// 设置 → 创意工坊卡片验收：node dev/check-ws-settings.mjs
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
  await repo.saveSettings({ ageAck: true, onboardingDone: true });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.locator('button[aria-label="设置"]').first().click();
await page.waitForTimeout(700);

const card = page.locator('.settings-card').filter({ hasText: '创意工坊' }).first();
const cardCount = await card.count();
if (cardCount) await card.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: join(HERE, 'ws-settings.png') });
const info = await page.evaluate(async () => {
  const cards = [...document.querySelectorAll('.settings-card')];
  const ws = cards.find((el) => el.textContent.includes('创意工坊'));
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const settings = repo.settings;
  return {
    cardCount: cards.length,
    text: ws?.innerText.slice(0, 500) || '',
    switchCount: ws?.querySelectorAll('.switch').length || 0,
    ranges: ws?.querySelectorAll('input[type=range]').length || 0,
    workshop: settings?.workshop || null,
    overflow: document.documentElement.scrollWidth - innerWidth,
  };
});
await browser.close();
const ok = info.cardCount >= 9 && Boolean(info.text) && info.workshop?.genTemperature === 0.9 && info.overflow === 0 && errors.length === 0;
console.log(JSON.stringify({ info, errors, ok }, null, 2));
if (!ok) process.exitCode = 1;
