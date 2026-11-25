// 验收 #12：长会话滚动流畅度 + 窗口化渲染检查。
// node dev/check-stress.mjs
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
  await page.waitForTimeout(1000);
  const age = page.getByRole('button', { name: /我已满 18/ });
  if (await age.count()) {
    await age.click();
    await page.waitForTimeout(600);
  }
  const skip = page.getByRole('button', { name: /跳过引导/ });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(500);
  }

  const chatId = await page.evaluate(async () => {
    const { Repo } = await import('/src/data/repo.js');
    const repo = new Repo();
    await repo.init();
    const now = Date.now();
    const text =
      '琥珀把杯子推过来，杯壁还带着温度。她抬眼看你，琥珀色的瞳孔里映着灯。\n「今晚想听个长一点的故事吗？酒还够。」';
    const messages = [];
    for (let i = 0; i < 120; i += 1) {
      messages.push({
        id: `stress-${i}`,
        sender: i % 2 ? 'user' : 'char',
        text: i % 7 === 0 ? `${i} · ${text}` : `第 ${i + 1} 句。${'酒馆的灯影在木桌上晃了一下。'.repeat(1 + (i % 3))}`,
        swipes: [],
        swipeIndex: 0,
        sendDate: now - (120 - i) * 60000,
        tokenEstimate: 30 + (i % 5) * 10,
      });
    }
    const chat = {
      id: 'chat-stress',
      cardId: 'card-amber',
      title: '压力测试 · 120 句',
      messages,
      createdAt: now - 7200000,
      updatedAt: now,
      demo: false,
    };
    await repo.saveChat(chat);
    return chat.id;
  });

  await page.goto(`${BASE}/#/chat/${chatId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  const initial = await page.evaluate(() => ({
    mounted: document.querySelectorAll('.msg').length,
    totalText: document.querySelector('.chat-stream')?.innerText.length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.querySelector('.chat-stream')?.scrollHeight,
  }));
  console.log('initial', initial);
  if (initial.mounted > 60) throw new Error(`窗口化失效，挂载了 ${initial.mounted} 条`);

  const perf = await page.evaluate(async () => {
    const scroller = document.querySelector('.chat-stream');
    if (!scroller) throw new Error('找不到 .chat-stream');
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    const atTop = document.querySelectorAll('.msg').length;

    const frameTimes = [];
    let last = performance.now();
    let frames = 0;
    let direction = 1;
    // 90 帧内反复上下滚动，覆盖窗口重算路径
    await new Promise((resolve) => {
      const step = () => {
        const now = performance.now();
        frameTimes.push(now - last);
        last = now;
        if (scroller.scrollTop <= 0) direction = 1;
        if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 10) direction = -1;
        scroller.scrollTop += 26 * direction;
        frames += 1;
        if (frames < 90) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    await new Promise((r) => setTimeout(r, 250));
    frameTimes.sort((a, b) => a - b);
    const p = (q) => frameTimes[Math.min(frameTimes.length - 1, Math.floor(frameTimes.length * q))];
    return {
      atTop,
      mountedAfter: document.querySelectorAll('.msg').length,
      frames,
      p50: Math.round(p(0.5) * 10) / 10,
      p95: Math.round(p(0.95) * 10) / 10,
      max: Math.round(frameTimes[frameTimes.length - 1] * 10) / 10,
      finalScrollTop: Math.round(scroller.scrollTop),
    };
  });
  console.log('perf', perf);
  if (perf.mountedAfter > 70) throw new Error(`滚动后挂载过多 ${perf.mountedAfter} 条`);
  if (perf.p95 > 40) throw new Error(`p95 帧间隔 ${perf.p95}ms，滚动不够流畅`);
  if (errors.length) throw new Error(`有 JS 错误：${errors.join(' | ')}`);
  await page.screenshot({ path: join(HERE, 'stress-chat.png'), fullPage: false });
  console.log('STRESS OK');
} catch (err) {
  console.error('STRESS FAILED:', err.message);
  await page.screenshot({ path: join(HERE, 'stress-failed.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
