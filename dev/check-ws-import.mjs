// 工坊详情/直接导入验收：node dev/check-ws-import.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = process.env.NODE_PATH || 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true, workshop: { remoteEnabled: false, demoSource: true } });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.goto(`${BASE}/#/workshop`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1100);

const counts = () => page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  return { cards: (await repo.listCards()).length, worlds: (await repo.listWorlds()).length, chats: (await repo.listChats()).length };
});

const before = await counts();
// 找一张卡（不是套装）的标题并打开详情
const cardTitle = await page.locator('.ws-card').filter({ hasText: '雾港的薇拉' }).first().locator('.ws-card__title').textContent();
await page.locator('.ws-card').filter({ hasText: '雾港的薇拉' }).first().click();
await page.waitForTimeout(500);
const detail = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.overlay.is-open')),
  buttons: [...document.querySelectorAll('.overlay.is-open button')].map((b) => b.textContent.trim()).filter(Boolean),
  text: document.querySelector('.overlay.is-open')?.innerText.slice(0, 220),
}));
const importBtn = page.getByRole('button', { name: /直接导入/ });
const canImport = await importBtn.count();
if (canImport) {
  await importBtn.click();
  await page.waitForTimeout(900);
}
const after = await counts();
const toastText = await page.evaluate(() => document.querySelector('#toast-root')?.innerText || '');
await page.screenshot({ path: join(HERE, 'ws-detail-import.png') });
await browser.close();
const ok = Boolean(cardTitle) && detail.open && canImport === 1 && after.cards === before.cards + 1 && after.chats === before.chats && after.worlds === before.worlds;
console.log(JSON.stringify({ before, cardTitle, detail, canImport, after, toastText, errors, ok }, null, 2));
if (!ok) process.exitCode = 1;
