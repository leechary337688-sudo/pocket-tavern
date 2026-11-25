// chapter-diary — 每 15 个用户回合生成章节摘要；超过 48 小时回来先注入前情提要。
// 摘要走 STLite.llm.complete（宿主串行、失败静默），不写聊天记录。

const KEY = 'state';
const EVERY = 15;
const GAP_MS = 48 * 60 * 60 * 1000;
const SUMMARY_PROMPT = `你是口袋酒馆的书记官。把下面这段角色扮演聊天总结成一段不超过 120 字的中文前情提要。
只保留：地点/时间推进、人物关系变化、未解决的悬念、重要承诺。不要评价，不要剧透，不要 markdown。
直接输出摘要正文。`;

function nowIso() {
  return new Date().toISOString();
}

function cleanSummary(text) {
  return String(text || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export default {
  init(api) {
    const bridge = { state: { chats: {} }, disposed: false, timer: null, injecting: false, panels: [] };
    const chatInfo = () => api.chat.getChatInfo() || {};
    const chatState = () => {
      const id = String(chatInfo().id || '');
      if (!id) return null;
      if (!bridge.state.chats[id]) bridge.state.chats[id] = { entries: [], userTurns: 0, lastSeen: nowIso(), lastSummaryAt: 0, lastInjected: '' };
      const st = bridge.state.chats[id];
      if (!Array.isArray(st.entries)) st.entries = [];
      if (typeof st.userTurns !== 'number') st.userTurns = 0;
      if (!st.lastSeen) st.lastSeen = nowIso();
      return st;
    };
    const save = () => {
      if (bridge.timer) return;
      bridge.timer = setTimeout(() => {
        bridge.timer = null;
        if (!bridge.disposed) api.storage.set(KEY, bridge.state).catch(() => {});
      }, 200);
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
    const touchSeen = () => {
      const st = chatState();
      if (!st) return;
      st.lastSeen = nowIso();
      save();
    };
    const checkGap = () => {
      const st = chatState();
      if (!st) return;
      const last = st.lastSeen ? new Date(st.lastSeen).getTime() : 0;
      if (last && Date.now() - last > GAP_MS && !st.pendingGap) st.pendingGap = st.lastSeen;
      st.lastSeen = nowIso();
      save();
    };
    const summaryMessages = () => {
      const messages = api.chat.getMessages() || [];
      const recent = messages.slice(-36);
      return recent.map((m) => `${m.speaker || (m.sender === 'user' ? '玩家' : '旁白')}：${m.text}`).join('\n').slice(0, 6000);
    };
    const makeSummary = async (st) => {
      if (!api.llm?.complete) return;
      const from = st.lastSummaryAt || 0;
      const to = st.userTurns;
      if (to <= from) return;
      const text = await api.llm.complete(
        [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: summaryMessages() },
        ],
        { temperature: 0.5, maxTokens: 320 },
      );
      const summary = cleanSummary(text);
      if (!summary) return;
      st.lastSummaryAt = to;
      st.entries.push({
        id: `ch_${Date.now().toString(36)}`,
        at: nowIso(),
        fromTurn: from + 1,
        toTurn: to,
        title: `第 ${st.entries.length + 1} 章`,
        text: summary,
        auto: true,
      });
      save();
      draw();
    };
    const onUserTurn = () => {
      const st = chatState();
      if (!st) return;
      st.userTurns += 1;
      st.lastSeen = nowIso();
      st.lastInjected = '';
      if (st.userTurns % EVERY === 0) makeSummary(st).catch(() => {});
      save();
      draw();
    };
    const inject = (prompt) => {
      const st = chatState();
      if (!st || !st.entries.length || !Array.isArray(prompt)) return;
      if (!st.pendingGap || st.lastInjected === st.pendingGap) return;
      const latest = st.entries.slice(-2);
      const content = `【前情提要】\n${latest.map((e) => `${e.title}：${e.text}`).join('\n')}`;
      prompt.push({ role: 'system', content });
      st.lastInjected = st.pendingGap;
      st.pendingGap = '';
      save();
      api.ui.toast('已把前情提要放进这一轮');
    };

    api.eventSource.on('app:ready', checkGap);
    api.eventSource.on('chat:changed', checkGap);
    api.eventSource.on('chat:messageSent', onUserTurn);
    api.eventSource.on('chat:messageReceived', touchSeen);
    api.eventSource.on('chat:promptReady', ({ prompt } = {}) => inject(prompt));

    api.ui.registerPanel({
      icon: '📖',
      title: '章节日记',
      render(el) {
        const render = () => {
          if (bridge.disposed) return;
          el.innerHTML = '';
          const st = chatState();
          const head = document.createElement('div');
          head.className = 'diary__head';
          const remain = st ? EVERY - (st.userTurns % EVERY || 0) : EVERY;
          head.innerHTML = `<strong>章节日记</strong><span>${st ? `${st.userTurns} 回合 · 再过 ${remain} 回合写下一章` : '先打开一局聊天'}</span>`;
          el.appendChild(head);
          if (!st) return;
          const list = document.createElement('div');
          list.className = 'diary__list';
          if (!st.entries.length) {
            list.innerHTML = '<p class="diary__empty">还没有章节。每 15 个回合，书记官会写一段。</p>';
          }
          for (const entry of st.entries.slice().reverse()) {
            const row = document.createElement('article');
            row.className = 'diary__entry';
            row.innerHTML = `<input class="diary__title" value="${String(entry.title || '').replace(/"/g, '&quot;')}" aria-label="章节名"><small>回合 ${entry.fromTurn}–${entry.toTurn} · ${new Date(entry.at).toLocaleString('zh-CN')}</small><p>${entry.text}</p>`;
            const title = row.querySelector('.diary__title');
            title.addEventListener('change', () => {
              entry.title = title.value.trim().slice(0, 40) || '未命名章节';
              save();
            });
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'diary__remove';
            remove.textContent = '删除';
            remove.addEventListener('click', () => {
              st.entries = st.entries.filter((item) => item.id !== entry.id);
              save();
              draw();
            });
            row.appendChild(remove);
            list.appendChild(row);
          }
          el.appendChild(list);
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
      checkGap();
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
