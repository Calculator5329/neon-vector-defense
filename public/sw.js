const CACHE_VERSION = 'nvd-shell-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // SPA navigations, including ?run= replay deep links: network-first, fall back to the cached
  // shell. ignoreSearch so a "/?run=..." URL still matches the cached "/" — and never resolve to
  // undefined (that surfaces as a "network error" and blanks the page), so end on Response.error().
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html', { ignoreSearch: true }).then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  // Hashed build assets + shell: cache-first, then network (and cache the result). A failed
  // network fetch must fall back to cache rather than reject uncaught (the old sw.js:38 crash).
  if (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request, { ignoreSearch: true }).then((c) => c || Response.error()))),
    );
  }
});
