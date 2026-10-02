const SEARCH_CACHE = 'ulsan-search-shell-v1';
const SEARCH_SHELL = [
  './search.html', './search.webmanifest', './search-app.js', './search-app.css',
  './kiosk.js', './kiosk.css', './images/symbol.png', './images/background.png',
  './images/ulsan_logo1.png', './images/ulsan_logo.png',
  './images/pwa/icon-192.png', './images/pwa/icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SEARCH_CACHE).then(cache => cache.addAll(SEARCH_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ulsan-search-') && key !== SEARCH_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Search data stays live: never persist deceased records in this app's shell cache.
  if (request.cache === 'no-store' || url.pathname.includes('/data/')) return;
  const shellUrl = new URL('./search.html', self.location.href);
  const assetPaths = SEARCH_SHELL.map(asset => new URL(asset, self.location.href).pathname);
  if (!assetPaths.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SEARCH_CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request.mode === 'navigate' ? shellUrl.href : request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request.mode === 'navigate' ? shellUrl.href : request);
      return cached || Response.error();
    }
  })());
});
