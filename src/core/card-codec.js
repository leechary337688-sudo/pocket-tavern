// card-codec — 角色卡导入/导出：PNG tEXt（ccv3 / chara）+ JSON；零依赖。

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function u32(view, offset) {
  return view.getUint32(offset, false);
}

function readKeyword(bytes) {
  const nul = bytes.indexOf(0);
  if (nul < 0) return null;
  const keyword = new TextDecoder('latin1').decode(bytes.subarray(0, nul));
  const textBytes = bytes.subarray(nul + 1);
  return { keyword, textBytes };
}

function base64ToUtf8(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  let binary;
  try {
    binary = atob(clean);
  } catch {
    try {
      return decodeURIComponent(clean);
    } catch {
      throw new Error('角色卡数据不是合法的 base64');
    }
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeCardPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('角色卡数据为空');
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    try {
      json = JSON.parse(base64ToUtf8(raw));
    } catch {
      try {
        json = JSON.parse(decodeURIComponent(raw));
      } catch {
        throw new Error('角色卡数据无法解析为 JSON');
      }
    }
  }
  if (!json || typeof json !== 'object') throw new Error('角色卡数据不是对象');
  return json;
}

async function inflateZlib(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  } catch {
    return null;
  }
}

/** 从 PNG 里读 ccv3 / chara 文本块 */
export async function readPngCardText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) throw new Error('不是有效的 PNG');
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) throw new Error('不是有效的 PNG 文件');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  const found = [];
  while (off + 8 <= bytes.length) {
    const len = u32(view, off);
    const typeBytes = bytes.subarray(off + 4, off + 8);
    const type = new TextDecoder('latin1').decode(typeBytes);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'tEXt') {
      const parsed = readKeyword(data);
      if (parsed) found.push({ keyword: parsed.keyword, textBytes: parsed.textBytes, type });
    } else if (type === 'iTXt') {
      // keyword\0 compressionFlag compressionMethod languageTag\0 translated\0 text
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = new TextDecoder('latin1').decode(data.subarray(0, nul));
        const compressionFlag = data[nul + 1];
        const rest = data.subarray(nul + 2);
        if (compressionFlag === 0) {
          const langEnd = rest.indexOf(0);
          const transEnd = rest.indexOf(0, langEnd + 1);
          found.push({ keyword, textBytes: rest.subarray(transEnd + 1), type: 'iTXt' });
        }
      }
    } else if (type === 'zTXt') {
      const parsed = readKeyword(data);
      if (parsed && parsed.textBytes[0] === 0) {
        const inflated = await inflateZlib(parsed.textBytes.subarray(1));
        if (inflated) found.push({ keyword: parsed.keyword, textBytes: new Uint8Array(inflated), type: 'zTXt' });
      }
    }
    if (type === 'IEND') break;
    off = dataEnd + 4;
  }
  const card = found.find((f) => f.keyword === 'ccv3') || found.find((f) => f.keyword === 'chara');
  if (!card) return null;
  const text = new TextDecoder('utf-8').decode(card.textBytes).replace(/\0+$/, '');
  return { keyword: card.keyword, text, json: decodeCardPayload(text) };
}

/**
 * character_book（CCv3 内嵌世界书）→ 宿主世界书条目。
 * 支持 V3 的 keys / secondary_keys / insertion_order / constant / enabled 等原始字段名。
 */
export function normalizeCharacterBook(book) {
  if (!book || typeof book !== 'object') return null;
  const rawEntries = Array.isArray(book.entries) ? book.entries : [];
  const entries = rawEntries
    .filter((e) => e && typeof e === 'object')
    .map((e, index) => {
      const keys = e.keys ?? e.key;
      const secondary = e.secondary_keys ?? e.keysecondary;
      return {
        uid: Number(e.id ?? e.uid ?? index + 1) || index + 1,
        key: (Array.isArray(keys) ? keys : String(keys || '').split(/[,，]/)).map((k) => String(k).trim()).filter(Boolean),
        keysecondary: (Array.isArray(secondary) ? secondary : String(secondary || '').split(/[,，]/))
          .map((k) => String(k).trim())
          .filter(Boolean),
        comment: String(e.comment ?? e.name ?? e.title ?? ''),
        content: String(e.content ?? ''),
        position: e.position === 'after' ? 'after' : 'before',
        order: Number(e.insertion_order ?? e.order) || 0,
        tokenBudget: Number(e.token_budget ?? e.tokenBudget) || 0,
        recursive: Boolean(e.recursive),
        selective: Boolean(e.selective),
        constant: Boolean(e.constant),
        probability: Math.min(100, Math.max(0, Number(e.probability ?? 100))),
        caseSensitive: Boolean(e.case_sensitive ?? e.caseSensitive),
        useRegex: Boolean(e.useRegex),
        enabled: e.enabled !== false,
      };
    });
  return {
    id: String(book.id || ''),
    name: String(book.name || '内嵌世界书').trim() || '内嵌世界书',
    description: String(book.description || ''),
    scanDepth: Number(book.scan_depth) || 0,
    tokenBudget: Number(book.token_budget) || 0,
    recursive: Boolean(book.recursive),
    entries,
    source: 'card',
  };
}

