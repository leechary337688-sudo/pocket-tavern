// plot-director — 盯伏笔、盯连续平淡；只做提示，不替玩家/角色做决定。
// 伏笔来自当前挂载世界书里带「真相/伏笔」标记的条目；提示语不剧透内容。

const KEY = 'state';
const FLAT_LIMIT = 10;
const FLAT_RE = /(但是|可是|然而|突然|忽然|竟|居然|没想到|原来|反而|危机|逼近|发现|揭开|暴露|门被|血|死|救|逃|追|转身|沉默|笑|哭|吻|抱)/;

function nowIso() {
  return new Date().toISOString();
}

function textOf(message) {
  return String(message?.text || '');
}

function collectTruths(mounts) {
  const worlds = Array.isArray(mounts?.worlds) ? mounts.worlds : [];
  const out = [];
  for (const world of worlds) {
    for (const entry of world.entries || []) {
      const comment = String(entry.comment || '');
      const content = String(entry.content || '');
      if (!/(真相|伏笔|暗线|秘密|truth)/i.test(`${comment} ${content.slice(0, 40)}`)) continue;
      out.push({
        id: `${world.id}:${entry.uid}`,
        world: world.name,
        comment: comment || '未命名伏笔',
        keys: (entry.key || []).slice(0, 4),
        triggered: false,
        triggeredAt: '',
      });
    }
  }
  return out.slice(0, 30);
}

export default {
  init(api) {
    const bridge = { state: { chats: {} }, disposed: false, timer: null, panels: [] };
    const chatInfo = () => api.chat.getChatInfo() || {};
    const chatState = () => {
      const id = String(chatInfo().id || '');
      if (!id) return null;
      if (!bridge.state.chats[id]) {
        bridge.state.chats[id] = { foreshadows: [], flat: 0, sugar: 1, injectedFlat: 0, lastTurn: 0, applied: {} };
      }
      const st = bridge.state.chats[id];
      if (!Array.isArray(st.foreshadows)) st.foreshadows = [];
      if (typeof st.flat !== 'number') st.flat = 0;
      if (typeof st.sugar !== 'number') st.sugar = 1;
      return st;
    };
    const save = () => {
      if (bridge.timer) return;
      bridge.timer = setTimeout(() => {
        bridge.timer = null;
        if (!bridge.disposed) api.storage.set(KEY, bridge.state).catch(() => {});
      }, 200);
    };
    const draw = () => {
      for (const fn of bridge.panels) {
        try {
          fn();
        } catch {
          /* 面板异常隔离 */
        }
      }
    };
    const syncForeshadows = () => {
      const st = chatState();
      if (!st) return;
      const truths = collectTruths(api.chat.getMounts?.());
      const byId = new Map(st.foreshadows.map((item) => [item.id, item]));
      st.foreshadows = truths.map((truth) => ({ ...truth, ...(byId.get(truth.id) || {}) }));
      save();
    };
    const markTriggered = (message) => {
      const st = chatState();
      if (!st || message?.sender !== 'char') return;
      const text = textOf(message);
      let changed = false;
      for (const item of st.foreshadows) {
        if (item.triggered) continue;
        const hit = item.keys?.some((key) => key && text.includes(key)) || (item.comment && text.includes(item.comment));
        if (hit) {
          item.triggered = true;
          item.triggeredAt = nowIso();
          changed = true;
        }
      }
      if (changed) {
        save();
        draw();
      }
    };
    const afterTurn = (message) => {
      const st = chatState();
      if (!st) return;
      st.lastTurn += 1;
      markTriggered(message);
      const text = textOf(message);
      if (FLAT_RE.test(text)) st.flat = 0;
      else st.flat += 1;
      save();
      draw();
    };
    const inject = (prompt) => {
      const st = chatState();
      if (!st || !Array.isArray(prompt)) return;
      if (st.flat >= FLAT_LIMIT && st.injectedFlat !== st.lastTurn) {
        prompt.push({ role: 'system', content: '【节奏提示】最近几轮一直在日常/原地打转。让环境或某个人主动推一下：一个不速之客、一条坏消息、一个被藏起来的物件，或一次不合时宜的坦白。不要解释这条提示。' });
        st.injectedFlat = st.lastTurn;
        st.flat = 0;
        save();
        api.ui.toast('剧情导演轻轻敲了敲桌子');
      }
      if (st.sugar > 0) {
        prompt.push({ role: 'system', content: `【关系节奏】本轮糖分密度 ${st.sugar}/3。关系推进要具体、克制，不要用总结代替互动。` });
      }
    };

    api.eventSource.on('app:ready', () => {
      syncForeshadows();
      draw();
    });
    api.eventSource.on('chat:changed', () => {
      syncForeshadows();
      draw();
    });
    api.eventSource.on('chat:messageReceived', ({ message } = {}) => {
      markTriggered(message);
      draw();
    });
    api.eventSource.on('chat:generateAfter', ({ message } = {}) => {
      afterTurn(message);
    });
    api.eventSource.on('chat:promptReady', ({ prompt } = {}) => inject(prompt));

    api.ui.registerPanel({
      icon: '🎬',
      title: '剧情导演',
      render(el) {
        const render = () => {
          if (bridge.disposed) return;
          el.innerHTML = '';
          const st = chatState();
          const head = document.createElement('div');
          head.className = 'director__head';
          head.innerHTML = `<strong>剧情导演</strong><span>${st ? (st.flat >= FLAT_LIMIT ? '该推一把了' : `连续平淡 ${st.flat}/${FLAT_LIMIT}`) : '先打开一局聊天'}</span>`;
          el.appendChild(head);
          if (!st) return;
          const unresolved = st.foreshadows.filter((item) => !item.triggered);
          const box = document.createElement('div');
          box.className = 'director__list';
          if (!unresolved.length) {
            box.innerHTML = '<p class="director__empty">当前挂载的世界书里没有未回收的伏笔条目。</p>';
          }
          for (const item of unresolved.slice(0, 12)) {
            const row = document.createElement('div');
            row.className = 'director__item';
            row.innerHTML = `<strong>${item.comment}</strong><small>《${item.world}》 · 未回收</small><p>${item.keys?.length ? `关键词：${item.keys.join(' / ')}` : '没有关键词，靠场景自然回收'}</p>`;
            box.appendChild(row);
          }
          el.appendChild(box);
          const sugarBox = document.createElement('label');
          sugarBox.className = 'director__sugar';
          sugarBox.innerHTML = `<span>糖分密度 <b>${st.sugar}</b> / 3</span><input type="range" min="0" max="3" step="1" value="${st.sugar}">`;
          const range = sugarBox.querySelector('input');
          range.addEventListener('input', () => {
            st.sugar = Number(range.value) || 0;
            sugarBox.querySelector('b').textContent = st.sugar;
            save();
          });
          el.appendChild(sugarBox);
        };
        bridge.panels.push(render);
        render();
        return () => {
          const index = bridge.panels.indexOf(render);
          if (index >= 0) bridge.panels.splice(index, 1);
        };
      },
    });

    api.storage.get(KEY, null).then((saved) => {
      if (saved && typeof saved === 'object') bridge.state = { chats: saved.chats || {} };
      syncForeshadows();
      draw();
    }).catch(() => {});

    return {
      unload() {
        bridge.disposed = true;
        if (bridge.timer) clearTimeout(bridge.timer);
      },
    };
  },
};
