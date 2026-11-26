import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const W = Number(process.env.PT_W || 390);
const H = Number(process.env.PT_H || 844);
const SHOT = process.env.PT_SHOT || 'group';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_INTERNET|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text());
});
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
  const cards = await repo.listCards();
  if (!cards.some((c) => c.name === '程墨白')) {
    await repo.saveCard({
      name: '程墨白',
      description: '雾港的账房先生，话少，记性极好。',
      personality: '克制、慢热，擅长算账和拆台。',
      scenario: '雾港酒馆的角落，他合上账本。',
      first_mes: '「坐。你身上有三样东西不对。」',
      mes_example: '',
      tags: ['雾港', '账房'],
      avatar: '',
    });
  }
});
await page.goto(BASE + '#/cards', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(600);
check('首启弹层已关闭', await page.locator('.overlay.is-open').count() === 0);
const groupBtn = page.locator('button[aria-label="开一桌群聊"]');
check('卡库有开群聊入口', await groupBtn.count() === 1);
await groupBtn.click();
await sleep(300);
check('群聊设置面板打开', await page.locator('.group-editor').count() === 1);
await page.screenshot({ path: `dev/${SHOT}-editor.png` });
const members = page.locator('.group-member input[type="checkbox"]');
check('成员列表至少有两位', await members.count() >= 2, `count=${await members.count()}`);
for (let i = 0; i < await members.count(); i++) {
  if (!(await members.nth(i).isChecked())) await members.nth(i).check();
}
const title = page.locator('.group-editor input.field').first();
await title.fill('雾港账房夜谈');
const openBtn = page.locator('.overlay.is-open .btn--primary', { hasText: '开桌' });
check('开桌按钮可用', await openBtn.count() === 1);
await openBtn.click();
await page.waitForURL(/#\/chat\//, { timeout: 5000 });
await sleep(800);
check('开桌后进入聊天页', /#\/chat\//.test(page.url()), page.url());
check('群聊顶栏有成员按钮', await page.locator('button[aria-label="群聊成员与规则"]').count() === 1);
const chatId = decodeURIComponent(page.url().split('#/chat/')[1] || '');
const info = await page.evaluate(async (id) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const chat = await repo.getChat(id);
  return { kind: chat?.kind, members: chat?.memberIds?.length, title: chat?.title, count: chat?.messages?.length, agentMode: chat?.agentMode };
}, chatId);
check('会话存为群聊/两成员/Agent 默认开', info.kind === 'group' && info.members === 2 && info.agentMode === true, JSON.stringify(info));

await page.locator('.composer__input').fill('程墨白，你怎么看这局？');
await page.locator('button[aria-label="发送"]').click();
await sleep(3500);
const last = await page.evaluate(async (id) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const chat = await repo.getChat(id);
  const chars = (chat?.messages || []).filter((m) => m.sender === 'char');
  const userIndex = (chat?.messages || []).map((m) => m.sender).lastIndexOf('user');
  const replies = (chat?.messages || []).slice(userIndex + 1).filter((m) => m.sender === 'char');
  return { speakers: chars.slice(-3).map((m) => m.speaker || ''), replies: replies.map((m) => ({ speaker: m.speaker || '', text: m.text.slice(0, 40) })), count: chat.messages.length };
}, chatId);
check('点名后下一条由被点名角色发出', last.replies.length > 0 && last.replies[0].speaker === '程墨白', JSON.stringify(last));

await page.screenshot({ path: `dev/${SHOT}-chat.png` });
check('无 pageerror', errors.length === 0, JSON.stringify(errors.slice(0, 2)));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `GROUP UI FAILED (${failed.length}/${results.length})` : `GROUP UI OK (${results.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