/** 宿主世界书 → character_book（导出进卡时使用）。 */
export function toCharacterBook(book) {
  if (!book || !Array.isArray(book.entries)) return undefined;
  return {
    name: String(book.name || '内嵌世界书'),
    description: String(book.description || ''),
    scan_depth: Number(book.scanDepth) || undefined,
    token_budget: Number(book.tokenBudget) || undefined,
    recursive: Boolean(book.recursive),
    entries: book.entries.map((e, index) => ({
      id: Number(e.uid) || index + 1,
      keys: Array.isArray(e.key) ? e.key : [],
      secondary_keys: Array.isArray(e.keysecondary) ? e.keysecondary : [],
      comment: String(e.comment || ''),
      content: String(e.content || ''),
      constant: Boolean(e.constant),
      selective: Boolean(e.selective),
      insertion_order: Number(e.order) || 0,
      enabled: e.enabled !== false,
      position: e.position === 'after' ? 'after' : 'before',
      case_sensitive: Boolean(e.caseSensitive),
      use_regex: Boolean(e.useRegex),
      probability: Number(e.probability ?? 100),
      token_budget: Number(e.tokenBudget) || undefined,
    })),
  };
}

export function normalizeCard(raw, { avatar = '' } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('角色卡内容为空');
  const d = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const spec = String(raw.spec || d.spec || 'chara_card_v2');
  const name = String(d.name || d.char_name || '').trim();
  if (!name) throw new Error('角色卡缺少 name 字段');
  let tags = d.tags;
  if (typeof tags === 'string') tags = tags.split(/[,，]/);
  if (!Array.isArray(tags)) tags = [];
  const alternates = Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(String).filter(Boolean) : [];
  const card = {
    id: '',
    name,
    description: String(d.description || ''),
    personality: String(d.personality || ''),
    scenario: String(d.scenario || ''),
    first_mes: String(d.first_mes || d.greeting || ''),
    mes_example: String(d.mes_example || d.example_dialogue || ''),
    creator: String(d.creator || d.author || ''),
    tags: tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 32),
    avatar: String(avatar || d.avatar || ''),
    system_prompt: String(d.system_prompt || ''),
    post_history_instructions: String(d.post_history_instructions || ''),
    alternate_greetings: alternates,
    spec: spec.includes('v3') ? 'chara_card_v3' : 'chara_card_v2',
    spec_version: String(raw.spec_version || d.spec_version || '2.0'),
    character_book: normalizeCharacterBook(d.character_book) || null,
    character_book_id: String(d.extensions?.pockettavern?.character_book_id || ''),
  };
  if (!card.first_mes && alternates.length) card.first_mes = alternates[0];
  return card;
}

async function shrinkImage(dataUrl, max = 512) {
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = dataUrl;
    });
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const size = Math.min(max, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    let out = canvas.toDataURL('image/webp', 0.9);
    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.9);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

function bufferToDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function parseCardFile(file) {
  if (!file) throw new Error('没有选择文件');
  if (file.size > 30 * 1024 * 1024) throw new Error('文件超过 30MB');
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const isPng = head.length === 8 && PNG_SIG.every((b, i) => head[i] === b);
  if (isPng) {
    const png = await readPngCardText(buf);
    if (!png) throw new Error('这张 PNG 没有 ccv3 / chara 角色卡信息');
    const avatar = await shrinkImage(bufferToDataUrl(buf, 'image/png'), 512);
    return { card: normalizeCard(png.json, { avatar }), keyword: png.keyword, source: 'png' };
  }
  const text = new TextDecoder('utf-8').decode(buf);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 PNG 角色卡或 JSON 文件');
  }
  return { card: normalizeCard(json), source: 'json' };
}

