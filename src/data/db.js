// db — IndexedDB 封装。数据库 pt-db，6 个 objectStore。
// localStorage 只允许存 UI 态（主题、当前会话 id），业务数据一律在这里。

export const DB_NAME = 'pt-db';
// v2：新增 trials（试穿沙盒独立 store）与 worlds（按嵌卡激活）。
export const DB_VERSION = 2;
export const STORES = Object.freeze({
  cards: 'cards',
  chats: 'chats',
  worlds: 'worlds',
  settings: 'settings',
  personas: 'personas',
  extdata: 'extdata',
  trials: 'trials',
});

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains(STORES.cards)) {
        const s = db.createObjectStore(STORES.cards, { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.chats)) {
        const s = db.createObjectStore(STORES.chats, { keyPath: 'id' });
        s.createIndex('cardId', 'cardId', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.worlds)) {
        db.createObjectStore(STORES.worlds, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.personas)) {
        db.createObjectStore(STORES.personas, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.extdata)) {
        const s = db.createObjectStore(STORES.extdata, { keyPath: 'id' });
        s.createIndex('pluginId', 'pluginId', { unique: false });
      }
      // v2：试穿沙盒独立 store；正式表 cards/worlds/chats 在试穿路径下永不写入
      if (!db.objectStoreNames.contains(STORES.trials)) {
        const s = db.createObjectStore(STORES.trials, { keyPath: 'id' });
        s.createIndex('contentHash', 'contentHash', { unique: false });
        s.createIndex('kind', 'kind', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      // 升级失败可在这里按 event.oldVersion 做迁移
      void tx;
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('无法打开本地数据库'));
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('本地数据库被其他标签页占用，请关闭其他酒馆页面后重试'));
    };
  });
  return dbPromise;
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
  });
}

export function makeId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function clone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export async function dbGet(store, key) {
  const db = await openDB();
  return reqPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function dbGetAll(store) {
  const db = await openDB();
  return reqPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function dbGetAllByIndex(store, index, key) {
  const db = await openDB();
  return reqPromise(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(key));
}

export async function dbPut(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('写入失败'));
    tx.onabort = () => reject(tx.error || new Error('写入被中止'));
  });
  return value;
}

export async function dbBulkPut(store, values) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return 0;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const v of list) s.put(v);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('批量写入失败'));
    tx.onabort = () => reject(tx.error || new Error('批量写入被中止'));
  });
  return list.length;
}

export async function dbDelete(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('删除失败'));
  });
}

export async function dbClear(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('清空失败'));
  });
}
