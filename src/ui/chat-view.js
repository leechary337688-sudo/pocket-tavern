// chat-view — 消息流、流式光标、swipe、长按菜单、删除撤销、分支与组装预览。
import {
  h,
  clear,
  formatTime,
  dayKey,
  dayLabel,
  isNearBottom,
  copyText,
  haptic,
  debounce,
  clamp,
  truncate,
  sleep,
} from './dom.js';
import { icon, iconButton } from './icons.js';
import { openOverlay, actionSheet, confirmDialog, promptDialog } from './overlay.js';
import { toast, toastError } from './toast.js';
import { openGroupEditor, openWorldMountEditor } from './group-view.js';
import { estimateTokens } from '../core/tokenizer-lite.js';
import { formatRoll } from '../core/dice-engine.js';

const VIRTUAL_AT = 100;
const AVG_HEIGHT = 116;
const UNDO_MS = 5000;

function cloneMessage(m) {
  return { ...m, swipes: Array.isArray(m.swipes) ? [...m.swipes] : [] };
}

/** 状态/好感是给插件吃的结构化行，不占玩家的正文视觉。 */
function visibleText(text) {
  return String(text || '')
    .replace(/\[(状态|好感)\]\s*\{[^\n]*\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenLabel(n) {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

class MessageList {
  constructor({ scroller, listEl, view }) {
    this.scroller = scroller;
    this.listEl = listEl;
    this.view = view;
    this.messages = [];
    this.nodes = new Map();
    this.heights = new Map();
    this.topSpacer = h('div', { class: 'msg-spacer', 'aria-hidden': 'true' });
    this.bottomSpacer = h('div', { class: 'msg-spacer', 'aria-hidden': 'true' });
    this.topHeight = 0;
    this.renderedHeight = 0;
    this.from = 0;
    this.to = 0;
    this._renderFlag = false;
    this._scrollRaf = 0;
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
  }

  get length() {
    return this.messages.length;
  }

  isNearBottom() {
    return isNearBottom(this.scroller, 120);
  }

  estimate(m) {
    if (this.heights.has(m.id)) return this.heights.get(m.id);
    const width = this.scroller.clientWidth || 360;
    const charsPerLine = Math.max(16, Math.floor((width - 84) / 17));
    const lines = Math.max(1, Math.ceil(String(m.text || '').length / charsPerLine));
    const base = 44 + lines * 27;
    const swipe = m.sender === 'char' && (m.swipes?.length || 0) > 1 ? 44 : 0;
    const foot = 26;
    return Math.min(1000, base + swipe + foot + 14);
  }

  totalHeight() {
    let n = 0;
    for (const m of this.messages) n += this.estimate(m);
    return n;
  }

  indexAt(y) {
    let acc = 0;
    for (let i = 0; i < this.messages.length; i++) {
      acc += this.estimate(this.messages[i]);
      if (acc >= y) return i;
    }
    return Math.max(0, this.messages.length - 1);
  }

  setMessages(messages, { atBottom = null } = {}) {
    this.messages = messages;
    const bottom = atBottom == null ? this.isNearBottom() : atBottom;
    this.render({ atBottom: bottom });
  }

  addMessage(message) {
    if (this.messages.some((m) => m.id === message.id)) return;
    const bottom = this.isNearBottom();
    this.messages.push(message);
    this.render({ atBottom: bottom });
  }

  refreshMessage(message) {
    const i = this.messages.findIndex((m) => m.id === message.id);
    if (i < 0) return;
    this.messages[i] = message;
    this.heights.delete(message.id);
    this.render({ atBottom: this.isNearBottom() });
  }

  patchStream(id, text) {
    const msg = this.messages.find((m) => m.id === id);
    if (msg) {
      msg.text = text;
      msg.tokenEstimate = estimateTokens(text);
    }
    const node = this.nodes.get(id);
    if (node) {
      this.view.updateStreamNode(node, msg || { text });
      if (this.isNearBottom()) this.scrollToBottom(false);
    } else if (this.isNearBottom()) {
      this.render({ atBottom: true });
    }
  }

  render({ atBottom = false } = {}) {
    if (this._renderFlag) return;
    this._renderFlag = true;
    const len = this.messages.length;
    const viewport = this.scroller.clientHeight || 600;
    const virtual = len > VIRTUAL_AT;
    let from = 0;
    let to = len;
    let top = 0;
    let bottom = 0;
    if (virtual) {
      if (atBottom) {
        to = len;
        from = Math.max(0, len - (10 + Math.ceil(viewport / AVG_HEIGHT) + 10));
      } else {
        const idx = this.indexAt(this.scroller.scrollTop);
        from = Math.max(0, idx - 10);
        to = Math.min(len, idx + 10 + Math.ceil(viewport / AVG_HEIGHT));
      }
      for (let i = 0; i < from; i++) top += this.estimate(this.messages[i]);
      for (let i = to; i < len; i++) bottom += this.estimate(this.messages[i]);
    }
    this.from = from;
    this.to = to;
    this.topHeight = top;
    const frag = document.createDocumentFragment();
    if (virtual && top > 0) {
      this.topSpacer.style.height = `${top}px`;
      frag.appendChild(this.topSpacer);
    }
    const nodes = new Map();
    for (let i = from; i < to; i++) {
      const msg = this.messages[i];
      const prev = this.messages[i - 1];
      if (!prev || dayKey(prev.sendDate) !== dayKey(msg.sendDate)) {
        frag.appendChild(h('div', { class: 'day-divider' }, h('span', {}, dayLabel(msg.sendDate))));
      }
      const node = this.view.buildMessage(msg, i);
      nodes.set(msg.id, node);
      frag.appendChild(node);
    }
    if (virtual && bottom >= 0) {
      this.bottomSpacer.style.height = `${bottom}px`;
      frag.appendChild(this.bottomSpacer);
    }
    this.nodes = nodes;
    this.listEl.replaceChildren(frag);
    this.renderedHeight = 0;
    for (let i = from; i < to; i++) this.renderedHeight += this.estimate(this.messages[i]);
    this._renderFlag = false;
    requestAnimationFrame(() => {
      // 用实际高度校正估算，滚动条长度更贴近真实。
      for (const [id, node] of nodes) {
        const hgt = node.getBoundingClientRect().height + 14;
        if (hgt > 10) this.heights.set(id, hgt);
      }
      if (virtual) {
        let nt = 0;
        for (let i = 0; i < from; i++) nt += this.estimate(this.messages[i]);
        let nb = 0;
        for (let i = to; i < len; i++) nb += this.estimate(this.messages[i]);
        this.topSpacer.style.height = `${nt}px`;
        this.bottomSpacer.style.height = `${nb}px`;
        this.topHeight = nt;
      }
      if (atBottom || this._wantBottom) {
        this._wantBottom = false;
        this.scrollToBottom(false);
      }
    });
  }

  onScroll() {
    if (this.messages.length <= VIRTUAL_AT) return;
    if (this._scrollRaf) return;
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = 0;
      const top = this.scroller.scrollTop;
      const viewport = this.scroller.clientHeight;
      if (top < this.topHeight - 260 || top + viewport > this.topHeight + this.renderedHeight + 260) {
        this.render({ atBottom: false });
      }
    });
  }

  scrollToBottom(smooth = false) {
    const behavior = smooth && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
    requestAnimationFrame(() => {
      this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior });
    });
  }

  scrollToMessage(id) {
    const index = this.messages.findIndex((m) => m.id === id);
    if (index < 0) return false;
    if (!this.nodes.has(id)) {
      let top = 0;
      for (let i = 0; i < index; i++) top += this.estimate(this.messages[i]);
      this.scroller.scrollTop = Math.max(0, top - this.scroller.clientHeight / 3);
      this.render({ atBottom: false });
    }
    requestAnimationFrame(() => {
      const node = this.scroller.querySelector(`[data-id="${String(id).replace(/"/g, '\\"')}"]`);
      if (!node) return;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.add('is-jump-flash');
      setTimeout(() => node.classList.remove('is-jump-flash'), 900);
    });
    return true;
  }
}

