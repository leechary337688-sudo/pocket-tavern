// 工坊离线验收：node dev/check-ws-offline.mjs
// 需要先跑过任意页面让 Service Worker 接管；本脚本会等待 SW ready 再切离线。
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
await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) throw new Error('no service worker');
  await navigator.serviceWorker.ready;
});
await page.waitForTimeout(800);
await page.goto(`${BASE}/#/workshop`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const onlineInfo = await page.evaluate(() => ({
  online: navigator.onLine,
  cards: document.querySelectorAll('.ws-card').length,
  empty: Boolean(document.querySelector('.ws-empty') && !document.querySelector('.ws-empty').hidden),
}));

await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
const netProbe = await page.evaluate(async () => {
  try {
    const res = await fetch('/__offline_probe__', { cache: 'no-store' });
    return `http:${res.status}`;
  } catch {
    return 'blocked';
  }
});
const offlineInfo = await page.evaluate(() => ({
  online: navigator.onLine,
  title: document.querySelector('.ws-view .topbar h1, .ws-title')?.textContent || '',
  cards: [...document.querySelectorAll('.ws-card')].map((el) => el.querySelector('.ws-card__title')?.textContent),
  empty: Boolean(document.querySelector('.ws-empty') && !document.querySelector('.ws-empty').hidden),
  banner: document.querySelector('.ws-banner')?.textContent || '',
  bodyOverflow: document.body.scrollWidth - innerWidth,
}));
await page.screenshot({ path: join(HERE, 'ws-offline.png') });
await context.setOffline(false);
await browser.close();

const ok = netProbe === 'blocked'
  && offlineInfo.cards.length >= 3
  && offlineInfo.bodyOverflow === 0
  && errors.filter((line) => !line.includes('ERR_INTERNET_DISCONNECTED')).length === 0;
console.log(JSON.stringify({ onlineInfo, netProbe, offlineInfo, errors, ok }, null, 2));
if (!ok) process.exitCode = 1;
