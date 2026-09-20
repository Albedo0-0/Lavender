/**
 * myworld-assets.js
 * ----------------------------------------------------------------------
 * My World — centralized, data-driven definitions for the world's
 * visual stages.
 *
 * This module owns:
 * - the tree's stage list (many small, subtle stages rather than a few
 *   dramatic upgrades), including the growth-point thresholds that
 *   define when a stage is reached
 * - visual "families" the tree draws from (canopy shapes, leaf
 *   palettes, blossom palettes, root-flare variants) — deterministic,
 *   selected once per tree via the persisted params in myworld-data.js
 * - structural placeholders for future environment systems (flowers,
 *   grass, bushes, rocks, fireflies, birds, stars, weather, seasons)
 *
 * This module does NOT render anything and does NOT touch persistence —
 * it is pure data plus small pure lookup helpers, consumed by
 * myworld.js.
 *
 * Tuning note: growthPoints thresholds below are intentionally
 * generous placeholders. The actual rate at which growth points accrue
 * (e.g. per study minute) is decided later in myworld.js, once a real
 * feed exists — until then nothing advances these on its own.
 * ----------------------------------------------------------------------
 */

const MyWorldAssets = (function () {
  'use strict';

  // -----------------------------------------------------------------
  // Tree growth stages.
  //
  // Each stage:
  //  - id / key: stable identifier, never renumber/reuse
  //  - name: human-readable (kept understated on purpose — no "Level"
  //    or "XP" language anywhere in this file)
  //  - family: coarse grouping used for CSS state classes
  //    ('seed' | 'sprout' | 'sapling' | 'tree' | 'elder')
  //  - minGrowthPoints: threshold at which this stage begins
  //  - description: short, quiet, non-triumphant flavor text
  //  - render hints consumed by myworld.js's procedural tree drawing:
  //      trunkHeightRatio   (0..1, relative to the scene's max trunk height)
  //      trunkThicknessBase (0..1, relative to the scene's max trunk thickness)
  //      canopyPresent      (bool — does this stage draw a canopy at all)
  //      canopyRadiusRatio  (0..1, relative to the scene's max canopy radius)
  //      leafDensityBase    (0..1, base leaf-cluster density before params multiplier)
  //      branchCountBase    (int, base branch count before params multiplier)
  //      blossomEligible    (bool — can blossom accents appear at this stage)
  //      rootFlarePresent   (bool — do visible root flares render at the base)
  //
  // Thresholds increase with growing gaps on purpose: later growth
  // should feel slower and more effortful than early growth, matching
  // how a real tree's visible change slows as it matures.
  // -----------------------------------------------------------------

  const TREE_STAGES = [
    {
      id: 'seed', key: 'seed', family: 'seed', name: 'Seed',
      minGrowthPoints: 0,
      description: 'Resting, waiting.',
      trunkHeightRatio: 0, trunkThicknessBase: 0,
      canopyPresent: false, canopyRadiusRatio: 0,
      leafDensityBase: 0, branchCountBase: 0,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'seed-swelling', key: 'seed_swelling', family: 'seed', name: 'Swelling Seed',
      minGrowthPoints: 30,
      description: 'Something has quietly begun.',
      trunkHeightRatio: 0.02, trunkThicknessBase: 0.05,
      canopyPresent: false, canopyRadiusRatio: 0,
      leafDensityBase: 0, branchCountBase: 0,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'root-thread', key: 'root_thread', family: 'seed', name: 'First Root',
      minGrowthPoints: 70,
      description: 'A thin root has found the soil.',
      trunkHeightRatio: 0.03, trunkThicknessBase: 0.06,
      canopyPresent: false, canopyRadiusRatio: 0,
      leafDensityBase: 0, branchCountBase: 0,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'tiny-sprout', key: 'tiny_sprout', family: 'sprout', name: 'Tiny Sprout',
      minGrowthPoints: 120,
      description: 'A pale shoot breaks the surface.',
      trunkHeightRatio: 0.06, trunkThicknessBase: 0.08,
      canopyPresent: false, canopyRadiusRatio: 0,
      leafDensityBase: 0, branchCountBase: 0,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'first-leaf-pair', key: 'first_leaf_pair', family: 'sprout', name: 'First Leaves',
      minGrowthPoints: 190,
      description: 'Two small leaves have unfolded.',
      trunkHeightRatio: 0.09, trunkThicknessBase: 0.10,
      canopyPresent: true, canopyRadiusRatio: 0.06,
      leafDensityBase: 0.15, branchCountBase: 0,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'unfurling-sprout', key: 'unfurling_sprout', family: 'sprout', name: 'Unfurling Sprout',
      minGrowthPoints: 280,
      description: 'Slowly opening toward the light.',
      trunkHeightRatio: 0.13, trunkThicknessBase: 0.12,
      canopyPresent: true, canopyRadiusRatio: 0.09,
      leafDensityBase: 0.22, branchCountBase: 1,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'seedling', key: 'seedling', family: 'sprout', name: 'Seedling',
      minGrowthPoints: 390,
      description: 'Standing on its own now.',
      trunkHeightRatio: 0.17, trunkThicknessBase: 0.15,
      canopyPresent: true, canopyRadiusRatio: 0.12,
      leafDensityBase: 0.30, branchCountBase: 2,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'seedling-fuller', key: 'seedling_fuller', family: 'sprout', name: 'Filling-Out Seedling',
      minGrowthPoints: 520,
      description: 'A little steadier, a little fuller.',
      trunkHeightRatio: 0.21, trunkThicknessBase: 0.18,
      canopyPresent: true, canopyRadiusRatio: 0.15,
      leafDensityBase: 0.38, branchCountBase: 2,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'young-shoot', key: 'young_shoot', family: 'sapling', name: 'Young Shoot',
      minGrowthPoints: 680,
      description: 'The stem has begun to stiffen.',
      trunkHeightRatio: 0.26, trunkThicknessBase: 0.22,
      canopyPresent: true, canopyRadiusRatio: 0.19,
      leafDensityBase: 0.45, branchCountBase: 3,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'early-sapling', key: 'early_sapling', family: 'sapling', name: 'Early Sapling',
      minGrowthPoints: 860,
      description: 'A true sapling now, still slight.',
      trunkHeightRatio: 0.32, trunkThicknessBase: 0.27,
      canopyPresent: true, canopyRadiusRatio: 0.23,
      leafDensityBase: 0.52, branchCountBase: 4,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'branching-sapling', key: 'branching_sapling', family: 'sapling', name: 'Branching Sapling',
      minGrowthPoints: 1080,
      description: 'New branches are finding their own directions.',
      trunkHeightRatio: 0.38, trunkThicknessBase: 0.32,
      canopyPresent: true, canopyRadiusRatio: 0.27,
      leafDensityBase: 0.58, branchCountBase: 5,
      blossomEligible: false, rootFlarePresent: false
    },
    {
      id: 'thickening-sapling', key: 'thickening_sapling', family: 'sapling', name: 'Thickening Sapling',
      minGrowthPoints: 1340,
      description: 'The trunk no longer bends in a light wind.',
      trunkHeightRatio: 0.45, trunkThicknessBase: 0.38,
      canopyPresent: true, canopyRadiusRatio: 0.32,
      leafDensityBase: 0.64, branchCountBase: 6,
      blossomEligible: false, rootFlarePresent: true
    },
    {
      id: 'canopy-forming', key: 'canopy_forming', family: 'tree', name: 'Canopy Forming',
      minGrowthPoints: 1640,
      description: 'The first hint of a real canopy.',
      trunkHeightRatio: 0.53, trunkThicknessBase: 0.44,
      canopyPresent: true, canopyRadiusRatio: 0.38,
      leafDensityBase: 0.70, branchCountBase: 7,
      blossomEligible: false, rootFlarePresent: true
    },
    {
      id: 'young-tree', key: 'young_tree', family: 'tree', name: 'Young Tree',
      minGrowthPoints: 1990,
      description: 'Recognizably a tree, still growing into itself.',
      trunkHeightRatio: 0.61, trunkThicknessBase: 0.50,
      canopyPresent: true, canopyRadiusRatio: 0.44,
      leafDensityBase: 0.75, branchCountBase: 8,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'developing-tree', key: 'developing_tree', family: 'tree', name: 'Developing Tree',
      minGrowthPoints: 2390,
      description: 'Filling out, season by season.',
      trunkHeightRatio: 0.68, trunkThicknessBase: 0.57,
      canopyPresent: true, canopyRadiusRatio: 0.50,
      leafDensityBase: 0.80, branchCountBase: 9,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'developing-tree-fuller', key: 'developing_tree_fuller', family: 'tree', name: 'Fuller Canopy',
      minGrowthPoints: 2840,
      description: 'The canopy has begun to close overhead.',
      trunkHeightRatio: 0.75, trunkThicknessBase: 0.64,
      canopyPresent: true, canopyRadiusRatio: 0.56,
      leafDensityBase: 0.85, branchCountBase: 10,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'maturing-tree', key: 'maturing_tree', family: 'tree', name: 'Maturing Tree',
      minGrowthPoints: 3340,
      description: 'Settling into its lasting shape.',
      trunkHeightRatio: 0.82, trunkThicknessBase: 0.71,
      canopyPresent: true, canopyRadiusRatio: 0.62,
      leafDensityBase: 0.89, branchCountBase: 11,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'mature-tree', key: 'mature_tree', family: 'tree', name: 'Mature Tree',
      minGrowthPoints: 3900,
      description: 'Full, steady, unhurried.',
      trunkHeightRatio: 0.90, trunkThicknessBase: 0.79,
      canopyPresent: true, canopyRadiusRatio: 0.68,
      leafDensityBase: 0.93, branchCountBase: 12,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'flowering-tree', key: 'flowering_tree', family: 'tree', name: 'Flowering Tree',
      minGrowthPoints: 4520,
      description: 'Blossoms have appeared among the leaves.',
      trunkHeightRatio: 0.94, trunkThicknessBase: 0.84,
      canopyPresent: true, canopyRadiusRatio: 0.73,
      leafDensityBase: 0.96, branchCountBase: 13,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'established-tree', key: 'established_tree', family: 'elder', name: 'Established Tree',
      minGrowthPoints: 5200,
      description: 'It has been here a long while now.',
      trunkHeightRatio: 0.97, trunkThicknessBase: 0.90,
      canopyPresent: true, canopyRadiusRatio: 0.79,
      leafDensityBase: 0.98, branchCountBase: 14,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'ancient-beginning', key: 'ancient_beginning', family: 'elder', name: 'Elder Tree',
      minGrowthPoints: 5960,
      description: 'Its shape has become entirely its own.',
      trunkHeightRatio: 1.0, trunkThicknessBase: 0.96,
      canopyPresent: true, canopyRadiusRatio: 0.86,
      leafDensityBase: 1.0, branchCountBase: 15,
      blossomEligible: true, rootFlarePresent: true
    },
    {
      id: 'ancient-elaborate', key: 'ancient_elaborate', family: 'elder', name: 'Ancient Tree',
      minGrowthPoints: 6800,
      description: 'Every branch tells part of a long, slow story.',
      trunkHeightRatio: 1.0, trunkThicknessBase: 1.0,
      canopyPresent: true, canopyRadiusRatio: 1.0,
      leafDensityBase: 1.0, branchCountBase: 17,
      blossomEligible: true, rootFlarePresent: true
    }
  ];

  // -----------------------------------------------------------------
  // Visual "families" tree params select from (see
  // myworld-data.js `deriveTreeParams` for how the indices are chosen —
  // once chosen at creation, an index is permanent for that tree).
  // -----------------------------------------------------------------

  // canopyShapeVariant (0..3)
  const CANOPY_SHAPE_FAMILIES = [
    { id: 'rounded', name: 'Rounded', blobCountBase: 5, blobSpread: 0.55, verticalBias: 0.0 },
    { id: 'oval', name: 'Oval', blobCountBase: 6, blobSpread: 0.62, verticalBias: 0.12 },
    { id: 'irregular', name: 'Irregular', blobCountBase: 7, blobSpread: 0.72, verticalBias: -0.05 },
    { id: 'weeping', name: 'Weeping', blobCountBase: 6, blobSpread: 0.5, verticalBias: 0.28 }
  ];

  // leafColorVariant (0..4) — each a small palette of leaf shades plus
  // one soft highlight, kept in a dreamy/muted register to match
  // Lavender's overall aesthetic rather than saturated "game green".
  const LEAF_COLOR_PALETTES = [
    { id: 'spring-green', name: 'Spring Green', shades: ['#9fc48a', '#7fae6c', '#6a9a58'], highlight: '#c7e3b8' },
    { id: 'sage', name: 'Sage', shades: ['#a8b99b', '#8fa382', '#78906a'], highlight: '#cdd9c1' },
    { id: 'deep-emerald', name: 'Deep Emerald', shades: ['#5f8f74', '#4c7a61', '#3c6650'], highlight: '#93bda3' },
    { id: 'warm-olive', name: 'Warm Olive', shades: ['#a8a072', '#928a5c', '#7c754a'], highlight: '#cdc79f' },
    { id: 'soft-teal', name: 'Soft Teal', shades: ['#84b0ac', '#6a9793', '#557b78'], highlight: '#b7d9d6' }
  ];

  // blossomVariant (0..2) — used once a stage's blossomEligible is true.
  const BLOSSOM_PALETTES = [
    { id: 'blush-pink', name: 'Blush', color: '#f0c7d6', highlight: '#fbe6ee' },
    { id: 'cream-white', name: 'Cream', color: '#f6efdd', highlight: '#fffaf0' },
    { id: 'lavender-mauve', name: 'Lavender Mauve', color: '#d9c7e8', highlight: '#efe4f6' }
  ];

  // rootFlareVariant (0..2) — silhouette variants only, used once
  // rootFlarePresent is true for the current stage.
  const ROOT_FLARE_VARIANTS = [
    { id: 'soft', name: 'Soft', flareWidth: 0.9, flareCount: 2 },
    { id: 'wide', name: 'Wide', flareWidth: 1.15, flareCount: 3 },
    { id: 'gnarled', name: 'Gnarled', flareWidth: 1.0, flareCount: 4 }
  ];

  // -----------------------------------------------------------------
  // Future environment systems — structural placeholders only.
  // Not rendered yet by myworld.js; these exist so the schema and
  // integration points are settled ahead of time. Deliberately small.
  // -----------------------------------------------------------------

  // A "flower type" a future planting system could place in the world.
  const FLOWER_TYPES = [
    { id: 'daisy', name: 'Daisy', colorPalette: ['#ffffff', '#f4e04d'], unlockStageFamily: 'sapling' },
    { id: 'lavender-sprig', name: 'Lavender Sprig', colorPalette: ['#b9a3d6', '#8c72ad'], unlockStageFamily: 'tree' },
    { id: 'poppy', name: 'Poppy', colorPalette: ['#e2543f'], unlockStageFamily: 'tree' }
  ];

  const GRASS_VARIANTS = [
    { id: 'meadow-tuft', name: 'Meadow Tuft', density: 'sparse' },
    { id: 'wild-blade', name: 'Wild Blade', density: 'medium' }
  ];

  const BUSH_TYPES = [
    { id: 'round-shrub', name: 'Round Shrub', colorPalette: ['#7fae6c', '#6a9a58'] },
    { id: 'berry-bush', name: 'Berry Bush', colorPalette: ['#6a9a58', '#a5457a'] }
  ];

  const ROCK_TYPES = [
    { id: 'smooth-stone', name: 'Smooth Stone', colorPalette: ['#b9b3ad', '#9a948e'] },
    { id: 'mossy-stone', name: 'Mossy Stone', colorPalette: ['#9a9488', '#7fae6c'] }
  ];

  // Simple on/off + density-style config placeholders (not schedules).
  const FIREFLY_CONFIG = { maxCount: 12, colorPalette: ['#f4e9a0'] };
  const BIRD_TYPES = [
    { id: 'small-songbird', name: 'Small Songbird', colorPalette: ['#7a6a58', '#e0d6c3'] }
  ];
  const STAR_FIELD_CONFIG = { maxCount: 60, colorPalette: ['#ffffff', '#e7e2f7'] };

  const WEATHER_TYPES = [
    { id: 'clear', name: 'Clear' },
    { id: 'soft-rain', name: 'Soft Rain' },
    { id: 'light-fog', name: 'Light Fog' },
    { id: 'gentle-breeze', name: 'Gentle Breeze' }
  ];

  const SEASON_PALETTES = [
    { id: 'spring', name: 'Spring', skyTint: '#e9e6f5', groundTint: '#bcd7a4' },
    { id: 'summer', name: 'Summer', skyTint: '#e3ecf6', groundTint: '#9fc48a' },
    { id: 'autumn', name: 'Autumn', skyTint: '#f3e3d3', groundTint: '#c9a45f' },
    { id: 'winter', name: 'Winter', skyTint: '#eef1f6', groundTint: '#dfe6ea' }
  ];

  // -----------------------------------------------------------------
  // Pure lookup helpers (stage math). These are the single source of
  // truth for "which stage is this many growth points" — myworld.js
  // should always go through these rather than re-deriving thresholds.
  // -----------------------------------------------------------------

  function getStageByIndex(index, stages) {
    const S = stages || TREE_STAGES;
    if (typeof index !== 'number' || index < 0) return S[0];
    if (index >= S.length) return S[S.length - 1];
    return S[index];
  }

  function getStageIndexForGrowthPoints(growthPoints, stages) {
    const S = stages || TREE_STAGES;
    const gp = (typeof growthPoints === 'number' && isFinite(growthPoints) && growthPoints > 0) ? growthPoints : 0;
    let idx = 0;
    for (let i = 0; i < S.length; i++) {
      if (gp >= S[i].minGrowthPoints) idx = i;
      else break;
    }
    return idx;
  }

  function getStageForGrowthPoints(growthPoints, stages) {
    return getStageByIndex(getStageIndexForGrowthPoints(growthPoints, stages), stages);
  }

  /** 0..1 progress from the current stage's threshold toward the next stage's. */
  function getStageProgress(growthPoints, stages) {
    const S = stages || TREE_STAGES;
    const idx = getStageIndexForGrowthPoints(growthPoints, S);
    const current = S[idx];
    const next = S[idx + 1];
    if (!next) return 1; // final stage reached — fully "in" it
    const span = next.minGrowthPoints - current.minGrowthPoints;
    if (span <= 0) return 0;
    const into = (growthPoints || 0) - current.minGrowthPoints;
    return Math.max(0, Math.min(1, into / span));
  }

  function isFinalStage(index, stages) {
    return index >= (stages || TREE_STAGES).length - 1;
  }

  function getCanopyShapeFamily(variantIndex) {
    return CANOPY_SHAPE_FAMILIES[variantIndex % CANOPY_SHAPE_FAMILIES.length] || CANOPY_SHAPE_FAMILIES[0];
  }

  function getLeafPalette(variantIndex) {
    return LEAF_COLOR_PALETTES[variantIndex % LEAF_COLOR_PALETTES.length] || LEAF_COLOR_PALETTES[0];
  }

  function getBlossomPalette(variantIndex) {
    return BLOSSOM_PALETTES[variantIndex % BLOSSOM_PALETTES.length] || BLOSSOM_PALETTES[0];
  }

  function getRootFlareVariant(variantIndex) {
    return ROOT_FLARE_VARIANTS[variantIndex % ROOT_FLARE_VARIANTS.length] || ROOT_FLARE_VARIANTS[0];
  }

  return {
    TREE_STAGES,
    CANOPY_SHAPE_FAMILIES,
    LEAF_COLOR_PALETTES,
    BLOSSOM_PALETTES,
    ROOT_FLARE_VARIANTS,

    // future-system placeholders (structure only)
    FLOWER_TYPES,
    GRASS_VARIANTS,
    BUSH_TYPES,
    ROCK_TYPES,
    FIREFLY_CONFIG,
    BIRD_TYPES,
    STAR_FIELD_CONFIG,
    WEATHER_TYPES,
    SEASON_PALETTES,

    // lookups
    getStageByIndex,
    getStageIndexForGrowthPoints,
    getStageForGrowthPoints,
    getStageProgress,
    isFinalStage,
    getCanopyShapeFamily,
    getLeafPalette,
    getBlossomPalette,
    getRootFlareVariant
  };
})();
