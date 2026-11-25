// gen-view — AI 生成角色卡 / 世界书；字段级重生、试聊转正、发布入口。
import { h, clear, debounce } from './dom.js';
import { icon, iconButton } from './icons.js';
import { openOverlay, actionSheet } from './overlay.js';
import { toast, toastError } from './toast.js';
import {
  CARD_FIELDS,
  FIELD_LABELS,
  generateCard,
  generateWorld,
  regenerateField,
  validateWorldEntries,
} from '../workshop/ai-gen.js';
import { createTrialSandbox } from '../workshop/trial-sandbox.js';
import { copyText } from './dom.js';
import { openPublishFlow } from './publish-view.js';

const FIELD_ROWS = {
  name: 1,
  description: 4,
  personality: 3,
  scenario: 3,
  first_mes: 5,
  mes_example: 4,
  tags: 1,
};

function tagsText(tags) {
  return (Array.isArray(tags) ? tags : []).join(', ');
}

function parseTags(value) {
  return String(value || '')
    .split(/[,，、#]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function mount(el, ctx = {}) {
  const settings = ctx.settings || {};
  const state = {
    mode: 'card',
    idea: '',
    source: '',
    language: settings.workshop?.genLanguage || 'auto',
    temperature: Number(settings.workshop?.genTemperature) || 0.9,
    model: settings.workshop?.genModel || '',
    card: null,
    world: null,
    busy: false,
    error: '',
    progress: '',
    disposed: false,
  };
  let fieldBusy = '';
  let trial = null;
  let overlay = null;
  let controller = null;

  const root = h('div', { class: 'view gen-view' });
  const topbar = h('header', { class: 'topbar' },
    iconButton('back', '返回工坊', () => ctx.onBack?.(), { class: 'icon-btn' }),
    h('div', { class: 'topbar__title-wrap' }, h('h1', { class: 'topbar__title' }, 'AI 生成器'),
      h('span', { class: 'topbar__sub' }, '一句话起稿，剩下的边看边改')),
    h('div', { class: 'topbar__actions' }, iconButton('archive', '作品工坊', () => ctx.onOpenWorkshop?.())),
  );

  const modeTabs = h('div', { class: 'gen-tabs', role: 'tablist' });
  const scroll = h('main', { class: 'gen-scroll' });
  const formHost = h('section', { class: 'gen-form' });
  const status = h('div', { class: 'gen-status', role: 'status' });
  const resultHost = h('section', { class: 'gen-result', hidden: true });
  const draftBar = h('div', { class: 'gen-draft-bar', hidden: true });
  const draftText = h('span', { class: 'gen-draft-bar__text' });
  const draftClear = h('button', { class: 'text-btn', type: 'button' }, '清空草稿');
  draftClear.addEventListener('click', () => clearDraft());
  draftBar.append(draftText, draftClear);
  scroll.append(
    draftBar,
    h('div', { class: 'gen-intro' },
      h('span', { class: 'gen-intro__badge' }, icon('sparkle', { size: 14 }), '创意工坊'),
      h('h2', {}, '先捏个雏形，再一起改。'),
      h('p', {}, '生成走你已配置的后端；草稿只在这台设备上，不点「转正」不会进卡库。')),
    modeTabs,
    formHost,
    status,
    resultHost,
  );
  root.append(topbar, scroll);
  el.append(root);

  function liveSettings() {
    return ctx.repo?.settings || settings;
  }

  // ---------- 草稿：只存本机 IndexedDB，不写正式卡库 ----------
  const DRAFT_NS = '__workshop';
  const DRAFT_KEY = 'drafts';
  let draftReady = false;
  let draftTimer = null;
  let draftLast = '';

  function draftPayload() {
    return {
      card: state.card ? JSON.parse(JSON.stringify(state.card)) : null,
      idea: state.idea,
      world: state.world ? JSON.parse(JSON.stringify(state.world)) : null,
      source: state.source,
      language: state.language,
      temperature: state.temperature,
      model: state.model,
      updatedAt: new Date().toISOString(),
    };
  }

  function draftDigest(payload = draftPayload()) {
    return JSON.stringify(payload);
  }

  function showDraftBar(label) {
    draftText.textContent = label;
    draftBar.hidden = false;
  }

  async function saveDraftNow() {
    if (!draftReady || !ctx.repo || state.disposed) return;
    const payload = draftPayload();
    const digest = draftDigest(payload);
    if (digest === draftLast) return;
    draftLast = digest;
    try {
      await ctx.repo.extSet(DRAFT_NS, DRAFT_KEY, payload);
    } catch {
      /* 草稿失败不打断创作 */
    }
  }

  function scheduleDraftSave() {
    if (!draftReady) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 500);
  }

  async function clearDraft() {
    draftReady = false;
    clearTimeout(draftTimer);
    try {
      await ctx.repo?.extDelete?.(DRAFT_NS, DRAFT_KEY);
    } catch {
      /* ignore */
    }
    draftLast = draftDigest({ card: null, idea: '', world: null, source: '' });
    draftBar.hidden = true;
    draftReady = true;
  }

  async function restoreDraft() {
    if (!ctx.repo) {
      draftReady = true;
      return;
    }
    try {
      const saved = await ctx.repo.extGet?.(DRAFT_NS, DRAFT_KEY);
      if (saved && !state.card && !state.world && !state.idea && !state.source) {
        if (saved.idea || saved.card) {
          state.idea = String(saved.idea || '');
          state.card = saved.card || null;
        }
        if (saved.source || saved.world) {
          state.source = String(saved.source || '');
          state.world = saved.world || null;
        }
        if (saved.language) state.language = saved.language;
        if (Number.isFinite(Number(saved.temperature))) state.temperature = Number(saved.temperature);
        if (saved.model !== undefined) state.model = String(saved.model || '');
        if (saved.card || saved.world || saved.idea || saved.source) {
          state.mode = saved.card || !saved.world ? 'card' : 'world';
          const kindLabel = saved.card ? '角色卡' : saved.world ? '世界书' : '输入草稿';
          showDraftBar(`已恢复上次草稿 · ${kindLabel}${saved.updatedAt ? ` · ${new Date(saved.updatedAt).toLocaleString()}` : ''}`);
        }
      }
    } catch {
      /* ignore */
    }
    draftLast = draftDigest();
    draftReady = true;
    renderForm();
    renderResult();
  }

  root.addEventListener('input', scheduleDraftSave);
  root.addEventListener('change', scheduleDraftSave);

  function persistGenOptions() {
    settings.workshop = {
      ...(settings.workshop || {}),
      genLanguage: state.language,
      genTemperature: state.temperature,
      genModel: state.model,
    };
    ctx.repo?.saveSettings?.({ workshop: settings.workshop }).catch(() => {});
  }

  function modeTabsRender() {
    clear(modeTabs);
    [
      { id: 'card', label: '角色卡', iconName: 'cards' },
      { id: 'world', label: '世界书', iconName: 'book' },
    ].forEach((tab) => {
      modeTabs.append(h('button', {
        class: `gen-tab ${state.mode === tab.id ? 'is-on' : ''}`,
        type: 'button',
        'aria-pressed': String(state.mode === tab.id),
        onclick: () => {
          if (state.busy) return;
          state.mode = tab.id;
          state.error = '';
          modeTabsRender();
          renderForm();
          renderResult();
        },
      }, icon(tab.iconName, { size: 16 }), tab.label));
    });
  }

  function optionRow(multiline = false) {
    const temp = h('input', {
      type: 'range',
      min: '0.5',
      max: '1.2',
      step: '0.05',
      value: String(state.temperature),
      class: 'gen-range',
      'aria-label': '生成温度',
    });
    const tempLabel = h('span', { class: 'gen-option__value' }, state.temperature.toFixed(2));
    temp.addEventListener('input', () => {
      state.temperature = Number(temp.value);
      tempLabel.textContent = state.temperature.toFixed(2);
    });
    temp.addEventListener('change', persistGenOptions);
    const lang = h('select', { class: 'field gen-select', 'aria-label': '输出语言' },
      h('option', { value: 'auto', selected: state.language === 'auto' }, '跟随输入'),
      h('option', { value: 'zh', selected: state.language === 'zh' }, '中文'),
      h('option', { value: 'en', selected: state.language === 'en' }, 'English'));
    lang.addEventListener('change', () => {
      state.language = lang.value;
      persistGenOptions();
    });
    const model = h('input', {
      class: 'field',
      value: state.model,
      placeholder: '默认模型',
      'aria-label': '生成用模型',
    });
    model.addEventListener('input', debounce(() => {
      state.model = model.value.trim();
      persistGenOptions();
    }, 400));
    return h('div', { class: `gen-options ${multiline ? 'gen-options--wrap' : ''}` },
      h('label', { class: 'gen-option gen-option--temp' }, h('span', { class: 'gen-option__label' }, '温度'), temp, tempLabel),
      h('label', { class: 'gen-option' }, h('span', { class: 'gen-option__label' }, '语言'), lang),
      h('label', { class: 'gen-option gen-option--model' }, h('span', { class: 'gen-option__label' }, '生成模型'), model),
    );
  }

  function genButton(label) {
    return h('button', { class: 'btn btn--primary gen-submit', type: 'button', onclick: runGenerate },
      icon('sparkle', { size: 17 }), label);
  }

  function renderForm() {
    clear(formHost);
    state.error = '';
    if (state.mode === 'card') {
      const idea = h('textarea', {
        class: 'field field--area gen-idea',
        rows: '3',
        maxlength: '100',
        placeholder: '例：一个失忆的海盗船长，嘴上不认账，其实很怕黑。',
        'aria-label': '角色想法',
      }, state.idea);
      const count = h('span', { class: 'gen-count' }, `${state.idea.length} / 100`);
      idea.addEventListener('input', () => {
        state.idea = idea.value.slice(0, 100);
        count.textContent = `${state.idea.length} / 100`;
        count.classList.toggle('is-near', state.idea.length > 90);
      });
      formHost.append(
        h('h3', { class: 'gen-form__title' }, '一句话，起个角色'),
        idea,
        h('div', { class: 'gen-form__meta' }, count, h('span', {}, '名字、口吻、秘密都可以写进去')),
        optionRow(),
        genButton('调一杯角色卡'),
        h('p', { class: 'gen-hint' }, icon('info', { size: 13 }), '生成后每个字段都能改；左滑字段卡可只重生该字段。'),
      );
    } else {
      const source = h('textarea', {
        class: 'field field--area gen-idea',
        rows: '7',
        maxlength: '2000',
        placeholder: '粘贴一段世界设定、城市背景、势力关系……\n例：雾港常年下雨，旧海关二十年前因走私案关闭，城里所有书商都欠同一个人人情。',
        'aria-label': '世界设定',
      }, state.source);
      const count = h('span', { class: 'gen-count' }, `${state.source.length} / 2000`);
      source.addEventListener('input', () => {
        state.source = source.value.slice(0, 2000);
        count.textContent = `${state.source.length} / 2000`;
        count.classList.toggle('is-near', state.source.length > 1850);
      });
      formHost.append(
        h('h3', { class: 'gen-form__title' }, '把设定拆成能触发的条目'),
        source,
        h('div', { class: 'gen-form__meta' }, count, h('span', {}, '会拆成 5–15 条，每条 content ≤200 token')),
        optionRow(true),
        genButton('拆成世界书'),
        h('p', { class: 'gen-hint' }, icon('info', { size: 13 }), '生成后可以用表格改关键词、拖拽排序；重复或空 key 会标红。'),
      );
    }
    formHost.querySelector('.gen-submit')?.toggleAttribute('disabled', state.busy);
  }

  function setBusy(busy, progress = '') {
    state.busy = busy;
    state.progress = progress;
    clear(status);
    if (busy) {
      status.append(h('span', { class: 'gen-spinner' }), h('span', {}, progress || '正在调酒…'));
    } else if (state.error) {
      status.append(h('span', { class: 'gen-status__error' }, icon('warning', { size: 15 }), state.error));
    }
    formHost.querySelectorAll('button, textarea, input, select').forEach((node) => {
      if (node.classList.contains('gen-submit')) node.disabled = busy;
    });
  }

  async function runGenerate() {
    if (state.busy) return;
    state.error = '';
    if (state.mode === 'card' && !state.idea.trim()) {
      toastError('先写一句角色想法');
      return;
    }
    if (state.mode === 'world' && !state.source.trim()) {
      toastError('先粘贴一段世界设定');
      return;
    }
    setBusy(true, state.mode === 'card' ? '正在拟人设…' : '正在拆条目…');
    controller = new AbortController();
    try {
      if (state.mode === 'card') {
        state.card = await generateCard({
          idea: state.idea,
          settings: liveSettings(),
          language: state.language,
          temperature: state.temperature,
          model: state.model,
          signal: controller.signal,
          onProgress: ({ chars }) => setBusy(true, `正在拟人设… 已收到 ${chars} 字`),
        });
      } else {
        state.world = await generateWorld({
          source: state.source,
          settings: liveSettings(),
          language: state.language,
          temperature: state.temperature,
          model: state.model,
          signal: controller.signal,
          onProgress: ({ chars }) => setBusy(true, `正在拆条目… 已收到 ${chars} 字`),
        });
      }
      state.busy = false;
      state.error = '';
      clear(status);
      scheduleDraftSave();
      renderResult();
      toast(state.mode === 'card' ? '角色卡雏形好了，先改再转正' : '世界书条目已拆好，检查一下 key', { type: 'success' });
    } catch (err) {
      state.busy = false;
      state.error = err?.name === 'AbortError' ? '生成已停止' : String(err?.message || err);
      setBusy(false);
    } finally {
      controller = null;
      renderForm();
    }
  }

  function fieldNode(field) {
    const value = field === 'tags' ? tagsText(state.card?.tags) : String(state.card?.[field] || '');
    const isSingle = field === 'name' || field === 'tags';
    const control = isSingle
      ? h('input', {
        class: 'field gen-field__input',
        value,
        maxlength: field === 'name' ? '60' : '120',
        'aria-label': FIELD_LABELS[field] || field,
      })
      : h('textarea', {
        class: 'field field--area gen-field__input',
        rows: String(FIELD_ROWS[field] || 3),
        'aria-label': FIELD_LABELS[field] || field,
      }, value);
    control.addEventListener('input', () => {
      if (!state.card) return;
      if (field === 'tags') state.card.tags = parseTags(control.value);
      else state.card[field] = control.value;
    });
    const regen = h('button', {
      class: 'gen-field__regen',
      type: 'button',
      'aria-label': `重生 ${FIELD_LABELS[field] || field}`,
      disabled: fieldBusy === field,
    }, icon('refresh', { size: 15 }), fieldBusy === field ? '重生中…' : '重生');
    regen.addEventListener('click', () => regenField(field, control));
    const node = h('div', { class: 'gen-field', dataset: { field } },
      h('div', { class: 'gen-field__head' },
        h('span', { class: 'gen-field__label' }, FIELD_LABELS[field] || field),
        h('span', { class: 'gen-field__hint' }, '左滑可只重生这块'),
        regen),
      control);
    let startX = 0;
    let startY = 0;
    let swiping = false;
    node.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      swiping = false;
    }, { passive: true });
    node.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (dx < -18 && Math.abs(dy) < 34) {
        swiping = true;
        node.classList.add('is-swiping');
        node.style.transform = `translateX(${Math.max(-48, dx * 0.55)}px)`;
      }
    }, { passive: true });
    node.addEventListener('touchend', () => {
      node.classList.remove('is-swiping');
      node.style.transform = '';
      if (swiping) {
        swiping = false;
        regenField(field, control);
      }
    });
    return node;
  }

  async function regenField(field, control) {
    if (!state.card || fieldBusy) return;
    fieldBusy = field;
    const old = field === 'tags' ? [...state.card.tags] : state.card[field];
    renderCardResult();
    clear(status);
    status.append(h('span', { class: 'gen-spinner' }), h('span', {}, `正在重生「${FIELD_LABELS[field] || field}」…`));
    try {
      const value = await regenerateField({
        card: state.card,
        field,
        idea: state.idea,
        settings: liveSettings(),
        language: state.language,
        temperature: state.temperature,
        model: state.model,
      });
      if (field === 'tags') state.card.tags = parseTags(value);
      else state.card[field] = String(value || '').trim();
      scheduleDraftSave();
      toast(`「${FIELD_LABELS[field] || field}」重生完成`, { type: 'success' });
      clear(status);
      renderCardResult();
    } catch (err) {
      if (state.card) {
        if (field === 'tags') state.card.tags = old;
        else state.card[field] = old;
      }
      state.error = String(err?.message || err);
      clear(status);
      status.append(h('span', { class: 'gen-status__error' }, icon('warning', { size: 15 }), state.error));
      renderCardResult();
    } finally {
      fieldBusy = '';
      if (state.card) renderCardResult();
    }
  }

  function renderCardResult() {
    if (!state.card) return;
    clear(resultHost);
    resultHost.hidden = false;
    const actions = h('div', { class: 'gen-actions' });
    const trialBtn = h('button', { class: 'btn btn--primary gen-trial-btn', type: 'button' },
      icon('play', { size: 16 }), '试聊 · 开 3 条');
    trialBtn.addEventListener('click', openCardTrial);
    const publishBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, icon('upload', { size: 16 }), '发布');
    publishBtn.addEventListener('click', () => {
      openPublishFlow({
        type: 'card',
        card: state.card,
        settings: liveSettings(),
        repo: ctx.repo,
        onPublished: (item) => {
          ctx.onPublished?.(item);
        },
      });
    });
    const copyBtn = h('button', { class: 'btn btn--quiet', type: 'button' }, icon('copy', { size: 16 }), '复制 JSON');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(JSON.stringify(state.card, null, 2));
      toast(ok ? '草稿 JSON 已复制' : '复制失败，请手动选中', { type: ok ? 'success' : 'warn' });
    });
    actions.append(trialBtn, publishBtn, copyBtn);
    resultHost.append(
      h('div', { class: 'gen-result__head' },
        h('div', {}, h('span', { class: 'gen-draft-badge' }, '草稿 · 未入库'),
          h('h3', {}, state.card.name || '未命名角色'),
          h('p', {}, `${(state.card.tags || []).length} 个 tag · 可改到满意再转正`)),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '收起草稿',
          onclick: () => { resultHost.hidden = true; },
        }, icon('chevronDown', { size: 18 }))),
      h('div', { class: 'gen-fields' }, ...CARD_FIELDS.map(fieldNode)),
      actions,
      h('p', { class: 'gen-warn' }, icon('lock', { size: 14 }), '转正前只存在于内存；试聊和草稿都不会污染卡库。'),
    );
  }

  function renderWorldResult() {
    if (!state.world) return;
    clear(resultHost);
    resultHost.hidden = false;
    const entries = state.world.entries || [];
    let errors = validateWorldEntries(entries);
    const name = h('input', {
      class: 'field gen-world-name',
      value: state.world.name || '未命名世界书',
      maxlength: '60',
      'aria-label': '世界书名称',
    });
    name.addEventListener('input', () => { state.world.name = name.value; });
    const list = h('div', { class: 'gen-world-list' });
    const summary = h('div', { class: 'gen-world-summary' });
    const actions = h('div', { class: 'gen-actions' });

    const updateSummary = () => {
      errors = validateWorldEntries(entries);
      clear(summary);
      summary.append(
        h('span', {}, `${entries.length} 条`),
        h('span', {}, errors.size ? `${errors.size} 条待修` : '校验通过'),
        h('span', {}, '拖拽 ⠿ 排序'),
      );
      summary.classList.toggle('is-error', errors.size > 0);
    };

    const renderRows = () => {
      clear(list);
      entries.forEach((entry, index) => {
        const err = errors.get(index);
        const row = h('div', {
          class: `gen-world-row ${err ? 'is-error' : ''}`,
          draggable: 'true',
          dataset: { index: String(index) },
        });
        const handle = h('span', { class: 'gen-world-row__handle', title: '拖拽排序' }, '⠿');
        const comment = h('input', {
          class: 'field gen-world-row__comment',
          value: entry.comment || '',
          maxlength: '80',
          placeholder: '条目名',
          'aria-label': `第 ${index + 1} 条名称`,
        });
        const keys = h('input', {
          class: 'field gen-world-row__keys',
          value: (entry.key || []).join(', '),
          placeholder: 'key，用逗号分隔',
          'aria-label': `第 ${index + 1} 条关键词`,
        });
        const content = h('textarea', {
          class: 'field field--area gen-world-row__content',
          rows: '2',
          maxlength: '1200',
          'aria-label': `第 ${index + 1} 条内容`,
        }, String(entry.content || ''));
        const tokens = h('span', { class: 'gen-world-row__tokens' }, `${entry.tokenEstimate || 0} tok`);
        const errLine = h('span', { class: 'gen-world-row__error' }, err || '');
        const del = h('button', {
          class: 'icon-btn gen-world-row__del',
          type: 'button',
          'aria-label': `删除第 ${index + 1} 条`,
          onclick: () => {
            entries.splice(index, 1);
            updateSummary();
            renderRows();
          },
        }, icon('trash', { size: 16 }));
        comment.addEventListener('input', () => { entry.comment = comment.value; });
        keys.addEventListener('input', () => {
          entry.key = parseTags(keys.value);
          errors = validateWorldEntries(entries);
          row.classList.toggle('is-error', errors.has(index));
          errLine.textContent = errors.get(index) || '';
          updateSummary();
        });
        content.addEventListener('input', () => {
          entry.content = content.value;
          const est = (entry.content.match(/[\u4e00-\u9fff]/g) || []).length + Math.ceil(entry.content.replace(/[\u4e00-\u9fff]/g, '').length / 4);
          entry.tokenEstimate = est;
          tokens.textContent = `${est} tok`;
          errors = validateWorldEntries(entries);
          row.classList.toggle('is-error', errors.has(index));
          errLine.textContent = errors.get(index) || '';
          updateSummary();
        });
        // 初始按轻量估算显示
        const initContent = String(entry.content || '');
        const initTokens = (initContent.match(/[\u4e00-\u9fff]/g) || []).length + Math.ceil(initContent.replace(/[\u4e00-\u9fff]/g, '').length / 4);
        entry.tokenEstimate = initTokens;
        tokens.textContent = `${initTokens} tok`;
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', String(index));
          e.dataTransfer.effectAllowed = 'move';
          row.classList.add('is-dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
        row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          if (!Number.isInteger(from) || from === index) return;
          const [moved] = entries.splice(from, 1);
          entries.splice(index, 0, moved);
          entries.forEach((rowEntry, i) => { rowEntry.uid = i + 1; rowEntry.order = i * 10; });
          updateSummary();
          renderRows();
        });
        row.append(handle, h('div', { class: 'gen-world-row__main' },
          h('div', { class: 'gen-world-row__top' }, comment, del),
          keys,
          content,
          h('div', { class: 'gen-world-row__foot' }, tokens, errLine),
        ));
        list.append(row);
      });
    };

    const addBtn = h('button', { class: 'btn btn--quiet gen-world-add', type: 'button' },
      icon('plus', { size: 16 }), '加一条');
    addBtn.addEventListener('click', () => {
      if (entries.length >= 15) {
        toast('最多 15 条；再多读者也记不住', { type: 'warn' });
        return;
      }
      entries.push({
        uid: entries.length + 1,
        key: [],
        comment: `新条目 ${entries.length + 1}`,
        content: '',
        position: 'before',
        order: entries.length * 10,
        tokenBudget: 0,
        recursive: false,
        selective: false,
        constant: false,
        probability: 100,
        caseSensitive: false,
        useRegex: false,
      });
      errors = validateWorldEntries(entries);
      updateSummary();
      renderRows();
    });

    const saveBtn = h('button', { class: 'btn btn--primary', type: 'button' }, icon('check', { size: 16 }), '存入世界书');
    saveBtn.addEventListener('click', async () => {
      errors = validateWorldEntries(entries);
      if (errors.size) {
        toastError('先把标红的 key 或空内容修好');
        return;
      }
      try {
        const saved = await ctx.repo.saveWorld({
          name: state.world.name,
          enabled: true,
          entries: entries.map((entry, index) => ({ ...entry, uid: index + 1, order: index * 10 })),
        });
        toast(`世界书「${saved.name}」已入库`, { type: 'success' });
        ctx.onWorldSaved?.(saved);
      } catch (err) {
        toastError(`保存失败：${err?.message || err}`);
      }
    });
    const publishBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, icon('upload', { size: 16 }), '发布');
    publishBtn.addEventListener('click', () => {
      errors = validateWorldEntries(entries);
      if (errors.size) {
        toastError('先把标红的条目修好再发布');
        return;
      }
      openPublishFlow({
        type: 'world',
        world: { ...state.world, entries },
        settings: liveSettings(),
        repo: ctx.repo,
        onPublished: (item) => {
          ctx.onPublished?.(item);
        },
      });
    });
    actions.append(saveBtn, publishBtn);

    renderRows();
    updateSummary();
    resultHost.append(
      h('div', { class: 'gen-result__head' },
        h('div', {}, h('span', { class: 'gen-draft-badge' }, '草稿 · 未入库'),
          h('h3', {}, '世界书条目'),
          h('p', {}, '表格里能直接改；拖 ⠿ 换顺序。')),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '收起草稿',
          onclick: () => { resultHost.hidden = true; },
        }, icon('chevronDown', { size: 18 }))),
      h('label', { class: 'gen-world-name-wrap' }, h('span', { class: 'gen-field__label' }, '世界书名称'), name),
      summary,
      list,
      addBtn,
      actions,
      h('p', { class: 'gen-warn' }, icon('warning', { size: 14 }), '空 key、重复 key、空内容会标红；content 建议不超过 200 token。'),
    );
  }

  function renderResult() {
    if (state.mode === 'card') renderCardResult();
    else renderWorldResult();
    if ((state.mode === 'card' && !state.card) || (state.mode === 'world' && !state.world)) resultHost.hidden = true;
  }

  function openCardTrial() {
    if (!state.card) return;
    if (trial) {
      trial.destroy();
      trial = null;
      overlay?.close();
    }
    const wrap = h('div', { class: 'ws-trial' });
    const head = h('div', { class: 'ws-trial__head' });
    const messages = h('div', { class: 'ws-trial__messages' });
    const hint = h('p', { class: 'ws-trial__hint' });
    const input = h('textarea', { class: 'field field--area ws-trial__input', rows: '2', placeholder: '试聊一句，不写入卡库…', 'aria-label': '试聊输入' });
    const sendBtn = h('button', { class: 'btn btn--primary ws-trial__send', type: 'button' }, icon('send', { size: 16 }), '发送');
    const footer = h('div', { class: 'ws-trial__actions' });
    wrap.append(head, messages, hint, h('div', { class: 'ws-trial__composer' }, input, sendBtn), footer);
    let closed = false;
    let sending = false;
    const sandbox = createTrialSandbox({
      repo: ctx.repo,
      settings: liveSettings(),
      card: state.card,
      title: `与${state.card.name || '新角色'}的试聊`,
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

    function closeTrial(discard = false) {
      if (closed) return;
      closed = true;
      if (discard) sandbox.discard();
      sandbox.destroy();
      if (trial === sandbox) trial = null;
      unsub();
      overlay?.close();
    }

    function render() {
      const snap = sandbox.snapshot();
      clear(head);
      head.append(
        h('div', { class: 'ws-trial__avatar ws-trial__avatar--text' }, (snap.card.name || '新').slice(0, 1)),
        h('div', {}, h('strong', {}, snap.card.name), h('span', {}, '未入库 · 试聊沙盒')),
      );
      clear(messages);
      snap.messages.forEach((msg) => {
        messages.append(h('div', { class: `ws-trial__msg ws-trial__msg--${msg.sender}` },
          h('div', { class: 'ws-trial__bubble' }, msg.text || (msg.sender === 'char' ? '…' : ''))));
      });
      if (!snap.messages.length) messages.append(h('p', { class: 'ws-trial__empty' }, '正在铺桌布…'));
      messages.scrollTop = messages.scrollHeight;
      hint.textContent = snap.error || (snap.state === 'streaming'
        ? '正在写下一句…'
        : `已试聊 ${snap.count} 条 · ${snap.canPromote ? '满意就转正' : '至少 3 条后才能转正'}`);
      hint.classList.toggle('is-error', Boolean(snap.error));
      sendBtn.disabled = snap.state === 'streaming' || sending;
      input.disabled = snap.state === 'streaming';
      clear(footer);
      const discard = h('button', { class: 'btn btn--ghost', type: 'button' }, '丢弃');
      discard.addEventListener('click', () => closeTrial(true));
      const promote = h('button', { class: 'btn btn--primary', type: 'button', disabled: !snap.canPromote },
        icon('check', { size: 16 }), '转正并开聊');
      promote.addEventListener('click', async () => {
        if (!snap.canPromote) return;
        promote.disabled = true;
        try {
          const result = await sandbox.promote();
          state.card = null;
          state.idea = '';
          await clearDraft();
          closeTrial(false);
          ctx.onPromoted?.(result.chat.id, result.card.id);
        } catch (err) {
          toastError(`转正失败：${err?.message || err}`);
          promote.disabled = false;
        }
      });
      footer.append(discard, promote);
    }

    overlay = openOverlay({
      title: '试聊间',
      subtitle: '满意再转正 · 不满意丢弃零残留',
      className: 'ws-trial-overlay',
      content: wrap,
      dismissible: true,
      onClose: () => {
        if (!closed) closeTrial(true);
      },
    });
    const unsub = sandbox.subscribe(render);
    render();
    sandbox.start().catch(() => {});
    const send = async () => {
      const text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      input.value = '';
      try {
        await sandbox.send(text);
      } catch (err) {
        toastError(`这句没送出去：${err?.message || err}`);
      } finally {
        sending = false;
        render();
      }
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
  }

  modeTabsRender();
  renderForm();
  renderResult();
  restoreDraft();

  return {
    unmount() {
      saveDraftNow();
      state.disposed = true;
      controller?.abort();
      trial?.destroy();
      trial = null;
      overlay?.close?.();
      root.remove();
    },
  };
}
