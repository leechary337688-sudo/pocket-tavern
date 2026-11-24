// AI 生成 + 字段重生 + 三步发布：node dev/check-gen.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePackBytes } from '../src/workshop/packer.js';

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
await wait(600);
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
await wait(700);
await page.goto(`${BASE}/#/workshop/gen`, { waitUntil: 'domcontentloaded' });
await wait(900);
await page.screenshot({ path: join(HERE, 'gen-initial.png') });

const idea = '一个失忆的海盗船长，嘴上不认账，其实很怕黑。';
await page.locator('textarea[aria-label="角色想法"]').fill(idea);
await page.getByRole('button', { name: /调一杯角色卡/ }).click();
await page.waitForSelector('.gen-field', { timeout: 30000 });
await wait(700);

const readFields = () => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('.gen-field')].map((node) => [
    node.dataset.field,
    node.querySelector('input, textarea')?.value ?? '',
  ]),
));
const first = await readFields();
const fieldCount = Object.keys(first).length;
const draftName = first.name;
await page.locator('.gen-fields').scrollIntoViewIfNeeded();
await wait(300);
await page.screenshot({ path: join(HERE, 'gen-card.png'), fullPage: false });

const regen = page.getByRole('button', { name: '重生 开场白' });
const regenCount = await regen.count();
await regen.click();
await wait(2500);
const second = await readFields();
const changed = Object.keys(first).filter((key) => first[key] !== second[key]);
await page.screenshot({ path: join(HERE, 'gen-regen.png'), fullPage: false });

console.log(JSON.stringify({
  fieldCount,
  draftName,
  firstMesChanged: first.first_mes !== second.first_mes,
  changedFields: changed,
  regenCount,
}, null, 2));

// 发布三步：第 2 步必须勾选确认才能继续
await page.getByRole('button', { name: /^发布$/ }).click();
await page.waitForSelector('.publish-flow', { timeout: 8000 });
await page.getByRole('button', { name: /下一步 · 确认分级/ }).click();
await wait(250);
const gateBefore = await page.evaluate(() => {
  const next = [...document.querySelectorAll('.publish-flow button')].find((b) => b.textContent.includes('上传/导出'));
  return { disabled: next?.disabled, confirm: !!document.querySelector('.publish-confirm input') };
});
await page.screenshot({ path: join(HERE, 'publish-step2.png') });
await page.locator('.publish-confirm input').check();
await wait(150);
const gateAfter = await page.evaluate(() => {
  const next = [...document.querySelectorAll('.publish-flow button')].find((b) => b.textContent.includes('上传/导出'));
  return { disabled: next?.disabled };
});
await page.getByRole('button', { name: /下一步 · 上传\/导出/ }).click();
await wait(300);
await page.screenshot({ path: join(HERE, 'publish-step3.png') });
const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
await page.getByRole('button', { name: /导出 \.ptpack/ }).click();
const download = await downloadPromise;
const exportPath = join(HERE, 'export-test.ptpack');
await download.saveAs(exportPath);
await page.getByRole('button', { name: /发布到本地工坊/ }).click();
await page.waitForSelector('.publish-done', { timeout: 15000 });
await page.screenshot({ path: join(HERE, 'publish-done.png') });
await page.getByRole('button', { name: /回到工坊/ }).click();
await wait(900);
await page.goto(`${BASE}/#/workshop`, { waitUntil: 'domcontentloaded' });
await wait(900);
const publishedTitle = await page.evaluate((name) => ({
  found: [...document.querySelectorAll('.ws-card__title')].some((el) => el.textContent === name),
  titles: [...document.querySelectorAll('.ws-card__title')].map((el) => el.textContent),
}), draftName);
await page.screenshot({ path: join(HERE, 'ws-after-publish.png') });

// 发布后的作品也必须能点开详情并试穿
await page.locator('.ws-card', { hasText: draftName }).first().click();
await page.waitForSelector('.ws-detail', { timeout: 8000 });
await page.getByRole('button', { name: /试穿 · 开 3 条试聊/ }).click();
await page.waitForSelector('.ws-trial__msg', { timeout: 30000 });
await wait(1500);
const publishedTrial = await page.evaluate(() => ({
  messages: document.querySelectorAll('.ws-trial__msg').length,
  promote: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent.includes('转正并开聊'))),
}));
await page.screenshot({ path: join(HERE, 'ws-published-trial.png') });

const exportBytes = fs.readFileSync(exportPath);
const parsedExport = parsePackBytes(new Uint8Array(exportBytes));
const exportInfo = {
  bytes: exportBytes.length,
  type: parsedExport.manifest.type,
  title: parsedExport.manifest.title,
  cardName: parsedExport.card?.name || '',
};

console.log(JSON.stringify({ gateBefore, gateAfter, publishedTitle, publishedTrial, exportInfo, errors }, null, 2));
await browser.close();
