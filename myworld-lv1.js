
/**
 * myworld-lv1.js — LV1 content pack.
 * ----------------------------------------------------------------------
 * Owns LV1's world-specific interaction/progression decisions that the
 * generic My World core must not need to know about:
 * - the campfire's lit/unlit interaction state
 * - "lighting the campfire counts as today's consistency action" (once
 *   per calendar day; turning it off never undoes a day already earned)
 * - the campfire-day -> tree-growth progression rate
 *
 * Does NOT own campfire/campsite/tent rendering or hit-test geometry —
 * those remain in myworld.js unchanged, since they are existing visuals
 * this migration must not alter.
 *
 * Persistence goes through MyWorldData's generic, pack-agnostic
 * getLVState/patchLVState/recordLVDailyAction primitives, namespaced
 * under this pack's own id ('lv1') and action key ('campfire') — the
 * core data layer never needs to know these names mean "campfire".
 *
 * Load order: myworld-data.js -> myworld-assets.js -> myworld-content.js
 * -> myworld-lv1.js -> myworld.js
 * ----------------------------------------------------------------------
 */
const MyWorldLV1 = (function () {
  'use strict';

  const PACK_ID = 'lv1';
  const ACTION_KEY = 'campfire';
  // Daily campfire consistency action reaches max tree growth in ~7-10 days.
  const GROWTH_TARGET_DAYS = 8;

  function hasData() {
    return typeof MyWorldData !== 'undefined' && !!MyWorldData;
  }

  /** Whether the campfire is currently persisted as lit. */
  function isLit() {
    if (!hasData()) return false;
    const s = MyWorldData.getLVState(PACK_ID);
    return !!(s && s.campfire && s.campfire.lit);
  }

  function setLit(lit) {
    if (!hasData()) return;
    MyWorldData.patchLVState(PACK_ID, { campfire: { lit: !!lit } });
  }

  /**
   * Per-day growth-point delta for a single campfire consistency action,
   * sized so ~GROWTH_TARGET_DAYS of daily actions carries the tree from
   * its first stage to its last.
   */
  function getGrowthPerDay(engine) {
    const stages = (engine && engine.getTreeStages) ? engine.getTreeStages() : null;
    if (!stages || !stages.length) return 0;
    const max = stages[stages.length - 1].minGrowthPoints || 0;
    return max > 0 ? (max / GROWTH_TARGET_DAYS) : 0;
  }

  /**
   * Called once per successful "light the campfire" interaction. Records
   * today's consistency action (at most once per calendar day) and, only
   * on a genuinely new day, applies this pack's growth rate to the
   * active tree via the engine's generic growth API.
   */
  function applyDailyAction(engine) {
    if (!hasData()) return;
    const result = MyWorldData.recordLVDailyAction(PACK_ID, ACTION_KEY);
    if (!result || !result.isNewDayAction) return;
    const delta = getGrowthPerDay(engine);
    if (delta > 0 && engine && engine.growActiveTree) engine.growActiveTree(delta);
  }

  /** Called by the core when the world is (re)entered, to sync visual state. */
  function onEnter() {
    return isLit();
  }

  /**
   * Called by the core when the campfire is toggled. `wasLit` is the
   * core's current visual state; `engine` exposes the small generic
   * growth API this pack needs (growActiveTree, getTreeStages). Returns
   * the new lit state for the core to use for rendering.
   */
  function toggle(wasLit, engine) {
    const nowLit = !wasLit;
    setLit(nowLit);
    if (nowLit) applyDailyAction(engine);
    return nowLit;
  }

  return {
    id: PACK_ID,
    onEnter,
    toggle
  };
})();
