// room-sanitizer — 输出侧四道闸（docs/pt-prompt-v1 §“四道闸”）。
// 全部是纯函数，便于单测；只做保守裁剪，宁可少删也不误删正文。

const BANNER_RE = /^(?:【[^】]{1,12}】|\[[^\]]{1,12}\]|【?[^】\n]{1,10}[：:])\s*$/;

/** 去掉模型爱用的说话人标题行（【罗莎】单独一行、`罗莎：`单独一行） */
export function stripSpeakerHeaders(text, { cast = [] } = {}) {
  const names = new Set((cast || []).map((c) => c?.name).filter(Boolean));
  const lines = String(text || '').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push(raw);
      continue;
    }
    const nameOnly = line.replace(/^[【\[]|[】\]]$/g, '').replace(/[：:]$/, '').trim();
    if (names.has(nameOnly) && BANNER_RE.test(line)) continue;
    // 形如「【罗莎】」开头后面紧跟内容的，只剥前缀
    const m = line.match(/^【([^】]{1,12})】\s*(.+)$/);
    if (m && names.has(m[1])) {
      out.push(raw.replace(/^(\s*)【[^】]{1,12}】\s*/, '$1'));
      continue;
    }
    out.push(raw);
  }
  return out.join('\n');
}

/** 只保留第一段（R1：一次只写一个人；遇到第二个说话人标题就截断） */
export function cutAtSecondSpeaker(text, { cast = [] } = {}) {
  const names = (cast || []).map((c) => c?.name).filter(Boolean);
  const src = String(text || '');
  if (!names.length) return src;
  const pattern = new RegExp(`\\n\\s*(?:【(${names.map(escapeRe).join('|')})】|[\\u4e00-\\u9fa5]{1,8}[：:])`, 'g');
  const lines = src.split('\n');
  const kept = [];
  let seenBlock = 0;
  for (const line of lines) {
    if (pattern.test(`\n${line}`)) {
      seenBlock += 1;
      pattern.lastIndex = 0;
      if (seenBlock >= 2) break;
    }
    pattern.lastIndex = 0;
    kept.push(line);
  }
  return kept.join('\n');
}

/** 切掉旁白/总结/OOC 尾巴 */
export function cutNarrationTail(text) {
  const src = String(text || '');
  const markers = [
    /\n\s*[（(]?(?:旁白|总结|综上|说到底|总之)[）)]?\s*[：:]/,
    /\n\s*(?:总之|总而言之|以上|总而言之)/,
  ];
  let cut = src.length;
  for (const re of markers) {
    const m = src.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  return src.slice(0, cut).trimEnd();
}

/** 把「（我…）」里的主语改成无主语形式 */
export function dropFirstPersonSubject(text, { char = '' } = {}) {
  let out = String(text || '');
  out = out.replace(/（\s*我/g, '（').replace(/\(\s*我/g, '(');
  if (char) {
    const esc = escapeRe(char);
    out = out.replace(new RegExp(`（\\s*${esc}`, 'g'), '（').replace(new RegExp(`\\(\\s*${esc}`, 'g'), '(');
  }
  // （我说道）→（说道）这类动词前的主语也一并去掉
  out = out.replace(/（\s*我(说|道|问|答|想|笑|叹|看|听)/g, '（$1');
  return out;
}

/** 去掉模型重复多遍的同一行（R7 的兜底） */
export function dedupeLines(text) {
  const seen = new Set();
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const key = line.trim();
      if (!key || key.length < 8) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

/** 末句是不是推进信号（问、要求、转折、动作） */
export function looksAdvancing(text) {
  const tail = String(text || '').trim().slice(-80);
  if (!tail) return false;
  return /[？?]|「[^」]{2,}」$|（[^）]*）$/.test(tail);
}

/**
 * 主入口：四道闸依次执行。
 * @returns {{text:string, removed:string[], cut:boolean, flagged:boolean}}
 */
export function sanitizeOutput(text, { cast = [], char = '', viewerName = '' } = {}) {
  const removed = [];
  let out = String(text || '').replace(/\r\n/g, '\n');
  const original = out;

  const afterHeaders = stripSpeakerHeaders(out, { cast });
  if (afterHeaders !== out) removed.push('speaker-header');
  out = afterHeaders;

  const afterCut = cutAtSecondSpeaker(out, { cast });
  const cut = afterCut !== out;
  out = afterCut;

  const afterNarration = cutNarrationTail(out);
  if (afterNarration !== out) {
    removed.push('narration');
    out = afterNarration;
  }

  const afterfp = dropFirstPersonSubject(out, { char });
  if (afterfp !== out) {
    removed.push('first-person');
    out = afterfp;
  }

  const afterDedupe = dedupeLines(out);
  if (afterDedupe !== out) removed.push('repeat');
  out = afterDedupe;

  out = out.replace(/\n{3,}/g, '\n\n').trim();
  // 串台闸：正文里出现别人的台词标记，标记出来供日志/调试
  const others = (cast || []).filter((c) => c?.name && c.name !== viewerName && c.name !== char).map((c) => c.name);
  const flagged = others.some((n) => out.includes(`${n}说`) || out.includes(`${n}道`) || out.includes(`【${n}】`));
  return { text: out || original.trim(), removed, cut, flagged };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
