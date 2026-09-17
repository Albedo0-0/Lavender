// service-worker.js — minimal PWA support only. Network-first, no cache-first
// behavior, so files are never served stale. Exists solely to satisfy PWA
// installability requirements (a fetch handler + a manifest).
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  e.respondWith(
    fetch(e.request).catch(function () {
      return caches.match(e.request);
    })
  );
});

