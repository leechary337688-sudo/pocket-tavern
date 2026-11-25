// preset-picker — 显式载入预设世界；不自动写库，不碰现有会话。
import { h } from './dom.js';
import { openOverlay, confirmDialog } from './overlay.js';
import { toast, toastError } from './toast.js';
import { PRESET_INDEX, loadPreset, presetStatus, installPreset } from '../data/preset-loader.js';

export function openPresetPicker({ repo, onLoaded, onClose } = {}) {
  const list = h('div', { class: 'preset-list' });
  const note = h('p', { class: 'preset-note' }, '预设只在你点「载入」后写入本机；不会覆盖现有会话。重复载入会按内容判重，同版本直接跳过。');
  const content = h('div', { class: 'preset-picker' }, note, list);
  const overlay = openOverlay({
    title: '载入预设世界',
    subtitle: '一套世界一本书 + 一桌角色；载入后从卡库开聊',
    content,
    className: 'overlay__panel--presets',
    actions: [{ label: '关闭', kind: 'ghost' }],
    onClose,
  });

  function render() {
    list.replaceChildren();
    for (const meta of PRESET_INDEX) {
      const card = h('article', { class: 'preset-card' },
        h('div', { class: `preset-card__cover preset-card__cover--${meta.id}` }, h('span', {}, meta.cover)),
        h('div', { class: 'preset-card__body' },
          h('div', { class: 'preset-card__head' }, h('h3', {}, meta.title), h('span', { class: 'tag' }, meta.rating === 'mature' ? '18+' : '全年龄')),
          h('p', { class: 'preset-card__tagline' }, meta.tagline),
          h('p', { class: 'preset-card__desc' }, meta.subtitle),
          h('div', { class: 'preset-card__meta' }, h('span', { class: 'preset-status' }, '检查中…')),
          h('div', { class: 'preset-card__actions' },
            h('button', { class: 'btn btn--primary btn--small', type: 'button', onclick: () => load(meta, card) }, '载入这套世界'),
          ),
        ),
      );
      list.appendChild(card);
      refreshStatus(meta, card);
    }
  }

  async function refreshStatus(meta, card) {
    const statusEl = card.querySelector('.preset-status');
    const button = card.querySelector('button');
    try {
      const preset = await loadPreset(meta.id);
      const status = await presetStatus(repo, preset);
      const parts = [];
      if (status.world) parts.push(status.world.same ? '世界书已载入' : '世界书将更新');
      if (status.newCards) parts.push(`新增 ${status.newCards} 张卡`);
      if (status.updateCards?.length) parts.push(`更新 ${status.updateCards.length} 张卡`);
      if (!parts.length) parts.push('全新一套');
      statusEl.textContent = parts.join(' · ');
      statusEl.classList.toggle('is-ready', true);
      button.dataset.presetId = meta.id;
      card._preset = preset;
      card._status = status;
    } catch (err) {
      statusEl.textContent = '读取失败';
      statusEl.classList.add('is-error');
      button.disabled = true;
      console.warn('[pt] preset status', err);
    }
  }

  async function load(meta, card) {
    const button = card.querySelector('button');
    const statusEl = card.querySelector('.preset-status');
    try {
      const preset = card._preset || await loadPreset(meta.id);
      const status = card._status || await presetStatus(repo, preset);
      if (status.exists) {
        const ok = await confirmDialog({
          title: `《${meta.title}》已经在你的库里`,
          message: status.update
            ? '这套预设的本地内容与 0.4.0 版本不一致，会原位更新同名世界书与角色卡；现有聊天记录保留，不会被删除。'
            : '检测到相同内容，载入会直接复用已有世界书与角色卡，不会重复复制。',
          confirmText: status.update ? '更新到 0.4.0' : '继续载入',
        });
        if (!ok) return;
      }
      button.disabled = true;
      button.textContent = '正在摆桌…';
      const report = await installPreset(repo, preset, {
        onProgress: ({ index, total, label }) => { statusEl.textContent = `${label} · ${index}/${total}`; },
      });
      statusEl.textContent = `已就绪：世界书 ${report.world} · 新卡 ${report.cards} · 更新 ${report.updated} · 快捷回复 +${report.quickReplies}`;
      button.textContent = '已载入';
      button.classList.remove('btn--primary');
      toast(`《${meta.title}》已摆上桌`, { type: 'success' });
      onLoaded?.({ meta, preset, report });
      render();
    } catch (err) {
      button.disabled = false;
      button.textContent = '重新试试';
      toastError(`载入失败：${err.message || '未知错误'}`);
    }
  }

  render();
  return { close: overlay.close };
}
