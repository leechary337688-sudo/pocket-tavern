import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');
const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => page.waitForTimeout(ms);
await page.goto(BASE);
await sleep(500);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true, nsfw: false });
  const state = { chats: { 'chat-demo': {
    pairs: { 'card-amber|player': { a: 'card-amber', b: 'player', score: 60, updatedAt: new Date().toISOString() } },
    sweets: [{ at: new Date().toISOString(), from: '琥珀', to: '你', delta: 10, messageId: 'seed-msg', snippet: '「今晚这杯算我的。」' }],
    applied: {},
  } } };
  await repo.extSet('affection', 'state', state);
});
await page.reload();
await sleep(700);
await page.evaluate(() => { location.hash = '#/chat/chat-demo'; });
await sleep(900);
await page.evaluate(() => { location.hash = '#/home'; });
await sleep(500);
await page.locator('button[aria-label="设置"]').click();
await sleep(700);
const text = await page.locator('#drawer-root').innerText();
check('26 好感面板 60 分显示心动', text.includes('60') && text.includes('心动'), text.slice(0, 500));
check('26 发糖时刻显示', text.includes('发糖') && text.includes('今晚这杯算我的'), text.slice(-600));
check('无 pageerror', errors.length === 0, errors.join('\n'));
await page.screenshot({ path: 'dev/affection-panel.png' });
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length ? '04 AFFECTION UI FAIL' : '04 AFFECTION UI OK'} (${checks.length - failed.length}/${checks.length})`);
await browser.close();
if (failed.length) process.exit(1);
