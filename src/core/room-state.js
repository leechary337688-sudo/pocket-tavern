// room-state — 房间状态账本（docs/pt-prompt-v1 §“状态账本”）。
// 目的：让“此刻在哪、刚才发生了什么、欠着谁的承诺”变成可读文本，而不是埋在历史里碰运气。
// 约束：只写 extdata（`__state`/`room`），不进聊天记录；每 4 条角色消息才重算一次。

const KEEP_TURNS = 8;

export function emptyLedger() {
  return { version: 1, byChat: {} };
}

/** 从最近若干条消息里提取“此刻/最近发生/未结” */
export function extractLedger({ messages = [], members = [], scene = '', lastTurns = KEEP_TURNS } = {}) {
  const chars = (messages || []).filter((m) => m && m.sender === 'char' && !m.ephemeral);
  const recent = chars.slice(-lastTurns);
  const speakers = [];
  for (const m of recent) {
    const name = m.speaker || '';
    if (name && !speakers.includes(name)) speakers.push(name);
  }
  const lastLine = (recent[recent.length - 1]?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const openLoop = /[？?]\s*$|等(?:你|他|她)|还没答|之后再|明天|下次/.test(lastLine);
  const present = (members || [])
    .filter((m) => m && (m.memberState || 'active') === 'active')
    .map((m) => m.name)
    .filter(Boolean);
  return {
    scene: String(scene || '').slice(0, 80),
    present,
    recentSpeakers: speakers.slice(-4),
    lastLine,
    openLoop,
    turn: chars.length,
    updatedAt: new Date().toISOString(),
  };
}

/** 渲染成 system 里的一小段（S4/S5） */
export function ledgerText(ledger, { char = '当前角色', user = '玩家' } = {}) {
  if (!ledger) return '';
  const lines = ['【此刻】'];
  if (ledger.scene) lines.push(`地点：${ledger.scene}`);
  if (ledger.present?.length) lines.push(`在场：${ledger.present.join('、')}`);
  if (ledger.lastLine) lines.push(`刚才：${ledger.recentSpeakers.slice(-2).join('、') || char}那边停在「${ledger.lastLine}」`);
  if (ledger.openLoop) lines.push(`未结：${user}还欠着一个回应。`);
  if (lines.length === 1) return '';
  lines.push('只依据这些，不编造没发生过的事。');
  return lines.join('\n');
}

export function shouldUpdate(ledger, charCount) {
  if (!ledger) return charCount >= 4;
  return charCount - (ledger.turn || 0) >= 4;
}
