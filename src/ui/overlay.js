// overlay — 底部弹层 / 居中对话框 / 操作表 / 输入框。统一处理焦点、Esc 与滚动锁。
import { h, clear, sleep } from './dom.js';
import { icon } from './icons.js';

const stack = [];
let uid = 0;

function getRoot() {
  let root = document.getElementById('modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
    document.body.appendChild(root);
  }
  return root;
}

function focusables(panel) {
  return [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null,
  );
}

function lock() {
  document.body.classList.add('is-locked');
}

function unlock() {
  if (!stack.length) document.body.classList.remove('is-locked');
}

/**
 * 打开一个弹层。content 为 Node；footer 为按钮数组或 Node。
 * 返回 { el, panel, body, close, setTitle }；close(value) 会触发 onClose(value)。
 */
export function openOverlay({
  title = '',
  subtitle = '',
  content = null,
  actions = [],
  variant = 'sheet',
  dismissible = true,
  onClose = null,
  className = '',
  headerExtra = null,
} = {}) {
  const root = getRoot();
  const id = `ov-${++uid}`;
  const previousFocus = document.activeElement;
  const layer = h('div', { class: `overlay overlay--${variant}`, role: 'presentation' });
  const panel = h('section', {
    class: `overlay__panel ${className}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': title ? `${id}-title` : undefined,
  });
  const head = title || subtitle || headerExtra
    ? h(
        'header',
        { class: 'overlay__head' },
        h(
          'div',
          { class: 'overlay__titles' },
          title ? h('h2', { class: 'overlay__title', id: `${id}-title` }, title) : null,
          subtitle ? h('p', { class: 'overlay__subtitle' }, subtitle) : null,
        ),
        headerExtra,
        dismissible
          ? h(
              'button',
              {
                class: 'icon-btn overlay__close',
                type: 'button',
                'aria-label': '关闭',
                onclick: () => close(null),
              },
              icon('close'),
            )
          : null,
      )
    : null;

  const body = h('div', { class: 'overlay__body' });
  if (content instanceof Node) body.appendChild(content);
  else if (typeof content === 'string' && content) body.appendChild(h('p', { class: 'overlay__text' }, content));

  const foot = h('footer', { class: 'overlay__foot' });
  for (const action of actions) {
    if (!action) continue;
    const btn = h(
      'button',
      {
        type: 'button',
        class: `btn ${action.kind ? `btn--${action.kind}` : 'btn--ghost'} ${action.block ? 'btn--block' : ''}`.trim(),
        onclick: async () => {
          const result = action.onClick ? await action.onClick() : action.value;
          if (action.keepOpen) return;
          close(result === undefined ? action.value ?? true : result);
        },
      },
      action.icon ? icon(action.icon, { size: 18 }) : null,
      action.label,
    );
    if (action.disabled) btn.disabled = true;
    foot.appendChild(btn);
  }
  if (!actions.length) foot.hidden = true;

  panel.append(...[head, body, foot].filter(Boolean));
  layer.appendChild(h('div', { class: 'overlay__backdrop', onclick: () => dismissible && close(null) }));
  layer.appendChild(panel);

  let closed = false;
  const item = { close };
  function close(value) {
    if (closed) return;
    closed = true;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const idx = stack.indexOf(item);
    if (idx >= 0) stack.splice(idx, 1);
    unlock();
    setTimeout(() => {
      layer.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try {
          previousFocus.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    }, 180);
    onClose?.(value ?? null);
  }

  const onKey = (event) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      close(null);
    } else if (event.key === 'Tab') {
      const list = focusables(panel);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  layer.addEventListener('keydown', onKey);

  root.appendChild(layer);
  stack.push(item);
  lock();
  requestAnimationFrame(() => layer.classList.add('is-open'));
  setTimeout(() => {
    const target = focusables(panel).find((el) => !el.classList.contains('overlay__close')) || focusables(panel)[0];
    target?.focus({ preventScroll: true });
  }, 80);

  return {
    el: layer,
    panel,
    body,
    foot,
    close,
    setTitle(next) {
      const t = panel.querySelector('.overlay__title');
      if (t) t.textContent = next;
    },
  };
}

export function actionSheet({ title = '', items = [], subtitle = '', dismissible = true, onClose } = {}) {
  return new Promise((resolve) => {
    const list = h('div', { class: 'action-list' });
    const overlay = openOverlay({
      title,
      subtitle,
      content: list,
      actions: [],
      dismissible,
      className: 'overlay__panel--actions',
      onClose: (value) => {
        resolve(value);
        onClose?.(value);
      },
    });
    for (const item of items) {
      const btn = h(
        'button',
        {
          class: `action-row ${item.danger ? 'action-row--danger' : ''}`.trim(),
          type: 'button',
          onclick: () => overlay.close(item.key),
        },
        item.icon ? h('span', { class: 'action-row__icon' }, icon(item.icon, { size: 21 })) : null,
        h(
          'span',
          { class: 'action-row__main' },
          h('span', { class: 'action-row__label' }, item.label),
          item.description ? h('span', { class: 'action-row__desc' }, item.description) : null,
        ),
        item.badge ? h('span', { class: 'action-row__badge' }, item.badge) : null,
      );
      list.appendChild(btn);
    }
  });
}

export function confirmDialog({
  title = '确认',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = openOverlay({
      title,
      content: h('p', { class: 'dialog-message' }, message),
      variant: 'center',
      actions: [
        { label: cancelText, kind: 'ghost', onClick: () => false },
        { label: confirmText, kind: danger ? 'danger' : 'primary', onClick: () => true },
      ],
      onClose: (value) => resolve(Boolean(value)),
    });
    overlay.panel.classList.add('dialog');
  });
}

export function promptDialog({
  title = '输入',
  label = '',
  value = '',
  placeholder = '',
  confirmText = '确定',
  multiline = false,
  maxlength = 4000,
  helper = '',
} = {}) {
  return new Promise((resolve) => {
    let input;
    if (multiline) {
      input = h('textarea', {
        class: 'field field--area',
        rows: '4',
        placeholder,
        maxlength,
        value,
      });
    } else {
      input = h('input', { class: 'field', type: 'text', placeholder, maxlength, value });
    }
    const form = h(
      'form',
      { class: 'dialog-form' },
      label ? h('label', { class: 'field-label', for: `f-${uid}` }, label) : null,
      input,
      helper ? h('p', { class: 'field-help' }, helper) : null,
    );
    input.id = `f-${uid}`;
    const overlay = openOverlay({
      title,
      content: form,
      variant: 'center',
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => null },
        {
          label: confirmText,
          kind: 'primary',
          onClick: () => {
            const text = input.value.trim();
            return text ? text : null;
          },
        },
      ],
      onClose: (result) => resolve(result ?? null),
    });
    overlay.panel.classList.add('dialog');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text) overlay.close(text);
    });
    if (!multiline) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
    }
    setTimeout(() => {
      input.focus({ preventScroll: true });
      input.select();
    }, 90);
  });
}

export function closeAllOverlays() {
  for (const item of [...stack]) item.close(null);
}

export async function withLoadingButton(button, task, loadingLabel = '处理中…') {
  const previous = button.textContent;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = loadingLabel;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = previous;
  }
}

export { stack as overlayStack, sleep, clear };
