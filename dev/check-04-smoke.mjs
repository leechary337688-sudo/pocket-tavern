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
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err.stack || err)));
const logs = [];
page.on('console', (msg) => { if (msg.type() === 'error') logs.push(msg.text()); });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await sleep(1200);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    nsfw: false,
    connection: { endpoint: 'http://127.0.0.1:8788', apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
    plugins: { enabled: ['token-counter', 'dice-log', 'story-status', 'affection', 'chapter-diary', 'plot-director'] },
  });
});
await page.reload();
await sleep(1600);
const boot = await page.evaluate(() => !!document.querySelector('#boot-screen'));
const home = await page.evaluate(() => document.body.innerText.includes('袖珍酒馆'));
console.log('HOME', { boot, home, errors: pageErrors.length, consoleErrors: logs.slice(0, 8) });
await page.screenshot({ path: 'dev/smoke04-home.png' });

await page.locator('button[aria-label="设置"]').first().click();
await sleep(700);
const drawerText = await page.locator('#drawer-root').innerText();
console.log('PLUGIN CARDS', {
  story: drawerText.includes('剧情状态'),
  affection: drawerText.includes('好感度'),
  diary: drawerText.includes('章节日记'),
  director: drawerText.includes('剧情导演'),
  old: drawerText.includes('关键词推断'),
  errors: pageErrors.length,
});
await page.screenshot({ path: 'dev/smoke04-settings.png' });

await page.keyboard.press('Escape');
await sleep(400);
await page.evaluate(() => { location.hash = '#/chat/chat-demo'; });
await sleep(1200);
const chatText = await page.locator('#view-root').innerText();
await page.locator('button[aria-label="查看角色档案"]').first().click();
await sleep(500);
const profileText = await page.locator('.overlay.is-open').innerText().catch(() => '');
console.log('CHAT', { hasComposer: chatText.includes('说点什么'), memberCard: profileText.includes('角色状态'), errors: pageErrors.length });
await page.screenshot({ path: 'dev/smoke04-profile.png' });

console.log('PAGE ERRORS', pageErrors);
console.log('CONSOLE ERRORS', logs.slice(0, 12));
await browser.close();
