// prompt-builder — 组装系统提示、世界书、角色卡与聊天记录，并返回可审计的 trace。
// 预算以「上下文窗口 − 回复预留」为基数（百分比与原规格一致），超限优先丢弃最旧聊天记录。

import { estimateTokens, truncateToTokens } from './tokenizer-lite.js';
import { SAMPLER_DEFAULTS } from './sampler.js';
import { findKeyConflicts } from './mount-resolver.js';

export const PROMPT_BUDGET = Object.freeze({
  system: 0.1,
  worldConst: 0.05,
  card: 0.35,
  worldTrig: 0.25,
  chat: 0.2,
});

const DEFAULT_SYSTEM = `你正在「袖珍酒馆」中扮演「{{char}}」。请始终以{{char}}的身份、口吻和记忆回应。动作行用（）包裹，动词开头，不写主语"我"；对白用「」。不要替{{user}}决定行动或台词，不要替其他角色说话，不要跳出角色解释自己是 AI。描写克制、具体，每次回复通常 2–3 段。`;

const now = () => new Date();

function pad(n) {
  return String(n).padStart(2, '0');
}

export function applyMacros(input, ctx = {}) {
  const card = ctx.card || {};
  const userName = ctx.userName || '旅人';
  const charName = card.name || ctx.charName || '酒馆老板娘';
  const date = now();
  const map = {
    char: charName,
    user: userName,
    persona: userName,
    description: card.description || '',
    personality: card.personality || '',
    scenario: card.scenario || '',
    first_mes: card.first_mes || '',
    mes_example: card.mes_example || '',
    creator: card.creator || '',
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    weekday: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()],
    isotime: date.toISOString(),
  };
  let out = String(input ?? '');
  // 两次替换，允许卡片字段里再用宏
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (m, key) => (key in map ? String(map[key]) : m));
    out = out.replace(/\{\{\s*random\s*:\s*([^}]+)\}\}/gi, (m, list) => {
      const items = String(list)
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return items.length ? items[Math.floor(Math.random() * items.length)] : '';
    });
    out = out.replace(/\{\{\s*roll\s*:\s*(\d*)d(\d+)\s*\}\}/gi, (m, count, sides) => {
      const n = Math.min(20, Math.max(1, Number(count || 1)));
      const s = Math.min(1000, Math.max(2, Number(sides)));
      let total = 0;
      for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * s);
      return String(total);
    });
  }
  return out;
}

function entryKey(entry, i) {
  return entry.uid !== undefined && entry.uid !== null ? String(entry.uid) : `e${i}`;
}

/** 把世界对象展开成条目数组 */
export function collectEntries(worlds = []) {
  const out = [];
  for (const world of worlds || []) {
    if (!world || world.enabled === false) continue;
    const entries = Array.isArray(world.entries) ? world.entries : [];
    entries.forEach((entry, i) => {
      if (!entry) return;
      const uid = entryKey(entry, i);
      out.push({
        ...entry,
        uid,
        _matchKey: `${world.id || world.name || 'world'}:${uid}`,
        _worldId: world.id,
        _worldName: world.name || '未命名世界书',
        _idx: i,
      });
    });
  }
  return out;
}

function matchesKey(key, text, entry) {
  if (!key) return false;
  if (entry.useRegex) {
    try {
      const re = new RegExp(key, entry.caseSensitive ? '' : 'i');
      return re.test(text);
    } catch {
      return text.includes(key);
    }
  }
  return entry.caseSensitive ? text.includes(key) : text.toLowerCase().includes(key.toLowerCase());
}

function entryMatched(entry, texts) {
  const keys = (entry.key || []).map((k) => String(k || '').trim()).filter(Boolean);
  if (!keys.length) return { hit: false, via: '' };
  const primary = keys.some((k) => texts.some((t) => matchesKey(k, t, entry)));
  if (!primary) return { hit: false, via: '' };
  if (entry.selective) {
    const second = (entry.keysecondary || []).map((k) => String(k || '').trim()).filter(Boolean);
    if (second.length && !second.some((k) => texts.some((t) => matchesKey(k, t, entry)))) {
      return { hit: false, via: '需要次要关键词' };
    }
  }
  const key = keys.find((k) => texts.some((t) => matchesKey(k, t, entry))) || keys[0];
  return { hit: true, via: key };
}

/**
 * 扫描世界书：最多 2 层；命中即注入；同一 uid 只命中一次。
 * @returns {{matched:any[], layers:number, log:any[]}}
 */
