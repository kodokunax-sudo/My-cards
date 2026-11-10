const CACHE_NAME = 'titan-assets-v1';
const SHELL_CACHE = 'titan-shell-v1';
const BASE_PATH = new URL('./', self.location.href).pathname;
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './src/boot.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('titan-') && ![CACHE_NAME, SHELL_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isLocalGameRequest(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith(BASE_PATH)) return false;
  return true;
}

function isCodeRequest(url) {
  return /\.(?:js|mjs|css|json|wasm)$/i.test(url.pathname);
}

async function saveResponse(cache, request, response) {
  if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
    try { await cache.put(request, response.clone()); } catch (error) {
      // A full browser cache must never block gameplay.
    }
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isLocalGameRequest(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        await saveResponse(cache, request, response);
        return response;
      } catch (error) {
        return (await caches.match(request)) ||
          (await caches.match(new URL('./index.html', self.location.href).href)) ||
          Response.error();
      }
    })());
    return;
  }

  // Code is checked against the network so deployed fixes appear immediately.
  // If offline, the last downloaded version remains usable.
  if (isCodeRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        await saveResponse(cache, request, response);
        return response;
      } catch (error) {
        return (await cache.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Images, audio and model/texture data use cache-first loading. Each file is
  // stored after its first successful download and reused on future visits.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          await saveResponse(cache, request, fresh);
        } catch (error) { /* use the cached asset */ }
      })());
      return cached;
    }
    try {
      const response = await fetch(request);
      await saveResponse(cache, request, response);
      return response;
    } catch (error) {
      return Response.error();
    }
  })());
});
