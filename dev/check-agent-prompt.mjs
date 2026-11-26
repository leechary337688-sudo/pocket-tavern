import { buildAgentPrompt } from '../src/core/agent-prompt.js';
import { resolveMounts } from '../src/core/mount-resolver.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const cast = [
  { id: 'a', name: '秦照', description: '医生，冷静。', first_mes: 'A 的开场' },
  { id: 'b', name: '白棠', description: '电台主播，嘴快。', first_mes: 'B 的开场' },
  { id: 'c', name: '陆沉', description: '守夜人，沉默。', first_mes: 'C 的开场' },
];
const messages = [
  { id: '1', sender: 'char', cardId: 'a', speaker: '秦照', text: '我先开口。' },
  { id: '2', sender: 'char', cardId: 'b', speaker: '白棠', text: '我插一句。' },
  { id: '3', sender: 'char', cardId: 'c', speaker: '陆沉', text: '（点头）' },
  { id: '4', sender: 'user', text: '你们怎么看？' },
  { id: '5', sender: 'char', cardId: 'a', speaker: '秦照', text: '这局有诈。' },
];

const result = buildAgentPrompt({
  viewer: cast[0],
  cast,
  messages,
  userInput: '你们怎么看？',
  includeCurrentUserInput: true,
  settings: { personaName: '旅人', sampler: { context_window: 8192, max_tokens: 512 } },
  sampler: { context_window: 8192, max_tokens: 512 },
});

const sys = result.messages.find((m) => m.role === 'system')?.content || '';
const assistants = result.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
const users = result.messages.filter((m) => m.role === 'user').map((m) => m.content);

check('system 只放当前角色卡', sys.includes('名称：秦照') && !sys.includes('名称：白棠') && !sys.includes('名称：陆沉'));
check('在座名单仍包含所有人', sys.includes('白棠') && sys.includes('陆沉'));
check('自己的历史是 assistant', assistants.includes('我先开口。') && assistants.includes('这局有诈。') && !assistants.includes('我插一句。'));
check('别人的发言是 user 且带【角色名】', users.some((t) => t.includes('【白棠】我插一句。')) && users.some((t) => t.includes('【陆沉】（点头）')));
check('用户消息只出现一次', users.join('\n').split('你们怎么看？').length - 1 === 1);
check('连续 user 已合并（白棠+陆沉+玩家在同一块）', users.some((t) => t.includes('【白棠】') && t.includes('【陆沉】') && t.includes('你们怎么看？')));
check('trace 记录 agent 视角', result.trace.agent?.viewerName === '秦照');

const preview = buildAgentPrompt({
  viewer: cast[1],
  cast,
  messages: messages.slice(0, 4),
  userInput: '只看我这条',
  includeCurrentUserInput: false,
  settings: { sampler: { context_window: 8192, max_tokens: 512 } },
  sampler: { context_window: 8192, max_tokens: 512 },
});
const pUsers = preview.messages.filter((m) => m.role === 'user').map((m) => m.content);
check('预览（输入未入历史）会补上 userInput', pUsers.some((t) => t.includes('只看我这条')));
check('预览以白棠为视角，秦照是 user', pUsers.some((t) => t.includes('【秦照】')));

// 角色书只挂当前 Agent 自己的
const worlds = [
  { id: 'wa', name: 'A书', entries: [{ key: ['a'], content: 'A' }] },
  { id: 'wb', name: 'B书', entries: [{ key: ['b'], content: 'B' }] },
];
const mounts = resolveMounts({
  chat: { kind: 'group', memberIds: ['a', 'b'], worldIds: [] },
  cards: cast,
  cardBooks: { a: worlds[0], b: worlds[1] },
  worlds,
  settings: { world: { maxBooks: 1 } },
  viewerCardId: 'a',
});
check('Agent A 只挂自己的卡内嵌书', mounts.worlds.length === 1 && mounts.worlds[0].id === 'wa', mounts.worlds.map((w) => w.id).join(','));

console.log(`AGENT PROMPT ${fail ? 'FAIL' : 'OK'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
