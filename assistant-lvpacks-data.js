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
  // Built-in pixel packs — 8x8 grids, '.' = transparent, other chars key into `palette`.
  // Two `idle` frames (breathing) + one `blink` frame, cycled by assistant.js's own idle
  // state machine; the pack only supplies art + which named states it defines (Section 9:
  // engine and skin stay separate — no drag/position/nav logic lives here).
  // ---------------------------------------------------------------------

  const CAT_PACK = {
    id: 'lv-cat', name: 'Pixel Cat', cost: 0,
    pixel: {
      palette: { o: '#3f2f21', b: '#a8b087', w: '#fbf8f0', p: '#c97b62' },
      idle: [
        ['.oo..oo.', 'obbo.obb', 'obbbbbbo', 'obwoowbo', 'obbbbbbo', 'obbppbbo', '.obbbbo.', '..oooo..'],
        ['.oo..oo.', 'obbo.obb', 'obbbbbbo', 'obwoowbo', 'obbbbbbo', '.obbppbo', '.obbbbo.', '..oooo..']
      ],
      blink: ['.oo..oo.', 'obbo.obb', 'obbbbbbo', 'oboooobo', 'obbbbbbo', 'obbppbbo', '.obbbbo.', '..oooo..']
    },
    idleBehaviors: ['sit', 'blink', 'breathe']
  };

  const MOTH_PACK = {
    id: 'lv-moth', name: 'Pixel Moth', cost: 400,
    pixel: {
      palette: { o: '#3a3226', b: '#c3a97e', w: '#fffdf8', p: '#8a9468' },
      idle: [
        ['o.....o.', '.o...o..', 'bbobobbb', 'bbbwwbbb', 'obppppbo', '.obbbbo.', '..o..o..', '.o....o.'],
        ['o.....o.', '.o...o..', 'obobobbb', 'bbbwwbbb', 'bbppppbo', '.obbbbo.', '..o..o..', '.o....o.']
      ],
      blink: ['o.....o.', '.o...o..', 'bbobobbb', 'bbbooobb', 'obppppbo', '.obbbbo.', '..o..o..', '.o....o.']
    },
    idleBehaviors: ['perch', 'blink', 'wing-flutter']
  };

  const FROG_PACK = {
    id: 'lv-frog', name: 'Pixel Frog', cost: 600,
    pixel: {
      palette: { o: '#405228', b: '#8a9468', w: '#eef0e6', p: '#405228' },
      idle: [
        ['.o....o.', 'obo..obo', 'obwoowbo', 'obbbbbbo', 'obbbbbbo', 'bbbbbbbb', 'o.bbbb.o', 'o......o'],
        ['.o....o.', 'obo..obo', 'obwoowbo', 'obbbbbbo', '.obbbbo.', 'bbbbbbbb', 'o.bbbb.o', 'o......o']
      ],
      blink: ['.o....o.', 'obo..obo', 'oboooobo', 'obbbbbbo', 'obbbbbbo', 'bbbbbbbb', 'o.bbbb.o', 'o......o']
    },
    idleBehaviors: ['sit', 'blink', 'breathe']
  };

  register(CAT_PACK);
  register(MOTH_PACK);
  register(FROG_PACK);

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
