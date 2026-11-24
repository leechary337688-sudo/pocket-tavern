// 验收 #1 的安装性检查：用持久化 profile（非隐身）跑 CDP installability。
// node dev/check-installable.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = process.env.NODE_PATH || 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const profile = mkdtempSync(join(tmpdir(), 'pt-install-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
});

try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
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
  await page.waitForTimeout(1200);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const manifest = await cdp.send('Page.getAppManifest');
  const install = await cdp.send('Page.getInstallabilityErrors');
  console.log({ manifestErrors: manifest.errors, installabilityErrors: install.installabilityErrors });
  if (manifest.errors?.length) throw new Error('manifest 有解析错误');
  if (install.installabilityErrors?.length) {
    throw new Error(`不可安装：${install.installabilityErrors.map((e) => e.errorId).join(',')}`);
  }
  const prompt = await page.evaluate(() => ({
    standalone: matchMedia('(display-mode: standalone)').matches,
    hasBeforeInstallPrompt: Boolean(window.__ptInstallReady),
    controlled: Boolean(navigator.serviceWorker?.controller),
  }));
  console.log(prompt);
  console.log('INSTALLABLE OK');
} catch (err) {
  console.error('INSTALLABLE FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
