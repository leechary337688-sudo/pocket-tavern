import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
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
  await repo.saveSettings({ ageAck: true, onboardingDone: true });
});

const result = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const { TrialSandbox } = await import('/src/workshop/trial-sandbox.js');
  const repo = new Repo();
  await repo.init();
  const msg = (id, sender, text) => ({ id, sender, text, swipes: [text], swipeIndex: 0, sendDate: new Date().toISOString(), tokenEstimate: 12 });
  const make = (name, desc, bookName, bookContent) => {
    const t = new TrialSandbox({
      repo,
      settings: repo.settings,
      card: {
        name, description: desc, personality: '测试', scenario: '测试场景',
        first_mes: '测试开场', mes_example: '', tags: ['测试'],
        avatar: '', spec: 'chara_card_v2',
        character_book: {
          name: bookName,
          entries: [{ uid: 'trial-book-1', key: ['试穿'], keysecondary: [], comment: '测试', content: bookContent, position: 'before', order: 10, tokenBudget: 0, recursive: false, selective: false, constant: false, probability: 100, caseSensitive: false, useRegex: false, enabled: true }],
        },
      },
      world: {
        name: bookName,
        entries: [{ uid: 'trial-world-1', key: ['试穿'], keysecondary: [], comment: '测试', content: bookContent, position: 'before', order: 10, tokenBudget: 0, recursive: false, selective: false, constant: false, probability: 100, caseSensitive: false, useRegex: false, enabled: true }],
      },
      title: '冲突测试',
    });
    t.messages = [msg('m1', 'char', '开场'), msg('m2', 'user', '你好'), msg('m3', 'char', '回应')];
    t.state = 'ready';
    return t;
  };

  const before = await repo.stats();
  const t1 = make('琥珀', '冲突版描述', '琥珀的酒馆', '这是冲突版私藏：吧台下面有第二把钥匙。');
  let asked = null;
  const p1 = await t1.promote({
    onConflict: async ({ name, existing }) => { asked = { name, existing: existing.length }; return 'rename'; },
  });
  const afterRename = await repo.stats();

  const t2 = make('新角色甲', '另一个角色', '全新世界书', '全新内容。');
  await t2.promote({ onConflict: async () => 'reuse' });
  const t3 = make('将被丢弃', '丢弃测试', '丢弃书', '丢弃内容。');
  await t3.discard();
  const afterDiscard = await repo.stats();
  const trials = await repo.listTrials();

  return {
    before,
    asked,
    worldName: p1.world?.name || '',
    cardId: p1.card?.id || '',
    chatId: p1.chat?.id || '',
    afterRename,
    afterDiscard,
    trials: trials.map((t) => ({ id: t.id, state: t.state })),
    t3Id: t3.id,
  };
});

check('同名不同 hash 触发冲突询问', result.asked?.name === '琥珀的酒馆' && result.asked?.existing >= 1, JSON.stringify(result.asked));
check('选择 rename 后并存为《X(2)》', result.worldName === '琥珀的酒馆(2)', result.worldName);
check('转正生成正式卡与会话', Boolean(result.cardId && result.chatId), `${result.cardId} / ${result.chatId}`);
check('转正后卡/聊各 +1', result.afterRename.cards === result.before.cards + 1 && result.afterRename.chats === result.before.chats + 1, JSON.stringify(result.afterRename));
check('丢弃不增加正式数据', result.afterDiscard.cards === result.afterRename.cards + 1 && result.afterDiscard.chats === result.afterRename.chats + 1, JSON.stringify(result.afterDiscard));
check('弃 trial 记录已删除', !result.trials.some((t) => t.id === result.t3Id), JSON.stringify(result.trials));
check('无 pageerror', errors.length === 0, errors.join('\n'));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `TRIAL CONFLICT FAILED (${results.length - failed.length}/${results.length})` : `TRIAL CONFLICT OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
