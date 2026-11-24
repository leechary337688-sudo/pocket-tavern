import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const sleep = (ms) => page.waitForTimeout(ms);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true });
});
await page.goto(BASE + '#/world', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(700);
const cards = page.locator('.world-card');
check('世界书列表已渲染', await cards.count() >= 1, `count=${await cards.count()}`);
const text = await cards.first().innerText();
check('列表显示 hash 短码', /#\w{8}/.test(text), text.replace(/\n/g, ' | '));
check('列表显示绑定会话数', /会话/.test(text), text.replace(/\n/g, ' | '));
check('列表显示嵌卡/馆藏', /嵌卡|馆藏/.test(text), text.replace(/\n/g, ' | '));
check('无 pageerror', errors.length === 0, errors.join('\n'));
await page.screenshot({ path: 'dev/world-hash.png' });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `WORLD HASH FAILED (${results.length - failed.length}/${results.length})` : `WORLD HASH OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
