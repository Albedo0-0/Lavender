// calendar-photos.js — custom photo for a Calendar date cell. Depends on: State, Storage.
// The image itself (original, untouched bytes) lives in the existing IndexedDB 'media' store.
// State.get().calendarPhotos holds only the light mapping dateStr -> media id.

const CalendarPhotos = (function () {
  const STORE = 'media';
  const ID_PREFIX = 'calphoto_';
  const urlCache = Object.create(null);
  const pending = Object.create(null);

  function map() {
    return State.get().calendarPhotos || {};
  }

  function has(dateStr) {
    return !!map()[dateStr];
  }

  function mediaId(dateStr) {
    return map()[dateStr] || null;
  }

  function idb(mode, fn) {
    return Storage.getDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function releaseUrl(dateStr) {
    const c = urlCache[dateStr];
    if (c) {
      try { URL.revokeObjectURL(c.url); } catch (e) {}
      delete urlCache[dateStr];
    }
  }

  function getUrl(dateStr) {
    const id = mediaId(dateStr);
    if (!id) return Promise.resolve(null);
    const cached = urlCache[dateStr];
    if (cached && cached.id === id) return Promise.resolve(cached.url);
    if (pending[dateStr] && pending[dateStr].id === id) return pending[dateStr].promise;

    const promise = idb('readonly', function (s) { return s.get(id); })
      .then(function (rec) {
        if (!rec || !rec.blob) return null;
        releaseUrl(dateStr);
        const url = URL.createObjectURL(rec.blob);
        urlCache[dateStr] = { id: id, url: url };
        return url;
      })
      .catch(function () { return null; })
      .then(function (url) {
        delete pending[dateStr];
        return url;
      });
    pending[dateStr] = { id: id, promise: promise };
    return promise;
  }

  function attach(dateStr, file) {
    if (!file || !/^image\//.test(file.type || '')) return Promise.resolve(false);
    const id = ID_PREFIX + dateStr;
    const record = { id: id, kind: 'calendar-photo', date: dateStr, name: file.name || '', type: file.type, blob: file };
    return idb('readwrite', function (s) { return s.put(record); }).then(function () {
      releaseUrl(dateStr);
      const next = Object.assign({}, map());
      next[dateStr] = id;
      return State.set({ calendarPhotos: next });
    });
  }

  function remove(dateStr) {
    const id = mediaId(dateStr);
    if (!id) return Promise.resolve(true);
    const next = Object.assign({}, map());
    delete next[dateStr];
    State.set({ calendarPhotos: next });
    releaseUrl(dateStr);
    return idb('readwrite', function (s) { return s.delete(id); })
      .then(function () { return true; })
      .catch(function () { return true; });
  }

  function paint(cell, url) {
    cell.style.backgroundImage = 'url("' + url + '")';
    cell.style.backgroundSize = 'cover';
    cell.style.backgroundPosition = 'center';
    cell.style.backgroundRepeat = 'no-repeat';
  }

  function clear(cell) {
    cell.classList.remove('cal-has-photo');
    cell.style.backgroundImage = '';
    cell.style.backgroundSize = '';
    cell.style.backgroundPosition = '';
    cell.style.backgroundRepeat = '';
  }

  // Calendar calls only this: it decides whether the cell has a photo and presents it.
  function apply(cell, dateStr) {
    if (!has(dateStr)) { clear(cell); return; }
    cell.classList.add('cal-has-photo');
    const cached = urlCache[dateStr];
    if (cached && cached.id === mediaId(dateStr)) { paint(cell, cached.url); return; }
    getUrl(dateStr).then(function (url) {
      if (url && has(dateStr)) paint(cell, url);
      else clear(cell);
    });
  }

  return { has: has, mediaId: mediaId, getUrl: getUrl, attach: attach, remove: remove, apply: apply };
})();
