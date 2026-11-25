// seed — 内置演示：角色卡「琥珀」+ 示例世界书「酒馆」。无后端时也能完整预览 UI。

import { SAMPLER_DEFAULTS } from '../core/sampler.js';

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4A3020"/><stop offset="1" stop-color="#24170F"/></linearGradient>
<linearGradient id="hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E5A24B"/><stop offset="1" stop-color="#A8621F"/></linearGradient>
<linearGradient id="dress" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5C3A22"/><stop offset="1" stop-color="#33200F"/></linearGradient>
<radialGradient id="light" cx="50%" cy="32%" r="62%"><stop offset="0" stop-color="#FFDCA8" stop-opacity=".3"/><stop offset="1" stop-color="#FFDCA8" stop-opacity="0"/></radialGradient>
</defs>
<rect width="160" height="160" fill="url(#bg)"/>
<rect width="160" height="160" fill="url(#light)"/>
<circle cx="132" cy="26" r="26" fill="#E8A33D" opacity=".08"/>
<circle cx="26" cy="120" r="34" fill="#E8A33D" opacity=".06"/>
<path d="M28 158 C30 122 52 108 80 108 C108 108 130 122 132 158 Z" fill="url(#dress)"/>
<path d="M66 104 h28 v18 c0 10 -28 10 -28 0 Z" fill="#EBC6A2"/>
<path d="M40 62 C40 30 60 14 80 14 C100 14 120 30 120 62 C120 98 104 118 80 118 C56 118 40 98 40 62 Z" fill="url(#hair)"/>
<path d="M46 60 C48 38 62 24 80 24 C98 24 112 38 114 60 C114 74 108 84 100 88 L100 62 C92 56 68 56 60 62 L60 88 C52 84 46 74 46 60 Z" fill="#F0B968"/>
<ellipse cx="80" cy="76" rx="32" ry="36" fill="#F3D3B3"/>
<path d="M48 66 C50 40 64 30 80 30 C96 30 110 40 112 66 C104 60 98 54 94 46 C84 56 70 60 56 58 C54 62 51 64 48 66 Z" fill="url(#hair)"/>
<path d="M48 62 C44 76 46 92 54 102 L58 76 Z" fill="#C9822A"/>
<path d="M112 62 C116 76 114 92 106 102 L102 76 Z" fill="#C9822A"/>
<ellipse cx="66" cy="78" rx="6.4" ry="7.4" fill="#FFF6E9"/>
<ellipse cx="94" cy="78" rx="6.4" ry="7.4" fill="#FFF6E9"/>
<circle cx="67" cy="79" r="4.2" fill="#8D4E17"/>
<circle cx="95" cy="79" r="4.2" fill="#8D4E17"/>
<circle cx="68.4" cy="77.4" r="1.5" fill="#FFFDF5"/>
<circle cx="96.4" cy="77.4" r="1.5" fill="#FFFDF5"/>
<path d="M58 68 C62 64 70 64 74 68" stroke="#6E3F1B" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<path d="M86 68 C90 64 98 64 102 68" stroke="#6E3F1B" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<path d="M79 82 C81 86 79 89 76 89" stroke="#D5A17A" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M70 96 C76 101 84 101 90 96" stroke="#A9503B" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<ellipse cx="62" cy="90" rx="7" ry="4" fill="#E8A18C" opacity=".28"/>
<ellipse cx="98" cy="90" rx="7" ry="4" fill="#E8A18C" opacity=".28"/>
<circle cx="46" cy="93" r="3" fill="#E8A33D"/>
<circle cx="114" cy="93" r="3" fill="#E8A33D"/>
<path d="M70 108 L80 116 L90 108 L90 118 L80 124 L70 118 Z" fill="#C9822A"/>
<circle cx="80" cy="118" r="2.4" fill="#7B3F16"/>
</svg>`;

export function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, ' ').trim())}`;
}

export const DEMO_AVATAR = svgToDataUrl(AVATAR_SVG);

