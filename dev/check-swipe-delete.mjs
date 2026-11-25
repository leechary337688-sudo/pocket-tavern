// 验收补充：会话列表右滑露出删除 + 确认删除。
// node dev/check-swipe-delete.mjs
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

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForTimeout(500);
  }
  const skip = page.getByRole('button', { name: /跳过引导/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(500);
  }

  const before = await page.locator('.chat-row').count();
  if (!before) throw new Error('没有会话可测');

  const swipe = await page.evaluate(() => {
    const row = document.querySelector('.chat-row');
    const surface = row.querySelector('.chat-row__surface');
    const rect = surface.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const touch = (x) => new Touch({ identifier: 1, target: surface, clientX: x, clientY: y });
    surface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(100)] }));
    for (const x of [130, 170, 210, 250]) {
      surface.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(x)] }));
    }
    surface.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
    return {
      swiped: row.classList.contains('is-swiped'),
      transform: surface.style.transform,
      hint: document.querySelector('.swipe-hint')?.textContent,
      deleteVisible: getComputedStyle(row.querySelector('.chat-row__delete')).width,
    };
  });
  console.log('swipe', swipe);
  const delInfo = await page.evaluate(() => {
    const el = document.querySelector('.chat-row__delete');
    return {
      text: el.innerText,
      rect: el.getBoundingClientRect().toJSON(),
      children: [...el.children].map((c) => ({ tag: c.tagName, text: c.textContent, rect: c.getBoundingClientRect().toJSON() })),
    };
  });
  console.log('delete button', JSON.stringify(delInfo));
  if (!swipe.swiped) throw new Error('右滑后没有进入 is-swiped 状态');
  if (!swipe.transform.includes('96px')) throw new Error('右滑位移不是 96px');
  if (!swipe.hint?.includes('右滑')) throw new Error('提示文案不是右滑');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(HERE, 'swipe-open.png'), fullPage: true });

  await page.locator('.chat-row__delete').first().click();
  await page.waitForTimeout(300);
  const confirm = page.getByRole('button', { name: '删除', exact: true }).last();
  if (!(await confirm.count())) throw new Error('没有出现删除确认');
  await confirm.click();
  await page.waitForTimeout(700);
  const after = await page.locator('.chat-row').count();
  console.log('rows', { before, after });
  if (after >= before) throw new Error('确认后会话没有删除');
  if (errors.length) throw new Error(`有 JS 错误：${errors.join(' | ')}`);
  console.log('SWIPE DELETE OK');
} catch (err) {
  console.error('SWIPE DELETE FAILED:', err.message);
  await page.screenshot({ path: join(HERE, 'swipe-failed.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
