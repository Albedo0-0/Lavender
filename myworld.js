/**
 * myworld.js
 * ----------------------------------------------------------------------
 * My World — main controller.
 *
 * Depends on MyWorldData (persistence) and MyWorldAssets (stage/visual
 * definitions). Must be loaded after both.
 *
 * Responsibilities:
 * - initialize a My World mount point (given a container element)
 * - load/read current world state (delegates to MyWorldData)
 * - calculate gradual tree growth from growth points (delegates
 *   thresholds to MyWorldAssets, persists results via MyWorldData)
 * - render the scene and the tree into the DOM
 * - offer a clearly-marked, NOT-YET-WIRED hook for future study
 *   progress to feed tree growth
 *
 * Explicitly out of scope for this file (per spec):
 * - no navigation integration (nothing calls Nav.switchTo, nothing
 *   assumes a #screen-myworld exists)
 * - no TimeEngine integration (nothing subscribes to TimeEngine)
 * - no Study-screen integration
 * - no automatic mounting on page load — a future integration turn
 *   calls `MyWorld.init(containerEl)` explicitly.
 *
 * Rendering vs. persistence stay separated: this file never writes to
 * localStorage/State directly — all persistence goes through
 * MyWorldData's API. Rendering functions never mutate world data.
 *
 * Determinism: the tree's on-screen shape is fully derived from
 * `world.tree.params` (persisted once, forever, by MyWorldData) plus
 * the current stage. Re-rendering the same world state always produces
 * the same SVG — nothing here calls Math.random().
 * ----------------------------------------------------------------------
 */

