// repo — 业务数据门面：卡 / 会话 / 世界书 / 设置 / 人格 / 插件数据 / 快照 / 备份。

import {
  STORES,
  clone,
  dbBulkPut,
  dbClear,
  dbDelete,
  dbGet,
  dbGetAll,
  dbGetAllByIndex,
  dbPut,
  makeId,
  openDB,
} from './db.js';
import { DEMO_CARD, DEMO_PERSONA, DEMO_WORLD, defaultSettings, demoChat } from './seed.js';
import { estimateTokens } from '../core/tokenizer-lite.js';
import { normalizeSampler } from '../core/sampler.js';
import { hashCard, hashWorld, shortHash } from './content-hash.js';
import { normalizeCharacterBook, toCharacterBook } from '../core/card-codec.js';

export const APP_NAME = 'PocketTavern';
export const APP_VERSION = '0.2.0';

function nowIso() {
  return new Date().toISOString();
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return clone(patch ?? base);
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = mergeDeep(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}

function normalizeSettings(raw) {
  const d = defaultSettings();
  const merged = mergeDeep(d, raw || {});
  merged.key = 'app';
  merged.version = 1;
  merged.sampler = normalizeSampler(merged.sampler);
  merged.connection = { ...d.connection, ...(raw?.connection || {}) };
  merged.sound = { ...d.sound, ...(raw?.sound || {}) };
  merged.prompt = { ...d.prompt, ...(raw?.prompt || {}) };
  merged.plugins = { ...d.plugins, ...(raw?.plugins || {}) };
  if (!Array.isArray(merged.plugins.enabled)) merged.plugins.enabled = [];
  if (!Array.isArray(merged.quickReplies)) merged.quickReplies = [];
  if (!merged.personaName) merged.personaName = '旅人';
  merged.world = { ...d.world, ...(raw?.world || {}) };
  if (!Array.isArray(merged.world.globalIds)) merged.world.globalIds = [];
  merged.world.maxBooks = Math.min(8, Math.max(1, Number(merged.world.maxBooks) || 1));
  merged.group = { ...d.group, ...(raw?.group || {}) };
  if (!['natural_order', 'round_robin', 'director', 'mention'].includes(merged.group.mode)) merged.group.mode = 'natural_order';
  merged.group.defaultTalkativeness = Math.min(1, Math.max(0, Number(merged.group.defaultTalkativeness ?? 0.5)));
  return merged;
}

function redactExtraHeaders(raw) {
  if (!raw) return '';
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') return '';
    const out = {};
    const removed = [];
    for (const [k, v] of Object.entries(obj)) {
      if (/authorization|api[-_]?key|token|secret|cookie|bearer/i.test(k)) {
        out[k] = '';
        removed.push(k);
      } else {
        out[k] = v;
      }
    }
    return { json: JSON.stringify(out, null, 2), removed };
  } catch {
    return '';
  }
}

function sanitizeTokenizeMessages(messages) {
  for (const m of messages) {
    if (!m.tokenEstimate) m.tokenEstimate = estimateTokens(m.text || '');
  }
  return messages;
}

function greetingMessage(card) {
  const text = String(card?.first_mes || '').trim() || `（${card?.name || '角色'}走进了酒馆。）`;
  return {
    id: makeId('msg'),
    sender: 'char',
    text,
    swipes: [text],
    swipeIndex: 0,
    sendDate: nowIso(),
    tokenEstimate: estimateTokens(text),
    starred: false,
  };
}

function summarizeChat(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const last = messages[messages.length - 1];
  return {
    id: chat.id,
    cardId: chat.cardId,
    kind: chat.kind === 'group' ? 'group' : 'single',
    worldIds: Array.isArray(chat.worldIds) ? chat.worldIds : [],
    memberIds: Array.isArray(chat.memberIds) ? chat.memberIds : [],
    title: chat.title || '未命名会话',
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    starred: Boolean(chat.starred),
    branchOf: chat.branchOf || null,
    messageCount: messages.length,
    lastMessage: last ? { sender: last.sender, text: String(last.text || '').slice(0, 90) } : null,
    demo: Boolean(chat.demo),
  };
}

