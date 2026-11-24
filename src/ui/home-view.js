// home-view — 会话列表 / 开新局 / 继续上次。移动端右滑露出删除。
import { h, clear, formatTime, relativeTime, truncate, dayLabel } from './dom.js';
import { icon, iconButton, logoMark } from './icons.js';
import { confirmDialog } from './overlay.js';
import { toastError } from './toast.js';

function avatarFor(card) {
  const img = h('img', { class: 'avatar avatar--48', alt: '', src: card?.avatar || 'icons/logo.svg' });
  img.addEventListener('error', () => {
    img.src = 'icons/logo.svg';
  });
  return img;
}

function statChip(text, iconName) {
  return h('span', { class: 'stat-chip' }, icon(iconName, { size: 14 }), text);
}

export function mount(el, ctx) {
  const { repo, onOpenChat, onNewChat, onOpenSettings, onOpenCards, onOpenWorkshop, onDeleted } = ctx;
  let disposed = false;
  const root = h('div', { class: 'view home-view' });
  el.appendChild(root);
  let chats = [];
  let cards = new Map();

  const scroll = h('main', { class: 'home-scroll' });
  root.appendChild(scroll);

  function header() {
    return h(
      'header',
      { class: 'topbar topbar--home' },
      h(
        'div',
        { class: 'topbar__brand' },
        h('span', { class: 'logo-wrap' }, logoMark(30)),
        h(
          'div',
          { class: 'brand-text' },
          h('h1', { class: 'brand-title' }, '袖珍酒馆'),
          h('span', { class: 'brand-sub' }, 'PocketTavern'),
        ),
      ),
      h(
        'div',
        { class: 'topbar__actions' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '设置', onclick: onOpenSettings }, icon('settings')),
      ),
    );
  }

  function hero() {
    return h(
      'section',
      { class: 'home-hero' },
      h('span', { class: 'eyebrow' }, 'POCKET TAVERN · 深夜营业'),
      h('h2', { class: 'hero-title' }, '今夜，想和谁', h('br'), h('em', {}, '喝一杯？')),
      h('p', { class: 'hero-copy' }, '角色卡、世界书、流式回复。酒馆一直开到你困为止。'),
      h(
        'div',
        { class: 'hero-actions' },
        h('button', { class: 'btn btn--primary', type: 'button', onclick: onNewChat }, icon('plus', { size: 18 }), '开一桌新聊天'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: onOpenCards }, icon('cards', { size: 18 }), '逛卡库'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: onOpenWorkshop }, icon('sparkle', { size: 18 }), '创意工坊'),
      ),
      h('div', { class: 'hero-glow', 'aria-hidden': 'true' }),
    );
  }

  function statsBar() {
    const total = chats.reduce((n, c) => n + (c.messageCount || 0), 0);
    return h(
      'div',
      { class: 'home-stats' },
      statChip(`${chats.length} 场酒局`, 'chat'),
      statChip(`${cards.size} 位常客`, 'user'),
      statChip(`${total} 句交谈`, 'sparkle'),
    );
  }

  function chatRow(chat) {
    const card = cards.get(chat.cardId);
    const surface = h(
      'div',
      { class: 'chat-row__surface' },
      h('div', { class: 'chat-row__avatar' }, avatarFor(card), chat.branchOf ? h('span', { class: 'avatar-branch', title: '分支会话' }, icon('branch', { size: 11 })) : null),
      h(
        'div',
        { class: 'chat-row__main' },
        h(
          'div',
          { class: 'chat-row__top' },
          h('span', { class: 'chat-row__name' }, chat.title || card?.name || '未命名会话'),
          chat.starred ? icon('starFill', { size: 14, className: 'chat-row__star' }) : null,
          h('span', { class: 'chat-row__time' }, chat.demo ? '示例' : relativeTime(chat.updatedAt)),
        ),
        h(
          'div',
          { class: 'chat-row__bottom' },
          h('span', { class: 'chat-row__preview' }, chat.lastMessage ? `${chat.lastMessage.sender === 'user' ? '你：' : ''}${truncate(chat.lastMessage.text, 46)}` : '还没有开口'),
          h('span', { class: 'chat-row__count' }, `${chat.messageCount || 0}`),
        ),
      ),
      h('span', { class: 'chat-row__chevron' }, icon('forward', { size: 18 })),
    );
    const del = h(
      'button',
      {
        class: 'chat-row__delete',
        type: 'button',
        'aria-label': '删除会话',
        onclick: async (event) => {
          event.stopPropagation();
          const ok = await confirmDialog({
            title: '删掉这场酒局？',
            message: `「${chat.title || card?.name || '未命名会话'}」${chat.messageCount || 0} 条消息会一起删除，且不能撤销。`,
            confirmText: '删除',
            danger: true,
          });
          if (!ok) return resetSwipe();
          try {
            await repo.deleteChat(chat.id);
            chats = chats.filter((c) => c.id !== chat.id);
            onDeleted?.(chat.id);
            draw();
          } catch (err) {
            toastError(`删除失败：${err.message}`);
            resetSwipe();
          }
        },
      },
      icon('trash', { size: 20 }),
      h('span', {}, '删除'),
    );
    const row = h('article', { class: 'chat-row', tabindex: '0', role: 'button', 'data-id': chat.id }, del, surface);
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let swiping = false;
    let moved = false;
    const resetSwipe = () => {
      surface.style.transform = '';
      row.classList.remove('is-swiped');
      dx = 0;
      swiping = false;
    };
    surface.addEventListener(
      'touchstart',
      (event) => {
        const t = event.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        dx = 0;
        swiping = false;
        moved = false;
        surface.style.transition = 'none';
      },
      { passive: true },
    );
    surface.addEventListener(
      'touchmove',
      (event) => {
        const t = event.touches[0];
        const mx = t.clientX - startX;
        const my = t.clientY - startY;
        if (!swiping) {
          if (Math.abs(mx) < 8 || Math.abs(mx) < Math.abs(my)) return;
          swiping = true;
          moved = true;
        }
        if (!swiping) return;
        if (event.cancelable) event.preventDefault();
        dx = Math.min(96, Math.max(0, mx + (row.classList.contains('is-swiped') ? 96 : 0)));
        surface.style.transform = `translateX(${dx}px)`;
      },
      { passive: false },
    );
    surface.addEventListener('touchend', () => {
      surface.style.transition = '';
      if (!swiping) return;
      if (dx > 52) {
        surface.style.transform = 'translateX(96px)';
        row.classList.add('is-swiped');
      } else {
        resetSwipe();
      }
      setTimeout(() => {
        moved = false;
      }, 60);
    });
    surface.addEventListener('click', () => {
      if (moved) return;
      if (row.classList.contains('is-swiped')) {
        resetSwipe();
        return;
      }
      onOpenChat(chat.id);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenChat(chat.id);
      }
      if (event.key === 'Escape') resetSwipe();
    });
    return row;
  }

  function chatList() {
    if (!chats.length) {
      return h(
        'section',
        { class: 'empty-block' },
        h('div', { class: 'empty-block__icon' }, icon('chat', { size: 30 })),
        h('h3', {}, '还没有落座的客人'),
        h('p', {}, '内置的琥珀还在擦杯子。开一桌，或者从卡库导入一张新角色卡。'),
        h(
          'div',
          { class: 'empty-block__actions' },
          h('button', { class: 'btn btn--primary', type: 'button', onclick: onNewChat }, '开一桌'),
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: onOpenCards }, '去卡库'),
        ),
      );
    }
    const groups = new Map();
    for (const chat of chats) {
      const key = dayLabel(chat.updatedAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(chat);
    }
    const wrap = h('section', { class: 'section' });
    wrap.appendChild(
      h(
        'div',
        { class: 'section-head' },
        h('h3', { class: 'section-title' }, '最近的酒局'),
        h('span', { class: 'section-meta' }, `${chats.length} 场`),
      ),
    );
    for (const [label, list] of groups) {
      wrap.appendChild(h('div', { class: 'group-label' }, label));
      const listEl = h('div', { class: 'chat-list' });
      for (const chat of list) listEl.appendChild(chatRow(chat));
      wrap.appendChild(listEl);
    }
    wrap.appendChild(h('p', { class: 'swipe-hint' }, '右滑会话可删除 · 长按消息有更多操作'));
    return wrap;
  }

  function footerNote() {
    return h(
      'footer',
      { class: 'home-foot' },
      h('span', {}, '本地优先 · 无遥测 · 数据只存在这台设备'),
      h('span', { class: 'home-foot__dot' }, '·'),
      h('span', {}, formatTime(new Date().toISOString())),
    );
  }

  function draw() {
    if (disposed) return;
    clear(root);
    root.appendChild(header());
    root.appendChild(scroll);
    clear(scroll);
    scroll.appendChild(hero());
    scroll.appendChild(statsBar());
    scroll.appendChild(chatList());
    scroll.appendChild(footerNote());
  }

  (async () => {
    try {
      const [list, cardList] = await Promise.all([repo.listChats(), repo.listCards()]);
      if (disposed) return;
      chats = list;
      cards = new Map(cardList.map((c) => [c.id, c]));
      draw();
    } catch (err) {
      clear(scroll);
      scroll.appendChild(
        h('div', { class: 'empty-block' }, h('h3', {}, '酒馆没开门'), h('p', {}, String(err?.message || err))),
      );
    }
  })();

  return {
    unmount() {
      disposed = true;
      clear(root);
      root.remove();
    },
  };
}
