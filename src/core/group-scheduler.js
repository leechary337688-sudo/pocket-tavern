// group-scheduler — 群聊“谁来说下一句”（补丁 B）。
//
// 默认模式 natural_order：
//   ① 用户消息里“整词”提到某个成员名 → 该成员必定接话（最高优先，按提及顺序）
//   ② 其余成员按 talkativeness（0–1，默认 0.5）掷骰决定要不要插话
//   ③ allow_self_responses 默认 false：连续两次都是同一人说话时，跳过此人防霸屏
// 其他可选模式：round_robin（轮流）、director（每轮只掷一次，随机选一人）、mention（只有被点名才说话）。

function clamp01(n, fallback = 0.5) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 整词匹配成员名：中文没有空格分词，所以“整词”= 名字不能是更长名字的一部分。
 * - 名字后面紧跟另一个名字的首字（如「禁武江湖录」vs「禁武江湖录续集」）→ 不算命中
 * - 名字前面已经有更长的同名候选（如「禁武江湖录」里的「禁武江湖」）→ 不算命中
 */
export function mentionsName(text, name, allNames = null) {
  const target = String(name || '').trim();
  if (!target) return false;
  const source = String(text || '');
  if (!source) return false;
  if (/^[A-Za-z0-9_\- ]+$/.test(target)) {
    // 英文名按词边界（忽略大小写）
    return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(target)}($|[^A-Za-z0-9_])`, 'i').test(source);
  }
  const chars = [...target].map(escapeRe).join('');
  const CJK = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF';
  const re = new RegExp(`(^|[^${CJK}A-Za-z0-9])${chars}($|[^${CJK}A-Za-z0-9])`);
  if (re.test(source)) return true;
  // 中文名字后面常紧跟汉字，用“最长名字优先”的包含检查兜底
  const longest = source.match(new RegExp(`[${CJK}]+`, 'g')) || [];
  const names = (Array.isArray(allNames) && allNames.length ? allNames : [target])
    .map((n) => String(n || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // 长名优先，避免短名抢匹配
  for (const chunk of longest) {
    if (chunk.includes(target)) {
      const owner = names.find((n) => chunk.includes(n));
      if (owner === target) return true;
    }
  }
  return false;
}

export function findMentions(text, members = []) {
  const hits = [];
  const names = members.map((m) => m?.name).filter(Boolean);
  for (const member of members) {
    if (!member) continue;
    if (mentionsName(text, member.name, names)) hits.push(member);
  }
  const source = String(text);
  return hits.sort((a, b) => source.indexOf(a.name) - source.indexOf(b.name));
}

function lastSpeakerOf(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.sender === 'char') return { id: m.cardId || m.speakerId || '', name: m.speaker || '' };
    if (m && m.sender === 'user') return null;
  }
  return null;
}

/**
 * 计算本轮发言顺序。
 * @returns {{mode:string, order:object[], plan:{cardId:string,reason:string,roll?:number}[]}}
 */
export function planSpeakers({
  members = [],
  messages = [],
  userInput = '',
  mode = 'natural_order',
  allowSelfResponses = false,
  rounds = 1,
  rng = Math.random,
  defaultTalkativeness = 0.5,
} = {}) {
  const alive = (members || []).filter((m) => m && m.id);
  if (!alive.length) return { mode, order: [], plan: [] };
  const last = lastSpeakerOf(messages);
  const mentioned = findMentions(userInput, alive);
  const plan = [];
  const used = new Set();

  const take = (member, reason, extra = {}) => {
    if (!member || used.has(member.id)) return;
    used.add(member.id);
    plan.push({ cardId: member.id, name: member.name, reason, ...extra });
  };

  if (mode === 'mention') {
    mentioned.forEach((m) => take(m, '被点名'));
    if (!plan.length) take(alive[0], '没人被点名，默认第一位');
    return { mode, order: alive, plan };
  }

  if (mode === 'round_robin') {
    const idx = last ? alive.findIndex((m) => m.id === last.id) : -1;
    for (let r = 0; r < Math.max(1, rounds); r++) {
      const next = alive[(idx + 1 + r + alive.length) % alive.length];
      take(next, '轮流发言');
    }
    return { mode, order: alive, plan };
  }

  if (mode === 'director') {
    const pool = allowSelfResponses || !last ? alive : alive.filter((m) => m.id !== last.id);
    const pick = pool[Math.floor(rng() * pool.length)] || alive[0];
    take(pick, '导演随机指定');
    return { mode, order: alive, plan };
  }

  // natural_order
  // ① 被点名的必定接话（不受 talkativeness 与 allow_self_responses 影响）
  mentioned.forEach((m) => take(m, `被点名（${m.name}）`));

  // ② 其余成员按 talkativeness 掷骰
  for (const member of alive) {
    if (used.has(member.id)) continue;
    if (!allowSelfResponses && last && last.id === member.id) continue;
    const talk = clamp01(member.talkativeness, clamp01(defaultTalkativeness, 0.5));
    // 至少保留 5% 的基础接话欲望，避免 0 人说话全场冷场
    const p = talk * 0.75 + 0.05;
    const roll = rng();
    if (roll < p) take(member, `掷骰接话（${Math.round(talk * 100)}%）`, { roll });
  }

  for (let r = 1; r < Math.max(1, rounds); r++) {
    for (const member of alive) {
      if (used.has(member.id) && r === 1) continue;
      const talk = clamp01(member.talkativeness, clamp01(defaultTalkativeness, 0.5));
      if (rng() < talk * 0.5) take(member, '多轮插话');
    }
  }

  // ③ 全场安静时兜底：让好感最高（或第一位）的人接一句，避免卡死在用户这
  if (!plan.length) take(alive[0], '没人接话，兜底点名');

  return { mode, order: alive, plan };
}

/** 群聊卡片的默认 talkativeness（0–1，默认 0.5）。 */
export function memberOf(card, memberState = {}) {
  const talk = clamp01(memberState?.[card?.id]?.talkativeness, 0.5);
  return { ...card, talkativeness: talk };
}
