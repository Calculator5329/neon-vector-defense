// A hub hosts multiple games on one origin. Keep this worker's requests and
// cache cleanup inside its own installation directory.
const ROOT = new URL('./', self.location.href).pathname;
const CACHE_PREFIX = `nvd-shell:${ROOT}:`;
const CACHE_VERSION = `${CACHE_PREFIX}v5`;
const APP_SHELL = ['', 'index.html', 'site.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png']
  .map((path) => `${ROOT}${path}`);

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
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT)) return;

  // Replay and privacy deep links keep their query when online, with a cached
  // game shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE_VERSION).then((cache) =>
        cache.match(`${ROOT}index.html`, { ignoreSearch: true }).then((cached) => cached || Response.error()),
      )),
    );
    return;
  }

  if (url.pathname.startsWith(`${ROOT}assets/`) || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) => cache.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          void cache.put(request, copy);
        }
        return response;
      }).catch(() => cache.match(request, { ignoreSearch: true }).then((cached) => cached || Response.error())))),
    );
  }
});
