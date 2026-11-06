// backup.js — Backup / Restore / Summary / Compare (Feature 14). Local export/import only, no
// cloud sync. Depends on: State. Load after state.js. Optionally calls into Nav/TimeEngine/screen
// modules after a successful restore if they exist on window — all such calls are guarded, matching
// the project's existing `typeof X !== 'undefined'` defensive-call pattern (see calendar.js's
// TargetsData guard).
//
// Export shape: { schemaVersion, version, exportedAt, calendar, planner, targets, journal, study,
// progress, water, sleep, gamification, assistant, alarms, myWorld, dailySummaries, settings }.
// `version` is kept as a legacy alias of `schemaVersion` for any older reader. `myWorld` is optional
// on restore (backups made before it existed simply don't carry it).
//
// Restore shape: per-record merge, current/live data always wins on conflict, backup-only records
// are added, live-only records are preserved. Runtime session state (studyClock/timeEngine) is
// always forced idle. Singleton config (settings, gamification totals, journal lock, studyStreak,
// waterReminder, currentScreen) is never overwritten by a restore — only real per-ID record
// collections merge. Validation + merge happen fully in memory; State.replace() is only called once,
// with a single complete object covering every key State's defaultState defines, so nothing an
// older/partial backup doesn't mention can accidentally fall back to State's own defaults.
// My World keeps its own storage outside State (world record, inventory, imported content packs), so
// it is exported/merged through MyWorldData/MyWorldContent under the same rules: live wins on
// conflict, backup-only records are added, live-only records are preserved.
const Backup = (function () {
  // v3: ZIP package (backup.json + manifest.json + media/), adds canonicalTasks and providers. v1/v2 (plain JSON,
  // media inline as data URLs or absent) restore unchanged: every v3 field is optional on restore.
  const SCHEMA_VERSION = 3;

  // Mirrors state.js's defaultState.studyClock exactly — the canonical "idle" shape.
  const DEFAULT_IDLE_STUDY_CLOCK = {
    mode: 'stopwatch',
    running: false,
    startedAt: null,
    timerTotalMs: 0,
    elapsedMs: 0,
    awaitingDecision: false
  };

  let _restoring = false;

  // ---------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------

  function build() {
    const s = State.get();
    return {
      schemaVersion: SCHEMA_VERSION,
      version: SCHEMA_VERSION, // legacy alias
      exportedAt: new Date().toISOString(),
      calendar: {
        dateHubs: s.dateHubs,
        studyStreak: s.studyStreak,
        favoriteTopics: s.favoriteTopics
      },
      planner: {
        topics: s.topics,
        tasks: s.tasks,
        tags: s.tags,
        tagsMigrated: s.tagsMigrated,
        subjects: s.subjects // active-subject list; null = never customised (older backups simply lack this key)
      },
      targets: {
        targets: s.targets,
        subtargets: s.subtargets
      },
      journal: {
        journalEntries: s.journalEntries,
        journalPasswordHash: s.journalPasswordHash,
        journalLocked: s.journalLocked
      },
      study: {
        studyClock: s.studyClock,
        timeEngine: s.timeEngine,
        sessionRecords: s.sessionRecords,
        timeEngineBreaks: s.timeEngineBreaks,
        studyLog: s.studyLog,
        studyTemplates: s.studyTemplates,
        musicPlaylist: s.musicPlaylist
      },
      progress: {}, // derived-only — Progress owns no data of its own; key reserved
      water: {
        waterEvents: s.waterEvents,
        waterReminder: s.waterReminder
      },
      sleep: {
        sleepRecords: s.sleepRecords
      },
      habits: {
        habits: s.habits,
        habitLogs: s.habitLogs,
        habitsMigrated: s.habitsMigrated
      },
      gamification: {
        totalExp: s.gamification.totalExp,
        lastSettledDate: s.gamification.lastSettledDate,
        streakBonusAwardedForRun: s.gamification.streakBonusAwardedForRun,
        expLedger: s.expLedger
      },
      assistant: {
        assistantNotes: s.assistantNotes,
        notepadFolders: s.notepadFolders
      },
            alarms: {
        generalAlarms: s.generalAlarms
      },
      tests: {
        testMarks: s.testMarks // older backups simply lack this group
      },
            myWorld: buildMyWorld(),
      gallery: buildGallery(),
      dailySummaries: s.dailySummaries,
      planningHistory: s.planningHistory || {},
      canonicalTasks: buildCanonicalTasks(),
      extras: {
        calendarPhotos: s.calendarPhotos || {}, // dateStr -> media id (the image itself is in the media store provider)
        itineraryTemplates: s.itineraryTemplates || {},
        dailyItinerarySummaries: s.dailyItinerarySummaries || {}
      },
      settings: s.settings
    };
  }

  // The planner's canonical task store lives in its own localStorage key, outside State. Null if unavailable.
  function buildCanonicalTasks() {
    if (typeof CanonicalTaskStore === 'undefined' || typeof CanonicalTaskStore.exportBackup !== 'function') return null;
    try { return CanonicalTaskStore.exportBackup(); } catch (e) { return null; }
  }

  // My World lives outside State — read it through its own modules. Null if they aren't loaded.
  function buildMyWorld() {
    if (typeof MyWorldData === 'undefined' || typeof MyWorldContent === 'undefined') return null;
    const content = MyWorldContent.exportBackup();
    return {
      world: MyWorldData.getWorld(),
      inventory: content.inventory,
            definitions: content.definitions
    };
  }

  // Gallery owns its photos/folders/tags in its own IndexedDB store — read through its module. Null if not loaded.
  function buildGallery() {
    if (typeof Gallery === 'undefined' || typeof Gallery.exportBackup !== 'function') return null;
    return Gallery.exportBackup();
  }

  function exportJson() {
    return JSON.stringify(build(), null, 2);
  }

  // ---------------------------------------------------------------------
  // MEDIA + ZIP PACKAGING
  // Any base64 data-URL string (>= MEDIA_MIN_CHARS) or image/audio/video Blob anywhere in the exported object
  // tree is moved out of the JSON into media/<id>.<ext> inside the ZIP and replaced by { "$media": id }.
  // Restore reverses this before any module sees the data, so media-backed features (Gallery today, anything
  // that stores data URLs tomorrow) need no media handling of their own. manifest.json maps every file to its
  // id, MIME type, size, CRC-32 and the JSON paths (e.g. gallery.photos.<photoId>.src) that reference it.
  // Files are STORED (not deflated): photos are already compressed. Reading accepts deflated ZIPs too.
  // ---------------------------------------------------------------------

  const BACKUP_FORMAT = 'lavender-backup';
  const MEDIA_MIN_CHARS = 1024;
  const MEDIA_MIME_RE = /^(image|audio|video)\/[\w.+-]+$/i;
  const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+);base64,/i;
  const MEDIA_EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'image/avif': 'avif', 'image/heic': 'heic', 'image/bmp': 'bmp'
  };
  const EXT_MIME = {};
  Object.keys(MEDIA_EXT).forEach(function (m) { EXT_MIME[MEDIA_EXT[m]] = m; });
  const QUOTA_MSG = 'There is not enough storage space on this device to restore this backup. Free up space and try again.';

  // Optional extra stores outside State (e.g. journal photos). Contract:
  //   { key, collect(): Promise<json|null>, restore(payload): Promise<{ok}>, undo?(result), clear?() }
  // collect() may return data containing data URLs/Blobs; restore() receives them re-hydrated and must be
  // all-or-nothing (return { ok:false, quota? } on failure).
  const providers = [];
  function registerProvider(p) {
    if (!p || typeof p.key !== 'string' || typeof p.collect !== 'function' || typeof p.restore !== 'function') return false;
    for (let i = providers.length - 1; i >= 0; i--) if (providers[i].key === p.key) providers.splice(i, 1);
    providers.push(p);
    return true;
  }

  // Journal photos and calendar photos: blobs in the shared IndexedDB 'media' store (Storage.getDB()), referenced
  // by id from State (journalEntries[date].photos, calendarPhotos[date]). Only records still referenced after the
  // merge are restored; an id already on this device is never overwritten (live wins).
  function mediaStoreOp(mode, fn) {
    if (typeof Storage === 'undefined' || typeof Storage.getDB !== 'function') return Promise.reject(new Error('Media storage unavailable'));
    return Storage.getDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction('media', mode);
        const req = fn(tx.objectStore('media'));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Write failed')); };
      });
    });
  }

  function wantedMediaIds(s) {
    const w = {};
    Object.keys(s.journalEntries || {}).forEach(function (d) {
      const e = s.journalEntries[d];
      if (e && Array.isArray(e.photos)) e.photos.forEach(function (id) { if (typeof id === 'string') w[id] = true; });
    });
    Object.keys(s.calendarPhotos || {}).forEach(function (d) {
      if (typeof s.calendarPhotos[d] === 'string') w[s.calendarPhotos[d]] = true;
    });
    return w;
  }

  providers.push({
    key: 'mediaStore',
    label: 'Journal and calendar photos',
    always: true, // also run for older backups, so unresolved photo references are reported
    collect: function () {
      return mediaStoreOp('readonly', function (st) { return st.getAll(); }).then(function (recs) {
        const out = [];
        (recs || []).forEach(function (r) {
          if (!r || typeof r.id !== 'string' || !(r.blob instanceof Blob)) return;
          const t = String(r.blob.type || r.type || '').toLowerCase();
          const rec = Object.assign({}, r);
          // Bytes are never altered; a missing/odd MIME label is normalised so the file can be packaged.
          rec.blob = MEDIA_MIME_RE.test(t) ? (r.blob.type === t ? r.blob : new Blob([r.blob], { type: t })) : new Blob([r.blob], { type: 'image/jpeg' });
          out.push(rec);
        });
        return { records: out };
      });
    },
    restore: async function (payload, ctx) {
      const recs = payload && Array.isArray(payload.records) ? payload.records : [];
      const have = {};
      (await mediaStoreOp('readonly', function (st) { return st.getAllKeys(); }) || []).forEach(function (k) { have[k] = true; });
      const incoming = {};
      recs.forEach(function (r) {
        if (isPlainObject(r) && typeof r.id === 'string' && r.blob instanceof Blob && ctx.wanted[r.id]) incoming[r.id] = r;
      });
      const toAdd = Object.keys(incoming).filter(function (id) { return !have[id]; });
      if (toAdd.length) {
        await mediaStoreOp('readwrite', function (st) { toAdd.forEach(function (id) { st.put(incoming[id]); }); return null; });
      }
      const present = Object.keys(have).filter(function (id) { return ctx.wanted[id]; }).concat(toAdd);
      const presentSet = {};
      present.forEach(function (id) { presentSet[id] = true; });
      const missing = Object.keys(ctx.wanted).filter(function (id) { return !presentSet[id]; }).length;
      return { ok: true, added: toAdd, present: present, missing: missing };
    },
    undo: function (r) {
      if (!r || !r.added || !r.added.length) return true;
      return mediaStoreOp('readwrite', function (st) { r.added.forEach(function (id) { st.delete(id); }); return null; })
        .then(function () { return true; }, function () { return false; });
    },
    clear: function () { return mediaStoreOp('readwrite', function (st) { return st.clear(); }); }
  });

  // State.replace() swallows a failed localStorage write, so confirm what was persisted matches memory.
  function persistedMatches() {
    try {
      if (typeof Storage === 'undefined' || typeof Storage.load !== 'function') return true;
      return JSON.stringify(Storage.load('appState')) === JSON.stringify(State.get());
    } catch (e) { return false; }
  }

  function isQuotaError(e) {
    return /quota|storage full|no space/i.test(String(e && (e.name + ' ' + e.message)));
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToDataUrl(bytes, mime) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:' + mime + ';base64,' + btoa(bin);
  }

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---- extraction (export) ----

  function newMediaCtx() {
    return { items: [], byString: new Map(), byBlob: new Map(), path: [], warnings: [] };
  }

  function addMediaItem(ctx, mime, as, payload) {
    const item = { id: 'm' + String(ctx.items.length + 1).padStart(5, '0'), mime: mime, as: as, refs: [], bytes: payload.bytes || null, blob: payload.blob || null };
    ctx.items.push(item);
    return item;
  }

  function noteRef(ctx, item) {
    if (item.refs.length < 8) item.refs.push(ctx.path.join('.'));
  }

  // Returns a JSON-safe deep copy of v with media replaced by { $media: id }. Never mutates v.
  function extractMedia(v, ctx) {
    if (ctx.path.length > 100) throw new Error('Data is nested too deeply to export.');
    if (typeof v === 'string') {
      if (v.length < MEDIA_MIN_CHARS) return v;
      const m = DATA_URL_RE.exec(v);
      if (!m || !MEDIA_MIME_RE.test(m[1])) return v;
      let item = ctx.byString.get(v);
      if (!item) {
        let bytes;
        try { bytes = base64ToBytes(v.slice(m[0].length)); } catch (e) {
          ctx.warnings.push('One embedded image could not be decoded and was kept inside the backup data instead.');
          return v;
        }
        item = addMediaItem(ctx, m[1].toLowerCase(), 'dataUrl', { bytes: bytes });
        ctx.byString.set(v, item);
      }
      noteRef(ctx, item);
      return { $media: item.id };
    }
    if (typeof Blob !== 'undefined' && v instanceof Blob) {
      // Only real media is packaged. Other Blobs/Files (e.g. a local music File held in memory) are runtime-only.
      if (!MEDIA_MIME_RE.test(v.type)) return undefined;
      let item = ctx.byBlob.get(v);
      if (!item) { item = addMediaItem(ctx, v.type.toLowerCase(), 'blob', { blob: v }); ctx.byBlob.set(v, item); }
      noteRef(ctx, item);
      return { $media: item.id };
    }
    if (Array.isArray(v)) {
      return v.map(function (x, i) {
        ctx.path.push(i);
        const r = extractMedia(x, ctx);
        ctx.path.pop();
        return r === undefined ? null : r;
      });
    }
    if (v && typeof v === 'object') {
      if (typeof v.toJSON === 'function') return extractMedia(v.toJSON(), ctx);
      const out = {};
      Object.keys(v).forEach(function (k) {
        ctx.path.push(k);
        const r = extractMedia(v[k], ctx);
        ctx.path.pop();
        if (r !== undefined) out[k] = r;
      });
      return out;
    }
    return (typeof v === 'function' || typeof v === 'symbol') ? undefined : v;
  }

  async function resolveMediaBytes(ctx) {
    for (let i = 0; i < ctx.items.length; i++) {
      const it = ctx.items[i];
      if (!it.bytes) it.bytes = new Uint8Array(await it.blob.arrayBuffer());
      it.blob = null;
      it.size = it.bytes.length;
      it.crc = crc32(it.bytes);
    }
  }

  // ---- rehydration (restore) ----

  // Returns a copy of v with every { $media: id } replaced by its data URL / Blob (null if the media is missing).
  function rehydrate(v, media, cache, stats) {
    if (Array.isArray(v)) return v.map(function (x) { return rehydrate(x, media, cache, stats); });
    if (isPlainObject(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$media' && typeof v.$media === 'string') {
        const m = media[v.$media];
        if (!m) { stats.unresolved++; return null; }
        if (m.as === 'blob') return new Blob([m.bytes], { type: m.mime });
        if (cache[v.$media] === undefined) cache[v.$media] = bytesToDataUrl(m.bytes, m.mime);
        return cache[v.$media];
      }
      const out = {};
      keys.forEach(function (k) { if (k !== '__proto__') out[k] = rehydrate(v[k], media, cache, stats); });
      return out;
    }
    return v;
  }

  // ---- minimal ZIP writer / reader (STORE only for writing; STORE + deflate for reading) ----

  async function zipBuild(entries) {
    if (entries.length > 65534) throw new Error('TOO_MANY_FILES');
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    let cdSize = 0;
    entries.forEach(function (e) {
      const name = enc.encode(e.name);
      const size = e.bytes.length;
      const crc = e.crc != null ? e.crc : crc32(e.bytes);
      if (size > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new Error('TOO_LARGE');
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), name, e.bytes);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
      cdSize += 46 + name.length;
    });
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(eocd.buffer)]), { type: 'application/zip' });
  }

  // Parses the central directory. Throws if the structure is damaged.
  function zipOpen(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('NOT_ZIP');
    const count = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('ZIP64');
    const dec = new TextDecoder('utf-8');
    const entries = {};
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('BAD_DIRECTORY');
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries[name] = {
        flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true), crc: dv.getUint32(p + 16, true),
        csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), lho: dv.getUint32(p + 42, true)
      };
      p += 46 + nlen + elen + clen;
    }
    return { u8: u8, dv: dv, entries: entries };
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('UNSUPPORTED_COMPRESSION');
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Returns the verified bytes of one entry. Throws UNSUPPORTED_COMPRESSION / CORRUPT.
  async function zipFile(z, name) {
    const e = z.entries[name];
    if (!e) throw new Error('MISSING');
    if ((e.flags & 1) || (e.method !== 0 && e.method !== 8)) throw new Error('UNSUPPORTED_COMPRESSION');
    if (e.lho + 30 > z.u8.length || z.dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('CORRUPT');
    const start = e.lho + 30 + z.dv.getUint16(e.lho + 26, true) + z.dv.getUint16(e.lho + 28, true);
    if (start + e.csize > z.u8.length) throw new Error('CORRUPT');
    const raw = z.u8.subarray(start, start + e.csize);
    const bytes = e.method === 0 ? raw : await inflateRaw(raw).catch(function (err) {
      throw new Error(err && err.message === 'UNSUPPORTED_COMPRESSION' ? err.message : 'CORRUPT');
    });
    if (bytes.length !== e.usize || crc32(bytes) !== e.crc) throw new Error('CORRUPT');
    return bytes;
  }

  // ---- export ----

  async function buildPackage() {
    const warnings = [];
    if (typeof Gallery !== 'undefined' && typeof Gallery.ready === 'function') {
      let ok = false;
      try { ok = await Gallery.ready(); } catch (e) { ok = false; }
      if (!ok) warnings.push('The gallery could not be read, so its photos are NOT included in this backup.');
    }
    const data = build();
    if (typeof CanonicalTaskStore !== 'undefined' && data.canonicalTasks === null) {
      warnings.push('Planner tasks could not be read and are NOT included in this backup.');
    }
    data.providers = {};
    for (let i = 0; i < providers.length; i++) {
      try {
        const payload = await providers[i].collect();
        if (payload !== null && payload !== undefined) data.providers[providers[i].key] = payload;
      } catch (e) {
        warnings.push('"' + (providers[i].label || providers[i].key) + '" could not be read and are NOT included in this backup.');
      }
    }

    const ctx = newMediaCtx();
    const slim = extractMedia(data, ctx);
    await resolveMediaBytes(ctx);
    ctx.warnings.forEach(function (w) { warnings.push(w); });

    let mediaBytes = 0;
    ctx.items.forEach(function (it) { mediaBytes += it.size; });
    const stats = {
      photos: (data.gallery && data.gallery.photos ? Object.keys(data.gallery.photos).length : 0)
        + (data.providers.mediaStore && data.providers.mediaStore.records ? data.providers.mediaStore.records.length : 0),
      mediaFiles: ctx.items.length,
      mediaBytes: mediaBytes,
      tasks: countMap(data.planner.tasks),
      plannerTasks: data.canonicalTasks && Array.isArray(data.canonicalTasks.tasks) ? data.canonicalTasks.tasks.length : 0,
      journalEntries: countMap(data.journal.journalEntries)
    };
    slim.contents = stats;

    const manifest = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: data.exportedAt,
      media: ctx.items.map(function (it) {
        return {
          id: it.id, path: 'media/' + it.id + '.' + (MEDIA_EXT[it.mime] || 'bin'), mime: it.mime,
          size: it.size, crc32: it.crc, as: it.as, refs: it.refs
        };
      })
    };

    const enc = new TextEncoder();
    const entries = [
      { name: 'backup.json', bytes: enc.encode(JSON.stringify(slim)) },
      { name: 'manifest.json', bytes: enc.encode(JSON.stringify(manifest, null, 1)) }
    ];
    ctx.items.forEach(function (it, i) {
      entries.push({ name: manifest.media[i].path, bytes: it.bytes, crc: it.crc });
    });
    const blob = await zipBuild(entries);
    return { blob: blob, filename: 'lavender-backup-' + new Date().toISOString().slice(0, 10) + '.zip', stats: stats, warnings: warnings };
  }

  // Local file download only, no network call — works fully offline.
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000); // large files: don't revoke before the download starts
  }

  // Returns { ok:true, filename, size, stats, warnings } or { ok:false, error }. Never throws.
  async function downloadExport() {
    try {
      const pkg = await buildPackage();
      triggerDownload(pkg.blob, pkg.filename);
      return { ok: true, filename: pkg.filename, size: pkg.blob.size, stats: pkg.stats, warnings: pkg.warnings };
    } catch (e) {
      const m = e && e.message;
      let error = "The backup couldn't be created.";
      if (m === 'TOO_MANY_FILES' || m === 'TOO_LARGE') error = 'Your library is too large to fit in a single backup file.';
      else if (e instanceof RangeError) error = 'This device ran out of memory while building the backup. Close other tabs or apps and try again.';
      else if (isQuotaError(e)) error = 'There is not enough free space on this device to create the backup.';
      return { ok: false, error: error };
    }
  }

  // ---------------------------------------------------------------------
  // LOW-LEVEL VALIDATION HELPERS
  // ---------------------------------------------------------------------

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function isNonNegNum(v) {
    return isFiniteNum(v) && v >= 0;
  }

  function isValidDateStr(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00');
    return !isNaN(d.getTime());
  }

  function safeParse(jsonText) {
    try { return JSON.parse(jsonText); } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------
  // GENERIC RECORD-COLLECTION CLEANERS (drop individual bad records, never
  // abort the whole restore for one corrupt entry)
  // ---------------------------------------------------------------------

  // id-keyed map, e.g. topics/tasks/targets/subtargets/generalAlarms/assistantNotes.
  // idField: the field inside each record that should equal its own map key (or null to skip
  // that check, e.g. sessionRecords whose internal id field name isn't specified anywhere).
  function cleanIdMap(rawMap, idField, recordValidator) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (key) {
      const rec = rawMap[key];
      if (!isPlainObject(rec)) return;
      if (idField && rec[idField] !== undefined && rec[idField] !== key) return; // key/id mismatch
      if (recordValidator && !recordValidator(rec)) return;
      out[key] = rec;
    });
    return out;
  }

  // date-string-keyed map of single records, e.g. dateHubs/journalEntries/sleepRecords/dailySummaries.
  function cleanDateKeyedMap(rawMap, opts) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    const o = opts || {};
    Object.keys(rawMap).forEach(function (dateStr) {
      if (!isValidDateStr(dateStr)) return;
      const rec = rawMap[dateStr];
      if (!isPlainObject(rec)) return;
      if (o.dateField && rec[o.dateField] !== undefined && rec[o.dateField] !== dateStr) return;
      if (o.recordValidator && !o.recordValidator(rec)) return;
      out[dateStr] = rec;
    });
    return out;
  }

  // date-string-keyed map of arrays, e.g. waterEvents/studyLog. Each date's array is treated as
  // one atomic "record" for merge purposes — bad items inside an array are dropped individually.
  function cleanDateKeyedArrayMap(rawMap, itemValidator) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (dateStr) {
      if (!isValidDateStr(dateStr)) return;
      const arr = rawMap[dateStr];
      if (!Array.isArray(arr)) return;
      out[dateStr] = arr.filter(function (item) {
        return isPlainObject(item) && (!itemValidator || itemValidator(item));
      });
    });
    return out;
  }

  // plain array of id-carrying records, e.g. timeEngineBreaks/expLedger.
  function cleanIdArray(rawArr, idField, itemValidator) {
    const out = [];
    if (!Array.isArray(rawArr)) return out;
    const seen = {};
    rawArr.forEach(function (item) {
      if (!isPlainObject(item)) return;
      const id = item[idField];
      if (id === undefined || id === null || seen[id]) return;
      if (itemValidator && !itemValidator(item)) return;
      seen[id] = true;
      out.push(item);
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // PER-RECORD-TYPE VALIDATORS
  // ---------------------------------------------------------------------

  function validTopic(rec) {
    return typeof rec.topicId === 'string' && rec.topicId.length > 0
      && (rec.tags === undefined || Array.isArray(rec.tags));
  }

  function validTask(rec) {
    if (typeof rec.taskId !== 'string' || !rec.taskId) return false;
    if (rec.date != null && !isValidDateStr(rec.date)) return false;
    if (rec.completedDate != null && !isValidDateStr(rec.completedDate)) return false;
    // PlannerData stores revisionNumber as a label string ('R1'..'R6'); older data may hold a number.
    // Rejecting strings dropped every revision task on restore.
    if (rec.revisionNumber !== undefined && rec.revisionNumber !== null
      && !isNonNegNum(rec.revisionNumber) && typeof rec.revisionNumber !== 'string') return false;
    return true;
  }

  function validTarget(rec) {
    if (typeof rec.targetId !== 'string' || !rec.targetId) return false;
    if (rec.dateKey != null && !isValidDateStr(rec.dateKey)) return false;
    if (rec.targetValue !== undefined && !isNonNegNum(rec.targetValue)) return false;
    if (rec.currentValue !== undefined && !isFiniteNum(rec.currentValue)) return false;
    if (rec.subtargets !== undefined && !Array.isArray(rec.subtargets)) return false;
    return true;
  }

  function validSubtarget(rec) {
    if (typeof rec.subtargetId !== 'string' || !rec.subtargetId) return false;
    if (typeof rec.parentTargetId !== 'string' || !rec.parentTargetId) return false;
    if (rec.targetValue !== undefined && !isNonNegNum(rec.targetValue)) return false;
    if (rec.currentValue !== undefined && !isFiniteNum(rec.currentValue)) return false;
    return true;
  }

  function validSessionRecord() {
    return true; // exact shape isn't specified anywhere; structural (plain-object) check is enough
  }

  function validAlarm() {
    return true; // loosely typed upstream; key/id match is the only structural guarantee available
  }

  function validAssistantNote(rec) {
    if (rec.createdAt != null && isNaN(new Date(rec.createdAt).getTime())) return false;
    return true;
  }

  function validTag(rec) {
    return typeof rec.tagId === 'string' && rec.tagId.length > 0 && typeof rec.name === 'string';
  }

  function validStudyTemplate(rec) {
    return typeof rec.templateId === 'string' && rec.templateId.length > 0 && typeof rec.name === 'string';
  }

  function validTrack(rec) {
    return typeof rec.id === 'string' && rec.id.length > 0 && (rec.source === 'local' || rec.source === 'youtube');
  }

  function validExpEntry(rec) {
    if (rec.id === undefined || rec.id === null) return false;
    // Award/retract pairs are the documented EXP pattern, so a negative delta is legitimate here —
    // only reject non-finite values, not negative ones.
    if (rec.exp !== undefined && !isFiniteNum(rec.exp)) return false;
    if (rec.date != null && !isValidDateStr(rec.date)) return false;
    return true;
  }

  function validBreakRecord(rec) {
    if (rec.id === undefined || rec.id === null) return false;
    if (rec.durationMs !== undefined && !isNonNegNum(rec.durationMs)) return false;
    if (rec.date != null && !isValidDateStr(rec.date)) return false;
    return true;
  }

  function validWaterEvent(rec) {
    if (rec.value !== undefined && !isNonNegNum(rec.value)) return false;
    return true;
  }

  function validSleepRecord(rec) {
    if (rec.durationMin != null && !isNonNegNum(rec.durationMin)) return false;
    return true;
  }

  function validHabit(rec) {
    if (typeof rec.habitId !== 'string' || !rec.habitId) return false;
    if (rec.systemKey != null && rec.systemKey !== 'water' && rec.systemKey !== 'sleep') return false;
    if (rec.type !== undefined && ['binary', 'target', 'counter'].indexOf(rec.type) === -1) return false;
    return true;
  }

  // habitLogs are keyed habitId + '__' + dateStr; the key must match the record's own habitId/date.
  function cleanHabitLogs(rawMap) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (key) {
      const rec = rawMap[key];
      if (!isPlainObject(rec)) return;
      if (typeof rec.habitId !== 'string' || !rec.habitId || !isValidDateStr(rec.date)) return;
      if (key !== rec.habitId + '__' + rec.date) return;
      if (rec.count != null && !isNonNegNum(rec.count)) return;
      out[key] = rec;
    });
    return out;
  }

    // testMarks are keyed by testId (never by date, so same-day tests stay separate). A record needs a valid
  // date, total > 0 and 0 <= obtained <= total; bad subject rows are dropped individually.
  function cleanTestMarks(rawMap) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (key) {
      const rec = rawMap[key];
      if (!isPlainObject(rec) || !isValidDateStr(rec.date)) return;
      if (rec.testId !== undefined && rec.testId !== key) return;
      if (!isFiniteNum(rec.total) || rec.total <= 0 || !isFiniteNum(rec.obtained) || rec.obtained < 0 || rec.obtained > rec.total) return;
      const seen = {};
      const subjects = (Array.isArray(rec.subjects) ? rec.subjects : []).filter(function (s) {
        if (!isPlainObject(s) || typeof s.subject !== 'string' || !s.subject || seen[s.subject]) return false;
        if (!isFiniteNum(s.total) || s.total <= 0 || !isFiniteNum(s.obtained) || s.obtained < 0 || s.obtained > s.total) return false;
        seen[s.subject] = true;
        return true;
      });
      out[key] = Object.assign({}, rec, { testId: key, subjects: subjects });
    });
    return out;
  }

  // dateStr -> media id string
  function cleanCalendarPhotos(rawMap) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (d) {
      if (isValidDateStr(d) && typeof rawMap[d] === 'string' && rawMap[d]) out[d] = rawMap[d];
    });
    return out;
  }

  function validDailySummary(rec) {
    if (rec.studyMs !== undefined && !isNonNegNum(rec.studyMs)) return false;
    if (rec.breakMs !== undefined && !isNonNegNum(rec.breakMs)) return false;
    if (rec.tasksTotal !== undefined && !isNonNegNum(rec.tasksTotal)) return false;
    if (rec.tasksCompleted !== undefined && !isNonNegNum(rec.tasksCompleted)) return false;
    return true;
  }

  function validDateHub(rec) {
    if (rec.studyHours != null && !isNonNegNum(rec.studyHours)) return false;
    return true;
  }

  // Structural check only — MyWorldData/MyWorldContent own their schemas and re-validate every
  // record (world defaults/clamps, content validate(), inventory id rules) when the merge is applied.
  function cleanMyWorld(raw) {
    if (!isPlainObject(raw)) return null;
    return {
      world: isPlainObject(raw.world) ? raw.world : null,
      inventory: isPlainObject(raw.inventory) ? raw.inventory : null,
            definitions: Array.isArray(raw.definitions) ? raw.definitions.filter(isPlainObject) : []
    };
  }

  // Structural check only — Gallery re-validates every folder/photo record when the merge is applied.
  function cleanGallery(raw) {
    if (!isPlainObject(raw)) return null;
    return {
      folders: isPlainObject(raw.folders) ? raw.folders : {},
      photos: isPlainObject(raw.photos) ? raw.photos : {}
    };
  }

  // ---------------------------------------------------------------------
  // FLATTEN + VALIDATE THE PARSED BACKUP
  // ---------------------------------------------------------------------

  function flattenGroups(parsed) {
    const c = isPlainObject(parsed.calendar) ? parsed.calendar : {};
    const p = isPlainObject(parsed.planner) ? parsed.planner : {};
    const tg = isPlainObject(parsed.targets) ? parsed.targets : {};
    const j = isPlainObject(parsed.journal) ? parsed.journal : {};
    const st = isPlainObject(parsed.study) ? parsed.study : {};
    const w = isPlainObject(parsed.water) ? parsed.water : {};
    const sl = isPlainObject(parsed.sleep) ? parsed.sleep : {};
    const hb = isPlainObject(parsed.habits) ? parsed.habits : {};
    const a = isPlainObject(parsed.assistant) ? parsed.assistant : {};
        const al = isPlainObject(parsed.alarms) ? parsed.alarms : {};
    const tm = isPlainObject(parsed.tests) ? parsed.tests : {};
    const ex = isPlainObject(parsed.extras) ? parsed.extras : {};

    return {
      dateHubs: c.dateHubs,
      favoriteTopics: c.favoriteTopics,
      topics: p.topics,
      tasks: p.tasks,
      tags: p.tags,
      tagsMigrated: p.tagsMigrated,
      subjects: p.subjects,
      studyTemplates: st.studyTemplates,
      musicPlaylist: st.musicPlaylist,
      notepadFolders: a.notepadFolders,
      targets: tg.targets,
      subtargets: tg.subtargets,
      journalEntries: j.journalEntries,
      studyClock: st.studyClock,
      timeEngine: st.timeEngine,
      sessionRecords: st.sessionRecords,
      timeEngineBreaks: st.timeEngineBreaks,
      studyLog: st.studyLog,
      waterEvents: w.waterEvents,
      sleepRecords: sl.sleepRecords,
      habits: hb.habits,
      habitLogs: hb.habitLogs,
      habitsMigrated: hb.habitsMigrated,
      expLedger: (isPlainObject(parsed.gamification) ? parsed.gamification.expLedger : undefined),
      assistantNotes: a.assistantNotes,
            generalAlarms: al.generalAlarms,
      testMarks: tm.testMarks,
            myWorld: parsed.myWorld,
      gallery: parsed.gallery,
      dailySummaries: parsed.dailySummaries,
      planningHistory: parsed.planningHistory,
      canonicalTasks: parsed.canonicalTasks,
      providers: parsed.providers,
      calendarPhotos: ex.calendarPhotos,
      itineraryTemplates: ex.itineraryTemplates,
      dailyItinerarySummaries: ex.dailyItinerarySummaries
    };
  }

  // Returns { ok:false, error } for a structurally unrecognizable backup (nothing is written), or
  // { ok:true, exportedAt, cleaned } where `cleaned` holds only individually-valid records — bad
  // individual records are silently dropped rather than failing the whole restore.
  function validateAndClean(parsed) {
    if (!isPlainObject(parsed)) {
      return { ok: false, error: "That file isn't valid backup JSON." };
    }
    const schemaVersion = (typeof parsed.schemaVersion === 'number') ? parsed.schemaVersion
      : (typeof parsed.version === 'number' ? parsed.version : null);
    if (schemaVersion === null) {
      return { ok: false, error: "That file isn't a recognized Lavender backup." };
    }
    if (schemaVersion > SCHEMA_VERSION) {
      return { ok: false, error: "This backup is from a newer version of Lavender and can't be restored here." };
    }
    if (typeof parsed.exportedAt !== 'string' || isNaN(new Date(parsed.exportedAt).getTime())) {
      return { ok: false, error: "That file isn't a recognized Lavender backup." };
    }

    const flat = flattenGroups(parsed);
    const cleaned = {
      dateHubs: cleanDateKeyedMap(flat.dateHubs, { recordValidator: validDateHub }),
      topics: cleanIdMap(flat.topics, 'topicId', validTopic),
      tasks: cleanIdMap(flat.tasks, 'taskId', validTask),
      targets: cleanIdMap(flat.targets, 'targetId', validTarget),
      subtargets: cleanIdMap(flat.subtargets, 'subtargetId', validSubtarget),
      journalEntries: cleanDateKeyedMap(flat.journalEntries, {}),
      sessionRecords: cleanIdMap(flat.sessionRecords, null, validSessionRecord),
      timeEngineBreaks: cleanIdArray(flat.timeEngineBreaks, 'id', validBreakRecord),
      studyLog: cleanDateKeyedArrayMap(flat.studyLog, null),
      waterEvents: cleanDateKeyedArrayMap(flat.waterEvents, validWaterEvent),
      sleepRecords: cleanDateKeyedMap(flat.sleepRecords, { dateField: 'date', recordValidator: validSleepRecord }),
      habits: cleanIdMap(flat.habits, 'habitId', validHabit),
            habitLogs: cleanHabitLogs(flat.habitLogs),
      testMarks: cleanTestMarks(flat.testMarks),
      habitsMigrated: typeof flat.habitsMigrated === 'boolean' ? flat.habitsMigrated : undefined,
      dailySummaries: cleanDateKeyedMap(flat.dailySummaries, { dateField: 'date', recordValidator: validDailySummary }),
      planningHistory: isPlainObject(flat.planningHistory) ? flat.planningHistory : {},
      generalAlarms: cleanIdMap(flat.generalAlarms, 'id', validAlarm),
      assistantNotes: cleanIdMap(flat.assistantNotes, 'id', validAssistantNote),
      expLedger: cleanIdArray(flat.expLedger, 'id', validExpEntry),
      favoriteTopics: Array.isArray(flat.favoriteTopics)
        ? flat.favoriteTopics.filter(function (id) { return typeof id === 'string'; })
        : [],
      tags: cleanIdMap(flat.tags, 'tagId', validTag),
      tagsMigrated: typeof flat.tagsMigrated === 'boolean' ? flat.tagsMigrated : undefined,
      subjects: cleanSubjects(flat.subjects),
      studyTemplates: cleanIdMap(flat.studyTemplates, 'templateId', validStudyTemplate),
      // Local File objects can't survive a backup — same rule as player.js init: mark them unavailable.
      musicPlaylist: cleanIdArray(flat.musicPlaylist, 'id', validTrack).map(function (t) {
        return t.source === 'local' ? Object.assign({}, t, { available: false, fileObj: null }) : t;
      }),
      notepadFolders: Array.isArray(flat.notepadFolders)
        ? flat.notepadFolders.filter(function (f) { return typeof f === 'string' && f.trim().length > 0; })
        : [],
            myWorld: cleanMyWorld(flat.myWorld),
      gallery: cleanGallery(flat.gallery),
      // Optional v3 fields — absent in v1/v2 backups. Their owners re-validate every record on merge.
      canonicalTasks: (isPlainObject(flat.canonicalTasks) && Array.isArray(flat.canonicalTasks.tasks)) ? flat.canonicalTasks : null,
      providers: isPlainObject(flat.providers) ? flat.providers : {},
      calendarPhotos: cleanCalendarPhotos(flat.calendarPhotos),
      itineraryTemplates: cleanIdMap(flat.itineraryTemplates, null, null),
      dailyItinerarySummaries: cleanDateKeyedMap(flat.dailyItinerarySummaries, {})
    };

    return { ok: true, schemaVersion: schemaVersion, exportedAt: parsed.exportedAt, cleaned: cleaned };
  }

  // Subjects are plain strings. Returns a cleaned, de-duplicated (case-insensitive, first spelling
  // wins) array, or undefined when the backup carries no usable list (older backups, or null =
  // "never customised"), in which case restore leaves the live subjects alone.
  function cleanSubjects(raw) {
    if (!Array.isArray(raw)) return undefined;
    const seen = {};
    const out = [];
    raw.forEach(function (name) {
      if (typeof name !== 'string') return;
      const clean = name.replace(/\s+/g, ' ').trim();
      if (!clean || seen[clean.toLowerCase()]) return;
      seen[clean.toLowerCase()] = true;
      out.push(clean);
    });
    return out;
  }

  // The active-subject list is configuration, so (like settings) a customised live list is never
  // overwritten. If the live app has never customised subjects (null), the backup's list is adopted
  // — plus any custom subject the live app was already showing — so a restore into a clean or legacy
  // install keeps the backed-up subjects (renames and deletions included) instead of falling back to
  // Biology/Physics/Chemistry. A backup with no list leaves live untouched.
  function mergeSubjects(backupSubjects, cur) {
    if (Array.isArray(cur.subjects)) return cur.subjects;
    if (!Array.isArray(backupSubjects)) return cur.subjects === undefined ? null : cur.subjects;
    const merged = backupSubjects.slice();
    const have = {};
    merged.forEach(function (n) { have[n.toLowerCase()] = true; });
    if (typeof PlannerData !== 'undefined' && PlannerData.getAllSubjects) {
      const defaults = (PlannerData.DEFAULT_SUBJECTS || []).map(function (n) { return n.toLowerCase(); });
      PlannerData.getAllSubjects().forEach(function (n) {
        const key = n.toLowerCase();
        if (defaults.indexOf(key) !== -1 || have[key]) return; // live-only defaults are not forced back in
        have[key] = true;
        merged.push(n);
      });
    }
    return merged;
  }

  // ---------------------------------------------------------------------
  // MERGE (current/live always wins on a same-ID conflict; backup-only
  // records are added; live-only records are preserved)
  // ---------------------------------------------------------------------

  function mergeIdMap(backupMap, liveMap) {
    return Object.assign({}, backupMap || {}, liveMap || {});
  }

  function mergeIdArrayById(backupArr, liveArr, idField) {
    const map = {};
    (backupArr || []).forEach(function (item) { map[item[idField]] = item; });
    (liveArr || []).forEach(function (item) { map[item[idField]] = item; }); // live overwrites on same id
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // Builds one complete object covering every State defaultState key. Runtime session state is
  // always forced idle. Singleton config/settings/gamification-total fields always keep the live
  // value — a restore never silently changes those. Tasks/subtargets referencing a topic/target
  // that doesn't exist anywhere after merging are dropped rather than creating an orphan.
  function buildMergedState(v, cur) {
    const c = v.cleaned;

    const mergedTopics = mergeIdMap(c.topics, cur.topics);
    const mergedTargets = mergeIdMap(c.targets, cur.targets);

    const backupOnlyTasks = {};
    Object.keys(c.tasks || {}).forEach(function (id) {
      if (cur.tasks && Object.prototype.hasOwnProperty.call(cur.tasks, id)) return; // live wins, untouched
      const t = c.tasks[id];
      if (!t.topicId || mergedTopics[t.topicId]) backupOnlyTasks[id] = t; // else: orphaned, drop
    });
    const mergedTasks = Object.assign({}, backupOnlyTasks, cur.tasks || {});

    const backupOnlySubtargets = {};
    Object.keys(c.subtargets || {}).forEach(function (id) {
      if (cur.subtargets && Object.prototype.hasOwnProperty.call(cur.subtargets, id)) return;
      const st = c.subtargets[id];
      if (mergedTargets[st.parentTargetId]) backupOnlySubtargets[id] = st; // else: orphaned, drop
    });
    const mergedSubtargets = Object.assign({}, backupOnlySubtargets, cur.subtargets || {});

    const mergedFavoriteTopics = Array.from(new Set([].concat(cur.favoriteTopics || [], c.favoriteTopics || [])))
      .filter(function (id) { return !!mergedTopics[id]; });

    // Study templates: the live Pomodoro default always wins — a second isPomodoroDefault record
    // would be undeletable (deleteTemplate refuses defaults), so a backup's default is skipped
    // whenever the live state already has one.
    const liveTemplates = cur.studyTemplates || {};
    const liveHasDefaultTemplate = Object.keys(liveTemplates).some(function (id) {
      return liveTemplates[id] && liveTemplates[id].isPomodoroDefault;
    });
    const backupTemplates = {};
    Object.keys(c.studyTemplates || {}).forEach(function (id) {
      if (liveHasDefaultTemplate && c.studyTemplates[id].isPomodoroDefault) return;
      backupTemplates[id] = c.studyTemplates[id];
    });

    // Playlist order matters: live tracks keep their order, backup-only tracks are appended.
    const livePlaylist = cur.musicPlaylist || [];
    const livePlaylistIds = {};
    livePlaylist.forEach(function (t) { livePlaylistIds[t.id] = true; });
    const mergedPlaylist = livePlaylist.concat((c.musicPlaylist || []).filter(function (t) { return !livePlaylistIds[t.id]; }));

    // Habits: live wins per habit / per log; backup-only records are added. A backup-only log whose
    // habit exists nowhere after merging is orphaned and dropped (same rule as tasks/subtargets).
    const mergedHabits = mergeIdMap(c.habits, cur.habits);
    const backupOnlyHabitLogs = {};
    Object.keys(c.habitLogs || {}).forEach(function (key) {
      if (cur.habitLogs && Object.prototype.hasOwnProperty.call(cur.habitLogs, key)) return; // live wins
      const log = c.habitLogs[key];
      if (mergedHabits[log.habitId]) backupOnlyHabitLogs[key] = log;
    });
    const mergedHabitLogs = Object.assign({}, backupOnlyHabitLogs, cur.habitLogs || {});
    // An older (un-migrated) backup that brings legacy Water/Sleep records the live archive lacks
    // reopens the migration flag. HabitData.init() then folds them in (idempotent: event-id dedup,
    // existing habit logs win). Nothing is converted here, so nothing is duplicated.
    const backupBringsLegacy = c.habitsMigrated !== true
      && (countAdditions(c.waterEvents, cur.waterEvents) > 0 || countAdditions(c.sleepRecords, cur.sleepRecords) > 0);

    // Base = live state, so keys this merge doesn't handle (runtime itinerary/candle/weather state, future keys)
    // keep their live value instead of being reset to defaults by State.replace().
    return Object.assign({}, cur, {
      currentScreen: cur.currentScreen,
      dateHubs: mergeIdMap(c.dateHubs, cur.dateHubs),
      studyStreak: cur.studyStreak,
      topics: mergedTopics,
      tasks: mergedTasks,
      journalEntries: mergeIdMap(c.journalEntries, cur.journalEntries),
      journalPasswordHash: cur.journalPasswordHash,
      journalLocked: cur.journalLocked,
      studyClock: Object.assign({}, DEFAULT_IDLE_STUDY_CLOCK), // always reset — never resume a session
      timeEngine: null, // always reset
      sessionRecords: mergeIdMap(c.sessionRecords, cur.sessionRecords),
      timeEngineBreaks: mergeIdArrayById(c.timeEngineBreaks, cur.timeEngineBreaks, 'id'),
      dailySummaries: mergeIdMap(c.dailySummaries, cur.dailySummaries),
      planningHistory: mergeIdMap(c.planningHistory, cur.planningHistory),
      studyLog: mergeIdMap(c.studyLog, cur.studyLog),
      favoriteTopics: mergedFavoriteTopics,
      waterEvents: mergeIdMap(c.waterEvents, cur.waterEvents),
      waterReminder: cur.waterReminder,
      sleepRecords: mergeIdMap(c.sleepRecords, cur.sleepRecords),
      habits: mergedHabits,
            habitLogs: mergedHabitLogs,
      testMarks: mergeIdMap(c.testMarks, cur.testMarks), // live wins per testId; backup-only tests are added
      habitsMigrated: cur.habitsMigrated === true && !backupBringsLegacy,
      generalAlarms: mergeIdMap(c.generalAlarms, cur.generalAlarms),
      assistantNotes: mergeIdMap(c.assistantNotes, cur.assistantNotes),
      gamification: cur.gamification,
      expLedger: mergeIdArrayById(c.expLedger, cur.expLedger, 'id'),
      settings: cur.settings,
      targets: mergedTargets,
      subtargets: mergedSubtargets,
      tags: mergeIdMap(c.tags, cur.tags),
      // If either side hasn't run the legacy-tag migration, leave it false so it re-runs (idempotent).
      tagsMigrated: cur.tagsMigrated === true && c.tagsMigrated !== false,
      subjects: mergeSubjects(c.subjects, cur),
      studyTemplates: mergeIdMap(backupTemplates, liveTemplates),
      musicPlaylist: mergedPlaylist,
      notepadFolders: Array.from(new Set([].concat(cur.notepadFolders || [], c.notepadFolders || []))),
      calendarPhotos: mergeIdMap(c.calendarPhotos, cur.calendarPhotos),
      itineraryTemplates: mergeIdMap(c.itineraryTemplates, cur.itineraryTemplates),
      dailyItinerarySummaries: mergeIdMap(c.dailyItinerarySummaries, cur.dailyItinerarySummaries)
    });
  }

  function countAdditions(cleanedMap, curMap) {
    let added = 0;
    Object.keys(cleanedMap || {}).forEach(function (k) {
      if (!curMap || !Object.prototype.hasOwnProperty.call(curMap, k)) added++;
    });
    return added;
  }

  function countArrayAdditions(cleanedArr, curArr, idField) {
    const curIds = {};
    (curArr || []).forEach(function (i) { curIds[i[idField]] = true; });
    let added = 0;
    (cleanedArr || []).forEach(function (i) { if (!curIds[i[idField]]) added++; });
    return added;
  }

  function summarizeApplied(v, cur) {
    const c = v.cleaned;
    return {
      topicsAdded: countAdditions(c.topics, cur.topics),
      tasksAdded: countAdditions(c.tasks, cur.tasks),
      targetsAdded: countAdditions(c.targets, cur.targets),
      subtargetsAdded: countAdditions(c.subtargets, cur.subtargets),
      dateHubsAdded: countAdditions(c.dateHubs, cur.dateHubs),
      journalEntriesAdded: countAdditions(c.journalEntries, cur.journalEntries),
      sessionRecordsAdded: countAdditions(c.sessionRecords, cur.sessionRecords),
      timeEngineBreaksAdded: countArrayAdditions(c.timeEngineBreaks, cur.timeEngineBreaks, 'id'),
      dailySummariesAdded: countAdditions(c.dailySummaries, cur.dailySummaries),
      sleepRecordsAdded: countAdditions(c.sleepRecords, cur.sleepRecords),
      generalAlarmsAdded: countAdditions(c.generalAlarms, cur.generalAlarms),
      assistantNotesAdded: countAdditions(c.assistantNotes, cur.assistantNotes),
            expLedgerAdded: countArrayAdditions(c.expLedger, cur.expLedger, 'id'),
      testMarksAdded: countAdditions(c.testMarks, cur.testMarks)
    };
  }

  // ---------------------------------------------------------------------
  // SUMMARY / COMPARE (non-persisted, read-only — safe to call repeatedly
  // without ever touching State)
  // ---------------------------------------------------------------------

  function countMap(m) { return m ? Object.keys(m).length : 0; }

  function extractSessionDate(rec) {
    const candidates = ['date', 'plannedDate', 'day', 'startedAt', 'createdAt'];
    for (let i = 0; i < candidates.length; i++) {
      const v = rec[candidates[i]];
      if (typeof v === 'string' && v.length >= 10) return v.slice(0, 10);
    }
    return null;
  }

  function computeDateRange(dateList) {
    let from = null, to = null;
    dateList.forEach(function (d) {
      if (!d) return;
      if (from === null || d < from) from = d;
      if (to === null || d > to) to = d;
    });
    return from === null ? null : { from: from, to: to };
  }

  function computeSummary(v, cur) {
    const c = v.cleaned;
    return {
      exportedAt: v.exportedAt,
      counts: {
        topics: countMap(c.topics),
        tasks: countMap(c.tasks),
        targets: countMap(c.targets),
        journalEntries: countMap(c.journalEntries),
        alarms: countMap(c.generalAlarms),
        sessions: countMap(c.sessionRecords)
      },
      sessionDateRange: computeDateRange(
        Object.keys(c.sessionRecords || {}).map(function (id) { return extractSessionDate(c.sessionRecords[id]); })
      ),
      journalDateRange: computeDateRange(Object.keys(c.journalEntries || {})),
      willChange: summarizeApplied(v, cur)
    };
  }

  function compareMaps(cleanedMap, curMap) {
    cleanedMap = cleanedMap || {};
    curMap = curMap || {};
    let onlyBackup = 0, onlyLive = 0, both = 0, conflicts = 0;
    const allKeys = new Set(Object.keys(cleanedMap).concat(Object.keys(curMap)));
    allKeys.forEach(function (k) {
      const inB = Object.prototype.hasOwnProperty.call(cleanedMap, k);
      const inL = Object.prototype.hasOwnProperty.call(curMap, k);
      if (inB && inL) {
        both++;
        if (JSON.stringify(cleanedMap[k]) !== JSON.stringify(curMap[k])) conflicts++;
      } else if (inB) {
        onlyBackup++;
      } else {
        onlyLive++;
      }
    });
    return { onlyInBackup: onlyBackup, onlyInLive: onlyLive, inBoth: both, conflicts: conflicts };
  }

  function compareArraysById(cleanedArr, curArr, idField) {
    const b = {}, l = {};
    (cleanedArr || []).forEach(function (i) { b[i[idField]] = i; });
    (curArr || []).forEach(function (i) { l[i[idField]] = i; });
    return compareMaps(b, l);
  }

  function computeCompare(v, cur) {
    const c = v.cleaned;
    return {
      exportedAt: v.exportedAt,
      topics: compareMaps(c.topics, cur.topics),
      tasks: compareMaps(c.tasks, cur.tasks),
      targets: compareMaps(c.targets, cur.targets),
      subtargets: compareMaps(c.subtargets, cur.subtargets),
      sessionRecords: compareMaps(c.sessionRecords, cur.sessionRecords),
      timeEngineBreaks: compareArraysById(c.timeEngineBreaks, cur.timeEngineBreaks, 'id'),
      dateHubs: compareMaps(c.dateHubs, cur.dateHubs),
      journalEntries: compareMaps(c.journalEntries, cur.journalEntries),
      sleepRecords: compareMaps(c.sleepRecords, cur.sleepRecords),
      dailySummaries: compareMaps(c.dailySummaries, cur.dailySummaries),
      waterEvents: compareMaps(c.waterEvents, cur.waterEvents),
      studyLog: compareMaps(c.studyLog, cur.studyLog),
      generalAlarms: compareMaps(c.generalAlarms, cur.generalAlarms),
      assistantNotes: compareMaps(c.assistantNotes, cur.assistantNotes),
            expLedger: compareArraysById(c.expLedger, cur.expLedger, 'id'),
      testMarks: compareMaps(c.testMarks, cur.testMarks),
      liveWinsOnConflict: true
    };
  }

  // Parses + validates without touching State — use to render a Summary/Compare confirmation
  // screen before the user commits to restoreFromJson().
  function inspectBackup(jsonText) {
    const parsed = safeParse(jsonText);
    if (parsed === null) return { ok: false, error: "That file isn't valid backup JSON." };
    const v = validateAndClean(parsed);
    if (!v.ok) return { ok: false, error: v.error };
    const cur = State.get();
    return { ok: true, exportedAt: v.exportedAt, summary: computeSummary(v, cur), compare: computeCompare(v, cur) };
  }

  function getSummary(jsonText) {
    const r = inspectBackup(jsonText);
    if (!r.ok) return r;
    return { ok: true, exportedAt: r.exportedAt, summary: r.summary };
  }

  function getCompare(jsonText) {
    const r = inspectBackup(jsonText);
    if (!r.ok) return r;
    return { ok: true, exportedAt: r.exportedAt, compare: r.compare };
  }

  // ---------------------------------------------------------------------
  // RESTORE
  // ---------------------------------------------------------------------

  function isRestoring() {
    return _restoring;
  }

  // Defensive, best-effort post-restore hooks. Every call is guarded so this never throws just
  // because a given module isn't loaded/available; each screen's own render()/init() is assumed
  // idempotent per the project's existing "no duplicate listeners on re-render" rule, so calling
  // it again here does not itself introduce duplicate listeners or subscriptions.
  function runPostRestoreHooks() {
    // Habits: re-run the existing idempotent init (ensureSystemHabits + migrateLegacy) so a restored
    // legacy Water/Sleep archive is folded in when the flag was reopened, before screens re-render.
    if (typeof HabitData !== 'undefined' && typeof HabitData.init === 'function') {
      try { HabitData.init(); } catch (e) { /* idempotent; retries on next app load */ }
    }
    if (typeof Nav !== 'undefined' && typeof Nav.switchTo === 'function') {
      const screen = State.get().currentScreen;
      if (screen) Nav.switchTo(screen);
    }
    ['Library', 'Calendar', 'Study', 'Progress', 'Journal'].forEach(function (modName) {
      const mod = (typeof window !== 'undefined') ? window[modName] : undefined;
      if (mod && typeof mod.render === 'function') {
        try { mod.render(); } catch (e) { /* one screen failing to re-render shouldn't break restore */ }
      }
    });
    if (typeof TimeEngine !== 'undefined') {
      if (typeof TimeEngine.reinit === 'function') TimeEngine.reinit();
      else if (typeof TimeEngine.init === 'function') TimeEngine.init();
      if (typeof TimeEngine.stop === 'function') TimeEngine.stop();
    }
  }

  // Merges the backup's My World data through its own modules (it isn't part of State). Runs right
  // after State.replace(), which rebuilds State from defaults and would otherwise drop the myWorld
  // mirror that MyWorldData.persist() writes. Best-effort: a My World failure never undoes the rest
  // of an already-applied restore. Returns a promise that always resolves, once any restored
  // content packs have been written to their IndexedDB store.
  function restoreMyWorld(mw) {
    let settled = Promise.resolve(true);
    if (!mw || typeof MyWorldData === 'undefined' || typeof MyWorldContent === 'undefined') return settled;
    try {
      if (mw.world) MyWorldData.mergeBackupWorld(mw.world);
    } catch (e) { /* leave the live world untouched */ }
    try {
      settled = MyWorldContent.mergeBackup(mw).settled;
    } catch (e) { /* leave the live inventory untouched */ }
        return settled;
  }

  // ---- opening a backup file (validation happens here, before anything live is touched) ----

  function emptyReport() {
    return { total: 0, ok: 0, bytes: 0, missing: [], corrupt: [], unsupported: [], duplicates: 0 };
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function mediaWarnings(r) {
    const w = [];
    if (r.missing.length) w.push(plural(r.missing.length, 'media file') + ' listed in the backup could not be found in the ZIP and will be skipped.');
    if (r.corrupt.length) w.push(plural(r.corrupt.length, 'media file') + ' failed the integrity check and will be skipped.');
    if (r.unsupported.length) w.push(plural(r.unsupported.length, 'media file') + ' use an unsupported type or compression and will be skipped.');
    if (r.duplicates) w.push(plural(r.duplicates, 'duplicate media entry') + ' ignored.');
    return w;
  }

  function stripBom(text) { return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

  function openJsonText(text) {
    const parsed = safeParse(stripBom(String(text)));
    if (parsed === null) return { ok: false, error: "That file isn't a valid Lavender backup." };
    return { ok: true, format: 'json', parsed: parsed, media: {}, report: emptyReport() };
  }

  // Fallback when manifest.json is missing/unreadable: derive the media list from media/<id>.<ext> names.
  function deriveMediaList(z) {
    const out = [];
    Object.keys(z.entries).forEach(function (n) {
      const m = /^media\/([^/]+?)(?:\.([A-Za-z0-9]+))?$/.exec(n);
      if (m) out.push({ id: m[1], path: n, mime: EXT_MIME[(m[2] || '').toLowerCase()] || 'application/octet-stream', as: 'dataUrl' });
    });
    return out;
  }

  // Accepts a ZIP package (v3) or a plain JSON backup (v1/v2). Returns { ok:false, error } or
  // { ok:true, format, parsed, media, report, notes }. Reads and verifies every media file up front.
  async function openFile(file) {
    let buf;
    try { buf = await file.arrayBuffer(); } catch (e) {
      return { ok: false, error: "Couldn't read that file. It may be too large for this device's memory." };
    }
    const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (!(head.length === 2 && head[0] === 0x50 && head[1] === 0x4B)) {
      return openJsonText(new TextDecoder('utf-8').decode(buf));
    }
    let z;
    try { z = zipOpen(buf); } catch (e) {
      return { ok: false, error: "That ZIP file is damaged or isn't a Lavender backup." };
    }
    if (!z.entries['backup.json']) return { ok: false, error: "That ZIP isn't a Lavender backup (backup.json is missing)." };
    const dec = new TextDecoder('utf-8');
    let parsed;
    try { parsed = safeParse(stripBom(dec.decode(await zipFile(z, 'backup.json')))); } catch (e) { parsed = null; }
    if (parsed === null) return { ok: false, error: 'The backup data inside this ZIP is damaged and cannot be read.' };

    const notes = [];
    let list = null;
    if (z.entries['manifest.json']) {
      try {
        const mf = safeParse(dec.decode(await zipFile(z, 'manifest.json')));
        if (isPlainObject(mf) && Array.isArray(mf.media)) list = mf.media;
      } catch (e) { /* fall through to derived list */ }
    }
    if (!list) {
      list = deriveMediaList(z);
      notes.push('The backup manifest was missing or damaged; photos were matched using their file names.');
    }

    const report = emptyReport();
    const media = {};
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!isPlainObject(m) || typeof m.id !== 'string' || typeof m.path !== 'string') continue;
      report.total++;
      if (Object.prototype.hasOwnProperty.call(media, m.id)) { report.duplicates++; continue; }
      if (typeof m.mime !== 'string' || !MEDIA_MIME_RE.test(m.mime)) { report.unsupported.push(m.id); continue; }
      if (!z.entries[m.path]) { report.missing.push(m.id); continue; }
      if (typeof m.crc32 === 'number' && m.crc32 !== z.entries[m.path].crc) { report.corrupt.push(m.id); continue; }
      let bytes;
      try { bytes = await zipFile(z, m.path); } catch (e) {
        (e && e.message === 'UNSUPPORTED_COMPRESSION' ? report.unsupported : report.corrupt).push(m.id);
        continue;
      }
      media[m.id] = { mime: m.mime.toLowerCase(), as: m.as === 'blob' ? 'blob' : 'dataUrl', bytes: bytes };
      report.ok++;
      report.bytes += bytes.length;
    }
    return { ok: true, format: 'zip', parsed: parsed, media: media, report: report, notes: notes };
  }

  function galleryStats(g, media) {
    const out = { total: 0, restorable: 0, added: 0 };
    if (!g) return out;
    const live = (typeof Gallery !== 'undefined' && typeof Gallery.exportBackup === 'function') ? Gallery.exportBackup() : null;
    Object.keys(g.photos).forEach(function (id) {
      const src = isPlainObject(g.photos[id]) ? g.photos[id].src : null;
      out.total++;
      const ok = typeof src === 'string' ? src.indexOf('data:image/') === 0
        : (isPlainObject(src) && typeof src.$media === 'string' && !!media[src.$media]);
      if (!ok) return;
      out.restorable++;
      if (!live || !live.photos || !live.photos[id]) out.added++;
    });
    return out;
  }

  // Validates an opened backup and builds the preview. Touches nothing live.
  async function inspectPackage(pkg) {
    const v = validateAndClean(pkg.parsed);
    if (!v.ok) return { ok: false, error: v.error };
    const cur = State.get();
    const summary = computeSummary(v, cur);
    const compare = computeCompare(v, cur);
    const g = galleryStats(v.cleaned.gallery, pkg.media);
    const ct = v.cleaned.canonicalTasks;
    let liveIds = {};
    if (ct && typeof CanonicalTaskStore !== 'undefined' && typeof CanonicalTaskStore.exportBackup === 'function') {
      try { CanonicalTaskStore.exportBackup().tasks.forEach(function (t) { liveIds[t.id] = true; }); } catch (e) { liveIds = {}; }
    }
    summary.counts.photos = g.restorable;
    summary.counts.mediaFiles = pkg.report.ok;
    summary.counts.plannerTasks = ct ? ct.tasks.length : 0;
    summary.willChange.photosAdded = g.added;
    summary.willChange.plannerTasksAdded = ct ? ct.tasks.filter(function (t) { return t && !liveIds[t.id]; }).length : 0;
    const mp = pkg.parsed.providers && pkg.parsed.providers.mediaStore;
    const liveKeys = {};
    try { (await mediaStoreOp('readonly', function (st) { return st.getAllKeys(); })).forEach(function (k) { liveKeys[k] = true; }); } catch (e) { /* unknown: count all as new */ }
    (mp && Array.isArray(mp.records) ? mp.records : []).forEach(function (r) {
      const ref = r && r.blob && r.blob.$media;
      if (typeof ref !== 'string' || !pkg.media[ref]) return;
      summary.counts.photos++;
      if (!liveKeys[r.id]) summary.willChange.photosAdded++;
    });
    const warnings = (pkg.notes || []).concat(mediaWarnings(pkg.report));
    if (g.total > g.restorable) warnings.push(plural(g.total - g.restorable, 'photo') + " can't be restored because the image data is missing or damaged.");
    if (v.schemaVersion < SCHEMA_VERSION) warnings.push('This backup uses an older format (v' + v.schemaVersion + ') and will be upgraded automatically.');
    return { ok: true, exportedAt: v.exportedAt, schemaVersion: v.schemaVersion, format: pkg.format, summary: summary, compare: compare, warnings: warnings, pkg: pkg };
  }

  async function inspectFile(file) {
    const pkg = await openFile(file);
    return pkg.ok ? inspectPackage(pkg) : pkg;
  }

  // ---- restore ----

  // Returns { ok:false, error } or { ok:true, summary, warnings }. Never throws. Order: stores with atomic
  // writes first (Gallery, providers, planner tasks), then State (the single in-memory-built object), then My
  // World. If any step fails, the steps already applied are rolled back, so a failed restore leaves live data as it
  // was. The merge rule is unchanged: live data wins on id conflict, backup-only records are added.
  async function restorePackage(pkg) {
    if (_restoring) return { ok: false, error: 'A restore is already in progress.' };
    if (!pkg || !pkg.ok || !pkg.parsed) return { ok: false, error: 'There is no backup to restore.' };
    _restoring = true;
    const undos = [];
    async function abort(message) {
      let clean = true;
      for (let i = undos.length - 1; i >= 0; i--) {
        try { if ((await undos[i]()) === false) clean = false; } catch (e) { clean = false; }
      }
      return { ok: false, error: message + (clean ? ' No changes were made.' : ' Some imported items may remain on this device; restoring the same backup again is safe.') };
    }
    try {
      const v = validateAndClean(rehydrate(pkg.parsed, pkg.media || {}, {}, { unresolved: 0 }));
      if (!v.ok) return { ok: false, error: v.error };
      const c = v.cleaned;
      const cur = State.get();
      const summary = summarizeApplied(v, cur);
      const merged = buildMergedState(v, cur); // pure, in memory
      const snapshot = Object.assign({}, cur);
      const warnings = mediaWarnings(pkg.report || emptyReport());

      // 1. Gallery (one IndexedDB transaction)
      if (c.gallery && (Object.keys(c.gallery.photos).length || Object.keys(c.gallery.folders).length)) {
        if (typeof Gallery === 'undefined' || typeof Gallery.mergeBackup !== 'function') {
          warnings.push('The gallery is not available, so the photos in this backup were not restored.');
        } else {
          const r = await Gallery.mergeBackup(c.gallery).settled;
          if (!r.ok) return await abort(r.quota ? QUOTA_MSG : (r.error || 'The gallery could not be restored.'));
          undos.push(function () { return Gallery.rollbackBackup(r); });
          summary.photosAdded = r.addedPhotos.length;
          if (r.invalid) warnings.push(plural(r.invalid, 'photo') + " could not be restored because the image data is missing or damaged.");
        }
      }
      // 2. Registered providers
      const wanted = wantedMediaIds(merged);
      const results = {};
      for (let i = 0; i < providers.length; i++) {
        const p = providers[i];
        if (c.providers[p.key] === undefined && !p.always) continue;
        let r;
        try { r = await p.restore(c.providers[p.key], { merged: merged, wanted: wanted }); } catch (e) { r = { ok: false, quota: isQuotaError(e) }; }
        if (!r || r.ok === false) return await abort(r && r.quota ? QUOTA_MSG : '"' + (p.label || p.key) + '" could not be restored.');
        results[p.key] = r;
        if (typeof p.undo === 'function') undos.push(function () { return p.undo(r); });
      }
      const ms = results.mediaStore;
      if (ms) {
        // Drop restored calendar-photo mappings whose image isn't available, rather than leave dangling ids.
        const present = {};
        (ms.present || []).forEach(function (id) { present[id] = true; });
        Object.keys(merged.calendarPhotos || {}).forEach(function (d) {
          if (!(cur.calendarPhotos && cur.calendarPhotos[d]) && !present[merged.calendarPhotos[d]]) delete merged.calendarPhotos[d];
        });
        summary.mediaAdded = ms.added.length;
        if (ms.missing) warnings.push(plural(ms.missing, 'journal or calendar photo') + ' could not be restored: the image data is unavailable.');
      }
      // 3. Planner tasks (one localStorage write)
      if (c.canonicalTasks && typeof CanonicalTaskStore !== 'undefined' && typeof CanonicalTaskStore.mergeBackup === 'function') {
        const r = CanonicalTaskStore.mergeBackup(c.canonicalTasks);
        if (!r.ok) return await abort('Planner tasks could not be saved (storage may be full).');
        undos.push(function () { return CanonicalTaskStore.rollbackBackup(r); });
        summary.plannerTasksAdded = r.added.length;
      }
      // 4. State
      let stateOk = true, stateErr = null;
      try { State.replace(merged); stateOk = persistedMatches(); } catch (e) { stateOk = false; stateErr = e; }
      if (!stateOk) {
        try { State.replace(snapshot); } catch (e2) { /* nothing more to do */ }
        return await abort(!stateErr || isQuotaError(stateErr) ? QUOTA_MSG : 'Your data could not be saved.');
      }
      // 5. My World (own storage; must run after State.replace — see restoreMyWorld). Best-effort.
      await restoreMyWorld(c.myWorld);
      runPostRestoreHooks();
      return { ok: true, summary: summary, warnings: warnings };
    } catch (e) {
      return await abort('Restore failed unexpectedly.');
    } finally {
      _restoring = false;
    }
  }

  // Legacy entry point (plain JSON text, schema v1/v2). Now async.
  async function restoreFromJson(jsonText) {
    const pkg = openJsonText(jsonText);
    return pkg.ok ? restorePackage(pkg) : pkg;
  }

  function clearAllData() {
    State.clear();
    // My World persists outside State's appState key: world ('lavender.myWorld.v*') and inventory
    // ('lavender.myWorld.inventory.v*') each live in their own localStorage key.
    try {
      const myWorldKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('lavender.myWorld.') === 0) myWorldKeys.push(k);
      }
      myWorldKeys.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { /* localStorage unavailable — nothing to clear */ }
    // The planner's canonical task store has its own localStorage key.
    if (typeof CanonicalTaskStore !== 'undefined' && typeof CanonicalTaskStore.clearAll === 'function') {
      try { CanonicalTaskStore.clearAll(); } catch (e) { /* best-effort */ }
    }
    providers.forEach(function (p) {
      if (typeof p.clear === 'function') { try { Promise.resolve(p.clear()).catch(function () { /* best-effort */ }); } catch (e) { /* best-effort */ } }
    });
    // Gallery persists in its own IndexedDB store.
    if (typeof Gallery !== 'undefined' && typeof Gallery.clearAll === 'function') {
      try { Gallery.clearAll(); } catch (e) { /* best-effort */ }
    }
  }

  return {
    downloadExport: downloadExport,
    exportJson: exportJson,
    restoreFromJson: restoreFromJson,
    restorePackage: restorePackage,
    inspectFile: inspectFile,
    registerProvider: registerProvider,
    inspectBackup: inspectBackup,
    getSummary: getSummary,
    getCompare: getCompare,
    isRestoring: isRestoring,
    clearAllData: clearAllData
  };
})();
