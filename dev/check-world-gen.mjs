// 世界书生成与表格校验：node dev/check-world-gen.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = process.env.NODE_PATH || 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await wait(600);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo(); await repo.init();
  await repo.saveSettings({
    ageAck: true, onboardingDone: true,
    connection: { endpoint: 'http://127.0.0.1:8788', apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
    workshop: { remoteEnabled: false, remoteUrl: '', demoSource: true, genModel: '', genTemperature: 0.9, genLanguage: 'zh' },
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(700);
await page.goto(`${BASE}/#/workshop/gen`, { waitUntil: 'domcontentloaded' });
await wait(700);
await page.getByRole('button', { name: '世界书' }).click();
await wait(250);
await page.locator('textarea[aria-label="世界设定"]').fill('雾港常年下雨，旧海关二十年前因走私案关闭，城里所有书商都欠同一个人人情。');
await page.getByRole('button', { name: /拆成世界书/ }).click();
try {
  await page.waitForSelector('.gen-world-row', { timeout: 30000 });
} catch (err) {
  await page.screenshot({ path: join(HERE, 'gen-world-fail.png') });
  const debug = await page.evaluate(() => ({
    status: document.querySelector('.gen-status')?.textContent,
    toast: document.querySelector('#toast-root')?.textContent,
    body: document.body.innerText.slice(-1200),
  }));
  console.log(JSON.stringify({ debug, errors }, null, 2));
  throw err;
}
await wait(500);
const rows = await page.evaluate(() => [...document.querySelectorAll('.gen-world-row')].map((row) => ({
  keys: row.querySelector('.gen-world-row__keys')?.value,
  comment: row.querySelector('input[aria-label*="条目名"], input[placeholder*="条目"]')?.value,
  error: row.querySelector('.gen-world-row__error')?.textContent,
})));
await page.screenshot({ path: join(HERE, 'gen-world.png') });

// 制造重复 key：把第一行 key 改成第二行第一个 key
const keyInputs = page.locator('.gen-world-row__keys');
const beforeKeys = await keyInputs.evaluateAll((nodes) => nodes.map((n) => n.value));
await keyInputs.nth(1).fill('雾港');
await page.waitForTimeout(600);
const dupError = await page.evaluate(() => [...document.querySelectorAll('.gen-world-row')].map((row) => ({
  keys: row.querySelector('.gen-world-row__keys')?.value,
  cls: row.className,
  error: row.querySelector('.gen-world-row__error')?.textContent,
})));
await page.screenshot({ path: join(HERE, 'gen-world-dup.png') });

// 修回唯一 key
await keyInputs.nth(1).fill(beforeKeys[1]);
await page.waitForTimeout(300);
const afterFixError = await page.evaluate(() => [...document.querySelectorAll('.gen-world-row__error')].map((el) => el.textContent).filter(Boolean));
const beforeSave = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js'); const repo = new Repo(); await repo.init();
  return (await repo.listWorlds()).length;
});
await page.getByRole('button', { name: /存入世界书/ }).click();
await wait(800);
const afterSave = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js'); const repo = new Repo(); await repo.init();
  return (await repo.listWorlds()).length;
});
await page.screenshot({ path: join(HERE, 'gen-world-saved.png') });
console.log(JSON.stringify({ count: rows.length, rows: rows.slice(0, 2), dupError, afterFixError, beforeSave, afterSave, errors }, null, 2));
await browser.close();
