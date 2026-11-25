import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

await page.goto(BASE);
await page.waitForTimeout(500);
const result = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const { loadPreset, presetStatus, installPreset } = await import('/src/data/preset-loader.js');
  const repo = new Repo();
  await repo.init();
  const before = await repo.stats();
  const fog = await loadPreset('fog-harbor');
  const statusBefore = await presetStatus(repo, fog);
  const first = await installPreset(repo, fog);
  const afterFirst = await repo.stats();
  const second = await installPreset(repo, fog);
  const afterSecond = await repo.stats();
  const settings = repo.settings;
  const cards = await repo.listCards();
  const worlds = await repo.listWorlds();
  const phoenix = await loadPreset('phoenix-palace');
  const third = await installPreset(repo, phoenix);
  const afterThird = await repo.stats();
  const cardsAfter = await repo.listCards();
  const worldsAfter = await repo.listWorlds();
  return {
    before, statusBefore, first, afterFirst, second, afterSecond, third, afterThird,
    quickReplies: repo.settings.quickReplies?.length || 0,
    fogNames: cardsAfter.filter((c) => c.presetId === 'fog-harbor').map((c) => c.name),
    phoenixNames: cardsAfter.filter((c) => c.presetId === 'phoenix-palace').map((c) => c.name),
    worldScopes: worldsAfter.map((w) => ({ name: w.name, scope: w.scope, presetId: w.presetId, entries: w.entries.length })),
  };
});
console.log(JSON.stringify(result, null, 2));
check('载入前不自动写卡', result.before.cards === 1 && result.before.worlds >= 1, JSON.stringify(result.before));
check('雾港 12 卡 + 1 主世界书', result.fogNames.length === 12 && result.afterFirst.worlds - result.before.worlds === 13, JSON.stringify({ fogCards: result.fogNames.length, before: result.before, after: result.afterFirst }));
check('雾港 22 条文设定', result.worldScopes.some((w) => w.presetId === 'fog-harbor' && w.entries === 22), JSON.stringify(result.worldScopes.filter((w) => w.presetId === 'fog-harbor')));
check('重复载入幂等', result.second.cards === 0 && result.second.updated === 0 && result.second.skipped === 12 && result.afterSecond.cards === result.afterFirst.cards, JSON.stringify(result.second));
check('凤阙 12 卡 + 1 主世界书', result.phoenixNames.length === 12 && result.third.cards === 12, JSON.stringify({ phoenix: result.phoenixNames.length, third: result.third }));
check('快捷回复合并 11 条', result.quickReplies === 11, String(result.quickReplies));
check('主世界书为馆藏、卡内嵌书为 embedded', result.worldScopes.filter((w) => w.scope === 'library').length >= 2 && result.worldScopes.filter((w) => w.scope === 'embedded').length >= 24, JSON.stringify(result.worldScopes.slice(0, 6)));
check('无 pageerror', errors.length === 0, errors.join('\n'));

const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length ? 'PRESETS FAIL' : 'PRESETS OK'} (${checks.length - failed.length}/${checks.length})`);
await browser.close();
if (failed.length) process.exit(1);
