// ai-gen — 工坊 AI 生成器：角色卡 / 世界书 / 单字段重生。
// 走用户当前连接；生成器只发送公共提示词与用户输入，不发送会话、密钥或本机数据。
import { ApiClient } from '../core/api-client.js';
import { truncateToTokens } from '../core/tokenizer-lite.js';

export const CARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'tags'];
export const FIELD_LABELS = {
  name: '名字',
  description: '描述',
  personality: '人格',
  scenario: '场景',
  first_mes: '开场白',
  mes_example: '示例对话',
  tags: '标签',
};

const CARD_SYSTEM = `你是「袖珍酒馆」的角色卡作者。根据一句想法写一张可直接扮演的角色卡。
只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。字段必须齐全：
{"name":"角色名","description":"外貌与身份，2-5 句","personality":"性格、说话方式、边界，2-5 句","scenario":"当前场景与关系，1-3 句","first_mes":"角色对用户说的第一段话，含动作/环境，150-300 字","mes_example":"<START>\\n{{user}}: ...\\n{{char}}: ... 的示例对话，2 轮","tags":["3-6 个短标签"]}
要求：第二人称视角，有画面感，避免空泛形容词；不替用户行动；不输出成人内容，除非用户想法明确要求。语言跟随用户输入。`;
const WORLD_SYSTEM = `你是「袖珍酒馆」的世界书编辑。把设定拆成 5-15 个可独立触发的世界书条目。
只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释：
{"name":"世界书名","entries":[{"comment":"条目名","key":["触发词1","触发词2"],"content":"设定正文，不超过 200 token"}]}
要求：每条 1-3 个具体触发词；条目之间不重复；内容具体、可被角色扮演直接使用；语言跟随输入。`;
const FIELD_SYSTEM = `你是「袖珍酒馆」的角色卡编辑。只重写指定的一个字段。
只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。例如：{"first_mes":"新的开场白"}。
保持角色卡其余设定一致；不要复述用户原话；语言跟随原卡。`;

function cleanText(value, fallback = '') {
  return String(value ?? fallback).replace(/\r\n/g, '\n').trim();
}

function cleanTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => cleanText(t)).filter(Boolean).slice(0, 12);
  return String(raw || '')
    .split(/[,，、#\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function modelConnection(settings, overrideModel) {
  const conn = settings?.connection || {};
  return { ...conn, model: String(overrideModel || settings?.workshop?.genModel || conn.model || '').trim() };
}

export function isGeneratorConfigured(settings) {
  const conn = modelConnection(settings);
  return Boolean(String(conn.endpoint || '').trim() && conn.model);
}

function clampTemperature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.9;
  return Math.min(1.2, Math.max(0.5, n));
}

/**
 * 容错解析模型返回的 JSON。只取第一个完整 JSON 对象，避免把解释文字带进来。
 */
export function parseJsonObject(text) {
  let raw = String(text || '').trim();
  if (!raw) throw new Error('模型没有返回内容');
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 对象');
  let obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    try {
      // 少量模型会在 JSON 前后加零宽字符或注释，去掉后再试一次。
      obj = JSON.parse(raw.slice(start, end + 1).replace(/\/\/[^\n]*/g, ''));
    } catch {
      throw new Error('模型返回的 JSON 无法解析，请重生一次或换一个模型');
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('模型返回的不是对象');
  if (obj.card && typeof obj.card === 'object') return obj.card;
  if (obj.data && typeof obj.data === 'object' && !obj.entries) return obj.data;
  return obj;
}

export function normalizeCardDraft(raw, { fallbackName = '未命名角色' } = {}) {
  const src = raw?.card && typeof raw.card === 'object' ? raw.card : raw || {};
  const name = cleanText(src.name || fallbackName, fallbackName).slice(0, 60);
  const out = {
    name: name || fallbackName,
    description: cleanText(src.description),
    personality: cleanText(src.personality),
    scenario: cleanText(src.scenario),
    first_mes: cleanText(src.first_mes || src.firstMessage),
    mes_example: cleanText(src.mes_example || src.example),
    creator: cleanText(src.creator || 'PocketTavern AI 工坊').slice(0, 80),
    tags: cleanTags(src.tags),
    spec: 'chara_card_v2',
  };
  if (!out.description && !out.personality && !out.scenario && !out.first_mes) {
    throw new Error('模型没有给出可用的角色卡字段，请重生');
  }
  return out;
}

export function normalizeWorldDraft(raw, { fallbackName = '未命名世界书' } = {}) {
  const src = raw?.world && typeof raw.world === 'object' ? raw.world : raw || {};
  const entriesRaw = Array.isArray(src.entries) ? src.entries : Array.isArray(src.items) ? src.items : [];
  const entries = entriesRaw.slice(0, 15).map((entry, index) => {
    const keys = Array.isArray(entry.key)
      ? entry.key.map((k) => cleanText(k)).filter(Boolean)
      : cleanTags(entry.key || entry.keys || '');
    return {
      uid: index + 1,
      key: [...new Set(keys)].slice(0, 12),
      keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary.map((k) => cleanText(k)).filter(Boolean) : [],
      comment: cleanText(entry.comment || `条目 ${index + 1}`).slice(0, 80),
      content: truncateToTokens(cleanText(entry.content), 200).text,
      position: entry.position === 'after' ? 'after' : 'before',
      order: index * 10,
      tokenBudget: 0,
      recursive: Boolean(entry.recursive),
      selective: Boolean(entry.selective),
      constant: Boolean(entry.constant),
      probability: Math.min(100, Math.max(0, Number(entry.probability ?? 100))),
      caseSensitive: Boolean(entry.caseSensitive),
      useRegex: Boolean(entry.useRegex),
    };
  });
  if (entries.length < 5) throw new Error(`世界书需要 5-15 条，模型只给出了 ${entries.length} 条，请重生`);
  return {
    name: cleanText(src.name || fallbackName).slice(0, 60) || fallbackName,
    enabled: true,
    entries,
  };
}

async function callJson({ settings, system, user, temperature = 0.9, model = '', maxTokens = 1600, signal, onProgress }) {
  if (!isGeneratorConfigured(settings)) {
    throw new Error('还没有配置后端连接。先到设置 → 后端连接填写端点和模型。');
  }
  const client = new ApiClient({
    connection: modelConnection(settings, model),
    sampler: {
      ...(settings?.sampler || {}),
      temperature: clampTemperature(temperature),
      max_tokens: Math.max(256, Number(maxTokens) || 1600),
    },
    retries: 1,
    timeoutMs: 60000,
  });
  let streamed = '';
  await client.streamChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    signal,
    onToken: (piece) => {
      streamed += piece;
      onProgress?.({ chars: streamed.length });
    },
  });
  return parseJsonObject(streamed);
}

