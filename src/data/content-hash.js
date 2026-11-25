// content-hash — 内容指纹。SHA-256 取前 16 位十六进制。
// 用途：转正判重（同 hash 复用、同名不同 hash 让用户选）、查重合并工具、世界书列表短码。
//
// 设计要点：
// - 只哈希“内容”，不哈希 id / 时间戳 / 绑定关系，否则总是算不出相同 hash。
// - 图片（头像 / 封面）会被剥掉，避免 base64 抖动导致误判。
// - 世界书条目按稳定字段 + 排序键归一，保证条目顺序变化不影响 hash。

const STRIP_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'avatar',
  'cover',
  'contentHash',
  'installedAt',
  'builtin',
  'character_book',
  'character_book_id',
  'presetId',
  'extensions',
]);

const ENTRY_KEYS = [
  'key',
  'keysecondary',
  'comment',
  'content',
  'position',
  'order',
  'tokenBudget',
  'recursive',
  'selective',
  'constant',
  'probability',
  'caseSensitive',
  'useRegex',
];

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function trimStrings(value) {
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n').trim();
  if (Array.isArray(value)) return value.map(trimStrings);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimStrings(v);
    return out;
  }
  return value;
}

/** 世界书条目 → 可哈希的稳定形态。 */
export function canonicalEntries(entries) {
  const list = (Array.isArray(entries) ? entries : []).map((entry) => {
    const out = {};
    for (const key of ENTRY_KEYS) {
      const value = entry?.[key];
      out[key] = Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : value ?? null;
    }
    out.enabled = entry?.enabled !== false;
    return out;
  });
  // 用内容本身排序，而不是依赖数组顺序：同样的条目集合，顺序不同也算同一本
  list.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  return list;
}

/** 卡内容 → 可哈希形态（剥掉 id/时间/头像；内嵌书算内容）。 */
export function canonicalCard(card) {
  const out = {};
  for (const [key, value] of Object.entries(card || {})) {
    if (STRIP_KEYS.has(key)) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === '' || value === null || value === undefined) continue;
    out[key] = value;
  }
  if (Array.isArray(card?.character_book?.entries) && card.character_book.entries.length) {
    out.character_book = {
      name: String(card.character_book.name || '').trim(),
      entries: canonicalEntries(card.character_book.entries),
    };
  }
  return trimStrings(out);
}

/** 世界书内容 → 可哈希形态。 */
export function canonicalWorld(world) {
  const out = {};
  for (const [key, value] of Object.entries(world || {})) {
    if (STRIP_KEYS.has(key)) continue;
    if (key === 'entries') {
      out.entries = canonicalEntries(value);
      continue;
    }
    if (key === 'embeddedFor' || key === 'embedded_uid') continue;
    if (value === '' || value === null || value === undefined) continue;
    out[key] = value;
  }
  return trimStrings(out);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 兜底：非安全上下文（http）下没有 subtle，用 FNV-1a 变体填充到同样长度
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i += 1) {
    h1 ^= data[i];
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + data[i] * (i + 1)) >>> 0;
    h2 = Math.imul(h2, 2654435761) >>> 0;
  }
  const a = h1.toString(16).padStart(8, '0');
  const b = h2.toString(16).padStart(8, '0');
  return (a + b + a + b).slice(0, 64);
}

/** 任意对象 → 16 位内容指纹。 */
export async function contentHash(value, kind = 'card') {
  const canonical = kind === 'world' ? canonicalWorld(value) : canonicalCard(value);
  const hex = await sha256Hex(stableStringify(canonical));
  return hex.slice(0, 16);
}

export async function hashCard(card) {
  return contentHash(card, 'card');
}

export async function hashWorld(world) {
  return contentHash(world, 'world');
}

/** 展示用短码：8 位 → `#a1b2c3d4`。 */
export function shortHash(hash) {
  const value = String(hash || '');
  return value ? `#${value.slice(0, 8)}` : '';
}
