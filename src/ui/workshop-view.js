// workshop-view — 创意工坊：瀑布流浏览、试穿、导入、安装更新。
import { h, clear, qs, debounce, formatTime } from './dom.js';
import { icon, iconButton } from './icons.js';
import { openOverlay, confirmDialog, actionSheet } from './overlay.js';
import { toast, toastError } from './toast.js';
import { listWorkshop, getWorkshopItem, importWorkshopItem, installedStatus } from '../workshop/registry.js';
import { createTrialSandbox } from '../workshop/trial-sandbox.js';
import { packForItem } from '../workshop/registry.js';

const TYPE_LABEL = { card: '角色卡', world: '世界书', bundle: '套装' };
const TYPE_ICON = { card: 'cards', world: 'book', bundle: 'archive' };
const SORTS = [
  { id: 'new', label: '最新' },
  { id: 'hot', label: '下载最多' },
  { id: 'rating', label: '评分' },
];

function cover(item) {
  return item.cover || (item.type === 'world' ? 'icons/logo.svg' : 'icons/logo.svg');
}

function stars(rating) {
  return '★★★★★'.slice(0, Math.round(rating || 0)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(rating || 0));
}

function installLabel(status) {
  if (status === 'update') return '可更新';
  if (status === 'installed') return '已安装';
  return '';
}

