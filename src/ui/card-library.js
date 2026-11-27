// card-library — 角色卡网格/列表、搜索、tag 过滤、PNG/JSON 导入导出与编辑。
import { h, clear, debounce, truncate, formatTime } from './dom.js';
import { icon, iconButton } from './icons.js';
import { openOverlay, confirmDialog, actionSheet } from './overlay.js';
import { toast, toastError } from './toast.js';
import { openGroupEditor } from './group-view.js';
import {
  parseCardFile,
  exportCardPng,
  exportCardJson,
  downloadBlob,
  safeFilename,
} from '../core/card-codec.js';

function avatarEl(card, size = 56) {
  const img = h('img', { class: `avatar avatar--${size}`, alt: '', src: card?.avatar || 'icons/logo.svg' });
  img.addEventListener('error', () => {
    img.src = 'icons/logo.svg';
  });
  return img;
}

function tagsOf(card) {
  return Array.isArray(card?.tags) ? card.tags.filter(Boolean) : [];
}

function excerpt(card) {
  return truncate(String(card?.description || card?.personality || '还没有写介绍。').replace(/\s+/g, ' '), 96);
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function makeAvatar(file) {
  const raw = await readAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片格式不支持'));
    image.src = raw;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(512 / img.width, 512 / img.height);
  const w = img.width * scale;
  const hgt = img.height * scale;
  ctx.drawImage(img, (512 - w) / 2, (512 - hgt) / 2, w, hgt);
  return canvas.toDataURL('image/webp', 0.88);
}

function field(label, input, helper = '') {
  return h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, label), input, helper ? h('span', { class: 'field-help' }, helper) : null);
}

