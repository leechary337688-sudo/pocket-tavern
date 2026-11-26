// agent-prompt — 多 Agent 群聊的“角色视角”提示词组装。
//
// 房间仍然只有一条共享消息流；每次调用只站在「当前发言人」的视角：
// - 自己的角色消息 → assistant
// - 其他角色的消息 → user，并加【角色名】前缀
// - 玩家消息 → user
// - 只把当前角色的卡放进 system，其他角色只出现在“在座名单”里
//
// 这样 7B/Claude/Gemini 都不需要猜“我现在是谁”。

import { buildPrompt } from './prompt-builder.js';

function memberById(cast, id) {
  return (cast || []).find((m) => m && m.id === id) || null;
}

function nameOf(message, cast, fallback = '角色') {
  if (!message) return fallback;
  if (message.speaker) return message.speaker;
  const member = memberById(cast, message.cardId);
  return member?.name || fallback;
}

/** 只改 prompt 用的副本，不动真实消息。 */
export function mapForAgent(messages = [], viewer = null, cast = []) {
  const viewerId = viewer?.id || '';
  const viewerName = viewer?.name || '';
  return (messages || [])
    .filter((m) => m && m.sender !== 'system')
    .map((m) => {
      if (m.sender !== 'char') return { ...m };
      const isSelf = (viewerId && m.cardId === viewerId)
        || (viewerName && m.speaker === viewerName)
        || (!m.cardId && !m.speaker && cast.length <= 1);
      if (isSelf) return { ...m };
      const speaker = nameOf(m, cast, '另一位角色');
      return {
        ...m,
        sender: 'user',
        text: `【${speaker}】${String(m.text || '')}`,
      };
    });
}

/**
 * 把连续 user 合并，兼容 Claude/Gemini 等不接受连续同角色的后端。
 * 只合并 user；assistant 仍保留原样。
 */
export function mergeAdjacentUser(messages = []) {
  const out = [];
  for (const m of messages || []) {
    const prev = out[out.length - 1];
    if (m?.role === 'user' && prev?.role === 'user') {
      prev.content = `${prev.content}\n\n${m.content}`;
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

/**
 * 站在 viewer 的视角组装 prompt。
 * @param {object} opts
 * @param {object} opts.viewer 当前角色卡
 * @param {object[]} opts.cast 在座角色卡
 * @param {object[]} opts.messages 房间历史（可包含当前用户消息）
 * @param {object[]} opts.worlds 已解析的世界书
 * @param {object} opts.settings 应用设置
 * @param {string} opts.userInput 只有 continue 等模式才需要额外输入
 * @param {boolean} opts.includeCurrentUserInput 历史里是否已包含当前输入（new/regen 为 true）
 */
export function buildAgentPrompt({
  viewer,
  cast = [],
  messages = [],
  worlds = [],
  settings = {},
  userInput = '',
  extraSystem = '',
  sampler = {},
  charName,
  userName,
  includeCurrentUserInput = true,
} = {}) {
  const mapped = mapForAgent(messages, viewer, cast);
  const identity = [
    `【角色隔离】本轮你只扮演「${viewer?.name || '当前角色'}」。`,
    '历史中，你自己的话在 assistant；其他人的话以【角色名】开头，是别人的发言，不是你说的。',
    '只写自己的动作、对白和内心，不替其他角色说话，不替玩家做决定，不要用第三人称写自己。',
  ].join('\n');
  const sys = [identity, extraSystem].filter(Boolean).join('\n\n');

  const result = buildPrompt({
    card: viewer,
    speakerCard: viewer,
    cast,
    messages: mapped,
    worlds,
    settings: { ...settings, __speaker: viewer?.name || '', __agentMode: true },
    // new/regen 的当前用户消息已经在 mapped 末尾；再 append 会重复
    userInput: includeCurrentUserInput ? '' : userInput,
    extraSystem: sys,
    sampler,
    charName: charName || viewer?.name,
    userName,
  });

  const messagesOut = mergeAdjacentUser(result.messages || []);
  result.messages = messagesOut;
  result.trace = {
    ...result.trace,
    agent: {
      viewerId: viewer?.id || '',
      viewerName: viewer?.name || '',
      mappedMessages: mapped.length,
      includeCurrentUserInput: Boolean(includeCurrentUserInput),
    },
  };
  return result;
}
