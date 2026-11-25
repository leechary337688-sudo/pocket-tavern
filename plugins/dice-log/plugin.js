// dice-log — 本地骰子记录 + 快捷投掷。只通过 STLite 访问宿主。
let apiRef = null;
let panel = null;
let refresh = null;
const KEY = 'rolls';
const MAX = 30;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeLabel(iso) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return '';
  }
}

async function readRolls() {
  if (!apiRef) return [];
  try {
    const value = await apiRef.storage(apiRef.pluginId).get(KEY, []);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function writeRolls(rolls) {
  await apiRef.storage(apiRef.pluginId).set(KEY, rolls.slice(0, MAX));
}

async function record(result) {
  const rolls = await readRolls();
  const entry = {
    expr: result.expr,
    total: result.total,
    detail: result.detail,
    at: new Date().toISOString(),
  };
  rolls.unshift(entry);
  await writeRolls(rolls);
  refresh?.();
  return entry;
}

async function throwDice(expr) {
  if (!apiRef) return null;
  let result;
  try {
    result = apiRef.dice.roll(expr);
  } catch (err) {
    apiRef.ui.toast(`骰子卡住了：${err.message}`);
    return null;
  }
  await record(result);
  apiRef.ui.toast(`${result.expr} = ${result.total}${result.perfect ? ' · 大成功！' : ''}`);
  return result;
}

export default {
  init(api) {
    apiRef = api;
    api.ui.registerQuickReply({
      label: '🎲 d20',
      onTap: () => throwDice('1d20'),
    });
    api.ui.registerPanel({
      icon: '🎲',
      title: '骰子记录',
      render(host) {
        if (!host) return;
        panel = host;
        refresh = async () => {
          if (!host.isConnected) {
            panel = null;
            return;
          }
          const rolls = await readRolls();
          host.replaceChildren();
          const head = el('div', 'sampler-head');
          head.appendChild(el('span', 'sampler-label', `${rolls.length} 次记录（最多 ${MAX} 条）`));
          head.appendChild(el('span', 'muted small', '只存本机'));
          host.appendChild(head);

          const actions = el('div', 'btn-row');
          actions.style.margin = '6px 0';
          const d20 = el('button', 'btn btn--ghost btn--small', '掷 d20');
          d20.type = 'button';
          d20.addEventListener('click', () => throwDice('1d20'));
          const d100 = el('button', 'btn btn--ghost btn--small', '掷 d100');
          d100.type = 'button';
          d100.addEventListener('click', () => throwDice('1d100'));
          const clear = el('button', 'btn btn--ghost btn--small', '清空');
          clear.type = 'button';
          clear.addEventListener('click', async () => {
            await writeRolls([]);
            await refresh();
            api.ui.toast('骰子记录已清空');
          });
          actions.append(d20, d100, clear);
          host.appendChild(actions);

          if (!rolls.length) {
            host.appendChild(el('p', 'muted small', '还没有掷过骰子。快捷栏里也有一个 d20。'));
            return;
          }
          const list = el('div', 'dice-history');
          for (const item of rolls.slice(0, 8)) {
            const row = el('div', 'dice-history__item');
            row.appendChild(el('strong', '', `${item.expr} = ${item.total}`));
            row.appendChild(el('span', '', ` · ${item.detail || ''} · ${timeLabel(item.at)}`));
            list.appendChild(row);
          }
          host.appendChild(list);
        };
        refresh();
      },
    });
  },
  unload() {
    panel = null;
    refresh = null;
    apiRef = null;
  },
};
