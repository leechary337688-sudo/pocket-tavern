// token-counter — 上下文占用面板。只通过 STLite 访问宿主数据。
let apiRef = null;
let timer = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function bar(percent, warn) {
  const track = el('div', 'preview-bar');
  const fill = el('span', 'preview-bar__fill');
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (warn) fill.style.background = 'var(--danger)';
  track.appendChild(fill);
  return track;
}

function stat(value, label, hint) {
  const box = el('div', 'stat-chip');
  box.appendChild(el('strong', '', value));
  box.appendChild(el('span', '', label));
  if (hint) box.appendChild(el('span', 'muted small', hint));
  return box;
}

export default {
  init(api) {
    apiRef = api;
    api.ui.registerPanel({
      icon: '🫗',
      title: '上下文酒量',
      render(host) {
        if (!host) return;
        const redraw = () => {
          if (!host.isConnected) {
            clearInterval(timer);
            timer = 0;
            return;
          }
          host.replaceChildren();
          let messages = [];
          let trace = null;
          let settings = {};
          try {
            messages = api.chat.getMessages() || [];
            trace = api.chat.getLastPromptTrace();
            settings = api.settings || {};
          } catch {
            host.appendChild(el('p', 'muted small', '还没有打开会话。'));
            return;
          }

          const sampler = settings.sampler || {};
          const contextWindow = Number(sampler.context_window) || 8192;
          const maxTokens = Number(sampler.max_tokens) || 2048;
          const reserve = Math.min(maxTokens, Math.floor(contextWindow / 2));
          const available = Math.max(512, contextWindow - reserve);
          const chatTokens = messages.reduce((sum, m) => {
            const estimated = Number(m.tokenEstimate) || api.tokenizer.estimate(m.text || '');
            return sum + Math.max(0, estimated) + 4;
          }, 0);
          const total = trace?.totalTokens || chatTokens;
          const percent = Math.round((total / available) * 100);

          host.appendChild(
            (() => {
              const row = el('div', 'preview-summary');
              const left = el('div', 'preview-stat');
              left.appendChild(el('strong', '', String(total)));
              left.appendChild(el('span', '', `已占用 / ${available} 预算`));
              const right = el('div', 'preview-stat');
              right.appendChild(el('strong', '', `${percent}%`));
              right.appendChild(el('span', '', `${messages.length} 条消息 · 输出预留 ${reserve}`));
              row.append(left, right);
              return row;
            })(),
          );
          host.appendChild(bar(percent, percent >= 90));
          host.appendChild(
            (() => {
              const grid = el('div', 'stat-grid');
              grid.append(
                stat(String(contextWindow), '上下文窗口'),
                stat(String(maxTokens), 'max_tokens'),
                stat(String(chatTokens), '聊天记录估算'),
                stat(trace ? String(trace.sections?.length || 0) : '—', '提示词分区'),
              );
              return grid;
            })(),
          );

          if (trace?.sections?.length) {
            const list = el('div', '');
            list.style.marginTop = '10px';
            list.appendChild(el('div', 'settings-subhead settings-subhead--tight', '分区预算'));
            for (const section of trace.sections) {
              if (!section || !section.tokens) continue;
              const line = el('div', 'sampler-row sampler-row--compact');
              line.style.padding = '2px 0';
              const label = el('span', 'sampler-label', `${section.label || section.key || '分区'}`);
              const value = el('span', 'sampler-value', `${section.tokens} / ${section.budget || '—'}`);
              line.append(label, value);
              list.appendChild(line);
            }
            host.appendChild(list);
          }

          const worldMatches = trace?.worldMatches?.length
            ? trace.worldMatches
            : (trace?.sections || []).find((s) => s.key === 'worldTrig')?.items || [];
          if (worldMatches.length) {
            const box = el('div', '');
            box.style.marginTop = '10px';
            box.appendChild(el('div', 'settings-subhead settings-subhead--tight', `世界书命中 · ${worldMatches.length}`));
            for (const match of worldMatches.slice(0, 6)) {
              const line = el('div', 'preview-world');
              const head = el('div', 'preview-world__head');
              head.appendChild(el('strong', '', match.comment || match.title || `条目 ${match.uid ?? ''}`));
              head.appendChild(el('span', 'mini-tag mini-tag--amber', match.position === 'after' ? '后置' : '前置'));
              line.appendChild(head);
              line.appendChild(el('div', 'preview-world__keys', (match.key || []).join(' · ') || '常量条目'));
              box.appendChild(line);
            }
            host.appendChild(box);
          }

          if (!trace) {
            host.appendChild(el('p', 'muted small', '打开一次会话或生成一次回复后，这里会显示实际的提示词分区。'));
          }
          host.appendChild(el('p', 'muted small', '估算为轻量 tokenizer，与实际模型可能相差 10–20%。'));
        };
        redraw();
        clearInterval(timer);
        timer = setInterval(redraw, 1200);
      },
    });
  },
  unload() {
    clearInterval(timer);
    timer = 0;
    apiRef = null;
  },
};
