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
const sleep = (ms) => page.waitForTimeout(ms);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const seed = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    connection: { endpoint: location.origin, apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: '' },
  });
  const card = (await repo.listCards())[0];
  const entries = [{
    uid: 1, key: ['禁武'], keysecondary: [], comment: '规矩',
    content: '禁武江湖录：动手之前先报门派。', position: 'before', order: 10,
    tokenBudget: 0, recursive: false, selective: false, constant: false,
    probability: 100, caseSensitive: false, useRegex: false, enabled: true,
  }];
  const a = await repo.saveWorld({ id: 'world-dup-a', name: '禁武江湖录', enabled: true, entries, scope: 'library', embeddedFor: [] });
  const b = await repo.saveWorld({ id: 'world-dup-b', name: '禁武江湖录', enabled: true, entries, scope: 'library', embeddedFor: [] });
  const c = await repo.saveWorld({ id: 'world-dup-c', name: '禁武江湖录', enabled: true, entries, scope: 'library', embeddedFor: [] });
  const { dbPut, STORES } = await import('/src/data/db.js');
  const boundCard = { id: 'card-bound-dup', name: '绑着副本的卡', description: '用于验证合并时的卡绑定改绑。', character_book_id: b.id, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await dbPut(STORES.cards, boundCard);
  const chat = await repo.createChat(card, { title: '绑定副本的会话', worldIds: [b.id] });
  return { a: a.id, b: b.id, c: c.id, chat: chat.id, boundCard: boundCard.id, hashA: a.contentHash, hashB: b.contentHash, hashC: c.contentHash };
});
check('三本复制世界书同 hash', seed.hashA && seed.hashA === seed.hashB && seed.hashB === seed.hashC, JSON.stringify(seed));

await page.goto(BASE + '#/home', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(700);
check('首启弹层已关闭', await page.locator('.overlay.is-open').count() === 0);
await page.locator('button[aria-label="设置"]').click();
await sleep(400);
const dedupe = page.getByRole('button', { name: /查重合并/ });
check('设置里有查重合并入口', await dedupe.count() === 1);
await dedupe.scrollIntoViewIfNeeded();
await dedupe.click();
await sleep(500);
check('查到重复分组', await page.locator('.dedupe-group').count() >= 1);
const groupText = await page.locator('.dedupe-group').first().innerText();
check('分组显示同名书', /禁武江湖录/.test(groupText), groupText.slice(0, 120));
const select = page.locator('.dedupe-group select').first();
const keepId = await select.inputValue();
await page.getByRole('button', { name: '合并这组' }).first().click();
await sleep(300);
await page.getByRole('button', { name: '合并', exact: true }).click();
await sleep(800);
const after = await page.evaluate(async ({ keepId, boundCardId }) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const worlds = await repo.listWorlds();
  const chats = await repo.listChats();
  const chat = await repo.getChat(chats[0]?.id);
  const card = await repo.getCard(boundCardId);
  return {
    worlds: worlds.filter((w) => w.name === '禁武江湖录').length,
    keepExists: worlds.some((w) => w.id === keepId),
    chatWorldIds: chat?.worldIds || [],
    chatId: chat?.id,
    cardBookId: card?.character_book_id || '',
    cardBookName: card?.character_book?.name || '',
    cardBookContent: card?.character_book?.entries?.[0]?.content || '',
  };
}, { keepId, boundCardId: seed.boundCard });
check('合并后同名书只剩一本', after.worlds === 1, JSON.stringify(after));
check('合并保留用户选的那本', after.keepExists, keepId);
check('绑定会话已改绑保留本', after.chatWorldIds.length === 1 && after.chatWorldIds[0] === keepId, JSON.stringify(after.chatWorldIds));
check('绑卡也改绑保留本', after.cardBookId === keepId && after.cardBookName === '禁武江湖录', `${after.cardBookId} / ${after.cardBookName}`);
check('绑卡内嵌书同步为保留内容', /动手之前先报门派/.test(after.cardBookContent), after.cardBookContent.slice(0, 40));
check('无 pageerror', errors.length === 0, errors.join('\n'));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `DEDUPE FAILED (${results.length - failed.length}/${results.length})` : `DEDUPE OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
