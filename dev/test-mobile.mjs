// 移动端冒烟截图：node dev/test-mobile.mjs
// 用 dsh 自带的 playwright-core + chromium，390×844 触屏上下文。
// 只读/本地，不改数据源。
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
  timezoneId: 'Asia/Shanghai',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.screenshot({ path: join(HERE, 'mobile-age.png') });

const ageBtn = page.getByRole('button', { name: /我已满 18/ });
if (await ageBtn.count()) await ageBtn.click();
await page.waitForTimeout(500);
await page.screenshot({ path: join(HERE, 'mobile-onboard.png') });

const skip = page.getByRole('button', { name: /跳过引导/ });
if (await skip.count()) await skip.click();
await page.waitForTimeout(800);
await page.screenshot({ path: join(HERE, 'mobile-home.png') });

await page.goto(`${BASE}/#/chat/chat-demo`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(HERE, 'mobile-chat.png') });

const info = await page.evaluate(() => ({
  width: innerWidth,
  docWidth: document.documentElement.scrollWidth,
  view: document.querySelector('#view-root > *')?.className,
  bubbles: document.querySelectorAll('.msg').length,
  composer: !!document.querySelector('.composer__input'),
  quick: document.querySelectorAll('.quick-btn').length,
  bodyOverflowX: getComputedStyle(document.body).overflowX,
}));
console.log(JSON.stringify({ info, errors }, null, 2));
await browser.close();
