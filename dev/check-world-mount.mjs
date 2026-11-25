import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const W = Number(process.env.PT_W || 390);
const H = Number(process.env.PT_H || 844);
const SHOT = process.env.PT_SHOT || 'world-mount';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
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
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    connection: { endpoint: location.origin, apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: '' },
  });
  for (const [id, name] of [['world-mount-a', '测试挂载·甲'], ['world-mount-b', '测试挂载·乙']]) {
    await repo.saveWorld({
      id, name, enabled: true, scope: 'library',
      entries: [{ uid: 1, key: ['测试'], content: '测试挂载内容。', position: 'before', order: 10 }],
    });
  }
});
await page.goto(BASE + '#/chat/chat-demo', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(700);
check('聊天页已打开', await page.locator('.chat-view').count() === 1, page.url());

await page.locator('.chat-topbar button[aria-label="更多"]').click();
await sleep(200);
const mountItem = page.locator('.overlay.is-open button', { hasText: '世界书挂载' });
check('菜单有世界书挂载', await mountItem.count() === 1);
await mountItem.click();
await sleep(350);
check('挂载面板打开', await page.locator('.world-mount').count() === 1);
await page.screenshot({ path: `dev/${SHOT}-panel.png` });

const select = page.locator('.world-mount select');
check('默认单选主世界书', await select.count() === 1);
await select.selectOption('world-mount-a');
await page.locator('.overlay.is-open .btn--primary', { hasText: '保存挂载' }).click();
await sleep(500);
let chat = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  return repo.getChat('chat-demo');
});
check('单本挂载已保存', chat?.worldIds?.length === 1 && chat.worldIds[0] === 'world-mount-a', JSON.stringify(chat?.worldIds));
check('单本模式 advancedWorlds=false', chat?.advancedWorlds === false, String(chat?.advancedWorlds));

await page.locator('.chat-topbar button[aria-label="更多"]').click();
await sleep(200);
await page.locator('.overlay.is-open button', { hasText: '世界书挂载' }).click();
await sleep(300);
await page.locator('.world-mount__advanced .switch').click();
await sleep(250);
const boxes = page.locator('.world-mount__row input[type="checkbox"]');
check('高级模式出现多选', await boxes.count() >= 2, `count=${await boxes.count()}`);
for (let i = 0; i < await boxes.count(); i++) {
  if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
}
await page.locator('.overlay.is-open .btn--primary', { hasText: '保存挂载' }).click();
await sleep(500);
chat = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  return repo.getChat('chat-demo');
});
check('多本挂载已保存', chat?.worldIds?.length === 2, JSON.stringify(chat?.worldIds));
check('高级模式已持久化', chat?.advancedWorlds === true, String(chat?.advancedWorlds));
await page.screenshot({ path: `dev/${SHOT}.png` });

await page.locator('.chat-topbar button[aria-label="组装预览"]').click();
await sleep(700);
const text = await page.locator('.overlay.is-open').innerText();
check('组装预览显示挂载', /世界书挂载/.test(text) && /测试挂载/.test(text), text.slice(0, 120).replace(/\n/g, ' | '));
await page.keyboard.press('Escape');
await sleep(200);
check('无 pageerror', errors.length === 0, errors.join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`WORLD MOUNT ${failed.length ? 'FAIL' : 'OK'} (${results.length - failed.length}/${results.length})`);
await browser.close();
if (failed.length) process.exitCode = 1;
