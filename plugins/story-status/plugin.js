// story-status v2 — 按角色归属的剧情状态。
// 只使用 STLite API；不直接读 DOM、不直接写数据库、不调用额外模型。

const STATUS_KEY = 'chats';

// 单 emoji，badge 最多显示 2 个 UTF-16 单元。
const DEFS = {
  流血: { icon: '🩸', category: 'dot', duration: 3, maxStacks: 3 },
  中毒: { icon: '🟢', category: 'dot', duration: 3, maxStacks: 3 },
  灼烧: { icon: '🔥', category: 'dot', duration: 2, maxStacks: 2 },
  冻伤: { icon: '❄️', category: 'dot', duration: 2, maxStacks: 2 },
  感电: { icon: '⚡', category: 'control', duration: 1, maxStacks: 1 },
  诅咒: { icon: '🌑', category: 'special', duration: 3, maxStacks: 2 },
  眩晕: { icon: '💫', category: 'control', duration: 1, maxStacks: 1 },
  沉默: { icon: '🔇', category: 'control', duration: 1, maxStacks: 1 },
  定身: { icon: '⛓️', category: 'control', duration: 1, maxStacks: 1 },
  护盾: { icon: '🛡️', category: 'buff', duration: 2, maxStacks: 2 },
  加速: { icon: '💨', category: 'buff', duration: 1, maxStacks: 1 },
  狂暴: { icon: '😤', category: 'buff', duration: 2, maxStacks: 1 },
  隐身: { icon: '👻', category: 'buff', duration: 2, maxStacks: 1 },
  重伤: { icon: '🩹', category: 'special', duration: 3, maxStacks: 1 },
  死亡: { icon: '💀', category: 'special', duration: 9, maxStacks: 1 },
  心动: { icon: '💗', category: 'emotion', duration: 3, maxStacks: 3 },
  羞涩: { icon: '🌸', category: 'emotion', duration: 2, maxStacks: 2 },
  信任: { icon: '🤝', category: 'emotion', duration: 3, maxStacks: 3 },
  依赖: { icon: '🫂', category: 'emotion', duration: 3, maxStacks: 3 },
  吃醋: { icon: '🍋', category: 'emotion', duration: 2, maxStacks: 2 },
  误会: { icon: '💭', category: 'emotion', duration: 2, maxStacks: 2 },
  勇气: { icon: '🔥', category: 'emotion', duration: 2, maxStacks: 2 },
  决心: { icon: '✦', category: 'emotion', duration: 3, maxStacks: 2 },
  黑化: { icon: '🖤', category: 'special', duration: 3, maxStacks: 1 },
  疲惫: { icon: '😪', category: 'emotion', duration: 2, maxStacks: 2 },
  醉酒: { icon: '🍶', category: 'control', duration: 2, maxStacks: 2 },
};

const PRIORITY = { death: 0, special: 1, dot: 2, control: 3, buff: 4, emotion: 5 };
const TARGET_STATE = new Set(['active', 'away', 'dead']);
const KEYWORD_STATES = [
  ['死亡', /死亡|断气|咽气|尸体|阵亡|没有呼吸/],
  ['流血', /流血|出血|血顺着|伤口.*血|血滴|受伤|刀伤|中箭|划伤|淤青|骨折/],
  ['中毒', /中毒|毒发|毒性/],
  ['灼烧', /灼烧|着火|烧焦|烈焰/],
  ['冻伤', /冻伤|结冰|寒气入骨/],
  ['眩晕', /眩晕|头晕|眼前发黑/],
  ['心动', /心动|心跳|脸红|耳根发烫/],
  ['信任', /信任|相信你|交给你/],
  ['疲惫', /疲惫|累了|困倦|体力不支/],
  ['醉酒', /醉酒|喝醉|酒意上头/],
];
let warned = false;

function nameOf(card) {
  return String(card?.name || '角色');
}

function defOf(name) {
  return DEFS[name] || null;
}

