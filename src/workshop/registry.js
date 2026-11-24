// registry — 创意工坊数据源：内置演示 + 本地发布 + 用户自托管端点。
// 远程请求只发往 settings.workshop.remoteUrl；不携带 API Key，也没有账号体系。
import { buildPack } from './packer.js';
import { hashCard, hashWorld } from '../data/content-hash.js';

const STORE_ID = '__workshop';
const STORE_KEY = 'state';
const CACHE_LIMIT = 60;

function coverSvg(a, b, accent) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx="72%" cy="18%" r="70%"><stop offset="0" stop-color="${accent}" stop-opacity=".5"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
<rect width="240" height="320" fill="url(#g)"/><rect width="240" height="320" fill="url(#r)"/>
<circle cx="120" cy="132" r="48" fill="none" stroke="${accent}" stroke-width="1.4" opacity=".55"/>
<path d="M92 112h56l-8 58c-2 14-38 14-40 0z" fill="${accent}" opacity=".82"/>
<path d="M108 170h24v28h-24z" fill="${accent}" opacity=".45"/>
<path d="M94 204h52" stroke="${accent}" stroke-width="7" stroke-linecap="round" opacity=".62"/>
<path d="M164 48l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" fill="${accent}" opacity=".75"/>
<text x="120" y="276" text-anchor="middle" fill="${accent}" font-family="serif" font-size="13" opacity=".72">POCKET TAVERN</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, ' ').trim())}`;
}

const COVER_CARD = coverSvg('#2A2018', '#5A3820', '#E8A33D');
const COVER_WORLD = coverSvg('#1B2420', '#3F4B3E', '#C7B27A');
const COVER_BUNDLE = coverSvg('#251A25', '#4B2D3F', '#D99A8C');

const DEMO_CARD = {
  name: '雾港的薇拉',
  description: '雾港旧书店的年轻书商，总在柜台后修补被潮气泡皱的航海日志。她记得每本书原来的主人，也记得谁欠了书钱。',
  personality: '冷静、嘴硬、好奇心重。对陌生人先保持距离，聊到书籍和旧地图时会不自觉凑近。讨厌把书当装饰的人。',
  scenario: '雾港连续下了三天雨。你推门进旧书店，想把一封没有署名的信交给店主。',
  first_mes: '（她把一本摊开的航海日志合上，抬头时眼镜滑到鼻尖。）\n\n「今天不卖书。雨太大，书会受潮。」\n\n（她看了你手里的信一眼，手指停在柜台边缘。）\n\n「不过……如果你要找的不是书，是收信的人，那我可以听你说完。」',
  mes_example: '<START>\n{{user}}: 你认识这个印章吗？\n{{char}}: （薇拉把信翻过来，用指腹蹭了蹭火漆）「认识。雾港旧海关的章，二十年前就停用了。」（她抬眼看你）「你从哪儿弄来的？」',
  tags: ['雾港', '书商', '悬疑', '慢热'],
  creator: 'PocketTavern 示例工坊',
};

const DEMO_WORLD = {
  name: '雾港城设定集',
  enabled: true,
  entries: [
    { uid: 1, key: ['雾港'], comment: '雾港', content: '雾港是一座常年被海雾笼罩的旧港口城市。石阶从码头一直铺到山上，路灯用鲸油，入夜后像一串昏黄的珠子。', position: 'before' },
    { uid: 2, key: ['旧海关'], comment: '旧海关', content: '旧海关在雾港东侧，二十年前因走私案关闭。档案室的门锁生锈，窗台上还留着半截蜡烛。', position: 'before' },
    { uid: 3, key: ['薇拉的书店'], comment: '旧书店', content: '薇拉的旧书店叫「潮汐页」，门楣上挂着一枚铜书签。店里最深处有一扇通往地下书库的门，只有她知道钥匙在哪。', position: 'before' },
    { uid: 4, key: ['火漆印章'], comment: '火漆印章', content: '雾港旧海关的印章是深蓝色火漆，图案为一枚锚与两行小字。二十年前的走私案后，这枚印章本应全部销毁。', position: 'before' },
    { uid: 5, key: ['潮汐页'], comment: '书店规矩', content: '「潮汐页」有一条规矩：不卖没有主人的书。薇拉会为每本书等一个能说出它来历的人，等不到就放进地下书库。', position: 'before' },
    { uid: 6, key: ['地下书库'], comment: '地下书库', content: '地下书库没有窗户，空气里有盐和旧纸的味道。最里面有一只上锁的木箱，箱盖上刻着一艘没有名字的船。', position: 'before' },
  ],
};

const DEMO_ITEMS = [
  {
    id: 'ws-demo-fog-card',
    type: 'card',
    title: '雾港的薇拉',
    author: 'PocketTavern 示例工坊',
    tags: ['雾港', '书商', '悬疑'],
    rating: 4.8,
    downloads: 1280,
    version: '1.0.0',
    contentRating: 'general',
    description: '旧书店、潮汐页和一枚不该存在的海关印章。',
    changelog: '示例工坊首个角色。',
    cover: COVER_CARD,
    publishedAt: '2026-11-10T12:00:00.000Z',
    card: DEMO_CARD,
  },
  {
    id: 'ws-demo-fog-world',
    type: 'world',
    title: '雾港城设定集',
    author: 'PocketTavern 示例工坊',
    tags: ['雾港', '世界书', '悬疑'],
    rating: 4.6,
    downloads: 860,
    version: '1.1.0',
    contentRating: 'general',
    description: '六条可直接触发的雾港设定：旧海关、潮汐页、地下书库。',
    changelog: '补上「地下书库」触发条目。',
    cover: COVER_WORLD,
    publishedAt: '2026-11-12T12:00:00.000Z',
    world: DEMO_WORLD,
  },
  {
    id: 'ws-demo-fog-bundle',
    type: 'bundle',
    title: '雾港雨夜套装',
    author: 'PocketTavern 示例工坊',
    tags: ['雾港', '套装', '悬疑'],
    rating: 4.9,
    downloads: 430,
    version: '1.0.0',
    contentRating: 'general',
    description: '角色卡 + 六条世界书，试穿后一起转正。',
    changelog: '首发套装。',
    cover: COVER_BUNDLE,
    publishedAt: '2026-11-15T12:00:00.000Z',
    card: DEMO_CARD,
    world: DEMO_WORLD,
  },
];

function normalizeTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  return String(raw || '').split(/[,，、#]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
}

function normalizeItem(raw, source = 'demo') {
  if (!raw || typeof raw !== 'object') return null;
  const card = raw.card && typeof raw.card === 'object' ? raw.card : null;
  const world = raw.world && typeof raw.world === 'object' ? raw.world : null;
  const type = ['card', 'world', 'bundle'].includes(raw.type) ? raw.type : card ? 'card' : world ? 'world' : 'card';
  const id = String(raw.id || raw.packId || '').trim();
  if (!id) return null;
  const title = String(raw.title || card?.name || world?.name || raw.name || '未命名作品').trim();
  return {
    id,
    type,
    title,
    author: String(raw.author || card?.creator || '匿名酒客').slice(0, 80),
    tags: normalizeTags(raw.tags),
    rating: Math.max(0, Math.min(5, Number(raw.rating) || 0)),
    downloads: Math.max(0, Number(raw.downloads ?? raw.downloadCount ?? 0) || 0),
    version: String(raw.version || '1.0.0'),
    contentRating: raw.contentRating === 'mature' ? 'mature' : 'general',
    description: String(raw.description || card?.description || world?.name || '').slice(0, 600),
    changelog: String(raw.changelog || '').slice(0, 1000),
    cover: raw.cover || card?.avatar || (type === 'world' ? COVER_WORLD : COVER_CARD),
    publishedAt: raw.publishedAt || raw.createdAt || new Date().toISOString(),
    card,
    world,
    source,
  };
}

function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.+-]/).map((n) => Number(n) || 0);
  const pb = String(b || '0').split(/[.+-]/).map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

async function readState(repo) {
  const rec = (await repo.extGet(STORE_ID, STORE_KEY)) || {};
  return {
    installed: Array.isArray(rec.installed) ? rec.installed : [],
    published: Array.isArray(rec.published) ? rec.published : [],
    cache: Array.isArray(rec.cache) ? rec.cache : [],
  };
}

async function writeState(repo, state) {
  await repo.extSet(STORE_ID, STORE_KEY, {
    installed: state.installed.slice(0, 300),
    published: state.published.slice(0, 100),
    cache: state.cache.slice(0, CACHE_LIMIT),
  });
}

function remoteBase(settings) {
  if (settings?.workshop?.remoteEnabled === false) return '';
  return String(settings?.workshop?.remoteUrl || '').trim().replace(/\/+$/, '');
}

function endpoint(settings, path) {
  const base = remoteBase(settings);
  return base ? `${base}${path}` : '';
}

async function fetchJson(url, { method = 'GET', body, headers = {}, signal, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method,
      body,
      headers,
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`工坊端点 HTTP ${res.status}`);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('工坊端点返回的不是 JSON');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function listFromPayload(payload) {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  return raw.map((item) => normalizeItem(item, 'remote')).filter(Boolean);
}

export const WORKSHOP_DEMO_ITEMS = DEMO_ITEMS.map((item) => normalizeItem(item, 'demo'));

/**
 * 工坊列表。远程失败不抛错：回退到缓存/演示/本地发布，并返回 offline 标记。
 */
export async function listWorkshop({ repo, settings, type = '', q = '', sort = 'new', includeMature = false, signal } = {}) {
  const state = await readState(repo);
  const base = remoteBase(settings);
  let remote = [];
  let offline = false;
  let remoteError = '';
  if (base) {
    try {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (q) params.set('q', q);
      params.set('sort', sort);
      const payload = await fetchJson(`${base}/api/list?${params.toString()}`, { signal });
      remote = listFromPayload(payload);
      state.cache = remote.slice(0, CACHE_LIMIT);
      await writeState(repo, state);
    } catch (err) {
      offline = true;
      remoteError = err?.name === 'AbortError' ? '请求已取消' : String(err?.message || err);
      remote = (state.cache || []).map((item) => normalizeItem(item, 'cache')).filter(Boolean);
    }
  }

  const includeDemo = settings?.workshop?.demoSource !== false;
  const merged = new Map();
  const add = (item) => {
    if (item && !merged.has(item.id)) merged.set(item.id, item);
  };
  // 本地发布优先，其次是远程，最后是演示源；同 id 不重复。
  state.published.forEach((item) => add(normalizeItem(item, 'local')));
  remote.forEach(add);
  if (includeDemo) WORKSHOP_DEMO_ITEMS.forEach(add);

  let items = [...merged.values()];
  if (type) items = items.filter((item) => item.type === type);
  if (!includeMature) items = items.filter((item) => item.contentRating !== 'mature');
  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    items = items.filter((item) =>
      [item.title, item.author, item.description, ...(item.tags || [])].join(' ').toLowerCase().includes(needle),
    );
  }
  if (sort === 'hot') items.sort((a, b) => b.downloads - a.downloads);
  else if (sort === 'rating') items.sort((a, b) => b.rating - a.rating);
  else items.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));

  return {
    items,
    offline,
    remoteEnabled: Boolean(base),
    source: base ? (offline ? 'cache' : 'remote') : 'local',
    remoteError,
    installed: state.installed,
  };
}

export async function getWorkshopItem({ repo, settings, id, signal } = {}) {
  const base = remoteBase(settings);
  if (base) {
    try {
      const payload = await fetchJson(`${base}/api/item/${encodeURIComponent(id)}`, { signal });
      const item = normalizeItem(payload?.item || payload, 'remote');
      if (item) return item;
    } catch {
      /* 回退到本地缓存/演示 */
    }
  }
  const state = await readState(repo);
  const local = state.published.map((item) => normalizeItem(item, 'local')).find((item) => item?.id === id);
  if (local) return local;
  const cached = state.cache.map((item) => normalizeItem(item, 'cache')).find((item) => item?.id === id);
  if (cached) return cached;
  return WORKSHOP_DEMO_ITEMS.find((item) => item.id === id) || null;
}

/** 发布：有远程端点走 POST /api/publish；否则落到本地演示工坊。 */
export async function publishPack({ repo, settings, pack, signal } = {}) {
  if (!pack?.zip || !pack.manifest) throw new Error('没有可发布的 .ptpack');
  const manifest = pack.manifest;
  const base = remoteBase(settings);
  if (base) {
    const payload = await fetchJson(`${base}/api/publish`, {
      method: 'POST',
      body: pack.zip,
      headers: { 'Content-Type': 'application/zip' },
      signal,
      timeoutMs: 20000,
    });
    const item = normalizeItem(payload?.item || payload, 'remote');
    if (!item) throw new Error('工坊端点没有返回作品信息');
    return item;
  }

  const state = await readState(repo);
  const item = normalizeItem({
    id: manifest.id,
    type: manifest.type,
    title: manifest.title,
    author: manifest.author,
    tags: manifest.tags,
    rating: 0,
    downloads: 0,
    version: manifest.version,
    contentRating: manifest.contentRating,
    description: manifest.description,
    changelog: manifest.changelog,
    cover: pack.files?.['card.json']?.avatar || (manifest.type === 'world' ? COVER_WORLD : COVER_CARD),
    publishedAt: new Date().toISOString(),
    card: pack.files?.['card.json'] || null,
    world: pack.files?.['world.json'] || null,
  }, 'local');
  if (!item) throw new Error('打包内容不完整');
  state.published = [item, ...state.published.filter((row) => row?.id !== item.id)];
  await writeState(repo, state);
  return item;
}

export async function importWorkshopItem({ repo, item } = {}) {
  if (!item) throw new Error('没有可导入的作品');
  let card = null;
  let world = null;
  let reused = { card: false, world: false };
  if ((item.type === 'card' || item.type === 'bundle') && item.card) {
    const draft = { ...item.card };
    delete draft.id;
    delete draft.character_book_id;
    delete draft.createdAt;
    delete draft.updatedAt;
    // 禁止“另存为副本”：内容 hash 相同直接复用，避免幽灵卡/幽灵书
    const hash = await hashCard(draft);
    const same = await repo.findCardsByHash(hash);
    if (same.length) {
      card = same[0];
      reused.card = true;
      if (draft.character_book) {
        // 同一张卡重新导入时，把新内嵌书补上/更新，但不新建重复卡
        card = await repo.saveCard({ ...card, character_book: draft.character_book });
      }
    } else {
      card = await repo.saveCard(draft);
    }
  }
  if ((item.type === 'world' || item.type === 'bundle') && item.world) {
    const draft = { ...item.world };
    delete draft.id;
    delete draft.createdAt;
    delete draft.updatedAt;
    const hash = await hashWorld(draft);
    const same = await repo.findWorldsByHash(hash);
    if (same.length) {
      world = same[0];
      reused.world = true;
    } else {
      const sameName = await repo.findWorldsByName(draft.name);
      if (sameName.length) {
        // 同名不同 hash：自动编号，不制造同名幽灵
        const base = String(draft.name || '世界书').replace(/\s*\(\d+\)$/, '').trim() || '世界书';
        let i = 2;
        let name = `${base}(${i})`;
        while ((await repo.findWorldsByName(name)).length) {
          i += 1;
          name = `${base}(${i})`;
        }
        draft.name = name;
      }
      world = await repo.saveWorld(draft);
    }
  }
  await markInstalled({ repo, item });
  return { card, world, reused };
}

export async function markInstalled({ repo, item } = {}) {
  if (!item?.id) return null;
  const state = await readState(repo);
  const record = {
    id: item.id,
    version: item.version || '1.0.0',
    type: item.type,
    title: item.title,
    at: new Date().toISOString(),
  };
  state.installed = [record, ...state.installed.filter((row) => row.id !== item.id)];
  await writeState(repo, state);
  return record;
}

export function installedStatus(installed = [], item) {
  const record = installed.find((row) => row.id === item?.id);
  if (!record) return null;
  return compareVersions(item.version, record.version) > 0 ? 'update' : 'installed';
}

export function packForItem(item) {
  if (!item) throw new Error('没有作品');
  return buildPack({
    type: item.type,
    card: item.card,
    world: item.world,
    meta: {
      id: item.id,
      title: item.title,
      version: item.version,
      author: item.author,
      tags: item.tags,
      contentRating: item.contentRating,
      changelog: item.changelog,
      description: item.description,
    },
  });
}