export class Repo {
  constructor() {
    this.db = null;
    this.settings = null;
    this.fresh = false;
  }

  async init() {
    this.db = await openDB();
    let stored = await dbGet(STORES.settings, 'app');
    if (!stored) {
      this.fresh = true;
      await this._seed();
      stored = await dbGet(STORES.settings, 'app');
    }
    this.settings = normalizeSettings(stored);
    // 修正演示会话可能缺失的 tokenEstimate
    const chats = await dbGetAll(STORES.chats);
    for (const chat of chats) sanitizeTokenizeMessages(chat.messages || []);
    await this.maybeDailySnapshot().catch(() => {});
    return { fresh: this.fresh, settings: this.settings };
  }

  async _seed() {
    const settings = defaultSettings();
    settings.seededAt = nowIso();
    const card = { ...DEMO_CARD, createdAt: nowIso(), updatedAt: nowIso() };
    card.contentHash = await hashCard(card);
    const world = { ...DEMO_WORLD, createdAt: nowIso(), updatedAt: nowIso() };
    world.contentHash = await hashWorld(world);
    const chat = demoChat();
    sanitizeTokenizeMessages(chat.messages);
    chat.createdAt = nowIso();
    chat.updatedAt = nowIso();
    await dbBulkPut(STORES.cards, [card]);
    await dbBulkPut(STORES.worlds, [world]);
    await dbBulkPut(STORES.personas, [{ ...DEMO_PERSONA, createdAt: nowIso() }]);
    await dbBulkPut(STORES.chats, [chat]);
    await dbPut(STORES.settings, settings);
  }

  // ---------- settings ----------
  async saveSettings(patch = {}) {
    const next = normalizeSettings(mergeDeep(this.settings || defaultSettings(), patch));
    next.updatedAt = nowIso();
    await dbPut(STORES.settings, next);
    this.settings = next;
    return next;
  }

  /** 供插件使用：密钥、敏感头全部脱敏；额外标记 hasApiKey。 */
  sanitizedSettings() {
    const s = clone(this.settings || {});
    const hasApiKey = Boolean(s.connection?.apiKey);
    if (s.connection) {
      delete s.connection.apiKey;
      s.connection.hasApiKey = hasApiKey;
      const red = redactExtraHeaders(s.connection.extraHeaders);
      s.connection.extraHeaders = red ? red.json : '';
    }
    return s;
  }

  // ---------- cards ----------
  async listCards() {
    const cards = await dbGetAll(STORES.cards);
    return cards.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }

  async getCard(id) {
    return dbGet(STORES.cards, id);
  }

  async saveCard(card, { saveBook = true, bookId = '' } = {}) {
    const out = clone(card);
    if (!out.id) out.id = makeId('card');
    out.name = String(out.name || '未命名角色').trim() || '未命名角色';
    out.tags = Array.isArray(out.tags) ? out.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    if (out.character_book && !out.character_book.entries) out.character_book = normalizeCharacterBook(out.character_book);
    out.createdAt = out.createdAt || nowIso();
    out.updatedAt = nowIso();
    out.contentHash = await hashCard(out);
    await dbPut(STORES.cards, out);
    // 内嵌书 -> 嵌入态的馆藏世界书（随卡激活，卡删书删）
    if (saveBook && out.character_book) {
      const existing = out.character_book_id ? await this.getWorld(out.character_book_id) : null;
      const book = await this.saveWorld({
        ...(existing || {}),
        id: out.character_book_id || bookId || existing?.id || '',
        name: out.character_book.name || `${out.name}·内嵌书`,
        description: out.character_book.description || '',
        entries: out.character_book.entries || [],
        scanDepth: out.character_book.scanDepth || 0,
        tokenBudget: out.character_book.tokenBudget || 0,
        recursive: Boolean(out.character_book.recursive),
        scope: 'embedded',
        embeddedFor: [out.id],
        enabled: true,
      });
      out.character_book_id = book.id;
      await dbPut(STORES.cards, out);
    } else if (out.character_book_id) {
      // 内嵌书被清空：解除卡片里的书，书本身降级为普通馆藏（不静默删除用户内容）
      const old = await this.getWorld(out.character_book_id);
      if (old) {
        await this.saveWorld({
          ...old,
          scope: 'library',
          embeddedFor: (old.embeddedFor || []).filter((id) => id !== out.id),
        });
      }
      out.character_book_id = '';
      await dbPut(STORES.cards, out);
    }
    return out;
  }

