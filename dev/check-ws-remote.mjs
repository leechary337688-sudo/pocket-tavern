// 远程工坊验收：node dev/check-ws-remote.mjs
// 本地 mock 实现 GET /api/list、GET /api/item/:id、POST /api/publish。
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

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    workshop: {
      remoteEnabled: true,
      remoteUrl: 'http://127.0.0.1:8788',
      demoSource: true,
      genLanguage: 'zh',
    },
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

const published = await page.evaluate(async () => {
  const { WORKSHOP_DEMO_ITEMS, publishPack } = await import('/src/workshop/registry.js');
  const { buildPack } = await import('/src/workshop/packer.js');
  const demo = WORKSHOP_DEMO_ITEMS.find((item) => item.type === 'card');
  const pack = buildPack({
    type: 'card',
    card: demo.card,
    meta: {
      title: '远程测试卡',
      author: 'remote-tester',
      tags: ['远程', '测试'],
      contentRating: 'general',
      changelog: '首个远程发布。',
    },
  });
  const item = await publishPack({
    repo: null,
    settings: { workshop: { remoteEnabled: true, remoteUrl: 'http://127.0.0.1:8788' } },
    pack,
  });
  return { id: item.id, title: item.title, type: item.type, size: pack.size };
});

await page.goto(`${BASE}/#/workshop`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const listInfo = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.ws-card')].map((el) => el.querySelector('.ws-card__title')?.textContent),
  banner: document.querySelector('.ws-banner')?.textContent || '',
  overflow: document.body.scrollWidth - innerWidth,
}));
await page.screenshot({ path: join(HERE, 'ws-remote.png') });
await browser.close();

const ok = published.title === '远程测试卡'
  && listInfo.cards.includes('远程测试卡')
  && !listInfo.banner
  && listInfo.overflow === 0
  && errors.length === 0;
console.log(JSON.stringify({ published, listInfo, errors, ok }, null, 2));
if (!ok) process.exitCode = 1;
