/*
 * assistant-lvpacks-data.js — Assistant LV Pack registry.
 *
 * "LV Pack" here follows the same idea already established by My World's content packs
 * (myworld-content.js): a small, versioned, swappable definition of *appearance*, kept
 * completely separate from the engine that positions/drags/interacts with it. This file is
 * that separate, self-contained registry for the Assistant's companion character — it does
 * NOT touch myworld-content.js's registry, does NOT add a second Store/currency/inventory
 * system, and does NOT give assistant.js (the engine) any reason to know how many packs exist
 * or what they look like beyond "ask this file for the active one."
 *
 * Ownership/active-state piggybacks entirely on the existing Cosmetics ledger
 * (misc-cosmetics.js's MiscCosmetics.register/isActive/setUnlocked/setActive) — this file only
 * adds pack *definitions* (pixel art + idle behavior names + EXP cost) and a couple of small
 * helpers on top of that ledger. No parallel ownership store, no parallel currency: purchases
 * spend real EXP through GamificationData.spendExp, the app's single EXP choke point, exactly
 * the same way Assistant's existing My World Store purchase already does.
 *
 * Each pack is a plain data object — nothing here reaches into assistant.js, and assistant.js
 * never hardcodes a pack's art. A pack can be register()ed or unregister()ed at any time without
 * editing the Assistant engine itself ("future Assistant LV Packs must be addable without
 * modifying the core Assistant engine").
 *
 * Sprite format: each frame is an array of 8 row-strings, 8 characters each. Every character is
 * a key into the pack's own `palette` map, or '.' for transparent. Rendered by assistant.js onto
 * a small <canvas> with image-smoothing disabled — real pixel art, not an SVG shape.
 *
 * Load order: must load after misc-cosmetics.js (its built-in registrations call
 * MiscCosmetics.register at parse time) and after gamification-data.js (purchase() calls
 * GamificationData.spendExp). Both are satisfied by index.html's script order.
 */
