const SHELL_CACHE = 'ulsan-status-shell-v1';
const RUNTIME_CACHE = 'ulsan-status-runtime-v1';

const SHELL_ASSETS = [
  './',
  './status.html',
  './manifest.webmanifest',
  './images/symbol.png',
  './images/pwa/icon-192.png',
  './images/pwa/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function shouldHandle(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!shouldHandle(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await caches.match(request);
        return cached || caches.match('./status.html');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const networkFetch = fetch(request)
      .then(async (response) => {
        if (response && response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cached);

    return cached || networkFetch;
  })());
});
