// packer — .ptpack 打包与读取。零依赖 ZIP（store 模式）+ manifest。
// 只打包用户显式选择的卡/世界书，不读取设置、密钥或聊天。

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return encoder.encode(String(value ?? ''));
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0xff) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 生成只含 store 条目的 zip；文件名 UTF-8，足够 .ptpack 使用。 */
export function makeZip(files) {
  const now = dosDateTime();
  const entries = files.map((file) => ({
    name: toBytes(file.name),
    data: toBytes(file.data),
  }));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + entry.name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, entry.name.length, true);
    lv.setUint16(28, 0, true);
    local.set(entry.name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(entry.name, 46);
    centralParts.push(central);
    offset += local.length + entry.data.length;
  }
  const centralBytes = concat(centralParts);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralBytes.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return concat([...localParts, centralBytes, eocd]);
}

/** 读取 makeZip 产出的 store-only zip；不执行任何压缩库代码。 */
export function readZip(input) {
  const bytes = toBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 .ptpack（缺少 zip 目录）');
  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const files = new Map();
  let offset = centralOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ptpack 目录损坏');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
    if (method !== 0) throw new Error(`不支持的压缩条目：${name}`);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`ptpack 条目损坏：${name}`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + size > bytes.length) throw new Error(`ptpack 条目越界：${name}`);
    if (!name || name.includes('..') || name.startsWith('/')) throw new Error('ptpack 含非法文件名');
    files.set(name, bytes.slice(dataStart, dataStart + size));
    if (flags & 0x0008) throw new Error('不支持流式 zip 条目');
  }
  return files;
}

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value, null, 2));
}

function cleanCard(card) {
  const out = {};
  for (const key of [
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'creator', 'tags', 'avatar', 'spec', 'system_prompt', 'post_history_instructions',
    'alternate_greetings', 'character_book',
  ]) {
    if (card?.[key] !== undefined) out[key] = card[key];
  }
  out.tags = Array.isArray(out.tags) ? out.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  return out;
}

function cleanWorld(world) {
  return {
    name: String(world?.name || '未命名世界书'),
    enabled: world?.enabled !== false,
    entries: Array.isArray(world?.entries)
      ? world.entries.map((entry, index) => ({
          uid: entry.uid ?? index + 1,
          key: Array.isArray(entry.key) ? entry.key : [],
          keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
          comment: String(entry.comment || ''),
          content: String(entry.content || ''),
          position: entry.position === 'after' ? 'after' : 'before',
          order: Number(entry.order) || 0,
          tokenBudget: Number(entry.tokenBudget) || 0,
          recursive: Boolean(entry.recursive),
          selective: Boolean(entry.selective),
          constant: Boolean(entry.constant),
          probability: Math.min(100, Math.max(0, Number(entry.probability ?? 100))),
          caseSensitive: Boolean(entry.caseSensitive),
          useRegex: Boolean(entry.useRegex),
        }))
      : [],
  };
}

export function safeFilename(name, ext = 'ptpack') {
  const base = String(name || 'pockettavern-pack')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'pockettavern-pack';
  return ext ? `${base}.${ext}` : base;
}

/**
 * 构建 .ptpack。
 * @param {{type:'card'|'world'|'bundle', card?:object, world?:object, meta?:object}} input
 */
export function buildPack({ type = 'card', card = null, world = null, meta = {} } = {}) {
  const kind = ['card', 'world', 'bundle'].includes(type) ? type : 'card';
  if ((kind === 'card' || kind === 'bundle') && !card) throw new Error('没有可打包的角色卡');
  if ((kind === 'world' || kind === 'bundle') && !world) throw new Error('没有可打包的世界书');
  const payload = {};
  if (kind === 'card' || kind === 'bundle') payload['card.json'] = cleanCard(card);
  if (kind === 'world' || kind === 'bundle') payload['world.json'] = cleanWorld(world);
  const title = String(meta.title || card?.name || world?.name || '未命名作品').trim() || '未命名作品';
  const files = ['manifest.json', ...Object.keys(payload)];
  const id = String(meta.id || `pt-${kind}-${Date.now().toString(36)}`).replace(/[^\w.-]/g, '-');
  const manifest = {
    format: 'ptpack',
    type: kind,
    id,
    title,
    version: String(meta.version || '1.0.0').replace(/[^\w.+-]/g, '') || '1.0.0',
    author: String(meta.author || card?.creator || 'PocketTavern 用户').slice(0, 80),
    tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [],
    contentRating: meta.contentRating === 'mature' ? 'mature' : 'general',
    changelog: String(meta.changelog || '首个版本。').slice(0, 1000),
    description: String(meta.description || card?.description || '').slice(0, 600),
    files,
    createdAt: new Date().toISOString(),
  };
  const entries = [
    { name: 'manifest.json', data: jsonBytes(manifest) },
    ...Object.entries(payload).map(([name, value]) => ({ name, data: jsonBytes(value) })),
  ];
  const zip = makeZip(entries);
  return {
    manifest,
    files: payload,
    zip,
    blob: new Blob([zip], { type: 'application/zip' }),
    filename: safeFilename(title, 'ptpack'),
    size: zip.length,
  };
}

export async function parsePackFile(file) {
  const buffer = await file.arrayBuffer();
  return parsePackBytes(buffer);
}

export function parsePackBytes(buffer) {
  const files = readZip(buffer);
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) throw new Error('ptpack 缺少 manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    throw new Error('ptpack 的 manifest.json 不是合法 JSON');
  }
  if (!manifest || !['card', 'world', 'bundle'].includes(manifest.type)) throw new Error('ptpack 类型无效');
  const card = files.has('card.json') ? JSON.parse(decoder.decode(files.get('card.json'))) : null;
  const world = files.has('world.json') ? JSON.parse(decoder.decode(files.get('world.json'))) : null;
  if (manifest.type === 'card' && !card) throw new Error('ptpack 缺少 card.json');
  if (manifest.type === 'world' && !world) throw new Error('ptpack 缺少 world.json');
  return { manifest, card, world, files };
}

export function downloadPack(pack) {
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(pack.blob);
  anchor.href = url;
  anchor.download = pack.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
