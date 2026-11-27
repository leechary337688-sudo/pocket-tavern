// 0.6 房间核心纯函数：输出闸、采样档位、stop、路由、状态账本。
import assert from 'node:assert/strict';
import { sanitizeOutput, looksAdvancing, stripSpeakerHeaders } from '../src/core/room-sanitizer.js';
import { applyTier, normalizeSampler, STOP_WORDS } from '../src/core/sampler.js';
import { ApiClient } from '../src/core/api-client.js';
import { selectSpeakers } from '../src/core/room-router.js';
import { extractLedger, ledgerText } from '../src/core/room-state.js';

const cast = [{ name: '甲', id: 'a' }, { name: '乙', id: 'b' }];
const results = [];
function check(name, fn) {
  try { fn(); results.push(true); console.log(`PASS  ${name}`); }
  catch (err) { results.push(false); console.log(`FAIL  ${name} — ${err.message}`); }
}

check('输出闸去掉说话人标题并标记串台', () => {
  const r = sanitizeOutput('（甲放下杯子）\n【乙】\n「你来了。」', { cast, char: '甲', viewerName: '甲' });
  assert.ok(!r.text.includes('【乙】'), r.text);
  assert.equal(r.removed.includes('speaker-header'), true, JSON.stringify(r));
});

check('输出闸去掉动作里的第一人称主语', () => {
  const r = sanitizeOutput('（我推开门，环视一圈）「来了。」', { cast, char: '甲', viewerName: '甲' });
  assert.ok(!r.text.includes('我推开门'), r.text);
  assert.ok(r.text.includes('推开门'), r.text);
});

check('输出闸去掉重复行', () => {
  const line = '（把杯子擦亮，放在你面前。）';
  const r = sanitizeOutput(`${line}\n${line}`, { cast, char: '甲', viewerName: '甲' });
  assert.equal(r.text.split(line).length - 1, 1, r.text);
});

check('说话人标题剥离不碰正文', () => {
  const out = stripSpeakerHeaders('【乙】\n（乙抬头）', { cast });
  assert.equal(out.trim(), '（乙抬头）');
});

check('推进信号识别问句与动作结尾', () => {
  assert.equal(looksAdvancing('「你要走了？」'), true);
  assert.equal(looksAdvancing('（他把杯子放下）'), true);
  assert.equal(looksAdvancing('今晚很安静。'), false);
});

check('采样档位 small 收紧 max_tokens 且保留 stop/context', () => {
  const base = normalizeSampler({ context_window: 4096, seed: 7 });
  const small = applyTier(base, 'small');
  assert.equal(small.max_tokens, 220);
  assert.equal(small.context_window, 4096);
  assert.equal(small.seed, 7);
  assert.ok(Array.isArray(small.stop) && small.stop.length > 0);
  assert.ok(small.stop.includes('\n【'));
  assert.ok(small.stop.length <= 4);
});

check('OpenAI 请求带 stop；DeepSeek 不带 repetition_penalty', () => {
  const deep = new ApiClient({
    connection: { endpoint: 'https://api.deepseek.com', apiType: 'openai', model: 'deepseek-flash', apiKey: 'sk-test' },
    sampler: { rep_pen: 1.1 },
  });
  const dreq = deep._buildRequest([{ role: 'user', content: 'hi' }]);
  assert.ok(Array.isArray(dreq.body.stop) && dreq.body.stop.length > 0);
  assert.equal('repetition_penalty' in dreq.body, false);

  const local = new ApiClient({
    connection: { endpoint: 'http://127.0.0.1:1234', apiType: 'openai', model: 'qwen-local', apiKey: '' },
    sampler: { rep_pen: 1.1 },
  });
  const lreq = local._buildRequest([{ role: 'user', content: 'hi' }]);
  assert.equal(lreq.body.repetition_penalty, 1.1);
  assert.ok(Array.isArray(lreq.body.stop) && lreq.body.stop.length > 0);
});

check('路由：默认一轮一人，点谁谁先说', () => {
  const members = [
    { id: 'a', name: '甲', memberState: 'active', talkativeness: 0 },
    { id: 'b', name: '乙', memberState: 'active', talkativeness: 0 },
  ];
  const one = selectSpeakers({ userInput: '乙，你怎么看？', members, turnBudget: 1, rng: () => 0.9 });
  assert.equal(one.turns.length, 1);
  assert.equal(one.turns[0].name, '乙');
  assert.ok(one.turns[0].reason.startsWith('被点名'));
});

check('路由：turnBudget=2 才排两位，退场角色不进池', () => {
  const members = [
    { id: 'a', name: '甲', memberState: 'active', talkativeness: 1 },
    { id: 'b', name: '乙', memberState: 'active', talkativeness: 1 },
    { id: 'c', name: '丙', memberState: 'dead', talkativeness: 1 },
  ];
  const two = selectSpeakers({ userInput: '继续', members, turnBudget: 2, rng: () => 0.1 });
  assert.equal(two.turns.length, 2);
  assert.equal(two.turns.some((t) => t.name === '丙'), false);
});

check('状态账本提取在场/未结并渲染', () => {
  const ledger = extractLedger({
    messages: [{ sender: 'char', speaker: '甲', text: '你要留下来吗？' }],
    members: [{ id: 'a', name: '甲', memberState: 'active' }],
    scene: '雾港酒馆',
  });
  assert.equal(ledger.openLoop, true);
  const text = ledgerText(ledger, { char: '甲', user: '旅人' });
  assert.ok(text.includes('雾港酒馆'));
  assert.ok(text.includes('未结'));
});

console.log(results.every(Boolean) ? `ROOM CORE OK (${results.length}/${results.length})` : `ROOM CORE FAILED (${results.filter(Boolean).length}/${results.length})`);
process.exitCode = results.every(Boolean) ? 0 : 1;