const AssistantLVPackData = (function () {
  const CATEGORY = 'assistant-pack';
  const registry = Object.create(null);
  const order = [];

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[AssistantLVPackData] ' + msg);
  }

  // ---------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------

  function validate(def) {
    if (!def || typeof def !== 'object') return 'not an object';
    if (typeof def.id !== 'string' || !def.id) return 'id';
    if (typeof def.name !== 'string' || !def.name) return 'name';
    if (!def.pixel || !Array.isArray(def.pixel.idle) || !def.pixel.idle.length) return 'pixel.idle';
    if (typeof def.pixel.palette !== 'object') return 'pixel.palette';
    return '';
  }

  /** Registers a new pack. Re-registering an id already known is a no-op (returns false) — this
   * keeps a pack's own registration call idempotent/safe if it runs more than once, without ever
   * silently replacing an existing (possibly owned/active) pack's art out from under the user. */
  function register(def) {
    const err = validate(def);
    if (err) { warn('rejected pack "' + (def && def.id) + '": ' + err); return false; }
    if (registry[def.id]) return false;
    registry[def.id] = def;
    order.push(def.id);
    if (typeof MiscCosmetics !== 'undefined') {
      MiscCosmetics.register(def.id, {
        category: CATEGORY,
        label: def.name,
        unlocked: (def.cost || 0) === 0,
        active: false
      });
    }
    return true;
  }

  /** Removes a pack from the live registry only (art + idle-behavior data) — the Cosmetics
   * ledger's unlocked/active flags for it are left alone (so re-registering the same id later
   * restores exactly where the player left off), matching the "safely removable" requirement.
   * If the removed pack was active, falls back to the first remaining registered pack. */
  function unregister(id) {
    if (!registry[id]) return false;
    delete registry[id];
    const idx = order.indexOf(id);
    if (idx >= 0) order.splice(idx, 1);
    if (getActiveId() === id && order[0]) setActive(order[0]);
    return true;
  }

  function get(id) { return (typeof id === 'string' && registry[id]) || null; }

  // ---------------------------------------------------------------------
  // Ownership / active pack — reads and writes go through MiscCosmetics only
  // ---------------------------------------------------------------------

  function cosmeticsMeta(id) {
    if (typeof MiscCosmetics === 'undefined') return { unlocked: true, active: order[0] === id };
    const found = MiscCosmetics.list(CATEGORY).filter(function (m) { return m.id === id; })[0];
    return found || { unlocked: true, active: false };
  }

  function isOwned(id) { return !!cosmeticsMeta(id).unlocked; }
  function isActivePack(id) { return !!cosmeticsMeta(id).active; }

  function getActiveId() {
    if (typeof MiscCosmetics !== 'undefined') {
      const activeEntry = MiscCosmetics.list(CATEGORY).filter(function (m) { return m.active && m.unlocked && registry[m.id]; })[0];
      if (activeEntry) return activeEntry.id;
    }
    // Nothing marked active yet (fresh install) — the first registered (free) pack is the
    // sensible default, mirroring MyWorldContent's DEFAULT_WORLD fallback pattern.
    return order[0] || null;
  }

  function getActive() { return get(getActiveId()); }

  function list() {
    return order.map(function (id) {
      const meta = cosmeticsMeta(id);
      const def = registry[id];
      return { id: id, name: def.name, cost: def.cost || 0, unlocked: !!meta.unlocked, active: id === getActiveId() };
    });
  }

  /** Spends EXP through the app's single EXP choke point (GamificationData.spendExp — never a
   * second currency), then unlocks the pack via the existing Cosmetics ownership flag. */
  function purchase(id) {
    const def = get(id);
    if (!def) return { ok: false, error: 'Unknown pack.' };
    if (isOwned(id)) return { ok: true, alreadyOwned: true };
    if (typeof GamificationData === 'undefined' || typeof MiscCosmetics === 'undefined') {
      return { ok: false, error: 'Store unavailable right now.' };
    }
    if (!GamificationData.spendExp(def.cost || 0, 'Assistant pack unlocked: ' + def.name)) {
      return { ok: false, error: 'Not enough EXP.' };
    }
    MiscCosmetics.setUnlocked(id, true);
    return { ok: true };
  }

  /** Exactly one assistant pack is active at a time — enforced by flipping every other
   * registered pack's active flag off through the same Cosmetics registry, never a separate
   * "current pack" field of its own. Switchable directly from Cosmetics, per the requirement. */
  function setActive(id) {
    if (!registry[id] || !isOwned(id) || typeof MiscCosmetics === 'undefined') return false;
    order.forEach(function (oid) { MiscCosmetics.setActive(oid, oid === id); });
    return true;
  }

  // ---------------------------------------------------------------------
    // Built-in pixel packs — '.' = transparent, other chars key into `palette`. Cat, Puppy and
  // Capybara are 20x20 and supply `pixel.render(state)`, driven by assistant.js's idle state
  // machine; the pack only supplies art + which named states it defines (Section 9:
  // engine and skin stay separate — no drag/position/nav logic lives here).
  // ---------------------------------------------------------------------

  // Refined 20x20 cat. Same cat, same palette; shading uses two tones from the same sage family.
  // buildCatFrame(state) returns 20 row-strings. state: { blink 0-2, look -1/0/1, earL/earR 0-2
  // (1 = twitch, 2 = perked), tail 0-2, breath 0/1, mood 'normal'|'perk'|'happy' }.
  const CAT_TAIL_BASE = [[18, 18], [17, 18], [16, 18], [15, 18], [14, 18]];
  const CAT_TAIL_TIPS = [
    [[13, 18], [12, 18], [11, 18]],
    [[13, 18], [12, 18], [12, 19], [11, 19]],
    [[13, 18], [13, 19], [12, 19], [11, 19], [10, 19]]
  ];
  const CAT_HEAD_ROWS = [
    '....o' + '..........' + 'o....',
    '...opo' + '........' + 'opo...',
    '...opp' + 'oooooooo' + 'ppo...',
    '..o' + 'bllbbbddbbbbbb' + 'o..',
    '..o' + 'blbbbdbbdbbbbb' + 'o..',
    '..o' + 'b'.repeat(14) + 'o..',
    '..o' + 'b'.repeat(14) + 'o..',
    '..o' + 'b'.repeat(14) + 'o..',
    '..o' + 'bbbbbwppwbbbbb' + 'o..',
    '..o' + 'bbbbbowwobbbbb' + 'o..',
    '..o' + 'b'.repeat(14) + 'o..',
    '...o' + 'bddddddddddb' + 'o...'
  ];
  const CAT_BODY_ROWS = [
    '....o' + 'bbbwwwwbbb' + 'o....',
    '...o' + 'bbbbwwwwbbbb' + 'o...',
    '..o' + 'bbbbwwwwwwbbbb' + 'o..',
    '..o' + 'dbbbwwoowwbbbd' + 'o..',
    '..o' + 'bbbbwwoowwbbbb' + 'o..',
    '..' + 'o'.repeat(16) + '..'
  ];

  function buildCatFrame(s) {
    s = s || {};
    const N = 20;
    const blank = function () {
      const g = [];
      for (let r = 0; r < N; r++) { g.push([]); for (let c = 0; c < N; c++) g[r].push('.'); }
      return g;
    };
    const stamp = function (grid, r0, rows) {
      rows.forEach(function (str, i) {
        for (let c = 0; c < str.length; c++) if (str[c] !== '.') grid[r0 + i][c] = str[c];
      });
    };
    const g = blank();
    const h = blank();

    // Tail (drawn first so the body overlaps it)
    const pts = CAT_TAIL_BASE.concat(CAT_TAIL_TIPS[(s.tail | 0) % 3]);
    pts.forEach(function (p, i) { g[p[0]][p[1]] = (i === pts.length - 1) ? 'd' : 'b'; });
    pts.forEach(function (p) {
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
        const r = p[0] + d[0], c = p[1] + d[1];
        if (r >= 0 && r < N && c >= 0 && c < N && g[r][c] === '.') g[r][c] = 'o';
      });
    });

    stamp(g, 13, CAT_BODY_ROWS);
    stamp(h, 1, CAT_HEAD_ROWS);

    // Whiskers
    h[9][0] = 'd'; h[9][1] = 'd'; h[9][18] = 'd'; h[9][19] = 'd';

    // Ears: 1 = twitch (flicked and lowered), 2 = perked (taller)
    const ear = function (state, mirror) {
      const m = function (c) { return mirror ? N - 1 - c : c; };
      const set = function (r, c, ch) { h[r][m(c)] = ch; };
      if (state === 1) {
        set(1, 4, '.'); set(1, 3, 'o');
        set(2, 2, 'o'); set(2, 3, 'p'); set(2, 4, 'p'); set(2, 5, 'o');
      } else if (state === 2) {
        set(0, 4, 'o'); set(1, 3, 'o'); set(1, 4, 'p'); set(1, 5, 'o');
      }
    };
    ear(s.earL | 0, false);
    ear(s.earR | 0, true);

    // Eyes: left eye cols 5-7, right eye cols 12-14, rows 6-8
    const look = s.look | 0;
    const offs = look < 0 ? [0, 0] : (look > 0 ? [1, 1] : [1, 0]); // pupil offset; default looks toward centre
    [5, 12].forEach(function (x, i) {
      const set = function (r, dx, ch) { h[r][x + dx] = ch; };
      if (s.mood === 'happy') {
        for (let dx = 0; dx < 3; dx++) set(6, dx, 'b');
        set(7, 0, 'b'); set(7, 1, 'o'); set(7, 2, 'b');
        set(8, 0, 'o'); set(8, 1, 'b'); set(8, 2, 'o');
        return;
      }
      const bl = s.blink | 0;
      if (bl === 2) {
        for (let dx = 0; dx < 3; dx++) { set(6, dx, 'b'); set(7, dx, 'b'); set(8, dx, 'o'); }
        return;
      }
      const px = offs[i];
      for (let r = 6; r <= 8; r++) {
        for (let dx = 0; dx < 3; dx++) set(r, dx, (r >= 7 && dx >= px && dx < px + 2) ? 'o' : 'w');
      }
      if (s.mood === 'perk') set(7, px, 'w'); // sparkle
      if (bl === 1) for (let dx = 0; dx < 3; dx++) set(6, dx, 'b');
    });

    // Head sits on the body; breathing lowers it one pixel
    const dy = (s.mood === 'perk') ? 0 : (s.breath ? 1 : 0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (h[r][c] !== '.' && r + dy < N) g[r + dy][c] = h[r][c];
      }
    }
    return g.map(function (row) { return row.join(''); });
  }

  const CAT_PACK = {
    id: 'lv-cat', name: 'Pixel Cat', cost: 0,
    pixel: {
      palette: { o: '#3f2f21', b: '#a8b087', w: '#fbf8f0', p: '#c97b62', d: '#8a9468', l: '#c3c9ac' },
      idle: [buildCatFrame({})],
      blink: buildCatFrame({ blink: 2 }),
      render: buildCatFrame
    },
    idleBehaviors: ['sit', 'blink', 'breathe', 'ear-twitch', 'tail-sway', 'glance']
  };

    // Pads a row-string with transparent pixels out to the shared 20-column grid.
  function padRow(str) { while (str.length < 20) str += '.'; return str; }

  // ---- Refined 20x20 puppy (golden pup). Same pipeline as the cat: buildPuppyFrame(state) takes
  // the engine's richState object ({ blink 0-2, look -1/0/1, earL/earR 0-2, tail 0-2, breath 0/1,
  // mood }) and returns 20 row-strings. Ears: 1 = flick, 2 = perked. Tail wags with `tail`;
  // 'happy' shows a panting tongue. Head is stamped at frame row 1 (HT), body at row 13, like the cat.
  const PUP_TAIL_BASE = [[17, 18], [16, 18], [15, 18]];
  const PUP_TAIL_TIPS = [
    [[14, 18], [14, 17], [13, 17], [12, 17]],
    [[14, 18], [13, 18], [12, 18], [11, 18]],
    [[14, 18], [13, 18], [13, 19], [12, 19], [11, 19]]
  ];
  const PUP_HEAD_ROWS = [
    '......oooooooo',
    '....o' + 'lllbbbbbbb' + 'o',
    '...o' + 'llbbbbbbbbbb' + 'o',
    '..o' + 'l' + 'b'.repeat(12) + 'd' + 'o',
    '..o' + 'b'.repeat(13) + 'd' + 'o',
    '..o' + 'b'.repeat(13) + 'd' + 'o',
    '..o' + 'b'.repeat(13) + 'd' + 'o',
    '..o' + 'bbbbb' + 'nnnn' + 'bbbb' + 'd' + 'o',
    '..o' + 'bbbb' + 'ww' + 'nn' + 'ww' + 'bbb' + 'd' + 'o',
    '..o' + 'bbb' + 'www' + 'oo' + 'www' + 'bb' + 'd' + 'o',
    '..o' + 'bbb' + 'w' + 'o' + 'wwww' + 'o' + 'w' + 'bb' + 'd' + 'o',
    '...o' + 'c' + 'w'.repeat(10) + 'c' + 'o'
  ].map(padRow);
  const PUP_BODY_ROWS = [
    '....o' + 'bbbcwwcbbb' + 'o',
    '...o' + 'dbbbwwwwbbbd' + 'o',
    '..o' + 'dbbbwwwwwwbbbd' + 'o',
    '..o' + 'dbbwwboobwwbbd' + 'o',
    '..o' + 'dbcwwcoocwwcbd' + 'o',
    '..' + 'o'.repeat(16)
  ].map(padRow);
  // Floppy ear, left side (mirrored for the right). Row 0 sits on head row 2.
  const PUP_EAR = ['...ooo', '..osso', '.oesso', '.oeeso', '.oeeeo', '.oeeeo', '.oeeeo', '..oeeo', '...ooo'];

  function buildPuppyFrame(s) {
    s = s || {};
    const N = 20;
    const HT = 1; // head grid is in frame coordinates; head row r lives at h[HT + r]
    const blank = function () {
      const g = [];
      for (let r = 0; r < N; r++) { g.push([]); for (let c = 0; c < N; c++) g[r].push('.'); }
      return g;
    };
    const stamp = function (grid, r0, rows) {
      rows.forEach(function (str, i) {
        for (let c = 0; c < str.length; c++) if (str[c] !== '.') grid[r0 + i][c] = str[c];
      });
    };
    const g = blank();
    const h = blank();

    // Tail (drawn first so the body overlaps it)
    const pts = PUP_TAIL_BASE.concat(PUP_TAIL_TIPS[(s.tail | 0) % 3]);
    pts.forEach(function (p, i) { g[p[0]][p[1]] = (i === pts.length - 1) ? 'c' : 'b'; });
    pts.forEach(function (p) {
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
        const r = p[0] + d[0], c = p[1] + d[1];
        if (r >= 0 && r < N && c >= 0 && c < N && g[r][c] === '.') g[r][c] = 'o';
      });
    });

    stamp(g, 13, PUP_BODY_ROWS);
    stamp(h, HT, PUP_HEAD_ROWS);

    // Floppy ears: 1 = flick (up and out), 2 = perked (lifted higher)
    const ear = function (state, mirror) {
      const dr = state === 2 ? -2 : (state === 1 ? -1 : 0);
      const dc = state === 1 ? -1 : 0;
      PUP_EAR.forEach(function (str, i) {
        for (let c = 0; c < str.length; c++) {
          if (str[c] === '.') continue;
          const col = c + dc;
          const r = HT + 2 + i + dr;
          if (r < 0 || col < 0) continue;
          h[r][mirror ? N - 1 - col : col] = str[c];
        }
      });
    };
    ear(s.earL | 0, false);
    ear(s.earR | 0, true);

    // Eyes: left eye cols 6-8, right eye cols 11-13, head rows 4-6 (3x3, dark with a shine)
    const look = s.look | 0;
    const bl = s.blink | 0;
    [6, 11].forEach(function (x) {
      const set = function (r, dx, ch) { h[HT + r][x + dx] = ch; };
      if (s.mood === 'happy') {
        for (let dx = 0; dx < 3; dx++) set(4, dx, 'b');
        set(5, 0, 'b'); set(5, 1, 'o'); set(5, 2, 'b');
        set(6, 0, 'o'); set(6, 1, 'b'); set(6, 2, 'o');
        return;
      }
      if (bl === 2) {
        for (let dx = 0; dx < 3; dx++) { set(4, dx, 'b'); set(5, dx, 'o'); set(6, dx, 'd'); }
        return;
      }
      for (let r = 4; r <= 6; r++) for (let dx = 0; dx < 3; dx++) set(r, dx, 'n');
      const shine = look > 0 ? 2 : 0;
      set(4, shine, 'w');
      if (look < 0) set(5, 2, 'w'); else if (look > 0) set(5, 0, 'w');
      if (s.mood === 'perk') set(6, 2 - shine, 'c');
      if (bl === 1) for (let dx = 0; dx < 3; dx++) set(4, dx, 'b');
    });

    // Panting tongue when content
    if (s.mood === 'happy') {
      h[HT + 10][8] = 'q'; h[HT + 10][9] = 'p'; h[HT + 10][10] = 'p'; h[HT + 10][11] = 'q';
      h[HT + 11][9] = 'p'; h[HT + 11][10] = 'p';
    }

    // Head sits on the body; breathing lowers it one pixel
    const dy = (s.mood === 'perk') ? 0 : (s.breath ? 1 : 0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (h[r][c] !== '.' && r + dy < N) g[r + dy][c] = h[r][c];
      }
    }
    return g.map(function (row) { return row.join(''); });
  }

  // ---- Refined 20x20 capybara (side profile, facing left). Same state object as the cat.
  // Uses: blink, look (eye shifts toward/away from the snout), earL/earR (either flicks the single
  // ear), breath (head bob), mood 'perk' (ear up, bright eye) and 'happy' (content squint + munching,
  // driven by `tail`, so it chews only during the happy moment). Head grid is in frame coordinates.
  const CAPY_HEAD_ROWS = [
    '...ooooo',
    '..olllbbo',
    '.o' + 'llbbbbb' + 'd',
    'o' + 'nn' + 'bbbbbb' + 'd',
    'o' + 'nn' + 'bbbbbb' + 'd',
    'o' + 'mmm' + 'bbbbb' + 'd',
    'o' + 'mmmm' + 'bbbb' + 'd',
    '.ooooo'
  ].map(padRow);
  const CAPY_BODY_ROWS = [
    '.........ooooooo',
    '........o' + 'lllllll' + 'o',
    '.......o' + 'lllbbbbbb' + 'o',
    '......o' + 'll' + 'bbbbbbbbb' + 'o',
    '.....o' + 'l' + 'b'.repeat(10) + 'd' + 'o',
    '.....o' + 'b'.repeat(11) + 'd' + 'o',
    '.....o' + 'b'.repeat(11) + 'd' + 'o',
    '.....o' + 'b'.repeat(10) + 'dd' + 'o',
    '.....o' + 'b'.repeat(8) + 'dddd' + 'o',
    '......o' + 'd'.repeat(11) + 'o',
    '.......obbooooobbo',
    '.......obdo...odbo',
    '.......oooo...oooo'
  ].map(padRow);
  const CAPY_FLECKS = [[9, 13, 'r'], [10, 15, 'r'], [11, 10, 'r'], [12, 14, 'r'], [13, 9, 'r'], [10, 10, 'l'], [9, 10, 'l']];

  function buildCapyFrame(s) {
    s = s || {};
    const N = 20;
    const blank = function () {
      const g = [];
      for (let r = 0; r < N; r++) { g.push([]); for (let c = 0; c < N; c++) g[r].push('.'); }
      return g;
    };
    const stamp = function (grid, r0, rows) {
      rows.forEach(function (str, i) {
        for (let c = 0; c < str.length; c++) if (str[c] !== '.') grid[r0 + i][c] = str[c];
      });
    };
    const g = blank();
    const h = blank();

    stamp(g, 6, CAPY_BODY_ROWS);
    CAPY_FLECKS.forEach(function (f) { if (g[f[0]][f[1]] !== '.') g[f[0]][f[1]] = f[2]; });
    stamp(h, 6, CAPY_HEAD_ROWS);

    // Mouth line (lowers a pixel while munching)
    const chew = (s.mood === 'happy' && (s.tail | 0) > 0) ? 1 : 0;
    for (let c = 1; c <= 3; c++) h[11 + chew][c] = 'd';

    // Single small ear: 0 = rest, 1 = flick back, 2 = perked
    const es = Math.max(s.earL | 0, s.earR | 0);
    const put = function (r, c, ch) { if (r >= 0 && r < N && c >= 0 && c < N) h[r][c] = ch; };
    if (es === 2) {
      put(4, 6, 'o'); put(4, 7, 'o');
      put(5, 5, 'o'); put(5, 6, 'e'); put(5, 7, 'e'); put(5, 8, 'o');
      put(6, 6, 'e'); put(6, 7, 'e'); put(6, 8, 'o');
    } else if (es === 1) {
      put(5, 7, 'o'); put(5, 8, 'o');
      put(6, 7, 'e'); put(6, 8, 'e'); put(6, 9, 'o');
    } else {
      put(5, 6, 'o'); put(5, 7, 'o');
      put(6, 6, 'e'); put(6, 7, 'e'); put(6, 8, 'o');
    }

    // Eye (2x2, head rows 8-9). Looking toward the snout shifts it left, away shifts it right.
    const look = s.look | 0;
    const bl = s.blink | 0;
    const ex = 5 + (look < 0 ? -1 : (look > 0 ? 1 : 0));
    if (s.mood === 'happy') {
      put(8, ex, 'o'); put(8, ex + 1, 'o'); put(9, ex, 'b'); put(9, ex + 1, 'b');
    } else if (bl === 2) {
      put(8, ex, 'b'); put(8, ex + 1, 'b'); put(9, ex, 'o'); put(9, ex + 1, 'o');
    } else {
      put(8, ex, 'w'); put(8, ex + 1, 'n'); put(9, ex, 'n'); put(9, ex + 1, 'n');
      if (s.mood === 'perk') put(9, ex + 1, 'w');
      if (bl === 1) { put(8, ex, 'b'); put(8, ex + 1, 'b'); }
    }

    // Head sits on the body; breathing lowers it one pixel
    const dy = (s.mood === 'perk') ? 0 : (s.breath ? 1 : 0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (h[r][c] !== '.' && r + dy < N) g[r + dy][c] = h[r][c];
      }
    }
    return g.map(function (row) { return row.join(''); });
  }

  // Ids 'lv-moth' / 'lv-frog' are kept on purpose so existing ownership/active state carries over.
  const PUPPY_PACK = {
    id: 'lv-moth', name: 'Pixel Puppy', cost: 400,
    pixel: {
      palette: { o: '#34241a', b: '#c8914f', l: '#e2b472', d: '#a06c36', e: '#7c4f27', s: '#9a6634', w: '#f7ecd6', c: '#e3cfa6', n: '#231913', p: '#d9737f', q: '#6b2a2f' },
      idle: [buildPuppyFrame({})],
      blink: buildPuppyFrame({ blink: 2 }),
      render: buildPuppyFrame
    },
    idleBehaviors: ['sit', 'blink', 'breathe', 'ear-twitch', 'tail-wag', 'glance']
  };

  const CAPYBARA_PACK = {
    id: 'lv-frog', name: 'Pixel Capybara', cost: 600,
    pixel: {
      palette: { o: '#3a2a1e', b: '#8d6a45', l: '#a98760', d: '#6e4f32', r: '#7a5836', m: '#c4a77d', n: '#241a14', w: '#f3ece0', e: '#6b4a30' },
      idle: [buildCapyFrame({})],
      blink: buildCapyFrame({ blink: 2 }),
      render: buildCapyFrame
    },
    idleBehaviors: ['rest', 'blink', 'breathe', 'ear-twitch', 'glance', 'munch']
  };

  register(CAT_PACK);
    register(PUPPY_PACK);
  register(CAPYBARA_PACK);

  return {
    CATEGORY: CATEGORY,
    register: register,
    unregister: unregister,
    get: get,
    list: list,
    isOwned: isOwned,
    isActivePack: isActivePack,
    getActiveId: getActiveId,
    getActive: getActive,
    purchase: purchase,
    setActive: setActive
  };
})();
