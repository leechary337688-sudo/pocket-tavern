// tokenizer-lite — 零依赖 token 估算器。
// 不做真正 BPE：中文按字、拉丁按 4 字符/词、标点按权重估算，用于上下文预算与展示。
// 误差约 ±15%，对 8k 预算足够；需要精确值时可在插件里换 wasm tokenizer。

const CJK_SRC = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF\\uAC00-\\uD7AF';
const CJK_RE = new RegExp(`[${CJK_SRC}]`, 'g');
const NON_CJK_PUNCT_RE = new RegExp(`[^\\sA-Za-z0-9_${CJK_SRC}]`, 'g');
const WORD_RE = /[A-Za-z]+/g;
const NUM_RE = /\d+/g;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/**
 * @param {string} text
 * @returns {number} 估算 token 数（含 2 token 消息开销）
 */
export function estimateTokens(text) {
  if (text === null || text === undefined || text === '') return 0;
  const s = String(text);
  let tokens = 0;
  const cjk = s.match(CJK_RE);
  if (cjk) tokens += cjk.length;
  const emoji = s.match(EMOJI_RE);
  if (emoji) tokens += emoji.length;
  const words = s.match(WORD_RE);
  if (words) {
    for (const w of words) tokens += Math.max(1, Math.ceil(w.length / 4));
  }
  const nums = s.match(NUM_RE);
  if (nums) {
    for (const n of nums) tokens += Math.max(1, Math.ceil(n.length / 3));
  }
  const punct = s.match(NON_CJK_PUNCT_RE);
  if (punct) tokens += Math.ceil(punct.length * 0.34);
  const lines = (s.match(/\n/g) || []).length;
  tokens += Math.ceil(lines * 0.5);
  return Math.max(1, Math.ceil(tokens)) + 2;
}

/**
 * 估算一组聊天消息的 token。
 * @param {{role:string, content:string}[]} messages
 */
export function estimateMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) total += estimateTokens(m?.content || '') + 2;
  return total;
}

/**
 * 按预算截断文本，保留原文语义尽量完整，末尾加省略号。
 * @param {string} text
 * @param {number} maxTokens
 * @returns {{text:string, tokens:number, truncated:boolean}}
 */
export function truncateToTokens(text, maxTokens) {
  const source = String(text ?? '');
  const full = estimateTokens(source);
  if (maxTokens <= 0) return { text: '', tokens: 0, truncated: source.length > 0 };
  if (full <= maxTokens) return { text: source, tokens: full, truncated: false };

  let lo = 0;
  let hi = source.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (estimateTokens(source.slice(0, mid) + '…') <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  // 不把代理对切成半个
  if (lo > 0) {
    const code = source.charCodeAt(lo - 1);
    if (code >= 0xd800 && code <= 0xdbff) lo -= 1;
  }
  const cut = source.slice(0, lo).replace(/\s+$/, '') + '…';
  return { text: cut, tokens: estimateTokens(cut), truncated: true };
}

/** 人类可读的 token 数 */
export function formatTokens(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v < 1000) return String(v);
  if (v < 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(v / 1000) + 'k';
}

export const tokenizer = Object.freeze({ estimateTokens, estimateMessages, truncateToTokens, formatTokens });
