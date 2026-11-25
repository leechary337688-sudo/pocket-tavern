// chat-engine — 会话状态机：发送 / 流式 / 暂停续写 / swipe / 分支 / 编辑 / 删除撤销。
// 仅依赖 core + repo + bus，不碰 DOM（ui 通过私有事件订阅）。

import { ApiClient } from '../core/api-client.js';
import { buildPrompt } from '../core/prompt-builder.js';
import { resolveMounts } from '../core/mount-resolver.js';
import { planSpeakers, findMentions } from '../core/group-scheduler.js';
import { estimateTokens } from '../core/tokenizer-lite.js';
import { makeId } from '../data/db.js';

const MAX_MESSAGES = 500;
const MAX_SWIPES = 5;
const UNDO_MS = 5000;
/** 群聊里一轮最多几个人接话，避免一按发送刷一屏 */
const MAX_GROUP_TURNS = 3;

function nowIso() {
  return new Date().toISOString();
}

function cloneMessage(message) {
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    swipes: Array.isArray(message.swipes) ? [...message.swipes] : [],
    swipeIndex: message.swipeIndex || 0,
    sendDate: message.sendDate,
    tokenEstimate: message.tokenEstimate || 0,
    starred: Boolean(message.starred),
    incomplete: Boolean(message.incomplete),
    interrupted: Boolean(message.interrupted),
    error: message.error || '',
    branchOf: message.branchOf || null,
    cardId: message.cardId || '',
    speaker: message.speaker || '',
  };
}

function newMessage(sender, text, extra = {}) {
  return {
    id: makeId('msg'),
    sender,
    text,
    swipes: sender === 'char' ? [text] : [],
    swipeIndex: 0,
    sendDate: nowIso(),
    tokenEstimate: estimateTokens(text),
    starred: false,
    ...extra,
  };
}

function overlapTrim(base, addition) {
  // 续写时模型有时会复述断点前的内容，去掉最长重叠（至少 6 字）
  const a = String(base || '');
  const b = String(addition || '');
  let max = Math.min(a.length, b.length, 400);
  for (let n = max; n >= 6; n--) {
    if (a.slice(-n) === b.slice(0, n)) return b.slice(n).replace(/^\s+/, '');
  }
  return b;
}

export class ChatEngine {
  constructor({ repo, bus } = {}) {
    this.repo = repo;
    this.bus = bus;
    this.chat = null;
    this.card = null;
    this.settings = repo?.settings || {};
    this.state = 'idle'; // idle | streaming | paused | error
    this.generatingMessage = null;
    this.abortController = null;
    this._listeners = new Map();
    this._buffer = '';
    this._baseText = '';
    this._flushHandle = null;
    this._saveTimer = null;
    this._lastSave = 0;
    this._mode = 'new';
    this._manualStop = false;
    this._interrupted = false;
    this._notice = '';
    this._undo = null;
    this._undoTimer = null;
    this.lastPrompt = null;
    this._regenWasEmpty = false;
    this._regenBackup = null;
    this._activeGeneration = null;
    // 群聊
    this.cast = [];
    this.members = [];
    this.speakerCard = null;
    this.lastMounts = null;
  }

  // ---------- 私有事件（UI） ----------
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  _emit(event, payload) {
    for (const fn of [...(this._listeners.get(event) || [])]) {
      try {
        fn(payload);
      } catch (err) {
        console.warn('[pt] engine listener error', event, err?.message);
      }
    }
  }

  // ---------- 打开 / 快照 ----------
  async open(chatId) {
    if (this.state === 'streaming') {
      await this.stop({ silent: true });
      if (this._activeGeneration) await this._activeGeneration.catch(() => {});
    }
    this.chat = await this.repo.getChat(chatId);
    if (!this.chat) throw new Error('找不到这个会话');
    await this._loadCast();
    const primary = this.card || {
      id: this.chat.cardId,
      name: '未知角色',
      first_mes: '……',
      tags: [],
    };
    this.card = primary;
    this.settings = this.repo.settings;
    this.state = 'idle';
    this.generatingMessage = null;
    this._interrupted = false;
    this.lastPrompt = null;
    this._emit('open', { chat: this.chat, card: this.card, members: this.members, kind: this.kind });
    this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
    this._emit('state', { state: 'idle' });
    return { chat: this.chat, card: this.card, members: this.members, kind: this.kind };
  }

  get kind() {
    return this.chat?.kind === 'group' ? 'group' : 'single';
  }

  get isGroup() {
    return this.kind === 'group';
  }

  /** 加载在座角色（群聊=全部成员；单聊=唯一主角）与各自的内嵌书。 */
  async _loadCast() {
    const chat = this.chat;
    if (!chat) {
      this.cast = [];
      this.members = [];
      this.card = null;
      return;
    }
    const ids = Array.isArray(chat.memberIds) && chat.memberIds.length ? [...chat.memberIds] : chat.cardId ? [chat.cardId] : [];
    const cards = [];
    const books = {};
    for (const id of ids) {
      const card = await this.repo.getCard(id);
      if (!card) continue;
      cards.push(card);
      const book = await this.repo.getCardBook(id);
      if (book) books[id] = book;
    }
    const memberState = chat.memberState || {};
    this.cast = cards;
    this.members = cards.map((c) => ({
      ...c,
      memberState: typeof memberState[c.id] === 'string'
        ? memberState[c.id]
        : (memberState[c.id]?.state || 'active'),
      talkativeness: Math.min(1, Math.max(0, Number(memberState[c.id]?.talkativeness ?? this.settings?.group?.defaultTalkativeness ?? 0.5))),
    }));
    this.cardBooks = books;
    this.card = cards.find((c) => c.id === chat.cardId) || cards[0] || null;
  }

