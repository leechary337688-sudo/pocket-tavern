// toast — 轻提示。最多同时 3 条，带可选的撤销/重试动作。
import { h, clear } from './dom.js';
import { icon } from './icons.js';

let host = null;
const live = [];
const ICONS = { info: 'info', success: 'check', error: 'warning', warn: 'warning', dice: 'dice' };

function getHost() {
  if (host && host.isConnected) return host;
  host = document.getElementById('toast-root');
  if (!host) {
    host = h('div', { id: 'toast-root', class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, { type = 'info', action = '', onAction = null, duration = 2800, iconName = '' } = {}) {
  const root = getHost();
  while (live.length >= 3) {
    const oldest = live.shift();
    oldest?.remove();
  }
  const node = h('div', { class: `toast toast--${type}` });
  const mark = h('span', { class: 'toast__icon' }, icon(iconName || ICONS[type] || 'info', { size: 18 }));
  const text = h('span', { class: 'toast__text' }, message);
  node.append(mark, text);
  let timer = 0;
  const dismiss = () => {
    if (!node.isConnected) return;
    clearTimeout(timer);
    node.classList.remove('is-in');
    node.classList.add('is-out');
    const i = live.indexOf(node);
    if (i >= 0) live.splice(i, 1);
    setTimeout(() => node.remove(), 220);
  };
  if (action) {
    const btn = h(
      'button',
      {
        class: 'toast__action',
        type: 'button',
        onclick: (event) => {
          event.stopPropagation();
          dismiss();
          onAction?.();
        },
      },
      action,
    );
    node.appendChild(btn);
  }
  node.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    dismiss();
  });
  root.appendChild(node);
  live.push(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function toastError(message, options = {}) {
  return toast(message, { type: 'error', duration: 3800, ...options });
}

export function mount(el) {
  clear(el);
  const root = h('div', { id: 'toast-host', class: 'toast-host', role: 'status', 'aria-live': 'polite' });
  el.appendChild(root);
  host = root;
  return { unmount: unmount };
}

export function unmount() {
  host?.remove();
  host = null;
  live.length = 0;
}
