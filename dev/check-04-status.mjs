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
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE);
await sleep(900);
const setup = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true, onboardingDone: true, nsfw: false,
    connection: { endpoint: 'http://127.0.0.1:8788', apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: {} },
    plugins: { enabled: ['story-status', 'affection', 'chapter-diary', 'plot-director'] },
  });
  const b = await repo.saveCard({
    name: '程墨白', description: '测试用捕快。', personality: '冷静。', scenario: '酒馆。',
    first_mes: '（他抬了抬眼皮。）', mes_example: '', tags: ['测试'], creator: 'test',
  });
  const amber = await repo.getCard('card-amber');
  const chat = await repo.createChat(amber, {
    title: '状态归属测试', kind: 'group', memberIds: ['card-amber', b.id],
    messages: [
      { id: 'm-a1', sender: 'char', speaker: '琥珀', cardId: 'card-amber', text: '（琥珀的左臂被划开一道口子，血顺着滴落。）[状态] {"target":"琥珀","add":["流血"],"stacks":2,"turns":3,"note":"玻璃划伤"}', swipes: [], swipeIndex: 0, sendDate: Date.now(), tokenEstimate: 40 },
      { id: 'm-b1', sender: 'char', speaker: '程墨白', cardId: b.id, text: '（程墨白把刀收回鞘里，靠在门边。）', swipes: [], swipeIndex: 0, sendDate: Date.now() + 1000, tokenEstimate: 20 },
    ],
  });
  return { chatId: chat.id, bId: b.id };
});
await page.reload();
await sleep(1500);
await page.evaluate((id) => { location.hash = `#/chat/${id}`; }, setup.chatId);
await sleep(1600);

const dom = await page.evaluate(() => {
  const avatars = [...document.querySelectorAll('.msg__avatar')].map((el) => ({
    cls: el.className,
    badge: el.querySelector('.avatar-deco')?.textContent || '',
    label: el.closest('.msg')?.innerText.split('\n')[0] || '',
  }));
  return { avatars, body: document.body.innerText.slice(0, 300) };
});
check('琥珀头像带流血角标', dom.avatars.some((a) => a.cls.includes('pt-status--dot') && a.badge.includes('🩸')), JSON.stringify(dom.avatars));
check('程墨白头像不受污染', dom.avatars.filter((a) => a.cls.includes('pt-status')).length === 1, JSON.stringify(dom.avatars.filter((a) => a.cls.includes('pt-status'))));
await page.screenshot({ path: 'dev/status04-chat.png' });

await page.locator('.chat-identity').first().click();
await sleep(500);
const profile = await page.locator('.overlay.is-open').innerText().catch(() => '');
check('角色状态卡显示流血与层数', profile.includes('流血') && profile.includes('×2'), profile.slice(0, 160));
check('角色状态卡可切换退场', profile.includes('退场'), '');
await page.screenshot({ path: 'dev/status04-card.png' });
console.log('SETUP', setup, 'ERRORS', errors);
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length ? 'STATUS 0.4 FAIL' : 'STATUS 0.4 OK'} (${checks.length - failed.length}/${checks.length})`);
await browser.close();
if (failed.length) process.exit(1);
