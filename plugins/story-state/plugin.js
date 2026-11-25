// story-state — 从聊天文本里推断角色状态，装饰头像并注入下一轮提示词。
// 这是启发式插件：不额外调用模型，也不修改聊天记录；所有判断都来自当前可见消息。

const DEAD_RE = /(?:已经|彻底|确认)?(?:死亡|死了|死了过去|断气|咽气|阵亡|尸体|没有呼吸)/;
const HURT_RE = /(?:受伤|流血|出血|血|刀伤|剑伤|中箭|骨折|挂彩|淤青|伤口|口子|划开|包扎|绷带|血流)/;
const LOCATIONS = ['春灯舫', '画舫', '听雨楼', '临江府', '雾港', '潮见市', '潮汐页', '灯塔', '酒馆', '码头', '书店', '学校', '街道', '房间', '地下室'];

function lastOwnMessages(messages, name) {
  if (!name) return [];
  return messages.filter((m) => m.sender === 'char' && (m.speaker === name || m.speaker === name.trim())).slice(-24);
}

function analyzeName(messages, name) {
  const text = lastOwnMessages(messages, name).map((m) => String(m.text || '')).join('\n');
  let state = 'normal';
  let badge = '';
  let label = '';
  if (DEAD_RE.test(text)) {
    state = 'dead';
    badge = '✝';
    label = '已死亡';
  } else if (HURT_RE.test(text)) {
    state = 'hurt';
    badge = '血';
    label = '受伤';
  }
  let location = '';
  for (const place of LOCATIONS) {
    if (text.includes(place)) location = place;
  }
  return {
    state,
    badge,
    label,
    location,
    title: [label, location ? `在${location}` : ''].filter(Boolean).join(' · '),
  };
}

function chatMessages(api) {
  try {
    return api.chat.getMessages() || [];
  } catch {
    return [];
  }
}

function memberNames(api) {
  const messages = chatMessages(api);
  const names = [];
  for (const msg of messages) {
    if (msg.sender === 'char' && msg.speaker && !names.includes(msg.speaker)) names.push(msg.speaker);
  }
  return names;
}

function statusLines(api) {
  const messages = chatMessages(api);
  return memberNames(api).map((name) => {
    const info = analyzeName(messages, name);
    return `${name}：${info.label || '正常'}${info.location ? `，在${info.location}` : ''}`;
  });
}

export default {
  init(api) {
    api.ui.registerAvatarDecorator(({ card } = {}) => {
      if (!card?.name) return null;
      const info = analyzeName(chatMessages(api), card.name);
      return info.state === 'normal' && !info.badge ? null : info;
    });

    api.ui.registerPanel({
      icon: '🎭',
      title: '剧情状态',
      render(el) {
        el.replaceChildren();
        const head = document.createElement('p');
        head.className = 'muted small';
        head.textContent = '启发式读取当前聊天里的伤势、死亡与地点；不会额外调用模型。';
        el.appendChild(head);
        const list = document.createElement('div');
        list.className = 'story-state-list';
        const draw = () => {
          list.replaceChildren();
          const lines = statusLines(api);
          if (!lines.length) {
            const empty = document.createElement('p');
            empty.className = 'muted';
            empty.textContent = '还没有角色说过话。';
            list.appendChild(empty);
            return;
          }
          for (const name of memberNames(api)) {
            const info = analyzeName(chatMessages(api), name);
            const row = document.createElement('div');
            row.className = `story-state-row story-state-row--${info.state}`;
            const dot = document.createElement('span');
            dot.className = 'story-state-dot';
            const label = document.createElement('span');
            label.textContent = `${name} · ${info.label || '正常'}${info.location ? ` · ${info.location}` : ''}`;
            row.append(dot, label);
            list.appendChild(row);
          }
        };
        draw();
        el.appendChild(list);
        const off1 = api.eventSource.on('chat:messageReceived', draw);
        const off2 = api.eventSource.on('chat:changed', draw);
        const off3 = api.eventSource.on('chat:messageEdited', draw);
        return () => {
          off1();
          off2();
          off3();
        };
      },
    });

    api.eventSource.on('chat:promptReady', ({ prompt } = {}) => {
      if (!Array.isArray(prompt)) return;
      const lines = statusLines(api);
      if (!lines.length) return;
      const block = `[剧情状态] 当前状态（启发式，仅作连续性参考）：\n${lines.map((line) => `- ${line}`).join('\n')}`;
      const firstSystem = prompt.find((msg) => msg.role === 'system');
      if (firstSystem) firstSystem.content = `${firstSystem.content}\n\n${block}`;
      else prompt.unshift({ role: 'system', content: block });
    });
  },

  unload() {
    // 事件、面板与头像装饰由宿主统一清理。
  },
};
