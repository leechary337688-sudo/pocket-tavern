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
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await sleep(500);
const info = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  await repo.saveSettings({
    ageAck: true, onboardingDone: true, nsfw: false,
    connection: { endpoint: 'http://127.0.0.1:8788', apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
  });
  const amber = await repo.getCard('card-amber');
  const other = {
    id: 'card-dead-test', name: '测试·墨羽', description: '测试用角色', personality: '冷静',
    scenario: '测试房间', first_mes: '（她靠在门边。）', mes_example: '', creator: 'test', tags: ['测试'],
    avatar: amber.avatar,
  };
  await repo.saveCard(other);
  const chat = await repo.createChat(amber, {
    title: '退场测试房间', kind: 'group', memberIds: [amber.id, other.id], worldIds: [],
    memberState: { [other.id]: 'dead' },
    messages: [{ id: 'm0', sender: 'char', speaker: amber.name, cardId: amber.id, text: '（门开着。）', swipes: [], swipeIndex: 0, sendDate: Date.now(), tokenEstimate: 4 }],
  });
  return { chatId: chat.id, otherId: other.id, amberId: amber.id };
});
await page.reload();
await sleep(900);
await page.evaluate((cid) => { location.hash = `#/chat/${cid}`; }, info.chatId);
await sleep(1200);
const before = await page.evaluate(async (cid) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const chat = await repo.getChat(cid);
  return { messages: chat.messages.length, states: chat.memberState };
}, info.chatId);
await page.locator('textarea').fill('测试·墨羽，你在吗？');
await page.locator('button[aria-label="发送"]').click();
await sleep(2500);
const afterDead = await page.evaluate(async (cid) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const chat = await repo.getChat(cid);
  return {
    messages: chat.messages.length,
    speakers: chat.messages.map((m) => m.speaker).filter(Boolean),
    text: chat.messages.slice(-3).map((m) => m.text).join('\n'),
  };
}, info.chatId);
check('29 dead 被点名不进骰池', !afterDead.speakers.includes('测试·墨羽'), JSON.stringify(afterDead.speakers));
const bodyDead = await page.locator('body').innerText();
check('29 dead 点名 toast', bodyDead.includes('已退场') && bodyDead.includes('回忆中相见'), bodyDead.slice(-350));
check('29 退场后仍能收到其他角色/提示', afterDead.messages >= before.messages + 1, JSON.stringify({ before: before.messages, after: afterDead.messages }));

await page.evaluate(async ({ cid, id }) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const chat = await repo.getChat(cid);
  chat.memberState = { ...(chat.memberState || {}), [id]: 'active' };
  await repo.saveChat(chat);
}, { cid: info.chatId, id: info.otherId });
await page.reload();
await sleep(1200);
await page.locator('textarea').fill('测试·墨羽，回来了吗？');
await page.locator('button[aria-label="发送"]').click();
await sleep(2500);
const afterAlive = await page.evaluate(async (cid) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const chat = await repo.getChat(cid);
  return { speakers: chat.messages.map((m) => m.speaker).filter(Boolean), messages: chat.messages.length };
}, info.chatId);
check('29 回归后恢复发言', afterAlive.speakers.includes('测试·墨羽'), JSON.stringify(afterAlive.speakers));

// 30 禁用 story-status 后头像角标消失；重新启用后旧状态不崩
const toggle = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const enabled = (repo.settings.plugins?.enabled || []).filter((id) => id !== 'story-status');
  await repo.saveSettings({ plugins: { enabled } });
  return enabled;
});
check('30 可禁用 story-status', !toggle.includes('story-status'), JSON.stringify(toggle));
await page.reload();
await sleep(1000);
const decoAfter = await page.evaluate(() => ({
  badges: document.querySelectorAll('.msg__avatar .avatar-deco, .msg__avatar.pt-status, .msg__avatar.is-hurt').length,
  panels: document.body.innerText.includes('角色状态'),
}));
check('30 禁用后头像零残留', decoAfter.badges === 0, JSON.stringify(decoAfter));

await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const enabled = repo.settings.plugins?.enabled || [];
  if (!enabled.includes('story-status')) enabled.push('story-status');
  await repo.saveSettings({ plugins: { enabled } });
});
await page.reload();
await sleep(1000);
check('30 重新启用旧数据不崩', errors.length === 0, errors.join('\n'));

// 30 全部剧情插件禁用后，设置面板不挂载、头像不残留
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  const enabled = (repo.settings.plugins?.enabled || []).filter((id) => !['story-status', 'affection', 'chapter-diary', 'plot-director'].includes(id));
  await repo.saveSettings({ plugins: { enabled } });
});
await page.reload();
await sleep(900);
await page.evaluate(() => { location.hash = '#/home'; });
await sleep(500);
await page.locator('button[aria-label="设置"]').click();
await sleep(600);
const clean = await page.evaluate(() => ({
  statusPanel: !!document.querySelector('.story-status__head, .story-status__group'),
  affectionPanel: !!document.querySelector('.affection__head'),
  diaryPanel: !!document.querySelector('.diary__head'),
  directorPanel: !!document.querySelector('.director__head'),
  avatarDeco: document.querySelectorAll('.avatar-deco, .pt-status').length,
}));
check('30 四插件禁用后无挂载残留', !clean.statusPanel && !clean.affectionPanel && !clean.diaryPanel && !clean.directorPanel && clean.avatarDeco === 0, JSON.stringify(clean));

const failed = results.filter((r) => !r.ok);
console.log(`${failed.length ? '04 MEMBER STATE FAIL' : '04 MEMBER STATE OK'} (${results.length - failed.length}/${results.length})`);
await browser.close();
if (failed.length) process.exit(1);
