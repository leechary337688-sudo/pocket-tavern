// agent-prompt — 多 Agent 群聊的“角色视角”提示词组装（0.6：边界收紧）。
//
// 房间仍然只有一条共享消息流；每次调用只站在「当前发言人」的视角：
// - 自己的角色消息 → assistant（不带标签）
// - 其他角色的消息 → user，并加【角色名】前缀（R11：逐句说话人标签）
// - 玩家消息 → user
// - 只把当前角色的卡放进 system，其他角色只出现在“在场”清单里
//
// 0.6 的两处关键改动（见 docs/pt-prompt-v1）：
// - R2：不再把相邻 user 合并成一个大块，每条消息各自成条，边界不再消失；
// - S1/S6：身份锁与输出契约放 system 首尾，并用尾 cue 在最后一条 user 上再钉一次。

import { buildPrompt } from './prompt-builder.js';
import { contractText, identityLock } from './room-composer.js';

function memberById(cast, id) {
  return (cast || []).find((m) => m && m.id === id) || null;
}

function nameOf(message, cast, fallback = '角色') {
  if (!message) return fallback;
  if (message.speaker) return message.speaker;
  const member = memberById(cast, message.cardId);
  return member?.name || fallback;
}

/** 这条消息是不是 viewer 自己说的 */
export function isSelfMessage(m, viewer, cast = []) {
  const viewerId = viewer?.id || '';
  const viewerName = viewer?.name || '';
  if (!m) return false;
  return (viewerId && m.cardId === viewerId)
    || (viewerName && m.speaker === viewerName)
    || (!m.cardId && !m.speaker && cast.length <= 1);
}

/** 只改 prompt 用的副本，不动真实消息。 */
export function mapForAgent(messages = [], viewer = null, cast = []) {
  return (messages || [])
    .filter((m) => m && m.sender !== 'system')
    .map((m) => {
      if (m.sender !== 'char') return { ...m };
      if (isSelfMessage(m, viewer, cast)) return { ...m };
      const speaker = nameOf(m, cast, '另一位角色');
      return {
        ...m,
        sender: 'user',
        text: `【${speaker}】${String(m.text || '')}`,
      };
    });
}

/** 兼容旧调用：0.6 起不再合并（保留导出，行为变为原样返回副本） */
export function mergeAdjacentUser(messages = []) {
  return (messages || []).map((m) => ({ ...m }));
}

/** 在场清单（只有自己是「你」） */
export function castLines({ viewer, cast = [] }) {
  const self = viewer?.name || '当前角色';
  const others = (cast || []).filter((c) => c && c.id !== viewer?.id && c.name);
  if (!others.length) return '';
  const rows = [`· ${self}（你）`];
  for (const o of others) {
    const brief = String(o.personality || o.description || '').split(/[。；;\n]/)[0].slice(0, 20);
    rows.push(`· ${o.name}${brief ? `——${brief}` : ''}`);
  }
  rows.push('本轮只有你说话。其他人的台词、动作、反应都不要写，他们由系统另行安排。');
  return ['【在场】', ...rows].join('\n');
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
 * @param {string} opts.repeatHint 反重复提示（可选）
 * @param {boolean} opts.advance 本轮是否强制推进
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
  userName = '旅人',
  includeCurrentUserInput = true,
  tier = 'mid',
  repeatHint = '',
  advance = false,
} = {}) {
  const mapped = mapForAgent(messages, viewer, cast);
  const char = viewer?.name || '当前角色';
  const user = userName || '旅人';
  // S1 身份锁 + 在场清单 + 世界/插件注入（extraSystem 由调用方作为“可裁剪”内容）
  const locks = [castLines({ viewer, cast }), extraSystem].filter(Boolean).join('\n\n');
  // H3 尾 cue：身份 + 格式在最后一条 user 上再钉一次
  const tailCue = [
    `【现在只写${char}的回应】（）动作、「」对白，${tier === 'small' ? '40–100 字' : '40–120 字'}，结尾留钩子。不要写${user}，不要写别人。`,
    advance ? '【推进】这一轮必须发生一件小事：有人进门、有东西递过来、或有一句话说破了。' : '',
  ].filter(Boolean).join('\n');

  const result = buildPrompt({
    card: viewer,
    speakerCard: viewer,
    cast,
    messages: mapped,
    worlds,
    settings: {
      ...settings,
      __speaker: '',
      __agentMode: true,
      __pinned: identityLock({ char }),
      __tailCue: tailCue,
    },
    // new/regen 的当前用户消息已经在 mapped 末尾；再 append 会重复
    userInput: includeCurrentUserInput ? '' : userInput,
    extraSystem: locks,
    sampler,
    charName: charName || viewer?.name,
    userName: user,
  });

  // S6 输出契约：作为最后一条 system，排在历史与 after 之后（不参与裁剪）
  const contract = contractText({ char, user, tier });
  if (result.messages?.length) {
    result.messages.push({ role: 'system', content: contract });
  }
  if (repeatHint && result.messages?.length) {
    // 反重复提示放在契约前面，保持契约是最后一段 system
    result.messages.splice(result.messages.length - 1, 0, { role: 'system', content: repeatHint });
  }
  result.trace = {
    ...result.trace,
    agent: {
      viewerId: viewer?.id || '',
      viewerName: char,
      mappedMessages: mapped.length,
      includeCurrentUserInput: Boolean(includeCurrentUserInput),
      tier,
      tailCue,
      contract,
    },
  };
  return result;
}