export function mount(el, ctx = {}) {
  const state = {
    items: [],
    installed: [],
    loading: true,
    offline: false,
    remoteEnabled: false,
    source: 'local',
    remoteError: '',
    q: '',
    type: '',
    tag: '',
    sort: 'new',
    includeMature: false,
    disposed: false,
  };
  let trial = null;

  function currentSettings() {
    return ctx.repo?.settings || ctx.settings || {};
  }

  async function ensureFullItem(item) {
    if (!item || item.card || item.world) return item;
    try {
      const full = await getWorkshopItem({ repo: ctx.repo, settings: currentSettings(), id: item.id });
      return full ? { ...item, ...full } : item;
    } catch {
      return item;
    }
  }

  const root = h('div', { class: 'view workshop-view' });
  const topbar = h(
    'header',
    { class: 'topbar' },
    iconButton('back', '返回酒馆', () => ctx.onBack?.(), { class: 'icon-btn' }),
    h('div', { class: 'topbar__title-wrap' }, h('h1', { class: 'topbar__title' }, '创意工坊'),
      h('span', { class: 'topbar__sub' }, '别人的酒单，也能端上你的桌')),
    h('div', { class: 'topbar__actions' },
      iconButton('sparkle', 'AI 生成', () => ctx.onOpenGen?.()),
      iconButton('plus', '发布作品', () => ctx.onOpenPublish?.())),
  );

  const search = h('input', {
    class: 'field field--search',
    type: 'search',
    placeholder: '搜角色、世界书、作者或 tag',
    'aria-label': '搜索工坊',
    oninput: debounce((e) => {
      state.q = e.target.value;
      refresh({ quiet: true });
    }, 260),
  });
  const searchWrap = h('div', { class: 'ws-search' }, h('span', { class: 'ws-search__icon' }, icon('search', { size: 18 })), search);

  const typeTabs = h('div', { class: 'ws-tabs', role: 'tablist' });
  const tagBar = h('div', { class: 'tag-bar ws-tags' });
  const sortBar = h('div', { class: 'ws-sort' });
  const statusLine = h('div', { class: 'ws-status', role: 'status' });
  const banner = h('div', { class: 'ws-banner', hidden: true });
  const grid = h('div', { class: 'ws-grid' });
  const empty = h('div', { class: 'ws-empty', hidden: true });
  const pull = h('div', { class: 'ws-pull', 'aria-hidden': 'true' }, h('span', { class: 'ws-pull__text' }, '下拉刷新'));
  const scroll = h('main', { class: 'ws-scroll' }, pull, searchWrap, banner, statusLine, typeTabs, tagBar, sortBar, grid, empty);
  root.append(topbar, scroll);
  el.append(root);

  const unsubs = [];
  const unsubSettings = ctx.bus?.on?.('settings:changed', () => refresh({ quiet: true }));
  if (typeof unsubSettings === 'function') unsubs.push(unsubSettings);
  const unsubWorkshop = ctx.bus?.on?.('workshop:changed', (item) => {
    if (item) {
      // 刚上架的作品要能在第一屏看到：清掉搜索/类型/tag 过滤
      state.q = '';
      search.value = '';
      state.type = '';
      state.tag = '';
      typeTabsRender();
      tagsRender();
    }
    refresh({ quiet: true });
  });
  if (typeof unsubWorkshop === 'function') unsubs.push(unsubWorkshop);

  function typeTabsRender() {
    clear(typeTabs);
    const options = [
      { id: '', label: '全部' },
      { id: 'card', label: '角色卡' },
      { id: 'world', label: '世界书' },
      { id: 'bundle', label: '套装' },
    ];
    options.forEach((opt) => {
      typeTabs.append(
        h('button', {
          class: `ws-tab ${state.type === opt.id ? 'is-on' : ''}`,
          type: 'button',
          'aria-pressed': String(state.type === opt.id),
          onclick: () => {
            state.type = opt.id;
            state.tag = '';
            refresh();
          },
        }, opt.label),
      );
    });
  }

  function tagsRender() {
    clear(tagBar);
    const tags = [...new Set(state.items.flatMap((item) => item.tags || []))].slice(0, 8);
    if (state.tag && !tags.includes(state.tag)) tags.unshift(state.tag);
    if (!tags.length) return;
    tagBar.append(
      h('button', {
        class: `tag-chip ${state.tag ? '' : 'is-on'}`,
        type: 'button',
        onclick: () => {
          state.tag = '';
          refresh();
        },
      }, '全部'),
    );
    tags.forEach((tag) => {
      tagBar.append(
        h('button', {
          class: `tag-chip ${state.tag === tag ? 'is-on' : ''}`,
          type: 'button',
          onclick: () => {
            state.tag = state.tag === tag ? '' : tag;
            refresh();
          },
        }, tag),
      );
    });
  }

  function sortRender() {
    clear(sortBar);
    const label = h('span', { class: 'ws-sort__label' }, '排序');
    const group = h('div', { class: 'ws-sort__group' });
    SORTS.forEach((s) => {
      group.append(
        h('button', {
          class: `ws-sort__btn ${state.sort === s.id ? 'is-on' : ''}`,
          type: 'button',
          onclick: () => {
            state.sort = s.id;
            refresh();
          },
        }, s.label),
      );
    });
    const mature = h('button', {
      class: `ws-mature ${state.includeMature ? 'is-on' : ''}`,
      type: 'button',
      'aria-pressed': String(state.includeMature),
      onclick: () => {
        state.includeMature = !state.includeMature;
        refresh({ quiet: true });
      },
    }, state.includeMature ? '18+ 显示' : '18+ 隐藏');
    sortBar.append(label, group, mature);
  }

  function cardNode(item) {
    const status = installedStatus(state.installed, item);
    const trialBtn = h('button', {
      class: 'ws-try',
      type: 'button',
      'aria-label': `试穿 ${item.title}`,
      onclick: (e) => {
        e.stopPropagation();
        openTrial(item);
      },
    }, icon('play', { size: 16 }), '试穿');
    const coverEl = h('div', { class: 'ws-card__cover' },
      h('img', { src: cover(item), alt: '', loading: 'lazy' }),
      h('span', { class: `ws-badge ws-badge--${item.contentRating}` }, item.contentRating === 'mature' ? '18+' : '全年龄'),
      h('span', { class: 'ws-badge ws-badge--type' }, TYPE_LABEL[item.type] || '作品'));
    return h('article', {
      class: 'ws-card',
      tabindex: '0',
      role: 'button',
      'aria-label': `${item.title}，${item.author}`,
      onclick: () => openDetail(item),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(item);
        }
      },
    },
      coverEl,
      h('div', { class: 'ws-card__body' },
        h('h3', { class: 'ws-card__title' }, item.title),
        h('p', { class: 'ws-card__author' }, item.author || '匿名酒客'),
        h('div', { class: 'ws-card__meta' },
          h('span', { class: 'ws-card__rating', title: `${item.rating || 0} 分` }, stars(item.rating), h('b', {}, String(item.rating || 0))),
          h('span', { class: 'ws-card__dl' }, icon('download', { size: 13 }), String(item.downloads || 0))),
        h('div', { class: 'ws-card__tags' }, ...(item.tags || []).slice(0, 3).map((tag) => h('span', { class: 'ws-chip' }, tag))),
        status ? h('span', { class: `ws-installed ${status === 'update' ? 'is-update' : ''}` }, installLabel(status)) : null,
        trialBtn,
      ),
    );
  }

  function renderGrid() {
    clear(grid);
    if (!state.items.length) {
      empty.hidden = false;
      empty.innerHTML = '';
      empty.append(
        h('div', { class: 'ws-empty__mark' }, icon('archive', { size: 34 })),
        h('h2', {}, state.q ? '没搜到这件藏品' : '工坊还没开张'),
        h('p', {}, state.offline ? '远程工坊暂时连不上，缓存里也没有可看的东西。' : '换个关键词，或点右上角自己捏一张角色卡。'),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => ctx.onOpenGen?.() }, icon('sparkle', { size: 16 }), 'AI 生成一张'),
      );
      return;
    }
    empty.hidden = true;
    state.items.forEach((item) => grid.append(cardNode(item)));
  }

  function renderStatus() {
    clear(statusLine);
    const count = state.items.length;
    statusLine.append(h('span', {}, `${count} 件作品`));
    if (state.remoteEnabled) {
      statusLine.append(h('span', { class: 'ws-status__dot' }), h('span', {}, state.offline ? '远程源离线 · 显示缓存' : '远程工坊在线'));
    } else {
      statusLine.append(h('span', { class: 'ws-status__dot' }), h('span', {}, '本地 + 内置演示源'));
    }
    if (state.source === 'local') statusLine.append(h('span', { class: 'ws-status__hint' }, '可在设置里填自托管端点'));
  }

  function renderBanner() {
    if (!state.offline || !state.remoteEnabled) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    clear(banner);
    banner.append(
      h('span', { class: 'ws-banner__icon' }, icon('wifiOff', { size: 16 })),
      h('span', {}, `远程源连不上${state.remoteError ? `：${state.remoteError}` : ''}，先看缓存。`),
    );
  }

  async function refresh({ quiet = false } = {}) {
    if (state.disposed) return;
    if (!quiet) {
      state.loading = true;
      clear(statusLine);
      statusLine.append(h('span', {}, '正在擦杯子…'));
    }
    try {
      const result = await listWorkshop({
        repo: ctx.repo,
        settings: currentSettings(),
        type: state.type,
        q: state.q,
        sort: state.sort,
        includeMature: state.includeMature,
      });
      if (state.disposed) return;
      state.items = result.items;
      state.installed = result.installed || [];
      state.offline = result.offline;
      state.remoteEnabled = result.remoteEnabled;
      state.source = result.source;
      state.remoteError = result.remoteError;
      typeTabsRender();
      tagsRender();
      sortRender();
      renderBanner();
      renderStatus();
      renderGrid();
      if (!quiet && result.offline) toast('远程工坊连不上，先看缓存', { type: 'warn' });
    } catch (err) {
      if (state.disposed) return;
      state.items = [];
      renderStatus();
      renderGrid();
      toastError(`工坊没开成：${err?.message || err}`);
    } finally {
      state.loading = false;
      pull.classList.remove('is-refreshing');
      pull.style.transform = '';
    }
  }

  function makeTrialMessages() {
    const wrap = h('div', { class: 'ws-trial' });
    const head = h('div', { class: 'ws-trial__head' });
    const messages = h('div', { class: 'ws-trial__messages' });
    const hint = h('p', { class: 'ws-trial__hint' });
    const input = h('textarea', {
      class: 'field field--area ws-trial__input',
      rows: '2',
      placeholder: '说点什么，试聊不计入卡库…',
      'aria-label': '试聊输入',
    });
    const sendBtn = h('button', { class: 'btn btn--primary ws-trial__send', type: 'button' }, icon('send', { size: 16 }), '发送');
    const footer = h('div', { class: 'ws-trial__actions' });
    wrap.append(head, messages, hint, h('div', { class: 'ws-trial__composer' }, input, sendBtn), footer);
    return { wrap, head, messages, hint, input, sendBtn, footer };
  }

  async function openTrial(rawItem) {
    const item = await ensureFullItem(rawItem);
    if (state.disposed) return;
    if (item.type === 'world') {
      toast('世界书没有角色，先导入再用任意角色开聊', { type: 'info' });
      openDetail(item);
      return;
    }
    if (!item.card) {
      toastError('这件作品没有角色卡内容');
      return;
    }
    if (trial) {
      trial.destroy();
      trial = null;
    }
    const parts = makeTrialMessages();
    let overlay = null;
    const sandbox = createTrialSandbox({
      repo: ctx.repo,
      settings: currentSettings(),
      card: item.card,
      world: item.type === 'bundle' ? item.world : null,
      title: `与${item.card.name || item.title}的试聊`,
      onConflict: async ({ name }) => {
        const choice = await actionSheet({
          title: `已存在同名世界书《${name}》`,
          subtitle: '内容不同。要复用旧的，还是把这次试穿并存为带编号的新书？',
          items: [
            { key: 'reuse', label: '复用旧的', hint: '不新建世界书，试穿会话挂到已有书上' },
            { key: 'rename', label: `并存为《${name}(2)》`, hint: '保留两份，方便比较' },
          ],
        });
        return choice === 'rename' ? 'rename' : 'reuse';
      },
    });
    trial = sandbox;
    let sending = false;
    let closedByUser = false;

    function closeTrial({ discard = false } = {}) {
      if (closedByUser) return;
      closedByUser = true;
      if (discard) sandbox.discard();
      sandbox.destroy();
      if (trial === sandbox) trial = null;
      overlay?.close();
    }

    function render() {
      const snap = sandbox.snapshot();
      clear(parts.head);
      parts.head.append(
        h('img', { class: 'ws-trial__avatar', src: cover(item), alt: '' }),
        h('div', {}, h('strong', {}, snap.card.name), h('span', {}, `${item.title} · 试穿沙盒`)),
      );
      clear(parts.messages);
      snap.messages.forEach((msg) => {
        parts.messages.append(
          h('div', { class: `ws-trial__msg ws-trial__msg--${msg.sender}` },
            h('div', { class: 'ws-trial__bubble' }, msg.text || (msg.sender === 'char' ? '…' : '')),
          ),
        );
      });
      if (!snap.messages.length) parts.messages.append(h('p', { class: 'ws-trial__empty' }, '正在铺桌布…'));
      parts.messages.scrollTop = parts.messages.scrollHeight;
      parts.hint.textContent = snap.error
        ? snap.error
        : snap.state === 'streaming'
          ? '正在写下一句…'
          : `已试聊 ${snap.count} 条 · ${snap.canPromote ? '满意就转正，正式开一局' : '至少 3 条后才能转正'}`;
      parts.hint.classList.toggle('is-error', Boolean(snap.error));
      parts.sendBtn.disabled = snap.state === 'streaming' || sending;
      parts.input.disabled = snap.state === 'streaming' || snap.state === 'promoted';
      clear(parts.footer);
      const discardBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, '丢弃，零残留');
      discardBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '丢弃这次试穿？',
          message: '卡片、世界书和聊天都不会写入。这个动作没有撤销。',
          confirmText: '丢弃',
          danger: true,
        });
        if (ok) closeTrial({ discard: true });
      });
      const promoteBtn = h('button', {
        class: 'btn btn--primary',
        type: 'button',
        disabled: !snap.canPromote,
      }, icon('check', { size: 16 }), '转正并开聊');
      promoteBtn.addEventListener('click', async () => {
        if (!snap.canPromote) return;
        promoteBtn.disabled = true;
        promoteBtn.textContent = '正在落座…';
        try {
          const result = await sandbox.promote();
          closedByUser = true;
          if (trial === sandbox) trial = null;
          sandbox.destroy();
          overlay?.close();
          ctx.onTrialPromoted?.(result.chat.id, result.card.id, item);
        } catch (err) {
          toastError(`转正失败：${err?.message || err}`);
          promoteBtn.disabled = false;
          promoteBtn.textContent = '转正并开聊';
        }
      });
      parts.footer.append(discardBtn, promoteBtn);
    }

    overlay = openOverlay({
      title: '试穿间',
      subtitle: '不写卡库 · 不写会话 · 丢掉就干净',
      className: 'ws-trial-overlay',
      content: parts.wrap,
      dismissible: true,
      onClose: () => {
        if (!closedByUser) closeTrial({ discard: true });
      },
    });

    const send = async () => {
      const text = parts.input.value.trim();
      if (!text || sending) return;
      sending = true;
      parts.input.value = '';
      try {
        await sandbox.send(text);
      } catch (err) {
        if (err?.name !== 'AbortError') toastError(`这句没送出去：${err?.message || err}`);
      } finally {
        sending = false;
        render();
      }
    };
    parts.sendBtn.addEventListener('click', send);
    parts.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
    const unsub = sandbox.subscribe(render);
    render();
    sandbox.start().catch(() => {});
    const oldClose = overlay.close;
    overlay.close = () => {
      unsub();
      oldClose();
    };
  }

  async function openDetail(rawItem) {
    const item = await ensureFullItem(rawItem);
    if (state.disposed) return;
    const status = installedStatus(state.installed, item);
    const body = h('div', { class: 'ws-detail' });
    body.append(
      h('div', { class: 'ws-detail__top' },
        h('img', { class: 'ws-detail__cover', src: cover(item), alt: '' }),
        h('div', { class: 'ws-detail__head' },
          h('div', { class: 'ws-detail__badges' },
            h('span', { class: `ws-badge ws-badge--${item.contentRating}` }, item.contentRating === 'mature' ? '18+' : '全年龄'),
            h('span', { class: 'ws-badge ws-badge--type' }, TYPE_LABEL[item.type] || '作品'),
            status ? h('span', { class: 'ws-installed' }, installLabel(status)) : null),
          h('h2', { class: 'ws-detail__title' }, item.title),
          h('p', { class: 'ws-detail__author' }, `作者 ${item.author || '匿名酒客'} · v${item.version || '1.0.0'}`),
          h('div', { class: 'ws-detail__stats' },
            h('span', {}, stars(item.rating), ` ${item.rating || 0}`),
            h('span', {}, icon('download', { size: 14 }), ` ${item.downloads || 0}`),
            h('span', {}, formatTime(item.publishedAt))),
        ),
      ),
      h('p', { class: 'ws-detail__desc' }, item.description || '作者没有写简介。'),
      h('div', { class: 'ws-detail__tags' }, ...(item.tags || []).map((tag) => h('span', { class: 'ws-chip' }, tag))),
      h('div', { class: 'ws-detail__section' },
        h('h3', {}, '包含什么'),
        h('ul', { class: 'ws-detail__list' },
          item.card ? h('li', {}, `角色卡「${item.card.name}」`) : null,
          item.world ? h('li', {}, `世界书「${item.world.name || '未命名'}」 · ${(item.world.entries || []).length} 条`) : null,
          h('li', {}, `.ptpack v${item.version || '1.0.0'} · ${item.contentRating === 'mature' ? '成人向' : '全年龄'}`))),
      item.changelog ? h('div', { class: 'ws-detail__section' }, h('h3', {}, '更新日志'), h('p', {}, item.changelog)) : null,
      h('div', { class: 'ws-detail__note' }, icon('lock', { size: 14 }), '试穿只进临时沙盒；点转正才会写入你的卡库。'),
    );
    const actions = h('div', { class: 'ws-detail__actions' });
    const trialBtn = h('button', {
      class: 'btn btn--primary ws-detail__try',
      type: 'button',
      disabled: !item.card,
      title: item.card ? '进临时沙盒试聊' : '世界书没有角色，导入后用任意角色开聊',
    }, icon('play', { size: 16 }), item.card ? '试穿 · 开 3 条试聊' : '世界书仅可导入');
    const importBtn = h('button', { class: 'btn btn--ghost', type: 'button' },
      icon('download', { size: 16 }), status === 'update' ? '更新到本地' : '直接导入');
    const packBtn = h('button', { class: 'btn btn--quiet', type: 'button' }, icon('archive', { size: 16 }), '导出 .ptpack');
    actions.append(trialBtn, importBtn, packBtn);
    body.append(actions);

    const overlay = openOverlay({ title: '作品详情', content: body, dismissible: true });
    const doImport = async () => {
      importBtn.disabled = true;
      try {
        const result = await importWorkshopItem({ repo: ctx.repo, item });
        toast(`已导入${result.card ? `角色「${result.card.name}」` : ''}${result.world ? `世界书「${result.world.name}」` : ''}`, { type: 'success' });
        overlay.close();
        await refresh({ quiet: true });
        ctx.onImported?.(result, item);
      } catch (err) {
        toastError(`导入失败：${err?.message || err}`);
        importBtn.disabled = false;
      }
    };
    importBtn.addEventListener('click', doImport);
    trialBtn.addEventListener('click', () => {
      overlay.close();
      openTrial(item);
    });
    packBtn.addEventListener('click', async () => {
      try {
        const pack = packForItem(item);
        const { downloadPack } = await import('../workshop/packer.js');
        downloadPack(pack);
        toast('已导出 .ptpack', { type: 'success' });
      } catch (err) {
        toastError(`打包失败：${err?.message || err}`);
      }
    });
  }

  // 下拉刷新：只在滚动到顶部时接管。
  let touchStartY = 0;
  let pulling = false;
  scroll.addEventListener('touchstart', (e) => {
    if (scroll.scrollTop > 0 || e.touches.length !== 1) return;
    touchStartY = e.touches[0].clientY;
    pulling = false;
  }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (scroll.scrollTop > 0 || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - touchStartY;
    if (dy <= 0) return;
    pulling = true;
    const dist = Math.min(72, dy * 0.55);
    pull.style.transform = `translateY(${dist}px)`;
    pull.classList.toggle('is-visible', dist > 6);
    pull.querySelector('.ws-pull__text').textContent = dist > 48 ? '松手刷新' : '下拉刷新';
  }, { passive: true });
  scroll.addEventListener('touchend', () => {
    if (!pulling) return;
    const y = parseFloat((pull.style.transform.match(/translateY\(([\d.]+)px\)/) || [0, '0'])[1]) || 0;
    pull.classList.remove('is-visible');
    pull.style.transform = '';
    if (y > 40) {
      pull.classList.add('is-refreshing');
      toast('正在刷新工坊…', { type: 'info' });
      refresh();
    }
    pulling = false;
  });

  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.overlay.is-open')) ctx.onBack?.();
  };
  document.addEventListener('keydown', onKey);

  typeTabsRender();
  sortRender();
  refresh();

  return {
    unmount() {
      state.disposed = true;
      unsubs.forEach((fn) => fn?.());
      document.removeEventListener('keydown', onKey);
      trial?.destroy();
      trial = null;
      root.remove();
    },
  };
}
