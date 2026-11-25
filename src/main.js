// main — 应用装配：主题、路由、设置抽屉、插件宿主、引导、骰子与 PWA 注册。
import { Repo } from './data/repo.js';
import { createBus } from './ext/bus.js';
import { PluginHost } from './ext/loader.js';
import { ChatEngine } from './core/chat-engine.js';
import { openOverlay, closeAllOverlays, actionSheet } from './ui/overlay.js';
import { toast, toastError } from './ui/toast.js';
import { icon, logoMark } from './ui/icons.js';
import { h, clear } from './ui/dom.js';
import { sound } from './ui/sound.js';
import { DiceModal } from './ui/dice.js';
import { mount as mountHome } from './ui/home-view.js';
import { mount as mountCards } from './ui/card-library.js';
import { mount as mountWorld } from './ui/worldbook-view.js';
import { mount as mountChat } from './ui/chat-view.js';
import { mount as mountSettings } from './ui/settings-view.js';
import { mount as mountWorkshop } from './ui/workshop-view.js';
import { mount as mountGen } from './ui/gen-view.js';
import { openPublishFlow } from './ui/publish-view.js';
import { openGroupEditor } from './ui/group-view.js';

const APP_VERSION = '0.3.0';
const bootScreen = document.getElementById('boot-screen');
const bootFill = bootScreen?.querySelector('.boot-screen__fill');
const bootLabel = bootScreen?.querySelector('.boot-screen__label');
const viewRoot = document.getElementById('view-root');
const drawerRoot = document.getElementById('drawer-root');
const diceRoot = document.getElementById('dice-root');

const repo = new Repo();
const bus = createBus({
  onError: (err, context) => console.warn('[pt] bus error', context, err?.message),
});
const engine = new ChatEngine({ repo, bus });
let settings = null;
let loader = null;
let settingsView = null;
let diceModal = null;
let current = null;
let currentRoute = '';
let navToken = 0;
let theme = localStorage.getItem('pt:theme') || 'dark';
let deferredInstall = null;

applyTheme(theme, { persist: false });

function setBoot(pct, label) {
  if (bootFill) bootFill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  if (bootLabel && label) bootLabel.textContent = label;
}

function hideBoot() {
  if (!bootScreen) return;
  bootScreen.classList.add('is-leaving');
  setTimeout(() => bootScreen.remove(), 480);
}

function showBootError(err) {
  if (!bootScreen) return;
  bootScreen.classList.add('is-error');
  bootScreen.classList.remove('is-leaving');
  const label = bootScreen.querySelector('.boot-screen__label');
  if (label) label.textContent = `酒馆没点着：${err?.message || err}`;
  const bar = bootScreen.querySelector('.boot-screen__bar');
  if (bar) bar.hidden = true;
  if (!bootScreen.querySelector('.boot-screen__retry')) {
    const btn = h('button', { class: 'btn btn--primary boot-screen__retry', type: 'button', onclick: () => location.reload() }, '重新点火');
    bootScreen.querySelector('.boot-screen__inner')?.appendChild(btn);
  }
}

function applyTheme(next, { persist = true } = {}) {
  theme = next === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F7F0E4' : '#17110D');
  if (persist) localStorage.setItem('pt:theme', theme);
}

function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  if (name === 'chat' && rest[0]) return { name: 'chat', id: decodeURIComponent(rest[0]) };
  if (name === 'workshop') return { name: rest[0] === 'gen' ? 'workshop-gen' : 'workshop' };
  if (['cards', 'world'].includes(name)) return { name };
  return { name: 'home' };
}

