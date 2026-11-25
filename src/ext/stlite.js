// stlite — 插件唯一宿主 API。插件不能直接 import 宿主模块；一切经这里。
// 权限：storage / network / tts 在 API 层执行；apiKey 永不暴露明文。
// 注意：这是 API 层清单制，不是 JS 沙箱；第三方插件仍需审计源码。

import { rollDice } from '../core/dice-engine.js';
import { estimateTokens } from '../core/tokenizer-lite.js';

export const STLITE_VERSION = '1.0.0';

export const STLITE_EVENTS = Object.freeze([
  'app:ready',
  'chat:promptReady',
  'chat:generateAfter',
  'chat:messageSent',
  'chat:messageReceived',
  'chat:messageEdited',
  'chat:changed',
  'chat:memberChanged',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object') return value;
  for (const v of Object.values(value)) freezeDeep(v);
  return Object.freeze(value);
}

/**
 * @param {object} opts
 * @param {object} opts.manifest 插件 manifest
 * @param {object} opts.repo 宿主 repo（仅用于 extdata）
 * @param {object} opts.bus 宿主总线
 * @param {object} opts.bridge 宿主桥（getChatSnapshot / getCurrentCard / getSettings / tts / toast）
 * @param {object} opts.ui 注册表 { registerPanel, registerQuickReply }
 * @param {Array<Function>} opts.cleanup 清理函数栈
 * @param {(err:Error, context:string)=>void} opts.onError
 */
export function createSTLite({ manifest, repo, bus, bridge, ui, cleanup, onError }) {
  const pluginId = manifest.id;
  const perms = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
  const listenerMap = new Map();

  function trackedHandler(event, handler) {
    const wrapped =
      event === 'chat:promptReady'
        ? (payload) => handler(payload)
        : (...args) => handler(...args);
    return (...args) => {
      try {
        wrapped(...args);
      } catch (err) {
        onError?.(err, `event ${event}`);
      }
    };
  }

  const eventSource = Object.freeze({
    on(event, handler) {
      if (!STLITE_EVENTS.includes(event)) throw new Error(`不支持的事件：${event}`);
      if (typeof handler !== 'function') throw new Error('handler 必须是函数');
      const wrapped = trackedHandler(event, handler);
      const off = bus.on(event, wrapped);
      if (!listenerMap.has(event)) listenerMap.set(event, []);
      listenerMap.get(event).push({ handler, wrapped, off });
      cleanup.push(off);
      return off;
    },
    off(event, handler) {
      const arr = listenerMap.get(event);
      if (!arr) return false;
      const idx = arr.findIndex((x) => x.handler === handler);
      if (idx < 0) return false;
      const [entry] = arr.splice(idx, 1);
      entry.off();
      return true;
    },
    emit() {
      throw new Error('插件不能主动 emit 宿主事件');
    },
  });

  const storage = (() => {
    if (!perms.has('storage')) {
      const deny = () => Promise.reject(new Error('插件未声明 storage 权限'));
      return { get: deny, set: deny, remove: deny, keys: deny, clear: deny };
    }
    return {
      async get(key, fallback = undefined) {
        if (!key) return fallback;
        const value = await repo.extGet(pluginId, String(key));
        return value === undefined ? fallback : value;
      },
      async set(key, value) {
        if (!key) throw new Error('storage key 不能为空');
        await repo.extSet(pluginId, String(key), value);
        return true;
      },
      async remove(key) {
        await repo.extDelete(pluginId, String(key));
      },
      async keys() {
        return repo.extKeys(pluginId);
      },
      async clear() {
        const keys = await repo.extKeys(pluginId);
        for (const k of keys) await repo.extDelete(pluginId, k);
      },
    };
  })();

  const tts = perms.has('tts')
    ? Object.freeze({
        speak(text, opts) {
          return bridge.ttsSpeak(String(text || ''), opts || {});
        },
      })
    : Object.freeze({
        speak() {
          throw new Error('插件未声明 tts 权限');
        },
      });

  const net = perms.has('network')
    ? Object.freeze({
        fetch: (...args) => {
          // 插件网络仍受浏览器同源 / CORS 约束；宿主不代理任何请求
          return fetch(...args);
        },
      })
    : undefined;

  const llm = Object.freeze({
    async complete(messages, opts = {}) {
      if (!perms.has('network')) throw new Error('插件未声明 network 权限');
      if (!bridge.llmComplete) return null;
      return bridge.llmComplete(messages, opts);
    },
  });

  const chatApi = Object.freeze({
    getMessages() {
      const snap = bridge.getChatSnapshot();
      return (snap?.messages || []).map((m) => ({ ...m, swipes: [...(m.swipes || [])] }));
    },
    getChatInfo() {
      return bridge.getChatSnapshot()?.chat || null;
    },
    getMembers() {
      const members = bridge.getChatSnapshot()?.members || [];
      return freezeDeep(members.map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar || '',
        memberState: m.memberState || 'active',
        talkativeness: Number(m.talkativeness ?? 0.5),
      })));
    },
    getState() {
      return bridge.getChatSnapshot()?.state || 'idle';
    },
    getMounts() {
      return bridge.getChatSnapshot()?.mounts || null;
    },
    async setMemberState(memberId, state) {
      if (!bridge.setMemberState) throw new Error('当前宿主不支持成员状态');
      return bridge.setMemberState(String(memberId), String(state));
    },
    getLastPromptTrace() {
      const trace = bridge.getChatSnapshot()?.lastPromptTrace;
      return trace ? freezeDeep(JSON.parse(JSON.stringify(trace))) : null;
    },
  });

  const character = () => freezeDeep(JSON.parse(JSON.stringify(bridge.getCurrentCard() || {})));
  const settings = () => freezeDeep(JSON.parse(JSON.stringify(bridge.getSettings() || {})));

  const storageApi = (id) => {
    if (id && id !== pluginId) throw new Error('不能访问其它插件的存储');
    return storage;
  };
  Object.assign(storageApi, storage);

  const api = {
    version: STLITE_VERSION,
    pluginId,
    eventSource,
    chat: chatApi,
    storage: storageApi,
    ui: Object.freeze({
      registerPanel(panel) {
        if (!panel || typeof panel.render !== 'function') throw new Error('registerPanel 需要 render(el)');
        if (typeof panel.title !== 'string') throw new Error('registerPanel 需要 title');
        const item = Object.freeze({
          pluginId,
          pluginName: manifest.name || pluginId,
          icon: String(panel.icon || '🧩'),
          title: String(panel.title),
          render(el) {
            try {
              return panel.render(el);
            } catch (err) {
              onError?.(err, 'panel render');
              if (el) el.textContent = '面板加载失败，请查看控制台或禁用该插件。';
            }
          },
        });
        return ui.registerPanel(item);
      },
      registerQuickReply(reply) {
        if (!reply || typeof reply.onTap !== 'function') throw new Error('registerQuickReply 需要 onTap');
        if (typeof reply.label !== 'string') throw new Error('registerQuickReply 需要 label');
        const item = Object.freeze({
          pluginId,
          pluginName: manifest.name || pluginId,
          label: String(reply.label).slice(0, 24),
          onTap: () => {
            try {
              return reply.onTap();
            } catch (err) {
              onError?.(err, 'quick reply');
            }
          },
        });
        return ui.registerQuickReply(item);
      },
      registerAvatarDecorator(resolve) {
        if (typeof resolve !== 'function') throw new Error('registerAvatarDecorator 需要 resolve(context)');
        const item = Object.freeze({
          pluginId,
          pluginName: manifest.name || pluginId,
          resolve(context = {}) {
            try {
              return resolve(context);
            } catch (err) {
              onError?.(err, 'avatar decorator');
              return null;
            }
          },
        });
        return ui.registerAvatarDecorator(item);
      },
      registerMemberCard(card) {
        if (!card || typeof card.render !== 'function') throw new Error('registerMemberCard 需要 render(el, member)');
        const item = Object.freeze({
          pluginId,
          pluginName: manifest.name || pluginId,
          title: String(card.title || manifest.name || pluginId),
          render(el, member) {
            try {
              return card.render(el, member);
            } catch (err) {
              onError?.(err, 'member card');
              return null;
            }
          },
        });
        return ui.registerMemberCard(item);
      },
      toast(message) {
        bridge.toast(String(message || ''));
      },
      jumpToMessage(messageId) {
        bridge.jumpToMessage?.(String(messageId || ''));
      },
    }),
    dice: Object.freeze({
      roll(expr = '1d20') {
        return rollDice(expr);
      },
    }),
    tokenizer: Object.freeze({ estimate: estimateTokens }),
    llm,
    tts,
    ...(net ? { net } : {}),
  };

  Object.defineProperty(api, 'character', {
    enumerable: true,
    get: character,
  });
  Object.defineProperty(api, 'settings', {
    enumerable: true,
    get: settings,
  });

  return Object.freeze(api);
}
