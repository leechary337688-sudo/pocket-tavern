// 视图巡检：卡库 / 世界书 / 骰子 / 设置抽屉 / 插件面板。
// node dev/test-views.mjs
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
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

async function enter() {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForSelector('.overlay__panel--onboard', { timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
  const skip = page.getByRole('button', { name: /跳过引导/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(500);
}
async function shot(name) {
  await page.screenshot({ path: join(HERE, name) });
}

await enter();
await page.evaluate(() => {
  location.hash = '#/cards';
});
await page.waitForTimeout(700);
await shot('view-cards.png');
const cards = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.card-tile, .card-row').length,
  text: document.body.innerText.slice(0, 160),
  overflow: document.documentElement.scrollWidth - innerWidth,
}));

await page.evaluate(() => {
  location.hash = '#/world';
});
await page.waitForTimeout(700);
await shot('view-world.png');
const worldBtn = page.locator('.world-card, .world-row').first();
if (await worldBtn.count()) {
  await worldBtn.click();
  await page.waitForTimeout(500);
  await shot('view-world-detail.png');
}

await page.evaluate(() => {
  location.hash = '#/chat/chat-demo';
});
await page.waitForTimeout(900);
const dice = page.locator('.quick-btn').first();
if (await dice.count()) {
  await dice.click();
  await page.waitForTimeout(500);
  await shot('view-dice.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

await page.locator('button[aria-label="更多"]').click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /^设置/ }).click();
await page.waitForTimeout(600);
await shot('view-settings.png');
const drawer = await page.evaluate(() => {
  const d = document.querySelector('.drawer.is-open');
  const scroll = document.querySelector('.drawer__scroll');
  const cards = [...document.querySelectorAll('.settings-card__title')].map((e) => e.textContent.trim());
  return {
    open: !!d,
    cards,
    scrollHeight: scroll?.scrollHeight,
    clientHeight: scroll?.clientHeight,
    pluginText: [...document.querySelectorAll('.settings-card')].find((c) => c.textContent.includes('插件'))?.innerText.slice(0, 500),
  };
});
await page.evaluate(() => {
  const s = document.querySelector('.drawer__scroll');
  if (s) s.scrollTop = s.scrollHeight;
});
await page.waitForTimeout(400);
await shot('view-settings-plugins.png');

const taps = await page.evaluate(() =>
  [...document.querySelectorAll('button, a, [role="button"]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
  }).slice(0, 20).map((el) => ({ cls: el.className, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), text: el.textContent.trim().slice(0, 20) })),
);

console.log(JSON.stringify({ cards, drawer, taps, errors }, null, 2));
await browser.close();
