// study-environment.js — Phase 7: cozy nighttime world layered behind the Study screen.
// Purely presentational + derived. Depends on: TimeEngine (canonical study time via
// getAllTrackedDates/getDayStats). Must load AFTER timeengine.js and study.js (see index.html
// script order) so #study-layout already exists when init() runs.
//
// Design constraints honored (per Phase 7 spec):
//   - No second study-time source: lifetime hours are summed from TimeEngine's own
//     getAllTrackedDates()/getDayStats(), the same ledger Progress/streaks already read.
//   - No new persisted key: the "checkpoint rollback on broken streak" is fully derived each
//     render from (lifetime hours -> target stage) and (days since the last day with any
//     recorded study time) — never written to State, so there's nothing to desync or restore.
//   - Fireflies are ambient (fixed, restrained population), NOT tied to hours/rewards.
//   - Injects its own <style> once; does not touch style.css/study.js/index.html markup.
//     (Wiring the <script> tag + StudyEnvironment.init()/.render() calls into index.html/
//     study.js is a separate one-line patch, intentionally not done in this turn.)

const StudyEnvironment = (function () {
  const STYLE_ID = 'study-environment-styles';
  const SCENE_ID = 'study-environment-scene';
  const FIREFLY_COUNT = 9;          // restrained on purpose — never scales with hours
  const REFRESH_TICKS = 30;         // recompute lifetime hours/stage every ~30s of heartbeat, not every 1s
  const STREAK_BREAK_DAYS = 3;      // >3 days since last study day = visual rollback

  let tickCount = 0;
  let lastRenderedStage = null;

  // ---------- seeded PRNG (mulberry32) — stable, non-grid layout without re-shuffling on every render ----------
  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- date helpers (local, mirrors study.js/timeengine.js todayStr pattern) ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function daysBetween(fromDateStr, toDateStr) {
    const a = new Date(fromDateStr + 'T00:00:00').getTime();
    const b = new Date(toDateStr + 'T00:00:00').getTime();
    return Math.round((b - a) / 86400000);
  }

  // ---------- canonical study data (read-only; TimeEngine remains the single source of truth) ----------
  function lifetimeStudyMs() {
    if (typeof TimeEngine === 'undefined') return 0;
    let total = 0;
    TimeEngine.getAllTrackedDates().forEach(function (d) {
      const stats = TimeEngine.getDayStats(d);
      if (stats) total += stats.studyMs || 0;
    });
    return total;
  }
  function lifetimeStudyHours() { return lifetimeStudyMs() / 3600000; }

  function daysSinceLastStudyDay() {
    if (typeof TimeEngine === 'undefined') return Infinity;
    const studiedDates = TimeEngine.getAllTrackedDates().filter(function (d) {
      const stats = TimeEngine.getDayStats(d);
      return stats && stats.studyMs > 0;
    });
    if (!studiedDates.length) return Infinity;
    studiedDates.sort();
    return Math.max(0, daysBetween(studiedDates[studiedDates.length - 1], todayStr()));
  }

  // ---------- reward checkpoints ----------
  // Each stage only adds/matures elements relative to the last — never a full re-theme —
  // per "evolve rather than endlessly accumulate objects".
  const STAGES = [
    { minHours: 0,  sprouts: 0, flowers: 0, bushes: 0, tree: 0 },
    { minHours: 1,  sprouts: 4, flowers: 0, bushes: 0, tree: 0 },
    { minHours: 3,  sprouts: 6, flowers: 3, bushes: 0, tree: 0 },
    { minHours: 6,  sprouts: 6, flowers: 6, bushes: 0, tree: 0 },
    { minHours: 10, sprouts: 6, flowers: 8, bushes: 2, tree: 0 },
    { minHours: 18, sprouts: 6, flowers: 8, bushes: 4, tree: 1 },
    { minHours: 30, sprouts: 6, flowers: 9, bushes: 5, tree: 2 },
    { minHours: 50, sprouts: 6, flowers: 10, bushes: 6, tree: 3 }
  ];

  function stageIndexForHours(hours) {
    let idx = 0;
    for (let i = 0; i < STAGES.length; i++) {
      if (hours >= STAGES[i].minHours) idx = i; else break;
    }
    return idx;
  }

  // Visual-only rollback: one checkpoint back when the streak's been broken >3 days. Lifetime
  // hours (and every canonical stat) are never touched — recomputing this always yields the
  // true stage again the moment daysSinceLastStudyDay() drops back to <=3.
  function currentStageIndex() {
    const target = stageIndexForHours(lifetimeStudyHours());
    if (target > 0 && daysSinceLastStudyDay() > STREAK_BREAK_DAYS) return target - 1;
    return target;
  }

  // ---------- styles (self-contained; reconciled into style.css in the dedicated styling phase) ----------
  const CSS_TEXT =
    '#study-layout.study-env-host{position:relative;overflow:hidden;border-radius:14px;min-height:480px;}' +
    '#study-layout.study-env-host > *:not(#' + SCENE_ID + '){position:relative;z-index:1;}' +
    '#' + SCENE_ID + '{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;border-radius:inherit;}' +
    '.study-env-sky{position:absolute;inset:0;background:radial-gradient(ellipse at 70% 15%,#2a2f52 0%,#1b1f3a 40%,#11142b 75%,#0b0d1f 100%);}' +
    '.study-env-moon{position:absolute;top:8%;right:12%;width:54px;height:54px;border-radius:50%;' +
      'background:radial-gradient(circle at 35% 35%,#fdfaf0,#eae6d8 55%,rgba(234,230,216,0) 72%);' +
      'box-shadow:0 0 40px 14px rgba(240,238,220,0.18),0 0 90px 30px rgba(200,210,255,0.08);}' +
    '.study-env-fireflies{position:absolute;inset:0;}' +
    '.study-env-firefly{position:absolute;left:var(--fx-left);top:var(--fx-top);width:var(--fx-size);height:var(--fx-size);' +
      'border-radius:50%;background:radial-gradient(circle,rgba(255,224,140,var(--fx-op)) 0%,rgba(255,200,90,0.35) 45%,rgba(255,200,90,0) 75%);' +
      'box-shadow:0 0 6px 3px rgba(255,200,110,0.22);' +
      'animation:study-env-drift var(--fx-dur) ease-in-out var(--fx-delay) infinite alternate,' +
      'study-env-flicker calc(var(--fx-dur) * 0.6) ease-in-out var(--fx-delay) infinite alternate;}' +
    '@keyframes study-env-drift{0%{transform:translate(0,0);}100%{transform:translate(var(--fx-dx),calc(var(--fx-dy) * -1));}}' +
    '@keyframes study-env-flicker{0%{opacity:calc(var(--fx-op) * 0.5);}100%{opacity:var(--fx-op);}}' +
    '.study-env-garden{position:absolute;left:0;right:0;bottom:0;height:38%;}' +
    '.study-env-garden-svg{width:100%;height:100%;display:block;}' +
    '.study-env-ground{fill:#141a2e;}' +
    '.study-env-sprout{stroke:#5f8f5a;stroke-width:0.6;fill:none;stroke-linecap:round;opacity:0.85;}' +
    '.study-env-flower-stem{stroke:#4d7a4f;stroke-width:0.5;}' +
    '.study-env-flower-petal{opacity:0.9;}' +
    '.study-env-flower-center{fill:#fff3c4;}' +
    '.study-env-bush{fill:#2e4a34;opacity:0.9;}' +
    '.study-env-tree-trunk{fill:#3a2c22;}' +
    '.study-env-tree-canopy{fill:#33502f;opacity:0.92;}' +
    '.study-env-hours{position:absolute;right:10px;bottom:6px;font-size:11px;letter-spacing:0.5px;' +
      'color:rgba(255,255,255,0.28);font-variant-numeric:tabular-nums;user-select:none;}' +
    '@media (prefers-reduced-motion: reduce){.study-env-firefly{animation:none;opacity:var(--fx-op);}}';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
  }

  // ---------- DOM scaffolding ----------
  function ensureScene() {
    const layout = document.getElementById('study-layout');
    if (!layout) return null;
    let scene = document.getElementById(SCENE_ID);
    if (scene) return scene;
    layout.classList.add('study-env-host');
    scene = document.createElement('div');
    scene.id = SCENE_ID;
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<div class="study-env-sky"></div>' +
      '<div class="study-env-moon"></div>' +
      '<div class="study-env-fireflies"></div>' +
      '<div class="study-env-garden"></div>' +
      '<div class="study-env-hours"></div>';
    layout.insertBefore(scene, layout.firstChild);
    return scene;
  }

  function buildFireflies(container) {
    if (!container || container.dataset.built === '1') return;
    container.dataset.built = '1';
    const rand = mulberry32(1337); // fixed seed: stable atmosphere across reloads, not a reshuffle each render
    let html = '';
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const left = (8 + rand() * 84).toFixed(1);
      const top = (20 + rand() * 60).toFixed(1);
      const size = (2.5 + rand() * 2.5).toFixed(1);
      const dur = (6 + rand() * 8).toFixed(1);
      const delay = (rand() * 8).toFixed(1);
      const dx = (10 + rand() * 24).toFixed(0);
      const dy = (8 + rand() * 18).toFixed(0);
      const op = (0.55 + rand() * 0.35).toFixed(2);
      html += '<span class="study-env-firefly" style="--fx-left:' + left + '%;--fx-top:' + top + '%;' +
        '--fx-size:' + size + 'px;--fx-dur:' + dur + 's;--fx-delay:' + delay + 's;' +
        '--fx-dx:' + dx + 'px;--fx-dy:' + dy + 'px;--fx-op:' + op + ';"></span>';
    }
    container.innerHTML = html;
  }

  // ---------- garden SVG pieces (simple, restrained shapes — natural asymmetry via seeded jitter) ----------
  function sproutSVG(x, groundY, rand) {
    const h = 3 + rand() * 3;
    const lean = (rand() - 0.5) * 2;
    return '<path class="study-env-sprout" d="M' + x.toFixed(1) + ',' + groundY +
      ' q' + lean.toFixed(1) + ',-' + h.toFixed(1) + ' 0,-' + (h + 0.8).toFixed(1) + '"/>';
  }

  function flowerSVG(x, groundY, rand) {
    const s = 0.7 + rand() * 0.6;
    const stemH = 4 * s;
    const cy = groundY - stemH;
    const hue = (300 + rand() * 40).toFixed(0);
    const petalR = (1.1 * s).toFixed(2);
    let petals = '';
    for (let p = 0; p < 5; p++) {
      const ang = (p / 5) * Math.PI * 2;
      const px = (x + Math.cos(ang) * 1.4 * s).toFixed(1);
      const py = (cy + Math.sin(ang) * 1.4 * s).toFixed(1);
      petals += '<circle class="study-env-flower-petal" cx="' + px + '" cy="' + py + '" r="' + petalR +
        '" fill="hsl(' + hue + ',55%,72%)"/>';
    }
    return '<path class="study-env-flower-stem" d="M' + x.toFixed(1) + ',' + groundY + ' L' + x.toFixed(1) + ',' + cy.toFixed(1) + '"/>' +
      petals +
      '<circle class="study-env-flower-center" cx="' + x.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (0.6 * s).toFixed(2) + '"/>';
  }

  function bushSVG(x, groundY, rand) {
    const s = 0.8 + rand() * 0.5;
    const cy = groundY - 1.6 * s;
    return '<ellipse class="study-env-bush" cx="' + (x - 1.4 * s).toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (1.8 * s).toFixed(1) + '" ry="' + (1.5 * s).toFixed(1) + '"/>' +
      '<ellipse class="study-env-bush" cx="' + (x + 1.3 * s).toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (1.7 * s).toFixed(1) + '" ry="' + (1.4 * s).toFixed(1) + '"/>' +
      '<ellipse class="study-env-bush" cx="' + x.toFixed(1) + '" cy="' + (cy - 0.9 * s).toFixed(1) + '" rx="' + (1.9 * s).toFixed(1) + '" ry="' + (1.6 * s).toFixed(1) + '"/>';
  }

  function treeSVG(x, groundY, level) {
    const trunkH = 6 + level * 2.5;
    const trunkTop = groundY - trunkH;
    const canopyR = 4 + level * 1.8;
    let canopy = '<ellipse class="study-env-tree-canopy" cx="' + x.toFixed(1) + '" cy="' + trunkTop.toFixed(1) + '" rx="' + canopyR.toFixed(1) + '" ry="' + (canopyR * 0.78).toFixed(1) + '"/>';
    if (level >= 2) {
      canopy += '<ellipse class="study-env-tree-canopy" cx="' + (x - canopyR * 0.55).toFixed(1) + '" cy="' + (trunkTop + canopyR * 0.35).toFixed(1) + '" rx="' + (canopyR * 0.65).toFixed(1) + '" ry="' + (canopyR * 0.5).toFixed(1) + '"/>' +
        '<ellipse class="study-env-tree-canopy" cx="' + (x + canopyR * 0.55).toFixed(1) + '" cy="' + (trunkTop + canopyR * 0.35).toFixed(1) + '" rx="' + (canopyR * 0.65).toFixed(1) + '" ry="' + (canopyR * 0.5).toFixed(1) + '"/>';
    }
    if (level >= 3) {
      canopy += '<ellipse class="study-env-tree-canopy" cx="' + x.toFixed(1) + '" cy="' + (trunkTop - canopyR * 0.45).toFixed(1) + '" rx="' + (canopyR * 0.6).toFixed(1) + '" ry="' + (canopyR * 0.45).toFixed(1) + '"/>';
    }
    return '<rect class="study-env-tree-trunk" x="' + (x - 0.6).toFixed(1) + '" y="' + trunkTop.toFixed(1) + '" width="1.2" height="' + trunkH.toFixed(1) + '"/>' +
      canopy;
  }

  function buildGarden(container, stageIdx) {
    if (!container) return;
    const meta = STAGES[stageIdx];
    const rand = mulberry32(4242 + stageIdx); // stable per-stage layout; still varies stage to stage
    const groundY = 92;
    const parts = ['<path class="study-env-ground" d="M0,100 L0,' + groundY + ' Q50,' + (groundY - 2) + ' 100,' + groundY + ' L100,100 Z"/>'];

    for (let i = 0; i < meta.sprouts; i++) parts.push(sproutSVG(4 + rand() * 92, groundY, rand));
    for (let i = 0; i < meta.flowers; i++) parts.push(flowerSVG(4 + rand() * 92, groundY, rand));
    for (let i = 0; i < meta.bushes; i++) parts.push(bushSVG(6 + rand() * 88, groundY, rand));
    if (meta.tree > 0) parts.push(treeSVG(50 + (rand() - 0.5) * 14, groundY, meta.tree));

    container.innerHTML = '<svg class="study-env-garden-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + parts.join('') + '</svg>';
  }

  function renderHoursLabel(el, hours) {
    if (!el) return;
    el.textContent = hours.toFixed(1) + 'h';
  }

  // ---------- render orchestration ----------
  function renderScene(force) {
    if (typeof document === 'undefined') return;
    ensureStyles();
    const scene = ensureScene();
    if (!scene) return; // Study screen not in the DOM yet — safe no-op, retried on next tick/render()
    buildFireflies(scene.querySelector('.study-env-fireflies'));
    const hours = lifetimeStudyHours();
    const stageIdx = currentStageIndex();
    if (force || stageIdx !== lastRenderedStage) {
      buildGarden(scene.querySelector('.study-env-garden'), stageIdx);
      lastRenderedStage = stageIdx;
    }
    renderHoursLabel(scene.querySelector('.study-env-hours'), hours);
  }

  function onTick() {
    tickCount++;
    if (tickCount % REFRESH_TICKS !== 0) return;
    renderScene(false);
  }

  // init(): first build. Call once, after Study.init(), from index.html's init script (that
  // wiring is a separate one-line patch — see file header). Idempotent subscribe id means a
  // re-init never double-subscribes.
  function init() {
    renderScene(true);
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) {
      TimeEngine.subscribe(onTick, 'study-environment');
    }
  }

  // render(): mirrors Study.render()'s re-entry pattern (e.g. Nav switching back to Study).
  function render() { renderScene(true); }

  return { init: init, render: render };
})();
