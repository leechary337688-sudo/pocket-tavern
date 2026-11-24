// mount-resolver — 世界书挂载解析（补丁 B）。
//
// 挂载点与优先级（数字越大越优先）：
//   chat(4) > persona(3) > character(2，含卡内嵌书) > global(1)
//
// 规则：
// - 一个世界一本书：单聊默认只挂“在场角色自己的内嵌书”，chat 级显式指定的书优先。
// - 全局挂载默认关闭；多本世界书是高级选项（settings.world.maxBooks > 1 且用户显式开启）。
// - 跨书同 key 冲突：order 大者后注入（后写覆盖先写），并在组装预览里高亮。

export const MOUNT_LEVELS = Object.freeze({
  chat: 4,
  persona: 3,
  character: 2,
  global: 1,
});

export const MOUNT_LABELS = Object.freeze({
  chat: '会话',
  persona: '人格',
  character: '角色',
  global: '全局',
});

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeKey(k) {
  return String(k || '').trim().toLowerCase();
}

/**
 * 解析出本次组装要用的世界书列表。
 * @param {object} input
 * @param {object} [input.chat]          会话对象（worldIds / memberIds / kind）
 * @param {object[]} [input.cards]       有资格参与的角色卡（单聊=当前卡；群聊=成员卡）
 * @param {object} [input.cardBooks]     { [cardId]: world }，卡的内嵌书
 * @param {object} [input.settings]      应用设置（world.globalEnabled/globalIds/maxBooks）
 * @param {object} [input.persona]       当前人格（worldIds）
 * @param {object[]} [input.worlds]      馆藏世界书全集
 * @returns {{worlds:object[], mounts:any[], conflicts:any[], capped:boolean, maxBooks:number, reason:string}}
 */