  async refreshMembers() {
    if (!this.chat) return [];
    await this._loadCast();
    this._emit('members', { members: this.members, card: this.card });
    return this.members;
  }

  /** 解析本次组装要挂载的世界书（chat > persona > character > global）。 */
  async resolveMounts() {
    const worlds = await this.repo.listWorlds();
    const persona = (this.repo.personas || []).find?.((p) => p.id === this.settings?.personaId) || null;
    const result = resolveMounts({
      chat: this.chat,
      cards: this.isGroup ? this.cast : this.card ? [this.card] : [],
      cardBooks: this.cardBooks || {},
      settings: {
        ...(this.settings || {}),
        world: {
          ...(this.settings?.world || {}),
          maxBooks: this.chat?.advancedWorlds ? 8 : this.settings?.world?.maxBooks,
        },
      },
      persona,
      worlds,
    });
    this.lastMounts = result;
    return result;
  }

  /** 本轮发言计划（群聊）；单聊返回唯一主角。 */
  planTurns({ userInput = '', messages = null } = {}) {
    const history = messages || this.chat?.messages || [];
    if (!this.isGroup) {
      const card = this.card;
      return card ? [{ cardId: card.id, name: card.name, reason: '单聊', card }] : [];
    }
    const group = this.settings?.group || {};
    const plan = planSpeakers({
      members: this.members,
      messages: history,
      userInput,
      mode: this.chat?.mode || group.mode || 'natural_order',
      allowSelfResponses: Boolean(this.chat?.allowSelfResponses ?? group.allowSelfResponses),
      defaultTalkativeness: Number(group.defaultTalkativeness ?? 0.5),
    });
    const turns = (plan.plan || [])
      .slice(0, MAX_GROUP_TURNS)
      .map((item) => ({ ...item, card: this.members.find((m) => m.id === item.cardId) || null }))
      .filter((item) => item.card);
    turns.blockedMentions = plan.blockedMentions || [];
    return turns;
  }

  async refreshCard() {
    if (!this.chat) return;
    this.card = (await this.repo.getCard(this.chat.cardId)) || this.card;
    this._emit('card', this.card);
  }

  updateSettings(settings) {
    this.settings = settings;
  }

  getMessages() {
    return this.chat?.messages || [];
  }

  getChatInfo() {
    if (!this.chat) return null;
    return {
      id: this.chat.id,
      title: this.chat.title,
      cardId: this.chat.cardId,
      kind: this.kind,
      worldIds: Array.isArray(this.chat.worldIds) ? [...this.chat.worldIds] : [],
      advancedWorlds: Boolean(this.chat.advancedWorlds),
      memberIds: Array.isArray(this.chat.memberIds) ? [...this.chat.memberIds] : [],
      messageCount: this.chat.messages.length,
      createdAt: this.chat.createdAt,
      branchOf: this.chat.branchOf || null,
    };
  }

  getSnapshot() {
    return {
      chat: this.getChatInfo(),
      card: this.card ? { ...this.card } : null,
      members: this.members.map((m) => ({ ...m })),
      messages: this.getMessages().map(cloneMessage),
      state: this.state,
      generatingId: this.generatingMessage?.id || null,
      lastPromptTrace: this.lastPrompt?.trace || null,
      mounts: this.lastMounts,
    };
  }

  /** 修改会话的挂载设置（群聊成员 / 会话级世界书 / 发言规则）。 */
  async updateChatSettings(patch = {}) {
    if (!this.chat) throw new Error('还没有打开会话');
    let touched = false;
    if (Array.isArray(patch.memberIds)) {
      this.chat.memberIds = patch.memberIds.filter(Boolean);
      if (!this.chat.memberIds.includes(this.chat.cardId)) this.chat.cardId = this.chat.memberIds[0] || '';
      touched = true;
    }
    if (Array.isArray(patch.worldIds)) {
      const max = patch.advancedWorlds ? 8 : Math.max(1, Number(this.settings?.world?.maxBooks) || 1);
      this.chat.worldIds = patch.worldIds.filter(Boolean).slice(0, max);
      touched = true;
    }
    if (patch.advancedWorlds !== undefined) {
      this.chat.advancedWorlds = Boolean(patch.advancedWorlds);
      touched = true;
    }
    if (patch.mode !== undefined) {
      this.chat.mode = String(patch.mode || '');
      touched = true;
    }
    if (patch.title !== undefined && String(patch.title).trim()) {
      this.chat.title = String(patch.title).trim();
      touched = true;
    }
    if (patch.allowSelfResponses !== undefined) {
      this.chat.allowSelfResponses = Boolean(patch.allowSelfResponses);
      touched = true;
    }
    if (patch.memberState && typeof patch.memberState === 'object') {
      this.chat.memberState = { ...(this.chat.memberState || {}), ...patch.memberState };
      touched = true;
    }
    if (Array.isArray(patch.memberIds)) {
      const ids = [...new Set(patch.memberIds.map(String).filter(Boolean))];
      if (ids.length >= 2) {
        this.chat.memberIds = ids;
        this.chat.kind = 'group';
        this.chat.memberState = { ...(this.chat.memberState || {}) };
        const defaultTalk = Number(this.settings?.group?.defaultTalkativeness ?? 0.5);
        ids.forEach((id) => {
          if (!this.chat.memberState[id]) this.chat.memberState[id] = { talkativeness: defaultTalk, enabled: true };
        });
        touched = true;
      }
    }
    if (!touched) return this.getChatInfo();
    await this._loadCast();
    await this._saveNow();
    this.lastMounts = null;
    this._emit('members', { members: this.members, card: this.card });
    if (patch.memberState) {
      this.bus?.emit('chat:memberChanged', { chatId: this.chat.id, members: this.members.map((m) => ({ ...m })) });
    }
    this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
    return this.getChatInfo();
  }

