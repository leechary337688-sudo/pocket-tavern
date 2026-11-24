// dice-engine — 纯函数骰子解析与投掷，供 UI 与插件共用（不依赖 DOM）。
// 支持 2d6+3、1d20-2、2d6+1d4+1 这类表达式。

const EXPR_RE = /^[-+]?(\d*d\d+|\d+)([-+](\d*d\d+|\d+))*$/i;

/**
 * @param {string} expr
 * @param {() => number} rng 返回 [0,1)
 */
export function rollDice(expr = '1d20', rng = Math.random) {
  const cleaned = String(expr).toLowerCase().replace(/\s+/g, '');
  if (!cleaned || !EXPR_RE.test(cleaned)) {
    throw new Error('骰子格式不对，试试 2d6+3 或 1d100');
  }
  const terms = cleaned.match(/[+-]?[^+-]+/g) || [];
  let total = 0;
  let modifier = 0;
  const rolls = [];
  for (const raw of terms) {
    const sign = raw.startsWith('-') ? -1 : 1;
    const term = raw.replace(/^[+-]/, '');
    const dice = /^(\d*)d(\d+)$/.exec(term);
    if (dice) {
      const count = Math.min(100, Math.max(1, Number(dice[1] || 1)));
      const sides = Math.min(1000, Math.max(2, Number(dice[2])));
      const values = [];
      for (let i = 0; i < count; i++) values.push(1 + Math.floor(rng() * sides));
      const subtotal = values.reduce((a, b) => a + b, 0) * sign;
      total += subtotal;
      rolls.push({ sign, count, sides, values, subtotal });
    } else {
      const n = Number(term) || 0;
      total += n * sign;
      if (sign > 0) modifier += n;
      else modifier -= n;
    }
  }
  const detail = rolls
    .map((r) => `${r.sign < 0 ? '−' : '+'} ${r.count}d${r.sides} [${r.values.join(', ')}]`)
    .join(' ');
  const perfect = rolls.some((r) => r.sides === 100 && r.values.some((v) => v === 100));
  return {
    expr: cleaned,
    total,
    rolls,
    modifier,
    detail: detail.replace(/^\+ /, ''),
    perfect,
    criticalFail: rolls.some((r) => r.sides === 100 && r.values.some((v) => v === 1)),
    at: Date.now(),
  };
}

export function formatRoll(result) {
  return `🎲 ${result.expr} = ${result.total}${result.detail ? `（${result.detail}）` : ''}`;
}
