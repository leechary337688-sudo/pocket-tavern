import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');
const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const sleep = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await sleep(500);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true });
});
await page.reload();
await sleep(700);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const overflow = async () => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  body: document.body.scrollWidth - document.body.clientWidth,
}));
await page.locator('button[aria-label="设置"]').click();
await sleep(600);
const ov = await overflow();
check('320 设置无横向溢出', ov.doc <= 0 && ov.body <= 0, JSON.stringify(ov));
await page.locator('#drawer-root').getByText('载入预设世界').click();
await sleep(600);
const ov2 = await overflow();
check('320 预设选择器无横向溢出', ov2.doc <= 0 && ov2.body <= 0, JSON.stringify(ov2));
await page.screenshot({ path: 'dev/preset-320.png' });
check('无 pageerror', errors.length === 0, errors.join('\n'));
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length ? '04 320 FAIL' : '04 320 OK'} (${checks.length - failed.length}/${checks.length})`);
await browser.close();
if (failed.length) process.exit(1);