  async deleteCard(id) {
    const chats = await dbGetAllByIndex(STORES.chats, 'cardId', id);
    for (const chat of chats) await dbDelete(STORES.chats, chat.id);
    const card = await dbGet(STORES.cards, id);
    // 只删“专属于这张卡”的内嵌书；共享的书保留并解除关联
    if (card?.character_book_id) {
      const book = await this.getWorld(card.character_book_id);
      if (book) {
        const others = (book.embeddedFor || []).filter((cid) => cid !== id);
        if (!others.length) await dbDelete(STORES.worlds, book.id);
        else await this.saveWorld({ ...book, embeddedFor: others });
      }
    }
    await dbDelete(STORES.cards, id);
    return { chats: chats.length };
  }

  /** 把卡里的内嵌书取成完整对象（组装提示词用）。 */
  async getCardBook(cardId) {
    const card = await this.getCard(cardId);
    if (!card) return null;
    if (card.character_book_id) {
      const book = await this.getWorld(card.character_book_id);
      if (book) return book;
    }
    if (card.character_book) {
      return { ...normalizeCharacterBook(card.character_book), id: `card-book:${card.id}`, scope: 'embedded', embeddedFor: [card.id] };
    }
    return null;
  }

  /** 卡编辑器：写入/更新内嵌书。entries 传数组，传 null 表示清空。 */
  async setCardBook(cardId, name, entries) {
    const card = await this.getCard(cardId);
    if (!card) throw new Error('角色卡不存在');
    if (!entries) {
      const next = { ...card, character_book: null, character_book_id: '' };
      return this.saveCard(next, { saveBook: false });
    }
    const book = { name: name || `${card.name}·内嵌书`, entries };
    return this.saveCard({ ...card, character_book: normalizeCharacterBook(book) }, { saveBook: true });
  }

  /** 导出用：把卡的内嵌书补成 result.character_book。 */
  async cardWithBook(cardId) {
    const card = await this.getCard(cardId);
    if (!card) return null;
    const book = await this.getCardBook(cardId);
    return {
      ...card,
      character_book: book
        ? { name: book.name, description: book.description, entries: book.entries, scanDepth: book.scanDepth, tokenBudget: book.tokenBudget, recursive: book.recursive }
        : null,
    };
  }

