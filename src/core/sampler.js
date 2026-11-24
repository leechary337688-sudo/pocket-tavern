// sampler — 采样参数默认值、校验与展示。

export const SAMPLER_DEFAULTS = Object.freeze({
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  min_p: 0.05,
  rep_pen: 1.1,
  presence: 0,
  frequency: 0,
  seed: -1,
  max_tokens: 2048,
  context_window: 8192,
});

const LIMITS = {
  temperature: [0, 2],
  top_p: [0, 1],
  top_k: [0, 500],
  min_p: [0, 1],
  rep_pen: [1, 2],
  presence: [-2, 2],
  frequency: [-2, 2],
  seed: [-1, 2 ** 31 - 1],
  max_tokens: [64, 32768],
  context_window: [1024, 131072],
};

const INT_FIELDS = new Set(['top_k', 'seed', 'max_tokens', 'context_window']);

/** 合并默认值并夹到合法区间；非法数字回退默认值。 */
export function normalizeSampler(raw = {}) {
  const out = { ...SAMPLER_DEFAULTS };
  for (const [key, def] of Object.entries(SAMPLER_DEFAULTS)) {
    const val = raw?.[key];
    if (typeof val === 'number' && Number.isFinite(val)) out[key] = val;
    else if (typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val))) out[key] = Number(val);
    else out[key] = def;
    const [min, max] = LIMITS[key];
    out[key] = Math.min(max, Math.max(min, out[key]));
    if (INT_FIELDS.has(key)) out[key] = Math.round(out[key]);
  }
  if (out.seed === -1) out.seed = -1;
  if (out.max_tokens > out.context_window / 2) {
    out.max_tokens = Math.max(64, Math.min(out.max_tokens, Math.floor(out.context_window / 2)));
  }
  if (out.top_p === 0) out.top_p = 0.0001; // 有些后端拒绝 0
  return out;
}

/** 供 UI 阅读的采样摘要 */
export function samplerSummary(s = SAMPLER_DEFAULTS) {
  return `T ${s.temperature} · top_p ${s.top_p} · top_k ${s.top_k} · max ${s.max_tokens}`;
}

/** 随机 seed（-1 表示每次随机） */
export function resolveSeed(seed) {
  if (seed === -1 || seed === null || seed === undefined) return Math.floor(Math.random() * 2 ** 31);
  return seed;
}

export const SAMPLER_META = Object.freeze([
  { key: 'temperature', label: 'temperature', min: 0, max: 2, step: 0.05, hint: '越高越发散；1.5 会明显跑偏' },
  { key: 'top_p', label: 'top_p', min: 0, max: 1, step: 0.01, hint: '核采样，通常 0.9' },
  { key: 'top_k', label: 'top_k', min: 0, max: 200, step: 1, hint: '0 = 关闭' },
  { key: 'min_p', label: 'min_p', min: 0, max: 0.5, step: 0.01, hint: '相对概率下限' },
  { key: 'rep_pen', label: 'rep_pen', min: 1, max: 2, step: 0.01, hint: '重复惩罚 1.1' },
  { key: 'presence', label: 'presence', min: -2, max: 2, step: 0.05, hint: '话题新鲜度' },
  { key: 'frequency', label: 'frequency', min: -2, max: 2, step: 0.05, hint: '词频惩罚' },
  { key: 'max_tokens', label: 'max_tokens', min: 64, max: 8192, step: 64, hint: '单次回复上限' },
  { key: 'context_window', label: 'context_window', min: 1024, max: 131072, step: 1024, hint: '模型上下文窗口' },
]);
