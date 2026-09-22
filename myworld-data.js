/**
 * myworld-data.js
 * ----------------------------------------------------------------------
 * My World — persistent data layer.
 *
 * Owns the "myWorld" data shape, safe defaults, validation/migration on
 * load, and the read/write API. This module is a PURE DATA layer:
 * - no DOM access
 * - no rendering
 * - no growth-rate/stage-threshold decisions (those live in
 *   myworld-assets.js / myworld.js, which consume this module's data)
 *
 * Single-source-of-truth rule: this module does NOT compute or own
 * study totals, streaks, or EXP. `lifetimeStudyContribution` is a
 * placeholder mirror that a future integration will update by calling
 * `setLifetimeStudyContribution()` — MyWorldData never derives that
 * number itself.
 *
 * Storage strategy (defensive, forward-compatible):
 * - If the host page already has a global `State` module (Lavender's
 *   central store, `State.get()/patch()`), MyWorldData mirrors its data
 *   into `State`'s `myWorld` key via `State.patch('myWorld', world)`.
 *   This is opportunistic — state.js has NOT been modified to declare
 *   `myWorld` in its defaultState, so this is a soft integration only.
 * - MyWorldData ALWAYS also mirrors to its own localStorage key, so My
 *   World keeps working standalone even before `State` integration
 *   exists or if it's ever unavailable.
 * - On load, State (if present) is preferred as the source of truth;
 *   localStorage is the fallback/mirror.
 *
 * Nothing in this file auto-runs on page load beyond defining the
 * module object itself — no navigation, no TimeEngine, no Study
 * integration. Safe to include on any page and simply not called.
 * ----------------------------------------------------------------------
 */

