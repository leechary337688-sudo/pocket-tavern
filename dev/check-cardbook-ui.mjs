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
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({ ageAck: true, onboardingDone: true });
});
await page.goto(BASE + '#/cards', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(700);
check('首启弹层已关闭', await page.locator('.overlay.is-open').count() === 0);
const tile = page.locator('.card-tile, .card-row').first();
check('卡库有卡', await tile.count() >= 1);
await tile.click();
await sleep(400);
check('打开卡详情', await page.locator('.card-detail').count() === 1);
await page.getByRole('button', { name: '编辑' }).first().click();
await sleep(500);
check('打开卡编辑器', await page.locator('.card-editor').count() === 1);
const book = page.locator('details.card-book');
check('有卡内嵌世界书区', await book.count() === 1);
await book.locator('summary').click();
await sleep(250);
await page.screenshot({ path: 'dev/card-book-editor.png' });
const bookName = page.getByPlaceholder('内嵌世界书名称');
check('内嵌书名可编辑', await bookName.count() === 1, await bookName.inputValue());
await bookName.fill('琥珀私藏');
const row = page.locator('.card-book__row').first();
const keys = row.locator('input').first();
await keys.fill('琥珀, 私藏');
const content = row.locator('textarea').first();
await content.fill('这是只属于琥珀的私密设定：吧台下面藏着第二把钥匙。');
await page.getByRole('button', { name: '保存' }).click();
await sleep(800);
const saved = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const cards = await repo.listCards();
  const card = cards[0];
  const book = await repo.getCardBook(card.id);
  return {
    cardBookName: card.character_book?.name || '',
    cardBookKeys: card.character_book?.entries?.[0]?.key || [],
    linkedId: card.character_book_id || '',
    worldName: book?.name || '',
    worldScope: book?.scope || '',
    worldContent: book?.entries?.[0]?.content || '',
  };
});
check('保存写入卡内嵌书', saved.cardBookName === '琥珀私藏' && saved.cardBookKeys.includes('私藏'), JSON.stringify(saved));
check('同步嵌入态世界书', saved.linkedId && saved.worldName === '琥珀私藏' && saved.worldScope === 'embedded', saved.linkedId);
check('内嵌条目内容已保存', /第二把钥匙/.test(saved.worldContent));
check('无 pageerror', errors.length === 0, errors.join('\n'));
await page.screenshot({ path: 'dev/card-embedded-book.png' });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `CARD BOOK FAILED (${results.length - failed.length}/${results.length})` : `CARD BOOK OK (${results.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
