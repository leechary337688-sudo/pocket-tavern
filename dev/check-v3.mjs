// v3：工坊草稿/发布跳转、房间入口、单聊邀请转群、角色链式接话
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
async function db(fn, arg) {
  return page.evaluate(async ({ source, value }) => {
    const { Repo } = await import('/src/data/repo.js');
    const repo = new Repo();
    await repo.init();
    // eslint-disable-next-line no-new-func
    const run = new Function('repo', 'arg', `return (${source})(repo, arg)`);
    return run(repo, value);
  }, { source: fn.toString(), value: arg ?? null });
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
  await repo.extDelete('__workshop', 'drafts');
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
}, API);
await page.reload({ waitUntil: 'networkidle' });
await page.goto(`${BASE}#/workshop/gen`, { waitUntil: 'networkidle' });
await sleep(900);

const idea = '草稿测试：一个在旧书店打工的失忆旅人。';
await page.locator('textarea[aria-label="角色想法"]').fill(idea);
await sleep(900);
await page.reload({ waitUntil: 'networkidle' });
await sleep(900);
const restored = await page.evaluate(() => ({
  idea: document.querySelector('textarea[aria-label="角色想法"]')?.value || '',
  bar: document.querySelector('.gen-draft-bar')?.hidden === false,
  barText: document.querySelector('.gen-draft-bar')?.innerText || '',
}));
check('草稿自动保存并恢复', restored.idea === idea && restored.bar, JSON.stringify(restored));

await page.getByRole('button', { name: /调一杯角色卡/ }).click();
await page.waitForSelector('.gen-field', { timeout: 30000 });
await sleep(900);
await page.reload({ waitUntil: 'networkidle' });
await sleep(900);
const restoredCard = await page.evaluate(() => ({
  fields: document.querySelectorAll('.gen-field').length,
  bar: document.querySelector('.gen-draft-bar')?.hidden === false,
}));
check('草稿恢复生成中的角色卡', restoredCard.fields === 7 && restoredCard.bar, JSON.stringify(restoredCard));

await page.getByRole('button', { name: /^发布$/ }).click();
await page.waitForSelector('.publish-flow', { timeout: 8000 });
await page.getByRole('button', { name: /下一步 · 确认分级/ }).click();
await sleep(250);
await page.locator('.publish-confirm input').check();
await page.getByRole('button', { name: /下一步 · 上传\/导出/ }).click();
await sleep(250);
await page.getByRole('button', { name: /发布到本地工坊/ }).click();
await page.waitForURL(/#\/workshop/, { timeout: 15000 });
await sleep(900);
const published = await page.evaluate(() => ({
  url: location.hash,
  found: [...document.querySelectorAll('.ws-card__title')].some((el) => el.textContent.includes('失忆')),
}));
check('发布后跳工坊并可见新作品', published.url === '#/workshop' && published.found, JSON.stringify(published));
await page.screenshot({ path: 'dev/v3-published.png' });

await page.goto(`${BASE}#/home`, { waitUntil: 'networkidle' });
await sleep(700);
const roomCta = page.locator('.home-room-cta');
check('首页有开房间入口', await roomCta.count() === 1);
await roomCta.click();
await page.waitForSelector('.group-editor', { timeout: 5000 });
await sleep(250);
const memberChecks = page.locator('.group-member input[type="checkbox"]');
for (let i = 0; i < await memberChecks.count(); i++) {
  if (!(await memberChecks.nth(i).isChecked())) await memberChecks.nth(i).check();
}
await page.locator('.group-editor input.field').first().fill('雾港账房夜谈');
// 0.6 默认一轮一人；这里显式设成 2，验证一轮两位（不再靠“正文提到名字”自动接力）
await page.getByLabel('一轮发言人数').selectOption('2');
await page.getByRole('button', { name: /^开桌$/ }).click();
await page.waitForURL(/#\/chat\//, { timeout: 6000 });
await sleep(900);
const room = await page.evaluate(async () => {
  const id = decodeURIComponent(location.hash.split('#/chat/')[1] || '');
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const chat = await repo.getChat(id);
  return { id, kind: chat?.kind, members: chat?.memberIds?.length };
});
check('首页开出房间并带徽标', room.kind === 'group' && room.members >= 2 && await page.locator('.chat-room-badge').isVisible(), JSON.stringify(room));

await page.locator('.composer__input').fill('程墨白，你怎么看这局？');
await page.locator('button[aria-label="发送"]').click();
let chain = { replies: [], count: 0 };
for (let attempt = 0; attempt < 20; attempt++) {
  await sleep(500);
  chain = await db((repo, id) => {
    return repo.getChat(id).then((chat) => {
      const userIndex = chat.messages.map((m) => m.sender).lastIndexOf('user');
      return {
        replies: chat.messages.slice(userIndex + 1).filter((m) => m.sender === 'char').map((m) => m.speaker || ''),
        texts: chat.messages.slice(userIndex + 1).filter((m) => m.sender === 'char').map((m) => (m.text || '').slice(0, 260)),
        count: chat.messages.length,
      };
    });
  }, room.id);
  if (chain.replies.length >= 2) break;
}
check('一轮 2 位：A 先答，B 接话', chain.replies[0] === '程墨白' && chain.replies.includes('琥珀'), JSON.stringify(chain));
await page.waitForFunction(() => !document.querySelector('.stream-cursor') && !document.querySelector('button[aria-label="停止"]'), null, { timeout: 15000 }).catch(() => {});
await sleep(500);
const uiNames = await page.locator('.msg__name').allTextContents();
check('界面发言人与消息归属一致', uiNames.includes('程墨白') && uiNames.includes('琥珀'), JSON.stringify(uiNames));
await page.screenshot({ path: 'dev/v3-room-chain.png' });

await page.goto(`${BASE}#/chat/chat-demo`, { waitUntil: 'networkidle' });
await sleep(800);
const beforeInvite = await db((repo) => repo.getChat('chat-demo').then((c) => ({ kind: c.kind, count: c.messages.length })));
await page.locator('button[aria-label="更多"]').click();
await sleep(250);
await page.getByRole('button', { name: /邀请角色 · 转为房间/ }).click();
await page.waitForSelector('.group-editor', { timeout: 5000 });
await sleep(250);
const inviteChecks = page.locator('.group-member input[type="checkbox"]');
for (let i = 0; i < await inviteChecks.count(); i++) {
  if (!(await inviteChecks.nth(i).isChecked())) await inviteChecks.nth(i).check();
}
await page.getByRole('button', { name: /^保存$/ }).click();
await sleep(1200);
const afterInvite = await db((repo) => repo.getChat('chat-demo').then((c) => ({ kind: c.kind, count: c.messages.length, members: c.memberIds?.length })));
check('单聊可邀请角色并转为房间', afterInvite.kind === 'group' && afterInvite.members >= 2 && afterInvite.count >= beforeInvite.count, JSON.stringify({ beforeInvite, afterInvite }));
await page.screenshot({ path: 'dev/v3-invite.png' });

check('无 pageerror', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `V3 FAILED (${failed.length}/${results.length})` : `V3 OK (${results.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
