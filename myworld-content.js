/**
 * myworld-content.js
 * ----------------------------------------------------------------------
 * My World — content registry + inventory.
 *
 * Worlds and trees are plain data definitions registered here. The
 * engine (myworld.js) reads the ACTIVE world/tree from this module and
 * never hardcodes content. Definitions are data only (no functions), so
 * future content packs can register the same shapes.
 *
 * Inventory (owned ids, active world/tree, growth of non-legacy trees)
 * lives in its own localStorage key. The original apple tree keeps its
 * growth record in myworld-data.js (world.tree) — untouched.
 *
 * Load order: myworld-data.js -> myworld-assets.js -> myworld-content.js -> myworld.js
 * ----------------------------------------------------------------------
 */

const MyWorldContent = (function () {
  'use strict';

  const ENGINE_VERSION = 1;
  const INV_SCHEMA = 1;
  const INV_KEY = 'lavender.myWorld.inventory.v' + INV_SCHEMA;
  const DEFAULT_WORLD = 'core.meadow';
  const DEFAULT_TREE = 'core.apple';
  const SUPPORTED_RENDERERS = ['procedural'];
  const PROCEDURAL_STAGE_COUNT = 22;
  const MAX_SAFE = Number.MAX_SAFE_INTEGER;

  const registry = Object.create(null);
  const order = [];
  let inv = null;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function clampNum(n, min, max, fallback) {
    if (!isNum(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[MyWorldContent] ' + msg);
  }
  function nowIso() { return new Date().toISOString(); }

  // ---------------------------------------------------------------------
  // Built-in content: world "Meadow"
  // ---------------------------------------------------------------------
  const MEADOW = {
    type: 'world', id: 'core.meadow', name: 'Meadow', version: 1, engineMin: 1, cost: 0,
    tree: 'core.apple',
    baseHeight: 180,
    horizon: 0.66,
    ground: 0.74,
    treeSlot: 0.5,
    pond: true,
    seeds: { stars: 20240517, clouds: 4242 },
    sky: [
      { h: 0,     top: '#0b0e24', mid: '#131a3a', bot: '#232a52' },
      { h: 4.5,   top: '#141a3c', mid: '#2c3062', bot: '#5a4a7a' },
      { h: 6,     top: '#4a5590', mid: '#b0779a', bot: '#f0a070' },
      { h: 7.5,   top: '#5b8fd0', mid: '#7fb0e0', bot: '#cfe6f0' },
      { h: 12,    top: '#3f78d6', mid: '#5f9de6', bot: '#a8d0f0' },
      { h: 16.5,  top: '#4a82cf', mid: '#78aee0', bot: '#bcdcee' },
      { h: 18,    top: '#6a6fa8', mid: '#d08a78', bot: '#f4b26a' },
      { h: 19.25, top: '#3a3f78', mid: '#7a5a8c', bot: '#c8785a' },
      { h: 20.5,  top: '#171b3a', mid: '#232a52', bot: '#3c3667' },
      { h: 24,    top: '#0b0e24', mid: '#131a3a', bot: '#232a52' }
    ],
    palettes: {
      far: [
        ['#7f9f8f', '#2c3a5c'], ['#5f8272', '#1f2a48'], ['#4c6c60', '#182240']
      ],
      mid: [
        ['#5f9354', '#264566'], ['#4a7c48', '#1a3450'], ['#6aa652', '#22485a'],
        ['#2c4f3a', '#122238'], ['#437250', '#1c3654']
      ],
      ground: [
        ['#8ed05a', '#3a7a66'], ['#5fae44', '#2a6058'], ['#3f8a3a', '#1e4a4c'], ['#2f6e33', '#173e44'],
        ['#b98452', '#5a4560'], ['#9a6a40', '#4a3852'], ['#7c5232', '#3a2c46'], ['#623f28', '#2e2338'],
        ['#8e93a0', '#4a5078'], ['#73788a', '#3a4066'], ['#5c6174', '#2e3356'], ['#464a5e', '#232847'],
        ['#5a3a22', '#2a1f30'], ['#a9a5a0', '#5c5a78'],
        ['#f2c94c', '#d8b050'], ['#5cc8f0', '#5aa8e8'], ['#e88ac0', '#c878b8']
      ]
    },
    cloudTones: {
      day:   [[255, 255, 255], [232, 236, 246], [184, 192, 214]],
      dusk:  [[255, 226, 178], [240, 168, 136], [160, 104, 128]],
      night: [[96, 104, 150], [62, 70, 124], [42, 48, 92]]
    },
    weather: {
      states: {
        clear:  { cover: 0.25, rain: 0, fog: 0,    wind: 0.15 },
        breeze: { cover: 0.45, rain: 0, fog: 0,    wind: 0.75 },
        rain:   { cover: 0.92, rain: 1, fog: 0.12, wind: 0.4 },
        fog:    { cover: 0.6,  rain: 0, fog: 1,    wind: 0.08 }
      },
      weights: { clear: 0.4, breeze: 0.25, rain: 0.2, fog: 0.15 }
    }
  };

  // ---------------------------------------------------------------------
  // Built-in content: tree "Apple Tree" (procedural renderer)
  // Stage thresholds/names stay in myworld-assets.js (TREE_STAGES).
  // ---------------------------------------------------------------------
  const APPLE = {
    type: 'tree', id: 'core.apple', name: 'Apple Tree', version: 1, engineMin: 1, cost: 0,
    renderer: 'procedural',
    legacyRecord: true,
    stages: (typeof MyWorldAssets !== 'undefined' && MyWorldAssets && MyWorldAssets.TREE_STAGES) ? MyWorldAssets.TREE_STAGES : [],
    procedural: {
      curve: [[0, 0], [2, 0], [3, 0.04], [8, 0.16], [12, 0.36], [19, 0.84], [22, 1]],
      bark: [
        ['#b9795a', '#5c4064'], ['#8a4f48', '#46304f'], ['#623a42', '#33243f'], ['#3e2434', '#1c1428'],
        ['#ffd36a', '#ffd36a'],
        ['#a9744a', '#5a4560'], ['#6c4429', '#33263f'], ['#e8d090', '#c8b070'],
        ['#8fdc5a', '#6ad0a0'], ['#4fae4a', '#3f9a78'], ['#2e6e3a', '#2a6e5e']
      ],
      foliage: [
        ['#1c3f3a', '#0f2230'], ['#2b5e48', '#173a44'], ['#3f8250', '#1f5058'],
        ['#63a84a', '#2f6a66'], ['#a6dc5a', '#6ad0a0'], ['#f0c040', '#c8a050'],
        ['#fff4f0', '#d8d0e8'], ['#f7a8c4', '#c890b8'], ['#d8403c', '#a03050'],
        ['#ff8a70', '#d06080'], ['#ffe27a', '#e8c870']
      ],
      leafVariants: [null, [40, 130, 150], [160, 175, 50]]
    }
  };

  // ---------------------------------------------------------------------
  // Validation (defs are data only; anything malformed is rejected)
  // ---------------------------------------------------------------------
  function isPalette(list, minLen) {
    if (!Array.isArray(list) || list.length < minLen) return false;
    return list.every(function (p) { return Array.isArray(p) && p.length === 2 && isHex(p[0]) && isHex(p[1]); });
  }

  function isRgb(c) {
    return Array.isArray(c) && c.length === 3 && c.every(function (n) { return isNum(n) && n >= 0 && n <= 255; });
  }

  function validateWorld(d) {
    if (typeof d.tree !== 'string' || !d.tree) return 'tree';
    if (!isNum(d.baseHeight) || d.baseHeight < 90 || d.baseHeight > 400) return 'baseHeight';
    if (!isNum(d.horizon) || d.horizon < 0.3 || d.horizon > 0.9) return 'horizon';
    if (!isNum(d.ground) || d.ground < 0.4 || d.ground > 0.95) return 'ground';
    if (!isNum(d.treeSlot) || d.treeSlot < 0.2 || d.treeSlot > 0.8) return 'treeSlot';
    if (!isObj(d.seeds) || !isNum(d.seeds.stars) || !isNum(d.seeds.clouds)) return 'seeds';
    if (!Array.isArray(d.sky) || d.sky.length < 3) return 'sky';
    for (let i = 0; i < d.sky.length; i++) {
      const k = d.sky[i];
      if (!isObj(k) || !isNum(k.h) || !isHex(k.top) || !isHex(k.mid) || !isHex(k.bot)) return 'sky key ' + i;
      if (i > 0 && k.h <= d.sky[i - 1].h) return 'sky order';
    }
    if (d.sky[0].h !== 0 || d.sky[d.sky.length - 1].h !== 24) return 'sky range';
    if (!isObj(d.palettes) || !isPalette(d.palettes.far, 3) || !isPalette(d.palettes.mid, 5) || !isPalette(d.palettes.ground, 17)) return 'palettes';
    const ct = d.cloudTones;
    if (!isObj(ct)) return 'cloudTones';
    const tones = ['day', 'dusk', 'night'];
    for (let i = 0; i < tones.length; i++) {
      const t = ct[tones[i]];
      if (!Array.isArray(t) || t.length < 3 || !t.every(isRgb)) return 'cloudTones.' + tones[i];
    }
    const w = d.weather;
    if (!isObj(w) || !isObj(w.states) || !isObj(w.weights) || !isObj(w.states.clear)) return 'weather';
    const names = Object.keys(w.weights);
    if (!names.length) return 'weather.weights';
    for (let i = 0; i < names.length; i++) {
      const s = w.states[names[i]];
      if (!isObj(s) || !isNum(s.cover) || !isNum(s.rain) || !isNum(s.fog) || !isNum(s.wind)) return 'weather.' + names[i];
      if (!isNum(w.weights[names[i]]) || w.weights[names[i]] < 0) return 'weather.weights.' + names[i];
    }
    return '';
  }

  function validateTree(d) {
    if (SUPPORTED_RENDERERS.indexOf(d.renderer) < 0) return 'renderer';
    if (!Array.isArray(d.stages) || d.stages.length !== PROCEDURAL_STAGE_COUNT) return 'stages';
    for (let i = 0; i < d.stages.length; i++) {
      const s = d.stages[i];
      if (!isObj(s) || !isNum(s.minGrowthPoints)) return 'stage ' + i;
      if (i === 0 && s.minGrowthPoints !== 0) return 'stage 0';
      if (i > 0 && s.minGrowthPoints <= d.stages[i - 1].minGrowthPoints) return 'stage order';
    }
    const p = d.procedural;
    if (!isObj(p)) return 'procedural';
    if (!Array.isArray(p.curve) || p.curve.length < 2 ||
        !p.curve.every(function (c) { return Array.isArray(c) && isNum(c[0]) && isNum(c[1]); })) return 'curve';
    if (!isPalette(p.bark, 11) || !isPalette(p.foliage, 11)) return 'tree palettes';
    if (!Array.isArray(p.leafVariants) || !p.leafVariants.length ||
        !p.leafVariants.every(function (v) { return v === null || isRgb(v); })) return 'leafVariants';
    return '';
  }

  function validate(d) {
    if (!isObj(d)) return 'not an object';
    if (typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(d.id)) return 'id';
    if (d.type !== 'world' && d.type !== 'tree') return 'type';
    if (typeof d.name !== 'string' || !d.name) return 'name';
    if (!isNum(d.version)) return 'version';
    if (!isNum(d.cost) || d.cost < 0) return 'cost';
    if (isNum(d.engineMin) && d.engineMin > ENGINE_VERSION) return 'needs newer engine';
    return d.type === 'world' ? validateWorld(d) : validateTree(d);
  }

  // ---------------------------------------------------------------------
  // Registry
  // ---------------------------------------------------------------------
  function register(def) {
    const err = validate(def);
    if (err) { warn('rejected "' + (def && def.id) + '": ' + err); return false; }
    if (registry[def.id]) { warn('id already registered: ' + def.id); return false; }
    registry[def.id] = def;
    order.push(def.id);
    return true;
  }

  // ---------------------------------------------------------------------
  // Imported pack storage (IndexedDB) — Settings Phase 1/2
  // ---------------------------------------------------------------------
  const PACK_DB_NAME = 'lavender.packs.v1';
  const PACK_STORE = 'packs';
  let _packDbPromise = null;

  function openPackDb() {
    if (_packDbPromise) return _packDbPromise;
    _packDbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(PACK_DB_NAME, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(PACK_STORE)) db.createObjectStore(PACK_STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
    });
    return _packDbPromise;
  }

  function storePackDef(def) {
    return openPackDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(PACK_STORE, 'readwrite');
        tx.objectStore(PACK_STORE).put(def);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('put failed')); };
      });
    });
  }

  function loadAllPackDefs() {
    return openPackDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(PACK_STORE, 'readonly');
        const req = tx.objectStore(PACK_STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error || new Error('getAll failed')); };
      });
    });
  }

  function restoreImportedPacks() {
    return loadAllPackDefs().then(function (defs) {
      defs.forEach(function (def) {
        if (!registry[def.id]) register(def);
      });
      return defs.length;
    }).catch(function () { return 0; });
  }

  function importPackFile(file) {
    return file.text().then(function (text) {
      let pack;
      try { pack = JSON.parse(text); } catch (e) { throw new Error('Not valid pack data.'); }
      if (!isObj(pack)) throw new Error('Not valid pack data.');
      if (pack.schemaVersion !== 1) throw new Error('Unsupported pack version.');
      if (!isNum(pack.engineMin) || pack.engineMin > ENGINE_VERSION) throw new Error('This pack needs a newer app version.');
      if (typeof pack.sha256 !== 'string' || !pack.sha256) throw new Error('Pack is missing a checksum.');
      if (!Array.isArray(pack.definitions) || !pack.definitions.length) throw new Error('Pack has no content.');

      const claimed = pack.sha256;
      const checkObj = Object.assign({}, pack, { sha256: '' });
      const checkText = JSON.stringify(checkObj);
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(checkText)).then(function (buf) {
        const hex = Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        if (hex !== claimed.toLowerCase()) throw new Error('Pack failed the checksum check.');

        const toStore = [];
        for (let i = 0; i < pack.definitions.length; i++) {
          const def = pack.definitions[i];
          const err = validate(def);
          if (err) throw new Error('Invalid content in pack (' + (def && def.id) + '): ' + err);
          if (!registry[def.id]) toStore.push(def);
        }
        return Promise.all(toStore.map(storePackDef)).then(function () {
          let count = 0;
          toStore.forEach(function (def) { if (register(def)) count++; });
          return { ok: true, count: count };
        });
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'Import failed.' };
    });
                        }

  function get(id) {
    return (typeof id === 'string' && registry[id]) || null;
  }

  /** Summaries for a Store / Inventory screen. type: 'world' | 'tree' | undefined (all). */
  function list(type) {
    const inv0 = loadInv();
    const out = [];
    for (let i = 0; i < order.length; i++) {
      const d = registry[order[i]];
      if (type && d.type !== type) continue;
      out.push({
        id: d.id, type: d.type, name: d.name, version: d.version, cost: d.cost,
        owned: inv0.owned.indexOf(d.id) >= 0,
        active: d.id === (d.type === 'world' ? inv0.activeWorld : inv0.activeTree)
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Inventory
  // ---------------------------------------------------------------------
  function defaultInv() {
    return {
      v: INV_SCHEMA,
      owned: [DEFAULT_WORLD, DEFAULT_TREE],
      activeWorld: DEFAULT_WORLD,
      activeTree: DEFAULT_TREE,
      growth: {}
    };
  }

  function readInvRaw() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = window.localStorage.getItem(INV_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isObj(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveInv() {
    if (!inv) return false;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      window.localStorage.setItem(INV_KEY, JSON.stringify(inv));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadInv() {
    if (inv) return inv;
    const raw = readInvRaw();
    const base = defaultInv();
    if (raw) {
      if (Array.isArray(raw.owned)) {
        raw.owned.forEach(function (id) {
          if (typeof id === 'string' && base.owned.indexOf(id) < 0) base.owned.push(id);
        });
      }
      if (typeof raw.activeWorld === 'string' && base.owned.indexOf(raw.activeWorld) >= 0) base.activeWorld = raw.activeWorld;
      if (typeof raw.activeTree === 'string' && base.owned.indexOf(raw.activeTree) >= 0) base.activeTree = raw.activeTree;
      if (isObj(raw.growth)) {
        Object.keys(raw.growth).forEach(function (id) {
          if (isObj(raw.growth[id])) base.growth[id] = raw.growth[id];
        });
      }
    }
    inv = base;
    return inv;
  }

  function getInventory() {
    const i = loadInv();
    return { v: i.v, owned: i.owned.slice(), activeWorld: i.activeWorld, activeTree: i.activeTree };
  }

  function isOwned(id) {
    return loadInv().owned.indexOf(id) >= 0;
  }

  /** Marks a registered id as owned (the future Store calls this after a purchase). */
  function grant(id) {
    const d = get(id);
    if (!d) return false;
    const i = loadInv();
    const ids = [id];
    if (d.type === 'world' && d.tree) ids.push(d.tree);
    let changed = false;
    ids.forEach(function (x) {
      if (get(x) && i.owned.indexOf(x) < 0) { i.owned.push(x); changed = true; }
    });
    if (changed) saveInv();
    return true;
  }

function canActivate(type, id) {
    const d = get(id);
    if (type !== 'world' || !d || d.type !== 'world' || !isOwned(id)) return false;
    const t = get(d.tree);
    return !!t && t.type === 'tree';
  }

  function setActive(type, id) {
    if (!canActivate(type, id)) return false;
    const i = loadInv();
    i.activeWorld = id;
    i.activeTree = get(id).tree;
    saveInv();
    return true;
  }

  /** Active world, or the tree locked to it. Falls back to the built-ins if missing. */
  function getActive(type) {
    const i = loadInv();
    const w = get(i.activeWorld);
    if (type === 'world') return (w && w.type === 'world') ? w : get(DEFAULT_WORLD);
    const t = (w && w.type === 'world') ? get(w.tree) : null;
    return (t && t.type === 'tree') ? t : get(DEFAULT_TREE);
  }

  // ---------------------------------------------------------------------
  // Per-tree growth records
  // ---------------------------------------------------------------------
  function makeSeed() {
    const t = Date.now() % 2147483647;
    const r = Math.floor(Math.random() * 2147483647);
    return (t ^ r) >>> 0;
  }

  function newRecord() {
    const seed = makeSeed();
    const iso = nowIso();
    let params = { seed: seed };
    try {
      if (typeof MyWorldData !== 'undefined' && MyWorldData && MyWorldData.deriveTreeParams) params = MyWorldData.deriveTreeParams(seed);
    } catch (e) { /* keep minimal params */ }
    return {
      plantedAt: iso, lastGrowthAt: iso, growthPoints: 0, totalGrowthEventsApplied: 0,
      stageIndex: 0, stageProgress: 0, params: params
    };
  }

  /** Live growth record for a tree id (legacy apple = MyWorldData's world.tree). */
  function getTreeRecord(treeId) {
    const d = get(treeId);
    if (!d || d.type !== 'tree') return null;
    if (d.legacyRecord) {
      try {
        return (typeof MyWorldData !== 'undefined' && MyWorldData) ? MyWorldData.getWorld().tree : null;
      } catch (e) {
        return null;
      }
    }
    const i = loadInv();
    if (!isObj(i.growth[treeId]) || !isObj(i.growth[treeId].params)) {
      i.growth[treeId] = newRecord();
      saveInv();
    }
    return i.growth[treeId];
  }

  /** Same contract as MyWorldData.setTreeGrowth, for any tree id. */
  function setTreeGrowth(treeId, growthPoints, stageIndex, stageProgress) {
    const d = get(treeId);
    if (!d) return null;
    if (d.legacyRecord) {
      return (typeof MyWorldData !== 'undefined' && MyWorldData) ? MyWorldData.setTreeGrowth(growthPoints, stageIndex, stageProgress) : null;
    }
    const r = getTreeRecord(treeId);
    if (!r) return null;
    if (isNum(growthPoints)) r.growthPoints = clampNum(growthPoints, 0, MAX_SAFE, r.growthPoints);
    if (isNum(stageIndex)) r.stageIndex = clampNum(stageIndex, 0, 999, r.stageIndex);
    if (isNum(stageProgress)) r.stageProgress = clampNum(stageProgress, 0, 1, r.stageProgress);
    r.lastGrowthAt = nowIso();
    r.totalGrowthEventsApplied = (r.totalGrowthEventsApplied || 0) + 1;
    saveInv();
    return r;
  }

  // ---------------------------------------------------------------------
  // Backup / Restore support (called by backup.js). Reads and writes the same
  // inventory key and imported-pack store as everything above — no new storage.
  // ---------------------------------------------------------------------
  const BUILTIN_IDS = [MEADOW.id, APPLE.id];

  function isContentId(v) {
    return typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(v);
  }

  /** Everything My World content persists: the inventory plus imported (non-built-in) definitions. */
  function exportBackup() {
    const i = loadInv();
    const definitions = [];
    for (let n = 0; n < order.length; n++) {
      if (BUILTIN_IDS.indexOf(order[n]) < 0) definitions.push(registry[order[n]]);
    }
    return {
      inventory: { v: i.v, owned: i.owned.slice(), activeWorld: i.activeWorld, activeTree: i.activeTree, growth: i.growth },
      definitions: definitions
    };
  }

  /**
   * Merges backup content into the live inventory and pack store. Live wins on a same-id
   * conflict, backup-only records are added, live-only records are kept, and the live
   * active world/tree is never changed. Definitions go through validate(); inventory ids
   * and growth records are checked with the same rules loadInv() applies. Bad records are
   * dropped, never fatal. Returns { definitionsAdded, ownedAdded, growthAdded, settled } —
   * `settled` always resolves, once restored definitions have been written to IndexedDB.
   */
  function mergeBackup(raw) {
    const result = { definitionsAdded: 0, ownedAdded: 0, growthAdded: 0, settled: Promise.resolve(true) };
    if (!isObj(raw)) return result;

    const writes = [];
    if (Array.isArray(raw.definitions)) {
      raw.definitions.forEach(function (def) {
        if (!isObj(def) || typeof def.id !== 'string' || registry[def.id] || validate(def)) return;
        if (!register(def)) return;
        result.definitionsAdded++;
        writes.push(storePackDef(def).catch(function () { /* still usable for this session */ }));
      });
    }
    result.settled = Promise.all(writes).then(function () { return true; });

    const b = raw.inventory;
    if (isObj(b)) {
      const i = loadInv();
      let changed = false;
      if (Array.isArray(b.owned)) {
        b.owned.forEach(function (id) {
          if (isContentId(id) && i.owned.indexOf(id) < 0) { i.owned.push(id); result.ownedAdded++; changed = true; }
        });
      }
      if (isObj(b.growth)) {
        Object.keys(b.growth).forEach(function (id) {
          const r = b.growth[id];
          if (!isContentId(id) || Object.prototype.hasOwnProperty.call(i.growth, id)) return;
          if (!isObj(r) || !isObj(r.params) || !isNum(r.params.seed)) return;
          i.growth[id] = {
            plantedAt: typeof r.plantedAt === 'string' ? r.plantedAt : nowIso(),
            lastGrowthAt: typeof r.lastGrowthAt === 'string' ? r.lastGrowthAt : nowIso(),
            growthPoints: clampNum(r.growthPoints, 0, MAX_SAFE, 0),
            totalGrowthEventsApplied: clampNum(r.totalGrowthEventsApplied, 0, MAX_SAFE, 0),
            stageIndex: clampNum(r.stageIndex, 0, 999, 0),
            stageProgress: clampNum(r.stageProgress, 0, 1, 0),
            params: r.params
          };
          result.growthAdded++;
          changed = true;
        });
      }
      if (changed) saveInv();
    }
    return result;
  }

  // ---------------------------------------------------------------------
  // Boot: register built-ins
  // ---------------------------------------------------------------------
  register(MEADOW);
  register(APPLE);

  return {
    ENGINE_VERSION,
    DEFAULT_WORLD,
    DEFAULT_TREE,
    SUPPORTED_RENDERERS,

    register,
    get,
    list,
    validate,

    getInventory,
    isOwned,
    grant,
    canActivate,
    setActive,
    getActive,

    getTreeRecord,
    setTreeGrowth,

    importPackFile,
    restoreImportedPacks,

    exportBackup,
    mergeBackup
  };
})();
