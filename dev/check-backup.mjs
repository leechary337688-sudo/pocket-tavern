// 验收 #9：全量备份导出（默认脱敏）→ 改动 → 导入还原。
// node dev/check-backup.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = process.env.NODE_PATH || 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const log = (...a) => console.log(...a);
const fail = (msg) => {
  throw new Error(msg);
};
async function openDbSettings(patch) {
  return page.evaluate(async (fnSrc) => {
    const patch = eval(`(${fnSrc})`);
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pt-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const store = db.transaction('settings', 'readwrite').objectStore('settings');
    const settings = await new Promise((res, rej) => {
      const r = store.get('app');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    patch(settings);
    await new Promise((res, rej) => {
      const r = store.put(settings);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
    return settings;
  }, patch.toString());
}
async function idbCounts() {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pt-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const count = (name) =>
      new Promise((res, rej) => {
        const r = db.transaction(name).objectStore(name).count();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const chats = await new Promise((res, rej) => {
      const r = db.transaction('chats').objectStore('chats').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const settings = await new Promise((res, rej) => {
      const r = db.transaction('settings').objectStore('settings').get('app');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return {
      cards: await count('cards'),
      chats: await count('chats'),
      worlds: await count('worlds'),
      messages: chats.reduce((n, c) => n + (c.messages?.length || 0), 0),
      temp: settings?.sampler?.temperature,
      apiKey: settings?.connection?.apiKey,
    };
  });
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForTimeout(700);
  }
  await openDbSettings((s) => {
    s.ageAck = true;
    s.onboardingDone = true;
    s.connection = { apiType: 'openai', endpoint: 'http://127.0.0.1:8788', apiKey: 'dev-secret-key', model: 'amber-mock', extraHeaders: '' };
    s.sampler = { ...s.sampler, temperature: 1.5 };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  log('start', await idbCounts());

  // 发一条，制造消息历史
  await page.evaluate(() => (location.hash = '#/chat/chat-demo'));
  await page.waitForTimeout(900);
  const ta = page.locator('.composer__input');
  await ta.fill('备份测试：来一杯。');
  await page.locator('.send-btn').click();
  await page.waitForFunction(() => document.querySelector('.send-btn')?.getAttribute('aria-label') === '发送', null, { timeout: 15000 });
  await page.waitForTimeout(700);
  const before = await idbCounts();
  log('before backup', before);
  if (before.messages < 3) fail('发送后消息数不足 3');

  // 打开设置数据卡并导出
  await page.locator('button[aria-label="更多"]').click();
  await page.waitForTimeout(250);
  await page.locator('.overlay.is-open button', { hasText: '设置' }).click();
  await page.waitForTimeout(500);
  await page.locator('.drawer.is-open').evaluate((el) => {
    const target = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('导出全量备份'));
    target?.scrollIntoView({ block: 'center' });
  });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('.drawer.is-open button', { hasText: '导出全量备份' }).click(),
  ]);
  const backupPath = join(HERE, 'backup-test.json');
  await download.saveAs(backupPath);
  const raw = JSON.parse(await readFile(backupPath, 'utf8'));
  log('backup file', backupPath, 'app', raw.app, 'includesKeys', raw.includesKeys);
  if (raw.includesKeys !== false) fail('默认导出应不含密钥');
  if (raw.data?.settings?.connection?.apiKey) fail('默认导出里残留明文 apiKey');
  if (raw.data.settings.sampler.temperature !== 1.5) fail('备份未包含 temperature=1.5');
  if ((raw.data.chats?.[0]?.messages?.length || 0) < 3) fail('备份未包含聊天记录');

  const withKeys = await page.evaluate(async () => {
    const { Repo } = await import('/src/data/repo.js');
    const repo = new Repo();
    await repo.init();
    const bundle = await repo.exportAll({ includeKeys: true });
    return { includesKeys: bundle.includesKeys, apiKey: bundle.data?.settings?.connection?.apiKey || '' };
  });
  log('backup with keys', { includesKeys: withKeys.includesKeys, hasApiKey: Boolean(withKeys.apiKey) });
  if (withKeys.includesKeys !== true) fail('勾选包含密钥时 includesKeys 应为 true');
  if (withKeys.apiKey !== 'dev-secret-key') fail('勾选包含密钥时备份里应有 apiKey');

  // 破坏数据：清空卡/聊，改温度
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pt-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['cards', 'chats', 'settings'], 'readwrite');
      tx.objectStore('cards').clear();
      tx.objectStore('chats').clear();
      const st = tx.objectStore('settings');
      st.get('app').onsuccess = (ev) => {
        const s = ev.target.result;
        s.sampler.temperature = 0.3;
        st.put(s);
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });
  const broken = await idbCounts();
  log('after damage', broken);
  if (broken.cards !== 0 || broken.chats !== 0) fail('破坏数据失败');

  await page.setInputFiles('.drawer.is-open input[type=file]', backupPath);
  await page.waitForTimeout(500);
  const confirm = page.getByRole('button', { name: '替换并导入' });
  if (!(await confirm.count())) fail('没有出现导入确认');
  await confirm.click();
  await page.waitForTimeout(1400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const restored = await idbCounts();
  log('restored', restored);
  if (restored.cards !== before.cards) fail(`角色卡未还原：${restored.cards} != ${before.cards}`);
  if (restored.chats !== before.chats) fail(`会话未还原：${restored.chats} != ${before.chats}`);
  if (restored.messages !== before.messages) fail(`消息未还原：${restored.messages} != ${before.messages}`);
  if (restored.temp !== 1.5) fail(`temperature 未还原：${restored.temp}`);
  if (restored.apiKey !== 'dev-secret-key') fail(`导入时未保留本机 apiKey：${restored.apiKey}`);

  await page.screenshot({ path: join(HERE, 'backup-restored.png'), fullPage: true });
  log('errors', errors);
  if (errors.length) fail(`有 JS 错误：${errors.join(' | ')}`);
  log('BACKUP OK');
} catch (err) {
  console.error('BACKUP FAILED:', err.message);
  await page.screenshot({ path: join(HERE, 'backup-failed.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