export function mount(el, ctx) {
  const { repo, engine, bus, loader, sound } = ctx;
  let settings = ctx.settings || repo.settings;
  let snapshot = engine.getSnapshot();
  let messages = (snapshot.messages || []).map(cloneMessage);
  let card = snapshot.card || {};
  let members = (snapshot.members || []).map((m) => ({ ...m }));
  let chatInfo = snapshot.chat || {};
  let state = snapshot.state || 'idle';
  let generatingId = snapshot.generatingId || null;
  let disposed = false;
  let stick = true;
  let undoTimer = 0;
  let undoExpires = 0;
  let previewOverlay = null;

  const root = h('div', { class: 'view chat-view' });
  el.appendChild(root);

  // ---------------- 顶栏 ----------------
  const avatarImg = h('img', { class: 'avatar avatar--32', alt: '', src: card.avatar || 'icons/logo.svg' });
  avatarImg.addEventListener('error', () => {
    avatarImg.src = 'icons/logo.svg';
  });
  const headerAvatar = h('span', { class: 'chat-avatar-wrap' }, avatarImg);
  const titleEl = h('h1', { class: 'chat-title' }, chatInfo.title || card.name || '酒馆');
  const roomBadge = h('span', { class: 'chat-room-badge', hidden: chatInfo.kind !== 'group' }, `房间 · ${engine.members?.length || 0} 位`);
  const statusEl = h('p', { class: 'chat-status' }, '');
  const statusDot = h('span', { class: 'chat-status__dot' });

  function syncRoomBadge() {
    const isRoom = (chatInfo.kind || engine.kind) === 'group';
    roomBadge.hidden = !isRoom;
    roomBadge.textContent = `房间 · ${engine.members?.length || chatInfo.memberIds?.length || 0} 位`;
  }

  async function openGroupSettings() {
    const currentChat = {
      ...(engine.chat || {}),
      memberIds: engine.members?.length ? engine.members.map((m) => m.id) : [card.id],
      memberState: engine.chat?.memberState || {},
    };
    await openGroupEditor({
      repo,
      settings,
      chat: currentChat,
      onSave: async (data) => {
        const info = await engine.updateChatSettings(data);
        chatInfo = info || engine.getChatInfo();
        titleEl.textContent = chatInfo.title || card.name || '酒馆';
        syncRoomBadge();
        toast(chatInfo.kind === 'group' ? `房间已开，${chatInfo.members?.length || data.memberIds.length} 位在座` : '群聊设置已保存', { type: 'success' });
      },
    });
  }

  async function openWorldMount() {
    await openWorldMountEditor({
      repo,
      chat: engine.getChatInfo(),
      onSave: async ({ worldIds, advancedWorlds }) => {
        chatInfo = await engine.updateChatSettings({ worldIds, advancedWorlds });
        toast('世界书挂载已保存', { type: 'success' });
      },
    });
  }

  const header = h(
    'header',
    { class: 'chat-topbar' },
    h('button', { class: 'icon-btn chat-back', type: 'button', 'aria-label': '返回酒馆', onclick: () => ctx.onBack?.() }, icon('back')),
    h('button', { class: 'chat-identity', type: 'button', 'aria-label': '查看角色档案', onclick: showCardInfo }, headerAvatar, h('span', { class: 'chat-identity__text' }, h('span', { class: 'chat-title-line' }, titleEl, roomBadge), h('span', { class: 'chat-status' }, statusDot, statusEl))),
    h(
      'div',
      { class: 'chat-topbar__actions' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '组装预览', onclick: openPreview }, icon('terminal')),
      chatInfo.kind === 'group'
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '群聊成员与规则', onclick: openGroupSettings }, icon('user'))
        : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '更多', onclick: openChatMenu }, icon('more')),
    ),
  );

  // ---------------- 消息流 ----------------
  const scroller = h('div', { class: 'chat-stream', role: 'log', 'aria-live': 'polite' });
  const listEl = h('div', { class: 'msg-list' });
  scroller.appendChild(listEl);
  const scrollDownBtn = h('button', {
    class: 'scroll-down-btn',
    type: 'button',
    'aria-label': '回到最新消息',
    hidden: true,
    onclick: () => {
      stick = true;
      list.scrollToBottom(true);
      scrollDownBtn.hidden = true;
    },
  }, icon('chevronDown'));
  const undoBar = h(
    'div',
    { class: 'undo-bar', hidden: true, role: 'status' },
    h('span', { class: 'undo-bar__text' }, '已删除'),
    h('button', { class: 'undo-bar__btn', type: 'button' }, icon('undo', { size: 16 }), '撤销'),
  );
  const undoText = undoBar.querySelector('.undo-bar__text');
  undoBar.querySelector('button').addEventListener('click', async () => {
    try {
      const restored = await engine.undoDelete();
      hideUndo();
      toast(restored ? '已撤销删除' : '撤销窗口已经过期', { type: restored ? 'success' : 'warn' });
    } catch (err) {
      toastError(err.message);
    }
  });

  // ---------------- 快捷栏 ----------------
  const quickbar = h('div', { class: 'quickbar', role: 'toolbar', 'aria-label': '快捷回复' });

  // ---------------- 输入栏 ----------------
  const ta = h('textarea', {
    class: 'composer__input',
    rows: '1',
    placeholder: '说点什么，或者输入 / 查看指令…',
    'aria-label': '消息输入框',
    enterkeyhint: 'send',
  });
  const tokenMeter = h('span', { class: 'token-meter' }, '≈ 0');
  const sendBtn = h('button', { class: 'send-btn', type: 'button', 'aria-label': '发送' }, icon('send', { size: 22 }));
  const composer = h(
    'div',
    { class: 'composer' },
    h('button', { class: 'composer__plus', type: 'button', 'aria-label': '指令与更多', onclick: showCommands }, icon('plus', { size: 20 })),
    h('div', { class: 'composer__field' }, ta, h('div', { class: 'composer__meta' }, tokenMeter, h('span', { class: 'composer__hint' }, 'Enter 换行 · 点 + 看指令'))),
    sendBtn,
  );

  const chatBody = h('div', { class: 'chat-body' }, scroller, scrollDownBtn, undoBar, quickbar, composer);
  root.append(header, chatBody);
  syncRoomBadge();
  refreshHeaderDecoration();

  // ---------------- 消息节点 ----------------
  function speakerFor(msg) {
    const name = msg.speaker || '';
    const id = msg.cardId || '';
    return members.find((m) => m.id === id || (name && m.name === name))
      || (card?.id === id || (name && card?.name === name) ? card : null)
      || members[0]
      || card;
  }

  function metaFor(msg) {
    if (msg.sender === 'user') return '你';
    if (msg.sender === 'system') return '酒馆';
    return speakerFor(msg)?.name || '角色';
  }

  /** 头像状态由插件提供；宿主只认白名单状态/自定义 class，插件不能直接改 DOM。 */
  function decorateAvatar(wrapper, speaker, msg) {
    if (!wrapper) return;
    wrapper.querySelectorAll('.avatar-deco').forEach((node) => node.remove());
    for (const cls of String(wrapper.dataset.decoClasses || '').split(' ').filter(Boolean)) {
      wrapper.classList.remove(cls);
    }
    wrapper.dataset.decoClasses = '';
    wrapper.classList.remove('is-hurt', 'is-dead', 'is-alert');
    const memberState = speaker?.memberState || msg?.memberState || 'active';
    if (memberState === 'away' || memberState === 'dead') {
      wrapper.classList.add(memberState === 'dead' ? 'is-dead' : 'is-away');
    }
    let decorations = [];
    try {
      decorations = loader?.getAvatarDecorations?.({
        card: speaker,
        message: msg,
        chat: engine.chat,
        members,
      }) || [];
    } catch {
      decorations = [];
    }
    for (const deco of decorations) {
      if (deco.state && deco.state !== 'normal' && deco.state !== 'custom') {
        wrapper.classList.add(`is-${deco.state}`);
      }
      if (deco.className) {
        const classes = Array.isArray(deco.classNames) && deco.classNames.length ? deco.classNames : [deco.className];
        for (const name of classes) {
          if (name) wrapper.classList.add(name);
        }
        wrapper.dataset.decoClasses = `${wrapper.dataset.decoClasses} ${classes.join(' ')}`.trim();
      }
      if (deco.badge) {
        wrapper.appendChild(h('span', {
          class: 'avatar-deco',
          title: deco.title || deco.label || '',
          'aria-label': deco.label || '',
        }, deco.badge));
      }
    }
    if ((memberState === 'away' || memberState === 'dead') && !wrapper.querySelector('.avatar-deco')) {
      wrapper.appendChild(h('span', {
        class: 'avatar-deco avatar-deco--host',
        title: memberState === 'dead' ? '已退场' : '暂离',
        'aria-label': memberState === 'dead' ? '已退场' : '暂离',
      }, memberState === 'dead' ? '✝' : '…'));
    }
  }

  function refreshHeaderDecoration() {
    const last = [...messages].reverse().find((msg) => msg.sender === 'char');
    decorateAvatar(headerAvatar, card, last);
  }

  function buildMessage(msg, index) {
    if (msg.sender === 'system') {
      return h(
        'article',
        { class: 'msg msg--system', 'data-id': msg.id },
        h('div', { class: 'system-pill' }, h('span', { class: 'system-pill__text' }, msg.text || '…'), h('time', {}, formatTime(msg.sendDate))),
      );
    }
    const isChar = msg.sender === 'char';
    const textEl = h('div', { class: 'msg__text' }, visibleText(msg.text));
    const cursor = h('span', { class: 'stream-cursor', hidden: !(msg.pending && generatingId === msg.id) });
    const bubble = h('div', { class: 'msg__bubble' }, textEl, cursor);
    const foot = h('div', { class: 'msg__foot' });
    const meta = h(
      'div',
      { class: 'msg__meta' },
      h('span', { class: 'msg__name' }, metaFor(msg)),
      h('time', { class: 'msg__time' }, formatTime(msg.sendDate)),
      msg.starred ? icon('starFill', { size: 13, className: 'msg__star' }) : null,
    );
    let avatar = null;
    if (isChar) {
      const speaker = speakerFor(msg);
      avatar = h('button', {
        class: 'msg__avatar',
        type: 'button',
        'aria-label': `查看${speaker?.name || '角色'}的状态`,
        onclick: (event) => {
          event.stopPropagation();
          showMemberInfo(speaker, msg);
        },
      }, h('img', { class: 'avatar avatar--48', alt: '', src: speaker?.avatar || 'icons/logo.svg' }));
      avatar.querySelector('img').addEventListener('error', (event) => { event.target.src = 'icons/logo.svg'; });
      decorateAvatar(avatar, speaker, msg);
    }
    if (isChar && (msg.swipes?.length || 0) > 1) {
      foot.appendChild(
        h(
          'div',
          { class: 'msg__swipe' },
          h('button', { class: 'swipe-btn', type: 'button', 'aria-label': '上一条回复', onclick: (e) => { e.stopPropagation(); switchSwipe(msg, -1); } }, icon('back', { size: 15 })),
          h('span', { class: 'swipe-count' }, `${(msg.swipeIndex || 0) + 1} / ${msg.swipes.length}`),
          h('button', { class: 'swipe-btn', type: 'button', 'aria-label': '下一条回复', onclick: (e) => { e.stopPropagation(); switchSwipe(msg, 1); } }, icon('forward', { size: 15 })),
        ),
      );
    }
    if (msg.incomplete && msg.sender === 'char') {
      foot.appendChild(
        h('button', {
          class: 'msg__continue',
          type: 'button',
          onclick: (event) => {
            event.stopPropagation();
            continueMessage(msg);
          },
        }, icon('play', { size: 13 }), '继续'),
      );
    }
    if (msg.error) {
      foot.appendChild(
        h('button', {
          class: 'msg__retry',
          type: 'button',
          onclick: (event) => {
            event.stopPropagation();
            retryMessage(msg);
          },
        }, icon('refresh', { size: 13 }), '重试'),
      );
    }
    foot.appendChild(h('span', { class: 'msg__tokens' }, `≈${tokenLabel(msg.tokenEstimate || estimateTokens(msg.text || ''))}`));
    foot.appendChild(
      h('button', {
        class: `msg__star-btn ${msg.starred ? 'is-on' : ''}`,
        type: 'button',
        'aria-label': msg.starred ? '取消收藏' : '收藏',
        onclick: (event) => {
          event.stopPropagation();
          toggleStar(msg);
        },
      }, icon(msg.starred ? 'starFill' : 'star', { size: 15 })),
    );
    const main = h('div', { class: 'msg__main' }, meta, bubble, foot);
    if (msg.error) main.appendChild(h('p', { class: 'msg__error-text' }, truncate(msg.error, 90)));
    const node = h(
      'article',
      {
        class: `msg ${isChar ? 'msg--char' : 'msg--user'} ${msg.pending ? 'is-pending' : ''} ${msg.starred ? 'is-starred' : ''}`.trim(),
        'data-id': msg.id,
        tabindex: '0',
      },
      avatar,
      main,
    );
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openMessageMenu(msg);
    });
    node.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      if (msg.pending || generatingId === msg.id) {
        if (state === 'streaming') {
          engine.pause();
          toast('已暂停，点这条消息可以继续', { type: 'info' });
        } else if (state === 'paused' || state === 'error') {
          retryMessage(msg);
        }
      }
    });
    let pressTimer = 0;
    let longPressed = false;
    let startX = 0;
    let startY = 0;
    node.addEventListener('touchstart', (event) => {
      longPressed = false;
      const t = event.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressed = true;
        haptic(12);
        openMessageMenu(msg);
      }, 480);
    }, { passive: true });
    node.addEventListener('touchmove', (event) => {
      const t = event.touches[0];
      if (Math.abs(t.clientX - startX) > 12 || Math.abs(t.clientY - startY) > 12) clearTimeout(pressTimer);
    }, { passive: true });
    node.addEventListener('touchend', () => clearTimeout(pressTimer));
    node.addEventListener('click', (event) => {
      if (longPressed) {
        event.stopPropagation();
        longPressed = false;
      }
    }, true);
    let lastTap = 0;
    bubble.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      const now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        toggleStar(msg);
      } else {
        lastTap = now;
      }
    });
    return node;
  }

  const viewApi = {
    buildMessage,
    updateStreamNode(node, msg) {
      const textEl = node.querySelector('.msg__text');
      if (textEl) {
        if (msg.text) textEl.textContent = visibleText(msg.text);
        else textEl.textContent = '';
      }
      const cursor = node.querySelector('.stream-cursor');
      if (cursor) cursor.hidden = false;
      node.classList.add('is-pending');
      const tokenEl = node.querySelector('.msg__tokens');
      if (tokenEl) tokenEl.textContent = `≈${tokenLabel(msg?.tokenEstimate || estimateTokens(msg?.text || ''))}`;
      if (msg?.text && textEl && !textEl.textContent) textEl.textContent = visibleText(msg.text);
      if (!msg?.text && !node.querySelector('.msg__typing')) {
        const typing = h('span', { class: 'msg__typing' }, h('i'), h('i'), h('i'));
        node.querySelector('.msg__bubble')?.prepend(typing);
      }
      if (msg?.text) node.querySelector('.msg__typing')?.remove();
    },
  };

  const list = new MessageList({ scroller, listEl, view: viewApi });

  // ---------------- 状态 / 顶栏 ----------------
  function refreshStatus() {
    const model = settings?.connection?.model || '';
    let text = model ? truncate(model, 24) : '未连接后端';
    let kind = 'idle';
    if (state === 'streaming') {
      text = '正在斟酒…';
      kind = 'streaming';
    } else if (state === 'paused') {
      text = '已暂停';
      kind = 'paused';
    } else if (state === 'error') {
      text = '出错，点消息重试';
      kind = 'error';
    }
    statusEl.textContent = text;
    statusDot.className = `chat-status__dot chat-status__dot--${kind}`;
    const locked = state === 'streaming';
    ta.disabled = locked;
    quickbar.classList.toggle('is-locked', locked);
    if (locked) {
      clear(sendBtn);
      sendBtn.appendChild(icon('stop', { size: 20 }));
      sendBtn.setAttribute('aria-label', '停止生成');
      sendBtn.classList.add('is-stop');
    } else {
      clear(sendBtn);
      sendBtn.appendChild(icon('send', { size: 22 }));
      sendBtn.setAttribute('aria-label', '发送');
      sendBtn.classList.remove('is-stop');
    }
    ta.placeholder =
      state === 'paused'
        ? '已暂停 · 点消息继续，或直接发送新消息'
        : '说点什么，或者输入 / 查看指令…';
    if (state === 'paused') ta.placeholder = '已暂停 · 点消息继续，或直接发送新消息';
  }

  function setState(next) {
    state = next?.state || next || 'idle';
    if (next?.messageId !== undefined) generatingId = next.messageId;
    if (state === 'idle' || state === 'error') {
      // 生成结束后节点上不应再有光标；等 messageUpdated 刷新即可。
    }
    refreshStatus();
  }

  function updateHeader() {
    titleEl.textContent = chatInfo.title || card.name || '酒馆';
    avatarImg.src = card.avatar || 'icons/logo.svg';
    refreshStatus();
  }

  // ---------------- 交互 ----------------
  function memberCardHost() {
    const host = h('div', { class: 'member-card-host' });
    for (const panel of loader?.getMemberCards?.() || []) {
      const box = h('section', { class: 'member-card' }, h('h4', { class: 'member-card__title' }, panel.title || '角色状态'));
      try {
        const draw = panel.render(box, card, { chat: engine.chat, members });
        if (typeof draw === 'function') {
          // 首次渲染已由插件完成；重绘由插件自己的事件驱动。
        }
      } catch (err) {
        console.warn('[pt] member card', err);
      }
      host.appendChild(box);
    }
    return host;
  }

  function showMemberInfo(speaker, msg) {
    if (!speaker) return;
    const host = h('div', { class: 'card-detail member-detail' },
      h('div', { class: 'card-detail__top' },
        h('img', { class: 'avatar avatar--88', alt: '', src: speaker.avatar || 'icons/logo.svg' }),
        h('div', {}, h('h2', { class: 'card-detail__name' }, speaker.name || '角色'), h('p', { class: 'card-detail__meta' }, `${({ active: '在场', away: '暂离', dead: '已退场' })[speaker.memberState] || '在场'} · ${msg?.speaker || speaker.name || ''}`))),
      h('p', { class: 'card-detail__desc' }, speaker.description || '这个角色还没有写描述。'));
    for (const panel of loader?.getMemberCards?.() || []) {
      const box = h('section', { class: 'member-card' }, h('h4', { class: 'member-card__title' }, panel.title || '角色状态'));
      try {
        panel.render(box, speaker, { chat: engine.chat, members, message: msg });
      } catch (err) {
        console.warn('[pt] member card', err);
      }
      host.appendChild(box);
    }
    openOverlay({ title: '角色状态', content: host, actions: [{ label: '关闭', kind: 'primary' }] });
  }

  async function showCardInfo() {
    if (!card?.name) return;
    openOverlay({
      title: '角色档案',
      content: h(
        'div',
        { class: 'card-detail' },
        h('div', { class: 'card-detail__top' }, h('img', { class: 'avatar avatar--88', alt: '', src: card.avatar || 'icons/logo.svg' }), h('div', {}, h('h2', { class: 'card-detail__name' }, card.name), h('p', { class: 'card-detail__meta' }, card.creator ? `创作者 ${card.creator}` : '佚名创作者'), h('div', { class: 'tag-row' }, ...(card.tags || []).map((t) => h('span', { class: 'tag' }, t))))),
        memberCardHost(),
        h('p', { class: 'card-detail__desc' }, card.description || '这个角色还没有写描述。'),
        card.personality ? h('div', { class: 'card-section' }, h('h4', {}, '性格'), h('p', {}, card.personality)) : null,
        card.scenario ? h('div', { class: 'card-section' }, h('h4', {}, '场景'), h('p', {}, card.scenario)) : null,
        card.first_mes ? h('div', { class: 'card-section' }, h('h4', {}, '开场白'), h('p', { class: 'quote-block' }, card.first_mes)) : null,
      ),
      actions: [
        { label: '去卡库', kind: 'ghost', onClick: () => ctx.onOpenCards?.() },
        { label: '关闭', kind: 'primary' },
      ],
    });
  }

  async function openChatMenu() {
    const action = await actionSheet({
      title: chatInfo.title || '酒馆',
      items: [
        { key: 'preview', label: '组装预览', icon: 'terminal', description: '看系统提示、世界书与聊天预算' },
        { key: 'invite', label: chatInfo.kind === 'group' ? '群聊成员与规则' : '邀请角色 · 转为房间', icon: 'user', description: chatInfo.kind === 'group' ? '邀请/移除，改发言规则' : '保留这局消息，多开一张椅子' },
        { key: 'worldMount', label: '世界书挂载', icon: 'book', description: '一局一本；需要叠设定再开高级' },
        { key: 'world', label: '世界书', icon: 'book' },
        { key: 'cards', label: '角色卡库', icon: 'cards' },
        { key: 'rename', label: '重命名会话', icon: 'edit' },
        { key: 'reset', label: '重新开始', icon: 'refresh', danger: true, description: '保留角色卡，清空这局聊天' },
        { key: 'settings', label: '设置', icon: 'settings' },
      ],
    });
    if (!action) return;
    if (action === 'preview') return openPreview();
    if (action === 'invite') return openGroupSettings();
    if (action === 'worldMount') return openWorldMount();
    if (action === 'world') return ctx.onOpenWorldbook?.();
    if (action === 'cards') return ctx.onOpenCards?.();
    if (action === 'settings') return ctx.onOpenSettings?.();
    if (action === 'rename') {
      const name = await promptDialog({ title: '重命名会话', label: '会话名字', value: chatInfo.title || '', confirmText: '保存', maxlength: 50 });
      if (!name) return;
      try {
        await engine.setTitle(name);
        chatInfo = engine.getChatInfo();
        updateHeader();
      } catch (err) {
        toastError(err.message);
      }
      return;
    }
    if (action === 'reset') {
      const ok = await confirmDialog({
        title: '重新开始这一局？',
        message: '当前聊天记录会清空，角色卡与设置不受影响。',
        confirmText: '重新开始',
        danger: true,
      });
      if (!ok) return;
      try {
        await engine.reset();
        toast('酒馆重新开张', { type: 'success' });
      } catch (err) {
        toastError(err.message);
      }
    }
  }

  async function openMessageMenu(msg) {
    if (state === 'streaming' && msg.id !== generatingId) {
      toast('正在生成，先点消息暂停或按停止键', { type: 'info' });
      return;
    }
    const isChar = msg.sender === 'char';
    const items = [
      { key: 'copy', label: '复制', icon: 'copy' },
      msg.sender !== 'system' ? { key: 'edit', label: '编辑', icon: 'edit' } : null,
      isChar ? { key: 'regen', label: '重新生成', icon: 'refresh', description: state === 'streaming' ? '生成中不可用' : '生成一条新 swipe' } : null,
      isChar ? { key: 'continue', label: '继续生成', icon: 'play' } : null,
      { key: 'star', label: msg.starred ? '取消收藏' : '收藏', icon: msg.starred ? 'starFill' : 'star' },
      { key: 'branch', label: '从这里分出分支', icon: 'branch' },
      isChar ? { key: 'tts', label: '朗读', icon: 'volume' } : null,
      { key: 'delete', label: '删除', icon: 'trash', danger: true },
    ].filter(Boolean);
    const action = await actionSheet({ title: '消息操作', subtitle: truncate(visibleText(msg.text), 42), items });
    if (!action) return;
    if (action === 'copy') {
      const ok = await copyText(visibleText(msg.text));
      toast(ok ? '已复制' : '复制失败，请长按文本手动复制', { type: ok ? 'success' : 'error' });
    } else if (action === 'edit') {
      const text = await promptDialog({ title: '编辑消息', label: '内容', value: msg.text, multiline: true, confirmText: '保存' });
      if (!text) return;
      try {
        await engine.editMessage(msg.id, text);
        toast('已保存', { type: 'success', duration: 1400 });
      } catch (err) {
        toastError(err.message);
      }
    } else if (action === 'regen') {
      await regenerate(msg);
    } else if (action === 'continue') {
      await continueMessage(msg);
    } else if (action === 'star') {
      await toggleStar(msg);
    } else if (action === 'branch') {
      try {
        const chat = await engine.fork(msg.id);
        toast('已分出新的酒局', { type: 'success' });
        ctx.onForked?.(chat);
      } catch (err) {
        toastError(err.message);
      }
    } else if (action === 'tts') {
      const res = sound?.speak(visibleText(msg.text), { pitch: 1.1 });
      if (res && !res.ok) toast(res.reason, { type: 'warn', action: '去设置', onAction: () => ctx.onOpenSettings?.() });
    } else if (action === 'delete') {
      await deleteMessage(msg);
    }
  }

  async function deleteMessage(msg) {
    const mode = await actionSheet({
      title: '删除消息',
      subtitle: '删除后 5 秒内可以撤销',
      items: [
        { key: 'single', label: '仅删除这一条', icon: 'trash' },
        { key: 'following', label: '删除这条及之后', icon: 'trash', danger: true, description: `之后还有 ${Math.max(0, messages.length - messages.indexOf(msg) - 1)} 条` },
      ],
    });
    if (!mode) return;
    if (mode === 'following') {
      const ok = await confirmDialog({
        title: '连同后续一起删除？',
        message: '这条消息之后的内容都会消失。删除后 5 秒内仍可撤销。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await engine.deleteMessage(msg.id, { withFollowing: mode === 'following' });
      haptic(8);
      // undoChanged 会带真实删除条数与 5s 到期时间，这里不再重复 showUndo。
    } catch (err) {
      toastError(err.message);
    }
  }

  async function regenerate(msg) {
    try {
      await engine.regenerate(msg.id);
    } catch (err) {
      toastError(err.message);
    }
  }

  async function continueMessage(msg) {
    try {
      await engine.resumeMessage(msg.id);
    } catch (err) {
      toastError(err.message);
    }
  }

  async function retryMessage(msg) {
    try {
      if (msg.incomplete || state === 'paused' || state === 'error') await engine.resumeMessage(msg.id);
      else if (msg.sender === 'char') await engine.regenerate(msg.id);
    } catch (err) {
      toastError(err.message);
    }
  }

  async function toggleStar(msg) {
    try {
      const starred = await engine.toggleStar(msg.id);
      haptic(8);
      const fresh = engine.getMessages().find((m) => m.id === msg.id);
      if (fresh) list.refreshMessage(fresh);
      if (starred) toast('已收藏', { iconName: 'starFill', duration: 1200 });
    } catch (err) {
      toastError(err.message);
    }
  }

  async function switchSwipe(msg, dir) {
    try {
      const next = await engine.switchSwipe(msg.id, dir);
      if (next) {
        sound?.page();
        haptic(8);
        list.refreshMessage(engine.getMessages().find((m) => m.id === msg.id));
      }
    } catch (err) {
      toastError(err.message);
    }
  }

  function showUndo(undo) {
    undoExpires = undo.expiresAt || Date.now() + UNDO_MS;
    undoText.textContent = `已删除 ${undo.removed?.length || 1} 条消息 · 5 秒内可撤销`;
    undoBar.hidden = false;
    clearInterval(undoTimer);
    const tick = () => {
      const left = Math.max(0, undoExpires - Date.now());
      if (left <= 0) {
        hideUndo();
        return;
      }
      undoText.textContent = `已删除 ${undo.removed?.length || 1} 条消息 · ${Math.ceil(left / 1000)} 秒内可撤销`;
    };
    tick();
    undoTimer = setInterval(tick, 250);
  }

  function hideUndo() {
    undoBar.hidden = true;
    clearInterval(undoTimer);
    undoTimer = 0;
  }

  // ---------------- 发送 ----------------
  function autoGrow() {
    ta.style.height = 'auto';
    const line = 24;
    const max = line * 6;
    const next = clamp(ta.scrollHeight, line, max + 20);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > max + 20 ? 'auto' : 'hidden';
  }

  function updateMeter() {
    const used = messages.reduce((n, m) => n + (Number(m.tokenEstimate) || 0), 0) + estimateTokens(ta.value);
    const cw = Number(settings?.sampler?.context_window) || 8192;
    tokenMeter.textContent = `≈ ${tokenLabel(used)} / ${tokenLabel(cw)}`;
    tokenMeter.classList.toggle('is-warn', used > cw * 0.8);
  }

  async function doSend() {
    const raw = ta.value.trim();
    if (!raw) return;
    if (state === 'streaming') return;
    if (raw.startsWith('/')) {
      await runCommand(raw);
      return;
    }
    ta.value = '';
    autoGrow();
    updateMeter();
    stick = true;
    sound?.unlock?.().then((ok) => ok && sound.send());
    haptic(8);
    const pending = engine.send(raw);
    pending.catch((err) => {
      toastError(err.message, {
        action: !settings?.connection?.endpoint ? '去设置' : '',
        onAction: () => ctx.onOpenSettings?.(),
        duration: 4500,
      });
      if (!ta.value) {
        ta.value = raw;
        autoGrow();
        updateMeter();
      }
    });
  }

  async function runCommand(raw) {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const arg = raw.slice(cmd.length + 1).trim();
    if (!cmd) return;
    const lower = cmd.toLowerCase();
    if (lower === 'roll') {
      const expr = rest.join(' ').trim() || '1d20';
      ta.value = '';
      autoGrow();
      if (ctx.openDice) {
        ctx.openDice(expr, (result) => {
          engine.addSystemMessage(formatRoll(result)).catch(() => {});
          messages = engine.getMessages();
          list.setMessages(messages, { atBottom: true });
          updateMeter();
        });
      } else {
        toast('骰子面板还没准备好', { type: 'error' });
      }
      return;
    }
    if (lower === 'reset') {
      ta.value = '';
      autoGrow();
      const ok = await confirmDialog({ title: '重新开始这一局？', message: '当前聊天记录会清空，角色卡与设置不受影响。', confirmText: '重新开始', danger: true });
      if (!ok) return;
      await engine.reset();
      toast('酒馆重新开张', { type: 'success' });
      return;
    }
    if (lower === 'sys') {
      if (!arg) return toastError('用法：/sys 追加一段临时系统提示');
      ta.value = '';
      autoGrow();
      try {
        await engine.send('（继续）', { extraSystem: arg });
        toast('已追加临时系统提示', { type: 'success' });
      } catch (err) {
        toastError(err.message);
      }
      return;
    }
    if (lower === 'impersonate') {
      ta.value = '';
      autoGrow();
      try {
        toast('正在替你想一句…');
        const text = await engine.impersonate();
        ta.value = text;
        autoGrow();
        updateMeter();
        ta.focus();
        toast('已代写，可修改后发送', { type: 'success' });
      } catch (err) {
        toastError(err.message);
      }
      return;
    }
    if (lower === 'help') {
      ta.value = '';
      autoGrow();
      showHelp();
      return;
    }
    toast(`未知指令 /${cmd}，试试 /help`, { type: 'warn' });
  }

  function showHelp() {
    openOverlay({
      title: '酒馆指令',
      content: h(
        'div',
        { class: 'command-list' },
        ...[
          ['/roll 2d6+3', '掷骰；省略骰式默认 1d20，d100 掷出 100 会撒花'],
          ['/reset', '清空当前聊天，保留角色卡与设置'],
          ['/sys 保持沉默', '给下一轮追加临时系统提示'],
          ['/impersonate', '让模型替你写一句，放进输入框'],
          ['/help', '看这份清单'],
        ].map(([cmd, desc]) => h('div', { class: 'command-row' }, h('code', {}, cmd), h('span', {}, desc))),
      ),
      actions: [{ label: '知道了', kind: 'primary' }],
    });
  }

  async function showCommands() {
    const action = await actionSheet({
      title: '指令与工具',
      items: [
        { key: 'roll', label: '掷骰', icon: 'dice', description: '/roll 2d6+3' },
        { key: 'reset', label: '重新开始', icon: 'refresh', danger: true },
        { key: 'sys', label: '临时系统提示', icon: 'terminal', description: '/sys 追加一段设定' },
        { key: 'impersonate', label: '角色代写', icon: 'edit' },
        { key: 'preview', label: '组装预览', icon: 'code' },
        { key: 'help', label: '指令说明', icon: 'info' },
      ],
    });
    if (!action) return;
    if (action === 'roll') ta.value = '/roll 1d20';
    if (action === 'reset') ta.value = '/reset';
    if (action === 'sys') ta.value = '/sys ';
    if (action === 'impersonate') ta.value = '/impersonate';
    if (action === 'help') return showHelp();
    if (action === 'preview') return openPreview();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // ---------------- 快捷栏 ----------------
  function quickItems() {
    const items = [];
    items.push({ id: 'dice', label: '掷骰', iconName: 'dice', onTap: () => ctx.openDice?.('1d20') });
    for (const qr of settings?.quickReplies || []) {
      items.push({
        id: qr.id,
        label: qr.label,
        onTap: () => {
          ta.value = qr.text;
          autoGrow();
          updateMeter();
          ta.focus();
        },
      });
    }
    for (const qr of loader?.getQuickReplies?.() || []) {
      items.push({
        id: `plugin-${qr.pluginId}-${qr.label}`,
        label: qr.label,
        plugin: true,
        onTap: async () => {
          try {
            await qr.onTap?.();
          } catch (err) {
            toastError(`插件快捷回复出错：${err.message}`);
          }
        },
      });
    }
    return items;
  }

  function refreshQuickbar() {
    const items = quickItems();
    clear(quickbar);
    const max = 4;
    for (const item of items.slice(0, max)) {
      quickbar.appendChild(
        h('button', {
          class: 'quick-btn',
          type: 'button',
          disabled: state === 'streaming',
          onclick: () => {
            if (state === 'streaming') return;
            item.onTap?.();
          },
        }, item.iconName ? icon(item.iconName, { size: 16 }) : null, item.label),
      );
    }
    if (items.length > max) {
      quickbar.appendChild(
        h('button', {
          class: 'quick-btn quick-btn--more',
          type: 'button',
          'aria-label': '更多快捷回复',
          onclick: async () => {
            const key = await actionSheet({
              title: '快捷回复',
              items: items.slice(max).map((it) => ({ key: it.id, label: it.label, icon: it.iconName || 'chat' })),
            });
            const found = items.find((it) => it.id === key);
            found?.onTap?.();
          },
        }, icon('more', { size: 18 }), '更多'),
      );
    }
    quickbar.classList.toggle('is-locked', state === 'streaming');
  }

  // ---------------- 组装预览 ----------------
  function previewSection(section) {
    const budget = Number(section.budget) || 0;
    const tokens = Number(section.tokens) || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((tokens / budget) * 100)) : tokens > 0 ? 100 : 0;
    return h(
      'div',
      { class: `preview-section ${section.truncated ? 'is-clipped' : ''}`.trim() },
      h(
        'div',
        { class: 'preview-section__head' },
        h('strong', {}, section.label),
        h('span', { class: 'preview-section__count' }, `${tokens}${budget ? ` / ${budget}` : ''} tok${section.count != null ? ` · ${section.count} 条` : ''}`),
        section.truncated ? h('span', { class: 'mini-tag mini-tag--danger' }, '已裁剪') : null,
      ),
      h('div', { class: 'preview-bar' }, h('span', { class: 'preview-bar__fill', style: { width: `${pct}%` } })),
      section.text ? h('pre', { class: 'preview-text' }, section.text) : h('p', { class: 'muted small' }, '（空）'),
    );
  }

  async function openPreview() {
    const content = h('div', { class: 'preview-body' }, h('p', { class: 'muted' }, '正在组装…'));
    let overlay;
    const redraw = async () => {
      clear(content);
      try {
        const result = await engine.buildPreview({ userInput: ta.value.trim() });
        const tr = result.trace;
        const total = tr.totalTokens;
        const available = tr.budget?.available || tr.available;
        content.appendChild(
          h(
            'div',
            { class: 'preview-summary' },
            h('div', { class: 'preview-stat' }, h('span', {}, '总占用'), h('strong', {}, `${total} tok`)),
            h('div', { class: 'preview-stat' }, h('span', {}, '可用预算'), h('strong', {}, `${available} tok`)),
            h('div', { class: 'preview-stat' }, h('span', {}, '剩给输出'), h('strong', {}, `${tr.reserveOutput || 0} tok`)),
            h('div', { class: `preview-stat ${tr.overBudget ? 'is-danger' : ''}` }, h('span', {}, '状态'), h('strong', {}, tr.overBudget ? '超预算' : '正常')),
          ),
        );
        content.appendChild(h('h3', { class: 'preview-h' }, '分区预算'));
        for (const section of tr.sections || []) content.appendChild(previewSection(section));
        if ((tr.mounts || []).length) {
          const includedMounts = (tr.mounts || []).filter((m) => m.included);
          content.appendChild(h('h3', { class: 'preview-h' }, `世界书挂载 · ${includedMounts.length}`));
          for (const mount of tr.mounts) {
            content.appendChild(
              h(
                'div',
                { class: `preview-world ${mount.included ? 'is-in' : 'is-out'}` },
                h(
                  'div',
                  { class: 'preview-world__head' },
                  h('strong', {}, mount.name || '未命名世界书'),
                  h('span', { class: 'mini-tag mini-tag--amber' }, mount.levelLabel || mount.level || ''),
                  mount.included ? h('span', { class: 'mini-tag mini-tag--on' }, '已挂载') : h('span', { class: 'mini-tag mini-tag--danger' }, '未挂载'),
                  h('span', { class: 'muted small' }, mount.reason || ''),
                ),
              ),
            );
          }
        }
        if ((tr.keyConflicts || []).length) {
          content.appendChild(h('h3', { class: 'preview-h' }, `同 key 冲突 · ${tr.keyConflicts.length}`));
          for (const conflict of tr.keyConflicts) {
            content.appendChild(
              h(
                'p',
                { class: 'field-help' },
                h('strong', {}, `「${conflict.key}」`),
                `：${conflict.entries.map((e) => `${e.world}#${e.uid}（order ${e.order}）`).join(' vs ')}；生效：${conflict.winner?.world || ''}`,
              ),
            );
          }
        }
        content.appendChild(
          h(
            'div',
            { class: 'preview-actions' },
            h('button', {
              class: 'btn btn--ghost btn--small',
              type: 'button',
              onclick: async () => {
                await copyText(JSON.stringify({ trace: tr, messages: result.messages }, null, 2));
                toast('trace 已复制', { type: 'success' });
              },
            }, icon('copy', { size: 16 }), '复制 trace JSON'),
          ),
        );
        content.appendChild(h('h3', { class: 'preview-h' }, `世界书命中 · ${(tr.worldMatches || []).length}`));
        if (!(tr.worldMatches || []).length) {
          content.appendChild(h('p', { class: 'muted small' }, '本轮没有世界书条目命中。'));
        } else {
          for (const m of tr.worldMatches) {
            content.appendChild(
              h(
                'div',
                { class: `preview-world ${m.included ? 'is-in' : 'is-out'} ${m.conflict ? 'is-conflict' : ''}`.trim() },
                h('div', { class: 'preview-world__head' }, h('strong', {}, m.comment || m.keys?.join(', ') || '无标题'), h('span', { class: 'mini-tag' }, m.world || ''), m.mountLabel ? h('span', { class: 'mini-tag mini-tag--amber' }, m.mountLabel) : null, m.constant ? h('span', { class: 'mini-tag mini-tag--amber' }, '常驻') : h('span', { class: 'mini-tag' }, m.position === 'after' ? '后置' : '前置'), h('span', { class: 'mini-tag' }, `${m.tokens || 0} tok`), m.conflict ? h('span', { class: 'mini-tag mini-tag--danger' }, '同 key 冲突') : null, m.included ? h('span', { class: 'mini-tag mini-tag--on' }, '已注入') : h('span', { class: 'mini-tag mini-tag--danger' }, m.reason || '未注入')),
                h('p', { class: 'preview-world__keys' }, (m.keys || []).join(' · ')),
                h('p', { class: 'preview-world__text' }, truncate(m.content || '', 260)),
              ),
            );
          }
        }
        if ((tr.dropped || []).length) {
          content.appendChild(h('h3', { class: 'preview-h' }, `丢弃记录 · ${tr.dropped.length}`));
          content.appendChild(h('div', { class: 'preview-dropped' }, ...tr.dropped.slice(0, 20).map((d) => h('div', { class: 'preview-drop' }, h('span', {}, d.role), h('span', {}, d.reason), h('span', {}, truncate(d.preview, 40))))));
        }
        content.appendChild(h('h3', { class: 'preview-h' }, `最终消息 · ${result.messages.length} 条`));
        for (const m of result.messages) {
          content.appendChild(
            h(
              'details',
              { class: 'preview-msg' },
              h('summary', {}, h('span', { class: `preview-role preview-role--${m.role}` }, m.role), h('span', { class: 'muted small' }, `≈${estimateTokens(m.content)} tok`)),
              h('pre', {}, m.content),
            ),
          );
        }
        content.appendChild(h('p', { class: 'preview-eos' }, '… [EOS]'));
      } catch (err) {
        content.appendChild(h('p', { class: 'field-help' }, `组装失败：${err.message}`));
      }
    };
    overlay = openOverlay({
      title: '组装预览',
      content,
      variant: 'full',
      className: 'overlay__panel--preview',
      actions: [
        { label: '刷新', kind: 'ghost', icon: 'refresh', keepOpen: true, onClick: redraw },
        { label: '关闭', kind: 'primary' },
      ],
    });
    previewOverlay = overlay;
    await redraw();
  }

  // ---------------- 生命周期 ----------------
  const offs = [
    engine.on('messageAdded', ({ message }) => {
      if (!message) return;
      if (!messages.some((m) => m.id === message.id)) {
        messages.push(message);
        list.addMessage(message);
        updateMeter();
        refreshHeaderDecoration();
      }
    }),
    engine.on('messageUpdated', ({ message }) => {
      if (!message) return;
      const i = messages.findIndex((m) => m.id === message.id);
      if (i >= 0) messages[i] = message;
      list.refreshMessage(message);
      updateMeter();
      refreshHeaderDecoration();
    }),
    engine.on('messagesReplaced', ({ messages: next }) => {
      messages = (next || []).map(cloneMessage);
      list.setMessages(messages, { atBottom: true });
      updateMeter();
      refreshHeaderDecoration();
    }),
    engine.on('stream', ({ messageId, text }) => {
      list.patchStream(messageId, text);
      stick = list.isNearBottom();
      updateMeter();
    }),
    engine.on('state', (payload) => {
      setState(payload);
      stick = list.isNearBottom();
      updateMeter();
    }),
    engine.on('title', ({ title }) => {
      chatInfo = { ...chatInfo, title };
      updateHeader();
    }),
    engine.on('card', (next) => {
      card = next;
      updateHeader();
    }),
    engine.on('members', ({ members: next }) => {
      members = (next || []).map((m) => ({ ...m }));
      chatInfo = { ...chatInfo, kind: members.length > 1 ? 'group' : chatInfo.kind, memberIds: members.map((m) => m.id) };
      syncRoomBadge();
      list.setMessages(messages, { atBottom: false });
      refreshHeaderDecoration();
    }),
    engine.on('error', ({ error }) => {
      toastError(String(error?.message || '生成失败'), { action: '去设置', onAction: () => ctx.onOpenSettings?.(), duration: 5000 });
      sound?.error();
      haptic(120);
    }),
    engine.on('notice', (payload) => {
      const type = payload?.level === 'error' ? 'error' : payload?.level === 'warn' ? 'warn' : 'info';
      if (type === 'error') toastError(payload.message);
      else toast(payload.message, { type });
    }),
    engine.on('undoChanged', (payload) => {
      if (payload?.available && payload.expiresAt) {
        if (payload.expiresAt > Date.now()) {
          showUndo({ expiresAt: payload.expiresAt, removed: new Array(payload.removed || 1) });
        }
      } else {
        hideUndo();
      }
    }),
    engine.on('restored', () => {
      hideUndo();
      messages = engine.getMessages().map(cloneMessage);
      list.setMessages(messages, { atBottom: true });
    }),
  ];

  const onBus = [
    bus?.on?.('chat:messageReceived', () => {
      sound?.receive();
      haptic(8);
      if (stick) list.scrollToBottom(true);
    }),
    bus?.on?.('plugins:changed', () => refreshQuickbar()),
    bus?.on?.('settings:changed', () => {
      settings = repo.settings;
      refreshQuickbar();
      refreshStatus();
    }),
  ];

  const onScroll = () => {
    stick = list.isNearBottom();
    scrollDownBtn.hidden = stick || messages.length < 3;
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  ta.addEventListener('input', () => {
    autoGrow();
    updateMeter();
  });
  ta.addEventListener('focus', () => {
    setTimeout(() => list.scrollToBottom(false), 280);
  });
  ta.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !window.matchMedia?.('(pointer: coarse)').matches) {
      event.preventDefault();
      doSend();
    }
  });
  sendBtn.addEventListener('click', () => {
    if (state === 'streaming') {
      engine.stop();
    } else {
      doSend();
    }
  });

  const onViewport = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
    if (document.activeElement === ta) setTimeout(() => list.scrollToBottom(false), 60);
  };
  window.visualViewport?.addEventListener('resize', onViewport);
  window.visualViewport?.addEventListener('scroll', onViewport);

  const onVisibility = async () => {
    if (document.visibilityState !== 'visible') return;
    if (state === 'paused' || state === 'error') {
      const resumed = await engine.resumeIfInterrupted().catch(() => false);
      if (resumed) toast('连接恢复了，接着写…', { type: 'info' });
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // 初次渲染
  refreshStatus();
  refreshQuickbar();
  updateHeader();
  list.setMessages(messages, { atBottom: true });
  requestAnimationFrame(() => {
    list.scrollToBottom(false);
    autoGrow();
    updateMeter();
  });
  // 初次打开时，若上次被中断，给一个恢复机会。
  setTimeout(() => {
    engine.resumeIfInterrupted().catch(() => {});
  }, 800);

  return {
    scrollToMessage(id) {
      return list.scrollToMessage(String(id || ''));
    },
    unmount() {
      disposed = true;
      for (const off of offs) off?.();
      for (const off of onBus) off?.();
      clearInterval(undoTimer);
      scroller.removeEventListener('scroll', onScroll);
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('scroll', onViewport);
      document.removeEventListener('visibilitychange', onVisibility);
      clear(root);
      root.remove();
    },
  };
}
