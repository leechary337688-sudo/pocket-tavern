// group-view — 群聊开桌与成员/世界书设置。
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { openOverlay } from './overlay.js';
import { toastError } from './toast.js';

const MODES = [
  { id: 'natural_order', label: '自然顺序', hint: '点到谁谁接话；没点名就按活跃度掷骰' },
  { id: 'round_robin', label: '轮流发言', hint: '按成员顺序依次接话' },
  { id: 'director', label: '导演模式', hint: '由系统挑选最合适的人' },
  { id: 'mention', label: '只答点名', hint: '只有被叫到名字才接话' },
];

function avatar(card) {
  return h('img', { class: 'group-member__avatar', src: card.avatar || 'icons/logo.svg', alt: '' });
}

function range(value, onInput) {
  const input = h('input', {
    class: 'range',
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: String(value),
    'aria-label': '活跃度',
  });
  const out = h('span', { class: 'group-member__talk mono' }, Number(value).toFixed(2));
  input.addEventListener('input', () => {
    out.textContent = Number(input.value).toFixed(2);
    onInput(Number(input.value));
  });
  return { input, out };
}

/**
 * 打开群聊设置。传 chat 则编辑现有群聊，否则创建新群聊。
 * onSave({title, memberIds, worldIds, mode, memberState}) 由调用方写库/刷新引擎。
 */
