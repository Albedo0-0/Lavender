// storage.js — wraps localStorage (small/state data) and IndexedDB (photos/audio later).
// Later phases should always go through Storage.*, never touch localStorage/indexedDB directly.

const Storage = (function () {
  const PREFIX = 'cuteJournal_';

  function save(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage.save failed for key:', key, e);
      return false;
    }
  }

  function load(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Storage.load failed for key:', key, e);
      return null;
    }
  }

  function remove(key) {
    localStorage.removeItem(PREFIX + key);
  }

  // --- IndexedDB (not used yet — wired up now so Journal/Scrapbook phases
  // can store photos/audio without touching this file again) ---
  let dbPromise = null;

  function getDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('CuteJournalDB', 1);
        request.onupgradeneeded = function (e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('media')) {
            db.createObjectStore('media', { keyPath: 'id' });
          }
        };
        request.onsuccess = function (e) { resolve(e.target.result); };
        request.onerror = function (e) { reject(e.target.error); };
      });
    }
    return dbPromise;
  }

  return { save, load, remove, getDB };
})();