const MyWorldData = (function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'lavender.myWorld.v' + SCHEMA_VERSION;
  const STATE_KEY = 'myWorld';

  const MAX_SAFE = Number.MAX_SAFE_INTEGER;

  // ---------------------------------------------------------------------
  // Small local helpers (defensive numeric/date utilities, matching the
  // project's existing pattern of small guarded helpers such as
  // safeMs/safeElapsed/clamp10 in the rest of the codebase).
  // ---------------------------------------------------------------------

  function clampNum(n, min, max, fallback) {
    if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function safeString(s, fallback) {
    return (typeof s === 'string' && s.length > 0) ? s : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function localDateKey(d) {
    const date = (d instanceof Date && !isNaN(d)) ? d : new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  // ---------------------------------------------------------------------
  // Deterministic seed generation (creation-time only). Once a world's
  // tree.params.seed exists, it is treated as permanent identity for
  // that tree and is never regenerated — only carried forward.
  // ---------------------------------------------------------------------

  function makeSeed() {
    const t = Date.now() % 2147483647;
    const r = Math.floor(Math.random() * 2147483647);
    return (t ^ r) >>> 0;
  }

  // Tiny deterministic PRNG (mulberry32). Used only to derive a fixed
  // set of tree parameters once, at creation time. This is NOT used at
  // render time — myworld.js re-derives its own render-time randomness
  // from the persisted seed, so nothing here needs to run again later.
  function mulberry32(seed) {
    let s = seed;
    return function () {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deriveTreeParams(seed) {
    const rand = mulberry32(seed);
    return {
      seed: seed,
      // -1..1 lean direction/intensity of the trunk
      trunkCurve: clampNum(rand() * 2 - 1, -1, 1, 0),
      // relative thickness multiplier applied on top of each stage's base
      trunkThicknessVariant: clampNum(0.85 + rand() * 0.3, 0.7, 1.3, 1),
      // relative branch-count multiplier applied on top of each stage's base
      branchDensity: clampNum(0.8 + rand() * 0.4, 0.6, 1.4, 1),
      // -1..1 nudge applied to branch angles for a less uniform silhouette
      branchAngleVariant: clampNum(rand() * 2 - 1, -1, 1, 0),
      // selects a canopy silhouette family (see myworld-assets.js)
      canopyShapeVariant: Math.floor(rand() * 4),
      // selects a leaf color palette (see myworld-assets.js)
      leafColorVariant: Math.floor(rand() * 5),
      // relative leaf-cluster density multiplier
      leafDensityVariant: clampNum(0.85 + rand() * 0.3, 0.7, 1.3, 1),
      // -1..1 overall left/right asymmetry of the canopy
      asymmetry: clampNum(rand() * 2 - 1, -1, 1, 0),
      // selects a blossom accent palette, used only once a stage is
      // blossom-eligible (see myworld-assets.js)
      blossomVariant: Math.floor(rand() * 3),
      // selects a root-flare silhouette variant for later stages
      rootFlareVariant: Math.floor(rand() * 3)
    };
  }

  // ---------------------------------------------------------------------
  // Default / safe-empty world shape.
  // ---------------------------------------------------------------------

  function createDefaultWorld() {
    const seed = makeSeed();
    const iso = nowIso();
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: iso,
      lastUpdated: iso,

      // Placeholder mirror of study activity. Not computed here — a
      // future integration feeds this via setLifetimeStudyContribution().
      lifetimeStudyContribution: {
        totalMinutesApplied: 0,
        lastAppliedAmount: 0,
        lastAppliedAt: null
      },

      tree: {
        plantedAt: iso,
        lastGrowthAt: iso,
        // Abstract, slow-moving internal currency the tree grows
        // against. Intentionally never surfaced to the user as a
        // number, bar, or level — internal bookkeeping only.
        growthPoints: 0,
        totalGrowthEventsApplied: 0,
        // Index into the stage list defined in myworld-assets.js.
        stageIndex: 0,
        // 0..1 progress toward the next stage, for subtle in-stage
        // rendering variation only — never shown as a literal progress bar.
        stageProgress: 0,
        // Deterministic, persisted-forever visual identity of this tree.
        params: deriveTreeParams(seed)
      },

      // Structural placeholders only. Future phases populate and render
      // these; MyWorldData just guarantees the shape exists and is safe.
      environment: {
        flowers: [],
        grass: [],
        bushes: [],
        rocks: [],
        fireflies: { enabled: false, count: 0 },
        birds: { enabled: false, count: 0 },
        stars: { enabled: false, visible: false },
        weather: { current: 'clear' },
        season: { current: 'spring' },
        campfire: { lit: false, lastActionDate: null }
      },

      // Lightweight history of notable moments (e.g. stage changes).
      // Optional — nothing requires this to be populated.
      milestones: []
    };
  }

  // ---------------------------------------------------------------------
  // Validation / migration: take whatever was loaded (possibly missing
  // fields, possibly from an older schema) and return a complete, safe
  // world object. Never regenerates tree.params.seed if one is already
  // present — the tree's identity must stay stable across sessions.
  // ---------------------------------------------------------------------

  function mergeDefaults(raw) {
    const base = createDefaultWorld();
    if (!isPlainObject(raw)) return base;

    const world = base;

    world.schemaVersion = SCHEMA_VERSION;
    world.createdAt = safeString(raw.createdAt, base.createdAt);
    world.lastUpdated = safeString(raw.lastUpdated, base.lastUpdated);

    if (isPlainObject(raw.lifetimeStudyContribution)) {
      const c = raw.lifetimeStudyContribution;
      world.lifetimeStudyContribution.totalMinutesApplied =
        clampNum(c.totalMinutesApplied, 0, MAX_SAFE, base.lifetimeStudyContribution.totalMinutesApplied);
      world.lifetimeStudyContribution.lastAppliedAmount =
        clampNum(c.lastAppliedAmount, 0, MAX_SAFE, 0);
      world.lifetimeStudyContribution.lastAppliedAt =
        (typeof c.lastAppliedAt === 'string') ? c.lastAppliedAt : null;
    }

    if (isPlainObject(raw.tree)) {
      const t = raw.tree;
      world.tree.plantedAt = safeString(t.plantedAt, base.tree.plantedAt);
      world.tree.lastGrowthAt = safeString(t.lastGrowthAt, base.tree.lastGrowthAt);
      world.tree.growthPoints = clampNum(t.growthPoints, 0, MAX_SAFE, 0);
      world.tree.totalGrowthEventsApplied = clampNum(t.totalGrowthEventsApplied, 0, MAX_SAFE, 0);
      world.tree.stageIndex = clampNum(t.stageIndex, 0, 999, 0);
      world.tree.stageProgress = clampNum(t.stageProgress, 0, 1, 0);

      // Only trust persisted params as a whole if they carry a valid
      // seed. Partial/corrupt param sets fall back to a freshly-derived
      // set from the same seed (never a new random seed) when possible,
      // or to a brand-new seed only if no seed survived at all.
      if (isPlainObject(t.params) && typeof t.params.seed === 'number' && isFinite(t.params.seed)) {
        const p = t.params;
        world.tree.params = {
          seed: p.seed,
          trunkCurve: clampNum(p.trunkCurve, -1, 1, 0),
          trunkThicknessVariant: clampNum(p.trunkThicknessVariant, 0.7, 1.3, 1),
          branchDensity: clampNum(p.branchDensity, 0.6, 1.4, 1),
          branchAngleVariant: clampNum(p.branchAngleVariant, -1, 1, 0),
          canopyShapeVariant: clampNum(p.canopyShapeVariant, 0, 3, 0),
          leafColorVariant: clampNum(p.leafColorVariant, 0, 4, 0),
          leafDensityVariant: clampNum(p.leafDensityVariant, 0.7, 1.3, 1),
          asymmetry: clampNum(p.asymmetry, -1, 1, 0),
          blossomVariant: clampNum(p.blossomVariant, 0, 2, 0),
          rootFlareVariant: clampNum(p.rootFlareVariant, 0, 2, 0)
        };
      }
      // else: base.tree.params (freshly derived from a new seed) stands.
    }

    if (isPlainObject(raw.environment)) {
      const e = raw.environment;
      world.environment.flowers = Array.isArray(e.flowers) ? e.flowers : [];
      world.environment.grass = Array.isArray(e.grass) ? e.grass : [];
      world.environment.bushes = Array.isArray(e.bushes) ? e.bushes : [];
      world.environment.rocks = Array.isArray(e.rocks) ? e.rocks : [];

      if (isPlainObject(e.campfire)) {
        world.environment.campfire.lit = !!e.campfire.lit;
        world.environment.campfire.lastActionDate =
          (typeof e.campfire.lastActionDate === 'string') ? e.campfire.lastActionDate : null;
      }

      if (isPlainObject(e.fireflies)) {
        world.environment.fireflies.enabled = !!e.fireflies.enabled;
        world.environment.fireflies.count = clampNum(e.fireflies.count, 0, 999, 0);
      }
      if (isPlainObject(e.birds)) {
        world.environment.birds.enabled = !!e.birds.enabled;
        world.environment.birds.count = clampNum(e.birds.count, 0, 999, 0);
      }
      if (isPlainObject(e.stars)) {
        world.environment.stars.enabled = !!e.stars.enabled;
        world.environment.stars.visible = !!e.stars.visible;
      }
      if (isPlainObject(e.weather) && typeof e.weather.current === 'string') {
        world.environment.weather.current = e.weather.current;
      }
      if (isPlainObject(e.season) && typeof e.season.current === 'string') {
        world.environment.season.current = e.season.current;
      }
    }

    world.milestones = Array.isArray(raw.milestones)
      ? raw.milestones.filter((m) => isPlainObject(m) && typeof m.id === 'string')
      : [];

    return world;
  }

  // ---------------------------------------------------------------------
  // Storage backends
  // ---------------------------------------------------------------------

  function hasState() {
    try {
      return typeof State !== 'undefined' && !!State &&
        typeof State.get === 'function' && typeof State.patch === 'function';
    } catch (e) {
      return false;
    }
  }

  function readFromState() {
    try {
      const all = State.get();
      const world = all && all[STATE_KEY];
      return isPlainObject(world) ? world : null;
    } catch (e) {
      return null;
    }
  }

  function writeToState(world) {
    try {
      State.patch(STATE_KEY, world);
      return true;
    } catch (e) {
      return false;
    }
  }

  function hasLocalStorage() {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch (e) {
      return false;
    }
  }

  function readFromLocalStorage() {
    if (!hasLocalStorage()) return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writeToLocalStorage(world) {
    if (!hasLocalStorage()) return false;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(world));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Public load / persist API
  // ---------------------------------------------------------------------

  let cached = null;

  /**
   * Loads and returns the current world, validating/migrating as needed.
   * Idempotent and safe to call repeatedly (uses an in-memory cache).
   */
  function load() {
    if (cached) return cached;

    let raw = hasState() ? readFromState() : null;
    if (!raw) raw = readFromLocalStorage();

    cached = mergeDefaults(raw);

    // Writing the sanitized shape back is idempotent — re-running load()
    // must never mutate the seed or create duplicate records.
    persist(cached);

    return cached;
  }

  /**
   * Persists a full world object to every available backend. Always
   * mirrors to localStorage even when State is present, so My World
   * keeps working if State is ever unavailable on a given page.
   */
  function persist(world) {
    if (!isPlainObject(world)) return false;
    cached = world;

    let ok = false;
    if (hasState()) ok = writeToState(world) || ok;
    ok = writeToLocalStorage(world) || ok;
    return ok;
  }

  /** Returns the current world (loading it first if needed). */
  function getWorld() {
    return load();
  }

  /**
   * Applies a mutator function to a loaded copy of the world, stamps
   * lastUpdated, and persists. Returns the resulting world.
   * mutatorFn receives the current world and may mutate it in place
   * and/or return a replacement object.
   */
  function updateWorld(mutatorFn) {
    const world = load();
    let next = world;
    if (typeof mutatorFn === 'function') {
      const result = mutatorFn(world);
      if (isPlainObject(result)) next = result;
    }
    next.lastUpdated = nowIso();
    persist(next);
    return next;
  }

  /** Discards all My World data and starts a brand-new tree/world. */
  function resetWorld() {
    const fresh = createDefaultWorld();
    persist(fresh);
    return fresh;
  }

  // ---------------------------------------------------------------------
  // Narrow, purpose-built mutators (kept here so callers never need to
  // hand-roll world mutation logic / risk shape drift).
  // ---------------------------------------------------------------------

  /**
   * Records the latest known lifetime study contribution. This is a
   * placeholder mirror only — MyWorldData does not compute this value;
   * a future integration is responsible for calling this with real data.
   * `deltaMinutes` is optional context (what was just applied), not a
   * separate running total.
   */
  function setLifetimeStudyContribution(totalMinutes, deltaMinutes) {
    return updateWorld((world) => {
      world.lifetimeStudyContribution.totalMinutesApplied =
        clampNum(totalMinutes, 0, MAX_SAFE, world.lifetimeStudyContribution.totalMinutesApplied);
      world.lifetimeStudyContribution.lastAppliedAmount =
        clampNum(deltaMinutes, 0, MAX_SAFE, 0);
      world.lifetimeStudyContribution.lastAppliedAt = nowIso();
      return world;
    });
  }

  /**
   * Updates the tree's growth bookkeeping. Stage/threshold interpretation
   * lives in myworld-assets.js / myworld.js — this only stores whatever
   * values it's given, defensively clamped.
   */
  function setTreeGrowth(growthPoints, stageIndex, stageProgress) {
    return updateWorld((world) => {
      if (typeof growthPoints === 'number') {
        world.tree.growthPoints = clampNum(growthPoints, 0, MAX_SAFE, world.tree.growthPoints);
      }
      if (typeof stageIndex === 'number') {
        world.tree.stageIndex = clampNum(stageIndex, 0, 999, world.tree.stageIndex);
      }
      if (typeof stageProgress === 'number') {
        world.tree.stageProgress = clampNum(stageProgress, 0, 1, world.tree.stageProgress);
      }
      world.tree.lastGrowthAt = nowIso();
      world.tree.totalGrowthEventsApplied = (world.tree.totalGrowthEventsApplied || 0) + 1;
      return world;
    }).tree;
  }

    /** Shallow, safe merge into the environment placeholder block. */
  function patchEnvironment(partial) {
    return updateWorld((world) => {
      if (isPlainObject(partial)) {
        world.environment = Object.assign({}, world.environment, partial);
      }
      return world;
    }).environment;
  }

  /**
   * Sets the campfire's lit/unlit state without touching lastActionDate.
   * Turning the campfire off never undoes a day's already-recorded action.
   */
  function setCampfireLit(lit) {
    return updateWorld((world) => {
      world.environment.campfire = Object.assign({}, world.environment.campfire, { lit: !!lit });
      return world;
    }).environment.campfire;
  }

  /**
   * Records "the campfire was lit" as today's consistency action, at most
   * once per calendar day. Lighting it again later the same day is a
   * no-op for progress (lit stays true, lastActionDate is unchanged).
   * Returns { isNewDayAction, dateKey } so callers can decide whether to
   * apply any further consequence (e.g. tree growth) exactly once.
   */
  function recordCampfireLight() {
    const today = localDateKey();
    const world = load();
    const prevDate = world.environment.campfire.lastActionDate;
    const isNewDayAction = prevDate !== today;

    updateWorld((w) => {
      w.environment.campfire = Object.assign({}, w.environment.campfire, {
        lit: true,
        lastActionDate: isNewDayAction ? today : prevDate
      });
      return w;
    });

    return { isNewDayAction: isNewDayAction, dateKey: today };
  }

  /**
   * Appends a milestone entry (e.g. "reached a new stage"). Idempotent
   * by id — calling twice with the same id will not create a duplicate.
   */
  function addMilestone(entry) {
    const world = load();
    const milestone = {
      id: (entry && typeof entry.id === 'string' && entry.id) ||
        ('m_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36)),
      type: (entry && typeof entry.type === 'string') ? entry.type : 'note',
      stageIndex: clampNum(entry && entry.stageIndex, 0, 999, world.tree.stageIndex),
      timestamp: nowIso(),
      note: (entry && typeof entry.note === 'string') ? entry.note : ''
    };

    const alreadyExists = world.milestones.some((m) => m.id === milestone.id);
    if (!alreadyExists) {
      updateWorld((w) => {
        w.milestones = w.milestones.concat([milestone]);
        return w;
      });
    }
    return milestone;
  }

  // ---------------------------------------------------------------------
  // Backup / Restore support (called by backup.js). Validation reuses
  // mergeDefaults(); storage still goes through updateWorld()/persist().
  // ---------------------------------------------------------------------

  /**
   * Merges a world record from a backup into the live world. Live data wins
   * on conflict, backup-only milestones are added, live-only data is kept.
   * A live world that has never grown is just the fresh default — there is
   * nothing in it to protect — so the backup's tree, study mirror and
   * environment are adopted instead. Never throws on malformed input.
   * Returns { adopted, milestonesAdded }.
   */
  function mergeBackupWorld(rawWorld) {
    const result = { adopted: false, milestonesAdded: 0 };
    if (!isPlainObject(rawWorld)) return result;

    const backup = mergeDefaults(rawWorld);
    const live = load();
    const pristine = live.tree.growthPoints === 0 &&
      live.tree.totalGrowthEventsApplied === 0 &&
      live.lifetimeStudyContribution.totalMinutesApplied === 0 &&
      live.milestones.length === 0;

    updateWorld((world) => {
      if (pristine) {
        world.createdAt = backup.createdAt;
        world.lifetimeStudyContribution = backup.lifetimeStudyContribution;
        world.tree = backup.tree;
        world.environment = backup.environment;
        result.adopted = true;
      }
      const have = Object.create(null);
      world.milestones.forEach((m) => { have[m.id] = true; });
      backup.milestones.forEach((m) => {
        if (have[m.id]) return;
        have[m.id] = true;
        world.milestones.push(m);
        result.milestonesAdded++;
      });
      return world;
    });
    return result;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  return {
    SCHEMA_VERSION,

    // lifecycle
    load,
    getWorld,
    updateWorld,
    persist,
    resetWorld,

        // targeted mutators
    setLifetimeStudyContribution,
    setTreeGrowth,
    patchEnvironment,
    setCampfireLit,
    recordCampfireLight,
    addMilestone,

    // backup / restore
    mergeBackupWorld,

    // exposed for myworld.js / myworld-assets.js render-time use, and
    // for tests — pure, no side effects
    createDefaultWorld,
    deriveTreeParams
  };
})();
