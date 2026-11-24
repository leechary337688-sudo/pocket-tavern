// 最终视觉巡检：360 / 390 / 430 宽、深色/浅色、首页/聊天/设置。
// node dev/shots-final.mjs
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
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

async function dismissIntro() {
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForTimeout(650);
  }
  const skip = page.getByRole('button', { name: /跳过引导/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(500);
  }
}

async function overflow(label) {
  const v = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  console.log(label, v);
  if (v.doc > 0) throw new Error(`${label} 出现横向滚动 ${v.doc}px`);
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await dismissIntro();
  await overflow('home-390');
  await page.screenshot({ path: join(HERE, 'final-home-390.png'), fullPage: true });

  await page.locator('.chat-row').first().click();
  await page.waitForTimeout(800);
  await overflow('chat-390');
  await page.screenshot({ path: join(HERE, 'final-chat-390.png'), fullPage: false });

  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForTimeout(700);
  await overflow('settings-390');
  await page.screenshot({ path: join(HERE, 'final-settings-390.png'), fullPage: false });

  await page.evaluate(() => {
    document.querySelector('.drawer.is-open .drawer__head .icon-btn')?.click();
  });
  await page.waitForTimeout(400);

  // 浅色主题
  await page.evaluate(() => localStorage.setItem('pt:theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    location.hash = '#/home';
  });
  await page.waitForTimeout(700);
  await overflow('home-390-light');
  await page.screenshot({ path: join(HERE, 'final-home-light-390.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('pt:theme', 'dark'));

  // 360 宽
  await page.setViewportSize({ width: 360, height: 800 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await dismissIntro();
  await overflow('home-360');
  await page.screenshot({ path: join(HERE, 'final-home-360.png'), fullPage: true });

  // 320 宽（规格下限）
  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await dismissIntro();
  await overflow('home-320');
  await page.screenshot({ path: join(HERE, 'final-home-320.png'), fullPage: true });
  await page.locator('.chat-row').first().click();
  await page.waitForTimeout(700);
  await overflow('chat-320');
  await page.screenshot({ path: join(HERE, 'final-chat-320.png'), fullPage: false });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForTimeout(700);
  await overflow('settings-320');
  await page.screenshot({ path: join(HERE, 'final-settings-320.png'), fullPage: false });
  await page.evaluate(() => document.querySelector('.drawer.is-open .drawer__head .icon-btn')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = '#/cards'; });
  await page.waitForTimeout(700);
  await overflow('cards-320');
  await page.screenshot({ path: join(HERE, 'final-cards-320.png'), fullPage: true });
  await page.evaluate(() => { location.hash = '#/world'; });
  await page.waitForTimeout(700);
  await overflow('world-320');
  await page.screenshot({ path: join(HERE, 'final-world-320.png'), fullPage: true });

  // 430 宽
  await page.setViewportSize({ width: 430, height: 932 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await dismissIntro();
  await overflow('home-430');
  await page.screenshot({ path: join(HERE, 'final-home-430.png'), fullPage: true });

  if (errors.length) throw new Error(`有 JS 错误：${errors.join(' | ')}`);
  console.log('SHOTS OK');
} catch (err) {
  console.error('SHOTS FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