export async function generateCard({ idea, settings, language = 'auto', temperature = 0.9, model = '', signal, onProgress } = {}) {
  const prompt = String(idea || '').trim().slice(0, 100);
  if (!prompt) throw new Error('先写一句角色想法');
  const langRule = language === 'zh' ? '用中文输出。' : language === 'en' ? 'Write all fields in English.' : '输出语言跟随用户想法使用的语言。';
  const raw = await callJson({
    settings,
    system: `${CARD_SYSTEM}\n${langRule}\n[[PT_GEN_CARD]]`,
    user: `角色想法：${prompt}\n请生成严格 JSON。`,
    temperature,
    model,
    signal,
    onProgress,
    maxTokens: 1800,
  });
  return normalizeCardDraft(raw, { fallbackName: prompt.slice(0, 12) });
}

export async function regenerateField({ card, field, idea = '', settings, language = 'auto', temperature = 0.9, model = '', signal, onProgress } = {}) {
  if (!CARD_FIELDS.includes(field) && field !== 'tags') throw new Error('这个字段不支持重生');
  const langRule = language === 'zh' ? '用中文输出。' : language === 'en' ? 'Write in English.' : '输出语言跟随原卡。';
  const raw = await callJson({
    settings,
    system: `${FIELD_SYSTEM}\n${langRule}\n[[PT_REGEN_FIELD]]`,
    user: `字段：${field}\n角色想法：${String(idea || '').slice(0, 200)}\n原卡：${JSON.stringify(card || {}, null, 2)}\n只输出 {"${field}": ...}。`,
    temperature,
    model,
    signal,
    onProgress,
    maxTokens: field === 'first_mes' || field === 'mes_example' ? 900 : 600,
  });
  if (field === 'tags') {
    const tags = cleanTags(raw.tags ?? raw[field]);
    if (!tags.length) throw new Error('模型没有返回标签');
    return tags;
  }
  const value = cleanText(raw[field] ?? raw.value ?? '');
  if (!value) throw new Error('模型没有返回该字段的内容');
  return value;
}

export async function generateWorld({ source, settings, language = 'auto', temperature = 0.9, model = '', signal, onProgress } = {}) {
  const text = String(source || '').trim().slice(0, 2000);
  if (!text) throw new Error('先粘贴一段世界设定');
  const langRule = language === 'zh' ? '用中文输出。' : language === 'en' ? 'Write all entries in English.' : '输出语言跟随设定文本。';
  const raw = await callJson({
    settings,
    system: `${WORLD_SYSTEM}\n${langRule}\n[[PT_GEN_WORLD]]`,
    user: `设定文本：\n${text}\n\n请拆成 5-15 个条目，输出严格 JSON。`,
    temperature,
    model,
    signal,
    onProgress,
    maxTokens: 2600,
  });
  return normalizeWorldDraft(raw, { fallbackName: text.slice(0, 16) });
}

/** 世界书条目校验：空 key / 重复 key 返回错误索引。 */
export function validateWorldEntries(entries) {
  const seen = new Map();
  const errors = new Map();
  entries.forEach((entry, index) => {
    const keys = Array.isArray(entry.key) ? entry.key.map((k) => String(k).trim()).filter(Boolean) : [];
    if (!keys.length) errors.set(index, '缺少关键词');
    for (const key of keys) {
      const keyNormalized = key.toLowerCase();
      if (seen.has(keyNormalized) && seen.get(keyNormalized) !== index) errors.set(index, `关键词「${key}」重复`);
      else seen.set(keyNormalized, index);
    }
    if (!String(entry.content || '').trim()) errors.set(index, '内容为空');
  });
  return errors;
}
