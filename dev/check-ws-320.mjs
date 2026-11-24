// 320 宽工坊/生成器验收：node dev/check-ws-320.mjs
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
const context = await browser.newContext({ viewport: { width: 320, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
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

const result = {};
for (const [route, file] of [['#/workshop', 'ws-320.png'], ['#/workshop/gen', 'gen-320.png']]) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  result[route] = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
      .map((el) => ({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((b) => b.w > 0 && b.h > 0);
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      bodyOverflow: document.body.scrollWidth - innerWidth,
      small: buttons.filter((b) => b.h < 44 || b.w < 44).slice(0, 12),
    };
  });
  await page.screenshot({ path: join(HERE, file), fullPage: false });
}

// 设置抽屉里的工坊卡
await page.goto(`${BASE}/#/home`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.locator('button[aria-label="设置"]').click();
await page.waitForTimeout(450);
await page.locator('.settings-card', { hasText: '创意工坊' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
result.settings = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.drawer.is-open')),
  overflow: document.documentElement.scrollWidth - innerWidth,
  text: [...document.querySelectorAll('.settings-card')].find((c) => c.textContent.includes('创意工坊'))?.innerText.slice(0, 280) || '',
}));
await page.screenshot({ path: join(HERE, 'ws-settings-320.png') });
await browser.close();

const ok = Object.values(result).every((r) => !r.overflow && (!r.small || r.small.length === 0)) && errors.length === 0;
console.log(JSON.stringify({ result, errors, ok }, null, 2));
if (!ok) process.exitCode = 1;
