// 验收 #10：后台断流 → 回前台自动续写。
// 用 init script 把 document.visibilityState 变成可控，并让第一次 chat 请求在 800ms 后失败。
// node dev/check-resume.mjs
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

await page.addInitScript(() => {
  let vis = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
  window.__setVisibility = (v) => {
    vis = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  let chatCalls = 0;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/v1/chat/completions')) {
      chatCalls += 1;
      if (vis === 'hidden') {
        window.__firstChatStarted = true;
        return new Promise((_, reject) => {
          setTimeout(() => reject(new TypeError('Failed to fetch (simulated background drop)')), 800);
        });
      }
    }
    return realFetch(input, init);
  };
  window.__chatCalls = () => chatCalls;
});

async function setSettings(mutator) {
  await page.evaluate(async (src) => {
    const fn = eval(`(${src})`);
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pt-db');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const store = db.transaction('settings', 'readwrite').objectStore('settings');
    const s = await new Promise((res, rej) => {
      const r = store.get('app');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    fn(s);
    await new Promise((res, rej) => {
      const r = store.put(s);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }, mutator.toString());
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForTimeout(700);
  }
  await setSettings((s) => {
    s.ageAck = true;
    s.onboardingDone = true;
    s.connection = { apiType: 'openai', endpoint: 'http://127.0.0.1:8788', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: '' };
    s.sampler = { ...s.sampler, temperature: 1.5 };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => (location.hash = '#/chat/chat-demo'));
  await page.waitForTimeout(900);

  // 进入后台再发送
  await page.evaluate(() => window.__setVisibility('hidden'));
  const ta = page.locator('.composer__input');
  await ta.fill('后台测试：讲个故事。');
  await page.locator('.send-btn').click();
  await page.waitForTimeout(6000);
  const hiddenState = await page.evaluate(() => ({
    calls: window.__chatCalls(),
    stateText: document.querySelector('.chat-status')?.innerText,
    hasContinue: [...document.querySelectorAll('button')].some((b) => /继续/.test(b.textContent)),
    notice: document.querySelector('#toast-root')?.innerText,
  }));
  console.log('hidden', hiddenState);
  if (hiddenState.calls < 1) throw new Error('第一次请求没有发起');
  if (!hiddenState.hasContinue && hiddenState.stateText !== '已暂停') {
    throw new Error(`断流后没有出现继续/暂停：${JSON.stringify(hiddenState)}`);
  }

  // 回前台
  await page.evaluate(() => window.__setVisibility('visible'));
  await page.waitForTimeout(3500);
  const visibleState = await page.evaluate(() => {
    const last = [...document.querySelectorAll('.msg--char .msg__bubble')].pop();
    return {
      calls: window.__chatCalls(),
      text: last?.innerText || '',
      hasError: document.body.innerText.includes('Failed to fetch'),
      stateText: document.querySelector('.chat-status')?.innerText,
      notice: document.querySelector('#toast-root')?.innerText,
    };
  });
  console.log('visible', visibleState);
  if (visibleState.calls < 2) throw new Error('回前台没有发起续写请求');
  if (!visibleState.text || visibleState.text.length < 8) throw new Error('续写后消息仍为空');
  if (visibleState.hasError) throw new Error('页面出现原始网络错误文本');
  await page.screenshot({ path: join(HERE, 'resume-ok.png'), fullPage: true });
  if (errors.length) throw new Error(`有 JS 错误：${errors.join(' | ')}`);
  console.log('RESUME OK');
} catch (err) {
  console.error('RESUME FAILED:', err.message);
  await page.screenshot({ path: join(HERE, 'resume-failed.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
