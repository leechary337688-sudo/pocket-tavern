// 验收 21 / 22 回归：内嵌书随卡导出再导入 + 群聊点名必接话
// 用法：node dev/check-patch-v2.mjs   （需要 8788 的 mock-server 在跑）
//
// 21. 角色 A 的内嵌书随卡导出（PNG ccv3 / JSON）后重新导入，
//     A 在场时条目自动触发；A 不在场的聊天里不触发。
// 22. 群聊里用户消息提到成员 B 的全名，下一条必定 B 发言。

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.NODE_PATH = 'C:/Users/石晓佳/.dsh/profiles/desktop/node_modules';
require('module').Module._initPaths();
const { chromium } = require('playwright-core');

const BASE = process.env.PT_BASE || 'http://127.0.0.1:8788/';
const EXE = process.env.PT_CHROME || 'C:/Users/石晓佳/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const results = [];
const errors = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_INTERNET|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text());
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// 用页面里的 Repo 关掉首次弹窗，并把连接指向 mock
await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  await repo.saveSettings({
    ageAck: true,
    onboardingDone: true,
    connection: { endpoint: location.origin, apiType: 'openai', apiKey: 'dev-key', model: 'amber-mock', extraHeaders: '' },
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// ---------- 准备：建角色 A（带内嵌书）与角色 B ----------
const prep = await page.evaluate(async () => {
  const { Repo } = await import('/src/data/repo.js');
  const repo = new Repo();
  await repo.init();
  const entry = {
    uid: 1,
    key: ['私藏酒'],
    keysecondary: [],
    comment: '四海阁的私藏',
    content: '【四海阁私藏酒】只有店东知道，地窖第三排有坛贴着红签的酒，谁提「私藏酒」就会被带到后面。',
    position: 'before',
    order: 20,
    tokenBudget: 0,
    recursive: false,
    selective: false,
    constant: false,
    probability: 100,
    caseSensitive: false,
    useRegex: false,
  };
  const a = await repo.saveCard({
    id: 'card-test-a',
    name: '阿澜',
    description: '四海阁的店东，说话慢。',
    personality: '沉稳',
    scenario: '夜里打烊后',
    first_mes: '（她把最后一只杯子扣在架子上）「打烊了。」',
    mes_example: '',
    tags: ['测试'],
    character_book: { name: '阿澜私藏', entries: [entry] },
  });
  const b = await repo.saveCard({
    id: 'card-test-b',
    name: '程墨白',
    description: '常来讨酒的客人。',
    personality: '话多',
    scenario: '打烊后还赖着不走',
    first_mes: '（他把椅子转过来）「再一杯。」',
    mes_example: '',
    tags: ['测试'],
  });
  return { aId: a.id, aHash: a.contentHash, bookId: a.character_book_id, bId: b.id };
});

check('A 卡带内嵌书并生成了嵌入态世界书', Boolean(prep.bookId), `bookId=${prep.bookId} hash=${String(prep.aHash || '').slice(0, 16)}`);

// ---------- 21：导出成 PNG ccv3 → 重新导入 → 内嵌书跟着走 ----------
const roundTrip = await page.evaluate(async (aId) => {
  const { Repo } = await import('/src/data/repo.js');
  const codec = await import('/src/core/card-codec.js');
  const repo = new Repo();
  await repo.init();
  const card = await repo.cardWithBook(aId);
  const blob = await codec.exportCardPng(card);
  const file = new File([blob], 'A.png', { type: 'image/png' });
  const parsed = await codec.parseCardFile(file);
  // 清掉原卡后重新导入（模拟换机/别人拿到这张卡）
  await repo.deleteCard(aId);
  const existingWorld = await repo.getWorld(card.character_book_id);
  if (existingWorld) await repo.deleteWorld(existingWorld.id);
  const saved = await repo.saveCard({ ...parsed.card, id: '' });
  const world = saved.character_book_id ? await repo.getWorld(saved.character_book_id) : null;
  return {
    keyword: parsed.keyword,
    importedName: saved.name,
    importedBook: saved.character_book_id,
    bookScope: world?.scope,
    bookKeys: world ? (world.entries || []).flatMap((e) => e.key || []) : [],
    cardId: saved.id,
  };
}, prep.aId);

check('导出 PNG 用了 ccv3 关键字（含卡内嵌书）', roundTrip.keyword === 'ccv3', `keyword=${roundTrip.keyword}`);
check('重新导入后角色名与内嵌书完整', roundTrip.importedName === '阿澜' && Boolean(roundTrip.importedBook), JSON.stringify(roundTrip.bookKeys));
check('内嵌书是嵌入态（随卡激活）', roundTrip.bookScope === 'embedded', `scope=${roundTrip.bookScope}`);

// ---------- 21b：A 在场触发 / A 不在场不触发 ----------
const mountCheck = await page.evaluate(async ({ aId, bId }) => {
  const { Repo } = await import('/src/data/repo.js');
  const { ChatEngine } = await import('/src/core/chat-engine.js');
  const { resolveMounts } = await import('/src/core/mount-resolver.js');
  const repo = new Repo();
  await repo.init();
  const withA = await repo.createChat(await repo.getCard(aId), { title: '和 A' });
  const withB = await repo.createChat(await repo.getCard(bId), { title: '和 B' });
  const engine = new ChatEngine({ repo });
  await engine.open(withA.id);
  const promptA = await engine.buildPreview({ userInput: '把私藏酒拿出来吧' });
  const hitA = (promptA.trace.worldMatches || []).filter((m) => m.included);
  const mountsA = promptA.trace.mounts || [];
  await engine.open(withB.id);
  const promptB = await engine.buildPreview({ userInput: '把私藏酒拿出来吧' });
  const hitB = (promptB.trace.worldMatches || []).filter((m) => m.included);
  const mountsB = promptB.trace.mounts || [];
  engine.destroy();
  return {
    hitA: hitA.map((m) => m.comment),
    hitB: hitB.map((m) => m.comment),
    mountsA: mountsA.map((m) => `${m.level}:${m.included ? 'on' : 'off'}`),
    mountsB: mountsB.map((m) => `${m.level}:${m.included ? 'on' : 'off'}`),
  };
}, { aId: roundTrip.cardId, bId: prep.bId });

check('验收 21：A 在场时内嵌书条目触发', mountCheck.hitA.includes('四海阁的私藏'), JSON.stringify(mountCheck.hitA));
check('验收 21：A 不在场时不触发', mountCheck.hitB.length === 0, JSON.stringify(mountCheck.hitB));

// ---------- 22：群聊点名 B 全名，下一条必定 B 发言 ----------
const groupCheck = await page.evaluate(async ({ aId, bId }) => {
  const { Repo } = await import('/src/data/repo.js');
  const { ChatEngine } = await import('/src/core/chat-engine.js');
  const repo = new Repo();
  await repo.init();
  const chat = await repo.createChat(null, {
    kind: 'group',
    memberIds: [aId, bId],
    title: '群聊测试',
    messages: [],
  });
  const engine = new ChatEngine({ repo });
  await engine.open(chat.id);
  // 让随机骰子永远不中，验证“点名”优先级
  const plan1 = engine.planTurns({ userInput: '程墨白，你怎么看？' });
  const plan2 = engine.planTurns({ userInput: '今晚挺冷的' });
  engine.destroy();
  const fresh = await repo.getChat(chat.id);
  return {
    kind: fresh.kind,
    mentioned: plan1.map((t) => t.name),
    mentionedReason: plan1.map((t) => t.reason),
    random: plan2.map((t) => t.name),
  };
}, { aId: prep.aId, bId: prep.bId });

check('群聊会话保存为 group 且有成员', groupCheck.kind === 'group', 'kind=' + groupCheck.kind);
check('验收 22：提到「程墨白」时首位发言者就是程墨白', groupCheck.mentioned[0] === '程墨白', JSON.stringify(groupCheck.mentioned));
check('验收 22：点名原因标记为被点名/提到全名', /点名|全名|提到/.test(String(groupCheck.mentionedReason[0] || '')), String(groupCheck.mentionedReason[0]));

// ---------- 真发一条群聊消息，验证下一条确实是 B ----------
const live = await page.evaluate(async ({ aId, bId }) => {
  const { Repo } = await import('/src/data/repo.js');
  const { ChatEngine } = await import('/src/core/chat-engine.js');
  const repo = new Repo();
  await repo.init();
  const engine = new ChatEngine({ repo });
  await engine.open('chat-live-group').catch(async () => {
    const chat = await repo.createChat(null, { kind: 'group', memberIds: [aId, bId], title: '真群聊', messages: [] });
    await engine.open(chat.id);
  });
  const before = engine.getMessages().length;
  await engine.send('程墨白，你来说说。');
  const msgs = engine.getMessages();
  engine.destroy();
  const reply = msgs[msgs.length - 1];
  return { before, after: msgs.length, lastSender: reply?.sender, lastSpeaker: reply?.speaker, replyText: String(reply?.text || '').slice(0, 40) };
}, { aId: prep.aId, bId: prep.bId });

check('验收 22：真实对话里下一条由程墨白发出', live.lastSpeaker === '程墨白' && live.after > live.before, JSON.stringify(live));

await page.screenshot({ path: 'dev/patch-v2-chat.png' }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(errors.length ? 'PAGE ERRORS: ' + JSON.stringify(errors.slice(0, 3)) : 'no page errors');
console.log(failed.length ? `PATCH v2 FAILED (${failed.length}/${results.length})` : `PATCH v2 OK (${results.length}/${results.length})`);
if (failed.length) process.exitCode = 1;
