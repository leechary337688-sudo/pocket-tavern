// affection — 关系数值 / 档位 / 发糖时刻。
// 只从角色消息里的 [好感] 结构化行取值；不猜、不碰 apiKey。

const KEY = 'state';
const TIERS = [
  { min: 90, name: '挚爱', icon: '💞' },
  { min: 60, name: '心动', icon: '💗' },
  { min: 30, name: '信任', icon: '🤝' },
  { min: 0, name: '陌生', icon: '·' },
  { min: -50, name: '敌意', icon: '⚔️' },
];

function tierOf(score) {
  return TIERS.find((tier) => score >= tier.min) || TIERS[TIERS.length - 1];
}

function parseAffection(text) {
  const out = [];
  const re = /\[好感\]\s*(\{[^\n]*\})/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    try {
      const value = JSON.parse(match[1]);
      if (value && typeof value === 'object') out.push(value);
    } catch {
      /* 不完整行忽略 */
    }
  }
  return out;
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

export default {
  init(api) {
    const bridge = { state: { chats: {} }, disposed: false, timer: null, panels: [] };
    const chatInfo = () => api.chat.getChatInfo() || {};
    const members = () => api.chat.getMembers() || [];
    const chatState = () => {
      const id = String(chatInfo().id || '');
      if (!id) return null;
      if (!bridge.state.chats[id]) bridge.state.chats[id] = { pairs: {}, sweets: [], applied: {} };
      const st = bridge.state.chats[id];
      if (!st.pairs) st.pairs = {};
      if (!st.sweets) st.sweets = [];
      if (!st.applied) st.applied = {};
      return st;
    };
    const save = () => {
      if (bridge.timer) return;
      bridge.timer = setTimeout(() => {
        bridge.timer = null;
        if (!bridge.disposed) api.storage.set(KEY, bridge.state).catch(() => {});
      }, 160);
    };
    const fire = () => {
      save();
      draw();
    };
    const draw = () => {
      for (const fn of bridge.panels) {
        try {
          fn();
        } catch {
          /* 面板异常隔离 */
        }
      }
    };
    const memberName = (id) => (id === 'player' ? '你' : members().find((m) => m.id === id)?.name || id);
    const ensurePair = (a, b) => {
      const st = chatState();
      if (!st) return null;
      const key = pairKey(String(a), String(b));
      if (!st.pairs[key]) st.pairs[key] = { a: String(a), b: String(b), score: 0, updatedAt: '' };
      return st.pairs[key];
    };
    const apply = (message) => {
      const st = chatState();
      if (!st || !message || message.sender !== 'char' || !message.id || st.applied[message.id]) return;
      st.applied[message.id] = 1;
      const speaker = members().find((m) => m.id === message.cardId || m.name === message.speaker);
      if (!speaker) return;
      for (const payload of parseAffection(message.text)) {
        const targetRaw = String(payload.target || '');
        const target = targetRaw === 'player' ? { id: 'player', name: '你' } : members().find((m) => m.id === targetRaw || m.name === targetRaw);
        if (!target) continue;
        const delta = Math.max(-100, Math.min(100, Number(payload.delta) || 0));
        if (!delta) continue;
        const pair = ensurePair(speaker.id, target.id);
        if (!pair) continue;
        pair.score = Math.max(-100, Math.min(100, pair.score + delta));
        pair.updatedAt = new Date().toISOString();
        if (delta >= 8) {
          st.sweets.unshift({
            at: new Date().toISOString(),
            from: speaker.name,
            to: target.name,
            delta,
            messageId: message.id,
            snippet: String(message.text || '').replace(/\s+/g, ' ').slice(0, 70),
          });
          st.sweets = st.sweets.slice(0, 30);
        }
      }
      save();
    };
    const scan = () => {
      const st = chatState();
      if (!st) return;
      const recent = (api.chat.getMessages() || []).slice(-40);
      for (const message of recent) apply(message);
    };

    api.eventSource.on('app:ready', () => {
      scan();
      draw();
    });
    api.eventSource.on('chat:messageReceived', ({ message } = {}) => {
      apply(message);
      draw();
    });
    api.eventSource.on('chat:changed', () => {
      scan();
      draw();
    });

    api.ui.registerPanel({
      icon: '💗',
      title: '好感度',
      render(el) {
        const render = () => {
          if (bridge.disposed) return;
          el.innerHTML = '';
          const st = chatState();
          const head = document.createElement('div');
          head.className = 'affection__head';
          head.innerHTML = '<strong>好感度</strong><span>角色关系 · 本地记录</span>';
          el.appendChild(head);
          if (!st) {
            el.insertAdjacentHTML('beforeend', '<p class="affection__empty">先打开一局聊天。</p>');
            return;
          }
          const list = members();
          if (!list.length) {
            el.insertAdjacentHTML('beforeend', '<p class="affection__empty">当前会话没有角色。</p>');
            return;
          }
          for (const member of list) {
            const pair = ensurePair(member.id, 'player');
            const score = pair?.score || 0;
            const tier = tierOf(score);
            const row = document.createElement('section');
            row.className = 'affection__row';
            row.innerHTML = `
              <div class="affection__name"><img src="${member.avatar || 'icons/logo.svg'}" alt=""><strong>${member.name}</strong><span>${tier.icon} ${tier.name}</span></div>
              <div class="affection__bar"><i style="width:${(score + 100) / 2}%"></i></div>
              <div class="affection__score">${score > 0 ? '+' : ''}${score}<span> / 100</span></div>`;
            el.appendChild(row);
          }
          if (st.sweets.length) {
            const box = document.createElement('div');
            box.className = 'affection__sweets';
            box.innerHTML = '<strong>发糖时刻</strong>';
            for (const sweet of st.sweets.slice(0, 8)) {
              const item = document.createElement('button');
              item.type = 'button';
              item.className = 'affection__sweet';
              item.innerHTML = `<span>${sweet.from} → ${sweet.to} · +${sweet.delta}</span><small>${sweet.snippet}</small>`;
              item.addEventListener('click', () => {
                if (sweet.messageId) api.ui.jumpToMessage?.(sweet.messageId);
              });
              box.appendChild(item);
            }
            el.appendChild(box);
          }
        };
        bridge.panels.push(render);
        render();
        return () => {
          const index = bridge.panels.indexOf(render);
          if (index >= 0) bridge.panels.splice(index, 1);
        };
      },
    });

    api.storage.get(KEY, null).then((saved) => {
      if (saved && typeof saved === 'object') bridge.state = { chats: saved.chats || {} };
      scan();
      draw();
    }).catch(() => {});

    return {
      unload() {
        bridge.disposed = true;
        if (bridge.timer) clearTimeout(bridge.timer);
      },
    };
  },
};
