// trial-sandbox — 免保存的试聊沙盒。
//
// 补丁 A 的铁律：试穿全程只写独立的 trials store；
// cards / worlds / chats 三张正式表只在 promote()（用户点“转正”）里出现写入。
// 转正按 contentHash 判重：同 hash 直接复用；同名不同 hash 交给 onConflict 决定
// “复用旧的 / 并存为《X(2)》”。重复点转正幂等。
import { ApiClient } from '../core/api-client.js';
import { buildPrompt } from '../core/prompt-builder.js';
import { estimateTokens } from '../core/tokenizer-lite.js';
import { hashCard, hashWorld } from '../data/content-hash.js';

let seq = 0;
function nextId(prefix = 'trial') {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeCard(card) {
  const out = clone(card || {});
  out.name = String(out.name || '未命名角色').slice(0, 80);
  out.tags = Array.isArray(out.tags) ? out.tags.slice(0, 12) : [];
  out.first_mes = String(out.first_mes || '（角色抬起头，看向你。）');
  return out;
}

function makeMessage(sender, text) {
  const value = String(text || '');
  return {
    id: nextId('trial-msg'),
    sender,
    text: value,
    swipes: [value],
    swipeIndex: 0,
    sendDate: new Date().toISOString(),
    tokenEstimate: estimateTokens(value),
    starred: false,
    trial: true,
  };
}

/**
 * 试聊沙盒：
 * - 所有状态（含消息）持久化在 trials store，不碰正式表。
 * - promote() 才写 cards/worlds/chats，并返回正式会话。
 */
export class TrialSandbox {
  constructor({ repo, settings, card, world = null, title = '', trialId = '', onConflict = null } = {}) {
    this.repo = repo;
    this.settings = settings;
    this.id = trialId || nextId('trial');
    this.card = normalizeCard(card);
    this.world = world ? clone(world) : null;
    this.title = title || `与${this.card.name}的初见`;
    this.messages = [];
    this.state = 'idle'; // idle | starting | ready | streaming | error | promoted | discarded
    this.error = '';
    this.promoted = null;
    this.listeners = new Set();
    this.controller = null;
    this.disposed = false;
    this._autoStarted = false;
    this._promoting = null;
    this.onConflict = onConflict;
  }

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    const snap = this.snapshot();
    for (const fn of [...this.listeners]) {
      try {
        fn(snap);
      } catch {
        /* 订阅者异常不影响沙盒 */
      }
    }
  }

  snapshot() {
    return {
      id: this.id,
      card: clone(this.card),
      world: this.world ? clone(this.world) : null,
      title: this.title,
      messages: this.messages.map((m) => ({ ...m, swipes: [...m.swipes] })),
      state: this.state,
      error: this.error,
      count: this.messages.length,
      canPromote: this.messages.length >= 3 && this.state !== 'streaming' && this.state !== 'promoted',
      promoted: this.promoted
        ? { chatId: this.promoted.chat?.id, cardId: this.promoted.card?.id, worldId: this.promoted.world?.id || '' }
        : null,
      disposed: this.disposed,
    };
  }

  /** 只写 trials store；任何失败都不应阻断试聊。 */
  async _persist(extra = {}) {
    // 丢弃后即使生成回调还在跑，也不能把 trial 又写回来。
    if (this.disposed) return null;
    const record = {
      id: this.id,
      kind: this.world ? 'bundle' : 'card',
      status: this.state,
      card: clone(this.card),
      world: this.world ? clone(this.world) : null,
      title: this.title,
      messages: this.messages.map((m) => clone(m)),
      error: this.error,
      promoted: this.promoted
        ? { chatId: this.promoted.chat?.id || '', cardId: this.promoted.card?.id || '', worldId: this.promoted.world?.id || '' }
        : null,
      updatedAt: new Date().toISOString(),
      createdAt: this.createdAt || new Date().toISOString(),
      ...extra,
    };
    this.createdAt = record.createdAt;
    try {
      await this.repo.saveTrial(record);
    } catch {
      /* 沙盒存储失败不阻断 */
    }
    return record;
  }

  _client() {
    return new ApiClient({
      connection: this.settings?.connection || {},
      sampler: {
        ...this.settings?.sampler,
        temperature: Number(this.settings?.sampler?.temperature ?? 0.8),
        max_tokens: Math.min(512, Number(this.settings?.sampler?.max_tokens) || 512),
      },
      timeoutMs: 30000,
      retries: 1,
    });
  }

  async _generateReply() {
    const client = this._client();
    if (!client.configured) throw new Error('还没有连接后端。先在设置里填端点，或点「本地演示」用 mock。');
    const prompt = buildPrompt({
      card: this.card,
      messages: this.messages,
      worlds: this.world ? [{ ...this.world, enabled: true }] : [],
      settings: this.settings,
      userInput: '',
      sampler: client.sampler || this.settings?.sampler,
      charName: this.card.name,
      userName: this.settings?.personaName || '旅人',
    });
    const placeholder = makeMessage('char', '');
    this.messages.push(placeholder);
    this.state = 'streaming';
    this._emit();
    let text = '';
    let buffer = '';
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!buffer) return;
      text += buffer;
      buffer = '';
      placeholder.text = text;
      placeholder.swipes = [text];
      placeholder.tokenEstimate = estimateTokens(text);
      this._emit();
    };
    this.controller = new AbortController();
    try {
      await client.streamChat({
        messages: prompt.messages,
        signal: this.controller.signal,
        onToken: (token) => {
          buffer += token;
          if (!raf) raf = requestAnimationFrame(flush);
        },
      });
      if (raf) cancelAnimationFrame(raf);
      flush();
      if (!text.trim()) {
        placeholder.text = '（角色沉默了一会儿，似乎在斟酌措辞。）';
        placeholder.swipes = [placeholder.text];
        placeholder.tokenEstimate = estimateTokens(placeholder.text);
      }
      this.state = 'ready';
      this.error = '';
    } catch (err) {
      if (raf) cancelAnimationFrame(raf);
      this.messages.pop();
      this.state = 'error';
      this.error = err?.name === 'AbortError' ? '生成已停止' : String(err?.message || err);
      throw err;
    } finally {
      this.controller = null;
      await this._persist();
      this._emit();
    }
  }

  /** 自动开场：问候 → 一条试探 → 角色回应，共 3 条。 */
  async start() {
    if (this._autoStarted) return this.snapshot();
    this._autoStarted = true;
    if (this.disposed) return this.snapshot();
    this.messages = [makeMessage('char', this.card.first_mes)];
    this.state = 'starting';
    this.error = '';
    await this._persist();
    this._emit();
    const client = this._client();
    if (!client.configured) {
      this.state = 'ready';
      this.error = '先把后端连接填上，试聊才会自动长出 3 条。';
      await this._persist();
      this._emit();
      return this.snapshot();
    }
    try {
      this.messages.push(makeMessage('user', '（我在吧台前坐下，把杯子推到一边，抬头看向你。）'));
      this._emit();
      await this._generateReply();
    } catch (err) {
      this.state = 'ready';
      if (!this.error) this.error = String(err?.message || err);
      await this._persist();
      this._emit();
    }
    return this.snapshot();
  }

  async send(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    if (this.disposed) throw new Error('试聊已丢弃');
    if (this.state === 'streaming') throw new Error('正在生成，稍等一下');
    if (this.messages.length > 60) throw new Error('试聊太长了，先转正再继续');
    this.messages.push(makeMessage('user', value));
    await this._persist();
    this._emit();
    await this._generateReply();
    return this.snapshot();
  }

  async regenerate() {
    if (this.disposed) throw new Error('试聊已丢弃');
    if (this.state === 'streaming') throw new Error('正在生成，稍等一下');
    while (this.messages.length && this.messages[this.messages.length - 1].sender === 'char') this.messages.pop();
    if (!this.messages.length) this.messages.push(makeMessage('user', '（我看向你，等你开口。）'));
    await this._generateReply();
    return this.snapshot();
  }

  stop() {
    this.controller?.abort();
  }

  _uniqueWorldName(base, existingNames) {
    const names = new Set(existingNames.map((n) => String(n || '').trim()));
    const name = String(base || '未命名世界书').replace(/\s*\(\d+\)$/, '').trim() || '未命名世界书';
    if (!names.has(name)) return name;
    for (let i = 2; i < 200; i++) {
      const candidate = `${name}(${i})`;
      if (!names.has(candidate)) return candidate;
    }
    return `${name}(${Date.now().toString(36)})`;
  }

  /** 唯一的正式写入点：保存卡/世界书，并创建正式会话。 */
  async promote({ onConflict = null } = {}) {
    if (this.disposed) throw new Error('试聊已丢弃');
    if (this.messages.length < 3) throw new Error('至少试聊 3 条再转正');
    if (this.state === 'streaming') throw new Error('正在生成，稍等一下');
    if (this.promoted?.chat) return this.promoted;
    if (this._promoting) return this._promoting;

    this._promoting = (async () => {
      // 1) 卡：同 hash 复用；否则新建
      const cardDraft = clone(this.card);
      delete cardDraft.id;
      delete cardDraft.createdAt;
      delete cardDraft.updatedAt;
      cardDraft.builtin = false;
      const cardHash = await hashCard(cardDraft);
      let card = null;
      const sameCards = await this.repo.findCardsByHash(cardHash);
      if (sameCards.length) {
        card = sameCards[0];
      } else {
        card = await this.repo.saveCard(cardDraft);
      }

      // 2) 世界书：同 hash 复用；同名不同 hash 询问
      let world = null;
      if (this.world) {
        const worldDraft = clone(this.world);
        delete worldDraft.id;
        delete worldDraft.createdAt;
        delete worldDraft.updatedAt;
        const worldHash = await hashWorld(worldDraft);
        const sameWorlds = await this.repo.findWorldsByHash(worldHash);
        if (sameWorlds.length) {
          world = sameWorlds[0];
        } else {
          const sameName = await this.repo.findWorldsByName(worldDraft.name);
          if (sameName.length) {
            const decide = typeof (onConflict || this.onConflict) === 'function' ? onConflict || this.onConflict : null;
            let decision = 'reuse';
            if (decide) {
              try {
                decision = await decide({
                  name: String(worldDraft.name || '未命名世界书'),
                  existing: sameName.map((w) => ({ ...w })),
                  incoming: { ...worldDraft },
                });
              } catch {
                decision = 'reuse';
              }
            }
            if (decision === 'rename') {
              worldDraft.name = this._uniqueWorldName(worldDraft.name, sameName.map((w) => w.name));
              world = await this.repo.saveWorld(worldDraft);
            } else {
              world = sameName[0];
            }
          } else {
            world = await this.repo.saveWorld(worldDraft);
          }
        }
      }

      // 3) 正式会话：只在这里 createChat
      const messages = this.messages.map((m) => ({
        ...clone(m),
        id: nextId('msg'),
        trial: undefined,
      }));
      const chat = await this.repo.createChat(card, {
        title: this.title,
        messages,
        worldIds: world ? [world.id] : [],
        kind: 'single',
      });
      this.state = 'promoted';
      this.promoted = { card, world, chat };
      await this._persist();
      this._emit();
      return this.promoted;
    })();

    try {
      return await this._promoting;
    } finally {
      this._promoting = null;
    }
  }

  async discard() {
    this.controller?.abort();
    this.controller = null;
    this.disposed = true;
    // 丢弃 = 删 trial 记录，临时引用一起清掉；正式表没有任何写入
    try {
      await this.repo.deleteTrial(this.id);
    } catch {
      /* 已删 */
    }
    this.messages = [];
    this.state = 'discarded';
    this._emit();
  }

  destroy() {
    this.controller?.abort();
    this.controller = null;
    this.listeners.clear();
    this.disposed = true;
  }
}

export function createTrialSandbox(opts) {
  return new TrialSandbox(opts);
}