export const DEMO_CARD = {
  id: 'card-amber',
  name: '琥珀',
  description:
    '袖珍酒馆的老板娘。琥珀色长发松松挽起，围裙上永远沾着一点麦芽糖。她记得每位常客的名字、酒量和没说完的故事。调酒时话不多，收拾杯子时却总能一针见血。',
  personality:
    '温柔而清醒，擅长倾听，不轻易评判。对熟客会调侃，对陌生人保持礼貌的距离。讨厌浪费酒，也讨厌有人欺负店里的客人。喝醉时会哼走调的旧歌。',
  scenario:
    '深夜的城市边缘，一间只有一扇木门的小酒馆。壁炉常燃，酒架上摆满客人寄存的酒瓶。今晚下着细雨，你是推门进来的客人。',
  first_mes:
    '（她正背对着门擦拭一只高脚杯。听到门铃，琥珀转过身，琥珀色的眼睛在暖灯下亮了一下。）\n\n「欢迎光临袖珍酒馆。雨夜赶路，先坐下暖暖吧。」\n\n（她把一只厚底杯推到你面前，杯壁还带着温度，里面是冒着热气的蜂蜜酒。）\n\n「第一杯算店里的。想喝点什么，还是……想先讲个故事？」',
  mes_example:
    '<START>\n{{user}}: 老板娘，你这儿收故事吗？\n{{char}}: （琥珀把抹布搭在肩上，双手撑着吧台看你）「收啊。好故事换一杯酒，坏故事换一杯更烈的。」（她眨眨眼）「不过得看是谁讲。你看起来像是带着故事来的。」\n<START>\n{{user}}: 今天不太想说话。\n{{char}}: （她没追问，只是把酒推近一点，顺手调暗了桌边的灯）「那就先不说的。酒在这儿，我在这儿。等你想说了，我耳朵空着。」',
  creator: 'PocketTavern 内置示例',
  tags: ['酒馆', '老板娘', '治愈', '原创'],
  avatar: DEMO_AVATAR,
  spec: 'chara_card_v3',
  character_book_id: 'world-amber',
  character_book: {
    name: '琥珀的酒馆',
    description: '琥珀自己那本内嵌书：只在她出场时激活。',
    entries: [
      {
        uid: 1,
        key: ['酒馆', '酒馆老板娘', 'tavern'],
        keysecondary: [],
        comment: '酒馆环境',
        content:
          '【袖珍酒馆】一间只在夜里开门的小店：木墙、暖黄吊灯、噼啪作响的壁炉，酒架最高处摆着一瓶从不打开的老酒。窗外是细雨和城市边缘的窄巷。后院有一棵老槐树，树下长椅正对着月亮。老板娘琥珀会记住每位客人的名字与故事，但从不替客人做决定。',
        position: 'before',
        order: 10,
        tokenBudget: 0,
        recursive: true,
        selective: false,
        constant: false,
        probability: 100,
        caseSensitive: false,
        useRegex: false,
      },
    ],
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  builtin: true,
};

export const DEMO_WORLD = {
  id: 'world-amber',
  name: '琥珀的酒馆',
  enabled: true,
  scope: 'embedded',
  embeddedFor: ['card-amber'],
  linkedCards: [],
  entries: [
    {
      uid: 1,
      key: ['酒馆', '酒馆老板娘', 'tavern'],
      keysecondary: [],
      comment: '酒馆环境',
      content:
        '【袖珍酒馆】一间只在夜里开门的小店：木墙、暖黄吊灯、噼啪作响的壁炉，酒架最高处摆着一瓶从不打开的老酒。窗外是细雨和城市边缘的窄巷。后院有一棵老槐树，树下长椅正对着月亮。老板娘琥珀会记住每位客人的名字与故事，但从不替客人做决定。',
      position: 'before',
      order: 10,
      tokenBudget: 0,
      recursive: true,
      selective: false,
      constant: false,
      probability: 100,
      caseSensitive: false,
      useRegex: false,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export function defaultSettings() {
  return {
    key: 'app',
    version: 1,
    theme: 'dark', // 仅作为首选项兜底，实际 UI 态在 localStorage
    nsfw: false,
    ageAck: false,
    onboardingDone: false,
    personaName: '旅人',
    personaId: 'persona-traveler',
    connection: {
      endpoint: '',
      apiType: 'openai',
      apiKey: '',
      model: '',
      extraHeaders: '',
    },
    sampler: { ...SAMPLER_DEFAULTS },
    prompt: {
      system:
        '文风要求：中文，克制而有画面感；用动作、神态和环境细节代替解释。不要复述用户刚说过的话，不要替用户行动。保持角色的秘密与边界。',
      userName: '旅人',
    },
    sound: {
      enabled: true,
      volume: 0.55,
      tts: false,
      ttsRate: 1.0,
      charPitch: 1.1,
      userPitch: 1.0,
    },
    plugins: {
      enabled: ['token-counter', 'dice-log', 'story-state'],
      marketUrl: '',
    },
    quickReplies: [
      { id: 'qr-1', label: '来一杯', text: '老板，来一杯今天推荐的酒。' },
      { id: 'qr-2', label: '讲个故事', text: '给我讲一个发生在酒馆里的故事吧。' },
      { id: 'qr-3', label: '看看四周', text: '（我环顾酒馆四周，打量着这里。）' },
    ],
    ui: {
      cardView: 'grid',
    },
    // 世界与挂载：默认“一个世界一本书”，多世界是高级选项
    world: {
      globalEnabled: false, // 全局挂载默认关闭
      globalIds: [],
      maxBooks: 1, // 显式开启高级选项后可调大
    },
    group: {
      mode: 'natural_order',
      defaultTalkativeness: 0.5,
      allowSelfResponses: false,
    },
    workshop: {
      remoteEnabled: true,
      remoteUrl: '',
      demoSource: true,
      genModel: '',
      genTemperature: 0.9,
      genLanguage: 'auto',
    },
    updatedAt: new Date().toISOString(),
  };
}

export function demoChat() {
  const first = {
    id: 'msg-welcome',
    sender: 'char',
    text: DEMO_CARD.first_mes,
    swipes: [DEMO_CARD.first_mes],
    swipeIndex: 0,
    sendDate: '2026-01-01T00:00:00.000Z',
    tokenEstimate: 0,
    starred: false,
  };
  return {
    id: 'chat-demo',
    cardId: DEMO_CARD.id,
    title: '与琥珀的雨夜',
    worldIds: ['world-amber'],
    messages: [first],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    branchOf: null,
    starred: false,
    demo: true,
  };
}

export const DEMO_PERSONA = {
  id: 'persona-traveler',
  name: '旅人',
  description: '一个在雨夜推门而入的旅人，话不多，习惯把故事留在杯底。',
  createdAt: '2026-01-01T00:00:00.000Z',
};