  // ---------- worlds ----------
  async listWorlds() {
    const worlds = await dbGetAll(STORES.worlds);
    return worlds.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  async getWorld(id) {
    return dbGet(STORES.worlds, id);
  }

  async saveWorld(world) {
    const out = clone(world);
    if (!out.id) out.id = makeId('world');
    out.name = String(out.name || '未命名世界书').trim() || '未命名世界书';
    out.enabled = out.enabled !== false;
    // 挂载属性：global 全局常驻（默认关）、embeddedFor 嵌在卡里（随卡激活）
    out.scope = out.scope === 'embedded' ? 'embedded' : 'library';
    out.embeddedFor = out.scope === 'embedded' ? (Array.isArray(out.embeddedFor) ? out.embeddedFor : []) : [];
    out.linkedCards = Array.isArray(out.linkedCards) ? out.linkedCards.filter(Boolean) : [];
    out.entries = Array.isArray(out.entries) ? out.entries : [];
    out.entries = out.entries.map((e, i) => ({
      uid: e.uid ?? i + 1,
      key: Array.isArray(e.key) ? e.key : [],
      keysecondary: Array.isArray(e.keysecondary) ? e.keysecondary : [],
      comment: String(e.comment || ''),
      content: String(e.content || ''),
      position: e.position === 'after' ? 'after' : 'before',
      order: Number(e.order) || 0,
      tokenBudget: Number(e.tokenBudget) || 0,
      recursive: Boolean(e.recursive),
      selective: Boolean(e.selective),
      constant: Boolean(e.constant),
      probability: Math.min(100, Math.max(0, Number(e.probability ?? 100))),
      caseSensitive: Boolean(e.caseSensitive),
      useRegex: Boolean(e.useRegex),
      enabled: e.enabled !== false,
    }));
    out.createdAt = out.createdAt || nowIso();
    out.updatedAt = nowIso();
    out.contentHash = await hashWorld(out);
    await dbPut(STORES.worlds, out);
    return out;
  }

  async createWorld(name = '新的世界书') {
    // 新建默认是“馆藏书”：不嵌卡，等用户在世界书页里“嵌进某张卡”才随卡激活
    return this.saveWorld({ id: makeId('world'), name, enabled: true, entries: [], scope: 'library', embeddedFor: [] });
  }

  async deleteWorld(id) {
    await dbDelete(STORES.worlds, id);
  }

  // ---------- chats ----------
  async listChats() {
    const chats = await dbGetAll(STORES.chats);
    return chats
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .map(summarizeChat);
  }

  async getChat(id) {
    const chat = await dbGet(STORES.chats, id);
    if (chat) sanitizeTokenizeMessages(chat.messages || []);
    return chat || null;
  }

  async createChat(card, { title, messages, demo = false, worldIds = null, memberIds = null, kind = 'single', mode = '', memberState = null, allowSelfResponses = false, advancedWorlds = false } = {}) {
    const chat = {
      id: makeId('chat'),
      cardId: card?.id || (memberIds || [])[0] || '',
      kind,
      // 挂载：chat 级世界书（优先级最高）。单聊默认 0 本 = 只用卡内嵌书，符合“一个世界一本书”
      worldIds: Array.isArray(worldIds) ? worldIds.filter(Boolean) : [],
      memberIds: Array.isArray(memberIds) ? memberIds.filter(Boolean) : card?.id ? [card.id] : [],
      speaker: card?.id || (memberIds || [])[0] || '',
      mode: mode || '',
      memberState: memberState && typeof memberState === 'object' ? memberState : {},
      allowSelfResponses: Boolean(allowSelfResponses),
      advancedWorlds: Boolean(advancedWorlds),
      title: title || `与${card?.name || '角色'}的对话`,
      messages: messages || (card ? [greetingMessage(card)] : []),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      branchOf: null,
      starred: false,
      demo,
    };
    sanitizeTokenizeMessages(chat.messages);
    await dbPut(STORES.chats, chat);
    return chat;
  }

  async saveChat(chat) {
    const out = clone(chat);
    out.updatedAt = nowIso();
    out.messages = Array.isArray(out.messages) ? out.messages : [];
    await dbPut(STORES.chats, out);
    return out;
  }

  async deleteChat(id) {
    await dbDelete(STORES.chats, id);
  }

  async forkChat(sourceChat, card, messageIndex, title) {
    const msgs = (sourceChat.messages || []).slice(0, messageIndex + 1).map((m) => ({
      ...clone(m),
      id: makeId('msg'),
      swipes: Array.isArray(m.swipes) ? [...m.swipes] : [m.text],
      sendDate: m.sendDate || nowIso(),
    }));
    const chat = {
      id: makeId('chat'),
      cardId: card?.id || sourceChat.cardId,
      kind: sourceChat.kind || 'single',
      worldIds: Array.isArray(sourceChat.worldIds) ? [...sourceChat.worldIds] : [],
      memberIds: Array.isArray(sourceChat.memberIds) ? [...sourceChat.memberIds] : card?.id ? [card.id] : [],
      memberState: sourceChat.memberState ? { ...sourceChat.memberState } : {},
      allowSelfResponses: Boolean(sourceChat.allowSelfResponses),
      advancedWorlds: Boolean(sourceChat.advancedWorlds),
      speaker: sourceChat.speaker || card?.id || '',
      mode: sourceChat.mode || '',
      title: title || `分支 · ${sourceChat.title || '会话'}`,
      messages: msgs,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      branchOf: { chatId: sourceChat.id, messageId: sourceChat.messages?.[messageIndex]?.id, at: nowIso() },
      starred: false,
    };
    sanitizeTokenizeMessages(chat.messages);
    await dbPut(STORES.chats, chat);
    return chat;
  }

  // ---------- personas ----------
  async listPersonas() {
    return dbGetAll(STORES.personas);
  }

  async savePersona(persona) {
    const out = { ...clone(persona) };
    if (!out.id) out.id = makeId('persona');
    out.name = String(out.name || '旅人').trim() || '旅人';
    out.createdAt = out.createdAt || nowIso();
    await dbPut(STORES.personas, out);
    return out;
  }

  // ---------- extdata ----------
  async extGet(pluginId, key) {
    const rec = await dbGet(STORES.extdata, `${pluginId}:${key}`);
    return rec ? clone(rec.value) : undefined;
  }

  async extSet(pluginId, key, value) {
    await dbPut(STORES.extdata, {
      id: `${pluginId}:${key}`,
      pluginId,
      key,
      value: clone(value),
      updatedAt: nowIso(),
    });
  }

  async extDelete(pluginId, key) {
    await dbDelete(STORES.extdata, `${pluginId}:${key}`);
  }

  async extKeys(pluginId) {
    const rows = await dbGetAllByIndex(STORES.extdata, 'pluginId', pluginId);
    return rows.map((r) => r.key);
  }

  // ---------- snapshots ----------
  async maybeDailySnapshot() {
    const today = todayLocal();
    const rec = (await this.extGet('__app', 'snapshots')) || { snapshots: [] };
    const list = Array.isArray(rec.snapshots) ? rec.snapshots : [];
    if (list[0]?.date === today) return null;
    const snapshot = await this._makeSnapshotData(today);
    const next = [snapshot, ...list.filter((s) => s.date !== today)].slice(0, 7);
    await this.extSet('__app', 'snapshots', { snapshots: next });
    return snapshot;
  }

  async createSnapshot() {
    const snapshot = await this._makeSnapshotData(todayLocal());
    const rec = (await this.extGet('__app', 'snapshots')) || { snapshots: [] };
    const list = Array.isArray(rec.snapshots) ? rec.snapshots : [];
    const next = [snapshot, ...list.filter((s) => s.date !== snapshot.date)].slice(0, 7);
    await this.extSet('__app', 'snapshots', { snapshots: next });
    return snapshot;
  }

  async _makeSnapshotData(date) {
    const cards = await this.listCards();
    const worlds = await this.listWorlds();
    const chats = await dbGetAll(STORES.chats);
    const settings = this.sanitizedSettings();
    return {
      date,
      createdAt: nowIso(),
      counts: { cards: cards.length, chats: chats.length, worlds: worlds.length },
      data: { cards, chats, worlds, settings },
    };
  }

  async listSnapshots() {
    const rec = (await this.extGet('__app', 'snapshots')) || { snapshots: [] };
    return (rec.snapshots || []).map((s) => ({ date: s.date, createdAt: s.createdAt, counts: s.counts }));
  }

  async restoreSnapshot(date) {
    const rec = (await this.extGet('__app', 'snapshots')) || { snapshots: [] };
    const snap = (rec.snapshots || []).find((s) => s.date === date);
    if (!snap) throw new Error('找不到这个快照');
    await this._restoreData(snap.data, 'replace');
    return snap.counts;
  }

  // ---------- backup ----------
  async exportAll({ includeKeys = false } = {}) {
    const cards = await this.listCards();
    const worlds = await this.listWorlds();
    const chats = await dbGetAll(STORES.chats);
    const personas = await this.listPersonas();
    const settings = clone(this.settings);
    let redactedHeaders = [];
    if (!includeKeys) {
      if (settings.connection) {
        settings.connection.apiKey = '';
        const red = redactExtraHeaders(settings.connection.extraHeaders);
        if (red && typeof red === 'object') {
          settings.connection.extraHeaders = red.json;
          redactedHeaders = red.removed;
        } else {
          settings.connection.extraHeaders = '';
        }
      }
      delete settings.seededAt;
    }
    return {
      app: APP_NAME,
      version: APP_VERSION,
      exportVersion: 1,
      exportedAt: nowIso(),
      includesKeys: Boolean(includeKeys),
      redactedHeaders,
      data: { cards, chats, worlds, personas, settings },
    };
  }

  async importAll(payload, { mode = 'replace' } = {}) {
    const data = payload?.data && payload.app ? payload.data : payload;
    if (!data || typeof data !== 'object') throw new Error('备份文件格式不正确');
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const chats = Array.isArray(data.chats) ? data.chats : [];
    const worlds = Array.isArray(data.worlds) ? data.worlds : [];
    const personas = Array.isArray(data.personas) ? data.personas : [];
    if (!cards.length && !chats.length && !worlds.length && !data.settings) {
      throw new Error('备份里没有任何可导入的数据');
    }
    if (mode === 'replace') {
      await dbClear(STORES.cards);
      await dbClear(STORES.chats);
      await dbClear(STORES.worlds);
      await dbClear(STORES.personas);
    }
    await dbBulkPut(STORES.cards, cards);
    await dbBulkPut(STORES.worlds, worlds);
    await dbBulkPut(STORES.personas, personas);
    const cleanChats = chats.map((c) => ({ ...c, messages: sanitizeTokenizeMessages(Array.isArray(c.messages) ? c.messages : []) }));
    await dbBulkPut(STORES.chats, cleanChats);
    if (data.settings) {
      const incoming = normalizeSettings(data.settings);
      if (!payload?.includesKeys) {
        incoming.connection.apiKey = this.settings?.connection?.apiKey || '';
        if (!incoming.connection.extraHeaders) {
          incoming.connection.extraHeaders = this.settings?.connection?.extraHeaders || '';
        }
      }
      incoming.key = 'app';
      await dbPut(STORES.settings, incoming);
      this.settings = incoming;
    }
    return { cards: cards.length, chats: chats.length, worlds: worlds.length, personas: personas.length, mode };
  }

  async _restoreData(data, mode = 'replace') {
    if (mode === 'replace') {
      await dbClear(STORES.cards);
      await dbClear(STORES.chats);
      await dbClear(STORES.worlds);
      await dbClear(STORES.personas);
    }
    await dbBulkPut(STORES.cards, data.cards || []);
    await dbBulkPut(STORES.worlds, data.worlds || []);
    await dbBulkPut(STORES.chats, data.chats || []);
    await dbBulkPut(STORES.personas, data.personas || []);
    if (data.settings) {
      const incoming = normalizeSettings(data.settings);
      incoming.connection.apiKey = this.settings?.connection?.apiKey || '';
      if (!incoming.connection.extraHeaders) {
        incoming.connection.extraHeaders = this.settings?.connection?.extraHeaders || '';
      }
      await dbPut(STORES.settings, incoming);
      this.settings = incoming;
    }
  }

  // ---------- trials（试穿沙盒：独立 store，正式表零写入） ----------
  async saveTrial(trial) {
    const out = clone(trial || {});
    if (!out.id) out.id = makeId('trial');
    out.updatedAt = nowIso();
    out.createdAt = out.createdAt || out.updatedAt;
    await dbPut(STORES.trials, out);
    return out;
  }

  async getTrial(id) {
    return dbGet(STORES.trials, id);
  }

  async listTrials() {
    return dbGetAll(STORES.trials);
  }

  async deleteTrial(id) {
    await dbDelete(STORES.trials, id);
  }

  async findCardsByHash(hash) {
    if (!hash) return [];
    const all = await dbGetAll(STORES.cards);
    return all.filter((c) => c.contentHash === hash);
  }

  async findWorldsByHash(hash) {
    if (!hash) return [];
    const all = await dbGetAll(STORES.worlds);
    return all.filter((w) => w.contentHash === hash);
  }

  async findWorldsByName(name) {
    const wanted = String(name || '').trim();
    if (!wanted) return [];
    const all = await dbGetAll(STORES.worlds);
    return all.filter((w) => String(w.name || '').trim() === wanted);
  }

  /** 世界书查重：同 hash 或同名。返回可直接给“查重合并”工具用的清单。 */
  async duplicateWorlds() {
    const all = await dbGetAll(STORES.worlds);
    const byHash = new Map();
    const byName = new Map();
    for (const w of all) {
      const h = w.contentHash || (await hashWorld(w));
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(w);
      const n = String(w.name || '').trim();
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(w);
    }
    const groups = [];
    const seen = new Set();
    const withRefs = async (list) =>
      Promise.all(
        list.map(async (w) => ({ ...w, boundChats: await this.countWorldRefs(w.id) }))
      );
    for (const [hash, list] of byHash) {
      if (list.length < 2) continue;
      const key = `hash:${hash}`;
      seen.add(key);
      groups.push({
        kind: list.every((w) => String(w.name || '').trim() === String(list[0].name || '').trim()) ? 'same-name' : 'same-content',
        hash,
        name: list[0].name,
        records: await withRefs(list),
      });
    }
    for (const [name, list] of byName) {
      if (list.length < 2) continue;
      const hashes = new Set(list.map((w) => w.contentHash));
      const key = `name:${name}`;
      if (seen.has(key) || hashes.size < 2) continue;
      groups.push({
        kind: 'same-name',
        hash: '',
        name,
        records: await withRefs(list),
      });
    }
    return groups;
  }

  async countWorldRefs(worldId) {
    const chats = await dbGetAll(STORES.chats);
    return chats.filter((c) => (c.worldIds || []).includes(worldId)).length;
  }

  /** 合并重复世界书：keepId 保留；mergeIds 被删，其会话/卡绑定改绑到 keepId。 */
  async mergeWorlds(keepId, mergeIds = []) {
    const keep = await this.getWorld(keepId);
    if (!keep) throw new Error('要保留的世界书不存在');
    const ids = mergeIds.filter((id) => id && id !== keepId);
    if (!ids.length) return { merged: 0, rebound: 0, removed: 0 };
    const chats = await dbGetAll(STORES.chats);
    let rebound = 0;
    for (const chat of chats) {
      const w = Array.isArray(chat.worldIds) ? chat.worldIds : [];
      if (!w.some((id) => ids.includes(id))) continue;
      const next = w.map((id) => (ids.includes(id) ? keepId : id));
      chat.worldIds = [...new Set(next)];
      chat.updatedAt = nowIso();
      await dbPut(STORES.chats, chat);
      rebound += 1;
    }
    const cards = await dbGetAll(STORES.cards);
    for (const card of cards) {
      if (!ids.includes(card.character_book_id)) continue;
      card.character_book_id = keepId;
      card.character_book = toCharacterBook({ name: keep.name, entries: keep.entries || [] });
      card.updatedAt = nowIso();
      await dbPut(STORES.cards, card);
    }
    for (const id of ids) await dbDelete(STORES.worlds, id);
    return { merged: ids.length, rebound, removed: ids.length };
  }

  async resetAll() {
    await dbClear(STORES.cards);
    await dbClear(STORES.chats);
    await dbClear(STORES.worlds);
    await dbClear(STORES.personas);
    await dbClear(STORES.extdata);
    await dbClear(STORES.settings);
    await dbClear(STORES.trials);
    await this._seed();
    this.settings = normalizeSettings(await dbGet(STORES.settings, 'app'));
    this.fresh = true;
    return this.settings;
  }

  async stats() {
    const [cards, chats, worlds] = await Promise.all([
      this.listCards(),
      this.listChats(),
      this.listWorlds(),
    ]);
    return {
      cards: cards.length,
      chats: chats.length,
      worlds: worlds.length,
      messages: chats.reduce((n, c) => n + (c.messageCount || 0), 0),
    };
  }
}
