// room-router — 决定“这一轮谁说话、说几轮、要不要重生成”（docs/pt-prompt-v1 R1/R2）。
// 目标是可预测：默认一轮一个角色，点名才追加，绝不让整桌人自动接力。

import { planSpeakers } from './group-scheduler.js';

export const ROUTER_MODES = ['single', 'natural_order', 'round_robin', 'director', 'mention'];

/**
 * @param {object} opts
 * @param {string} opts.mode 房间模式（single 为一轮一人）
 * @param {string} opts.userInput 玩家这一轮说的话
 * @param {object[]} opts.members 在座成员（含 memberState/talkativeness）
 * @param {object[]} opts.messages 历史消息
 * @param {string} opts.lastSpeakerId 上一位发言者
 * @param {number} opts.turnBudget 本轮最多几人（默认 1）
 * @param {boolean} opts.allowSelfResponses 是否允许同一人连说
 * @param {() => number} opts.rng
 */
export function selectSpeakers({
  mode = 'natural_order',
  userInput = '',
  members = [],
  messages = [],
  lastSpeakerId = '',
  turnBudget = 1,
  allowSelfResponses = false,
  rng = Math.random,
} = {}) {
  const budget = Math.max(1, Math.min(3, Number(turnBudget) || 1));
  const active = (members || []).filter((m) => m && (m.memberState || 'active') === 'active');
  if (!active.length) return { turns: [], blockedMentions: [], reason: 'no-active-member' };

  // 显式 direct：房间里“主角”只有一个——单聊卡
  if (mode === 'single' || active.length === 1) {
    return {
      turns: [{ cardId: active[0].id, name: active[0].name, card: active[0], reason: mode === 'single' ? '单人房' : '唯一成员' }],
      blockedMentions: [],
      reason: 'single',
    };
  }

  const plan = planSpeakers({
    mode: mode === 'single' ? 'natural_order' : mode,
    userInput,
    members: active,
    messages,
    rng,
    allowSelfResponses,
  });

  const turns = [];
  for (const p of plan.plan || []) {
    if (turns.length >= budget) break;
    const id = p.cardId || p.id;
    const member = active.find((m) => m.id === id) || p.card || null;
    if (!member) continue;
    // 不许同一人在一轮之内连说（除非用户显式打开）
    if (!allowSelfResponses && turns.some((t) => t.cardId === id)) continue;
    turns.push({
      cardId: member.id,
      name: member.name,
      card: member,
      reason: p.reason || p.via || 'natural_order',
    });
  }
  if (!turns.length) { const fallback = active.find((m) => m.id !== lastSpeakerId) || active[0]; turns.push({ cardId: fallback.id, name: fallback.name, card: fallback, reason: 'fallback' }); }
  return { turns, blockedMentions: plan.blockedMentions || [], reason: plan.mode || mode };
}

/** 链式接话：只有在“被点名”时才追加，且绝不因为模型自己写出了名字而追加（R1）。 */
export function followUpsFor({ turns = [], spokenIds = [], members = [], lastSpeaker = null, budget = 1 } = {}) {
  const used = new Set(spokenIds);
  if (lastSpeaker?.cardId) used.add(lastSpeaker.cardId);
  const active = (members || []).filter((m) => m && (m.memberState || 'active') === 'active' && !used.has(m.id));
  if (used.size >= budget || !active.length) return [];
  return [];
}
