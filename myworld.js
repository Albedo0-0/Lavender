/**
 * myworld.js — My World pixel world (Phase 0 skeleton + Phase 1 fullscreen shell).
 * Depends on MyWorldData (persistence), MyWorldAssets (stage math) and MyWorldContent (world/tree definitions).
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
  let BASE_HEIGHT = 180;
  const MAX_DT = 0.1;
  const HOST_CLASS = 'myworld-fullscreen-host';
  const CANVAS_CLASS = 'myworld-canvas';
  const EXIT_CLASS = 'myworld-exit-btn';
  const PLACEHOLDER_BG = '#232a52';
  let HORIZON_RATIO = 0.66;
  let GROUND_RATIO = 0.74;
  let TREE_SLOT = 0.5;
  let STAR_SEED = 20240517;
  let CLOUD_SEED = 4242;
  let worldDef = null;
  let treeDef = null;
  let treeStages = null;

  // Sky keyframes come from the active world definition (see applyContent).
  let SKY_KEYS = [];

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
  function treeRecord(world) {
    if (treeDef && typeof MyWorldContent !== 'undefined' && MyWorldContent) {
      const r = MyWorldContent.getTreeRecord(treeDef.id);
      if (r) return r;
    }
    return (world && world.tree) ? world.tree : null;
  }

  function writeGrowth(growthPoints, stageIndex, stageProgress) {
    if (treeDef && typeof MyWorldContent !== 'undefined' && MyWorldContent) {
      return MyWorldContent.setTreeGrowth(treeDef.id, growthPoints, stageIndex, stageProgress);
    }
    return MyWorldData.setTreeGrowth(growthPoints, stageIndex, stageProgress);
  }

  function computeGrowthState(world) {
    const rec = treeRecord(world);
    if (!hasAssets() || !world || !rec) {
      return { stageIndex: 0, stageProgress: 0 };
    }
    const growthPoints = rec.growthPoints || 0;
    const stageIndex = MyWorldAssets.getStageIndexForGrowthPoints(growthPoints, treeStages);
    const stageProgress = MyWorldAssets.getStageProgress(growthPoints, treeStages);
    return { stageIndex, stageProgress };
  }

  function recalculateGrowth() {
    if (!hasData()) { warnMissingDeps('recalculateGrowth'); return null; }
    const world = MyWorldData.getWorld();
    const rec = treeRecord(world);
    if (!rec) return null;
    const derived = computeGrowthState(world);

    const stageChanged = derived.stageIndex !== rec.stageIndex;
    const progressChanged = Math.abs(derived.stageProgress - rec.stageProgress) > 0.0001;

    if (stageChanged || progressChanged) {
      writeGrowth(rec.growthPoints, derived.stageIndex, derived.stageProgress);
      if (stageChanged && hasAssets()) {
        const stageDef = MyWorldAssets.getStageByIndex(derived.stageIndex, treeStages);
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
    const rec = treeRecord(world);
    if (!rec) return null;
    const priorTotal = world.lifetimeStudyContribution.totalMinutesApplied || 0;
    const total = (typeof newLifetimeTotalMinutes === 'number' && isFinite(newLifetimeTotalMinutes))
      ? clampNum(newLifetimeTotalMinutes, 0, Number.MAX_SAFE_INTEGER, priorTotal + delta)
      : priorTotal + delta;

    MyWorldData.setLifetimeStudyContribution(total, delta);

    const addedGrowthPoints = delta * GROWTH_POINTS_PER_STUDY_MINUTE;
    const newGrowthPoints = clampNum(
      (rec.growthPoints || 0) + addedGrowthPoints,
      0, Number.MAX_SAFE_INTEGER, rec.growthPoints || 0
    );
    writeGrowth(newGrowthPoints);

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
    const rand = makeRng(STAR_SEED);
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

  let PAL_FAR = [];
  let PAL_MID = [];
  let PAL_GROUND = [];

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

    if (W >= 90 && !(worldDef && worldDef.pond === false)) {
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
    const cx = Math.floor(W * TREE_SLOT);
    terrain = { far: newLayer(), mid: newLayer(), ground: newLayer(), key: '' };
    buildHills(cx);
    buildGround(cx);
    buildGrassTufts();
    buildAmbientLights();
    buildLightShafts();
    buildAmbientProps();
  }

  function resetTerrain() {
    terrain = null;
    surf = null;
    pond = null;
    grassTufts = null;
    groundPalCache = null;
    ambientLights = null;
    lightShafts = null;
    ambientProps = null;
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
    groundPalCache = gp;
    gp.push(quant(mixRgb(s.bot, s.mid, 0.4)));
    gp.push(quant(mixRgb(s.mid, [16, 40, 70], 0.35)));
    gp.push(quant(mixRgb(s.top, [10, 24, 48], 0.5)));
    gp.push(quant(mixRgb(s.bot, [255, 255, 255], 0.55)));
    paintLayer(terrain.ground, gp);
    stampAmbientProps(terrain.ground.g, env);
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

  function drawHillsFar() {
    ensureTerrain();
    ctx.drawImage(terrain.far.canvas, 0, 0);
  }

  function drawHillsMid() {
    ensureTerrain();
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

  // ---------------------------------------------------------------------
  // Clouds and weather (Phase 4)
  // ---------------------------------------------------------------------
  let WX = { clear: { cover: 0.25, rain: 0, fog: 0, wind: 0.15 } };
  let WX_NAMES = ['clear'];
  let WX_WEIGHTS = [1];
  let CLOUD_TONES = { day: [], dusk: [], night: [] };

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  let wxName = 'clear';
  let wxLeft = 0;
  let wxLocked = false;
  let wxRand = null;
  let wxNow = { cover: 0.25, rain: 0, fog: 0, wind: 0.15 };
  let wxDt = 0;
  let windNow = 0.15;
  let motionScale = 1;
  let debugWeather = null;
  let clouds = null;
  let cloudKey = '';
  let fogBands = null;
  let fogKey = '';
  let drops = null;
  let splashes = null;

  function isWx(n) {
    return typeof n === 'string' && Object.prototype.hasOwnProperty.call(WX, n);
  }

  function wxRnd() {
    if (!wxRand) wxRand = makeRng((Date.now() / 1000) >>> 0);
    return wxRand();
  }

  function lockWeather(name) {
    const t = WX[name];
    wxName = name;
    wxLocked = true;
    wxNow = { cover: t.cover, rain: t.rain, fog: t.fog, wind: t.wind };
  }

  function setDebugWeather(name) {
    if (isWx(name)) {
      debugWeather = name;
      wxName = name;
      wxLocked = true;
    } else {
      debugWeather = null;
      wxLocked = false;
      wxLeft = 0;
    }
  }

  function getWind() {
    return windNow;
  }

  function getWeather() {
    return wxName;
  }

  function resetWeather() {
    clouds = null;
    cloudKey = '';
    fogBands = null;
    fogKey = '';
    drops = null;
    splashes = null;
  }

  function initWeather() {
    wxRand = makeRng((Date.now() / 1000) >>> 0);
    motionScale = (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 0.4 : 1;
    const m = typeof location !== 'undefined' ? /[?&]mwweather=([a-z]+)/.exec(location.search) : null;
    const dw = m ? m[1] : debugWeather;
    wxLocked = false;
    wxName = 'clear';
    wxNow = { cover: WX.clear.cover, rain: 0, fog: 0, wind: WX.clear.wind };
    windNow = WX.clear.wind;
    wxLeft = 90 + wxRnd() * 90;
    if (isWx(dw)) lockWeather(dw);
    resetWeather();
  }

  function pickWeather() {
    let total = 0;
    for (let i = 0; i < WX_NAMES.length; i++) {
      if (WX_NAMES[i] !== wxName) total += WX_WEIGHTS[i];
    }
    let r = wxRnd() * total;
    for (let i = 0; i < WX_NAMES.length; i++) {
      if (WX_NAMES[i] === wxName) continue;
      r -= WX_WEIGHTS[i];
      if (r <= 0) return WX_NAMES[i];
    }
    return 'clear';
  }

  function updateWeather(dt) {
    wxDt = dt;
    if (!wxLocked) {
      wxLeft -= dt;
      if (wxLeft <= 0) {
        wxName = pickWeather();
        wxLeft = 100 + wxRnd() * 120;
      }
    }
    const tgt = WX[wxName];
    const k = 1 - Math.exp(-dt / 7);
    wxNow.cover += (tgt.cover - wxNow.cover) * k;
    wxNow.rain += (tgt.rain - wxNow.rain) * k;
    wxNow.fog += (tgt.fog - wxNow.fog) * k;
    wxNow.wind += (tgt.wind - wxNow.wind) * k;
    const t = clockElapsed;
    const gust = 0.85 + 0.15 * Math.sin(t * 0.37) + 0.1 * Math.sin(t * 0.91 + 1.3);
    windNow = clampNum(wxNow.wind * gust, 0, 1, 0);
    updateClouds(dt);
  }

  // ---- clouds ----
  function makeCloudMap(rand, w, h) {
    const map = new Uint8Array(w * h);
    const n = 3 + Math.floor(w / 13);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let ry = Math.max(2, h * (0.3 + 0.32 * rand()) * (1 - 0.5 * Math.abs(2 * t - 1)));
      ry = Math.min(ry, (h - 1) / 1.85);
      const rx = Math.min(w / 2 - 0.5, ry * (1.2 + rand() * 0.6));
      const cx = rx + t * (w - 2 * rx);
      const cy = h - 1 - ry * 0.85;
      const y1 = Math.min(h - 1, Math.ceil(cy + ry));
      const x1 = Math.min(w - 1, Math.ceil(cx + rx));
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= y1; y++) {
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= x1; x++) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) map[y * w + x] = 2;
        }
      }
    }
    for (let x = 0; x < w; x++) {
      if (map[(h - 1) * w + x] && rand() < 0.3) map[(h - 1) * w + x] = 0;
    }
    for (let x = 0; x < w; x++) {
      let ct = -1;
      let cb = -1;
      for (let y = 0; y < h; y++) {
        if (map[y * w + x]) { if (ct < 0) ct = y; cb = y; }
      }
      if (ct < 0) continue;
      const span = cb - ct + 1;
      for (let y = ct; y <= cb; y++) {
        if (!map[y * w + x]) continue;
        const rel = (y - ct) / span;
        let v = 2;
        if (y === ct || (rel < 0.22 && (x + y) % 3 === 0)) v = 1;
        else if (rel > 0.7 || (rel > 0.58 && ((x + y) & 1))) v = 3;
        map[y * w + x] = v;
      }
    }
    return map;
  }

  function buildClouds() {
    const rand = makeRng(CLOUD_SEED);
    clouds = [];
    for (let li = 0; li < 2; li++) {
      const far = li === 0;
      const sprites = [];
      let maxW = 0;
      for (let s = 0; s < 4; s++) {
        let w = far ? Math.round(H * (0.1 + rand() * 0.12)) : Math.round(H * (0.26 + rand() * 0.22));
        w = Math.max(14, Math.min(w, Math.round(W * (far ? 0.4 : 0.75))));
        const h = Math.max(5, Math.round(w * (far ? 0.28 : 0.36)));
        sprites.push({ w: w, h: h, map: makeCloudMap(rand, w, h), canvas: null, g: null, img: null });
        if (w > maxW) maxW = w;
      }
      const n = far ? clampNum(Math.round(W / 48), 4, 9, 5) : clampNum(Math.round(W / 70), 3, 7, 4);
      const period = W + maxW * 2;
      const rank = [];
      for (let i = 0; i < n; i++) rank.push(i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = rank[i]; rank[i] = rank[j]; rank[j] = tmp;
      }
      const list = [];
      for (let i = 0; i < n; i++) {
        list.push({
          sp: sprites[i % 4],
          x: -maxW + (i + rand() * 0.6) * period / n,
          y: Math.round(H * (far ? 0.07 + rand() * 0.33 : 0.05 + rand() * 0.34)),
          v: far ? 1.2 + rand() * 0.8 : 3 + rand() * 2,
          th: rank[i] / n * 0.85
        });
      }
      clouds.push({ far: far, sprites: sprites, list: list, maxW: maxW, period: period });
    }
    cloudKey = '';
  }

  function updateClouds(dt) {
    if (!clouds) return;
    const f = dt * motionScale * (0.6 + windNow * 1.4);
    for (let li = 0; li < clouds.length; li++) {
      const L = clouds[li];
      for (let i = 0; i < L.list.length; i++) {
        const c = L.list[i];
        c.x += c.v * f;
        if (c.x >= W + L.maxW) c.x -= L.period;
      }
    }
  }

  function cloudPal(env, far, gray) {
    const out = [null];
    for (let i = 0; i < 3; i++) {
      let c = mixRgb(CLOUD_TONES.day[i], CLOUD_TONES.night[i], env.nf);
      c = mixRgb(c, CLOUD_TONES.dusk[i], env.dusk * 0.9);
      c = mixRgb(c, [110, 118, 138], gray * 0.55);
      if (far) c = mixRgb(c, env.sky.bot, 0.3);
      out.push(quant(c));
    }
    return out;
  }

  function paintSprite(sp, pal) {
    if (!sp.canvas) {
      sp.canvas = document.createElement('canvas');
      sp.canvas.width = sp.w;
      sp.canvas.height = sp.h;
      sp.g = sp.canvas.getContext('2d');
      sp.img = sp.g.createImageData(sp.w, sp.h);
    }
    const d = sp.img.data;
    const m = sp.map;
    for (let i = 0, n = m.length; i < n; i++) {
      const v = m[i];
      const j = i * 4;
      if (!v) { d[j + 3] = 0; continue; }
      const c = pal[v];
      d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255;
    }
    sp.g.putImageData(sp.img, 0, 0);
  }

  function ensureClouds() {
    if (!clouds) buildClouds();
    const hour = getWorldHour();
    const gray = Math.round(clampNum((wxNow.cover - 0.5) / 0.45, 0, 1, 0) * 6);
    const key = Math.floor(hour * 12) + '|' + gray + '|' + W + 'x' + H;
    if (key === cloudKey) return;
    cloudKey = key;
    const env = terrainEnv(hour);
    for (let li = 0; li < clouds.length; li++) {
      const pal = cloudPal(env, clouds[li].far, gray / 6);
      for (let s = 0; s < clouds[li].sprites.length; s++) paintSprite(clouds[li].sprites[s], pal);
    }
  }

  function drawClouds(li) {
    ensureClouds();
    const L = clouds[li];
    for (let i = 0; i < L.list.length; i++) {
      const c = L.list[i];
      const a = Math.round(clampNum((wxNow.cover - c.th) / 0.14, 0, 1, 0) * 4) / 4;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(c.sp.canvas, Math.round(c.x), c.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- fog ----
  function buildFog() {
    const fw = Math.ceil(W / 4) * 4;
    const defs = [
      { y: groundY - Math.round(H * 0.2), h: Math.round(H * 0.16), peak: 0.85, mid: 0.6, v: 1.6 },
      { y: groundY - Math.round(H * 0.09), h: Math.round(H * 0.09) + 3, peak: 0.7, mid: 0.7, v: 2.6 }
    ];
    fogBands = defs.map(function (d) {
      return {
        y: d.y, h: Math.max(4, d.h), peak: d.peak, mid: d.mid, v: d.v, fw: fw,
        off: 0, canvas: null, g: null, img: null
      };
    });
    fogKey = '';
  }

  function paintFog(b, rgb) {
    const fw = b.fw;
    if (!b.canvas) {
      b.canvas = document.createElement('canvas');
      b.canvas.width = fw;
      b.canvas.height = b.h;
      b.g = b.canvas.getContext('2d');
      b.img = b.g.createImageData(fw, b.h);
    }
    const d = b.img.data;
    const TAU = 6.2832;
    for (let y = 0; y < b.h; y++) {
      const pv = y / (b.h - 1);
      const prof = Math.sin(Math.PI / 2 * (pv < b.mid ? pv / b.mid : (1 - pv) / (1 - b.mid)));
      for (let x = 0; x < fw; x++) {
        const n = 0.5 + 0.2 * Math.sin(TAU * 2 * x / fw + 0.9) +
          0.18 * Math.sin(TAU * 3 * x / fw + y * 0.15 + 2.1) +
          0.12 * Math.sin(TAU * 5 * x / fw - y * 0.2);
        const dens = b.peak * prof * (0.45 + 0.75 * n);
        const on = dens > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const j = (y * fw + x) * 4;
        d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2]; d[j + 3] = on ? 255 : 0;
      }
    }
    b.g.putImageData(b.img, 0, 0);
  }

  function ensureFog() {
    if (!fogBands) buildFog();
    const hour = getWorldHour();
    const key = Math.floor(hour * 12) + '|' + W + 'x' + H;
    if (key === fogKey) return;
    fogKey = key;
    const env = terrainEnv(hour);
    const rgb = quant(mixRgb(mixRgb(env.sky.bot, [236, 238, 246], 0.55), [52, 60, 100], env.nf * 0.8));
    for (let i = 0; i < fogBands.length; i++) paintFog(fogBands[i], rgb);
  }

  function drawFog(i) {
    if (wxNow.fog < 0.03) return;
    ensureFog();
    const b = fogBands[i];
    b.off = (b.off + b.v * wxDt * motionScale * (0.5 + windNow)) % b.fw;
    ctx.globalAlpha = Math.round(clampNum(wxNow.fog * 0.7, 0, 1, 0) * 20) / 20;
    const o = Math.round(b.off);
    ctx.drawImage(b.canvas, -o, b.y);
    ctx.drawImage(b.canvas, b.fw - o, b.y);
    ctx.globalAlpha = 1;
  }

  // ---- rain ----
  function buildRain() {
    const cap = clampNum(Math.round(W * H / 230), 60, 220, 120);
    drops = [];
    for (let i = 0; i < cap; i++) drops.push({ x: 0, y: 0, vy: 120, off: 0, len: 2, on: false });
    splashes = [];
    for (let i = 0; i < 40; i++) splashes.push({ x: 0, y: 0, t: 0.24 });
  }

  function dropLandY(d) {
    const x = clampNum(Math.round(d.x), 0, W - 1, 0);
    const wet = pond && surf && x >= pond.x0 && x <= pond.x1 && surf[x] > groundY;
    return (wet ? groundY : getSurfaceY(x)) - d.off;
  }

  function spawnDrop(d) {
    d.x = -40 + wxRnd() * (W + 40);
    d.y = -2 - wxRnd() * H * 0.5;
    d.vy = (110 + wxRnd() * 70) * Math.max(0.55, motionScale);
    d.off = wxRnd() < 0.3 ? 2 + Math.floor(wxRnd() * 9) : 0;
    d.len = wxRnd() < 0.4 ? 3 : 2;
    d.on = true;
  }

  function addSplash(x, y) {
    if (x < 0 || x >= W) return;
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i];
      if (s.t >= 0.24) {
        s.x = Math.round(x);
        s.y = Math.round(y);
        s.t = 0;
        return;
      }
    }
  }

  function drawRain(dt) {
    if (!drops) buildRain();
    const active = Math.round(drops.length * wxNow.rain);
    const nf = nightFactor(getWorldHour());
    ctx.fillStyle = css(mixRgb([205, 226, 252], [120, 140, 200], nf));
    ctx.globalAlpha = 0.6;
    const vx = windNow * 50 * Math.max(0.55, motionScale);
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.on) {
        if (i >= active) continue;
        spawnDrop(d);
      }
      d.y += d.vy * dt;
      d.x += vx * dt;
      const ly = dropLandY(d);
      if (d.y >= ly) {
        addSplash(d.x, ly);
        if (i < active) spawnDrop(d); else d.on = false;
        continue;
      }
      const sl = vx / d.vy;
      for (let j = 0; j < d.len; j++) {
        ctx.fillRect(Math.round(d.x - j * sl), Math.round(d.y) - j, 1, 1);
      }
    }
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i];
      if (s.t >= 0.24) continue;
      s.t += dt;
      if (s.t >= 0.24) continue;
      if (s.t < 0.12) {
        ctx.globalAlpha = 0.6;
        ctx.fillRect(s.x - 1, s.y - 1, 1, 1);
        ctx.fillRect(s.x + 1, s.y - 1, 1, 1);
      } else {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(s.x - 2, s.y - 2, 1, 1);
        ctx.fillRect(s.x + 2, s.y - 2, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWeatherTint() {
    const a = (wxNow.rain * 0.2 + wxNow.fog * 0.05) * (1 - 0.6 * nightFactor(getWorldHour()));
    if (a < 0.02) return;
    ctx.globalAlpha = Math.round(a * 50) / 50;
    ctx.fillStyle = 'rgb(70,80,104)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // Living ambience: birds, butterflies, fireflies, falling leaves/petals,
  // grass sway, water shimmer (Phase 6)
  // ---------------------------------------------------------------------
  let reduceMotion = false;
  let lifeRand = null;
  let grassTufts = null;
  let groundPalCache = null;
  let birds = null;
  let birdTimer = 0;
  let butterflies = null;
  let fireflies = null;
  let fireflyHalo = null;
  let leaves = null;
  let shimmer = null;

  function lifeRnd() {
    if (!lifeRand) lifeRand = makeRng((Date.now() / 1000 + 777) >>> 0);
    return lifeRand();
  }

  // ---- grass tufts ----
  function buildGrassTufts() {
    grassTufts = [];
    if (!surf) return;
    const rand = makeRng(STAR_SEED ^ 0x2f6e2b1);
    const step = 3;
    for (let x = 1; x < W - 1; x += step) {
      const gx = Math.min(W - 2, x + Math.floor(rand() * step));
      if (rand() < 0.35) continue;
      if (pond && gx >= pond.x0 - 2 && gx <= pond.x1 + 2) continue;
      grassTufts.push({ x: gx, y: surf[gx], ph: rand() * 6.283, tall: rand() < 0.3, ci: 1 + Math.floor(rand() * 3) });
    }
  }

  function drawGrass() {
    if (!grassTufts || !groundPalCache) return;
    const amp = reduceMotion ? 0 : 1.1 * windNow;
    for (let i = 0; i < grassTufts.length; i++) {
      const t = grassTufts[i];
      const c = groundPalCache[t.ci];
      if (!c) continue;
      ctx.fillStyle = css(c);
      ctx.fillRect(t.x, t.y - 1, 1, 1);
      const sway = amp ? Math.sin(clockElapsed * 2.1 + t.ph) * amp * (t.tall ? 1 : 0.6) : 0;
      ctx.fillRect(t.x + Math.round(sway), t.y - 2, 1, 1);
    }
  }

  // ---- birds ----
  function buildBirds() {
    birds = [];
    for (let i = 0; i < 8; i++) birds.push({ active: false });
  }

  function spawnFlock() {
    const n = reduceMotion ? 1 + Math.floor(lifeRnd() * 2) : 2 + Math.floor(lifeRnd() * 3);
    const dir = lifeRnd() < 0.5 ? 1 : -1;
    const baseY = Math.round(horizonY * (0.15 + lifeRnd() * 0.35));
    const speed = (14 + lifeRnd() * 8) * dir;
    const treeX = Math.floor(W * TREE_SLOT);
    let placed = 0;
    for (let i = 0; i < birds.length && placed < n; i++) {
      const b = birds[i];
      if (b.active) continue;
      b.active = true;
      b.perch = false;
      b.landed = false;
      b.x = dir > 0 ? -6 - placed * 8 : W + 6 + placed * 8;
      b.y = baseY + (lifeRnd() - 0.5) * 10;
      b.vx = speed;
      b.amp = 1.2 + lifeRnd() * 1.3;
      b.ph = lifeRnd() * 6.283;
      b.wph = lifeRnd() * 6.283;
      b.canPerch = placed === 0 && treeGrowth.g >= 12 && lifeRnd() < 0.4 && !!treeSkel;
      if (b.canPerch) {
        b.tx = treeX + (lifeRnd() - 0.5) * treeSkel.Rc * 0.7;
        b.ty = groundY - treeSkel.Ht * (0.55 + lifeRnd() * 0.25);
      }
      placed++;
    }
  }

  function updateBirds(dt) {
    if (!birds) buildBirds();
    const day = nightFactor(getWorldHour()) < 0.5;
    if (!day) {
      for (let i = 0; i < birds.length; i++) birds[i].active = false;
      birdTimer = 20;
      return;
    }
    birdTimer -= dt * motionScale;
    if (birdTimer <= 0) {
      spawnFlock();
      birdTimer = (reduceMotion ? 26 : 16) + lifeRnd() * 20;
    }
    const treeX = Math.floor(W * TREE_SLOT);
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (!b.active) continue;
      b.wph += dt * 9 * motionScale;
      if (b.perch) {
        b.perchT -= dt * motionScale;
        if (b.perchT <= 0) {
          b.perch = false;
          b.vx = (b.x < treeX ? -1 : 1) * 18;
        }
        continue;
      }
      if (b.canPerch && !b.landed) {
        const dx = b.tx - b.x;
        const dy = b.ty - b.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 2.5) {
          b.perch = true;
          b.perchT = 4 + lifeRnd() * 5;
          b.landed = true;
          b.x = b.tx;
          b.y = b.ty;
          continue;
        }
        b.x += (dx / d) * 20 * dt * motionScale;
        b.y += (dy / d) * 20 * dt * motionScale + Math.sin(clockElapsed * 6 + b.ph) * 0.15;
        continue;
      }
      b.x += b.vx * dt * motionScale;
      b.y += Math.sin(clockElapsed * 3 + b.ph) * b.amp * dt * motionScale * 3;
      if (b.x < -12 || b.x > W + 12) b.active = false;
    }
  }

  function drawBirds() {
    if (!birds) return;
    ctx.fillStyle = '#2a2438';
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      if (!b.active) continue;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      if (b.perch) {
        ctx.fillRect(x, y - 1, 1, 2);
        ctx.fillRect(x - 1, y - 1, 1, 1);
        continue;
      }
      const up = Math.sin(b.wph) > 0;
      ctx.fillRect(x - 2, y - (up ? 1 : 0), 2, 1);
      ctx.fillRect(x + 1, y - (up ? 1 : 0), 2, 1);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // ---- butterflies ----
  function buildButterflies() {
    butterflies = [];
    const n = reduceMotion ? 2 : 3;
    for (let i = 0; i < n; i++) butterflies.push({ active: false });
  }

  function spawnButterfly(b) {
    b.active = true;
    b.x = lifeRnd() * W;
    b.y = groundY - 8 - lifeRnd() * (H * 0.22);
    b.ang = lifeRnd() * 6.283;
    b.turnPh = lifeRnd() * 6.283;
    b.wph = lifeRnd() * 6.283;
    b.hue = lifeRnd() < 0.5;
  }

  function updateButterflies(dt) {
    if (!butterflies) buildButterflies();
    const active = nightFactor(getWorldHour()) < 0.75;
    for (let i = 0; i < butterflies.length; i++) {
      const b = butterflies[i];
      if (!active) { b.active = false; continue; }
      if (!b.active) {
        if (lifeRnd() < dt * 0.1) spawnButterfly(b);
        continue;
      }
      b.wph += dt * 7 * motionScale;
      b.turnPh += dt * 0.6;
      b.ang += Math.sin(b.turnPh) * dt * 0.8;
      const sp = 5 * motionScale;
      b.x += Math.cos(b.ang) * sp * dt;
      b.y += Math.sin(b.ang) * sp * dt * 0.6;
      if (b.x < -4 || b.x > W + 4 || b.y < 4 || b.y > groundY) b.active = false;
    }
  }

  function drawButterflies() {
    if (!butterflies) return;
    for (let i = 0; i < butterflies.length; i++) {
      const b = butterflies[i];
      if (!b.active) continue;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      const open = Math.sin(b.wph) > 0;
      ctx.fillStyle = b.hue ? '#f0c040' : '#e88ac0';
      ctx.fillRect(x - (open ? 2 : 1), y, 1, 1);
      ctx.fillRect(x + (open ? 1 : 0), y, 1, 1);
      ctx.fillStyle = '#2a2438';
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // ---- fireflies ----
  function buildFireflyHalo() {
    const c = document.createElement('canvas');
    c.width = 5;
    c.height = 5;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = g.createImageData(5, 5);
    const d = img.data;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const dx = x - 2;
        const dy = y - 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const a = Math.max(0, 1 - dist / 2.6);
        const j = (y * 5 + x) * 4;
        d[j] = 255; d[j + 1] = 228; d[j + 2] = 140; d[j + 3] = Math.round(a * 160);
      }
    }
    g.putImageData(img, 0, 0);
    fireflyHalo = c;
  }

  function buildFireflies() {
    fireflies = [];
    const count = (reduceMotion ? 2 : 4) + Math.floor(lifeRnd() * (reduceMotion ? 3 : 5));
    for (let i = 0; i < 8; i++) {
      fireflies.push({
        active: i < count,
        x: lifeRnd() * W,
        y: groundY - lifeRnd() * H * 0.14,
        vx: (lifeRnd() - 0.5) * 4,
        vy: (lifeRnd() - 0.5) * 3,
        ph: lifeRnd() * 6.283,
        bph: lifeRnd() * 6.283
      });
    }
  }

  function updateFireflies(dt) {
    if (!fireflies) buildFireflies();
    if (!fireflyHalo) buildFireflyHalo();
    for (let i = 0; i < fireflies.length; i++) {
      const f = fireflies[i];
      if (!f.active) continue;
      f.ph += dt * 0.5 * motionScale;
      f.bph += dt * 1.6 * motionScale;
      f.x += (f.vx + Math.sin(f.ph) * 2) * dt * motionScale;
      f.y += (f.vy + Math.cos(f.ph * 1.3) * 1.5) * dt * motionScale;
      if (f.x < 0) f.x += W; else if (f.x > W) f.x -= W;
      f.y = clampNum(f.y, groundY - H * 0.2, groundY - 1, f.y);
    }
  }

  function drawFireflies() {
    if (!fireflies || !fireflyHalo) return;
    const vis = nightFactor(getWorldHour());
    if (vis < 0.04) return;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < fireflies.length; i++) {
      const f = fireflies[i];
      if (!f.active) continue;
      const blink = 0.35 + 0.65 * Math.max(0, Math.sin(f.bph));
      ctx.globalAlpha = vis * blink;
      ctx.drawImage(fireflyHalo, Math.round(f.x) - 2, Math.round(f.y) - 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- falling leaves / petals ----
  function buildLeaves() {
    leaves = [];
    for (let i = 0; i < 12; i++) leaves.push({ active: false });
  }

  function spawnLeaf(l) {
    const cx = Math.floor(W * TREE_SLOT);
    const r = treeSkel ? treeSkel.Rc * 0.8 : 20;
    const ht = treeSkel ? treeSkel.Ht : 60;
    l.active = true;
    l.x = cx + (lifeRnd() - 0.5) * r * 2;
    l.y = groundY - ht + lifeRnd() * ht * 0.6;
    l.vy = 5 + lifeRnd() * 4;
    l.ph = lifeRnd() * 6.283;
    l.amp = 3 + lifeRnd() * 3;
    l.petal = treeGrowth.g >= 18 && treeGrowth.g < 22;
    l.tw = lifeRnd() * 6.283;
  }

  function updateLeaves(dt) {
    if (!leaves) buildLeaves();
    const cap = reduceMotion ? 6 : 12;
    const rate = reduceMotion ? 0.05 : 0.1;
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i];
      if (!l.active) {
        if (i < cap && lifeRnd() < dt * rate) spawnLeaf(l);
        continue;
      }
      l.ph += dt * 1.4 * motionScale;
      l.tw += dt * 1.2 * motionScale;
      l.y += l.vy * dt * motionScale;
      l.x += Math.sin(l.ph) * l.amp * dt * motionScale;
      if (l.y > getSurfaceY(l.x)) l.active = false;
    }
  }

  function drawLeaves() {
    if (!leaves) return;
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i];
      if (!l.active) continue;
      ctx.fillStyle = l.petal ? '#f7a8c4' : '#7c9a3f';
      const x = Math.round(l.x) + (Math.sin(l.tw) > 0 ? 0 : 1);
      ctx.fillRect(x, Math.round(l.y), 1, 1);
    }
  }

  // ---- pond shimmer ----
  function buildShimmer() {
    shimmer = [];
    for (let i = 0; i < 3; i++) shimmer.push({ active: false });
  }

  function updateShimmer(dt) {
    if (!pond) return;
    if (!shimmer) buildShimmer();
    const n = reduceMotion ? 2 : 3;
    for (let i = 0; i < shimmer.length; i++) {
      const s = shimmer[i];
      if (i >= n) { s.active = false; continue; }
      if (!s.active) {
        s.active = true;
        s.x = pond.x0 + 2 + lifeRnd() * Math.max(1, pond.x1 - pond.x0 - 4);
        s.vx = (lifeRnd() - 0.5) * 3;
        s.ph = lifeRnd() * 6.283;
        s.life = 3 + lifeRnd() * 3;
      }
      s.ph += dt * 1.5 * motionScale;
      s.x += s.vx * dt * motionScale;
      s.life -= dt;
      if (s.x < pond.x0 + 1 || s.x > pond.x1 - 1 || s.life <= 0) s.active = false;
    }
  }

  function drawShimmer() {
    if (!pond || !shimmer) return;
    for (let i = 0; i < shimmer.length; i++) {
      const s = shimmer[i];
      if (!s.active) continue;
      const tw = Math.sin(s.ph);
      if (tw < 0.2) continue;
      ctx.globalAlpha = 0.5 + 0.5 * tw;
      ctx.fillStyle = '#eaf6ff';
      ctx.fillRect(Math.round(s.x), groundY, 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  // ---- driver ----
  function updateLife(dt) {
    updateBirds(dt);
    updateButterflies(dt);
    updateFireflies(dt);
    updateLeaves(dt);
    updateShimmer(dt);
    updateMotes(dt);
  }

  function initLife() {
    reduceMotion = motionScale < 1;
    lifeRand = makeRng((Date.now() / 1000 + 777) >>> 0);
    buildBirds();
    buildButterflies();
    buildFireflies();
    buildLeaves();
    buildShimmer();
    birdTimer = 6 + lifeRnd() * 10;
  }

  function resetLife() {
    birds = null;
    butterflies = null;
    fireflies = null;
    fireflyHalo = null;
    leaves = null;
    shimmer = null;
    motes = null;
    birdTimer = 0;
  }

  // ---------------------------------------------------------------------
  // Glow, lighting and magic (Phase 7)
  // ---------------------------------------------------------------------
  const LIGHT_GRADE = [
    { h: 0,    c: [150, 150, 205] },
    { h: 5,    c: [170, 160, 195] },
    { h: 6.5,  c: [255, 205, 210] },
    { h: 8,    c: [235, 235, 240] },
    { h: 11,   c: [255, 255, 252] },
    { h: 13,   c: [255, 255, 250] },
    { h: 16.5, c: [255, 238, 225] },
    { h: 18,   c: [255, 180, 120] },
    { h: 19.5, c: [200, 140, 150] },
    { h: 21,   c: [150, 150, 205] },
    { h: 24,   c: [150, 150, 205] }
  ];

  let lightGradeCanvas = null;
  let lightGradeKey = '';
  let vignetteCanvas = null;
  let ambientLights = null;
  let lightHalo = null;
  let treeGlowCanvas = null;
  let treeGlowKey = '';
  let lightShafts = null;
  let motes = null;
  let ambientProps = null;

  function lightGradeAt(hour) {
    const keys = LIGHT_GRADE;
    let i = 0;
    while (i < keys.length - 2 && hour >= keys[i + 1].h) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = clampNum((hour - a.h) / (b.h - a.h), 0, 1, 0);
    const s = t * t * (3 - 2 * t);
    return mixRgb(a.c, b.c, s);
  }

  function buildLightGrade() {
    const hour = getWorldHour();
    const c = lightGradeAt(hour);
    if (!lightGradeCanvas) lightGradeCanvas = document.createElement('canvas');
    lightGradeCanvas.width = W;
    lightGradeCanvas.height = H;
    const g = lightGradeCanvas.getContext('2d');
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const shade = quant(mixRgb(c, [255, 255, 255], 0.12 * (1 - t)));
      g.fillStyle = css(shade);
      g.fillRect(0, Math.round(H * i / bands), W, Math.ceil(H / bands) + 1);
    }
    lightGradeKey = Math.floor(hour * 12) + '|' + W + 'x' + H;
  }

  function drawLightGrade() {
    const hour = getWorldHour();
    const key = Math.floor(hour * 12) + '|' + W + 'x' + H;
    if (!lightGradeCanvas || key !== lightGradeKey) buildLightGrade();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lightGradeCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  function buildVignette() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const cx = W / 2;
    const cy = H / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxD;
        const a = clampNum((dist - 0.55) / 0.45, 0, 1, 0);
        const j = (y * W + x) * 4;
        d[j] = 6; d[j + 1] = 6; d[j + 2] = 14; d[j + 3] = Math.round(a * 110);
      }
    }
    g.putImageData(img, 0, 0);
    vignetteCanvas = c;
  }

  function drawVignette() {
    if (!vignetteCanvas || vignetteCanvas.width !== W || vignetteCanvas.height !== H) buildVignette();
    ctx.drawImage(vignetteCanvas, 0, 0);
  }

  function resetLighting() {
    lightGradeCanvas = null;
    lightGradeKey = '';
    vignetteCanvas = null;
  }

  // ---- ambient lights (lanterns / glowing mushrooms) ----
  function buildLightHalo() {
    const size = 9;
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
        d[j] = 255; d[j + 1] = 200; d[j + 2] = 110; d[j + 3] = Math.round(Math.pow(a, 1.4) * 190);
      }
    }
    g.putImageData(img, 0, 0);
    lightHalo = c;
  }

  function buildAmbientLights() {
    ambientLights = [];
    if (!surf) return;
    const rand = makeRng(STAR_SEED ^ 0x51ed270b);
    const n = 2 + Math.floor(rand() * 2);
    const cx = Math.floor(W * TREE_SLOT);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = clampNum(cx + side * (8 + Math.floor(rand() * 14)), 1, W - 2, cx);
      ambientLights.push({ x: x, y: surf[x] - 1, ph: rand() * 6.283 });
    }
  }

  function drawAmbientLights() {
    if (!ambientLights) return;
    if (!lightHalo) buildLightHalo();
    const vis = nightFactor(getWorldHour());
    if (vis < 0.05) return;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ambientLights.length; i++) {
      const l = ambientLights[i];
      const flick = 0.85 + 0.15 * Math.sin(clockElapsed * 3 + l.ph);
      ctx.globalAlpha = vis * flick;
      ctx.drawImage(lightHalo, Math.round(l.x) - 4, Math.round(l.y) - 8);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- tree light pool ----
  function buildTreeGlow() {
    const grown = clampNum(treeGrowth.g / 21, 0, 1, 0);
    const r = treeSkel ? Math.max(10, Math.round(treeSkel.Rc * (0.3 + 0.6 * grown))) : 16;
    const size = r * 2;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = g.createImageData(size, size);
    const d = img.data;
    const cx = size / 2;
    const cy = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - cx) / r;
        const dy = (y - cy) / r;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const a = Math.max(0, 1 - dist);
        const j = (y * size + x) * 4;
        d[j] = 255; d[j + 1] = 214; d[j + 2] = 150; d[j + 3] = Math.round(Math.pow(a, 1.6) * 90);
      }
    }
    g.putImageData(img, 0, 0);
    treeGlowCanvas = c;
    treeGlowKey = Math.floor(treeGrowth.g) + '';
  }

  function drawTreeGlow() {
    if (!treeSkel || treeGrowth.g < 3) return;
    const vis = nightFactor(getWorldHour());
    if (vis < 0.05) return;
    const key = Math.floor(treeGrowth.g) + '';
    if (!treeGlowCanvas || treeGlowKey !== key) buildTreeGlow();
    const cx = Math.floor(W * TREE_SLOT);
    const cy = groundY - 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = vis;
    ctx.drawImage(treeGlowCanvas, cx - treeGlowCanvas.width / 2, cy - treeGlowCanvas.height / 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- light shafts ----
  function buildLightShafts() {
    lightShafts = [];
    const rand = makeRng(STAR_SEED ^ 0x7f4a7c13);
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      lightShafts.push({ ox: (rand() - 0.5) * 0.7, w: 1 + (rand() < 0.4 ? 1 : 0), ang: 0.35 + rand() * 0.25 });
    }
  }

  function shaftFactor(hour) {
    const morn = Math.max(0, 1 - Math.abs(hour - 7.5) / 1.5);
    const eve = Math.max(0, 1 - Math.abs(hour - 18.5) / 1.5);
    return clampNum(Math.max(morn, eve), 0, 1, 0);
  }

  function drawLightShafts() {
    const hour = getWorldHour();
    const f = shaftFactor(hour);
    if (f < 0.03 || !treeSkel || !lightShafts) return;
    const dir = hour < 12 ? 1 : -1;
    const cx = Math.floor(W * TREE_SLOT);
    const topY = groundY - treeSkel.Ht - 6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fff0c0';
    for (let i = 0; i < lightShafts.length; i++) {
      const s = lightShafts[i];
      const x0 = cx + s.ox * treeSkel.Rc * 1.4;
      const len = treeSkel.Ht * 1.1;
      ctx.globalAlpha = f * 0.16;
      for (let k = 0; k < len; k += 2) {
        const y = Math.round(topY + k);
        if (y >= groundY) break;
        const x = Math.round(x0 + dir * s.ang * k);
        ctx.fillRect(x, y, s.w, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- magical motes ----
  function buildMotes() {
    motes = [];
    const n = reduceMotion ? 4 : (6 + Math.floor(lifeRnd() * 5));
    for (let i = 0; i < n; i++) {
      motes.push({
        x: lifeRnd() * W,
        y: groundY - lifeRnd() * H * 0.55,
        vx: (lifeRnd() - 0.5) * 2,
        vy: -0.4 - lifeRnd() * 0.6,
        ph: lifeRnd() * 6.283
      });
    }
  }

  function updateMotes(dt) {
    if (!motes) buildMotes();
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.ph += dt * 0.4 * motionScale;
      m.x += (m.vx + Math.sin(m.ph) * 1.2) * dt * motionScale;
      m.y += m.vy * dt * motionScale;
      if (m.x < -2) m.x += W; else if (m.x > W + 2) m.x -= W;
      if (m.y < groundY - H * 0.6) {
        m.y = groundY - 2;
        m.x = lifeRnd() * W;
      }
    }
  }

  function drawMotes() {
    if (!motes) return;
    const vis = 0.25 + 0.65 * nightFactor(getWorldHour());
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#eaf0ff';
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      const tw = 0.4 + 0.4 * Math.sin(m.ph * 1.7);
      ctx.globalAlpha = vis * tw * 0.5;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- ambient props (flowers, mushrooms, rocks, bushes) ----
  function buildAmbientProps() {
    ambientProps = [];
    if (!surf) return;
    const rand = makeRng(STAR_SEED ^ 0x1a2b3c4d);
    const treeX = Math.floor(W * TREE_SLOT);
    const n = Math.round(W / 16);
    for (let i = 0; i < n; i++) {
      const x = 2 + Math.floor(rand() * (W - 4));
      if (Math.abs(x - treeX) < 10) continue;
      if (pond && x >= pond.x0 - 3 && x <= pond.x1 + 3) continue;
      const kind = rand();
      ambientProps.push({
        x: x,
        y: surf[x],
        type: kind < 0.4 ? 'flower' : (kind < 0.65 ? 'mushroom' : (kind < 0.85 ? 'rock' : 'bush')),
        hue: rand()
      });
    }
  }

  function stampAmbientProps(g, env) {
    if (!ambientProps) return;
    for (let i = 0; i < ambientProps.length; i++) {
      const p = ambientProps[i];
      const y = p.y;
      if (p.type === 'flower') {
        g.fillStyle = css(quant(mixRgb(p.hue < 0.5 ? [230, 120, 160] : [240, 200, 90], env.sky.bot, 0.15 * env.nf)));
        g.fillRect(p.x, y - 1, 1, 1);
        g.fillStyle = css(quant(mixRgb([90, 140, 60], env.sky.bot, 0.2 * env.nf)));
        g.fillRect(p.x, y, 1, 1);
      } else if (p.type === 'mushroom') {
        g.fillStyle = css(quant(mixRgb([210, 90, 90], env.sky.bot, 0.15 * env.nf)));
        g.fillRect(p.x - 1, y - 2, 3, 1);
        g.fillStyle = css(quant(mixRgb([230, 220, 200], env.sky.bot, 0.15 * env.nf)));
        g.fillRect(p.x, y - 1, 1, 2);
      } else if (p.type === 'rock') {
        g.fillStyle = css(quant(mixRgb([120, 120, 130], env.sky.bot, 0.2 * env.nf)));
        g.fillRect(p.x - 1, y - 1, 3, 2);
        g.fillStyle = css(quant(mixRgb([160, 160, 172], env.sky.bot, 0.2 * env.nf)));
        g.fillRect(p.x - 1, y - 2, 2, 1);
      } else {
        g.fillStyle = css(quant(mixRgb([60, 110, 58], env.sky.bot, 0.2 * env.nf)));
        g.fillRect(p.x - 1, y - 2, 3, 2);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Tree: procedural pixel tree grown from the persisted seed (Phase 5)
  // ---------------------------------------------------------------------
  let TREE_FT = [[0, 0], [1, 1]];
  let PAL_BARK = [];
  let PAL_FOLIAGE = [];
  let LEAF_VARIANTS = [null];

  let treeGrowth = { g: 0, seed: 1, variant: 0 };
  let treeDirty = true;
  let treeSkel = null;
  let treeCur = null;
  let treePrev = null;
  let treeFade = 1;
  let debugStage = null;
  let treeSwayPh = 0;

  function hash3(x, y, s) {
    return hash2(x * 1013 + y, s);
  }

  function seedInt(s) {
    if (typeof s === 'number' && isFinite(s)) return (Math.floor(Math.abs(s)) >>> 0) || 1;
    let h = 2166136261;
    const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
  }

  function ftAt(g) {
    for (let i = 1; i < TREE_FT.length; i++) {
      if (g <= TREE_FT[i][0]) {
        const a = TREE_FT[i - 1];
        const b = TREE_FT[i];
        return a[1] + (b[1] - a[1]) * (g - a[0]) / (b[0] - a[0]);
      }
    }
    return 1;
  }

  function ftInv(f) {
    for (let i = 1; i < TREE_FT.length; i++) {
      const a = TREE_FT[i - 1];
      const b = TREE_FT[i];
      if (b[1] > a[1] && f <= b[1]) return a[0] + (b[0] - a[0]) * (f - a[1]) / (b[1] - a[1]);
    }
    return TREE_FT[TREE_FT.length - 1][0];
  }

  function brEase(t) {
    const c = t < 0 ? 0 : (t > 1 ? 1 : t);
    return 1 - Math.pow(1 - c, 1.6);
  }

  function brInv(f) {
    return 1 - Math.pow(1 - clampNum(f, 0, 1, 0), 1 / 1.6);
  }

  function setDebugStage(n) {
    debugStage = (typeof n === 'number' && isFinite(n)) ? clampNum(n, 0, 21.999, 0) : null;
    treeDirty = true;
  }

  function readTreeGrowth() {
    treeDirty = false;
    const world = hasData() ? MyWorldData.getWorld() : null;
    const st = computeGrowthState(world);
    const rec = treeRecord(world);
    const p = (rec && rec.params) ? rec.params : {};
    let g = st.stageIndex + clampNum(st.stageProgress, 0, 1, 0);
    const m = typeof location !== 'undefined' ? /[?&]mwstage=(\d+(?:\.\d+)?)/.exec(location.search) : null;
    if (debugStage !== null) g = debugStage;
    else if (m) g = parseFloat(m[1]);
    const v = p.leafColorVariant;
    treeGrowth = {
      g: clampNum(g, 0, 21.999, 0),
      seed: seedInt(p.seed),
      variant: (typeof v === 'number' && isFinite(v)) ? Math.abs(Math.floor(v)) % Math.max(1, LEAF_VARIANTS.length) : 0
    };
  }

  function resetTree() {
    treeSkel = null;
    treeCur = null;
    treePrev = null;
    treeFade = 1;
    treeDirty = true;
    treeGlowCanvas = null;
    treeGlowKey = '';
  }

  function ptAt(br, u) {
    const f = clampNum(u, 0, 1, 0) * (br.n - 1);
    const i = Math.min(br.n - 2, Math.floor(f));
    const t = f - i;
    const p = br.pts;
    return [p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * t, p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * t];
  }

  function angAt(br, u) {
    const i = Math.min(br.n - 2, Math.floor(clampNum(u, 0, 1, 0) * (br.n - 1)));
    const p = br.pts;
    return Math.atan2(p[i * 2 + 3] - p[i * 2 + 1], p[i * 2 + 2] - p[i * 2]);
  }

  function tracePath(rand, x0, y0, phi0, turn, L, wob) {
    const n = Math.max(3, Math.ceil(L / 1.2) + 1);
    const pts = new Float32Array(n * 2);
    const step = L / (n - 1);
    let x = x0;
    let y = y0;
    let jit = 0;
    pts[0] = x;
    pts[1] = y;
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      jit = jit * 0.85 + (rand() - 0.5) * wob;
      const phi = phi0 + turn * Math.pow(t, 1.2) + jit;
      x += Math.cos(phi) * step;
      y += Math.sin(phi) * step;
      pts[i * 2] = x;
      pts[i * 2 + 1] = y;
    }
    return { pts: pts, n: n };
  }

  function mkBranch(kind, path, par, att, w0, tip, b, d, len) {
    const bb = Math.min(b, 20.6);
    return {
      kind: kind, pts: path.pts, n: path.n, par: par, att: att, w0: w0, tip: tip,
      b: bb, d: Math.max(0.8, Math.min(d, 21.95 - bb)), len: len
    };
  }

  function buildTreeSkeleton(seed, Ht, Rc) {
    const rand = makeRng(seed);
    const mir = rand() < 0.5 ? -1 : 1;
    const lean = (rand() - 0.5) * 0.16;
    const ph = rand() * 6.28;
    const hl = Ht * 0.76;
    const wL0 = Ht * 0.13;
    const br = [];
    const cl = [];

    const ln = Math.ceil(hl / 1.2) + 1;
    const lp = new Float32Array(ln * 2);
    for (let i = 0; i < ln; i++) {
      const u = i / (ln - 1);
      lp[i * 2] = lean * Ht * Math.pow(u, 1.6) + 0.035 * Ht * Math.sin(u * 5.2 + ph) * u;
      lp[i * 2 + 1] = hl * u;
    }
    br.push({ kind: 0, pts: lp, n: ln, par: -1, att: 0, w0: wL0, tip: 0.28, b: 2, d: 20, len: hl });

    const P = clampNum(Math.round(Ht / 13), 6, 10, 8);
    const limbs = [];
    let side = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < P; i++) {
      const a = 0.14 + (i + 0.5) / P * 0.68 + (rand() - 0.5) * 0.04;
      side = rand() < 0.15 ? side : -side;
      const s = Math.sin(Math.PI * clampNum((a - 0.05) / 0.85, 0, 1, 0));
      const L = Rc * (0.16 + 0.7 * Math.pow(s, 1.3)) * (0.88 + rand() * 0.24);
      const ang = (14 + 40 * a + rand() * 12) * Math.PI / 180;
      const turn = side * ((a < 0.45 ? -0.2 : 0.3) + (rand() - 0.5) * 0.2);
      const sp = ptAt(br[0], a);
      const path = tracePath(rand, sp[0], sp[1], side > 0 ? ang : Math.PI - ang, turn, L, 0.1);
      const w0 = wL0 * (1 - 0.72 * Math.pow(a, 0.85)) * 0.58;
      limbs.push(br.length);
      br.push(mkBranch(1, path, 0, a, w0, 0.12, ftInv(a + 0.04), 3 + 7 * L / Rc, L));
    }

    for (let li = 0; li < limbs.length; li++) {
      const L = br[limbs[li]];
      const nS = 2 + (rand() < 0.5 ? 1 : 0);
      for (let j = 0; j < nS; j++) {
        const u = 0.32 + j * 0.22 + rand() * 0.06;
        const sp = ptAt(L, u);
        const phi0 = angAt(L, u) + (0.55 + rand() * 0.5) * (j % 2 ? 1 : -1);
        const len2 = L.len * (0.36 + rand() * 0.2);
        const turn2 = (Math.cos(phi0) >= 0 ? 1 : -1) * (0.15 + rand() * 0.3);
        const path = tracePath(rand, sp[0], sp[1], phi0, turn2, len2, 0.14);
        const w0 = Math.max(1.5, L.w0 * (1 - 0.88 * Math.pow(u, 0.9)) * 0.62);
        const si = br.length;
        br.push(mkBranch(2, path, limbs[li], u, w0, 0.2, L.b + L.d * brInv(u) + 0.3, L.d * 0.65 + 1, len2));
        const S = br[si];
        for (let k = 0; k < 2; k++) {
          const u3 = 0.5 + k * 0.32;
          const p3 = ptAt(S, u3);
          const phi3 = angAt(S, u3) + (0.5 + rand() * 0.4) * (k ? 1 : -1);
          const len3 = len2 * (0.4 + rand() * 0.2);
          const turn3 = (Math.cos(phi3) >= 0 ? 1 : -1) * (0.1 + rand() * 0.3);
          const path3 = tracePath(rand, p3[0], p3[1], phi3, turn3, len3, 0.16);
          br.push(mkBranch(3, path3, si, u3, 1.2, 0.5, S.b + S.d * brInv(u3) + 0.3, S.d * 0.7 + 0.8, len3));
        }
      }
    }

    for (let i = 0; i < 5; i++) {
      const rs = i % 2 ? 1 : -1;
      const sx = rs * wL0 * (0.12 + rand() * 0.22);
      const sy = wL0 * (0.7 + rand() * 0.6);
      const Lr = wL0 * (1 + rand() * 1.3);
      const n = Math.ceil(Lr / 1.2) + 1;
      const pts = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        pts[k * 2] = sx + rs * Lr * t;
        pts[k * 2 + 1] = sy * Math.pow(1 - t, 1.6) - 2.2 * t;
      }
      br.push(mkBranch(4, { pts: pts, n: n }, 0, 0.02, wL0 * 0.5 * (0.8 + rand() * 0.4), 0.15, 5 + rand() * 7, 6, Lr));
    }

    for (let k = 0; k < 6; k++) {
      const u = 0.42 + k * 0.1;
      const sd = k % 2 ? 1 : -1;
      cl.push({
        br: 0, u: u, ox: sd * Rc * 0.16 * (0.5 + rand()), oy: Rc * 0.05 * (rand() - 0.5),
        rmax: Rc * (0.2 + 0.06 * rand()), tau: ftInv(u) + 0.2
      });
    }
    const us = [0.42, 0.58, 0.72, 0.86, 1];
    for (let li = 0; li < limbs.length; li++) {
      const L = br[limbs[li]];
      for (let k = 0; k < us.length; k++) {
        const rm = clampNum(Rc * 0.13 + L.len * 0.07, 5, Rc * 0.27, 8) * (us[k] === 1 ? 1.2 : 1);
        cl.push({
          br: limbs[li], u: us[k], ox: (rand() - 0.5) * rm * 0.7, oy: (rand() - 0.5) * rm * 0.7 + rm * 0.15,
          rmax: rm, tau: L.b + L.d * brInv(us[k]) + 0.3
        });
      }
    }
    for (let bi = 1; bi < br.length; bi++) {
      const B = br[bi];
      if (B.kind !== 2 && B.kind !== 3) continue;
      const ul = B.kind === 2 ? [0.6, 1] : [1];
      for (let k = 0; k < ul.length; k++) {
        const rm = B.kind === 2 ? clampNum(Rc * 0.08 + B.len * 0.05, 4, Rc * 0.18, 5) : Math.max(3.5, Rc * 0.07);
        cl.push({
          br: bi, u: ul[k], ox: (rand() - 0.5) * rm * 0.6, oy: (rand() - 0.5) * rm * 0.6 + rm * 0.15,
          rmax: rm, tau: B.b + B.d * brInv(ul[k]) + 0.3
        });
      }
    }

    if (mir < 0) {
      for (let bi = 0; bi < br.length; bi++) {
        for (let i = 0; i < br[bi].n; i++) br[bi].pts[i * 2] = -br[bi].pts[i * 2];
      }
      for (let i = 0; i < cl.length; i++) cl[i].ox = -cl[i].ox;
    }

    const cxL = Rc + 16;
    return {
      branches: br, clusters: cl, Ht: Ht, Rc: Rc, hl: hl,
      cxL: cxL, wc: cxL * 2, hc: Ht + 26, baseL: Ht + 18, key: ''
    };
  }

  function newTreeLayer(w, h) {
    return { w: w, h: h, map: new Uint8Array(w * h), canvas: null, g: null, img: null };
  }

  function setPxW(map, wc, hc, x, y, v) {
    if (x >= 0 && x < wc && y >= 0 && y < hc) map[y * wc + x] = v;
  }

  function stampDisc(map, sk, x, y, wd, tx, ty, green) {
    const cx = sk.cxL + x;
    const cy = sk.baseL - y;
    const r = wd / 2;
    const R = Math.ceil(r);
    const px0 = Math.round(cx);
    const py0 = Math.round(cy);
    const nx = -ty;
    const ny = tx;
    const lim = r * r + 0.3;
    const lx = nx * -0.72 + ny * 0.69;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const X = px0 + dx;
        const Y = py0 + dy;
        const ox = X - cx;
        const oy = -(Y - cy);
        if (ox * ox + oy * oy > lim) continue;
        const lat = clampNum((ox * nx + oy * ny) / Math.max(r, 0.5), -1, 1, 0);
        const l = lat * lx + Math.sqrt(1 - lat * lat) * 0.5;
        let t = l > 0.7 ? 1 : (l > 0.25 ? 2 : (l > -0.35 ? 3 : 4));
        if (green) t = t === 1 ? 9 : (t === 4 ? 11 : 10);
        setPxW(map, sk.wc, sk.hc, X, Y, t);
      }
    }
  }

  function drawSoil(map, sk, g) {
    const m = 1 - smoothstep(4, 10, g);
    if (m <= 0.02) return;
    const hw = Math.round(3 + 5 * m);
    const hh = Math.max(1, Math.round(1 + 2 * m));
    for (let dx = -hw; dx <= hw; dx++) {
      const top = Math.round(hh * Math.sqrt(1 - Math.abs(dx) / (hw + 0.5)));
      for (let k = 0; k <= top; k++) {
        setPxW(map, sk.wc, sk.hc, sk.cxL + dx, sk.baseL - k, k === top ? 6 : 7);
      }
    }
    if (g < 1) {
      setPxW(map, sk.wc, sk.hc, sk.cxL, sk.baseL - hh - 1, 8);
      setPxW(map, sk.wc, sk.hc, sk.cxL + 1, sk.baseL - hh - 1, 8);
    } else if (g < 2) {
      setPxW(map, sk.wc, sk.hc, sk.cxL, sk.baseL - hh, 7);
      if (g >= 1.5) setPxW(map, sk.wc, sk.hc, sk.cxL, sk.baseL - hh - 1, 9);
    }
  }

  function finishBark(map, sk, g) {
    const wc = sk.wc;
    const hc = sk.hc;
    const mag = smoothstep(19, 21.9, g);
    const src = map.slice();
    for (let y = 0; y < hc; y++) {
      for (let x = 0; x < wc; x++) {
        const i = y * wc + x;
        const v = src[i];
        if (!v || (v > 4 && v < 9)) continue;
        const green = v >= 9;
        const r = x + 1 < wc ? src[i + 1] : 0;
        const d = y + 1 < hc ? src[i + wc] : 0;
        if (!r || !d) { map[i] = green ? 11 : 4; continue; }
        if (green || (v !== 2 && v !== 3)) continue;
        if (hash3(x, y >> 2, 313) < 0.09) map[i] = v + 1;
        else if (mag > 0 && sk.baseL - y < sk.Ht * 0.5 && hash3(x, y >> 2, 91) < 0.07 * mag) map[i] = 5;
      }
    }
  }

  function drawFoliage(cm, sk, g, met) {
    const wc = sk.wc;
    const hc = sk.hc;
    const cxL = sk.cxL;
    const baseL = sk.baseL;
    const Ht = sk.Ht;
    const Rc = sk.Rc;
    const bs = sk.branches;
    const zb = new Float32Array(wc * hc).fill(-1);
    const lt = new Float32Array(wc * hc);

    function blob(cx, cy, r) {
      const x0 = Math.max(0, Math.floor(cx - r - 1));
      const x1 = Math.min(wc - 1, Math.ceil(cx + r + 1));
      const y0 = Math.max(0, Math.floor(cy - r - 1));
      const y1 = Math.min(hc - 1, Math.ceil(cy + r + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - cx) / r;
          const dy = (y + 0.5 - cy) / r;
          const d2 = dx * dx + dy * dy;
          if (d2 + (hash3(x, y, 401) - 0.5) * 0.4 > 1) continue;
          const h = Math.sqrt(Math.max(0, 1 - d2));
          const z = h * r;
          const i = y * wc + x;
          if (z <= zb[i]) continue;
          zb[i] = z;
          lt[i] = dx * -0.5 - dy * 0.62 + h * 0.6;
        }
      }
    }

    const M0 = met[0];
    if (M0 && g >= 2.6) {
      const tx = cxL + bs[0].pts[M0.m * 2];
      const ty = baseL - bs[0].pts[M0.m * 2 + 1];
      const rt = 2 + (0.3 * Rc - 2) * Math.pow(smoothstep(3, 20, g), 1.1);
      blob(tx, ty - rt * 0.35, rt);
      const k = 1 - smoothstep(8, 10.5, g);
      if (k > 0.05) {
        const lr = (1.4 + 0.3 * (g - 2.6)) * k;
        blob(tx - rt * 0.9 - lr * 0.8, ty - lr * 0.2, lr);
        blob(tx + rt * 0.9 + lr * 0.8, ty - lr * 0.2, lr);
      }
    }

    for (let i = 0; i < sk.clusters.length; i++) {
      const c = sk.clusters[i];
      if (g < c.tau) continue;
      const r = c.rmax * smoothstep(c.tau, c.tau + 4.5, g);
      if (r < 1.5) continue;
      const p = ptAt(bs[c.br], c.u);
      const s = r / c.rmax;
      blob(cxL + p[0] + c.ox * s, baseL - p[1] - c.oy * s, r);
    }

    const gold = smoothstep(18.5, 21.9, g) * 0.85;
    const holeAmt = 0.028 * smoothstep(11, 18, g);
    const bl = smoothstep(16.8, 18, g) * (1 - smoothstep(19.3, 20.3, g));
    const fr = smoothstep(19.4, 20.8, g);

    for (let y = 0; y < hc; y++) {
      for (let x = 0; x < wc; x++) {
        const i = y * wc + x;
        if (zb[i] < 0) continue;
        const wy = baseL - y;
        const l = lt[i] - 0.3 * (1 - clampNum(wy / (0.6 * Ht), 0, 1, 0)) +
          ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * 0.2;
        let t = l > 0.78 ? 5 : (l > 0.45 ? 4 : (l > 0.05 ? 3 : (l > -0.35 ? 2 : 1)));
        if (gold > 0 && t >= 4) {
          const gp = smoothstep(-0.1, 0.8, (x - cxL) / Rc * 0.6 + wy / Ht * 0.5);
          if (hash3(x, y, 611) < gold * (0.15 + 0.85 * gp)) t = t === 5 ? 11 : 6;
        }
        if (holeAmt > 0 && t >= 2 && hash3(x, y, 733) < holeAmt) continue;
        cm[i] = t;
      }
    }

    if (bl > 0.02) {
      for (let y = 0; y < hc; y++) {
        for (let x = 0; x < wc; x++) {
          const v = cm[y * wc + x];
          if (v >= 3 && v <= 5 && hash3(x, y, 555) < 0.05 * bl) {
            cm[y * wc + x] = hash3(x, y, 556) < 0.35 ? 8 : 7;
          }
        }
      }
    }

    if (fr > 0.02) {
      for (let y = 0; y < hc - 1; y += 2) {
        for (let x = 0; x < wc - 1; x += 2) {
          const a = y * wc + x;
          if (hash3(x, y, 777) >= 0.014 * fr) continue;
          const v0 = cm[a], v1 = cm[a + 1], v2 = cm[a + wc], v3 = cm[a + wc + 1];
          if (v0 < 2 || v0 > 5 || v1 < 2 || v1 > 5 || v2 < 2 || v2 > 5 || v3 < 2 || v3 > 5) continue;
          cm[a] = 10;
          cm[a + 1] = 9;
          cm[a + wc] = 9;
          cm[a + wc + 1] = 9;
        }
      }
    }

    const src = cm.slice();
    for (let y = 0; y < hc; y++) {
      for (let x = 0; x < wc; x++) {
        const i = y * wc + x;
        const v = src[i];
        if (!v || (v >= 7 && v <= 10)) continue;
        const r = x + 1 < wc ? src[i + 1] : 0;
        const d = y + 1 < hc ? src[i + wc] : 0;
        if (!r || !d) cm[i] = 1;
      }
    }
  }

  function buildTreeLayers(sk, g) {
    const trunk = newTreeLayer(sk.wc, sk.hc);
    const crown = newTreeLayer(sk.wc, sk.hc);
    const bs = sk.branches;
    const girth = 0.15 + 0.85 * Math.pow(smoothstep(2, 21.5, g), 0.75);
    const met = [];

    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi];
      const f = b.kind === 0 ? ftAt(g) : brEase((g - b.b) / b.d);
      if (b.kind === 0 ? g < 2 : f <= 0) { met.push(null); continue; }
      const m = Math.max(0, Math.floor(f * (b.n - 1)));
      let wb = b.w0 * girth;
      if (b.par >= 0 && b.kind !== 4) {
        const PM = met[b.par];
        if (PM) {
          const pb = bs[b.par];
          const pu = Math.min(1, b.att * (pb.n - 1) / Math.max(1, PM.m));
          wb = Math.min(wb, PM.wb * (1 - (1 - pb.tip) * Math.pow(pu, 0.9)) * 0.78);
        }
      }
      met.push({ m: m, wb: Math.max(1, wb) });
    }

    function stampBranch(bi) {
      const b = bs[bi];
      const M = met[bi];
      if (!M) return;
      const flare = b.kind === 0 ? 0.5 * smoothstep(6, 14, g) : 0;
      for (let i = 0; i <= M.m; i++) {
        const u = i / (b.n - 1);
        const x = b.pts[i * 2];
        const y = b.pts[i * 2 + 1];
        const j = Math.min(i + 1, b.n - 1);
        const k = Math.max(i - 1, 0);
        let tx = b.pts[j * 2] - b.pts[k * 2];
        let ty = b.pts[j * 2 + 1] - b.pts[k * 2 + 1];
        const tl = Math.sqrt(tx * tx + ty * ty) || 1;
        tx /= tl;
        ty /= tl;
        let wd = M.wb * (1 - (1 - b.tip) * Math.pow(i / Math.max(1, M.m), 0.9));
        if (flare) wd *= 1 + flare * Math.exp(-y / 6);
        const tau = b.kind === 0 ? ftInv(u) : b.b + b.d * brInv(u);
        stampDisc(trunk.map, sk, x, y, Math.max(1, wd), tx, ty, g - tau < 3.6);
      }
    }

    for (let bi = 0; bi < bs.length; bi++) if (bs[bi].kind === 4) stampBranch(bi);
    for (let bi = 0; bi < bs.length; bi++) if (bs[bi].kind !== 4) stampBranch(bi);
    drawSoil(trunk.map, sk, g);
    finishBark(trunk.map, sk, g);
    drawFoliage(crown.map, sk, g, met);
    return { trunk: trunk, crown: crown, key: '', variant: 0, palKey: -1 };
  }

  function paintMap(L, pal) {
    if (!L.canvas) {
      L.canvas = document.createElement('canvas');
      L.canvas.width = L.w;
      L.canvas.height = L.h;
      L.g = L.canvas.getContext('2d');
      L.img = L.g.createImageData(L.w, L.h);
    }
    const d = L.img.data;
    const m = L.map;
    for (let i = 0, n = m.length; i < n; i++) {
      const v = m[i];
      const j = i * 4;
      if (!v) { d[j + 3] = 0; continue; }
      const c = pal[v];
      d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255;
    }
    L.g.putImageData(L.img, 0, 0);
  }

  function variantPal(v) {
    const t = LEAF_VARIANTS[v];
    if (!t) return PAL_FOLIAGE;
    return PAL_FOLIAGE.map(function (e, i) {
      return i < 5 ? [mixRgb(e[0], t, 0.28), mixRgb(e[1], t, 0.2)] : e;
    });
  }

  function paintTree(t, pk) {
    const env = terrainEnv(getWorldHour());
    const bp = tintPal(PAL_BARK, env, 0, 0.2);
    bp[5] = hexToRgb('#ffd36a');
    paintMap(t.trunk, bp);
    paintMap(t.crown, tintPal(variantPal(t.variant), env, 0, 0.15));
    t.palKey = pk;
  }

  function ensureTree() {
    if (treeDirty) readTreeGrowth();
    const Ht = Math.round(clampNum(H * 0.6, 60, 120, 100));
    const Rc = Math.max(20, Math.min(Math.round(Ht * 0.56), Math.floor(W * 0.47)));
    const sk = treeGrowth.seed + '|' + Ht + '|' + Rc;
    if (!treeSkel || treeSkel.key !== sk) {
      treeSkel = buildTreeSkeleton(treeGrowth.seed, Ht, Rc);
      treeSkel.key = sk;
      treeCur = null;
      treePrev = null;
      treeSwayPh = makeRng(treeGrowth.seed ^ 0x27d4eb2f)() * 6.283;
    }
    const gq = Math.round(treeGrowth.g * 8);
    const gk = gq + '|' + treeGrowth.variant;
    if (!treeCur || treeCur.key !== gk) {
      const prev = treeCur;
      treeCur = buildTreeLayers(treeSkel, gq / 8);
      treeCur.key = gk;
      treeCur.variant = treeGrowth.variant;
      if (prev) {
        treePrev = prev;
        treeFade = 0;
      }
    }
    const pk = Math.floor(getWorldHour() * 12);
    if (treeCur.palKey !== pk) paintTree(treeCur, pk);
    if (treePrev && treePrev.palKey !== pk) paintTree(treePrev, pk);
  }

  function drawTree() {
    ensureTree();
    const x = Math.floor(W * TREE_SLOT) - treeSkel.cxL;
    const y = groundY + 1 - treeSkel.baseL;
    const fading = !!treePrev;
    const swayAmp = reduceMotion ? 0 : 1.6 * (0.5 + 0.5 * windNow);
    const sway = swayAmp ? Math.sin(clockElapsed * 0.5 + treeSwayPh) * swayAmp : 0;
    const skew = sway / Math.max(1, treeSkel.baseL);
    ctx.save();
    ctx.transform(1, 0, -skew, 1, x + skew * treeSkel.baseL, y);
    if (fading) {
      ctx.drawImage(treePrev.trunk.canvas, 0, 0);
      ctx.drawImage(treePrev.crown.canvas, 0, 0);
      treeFade += wxDt / 1.6;
    }
    ctx.globalAlpha = fading ? Math.min(1, treeFade) : 1;
    ctx.drawImage(treeCur.trunk.canvas, 0, 0);
    ctx.drawImage(treeCur.crown.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (fading && treeFade >= 1) {
      treePrev = null;
      treeFade = 1;
    }
  }

  function getTreeInfo() {
    if (!treeSkel) return null;
    return {
      x: Math.floor(W * TREE_SLOT),
      y: groundY,
      g: treeGrowth.g,
      height: Math.round(ftAt(treeGrowth.g) * treeSkel.hl),
      crownRadius: treeSkel.Rc
    };
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
    resetWeather();
    drawFrame(0);
  }

  function drawFrame(dt) {
    if (!ctx) return;
    clockElapsed += dt;
    updateWeather(dt);
    updateLife(dt);
    drawSky();
    drawClouds(0);
    drawHillsFar();
    drawFog(0);
    drawHillsMid();
    drawClouds(1);
    drawTerrainFront();
    drawLightShafts();
    drawTree();
    drawTreeGlow();
    drawAmbientLights();
    drawGrass();
    drawShimmer();
    drawBirds();
    drawButterflies();
    drawLeaves();
    drawFireflies();
    drawMotes();
    drawFog(1);
    drawRain(dt);
    drawWeatherTint();
    drawLightGrade();
    drawVignette();

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

    applyContent();
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
    initWeather();
    initLife();
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
    resetWeather();
    resetTree();
    resetLife();
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

  function renderTree() { treeDirty = true; }

  function applyContent() {
    if (typeof MyWorldContent === 'undefined' || !MyWorldContent) {
      if (window.console && console.warn) console.warn('[MyWorld] MyWorldContent is missing; load myworld-content.js before myworld.js.');
      return false;
    }
    const wd = MyWorldContent.getActive('world');
    const td = MyWorldContent.getActive('tree');
    if (!wd || !td || !td.procedural) return false;
    worldDef = wd;
    treeDef = td;
    BASE_HEIGHT = wd.baseHeight;
    HORIZON_RATIO = wd.horizon;
    GROUND_RATIO = wd.ground;
    TREE_SLOT = wd.treeSlot;
    STAR_SEED = wd.seeds.stars;
    CLOUD_SEED = wd.seeds.clouds;
    SKY_KEYS = wd.sky;
    skyKeysRgb = null;
    PAL_FAR = mkPal(wd.palettes.far);
    PAL_MID = mkPal(wd.palettes.mid);
    PAL_GROUND = mkPal(wd.palettes.ground);
    CLOUD_TONES = wd.cloudTones;
    WX = wd.weather.states;
    WX_NAMES = Object.keys(wd.weather.weights);
    WX_WEIGHTS = WX_NAMES.map(function (n) { return wd.weather.weights[n]; });
    TREE_FT = td.procedural.curve;
    PAL_BARK = mkPal(td.procedural.bark);
    PAL_FOLIAGE = mkPal(td.procedural.foliage);
    LEAF_VARIANTS = td.procedural.leafVariants;
    treeStages = td.stages;
    return true;
  }

  function getContent() {
    return { world: worldDef ? worldDef.id : null, tree: treeDef ? treeDef.id : null };
  }

  function setContent(worldId) {
    if (typeof MyWorldContent === 'undefined' || !MyWorldContent) return false;
    if (worldId) {
      if (!MyWorldContent.canActivate('world', worldId)) return false;
      MyWorldContent.setActive('world', worldId);
    }
    if (!applyContent()) return false;
    resetSky();
    resetTerrain();
    resetWeather();
    resetTree();
    resetLife();
    if (host) {
      initWeather();
      initLife();
      fit();
    }
    return true;
  }

  function refresh() { treeDirty = true; fit(); }

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

  applyContent();

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
    getWind,
    getWeather,
    setDebugWeather,
    setDebugStage,
    getTreeInfo,
    setContent,
    getContent,

    render,
    renderTree,

    recalculateGrowth,
    computeGrowthState,
    applyStudyProgress
  };
})();
