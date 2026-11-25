// dice — 掷骰弹窗（280×320）与 d100 大成功撒花。骰子逻辑在 core/dice-engine.js。
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { rollDice, formatRoll } from '../core/dice-engine.js';
import { sound } from './sound.js';
import { haptic } from './dom.js';

export class DiceModal {
  constructor({ onResult = null } = {}) {
    this.onResult = onResult;
    this.host = null;
    this.layer = null;
    this.input = null;
    this.resultEl = null;
    this.detailEl = null;
    this.historyEl = null;
    this.history = [];
    this.openState = false;
    this._lastExpr = '1d20';
  }

  mount(host) {
    this.host = host;
    this.layer = h('div', { class: 'overlay overlay--center dice-overlay', role: 'presentation', hidden: true });
    const panel = h('section', {
      class: 'dice-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '掷骰',
    });
    this.resultEl = h('div', { class: 'dice-result' }, '—');
    this.detailEl = h('div', { class: 'dice-detail' }, '输入骰式，例如 2d6+3');
    this.historyEl = h('div', { class: 'dice-history', 'aria-live': 'polite' });
    this.input = h('input', {
      class: 'dice-input',
      type: 'text',
      inputmode: 'text',
      value: this._lastExpr,
      'aria-label': '骰子表达式',
      placeholder: '2d6+3',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const form = h(
      'form',
      {
        class: 'dice-form',
        onsubmit: (event) => {
          event.preventDefault();
          this.roll();
        },
      },
      this.input,
      h('button', { class: 'btn btn--primary dice-roll-btn', type: 'submit' }, icon('dice', { size: 20 }), '掷'),
    );
    const closeBtn = h(
      'button',
      { class: 'icon-btn dice-close', type: 'button', 'aria-label': '关闭', onclick: () => this.close() },
      icon('close', { size: 20 }),
    );
    panel.append(
      h('div', { class: 'dice-head' }, h('span', { class: 'dice-title' }, '酒馆骰子'), closeBtn),
      this.resultEl,
      this.detailEl,
      this.historyEl,
      form,
    );
    this.layer.appendChild(h('div', { class: 'overlay__backdrop', onclick: () => this.close() }));
    this.layer.appendChild(panel);
    host.appendChild(this.layer);
    this.layer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    return this;
  }

  open({ expr = '1d20', auto = true, onResult = null } = {}) {
    if (onResult) this.onResult = onResult;
    if (typeof expr === 'string' && expr.trim()) {
      this.input.value = expr.trim();
      this._lastExpr = expr.trim();
    }
    this.openState = true;
    this.layer.hidden = false;
    requestAnimationFrame(() => this.layer.classList.add('is-open'));
    setTimeout(() => {
      this.input.focus({ preventScroll: true });
      this.input.select();
    }, 90);
    if (auto) this.roll();
  }

  close() {
    if (!this.openState) return;
    this.openState = false;
    this.layer.classList.remove('is-open');
    setTimeout(() => {
      if (!this.openState) this.layer.hidden = true;
    }, 180);
    this.input?.blur();
  }

  roll() {
    const expr = this.input.value.trim() || '1d20';
    this._lastExpr = expr;
    let result;
    try {
      result = rollDice(expr);
    } catch (err) {
      this.detailEl.textContent = String(err?.message || '骰式不正确');
      this.resultEl.textContent = '×';
      this.resultEl.className = 'dice-result dice-result--error';
      sound.error();
      haptic(120);
      return null;
    }
    sound.unlock().then((ok) => ok && sound.dice());
    haptic([15, 30, 15]);
    const face = result.rolls?.[0]?.values?.[0];
    this.resultEl.textContent = result.total;
    this.resultEl.className = `dice-result ${result.perfect ? 'dice-result--perfect' : ''}`;
    this.detailEl.textContent = `${result.expr}  ·  ${result.detail}`;
    this.history.unshift(`${result.expr} = ${result.total}`);
    this.history = this.history.slice(0, 2);
    clear(this.historyEl);
    for (const row of this.history) this.historyEl.appendChild(h('span', { class: 'dice-history__item' }, row));
    if (result.perfect) {
      this.detailEl.textContent = 'D100 掷出 100 · 大成功！';
      confetti();
    } else if (result.rolls?.length === 1 && result.rolls[0].sides === 6 && face) {
      this.detailEl.textContent = `D6 掷出 ${face}  ·  ${result.detail}`;
    }
    this.onResult?.(result);
    return result;
  }
}

export function mount(host, options = {}) {
  return new DiceModal(options).mount(host);
}

/** 轻量撒花：Canvas 2D，1.5s 后自动清理；尊重 prefers-reduced-motion。 */
export function confetti({ count = 110, duration = 1600 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#E8A33D', '#C9822A', '#EFE6DA', '#C94F3D', '#F2C879'];
  const parts = Array.from({ length: count }, () => ({
    x: window.innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: window.innerHeight * 0.38,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 9 - 3,
    size: 4 + Math.random() * 7,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  let raf = 0;
  const tick = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (elapsed < duration) raf = requestAnimationFrame(tick);
    else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);
  setTimeout(() => {
    cancelAnimationFrame(raf);
    canvas.remove();
  }, duration + 200);
}

export { formatRoll };