export function mount(el, ctx) {
  const { repo, settings, onStartChat, onOpenSettings } = ctx;
  const root = h('div', { class: 'view cards-view' });
  el.appendChild(root);
  let disposed = false;
  let cards = [];
  let search = '';
  let activeTag = '全部';
  let view = settings?.ui?.cardView === 'list' ? 'list' : 'grid';

  const listHost = h('main', { class: 'cards-scroll' });
  const fileInput = h('input', { type: 'file', accept: '.png,.json,image/png,application/json', multiple: true, hidden: true });

  async function openGroup() {
    await openGroupEditor({
      repo,
      settings,
      onSave: async (data) => {
        const host = cards.find((c) => c.id === data.memberIds[0]) || cards[0];
        const chat = await repo.createChat(host, {
          ...data,
          kind: 'group',
          messages: host ? [{
            id: `msg-${Date.now()}-g`,
            sender: 'char',
            text: `（酒馆的灯亮起来，${data.memberIds.length} 个人在桌边坐下。）\n\n${host.first_mes || '「人齐了，坐吧。」'}`,
            swipes: [],
            swipeIndex: 0,
            sendDate: new Date().toISOString(),
            tokenEstimate: 0,
            cardId: host.id,
            speaker: host.name,
          }] : [],
        });
        ctx.onGroupCreated?.(chat);
      },
    });
  }

  function header() {
    return h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '返回酒馆', onclick: () => ctx.onBack?.() }, icon('back')),
      h('div', { class: 'topbar__lead' }, h('h1', { class: 'topbar__title' }, '卡库'), h('span', { class: 'topbar__sub' }, `${cards.length} 位角色`)),
      h(
        'div',
        { class: 'topbar__actions' },
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': '搜索',
            onclick: () => {
              searchWrap.hidden = !searchWrap.hidden;
              if (!searchWrap.hidden) searchInput.focus();
            },
          },
          icon('search'),
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': view === 'grid' ? '切换列表' : '切换网格',
            onclick: async () => {
              view = view === 'grid' ? 'list' : 'grid';
              await repo.saveSettings({ ui: { cardView: view } }).catch(() => {});
              draw();
            },
          },
          icon(view === 'grid' ? 'list' : 'grid'),
        ),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '开一桌群聊', onclick: openGroup }, icon('chat')),
        h('button', { class: 'icon-btn icon-btn--accent', type: 'button', 'aria-label': '添加角色卡', onclick: addMenu }, icon('plus')),
      ),
    );
  }

  const searchInput = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: '搜名字、tag 或设定…',
    'aria-label': '搜索角色卡',
    oninput: debounce((event) => {
      search = event.target.value.trim().toLowerCase();
      draw();
    }, 120),
  });
  const searchWrap = h('div', { class: 'search-wrap', hidden: true }, icon('search', { size: 18 }), searchInput);

  function tagsBar() {
    const tags = [...new Set(cards.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, 'zh'));
    if (!tags.length) return null;
    const bar = h('div', { class: 'tag-bar' });
    const all = ['全部', ...tags];
    for (const tag of all) {
      const isActive = activeTag === tag;
      bar.appendChild(
        h(
          'button',
          {
            class: `tag-chip ${isActive ? 'is-active' : ''}`,
            type: 'button',
            onclick: () => {
              activeTag = tag;
              draw();
            },
          },
          tag,
        ),
      );
    }
    return bar;
  }

  function filtered() {
    return cards.filter((card) => {
      if (activeTag !== '全部' && !tagsOf(card).includes(activeTag)) return false;
      if (!search) return true;
      const hay = [card.name, card.creator, card.description, card.personality, card.scenario, ...tagsOf(card)].join(' ').toLowerCase();
      return hay.includes(search);
    });
  }

  function openDetail(card) {
    const detail = h(
      'div',
      { class: 'card-detail' },
      h('div', { class: 'card-detail__top' }, avatarEl(card, 88), h('div', {}, h('h2', { class: 'card-detail__name' }, card.name), h('p', { class: 'card-detail__meta' }, card.creator ? `创作者 ${card.creator}` : '佚名创作者'), h('div', { class: 'tag-row' }, ...tagsOf(card).map((t) => h('span', { class: 'tag' }, t))))),
      h('p', { class: 'card-detail__desc' }, card.description || '还没有写描述。'),
      card.personality ? h('div', { class: 'card-section' }, h('h4', {}, '性格'), h('p', {}, card.personality)) : null,
      card.scenario ? h('div', { class: 'card-section' }, h('h4', {}, '场景'), h('p', {}, card.scenario)) : null,
      card.first_mes ? h('div', { class: 'card-section' }, h('h4', {}, '开场白'), h('p', { class: 'quote-block' }, truncate(card.first_mes, 220))) : null,
      h('p', { class: 'card-detail__stamp' }, `更新于 ${formatTime(card.updatedAt)}`),
    );
    const overlay = openOverlay({
      title: '角色档案',
      content: detail,
      variant: 'sheet',
      className: 'overlay__panel--card',
      actions: [
        {
          label: '编辑',
          kind: 'ghost',
          icon: 'edit',
          onClick: () => {
            overlay.close(null);
            setTimeout(() => openEditor(card), 200);
            return true;
          },
        },
        { label: '导出 PNG', kind: 'ghost', icon: 'download', keepOpen: true, onClick: () => exportPng(card) },
        {
          label: '开始聊天',
          kind: 'primary',
          icon: 'chat',
          onClick: () => {
            setTimeout(() => onStartChat?.(card), 210);
            return true;
          },
        },
      ],
    });
    overlay.body.appendChild(
      h(
        'div',
        { class: 'card-detail__tools' },
        h('button', { class: 'text-btn', type: 'button', onclick: () => exportJson(card) }, icon('file', { size: 16 }), '导出 JSON'),
        h(
          'button',
          {
            class: 'text-btn text-btn--danger',
            type: 'button',
            onclick: async () => {
              overlay.close(null);
              const ok = await confirmDialog({
                title: '删除这张卡？',
                message: `「${card.name}」和它的所有会话都会从这台设备移除。`,
                confirmText: '删除',
                danger: true,
              });
              if (!ok) return;
              try {
                await repo.deleteCard(card.id);
                toast('角色卡已删除');
                await refresh();
              } catch (err) {
                toastError(`删除失败：${err.message}`);
              }
            },
          },
          icon('trash', { size: 16 }),
          '删除',
        ),
      ),
    );
    // 编辑按钮需要等详情层收起后再打开编辑层，已在上面的 action 中处理。
  }

  function openEditor(existing = null) {
    const draft = existing
      ? { ...existing, tags: [...(existing.tags || [])] }
      : {
          name: '',
          description: '',
          personality: '',
          scenario: '',
          first_mes: '',
          mes_example: '',
          creator: settings?.personaName || '',
          tags: [],
          avatar: '',
        };
    const avatar = avatarEl(draft, 72);
    const avatarInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files?.[0];
      if (!file) return;
      try {
        draft.avatar = await makeAvatar(file);
        avatar.src = draft.avatar;
        toast('头像已更新，保存后生效');
      } catch (err) {
        toastError(err.message);
      }
    });
    const fields = {
      name: h('input', { class: 'field', type: 'text', value: draft.name, placeholder: '角色名', maxlength: 60, required: true }),
      creator: h('input', { class: 'field', type: 'text', value: draft.creator || '', placeholder: '创作者（可选）', maxlength: 60 }),
      tags: h('input', { class: 'field', type: 'text', value: (draft.tags || []).join(', '), placeholder: '酒馆, 治愈, 原创' }),
      description: h('textarea', { class: 'field field--area', rows: '5', value: draft.description || '', placeholder: '她是谁？外貌、身份、说话方式…' }),
      personality: h('textarea', { class: 'field field--area', rows: '3', value: draft.personality || '', placeholder: '性格关键词或一段自述' }),
      scenario: h('textarea', { class: 'field field--area', rows: '3', value: draft.scenario || '', placeholder: '你们在什么场景相遇？' }),
      first_mes: h('textarea', { class: 'field field--area', rows: '4', value: draft.first_mes || '', placeholder: '角色说的第一句话' }),
      mes_example: h('textarea', { class: 'field field--area', rows: '4', value: draft.mes_example || '', placeholder: '<START>\n{{user}}: …\n{{char}}: …' }),
    };

    // CCv3 卡内嵌世界书：随卡导出/导入，只有这张卡在场时才激活。
    const bookEntries = (draft.character_book?.entries || []).map((entry) => ({
      ...entry,
      uid: entry.uid || `cb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      key: [...(entry.key || [])],
      keysecondary: [...(entry.keysecondary || [])],
      content: String(entry.content || ''),
    }));
    const bookName = h('input', {
      class: 'field',
      type: 'text',
      value: draft.character_book?.name || `${draft.name || '角色'}的世界书`,
      placeholder: '内嵌世界书名称',
    });
    const bookRows = h('div', { class: 'card-book__rows' });
    const bookCount = h('span', { class: 'muted small' });
    function renderBookRows() {
      clear(bookRows);
      bookCount.textContent = `${bookEntries.length} 条 · 仅此角色在场时生效`;
      bookEntries.forEach((entry, index) => {
        const keys = h('input', { class: 'field', type: 'text', value: (entry.key || []).join(', '), placeholder: '关键词（逗号分隔）' });
        const content = h('textarea', { class: 'field field--area', rows: '2', value: entry.content || '', placeholder: '命中关键词时注入的设定' });
        keys.addEventListener('input', () => { entry.key = keys.value.split(/[,，]/).map((k) => k.trim()).filter(Boolean); });
        content.addEventListener('input', () => { entry.content = content.value; });
        const del = h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `删除第 ${index + 1} 条内嵌条目`,
          onclick: () => { bookEntries.splice(index, 1); renderBookRows(); },
        }, icon('trash', { size: 16 }));
        bookRows.appendChild(h('div', { class: 'card-book__row' }, keys, content, del));
      });
      if (!bookEntries.length) bookRows.appendChild(h('p', { class: 'muted small' }, '还没有条目。内嵌书适合放只属于这个角色的私设。'));
    }
    renderBookRows();
    const addBookEntry = h('button', {
      class: 'btn btn--ghost btn--small',
      type: 'button',
      onclick: () => {
        bookEntries.push({
          uid: `cb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          key: [],
          keysecondary: [],
          comment: '',
          content: '',
          position: 'before',
          order: 100,
          tokenBudget: 0,
          recursive: false,
          selective: false,
          constant: false,
          probability: 100,
          caseSensitive: false,
          useRegex: false,
          enabled: true,
        });
        renderBookRows();
      },
    }, icon('plus', { size: 16 }), '加一条内嵌设定');
    const bookSection = h('details', { class: 'card-book' },
      h('summary', {}, h('span', {}, '卡内嵌世界书'), bookCount),
      h('p', { class: 'muted small' }, '随卡导出为 ccv3；导入后只有这张卡在聊天/群聊里时才参与组装。'),
      h('div', { class: 'field-group' }, h('span', { class: 'field-label' }, '书名'), bookName),
      bookRows,
      addBookEntry,
    );

    const content = h(
      'div',
      { class: 'card-editor' },
      h('div', { class: 'card-editor__avatar' }, avatar, h('button', { class: 'text-btn', type: 'button', onclick: () => avatarInput.click() }, icon('camera', { size: 16 }), '更换头像'), avatarInput),
      field('名字 *', fields.name),
      field('创作者', fields.creator),
      field('标签（用逗号分隔）', fields.tags),
      field('描述', fields.description),
      field('性格', fields.personality),
      field('场景', fields.scenario),
      field('开场白', fields.first_mes),
      field('示例对话', fields.mes_example),
      bookSection,
    );
    const overlay = openOverlay({
      title: existing ? '编辑角色卡' : '新建角色卡',
      content,
      variant: 'full',
      className: 'overlay__panel--editor',
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => false },
        {
          label: '保存',
          kind: 'primary',
          onClick: async () => {
            const name = fields.name.value.trim();
            if (!name) {
              toastError('先给角色起个名字');
              fields.name.focus();
              return false;
            }
            const next = {
              ...draft,
              name,
              creator: fields.creator.value.trim(),
              tags: fields.tags.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
              description: fields.description.value.trim(),
              personality: fields.personality.value.trim(),
              scenario: fields.scenario.value.trim(),
              first_mes: fields.first_mes.value.trim(),
              mes_example: fields.mes_example.value.trim(),
            };
            const cleanEntries = bookEntries
              .map((entry) => ({ ...entry, content: String(entry.content || '').trim() }))
              .filter((entry) => entry.content);
            if (cleanEntries.length) {
              next.character_book = {
                name: bookName.value.trim() || `${name}的世界书`,
                entries: cleanEntries,
              };
            } else {
              next.character_book = null;
              next.character_book_id = '';
            }
            try {
              await repo.saveCard(next);
              toast(existing ? '角色卡已保存' : '新角色已入座', { type: 'success' });
              overlay.close(true);
              setTimeout(() => refresh(), 180);
            } catch (err) {
              toastError(`保存失败：${err.message}`);
            }
            return false;
          },
        },
      ],
    });
  }

  async function addMenu() {
    const key = await actionSheet({
      title: '添加角色',
      subtitle: '支持 SillyTavern 的 PNG 卡与 JSON',
      items: [
        { key: 'import', label: '导入 PNG / JSON', icon: 'upload', description: '解析 ccv2 / ccv3 / chara 元数据' },
        { key: 'new', label: '新建空白角色卡', icon: 'edit', description: '手写设定，从零开始' },
      ],
    });
    fileInput.value = '';
    if (key === 'import') fileInput.click();
    if (key === 'new') openEditor(null);
  }

  async function importFiles(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    let ok = 0;
    const errors = [];
    for (const file of list) {
      try {
        const parsed = await parseCardFile(file);
        await repo.saveCard(parsed.card);
        ok++;
      } catch (err) {
        errors.push(`${file.name}：${err.message}`);
      }
    }
    if (ok) {
      toast(`导入了 ${ok} 张角色卡`, { type: 'success' });
      await refresh();
    }
    if (errors.length) toastError(errors[0], { duration: 5200 });
  }

  async function exportPng(card) {
    try {
      toast('正在绘制角色卡…');
      const blob = await exportCardPng(card);
      downloadBlob(blob, `${safeFilename(card.name)}.png`);
      toast('PNG 卡已导出', { type: 'success' });
    } catch (err) {
      toastError(`导出失败：${err.message}`);
    }
  }

  function exportJson(card) {
    try {
      const text = exportCardJson(card);
      downloadBlob(new Blob([text], { type: 'application/json' }), `${safeFilename(card.name)}.json`);
      toast('JSON 卡已导出', { type: 'success' });
    } catch (err) {
      toastError(`导出失败：${err.message}`);
    }
  }

  function renderGrid(items) {
    const grid = h('div', { class: 'card-grid' });
    for (const card of items) {
      const el = h(
        'article',
        { class: 'card-tile', tabindex: '0', role: 'button', onclick: () => openDetail(card) },
        h('div', { class: 'card-tile__avatar' }, avatarEl(card, 56)),
        h('h3', { class: 'card-tile__name' }, card.name),
        h('div', { class: 'tag-row tag-row--small' }, ...tagsOf(card).slice(0, 2).map((t) => h('span', { class: 'tag' }, t))),
        h('p', { class: 'card-tile__desc' }, excerpt(card)),
        h('span', { class: 'card-tile__author' }, card.creator || '佚名'),
      );
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail(card);
        }
      });
      grid.appendChild(el);
    }
    return grid;
  }

  function renderList(items) {
    const list = h('div', { class: 'card-list' });
    for (const card of items) {
      const el = h(
        'article',
        { class: 'card-row', tabindex: '0', role: 'button', onclick: () => openDetail(card) },
        avatarEl(card, 56),
        h(
          'div',
          { class: 'card-row__main' },
          h('div', { class: 'card-row__top' }, h('h3', {}, card.name), h('span', { class: 'card-row__author' }, card.creator || '')),
          h('div', { class: 'tag-row tag-row--small' }, ...tagsOf(card).slice(0, 3).map((t) => h('span', { class: 'tag' }, t))),
          h('p', { class: 'card-row__desc' }, excerpt(card)),
        ),
        h('span', { class: 'card-row__chevron' }, icon('forward', { size: 18 })),
      );
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail(card);
        }
      });
      list.appendChild(el);
    }
    return list;
  }

  function draw() {
    if (disposed) return;
    clear(root);
    root.appendChild(header());
    root.appendChild(searchWrap);
    root.appendChild(fileInput);
    root.appendChild(searchWrap);
    const items = filtered();
    clear(listHost);
    const tags = tagsBar();
    if (tags) listHost.appendChild(tags);
    if (!items.length) {
      listHost.appendChild(
        h(
          'div',
          { class: 'empty-block' },
          h('div', { class: 'empty-block__icon' }, icon('cards', { size: 30 })),
          h('h3', {}, search || activeTag !== '全部' ? '没找到这张卡' : '卡库还是空的'),
          h('p', {}, search || activeTag !== '全部' ? '换个关键词或 tag 试试。' : '导入一张 PNG 卡，或手写一张新角色。'),
          h(
            'div',
            { class: 'empty-block__actions' },
            h('button', { class: 'btn btn--primary', type: 'button', onclick: addMenu }, icon('plus', { size: 18 }), '添加角色'),
            h('button', { class: 'btn btn--ghost', type: 'button', onclick: onOpenSettings }, '连通后端'),
          ),
        ),
      );
    } else {
      listHost.appendChild(renderGrid(items));
      if (view === 'list') {
        clear(listHost);
        listHost.appendChild(renderList(items));
      }
    }
    root.appendChild(listHost);
  }

  async function refresh() {
    cards = await repo.listCards();
    if (activeTag !== '全部' && !cards.some((c) => tagsOf(c).includes(activeTag))) activeTag = '全部';
    draw();
  }

  fileInput.addEventListener('change', () => importFiles(fileInput.files));
  root.appendChild(fileInput);
  refresh().catch((err) => {
    listHost.appendChild(h('div', { class: 'empty-block' }, h('h3', {}, '卡库打不开'), h('p', {}, String(err?.message || err))));
  });

  return {
    unmount() {
      disposed = true;
      clear(root);
      root.remove();
    },
  };
}
