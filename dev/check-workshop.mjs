// 创意工坊验收：node dev/check-workshop.mjs
// 依赖本地 mock：127.0.0.1:8788。会写入测试用 IndexedDB 数据。
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
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await wait(700);

// 先用页面内 Repo 写测试设置，避免依赖引导点击。
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
      extraHeaders: {},
    },
    workshop: {
      remoteEnabled: false,
      remoteUrl: '',
      demoSource: true,
      genModel: '',
      genTemperature: 0.9,
      genLanguage: 'zh',
    },
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(900);

await page.goto(`${BASE}/#/workshop`, { waitUntil: 'domcontentloaded' });
await wait(1000);
await page.screenshot({ path: join(HERE, 'ws-list.png'), fullPage: false });
const listInfo = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.ws-card')].map((el) => el.querySelector('.ws-card__title')?.textContent),
  tabs: [...document.querySelectorAll('.ws-tab')].map((el) => el.textContent),
  empty: !document.querySelector('.ws-empty')?.hidden,
  bodyOverflow: document.body.scrollWidth - innerWidth,
  docOverflow: document.documentElement.scrollWidth - innerWidth,
}));
console.log(JSON.stringify({ listInfo, errors }, null, 2));

// ---- 试穿：3 条 → 丢弃零残留 ----
const counts = () => page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  return { cards: (await repo.listCards()).length, chats: (await repo.listChats()).length, worlds: (await repo.listWorlds()).length };
});
const before = await counts();
const trialBtn = page.getByRole('button', { name: '试穿 雾港的薇拉' });
console.log('trial button count', await trialBtn.count());
await trialBtn.click();
await page.waitForSelector('.ws-trial', { timeout: 10000 });
const promote = page.getByRole('button', { name: /转正并开聊/ });
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll('.ws-trial__actions button')].find((b) => b.textContent.includes('转正并开聊'));
  return btn && !btn.disabled;
}, { timeout: 30000 }).catch(() => {});
const trialInfo = await page.evaluate(() => ({
  messages: [...document.querySelectorAll('.ws-trial__msg')].map((el) => el.className),
  hint: document.querySelector('.ws-trial__hint')?.textContent,
  promoteDisabled: [...document.querySelectorAll('.ws-trial__actions button')].find((b) => b.textContent.includes('转正并开聊'))?.disabled,
  actions: [...document.querySelectorAll('.ws-trial__actions button, .ws-trial__send')].map((b) => ({
    text: b.textContent.trim(),
    h: Math.round(b.getBoundingClientRect().height),
    w: Math.round(b.getBoundingClientRect().width),
  })),
}));
await page.screenshot({ path: join(HERE, 'ws-trial.png') });
console.log(JSON.stringify({ before, trialInfo }, null, 2));

const discardBtn = page.getByRole('button', { name: /丢弃，零残留/ });
await discardBtn.click();
await page.waitForTimeout(250);
const confirmDiscard = page.getByRole('button', { name: '丢弃', exact: true });
console.log('confirm discard count', await confirmDiscard.count());
await confirmDiscard.click();
await page.waitForTimeout(600);
const afterDiscard = await counts();
const trialAfterDiscard = await page.locator('.ws-trial').count();
console.log(JSON.stringify({ afterDiscard, trialAfterDiscard }, null, 2));

// ---- 试穿：3 条 → 转正 ----
await page.getByRole('button', { name: '试穿 雾港的薇拉' }).click();
await page.waitForSelector('.ws-trial', { timeout: 10000 });
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll('.ws-trial__actions button')].find((b) => b.textContent.includes('转正并开聊'));
  return btn && !btn.disabled;
}, { timeout: 30000 }).catch(() => {});
await page.screenshot({ path: join(HERE, 'ws-trial-ready.png') });
await page.getByRole('button', { name: /转正并开聊/ }).click();
await page.waitForTimeout(1100);
const afterPromote = await counts();
console.log(JSON.stringify({ afterPromote, hash: await page.evaluate(() => location.hash) }, null, 2));
await page.screenshot({ path: join(HERE, 'ws-promoted-chat.png') });

await browser.close();