export async function openGroupEditor({ repo, settings, chat = null, onSave } = {}) {
  let cards = [];
  let worlds = [];
  try {
    [cards, worlds] = await Promise.all([repo.listCards(), repo.listWorlds()]);
  } catch (err) {
    toastError(`读取角色/世界书失败：${err.message}`);
    return null;
  }
  if (!cards.length) {
    toastError('卡库还是空的，先导入一张角色卡');
    return null;
  }
  const state = {
    title: chat?.title || '深夜酒馆的群聊',
    selected: new Set(chat?.memberIds || []),
    worlds: new Set(chat?.worldIds || []),
    mode: chat?.mode || settings?.group?.mode || 'natural_order',
    allowSelf: Boolean(chat?.allowSelfResponses ?? settings?.group?.allowSelfResponses),
    advanced: Boolean(chat?.worldIds?.length > 1),
    memberState: { ...(chat?.memberState || {}) },
  };
  if (!state.selected.size) {
    state.selected.add(cards[0].id);
    if (cards[1]) state.selected.add(cards[1].id);
  }

  const titleInput = h('input', { class: 'field', type: 'text', value: state.title, maxlength: 40, placeholder: '群聊标题' });
  const memberList = h('div', { class: 'group-members' });
  const memberCount = h('span', { class: 'muted small' });

  function renderMembers() {
    clear(memberList);
    for (const card of cards) {
      const checked = state.selected.has(card.id);
      const check = h('input', {
        type: 'checkbox',
        class: 'switch-input',
        checked,
        'aria-label': `邀请 ${card.name}`,
      });
      const talk = range(
        Number(state.memberState?.[card.id]?.talkativeness ?? settings?.group?.defaultTalkativeness ?? 0.5),
        (v) => {
          state.memberState[card.id] = { ...(state.memberState[card.id] || {}), talkativeness: v };
        }
      );
      check.addEventListener('change', () => {
        if (check.checked) state.selected.add(card.id);
        else state.selected.delete(card.id);
        talk.input.disabled = !check.checked;
        memberCount.textContent = `${state.selected.size} 位在座`;
      });
      talk.input.disabled = !checked;
      const row = h('div', { class: 'group-member' },
        h('label', { class: 'group-member__pick' },
          h('span', { class: 'switch' }, check, h('span', { class: 'switch__knob' })),
          avatar(card),
          h('span', { class: 'group-member__name' }, card.name),
        ),
        h('span', { class: 'group-member__talk-wrap' }, h('span', { class: 'muted small' }, '活跃度'), talk.input, talk.out),
      );
      memberList.appendChild(row);
    }
    memberCount.textContent = `${state.selected.size} 位在座`;
  }
  renderMembers();

  const worldBox = h('div', { class: 'group-worlds' });
  function renderWorlds() {
    clear(worldBox);
    if (!worlds.length) {
      worldBox.appendChild(h('p', { class: 'muted small' }, '还没有世界书。卡内嵌书会随卡自动挂载。'));
      return;
    }
    if (!state.advanced) {
      const select = h('select', { class: 'field', 'aria-label': '挂载世界书' },
        h('option', { value: '' }, '不额外挂载（只用卡内嵌书）'),
        ...worlds.map((w) => h('option', { value: w.id, selected: state.worlds.has(w.id) }, `${w.name}${w.scope === 'embedded' ? '（嵌卡）' : ''}`)),
      );
      select.addEventListener('change', () => {
        state.worlds.clear();
        if (select.value) state.worlds.add(select.value);
      });
      worldBox.appendChild(select);
      return;
    }
    const max = Math.max(2, Math.min(8, Number(settings?.world?.maxBooks) || 3));
    const chosen = [...state.worlds].length;
    worldBox.appendChild(h('p', { class: 'muted small' }, `高级模式：最多 ${max} 本，当前 ${chosen} 本`));
    const list = h('div', { class: 'group-world-list' });
    for (const w of worlds) {
      const check = h('input', { type: 'checkbox', class: 'switch-input', checked: state.worlds.has(w.id) });
      check.addEventListener('change', () => {
        if (check.checked) {
          if (state.worlds.size >= max) {
            check.checked = false;
            toastError(`最多挂 ${max} 本世界书`);
            return;
          }
          state.worlds.add(w.id);
        } else state.worlds.delete(w.id);
      });
      list.appendChild(h('label', { class: 'group-world-row' },
        h('span', { class: 'switch' }, check, h('span', { class: 'switch__knob' })),
        h('span', {}, w.name),
        h('span', { class: 'muted small' }, w.entries?.length ? `${w.entries.length} 条` : '空书'),
      ));
    }
    worldBox.appendChild(list);
  }
  renderWorlds();

  const advanced = h('input', { type: 'checkbox', class: 'switch-input', checked: state.advanced });
  advanced.addEventListener('change', () => {
    state.advanced = advanced.checked;
    if (!state.advanced && state.worlds.size > 1) {
      const first = [...state.worlds][0];
      state.worlds.clear();
      if (first) state.worlds.add(first);
    }
    renderWorlds();
  });

  const modeSelect = h('select', { class: 'field', 'aria-label': '发言模式' },
    ...MODES.map((m) => h('option', { value: m.id, selected: state.mode === m.id }, m.label)),
  );
  modeSelect.addEventListener('change', () => { state.mode = modeSelect.value; });
  const modeHint = h('p', { class: 'muted small' }, MODES.find((m) => m.id === state.mode)?.hint || '');
  modeSelect.addEventListener('change', () => {
    modeHint.textContent = MODES.find((m) => m.id === state.mode)?.hint || '';
  });

  const allow = h('input', { type: 'checkbox', class: 'switch-input', checked: state.allowSelf });
  allow.addEventListener('change', () => { state.allowSelf = allow.checked; });

  const body = h('div', { class: 'group-editor' },
    h('div', { class: 'field-group' }, h('span', { class: 'field-label' }, '群聊标题'), titleInput),
    h('div', { class: 'settings-subhead settings-subhead--tight' }, h('h3', {}, '在座成员'), memberCount),
    h('p', { class: 'muted small' }, '至少 2 位。点名某人全名时，下一条一定由他接话。'),
    memberList,
    h('div', { class: 'settings-subhead settings-subhead--tight' }, h('h3', {}, '世界书挂载')),
    h('p', { class: 'muted small' }, '默认一桌一本，避免设定互相打架。需要叠设定时再开高级模式。'),
    worldBox,
    h('div', { class: 'settings-toggle' },
      h('span', {}, h('strong', {}, '启用多本世界书'), h('span', { class: 'muted small' }, '高级选项，最多 8 本')),
      h('span', { class: 'switch' }, advanced, h('span', { class: 'switch__knob' })),
    ),
    h('div', { class: 'field-group' }, h('span', { class: 'field-label' }, '发言顺序'), modeSelect, modeHint),
    h('div', { class: 'settings-toggle' },
      h('span', {}, h('strong', {}, '允许角色自问自答'), h('span', { class: 'muted small' }, '角色可以连续接自己的话，默认关')),
      h('span', { class: 'switch' }, allow, h('span', { class: 'switch__knob' })),
    ),
  );

  const overlay = openOverlay({
    title: chat ? '群聊设置' : '开一桌群聊',
    subtitle: '一个房间 = 一本主世界书 + 在座角色',
    content: body,
    variant: 'full',
    className: 'overlay__panel--editor',
    actions: [
      { label: '取消', kind: 'ghost', onClick: () => false },
      {
        label: chat ? '保存' : '开桌',
        kind: 'primary',
        onClick: async () => {
          const memberIds = [...state.selected];
          if (memberIds.length < 2) {
            toastError('至少选 2 位角色才能开群聊');
            return false;
          }
          const memberState = {};
          for (const id of memberIds) {
            const talk = state.memberState?.[id]?.talkativeness;
            if (Number.isFinite(Number(talk))) memberState[id] = { talkativeness: Math.min(1, Math.max(0, Number(talk))) };
          }
          try {
            await onSave?.({
              title: titleInput.value.trim() || '深夜酒馆的群聊',
              memberIds,
              worldIds: [...state.worlds],
              advancedWorlds: state.advanced,
              mode: state.mode,
              allowSelfResponses: state.allowSelf,
              memberState,
            });
            overlay.close(true);
          } catch (err) {
            toastError(`保存群聊失败：${err.message}`);
          }
          return false;
        },
      },
    ],
  });
  return overlay;
}
