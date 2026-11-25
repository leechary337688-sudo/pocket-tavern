// worldbook-view — 世界书列表与条目编辑（关键字触发、常量注入、正则、预算）。
import { h, clear, truncate } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, confirmDialog, promptDialog, actionSheet } from './overlay.js';
import { toast, toastError } from './toast.js';
import { shortHash } from '../data/content-hash.js';

function switchEl(checked, label, onChange) {
  const btn = h('button', {
    class: `switch ${checked ? 'is-on' : ''}`,
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    onclick: () => {
      const next = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', next);
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      onChange?.(next);
    },
  }, h('span', { class: 'switch__knob' }));
  return btn;
}

function toggleRow(label, description, input) {
  return h(
    'label',
    { class: 'toggle-row' },
    h('span', { class: 'toggle-row__text' }, h('span', { class: 'toggle-row__label' }, label), description ? h('span', { class: 'toggle-row__desc' }, description) : null),
    input,
  );
}

function tag(text, kind = '') {
  return h('span', { class: `mini-tag ${kind}`.trim() }, text);
}

export function mount(el, ctx) {
  const { repo } = ctx;
  const root = h('div', { class: 'view world-view' });
  el.appendChild(root);
  let disposed = false;
  let worlds = [];
  let activeId = null;

  function activeWorld() {
    return worlds.find((w) => w.id === activeId) || null;
  }

  async function reload({ keepActive = true } = {}) {
    const list = await repo.listWorlds();
    worlds = await Promise.all(
      list.map(async (w) => ({ ...w, boundChats: await repo.countWorldRefs(w.id) }))
    );
    if (keepActive && activeId && !worlds.some((w) => w.id === activeId)) activeId = null;
    draw();
  }

  function topbar() {
    const world = activeWorld();
    if (!world) {
      return h(
        'header',
        { class: 'topbar' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '返回酒馆', onclick: () => ctx.onBack?.() }, icon('back')),
        h('div', { class: 'topbar__lead' }, h('h1', { class: 'topbar__title' }, '世界书'), h('span', { class: 'topbar__sub' }, `${worlds.length} 本`)),
        h(
          'div',
          { class: 'topbar__actions' },
          h('button', { class: 'icon-btn icon-btn--accent', type: 'button', 'aria-label': '新建世界书', onclick: createWorld }, icon('plus')),
        ),
      );
    }
    return h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '返回世界书列表', onclick: () => { activeId = null; draw(); } }, icon('back')),
      h(
        'div',
        { class: 'topbar__lead topbar__lead--tight' },
        h('h1', { class: 'topbar__title topbar__title--small' }, world.name),
        h('span', { class: 'topbar__sub' }, `${world.entries.length} 个条目 · ${world.enabled ? '启用中' : '已停用'}`),
      ),
      h(
        'div',
        { class: 'topbar__actions' },
        h('button', { class: 'icon-btn icon-btn--accent', type: 'button', 'aria-label': '新增条目', onclick: () => editEntry(null) }, icon('plus')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '世界书操作', onclick: worldMenu }, icon('more')),
      ),
    );
  }

  async function createWorld() {
    const name = await promptDialog({
      title: '新建世界书',
      label: '名字',
      placeholder: '例如：雾港城设定集',
      confirmText: '创建',
      maxlength: 60,
      helper: '一个世界一本书，角色私设嵌进卡。需要多本时，在群聊里显式开启高级选项。',
    });
    if (!name) return;
    try {
      const world = await repo.createWorld(name);
      activeId = world.id;
      await reload();
      toast('世界书已创建', { type: 'success' });
    } catch (err) {
      toastError(`创建失败：${err.message}`);
    }
  }

  async function toggleWorld(world, enabled) {
    try {
      world.enabled = enabled;
      await repo.saveWorld(world);
      toast(enabled ? `「${world.name}」已启用` : `「${world.name}」已停用`);
      await reload();
    } catch (err) {
      toastError(`保存失败：${err.message}`);
      await reload();
    }
  }

  async function renameWorld() {
    const world = activeWorld();
    if (!world) return;
    const name = await promptDialog({ title: '重命名', label: '世界书名字', value: world.name, confirmText: '保存', maxlength: 60 });
    if (!name || name === world.name) return;
    try {
      world.name = name;
      await repo.saveWorld(world);
      await reload();
      toast('名字已更新');
    } catch (err) {
      toastError(`保存失败：${err.message}`);
    }
  }

  async function deleteWorld() {
    const world = activeWorld();
    if (!world) return;
    const ok = await confirmDialog({
      title: '删除这本世界书？',
      message: `「${world.name}」的 ${world.entries.length} 个条目会一起删除，且不能撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await repo.deleteWorld(world.id);
      activeId = null;
      await reload();
      toast('世界书已删除');
    } catch (err) {
      toastError(`删除失败：${err.message}`);
    }
  }

  async function worldMenu() {
    const world = activeWorld();
    if (!world) return;
    const action = await actionSheet({
      title: world.name,
      subtitle: '世界书操作',
      items: [
        { key: 'rename', label: '重命名', icon: 'edit' },
        { key: 'export', label: '导出世界书 JSON', icon: 'download' },
        { key: 'delete', label: '删除世界书', icon: 'trash', danger: true },
      ],
    });
    if (action === 'rename') return renameWorld();
    if (action === 'delete') return deleteWorld();
    if (action === 'export') {
      try {
        const text = JSON.stringify({ app: 'PocketTavern', kind: 'worldbook', version: 1, world }, null, 2);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `${world.name || '世界书'}.json` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('世界书已导出', { type: 'success' });
      } catch (err) {
        toastError(`导出失败：${err.message}`);
      }
    }
  }

  function entryRow(entry) {
    const keys = Array.isArray(entry.key) ? entry.key : [];
    const title = entry.comment || keys[0] || '未命名条目';
    return h(
      'article',
      {
        class: `entry-row ${entry.enabled === false ? 'is-disabled' : ''}`.trim(),
        tabindex: '0',
        role: 'button',
        onclick: () => editEntry(entry),
      },
      h(
        'div',
        { class: 'entry-row__main' },
        h(
          'div',
          { class: 'entry-row__top' },
          h('h3', { class: 'entry-row__title' }, title),
          entry.constant ? tag('常驻', 'mini-tag--amber') : null,
          entry.probability < 100 ? tag(`${entry.probability}%`) : null,
        ),
        h(
          'div',
          { class: 'entry-row__keys' },
          keys.slice(0, 4).map((k) => tag(k)),
          keys.length > 4 ? tag(`+${keys.length - 4}`) : null,
          entry.keysecondary?.length ? tag('次级键', 'mini-tag--ghost') : null,
        ),
        h('p', { class: 'entry-row__preview' }, truncate(entry.content, 88)),
      ),
      h(
        'div',
        { class: 'entry-row__side' },
        h('span', { class: 'entry-row__pos' }, entry.position === 'after' ? '后置' : '前置'),
        h('span', { class: 'entry-row__chevron' }, icon('forward', { size: 16 })),
      ),
    );
  }

  function renderWorldList() {
    const list = h('div', { class: 'world-list' });
    for (const world of worlds) {
      const embedded = world.scope === 'embedded';
      const meta = [
        `${world.entries.length} 条`,
        world.enabled ? '启用' : '停用',
        shortHash(world.contentHash || world.id),
        `${world.boundChats || 0} 会话`,
        embedded ? '嵌卡' : '馆藏',
      ].join(' · ');
      list.appendChild(
        h(
          'article',
          { class: 'world-card' },
          h(
            'button',
            { class: 'world-card__main', type: 'button', onclick: () => { activeId = world.id; draw(); } },
            h('span', { class: 'world-card__icon' }, icon('book', { size: 24 })),
            h(
              'span',
              { class: 'world-card__text' },
              h('span', { class: 'world-card__name' }, world.name),
              h('span', { class: 'world-card__meta' }, meta),
            ),
            icon('forward', { size: 18 }),
          ),
          switchEl(world.enabled, `启用 ${world.name}`, (next) => toggleWorld(world, next)),
        ),
      );
    }
    return list;
  }

  function renderWorldDetail(world) {
    const wrap = h('div', { class: 'world-detail' });
    wrap.appendChild(
      h(
        'div',
        { class: 'world-detail__head' },
        h(
          'div',
          { class: 'world-detail__copy' },
          h('p', { class: 'world-detail__desc' }, '条目会在聊天文本命中关键词时注入。常驻条目始终注入。扫描深度 2 层，同一轮不会重复命中。'),
        ),
        h('div', { class: 'world-detail__toggle' }, h('span', {}, world.enabled ? '启用中' : '已停用'), switchEl(world.enabled, '启用世界书', (next) => toggleWorld(world, next))),
      ),
    );
    if (!world.entries.length) {
      wrap.appendChild(
        h(
          'div',
          { class: 'empty-block empty-block--compact' },
          h('div', { class: 'empty-block__icon' }, icon('book', { size: 28 })),
          h('h3', {}, '这本世界书还是空白'),
          h('p', {}, '加一个条目，让「酒馆」这类关键词有地方可去。'),
          h('button', { class: 'btn btn--primary', type: 'button', onclick: () => editEntry(null) }, icon('plus', { size: 18 }), '新增条目'),
        ),
      );
    } else {
      const sorted = [...world.entries].sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.comment || a.key?.[0] || '').localeCompare(String(b.comment || b.key?.[0] || ''), 'zh'));
      const list = h('div', { class: 'entry-list' });
      for (const entry of sorted) list.appendChild(entryRow(entry));
      wrap.appendChild(list);
    }
    wrap.appendChild(h('p', { class: 'swipe-hint' }, '点条目编辑 · 词条支持逗号分隔 · 概率低于 100% 会掷骰决定是否注入'));
    return wrap;
  }

  function editEntry(existing) {
    const world = activeWorld();
    if (!world) return;
    const isNew = !existing;
    const draft = existing
      ? { ...existing, key: [...(existing.key || [])], keysecondary: [...(existing.keysecondary || [])] }
      : {
          uid: Math.max(0, ...world.entries.map((e) => Number(e.uid) || 0)) + 1,
          key: [],
          keysecondary: [],
          comment: '',
          content: '',
          position: 'before',
          order: 100,
          tokenBudget: 0,
          recursive: true,
          selective: false,
          constant: false,
          probability: 100,
          caseSensitive: false,
          useRegex: false,
          enabled: true,
        };
    const f = {
      comment: h('input', { class: 'field', type: 'text', value: draft.comment || '', placeholder: '例如：酒馆环境', maxlength: 80 }),
      keys: h('input', { class: 'field', type: 'text', value: (draft.key || []).join(', '), placeholder: '酒馆, 老板娘, tavern' }),
      secondary: h('input', { class: 'field', type: 'text', value: (draft.keysecondary || []).join(', '), placeholder: '可选：需要同时出现的词' }),
      content: h('textarea', { class: 'field field--area field--tall', rows: '8', value: draft.content || '', placeholder: '命中后注入给模型的设定正文。支持 {{char}} / {{user}} 宏。' }),
      position: h(
        'select',
        { class: 'field select' },
        h('option', { value: 'before', selected: draft.position !== 'after' }, '角色卡之前（前置）'),
        h('option', { value: 'after', selected: draft.position === 'after' }, '聊天记录之后（后置）'),
      ),
      order: h('input', { class: 'field field--num', type: 'number', inputmode: 'numeric', value: draft.order ?? 100, min: 0, max: 9999 }),
      tokenBudget: h('input', { class: 'field field--num', type: 'number', inputmode: 'numeric', value: draft.tokenBudget ?? 0, min: 0, max: 4096 }),
      probability: h('input', { class: 'field field--num', type: 'number', inputmode: 'numeric', value: draft.probability ?? 100, min: 0, max: 100 }),
      recursive: h('input', { type: 'checkbox', class: 'switch-input', checked: Boolean(draft.recursive) }),
      selective: h('input', { type: 'checkbox', class: 'switch-input', checked: Boolean(draft.selective) }),
      constant: h('input', { type: 'checkbox', class: 'switch-input', checked: Boolean(draft.constant) }),
      caseSensitive: h('input', { type: 'checkbox', class: 'switch-input', checked: Boolean(draft.caseSensitive) }),
      useRegex: h('input', { type: 'checkbox', class: 'switch-input', checked: Boolean(draft.useRegex) }),
      enabled: h('input', { type: 'checkbox', class: 'switch-input', checked: draft.enabled !== false }),
    };
    const form = h(
      'div',
      { class: 'entry-editor' },
      h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '条目标题'), f.comment),
      h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '主关键词（逗号分隔）'), f.keys, h('span', { class: 'field-help' }, '默认不区分大小写的子串匹配；开启正则可写表达式。')),
      h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '次级关键词（可选）'), f.secondary, h('span', { class: 'field-help' }, '填写后需要主/次级都命中（selective 时更严格）。')),
      h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '注入内容'), f.content),
      h(
        'div',
        { class: 'field-grid' },
        h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '插入位置'), f.position),
        h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '顺序'), f.order),
        h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, 'token 预算（0 不限）'), f.tokenBudget),
        h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, '触发概率 %'), f.probability),
      ),
      h(
        'div',
        { class: 'toggle-list' },
        toggleRow('启用条目', '关闭后不会参与扫描。', f.enabled),
        toggleRow('常驻注入', '无视关键词，每一轮都注入。', f.constant),
        toggleRow('递归扫描', '命中内容会作为下一层扫描文本，最多 2 层。', f.recursive),
        toggleRow('选择性匹配', '主关键词与次级关键词需同时命中。', f.selective),
        toggleRow('区分大小写', '关闭时酒馆 / Tavern 都能命中。', f.caseSensitive),
        toggleRow('使用正则', '主关键词按 JavaScript 正则解释。', f.useRegex),
      ),
      !isNew
        ? h(
            'button',
            {
              class: 'text-btn text-btn--danger entry-editor__delete',
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog({ title: '删除这个条目？', message: '删除后本轮对话不会立刻更新，但下一次组装会生效。', confirmText: '删除', danger: true });
                if (!ok) return;
                world.entries = world.entries.filter((e) => e.uid !== existing.uid);
                try {
                  await repo.saveWorld(world);
                  overlay.close(null);
                  await reload();
                  toast('条目已删除');
                } catch (err) {
                  toastError(`删除失败：${err.message}`);
                }
              },
            },
            icon('trash', { size: 16 }),
            '删除条目',
          )
        : null,
    );
    const overlay = openOverlay({
      title: isNew ? '新增世界书条目' : '编辑条目',
      content: form,
      variant: 'full',
      className: 'overlay__panel--editor',
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => false },
        {
          label: '保存条目',
          kind: 'primary',
          onClick: async () => {
            const key = f.keys.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            const constant = f.constant.checked;
            if (!key.length && !constant) {
              toastError('至少填一个关键词，或勾选「常驻注入」');
              f.keys.focus();
              return false;
            }
            if (!f.content.value.trim()) {
              toastError('注入内容不能为空');
              f.content.focus();
              return false;
            }
            const next = {
              ...draft,
              key,
              keysecondary: f.secondary.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
              comment: f.comment.value.trim(),
              content: f.content.value.trim(),
              position: f.position.value === 'after' ? 'after' : 'before',
              order: Number(f.order.value) || 0,
              tokenBudget: Math.max(0, Number(f.tokenBudget.value) || 0),
              probability: Math.min(100, Math.max(0, Number(f.probability.value) || 0)),
              recursive: f.recursive.checked,
              selective: f.selective.checked,
              constant,
              caseSensitive: f.caseSensitive.checked,
              useRegex: f.useRegex.checked,
              enabled: f.enabled.checked,
            };
            const entries = isNew ? [...world.entries, next] : world.entries.map((e) => (e.uid === existing.uid ? next : e));
            try {
              await repo.saveWorld({ ...world, entries });
              overlay.close(true);
              await reload();
              toast(isNew ? '条目已加入' : '条目已保存', { type: 'success' });
            } catch (err) {
              toastError(`保存失败：${err.message}`);
            }
            return false;
          },
        },
      ],
    });
  }

  function draw() {
    if (disposed) return;
    clear(root);
    root.appendChild(topbar());
    const world = activeWorld();
    if (!world) {
      const main = h('main', { class: 'world-scroll' });
      if (!worlds.length) {
        main.appendChild(
          h(
            'div',
            { class: 'empty-block' },
            h('div', { class: 'empty-block__icon' }, icon('book', { size: 30 })),
            h('h3', {}, '还没有世界书'),
            h('p', {}, '世界书让角色记得酒馆的布局、城市的规矩，或者某个不能提的名字。'),
            h('button', { class: 'btn btn--primary', type: 'button', onclick: createWorld }, icon('plus', { size: 18 }), '新建世界书'),
          ),
        );
      } else {
        main.appendChild(h('p', { class: 'page-hint' }, '世界书会随角色卡一起工作。开关控制是否参与本轮组装。'));
        main.appendChild(renderWorldList());
      }
      root.appendChild(main);
      return;
    }
    const main = h('main', { class: 'world-scroll' });
    main.appendChild(renderWorldDetail(world));
    root.appendChild(main);
  }

  reload().catch((err) => toastError(`世界书加载失败：${err.message}`));

  return {
    unmount() {
      disposed = true;
      clear(root);
      root.remove();
    },
  };
}
