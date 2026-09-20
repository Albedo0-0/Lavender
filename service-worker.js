// service-worker.js — cache-first for app shell, network-only for streams.
// Bump CACHE_VERSION whenever JS/CSS/HTML changes to force a clean update.
const CACHE_VERSION = 'lavender-v2';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './storage.js',
  './state.js',
  './notify.js',
  './sleep-data.js',
  './water-data.js',
  './alarm-data.js',
  './nav.js',
  './datehub.js',
  './streak.js',
  './planner-data.js',
  './tags-data.js',
  './targets-data.js',
  './timeengine.js',
  './journal-data.js',
  './modal.js',
  './tags.js',
  './targets.js',
  './sleep.js',
  './water.js',
  './alarm.js',
  './journal.js',
  './calendar.js',
  './planner.js',
  './library.js',
  './study-templates-data.js',
  './study-wallpaper.js',
  './study.js',
  './gamification-data.js',
  './productivity-data.js',
  './progress-data.js',
  './progress.js',
  './assistant-data.js',
  './assistant.js',
  './notepad.js',
  './radio-data.js',
  './music-data.js',
  './player.js',
  './unrecorded.js',
  './gamification.js',
  './backup.js',
  './backup-ui.js',
  './settings.js',
  './icon-192.png',
  './icon-512.png',
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
