// 0.6 链式接话闸：默认关；显式 chainMentions=true 时才因正文提到别人而追加。
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

await page.goto(BASE);
const result = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const { ChatEngine } = await import('/src/core/chat-engine.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true, onboardingDone: true,
    connection: { endpoint: 'http://127.0.0.1:8788', apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
  });
  const a = await repo.saveCard({ name: '甲', description: '测试甲', personality: '冷静', scenario: '酒馆', first_mes: '（甲放下杯子。）「坐。」', mes_example: '', tags: ['测试'] });
  const b = await repo.saveCard({ name: '乙', description: '测试乙', personality: '嘴快', scenario: '酒馆', first_mes: '（乙抬头。）「你来了。」', mes_example: '', tags: ['测试'] });
  async function run({ chainMentions, turnBudget }) {
    const chat = await repo.createChat(a, {
      title: `闸测试-${chainMentions ? 'chain' : 'off'}-${turnBudget}`,
      kind: 'group', memberIds: [a.id, b.id], agentMode: true, chainMentions, turnBudget,
      messages: [{
        id: `msg-${Date.now()}-${Math.random()}`, sender: 'char', text: a.first_mes, swipes: [], swipeIndex: 0,
        sendDate: new Date().toISOString(), cardId: a.id, speaker: a.name,
      }],
    });
    const engine = new ChatEngine({ repo });
    await engine.open(chat.id);
    let calls = 0;
    engine._makeApi = () => ({
      streamChat: async ({ onToken }) => {
        calls += 1;
        onToken('（乙把杯子擦亮，放在你面前）「这局有点意思。」');
        return { usage: null };
      },
    });
    await engine.send('甲，你怎么看这局？');
    const after = await repo.getChat(chat.id);
    const userIndex = after.messages.map((m) => m.sender).lastIndexOf('user');
    return {
      calls,
      speakers: after.messages.slice(userIndex + 1).filter((m) => m.sender === 'char').map((m) => m.speaker || ''),
    };
  }
  return {
    off: await run({ chainMentions: false, turnBudget: 1 }),
    on: await run({ chainMentions: true, turnBudget: 1 }),
    budget2: await run({ chainMentions: false, turnBudget: 2 }),
  };
});
const results = [];
function check(name, ok, detail = '') {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
check('默认 chain=false：正文提到别人也只回一条', result.off.calls === 1 && result.off.speakers.length === 1, JSON.stringify(result.off));
check('显式 chain=true：正文提到乙时追加乙，且只追加一次', result.on.calls === 2 && result.on.speakers.length === 2 && result.on.speakers[1] === '乙', JSON.stringify(result.on));
check('turnBudget=2：不靠提及也能排两位', result.budget2.calls === 2 && result.budget2.speakers.length === 2, JSON.stringify(result.budget2));
check('无 pageerror', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(results.every(Boolean) ? `CHAIN GATE OK (${results.length}/${results.length})` : `CHAIN GATE FAILED (${results.filter(Boolean).length}/${results.length})`);
process.exitCode = results.every(Boolean) ? 0 : 1;
