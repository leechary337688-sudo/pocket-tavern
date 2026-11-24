// 二轮 UI 校验：世界书卡布局、设置开关、插件面板、关于卡。
// node dev/check-ui2.mjs
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
const shot = (name) => page.screenshot({ path: join(HERE, name) });

async function enter() {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForSelector('.overlay__panel--onboard', { timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
  const skip = page.getByRole('button', { name: /跳过引导/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(300);
}

await enter();

await page.evaluate(() => { location.hash = '#/world'; });
await page.waitForTimeout(600);
await shot('view2-world.png');
const world = await page.evaluate(() => {
  const card = document.querySelector('.world-card');
  const main = card?.querySelector('.world-card__main');
  const text = card?.querySelector('.world-card__text');
  const sw = card?.querySelector('.switch[role="switch"]');
  const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; };
  return {
    card: r(card), main: r(main), text: r(text), sw: r(sw),
    mainDisplay: main ? getComputedStyle(main).display : null,
    textDisplay: text ? getComputedStyle(text).display : null,
    swOn: sw?.classList.contains('is-on'),
  };
});

await page.evaluate(() => { location.hash = '#/chat/chat-demo'; });
await page.waitForTimeout(700);
await page.locator('button[aria-label="更多"]').click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: /^设置/ }).click();
await page.waitForTimeout(600);

const plugin = page.locator('.settings-card').filter({ has: page.locator('h2', { hasText: '插件' }) }).first();
await plugin.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot('view2-plugins.png');
const pluginInfo = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.settings-card')].find((c) => c.querySelector('h2')?.textContent.trim() === '插件');
  return card ? { text: card.innerText.slice(0, 900), switches: card.querySelectorAll('.switch').length } : null;
});

const switches = await page.evaluate(() =>
  [...document.querySelectorAll('.settings-card .toggle-row')].map((row) => ({
    label: row.querySelector('.toggle-row__label')?.textContent.trim(),
    hasSwitch: !!row.querySelector('.switch'),
    inputVisible: (() => { const i = row.querySelector('input'); if (!i) return null; const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    switchBox: (() => { const s = row.querySelector('.switch'); if (!s) return null; const r = s.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  })),
);

const about = page.locator('.settings-card').filter({ has: page.locator('h2', { hasText: '关于' }) }).first();
await about.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot('view2-about.png');
const aboutInfo = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.settings-card')].find((c) => c.querySelector('h2')?.textContent.trim() === '关于');
  const hero = card?.querySelector('.about-hero > div');
  const meta = card?.querySelector('.about-meta');
  const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; };
  return {
    hero: r(hero),
    heroDisplay: hero ? getComputedStyle(hero).display : null,
    meta: r(meta),
    metaDisplay: meta ? getComputedStyle(meta).display : null,
    metaGap: meta ? getComputedStyle(meta).gap : null,
    text: card?.innerText.slice(0, 500),
  };
});

console.log(JSON.stringify({ world, pluginInfo, switches, aboutInfo, errors }, null, 2));
await browser.close();
