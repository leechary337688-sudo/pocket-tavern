// settings-view — 右侧设置抽屉：连接、采样、提示词、外观、声音、插件、数据与关于。
import { h, clear, clamp, debounce, formatTime } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, confirmDialog, promptDialog } from './overlay.js';
import { toast, toastError } from './toast.js';
import { ApiClient, ApiError } from '../core/api-client.js';
import { SAMPLER_DEFAULTS, SAMPLER_META } from '../core/sampler.js';
import { shortHash } from '../data/content-hash.js';
import { openPresetPicker } from './preset-picker.js';

const API_TYPES = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'kobold', label: 'KoboldCpp' },
  { value: 'tabby', label: 'TabbyAPI' },
];

function fieldGroup(label, control, hint = '') {
  return h('label', { class: 'field-group' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-help' }, hint) : null);
}

function toggleRow(label, description, input) {
  const control =
    input?.classList?.contains('switch-input')
      ? h('span', { class: 'switch' }, input, h('span', { class: 'switch__knob' }))
      : input;
  return h(
    'label',
    { class: 'toggle-row' },
    h('span', { class: 'toggle-row__text' }, h('span', { class: 'toggle-row__label' }, label), description ? h('span', { class: 'toggle-row__desc' }, description) : null),
    control,
  );
}

function card(title, iconName, subtitle = '') {
  const body = h('div', { class: 'settings-card__body' });
  const el = h(
    'section',
    { class: 'settings-card' },
    h(
      'header',
      { class: 'settings-card__head' },
      h('span', { class: 'settings-card__icon' }, icon(iconName, { size: 19 })),
      h('div', { class: 'settings-card__titles' }, h('h2', { class: 'settings-card__title' }, title), subtitle ? h('p', { class: 'settings-card__subtitle' }, subtitle) : null),
    ),
    body,
  );
  return { el, body };
}

function numInput(value, attrs = {}) {
  return h('input', { class: 'field field--num', type: 'number', inputmode: 'decimal', value, ...attrs });
}

export function mount(el, ctx) {
  const { repo, loader, bus } = ctx;
  let settings = ctx.settings || repo.settings;
  let theme = ctx.theme || localStorage.getItem('pt:theme') || 'dark';
  let opened = false;
  let disposed = false;
  let pluginBody = null;
  let dataBody = null;
  let marketResults = [];
  let modelOptions = [];

  const backdrop = h('div', { class: 'drawer__backdrop', onclick: () => close() });
  const panel = h('aside', {
    class: 'drawer__panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '设置',
  });
  const shell = h('div', { class: 'drawer', hidden: true, 'aria-hidden': 'true' }, backdrop, panel);
  el.appendChild(shell);

  const scroll = h('div', { class: 'drawer__scroll' });
  const head = h(
    'header',
    { class: 'drawer__head' },
    h('div', {}, h('h1', { class: 'drawer__title' }, '设置'), h('p', { class: 'drawer__sub' }, '一切只在这台设备上')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭设置', onclick: () => close() }, icon('close')),
  );
  panel.append(head, scroll);

  async function save(patch, { quiet = true } = {}) {
    settings = await repo.saveSettings(patch);
    ctx.onSettingsSaved?.(settings);
    if (!quiet) toast('已保存', { type: 'success', duration: 1500 });
    return settings;
  }

  // ---------------- 连接 ----------------
  function connectionCard() {
    const { el: cardEl, body } = card('后端连接', 'cloud', 'OpenAI 兼容 / Claude / Gemini / Kobold / Tabby');
    const conn = settings.connection || {};
    const type = h(
      'select',
      { class: 'field select' },
      ...API_TYPES.map((t) => h('option', { value: t.value, selected: (conn.apiType || 'openai') === t.value }, t.label)),
    );
    const endpoint = h('input', {
      class: 'field',
      type: 'url',
      inputmode: 'url',
      spellcheck: 'false',
      value: conn.endpoint || '',
      placeholder: 'http://127.0.0.1:5001',
      autocomplete: 'off',
    });
    const apiKey = h('input', {
      class: 'field',
      type: 'password',
      value: conn.apiKey || '',
      placeholder: 'sk-…（仅存本机）',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const eye = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '显示或隐藏密钥', onclick: () => {
      apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
      eye.replaceChildren(icon(apiKey.type === 'password' ? 'eye' : 'eyeOff', { size: 20 }));
    } }, icon('eye', { size: 20 }));
    const model = h('input', {
      class: 'field',
      type: 'text',
      value: conn.model || '',
      placeholder: '模型名，例如 gpt-4o-mini',
      autocomplete: 'off',
      list: 'model-options',
    });
    const datalist = h('datalist', { id: 'model-options' });
    const headers = h('textarea', {
      class: 'field field--area',
      rows: '3',
      value: typeof conn.extraHeaders === 'string' ? conn.extraHeaders : JSON.stringify(conn.extraHeaders || {}, null, 2),
      placeholder: '{"X-Custom": "value"}（可选）',
      spellcheck: 'false',
    });
    const status = h('span', { class: 'conn-status' });
    const saveBtn = h('button', { class: 'btn btn--primary', type: 'button' }, '保存连接');
    const testBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, icon('sparkle', { size: 18 }), '测试连接');
    const fetchBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, icon('refresh', { size: 16 }), '拉取模型');

    function draft() {
      let extraHeaders = '';
      const raw = headers.value.trim();
      if (raw) {
        const parsed = JSON.parse(raw); // 调用处捕获
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('额外请求头必须是 JSON 对象');
        extraHeaders = parsed;
      }
      return {
        apiType: type.value,
        endpoint: endpoint.value.trim().replace(/\/+$/, ''),
        apiKey: apiKey.value,
        model: model.value.trim(),
        extraHeaders,
      };
    }

    function updateStatus() {
      const configured = Boolean(conn.endpoint && conn.model);
      status.className = `conn-status ${configured ? 'is-on' : ''}`;
      status.textContent = configured ? `已配置 · ${conn.apiType || 'openai'}` : '尚未连接后端';
    }
    updateStatus();

    saveBtn.addEventListener('click', async () => {
      let next;
      try {
        next = draft();
      } catch (err) {
        toastError(err.message);
        headers.focus();
        return;
      }
      if (!next.endpoint) {
        toastError('先填后端地址');
        endpoint.focus();
        return;
      }
      try {
        new URL(next.endpoint);
      } catch {
        toastError('后端地址不是合法 URL');
        endpoint.focus();
        return;
      }
      await save({ connection: next });
      Object.assign(conn, next);
      updateStatus();
      toast('连接配置已保存', { type: 'success' });
    });

    fetchBtn.addEventListener('click', async () => {
      let next;
      try {
        next = draft();
      } catch (err) {
        toastError(err.message);
        return;
      }
      if (!next.endpoint) return toastError('先填后端地址');
      fetchBtn.disabled = true;
      fetchBtn.classList.add('is-loading');
      try {
        const api = new ApiClient({ connection: next, sampler: settings.sampler });
        const models = await api.listModels();
        modelOptions = models;
        clear(datalist);
        for (const m of models.slice(0, 300)) datalist.appendChild(h('option', { value: m.id || m.name || String(m) }));
        if (models.length && !model.value) model.value = models[0].id || models[0].name || '';
        toast(models.length ? `找到 ${models.length} 个模型` : '端点没有返回模型，可直接手填模型名', { type: models.length ? 'success' : 'info' });
      } catch (err) {
        toastError(err.message);
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.classList.remove('is-loading');
      }
    });

    testBtn.addEventListener('click', async () => {
      let next;
      try {
        next = draft();
      } catch (err) {
        return toastError(err.message);
      }
      if (!next.endpoint || !next.model) return toastError('先填地址和模型名');
      testBtn.disabled = true;
      testBtn.classList.add('is-loading');
      try {
        const api = new ApiClient({ connection: next, sampler: settings.sampler, timeoutMs: 15000, retries: 0 });
        const models = await api.listModels();
        updateStatus();
        toast(models.length ? `连接成功，看到 ${models.length} 个模型` : '连接成功（端点未返回模型列表）', { type: 'success' });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err?.message || err);
        toastError(`连接失败：${msg}`, { duration: 5000 });
      } finally {
        testBtn.disabled = false;
        testBtn.classList.remove('is-loading');
      }
    });

    body.append(
      fieldGroup('接口类型', type),
      fieldGroup('后端地址', endpoint, '只填到主机与端口，不要带 /v1；密钥只存在本机。'),
      h('div', { class: 'field-group' }, h('span', { class: 'field-label' }, 'API 密钥'), h('div', { class: 'input-with-btn' }, apiKey, eye), h('span', { class: 'field-help' }, '密钥不会写入日志，也不会暴露给插件（STLite 会脱敏）。')),
      h('div', { class: 'field-group' }, h('div', { class: 'field-label-row' }, h('span', { class: 'field-label' }, '模型'), fetchBtn), model, datalist),
      fieldGroup('额外请求头（JSON）', headers, '例如某些反代需要自定义鉴权头；留空即可。'),
      h('div', { class: 'conn-row' }, status, h('div', { class: 'btn-row' }, testBtn, saveBtn)),
    );
    return cardEl;
  }

  // ---------------- 采样 ----------------
  function samplerCard() {
    const { el: cardEl, body } = card('采样参数', 'cpu', '每次改动即时保存，重启后仍在');
    const rows = {};
    for (const meta of SAMPLER_META) {
      const value = Number(settings.sampler?.[meta.key] ?? SAMPLER_DEFAULTS[meta.key]);
      const range = h('input', { class: 'range', type: 'range', min: meta.min, max: meta.max, step: meta.step, value });
      const out = h('output', { class: 'sampler-value' }, String(value));
      const row = h(
        'div',
        { class: 'sampler-row' },
        h('div', { class: 'sampler-head' }, h('span', { class: 'sampler-label' }, meta.label), h('span', { class: 'sampler-hint' }, meta.hint), out),
        range,
      );
      range.addEventListener('input', () => {
        out.textContent = String(range.value);
      });
      range.addEventListener('change', async () => {
        const n = Number(range.value);
        try {
          await save({ sampler: { ...settings.sampler, [meta.key]: n } });
          out.textContent = String(settings.sampler[meta.key]);
        } catch (err) {
          toastError(`保存失败：${err.message}`);
        }
      });
      rows[meta.key] = row;
      body.appendChild(row);
    }
    const seed = numInput(settings.sampler?.seed ?? -1, { min: -1, max: 2147483647, step: 1 });
    const seedRow = h(
      'div',
      { class: 'sampler-row sampler-row--compact' },
      h('div', { class: 'sampler-head' }, h('span', { class: 'sampler-label' }, 'seed'), h('span', { class: 'sampler-hint' }, '-1 = 每次随机'), seed),
    );
    seed.addEventListener('change', () => save({ sampler: { ...settings.sampler, seed: Number(seed.value) || -1 } }).catch((err) => toastError(err.message)));
    body.appendChild(seedRow);
    body.appendChild(
      h(
        'div',
        { class: 'settings-card__foot' },
        h('button', {
          class: 'text-btn',
          type: 'button',
          onclick: async () => {
            await save({ sampler: { ...SAMPLER_DEFAULTS } });
            draw();
            toast('采样参数已恢复默认');
          },
        }, icon('undo', { size: 16 }), '恢复默认值'),
        h('span', { class: 'muted' }, `context ${settings.sampler?.context_window || 8192}`),
      ),
    );
    return cardEl;
  }

  // ---------------- 提示词 / 内容 ----------------
  function promptCard() {
    const { el: cardEl, body } = card('人格与提示词', 'quote', '系统提示词会参与每次组装，按 10% 预算裁剪');
    const persona = h('input', { class: 'field', type: 'text', value: settings.personaName || '旅人', placeholder: '你在故事里的名字', maxlength: 30 });
    const system = h('textarea', { class: 'field field--area', rows: '5', value: settings.prompt?.system || '', placeholder: '文风、禁区、叙事要求…' });
    const saveBtn = h('button', { class: 'btn btn--primary', type: 'button' }, '保存提示词');
    saveBtn.addEventListener('click', async () => {
      await save({ personaName: persona.value.trim() || '旅人', prompt: { ...settings.prompt, system: system.value.trim() } });
      toast('提示词已保存', { type: 'success' });
    });

    const qrBox = h('div', { class: 'quickreply-editor' });
    function drawQuickReplies() {
      clear(qrBox);
      for (const qr of settings.quickReplies || []) {
        qrBox.appendChild(
          h(
            'div',
            { class: 'quickreply-row' },
            h('div', { class: 'quickreply-row__text' }, h('strong', {}, qr.label), h('span', {}, qr.text)),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': '编辑快捷回复', onclick: () => editQuickReply(qr) }, icon('edit', { size: 18 })),
            h('button', {
              class: 'icon-btn icon-btn--danger',
              type: 'button',
              'aria-label': '删除快捷回复',
              onclick: async () => {
                await save({ quickReplies: (settings.quickReplies || []).filter((x) => x.id !== qr.id) });
                drawQuickReplies();
              },
            }, icon('trash', { size: 18 })),
          ),
        );
      }
      qrBox.appendChild(h('button', { class: 'text-btn', type: 'button', onclick: () => editQuickReply(null) }, icon('plus', { size: 16 }), '添加一条快捷回复'));
    }
    drawQuickReplies();

    body.append(
      fieldGroup('你的名字', persona, '会替换 {{user}} 宏。'),
      fieldGroup('系统提示词', system),
      saveBtn,
      h('div', { class: 'settings-subhead' }, h('h3', {}, '快速回复栏'), h('span', { class: 'muted' }, `${(settings.quickReplies || []).length} 条`)),
      qrBox,
      h('div', { class: 'settings-subhead' }, h('h3', {}, '内容分级'), h('span', { class: 'muted' }, settings.nsfw ? 'NSFW 已开启' : 'NSFW 关闭')),
      toggleRow(
        '允许成人内容',
        '默认关闭。只影响提示词与内容提醒，不改变本地数据。',
        h('input', {
          type: 'checkbox',
          class: 'switch-input',
          checked: Boolean(settings.nsfw),
          onchange: async (event) => {
            const next = event.target.checked;
            if (next) {
              const ok = await confirmDialog({
                title: '开启成人内容？',
                message: '请确认你已年满 18 岁，并会遵守所在地区法律与所用后端的服务条款。',
                confirmText: '我已成年，开启',
                danger: true,
              });
              if (!ok) {
                event.target.checked = false;
                return;
              }
            }
            await save({ nsfw: next });
            toast(next ? 'NSFW 已开启' : 'NSFW 已关闭');
            draw();
          },
        }),
      ),
    );
    return cardEl;
  }

  function editQuickReply(existing) {
    const label = h('input', { class: 'field', type: 'text', value: existing?.label || '', placeholder: '按钮上显示的字', maxlength: 12 });
    const text = h('textarea', { class: 'field field--area', rows: '3', value: existing?.text || '', placeholder: '点按后发送的内容' });
    const overlay = openOverlay({
      title: existing ? '编辑快捷回复' : '新增快捷回复',
      content: h('div', { class: 'dialog-form' }, fieldGroup('按钮文字', label), fieldGroup('发送内容', text)),
      variant: 'center',
      className: 'dialog',
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => null },
        {
          label: '保存',
          kind: 'primary',
          onClick: async () => {
            if (!label.value.trim() || !text.value.trim()) {
              toastError('文字和内容都要填');
              return false;
            }
            const list = [...(settings.quickReplies || [])];
            const next = { id: existing?.id || `qr-${Date.now()}`, label: label.value.trim(), text: text.value.trim() };
            const idx = list.findIndex((x) => x.id === next.id);
            if (idx >= 0) list[idx] = next;
            else list.push(next);
            await save({ quickReplies: list });
            overlay.close(true);
            draw();
            return false;
          },
        },
      ],
    });
  }

  // ---------------- 外观 ----------------
  function appearanceCard() {
    const { el: cardEl, body } = card('外观', 'palette', '两套配色，跟随你的作息');
    const choices = [
      { value: 'dark', label: '深夜酒馆', desc: '琥珀与木色' },
      { value: 'light', label: '白天小酒馆', desc: '纸张与日光' },
    ];
    const row = h('div', { class: 'theme-choice' });
    for (const choice of choices) {
      const btn = h(
        'button',
        {
          class: `theme-card ${theme === choice.value ? 'is-active' : ''} theme-card--${choice.value}`,
          type: 'button',
          onclick: () => {
            theme = choice.value;
            localStorage.setItem('pt:theme', theme);
            document.documentElement.dataset.theme = theme;
            ctx.onThemeChange?.(theme);
            row.querySelectorAll('.theme-card').forEach((el) => el.classList.toggle('is-active', el.dataset.theme === theme));
            toast(choice.label, { duration: 1200 });
          },
        },
        h('span', { class: 'theme-card__swatch' }),
        h('span', { class: 'theme-card__name' }, choice.label),
        h('span', { class: 'theme-card__desc' }, choice.desc),
      );
      btn.dataset.theme = choice.value;
      row.appendChild(btn);
    }
    body.appendChild(row);
    body.appendChild(h('p', { class: 'muted small' }, '主题是 UI 偏好，只存在 localStorage；角色与聊天数据仍在 IndexedDB。'));
    return cardEl;
  }

  // ---------------- 声音 ----------------
  function soundCard() {
    const { el: cardEl, body } = card('声音与朗读', 'volume', '全部由 Web Audio 合成，零音频素材');
    const enabled = h('input', {
      type: 'checkbox',
      class: 'switch-input',
      checked: Boolean(settings.sound?.enabled),
      onchange: async (event) => {
        await save({ sound: { ...settings.sound, enabled: event.target.checked } });
        ctx.onSoundChange?.(settings);
      },
    });
    const volume = h('input', { class: 'range', type: 'range', min: 0, max: 1, step: 0.01, value: settings.sound?.volume ?? 0.55 });
    const volOut = h('output', { class: 'sampler-value' }, `${Math.round((settings.sound?.volume ?? 0.55) * 100)}%`);
    volume.addEventListener('input', () => {
      volOut.textContent = `${Math.round(Number(volume.value) * 100)}%`;
    });
    volume.addEventListener('change', async () => {
      await save({ sound: { ...settings.sound, volume: Number(volume.value) } });
      ctx.onSoundChange?.(settings);
    });
    const tts = h('input', {
      type: 'checkbox',
      class: 'switch-input',
      checked: Boolean(settings.sound?.tts),
      onchange: async (event) => {
        await save({ sound: { ...settings.sound, tts: event.target.checked } });
        ctx.onSoundChange?.(settings);
        if (event.target.checked) ctx.sound?.speak('今晚想喝点什么？', { pitch: 1.1 });
      },
    });
    const rate = h('input', { class: 'range', type: 'range', min: 0.8, max: 1.5, step: 0.05, value: settings.sound?.ttsRate ?? 1 });
    const rateOut = h('output', { class: 'sampler-value' }, `${Number(settings.sound?.ttsRate ?? 1).toFixed(2)}×`);
    rate.addEventListener('input', () => {
      rateOut.textContent = `${Number(rate.value).toFixed(2)}×`;
    });
    rate.addEventListener('change', async () => {
      await save({ sound: { ...settings.sound, ttsRate: Number(rate.value) } });
      ctx.onSoundChange?.(settings);
    });
    body.append(
      toggleRow('启用音效', '发送、接收、掷骰、翻页与错误都有轻提示音。', enabled),
      h('div', { class: 'sampler-row' }, h('div', { class: 'sampler-head' }, h('span', { class: 'sampler-label' }, '音量'), volOut), volume),
      toggleRow('语音朗读', '使用系统 speechSynthesis，zh-CN；没有中文语音时会用默认音色。', tts),
      h('div', { class: 'sampler-row' }, h('div', { class: 'sampler-head' }, h('span', { class: 'sampler-label' }, '朗读语速'), rateOut), rate),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => { ctx.sound?.test(); } }, icon('music', { size: 16 }), '试听音效'),
        h('button', {
          class: 'btn btn--ghost btn--small',
          type: 'button',
          onclick: () => {
            const res = ctx.sound?.speak('旅人推开酒馆的门，雨声被关在身后。', { pitch: 1.1 });
            if (res && !res.ok) toast(res.reason, { type: 'warn' });
          },
        }, icon('speaker', { size: 16 }), '试听朗读'),
      ),
    );
    return cardEl;
  }

  // ---------------- 插件 ----------------
  function pluginCard() {
    const { el: cardEl, body } = card('插件', 'plugin', '清单式权限；单个插件崩溃不会影响主程序');
    pluginBody = h('div', { class: 'plugin-list' });
    body.appendChild(pluginBody);
    const market = h('div', { class: 'market-block' });
    const url = h('input', { class: 'field', type: 'url', inputmode: 'url', value: settings.plugins?.marketUrl || '', placeholder: 'https://example.com/plugins-index.json', spellcheck: 'false' });
    const results = h('div', { class: 'market-results' });
    const refresh = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, icon('refresh', { size: 16 }), '刷新索引');
    refresh.addEventListener('click', async () => {
      const value = url.value.trim();
      try {
        await save({ plugins: { ...settings.plugins, marketUrl: value } });
        if (!value) {
          marketResults = [];
          renderMarketResults(results);
          toast('已清空远程源，使用本地 /plugins/index.json', { duration: 2200 });
          return;
        }
        new URL(value);
        refresh.disabled = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(value, { signal: controller.signal, credentials: 'omit', cache: 'no-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          marketResults = Array.isArray(json?.plugins) ? json.plugins : [];
          renderMarketResults(results);
          toast(marketResults.length ? `远程索引有 ${marketResults.length} 个条目` : '远程索引为空');
        } finally {
          clearTimeout(timer);
          refresh.disabled = false;
        }
      } catch (err) {
        refresh.disabled = false;
        toastError(`索引读取失败：${err.message}`);
      }
    });
    market.append(
      h('div', { class: 'settings-subhead' }, h('h3', {}, '插件市场'), h('span', { class: 'mini-tag' }, '本地索引 · 远程源可配')),
      h('p', { class: 'muted small' }, '默认读取 /plugins/index.json。远程安装尚未实现（当前版本明确占位），当前只展示索引条目，不会自动下载代码。'),
      h('div', { class: 'input-with-btn input-with-btn--stack' }, url, refresh),
      results,
    );
    body.appendChild(market);
    renderPlugins();
    renderMarketResults(results);
    return cardEl;
  }

  function renderPlugins() {
    if (!pluginBody) return;
    clear(pluginBody);
    let list = [];
    try {
      list = loader?.list?.() || [];
    } catch {
      list = [];
    }
    if (!list.length) {
      pluginBody.appendChild(h('p', { class: 'muted small' }, '没有发现插件。检查 /plugins/index.json。'));
      return;
    }
    const enabledSet = new Set(settings.plugins?.enabled || []);
    for (const plugin of list) {
      const enabled = enabledSet.has(plugin.id);
      const toggle = h('input', {
        type: 'checkbox',
        class: 'switch-input',
        checked: enabled,
        onchange: async (event) => {
          event.target.disabled = true;
          try {
            await loader.setEnabled(plugin.id, event.target.checked);
            settings = repo.settings;
            enabledSet.clear();
            (settings.plugins?.enabled || []).forEach((id) => enabledSet.add(id));
            renderPlugins();
            renderPanels();
            toast(event.target.checked ? `已启用「${plugin.name}」` : `已停用「${plugin.name}」`, { type: 'success' });
          } catch (err) {
            event.target.checked = !event.target.checked;
            event.target.disabled = false;
            toastError(`插件切换失败：${err.message}`);
          }
        },
      });
      pluginBody.appendChild(
        h(
          'div',
          { class: 'plugin-row' },
          h('span', { class: 'plugin-row__icon' }, plugin.icon || '🧩'),
          h(
            'div',
            { class: 'plugin-row__main' },
            h('div', { class: 'plugin-row__title' }, h('strong', {}, plugin.name), h('span', { class: 'plugin-row__ver' }, `v${plugin.version}`), plugin.builtin ? h('span', { class: 'mini-tag' }, '内置') : null),
            h('p', { class: 'plugin-row__desc' }, plugin.description || '没有说明'),
            h('div', { class: 'plugin-row__meta' }, `权限：${plugin.permissions?.length ? plugin.permissions.join(' / ') : '无'}`, plugin.error ? h('span', { class: 'plugin-row__error' }, plugin.error) : null),
          ),
          h('span', { class: 'switch' }, toggle, h('span', { class: 'switch__knob' })),
        ),
      );
    }
    bodyPanels(pluginBody);
  }

  function bodyPanels(host) {
    let panels = [];
    try {
      panels = loader?.getPanels?.() || [];
    } catch {
      panels = [];
    }
    if (!panels.length) return;
    host.appendChild(h('div', { class: 'settings-subhead settings-subhead--tight' }, h('h3', {}, '插件面板')));
    for (const item of panels) {
      const box = h('div', { class: 'plugin-panel' });
      box.appendChild(
        h('div', { class: 'plugin-panel__head' }, h('span', {}, item.icon || '🧩'), h('strong', {}, item.title || '插件面板'), h('span', { class: 'muted small' }, item.pluginId || '')),
      );
      const content = h('div', { class: 'plugin-panel__body' });
      box.appendChild(content);
      host.appendChild(box);
      try {
        const result = item.render?.(content);
        if (result && typeof result.catch === 'function') result.catch((err) => toastError(`插件面板出错：${err.message}`));
      } catch (err) {
        content.appendChild(h('p', { class: 'muted small' }, `面板渲染失败：${err.message}`));
      }
    }
  }

  function renderPanels() {
    // 只重绘面板区，避免打断插件开关的焦点。
    const old = pluginBody?.querySelectorAll('.plugin-panel, .settings-subhead--tight');
    old?.forEach((el) => el.remove());
    if (pluginBody) bodyPanels(pluginBody);
  }

  function renderMarketResults(host) {
    clear(host);
    if (!marketResults.length) {
      host.appendChild(h('p', { class: 'muted small' }, '远程索引条目会显示在这里。'));
      return;
    }
    for (const item of marketResults.slice(0, 20)) {
      host.appendChild(
        h(
          'div',
          { class: 'market-row' },
          h('span', { class: 'market-row__icon' }, item.icon || '🧩'),
          h('div', { class: 'market-row__main' }, h('strong', {}, item.name || item.id || '未命名'), h('span', {}, item.description || '')),
          h('span', { class: 'mini-tag' }, '未实现安装'),
        ),
      );
    }
  }

  // ---------------- 数据 ----------------
  async function openDedupeTool() {
    const wrap = h('div', { class: 'dedupe-tool' });
    const overlay = openOverlay({
      title: '查重合并',
      subtitle: '同内容或同名的世界书，保留一本，其余会话与卡绑定自动改绑',
      content: wrap,
      actions: [{ label: '关闭', kind: 'ghost' }],
    });
    async function render() {
      clear(wrap);
      let groups = [];
      try {
        groups = await repo.duplicateWorlds();
      } catch (err) {
        wrap.appendChild(h('p', { class: 'muted' }, `读取失败：${err.message}`));
        return;
      }
      if (!groups.length) {
        wrap.append(
          h('div', { class: 'dedupe-empty' }, icon('check', { size: 22 }),
            h('strong', {}, '没有发现重复世界书'),
            h('span', { class: 'muted small' }, '同 hash 或同名的条目会出现在这里。'),
          ),
        );
        return;
      }
      wrap.appendChild(h('p', { class: 'muted small' }, `发现 ${groups.length} 组可疑重复。合并只改绑定，不删除会话。`));
      for (const group of groups) {
        const select = h('select', { class: 'field', 'aria-label': '保留哪一本' },
          ...group.records.map((w, index) => h('option', { value: w.id, selected: index === 0 },
            `${w.name} ${shortHash(w.contentHash)} · ${w.boundChats} 场`))
        );
        const mergeBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, '合并这组');
        mergeBtn.addEventListener('click', async () => {
          const keepId = select.value;
          const ids = group.records.map((w) => w.id).filter((id) => id !== keepId);
          if (!ids.length) return;
          const ok = await confirmDialog({
            title: '合并这些世界书？',
            message: `保留 1 本，删除 ${ids.length} 本；相关会话与角色卡会改绑到保留的那本。`,
            confirmText: '合并',
            danger: true,
          });
          if (!ok) return;
          mergeBtn.disabled = true;
          try {
            const result = await repo.mergeWorlds(keepId, ids);
            toast(`已合并 ${result.removed} 本，改绑 ${result.rebound} 场会话`, { type: 'success' });
            await render();
          } catch (err) {
            toastError(`合并失败：${err.message}`);
            mergeBtn.disabled = false;
          }
        });
        wrap.appendChild(
          h('div', { class: 'dedupe-group' },
            h('div', { class: 'dedupe-group__head' },
              h('strong', {}, group.kind === 'same-name' ? `同名《${group.name}》` : `同内容《${group.name}》`),
              h('span', { class: 'muted small' }, `${group.records.length} 本`),
            ),
            h('div', { class: 'dedupe-group__row' }, select, mergeBtn),
          ),
        );
      }
    }
    await render();
    return overlay;
  }

  function dataCard() {
    const { el: cardEl, body } = card('数据与备份', 'database', '本地优先，每日自动快照保留 7 份');
    dataBody = h('div', { class: 'data-block' });
    body.appendChild(dataBody);
    drawData();
    return cardEl;
  }

  async function drawData() {
    if (!dataBody) return;
    clear(dataBody);
    let stats = { cards: 0, chats: 0, worlds: 0, messages: 0 };
    let snapshots = [];
    try {
      [stats, snapshots] = await Promise.all([repo.stats(), repo.listSnapshots()]);
    } catch {
      /* ignore */
    }
    const includeKeys = h('input', { type: 'checkbox', class: 'switch-input' });
    const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    dataBody.append(
      h(
        'div',
        { class: 'stat-grid' },
        h('div', { class: 'stat-box' }, h('strong', {}, String(stats.cards)), h('span', {}, '角色卡')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(stats.chats)), h('span', {}, '会话')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(stats.messages)), h('span', {}, '消息')),
        h('div', { class: 'stat-box' }, h('strong', {}, String(stats.worlds)), h('span', {}, '世界书')),
      ),
      h(
        'div',
        { class: 'data-actions' },
        h('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: async () => {
            try {
              const payload = await repo.exportAll({ includeKeys: includeKeys.checked });
              const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = h('a', { href: url, download: `pockettavern-backup-${stamp}.json` });
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              toast(includeKeys.checked ? '备份已导出（包含密钥）' : '备份已导出（密钥已脱敏）', { type: 'success' });
            } catch (err) {
              toastError(`导出失败：${err.message}`);
            }
          },
        }, icon('download', { size: 18 }), '导出全量备份'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => importInput.click() }, icon('upload', { size: 18 }), '导入备份'),
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: async () => {
          try {
            await repo.createSnapshot();
            toast('已创建快照', { type: 'success' });
            drawData();
          } catch (err) {
            toastError(`快照失败：${err.message}`);
          }
        } }, icon('archive', { size: 16 }), '立即快照'),
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: openDedupeTool }, icon('filter', { size: 16 }), '查重合并'),
        h('button', {
          class: 'btn btn--ghost btn--small',
          type: 'button',
          onclick: () => openPresetPicker({ repo, onLoaded: () => drawData() }),
        }, icon('book', { size: 16 }), '载入预设世界'),
      ),
      toggleRow('备份包含 API 密钥', '默认脱敏。只有在完全信任备份文件去向时才打开。', includeKeys),
      importInput,
      h('div', { class: 'settings-subhead settings-subhead--tight' }, h('h3', {}, '自动快照'), h('span', { class: 'muted' }, `${snapshots.length} / 7`)),
    );
    if (!snapshots.length) {
      dataBody.appendChild(h('p', { class: 'muted small' }, '今天还没有快照。应用启动时会自动尝试创建每日快照。'));
    } else {
      const snapList = h('div', { class: 'snapshot-list' });
      for (const snap of snapshots) {
        snapList.appendChild(
          h(
            'div',
            { class: 'snapshot-row' },
            h('div', {}, h('strong', {}, snap.date), h('span', { class: 'muted small' }, ` · ${snap.counts?.cards || 0} 卡 / ${snap.counts?.chats || 0} 聊 / ${snap.counts?.worlds || 0} 世界书`)),
            h('button', {
              class: 'text-btn',
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog({ title: '恢复这个快照？', message: `${snap.date} 的快照会覆盖当前的角色卡、会话与世界书。`, confirmText: '恢复', danger: true });
                if (!ok) return;
                try {
                  await repo.restoreSnapshot(snap.date);
                  toast('快照已恢复，正在刷新…', { type: 'success' });
                  setTimeout(() => location.reload(), 700);
                } catch (err) {
                  toastError(`恢复失败：${err.message}`);
                }
              },
            }, '恢复'),
          ),
        );
      }
      dataBody.appendChild(snapList);
    }
    dataBody.appendChild(
      h('div', { class: 'danger-zone' },
        h('h3', {}, '危险区'),
        h('p', { class: 'muted small' }, '清除所有本地数据并恢复内置演示卡。此操作不可撤销，建议先导出备份。'),
        h('button', {
          class: 'btn btn--danger btn--small',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: '清空酒馆？', message: '角色卡、会话、世界书、插件数据都会删除，并重新写入演示数据。', confirmText: '清空并重置', danger: true });
            if (!ok) return;
            try {
              await repo.resetAll();
              localStorage.removeItem('pt:lastChat');
              toast('已重置，正在刷新…', { type: 'success' });
              setTimeout(() => location.reload(), 700);
            } catch (err) {
              toastError(`重置失败：${err.message}`);
            }
          },
        }, icon('trash', { size: 16 }), '清空并恢复演示数据'),
      ),
    );
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const ok = await confirmDialog({
          title: '导入备份？',
          message: '会用备份里的角色卡、会话、世界书与设置替换当前数据。当前数据不会自动备份，建议先导出。',
          confirmText: '替换并导入',
          danger: true,
        });
        if (!ok) return;
        const result = await repo.importAll(payload, { mode: 'replace' });
        toast(`导入完成：${result.cards} 卡 / ${result.chats} 聊 / ${result.worlds} 世界书`, { type: 'success', duration: 4000 });
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        toastError(`导入失败：${err.message}`);
      }
    });
  }

  // ---------------- 关于 ----------------
  function aboutCard() {
    const { el: cardEl, body } = card('关于', 'info');
    body.append(
      h('div', { class: 'about-hero' }, h('img', { class: 'about-logo', src: 'icons/logo.svg', alt: '' }), h('div', {}, h('strong', {}, '袖珍酒馆 PocketTavern'), h('span', { class: 'muted small' }, 'v0.4.0 · 移动优先 PWA'))),
      h('p', { class: 'muted small about-copy' }, '角色卡聊天、世界书、流式后端与插件。所有数据保存在本机 IndexedDB；没有遥测，也不会把内容发到你未配置的服务器。'),
      h('div', { class: 'about-meta' },
        h('span', {}, h('strong', {}, '存储'), ' IndexedDB pt-db'),
        h('span', {}, h('strong', {}, '主题'), ' 深夜 / 白天'),
        h('span', {}, h('strong', {}, '构建'), ' 原生 ES2022 · 无打包'),
      ),
    );
    return cardEl;
  }

  // ---------------- 创意工坊 ----------------
  function workshopCard() {
    const ws = settings.workshop || {};
    const { el: cardEl, body } = card('创意工坊', 'sparkle', 'AI 生成 · 自托管源 · 本地发布');
    const remote = h('input', { type: 'checkbox', class: 'switch-input', checked: ws.remoteEnabled !== false });
    remote.addEventListener('change', () => save({ workshop: { ...settings.workshop, remoteEnabled: remote.checked } }).catch((err) => toastError(err.message)));
    const demo = h('input', { type: 'checkbox', class: 'switch-input', checked: ws.demoSource !== false });
    demo.addEventListener('change', () => save({ workshop: { ...settings.workshop, demoSource: demo.checked } }).catch((err) => toastError(err.message)));
    const url = h('input', {
      class: 'field',
      type: 'url',
      inputmode: 'url',
      spellcheck: 'false',
      autocomplete: 'off',
      value: ws.remoteUrl || '',
      placeholder: 'https://your-workshop.example',
    });
    const urlHint = h('span', { class: 'field-help' }, '留空时只显示内置演示与本地发布；不会把 API Key 发给工坊。');
    url.addEventListener('input', debounce(async () => {
      try {
        await save({ workshop: { ...settings.workshop, remoteUrl: url.value.trim() } });
        urlHint.textContent = url.value.trim() ? '请求只带作品查询，不带密钥；失败会回退缓存。' : '留空时只显示内置演示与本地发布；不会把 API Key 发给工坊。';
      } catch (err) {
        toastError(err.message);
      }
    }, 500));
    const model = h('input', {
      class: 'field',
      value: ws.genModel || '',
      placeholder: '默认模型',
      autocomplete: 'off',
    });
    model.addEventListener('input', debounce(() => save({ workshop: { ...settings.workshop, genModel: model.value.trim() } }).catch((err) => toastError(err.message)), 450));
    const temp = h('input', {
      class: 'range',
      type: 'range',
      min: '0.5',
      max: '1.2',
      step: '0.05',
      value: String(Number(ws.genTemperature) || 0.9),
      'aria-label': '生成温度',
    });
    const tempValue = h('span', { class: 'range-value' }, (Number(ws.genTemperature) || 0.9).toFixed(2));
    temp.addEventListener('input', () => { tempValue.textContent = Number(temp.value).toFixed(2); });
    temp.addEventListener('change', () => save({ workshop: { ...settings.workshop, genTemperature: Number(temp.value) } }).catch((err) => toastError(err.message)));
    const lang = h('select', { class: 'field select' },
      h('option', { value: 'auto', selected: (ws.genLanguage || 'auto') === 'auto' }, '跟随输入'),
      h('option', { value: 'zh', selected: ws.genLanguage === 'zh' }, '中文'),
      h('option', { value: 'en', selected: ws.genLanguage === 'en' }, 'English'));
    lang.addEventListener('change', () => save({ workshop: { ...settings.workshop, genLanguage: lang.value } }).catch((err) => toastError(err.message)));
    body.append(
      toggleRow('启用远程工坊源', '关闭后只用内置演示与本地发布', remote),
      fieldGroup('自托管端点', url, ''),
      urlHint,
      toggleRow('显示内置演示源', '雾港的薇拉 / 世界书 / 套装', demo),
      fieldGroup('生成用模型', model, '只影响 AI 生成器，不改变聊天模型'),
      h('div', { class: 'range-row' }, h('div', { class: 'range-head' }, h('span', {}, '生成温度'), tempValue), temp),
      fieldGroup('生成语言', lang, '字段级重生也遵守这个设置'),
      h('p', { class: 'muted small' }, '工坊浏览/发布不需要登录；远程源只接收作品查询与 .ptpack，不接收本机密钥。'),
    );
    return cardEl;
  }

  function drawerBody() {
    clear(scroll);
    scroll.append(
      connectionCard(),
      samplerCard(),
      promptCard(),
      workshopCard(),
      appearanceCard(),
      soundCard(),
      pluginCard(),
      dataCard(),
      aboutCard(),
    );
  }

  function draw() {
    drawerBody();
  }

  function open() {
    if (disposed) return;
    opened = true;
    shell.hidden = false;
    shell.setAttribute('aria-hidden', 'false');
    drawerBody();
    requestAnimationFrame(() => shell.classList.add('is-open'));
    setTimeout(() => scroll.focus({ preventScroll: true }), 200);
  }

  function close() {
    if (!opened) return;
    opened = false;
    shell.classList.remove('is-open');
    shell.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!opened) shell.hidden = true;
    }, 280);
  }

  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  scroll.tabIndex = -1;

  const onPluginsChanged = debounce(() => {
    if (!opened) return;
    settings = repo.settings;
    renderPlugins();
  }, 120);
  const offPlugins = bus?.on?.('plugins:changed', onPluginsChanged);

  return {
    open,
    close,
    toggle: () => (opened ? close() : open()),
    isOpen: () => opened,
    unmount() {
      disposed = true;
      offPlugins?.();
      shell.remove();
    },
  };
}
