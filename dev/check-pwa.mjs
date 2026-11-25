// 验收 #11：PWA 壳离线可开 + manifest/图标/SW 检查。
// node dev/check-pwa.mjs
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
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForTimeout(700);
  }
  const skip = page.getByRole('button', { name: /跳过引导/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(700);
  }

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.href;
    const res = await fetch(href);
    return { href, status: res.status, json: await res.json() };
  });
  console.log('manifest', {
    href: manifest.href,
    status: manifest.status,
    name: manifest.json.name,
    display: manifest.json.display,
    start_url: manifest.json.start_url,
    icons: manifest.json.icons?.map((i) => `${i.sizes}:${i.purpose || 'any'}`),
  });
  if (manifest.status !== 200) throw new Error('manifest 无法加载');
  if (manifest.json.display !== 'standalone') throw new Error('manifest display 不是 standalone');
  const sizes = (manifest.json.icons || []).map((i) => i.sizes);
  if (!sizes.includes('192x192') || !sizes.includes('512x512')) throw new Error('缺少 192/512 图标');

  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const appManifest = await cdp.send('Page.getAppManifest');
  const installability = await cdp.send('Page.getInstallabilityErrors').catch((err) => ({ error: err.message }));
  console.log('cdp manifest', {
    url: appManifest.url,
    errors: appManifest.errors?.map((e) => e.message),
    installabilityErrors: installability.installabilityErrors,
  });
  if (appManifest.errors?.length) throw new Error(`manifest 解析错误：${appManifest.errors[0].message}`);
  const installErrors = installability.installabilityErrors || [];
  const blockingInstallErrors = installErrors.filter((e) => e.errorId !== 'in-incognito');
  if (blockingInstallErrors.length) {
    throw new Error(`浏览器认为不可安装：${blockingInstallErrors.map((e) => e.errorId).join(',')}`);
  }
  if (installErrors.some((e) => e.errorId === 'in-incognito')) {
    console.log('note: Playwright 上下文是隐身模式，Chrome 只会报 in-incognito；非隐身窗口安装入口需人工确认');
  }

  const iconStatus = await page.evaluate(async (base) => {
    const out = {};
    for (const p of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']) {
      const r = await fetch(base + '/' + p, { cache: 'no-store' });
      out[p] = r.status;
    }
    return out;
  }, BASE);
  console.log('icons', iconStatus);
  if (Object.values(iconStatus).some((s) => s !== 200)) throw new Error('有图标不是 200');

  // 等 SW 装好，并让当前页被 SW 接管
  await page.waitForFunction(() => navigator.serviceWorker?.ready, null, { timeout: 10000 });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
  }
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    const reqs = await cache.keys();
    return {
      scope: reg.scope,
      active: reg.active?.state,
      controlled: Boolean(navigator.serviceWorker.controller),
      caches: keys,
      cached: reqs.length,
      cachedMain: reqs.some((r) => r.url.endsWith('/index.html') || r.url.endsWith('/')),
    };
  });
  console.log('sw', sw);
  if (!sw.controlled) throw new Error('页面未被 Service Worker 接管');
  if (!sw.caches.length) throw new Error('没有缓存');
  if (!sw.cached) throw new Error('precache 为空');

  // 离线重载
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const offline = await page.evaluate(() => ({
    title: document.title,
    hasHome: Boolean(document.querySelector('.home-view')),
    hasHeroText: document.body.innerText.includes('今夜，想和谁'),
    text: document.body.innerText.slice(0, 160),
  }));
  console.log('offline', offline);
  if (!offline.hasHome || !offline.hasHeroText) throw new Error('离线刷新后应用壳没有打开');
  await page.screenshot({ path: join(HERE, 'pwa-offline.png'), fullPage: true });

  // 插件 entry 带 ?v= 查询串，离线时也必须命中 precache，否则 STLite 面板会静默消失。
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForTimeout(600);
  const offlinePlugins = await page.evaluate(() => ({
    hasTokenPanel: document.body.innerText.includes('上下文酒量'),
    hasDicePanel: document.body.innerText.includes('骰子记录'),
    hasStoryPanel: document.body.innerText.includes('剧情状态'),
    toasts: document.querySelector('#toast-root')?.innerText || '',
  }));
  console.log('offline plugins', offlinePlugins);
  if (!offlinePlugins.hasTokenPanel || !offlinePlugins.hasDicePanel || !offlinePlugins.hasStoryPanel) {
    throw new Error('离线时插件面板没有加载');
  }

  if (errors.length) throw new Error(`有 JS 错误：${errors.join(' | ')}`);
  console.log('PWA OK');
} catch (err) {
  console.error('PWA FAILED:', err.message);
  await page.screenshot({ path: join(HERE, 'pwa-failed.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
