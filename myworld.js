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
  const GROUND_RATIO = 0.74;

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

  // ---------------------------------------------------------------------
  // Terrain: far hills, mid hills + tree line, cross-section ground, pond (Phase 3)
  // ---------------------------------------------------------------------
  function mkPal(list) {
    return list.map(function (p) { return [hexToRgb(p[0]), hexToRgb(p[1])]; });
  }

  const PAL_FAR = mkPal([
    ['#7f9f8f', '#2c3a5c'], ['#5f8272', '#1f2a48'], ['#4c6c60', '#182240']
  ]);

  const PAL_MID = mkPal([
    ['#5f9354', '#264566'], ['#4a7c48', '#1a3450'], ['#6aa652', '#22485a'],
    ['#2c4f3a', '#122238'], ['#437250', '#1c3654']
  ]);

  const PAL_GROUND = mkPal([
    ['#8ed05a', '#3a7a66'], ['#5fae44', '#2a6058'], ['#3f8a3a', '#1e4a4c'], ['#2f6e33', '#173e44'],
    ['#b98452', '#5a4560'], ['#9a6a40', '#4a3852'], ['#7c5232', '#3a2c46'], ['#623f28', '#2e2338'],
    ['#8e93a0', '#4a5078'], ['#73788a', '#3a4066'], ['#5c6174', '#2e3356'], ['#464a5e', '#232847'],
    ['#5a3a22', '#2a1f30'], ['#a9a5a0', '#5c5a78'],
    ['#f2c94c', '#d8b050'], ['#5cc8f0', '#5aa8e8'], ['#e88ac0', '#c878b8']
  ]);

  let terrain = null;
  let groundY = 0;
  let surf = null;
  let pond = null;

  function hash2(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function vnoise(x, s, salt) {
    const p = x / s;
    const i = Math.floor(p);
    const f = p - i;
    return lerp(hash2(i, salt), hash2(i + 1, salt), f * f * (3 - 2 * f));
  }

  function newLayer() {
    return { map: new Uint8Array(W * H), canvas: null, g: null, img: null };
  }

  function setPx(map, x, y, v) {
    if (x >= 0 && x < W && y >= 0 && y < H) map[y * W + x] = v;
  }

  function toneIdx(xr, y) {
    const h = hash2(Math.floor((xr + 4096) / 8) * 131 + Math.floor(y / 8), 91);
    let t = h < 0.24 ? 0 : (h > 0.76 ? 2 : 1);
    if (hash2(xr * 3 + y * 17, 92) < 0.06) t = t === 1 ? 2 : 1;
    return t;
  }

  function drawTreeShape(map, tx, by, h, conifer) {
    const y0 = by - h;
    for (let r = 0; r < h; r++) {
      const hw = conifer
        ? Math.min(2, Math.floor((r + 1) / 3))
        : Math.round((h > 5 ? 3 : 2) * Math.sin(Math.PI * (r + 0.5) / h));
      for (let dx = -hw; dx <= hw; dx++) {
        setPx(map, tx + dx, y0 + r, (dx === -hw && hw > 0 && r > 0 && r % 2 === 0) ? 5 : 4);
      }
    }
  }

  function buildHills(cx) {
    const far = terrain.far.map;
    const mid = terrain.mid.map;
    const bottom = Math.min(H, groundY + 9);
    const midTops = new Int16Array(W);
    let prevTop = 0;

    for (let x = 0; x < W; x++) {
      const xr = x - cx;
      const fTop = Math.round(horizonY - 6 - H * 0.16 *
        (0.55 * vnoise(xr, 74, 11) + 0.3 * vnoise(xr, 29, 12) + 0.15 * vnoise(xr, 11, 13)));
      const span = Math.max(1, bottom - fTop);
      for (let y = Math.max(0, fTop); y < bottom; y++) {
        const dep = (y - fTop) / span;
        let v;
        if (y === fTop || (y === fTop + 1 && fTop < prevTop)) v = 1;
        else if (dep > 0.72 || (dep > 0.64 && ((x + y) & 1))) v = 3;
        else v = 2;
        far[y * W + x] = v;
      }
      prevTop = fTop;

      const mTop = Math.round(groundY - 6 - H * 0.11 *
        (0.6 * vnoise(xr, 48, 21) + 0.3 * vnoise(xr, 18, 22) + 0.1 * vnoise(xr, 7, 23)));
      midTops[x] = mTop;
      for (let y = Math.max(0, mTop); y < bottom; y++) {
        let v = 2;
        if (y === mTop) v = 1;
        else if (y >= groundY - 3) v = 3;
        else if (y === groundY - 4 && (x & 1)) v = 3;
        else if (hash2(xr * 7 + y, 24) < 0.05) v = 1;
        mid[y * W + x] = v;
      }
    }

    for (let k = Math.floor(-cx / 5) - 1; k <= Math.ceil((W - cx) / 5) + 1; k++) {
      if (hash2(k, 71) > 0.72) continue;
      const tx = cx + k * 5 + Math.floor(hash2(k, 72) * 5);
      if (tx < 0 || tx >= W) continue;
      const conifer = hash2(k, 74) < 0.62;
      let h = 4 + Math.floor(hash2(k, 73) * 6);
      if (!conifer) h = Math.min(h, 7);
      drawTreeShape(mid, tx, midTops[tx] + 1, h, conifer);
    }
  }

  function buildGround(cx) {
    const map = terrain.ground.map;
    const bd = new Uint8Array(W);
    surf = new Int16Array(W);
    pond = null;

    if (W >= 90) {
      const pw = clampNum(Math.round(W * 0.17), 16, 44, 16);
      const half = pw / 2;
      const pcx = Math.min(W - Math.ceil(half) - 6, cx + Math.round(W * 0.29));
      pond = { x0: Math.round(pcx - half), x1: Math.round(pcx + half), cx: pcx, half: half };
    }

    for (let x = 0; x < W; x++) {
      const xr = x - cx;
      let u = (vnoise(xr, 38, 31) - 0.5) * 3.2 + (vnoise(xr, 13, 32) - 0.5) * 1.8;
      u *= smoothstep(22, 70, Math.abs(xr));
      let dep = 0;
      if (pond) {
        u *= smoothstep(pond.half + 2, pond.half + 12, Math.abs(x - pond.cx));
        const t = (x - pond.x0) / (pond.x1 - pond.x0);
        if (t > 0 && t < 1) dep = Math.round(6 * Math.pow(Math.sin(Math.PI * t), 0.6));
      }
      bd[x] = dep;
      surf[x] = groundY + Math.round(u) + dep;
    }

    const dirtBase = H * 0.115;
    const deepStart = groundY + (H - groundY) * 0.6;

    for (let x = 0; x < W; x++) {
      const xr = x - cx;
      const s = surf[x];
      const wet = bd[x] > 0;
      const gt = wet ? 1 : 3 + (hash2(xr, 81) > 0.55 ? 1 : 0) + (hash2(xr, 82) > 0.86 ? 1 : 0);
      const dirtEnd = Math.round(dirtBase + (vnoise(xr, 9, 41) - 0.5) * 7 + (hash2(xr, 83) > 0.72 ? 1 : 0));

      if (wet) {
        for (let y = groundY; y < s; y++) {
          let v = 19;
          if (y === groundY) v = hash2(xr, 84) < 0.2 ? 21 : 18;
          else if (y === s - 1) v = 20;
          map[y * W + x] = v;
        }
      } else {
        const r = hash2(xr, 85);
        const th = r < 0.22 ? 1 : (r < 0.3 ? 2 : 0);
        for (let i = 1; i <= th; i++) setPx(map, x, s - i, i === th ? 1 : 2);
        if (th === 0 && hash2(xr, 87) < 0.07) setPx(map, x, s - 1, 4);
      }

      for (let y = Math.max(0, s); y < H; y++) {
        const d = y - s;
        let v;
        if (d < gt) {
          if (wet) v = 5;
          else if (d === 0) v = 1;
          else if (d === gt - 1) v = 3;
          else v = hash2(xr * 3 + y, 88) < 0.14 ? 3 : 2;
        } else if (d < dirtEnd) {
          v = 5 + Math.min(3, toneIdx(xr, y) + (d > dirtEnd * 0.62 ? 1 : 0));
          if (d === dirtEnd - 1 && hash2(xr, 89) < 0.5) v = 8;
        } else {
          let ti = toneIdx(xr, y);
          if (y > deepStart) ti++;
          if (y >= H - 5) ti = 3;
          v = 9 + Math.min(3, ti);
        }
        map[y * W + x] = v;
      }
    }

    for (let k = Math.floor(-cx / 11) - 1; k <= Math.ceil((W - cx) / 11) + 1; k++) {
      if (hash2(k, 101) > 0.5) continue;
      const x0 = cx + k * 11 + Math.floor(hash2(k, 102) * 11);
      if (x0 < 1 || x0 >= W - 1 || bd[x0]) continue;
      const len = 4 + Math.floor(hash2(k, 103) * 8);
      const side = hash2(k, 105) < 0.5 ? -1 : 1;
      const y0 = surf[x0] + 4;
      let x = x0;
      for (let i = 0; i < len; i++) {
        setPx(map, x, y0 + i, 13);
        if (i % 3 === 2) x += hash2(k * 7 + i, 104) < 0.5 ? -1 : 1;
      }
      if (hash2(k, 106) < 0.55) {
        setPx(map, x0 + side, y0 + 2, 13);
        setPx(map, x0 + side * 2, y0 + 3, 13);
      }
    }

    const pebbles = Math.round(W / 6);
    for (let i = 0; i < pebbles; i++) {
      const x = Math.floor(hash2(i, 111) * (W - 2));
      const y = surf[x] + 6 + Math.floor(hash2(i, 112) * Math.max(1, dirtBase - 8));
      if (y >= H) continue;
      const v = map[y * W + x];
      if (v >= 5 && v <= 8) {
        setPx(map, x, y, 14);
        if (hash2(i, 113) < 0.6) setPx(map, x + 1, y, 14);
      }
    }

    const ores = Math.round(W / 8);
    const oreTop = groundY + Math.round(H * 0.14);
    for (let i = 0; i < ores; i++) {
      const x = Math.floor(hash2(i, 121) * (W - 2));
      const y = oreTop + Math.floor(hash2(i, 122) * Math.max(1, H - oreTop - 2));
      if (y >= H - 1) continue;
      const v = map[y * W + x];
      if (v < 9 || v > 12) continue;
      const r = hash2(i, 123);
      if (r < 0.4) { setPx(map, x, y, 15); setPx(map, x + 1, y, 15); }
      else if (r < 0.75) { setPx(map, x, y, 16); setPx(map, x, y + 1, 16); }
      else { setPx(map, x, y, 17); }
    }
  }

  function buildTerrain() {
    groundY = Math.floor(H * GROUND_RATIO);
    const cx = Math.floor(W / 2);
    terrain = { far: newLayer(), mid: newLayer(), ground: newLayer(), key: '' };
    buildHills(cx);
    buildGround(cx);
  }

  function resetTerrain() {
    terrain = null;
    surf = null;
    pond = null;
  }

  function onTerrainResize() {
    resetTerrain();
    buildTerrain();
  }

  function terrainEnv(hour) {
    const dawn = Math.sin(Math.PI * clampNum((hour - 4.75) / 2.5, 0, 1, 0));
    const dusk = Math.sin(Math.PI * clampNum((hour - 17.25) / 2.75, 0, 1, 0));
    return { nf: nightFactor(hour), dusk: Math.max(dawn, dusk), sky: skyColorsAt(hour) };
  }

  function tintPal(pal, env, haze, silh) {
    const out = [null];
    const hz = haze * (1 - env.dusk * 0.5);
    for (let i = 0; i < pal.length; i++) {
      let c = mixRgb(pal[i][0], pal[i][1], env.nf);
      c = mixRgb(c, [58, 54, 98], silh * env.dusk);
      c = mixRgb(c, env.sky.bot, hz);
      out.push(quant(c));
    }
    return out;
  }

  function paintLayer(layer, pal) {
    if (!layer.canvas) {
      layer.canvas = document.createElement('canvas');
      layer.canvas.width = W;
      layer.canvas.height = H;
      layer.g = layer.canvas.getContext('2d');
      layer.img = layer.g.createImageData(W, H);
    }
    const d = layer.img.data;
    const m = layer.map;
    for (let i = 0, n = m.length; i < n; i++) {
      const v = m[i];
      const j = i * 4;
      if (!v) { d[j + 3] = 0; continue; }
      const c = pal[v];
      d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255;
    }
    layer.g.putImageData(layer.img, 0, 0);
  }

  function paintTerrain(hour) {
    const env = terrainEnv(hour);
    const s = env.sky;
    paintLayer(terrain.far, tintPal(PAL_FAR, env, 0.5, 0.4));
    paintLayer(terrain.mid, tintPal(PAL_MID, env, 0.25, 0.55));
    const gp = tintPal(PAL_GROUND, env, 0.04, 0.25);
    gp.push(quant(mixRgb(s.bot, s.mid, 0.4)));
    gp.push(quant(mixRgb(s.mid, [16, 40, 70], 0.35)));
    gp.push(quant(mixRgb(s.top, [10, 24, 48], 0.5)));
    gp.push(quant(mixRgb(s.bot, [255, 255, 255], 0.55)));
    paintLayer(terrain.ground, gp);
  }

  function ensureTerrain() {
    if (!terrain) buildTerrain();
    const hour = getWorldHour();
    const key = Math.floor(hour * 12) + '|' + W + 'x' + H;
    if (key !== terrain.key) {
      paintTerrain(hour);
      terrain.key = key;
    }
  }

  function drawTerrainBack() {
    ensureTerrain();
    ctx.drawImage(terrain.far.canvas, 0, 0);
    ctx.drawImage(terrain.mid.canvas, 0, 0);
  }

  function drawTerrainFront() {
    ensureTerrain();
    ctx.drawImage(terrain.ground.canvas, 0, 0);
  }

  function getGroundY() {
    return groundY;
  }

  function getSurfaceY(x) {
    if (!surf) return groundY;
    return surf[clampNum(Math.round(x), 0, W - 1, 0)];
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
    onTerrainResize();
    drawFrame(0);
  }

  function drawFrame(dt) {
    if (!ctx) return;
    clockElapsed += dt;
    drawSky();
    drawTerrainBack();
    drawTerrainFront();

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
    resetTerrain();
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
    getGroundY,
    getSurfaceY,

    render,
    renderTree,

    recalculateGrowth,
    computeGrowthState,
    applyStudyProgress
  };
})();