// ---------- 导出 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const len = data.length;
  const out = new Uint8Array(12 + len);
  const view = new DataView(out.buffer);
  view.setUint32(0, len, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + len);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + len, crc32(crcInput), false);
  return out;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function injectPngText(pngBytes, keyword, text) {
  const bytes = new Uint8Array(pngBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const textData = new Uint8Array(keyword.length + 1 + text.length);
  textData.set(new TextEncoder().encode(keyword), 0);
  textData[keyword.length] = 0;
  textData.set(new TextEncoder().encode(text), keyword.length + 1);
  const chunk = makeChunk('tEXt', textData);
  const parts = [bytes.subarray(0, 8)];
  let off = 8;
  let inserted = false;
  while (off + 8 <= bytes.length) {
    const len = u32(view, off);
    const type = new TextDecoder('latin1').decode(bytes.subarray(off + 4, off + 8));
    const total = 12 + len;
    if (type === 'IEND' && !inserted) {
      parts.push(chunk);
      inserted = true;
    }
    parts.push(bytes.subarray(off, off + total));
    off += total;
    if (type === 'IEND') break;
  }
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

export function cardToV2(card) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: card.name,
      description: card.description || '',
      personality: card.personality || '',
      scenario: card.scenario || '',
      first_mes: card.first_mes || '',
      mes_example: card.mes_example || '',
      creator: card.creator || '',
      creator_notes: '',
      system_prompt: card.system_prompt || '',
      post_history_instructions: card.post_history_instructions || '',
      alternate_greetings: card.alternate_greetings || [],
      tags: card.tags || [],
      character_version: '1.0',
      extensions: {},
    },
  };
}

export function cardToV3(card) {
  const book = card.character_book || null;
  const base = cardToV2(card);
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...base.data,
      group_only_greetings: [],
      nickname: card.nickname || '',
      creator_notes_multilingual: {},
      source: [],
      creation_date: card.createdAt ? Math.floor(new Date(card.createdAt).getTime() / 1000) || undefined : undefined,
      modification_date: Math.floor(Date.now() / 1000),
      character_book: book ? toCharacterBook(book) : undefined,
      extensions: {
        pockettavern: {
          character_book_id: card.character_book_id || '',
          embedded: Boolean(book),
        },
      },
    },
  };
}

async function drawCardImage(card) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 768);
  grad.addColorStop(0, '#2B1D13');
  grad.addColorStop(1, '#17110D');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 768);
  if (card.avatar) {
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = card.avatar;
      });
      const scale = Math.max(512 / img.width, 768 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (512 - w) / 2, (768 - h) / 2, w, h);
    } catch {
      /* keep gradient */
    }
  }
  ctx.fillStyle = 'rgba(23,17,13,0.72)';
  ctx.fillRect(0, 600, 512, 168);
  ctx.fillStyle = '#EFE6DA';
  ctx.font = 'bold 44px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(card.name.slice(0, 12), 32, 674);
  ctx.fillStyle = '#E8A33D';
  ctx.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText((card.tags || []).slice(0, 3).join(' · ') || 'PocketTavern', 32, 716);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

export async function exportCardPng(card) {
  const blob = await drawCardImage(card);
  const buf = await blob.arrayBuffer();
  // 有内嵌书时用 ccv3 关键字（CCv3 规范），否则维持 chara 以兼容老工具
  const useV3 = Boolean(card.character_book);
  const json = JSON.stringify(useV3 ? cardToV3(card) : cardToV2(card));
  const png = injectPngText(buf, useV3 ? 'ccv3' : 'chara', utf8ToBase64(json));
  return new Blob([png], { type: 'image/png' });
}

export function exportCardJson(card, { v3 = null } = {}) {
  const useV3 = v3 === null ? Boolean(card.character_book) : v3;
  return new Blob([JSON.stringify(useV3 ? cardToV3(card) : cardToV2(card), null, 2)], { type: 'application/json' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(name, ext) {
  const base = String(name || 'character').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
  return `${base || 'character'}${ext ? `.${ext}` : ''}`;
}
