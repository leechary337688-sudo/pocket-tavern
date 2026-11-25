// llm-queue — 插件专用的一次性 LLM 调用队列。
//
// 设计约束：
// - 只走用户当前连接；不新增端点、不内置密钥。
// - 全局串行，避免几个插件同时抢流式连接、拖慢聊天。
// - 失败静默返回 null；日志只记通用原因，不输出 apiKey / 请求头。
// - 结果不进入聊天历史，也不进入 prompt trace。

import { ApiClient } from '../core/api-client.js';

const DEFAULT_TIMEOUT_MS = 20000;

function textOf(message) {
  if (!message) return '';
  return typeof message === 'string' ? message : String(message.content || '');
}

export class LlmQueue {
  constructor({ getSettings, onError = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.getSettings = getSettings;
    this.onError = onError;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.running = false;
  }

  /** 插件调用；返回完整文本或 null。绝不抛出。 */
  complete(messages, options = {}) {
    const list = Array.isArray(messages) ? messages.filter(Boolean).map((m) => ({
      role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user',
      content: textOf(m),
    })) : [];
    if (!list.length) return Promise.resolve(null);
    const job = {
      messages: list,
      temperature: Math.min(1.4, Math.max(0, Number(options.temperature) || 0.8)),
      maxTokens: Math.min(1200, Math.max(32, Number(options.maxTokens) || 320)),
      signal: options.signal || null,
    };
    return new Promise((resolve) => {
      this.queue.push({ job, resolve });
      this._pump();
    });
  }

  async _pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const { job, resolve } = this.queue.shift();
        resolve(await this._run(job));
      }
    } finally {
      this.running = false;
    }
  }

  async _run(job) {
    let settings;
    try {
      settings = this.getSettings?.() || {};
    } catch {
      return null;
    }
    const connection = settings.connection || {};
    if (!connection.endpoint || !connection.model) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    job.signal?.addEventListener?.('abort', onAbort, { once: true });
    let text = '';
    try {
      const client = new ApiClient({
        connection,
        sampler: {
          ...(settings.sampler || {}),
          temperature: job.temperature,
          max_tokens: job.maxTokens,
        },
        timeoutMs: this.timeoutMs,
        retries: 0,
      });
      const result = await client.streamChat({
        messages: job.messages,
        signal: controller.signal,
        onToken: (token) => { text += String(token || ''); },
        meta: { source: 'plugin-llm' },
      });
      return String(result?.text || text || '').trim() || null;
    } catch (err) {
      // 不记录 err.message：部分后端会在错误文本里回显请求头。
      this.onError?.(err instanceof Error ? err.name : 'llm');
      return null;
    } finally {
      clearTimeout(timer);
      job.signal?.removeEventListener?.('abort', onAbort);
    }
  }
}

export function createLlmQueue(options) {
  return new LlmQueue(options);
}
