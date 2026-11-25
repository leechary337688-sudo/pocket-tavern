// 0.4 插件层单元验收：用假 STLite 直接驱动四个剧情插件。
// 不依赖浏览器；覆盖验收 23/24/25/26/27/30 的插件部分。
import assert from 'node:assert/strict';
import storyStatus from '../plugins/story-status/plugin.js';
import affection from '../plugins/affection/plugin.js';
import diary from '../plugins/chapter-diary/plugin.js';
import director from '../plugins/plot-director/plugin.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function makeApi({ members = [], mounts = { worlds: [] }, messages = [], storage = {}, llmText = '摘要正文' } = {}) {
  const handlers = new Map();
  const panelList = [];
  const memberCardList = [];
  const decorations = [];
  const toasts = [];
  const memberState = new Map(members.map((m) => [m.id, m.memberState || 'active']));
  const store = { ...storage };
  const api = {
    storage: {
      async get(key, fallback) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback; },
      async set(key, value) { store[key] = JSON.parse(JSON.stringify(value)); },
      async remove(key) { delete store[key]; },
      async keys() { return Object.keys(store); },
      async clear() { for (const key of Object.keys(store)) delete store[key]; },
    },
    eventSource: {
      on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); return () => {}; },
      off() {},
      emit(name, payload) { for (const fn of handlers.get(name) || []) fn(payload); },
    },
    chat: {
      getChatInfo() { return { id: 'c1', kind: members.length > 1 ? 'group' : 'single', memberIds: members.map((m) => m.id) }; },
      getMembers() { return members.map((m) => ({ ...m, memberState: memberState.get(m.id) || 'active' })); },
      getMounts() { return mounts; },
      getMessages() { return messages.slice(); },
      setMemberState(id, state) { memberState.set(id, state); api.eventSource.emit('chat:memberChanged', { memberId: id, state }); },
    },
    llm: { async complete() { return llmText; } },
    ui: {
      registerPanel(item) { panelList.push(item); return () => {}; },
      registerMemberCard(item) { memberCardList.push(item); return () => {}; },
      registerAvatarDecorator(resolve) { decorations.push(resolve); return () => {}; },
      toast(text) { toasts.push(text); },
      jumpToMessage() {},
    },
  };
  return { api, store, toasts, decorations, panelList, memberCardList, memberState, emit: (n, p) => api.eventSource.emit(n, p) };
}

function msg(id, text, speaker = '琥珀', cardId = 'm1', sender = 'char') {
  return { id, text, speaker, cardId, sender, sendDate: Date.now() };
}

async function testStoryStatus() {
  const members = [
    { id: 'm1', name: '琥珀', talkativeness: 0.5 },
    { id: 'm2', name: '程墨白', talkativeness: 0.5 },
  ];
  const messages = [];
  const env = makeApi({ members, messages });
  const inst = storyStatus.init(env.api);
  await sleep(30);
  env.emit('app:ready');
  env.emit('chat:messageReceived', { message: msg('s1', '（琥珀左臂被划开一道口子，血顺着滴落。）[状态] {"target":"琥珀","add":["流血"],"stacks":2,"turns":3,"note":"玻璃划伤"}') });
  env.emit('chat:generateAfter', { message: msg('s1', '') });
  await sleep(220);
  let st = env.store.chats.chats.c1;
  check('23/24 状态归属琥珀且层数 2', (st.statuses.m1 || []).some((s) => s.name === '流血' && s.stacks === 2), JSON.stringify(st.statuses));
  check('23 程墨白未被污染', !(st.statuses.m2 || []).length, JSON.stringify(st.statuses.m2 || []));
  env.emit('chat:generateAfter', { message: msg('s2', '') });
  env.emit('chat:generateAfter', { message: msg('s3', '') });
  env.emit('chat:generateAfter', { message: msg('s4', '') });
  await sleep(220);
  st = env.store.chats.chats.c1;
  const bleed = (st.statuses.m1 || []).find((s) => s.name === '流血');
  check('24 回合递减/到期移除', !bleed, `turn=${st.turn} log=${st.log.slice(0, 3).map((l) => l.type + ':' + l.name).join(',')}`);
  check('24 到期写日志', st.log.some((l) => l.type === 'expire' && l.name === '流血'), JSON.stringify(st.log.slice(0, 2)));

  // 情感 + 多状态优先级
  env.emit('chat:messageReceived', { message: msg('s5', '[状态] {"target":"琥珀","add":["心动"]}') });
  env.emit('chat:generateAfter', { message: msg('s5', '') });
  await sleep(220);
  const deco = env.decorations[0]?.({ card: { name: '琥珀', id: 'm1' } });
  check('25 情感状态角标', deco?.state?.badge === '💗' || deco?.badge === '💗', JSON.stringify(deco));
  env.emit('chat:messageReceived', { message: msg('s6', '[状态] {"target":"琥珀","add":["流血"]}') });
  env.emit('chat:generateAfter', { message: msg('s6', '') });
  await sleep(220);
  const deco2 = env.decorations[0]?.({ card: { name: '琥珀', id: 'm1' } });
  check('25 dot 优先于 emotion', JSON.stringify(deco2).includes('🩸') && !JSON.stringify(deco2).includes('💗'), JSON.stringify(deco2));

  // 关键词只归发言者本人
  env.emit('chat:messageReceived', { message: msg('s7', '（我受伤了，血顺着流下。）', '程墨白', 'm2') });
  await sleep(220);
  st = env.store.chats.chats.c1;
  check('23 关键词只归发言者', (st.statuses.m2 || []).some((s) => s.name === '流血') && !(st.statuses.m1 || []).some((s) => s.name === '流血' && s.source === '关键词'), JSON.stringify(st.statuses));
  inst.unload?.();
}

