// loader — 本地插件索引、动态 import、权限清单、错误隔离与卸载。
// 插件只通过 STLite 访问宿主；单个插件崩溃不影响主程序。

import { createSTLite } from './stlite.js';

const APP_VERSION = '0.3.0';
const ALLOWED_PERMISSIONS = new Set(['storage', 'network', 'tts']);

export const FALLBACK_MANIFESTS = [
  {
    id: 'token-counter',
    name: '上下文酒量',
    version: '1.0.0',
    author: 'PocketTavern',
    description: '实时估算上下文占用，标出世界书触发了哪些条目。',
    entry: 'plugin.js',
    minAppVersion: '0.1.0',
    permissions: ['storage'],
    icon: '🫗',
    builtin: true,
  },
  {
    id: 'dice-log',
    name: '骰子记录',
    version: '1.0.0',
    author: 'PocketTavern',
    description: '把每一次掷骰写进本地记录，并提供快捷投掷。',
    entry: 'plugin.js',
    minAppVersion: '0.1.0',
    permissions: ['storage'],
    icon: '🎲',
    builtin: true,
  },
  {
    id: 'story-state',
    name: '剧情状态',
    version: '1.0.0',
    author: 'PocketTavern',
    description: '从聊天里的伤势/死亡/地点关键词推断角色状态，给头像加标记，并把状态写进下一轮提示词。',
    entry: 'plugin.js',
    minAppVersion: '0.3.0',
    permissions: [],
    icon: '🎭',
    builtin: true,
  },
];

function validId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,40}$/.test(id);
}

function validEntry(entry) {
  return typeof entry === 'string' && /^[A-Za-z0-9._/-]+\.js$/.test(entry) && !entry.includes('..');
}