export function resolveMounts({
  chat = null,
  cards = [],
  cardBooks = {},
  settings = {},
  persona = null,
  worlds = [],
} = {}) {
  const byId = new Map();
  for (const w of worlds || []) if (w && w.id) byId.set(w.id, w);

  const isGroup = chat?.kind === 'group';
  const memberIds = asList(chat?.memberIds);
  const memberSet = new Set(memberIds);
  const mounts = [];
  const seen = new Set();

  const push = (world, level, extra = {}) => {
    if (!world || !world.id) return;
    if (world.enabled === false) {
      mounts.push({
        id: world.id,
        name: world.name,
        level,
        levelLabel: MOUNT_LABELS[level],
        included: false,
        reason: '这本世界书已停用',
        ...extra,
      });
      return;
    }
    const dedupeKey = world.id;
    if (seen.has(dedupeKey)) {
      const existing = mounts.find((m) => m.id === dedupeKey);
      if (existing) existing.alsoIn = [...(existing.alsoIn || []), MOUNT_LABELS[level]];
      return;
    }
    seen.add(dedupeKey);
    mounts.push({
      id: world.id,
      name: world.name || '未命名世界书',
      level,
      levelLabel: MOUNT_LABELS[level],
      included: true,
      reason: extra.reason || `${MOUNT_LABELS[level]}挂载`,
      hash: world.contentHash || '',
      scope: world.scope || 'library',
      ...extra,
    });
  };

  const worldCfg = settings?.world || {};
  const configuredMax = Math.max(1, Number(worldCfg.maxBooks) || 1);

  // 1) 会话级（最高优先级）。内嵌书由角色级自动激活，不当作会话主书重复挂。
  const chatWorldIds = asList(chat?.worldIds);
  const explicitChatIds = chatWorldIds.filter((id) => byId.get(id)?.scope !== 'embedded');
  for (const id of explicitChatIds) push(byId.get(id) || null, 'chat', { reason: '会话指定' });
  if (explicitChatIds.length) {
    for (const id of explicitChatIds) {
      if (!byId.has(id)) {
        mounts.push({ id, name: '（已删除的世界书）', level: 'chat', levelLabel: '会话', included: false, reason: '会话引用的书已不存在' });
      }
    }
  }

  // 2) 人格级
  for (const id of asList(persona?.worldIds)) push(byId.get(id) || null, 'persona', { reason: '人格指定' });

  // 3) 角色级（含内嵌书）。
  //    单聊：只有当前角色在场；群聊：只有成员在场。离场角色的书坚决不挂。
  for (const card of cards || []) {
    if (!card) continue;
    if (isGroup && !memberSet.has(card.id)) continue;
    const book = cardBooks?.[card.id];
    if (book) push(book, 'character', { reason: `${card.name || '角色'}的内嵌书`, cardId: card.id });
    for (const id of asList(card.worldIds)) {
      if (chatWorldIds.includes(id)) continue;
      push(byId.get(id) || null, 'character', { reason: `${card.name || '角色'}的私设`, cardId: card.id });
    }
  }

  // 也允许“只给了卡 id 没给卡对象”的调用方
  if (!cards?.length && !isGroup && chat?.cardId && cardBooks?.[chat.cardId]) {
    push(cardBooks[chat.cardId], 'character', { reason: '角色的内嵌书', cardId: chat.cardId });
  }

  // 4) 全局（默认关闭）
  if (worldCfg.globalEnabled) {
    for (const id of asList(worldCfg.globalIds)) push(byId.get(id) || null, 'global', { reason: '全局挂载' });
  }

  const included = mounts.filter((m) => m.included);
  // 一个世界一本书：maxBooks 限制“会话/人格/全局”这类显式挂载；
  // 角色内嵌书属于角色本身，随在场角色各带一本，不占主世界书名额。
  const maxBooks = Math.max(1, configuredMax);
  let capped = false;
  const characters = included.filter((m) => m.level === 'character');
  const explicit = included.filter((m) => m.level !== 'character');
  const allowed = [...characters];
  for (const mount of explicit.sort((a, b) => (MOUNT_LEVELS[b.level] || 0) - (MOUNT_LEVELS[a.level] || 0))) {
    const explicitCount = allowed.filter((m) => m.level !== 'character').length;
    if (explicitCount >= maxBooks) {
      capped = true;
      mount.included = false;
      mount.reason = `超出「一世界一本书」上限（${maxBooks} 本），未挂载`;
      continue;
    }
    allowed.push(mount);
  }

  const includedIds = new Set(allowed.map((m) => m.id));
  const resolved = mounts
    .filter((m) => includedIds.has(m.id))
    .map((m) => byId.get(m.id))
    .filter(Boolean);

  return {
    worlds: resolved,
    mounts,
    conflicts: findKeyConflicts(resolved),
    capped,
    maxBooks,
    reason: capped ? `一世界一本书：最多 ${maxBooks} 本` : '',
  };
}

/**
 * 找出跨书重复关键字的条目（用于组装预览高亮 + 冲突提示）。
 * @returns {{key:string, entries:{worldId:string,world:string,uid:any,order:number,comment:string}[], winner:any}[]}
 */
export function findKeyConflicts(worlds = []) {
  const map = new Map();
  for (const world of worlds || []) {
    for (const entry of world.entries || []) {
      if (entry.enabled === false) continue;
      for (const raw of entry.key || []) {
        const key = normalizeKey(raw);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({
          worldId: world.id,
          world: world.name || '未命名世界书',
          uid: entry.uid,
          order: Number(entry.order) || 0,
          comment: entry.comment || '',
          constant: Boolean(entry.constant),
        });
      }
    }
  }
  const out = [];
  for (const [key, entries] of map) {
    const worldsInvolved = new Set(entries.map((e) => e.worldId));
    if (worldsInvolved.size < 2) continue;
    // order 大者后注入 → 视为生效方
    const winner = [...entries].sort((a, b) => b.order - a.order)[0];
    out.push({ key, entries, winner });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** 组装预览用：把挂载结果压成一句人话。 */
export function describeMounts(result) {
  if (!result) return '';
  const list = (result.mounts || []).filter((m) => m.included);
  if (!list.length) {
    return result.mounts?.length ? '这次没有世界书参与组装' : '这次没有挂载任何世界书';
  }
  return list.map((m) => `${m.name}（${m.levelLabel}）`).join(' · ');
}
