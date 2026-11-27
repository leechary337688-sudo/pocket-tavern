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

await page.addInitScript(() => {
  window.__captured = [];
  const orig = window.fetch;
  window.fetch = async (url, init = {}) => {
    try {
      const u = String(url?.url || url);
      if (u.includes('/v1/chat/completions') && init?.body) {
        window.__captured.push(JSON.parse(String(init.body)));
      }
    } catch {}
    return orig(url, init);
  };
});

await page.goto(BASE);
const chatId = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true, onboardingDone: true, nsfw: false,
    connection: { endpoint: 'http://127.0.0.1:8788', apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
  });
  const a = await repo.saveCard({
    name: '阿岚', description: '测试甲，冷静。', personality: '冷静', scenario: '酒馆',
    first_mes: '（阿岚放下杯子。）「坐。」', mes_example: '', tags: ['测试'], creator: 'test',
  });
  const b = await repo.saveCard({
    name: '墨羽', description: '测试乙，嘴快。', personality: '嘴快', scenario: '酒馆',
    first_mes: '（墨羽抬头。）「你终于来了。」', mes_example: '', tags: ['测试'], creator: 'test',
  });
  const chat = await repo.createChat(a, {
    title: 'Agent 运行测试', kind: 'group', memberIds: [a.id, b.id], agentMode: true, turnBudget: 2,
    memberState: { [a.id]: { talkativeness: 1 }, [b.id]: { talkativeness: 1 } },
    messages: [{
      id: `msg-${Date.now()}`, sender: 'char', text: a.first_mes, swipes: [], swipeIndex: 0,
      sendDate: new Date().toISOString(), cardId: a.id, speaker: a.name,
    }],
  });
  return chat.id;
});
await page.reload();
await page.waitForFunction(() => !document.querySelector('.overlay.is-open'), null, { timeout: 10000 }).catch(() => {});
await page.goto(`${BASE}#/chat/${chatId}`);
await page.waitForSelector('.chat-view', { timeout: 10000 });
await sleep(600);
const ta = page.locator('.composer textarea');
await ta.fill('你们在吗？');
await page.getByRole('button', { name: '发送' }).click();
await page.waitForFunction(() => !document.querySelector('.stream-cursor') && !document.querySelector('button[aria-label="停止"]'), null, { timeout: 12000 }).catch(() => {});
await sleep(1500);

const requests = await page.evaluate(() => window.__captured || []);
check('至少发出了一次请求', requests.length >= 1, `count=${requests.length}`);
check('单轮调用不超过 3 个 Agent', requests.length <= 3, `count=${requests.length}`);
const bodies = requests.map((b) => b.messages || []);
check('第一个 Agent 只有一条当前用户消息', bodies[0]?.filter((m) => m.role === 'user' && m.content.trim() === '你们在吗？').length === 1, JSON.stringify(bodies[0]?.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 120))));
check('请求里没有连续重复的当前用户块', bodies.every((msgs) => msgs.filter((m) => m.role === 'user').every((m) => !m.content.includes('你们在吗？你们在吗？'))));
check('第一个 Agent 的历史里包含自己的 assistant 开场', bodies[0]?.some((m) => m.role === 'assistant' && m.content.includes('阿岚放下杯子')));
if (bodies.length > 1) {
  check('第二个 Agent 把别人（阿岚）标成【阿岚】user', bodies.slice(1).some((msgs) => msgs.some((m) => m.role === 'user' && m.content.includes('【阿岚】'))));
}
check('无 pageerror', errors.length === 0, errors.join(' | '));
console.log(JSON.stringify({ requests: requests.length, roles: bodies.map((msgs) => msgs.map((m) => m.role).join(',')) }, null, 2));
console.log(`AGENT LIVE ${fail ? 'FAIL' : 'OK'} (${pass}/${pass + fail})`);
await browser.close();
process.exit(fail ? 1 : 0);
