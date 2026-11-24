/* 袖珍酒馆 Service Worker — 只缓存同源应用壳；绝不缓存 API 响应、密钥或聊天内容。 */
const VERSION = '0.2.9';
const CACHE = `pt-shell-v${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './src/styles/app.css',
  './src/core/api-client.js',
  './src/core/card-codec.js',
  './src/core/chat-engine.js',
  './src/core/dice-engine.js',
  './src/core/mount-resolver.js',
  './src/core/group-scheduler.js',
  './src/core/prompt-builder.js',
  './src/core/sampler.js',
  './src/core/sse-parser.js',
  './src/core/tokenizer-lite.js',
  './src/data/db.js',
  './src/data/content-hash.js',
  './src/data/repo.js',
  './src/data/seed.js',
  './src/ext/bus.js',
  './src/ext/loader.js',
  './src/ext/stlite.js',
  './src/workshop/ai-gen.js',
  './src/workshop/packer.js',
  './src/workshop/registry.js',
  './src/workshop/trial-sandbox.js',
  './src/ui/card-library.js',
  './src/ui/chat-view.js',
  './src/ui/dice.js',
  './src/ui/dom.js',
  './src/ui/home-view.js',
  './src/ui/icons.js',
  './src/ui/overlay.js',
  './src/ui/settings-view.js',
  './src/ui/sound.js',
  './src/ui/toast.js',
  './src/ui/worldbook-view.js',
  './src/ui/workshop-view.js',
  './src/ui/gen-view.js',
  './src/ui/group-view.js',
  './src/ui/publish-view.js',
  './plugins/index.json',
  './plugins/token-counter/manifest.json',
  './plugins/token-counter/plugin.js',
  './plugins/dice-log/manifest.json',
  './plugins/dice-log/plugin.js',
  './icons/logo.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

const SHELL_PATHS = new Set(SHELL.map((path) => new URL(path, self.location.href).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('pt-shell-') && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 后端 API、远程插件源一律走网络，不落缓存

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  // 只接管应用壳；后端 API、同源 /v1、远程源一律走网络，绝不落缓存。
  if (!SHELL_PATHS.has(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // 插件 entry 带 ?v=version 做版本区分，匹配时忽略 query，避免离线时误判未缓存。
      const cacheKey = new URL(request.url);
      cacheKey.search = '';
      const cached = await cache.match(cacheKey.toString(), { ignoreSearch: true });
      if (cached) {
        // 壳资源离线优先；后台静默更新，下次刷新生效。
        fetch(request)
          .then((res) => {
            if (res.ok) cache.put(cacheKey.toString(), res.clone()).catch(() => {});
          })
          .catch(() => {});
        return cached;
      }
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(cacheKey.toString(), fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return Response.error();
      }
    })(),
  );
});
