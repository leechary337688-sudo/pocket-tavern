// sound — 全部由 Web Audio 合成，不加载任何音频素材；TTS 走系统 speechSynthesis。
const TTS_LANG = 'zh-CN';

export class Sound {
  constructor(settings = {}) {
    this.ctx = null;
    this.master = null;
    this.settings = { enabled: true, volume: 0.55, tts: false, ttsRate: 1.0, ...settings };
  }

  update(settings = {}) {
    const s = settings.sound || settings;
    this.settings = { ...this.settings, ...s };
  }

  get enabled() {
    return Boolean(this.settings.enabled);
  }

  get volume() {
    const v = Number(this.settings.volume);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.55;
  }

  async unlock() {
    if (!this.enabled) return false;
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  _ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  _gain(value = 0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, value), this.ctx.currentTime);
    g.connect(this.master);
    return g;
  }

  _tone({ freq = 440, to = null, type = 'sine', duration = 0.2, gain = 0.2, delay = 0, filter = null }) {
    if (!this._ready()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * this.volume), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    let tail = g;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = filter.type || 'lowpass';
      bq.frequency.value = filter.freq || 1200;
      bq.Q.value = filter.q || 0.8;
      g.connect(bq);
      tail = bq;
    }
    osc.connect(g);
    tail.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  _noise({ duration = 0.2, gain = 0.15, type = 'bandpass', freq = 1600, q = 0.8, sweepTo = null, delay = 0 }) {
    if (!this._ready()) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.setValueAtTime(freq, t0);
    bq.Q.value = q;
    if (sweepTo) bq.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * this.volume), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(bq);
    bq.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  send() {
    this._tone({ freq: 180, to: 96, type: 'sine', duration: 0.15, gain: 0.32, filter: { type: 'lowpass', freq: 900 } });
    this._noise({ duration: 0.045, gain: 0.05, type: 'lowpass', freq: 1100 });
  }

  receive() {
    this._tone({ freq: 660, type: 'sine', duration: 0.2, gain: 0.07 });
    this._tone({ freq: 880, type: 'sine', duration: 0.2, gain: 0.055, delay: 0.012 });
  }

  dice() {
    this._noise({ duration: 0.3, gain: 0.16, type: 'highpass', freq: 900, q: 0.7 });
    this._tone({ freq: 1400, to: 700, type: 'triangle', duration: 0.16, gain: 0.04, delay: 0.05 });
  }

  page() {
    this._noise({ duration: 0.12, gain: 0.085, type: 'bandpass', freq: 2400, q: 0.9, sweepTo: 420 });
  }

  error() {
    this._tone({ freq: 220, to: 160, type: 'sine', duration: 0.32, gain: 0.16 });
    this._tone({ freq: 160, to: 120, type: 'triangle', duration: 0.24, gain: 0.06, delay: 0.05 });
  }

  success() {
    this._tone({ freq: 520, type: 'sine', duration: 0.12, gain: 0.06 });
    this._tone({ freq: 780, type: 'sine', duration: 0.18, gain: 0.05, delay: 0.07 });
  }

  ttsAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
  }

  speak(text, { pitch = 1.1, rate = null, onEnd = null } = {}) {
    if (!this.ttsAvailable()) return { ok: false, reason: '当前浏览器不支持语音合成' };
    if (!this.settings.tts) return { ok: false, reason: '语音朗读已在设置里关闭' };
    const content = String(text || '').trim();
    if (!content) return { ok: false, reason: '没有可朗读的文字' };
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(content.slice(0, 4000));
      utter.lang = TTS_LANG;
      const voices = window.speechSynthesis.getVoices?.() || [];
      const zh = voices.find((v) => /zh[-_]?CN|Chinese|中文|普通话/i.test(v.lang || v.name || ''));
      if (zh) utter.voice = zh;
      utter.pitch = Math.max(0.5, Math.min(2, pitch));
      utter.rate = Math.max(0.8, Math.min(1.5, Number(rate ?? this.settings.ttsRate ?? 1)));
      utter.volume = Math.max(0.1, this.volume);
      utter.onend = () => onEnd?.();
      utter.onerror = () => onEnd?.();
      window.speechSynthesis.speak(utter);
      return { ok: true, utterance: utter };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  stopSpeak() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }

  test() {
    this.unlock().then((ok) => {
      if (ok) {
        this.receive();
        setTimeout(() => this.page(), 220);
      }
    });
  }
}

export const sound = new Sound();