export function scanWorldbook(entries, texts, { rng = Math.random } = {}) {
  const all = (entries || []).filter((e) => e && !e.constant);
  const matchedKeys = new Set();
  const matchedEntries = new Map();
  const log = [];
  let layerTexts = texts.map((t) => String(t || '')).filter(Boolean);
  let layers = 0;

  for (let depth = 1; depth <= 2; depth++) {
    if (!layerTexts.length) break;
    const newMatches = [];
    for (const entry of all) {
      if (matchedKeys.has(entry._matchKey)) continue;
      const { hit, via } = entryMatched(entry, layerTexts);
      if (!hit) continue;
      const probability = entry.probability === undefined || entry.probability === null ? 100 : Number(entry.probability);
      if (Number.isFinite(probability) && probability < 100) {
        const roll = rng() * 100;
        if (roll >= probability) {
          log.push({ uid: entry.uid, depth, hit: false, key: via, reason: `概率 ${probability}% 未通过（roll ${roll.toFixed(1)}）` });
          continue;
        }
      }
      matchedKeys.add(entry._matchKey);
      const match = { ...entry, _depth: depth, _via: via };
      matchedEntries.set(entry._matchKey, match);
      newMatches.push(match);
      log.push({ uid: entry.uid, depth, hit: true, key: via, reason: `命中「${via}」` });
    }
    if (!newMatches.length) break;
    layers = depth;
    const recursiveText = newMatches
      .filter((e) => e.recursive === true)
      .map((e) => applyMacros(e.content || '', {}))
      .filter(Boolean)
      .join('\n');
    if (!recursiveText) break;
    layerTexts = [recursiveText];
  }
  return { matched: [...matchedEntries.values()], layers, log };
}

function clip(text, budget, label) {
  const r = truncateToTokens(text, budget);
  return { text: r.text, tokens: r.tokens, truncated: r.truncated, label };
}

function sectionHeader(label) {
  return `【${label}】`;
}

/**
 * 组装 prompt。
 * @returns {{messages:{role:string,content:string}[], trace:any, userInput:string}}
 */