function navigate(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

function unmountCurrent() {
  try {
    current?.unmount?.();
  } catch (err) {
    console.warn('[pt] unmount', err);
  }
  current = null;
  clear(viewRoot);
}

async function createChatFor(card) {
  const chat = await repo.createChat(card);
  navigate(`#/chat/${encodeURIComponent(chat.id)}`);
  return chat;
}

async function createRoom(data) {
  const cards = await repo.listCards();
  const host = cards.find((c) => c.id === data.memberIds[0]) || cards[0];
  if (!host) throw new Error('卡库还是空的');
  const chat = await repo.createChat(host, {
    ...data,
    kind: 'group',
    messages: [{
      id: `msg-${Date.now()}-room`,
      sender: 'char',
      text: `（酒馆的灯亮起来，${data.memberIds.length} 个人在桌边坐下。）\n\n${host.first_mes || '「人齐了，坐吧。」'}`,
      swipes: [],
      swipeIndex: 0,
      sendDate: new Date().toISOString(),
      tokenEstimate: 0,
      cardId: host.id,
      speaker: host.name,
    }],
  });
  toast(`房间「${chat.title || '深夜酒馆'}」开好了`, { type: 'success' });
  navigate(`#/chat/${encodeURIComponent(chat.id)}`);
  return chat;
}

async function openNewRoom() {
  await openGroupEditor({
    repo,
    settings,
    onSave: createRoom,
  });
}

async function openDemoChat() {
  const chats = await repo.listChats();
  const demo = chats.find((c) => c.demo) || chats[0];
  if (demo) {
    navigate(`#/chat/${encodeURIComponent(demo.id)}`);
    return;
  }
  const cards = await repo.listCards();
  if (cards[0]) await createChatFor(cards[0]);
  else navigate('#/cards');
}

async function renderRoute() {
  const token = ++navToken;
  const route = parseHash();
  const key = `${route.name}:${route.id || ''}`;
  if (key === currentRoute && current) return;
  unmountCurrent();
  currentRoute = key;
  viewRoot.scrollTop = 0;
  try {
    if (route.name === 'workshop') {
      current = mountWorkshop(viewRoot, {
        repo,
        settings,
        bus,
        onBack: () => navigate('#/home'),
        onOpenGen: () => navigate('#/workshop/gen'),
        onOpenPublish: openWorkshopPublish,
        onTrialPromoted: (chatId) => {
          toast('已转正，正式会话开门了', { type: 'success' });
          navigate(`#/chat/${encodeURIComponent(chatId)}`);
        },
      });
    } else if (route.name === 'workshop-gen') {
      current = mountGen(viewRoot, {
        repo,
        settings,
        bus,
        onBack: () => navigate('#/workshop'),
        onOpenWorkshop: () => navigate('#/workshop'),
        onPromoted: (chatId) => {
          toast('卡已入库，正式会话已创建', { type: 'success' });
          navigate(`#/chat/${encodeURIComponent(chatId)}`);
        },
        onPublished: (item) => {
          closeAllOverlays();
          bus.emit('workshop:changed', item);
          toast(`「${item?.title || '作品'}」已上架工坊，可试穿或直接导入`, { type: 'success', duration: 3200 });
          navigate('#/workshop');
        },
        onWorldSaved: (world) => toast(`世界书「${world.name}」已入库`, { type: 'success' }),
      });
    } else if (route.name === 'cards') {
      current = mountCards(viewRoot, {
        repo,
        settings,
        onBack: () => navigate('#/home'),
        onStartChat: async (card) => {
          try {
            await createChatFor(card);
          } catch (err) {
            toastError(err.message);
          }
        },
        onOpenSettings: openSettings,
        onGroupCreated: (chat) => {
          toast(`群聊「${chat.title}」已开桌`, { type: 'success' });
          navigate(`#/chat/${encodeURIComponent(chat.id)}`);
        },
      });
    } else if (route.name === 'world') {
      current = mountWorld(viewRoot, { repo, onBack: () => navigate('#/home') });
    } else if (route.name === 'chat') {
      try {
        const opened = await engine.open(route.id);
        if (token !== navToken) return;
        localStorage.setItem('pt:lastChat', opened.chat.id);
        current = mountChat(viewRoot, {
          repo,
          engine,
          bus,
          loader,
          sound,
          settings,
          onBack: () => navigate('#/home'),
          onOpenSettings: openSettings,
          onOpenCards: () => navigate('#/cards'),
          onOpenWorldbook: () => navigate('#/world'),
          onForked: (chat) => {
            if (chat?.id) navigate(`#/chat/${encodeURIComponent(chat.id)}`);
          },
          openDice: (expr, onResult) => diceModal?.open({ expr: expr || '1d20', auto: true, onResult }),
        });
      } catch (err) {
        if (token !== navToken) return;
        toastError(err.message || '找不到这个会话');
        navigate('#/home');
        return;
      }
    } else {
      current = mountHome(viewRoot, {
        repo,
        onOpenChat: (id) => navigate(`#/chat/${encodeURIComponent(id)}`),
        onNewChat: () => navigate('#/cards'),
        onNewRoom: openNewRoom,
        onOpenCards: () => navigate('#/cards'),
        onOpenWorkshop: () => navigate('#/workshop'),
        onOpenSettings: openSettings,
        onDeleted: () => {},
      });
    }
  } catch (err) {
    console.error('[pt] route', err);
    toastError(`页面没打开：${err.message}`);
    unmountCurrent();
    currentRoute = '';
  }
}

function openSettings() {
  closeAllOverlays();
  settingsView?.open();
}

async function openWorkshopPublish() {
  try {
    const [cards, worlds] = await Promise.all([repo.listCards(), repo.listWorlds()]);
    const items = [];
    cards.forEach((card) => items.push({
      key: `card:${card.id}`,
      label: `角色卡 · ${card.name}`,
      icon: 'cards',
      description: (card.description || '').slice(0, 44),
    }));
    worlds.forEach((world) => items.push({
      key: `world:${world.id}`,
      label: `世界书 · ${world.name}`,
      icon: 'book',
      description: `${(world.entries || []).length} 个条目`,
    }));
    if (!items.length) {
      toast('卡库和世界书都是空的，先用 AI 生成一件', { type: 'info' });
      navigate('#/workshop/gen');
      return;
    }
    const key = await actionSheet({ title: '发布哪件作品', subtitle: '发布前会要求你确认分级与内容', items });
    if (!key) return;
    const [kind, id] = key.split(':');
    if (kind === 'card') {
      const card = cards.find((row) => row.id === id);
      if (card) openPublishFlow({ type: 'card', card, settings, repo, onPublished: (item) => bus.emit('workshop:changed', item) });
    } else if (kind === 'world') {
      const world = worlds.find((row) => row.id === id);
      if (world) openPublishFlow({ type: 'world', world, settings, repo, onPublished: (item) => bus.emit('workshop:changed', item) });
    }
  } catch (err) {
    toastError(`打开发布失败：${err.message}`);
  }
}

// ---------------- 首次启动：18+ 与三步引导 ----------------
async function saveLocalSettings(patch) {
  settings = await repo.saveSettings(patch);
  engine.updateSettings(settings);
  return settings;
}

function showAgeGate() {
  const content = h(
    'div',
    { class: 'age-gate' },
    h('div', { class: 'age-gate__mark' }, logoMark(76)),
    h('p', { class: 'age-gate__text' }, '袖珍酒馆是给成年人的深夜小馆。这里可能出现成人向的角色扮演内容，默认关闭。'),
    h('p', { class: 'age-gate__fine' }, '所有聊天、角色卡与密钥只保存在这台设备上；没有遥测，也不会把内容发往你配置的后端之外的服务器。'),
  );
  const overlay = openOverlay({
    title: '18+ 内容提示',
    subtitle: '第一次进店，先确认一下',
    content,
    variant: 'center',
    dismissible: false,
    className: 'overlay__panel--age',
    actions: [],
  });
  const enter = h(
    'button',
    {
      class: 'btn btn--primary btn--block',
      type: 'button',
      onclick: async () => {
        await saveLocalSettings({ ageAck: true });
        overlay.close();
        setTimeout(maybeOnboarding, 240);
      },
    },
    '我已满 18 岁，进店',
  );
  const safe = h(
    'button',
    {
      class: 'btn btn--ghost btn--block',
      type: 'button',
      onclick: async () => {
        await saveLocalSettings({ ageAck: true, nsfw: false });
        overlay.close();
        setTimeout(maybeOnboarding, 240);
      },
    },
    '只看安全内容',
  );
  content.append(h('div', { class: 'age-gate__actions' }, enter, safe));
}

function maybeOnboarding() {
  if (!settings?.ageAck) {
    showAgeGate();
    return;
  }
  if (!settings?.onboardingDone) showOnboarding();
}

function showOnboarding() {
  let step = 0;
  const content = h('div', { class: 'onboard' });
  const overlay = openOverlay({
    title: '第一次来酒馆？',
    subtitle: '三步就座',
    content,
    variant: 'center',
    dismissible: false,
    className: 'overlay__panel--onboard',
    actions: [],
  });

  async function finish() {
    await saveLocalSettings({ onboardingDone: true });
    overlay.close();
  }

  function draw() {
    clear(content);
    const steps = [
      {
        eyebrow: 'STEP 1 · 带谁来',
        title: '角色卡先入座',
        copy: '支持 SillyTavern 的 PNG 角色卡（ccv2 / ccv3）和 .json。点开卡库，可以把喜欢的角色拖进来；也可以先用内置的琥珀。',
        action: '去卡库看看',
        onAction: async () => {
          await finish();
          navigate('#/cards');
        },
      },
      {
        eyebrow: 'STEP 2 · 连上酒',
        title: '给你的后端留个门',
        copy: 'OpenAI 兼容、Claude、Gemini、Kobold、Tabby 都行。端点和密钥只写在本机的 IndexedDB；没有密钥也可以先逛 UI、读内置卡。',
        action: '打开连接设置',
        onAction: async () => {
          await finish();
          openSettings();
        },
      },
      {
        eyebrow: 'STEP 3 · 开聊',
        title: '杯子碰在一起',
        copy: '长按消息可以编辑、分支、重生；双击收藏；输入 / 看指令。内置琥珀已经坐在吧台边了。',
        action: '和琥珀开聊',
        onAction: async () => {
          await finish();
          openDemoChat();
        },
      },
    ];
    const data = steps[step];
    content.append(
      h('div', { class: 'onboard__dots' }, ...steps.map((_, i) => h('span', { class: `onboard__dot ${i === step ? 'is-on' : ''}` }))),
      h('span', { class: 'eyebrow' }, data.eyebrow),
      h('h2', { class: 'onboard__title' }, data.title),
      h('p', { class: 'onboard__copy' }, data.copy),
      h(
        'div',
        { class: 'onboard__actions' },
        h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: data.onAction }, data.action),
        h(
          'div',
          { class: 'onboard__nav' },
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', disabled: step === 0, onclick: () => { step = Math.max(0, step - 1); draw(); } }, '上一步'),
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => { if (step < steps.length - 1) { step += 1; draw(); } else { finish(); } } }, step === steps.length - 1 ? '完成' : '下一步'),
        ),
      ),
      h('button', { class: 'onboard__skip', type: 'button', onclick: finish }, '先随便逛逛，跳过引导'),
    );
  }
  draw();
}

