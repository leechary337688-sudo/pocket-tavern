// 真实 LM Studio 验收：不 mock，直接把浏览器请求送到 127.0.0.1:1234。
// 目的：验证 0.6 默认一人/一轮两位、身份锁、输出闸、stop 与两 Agent 提示词。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const LLM = process.env.LMSTUDIO_URL || 'http://127.0.0.1:1234';
const MODEL = process.env.LMSTUDIO_MODEL || 'qwen2.5-7b-instruct-uncensored';
const EXE = 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const outDir = path.resolve('dev/lmstudio-real');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/v1/chat/completions')) {
    try { requests.push({ url: req.url(), at: new Date().toISOString(), body: JSON.parse(req.postData() || '{}') }); }
    catch { requests.push({ url: req.url(), raw: req.postData()?.slice(0, 2000) }); }
  }
});

const sleep = (ms) => page.waitForTimeout(ms);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async ({ llm, model }) => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    connection: { endpoint: llm, apiType: 'openai', apiKey: 'lm-studio', model, extraHeaders: '' },
    sampler: { context_window: 8192, max_tokens: 320, temperature: 0.8 },
  });
  const cards = await repo.listCards();
  if (!cards.some((c) => c.name === '程墨白')) {
    await repo.saveCard({
      name: '程墨白',
      description: '雾港的账房先生，话少，记性极好。',
      personality: '克制、慢热，擅长算账和拆台。',
      scenario: '雾港酒馆的角落，他合上账本。',
      first_mes: '「坐。你身上有三样东西不对。」',
      mes_example: '',
      tags: ['雾港', '账房'],
      avatar: '',
    });
  }
}, { llm: LLM, model: MODEL });

await page.goto(BASE + '#/cards', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await sleep(700);

const groupBtn = page.locator('button[aria-label="开一桌群聊"]');
check('卡库有开群聊入口', await groupBtn.count() === 1);
await groupBtn.click();
await sleep(350);
const members = page.locator('.group-member input[type="checkbox"]');
for (let i = 0; i < await members.count(); i++) {
  if (!(await members.nth(i).isChecked())) await members.nth(i).check();
}
await page.locator('.group-editor input.field').first().fill('LM Studio 真实验收');
await page.getByLabel('一轮发言人数').selectOption('2');
await page.locator('.overlay.is-open .btn--primary', { hasText: '开桌' }).click();
await page.waitForURL(/#\/chat\//, { timeout: 5000 });
await sleep(900);
const chatId = decodeURIComponent(page.url().split('#/chat/')[1] || '');
check('进入真实群聊', Boolean(chatId), page.url());
await page.screenshot({ path: path.join(outDir, 'before.png') });

await page.locator('.composer__input').fill('程墨白，你怎么看这局？');
const send = page.locator('button[aria-label="发送"]');
await send.click();
const started = Date.now();
let chat = null;
for (let i = 0; i < 180; i++) {
  await sleep(1000);
  chat = await page.evaluate(async (id) => {
    const { Repo } = await import('/src/data/repo.js');
    const repo = new Repo();
    await repo.init();
    return repo.getChat(id);
  }, chatId);
  const pending = (chat?.messages || []).some((m) => m.pending);
  const chars = (chat?.messages || []).filter((m) => m.sender === 'char');
  if (!pending && chars.length >= 3) break;
}
const elapsed = Date.now() - started;
await page.screenshot({ path: path.join(outDir, 'after.png') });
const messages = (chat?.messages || []).map((m) => ({
  sender: m.sender,
  speaker: m.speaker || '',
  cardId: m.cardId || '',
  text: String(m.text || ''),
  pending: Boolean(m.pending),
  error: m.error || '',
}));
const replies = messages.filter((m) => m.sender === 'char').slice(-3);
const replyText = replies.map((m) => m.text).join('\n');
const cueLeak = replyText.includes('【现在只写');
const firstPersonAction = /（我[\u4e00-\u9fff]/.test(replyText);
const foreignSpeakerHeader = /【(琥珀|程墨白)】/.test(replyText);
const foreignNarration = replyText.split('\n').some((line) => /^\s*[（(]?(琥珀|程墨白)/.test(line) && !line.includes('「'));
const assistantHeaders = (replyText.match(/^(assistant|Assistant|用户|玩家)[：:]/gm) || []).length;
const secondSystem = requests[1]?.body?.messages?.find((m) => m.role === 'system')?.content || '';
const secondScene = (secondSystem.match(/【此刻】\n地点：([^\n]+)/) || [])[1] || '';

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({
  model: MODEL, endpoint: LLM, chatId, elapsed, requests, messages, errors,
  metrics: { cueLeak, firstPersonAction, foreignSpeakerHeader, foreignNarration, assistantHeaders, secondScene },
}, null, 2));

check('真实 7B 生成完成', !messages.some((m) => m.pending) && messages.some((m) => m.sender === 'char'), `${elapsed}ms`);
check('至少两位角色接话（turnBudget=2）', replies.length >= 2, `replies=${replies.length}`);
check('发言人有名字且不是 card id', replies.every((m) => m.speaker && !m.speaker.startsWith('card_')), JSON.stringify(replies.map((m) => m.speaker)));
check('回复不是错误态', !messages.some((m) => m.error) && errors.length === 0, JSON.stringify(messages.filter((m) => m.error)));
check('输出没有尾 cue 泄漏', !cueLeak);
check('输出没有【别人】标题串台', !foreignSpeakerHeader);
check('输出没有“别人做主语”的旁白', !foreignNarration);
check('输出没有 assistant/用户 标题', assistantHeaders === 0);
check('输出没有“（我…”主语句', !firstPersonAction);
check('第二个 Agent 的“此刻”是自己的场景', secondScene.includes('深夜的城市边缘'), secondScene);
const repOk = MODEL.toLowerCase().includes('deepseek')
  ? requests.every((r) => !('repetition_penalty' in r.body))
  : requests.length > 0;
check('请求带 stop 且重复惩罚符合后端规则', requests.length > 0 && requests.every((r) => Array.isArray(r.body?.stop) && r.body.stop.length <= 4) && repOk, JSON.stringify(requests.map((r) => ({ stop: r.body?.stop, rep: r.body?.repetition_penalty }))));
console.log('\n--- REPLIES ---');
for (const m of replies) console.log(`[${m.speaker || m.cardId}] ${m.text}\n`);
console.log('--- REQUEST ROLES ---');
for (const [i, r] of requests.entries()) console.log(i, (r.body?.messages || []).map((m) => `${m.role}:${String(m.content).slice(0, 50).replace(/\n/g, ' / ')}`));
console.log('--- ERRORS ---', errors.slice(0, 3));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? 'REAL LM STUDIO FAILED' : 'REAL LM STUDIO OK'} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exitCode = 1;
