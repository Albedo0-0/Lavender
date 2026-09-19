/**
 * myworld.js — My World pixel world (Phase 0 skeleton + Phase 1 fullscreen shell).
 * Depends on MyWorldData (persistence) and MyWorldAssets (stage thresholds).
 */

const MyWorld = (function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Growth policy (carried over unchanged from the previous myworld.js)
  // ---------------------------------------------------------------------
  const GROWTH_POINTS_PER_STUDY_MINUTE = 0.15;

  // ---------------------------------------------------------------------
  // Shell constants
  // ---------------------------------------------------------------------
  const BASE_HEIGHT = 180;
  const MAX_DT = 0.1;
  const HOST_CLASS = 'myworld-fullscreen-host';
  const CANVAS_CLASS = 'myworld-canvas';
  const EXIT_CLASS = 'myworld-exit-btn';
  const PLACEHOLDER_BG = '#232a52';
  const HORIZON_RATIO = 0.66;

  // Sky palette keyframes by local hour (top / mid / horizon). Last key wraps to first.
  const SKY_KEYS = [
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
  ];

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
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

  function isDebug() {
    return typeof location !== 'undefined' && /[?&]mwdebug=1/.test(location.search);
  }

  // ---------------------------------------------------------------------
  // Growth (pure logic, unchanged behavior)
  // ---------------------------------------------------------------------
  function computeGrowthState(world) {
    if (!hasAssets() || !world || !world.tree) {
      return { stageIndex: 0, stageProgress: 0 };
    }
    const growthPoints = world.tree.growthPoints || 0;
    const stageIndex = MyWorldAssets.getStageIndexForGrowthPoints(growthPoints);
    const stageProgress = MyWorldAssets.getStageProgress(growthPoints);
    return { stageIndex, stageProgress };
  }

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

  // ---------------------------------------------------------------------
  // Fullscreen shell: host + canvas + rAF loop
  // ---------------------------------------------------------------------
  let mountedContainer = null;
  let host = null;
  let canvas = null;
  let ctx = null;
  let onExitCb = null;
  let nativeFs = false;
  let rafId = 0;
  let lastTs = 0;
  let frame = 0;
  let scale = 4;
  let W = 0;
  let H = 0;

  // ---------------------------------------------------------------------
  // Sky: banded pixel gradient, sun, moon, stars, horizon glow (Phase 2)
  // ---------------------------------------------------------------------
  let clockElapsed = 0;
  let debugHour = null;
  let debugSpeed = 0;
  let horizonY = 0;
  let skyCanvas = null;
  let skyKey = '';
  let stars = null;
  let skyKeysRgb = null;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixRgb(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function quant(c) {
    return c.map(function (v) { return Math.min(255, Math.max(0, Math.round(v / 6) * 6)); });
  }

  function css(c) {
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  function smoothstep(a, b, x) {
    const t = clampNum((x - a) / (b - a), 0, 1, 0);
    return t * t * (3 - 2 * t);
  }

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getSkyKeys() {
    if (!skyKeysRgb) {
      skyKeysRgb = SKY_KEYS.map(function (k) {
        return { h: k.h, top: hexToRgb(k.top), mid: hexToRgb(k.mid), bot: hexToRgb(k.bot) };
      });
    }
    return skyKeysRgb;
  }

  function skyColorsAt(hour) {
    const keys = getSkyKeys();
    let i = 0;
    while (i < keys.length - 2 && hour >= keys[i + 1].h) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = clampNum((hour - a.h) / (b.h - a.h), 0, 1, 0);
    const s = t * t * (3 - 2 * t);
    return { top: mixRgb(a.top, b.top, s), mid: mixRgb(a.mid, b.mid, s), bot: mixRgb(a.bot, b.bot, s) };
  }

  function getWorldHour() {
    if (debugHour !== null) {
      return (((debugHour + clockElapsed * debugSpeed / 3600) % 24) + 24) % 24;
    }
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  function initSkyClock() {
    clockElapsed = 0;
    skyKey = '';
    if (typeof location === 'undefined') return;
    const mt = /[?&]mwtime=([0-9.]+)/.exec(location.search);
    const ms = /[?&]mwspeed=([0-9.]+)/.exec(location.search);
    if (mt) {
      debugHour = clampNum(parseFloat(mt[1]), 0, 24, 12) % 24;
      debugSpeed = ms ? clampNum(parseFloat(ms[1]), 0, 100000, 0) : 0;
    }
  }

  function setDebugTime(hour, speed) {
    debugHour = (typeof hour === 'number' && isFinite(hour)) ? (((hour % 24) + 24) % 24) : null;
    debugSpeed = clampNum(speed, 0, 100000, 0);
    clockElapsed = 0;
    skyKey = '';
  }

  function resetSky() {
    skyCanvas = null;
    skyKey = '';
    stars = null;
  }

  function onSkyResize() {
    horizonY = Math.floor(H * HORIZON_RATIO);
    resetSky();
  }

  function nightFactor(h) {
    if (h >= 20.5 || h < 4.5) return 1;
    if (h < 6.5) return 1 - smoothstep(4.5, 6.5, h);
    if (h < 18.5) return 0;
    return smoothstep(18.5, 20.5, h);
  }

  function buildStars() {
    const rand = makeRng(20240517);
    const count = Math.round(clampNum(W * horizonY / 260, 30, 160, 60));
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.floor(rand() * W),
        y: Math.floor(Math.pow(rand(), 1.4) * horizonY * 0.92),
        th: rand(),
        ph: rand() * 6.283,
        sp: 0.6 + rand() * 1.6,
        big: rand() < 0.12
      });
    }
  }

  function buildSky(hour) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;

    const cols = skyColorsAt(hour);
    const bandH = Math.max(3, Math.round(horizonY / 22));
    const bands = [];
    for (let y = 0; y < horizonY; y += bandH) {
      const t = clampNum((y + bandH / 2) / horizonY, 0, 1, 0);
      const e = Math.pow(t, 1.35);
      const col = e < 0.5 ? mixRgb(cols.top, cols.mid, e * 2) : mixRgb(cols.mid, cols.bot, (e - 0.5) * 2);
      bands.push({ y: y, h: Math.min(bandH, horizonY - y), c: quant(col) });
    }

    bands.forEach(function (b) {
      g.fillStyle = css(b.c);
      g.fillRect(0, b.y, W, b.h);
    });

    for (let i = 1; i < bands.length; i++) {
      const prev = bands[i - 1];
      const cur = bands[i];
      g.fillStyle = css(cur.c);
      for (let x = 0; x < W; x += 2) g.fillRect(x, cur.y - 1, 1, 1);
      g.fillStyle = css(prev.c);
      for (let x = 1; x < W; x += 2) g.fillRect(x, cur.y, 1, 1);
    }

    g.fillStyle = css(quant(mixRgb(cols.bot, [24, 32, 30], 0.7)));
    g.fillRect(0, horizonY, W, H - horizonY);
    return c;
  }

  function fillDisc(cx, cy, r, color) {
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.round(Math.sqrt(r * r + 0.5 - dy * dy));
      ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  function drawStars(hour) {
    const nf = nightFactor(hour);
    if (nf <= 0.02) return;
    if (!stars) buildStars();
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (s.th > nf) continue;
      const tw = Math.sin(clockElapsed * s.sp + s.ph);
      ctx.fillStyle = tw > 0.55 ? '#ffffff' : (tw < -0.6 ? '#8c8ab8' : '#f4f1ff');
      ctx.fillRect(s.x, s.y, 1, 1);
      if (s.big && tw > -0.3) {
        ctx.fillRect(s.x - 1, s.y, 3, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 3);
      }
    }
  }

  function drawSun(hour) {
    const p = (hour - 6) / 12;
    if (p < -0.08 || p > 1.08) return;
    const sinp = Math.sin(Math.PI * p);
    const alt = clampNum(sinp, 0, 1, 0);
    const r = Math.max(6, Math.round(H * 0.045));
    const cx = Math.round(W * (0.1 + 0.8 * p));
    const cy = Math.round(horizonY - sinp * horizonY * 0.78);
    const warm = 1 - smoothstep(0, 0.35, alt);
    const core = mixRgb([255, 246, 200], [255, 196, 120], warm);
    const ring = mixRgb([255, 224, 140], [255, 150, 90], warm);

    if (warm > 0.02) {
      const gh = Math.round(H * 0.16);
      ctx.fillStyle = css([255, 168, 96]);
      for (let d = 0; d < gh; d++) {
        const f = 1 - d / gh;
        const hw = Math.round(W * 0.42 * Math.pow(f, 0.6)) + r;
        ctx.globalAlpha = 0.16 * f * warm;
        ctx.fillRect(cx - hw, horizonY - 1 - d, hw * 2, 1);
      }
    }

    ctx.globalAlpha = 0.08; fillDisc(cx, cy, r + 9, css(core));
    ctx.globalAlpha = 0.14; fillDisc(cx, cy, r + 5, css(core));
    ctx.globalAlpha = 0.22; fillDisc(cx, cy, r + 2, css(core));
    ctx.globalAlpha = 1;
    fillDisc(cx, cy, r, css(ring));
    fillDisc(cx, cy, r - 2, css(core));
  }

  function drawMoon(hour) {
    const q = (((hour - 18) % 24) + 24) % 24;
    const p = q >= 23 ? (q - 24) / 12 : q / 12;
    if (p < -0.08 || p > 1.08) return;
    const sinp = Math.sin(Math.PI * p);
    const r = Math.max(5, Math.round(H * 0.035));
    const cx = Math.round(W * (0.1 + 0.8 * p));
    const cy = Math.round(horizonY - sinp * horizonY * 0.78);
    const nf = nightFactor(hour);
    const vis = 0.35 + 0.65 * nf;

    ctx.globalAlpha = 0.07 * vis; fillDisc(cx, cy, r + 8, css([200, 205, 255]));
    ctx.globalAlpha = 0.12 * vis; fillDisc(cx, cy, r + 4, css([200, 205, 255]));
    ctx.globalAlpha = 0.2 * vis;  fillDisc(cx, cy, r + 2, css([226, 220, 255]));
    ctx.globalAlpha = vis;
    fillDisc(cx, cy, r, css([217, 214, 232]));
    ctx.fillStyle = css([185, 182, 208]);
    ctx.fillRect(cx - Math.round(r * 0.4), cy - Math.round(r * 0.3), 2, 2);
    ctx.fillRect(cx + Math.round(r * 0.2), cy + Math.round(r * 0.1), 3, 2);
    ctx.fillRect(cx - Math.round(r * 0.1), cy + Math.round(r * 0.5), 2, 1);
    ctx.globalAlpha = 1;
  }

  function drawSky() {
    const hour = getWorldHour();
    const key = Math.floor(hour * 60) + '|' + W + 'x' + H;
    if (!skyCanvas || key !== skyKey) {
      skyCanvas = buildSky(hour);
      skyKey = key;
    }
    ctx.drawImage(skyCanvas, 0, 0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, horizonY);
    ctx.clip();
    drawStars(hour);
    drawSun(hour);
    drawMoon(hour);
    ctx.restore();
  }

  function fit() {
    if (!host || !canvas) return;
    const vw = host.clientWidth || window.innerWidth;
    const vh = host.clientHeight || window.innerHeight;
    scale = Math.max(2, Math.round(vh / BASE_HEIGHT));
    W = Math.max(1, Math.ceil(vw / scale));
    H = Math.max(1, Math.ceil(vh / scale));
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    ctx = canvas.getContext('2d');
    if (ctx) ctx.imageSmoothingEnabled = false;
    onSkyResize();
    drawFrame(0);
  }

  function drawFrame(dt) {
    if (!ctx) return;
    clockElapsed += dt;
    drawSky();

    if (isDebug()) {
      ctx.fillStyle = '#f4f1ff';
      ctx.font = '8px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText('f:' + frame + ' x' + scale + ' ' + W + 'x' + H + ' h:' + getWorldHour().toFixed(2), 2, 2);
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillRect(W - 1, 0, 1, 1);
      ctx.fillRect(0, H - 1, 1, 1);
      ctx.fillRect(W - 1, H - 1, 1, 1);
    }
  }

  function loop(ts) {
    rafId = 0;
    if (!host || document.hidden) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(MAX_DT, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    frame++;
    drawFrame(dt);
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId || !host || document.hidden) return;
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = 0;
  }

  function onResize() { fit(); }

  function onVisibility() {
    if (document.hidden) stopLoop(); else startLoop();
  }

  function onKey(e) {
    if (e.key === 'Escape') closeFullscreen();
  }

  function onFsChange() {
    const el = document.fullscreenElement || document.webkitFullscreenElement || null;
    if (el && el === host) { nativeFs = true; fit(); return; }
    if (!el && nativeFs) {
      nativeFs = false;
      closeFullscreen();
    }
  }

  function requestNative(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(el);
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* fallback overlay already covers the screen */ }
  }

  function exitNative() {
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    if (!el) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(document);
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function isFullscreen() {
    return !!host;
  }

  function openFullscreen(onExit) {
    if (!hasData() || !hasAssets()) warnMissingDeps('openFullscreen');

    if (host) return getState();

    onExitCb = (typeof onExit === 'function') ? onExit : null;

    host = document.createElement('div');
    host.className = HOST_CLASS;
    host.setAttribute('data-myworld-fullscreen', 'true');

    canvas = document.createElement('canvas');
    canvas.className = CANVAS_CLASS;
    host.appendChild(canvas);

    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = EXIT_CLASS;
    exitBtn.setAttribute('aria-label', 'Leave My World');
    exitBtn.textContent = '\u2715';
    exitBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeFullscreen();
    });
    host.appendChild(exitBtn);

    document.body.appendChild(host);

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    requestNative(host);
    frame = 0;
    initSkyClock();
    fit();
    startLoop();

    mountedContainer = host;
    return getState();
  }

  function closeFullscreen() {
    if (!host) return;

    nativeFs = false;
    stopLoop();

    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);

    const h = host;
    host = null;
    canvas = null;
    ctx = null;
    resetSky();
    if (mountedContainer === h) mountedContainer = null;
    h.remove();
    exitNative();

    const cb = onExitCb;
    onExitCb = null;
    if (cb) cb();
  }

  // ---------------------------------------------------------------------
  // Entry point called by nav.js when the My World tab is selected.
  // ---------------------------------------------------------------------
  function init(container, prevScreen) {
    if (container) mountedContainer = container;
    if (host) return getState();

    const target = (prevScreen && prevScreen !== 'myworld') ? prevScreen : 'library';
    return openFullscreen(function () {
      if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo(target);
    });
  }

  // ---------------------------------------------------------------------
  // Compatibility surface (kept so existing callers don't break)
  // ---------------------------------------------------------------------
  function render(container) {
    if (container && container !== host) mountedContainer = container;
    fit();
  }

  function renderTree() { /* Phase 5 */ }

  function refresh() { fit(); }

  function loadState() {
    if (!hasData()) { warnMissingDeps('loadState'); return null; }
    return MyWorldData.load();
  }

  function getState() {
    if (!hasData()) { warnMissingDeps('getState'); return null; }
    return MyWorldData.getWorld();
  }

  function save() {
    if (!hasData()) { warnMissingDeps('save'); return false; }
    return MyWorldData.persist(MyWorldData.getWorld());
  }

  return {
    init,
    loadState,
    getState,
    save,
    refresh,

    openFullscreen,
    closeFullscreen,
    isFullscreen,
    setDebugTime,

    render,
    renderTree,

    recalculateGrowth,
    computeGrowthState,
    applyStudyProgress
  };
})();