async function testAffection() {
  const members = [{ id: 'm1', name: '琥珀', talkativeness: 0.5 }];
  const env = makeApi({ members });
  const inst = affection.init(env.api);
  await sleep(30);
  for (let i = 0; i < 12; i += 1) {
    env.emit('chat:messageReceived', { message: msg(`a${i}`, '[好感] {"target":"player","delta":5}') });
  }
  await sleep(220);
  const pair = env.store.state.chats.c1.pairs['m1|player'];
  check('26 好感 +5 ×12 = 60', pair?.score === 60, JSON.stringify(pair));
  env.emit('chat:messageReceived', { message: msg('a12', '[好感] {"target":"player","delta":10}') });
  await sleep(220);
  const sweets = env.store.state.chats.c1.sweets || [];
  check('26 delta≥8 记发糖', sweets.length >= 1 && sweets[0].delta === 10, JSON.stringify(sweets.slice(0, 1)));
  inst.unload?.();
}

async function testDiary() {
  const members = [{ id: 'm1', name: '琥珀', talkativeness: 0.5 }];
  const messages = [];
  const env = makeApi({ members, messages });
  const inst = diary.init(env.api);
  await sleep(30);
  for (let i = 0; i < 15; i += 1) env.emit('chat:messageSent', { message: msg(`u${i}`, '测试', '你', '', 'user') });
  env.emit('chat:changed');
  await sleep(400);
  const st = env.store.state.chats.c1;
  check('27 15 回合生成章节摘要', (st.entries || []).length >= 1 && st.entries[0].text === '摘要正文', JSON.stringify(st.entries?.[0]));
  inst.unload?.();

  // 48h 前情提要：旧 lastSeen + 已有章节
  const old = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
  const seedState = { chats: { c1: { ...st, lastSeen: old, pendingGap: '', lastInjected: '' } } };
  const env2 = makeApi({ members, storage: { state: seedState } });
  const inst2 = diary.init(env2.api);
  await sleep(30);
  env2.emit('app:ready');
  await sleep(30);
  const prompt = [];
  env2.emit('chat:promptReady', { prompt });
  const injected = prompt.some((p) => String(p.content || '').includes('前情提要'));
  check('27 48h 前情提要注入', injected, JSON.stringify(prompt.slice(-1)));
  inst2.unload?.();
}

async function testDirector() {
  const members = [{ id: 'm1', name: '琥珀', talkativeness: 0.5 }];
  const mounts = { worlds: [{ id: 'w1', name: '测试书', entries: [
    { uid: 1, comment: '真相：账本藏在船底', key: ['船底'], content: '真相：账本藏在船底' },
  ] }] };
  const env = makeApi({ members, mounts });
  const inst = director.init(env.api);
  await sleep(30);
  env.emit('app:ready');
  await sleep(300);
  for (let i = 0; i < 10; i += 1) env.emit('chat:generateAfter', { message: msg(`d${i}`, '她看着窗外，没有动作。') });
  const prompt = [];
  env.emit('chat:promptReady', { prompt });
  check('28 伏笔扫描', env.store.state.chats.c1.foreshadows?.length === 1, JSON.stringify(env.store.state.chats.c1.foreshadows));
  check('剧情导演连续平淡注入', prompt.some((p) => String(p.content || '').includes('节奏提示')), JSON.stringify(prompt));
  check('糖分密度注入', prompt.some((p) => String(p.content || '').includes('糖分密度')), JSON.stringify(prompt));
  inst.unload?.();
}

await testStoryStatus();
await testAffection();
await testDiary();
await testDirector();

const failed = results.filter((r) => !r.ok);
console.log(`${failed.length ? '04 PLUGINS FAIL' : '04 PLUGINS OK'} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exit(1);