// ---------------- 安装提示 ----------------
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  setTimeout(() => {
    if (!deferredInstall) return;
    toast('可以把袖珍酒馆装到桌面', {
      action: '安装',
      duration: 6000,
      onAction: async () => {
        deferredInstall.prompt();
        await deferredInstall.userChoice?.catch?.(() => {});
        deferredInstall = null;
      },
    });
  }, 9000);
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  toast('装好了，主屏见', { type: 'success' });
});

// ---------------- 启动 ----------------
async function boot() {
  try {
    setBoot(8, '擦亮杯子…');
    settings = await repo.init().then((r) => r.settings);
    engine.updateSettings(settings);
    sound.update(settings.sound);
    setBoot(26, '摆好角色卡…');

    const bridge = {
      getChatSnapshot: () => engine.getSnapshot(),
      getCurrentCard: () => engine.card || {},
      getSettings: () => repo.sanitizedSettings(),
      ttsSpeak: (text, opts) => sound.speak(text, opts),
      toast: (msg) => toast(String(msg || '')),
    };
    loader = new PluginHost({ repo, bus, bridge });
    await loader.init().catch((err) => {
      console.warn('[pt] plugin host', err);
      toastError(`插件加载遇到问题：${err.message}`);
    });
    setBoot(52, '生火、温酒…');

    settingsView = mountSettings(drawerRoot, {
      repo,
      loader,
      bus,
      settings,
      theme,
      sound,
      onSettingsSaved: (next) => {
        settings = next;
        engine.updateSettings(next);
        sound.update(next.sound);
        bus.emit('settings:changed', next);
      },
      onThemeChange: (next) => applyTheme(next),
      onSoundChange: (nextSettings) => {
        settings = nextSettings;
        sound.update(nextSettings.sound);
      },
    });
    diceModal = new DiceModal().mount(diceRoot);
    setBoot(76, '把门打开…');

    window.addEventListener('hashchange', () => renderRoute());
    if (!location.hash || location.hash === '#') {
      location.replace('#/home');
    }
    await renderRoute();
    setBoot(100, '欢迎光临');
    setTimeout(hideBoot, 260);
    setTimeout(maybeOnboarding, 700);

    bus.emit('app:ready', { version: APP_VERSION, plugins: loader.list() });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[pt] sw', err.message));
    }
  } catch (err) {
    console.error('[pt] boot failed', err);
    showBootError(err);
  }
}

boot();
