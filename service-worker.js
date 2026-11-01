// service-worker.js — versioned, cache-first app shell with automatic updates.
//
// UPDATE LIFECYCLE (native service-worker lifecycle; no page code or user action involved):
//   1. The browser re-fetches this file on every navigation (and when the app returns to the
//      foreground, see index.html). A byte-different file installs as a new worker.
//   2. install: the whole REQUIRED shell is downloaded (bypassing the HTTP cache) into a cache named
//      after CACHE_VERSION. It is all-or-nothing: if anything fails (offline, 404) install fails, the
//      new worker is discarded and the current worker + cache keep serving. A half-downloaded
//      version is never activated, and the browser simply retries on a later update check.
//   3. Only after a complete download does the worker call skipWaiting() and activate itself.
//   4. activate: deletes the old lavender-* caches, claims open windows and reloads them once, so
//      pages that were loaded by the previous version restart on the new one (first installs don't reload).
// Every request is answered from this version's own cache only (no background refreshing of
// individual files), so files from two different deployments can never be mixed.
//
// REQUIRED: bump CACHE_VERSION on every deploy that changes any file below (this file itself
// changing is what triggers the update; the new cache name is what keeps versions apart).
const CACHE_VERSION = 'lavender-vDay10';
const CACHE_PREFIX = 'lavender-';

// Everything index.html needs to start. If any of these cannot be fetched the update is not installed.
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
  './habit-data.js',
  './nav.js',
  './planning-agent-ui.js',
  './itinerary-time.js',
  './datehub.js',
  './streak.js',
  './tags-data.js',
  './timeengine.js',
  './journal-data.js',
  './modal.js',
  './tags.js',
  './sleep.js',
  './water.js',
  './habits.js',
  './general-alarm.js',
  './journal.js',
  './calendar-photos.js',
  './calendar.js',
  './calendar-day.js',
  './library.js',
  './study-templates-data.js',
  './study-wallpaper.js',
  './study.js',
  './dashboard.js',
  './dashboard-calendar.js',
  './gamification-data.js',
  './productivity-data.js',
  './progress-data.js',
  './ptpe-data.js',
  './progress.js',
  './ptpe-ui.js',
  './assistant-data.js',
  './assistant.js',
  './notepad.js',
  './gallery.js',
  './radio-data.js',
  './music-data.js',
  './player.js',
  './unrecorded.js',
  './gamification.js',
  './backup.js',
  './backup-ui.js',
  './entity-lvpack-data.js',
  './entity-lvpack-ui.js',
  './settings.js',
  './icon-192.png',
  './myworld.css',
  './gallery.css',
  './dashboard.css',
  './myworld-data.js',
  './myworld-assets.js',
  './myworld-content.js',
  './myworld-lv1.js',
  './myworld.js',
  './misc-core.js',
  './misc-cosmetics.js',
  './assistant-lvpacks-data.js',
  './misc-sound.js',
  './paper-pocket.js',
  './wish-butterfly.js',
  './firefly.js',
  './ladybug.js',
  './candle-lamp.js',
  './fullscreen.js',
];

// Best-effort extras that index.html does not load. A failure here never blocks an update.
const OPTIONAL = [
  './icon-512.png',
  './pressed-paper.js',
  './rain-ambience.js',
  './sunlight-ambience.js',
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

// Downloads straight from the network (cache: 'reload' skips the browser's HTTP cache, which could
// otherwise hand this install the previous deployment's copy of a file).
function precache(cache, url) {
  return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
    if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
    return cache.put(url, res);
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.has(CACHE_VERSION).then(function (existed) {
      return caches.open(CACHE_VERSION).then(function (cache) {
        return Promise.all(APP_SHELL.map(function (url) { return precache(cache, url); }))
          .then(function () {
            return Promise.allSettled(OPTIONAL.map(function (url) { return precache(cache, url); }));
          });
      }).catch(function (err) {
        // Failed install: discard the half-built cache (never one that already existed) and fail the
        // install, so this worker is thrown away and the current worker + cache keep serving.
        console.error('[Lavender SW] Update not installed; keeping the current version.', err);
        return (existed ? Promise.resolve() : caches.delete(CACHE_VERSION)).then(function () { throw err; });
      });
    }).then(function () {
      // Complete download only: take over without waiting for every tab to close.
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      const stale = keys.filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_VERSION; });
      return Promise.all(stale.map(function (k) { return caches.delete(k); })).then(function () { return stale.length > 0; });
        }).then(function () {
      return self.clients.claim();
    })
  );
});

// Sent by this worker to itself (see activate). Pages cannot trigger it.
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'RELOAD_CLIENTS' || e.source instanceof Client) return;
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function (wins) {
      return Promise.all(wins.map(function (w) { return w.navigate(w.url).catch(function () {}); }));
    })
  );
});

self.addEventListener('fetch', function (e) {
  // Never intercept non-GET or uncacheable (streams / cross-origin)
  if (e.request.method !== 'GET' || isUncacheable(e.request.url)) {
    return; // fall through to normal network
  }

  e.respondWith(
    // This version's cache only — never caches.match(), which also searches other versions' caches.
    caches.open(CACHE_VERSION).then(function (cache) {
            // Exact match first (all scripts); ignoreSearch only as a fallback so style.css?v=8 and launch URLs like /?source=pwa still hit the precached file.
      return cache.match(e.request).then(function (exact) {
        return exact || cache.match(e.request, { ignoreSearch: true });
      }).then(function (cached) {
        if (cached) return cached;
        return fetch(e.request).then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(e.request, response.clone()).catch(function () {});
          }
          return response;
        }).catch(function () {
          // Offline and not cached: a navigation still gets the app; anything else is a normal network error.
          return e.request.mode === 'navigate' ? cache.match('./index.html') : Response.error();
        });
      });
    })
  );
});
