import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const W = Number(process.env.PT_W || 390);
const H = Number(process.env.PT_H || 844);
const SHOT = process.env.PT_SHOT || 'preview-mounts';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
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
const ids = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true });
  const entry = (uid, add) => ({
    uid, key: ['暗号'], keysecondary: [], comment: `暗号${add}`,
    content: `暗号规则 ${add}：只对说出「雾港」的人亮灯。`,
    position: 'before', order: add * 10, tokenBudget: 0, recursive: false,
    selective: false, constant: false, probability: 100, caseSensitive: false,
    useRegex: false, enabled: true,
  });
  const a = await repo.saveCard({
    name: '甲', description: '甲', personality: '甲', scenario: '甲', first_mes: '甲', mes_example: '',
    tags: [], character_book: { name: '甲书', entries: [entry('a1', 1)] },
  });
  const b = await repo.saveCard({
    name: '乙', description: '乙', personality: '乙', scenario: '乙', first_mes: '乙', mes_example: '',
    tags: [], character_book: { name: '乙书', entries: [entry('b1', 2)] },
  });
  const chat = await repo.createChat(a, {
    title: '冲突预览',
    kind: 'group',
    memberIds: [a.id, b.id],
    messages: [{ id: 'msg_1', sender: 'user', text: '暗号是什么？', sendDate: new Date().toISOString(), swipes: ['暗号是什么？'], swipeIndex: 0, tokenEstimate: 10 }],
  });
  return { chatId: chat.id, a: a.id, b: b.id };
});

await page.goto(BASE + '#/chat/' + ids.chatId, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(900);
check('聊天页打开', await page.locator('.chat-view').count() === 1, ids.chatId);
await page.locator('button[aria-label="组装预览"]').click();
await sleep(900);
const body = page.locator('.preview-body');
const text = await body.innerText();
check('预览显示挂载列表', /世界书挂载/.test(text), text.slice(0, 80).replace(/\n/g, ' | '));
check('预览显示冲突高亮', /同 key 冲突/.test(text), text.slice(0, 160).replace(/\n/g, ' | '));
check('冲突里包含两本书', /甲书/.test(text) && /乙书/.test(text), text.slice(0, 220).replace(/\n/g, ' | '));
check('无 pageerror', errors.length === 0, errors.join('\n'));
await page.getByText('世界书挂载', { exact: false }).scrollIntoViewIfNeeded();
await sleep(300);
await page.screenshot({ path: `dev/${SHOT}.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `PREVIEW MOUNTS FAILED (${results.length - failed.length}/${results.length})` : `PREVIEW MOUNTS OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
