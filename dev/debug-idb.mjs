import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = process.env.NODE_PATH || 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8788/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.getByRole('button', { name: /我已满 18/ }).click();
await page.waitForTimeout(1800);
const readSettings = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('pt-db');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readonly');
          const get = tx.objectStore('settings').get('app');
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => resolve({ error: String(get.error) });
        };
        req.onerror = () => resolve({ error: String(req.error) });
      }),
  );
console.log('after age', JSON.stringify(await readSettings()).slice(0, 500));
const skip = page.getByRole('button', { name: /跳过引导/ });
console.log('skip count', await skip.count());
if (await skip.count()) await skip.click();
await page.waitForTimeout(1200);
console.log('after skip', JSON.stringify(await readSettings()).slice(0, 500));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
console.log('after reload overlays', await page.locator('.overlay.is-open').count());
console.log('after reload settings', JSON.stringify(await readSettings()).slice(0, 500));
await browser.close();