function versionAtLeast(current, required) {
  if (!required) return true;
  const a = String(current).split('.').map((n) => Number(n) || 0);
  const b = String(required).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

export class PluginHost {
  constructor({ repo, bus, bridge } = {}) {
    this.repo = repo;
    this.bus = bus;
    this.bridge = bridge || {};
    this.registry = new Map();
    this.loaded = new Map();
    this.panels = [];
    this.quickReplies = [];
    this.avatarDecorators = [];
    this.indexUrl = new URL('../../plugins/index.json', import.meta.url);
    this._errorClock = new Map();
    this.ready = false;
  }

  async init() {
    await this._loadIndex();
    await this._loadEnabled();
    this.ready = true;
    this._changed();
    return this.list();
  }

  async _loadEnabled() {
    const enabled = new Set(this.repo?.settings?.plugins?.enabled || []);
    for (const id of this.registry.keys()) {
      if (!enabled.has(id)) continue;
      try {
        await this.load(id);
      } catch {
        // load() 已记录错误并 toast；单插件失败不能阻断宿主启动
      }
    }
  }

  async _loadIndex() {
    let plugins = [];
    try {
      const res = await fetch(this.indexUrl, { cache: 'no-cache', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      plugins = Array.isArray(json?.plugins) ? json.plugins : [];
    } catch {
      plugins = FALLBACK_MANIFESTS;
    }
    if (!plugins.length) plugins = FALLBACK_MANIFESTS;
    for (const p of plugins) {
      if (!validId(p?.id)) continue;
      if (!this.registry.has(p.id)) {
        this.registry.set(p.id, {
          manifest: {
            ...p,
            permissions: Array.isArray(p.permissions) ? p.permissions.filter((x) => ALLOWED_PERMISSIONS.has(x)) : [],
          },
          loaded: false,
          error: '',
        });
      }
    }
    if (!this.registry.size) {
      for (const p of FALLBACK_MANIFESTS) {
        this.registry.set(p.id, { manifest: { ...p }, loaded: false, error: '' });
      }
    }
  }

  async _fetchManifest(id, fallback) {
    try {
      const url = new URL(`../../plugins/${id}/manifest.json`, import.meta.url);
      const res = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();
      if (manifest.id !== id) throw new Error('manifest id 与目录不一致');
      return {
        ...fallback,
        ...manifest,
        id,
        permissions: Array.isArray(manifest.permissions)
          ? manifest.permissions.filter((x) => ALLOWED_PERMISSIONS.has(x))
          : [],
      };
    } catch {
      return fallback;
    }
  }

  list() {
    return [...this.registry.values()].map((r) => ({
      id: r.manifest.id,
      name: r.manifest.name || r.manifest.id,
      version: r.manifest.version || '0.0.0',
      author: r.manifest.author || '未知',
      description: r.manifest.description || '',
      entry: r.manifest.entry,
      permissions: r.manifest.permissions || [],
      icon: r.manifest.icon || '🧩',
      builtin: Boolean(r.manifest.builtin),
      minAppVersion: r.manifest.minAppVersion || '',
      loaded: r.loaded,
      error: r.error || '',
    }));
  }

  isEnabled(id) {
    return (this.repo?.settings?.plugins?.enabled || []).includes(id);
  }

  async setEnabled(id, enabled) {
    const rec = this.registry.get(id);
    if (!rec) throw new Error('未知插件');
    const list = new Set(this.repo.settings.plugins.enabled || []);
    if (enabled) list.add(id);
    else list.delete(id);
    await this.repo.saveSettings({ plugins: { enabled: [...list] } });
    if (enabled) await this.load(id);
    else await this.unload(id);
    this._changed();
    return this.list();
  }

  async load(id) {
    const rec = this.registry.get(id);
    if (!rec) throw new Error('未知插件');
    if (rec.loaded) return true;
    rec.error = '';
    const manifest = await this._fetchManifest(id, rec.manifest);
    rec.manifest = manifest;
    if (!validEntry(manifest.entry)) {
      rec.error = 'manifest entry 不合法';
      this._changed();
      throw new Error(rec.error);
    }
    if (!versionAtLeast(APP_VERSION, manifest.minAppVersion)) {
      rec.error = `需要宿主 ${manifest.minAppVersion} 或更高版本`;
      this._changed();
      throw new Error(rec.error);
    }
    const cleanup = [];
    const ui = {
      registerPanel: (item) => {
        this.panels.push(item);
        this._changed();
        return () => {
          const i = this.panels.indexOf(item);
          if (i >= 0) this.panels.splice(i, 1);
          this._changed();
        };
      },
      registerQuickReply: (item) => {
        this.quickReplies.push(item);
        this._changed();
        return () => {
          const i = this.quickReplies.indexOf(item);
          if (i >= 0) this.quickReplies.splice(i, 1);
          this._changed();
        };
      },
      registerAvatarDecorator: (item) => {
        if (!item || typeof item.resolve !== 'function') throw new Error('registerAvatarDecorator 需要 resolve');
        this.avatarDecorators.push(item);
        this._changed();
        return () => {
          const i = this.avatarDecorators.indexOf(item);
          if (i >= 0) this.avatarDecorators.splice(i, 1);
          this._changed();
        };
      },
    };
    const stlite = createSTLite({
      manifest,
      repo: this.repo,
      bus: this.bus,
      bridge: this.bridge,
      ui,
      cleanup,
      onError: (err, context) => this._pluginError(id, err, context),
    });

    let module;
    try {
      const url = new URL(`../../plugins/${id}/${manifest.entry}`, import.meta.url);
      url.searchParams.set('v', encodeURIComponent(manifest.version || '0'));
      module = await import(url.href);
    } catch (err) {
      this._cleanup(id, cleanup);
      rec.error = `加载失败：${err.message}`;
      rec.loaded = false;
      this._pluginError(id, err, 'import');
      this._changed();
      throw err;
    }

    const instance = module?.default;
    if (!instance || typeof instance.init !== 'function') {
      this._cleanup(id, cleanup);
      rec.error = 'entry 需要 export default { init(STLite) }';
      this._changed();
      throw new Error(rec.error);
    }

    try {
      await instance.init(stlite);
      rec.loaded = true;
      rec.error = '';
      this.loaded.set(id, { instance, stlite, cleanup, manifest });
      this._changed();
      return true;
    } catch (err) {
      this._cleanup(id, cleanup);
      rec.loaded = false;
      rec.error = `初始化失败：${err.message}`;
      this._pluginError(id, err, 'init');
      this._changed();
      throw err;
    }
  }

  async unload(id) {
    const rec = this.registry.get(id);
    const loaded = this.loaded.get(id);
    if (!loaded) {
      if (rec) {
        rec.loaded = false;
        rec.error = '';
      }
      this._changed();
      return;
    }
    try {
      await loaded.instance.unload?.();
    } catch (err) {
      this._pluginError(id, err, 'unload');
    }
    this._cleanup(id, loaded.cleanup);
    this.loaded.delete(id);
    if (rec) {
      rec.loaded = false;
      rec.error = '';
    }
    this._changed();
  }

  _cleanup(id, cleanup) {
    for (const fn of cleanup.splice(0)) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.panels = this.panels.filter((p) => p.pluginId !== id);
    this.quickReplies = this.quickReplies.filter((q) => q.pluginId !== id);
    this.avatarDecorators = this.avatarDecorators.filter((d) => d.pluginId !== id);
  }

  _pluginError(id, err, context = '') {
    const message = String(err?.message || err || '未知错误');
    const key = `${id}:${message}`;
    const last = this._errorClock.get(key) || 0;
    if (Date.now() - last < 15000) return;
    this._errorClock.set(key, Date.now());
    console.warn(`[pt] 插件 ${id} 出错（${context}）：${message}`);
    this.bridge.toast?.(`插件「${id}」出错：${message}`);
  }

  _changed() {
    this.bus?.emit('plugins:changed', { panels: this.getPanels(), quickReplies: this.getQuickReplies(), list: this.list() });
  }

  getPanels() {
    return [...this.panels];
  }

  getQuickReplies() {
    return [...this.quickReplies];
  }

  /** 宿主唯一允许的头像状态白名单；插件只能返回这些状态。 */
  getAvatarDecorations(context = {}) {
    const allowed = new Set(['normal', 'hurt', 'dead', 'alert']);
    const out = [];
    for (const decorator of this.avatarDecorators) {
      try {
        const result = decorator.resolve(context);
        if (!result || typeof result !== 'object') continue;
        const state = allowed.has(result.state) ? result.state : 'normal';
        if (state === 'normal' && !result.badge) continue;
        out.push({
          pluginId: decorator.pluginId,
          state,
          badge: String(result.badge || '').slice(0, 4),
          label: String(result.label || '').slice(0, 24),
          title: String(result.title || result.label || '').slice(0, 80),
        });
      } catch (err) {
        this._pluginError?.(decorator.pluginId, err, 'avatar decorator');
      }
    }
    return out;
  }

  async reload() {
    for (const id of [...this.loaded.keys()]) await this.unload(id);
    this.registry.clear();
    await this._loadIndex();
    await this._loadEnabled();
    this._changed();
  }
}
