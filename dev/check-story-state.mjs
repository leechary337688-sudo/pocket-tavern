// 剧情状态插件：头像受伤/死亡装饰 + 组装预览注入 + 设置面板
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = process.env.NODE_PATH || 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const API = (process.env.PT_API || BASE).replace(/\/$/, '');
const EXE = process.env.CHROME_PATH || 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
let capturedRequest = null;
page.on('request', (req) => {
  if (req.url().includes('/v1/chat/completions') && req.method() === 'POST') {
    try {
      capturedRequest = JSON.parse(req.postData() || '{}');
    } catch {
      capturedRequest = null;
    }
  }
});
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_INTERNET|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`);
});
const sleep = (ms) => page.waitForTimeout(ms);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (apiBase) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    connection: { endpoint: apiBase, apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
    plugins: { enabled: ['token-counter', 'dice-log', 'story-state'] },
  });
  const chat = await repo.getChat('chat-demo');
  if (chat) {
    const idx = chat.messages.findIndex((m) => m.id === 'story-hurt');
    const message = {
      id: 'story-hurt',
      sender: 'char',
      speaker: '琥珀',
      text: '（琥珀的左臂被碎玻璃划开一道口子，血顺着手腕滴在吧台上。）\n\n「没事……先别管我。」',
      swipes: [],
      swipeIndex: 0,
      sendDate: new Date().toISOString(),
      tokenEstimate: 32,
    };
    if (idx >= 0) chat.messages[idx] = message;
    else chat.messages.push(message);
    await repo.saveChat(chat);
  }
}, API);
await page.reload({ waitUntil: 'networkidle' });
await page.goto(`${BASE}#/chat/chat-demo`, { waitUntil: 'networkidle' });
await sleep(900);

check('聊天页已打开', await page.locator('.chat-view').count() === 1);
const hurt = await page.evaluate(() => ({
  body: document.querySelector('.msg__avatar.is-hurt')?.className || '',
  badges: [...document.querySelectorAll('.msg__avatar.is-hurt .avatar-deco')].map((n) => n.textContent),
  header: document.querySelector('.chat-avatar-wrap')?.className || '',
}));
check('受伤消息头像被标记', hurt.body.includes('is-hurt'), JSON.stringify(hurt));
check('受伤徽标为「血」', hurt.badges.includes('血'), JSON.stringify(hurt.badges));
await page.screenshot({ path: 'dev/story-state-hurt.png' });

await page.locator('.composer__input').fill('琥珀，你还好吗？');
await page.locator('button[aria-label="发送"]').click();
await sleep(1200);
const systemText = (capturedRequest?.messages || [])
  .filter((m) => m.role === 'system')
  .map((m) => String(m.content || ''))
  .join('\n');
check('请求体注入剧情状态', systemText.includes('[剧情状态]') && systemText.includes('琥珀'), systemText.includes('[剧情状态]') ? 'found' : 'missing');
await page.screenshot({ path: 'dev/story-state-preview.png' });
await sleep(2500);

await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const chat = await repo.getChat('chat-demo');
  const message = chat.messages.find((m) => m.id === 'story-hurt');
  if (message) {
    message.text = '（琥珀倒在地上，已经没有呼吸。酒馆里安静得只剩雨声。）';
    await repo.saveChat(chat);
  }
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(900);
const dead = await page.evaluate(() => ({
  body: document.querySelector('.msg__avatar.is-dead')?.className || '',
  badges: [...document.querySelectorAll('.msg__avatar.is-dead .avatar-deco')].map((n) => n.textContent),
  hurtCount: document.querySelectorAll('.msg__avatar.is-hurt').length,
}));
check('死亡消息头像变灰', dead.body.includes('is-dead') && dead.hurtCount === 0, JSON.stringify(dead));
check('死亡徽标为「✝」', dead.badges.includes('✝'), JSON.stringify(dead.badges));
await page.screenshot({ path: 'dev/story-state-dead.png' });

await page.locator('button[aria-label="更多"]').click();
await sleep(250);
await page.getByRole('button', { name: /^设置$/ }).click();
await sleep(600);
const panel = await page.evaluate(() => ({
  title: [...document.querySelectorAll('.plugin-panel')].map((n) => n.innerText).find((t) => t.includes('剧情状态')) || '',
  rows: [...document.querySelectorAll('.story-state-row')].map((n) => n.innerText),
}));
check('设置面板显示剧情状态面板', panel.title.includes('剧情状态'), panel.title.slice(0, 50));
check('设置面板显示死亡状态', panel.rows.some((row) => row.includes('已死亡')), JSON.stringify(panel.rows));
await page.screenshot({ path: 'dev/story-state-panel.png' });

check('无 pageerror', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `STORY STATE FAILED (${failed.length}/${results.length})` : `STORY STATE OK (${results.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
