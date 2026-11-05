const CACHE = 'consentimiento-shell-v1';
const PAGE = new URL('./index.html', self.registration.scope).href;
const PDF = new URL('./vendor/jspdf.umd.min.js', self.registration.scope).href;
const MANIFEST = new URL('./manifest.webmanifest', self.registration.scope).href;
const FILES = [PAGE, PDF, MANIFEST];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES.map(url => new Request(url, {cache: 'reload'})));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith('consentimiento-shell-') && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.href.startsWith(self.registration.scope)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected) await cache.put(PAGE, response.clone());
        return response;
      } catch {
        return await cache.match(PAGE) || new Response('Conéctate una vez para preparar la versión sin conexión.', {
          status: 503,
          headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}
        });
      }
    })());
    return;
  }

  if (FILES.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(url.href);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.redirected) await cache.put(url.href, response.clone());
      return response;
    })());
  }
});
