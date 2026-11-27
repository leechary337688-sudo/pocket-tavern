// api-client — 多后端流式客户端（OpenAI 兼容 / Claude / Gemini / Kobold / Tabby）。
// 安全约定：永不 console.log 请求头、apiKey 或含密钥 URL；错误文本统一 redact。

import { SSEParser } from './sse-parser.js';
import { normalizeSampler } from './sampler.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(message, { status = 0, retryable = true, detail = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

function trimSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function redact(text, secret) {
  let out = String(text ?? '');
  if (secret) out = out.split(secret).join('***');
  // 通用兜底：sk-xxx / Bearer xxx
  return out.replace(/\b(sk-[A-Za-z0-9_-]{6,})/g, 'sk-***').replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***');
}

function parseErrorBody(text, status, secret) {
  let detail = '';
  try {
    const j = JSON.parse(text);
    detail = j?.error?.message || j?.error || j?.message || j?.detail || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    detail = text.slice(0, 300);
  }
  const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  const hint =
    status === 401 || status === 403
      ? '（请检查 API Key / 端点权限）'
      : status === 404
        ? '（接口路径不存在，检查端点与 apiType）'
        : status === 429
          ? '（请求过于频繁或额度不足）'
          : '';
  return new ApiError(redact(`HTTP ${status}${detail ? ' · ' + detail : ''}${hint}`, secret), {
    status,
    retryable,
    detail: redact(detail, secret),
  });
}

function openAIUrl(base, kind) {
  const b = trimSlash(base);
  if (kind === 'chat' && /\/chat\/completions$/.test(b)) return b;
  if (kind === 'models' && /\/models$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + (kind === 'chat' ? '/chat/completions' : '/models');
  if (/\/v1\/chat\/completions$/.test(b) && kind === 'models') return b.replace(/\/chat\/completions$/, '/models');
  return b + '/v1' + (kind === 'chat' ? '/chat/completions' : '/models');
}

function claudeUrl(base) {
  const b = trimSlash(base);
  if (/\/messages$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + '/messages';
  return b + '/v1/messages';
}

function geminiBase(base) {
  let b = trimSlash(base);
  if (/\/models\/[^/]+:streamGenerateContent$/.test(b)) return b;
  if (/\/v1beta$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b.replace(/\/v1$/, '/v1beta');
  return b + '/v1beta';
}

function koboldUrl(base, kind) {
  const b = trimSlash(base);
  if (kind === 'models') {
    if (/\/api\/v1\/model$/.test(b)) return b;
    if (/\/api$/.test(b)) return b + '/v1/model';
    return b + '/api/v1/model';
  }
  if (/\/api\/extra\/generate\/stream$/.test(b)) return b;
  if (/\/api$/.test(b)) return b + '/extra/generate/stream';
  return b + '/api/extra/generate/stream';
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.text || p?.content || ''))
      .filter(Boolean)
      .join('');
  }
  return content == null ? '' : String(content);
}

function mergeConsecutive(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
    const text = String(m.content || '');
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].content += (out[out.length - 1].content ? '\n\n' : '') + text;
    } else {
      out.push({ role, content: text });
    }
  }
  return out;
}

function buildKoboldPrompt(messages, meta = {}) {
  const userName = meta.userName || 'User';
  const charName = meta.charName || 'Character';
  const system = messages.filter((m) => m.role === 'system').map((m) => contentText(m.content)).join('\n\n');
  const lines = [];
  if (system) lines.push(`[System]\n${system}`);
  for (const m of messages) {
    if (m.role === 'system') continue;
    const name = m.role === 'assistant' ? charName : userName;
    lines.push(`[${name}] ${contentText(m.content)}`);
  }
  return `${lines.join('\n\n')}\n\n[${charName}]:`;
}

function extractFullText(kind, obj) {
  try {
    if (kind === 'claude') return (obj.content || []).map((c) => c?.text || '').join('');
    if (kind === 'gemini') {
      return (obj.candidates?.[0]?.content?.parts || []).map((p) => p?.text || '').join('');
    }
    if (kind === 'kobold') return obj.results?.[0]?.text || obj.token || obj.text || '';
    return obj.choices?.[0]?.message?.content || obj.choices?.[0]?.text || '';
  } catch {
    return '';
  }
}

