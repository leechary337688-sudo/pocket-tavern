// room-composer — 身份锁 / 输出契约 / 尾 cue 的原文（docs/pt-prompt-v1 的 S1、S6）。
// 这几段是“永不裁剪”的硬规则，放在 system 首尾；尾 cue 再钉在最后一条 user 上。

export const TIERS = ['small', 'mid', 'strong'];

/** S1：身份锁 */
export function identityLock({ char = '当前角色' } = {}) {
  return [
    `【身份锁】你是「${char}」。`,
    '用第一人称，但动作行不写主语“我”：写「（放下杯子）…」不写「（我放下杯子）…」。',
    '只输出这一个角色此刻的动作与台词。',
  ].join('\n');
}

/** S6：输出契约（按档位裁剪长度） */
export function contractText({ char = '当前角色', user = '玩家', tier = 'mid' } = {}) {
  const length = tier === 'small'
    ? '40–100 字'
    : tier === 'strong'
      ? '60–160 字'
      : '40–120 字';
  return [
    `【输出契约】只输出「${char}」的回应，${length}。`,
    '格式：（动作）「对白」——动作行不加主语“我”，对白用「」。',
    `不要出现${user}的台词或动作，不要写其他角色，不要写主角名。`,
    '不要旁白、不要总结、不要给建议、不要全知视角。',
    `结尾留一个动作、问题或要求给${user}。`,
  ].join('\n');
}

/** H3：尾 cue（贴在最后一条 user 消息末尾，最省钱的防串台） */
export function tailCue({ char = '当前角色', user = '玩家', tier = 'mid', advance = false } = {}) {
  const length = tier === 'small' ? '40–100 字' : tier === 'strong' ? '60–160 字' : '40–120 字';
  return [
    `【现在只写${char}】（）动作、「」对白，${length}，结尾留钩子；不要写${user}，不要写别人。`,
    advance ? '这一轮必须发生一件小事：有人进门、有东西递过来、或有一句话说破了。' : '',
  ].filter(Boolean).join('\n');
}

/** H1：历史窗口（条数，按档位） */
export function historyWindow(tier = 'mid') {
  return tier === 'small' ? 6 : tier === 'strong' ? 12 : 8;
}
