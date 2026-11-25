// preset-loader — 内置预设世界的读取、判重与显式写入。
// 预设不会在启动/引导时偷偷写库；只有用户点“载入”才调用 installPreset。

import { hashCard, hashWorld } from '../data/content-hash.js';

const PRESET_BASE = new URL('../../assets/presets/', import.meta.url);
const INSTALL_NS = '__presets';
const INSTALL_KEY = 'installed';

/** 预设索引：只放元信息，避免列表页加载整包。 */
export const PRESET_INDEX = [
  {
    id: 'fog-harbor',
    title: '雾港夜雨',
    subtitle: '一桩失踪案，四段各怀心事的雨夜。',
    rating: 'general',
    cover: '🌧️',
    tagline: '男性向 · 悬疑 / 情感',
  },
  {
    id: 'phoenix-palace',
    title: '凤阙春深',
    subtitle: '替亡兄入朝的女史官，在凤阙里查一桩旧案。',
    rating: 'general',
    cover: '🏮',
    tagline: '女性向 · 权谋 / 情感',
  },
];

export function presetMeta(id) {
  return PRESET_INDEX.find((item) => item.id === id) || null;
}

export async function loadPreset(id) {
  if (!presetMeta(id)) throw new Error('没有这套预设');
  const res = await fetch(new URL(`${id}.json`, PRESET_BASE), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`预设读取失败（${res.status}）`);
  const preset = await res.json();
  if (!preset || !preset.world || !Array.isArray(preset.cards)) throw new Error('预设文件结构不完整');
  return preset;
}

function sameHash(a, b) {
  return Boolean(a && b && String(a) === String(b));
}

async function installedState(repo) {
  const saved = await repo.extGet(INSTALL_NS, INSTALL_KEY);
  return saved && typeof saved === 'object' ? saved : {};
}

async function saveInstalled(repo, state) {
  await repo.extSet(INSTALL_NS, INSTALL_KEY, state);
}

/** 现有库中这套预设的落点与版本状态。 */
export async function presetStatus(repo, preset) {
  const [worlds, cards] = await Promise.all([repo.listWorlds(), repo.listCards()]);
  const world = worlds.find((w) => w.presetId === preset.id || w.name === preset.world.name) || null;
  const worldHash = await hashWorld(preset.world);
  const matchedCards = [];
  const updates = [];
  for (const raw of preset.cards) {
    const existing = cards.find((c) => c.presetId === preset.id && c.name === raw.name) || cards.find((c) => c.name === raw.name);
    const hash = await hashCard(raw);
    if (!existing) {
      matchedCards.push({ name: raw.name, status: 'new' });
      continue;
    }
    if (sameHash(existing.contentHash, hash)) {
      matchedCards.push({ name: raw.name, status: 'same', id: existing.id });
    } else {
      matchedCards.push({ name: raw.name, status: 'update', id: existing.id });
      updates.push(raw.name);
    }
  }
  return {
    id: preset.id,
    exists: Boolean(world) || matchedCards.some((c) => c.status !== 'new'),
    update: Boolean(world && !sameHash(world.contentHash, worldHash)) || updates.length > 0,
    world: world ? { id: world.id, name: world.name, same: sameHash(world.contentHash, worldHash) } : null,
    cards: matchedCards,
    newCards: matchedCards.filter((c) => c.status === 'new').length,
    updateCards: updates,
    installed: Boolean((await installedState(repo))[preset.id]),
  };
}

/**
 * 写入一套预设。显式调用；同内容跳过，同预设旧版本原位更新。
 * @param {object} repo
 * @param {object} preset
 * @param {{onProgress?: (p:{index:number,total:number,label:string})=>void}} opts
 */
export async function installPreset(repo, preset, { onProgress } = {}) {
  const [worlds, cards] = await Promise.all([repo.listWorlds(), repo.listCards()]);
  const report = { world: 'skipped', cards: 0, updated: 0, skipped: 0, quickReplies: 0 };
  const total = 1 + preset.cards.length + 1;
  const tick = (index, label) => onProgress?.({ index, total, label });

  const worldHash = await hashWorld(preset.world);
  let world = worlds.find((w) => w.presetId === preset.id || w.name === preset.world.name) || null;
  if (!world) {
    tick(0, `摆放 ${preset.world.name}`);
    world = await repo.saveWorld({
      ...preset.world,
      presetId: preset.id,
      scope: 'library',
      embeddedFor: [],
      enabled: true,
      contentHash: worldHash,
    });
    report.world = 'created';
  } else if (!sameHash(world.contentHash, worldHash)) {
    tick(0, `更新 ${preset.world.name}`);
    world = await repo.saveWorld({
      ...preset.world,
      id: world.id,
      presetId: preset.id,
      scope: 'library',
      embeddedFor: [],
      enabled: true,
      contentHash: worldHash,
    });
    report.world = 'updated';
  }

  for (let i = 0; i < preset.cards.length; i += 1) {
    const raw = preset.cards[i];
    const existing = cards.find((c) => c.presetId === preset.id && c.name === raw.name) || cards.find((c) => c.name === raw.name);
    const hash = await hashCard(raw);
    if (existing && sameHash(existing.contentHash, hash)) {
      report.skipped += 1;
      tick(i + 1, `跳过 ${raw.name}`);
      continue;
    }
    tick(i + 1, `${existing ? '更新' : '摆上'} ${raw.name}`);
    const payload = {
      ...raw,
      presetId: preset.id,
      ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
    };
    await repo.saveCard(payload, { saveBook: true });
    if (existing) report.updated += 1;
    else report.cards += 1;
  }

  const settings = repo.settings || {};
  const quick = Array.isArray(settings.quickReplies) ? settings.quickReplies : [];
  const next = [...quick];
  for (let i = 0; i < (preset.quickReplies || []).length; i += 1) {
    const item = preset.quickReplies[i];
    const id = `preset-${preset.id}-${i + 1}`;
    if (next.some((q) => q.id === id)) continue;
    next.push({ id, label: String(item.label || '预设'), text: String(item.text || '') });
    report.quickReplies += 1;
  }
  if (next.length !== quick.length) await repo.saveSettings({ quickReplies: next });

  const state = await installedState(repo);
  state[preset.id] = {
    title: preset.title || preset.id,
    version: preset.version || '0.4.0',
    installedAt: new Date().toISOString(),
    worldId: world?.id || '',
    cards: preset.cards.length,
  };
  await saveInstalled(repo, state);
  tick(total, '摆好了');
  return { ...report, worldId: world?.id || '', state };
}