  /** 主持人手动改成员在场状态：active / away / dead。 */
  async setMemberState(memberId, state) {
    const value = ['active', 'away', 'dead'].includes(state) ? state : 'active';
    const prev = this.chat?.memberState?.[memberId];
    const next = { ...(prev && typeof prev === 'object' ? prev : {}), state: value, enabled: value === 'active' };
    return this.updateChatSettings({ memberState: { [memberId]: next } });
  }

  /** 中途邀请角色：单聊会保留全部消息并升级为房间（group）。 */
  async inviteMembers(memberIds = []) {
    if (!this.chat) throw new Error('还没有打开会话');
    const base = Array.isArray(this.chat.memberIds) && this.chat.memberIds.length
      ? this.chat.memberIds
      : [this.chat.cardId];
    const ids = [...new Set([...base, ...memberIds.map(String).filter(Boolean)])];
    const cards = (await Promise.all(ids.map((id) => this.repo.getCard(id)))).filter(Boolean);
    const valid = cards.map((card) => card.id);
    if (valid.length < 2) throw new Error('房间里至少要有两位角色');
    this.chat.memberIds = valid;
    this.chat.kind = 'group';
    this.chat.memberState = { ...(this.chat.memberState || {}) };
    const defaultTalk = Number(this.settings?.group?.defaultTalkativeness ?? 0.5);
    valid.forEach((id) => {
      if (!this.chat.memberState[id]) this.chat.memberState[id] = { talkativeness: defaultTalk, enabled: true };
    });
    this.lastMounts = null;
    await this._loadCast();
    await this._saveNow();
    const added = cards.filter((card) => !base.includes(card.id));
    if (added.length) {
      await this.addSystemMessage(`（${added.map((card) => card.name).join('、')} 在桌边坐下，房间多了一位客人。）`);
    }
    this._emit('members', { members: this.members, card: this.card });
    this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
    return this.getChatInfo();
  }

