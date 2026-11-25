import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Runtime.enable');
cdp.on('Runtime.exceptionThrown', (ev) => {
  const d = ev.exceptionDetails;
  console.log('EXC', d.url, d.lineNumber + 1, d.columnNumber + 1, d.text, d.exception?.description?.slice(0, 300));
});
await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await browser.close();
