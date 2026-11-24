// sse-parser — 严格按 text/event-stream 分行、缓冲，不逐 token 解析 DOM。
// 支持 data:/event:/id:/retry: 字段、注释行、CRLF，以及流结束 flush。

export class SSEParser {
  constructor() {
    this.buffer = '';
    this.dataLines = [];
    this.eventName = '';
    this.lastId = '';
    this.retry = null;
  }

  _dispatch(out) {
    if (this.dataLines.length === 0 && !this.eventName) {
      this.eventName = '';
      return;
    }
    out.push({
      event: this.eventName || 'message',
      data: this.dataLines.join('\n'),
      id: this.lastId,
    });
    this.dataLines = [];
    this.eventName = '';
  }

  /** @param {string} chunk @returns {{event:string,data:string,id:string}[]} */
  feed(chunk) {
    this.buffer += String(chunk ?? '');
    const out = [];
    let nl;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        this._dispatch(out);
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') this.dataLines.push(value);
      else if (field === 'event') this.eventName = value;
      else if (field === 'id') this.lastId = value;
      else if (field === 'retry') {
        const n = Number(value);
        if (Number.isFinite(n)) this.retry = n;
      }
    }
    return out;
  }

  /** 流结束时，把残留的最后一行与未以空行结尾的事件吐出。 */
  flush() {
    const out = [];
    if (this.buffer) {
      let line = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      if (line.startsWith('data:')) {
        let value = line.slice(5);
        if (value.startsWith(' ')) value = value.slice(1);
        this.dataLines.push(value);
      }
    }
    this._dispatch(out);
    return out;
  }

  reset() {
    this.buffer = '';
    this.dataLines = [];
    this.eventName = '';
    this.lastId = '';
    this.retry = null;
  }
}