function parseStatusLines(text) {
  const source = String(text || '');
  const out = [];
  const re = /\[状态\]\s*(\{[^\n]*\})/g;
  let match;
  while ((match = re.exec(source))) {
    try {
      const payload = JSON.parse(match[1]);
      if (payload && typeof payload === 'object') out.push(payload);
    } catch {
      /* 半行 JSON 不处理 */
    }
  }
  return out;
}

function clamp(n, min, max, fallback) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function statusScore(status) {
  return PRIORITY[defOf(status.name)?.category] ?? 9;
}

function topStatus(statuses = []) {
  return [...statuses].sort((a, b) => statusScore(a) - statusScore(b) || (b.stacks || 1) - (a.stacks || 1))[0] || null;
}

function emptyChatState() {
  return { statuses: {}, log: [], turn: 0, applied: {} };
}

export default {
  init(api) {
    const bridge = {
      api,
      state: { chats: {} },
      dirty: false,
      timer: null,
      disposed: false,
    };

    const load = async () => {
      const saved = await api.storage.get(STATUS_KEY, null);
      if (saved && typeof saved === 'object') bridge.state = { chats: saved.chats || {} };
    };
    const save = () => {
      if (bridge.timer) return;
      bridge.timer = setTimeout(async () => {
        bridge.timer = null;
        if (bridge.disposed) return;
        try {
          await api.storage.set(STATUS_KEY, bridge.state);
        } catch {
          /* 存储失败不阻塞聊天 */
        }
      }, 160);
    };
    const chatInfo = () => api.chat.getChatInfo() || {};
    const members = () => api.chat.getMembers() || [];
    const memberIdOf = (card) => String(card?.id || '');
    const memberByName = (name) => members().find((m) => m.name === name || m.id === name);
    const chatState = () => {
      const id = String(chatInfo().id || '');
      if (!id) return null;
      if (!bridge.state.chats[id]) bridge.state.chats[id] = emptyChatState();
      return bridge.state.chats[id];
    };
    const statusesOf = (cardOrId) => {
      const st = chatState();
      const id = typeof cardOrId === 'string' ? cardOrId : memberIdOf(cardOrId);
      return st?.statuses?.[id] || [];
    };

    const log = (entry) => {
      const st = chatState();
      if (!st) return;
      st.log.unshift({ ...entry, at: new Date().toISOString() });
      st.log = st.log.slice(0, 80);
    };

    const fire = () => {
      save();
      drawPanels();
    };

    const removeStatus = (memberId, name, reason = '手动移除') => {
      const st = chatState();
      if (!st) return;
      const list = st.statuses[memberId] || [];
      const next = list.filter((s) => s.name !== name);
      if (next.length === list.length) return;
      st.statuses[memberId] = next;
      log({ type: 'remove', memberId, name, reason });
      fire();
    };

    const addStatus = (memberId, name, options = {}) => {
      const def = defOf(name);
      const st = chatState();
      if (!def || !st || !memberId) return false;
      const list = st.statuses[memberId] || [];
      if (list.some((s) => s.name === '死亡') && name !== '死亡') return false;
      const stacks = clamp(options.stacks, 1, def.maxStacks, 1);
      const turns = clamp(options.turns, 1, 9, def.duration);
      const note = String(options.note || '').slice(0, 60);
      const old = list.find((s) => s.name === name);
      if (old) {
        old.stacks = Math.min(def.maxStacks, Math.max(old.stacks || 1, stacks));
        old.turns = Math.max(old.turns || 0, turns);
        old.note = note || old.note || '';
        old.visibility = options.visibility === 'self' ? 'self' : (old.visibility || 'public');
      } else {
        list.push({
          name,
          icon: def.icon,
          category: def.category,
          stacks,
          maxStacks: def.maxStacks,
          turns,
          duration: def.duration,
          visibility: options.visibility === 'self' ? 'self' : 'public',
          note,
          source: String(options.source || ''),
          startedAtTurn: (st.turn || 0) + 1,
        });
      }
      st.statuses[memberId] = list;
      log({ type: 'add', memberId, name, stacks, turns, note });
      fire();
      return true;
    };

    const applyPayload = (payload, message) => {
      const st = chatState();
      if (!st) return;
      const speaker = message?.speaker || '';
      const speakerCard = members().find((m) => m.id === message?.cardId || m.name === speaker);
      const targetRaw = payload.target ?? payload.member ?? speaker;
      const target = targetRaw === 'player' ? null : memberByName(String(targetRaw || ''));
      if (!target) {
        if (!warned) {
          warned = true;
          api.ui.toast('状态目标不在场，已忽略');
        }
        return;
      }
      if ((target.memberState || 'active') === 'dead' && !(Array.isArray(payload.add) ? payload.add : [payload.add]).includes('死亡')) {
        return;
      }
      const removes = Array.isArray(payload.remove) ? payload.remove : payload.remove ? [payload.remove] : [];
      for (const name of removes) removeStatus(target.id, String(name), '角色文本');
      const adds = Array.isArray(payload.add) ? payload.add : payload.add ? [payload.add] : [];
      for (const name of adds) {
        addStatus(target.id, String(name), {
          stacks: payload.stacks,
          turns: payload.turns,
          note: payload.note,
          visibility: payload.visibility,
          source: speakerCard?.name || speaker,
        });
      }
      if (adds.includes('死亡')) {
        api.chat.setMemberState?.(target.id, 'dead').catch?.(() => {});
      }
    };

    const scanMessage = (message) => {
      if (!message || message.sender !== 'char') return;
      const st = chatState();
      if (!st || !message.id || st.applied[message.id]) return;
      st.applied[message.id] = 1;
      const payloads = parseStatusLines(message.text);
      if (payloads.length) {
        for (const payload of payloads) applyPayload(payload, message);
      } else {
        // 非结构化文本只归发言者本人，绝不甩给全队。
        const speaker = members().find((m) => m.id === message.cardId || m.name === message.speaker);
        if (speaker) {
          const hit = KEYWORD_STATES.find(([, re]) => re.test(String(message.text || '')));
          if (hit) applyPayload({ target: speaker.name, add: [hit[0]], source: '关键词' }, message);
        }
      }
      save();
    };

    const scanRecent = () => {
      const st = chatState();
      if (!st) return;
      const messages = api.chat.getMessages() || [];
      for (const message of messages.slice(-60)) scanMessage(message);
    };

    const tick = () => {
      const st = chatState();
      if (!st) return;
      st.turn = (st.turn || 0) + 1;
      const expired = [];
      for (const [memberId, list] of Object.entries(st.statuses)) {
        const next = [];
        for (const status of list) {
          if ((status.startedAtTurn || 0) >= st.turn) {
            next.push(status);
            continue;
          }
          status.turns = Number(status.turns || 0) - 1;
          if (status.turns > 0) next.push(status);
          else expired.push({ memberId, name: status.name });
        }
        st.statuses[memberId] = next;
      }
      for (const item of expired) {
        log({ type: 'expire', memberId: item.memberId, name: item.name, reason: '回合结束' });
        if (item.name === '护盾') api.ui.toast('护盾碎裂');
      }
      if (expired.length) fire();
      else save();
    };

    api.eventSource.on('app:ready', () => {
      scanRecent();
      drawPanels();
    });
    api.eventSource.on('chat:messageReceived', ({ message } = {}) => {
      scanMessage(message);
      drawPanels();
    });
    api.eventSource.on('chat:generateAfter', () => {
      scanRecent();
      tick();
      drawPanels();
    });
    api.eventSource.on('chat:changed', () => {
      scanRecent();
      drawPanels();
    });
    api.eventSource.on('chat:memberChanged', () => drawPanels());

    const panels = [];
    const memberCards = [];
    function drawPanels() {
      for (const panel of panels) {
        try {
          panel();
        } catch {
          /* 面板异常不影响聊天 */
        }
      }
      for (const draw of memberCards) {
        try {
          draw();
        } catch {
          /* 成员状态卡异常不影响聊天 */
        }
      }
    }

    api.ui.registerPanel({
      icon: '🩸',
      title: '角色状态',
      render(el) {
        const draw = () => {
          if (bridge.disposed) return;
          el.innerHTML = '';
          const st = chatState();
          const title = document.createElement('div');
          title.className = 'story-status__head';
          title.innerHTML = '<strong>角色状态</strong><span>按角色归属 · 回合制</span>';
          el.appendChild(title);
          if (!st) {
            el.insertAdjacentHTML('beforeend', '<p class="story-status__empty">先打开一局聊天。</p>');
            return;
          }
          const list = members();
          if (!list.length) {
            el.insertAdjacentHTML('beforeend', '<p class="story-status__empty">当前会话没有角色。</p>');
            return;
          }
          const grid = document.createElement('div');
          grid.className = 'story-status__members';
          for (const member of list) {
            const states = st.statuses[member.id] || [];
            const card = document.createElement('section');
            card.className = 'story-status__member';
            const head = document.createElement('div');
            head.className = 'story-status__member-head';
            head.innerHTML = `<strong>${nameOf(member)}</strong><span>${states.length ? `${states.length} 个状态` : '正常'}</span>`;
            card.appendChild(head);
            if (!states.length) {
              const empty = document.createElement('p');
              empty.className = 'story-status__empty';
              empty.textContent = '没有异常状态。';
              card.appendChild(empty);
            } else {
              for (const category of ['special', 'dot', 'control', 'buff', 'emotion']) {
                const entries = states.filter((s) => (defOf(s.name)?.category || 'special') === category);
                if (!entries.length) continue;
                const group = document.createElement('div');
                group.className = 'story-status__group';
                const label = document.createElement('span');
                label.className = 'story-status__group-name';
                label.textContent = ({ special: '特殊', dot: '持续伤害', control: '控制', buff: '增益', emotion: '情感' })[category];
                group.appendChild(label);
                for (const status of entries) {
                  const chip = document.createElement('button');
                  chip.type = 'button';
                  chip.className = `story-status__chip story-status__chip--${category}`;
                  chip.title = status.note || '点击移除';
                  chip.textContent = `${status.icon || ''} ${status.name}${status.stacks > 1 ? ` ×${status.stacks}` : ''} · ${status.turns} 回合`;
                  chip.addEventListener('click', () => removeStatus(member.id, status.name));
                  group.appendChild(chip);
                }
                card.appendChild(group);
              }
            }
            const controls = document.createElement('div');
            controls.className = 'story-status__controls';
            for (const state of ['active', 'away', 'dead']) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = `story-status__state ${member.memberState === state ? 'is-on' : ''}`;
              button.textContent = ({ active: '在场', away: '暂离', dead: '退场' })[state];
              button.addEventListener('click', async () => {
                await api.chat.setMemberState?.(member.id, state);
                drawPanels();
              });
              controls.appendChild(button);
            }
            card.appendChild(controls);
            grid.appendChild(card);
          }
          el.appendChild(grid);
          if (st.log.length) {
            const logEl = document.createElement('div');
            logEl.className = 'story-status__log';
            logEl.innerHTML = `<strong>状态日志</strong>${st.log.slice(0, 8).map((item) => {
              const who = list.find((m) => m.id === item.memberId)?.name || item.memberId;
              return `<span>${who} · ${item.name} · ${item.type === 'expire' ? '到期' : item.type === 'remove' ? '移除' : '获得'}</span>`;
            }).join('')}`;
            el.appendChild(logEl);
          }
        };
        panels.push(draw);
        draw();
        return () => {
          const index = panels.indexOf(draw);
          if (index >= 0) panels.splice(index, 1);
        };
      },
    });

    api.ui.registerMemberCard({
      title: '角色状态',
      render(el, memberInput) {
        const draw = () => {
          if (bridge.disposed) return;
          el.innerHTML = '';
          const st = chatState();
          const member = members().find((m) => m.id === memberInput?.id || m.name === memberInput?.name) || memberInput;
          if (!st || !member) {
            el.insertAdjacentHTML('beforeend', '<p class="story-status__empty">这一局暂时没有状态记录。</p>');
            return;
          }
          const states = st.statuses[member.id] || [];
          const head = document.createElement('div');
          head.className = 'story-status__head';
          head.innerHTML = `<strong>${nameOf(member)}</strong><span>${({ active: '在场', away: '暂离', dead: '已退场' })[member.memberState] || '在场'} · ${states.length} 个状态</span>`;
          el.appendChild(head);
          if (!states.length) {
            el.insertAdjacentHTML('beforeend', '<p class="story-status__empty">没有异常状态。</p>');
          } else {
            for (const category of ['special', 'dot', 'control', 'buff', 'emotion']) {
              const entries = states.filter((s) => (defOf(s.name)?.category || 'special') === category);
              if (!entries.length) continue;
              const group = document.createElement('div');
              group.className = 'story-status__group';
              group.innerHTML = `<span class="story-status__group-name">${({ special: '特殊', dot: '持续伤害', control: '控制', buff: '增益', emotion: '情感' })[category]}</span>`;
              for (const status of entries) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `story-status__chip story-status__chip--${category}`;
                chip.title = status.note || '点击移除';
                chip.textContent = `${status.icon || ''} ${status.name}${status.stacks > 1 ? ` ×${status.stacks}` : ''} · ${status.turns} 回合`;
                chip.addEventListener('click', () => removeStatus(member.id, status.name));
                group.appendChild(chip);
              }
              el.appendChild(group);
            }
          }
          const controls = document.createElement('div');
          controls.className = 'story-status__controls';
          for (const state of ['active', 'away', 'dead']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `story-status__state ${member.memberState === state ? 'is-on' : ''}`;
            button.textContent = ({ active: '在场', away: '暂离', dead: '退场' })[state];
            button.addEventListener('click', async () => {
              await api.chat.setMemberState?.(member.id, state);
              drawPanels();
            });
            controls.appendChild(button);
          }
          el.appendChild(controls);
          const recent = st.log.filter((item) => item.memberId === member.id).slice(0, 4);
          if (recent.length) {
            const logEl = document.createElement('div');
            logEl.className = 'story-status__log';
            logEl.innerHTML = `<strong>最近</strong>${recent.map((item) => `<span>${item.name} · ${item.type === 'expire' ? '到期' : item.type === 'remove' ? '移除' : '获得'}</span>`).join('')}`;
            el.appendChild(logEl);
          }
        };
        memberCards.push(draw);
        draw();
        return () => {
          const index = memberCards.indexOf(draw);
          if (index >= 0) memberCards.splice(index, 1);
        };
      },
    });

    api.ui.registerAvatarDecorator(({ card } = {}) => {
      if (!card?.id) return null;
      const states = statusesOf(card.id).filter((s) => s.visibility !== 'self');
      const top = topStatus(states);
      if (!top) return null;
      const def = defOf(top.name);
      if (!def) return null;
      return {
        state: {
          badge: def.icon,
          className: `pt-status pt-status--${def.category}${top.name === '死亡' ? ' pt-status--dead' : ''}`,
        },
        label: top.name,
        title: `${top.name}${top.stacks > 1 ? ` ×${top.stacks}` : ''} · 剩 ${top.turns} 回合`,
      };
    });

    load().then(() => {
      scanRecent();
      drawPanels();
    }).catch(() => {});

    return {
      unload() {
        bridge.disposed = true;
        if (bridge.timer) clearTimeout(bridge.timer);
      },
    };
  },
};
