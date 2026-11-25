import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
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
    connection: {
      endpoint: 'http://127.0.0.1:8788',
      apiType: 'openai',
      apiKey: 'dev-key',
      model: 'amber-mock',
      extraHeaders: '',
    },
  });
});
await page.reload({ waitUntil: 'networkidle' });

const out = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const { createTrialSandbox } = await import('/src/workshop/trial-sandbox.js');
  const repo = new Repo();
  await repo.init();
  const before = {
    cards: (await repo.listCards()).length,
    chats: (await repo.listChats()).length,
    worlds: (await repo.listWorlds()).length,
    trials: (await repo.listTrials()).length,
  };
  const sandbox = createTrialSandbox({
    repo,
    settings: repo.settings,
    card: {
      name: '丢弃测试',
      description: '只用于流式中途丢弃',
      personality: '安静',
      scenario: '测试',
      first_mes: '（她抬起眼。）「你来了。」',
      mes_example: '',
      tags: ['test'],
    },
    title: '丢弃测试',
  });
  // 不 await start：让 mock SSE 正在流式输出时丢弃。
  sandbox.start();
  await new Promise((r) => setTimeout(r, 80));
  const midState = sandbox.snapshot().state;
  await sandbox.discard();
  await new Promise((r) => setTimeout(r, 900));
  const after = {
    cards: (await repo.listCards()).length,
    chats: (await repo.listChats()).length,
    worlds: (await repo.listWorlds()).length,
    trials: (await repo.listTrials()).length,
  };
  return { before, after, midState, state: sandbox.snapshot().state };
});

check('丢弃前正式表不变', out.before.cards >= 1, JSON.stringify(out.before));
check('流式中途触发丢弃', ['starting', 'streaming', 'ready'].includes(out.midState), out.midState);
check(
  '丢弃后 trial 不复活',
  out.after.trials === out.before.trials,
  JSON.stringify({ before: out.before.trials, after: out.after.trials }),
);
check(
  '丢弃后 cards/chats/worlds 不增',
  out.after.cards === out.before.cards && out.after.chats === out.before.chats && out.after.worlds === out.before.worlds,
  JSON.stringify(out.after),
);
check('无 pageerror', errors.length === 0, errors.join('\n'));

await browser.close();
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`TRIAL DISCARD FAILED (${failed.length})`);
  process.exit(1);
}
console.log('TRIAL DISCARD OK (5/5)');
