
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

  // Campsite/tent/campfire geometry, owned by this pack. Populated by
  // buildGroundProps() (called from myworld.js's buildTerrain), consumed
  // by stampGroundProps() (ground-layer paint), draw() (per-frame overlay)
  // and onCanvasClick() (hit-test) below.
  let campsite = null;
  let campfireGlowHalo = null;

  function clampNum(n, min, max, fallback) {
    if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

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

  /** Called by the core when the world is exited (fullscreen closed). */
  function onExit() {
    campsite = null;
    campfireGlowHalo = null;
  }

  /**
   * Called by the core's toggle path. Kept for compatibility; the tap
   * itself now arrives via onCanvasClick below, which calls this.
   */
  function toggle(wasLit, engine) {
    const nowLit = !wasLit;
    setLit(nowLit);
    if (nowLit) applyDailyAction(engine);
    return nowLit;
  }

  // -----------------------------------------------------------------
  // Ground props: campsite + tent + campfire position. Geometry only
  // (same placement rule as the original core implementation).
  // -----------------------------------------------------------------
  function buildGroundProps(surf, W, TREE_SLOT, pond) {
    if (!surf) { campsite = null; return; }
    const treeX = Math.floor(W * TREE_SLOT);
    const side = treeX > W * 0.55 ? -1 : 1;
    let x = clampNum(treeX + side * Math.round(W * 0.22), 10, W - 16, treeX);
    if (pond && x >= pond.x0 - 8 && x <= pond.x1 + 8) {
      x = clampNum(treeX - side * Math.round(W * 0.22), 10, W - 16, treeX);
    }
    const fx = clampNum(x + 9, 10, W - 6, x + 9);
    campsite = { x: x, y: surf[x], fireX: fx, fireY: surf[fx] };
  }

  function resetGroundProps() {
    campsite = null;
    campfireGlowHalo = null;
  }

  /** Paints the tent + cold-fire pit into the ground layer (same visual as before). */
  function stampGroundProps(g, env) {
    if (!campsite) return;
    function css(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
    function quant(c) { return c.map(function (v) { return Math.min(255, Math.max(0, Math.round(v / 6) * 6)); }); }

    const x = campsite.x;
    const y = campsite.y;
    const fabric = css(quant(mixRgb([196, 156, 108], env.sky.bot, 0.15 * env.nf)));
    const fabricShade = css(quant(mixRgb([146, 108, 74], env.sky.bot, 0.18 * env.nf)));
    const doorway = css(quant(mixRgb([40, 30, 26], env.sky.bot, 0.1 * env.nf)));
    const h = 14;
    for (let r = 0; r < h; r++) {
      const hw = Math.max(1, Math.round((r + 1) / h * 7));
      g.fillStyle = r % 2 === 0 ? fabric : fabricShade;
      g.fillRect(x - hw, y - h + r, hw * 2, 1);
    }
    g.fillStyle = doorway;
    g.fillRect(x - 1, y - 6, 2, 6);

    const fx = campsite.fireX;
    const fy = campsite.fireY;
    g.fillStyle = css(quant(mixRgb([120, 118, 116], env.sky.bot, 0.2 * env.nf)));
    g.fillRect(fx - 3, fy - 1, 6, 1);
    g.fillStyle = css(quant(mixRgb([90, 62, 40], env.sky.bot, 0.2 * env.nf)));
    g.fillRect(fx - 2, fy - 2, 4, 1);
    g.fillRect(fx - 1, fy - 3, 2, 1);
  }

  function buildCampfireGlowHalo() {
    const size = 17;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = g.createImageData(size, size);
    const d = img.data;
    const cx = (size - 1) / 2;
    const cy = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const a = Math.max(0, 1 - dist / (cx + 0.5));
        const j = (y * size + x) * 4;
        d[j] = 255; d[j + 1] = 176; d[j + 2] = 96; d[j + 3] = Math.round(Math.pow(a, 1.7) * 120);
      }
    }
    g.putImageData(img, 0, 0);
    campfireGlowHalo = c;
  }

/** Per-frame overlay draw (flame + glow), called from myworld.js's drawFrame. */
  function draw(ctx, W, H, clockElapsed) {
    if (!campsite || !isLit()) return;
    if (!campfireGlowHalo) buildCampfireGlowHalo();
    const fx = campsite.fireX;
    const fy = campsite.fireY;
    const flick = 0.85 + 0.15 * Math.sin(clockElapsed * 6);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flick;
    ctx.drawImage(campfireGlowHalo, Math.round(fx) - 8, Math.round(fy) - 10);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const sway = Math.sin(clockElapsed * 5) * 0.6;
    ctx.fillStyle = '#ff8a3d';
    ctx.fillRect(Math.round(fx - 1 + sway), fy - 7, 2, 6);
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(Math.round(fx + sway * 0.6), fy - 8, 1, 4);
  }

  /** Hit-test in canvas pixel space, called from myworld.js's onCanvasClick. */
  function onCanvasClick(px, py, engine) {
    if (!campsite) return;
    const dx = px - campsite.fireX;
    const dy = py - (campsite.fireY - 2);
    if (dx * dx + dy * dy <= 25) toggle(isLit(), engine);
  }

  const api = {
    id: PACK_ID,
    onEnter,
    onExit,
    toggle,
    buildGroundProps,
    resetGroundProps,
    stampGroundProps,
    drawForeground: draw,
    onCanvasClick,
    getCampsite: function () { return campsite; }
  };

  // Register into the generic pack registry under this pack's own id
  // ('lv1') so myworld.js can resolve it the same way it resolves any
  // imported pack — by the active world's declared lvPack id — rather
  // than by scanning for this file's global.
  if (typeof MyWorldContent !== 'undefined' && MyWorldContent && MyWorldContent.registerPack) {
    MyWorldContent.registerPack(api);
  }

  return api;
})();
