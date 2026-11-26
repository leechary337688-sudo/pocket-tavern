import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  serviceWorkers: 'block',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const sleep = (ms) => page.waitForTimeout(ms);
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

await page.goto(BASE);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true, nsfw: false });
  const a = await repo.saveCard({
    name: '阿岚', description: '测试甲，冷静。', personality: '冷静', scenario: '酒馆',
    first_mes: '（阿岚放下杯子。）「坐。」', mes_example: '', tags: ['测试'], creator: 'test',
  });
  const b = await repo.saveCard({
    name: '墨羽', description: '测试乙，嘴快。', personality: '嘴快', scenario: '酒馆',
    first_mes: '（墨羽抬头。）「你终于来了。」', mes_example: '', tags: ['测试'], creator: 'test',
  });
  const fresh = { id: `msg-${Date.now()}-a`, sender: 'char', text: a.first_mes, swipes: [], swipeIndex: 0, sendDate: new Date().toISOString(), cardId: a.id, speaker: a.name };
  window.__agentChat = await repo.createChat(a, {
    title: 'Agent 测试房', kind: 'group', memberIds: [a.id, b.id], agentMode: true,
    messages: [fresh],
  });
  window.__oldChat = await repo.createChat(a, {
    title: '旧逻辑测试房', kind: 'group', memberIds: [a.id, b.id], agentMode: false,
    messages: [{ ...fresh, id: `msg-${Date.now()}-b` }],
  });
});

async function openChat(id) {
  await page.goto(`${BASE}#/chat/${id}`);
  await page.waitForFunction(() => !!document.querySelector('.chat-view'), null, { timeout: 10000 });
  await sleep(700);
}

const ids = await page.evaluate(() => ({ agent: window.__agentChat.id, old: window.__oldChat.id }));
await page.reload();
await page.waitForFunction(() => !document.querySelector('.overlay.is-open'), null, { timeout: 10000 }).catch(() => {});
await openChat(ids.agent);
check('Agent 房屋徽标显示 Agent', (await page.locator('.chat-room-badge').innerText()).includes('Agent'));
await page.getByRole('button', { name: '群聊成员与规则' }).click();
await page.waitForSelector('.group-editor', { timeout: 5000 });
const editorText = await page.locator('.group-editor').innerText();
check('群聊设置有 Agent 模式开关', editorText.includes('每个角色独立上下文'), editorText.slice(-80));
await page.getByRole('button', { name: '取消' }).click();
await sleep(300);
await page.getByRole('button', { name: '组装预览' }).click();
await page.waitForSelector('.preview-body .preview-agent-note', { timeout: 5000 });
const note = await page.locator('.preview-agent-note').innerText();
check('预览显示 Agent 视角与当前角色', note.includes('Agent 视角') && (note.includes('阿岚') || note.includes('墨羽')), note);
await page.screenshot({ path: 'dev/agent-preview.png' });
await page.keyboard.press('Escape');
await sleep(300);

await openChat(ids.old);
check('旧房不显示 Agent 徽标', !(await page.locator('.chat-room-badge').innerText()).includes('Agent'));
await page.getByRole('button', { name: '组装预览' }).click();
await page.waitForTimeout(500);
check('旧房预览没有 Agent 说明', (await page.locator('.preview-agent-note').count()) === 0);
await page.keyboard.press('Escape');
await sleep(300);

// 旧房手动升级为 Agent 模式
await page.getByRole('button', { name: '群聊成员与规则' }).click();
await page.waitForSelector('.group-editor', { timeout: 5000 });
const agentRow = page.locator('.settings-toggle').filter({ hasText: '每个角色独立上下文' });
const agentBox = agentRow.locator('input.switch-input');
check('旧房 Agent 开关默认关', !(await agentBox.isChecked()));
await agentRow.locator('.switch').click();
await page.getByRole('button', { name: '保存' }).click();
await sleep(800);
const upgraded = await page.evaluate(async (id) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const chat = await repo.getChat(id);
  return Boolean(chat?.agentMode);
}, ids.old);
check('旧房可手动升级为 Agent', upgraded && (await page.locator('.chat-room-badge').innerText()).includes('Agent'));

check('无 pageerror', errors.length === 0, errors.join(' | '));
console.log(`AGENT UI ${fail ? 'FAIL' : 'OK'} (${pass}/${pass + fail})`);
await browser.close();
process.exit(fail ? 1 : 0);