  // ---------- 保存 ----------
  _queueSave(immediate = false) {
    if (!this.chat) return;
    if (immediate) {
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = null;
      const snapshot = this.chat;
      this.repo
        .saveChat(snapshot)
        .then(() => {
          this._lastSave = Date.now();
          this.bus?.emit('chat:changed', { chatId: snapshot.id, chat: snapshot });
        })
        .catch((err) => this._emit('notice', { level: 'error', message: `保存失败：${err.message}` }));
      return;
    }
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, 800);
  }

  async _saveNow() {
    if (!this.chat) return;
    try {
      await this.repo.saveChat(this.chat);
      this._lastSave = Date.now();
      this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
    } catch (err) {
      this._emit('notice', { level: 'error', message: `保存失败：${err.message}` });
    }
  }

  // ---------- 生成入口 ----------
  async send(text, { extraSystem = '' } = {}) {
    if (!this.chat) throw new Error('还没有打开会话');
    if (this.state === 'streaming') throw new Error('正在生成，先停止或等它写完');
    if (this.state === 'paused' || this.state === 'error') await this._settlePaused();
    const content = String(text || '').trim();
    if (!content) return;
    if (this.chat.messages.length >= MAX_MESSAGES) {
      throw new Error(`这个会话已有 ${MAX_MESSAGES} 条消息，先导出归档再开新会话`);
    }
    this._assertConfigured();
    const message = newMessage('user', content);
    this.chat.messages.push(message);
    await this._saveNow();
    this._emit('messageAdded', { message, index: this.chat.messages.length - 1 });
    this.bus?.emit('chat:messageSent', { chatId: this.chat.id, message: cloneMessage(message) });
    // 群聊：先按发言规则排出这一轮谁接话
    const turns = this.planTurns({ userInput: content });
    if (turns.blockedMentions?.length) {
      const names = [...new Set(turns.blockedMentions.map((m) => m.name))].join('、');
      this._emit('notice', { level: 'info', message: `${names} 已退场（可在回忆中相见）` });
    }
    if (this.isGroup && !turns.length) {
      this._emit('notice', { level: 'info', message: '这一轮没人接话，可以点名某位角色' });
      return;
    }
    await this._run({ mode: 'new', userInput: content, extraSystem, turns });
  }

  async _run(options) {
    const p = this._generate(options);
    this._activeGeneration = p;
    try {
      return await p;
    } finally {
      if (this._activeGeneration === p) this._activeGeneration = null;
    }
  }

  async regenerate(messageId) {
    if (!this.chat) throw new Error('还没有打开会话');
    if (this.state === 'streaming') throw new Error('正在生成，先停止');
    if (this.state === 'paused' || this.state === 'error') await this._settlePaused();
    const index = this.chat.messages.findIndex((m) => m.id === messageId);
    if (index < 0) throw new Error('找不到这条消息');
    const target = this.chat.messages[index];
    if (target.sender !== 'char') throw new Error('只能重生成角色的消息');
    if (index !== this.chat.messages.length - 1) throw new Error('目前只支持重生成最后一条消息');
    if ((target.swipes?.length || 0) >= MAX_SWIPES) throw new Error(`最多保留 ${MAX_SWIPES} 条 swipe，先切到想保留的那条`);
    this._assertConfigured();
    const hasUser = this.chat.messages.slice(0, index).some((m) => m.sender === 'user');
    const synthetic = hasUser ? '' : '（请用角色的口吻重新开场，只写角色的第一段回应。）';
    this._regenBackup = {
      text: target.text,
      swipes: Array.isArray(target.swipes) ? [...target.swipes] : [],
      swipeIndex: target.swipeIndex || 0,
    };
    target.text = '';
    target.incomplete = true;
    target.error = '';
    this._emit('messageUpdated', { message: target, index });
    this._queueSave();
    const speakerCard = this.isGroup
      ? this.members.find((m) => m.id === (target.cardId || this.chat.cardId)) || this.card
      : this.card;
    await this._run({
      mode: 'regen',
      userInput: synthetic,
      target,
      historyEnd: index,
      turns: [{ cardId: speakerCard?.id, name: speakerCard?.name, card: speakerCard, reason: '重新生成' }],
    });
  }

  async continueGeneration(messageId, { auto = false } = {}) {
    if (!this.chat) throw new Error('还没有打开会话');
    if (this.state === 'streaming') throw new Error('正在生成');
    this._assertConfigured();
    let target = messageId ? this.chat.messages.find((m) => m.id === messageId) : [...this.chat.messages].reverse().find((m) => m.sender === 'char');
    if (!target) throw new Error('没有可续写的角色消息');
    if (target.sender !== 'char') throw new Error('只能续写角色的消息');
    if (this.chat.messages[this.chat.messages.length - 1]?.id !== target.id && this.state !== 'paused') {
      throw new Error('只能续写最后一条角色消息');
    }
    const tail = String(target.text || '').slice(-700);
    const instruction = tail
      ? `【续写请求】上面这段回复被打断了。请紧接着它的最后一个字继续写，只输出新增内容，不要重复已有文字，不要解释：\n\n${tail}`
      : '【续写请求】请顺着上一条回复继续写下去，只输出新增内容，不要重复已有内容。';
    const index = this.chat.messages.indexOf(target);
    const speakerCard = this.isGroup
      ? this.members.find((m) => m.id === (target.cardId || this.chat.cardId)) || this.card
      : this.card;
    this._emit('state', { state: 'streaming', messageId: target.id, mode: 'continue', auto });
    try {
      await this._run({
        mode: 'continue',
        userInput: instruction,
        target,
        historyEnd: index,
        extraSystem: '',
        turns: [{ cardId: speakerCard?.id, name: speakerCard?.name, card: speakerCard, reason: '续写' }],
      });
    } catch (err) {
      if (auto) this._emit('notice', { level: 'error', message: '自动续写失败，点消息可再试一次' });
      throw err;
    }
  }

  async resumeMessage(messageId) {
    if (this.state === 'streaming') return;
    if (this.state !== 'paused' && this.state !== 'error') {
      const msg = this.chat?.messages.find((m) => m.id === messageId);
      if (!msg || !msg.incomplete) return this.continueGeneration(messageId);
    }
    const target = this.chat?.messages.find((m) => m.id === messageId);
    if (!target) return;
    if (this.generatingMessage && this.generatingMessage.id !== target.id) {
      await this._settlePaused();
    }
    this.state = 'idle';
    return this.continueGeneration(messageId);
  }

  async resumeIfInterrupted() {
    if (this.state !== 'paused' || !this._interrupted) return false;
    const target = this.generatingMessage || [...(this.chat?.messages || [])].reverse().find((m) => m.incomplete);
    if (!target) return false;
    this._emit('notice', { level: 'info', message: '连接恢复了，自动接着写…' });
    this._interrupted = false;
    try {
      await this.resumeMessage(target.id);
      return true;
    } catch {
      return false;
    }
  }

  async pause() {
    return this.stop();
  }

  async stop({ silent = false } = {}) {
    if (this.state !== 'streaming') return;
    this._manualStop = true;
    this._interrupted = false;
    if (this.abortController) this.abortController.abort();
    this.abortController = null;
    this._flushBuffer();
    this.state = 'paused';
    if (this.generatingMessage) {
      if (this.generatingMessage.text) this.generatingMessage.incomplete = true;
      this._saveNow();
      this._emit('messageUpdated', { message: this.generatingMessage, index: this.chat.messages.indexOf(this.generatingMessage) });
    }
    if (!silent) this._emit('state', { state: 'paused', messageId: this.generatingMessage?.id || null });
  }

  // ---------- 核心生成 ----------
  _assertConfigured() {
    const c = this.settings?.connection;
    if (!c?.endpoint || !c?.model) {
      throw new Error('还没有连接后端：设置 → 连接，填入端点与模型');
    }
  }

  _makeApi() {
    return new ApiClient({
      connection: this.settings.connection,
      sampler: this.settings.sampler,
      timeoutMs: 30000,
      retries: 2,
    });
  }

  async _build({ history, userInput, extraSystem, speaker = null }) {
    const mounts = await this.resolveMounts();
    const speakerCard = speaker || this.card || null;
    const result = buildPrompt({
      card: speakerCard,
      speakerCard,
      cast: this.isGroup ? this.cast : [],
      messages: history,
      worlds: mounts.worlds,
      settings: { ...this.settings, __mounts: mounts.mounts, __speaker: this.isGroup ? speakerCard?.name || '' : '' },
      userInput,
      extraSystem,
      sampler: this.settings.sampler,
      charName: speakerCard?.name,
      userName: this.settings?.personaName,
    });
    this.lastPrompt = { ...result, at: nowIso(), mounts };
    this.bus?.emit('chat:promptReady', {
      chatId: this.chat?.id,
      prompt: result.messages,
      trace: result.trace,
      card: speakerCard ? { ...speakerCard } : null,
      mounts: mounts.mounts,
    });
    return result;
  }

  async _generate(options) {
    const turns = Array.isArray(options.turns) && options.turns.length
      ? options.turns.map((turn) => ({ ...turn }))
      : [{ cardId: this.card?.id, name: this.card?.name, card: this.card, reason: '单聊' }];
    const spoken = new Set();
    let lastError = null;
    let lastMessage = null;
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.cardId) spoken.add(turn.cardId);
      let message = null;
      try {
        message = await this._generateTurn({ ...options, speaker: turn.card || null, turn, turnIndex: i });
      } catch (err) {
        lastError = err;
        const wasStop = this._manualStop || err?.name === 'AbortError';
        if (wasStop || i === turns.length - 1) return;
        this._emit('notice', { level: 'warn', message: `${turn?.name || '角色'}没接上话：${err?.message || err}` });
      }
      if (this._manualStop) {
        if (i < turns.length - 1) return;
        break;
      }
      if (message) lastMessage = message;
      // 自然接话：角色回复里整词点名了尚未发言的成员，就把对方请到下一棒。
      if (message && this.isGroup && options.mode === 'new' && turn.cardId) {
        const mentions = findMentions(message.text, this.members)
          .filter((member) => member.id && member.id !== turn.cardId && !spoken.has(member.id))
          .filter((member) => (member.memberState || 'active') === 'active');
        for (const member of mentions) {
          if (turns.length >= MAX_GROUP_TURNS) break;
          const later = turns.findIndex((item, index) => index > i && item.cardId === member.id);
          if (later >= 0) {
            const [queued] = turns.splice(later, 1);
            turns.splice(i + 1, 0, queued);
          } else {
            turns.splice(i + 1, 0, { cardId: member.id, name: member.name, card: member, reason: '被点名' });
          }
          spoken.add(member.id);
        }
      }
    }
    if (lastMessage) {
      this.bus?.emit('chat:generateAfter', { chatId: this.chat.id, message: cloneMessage(lastMessage) });
    }
    if (lastError && turns.length === 1) throw lastError;
  }

  async _generateTurn({ mode, userInput, extraSystem = '', target = null, historyEnd = null, speaker = null }) {
    if (!this.chat) throw new Error('还没有打开会话');
    this._assertConfigured();
    this._manualStop = false;
    this._interrupted = false;
    this._buffer = '';
    this._mode = mode;
    const speakerCard = speaker || this.card || null;

    let placeholder = target;
    if (mode === 'new') {
      placeholder = newMessage('char', '', {
        pending: true,
        cardId: speakerCard?.id || '',
        speaker: speakerCard?.name || '',
      });
      this.chat.messages.push(placeholder);
      this._emit('messageAdded', { message: placeholder, index: this.chat.messages.length - 1 });
      await this._saveNow();
    } else if (target) {
      this._baseText = String(target.text || '');
      if (mode === 'continue') target.error = '';
      if (speakerCard?.id) target.cardId = target.cardId || speakerCard.id;
      if (speakerCard?.name) target.speaker = target.speaker || speakerCard.name;
    }

    this.generatingMessage = placeholder;
    this.state = 'streaming';
    this._emit('state', { state: 'streaming', messageId: placeholder.id, mode, speaker: speakerCard?.name || '' });

    let history;
    if (mode === 'new') {
      history = this.chat.messages.filter((m) => m.id !== placeholder.id);
    } else if (mode === 'regen') {
      const end = historyEnd ?? this.chat.messages.indexOf(target);
      history = this.chat.messages.slice(0, Math.max(0, end));
    } else {
      const idx = this.chat.messages.indexOf(target);
      history = this.chat.messages.slice(0, Math.max(0, idx));
    }

    let prompt;
    try {
      prompt = await this._build({ history, userInput, extraSystem, speaker: speakerCard });
    } catch (err) {
      await this._handleFailure(err, placeholder);
      return;
    }
    if (this._manualStop) {
      await this._finishPaused(placeholder);
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;
    const api = this._makeApi();
    let retryNotice = '';

    try {
      const stats = await api.streamChat({
        messages: prompt.messages,
        signal: controller.signal,
        meta: { charName: speakerCard?.name, userName: this.settings?.personaName },
        onRetry: (n, err) => {
          retryNotice = `网络波动，重试 ${n}/2…`;
          this._emit('notice', { level: 'warn', message: `${retryNotice}（${err.message}）` });
        },
        onToken: (token) => this._onToken(token, placeholder),
        onMeta: (meta) => {
          this._lastUsage = meta?.usage || null;
        },
      });
      if (this._manualStop) {
        await this._finishPaused(placeholder);
        return;
      }
      this._flushBuffer();
      const finalText = String(placeholder.text || '').trim() ? placeholder.text : '';
      if (!finalText.trim()) throw new Error('模型没有返回内容');
      this._finalizeSuccess(placeholder, mode, finalText);
      this._buffer = '';
      this._tokenBatch = 0;
      this._regenBackup = null;
      await this._saveNow();
      this._emit('messageUpdated', { message: placeholder, index: this.chat.messages.indexOf(placeholder) });
      this._emit('state', { state: 'idle' });
      this.bus?.emit('chat:messageReceived', {
        chatId: this.chat.id,
        message: cloneMessage(placeholder),
        usage: stats?.usage || null,
      });
    } catch (err) {
      if (this._manualStop || err?.name === 'AbortError') {
        await this._finishPaused(placeholder);
      } else {
        await this._handleFailure(err, placeholder);
      }
      throw err;
    } finally {
      this.abortController = null;
      this._cancelFlush();
    }
    return placeholder;
  }

  _finalizeSuccess(message, mode, finalText) {
    message.text = finalText;
    message.pending = false;
    message.incomplete = false;
    message.interrupted = false;
    message.error = '';
    message.tokenEstimate = estimateTokens(finalText);
    if (mode === 'regen') {
      if (!Array.isArray(message.swipes)) message.swipes = [];
      // 暂停后继续时可能已放入临时 swipe；完成时更新它
      if (message.swipes.length && message.swipes[message.swipeIndex] === message.text) {
        // already in place
      } else if (message.swipes.length < MAX_SWIPES) {
        message.swipes.push(finalText);
        message.swipeIndex = message.swipes.length - 1;
      } else {
        message.swipes[MAX_SWIPES - 1] = finalText;
        message.swipeIndex = MAX_SWIPES - 1;
      }
    } else {
      if (!Array.isArray(message.swipes) || message.swipes.length === 0) message.swipes = [finalText];
      else message.swipes[message.swipeIndex || 0] = finalText;
      if (message.swipeIndex === undefined || message.swipeIndex === null) message.swipeIndex = 0;
    }
    this.state = 'idle';
    this.generatingMessage = null;
    this._mode = 'idle';
    this._interrupted = false;
    if (message.cardId) {
      this.lastSpeakerId = message.cardId;
      if (this.isGroup && this.chat) this.chat.speaker = message.cardId;
    }
  }

  async _finishPaused(message) {
    if (!message) return;
    this._flushBuffer();
    message.pending = false;
    message.incomplete = true;
    message.interrupted = this._interrupted;
    message.tokenEstimate = estimateTokens(message.text || '');
    if (message.sender === 'char' && message.text) {
      if (!Array.isArray(message.swipes)) message.swipes = [];
      if (!message.swipes.length) {
        message.swipes.push(message.text);
        message.swipeIndex = 0;
      } else if (message.swipes[message.swipeIndex] !== message.text) {
        if (message.swipes.length < MAX_SWIPES) {
          message.swipes.push(message.text);
          message.swipeIndex = message.swipes.length - 1;
        } else {
          message.swipes[message.swipeIndex] = message.text;
        }
      }
    }
    this._buffer = '';
    this._tokenBatch = 0;
    this._regenBackup = null;
    this.state = 'paused';
    this._manualStop = false;
    await this._saveNow();
    this._emit('messageUpdated', { message, index: this.chat?.messages.indexOf(message) ?? -1 });
    this._emit('state', { state: 'paused', messageId: message.id, interrupted: this._interrupted });
  }

  async _handleFailure(err, message) {
    this._flushBuffer();
    const raw = String(err?.message || '生成失败');
    const interrupted = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this._interrupted = interrupted;
    const wasRegen = this._mode === 'regen';
    if (message) {
      message.pending = false;
      message.incomplete = true;
      message.interrupted = interrupted;
      message.error = raw;
      if (wasRegen && this._regenBackup) {
        // 重生成失败时恢复原回复，保留已有 swipe，避免丢内容
        message.text = this._regenBackup.text;
        message.swipes = [...this._regenBackup.swipes];
        message.swipeIndex = this._regenBackup.swipeIndex;
        message.incomplete = false;
        message.error = '';
        this._regenBackup = null;
      } else if (message.sender === 'char' && message.text) {
        if (!Array.isArray(message.swipes) || !message.swipes.length) {
          message.swipes = [message.text];
          message.swipeIndex = 0;
        } else {
          message.swipes[message.swipeIndex || 0] = message.text;
        }
      }
      message.tokenEstimate = estimateTokens(message.text || '');
    }
    this._buffer = '';
    this._tokenBatch = 0;
    this.state = interrupted ? 'paused' : 'error';
    this.generatingMessage = message || null;
    await this._saveNow();
    if (message) this._emit('messageUpdated', { message, index: this.chat.messages.indexOf(message) });
    this._emit('state', { state: this.state, messageId: message?.id || null, interrupted });
    if (!interrupted) this._emit('error', { error: err, message: raw });
    else this._emit('notice', { level: 'warn', message: '连接中断，回到前台会自动续写' });
  }

  async _settlePaused() {
    const target = this.generatingMessage;
    this._cancelFlush();
    this._flushBuffer();
    if (target) {
      target.pending = false;
      target.incomplete = true;
      if (target.text && (!target.swipes || !target.swipes.length)) {
        target.swipes = [target.text];
        target.swipeIndex = 0;
      }
      await this._saveNow();
      this._emit('messageUpdated', { message: target, index: this.chat.messages.indexOf(target) });
    }
    this.state = 'idle';
    this.generatingMessage = null;
    this._interrupted = false;
  }

  // ---------- 流式缓冲：16ms 或 8 token 批量 flush ----------
  _onToken(token, message) {
    this._buffer += token;
    this._tokenBatch = (this._tokenBatch || 0) + 1;
    if (!this.generatingMessage) this.generatingMessage = message;
    if (this._tokenBatch >= 8) this._flushBuffer();
    else this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this._flushHandle) return;
    const run = () => {
      this._flushHandle = null;
      this._flushBuffer();
    };
    if (typeof requestAnimationFrame === 'function') this._flushHandle = requestAnimationFrame(run);
    else this._flushHandle = setTimeout(run, 16);
  }

  _cancelFlush() {
    if (!this._flushHandle) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._flushHandle);
    else clearTimeout(this._flushHandle);
    this._flushHandle = null;
  }

  _flushBuffer() {
    if (this._flushHandle) {
      this._cancelFlush();
    }
    if (!this._buffer) return;
    const target = this.generatingMessage;
    if (!target) {
      this._buffer = '';
      return;
    }
    target.text = (this._baseText || '') + this._buffer;
    target.tokenEstimate = estimateTokens(target.text);
    this._tokenBatch = 0;
    this._emit('stream', {
      messageId: target.id,
      text: target.text,
      delta: this._buffer,
      tokens: target.tokenEstimate,
    });
    if (Date.now() - this._lastSave > 700) this._queueSave();
  }

  // 流式结束时的最终文本：buffer 需先 flush
  finalizeBufferText(target) {
    return (this._baseText || '') + this._buffer;
  }

  // ---------- 编辑 / 删除 / swipe / 分支 ----------
  async editMessage(messageId, text) {
    const msg = this.chat?.messages.find((m) => m.id === messageId);
    if (!msg) throw new Error('找不到消息');
    const content = String(text || '').trim();
    if (!content) throw new Error('内容不能为空');
    msg.text = content;
    msg.tokenEstimate = estimateTokens(content);
    if (msg.sender === 'char') {
      if (!Array.isArray(msg.swipes) || !msg.swipes.length) msg.swipes = [content];
      msg.swipes[msg.swipeIndex || 0] = content;
    }
    msg.incomplete = false;
    await this._saveNow();
    this._emit('messageUpdated', { message: msg, index: this.chat.messages.indexOf(msg) });
    this.bus?.emit('chat:messageEdited', { chatId: this.chat.id, message: cloneMessage(msg) });
  }

  async addSystemMessage(text, { ephemeral = true } = {}) {
    if (!this.chat) return null;
    const content = String(text || '').trim();
    if (!content) return null;
    if (this.chat.messages.length >= MAX_MESSAGES) {
      this._emit('notice', { level: 'warn', message: `单聊最多保留 ${MAX_MESSAGES} 条，请先归档导出` });
      return null;
    }
    const msg = newMessage('system', content, { ephemeral });
    this.chat.messages.push(msg);
    await this._saveNow();
    this._emit('messageAdded', { message: msg, index: this.chat.messages.length - 1 });
    return msg;
  }

  async toggleStar(messageId) {
    const msg = this.chat?.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.starred = !msg.starred;
    await this._saveNow();
    this._emit('messageUpdated', { message: msg, index: this.chat.messages.indexOf(msg) });
    return msg.starred;
  }

  async switchSwipe(messageId, direction) {
    const msg = this.chat?.messages.find((m) => m.id === messageId);
    if (!msg || msg.sender !== 'char' || !Array.isArray(msg.swipes) || msg.swipes.length < 2) return null;
    const next = Math.min(msg.swipes.length - 1, Math.max(0, (msg.swipeIndex || 0) + direction));
    if (next === msg.swipeIndex) return msg;
    msg.swipeIndex = next;
    msg.text = msg.swipes[next];
    msg.tokenEstimate = estimateTokens(msg.text);
    msg.incomplete = false;
    await this._saveNow();
    this._emit('messageUpdated', { message: msg, index: this.chat.messages.indexOf(msg) });
    return msg;
  }

  async deleteMessage(messageId, { withFollowing = false } = {}) {
    if (this.state === 'streaming') throw new Error('正在生成，先停止再删除');
    const index = this.chat?.messages.findIndex((m) => m.id === messageId) ?? -1;
    if (index < 0) throw new Error('找不到消息');
    if (this._undo) this._clearUndo();
    const store = this.chat.messages.map((m) => cloneMessage(m));
    const removed = withFollowing ? this.chat.messages.splice(index) : this.chat.messages.splice(index, 1);
    this._undo = {
      chatId: this.chat.id,
      messages: store,
      removed: removed.map(cloneMessage),
      expiresAt: Date.now() + UNDO_MS,
    };
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => this._clearUndo(true), UNDO_MS);
    await this._saveNow();
    this._emit('messagesReplaced', { messages: this.chat.messages, reason: 'delete' });
    this._emit('deleted', { messageId, mode: withFollowing ? 'following' : 'single', removed: removed.length, expiresAt: this._undo.expiresAt });
    this._emit('undoChanged', { available: true, expiresAt: this._undo.expiresAt, removed: removed.length });
    this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
    return this._undo;
  }

  _clearUndo(expired = false) {
    clearTimeout(this._undoTimer);
    this._undoTimer = null;
    this._undo = null;
    this._emit('undoChanged', { available: false, expired });
  }

  get canUndo() {
    return Boolean(this._undo && Date.now() < this._undo.expiresAt);
  }

  async undoDelete() {
    if (!this.canUndo) return false;
    const undo = this._undo;
    this._clearUndo();
    if (!this.chat || undo.chatId !== this.chat.id) return false;
    this.chat.messages = undo.messages.map(cloneMessage);
    await this._saveNow();
    this._emit('messagesReplaced', { messages: this.chat.messages, reason: 'undo' });
    this._emit('restored', { count: undo.removed.length });
    this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
    return true;
  }

  async fork(messageId) {
    if (!this.chat) throw new Error('还没有打开会话');
    const index = this.chat.messages.findIndex((m) => m.id === messageId);
    if (index < 0) throw new Error('找不到消息');
    const chat = await this.repo.forkChat(this.chat, this.card, index);
    return chat;
  }

  async reset() {
    if (!this.chat) return;
    if (this.state === 'streaming') await this.stop();
    const text = String(this.card?.first_mes || '').trim() || '（她抬起头，等你开口。）';
    this.chat.messages = [newMessage('char', text)];
    await this._saveNow();
    this._emit('messagesReplaced', { messages: this.chat.messages, reason: 'reset' });
    this._emit('state', { state: 'idle' });
    this.bus?.emit('chat:changed', { chatId: this.chat.id, chat: this.chat });
  }

  async setTitle(title) {
    if (!this.chat) return;
    this.chat.title = String(title || '').trim() || this.chat.title;
    await this._saveNow();
    this._emit('title', { title: this.chat.title });
  }

  async buildPreview({ userInput = '', extraSystem = '', speakerId = '' } = {}) {
    if (!this.chat) throw new Error('先打开一个会话');
    const messages = this.chat.messages.filter((m) => !m.pending);
    let speaker = null;
    if (speakerId) {
      speaker = this.members.find((m) => m.id === speakerId) || null;
    } else if (this.isGroup) {
      // 预览跟随这一条输入的实际首位发言人，避免“预览是甲、发送却是乙”。
      const turns = this.planTurns({ userInput, messages });
      speaker = turns[0]?.card || this.members.find((m) => m.id === this.lastSpeakerId) || this.members[0];
    }
    return this._build({ history: messages, userInput, extraSystem, speaker: speaker || this.card });
  }

  async impersonate() {
    if (!this.chat) throw new Error('先打开一个会话');
    this._assertConfigured();
    const instruction =
      '【代写请求】请以 {{user}} 的第一人称，写一句此刻适合说出口的台词或动作，只输出这一句。不要替 {{char}} 说话，不要解释。';
    const result = await this.buildPreview({ userInput: instruction });
    const api = this._makeApi();
    let out = '';
    const controller = new AbortController();
    await api.streamChat({
      messages: result.messages,
      signal: controller.signal,
      meta: { charName: this.card?.name, userName: this.settings?.personaName },
      onToken: (t) => {
        out += t;
      },
    });
    return out.trim().replace(/^["“]|["”]$/g, '');
  }

  async destroy() {
    await this.stop({ silent: true });
    this._cancelFlush();
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._clearUndo();
    if (this.chat) await this.repo.saveChat(this.chat).catch(() => {});
    this._listeners.clear();
  }
}

export { MAX_MESSAGES, MAX_SWIPES, UNDO_MS };
