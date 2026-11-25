#!/usr/bin/env node
// 本地开发用：静态伺服 PocketTavern + OpenAI 兼容 mock 流式端点。
// 零依赖、零密钥。仅用于验收流式/重试/断线，不会访问外网。
//
//   node dev/mock-server.mjs            # http://127.0.0.1:8788
//   PORT=9000 node dev/mock-server.mjs
//
// 在设置 → 后端连接里填：
//   endpoint = http://127.0.0.1:8788
//   apiType  = openai
//   apiKey   = 任意非空（mock 不校验）
//   model    = amber-mock
//
// 温度越高，mock 的选择越跳；用于验收“temperature 1.5 输出发散”。

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../src/workshop/packer.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8788;
const HOST = process.env.HOST || '127.0.0.1';
const TEXT_DECODER = new TextDecoder();
const REMOTE_WORKSHOP = [];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function json(res, status, payload) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function messagesToPrompt(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => `${m.role || 'user'}: ${String(m.content ?? '')}`)
    .join('\n')
    .slice(-4000);
}

function lastUser(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') return String(list[i].content ?? '').trim();
  }
  return '';
}

function systemText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n');
}

function generationReply(messages, temperature) {
  const system = systemText(messages);
  const user = lastUser(messages);
  const seed = `${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;
  if (system.includes('[[PT_REGEN_FIELD]]')) {
    const field = (user.match(/字段[:：]\s*([a-z_]+)/i) || [])[1] || 'description';
    const hot = Number(temperature) > 1.05 ? '（温度有点高，这次写得野一点）' : '';
    const values = {
      name: `重生·${seed.slice(-4)}`,
      description: `这是重生后的描述。${hot}她身上还带着海风的盐味，记忆像被潮水泡过的纸。`,
      personality: `重生后的脾气：嘴硬、警惕，却会在别人递来热汤时沉默两秒。${hot}`,
      scenario: `重生后的场景：失忆的船长在雾港酒馆醒来，怀里只有半张被撕掉的海图。${hot}`,
      first_mes: `（她睁开眼，先摸了摸腰间的空刀鞘。）「……这是哪儿？我为什么记得一首没听过的船歌？」${hot}`,
      mes_example: `<START>\n{{user}}: 你还记得自己的名字吗？\n{{char}}: （她盯着杯底的倒影）「记得一个浪头，不记得浪头后面的人。」${hot}`,
    };
    if (field === 'tags') return JSON.stringify({ tags: [seed.slice(-3), '重生', '失忆'] });
    return JSON.stringify({ [field]: values[field] || values.description });
  }
  if (system.includes('[[PT_GEN_WORLD]]')) {
    const brief = user.replace(/^设定文本[：:]\s*/, '').replace(/\n+请拆成[\s\S]*$/, '').trim();
    const entries = Array.from({ length: 6 }, (_, index) => ({
      key: [`雾港关键词${index + 1}`, index === 0 ? '雾港' : `旧设定${index + 1}`],
      comment: `自动拆条 ${index + 1}`,
      content: `第 ${index + 1} 条设定：${brief.slice(0, 70) || '雾港'}。海雾、旧海关与潮汐页在这里交汇；这一条会在关键词命中时注入。`,
      position: 'before',
    }));
    return JSON.stringify({ name: '雾港拆条示例', entries });
  }
  if (system.includes('[[PT_GEN_CARD]]')) {
    const idea = user.replace(/^角色想法[:：]\s*/, '').replace(/\n请生成严格 JSON。?$/, '').slice(0, 100) || '无名的旅人';
    const named = idea.match(/(?:一个|一位|一名)?([^，。,\s]{2,14}?(?:船长|舰长|书商|侦探|旅人|女巫|佣兵))/);
    const name = named?.[1] || idea.slice(0, 12);
    return JSON.stringify({
      name,
      description: `${idea}。${name}在雾港的雨夜里醒来，身上只有一张被海水泡皱的船票。`,
      personality: '警惕、寡言，对海图和朗姆酒有本能的熟悉；不轻易相信人，但会记住每一份善意。',
      scenario: `雾港酒馆的灯快灭了，${name}推门进来，雨水顺着衣角滴在木地板上。`,
      first_mes: `（她停在门口，先看了一眼吧台后的退路，才慢慢走近。）\n\n「一杯最便宜的。……顺便，你见过这张船票吗？」`,
      mes_example: '<START>\n{{user}}: 你从哪条船下来的？\n{{char}}: （她捏着杯沿）「不记得船名。只记得桅杆断的时候，有人在喊我的名字。」',
      tags: ['雾港', '失忆', '船长', '悬疑'],
    });
  }
  return '';
}

function makeReply(messages, temperature) {
  const user = lastUser(messages) || '你好';
  const prompt = messagesToPrompt(messages);
  const hot = Number(temperature) > 1.2;
  const lines = hot
    ? [
        '（琥珀把抹布往肩上一搭，笑得有点晃眼）',
        '今夜的风把门吹得叮当响，你倒是准时。',
        '要不要先来一杯「随机应变」？配方看心情，度数看温度。',
        '你刚才那句「' + user.slice(0, 42) + '」——我听见了，酒保的耳朵可尖。',
        '（她推过来一只杯子，杯沿上还挂着一点泡沫）',
        '说吧，我们是从你的故事开始，还是从我的坏主意开始？',
      ]
    : [
        '（琥珀把杯子擦亮，放在你面前）',
        '欢迎回来。吧台边给你留了位置。',
        '你刚才说「' + user.slice(0, 48) + '」，我记下了。',
        '今晚的推荐是温热的蜂蜜酒，配一点不急着说完的故事。',
        '（她靠在吧台后，等你继续）',
        '想从哪里开始？',
      ];
  const picks = [];
  const count = 4 + Math.floor(Math.random() * (hot ? 5 : 2));
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * lines.length);
    if (!picks.includes(lines[idx])) picks.push(lines[idx]);
  }
  if (!hot && prompt.includes('【角色卡】')) {
    picks.splice(1, 0, '（她看了一眼你带来的角色卡，眼神亮了一下）');
  }
  if (prompt.includes('本轮发言者') && prompt.includes('琥珀')) {
    picks.push('（琥珀在桌边轻轻敲了敲杯子，像是在等一个接话的人。）');
  }
  return picks.join('\n\n') + '\n\n';
}

async function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolvePromise(raw));
    req.on('error', reject);
  });
}

async function readRawBody(req, limit = 6_000_000) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function packToWorkshopItem(bytes) {
  const files = readZip(new Uint8Array(bytes));
  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) throw new Error('缺少 manifest.json');
  const manifest = JSON.parse(TEXT_DECODER.decode(manifestRaw));
  const card = files.get('card.json') ? JSON.parse(TEXT_DECODER.decode(files.get('card.json'))) : null;
  const world = files.get('world.json') ? JSON.parse(TEXT_DECODER.decode(files.get('world.json'))) : null;
  return {
    id: manifest.id,
    type: manifest.type,
    title: manifest.title,
    author: manifest.author,
    tags: manifest.tags || [],
    version: manifest.version || '1.0.0',
    contentRating: manifest.contentRating === 'mature' ? 'mature' : 'general',
    description: manifest.description || '',
    changelog: manifest.changelog || '',
    rating: 0,
    downloads: 0,
    publishedAt: new Date().toISOString(),
    card,
    world,
  };
}

function workshopList(url) {
  const type = url.searchParams.get('type') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const sort = url.searchParams.get('sort') || 'new';
  let items = REMOTE_WORKSHOP.slice();
  if (type) items = items.filter((item) => item.type === type);
  if (q) {
    items = items.filter((item) =>
      [item.title, item.author, item.description, ...(item.tags || [])].join(' ').toLowerCase().includes(q),
    );
  }
  if (sort === 'hot') items.sort((a, b) => b.downloads - a.downloads);
  else if (sort === 'rating') items.sort((a, b) => b.rating - a.rating);
  else items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return items;
}

async function handleChat(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    json(res, 400, { error: { message: `bad json: ${err.message}` } });
    return;
  }
  const temperature = Number(body.temperature ?? 0.7);
  const dropAfter = Number(req.headers['x-pt-drop-after-ms'] || 0);
  const reply = generationReply(body.messages, temperature) || makeReply(body.messages, temperature);
  const tokens = Array.from(reply);
  const chunkSize = Math.max(1, Math.min(4, Math.ceil(tokens.length / 18)));
  const stream = body.stream !== false;

  if (!stream) {
    json(res, 200, {
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion',
      model: body.model || 'amber-mock',
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: tokens.length, total_tokens: tokens.length },
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const id = `chatcmpl-mock-${Date.now()}`;
  let index = 0;
  let closed = false;
  const started = Date.now();

  const finish = (reason = 'stop') => {
    if (closed) return;
    closed = true;
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      model: body.model || 'amber-mock',
      choices: [{ index: 0, delta: {}, finish_reason: reason }],
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  };

  req.on('close', () => {
    closed = true;
  });

  const tick = () => {
    if (closed) return;
    if (dropAfter && Date.now() - started > dropAfter) {
      // 模拟网络中断：不发送 finish，直接掐断，让客户端走续写/重连逻辑。
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    if (index >= tokens.length) {
      finish('stop');
      return;
    }
    const piece = tokens.slice(index, index + chunkSize).join('');
    index += chunkSize;
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      model: body.model || 'amber-mock',
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    })}\n\n`);
    setTimeout(tick, 24 + Math.floor(Math.random() * 26));
  };
  setTimeout(tick, 40);
}

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  } catch {
    res.writeHead(400).end('bad url');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const safe = normalize(pathname).replace(/^([/\\])+/, '');
  const file = join(ROOT, safe);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: `${pathname.replace(/\/$/, '')}/index.html` }).end();
      return;
    }
    const data = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 · 这里没有酒');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/list' && req.method === 'GET') {
    json(res, 200, { items: workshopList(url) });
    return;
  }
  if (url.pathname.startsWith('/api/item/') && req.method === 'GET') {
    const id = decodeURIComponent(url.pathname.slice('/api/item/'.length));
    const item = REMOTE_WORKSHOP.find((row) => row.id === id);
    if (!item) json(res, 404, { error: { message: '作品不存在' } });
    else json(res, 200, { item });
    return;
  }
  if (url.pathname === '/api/publish' && (req.method === 'POST' || req.method === 'OPTIONS')) {
    cors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    try {
      const item = packToWorkshopItem(await readRawBody(req));
      REMOTE_WORKSHOP.unshift(item);
      json(res, 200, { item });
    } catch (err) {
      json(res, 400, { error: { message: err.message } });
    }
    return;
  }
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    json(res, 200, {
      object: 'list',
      data: [
        { id: 'amber-mock', object: 'model', created: 0, owned_by: 'pockettavern-dev' },
        { id: 'amber-mock-wild', object: 'model', created: 0, owned_by: 'pockettavern-dev' },
      ],
    });
    return;
  }
  if (url.pathname === '/v1/chat/completions' && (req.method === 'POST' || req.method === 'OPTIONS')) {
    try {
      await handleChat(req, res);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: { message: err.message } });
    }
    return;
  }
  if (url.pathname.startsWith('/v1/')) {
    json(res, 404, { error: { message: `mock 未实现：${url.pathname}` } });
    return;
  }
  await serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`PocketTavern dev server → http://${HOST}:${PORT}`);
  console.log(`  endpoint: http://${HOST}:${PORT}  ·  model: amber-mock  ·  apiKey: dev-only`);
  console.log('  Ctrl+C 停止。所有数据只在本地进程内，不联网。');
});