export function buildPrompt({
  card,
  /** 群聊时为全体成员卡；单聊时就是 [card] */
  cast = [],
  /** 群聊本轮发言者角色卡（优先于 card 用于身份与角色卡段） */
  speakerCard = null,
  messages = [],
  worlds = [],
  settings = {},
  userInput = '',
  extraSystem = '',
  sampler = {},
  charName,
  userName,
} = {}) {
  const activeCard = speakerCard || card;
  const s = { ...SAMPLER_DEFAULTS, ...sampler };
  const contextWindow = Math.max(1024, Number(s.context_window) || 8192);
  const reserveOutput = Math.min(Math.max(64, Number(s.max_tokens) || 2048), Math.floor(contextWindow * 0.5));
  const available = Math.max(512, contextWindow - reserveOutput);
  const budget = {
    system: Math.max(64, Math.floor(available * PROMPT_BUDGET.system)),
    worldConst: Math.max(32, Math.floor(available * PROMPT_BUDGET.worldConst)),
    card: Math.max(128, Math.floor(available * PROMPT_BUDGET.card)),
    worldTrig: Math.max(64, Math.floor(available * PROMPT_BUDGET.worldTrig)),
    chat: Math.max(64, Math.floor(available * PROMPT_BUDGET.chat)),
    available,
  };
  const user = userName || settings?.personaName || '旅人';
  const char = charName || activeCard?.name || card?.name || '琥珀';
  const macCtx = { card: activeCard, charName: char, userName: user };
  const safeCard = activeCard || {};

  const trace = {
    contextWindow,
    reserveOutput,
    available,
    budget,
    sections: [],
    messages: [],
    worldMatches: [],
    worldLog: [],
    dropped: [],
    userInputTokens: 0,
    totalTokens: 0,
    overBudget: false,
    mounts: [],
    keyConflicts: [],
    speaker: '',
    generatedAt: new Date().toISOString(),
    eos: '',
  };

  // 群聊：以“当前发言者”的身份说话（R3：删掉“或只做简短反应”，那等于邀请模型代写别人）
  const speaker = settings?.__speaker || '';
  trace.speaker = speaker;
  if (speaker) {
    trace.sections.push({
      id: 'speaker',
      label: '发言者',
      text: `本轮发言者：${speaker}。只以 ${speaker} 的身份回应；其他角色这一轮不说话，由系统另行安排。`,
      tokens: 0,
      budget: 0,
    });
    trace.sections[trace.sections.length - 1].tokens = estimateTokens(trace.sections[trace.sections.length - 1].text);
  }

  // 1) 系统提示（R5：分成“身份锁 + 可裁剪部分”，身份锁永不裁剪）
  const custom = settings?.prompt?.system ? applyMacros(settings.prompt.system, macCtx) : '';
  const cardSystem = safeCard.system_prompt ? applyMacros(safeCard.system_prompt, macCtx) : '';
  const safety = settings?.nsfw
    ? '内容分级：成人向（18+）。可以描写亲密与张力，仍需尊重角色与用户边界。'
    : '内容分级：全年龄向（PG-13）。避免露骨或极端描写。';
  const extra = extraSystem ? `【临时系统提示】\n${applyMacros(extraSystem, macCtx)}` : '';
  const pinned = settings?.__pinned ? applyMacros(String(settings.__pinned), macCtx) : '';
  const lock = [applyMacros(DEFAULT_SYSTEM, macCtx), pinned].filter(Boolean).join('\n\n');
  const rest = [cardSystem, custom, safety, extra].filter(Boolean).join('\n\n');
  const lockTokens = estimateTokens(lock);
  const restCap = Math.max(64, budget.system - lockTokens);
  const restSec = clip(rest, restCap, '系统提示');
  const systemSec = {
    text: [lock, restSec.text].filter(Boolean).join('\n\n'),
    tokens: lockTokens + restSec.tokens,
    truncated: restSec.truncated,
    pinned: true,
  };
  trace.sections.push({ id: 'system', label: '系统提示', ...systemSec, budget: budget.system });
  trace.sections[trace.sections.length - 1].tokens = estimateTokens(systemSec.text);

  // 2) 世界书常量
  const allEntries = collectEntries(worlds);
  // 挂载信息（resolveMounts 的结果，组装预览会展示）
  const mounts = Array.isArray(settings?.__mounts) ? settings.__mounts : [];
  const mountById = new Map(mounts.filter((m) => m.included).map((m) => [m.id, m]));
  const keyConflicts = findKeyConflicts(worlds);
  trace.mounts = mounts;
  trace.keyConflicts = keyConflicts;
  trace.conflictKeys = keyConflicts.flatMap((c) => (c.entries || []).map((e) => `${e.worldId}:${e.uid}`));
  const mountOf = (e) => mountById.get(e._worldId) || null;
  const constants = allEntries
    .filter((e) => e.constant)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const constParts = [];
  let constUsed = 0;
  for (const e of constants) {
    const remaining = budget.worldConst - constUsed;
    if (remaining <= 8) break;
    const cap = e.tokenBudget > 0 ? Math.min(e.tokenBudget, remaining) : remaining;
    const macroed = applyMacros(e.content || '', macCtx);
    const c = clip(`${sectionHeader(e.comment || e.key?.join(',') || '世界书')}\n${macroed}`, cap, '常量');
    if (!c.text) continue;
    constParts.push(c.text);
    constUsed += c.tokens;
    trace.worldMatches.push({
      uid: e.uid,
      world: e._worldName,
      worldId: e._worldId,
      mount: mountOf(e)?.level || '',
      mountLabel: mountOf(e)?.levelLabel || '',
      comment: e.comment || '',
      keys: e.key || [],
      position: e.position || 'before',
      constant: true,
      depth: 0,
      tokens: c.tokens,
      included: true,
      reason: '常量条目',
      content: macroed,
    });
  }
  const constText = constParts.join('\n\n');
  const constSec = clip(constText, budget.worldConst, '世界书常量');
  trace.sections.push({ id: 'worldConst', label: '世界书常量', ...constSec, budget: budget.worldConst, count: constParts.length });

  // 3) 角色卡（群聊时先给在座名单，再给本轮发言者的卡）
  const cardParts = [];
  const others = (cast || []).filter((c) => c && c.id !== safeCard.id);
  if (others.length) {
    cardParts.push(`在座角色：${[safeCard, ...others].map((c) => c.name).filter(Boolean).join('、')}`);
    cardParts.push(`本轮由「${safeCard.name || char}」发言，其余角色不要抢话。`);
  }
  if (safeCard.name) cardParts.push(`名称：${safeCard.name}`);
  if (safeCard.description) cardParts.push(`描述：${applyMacros(safeCard.description, macCtx)}`);
  if (safeCard.personality) cardParts.push(`性格：${applyMacros(safeCard.personality, macCtx)}`);
  if (safeCard.scenario) cardParts.push(`场景：${applyMacros(safeCard.scenario, macCtx)}`);
  if (safeCard.mes_example) cardParts.push(`示例对话：\n${applyMacros(safeCard.mes_example, macCtx)}`);
  const cardSec = clip(`${sectionHeader('角色卡')}\n${cardParts.join('\n')}`, budget.card, '角色卡');
  const cardSection = { id: 'card', label: '角色卡', ...cardSec, budget: budget.card };
  trace.sections.push(cardSection);

  // 4) 世界书触发（before / after 共用 25% 预算）
  const chatTexts = messages
    .filter((m) => m && (m.sender === 'user' || m.sender === 'char'))
    .slice(-2)
    .map((m) => String(m.text || ''));
  const scanSeeds = [userInput, ...chatTexts].filter(Boolean);
  const scan = scanWorldbook(allEntries, scanSeeds);
  trace.worldLog = scan.log;
  trace.layers = scan.layers;
  const triggered = [...scan.matched].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const beforeParts = [];
  const afterParts = [];
  let trigUsed = 0;
  let triggerBudgetExhausted = false;
  for (const e of triggered) {
    const remaining = budget.worldTrig - trigUsed;
    if (remaining <= 8) {
      triggerBudgetExhausted = true;
      trace.worldMatches.push({
        uid: e.uid,
        world: e._worldName,
        worldId: e._worldId,
        mount: mountOf(e)?.level || '',
        mountLabel: mountOf(e)?.levelLabel || '',
        comment: e.comment || '',
        keys: e.key || [],
        position: e.position || 'before',
        constant: false,
        depth: e._depth,
        tokens: 0,
        included: false,
        reason: '触发条目预算已用尽',
        content: e.content || '',
      });
      continue;
    }
    const cap = e.tokenBudget > 0 ? Math.min(e.tokenBudget, remaining) : remaining;
    const macroed = applyMacros(e.content || '', macCtx);
    const c = clip(`${sectionHeader(e.comment || e.key?.join(',') || '世界书触发')}\n${macroed}`, cap, '触发');
    if (!c.text) continue;
    trigUsed += c.tokens + 2;
    (e.position === 'after' ? afterParts : beforeParts).push(c.text);
    if (c.truncated) triggerBudgetExhausted = true;
    trace.worldMatches.push({
      uid: e.uid,
      world: e._worldName,
      worldId: e._worldId,
      mount: mountOf(e)?.level || '',
      mountLabel: mountOf(e)?.levelLabel || '',
      comment: e.comment || '',
      keys: e.key || [],
      position: e.position || 'before',
      constant: false,
      depth: e._depth,
      tokens: c.tokens,
      included: true,
      reason: `第 ${e._depth} 层命中「${e._via}」`,
      content: macroed,
      conflict: keyConflicts.some((cf) => cf.entries?.some((x) => x.worldId === e._worldId && String(x.uid) === String(e.uid))),
    });
  }
  const beforeText = beforeParts.join('\n\n');
  const afterText = afterParts.join('\n\n');
  const beforeSec = { text: beforeText, tokens: estimateTokens(beforeText), truncated: triggerBudgetExhausted, label: '触发 before' };
  const afterSec = { text: afterText, tokens: estimateTokens(afterText), truncated: false, label: '触发 after' };
  const beforeSection = {
    id: 'worldTrig',
    label: '世界书触发（before）',
    ...beforeSec,
    budget: budget.worldTrig,
    count: beforeParts.length,
  };
  const afterSection = {
    id: 'worldTrigAfter',
    label: '世界书触发（after）',
    ...afterSec,
    budget: 0,
    count: afterParts.length,
  };
  trace.sections.push(beforeSection, afterSection);

  // 5) 聊天记录（从最新往前取，预算 20%；R8/R11：别人的发言带【角色名】标签）
  const labelOf = (m) => {
    if (m.sender === 'user') return '用户';
    const name = m.speaker || (m.cardId === safeCard?.id ? char : '') || '';
    // 自己的发言不带标签（agent 视角里 assistant 就是自己），别人的带【名】
    if (name && name !== char) return `【${name}】`;
    return '角色';
  };
  const history = messages
    .filter((m) => m && m.sender !== 'system' && !m.ephemeral && !m.localOnly)
    .map((m) => ({
      id: m.id,
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: String(m.text || ''),
      label: labelOf(m),
      tokens: estimateTokens(String(m.text || '')),
    }))
    .filter((m) => m.content);
  const kept = [];
  let chatTokens = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (chatTokens + item.tokens <= budget.chat) {
      kept.unshift(item);
      chatTokens += item.tokens;
    } else {
      trace.dropped.unshift({ id: item.id, role: item.role, preview: item.content.slice(0, 60), tokens: item.tokens, reason: '聊天预算' });
    }
  }
  const chatSection = {
    id: 'chat',
    label: '聊天记录',
    text: kept.map((m) => `${m.label}：${m.content}`).join('\n\n'),
    tokens: chatTokens,
    budget: budget.chat,
    truncated: trace.dropped.length > 0,
    count: kept.length,
  };
  trace.sections.push(chatSection);

  // 6) 用户输入
  const userText = String(userInput || '').trim();
  trace.userInputTokens = estimateTokens(userText);
  trace.eos = '[EOS]';
  const sumSections = () => trace.sections.reduce((n, s) => n + (Number(s.tokens) || 0), 0);
  trace.totalTokens = sumSections() + trace.userInputTokens + 4;

  // 总计超过可用预算：继续从最旧聊天记录丢弃（规格要求的兜底）
  let droppedChat = 0;
  while (trace.totalTokens > available && kept.length > 0) {
    const item = kept.shift();
    trace.dropped.push({ id: item.id, role: item.role, preview: item.content.slice(0, 60), tokens: item.tokens, reason: '上下文总预算' });
    chatTokens -= item.tokens;
    chatSection.tokens = chatTokens;
    chatSection.text = kept.map((m) => `${m.label}：${m.content}`).join('\n\n');
    chatSection.count = kept.length;
    chatSection.truncated = true;
    droppedChat += 1;
    trace.totalTokens = sumSections() + trace.userInputTokens + 4;
  }
  if (trace.totalTokens > available) {
    // 仍超：依次裁剪触发、常量、角色卡，系统提示与用户输入保底
    const shrink = (section) => {
      if (!section || section.tokens <= 0) return;
      const deficit = trace.totalTokens - available;
      if (deficit <= 0) return;
      const target = Math.max(0, section.tokens - deficit);
      const r = truncateToTokens(section.text || '', target);
      if (!r.text) return;
      section.text = r.text;
      section.tokens = r.tokens;
      section.truncated = true;
      trace.totalTokens = sumSections() + trace.userInputTokens + 4;
    };
    shrink(afterSection);
    shrink(beforeSection);
    shrink(trace.sections.find((s) => s.id === 'worldConst'));
    shrink(cardSection);
    // 系统提示里的身份锁不参与裁剪：只缩可裁剪部分
    const sysSec = trace.sections.find((s) => s.id === 'system');
    if (sysSec && trace.totalTokens > available && sysSec.text) {
      const deficit = trace.totalTokens - available;
      const keep = Math.max(lockTokens, (sysSec.tokens || 0) - deficit);
      const r = truncateToTokens(sysSec.text, keep);
      if (r.text && r.tokens >= lockTokens) {
        sysSec.text = r.text;
        sysSec.tokens = r.tokens;
        sysSec.truncated = true;
        trace.totalTokens = sumSections() + trace.userInputTokens + 4;
      }
    }
  }
  trace.overBudget = trace.totalTokens > available;
  trace.chatTokens = chatTokens;
  if (droppedChat > 0) chatSection.truncated = true;

  const finalSystemParts = [
    trace.sections.find((s) => s.id === 'speaker')?.text,
    trace.sections.find((s) => s.id === 'system')?.text,
    trace.sections.find((s) => s.id === 'worldConst')?.text,
    trace.sections.find((s) => s.id === 'card')?.text,
    beforeSection.text,
  ].filter(Boolean);
  const apiMessages = [];
  if (finalSystemParts.length) apiMessages.push({ role: 'system', content: finalSystemParts.join('\n\n') });
  for (const m of kept) apiMessages.push({ role: m.role, content: m.content });
  if (afterSection.text) apiMessages.push({ role: 'system', content: afterSection.text });
  // H3 尾 cue：把身份与格式钉在最后一行（最便宜的防串台手段）
  const cue = String(settings?.__tailCue || '').trim();
  if (userText) apiMessages.push({ role: 'user', content: cue ? `${userText}\n\n${cue}` : userText });
  trace.tailCue = cue;

  // 供「组装预览」按最终顺序展示
  trace.messages = apiMessages.map((m) => ({ role: m.role, content: m.content, tokens: estimateTokens(m.content) }));
  if (trace.overBudget) {
    const chatTrace = trace.sections.find((x) => x.id === 'chat');
    if (chatTrace) chatTrace.truncated = true;
  }

  return { messages: apiMessages, trace, userInput: userText };
}
