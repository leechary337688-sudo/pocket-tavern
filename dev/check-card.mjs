// 角色卡导入/导出快速验收。
// node dev/check-card.mjs
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = (name) => page.screenshot({ path: join(HERE, name) });

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const age = page.getByRole('button', { name: /我已满 18/ });
if (await age.count()) await age.click();
await page.waitForTimeout(500);
const skip = page.getByRole('button', { name: /跳过引导/ });
if (await skip.count()) await skip.click();
await page.waitForTimeout(700);

await page.evaluate(() => { location.hash = '#/cards'; });
await page.waitForTimeout(600);
const before = await page.locator('.card-tile, .card-row').count();
const fileInputs = page.locator('input[type=file]');
console.error('debug', { hash: await page.evaluate(() => location.hash), inputs: await fileInputs.count(), text: (await page.evaluate(() => document.body.innerText)).slice(0, 160) });
await fileInputs.first().setInputFiles(join(HERE, 'fixtures', 'test-ccv2.png'));
await page.waitForTimeout(1200);
const after = await page.locator('.card-tile, .card-row').count();
await shot('card-imported.png');
const tiles = await page.evaluate(() =>
  [...document.querySelectorAll('.card-tile, .card-row')].map((t) => ({
    text: t.innerText.slice(0, 180),
    img: t.querySelector('img')?.src?.slice(0, 40),
  })),
);

// 打开新卡详情，检查字段与头像
const tile = page.locator('.card-tile, .card-row').filter({ hasText: '雨港的薇拉' }).first();
if (await tile.count()) {
  await tile.click();
  await page.waitForTimeout(500);
  await shot('card-detail.png');
}
const detail = await page.evaluate(() => {
  const d = document.querySelector('.overlay.is-open');
  return d ? { text: d.innerText.slice(0, 1200), img: d.querySelector('img')?.src?.slice(0, 40) } : null;
});

// 导出 PNG，验证 tEXt 可回读
let downloadInfo = null;
const exportBtn = page.getByRole('button', { name: /导出 PNG/ });
if (await exportBtn.count()) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), exportBtn.first().click()]);
  const path = join(HERE, 'exported-card.png');
  await dl.saveAs(path);
  downloadInfo = { name: dl.suggestedFilename(), path };
}

console.log(JSON.stringify({ before, after, tiles, detail, downloadInfo, errors }, null, 2));
await browser.close();
