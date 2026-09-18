// service-worker.js — cache-first for app shell, network-only for streams.
// Bump CACHE_VERSION whenever JS/CSS/HTML changes to force a clean update.
const CACHE_VERSION = 'lavender-v1';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  // JS modules — add any additional .js files your build uses
  './state.js',
  './storage.js',
  './nav.js',
  './modal.js',
  './library.js',
  './planner.js',
  './planner-data.js',
  './calendar.js',
  './journal.js',
  './study.js',
  './timeengine.js',
  './progress.js',
  './gamification.js',
  './gamification-data.js',
  './productivity-data.js',
  './alarm.js',
  './alarm-data.js',
  './water.js',
  './water-data.js',
  './sleep.js',
  './sleep-data.js',
  './notepad.js',
  './assistant.js',
  './tags.js',
  './settings.js',
  './backup.js',
  './streak.js',
  './targets.js',
  './targets-data.js',
  './datehub.js',
  './unrecorded.js',
  './player.js',
  './radio-data.js',
  './music-data.js',
  // Icons
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// URLs that must never be served from cache (live streams, YouTube, CDNs)
function isUncacheable(url) {
  const u = new URL(url);
  return (
    u.hostname.includes('youtube') ||
    u.hostname.includes('youtu.be') ||
    u.hostname.includes('googlevideo') ||
    u.hostname.includes('icecast') ||
    u.hostname.includes('shoutcast') ||
    u.protocol === 'chrome-extension:' ||
    // Generic: any non-same-origin fetch (radio stream hostnames vary)
    u.origin !== self.location.origin
  );
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // Cache what exists; ignore 404s for optional files (e.g. targets.js before Feature 5)
      return Promise.allSettled(
        APP_SHELL.map(function (url) { return cache.add(url); })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  // Never intercept non-GET or uncacheable (streams / cross-origin)
  if (e.request.method !== 'GET' || isUncacheable(e.request.url)) {
    return; // fall through to normal network
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      // Stale-while-revalidate: serve cache immediately, refresh in background
      var networkFetch = fetch(e.request).then(function (response) {
        if (response && response.status === 200 && response.type !== 'opaque') {
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(e.request, response.clone());
          });
        }
        return response;
      }).catch(function () { return null; });

      return cached || networkFetch;
    })
  );
});