export class ApiClient {
  constructor({ connection = {}, sampler = {}, timeoutMs = 30000, retries = 2 } = {}) {
    this.connection = { ...connection };
    this.sampler = normalizeSampler(sampler);
    this.timeoutMs = Math.max(5000, Number(timeoutMs) || 30000);
    this.retries = Math.max(0, Math.min(5, Number(retries) || 0));
  }

  update({ connection, sampler } = {}) {
    if (connection) this.connection = { ...connection };
    if (sampler) this.sampler = normalizeSampler(sampler);
  }

  get configured() {
    return Boolean(trimSlash(this.connection.endpoint) && String(this.connection.model || '').trim());
  }

  _secret() {
    return String(this.connection.apiKey || '');
  }

  _extraHeaders() {
    const raw = this.connection.extraHeaders;
    if (!raw) return {};
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not object');
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
      }
      return out;
    } catch {
      throw new ApiError('额外请求头不是合法 JSON 对象', { retryable: false });
    }
  }

  _baseHeaders(secret) {
    const type = this.connection.apiType || 'openai';
    const h = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (secret) {
      if (type === 'claude') {
        h['x-api-key'] = secret;
        h['anthropic-version'] = '2023-06-01';
        h['anthropic-dangerous-direct-browser-access'] = 'true';
      } else if (type === 'gemini') {
        h['x-goog-api-key'] = secret;
      } else {
        h.Authorization = `Bearer ${secret}`;
      }
    }
    return h;
  }

  _headers(secret) {
    return { ...this._baseHeaders(secret), ...this._extraHeaders() };
  }

  _messagesFor(kind, messages) {
    const clean = messages
      .filter((m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: contentText(m.content) }))
      .filter((m) => m.content !== '');
    if (kind === 'claude' || kind === 'gemini') {
      const system = mergeConsecutive(clean.filter((m) => m.role === 'system'))
        .map((m) => m.content)
        .join('\n\n');
      let rest = mergeConsecutive(clean.filter((m) => m.role !== 'system')).map((m) => ({
        role: kind === 'gemini' ? (m.role === 'assistant' ? 'model' : 'user') : m.role,
        content: m.content,
      }));
      if (rest.length === 0) rest = [{ role: 'user', content: '（开始。）' }];
      if (rest[0].role !== 'user') rest.unshift({ role: 'user', content: '（故事开始。）' });
      return { system, messages: rest };
    }
    return { system: '', messages: clean };
  }

  _buildRequest(messages) {
    const type = this.connection.apiType || 'openai';
    const model = String(this.connection.model || '').trim();
    const base = trimSlash(this.connection.endpoint);
    const s = this.sampler;
    const secret = this._secret();
    const headers = this._headers(secret);
    const body = {};

    if (type === 'claude') {
      const { system, messages: msgs } = this._messagesFor('claude', messages);
      Object.assign(body, {
        model,
        messages: msgs,
        max_tokens: s.max_tokens,
        temperature: s.temperature,
        top_p: s.top_p,
        top_k: s.top_k,
        stream: true,
      });
      if (system) body.system = system;
      return { url: claudeUrl(base), headers, body, kind: 'claude', secret };
    }

    if (type === 'gemini') {
      const { system, messages: msgs } = this._messagesFor('gemini', messages);
      const url = `${geminiBase(base)}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`;
      Object.assign(body, {
        contents: msgs.map((m) => ({ role: m.role, parts: [{ text: m.content }] })),
        generationConfig: {
          temperature: s.temperature,
          topP: s.top_p,
          topK: s.top_k,
          maxOutputTokens: s.max_tokens,
          ...(s.seed !== -1 ? { seed: s.seed } : {}),
        },
      });
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return { url, headers, body, kind: 'gemini', secret };
    }

    if (type === 'kobold') {
      Object.assign(body, {
        prompt: buildKoboldPrompt(messages, this.meta || {}),
        max_length: s.max_tokens,
        max_context_length: s.context_window,
        temperature: s.temperature,
        top_p: s.top_p,
        top_k: s.top_k,
        min_p: s.min_p,
        rep_pen: s.rep_pen,
        presence_penalty: s.presence,
        frequency_penalty: s.frequency,
        seed: s.seed === -1 ? Math.floor(Math.random() * 2 ** 31) : s.seed,
        stop: ['\n[User]', '\n[System]'],
        stream: true,
      });
      return { url: koboldUrl(base, 'chat'), headers, body, kind: 'kobold', secret };
    }

    // openai / tabby
    const { messages: msgs } = this._messagesFor('openai', messages);
    Object.assign(body, {
      model,
      messages: msgs,
      stream: true,
      temperature: s.temperature,
      top_p: s.top_p,
      top_k: s.top_k,
      min_p: s.min_p,
      presence_penalty: s.presence,
      frequency_penalty: s.frequency,
      max_tokens: s.max_tokens,
      ...(s.seed !== -1 ? { seed: s.seed } : {}),
    });
    // R6：stop / repetition_penalty 不是 OpenAI 规范字段，只发给明确支持的端点，
    // 免得被严格的反向代理（如 DeepSeek 官方）整个请求打回。
    const lenient = /deepseek/i.test(model || '') ? false
      : (s.rep_pen !== 1 || s.stop?.length) ? true : false;
    if (s.stop?.length) body.stop = s.stop;
    if (lenient && s.rep_pen !== 1) body.repetition_penalty = s.rep_pen;
    return { url: openAIUrl(base, 'chat'), headers, body, kind: 'openai', secret };
  }

  async _fetchJson(url, { headers, body, signal, timeoutMs = 15000, secret } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) throw parseErrorBody(text, res.status, secret);
      try {
        return JSON.parse(text);
      } catch {
        throw new ApiError('端点返回的不是 JSON', { retryable: false });
      }
    } catch (err) {
      if (timedOut) throw new ApiError(`请求超时（${Math.round(timeoutMs / 1000)} 秒无响应）`, { retryable: true });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        '无法连接端点：可能是网络不通、地址错误或服务端未允许跨域（CORS）。手机访问时请确认与后端同网。',
        { retryable: true, detail: redact(err?.message || '', secret) },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** @returns {Promise<string[]>} */
  async listModels({ signal } = {}) {
    const type = this.connection.apiType || 'openai';
    const base = trimSlash(this.connection.endpoint);
    if (!base) throw new ApiError('尚未配置 API 端点', { retryable: false });
    const secret = this._secret();
    const headers = this._headers(secret);
    let url = '';
    if (type === 'claude') url = claudeUrl(base).replace(/\/messages$/, '/models');
    else if (type === 'gemini') url = `${geminiBase(base)}/models`;
    else if (type === 'kobold') url = koboldUrl(base, 'models');
    else url = openAIUrl(base, 'models');

    const json = await this._fetchJson(url, { headers, signal, secret });
    let ids = [];
    if (type === 'gemini') ids = (json.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
    else if (type === 'kobold') ids = json.result ? [String(json.result)] : [];
    else ids = (json.data || []).map((m) => String(m.id || m.name || '')).filter(Boolean);
    return [...new Set(ids)];
  }

  /**
   * 流式对话。重试仅在没有收到任何 token 时进行（指数退避，2 次）。
   * @param {{messages:any[], signal?:AbortSignal, onToken?:(t:string)=>void, onRetry?:(attempt:number,err:Error)=>void, onMeta?:(m:any)=>void, meta?:any}} opts
   */
  async streamChat({ messages, signal, onToken, onRetry, onMeta, meta = {} } = {}) {
    if (!this.configured) {
      throw new ApiError('尚未配置端点或模型，请到设置 → 连接中填写', { retryable: false });
    }
    this.meta = meta;
    const req = this._buildRequest(messages);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let received = 0;
      try {
        const stats = await this._streamOnce(req, {
          signal,
          onToken: (text) => {
            if (!text) return;
            received += 1;
            onToken?.(text);
          },
          onMeta,
        });
        return { ...stats, attempts: attempt + 1 };
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        const retryable = err instanceof ApiError ? err.retryable : true;
        if (received === 0 && retryable && attempt < this.retries) {
          onRetry?.(attempt + 1, err);
          await sleep(500 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        throw err;
      }
    }
    throw new ApiError('请求失败', { retryable: false });
  }

  async _streamOnce(req, { signal, onToken, onMeta } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    let idle = null;
    const armTimer = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);
    };
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();

    let reader = null;
    try {
      armTimer();
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });
      armTimer();
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw parseErrorBody(text, res.status, req.secret);
      }

      const ctype = res.headers.get('content-type') || '';
      let fullText = '';
      let usage = null;
      let finishReason = '';
      let events = 0;

      if (ctype.includes('text/event-stream') && res.body) {
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SSEParser();
        let done = false;
        while (!done) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          armTimer();
          const chunk = decoder.decode(value, { stream: true });
          const evs = parser.feed(chunk);
          for (const ev of evs) {
            const r = this._handleEvent(req.kind, ev, onToken);
            if (r?.usage) usage = r.usage;
            if (r?.finishReason) finishReason = r.finishReason;
            if (r?.text) fullText += r.text;
            events += 1;
            if (r?.done) {
              done = true;
              break;
            }
          }
        }
        if (!done) {
          for (const ev of parser.flush()) {
            const r = this._handleEvent(req.kind, ev, onToken);
            if (r?.usage) usage = r.usage;
            if (r?.finishReason) finishReason = r.finishReason;
            if (r?.text) fullText += r.text;
            events += 1;
            if (r?.done) break;
          }
        }
      } else {
        const text = await res.text();
        armTimer();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ApiError('端点返回了无法解析的响应（未按 SSE 格式）', { retryable: false, detail: redact(text.slice(0, 200), req.secret) });
        }
        if (json?.error) {
          throw new ApiError(redact(json.error.message || '后端返回错误', req.secret), { retryable: false });
        }
        const full = extractFullText(req.kind, json);
        if (!full) throw new ApiError('端点返回了空内容', { retryable: false });
        onToken(full);
        fullText = full;
        usage = json.usage || json.usageMetadata || null;
        finishReason = json.choices?.[0]?.finish_reason || json.stop_reason || '';
        events = 1;
      }

      if (!fullText.trim() && !signal?.aborted) {
        throw new ApiError('模型没有返回可见文本（可能被安全策略拦截或只返回了推理内容）', { retryable: false });
      }
      onMeta?.({ usage, finishReason, kind: req.kind });
      return { text: fullText, usage, finishReason, events };
    } catch (err) {
      if (timedOut && !signal?.aborted) {
        throw new ApiError(`等待响应超时（${Math.round(this.timeoutMs / 1000)} 秒无新数据）`, { retryable: true });
      }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (err instanceof ApiError) throw err;
      if (err?.name === 'AbortError') throw err;
      throw new ApiError(
        '流式连接中断：可能是网络断开、后端报错或跨域预检失败。断点内容已保留，可继续生成。',
        { retryable: true, detail: redact(err?.message || '', req.secret) },
      );
    } finally {
      if (idle) clearTimeout(idle);
      signal?.removeEventListener('abort', onAbort);
      if (reader) reader.cancel().catch(() => {});
    }
  }

  _handleEvent(kind, ev, onToken) {
    const data = String(ev?.data ?? '');
    if (!data) return {};
    if (data.trim() === '[DONE]') return { done: true };
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      if (kind === 'kobold') {
        onToken?.(data);
        return { text: data };
      }
      return {};
    }
    if (obj?.error) {
      const message = obj.error?.message || obj.error?.status || '后端返回错误';
      throw new ApiError(redact(message, this._secret()), { retryable: false });
    }

    if (kind === 'claude') {
      if (obj.type === 'content_block_delta' && obj.delta?.text) {
        onToken?.(obj.delta.text);
        return { text: obj.delta.text };
      }
      if (obj.type === 'message_delta') {
        return { usage: obj.usage || null, finishReason: obj.delta?.stop_reason || '' };
      }
      if (obj.type === 'message_start' && obj.message?.usage) return { usage: obj.message.usage };
      if (obj.type === 'error') {
        throw new ApiError(redact(obj.error?.message || 'Claude 返回错误', this._secret()), { retryable: false });
      }
      return {};
    }

    if (kind === 'gemini') {
      const cand = obj.candidates?.[0];
      if (obj.promptFeedback?.blockReason) {
        throw new ApiError(`Gemini 拦截了请求：${obj.promptFeedback.blockReason}`, { retryable: false });
      }
      let text = '';
      for (const p of cand?.content?.parts || []) if (p?.text) text += p.text;
      if (text) onToken?.(text);
      return { text, finishReason: cand?.finishReason || '', usage: obj.usageMetadata || null };
    }

    if (kind === 'kobold') {
      const text = typeof obj.token === 'string' ? obj.token : '';
      if (text) onToken?.(text);
      return { text, finishReason: obj.finish_reason || '', usage: null };
    }

    // openai / tabby
    const choice = obj.choices?.[0];
    let text = choice?.delta?.content;
    if (Array.isArray(text)) text = text.map((p) => p?.text || '').join('');
    if (text) onToken?.(text);
    return {
      text: text || '',
      usage: obj.usage || null,
      finishReason: choice?.finish_reason || '',
    };
  }
}

export { redact };
