// 320 宽发布流程布局验收：node dev/check-publish-320.mjs
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
  await repo.saveSettings({ ageAck: true, onboardingDone: true, workshop: { remoteEnabled: false, demoSource: true } });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.goto(`${BASE}/#/workshop`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

await page.locator('button[aria-label="发布作品"]').click();
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.overlay.is-open')),
  items: [...document.querySelectorAll('.overlay.is-open button')].map((b) => b.textContent.trim()).filter(Boolean),
}));
await page.getByRole('button', { name: /角色卡 · 琥珀/ }).click();
await page.waitForSelector('.publish-flow', { timeout: 8000 });
await page.getByRole('button', { name: /下一步 · 确认分级/ }).click();
await page.waitForTimeout(350);
await page.locator('.publish-confirm input').check();
await page.waitForTimeout(200);
const layout = await page.evaluate(() => {
  const panel = document.querySelector('.publish-flow');
  const actions = [...document.querySelectorAll('.publish-flow .publish-actions .btn')];
  const rect = panel?.getBoundingClientRect();
  return {
    panel: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    actions: actions.map((b) => ({ text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
    overflow: document.documentElement.scrollWidth - innerWidth,
    bodyOverflow: document.body.scrollWidth - innerWidth,
  };
});
await page.screenshot({ path: join(HERE, 'publish-320.png') });
await browser.close();
const ok = sheet.open && sheet.items.some((x) => x.includes('角色卡')) && layout.panel && layout.overflow === 0 && layout.actions.every((a) => a.h >= 44) && errors.length === 0;
console.log(JSON.stringify({ sheet, layout, errors, ok }, null, 2));
if (!ok) process.exitCode = 1;
