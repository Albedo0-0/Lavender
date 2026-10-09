// gallery.js — Lavender Gallery: a standalone personal photo library, opened from the Utility Drawer.
// Owns its own photo / folder / tag data in IndexedDB ('lavender.gallery'). Tags are plain strings on
// the photo record (no second tag registry). Independent of Calendar photos, Scrapbook and State.
// UI is hosted in the shared Modal; the fullscreen viewer is its own layer above it.
// Backup integration (called by backup.js): exportBackup(), mergeBackup(raw), clearAll().
const Gallery = (function () {
  const DB_NAME = 'lavender.gallery';
  const DB_VERSION = 1;
  const MAX_SIDE = 2400;   // stored photo: longest side
  const THUMB_SIDE = 360;  // grid thumbnail: longest side
  const ALL = 'all';
  const UNFILED = 'unfiled';
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  const ICON_STAR = '<svg class="gal-ico" viewBox="0 0 9 9" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 0h1v2H4zM3 2h3v1H3zM0 3h9v1H0zM1 4h7v1H1zM2 5h5v1H2zM2 6h2v1H2zM5 6h2v1H5zM1 7h2v1H1zM6 7h2v1H6z"/></svg>';
  const ICON_FOLDER = '<svg class="gal-ico" viewBox="0 0 12 10" width="13" height="11" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M0 0h5v1h7v9H0z"/></svg>';
  const ICON_FRAME = '<svg viewBox="0 0 16 14" width="32" height="28" shape-rendering="crispEdges" aria-hidden="true"><path fill="#a9865a" d="M0 0h16v14H0z"/><path fill="#fffdf8" d="M2 2h12v10H2z"/><path fill="#c3c9ac" d="M3 3h10v8H3z"/><path fill="#8a9468" d="M3 9h3v-1h1V7h2v1h1v1h1V8h2v3H3z"/><path fill="#fffdf8" d="M10 4h2v2h-2z"/></svg>';

  let db = null;
  let loaded = false;
  let loadFailed = false;
  let loadPromise = null;
  let photos = {};   // id -> photo record (the single canonical store, mirrored in IndexedDB)
  let folders = {};  // id -> folder record

  const view = { folder: ALL, q: '', fav: false, tag: '', select: false };
  let selected = {};
  let root = null;
  let statusTimer = null;
  let viewer = null;
  let keyBound = false;

  // ------------------------------------------------------------------ helpers

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function normTag(t) {
    return String(t).replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30);
  }
  function normTags(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (t) {
      const n = normTag(t);
      if (n && out.indexOf(n) === -1 && out.length < 20) out.push(n);
    });
    return out;
  }
  function parseTags(text) { return normTags(String(text).split(/[,\n]/)); }

  function cleanFolder(raw) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (!name) return null;
    return { id: raw.id, name: name, createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now() };
  }
  function cleanPhoto(raw) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
    if (typeof raw.src !== 'string' || raw.src.indexOf('data:image/') !== 0) return null;
    return {
      id: raw.id,
      name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled').slice(0, 200),
      folderId: typeof raw.folderId === 'string' && ID_RE.test(raw.folderId) ? raw.folderId : null,
      tags: normTags(raw.tags),
      favorite: raw.favorite === true,
      addedAt: Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
      width: Number.isFinite(raw.width) ? raw.width : 0,
      height: Number.isFinite(raw.height) ? raw.height : 0,
      src: raw.src,
      thumb: typeof raw.thumb === 'string' && raw.thumb.indexOf('data:image/') === 0 ? raw.thumb : raw.src
    };
  }

  function allPhotos() {
    return Object.keys(photos).map(function (id) { return photos[id]; }).sort(function (a, b) {
      return (b.addedAt - a.addedAt) || (a.id < b.id ? 1 : -1);
    });
  }
  function allFolders() {
    return Object.keys(folders).map(function (id) { return folders[id]; }).sort(function (a, b) {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  }
  function folderOf(p) { return p.folderId && folders[p.folderId] ? folders[p.folderId] : null; }
  function folderNameTaken(name, exceptId) {
    const n = name.toLowerCase();
    return allFolders().some(function (f) { return f.id !== exceptId && f.name.toLowerCase() === n; });
  }

  function filtersActive() { return !!(view.q.trim() || view.fav || view.tag); }

  function visiblePhotos() {
    const words = view.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return allPhotos().filter(function (p) {
      const f = folderOf(p);
      if (view.folder === UNFILED && f) return false;
      if (view.folder !== ALL && view.folder !== UNFILED && (!f || f.id !== view.folder)) return false;
      if (view.fav && !p.favorite) return false;
      if (view.tag && p.tags.indexOf(view.tag) === -1) return false;
      if (words.length) {
        const hay = (p.name + ' ' + (f ? f.name : 'unfiled') + ' ' + p.tags.join(' ')).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ storage (IndexedDB)

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const d = req.result;
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function readAll(store) {
    return new Promise(function (resolve, reject) {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }
  // ops: [{ store, put } | { store, del } | { store, clear: true }] — one transaction, all or nothing.
  function write(ops) {
    return new Promise(function (resolve, reject) {
      if (!db) { reject(new Error('Gallery storage unavailable')); return; }
      if (!ops.length) { resolve(); return; }
      const names = [];
      ops.forEach(function (o) { if (names.indexOf(o.store) === -1) names.push(o.store); });
      const tx = db.transaction(names, 'readwrite');
      ops.forEach(function (o) {
        const s = tx.objectStore(o.store);
        if (o.clear) s.clear(); else if (o.del) s.delete(o.del); else s.put(o.put);
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Write failed')); };
    });
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = openDb().then(function (d) {
      db = d;
      return Promise.all([readAll('folders'), readAll('photos')]);
    }).then(function (res) {
      folders = {}; photos = {};
      res[0].forEach(function (raw) { const f = cleanFolder(raw); if (f) folders[f.id] = f; });
      res[1].forEach(function (raw) {
        const p = cleanPhoto(raw);
        if (!p) return;
        if (p.folderId && !folders[p.folderId]) p.folderId = null; // orphaned → Unfiled
        photos[p.id] = p;
      });
      loaded = true;
    }).catch(function () { loadFailed = true; });
    return loadPromise;
  }

  // Persist changed/removed photos first, then mirror into memory — memory never gets ahead of disk.
  function commit(changed, removedIds) {
    const ops = changed.map(function (p) { return { store: 'photos', put: p }; })
      .concat((removedIds || []).map(function (id) { return { store: 'photos', del: id }; }));
    return write(ops).then(function () {
      changed.forEach(function (p) { photos[p.id] = p; });
      (removedIds || []).forEach(function (id) { delete photos[id]; delete selected[id]; });
      afterChange();
      return true;
    }).catch(function () {
      setStatus("Couldn't save that change — storage may be full.");
      return false;
    });
  }

  // ------------------------------------------------------------------ operations

  function setFavorite(ids, value) {
    const changed = ids.map(function (id) { return photos[id]; }).filter(function (p) { return p && p.favorite !== value; })
      .map(function (p) { return Object.assign({}, p, { favorite: value }); });
    return commit(changed, []);
  }
  function movePhotos(ids, folderId) {
    const changed = ids.map(function (id) { return photos[id]; }).filter(function (p) { return p && p.folderId !== folderId; })
      .map(function (p) { return Object.assign({}, p, { folderId: folderId }); });
    return commit(changed, []).then(function (ok) {
      if (ok && changed.length) setStatus('Moved ' + plural(changed.length, 'photo') + ' to ' + (folderId ? folders[folderId].name : 'Unfiled') + '.');
      return ok;
    });
  }
  function tagPhotos(ids, tags, mode) {
    const changed = ids.map(function (id) { return photos[id]; }).filter(Boolean).map(function (p) {
      return Object.assign({}, p, { tags: mode === 'add' ? normTags(p.tags.concat(tags)) : normTags(tags) });
    });
    return commit(changed, []);
  }
  function deletePhotos(ids) {
    const existing = ids.filter(function (id) { return photos[id]; });
    return commit([], existing).then(function (ok) {
      if (ok && existing.length) setStatus('Deleted ' + plural(existing.length, 'photo') + '.');
      return ok;
    });
  }

  function createFolder(rawName) {
    const name = String(rawName).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return Promise.resolve({ error: 'Give the folder a name.' });
    if (folderNameTaken(name)) return Promise.resolve({ error: 'A folder with that name already exists.' });
    const rec = { id: newId('f'), name: name, createdAt: Date.now() };
    return write([{ store: 'folders', put: rec }]).then(function () {
      folders[rec.id] = rec; afterChange();
      return { folder: rec };
    }).catch(function () { return { error: "Couldn't save the folder." }; });
  }
  function renameFolder(id, rawName) {
    const name = String(rawName).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!folders[id]) return Promise.resolve({ error: 'That folder no longer exists.' });
    if (!name) return Promise.resolve({ error: 'Give the folder a name.' });
    if (folderNameTaken(name, id)) return Promise.resolve({ error: 'A folder with that name already exists.' });
    const rec = Object.assign({}, folders[id], { name: name });
    return write([{ store: 'folders', put: rec }]).then(function () {
      folders[id] = rec; afterChange();
      return { folder: rec };
    }).catch(function () { return { error: "Couldn't save the folder." }; });
  }
  // Safe delete: photos are kept (moved to Unfiled) unless the user explicitly also deletes them.
  function deleteFolder(id, alsoDeletePhotos) {
    if (!folders[id]) return Promise.resolve(true);
    const inside = allPhotos().filter(function (p) { return p.folderId === id; });
    const ops = [{ store: 'folders', del: id }];
    inside.forEach(function (p) {
      ops.push(alsoDeletePhotos ? { store: 'photos', del: p.id } : { store: 'photos', put: Object.assign({}, p, { folderId: null }) });
    });
    return write(ops).then(function () {
      delete folders[id];
      inside.forEach(function (p) {
        if (alsoDeletePhotos) { delete photos[p.id]; delete selected[p.id]; }
        else photos[p.id] = Object.assign({}, p, { folderId: null });
      });
      if (view.folder === id) view.folder = ALL;
      afterChange();
      return true;
    }).catch(function () { setStatus("Couldn't delete that folder."); return false; });
  }

  // ------------------------------------------------------------------ import

  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }
  function drawScaled(img, w, h, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return { url: c.toDataURL('image/jpeg', quality), width: cw, height: ch };
  }
  function processFile(file) {
    return new Promise(function (resolve, reject) {
      const objUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const w = img.naturalWidth, h = img.naturalHeight;
        try {
          if (!w || !h) throw new Error('Unreadable image');
          const thumb = drawScaled(img, w, h, THUMB_SIDE, 0.8).url;
          // Small JPEGs and GIFs are kept byte-for-byte; everything else is normalised to a bounded JPEG.
          const keep = file.type === 'image/gif' || (file.type === 'image/jpeg' && Math.max(w, h) <= MAX_SIDE);
          if (keep) {
            readDataUrl(file).then(function (src) {
              URL.revokeObjectURL(objUrl);
              resolve({ src: src, thumb: thumb, width: w, height: h });
            }, function (e) { URL.revokeObjectURL(objUrl); reject(e); });
          } else {
            const full = drawScaled(img, w, h, MAX_SIDE, 0.9);
            URL.revokeObjectURL(objUrl);
            resolve({ src: full.url, thumb: thumb, width: full.width, height: full.height });
          }
        } catch (e) { URL.revokeObjectURL(objUrl); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(objUrl); reject(new Error('Unreadable image')); };
      img.src = objUrl;
    });
  }

  function importFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) { setStatus('No image files found.'); return Promise.resolve(); }
    if (!loaded) { setStatus('Gallery storage is not available.'); return Promise.resolve(); }
    const folderId = folders[view.folder] ? view.folder : null;
    const base = Date.now();
    let i = 0, ok = 0, failed = 0;
    function next() {
      if (i >= files.length) return Promise.resolve();
      const idx = i++;
      const f = files[idx];
      setStatus('Adding ' + (idx + 1) + ' of ' + files.length + '…', true);
      return processFile(f).then(function (d) {
        const rec = {
          id: newId('p'), name: f.name || 'Untitled', folderId: folderId, tags: [], favorite: false,
          addedAt: base + (files.length - idx), width: d.width, height: d.height, src: d.src, thumb: d.thumb
        };
        return write([{ store: 'photos', put: rec }]).then(function () { photos[rec.id] = rec; ok++; afterChange(); });
      }).catch(function () { failed++; }).then(next);
    }
    return next().then(function () {
      setStatus((ok ? 'Added ' + plural(ok, 'photo') + '.' : 'No photos were added.') +
        (failed ? ' ' + failed + ' could not be read or saved.' : ''));
    });
  }

  // ------------------------------------------------------------------ gallery UI

  function isOpen() {
    const ov = document.getElementById('modal-overlay');
    return !!(root && root.isConnected && ov && ov.style.display !== 'none');
  }
  function $(sel) { return root ? root.querySelector(sel) : null; }

  function setStatus(msg, sticky) {
    if (!isOpen()) return;
    const el = $('.gal-status');
    if (!el) return;
    el.textContent = msg;
    if (statusTimer) { window.clearTimeout(statusTimer); statusTimer = null; }
    if (!sticky) statusTimer = window.setTimeout(function () { el.textContent = ''; }, 4500);
  }

  function shellHtml() {
    return '<div class="gal" id="gallery-root">' +
      '<div class="gal-head"><h3 class="modal-title">Gallery <span class="modal-title-accent gal-total"></span></h3>' +
      '<button type="button" class="modal-close-btn" data-act="close" aria-label="Close gallery">&times;</button></div>' +
      '<div class="gal-bar">' +
        '<input type="search" class="input gal-search" placeholder="Search name, folder or tag" aria-label="Search photos" autocomplete="off">' +
        '<button type="button" class="btn btn-secondary gal-fav-toggle" data-act="toggle-fav" aria-pressed="false">' + ICON_STAR + ' Favorites</button>' +
        '<button type="button" class="btn btn-secondary gal-select-toggle" data-act="toggle-select" aria-pressed="false">Select</button>' +
        '<button type="button" class="btn btn-primary gal-add" data-act="add">Add photos</button>' +
        '<input type="file" class="gal-file" accept="image/*" multiple hidden>' +
      '</div>' +
      '<div class="gal-status" aria-live="polite"></div>' +
      '<div class="gal-main">' +
        '<nav class="gal-side" aria-label="Folders"></nav>' +
        '<section class="gal-content">' +
          '<div class="gal-sub"></div>' +
          '<div class="gal-selbar" hidden></div>' +
          '<div class="gal-grid-wrap"></div>' +
        '</section>' +
      '</div></div>';
  }

  function bindRoot() {
    root.addEventListener('click', onRootClick);
    let t = null;
    root.querySelector('.gal-search').addEventListener('input', function (e) {
      view.q = e.target.value;
      if (t) window.clearTimeout(t);
      t = window.setTimeout(function () { refresh(true); }, 120);
    });
    root.querySelector('.gal-file').addEventListener('change', function (e) {
      const files = e.target.files;
      importFiles(files).then(function () { e.target.value = ''; });
    });
    const content = root.querySelector('.gal-content');
    content.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) {
        e.preventDefault(); content.classList.add('is-dropping');
      }
    });
    content.addEventListener('dragleave', function (e) {
      if (!content.contains(e.relatedTarget)) content.classList.remove('is-dropping');
    });
    content.addEventListener('drop', function (e) {
      content.classList.remove('is-dropping');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault(); importFiles(e.dataTransfer.files);
      }
    });
  }

  function selectedIds() { return Object.keys(selected).filter(function (id) { return photos[id]; }); }

  function onRootClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const act = t.dataset.act, id = t.dataset.id;
    switch (act) {
      case 'close': Modal.close(); break;
      case 'add': if (loaded) $('.gal-file').click(); break;
      case 'toggle-fav': view.fav = !view.fav; refresh(true); break;
      case 'toggle-select': view.select = !view.select; if (!view.select) selected = {}; refresh(); break;
      case 'folder': view.folder = t.dataset.folder; view.tag = ''; refresh(true); break;
      case 'tag': view.tag = view.tag === t.dataset.tag ? '' : t.dataset.tag; refresh(true); break;
      case 'clear-filters':
        view.q = ''; view.fav = false; view.tag = '';
        $('.gal-search').value = ''; refresh(true); break;
      case 'new-folder': sheetFolderName(root, null); break;
      case 'rename-folder': sheetFolderName(root, view.folder); break;
      case 'delete-folder': sheetDeleteFolder(root, view.folder); break;
      case 'open':
        if (view.select) toggleSelected(id); else openViewer(id);
        break;
      case 'sel-all':
        visiblePhotos().forEach(function (p) { selected[p.id] = true; }); refresh(); break;
      case 'sel-none': selected = {}; refresh(); break;
      case 'sel-fav': {
        const ids = selectedIds();
        const allFav = ids.length && ids.every(function (i) { return photos[i].favorite; });
        setFavorite(ids, !allFav); break;
      }
      case 'sel-move': sheetMove(root, selectedIds()); break;
      case 'sel-tag': sheetTags(root, selectedIds()); break;
      case 'sel-delete': sheetDeletePhotos(root, selectedIds()); break;
    }
  }

  function toggleSelected(id) {
    if (!photos[id]) return;
    if (selected[id]) delete selected[id]; else selected[id] = true;
    const tile = root.querySelector('.gal-tile[data-id="' + id + '"]');
    if (tile) tile.classList.toggle('is-selected', !!selected[id]);
    renderSelbar();
  }

  function afterChange() {
    if (isOpen()) refresh();
    if (viewer) updateViewer();
  }

  function refresh(resetScroll) {
    if (!isOpen()) return;
    if (view.folder !== ALL && view.folder !== UNFILED && !folders[view.folder]) view.folder = ALL;
    Object.keys(selected).forEach(function (id) { if (!photos[id]) delete selected[id]; });
    const favBtn = $('.gal-fav-toggle'), selBtn = $('.gal-select-toggle'), addBtn = $('.gal-add');
    favBtn.setAttribute('aria-pressed', String(view.fav)); favBtn.classList.toggle('is-on', view.fav);
    selBtn.setAttribute('aria-pressed', String(view.select)); selBtn.classList.toggle('is-on', view.select);
    selBtn.textContent = view.select ? 'Done' : 'Select';
    addBtn.disabled = !loaded;
    const total = Object.keys(photos).length;
    $('.gal-total').textContent = loaded && total ? plural(total, 'photo') : '';
    renderSide(); renderSub(); renderSelbar(); renderGrid(resetScroll);
  }

  function renderSide() {
    const list = allPhotos();
    const counts = {}; let unfiled = 0;
    list.forEach(function (p) { if (folderOf(p)) counts[p.folderId] = (counts[p.folderId] || 0) + 1; else unfiled++; });
    function row(key, label, n, icon) {
      return '<button type="button" class="gal-side-row' + (view.folder === key ? ' is-active' : '') + '" data-act="folder" data-folder="' + esc(key) + '">' +
        '<span class="gal-side-name">' + icon + '<span>' + esc(label) + '</span></span><span class="gal-side-count">' + n + '</span></button>';
    }
    let html = row(ALL, 'All photos', list.length, '') + row(UNFILED, 'Unfiled', unfiled, '');
    html += '<div class="gal-side-head"><span>Folders</span><button type="button" class="gal-mini" data-act="new-folder" title="New folder" aria-label="New folder"' + (loaded ? '' : ' disabled') + '>+</button></div>';
    const fl = allFolders();
    html += fl.length
      ? fl.map(function (f) { return row(f.id, f.name, counts[f.id] || 0, ICON_FOLDER); }).join('')
      : '<p class="gal-side-empty">No folders yet.</p>';
    $('.gal-side').innerHTML = html;
  }

  function renderSub() {
    const f = folders[view.folder];
    const title = view.folder === ALL ? 'All photos' : view.folder === UNFILED ? 'Unfiled' : (f ? f.name : '');
    const shown = visiblePhotos().length;
    let html = '<div class="gal-sub-row"><h4 class="gal-sub-title">' + esc(title) + '</h4>' +
      '<span class="gal-sub-count">' + (loaded ? plural(shown, 'photo') + (filtersActive() ? ' shown' : '') : '') + '</span>';
    if (filtersActive()) html += '<button type="button" class="gal-link" data-act="clear-filters">Clear filters</button>';
    if (f) {
      html += '<span class="gal-sub-spacer"></span>' +
        '<button type="button" class="btn btn-ghost gal-small" data-act="rename-folder">Rename</button>' +
        '<button type="button" class="btn btn-ghost gal-small" data-act="delete-folder">Delete folder</button>';
    }
    html += '</div>';
    // Tag chips for the current folder scope (ignores search/favorite so the row stays stable)
    const tagCounts = {};
    allPhotos().forEach(function (p) {
      if (view.folder === UNFILED && folderOf(p)) return;
      if (f && p.folderId !== f.id) return;
      p.tags.forEach(function (t) { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });
    const tags = Object.keys(tagCounts).sort();
    if (view.tag && !tagCounts[view.tag]) view.tag = '';
    if (tags.length) {
      html += '<div class="gal-tags" role="group" aria-label="Filter by tag">' + tags.map(function (t) {
        return '<button type="button" class="tag gal-tag' + (view.tag === t ? ' is-active' : '') + '" data-act="tag" data-tag="' + esc(t) + '" aria-pressed="' + (view.tag === t) + '">#' + esc(t) + ' <span>' + tagCounts[t] + '</span></button>';
      }).join('') + '</div>';
    }
    $('.gal-sub').innerHTML = html;
  }

  function renderSelbar() {
    const bar = $('.gal-selbar');
    bar.hidden = !view.select;
    if (!view.select) { bar.innerHTML = ''; return; }
    const n = selectedIds().length, off = n ? '' : ' disabled';
    bar.innerHTML = '<span class="gal-sel-count">' + n + ' selected</span>' +
      '<button type="button" class="gal-link" data-act="sel-all">Select all shown</button>' +
      (n ? '<button type="button" class="gal-link" data-act="sel-none">Clear</button>' : '') +
      '<span class="gal-sub-spacer"></span>' +
      '<button type="button" class="btn btn-secondary gal-small" data-act="sel-fav"' + off + '>Favorite</button>' +
      '<button type="button" class="btn btn-secondary gal-small" data-act="sel-move"' + off + '>Move</button>' +
      '<button type="button" class="btn btn-secondary gal-small" data-act="sel-tag"' + off + '>Tag</button>' +
      '<button type="button" class="btn btn-danger gal-small" data-act="sel-delete"' + off + '>Delete</button>';
  }

  function emptyState(kind) {
    const m = {
      loading: ['', 'Opening your photos…', '', ''],
      failed: ['', "Gallery storage isn't available", 'This browser blocked local photo storage, so the gallery can’t be used here.', ''],
      none: [ICON_FRAME, 'Your gallery is empty', 'Add a few photos to start your archive. You can also drop image files here.', 'add'],
      folder: [ICON_FRAME, 'This folder is empty', 'Add photos here, or move some in from All photos.', 'add'],
      unfiled: [ICON_FRAME, 'Nothing unfiled', 'Every photo has a home.', ''],
      match: [ICON_FRAME, 'No photos match', 'Try a different word, tag or folder.', 'clear-filters'],
      fav: [ICON_FRAME, 'No favorites here yet', 'Star a photo in the viewer to find it here.', 'clear-filters']
    }[kind];
    const label = m[3] === 'add' ? 'Add photos' : m[3] === 'clear-filters' ? 'Clear filters' : '';
    return '<div class="empty-state gal-empty">' + (m[0] ? '<div class="gal-empty-ico">' + m[0] + '</div>' : '') +
      '<div class="gal-empty-title">' + m[1] + '</div>' + (m[2] ? '<p>' + m[2] + '</p>' : '') +
      (label ? '<button type="button" class="btn ' + (m[3] === 'add' ? 'btn-primary' : 'btn-secondary') + '" data-act="' + m[3] + '">' + label + '</button>' : '') + '</div>';
  }

  function renderGrid(resetScroll) {
    const wrap = $('.gal-grid-wrap');
    const st = wrap.scrollTop;
    if (!loaded) { wrap.innerHTML = emptyState(loadFailed ? 'failed' : 'loading'); return; }
    const list = visiblePhotos();
    if (!list.length) {
      let kind = 'match';
      if (!filtersActive()) kind = !Object.keys(photos).length ? 'none' : view.folder === UNFILED ? 'unfiled' : 'folder';
      else if (view.fav && !view.q.trim() && !view.tag) kind = 'fav';
      wrap.innerHTML = emptyState(kind);
    } else {
      wrap.innerHTML = '<div class="gal-grid">' + list.map(function (p) {
        return '<div class="gal-tile' + (selected[p.id] ? ' is-selected' : '') + '" data-id="' + p.id + '">' +
          '<button type="button" class="gal-thumb" data-act="open" data-id="' + p.id + '" aria-label="' + (view.select ? 'Select ' : 'Open ') + esc(p.name) + '">' +
          '<img src="' + p.thumb + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" draggable="false"></button>' +
          (p.favorite ? '<span class="gal-badge" title="Favorite">' + ICON_STAR + '</span>' : '') +
          '<span class="gal-check" aria-hidden="true"></span>' +
          '<span class="gal-name" title="' + esc(p.name) + '">' + esc(p.name) + '</span></div>';
      }).join('') + '</div>';
    }
    wrap.scrollTop = resetScroll ? 0 : st;
  }

  // ------------------------------------------------------------------ inline sheets (rename / move / tag / confirm)

  function closeSheet(host) {
    const s = host && host.querySelector('.gal-sheet-wrap');
    if (s) s.remove();
  }
  // cfg: { title, body, ok, danger, onOk(wrap) -> true | Promise<true | errorString> | errorString }
  function openSheet(host, cfg) {
    closeSheet(host);
    const wrap = document.createElement('div');
    wrap.className = 'gal-sheet-wrap';
    wrap.innerHTML = '<div class="gal-sheet" role="dialog" aria-modal="true" aria-label="' + esc(cfg.title) + '">' +
      '<h4 class="gal-sheet-title">' + esc(cfg.title) + '</h4><div class="gal-sheet-body">' + cfg.body + '</div>' +
      '<p class="field-error gal-sheet-error" hidden></p>' +
      '<div class="gal-sheet-actions"><button type="button" class="btn btn-secondary" data-sheet="cancel">Cancel</button>' +
      '<button type="button" class="btn ' + (cfg.danger ? 'btn-danger' : 'btn-primary') + '" data-sheet="ok">' + esc(cfg.ok || 'OK') + '</button></div></div>';
    function submit() {
      Promise.resolve(cfg.onOk(wrap)).then(function (r) {
        if (r === true) { closeSheet(host); return; }
        const err = wrap.querySelector('.gal-sheet-error');
        err.textContent = r || 'Something went wrong.'; err.hidden = false;
      });
    }
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { closeSheet(host); return; }
      const b = e.target.closest('[data-sheet]');
      if (b) { if (b.dataset.sheet === 'cancel') closeSheet(host); else submit(); return; }
      const q = e.target.closest('[data-quick-tag]');
      if (q) {
        const input = wrap.querySelector('.gal-sheet-input');
        const have = parseTags(input.value);
        if (have.indexOf(q.dataset.quickTag) === -1) input.value = have.concat(q.dataset.quickTag).join(', ');
        input.focus();
      }
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.preventDefault(); submit(); }
    });
    host.appendChild(wrap);
    const first = wrap.querySelector('input[type="text"], input:checked, input, button[data-sheet="ok"]');
    if (first) { first.focus(); if (first.select && first.type === 'text') first.select(); }
  }

  function sheetFolderName(host, folderId) {
    const f = folderId ? folders[folderId] : null;
    openSheet(host, {
      title: f ? 'Rename folder' : 'New folder', ok: f ? 'Rename' : 'Create',
      body: '<div class="form-row"><label for="gal-fname">Folder name</label><input id="gal-fname" type="text" class="input gal-sheet-input" maxlength="40" value="' + (f ? esc(f.name) : '') + '" autocomplete="off"></div>',
      onOk: function (w) {
        const val = w.querySelector('#gal-fname').value;
        return (f ? renameFolder(f.id, val) : createFolder(val)).then(function (r) {
          if (r.error) return r.error;
          if (!f) { view.folder = r.folder.id; view.tag = ''; refresh(true); }
          return true;
        });
      }
    });
  }

  function sheetDeleteFolder(host, folderId) {
    const f = folders[folderId];
    if (!f) return;
    const n = allPhotos().filter(function (p) { return p.folderId === f.id; }).length;
    openSheet(host, {
      title: 'Delete “' + f.name + '”?', ok: 'Delete folder', danger: true,
      body: n
        ? '<p class="gal-sheet-text">This folder has ' + plural(n, 'photo') + '.</p>' +
          '<label class="gal-opt"><input type="radio" name="gal-del" value="keep" checked> Keep the photos (move to Unfiled)</label>' +
          '<label class="gal-opt"><input type="radio" name="gal-del" value="all"> Delete the photos too</label>'
        : '<p class="gal-sheet-text">This folder is empty. Nothing else will be removed.</p>',
      onOk: function (w) {
        const r = w.querySelector('input[name="gal-del"]:checked');
        return deleteFolder(f.id, !!(r && r.value === 'all')).then(function (ok) { return ok ? true : "Couldn't delete the folder."; });
      }
    });
  }

  function sheetDeletePhotos(host, ids) {
    ids = ids.filter(function (id) { return photos[id]; });
    if (!ids.length) return;
    openSheet(host, {
      title: ids.length === 1 ? 'Delete this photo?' : 'Delete ' + plural(ids.length, 'photo') + '?', ok: 'Delete', danger: true,
      body: '<p class="gal-sheet-text">This removes ' + (ids.length === 1 ? 'it' : 'them') + ' from your gallery. This can’t be undone.</p>',
      onOk: function () { return deletePhotos(ids).then(function (ok) { return ok ? true : "Couldn't delete."; }); }
    });
  }

  function sheetMove(host, ids) {
    ids = ids.filter(function (id) { return photos[id]; });
    if (!ids.length) return;
    const cur = ids.length === 1 ? photos[ids[0]].folderId : undefined;
    function opt(val, label, checked) {
      return '<label class="gal-opt"><input type="radio" name="gal-dest" value="' + esc(val) + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }
    let body = opt('', 'Unfiled', cur === null);
    allFolders().forEach(function (f) { body += opt(f.id, f.name, cur === f.id); });
    body += '<label class="gal-opt"><input type="radio" name="gal-dest" value="__new"> New folder…</label>' +
      '<input type="text" class="input gal-sheet-input gal-new-name" maxlength="40" placeholder="Folder name" aria-label="New folder name">';
    openSheet(host, {
      title: ids.length === 1 ? 'Move photo' : 'Move ' + plural(ids.length, 'photo'), ok: 'Move', body: body,
      onOk: function (w) {
        const r = w.querySelector('input[name="gal-dest"]:checked');
        if (!r) return 'Choose where to move.';
        if (r.value === '__new') {
          return createFolder(w.querySelector('.gal-new-name').value).then(function (res) {
            if (res.error) return res.error;
            return movePhotos(ids, res.folder.id).then(function (ok) { return ok ? true : "Couldn't move."; });
          });
        }
        return movePhotos(ids, r.value || null).then(function (ok) { return ok ? true : "Couldn't move."; });
      }
    });
    const nameInput = host.querySelector('.gal-new-name');
    if (nameInput) nameInput.addEventListener('focus', function () {
      const radio = host.querySelector('input[name="gal-dest"][value="__new"]');
      if (radio) radio.checked = true;
    });
  }

  function sheetTags(host, ids) {
    ids = ids.filter(function (id) { return photos[id]; });
    if (!ids.length) return;
    const single = ids.length === 1;
    const used = {};
    allPhotos().forEach(function (p) { p.tags.forEach(function (t) { used[t] = (used[t] || 0) + 1; }); });
    const quick = Object.keys(used).sort(function (a, b) { return used[b] - used[a] || (a < b ? -1 : 1); }).slice(0, 12);
    openSheet(host, {
      title: single ? 'Tag photo' : 'Add tags to ' + plural(ids.length, 'photo'), ok: 'Save',
      body: '<div class="form-row"><label for="gal-tags">Tags, separated by commas</label>' +
        '<input id="gal-tags" type="text" class="input gal-sheet-input" maxlength="300" value="' + (single ? esc(photos[ids[0]].tags.join(', ')) : '') + '" placeholder="e.g. trip, family" autocomplete="off"></div>' +
        (quick.length ? '<div class="gal-quick">' + quick.map(function (t) {
          return '<button type="button" class="tag gal-tag" data-quick-tag="' + esc(t) + '">#' + esc(t) + '</button>';
        }).join('') + '</div>' : ''),
      onOk: function (w) {
        const tags = parseTags(w.querySelector('#gal-tags').value);
        if (!single && !tags.length) return 'Enter at least one tag.';
        return tagPhotos(ids, tags, single ? 'set' : 'add').then(function (ok) { return ok ? true : "Couldn't save tags."; });
      }
    });
  }

  // ------------------------------------------------------------------ fullscreen viewer

  function openViewer(id) {
    const ids = visiblePhotos().map(function (p) { return p.id; });
    const index = ids.indexOf(id);
    if (index === -1) return;
    closeViewer();
    const el = document.createElement('div');
    el.id = 'gallery-viewer';
    el.className = 'gal-viewer';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photo viewer');
    el.tabIndex = -1;
    el.innerHTML =
      '<div class="gal-v-top"><div class="gal-v-title"><strong class="gal-v-name"></strong><span class="gal-v-meta"></span></div>' +
      '<div class="gal-v-tools">' +
        '<button type="button" class="gal-v-btn gal-v-fav" data-v="fav" aria-label="Favorite" aria-pressed="false">' + ICON_STAR + '</button>' +
        '<button type="button" class="gal-v-btn" data-v="move">Move</button>' +
        '<button type="button" class="gal-v-btn" data-v="tags">Tags</button>' +
        '<button type="button" class="gal-v-btn" data-v="delete">Delete</button>' +
        '<span class="gal-v-sep"></span>' +
        '<button type="button" class="gal-v-btn" data-v="zoom-out" aria-label="Zoom out">&minus;</button>' +
        '<span class="gal-v-zoom" aria-live="off">100%</span>' +
        '<button type="button" class="gal-v-btn" data-v="zoom-in" aria-label="Zoom in">+</button>' +
        '<button type="button" class="gal-v-btn" data-v="fit">Fit</button>' +
        '<span class="gal-v-sep"></span>' +
        '<button type="button" class="gal-v-btn" data-v="close" aria-label="Close viewer">&times;</button>' +
      '</div></div>' +
      '<div class="gal-v-stage"><img class="gal-v-img" alt="" draggable="false"></div>' +
      '<button type="button" class="gal-v-nav gal-v-prev" data-v="prev" aria-label="Previous photo">&#8249;</button>' +
      '<button type="button" class="gal-v-nav gal-v-next" data-v="next" aria-label="Next photo">&#8250;</button>' +
      '<div class="gal-v-foot"></div>';
    document.body.appendChild(el);
    viewer = { el: el, ids: ids, index: index, scale: 1, tx: 0, ty: 0, drag: null };
    bindViewer();
    updateViewer();
    el.focus({ preventScroll: true });
  }

  function closeViewer() {
    if (!viewer) return;
    const el = viewer.el;
    viewer = null;
    el.remove();
    if (isOpen()) { refresh(); root.focus && root.focus({ preventScroll: true }); }
  }

  function currentViewed() { return viewer ? photos[viewer.ids[viewer.index]] : null; }

  function updateViewer() {
    if (!viewer) return;
    // Drop photos that were deleted while the viewer was open.
    const curId = viewer.ids[viewer.index];
    viewer.ids = viewer.ids.filter(function (id) { return photos[id]; });
    if (!viewer.ids.length) { closeViewer(); return; }
    const at = viewer.ids.indexOf(curId);
    if (at === -1) { viewer.index = Math.min(viewer.index, viewer.ids.length - 1); resetZoom(); }
    else viewer.index = at;
    const p = currentViewed();
    const el = viewer.el;
    const img = el.querySelector('.gal-v-img');
    if (img.getAttribute('data-id') !== p.id) { img.src = p.src; img.alt = p.name; img.setAttribute('data-id', p.id); }
    el.querySelector('.gal-v-name').textContent = p.name;
    el.querySelector('.gal-v-meta').textContent = (viewer.index + 1) + ' / ' + viewer.ids.length +
      (p.width && p.height ? '  ·  ' + p.width + ' × ' + p.height : '');
    const fav = el.querySelector('.gal-v-fav');
    fav.classList.toggle('is-on', p.favorite); fav.setAttribute('aria-pressed', String(p.favorite));
    el.querySelector('.gal-v-prev').disabled = viewer.index === 0;
    el.querySelector('.gal-v-next').disabled = viewer.index === viewer.ids.length - 1;
    const f = folderOf(p);
    el.querySelector('.gal-v-foot').innerHTML = '<span class="gal-v-folder">' + ICON_FOLDER + ' ' + esc(f ? f.name : 'Unfiled') + '</span>' +
      p.tags.map(function (t) { return '<span class="gal-v-tag">#' + esc(t) + '</span>'; }).join('');
    applyTransform();
  }

  function applyTransform() {
    if (!viewer) return;
    const img = viewer.el.querySelector('.gal-v-img');
    img.style.transform = 'translate(' + viewer.tx + 'px,' + viewer.ty + 'px) scale(' + viewer.scale + ')';
    viewer.el.querySelector('.gal-v-zoom').textContent = Math.round(viewer.scale * 100) + '%';
    viewer.el.querySelector('.gal-v-stage').classList.toggle('is-zoomed', viewer.scale > 1);
  }
  function resetZoom() { if (viewer) { viewer.scale = 1; viewer.tx = 0; viewer.ty = 0; applyTransform(); } }
  // cx/cy are relative to the stage centre, so zoom stays anchored under the cursor.
  function zoomBy(factor, cx, cy) {
    if (!viewer) return;
    const ns = clamp(viewer.scale * factor, 1, 6);
    const r = ns / viewer.scale;
    viewer.tx = cx - (cx - viewer.tx) * r;
    viewer.ty = cy - (cy - viewer.ty) * r;
    viewer.scale = ns;
    if (ns === 1) { viewer.tx = 0; viewer.ty = 0; }
    applyTransform();
  }
  function step(d) {
    if (!viewer) return;
    const n = viewer.index + d;
    if (n < 0 || n >= viewer.ids.length) return;
    viewer.index = n; resetZoom(); updateViewer();
  }

  function bindViewer() {
    const el = viewer.el;
    const stage = el.querySelector('.gal-v-stage');
    el.addEventListener('click', function (e) {
      const b = e.target.closest('[data-v]');
      if (!b || b.disabled) return;
      const p = currentViewed();
      switch (b.dataset.v) {
        case 'close': closeViewer(); break;
        case 'prev': step(-1); break;
        case 'next': step(1); break;
        case 'zoom-in': zoomBy(1.4, 0, 0); break;
        case 'zoom-out': zoomBy(1 / 1.4, 0, 0); break;
        case 'fit': resetZoom(); break;
        case 'fav': if (p) setFavorite([p.id], !p.favorite); break;
        case 'move': if (p) sheetMove(el, [p.id]); break;
        case 'tags': if (p) sheetTags(el, [p.id]); break;
        case 'delete': if (p) sheetDeletePhotos(el, [p.id]); break;
      }
    });
    function stagePoint(e) {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
    }
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      const pt = stagePoint(e);
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, pt.x, pt.y);
    }, { passive: false });
    stage.addEventListener('dblclick', function (e) {
      const pt = stagePoint(e);
      if (viewer.scale > 1) resetZoom(); else zoomBy(2.5, pt.x, pt.y);
    });
    stage.addEventListener('pointerdown', function (e) {
      if (viewer.scale <= 1 || e.button !== 0) return;
      viewer.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: viewer.tx, ty: viewer.ty };
      stage.classList.add('is-dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* best-effort */ }
    });
    stage.addEventListener('pointermove', function (e) {
      const d = viewer && viewer.drag;
      if (!d || d.id !== e.pointerId) return;
      viewer.tx = d.tx + (e.clientX - d.x);
      viewer.ty = d.ty + (e.clientY - d.y);
      applyTransform();
    });
    function endDrag(e) {
      if (!viewer || !viewer.drag || viewer.drag.id !== e.pointerId) return;
      viewer.drag = null; stage.classList.remove('is-dragging');
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
  }

  // One capture-phase key handler: while the viewer (or a sheet) is open it owns Escape, so the shared
  // Modal underneath doesn't close.
  function onKeyDown(e) {
    const typing = e.target && e.target.closest && e.target.closest('input, textarea, select');
    if (viewer) {
      const sheet = viewer.el.querySelector('.gal-sheet-wrap');
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (sheet) closeSheet(viewer.el); else closeViewer();
        return;
      }
      if (typing || sheet) return;
      let handled = true;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.4, 0, 0);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.4, 0, 0);
      else if (e.key === '0') resetZoom();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.key === 'Escape' && isOpen() && root.querySelector('.gal-sheet-wrap')) {
      e.preventDefault(); e.stopPropagation();
      closeSheet(root);
    }
  }

  // ------------------------------------------------------------------ public: open / init

  function open() {
    if (typeof Modal === 'undefined') return;
    closeViewer();
    Modal.open(shellHtml(), { size: 'xl' });
    root = document.getElementById('gallery-root');
    if (!root) return;
    root.tabIndex = -1;
    view.select = false; selected = {};
    bindRoot();
    refresh(true);
    load().then(function () { if (isOpen()) refresh(true); });
  }

  function init() {
    const btn = document.getElementById('gallery-icon');
    if (btn) btn.addEventListener('click', open);
    if (!keyBound) { window.addEventListener('keydown', onKeyDown, true); keyBound = true; }
    load(); // eager, so a backup export always sees the full library
  }

  // ------------------------------------------------------------------ backup integration

  // Same shape as the stored records. Null until storage has loaded (nothing trustworthy to export yet).
  function exportBackup() {
    if (!loaded) return null;
    return { folders: Object.assign({}, folders), photos: Object.assign({}, photos) };
  }

  // Live wins on id conflict; backup-only folders/photos are added; a backup folder whose name already
  // exists live is folded into that live folder instead of duplicating it. Returns { settled: Promise }.
  function mergeBackup(raw) {
    if (!isObj(raw)) return { settled: Promise.resolve(true) };
    const settled = load().then(function () {
      if (!loaded) return true;
      const idMap = {};
      const addF = [];
      const fm = isObj(raw.folders) ? raw.folders : {};
      Object.keys(fm).forEach(function (k) {
        const f = cleanFolder(fm[k]);
        if (!f || f.id !== k || folders[f.id]) return;
        const same = allFolders().filter(function (x) { return x.name.toLowerCase() === f.name.toLowerCase(); })[0] ||
          addF.filter(function (x) { return x.name.toLowerCase() === f.name.toLowerCase(); })[0];
        if (same) idMap[f.id] = same.id; else addF.push(f);
      });
      const known = {};
      Object.keys(folders).forEach(function (id) { known[id] = true; });
      addF.forEach(function (f) { known[f.id] = true; });
      const addP = [];
      const pm = isObj(raw.photos) ? raw.photos : {};
      Object.keys(pm).forEach(function (k) {
        const p = cleanPhoto(pm[k]);
        if (!p || p.id !== k || photos[p.id]) return;
        if (p.folderId) {
          if (Object.prototype.hasOwnProperty.call(idMap, p.folderId)) p.folderId = idMap[p.folderId];
          else if (!known[p.folderId]) p.folderId = null;
        }
        addP.push(p);
      });
      const ops = addF.map(function (f) { return { store: 'folders', put: f }; })
        .concat(addP.map(function (p) { return { store: 'photos', put: p }; }));
      return write(ops).then(function () {
        addF.forEach(function (f) { folders[f.id] = f; });
        addP.forEach(function (p) { photos[p.id] = p; });
        afterChange();
        return true;
      });
    }).catch(function () { return true; }); // best-effort: never undoes an already-applied restore
    return { settled: settled };
  }

  function clearAll() {
    return load().then(function () {
      if (!loaded) return true;
      return write([{ store: 'photos', clear: true }, { store: 'folders', clear: true }]).then(function () {
        photos = {}; folders = {}; selected = {};
        view.folder = ALL; view.q = ''; view.fav = false; view.tag = '';
        closeViewer();
        afterChange();
        return true;
      });
    }).catch(function () { return false; });
  }

  return { init: init, open: open, exportBackup: exportBackup, mergeBackup: mergeBackup, clearAll: clearAll };
})();
