// 触达目标审计：逐路由列出 <44 的可点元素。
// node dev/audit-taps.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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

function audit(label) {
  return page.evaluate((label) => {
    const items = [...document.querySelectorAll('button, a, [role="button"], input[type=checkbox], .switch')]
      .filter((el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        return r.width < 44 || r.height < 44;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '', text: el.textContent.trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
      });
    return { label, items };
  }, label);
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const age = page.getByRole('button', { name: /我已满 18/ });
if (await age.count()) await age.click();
await page.waitForTimeout(500);
const skip = page.getByRole('button', { name: /跳过引导/ });
if (await skip.count()) await skip.click();
await page.waitForTimeout(800);

const out = [];
out.push(await audit('home'));
await page.evaluate(() => { location.hash = '#/cards'; });
await page.waitForTimeout(600); out.push(await audit('cards'));
await page.evaluate(() => { location.hash = '#/world'; });
await page.waitForTimeout(600); out.push(await audit('world'));
await page.evaluate(() => { location.hash = '#/chat/chat-demo'; });
await page.waitForTimeout(800); out.push(await audit('chat'));
await page.locator('button[aria-label="更多"]').click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: /^设置/ }).click();
await page.waitForTimeout(700); out.push(await audit('settings'));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.evaluate(() => { location.hash = '#/workshop'; });
await page.waitForTimeout(1000); out.push(await audit('workshop'));
await page.evaluate(() => { location.hash = '#/workshop/gen'; });
await page.waitForTimeout(800); out.push(await audit('workshop-gen'));
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