const MyWorld = (function () {
  'use strict';

  // -----------------------------------------------------------------
  // Tunable growth-rate constants.
  //
  // Not wired to anything yet — applyStudyProgress() below is a stub
  // future integrations call manually. Kept here (not in
  // myworld-data.js) because this is growth-calculation policy, not
  // persisted data.
  // -----------------------------------------------------------------

  // Deliberately small: growth should be measured in weeks/months of
  // real study activity, not minutes. Tune once real usage data exists.
  const GROWTH_POINTS_PER_STUDY_MINUTE = 0.15;

  // -----------------------------------------------------------------
  // Small local helpers
  // -----------------------------------------------------------------

  function clampNum(n, min, max, fallback) {
    if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function hasAssets() {
    return typeof MyWorldAssets !== 'undefined' && !!MyWorldAssets;
  }

  function hasData() {
    return typeof MyWorldData !== 'undefined' && !!MyWorldData;
  }

  function warnMissingDeps(fnName) {
    if (typeof window !== 'undefined' && window.console && console.warn) {
      console.warn('[MyWorld] ' + fnName + '() called before MyWorldData/MyWorldAssets were available.');
    }
  }

  // Render-time deterministic PRNG. Independent from MyWorldData's own
  // creation-time PRNG — it only needs to be deterministic given the
  // same seed, not bit-identical to it. Given the same persisted seed,
  // this always produces the same sequence, so the tree never changes
  // shape between renders on its own.
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // -----------------------------------------------------------------
  // Growth calculation (pure). Given a world's current growthPoints,
  // derives the stage index + in-stage progress it corresponds to,
  // via MyWorldAssets — the single source of truth for thresholds.
  // -----------------------------------------------------------------

  function computeGrowthState(world) {
    if (!hasAssets() || !world || !world.tree) {
      return { stageIndex: 0, stageProgress: 0 };
    }
    const growthPoints = world.tree.growthPoints || 0;
    const stageIndex = MyWorldAssets.getStageIndexForGrowthPoints(growthPoints);
    const stageProgress = MyWorldAssets.getStageProgress(growthPoints);
    return { stageIndex, stageProgress };
  }

  /**
   * Recomputes stage/progress from growthPoints and persists them if
   * they've drifted from what's stored. Idempotent — safe to call on
   * every load/render; will not write anything if nothing changed, and
   * will never touch growthPoints itself or the seed.
   */
  function recalculateGrowth() {
    if (!hasData()) { warnMissingDeps('recalculateGrowth'); return null; }
    const world = MyWorldData.getWorld();
    const derived = computeGrowthState(world);

    const stageChanged = derived.stageIndex !== world.tree.stageIndex;
    const progressChanged = Math.abs(derived.stageProgress - world.tree.stageProgress) > 0.0001;

    if (stageChanged || progressChanged) {
      MyWorldData.setTreeGrowth(world.tree.growthPoints, derived.stageIndex, derived.stageProgress);
      if (stageChanged && hasAssets()) {
        const stageDef = MyWorldAssets.getStageByIndex(derived.stageIndex);
        MyWorldData.addMilestone({
          type: 'stage-change',
          stageIndex: derived.stageIndex,
          note: stageDef ? stageDef.name : ''
        });
      }
    }

    return derived;
  }

  // -----------------------------------------------------------------
  // Future study-progress hook.
  //
  // NOT called from anywhere yet — no TimeEngine/Study wiring exists.
  // A future integration turn will decide when/how often to call this
  // (e.g. on session end) and with what `deltaMinutes` / running total.
  // -----------------------------------------------------------------

  /**
   * Applies an incremental amount of study time to the world's growth.
   * `deltaMinutes` is the amount of NEW study time since the last call
   * (not a cumulative total). `newLifetimeTotalMinutes` is optional —
   * if provided, it's stored as the mirrored lifetime total; if not,
   * the previous total plus deltaMinutes is used.
   *
   * This function does not read from TimeEngine/SessionRecords itself —
   * it only accepts numbers a future caller supplies, keeping MyWorld
   * from ever becoming a second source of truth for study time.
   */
  function applyStudyProgress(deltaMinutes, newLifetimeTotalMinutes) {
    if (!hasData()) { warnMissingDeps('applyStudyProgress'); return null; }

    const delta = clampNum(deltaMinutes, 0, Number.MAX_SAFE_INTEGER, 0);
    if (delta <= 0) return MyWorldData.getWorld();

    const world = MyWorldData.getWorld();
    const priorTotal = world.lifetimeStudyContribution.totalMinutesApplied || 0;
    const total = (typeof newLifetimeTotalMinutes === 'number' && isFinite(newLifetimeTotalMinutes))
      ? clampNum(newLifetimeTotalMinutes, 0, Number.MAX_SAFE_INTEGER, priorTotal + delta)
      : priorTotal + delta;

    MyWorldData.setLifetimeStudyContribution(total, delta);

    const addedGrowthPoints = delta * GROWTH_POINTS_PER_STUDY_MINUTE;
    const newGrowthPoints = clampNum(
      (world.tree.growthPoints || 0) + addedGrowthPoints,
      0, Number.MAX_SAFE_INTEGER, world.tree.growthPoints || 0
    );
    MyWorldData.setTreeGrowth(newGrowthPoints);

    return recalculateGrowth() && MyWorldData.getWorld();
  }

  // -----------------------------------------------------------------
  // Tree rendering (pure — reads world + assets, returns an SVG
  // string; does not mutate anything).
  // -----------------------------------------------------------------

  const SCENE = {
    viewBoxWidth: 400,
    viewBoxHeight: 400,
    groundY: 336,
    baseX: 200,
    maxTrunkHeight: 220,
    maxTrunkThickness: 22,
    maxCanopyRadius: 100
  };

  function buildTrunkPath(stageDef, params, rand) {
    const height = SCENE.maxTrunkHeight * stageDef.trunkHeightRatio;
    if (height <= 0) return '';

    const thickness = Math.max(
      2,
      SCENE.maxTrunkThickness * stageDef.trunkThicknessBase * params.trunkThicknessVariant
    );
    const lean = params.trunkCurve * (height * 0.18);

    const baseX = SCENE.baseX;
    const baseY = SCENE.groundY;
    const topX = baseX + lean;
    const topY = baseY - height;

    // Gentle S-curve control points, nudged by a touch of deterministic
    // jitter so the trunk doesn't look perfectly mechanical.
    const jitter = (rand() - 0.5) * height * 0.06;
    const c1x = baseX + lean * 0.3 + jitter;
    const c1y = baseY - height * 0.35;
    const c2x = baseX + lean * 0.7 - jitter;
    const c2y = baseY - height * 0.7;

    const halfBase = thickness / 2;
    const halfTop = Math.max(1, thickness * 0.35);

    const leftBase = baseX - halfBase;
    const rightBase = baseX + halfBase;
    const leftTop = topX - halfTop;
    const rightTop = topX + halfTop;

    return (
      '<path class="myworld-trunk" ' +
      'd="M ' + leftBase.toFixed(1) + ' ' + baseY.toFixed(1) +
      ' C ' + (c1x - halfBase * 0.6).toFixed(1) + ' ' + c1y.toFixed(1) +
      ' ' + (c2x - halfTop * 0.6).toFixed(1) + ' ' + c2y.toFixed(1) +
      ' ' + leftTop.toFixed(1) + ' ' + topY.toFixed(1) +
      ' L ' + rightTop.toFixed(1) + ' ' + topY.toFixed(1) +
      ' C ' + (c2x + halfTop * 0.6).toFixed(1) + ' ' + c2y.toFixed(1) +
      ' ' + (c1x + halfBase * 0.6).toFixed(1) + ' ' + c1y.toFixed(1) +
      ' ' + rightBase.toFixed(1) + ' ' + baseY.toFixed(1) +
      ' Z" />'
    );
  }

  function buildBranches(stageDef, params, rand, topX, topY, height) {
    if (!stageDef.canopyPresent || stageDef.branchCountBase <= 0) return '';

    const count = Math.max(0, Math.round(stageDef.branchCountBase * params.branchDensity));
    let svg = '';

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const side = (i % 2 === 0) ? -1 : 1;
      const angleBase = lerp(-0.9, 0.9, t) + params.branchAngleVariant * 0.4;
      const angle = angleBase * side * -1;
      const len = height * (0.18 + rand() * 0.16);
      const startY = topY + height * (0.15 + t * 0.55);
      const startX = topX + (rand() - 0.5) * 6;

      const endX = startX + Math.sin(angle) * len;
      const endY = startY - Math.cos(angle) * len * 0.7;

      const ctrlX = startX + Math.sin(angle) * len * 0.5 + (rand() - 0.5) * 10;
      const ctrlY = startY - Math.cos(angle) * len * 0.35;

      svg +=
        '<path class="myworld-branch" d="M ' + startX.toFixed(1) + ' ' + startY.toFixed(1) +
        ' Q ' + ctrlX.toFixed(1) + ' ' + ctrlY.toFixed(1) +
        ' ' + endX.toFixed(1) + ' ' + endY.toFixed(1) + '" />';
    }

    return svg;
  }

  function buildCanopy(stageDef, params, rand, topX, topY) {
    if (!stageDef.canopyPresent) return '';

    const shapeFamily = MyWorldAssets.getCanopyShapeFamily(params.canopyShapeVariant);
    const palette = MyWorldAssets.getLeafPalette(params.leafColorVariant);

    const radius = Math.max(6, SCENE.maxCanopyRadius * stageDef.canopyRadiusRatio);
    const density = clampNum(stageDef.leafDensityBase * params.leafDensityVariant, 0, 1.4, stageDef.leafDensityBase);
    const blobCount = Math.max(1, Math.round(shapeFamily.blobCountBase * (0.6 + density * 0.6)));

    const centerX = topX + params.asymmetry * radius * 0.3;
    const centerY = topY - radius * (0.5 + shapeFamily.verticalBias);

    let svg = '<g class="myworld-canopy">';

    for (let i = 0; i < blobCount; i++) {
      const angle = (i / blobCount) * Math.PI * 2 + rand() * 0.6;
      const spread = radius * shapeFamily.blobSpread * (0.4 + rand() * 0.6);
      const bx = centerX + Math.cos(angle) * spread * (0.5 + params.asymmetry * 0.2);
      const by = centerY + Math.sin(angle) * spread * 0.65;
      const br = radius * (0.28 + rand() * 0.24);
      const shadeIdx = Math.floor(rand() * palette.shades.length);
      const color = palette.shades[shadeIdx];
      const opacity = (0.72 + rand() * 0.22).toFixed(2);

      svg +=
        '<circle class="myworld-leaf-blob" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) +
        '" r="' + br.toFixed(1) + '" fill="' + color + '" opacity="' + opacity + '" />';
    }

    // A soft highlight blob near the top for a touch of light/depth.
    svg +=
      '<circle class="myworld-leaf-highlight" cx="' + (centerX - radius * 0.15).toFixed(1) +
      '" cy="' + (centerY - radius * 0.35).toFixed(1) + '" r="' + (radius * 0.3).toFixed(1) +
      '" fill="' + palette.highlight + '" opacity="0.35" />';

    if (stageDef.blossomEligible) {
      const blossomPalette = MyWorldAssets.getBlossomPalette(params.blossomVariant);
      const blossomCount = Math.round(blobCount * 0.7);
      for (let i = 0; i < blossomCount; i++) {
        const angle = rand() * Math.PI * 2;
        const spread = radius * shapeFamily.blobSpread * rand();
        const bx = centerX + Math.cos(angle) * spread;
        const by = centerY + Math.sin(angle) * spread * 0.65;
        const br = radius * (0.03 + rand() * 0.035);
        svg +=
          '<circle class="myworld-blossom" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) +
          '" r="' + br.toFixed(1) + '" fill="' + blossomPalette.color + '" />';
      }
    }

    svg += '</g>';
    return svg;
  }

  function buildRootFlare(stageDef, params, rand) {
    if (!stageDef.rootFlarePresent) return '';

    const variant = MyWorldAssets.getRootFlareVariant(params.rootFlareVariant);
    const baseX = SCENE.baseX;
    const baseY = SCENE.groundY;
    const width = 26 * variant.flareWidth;

    let svg = '<g class="myworld-root-flare">';
    for (let i = 0; i < variant.flareCount; i++) {
      const t = variant.flareCount > 1 ? i / (variant.flareCount - 1) : 0.5;
      const side = lerp(-1, 1, t);
      const spread = width * (0.4 + Math.abs(side) * 0.6);
      const endX = baseX + side * spread + (rand() - 0.5) * 6;
      const endY = baseY + 10 + rand() * 6;
      svg +=
        '<path class="myworld-root" d="M ' + baseX.toFixed(1) + ' ' + (baseY - 4).toFixed(1) +
        ' Q ' + (baseX + side * spread * 0.5).toFixed(1) + ' ' + (baseY + 4).toFixed(1) +
        ' ' + endX.toFixed(1) + ' ' + endY.toFixed(1) + '" />';
    }
    svg += '</g>';
    return svg;
  }

  /**
   * Builds a full, self-contained SVG string for the current tree.
   * Deterministic: identical input world always produces identical
   * output markup.
   */
  function buildTreeSVG(world) {
    if (!hasAssets() || !world || !world.tree) return '';

    const params = world.tree.params;
    const stageDef = MyWorldAssets.getStageByIndex(world.tree.stageIndex);
    const rand = mulberry32(params.seed);

    const height = SCENE.maxTrunkHeight * stageDef.trunkHeightRatio;
    const lean = params.trunkCurve * (height * 0.18);
    const topX = SCENE.baseX + lean;
    const topY = SCENE.groundY - height;

    let svg =
      '<svg class="myworld-tree-svg myworld-tree--' + stageDef.family +
      '" viewBox="0 0 ' + SCENE.viewBoxWidth + ' ' + SCENE.viewBoxHeight +
      '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">';

    svg += buildRootFlare(stageDef, params, rand);
    svg += buildTrunkPath(stageDef, params, rand);
    svg += buildBranches(stageDef, params, rand, topX, topY, height);
    svg += buildCanopy(stageDef, params, rand, topX, topY);

    svg += '</svg>';
    return svg;
  }

  // -----------------------------------------------------------------
  // DOM rendering. Split into "ensure structure exists" (run once per
  // container) and "update from state" (safe to call repeatedly, no
  // duplicate listeners since no listeners are attached here at all).
  // -----------------------------------------------------------------

  const ROOT_CLASS = 'myworld-root';

  function ensureDom(container) {
    if (!container) return null;

    let root = container.querySelector('.' + ROOT_CLASS);
    if (root) return root;

    root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.innerHTML =
      '<div class="myworld-sky">' +
      '  <div class="myworld-stars-layer" data-myworld-layer="stars"></div>' +
      '  <div class="myworld-clouds-layer" data-myworld-layer="clouds"></div>' +
      '</div>' +
      '<div class="myworld-scene">' +
      '  <div class="myworld-tree-layer" data-myworld-layer="tree"></div>' +
      '  <div class="myworld-environment-layer" data-myworld-layer="environment"></div>' +
      '  <div class="myworld-ground"></div>' +
      '</div>';

    container.innerHTML = '';
    container.appendChild(root);
    return root;
  }

  function updateDom(root, world) {
    if (!root || !world) return;

    const treeLayer = root.querySelector('[data-myworld-layer="tree"]');
    if (treeLayer) {
      treeLayer.innerHTML = buildTreeSVG(world);
    }

    // Environment layer intentionally left empty for now — future
    // phases will populate it from world.environment using the
    // structural placeholders defined in myworld-assets.js.
  }

  /** Renders the tree only, into a specific container (no scene chrome). */
  function renderTree(container) {
    if (!container || !hasData()) { warnMissingDeps('renderTree'); return; }
    const world = MyWorldData.getWorld();
    container.innerHTML = buildTreeSVG(world);
  }

  /** Full scene render (sky/ground/tree) into the given container. */
  function render(container) {
    if (!container) return;
    if (!hasData() || !hasAssets()) { warnMissingDeps('render'); return; }

    recalculateGrowth();
    const world = MyWorldData.getWorld();
    const root = ensureDom(container);
    updateDom(root, world);
  }

  // -----------------------------------------------------------------
  // Public lifecycle
  // -----------------------------------------------------------------

  let mountedContainer = null;

  /**
   * Initializes My World into the given container element. Safe to
   * call more than once with the same container (idempotent — reuses
   * existing DOM rather than duplicating it).
   */
  function init(container) {
    if (!hasData() || !hasAssets()) {
      warnMissingDeps('init');
      return null;
    }
    mountedContainer = container || mountedContainer;
    MyWorldData.load();
    recalculateGrowth();
    if (mountedContainer) render(mountedContainer);
    return getState();
  }

  /** Reads current world state without side effects on the DOM. */
  function loadState() {
    if (!hasData()) { warnMissingDeps('loadState'); return null; }
    return MyWorldData.load();
  }

  /** Alias for reading current world state (no recompute/side effects). */
  function getState() {
    if (!hasData()) { warnMissingDeps('getState'); return null; }
    return MyWorldData.getWorld();
  }

  /** Forces a persistence flush of the current in-memory world state. */
  function save() {
    if (!hasData()) { warnMissingDeps('save'); return false; }
    return MyWorldData.persist(MyWorldData.getWorld());
  }

  /** Re-renders into the last-initialized container, if any. */
  function refresh() {
    if (mountedContainer) render(mountedContainer);
  }

  return {
    // lifecycle
    init,
    loadState,
    getState,
    save,
    refresh,

    // rendering
    render,
    renderTree,

    // growth
    recalculateGrowth,
    computeGrowthState,
    applyStudyProgress,

    // exposed for debugging / future integration convenience
    buildTreeSVG
  };
})();
