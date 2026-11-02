// entity-lv1.js — Dashboard Entity: the hardcoded, built-in LV1 pack.
// Included directly in Lavender (index.html), needs no import and no purchase, and is never written to
// settings.entityPacks. It is a normal pack manifest in the SAME declarative format imported packs use
// (entity-lvpack-data.js spec v1) and is validated by the SAME validate() when it registers, so the
// built-in and imported packs share one runtime interface.
//
// POND PHASE: the `pond` environment is now real pixel art (192x108). The art is drawn procedurally, once,
// at load time by the small painter below and emitted as ordinary frames/layers of the manifest (ASCII rows +
// palettes). Nothing is fetched, nothing is stored, no second canvas or renderer exists; the renderer paints
// these layers exactly as it paints any imported pack. The painter is deterministic (seeded, no Math.random).
//
// LAYERS (painter's order, back to front):
//   back    distant hazy forest, light glow, ground base
//   trees   near trunks and the hanging canopy that frames the top
//   bank    shoreline land: moss band, grass, bushes, ferns, bank flowers, light shafts
//   water   shaded water, mirrored reflections, ripples, shallows, lily pads and lilies
//   stones  stones, the mossy log, ripples where they touch the water
//   reeds   cattails and reeds standing in the shallows
//   fg      front-lip tufts, foreground ferns and grass, tiny flowers
//
// COMPOSITION (the renderer uses centred "cover"): the water ellipse is centred on the scene, so the middle
// ~58x24 px that is visible on every screen shape is always open water with the pond's identity. Wide
// screens add the left/right banks and reeds, tablets keep a horizontal strip of water and both shores,
// phones keep a column of far bank, reflections, lily pads, front bank and foreground.
//
// The frog and every living/ambient element are NOT here yet; they arrive as later entities.
//
// Load order: entity-lvpack-data.js -> entity-lv1.js -> entity-renderer.js
const EntityLV1 = (function () {
  'use strict';

    const W = 256, H = 144;
  const CX = 96, CY = 56, RX = 68, RY = 19.5;   // pond centre and radii

  // =====================================================================================================
  // Small deterministic toolkit: seeded random, value noise, ordered dithering
  // =====================================================================================================
  function rng(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s) { return vnoise(x, y, s) * 0.6 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.1; }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayer(x, y) { return (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  // Banded quantiser: flat tones with a narrow dithered seam between two tones (no all-over grain).
  function quant(v, x, y) {
    const b = Math.floor(v), f = v - b;
    if (f < 0.36) return b;
    if (f > 0.64) return b + 1;
    return bayer(x, y) < (f - 0.36) / 0.28 ? b + 1 : b;
  }

  // =====================================================================================================
  // Colours: every colour is registered once; ramps remember their lighter/darker neighbours
  // =====================================================================================================
  const COL = [null], hexId = {}, lighterOf = {}, darkerOf = {};
  function col(hex) { if (hexId[hex]) return hexId[hex]; COL.push(hex); return (hexId[hex] = COL.length - 1); }
  function ramp(hexes) {
    const ids = hexes.map(col);
    ids.forEach(function (id, i) { if (i < ids.length - 1) lighterOf[id] = ids[i + 1]; if (i > 0) darkerOf[id] = ids[i - 1]; });
    return ids;
  }
  function lum(id) {
    const h = COL[id]; return (0.3 * parseInt(h.slice(1, 3), 16) + 0.59 * parseInt(h.slice(3, 5), 16) + 0.11 * parseInt(h.slice(5, 7), 16)) / 255;
  }
  const FAR   = ramp(['#4a6857', '#5a7a63', '#6d8f70', '#82a47b', '#99ba8b', '#b3cf9e', '#cfe0b5']);
  const LEAF  = ramp(['#12261b', '#1a3523', '#234628', '#2e592f', '#3c6e37', '#4d8440', '#639a49', '#80b455', '#a2cb69', '#c4e088']);
  const BARK  = ramp(['#221a14', '#31261b', '#443525', '#5a4632', '#755b41', '#94795a']);
  const STONE = ramp(['#283135', '#38444a', '#4c585a', '#64706c', '#818b81', '#9fa797', '#bec2ad']);
  const MOSS  = ramp(['#2d5127', '#41712f', '#5a8f38', '#7cab46', '#a1c75b']);
  const EARTH = ramp(['#18120d', '#281e15', '#3a2b1e', '#503b27']);
  const WATER = ramp(['#0f313c', '#163e4a', '#1e4d57', '#295e63', '#367068', '#468575', '#5e9c85', '#7fb79a', '#a8d3af', '#d3ebc6']);
  const PAD   = ramp(['#1d4f2f', '#2c6a3a', '#418549', '#60a154', '#8bbf6c']);
  const CATTAIL = ramp(['#3b2a1a', '#5e4128', '#85592f']);
  const BLOOM_WHITE = col('#ece6dc'), BLOOM_PINK = col('#d8b6cc'), BLOOM_MAUVE = col('#b394b6'), BLOOM_GOLD = col('#e6c768');
  const FLOWER_LAV = col('#a99bd0'), FLOWER_CREAM = col('#ebe5cf'), FLOWER_BLUE = col('#86a4d2');
  const MUSH_CAP = col('#d9c9a8'), MUSH_STEM = col('#efe6d0');

  // =====================================================================================================
  // Layers: a layer is a grid of colour ids (0 = transparent)
  // =====================================================================================================
  function makeLayer(name) { return { name: name, g: new Uint8Array(W * H) }; }
  function put(L, x, y, c) { x = Math.round(x); y = Math.round(y); if (c && x >= 0 && y >= 0 && x < W && y < H) L.g[y * W + x] = c; }
  function at(L, x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : L.g[y * W + x]; }
  function topOf(layers, x, y) { for (let i = layers.length - 1; i >= 0; i--) { const c = at(layers[i], x, y); if (c) return c; } return 0; }
  // stamp a tiny hand-drawn sprite: rows of chars, map char -> colour id
  function stamp(L, x, y, rows, map) {
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) { const c = map[rows[j].charAt(i)]; if (c) put(L, x + i, y + j, c); }
  }

  // =====================================================================================================
  // Water geometry (shared by every layer so the shore always agrees with the water)
  // =====================================================================================================
  function buildGeometry() {
    const water = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - CX) / RX, dy = (y + 0.5 - CY) / RY;
      const d = Math.sqrt(dx * dx + dy * dy), th = Math.atan2(dy, dx);
      let T = 1 + 0.085 * Math.sin(2 * th + 1.1) + 0.06 * Math.sin(3 * th + 0.3) + 0.03 * Math.sin(5 * th + 2.0);
      T += (fbm(x * 0.085, y * 0.15, 11) - 0.5) * 0.2;
      water[y * W + x] = d < T ? 1 : 0;
    }
    // remove isolated pixels so the shoreline reads as clean organic clusters
    for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, n = water[i - 1] + water[i + 1] + water[i - W] + water[i + W];
      if (water[i] && n <= 1) water[i] = 0; else if (!water[i] && n >= 3) water[i] = 1;
    }
    // chamfer distance (in pixels) to the nearest pixel of the opposite kind
    function chamfer(isSource) {
      const D = new Float32Array(W * H), BIG = 1e5;
      for (let i = 0; i < W * H; i++) D[i] = isSource(i) ? 0 : BIG;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; let v = D[i];
        if (x > 0) v = Math.min(v, D[i - 1] + 3);
        if (y > 0) { v = Math.min(v, D[i - W] + 3); if (x > 0) v = Math.min(v, D[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, D[i - W + 1] + 4); }
        D[i] = v;
      }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x; let v = D[i];
        if (x < W - 1) v = Math.min(v, D[i + 1] + 3);
        if (y < H - 1) { v = Math.min(v, D[i + W] + 3); if (x < W - 1) v = Math.min(v, D[i + W + 1] + 4); if (x > 0) v = Math.min(v, D[i + W - 1] + 4); }
        D[i] = v;
      }
      for (let i = 0; i < W * H; i++) D[i] /= 3;
      return D;
    }
    const dToWater = chamfer(function (i) { return water[i] === 1; });   // meaningful on land
    const dToLand = chamfer(function (i) { return water[i] === 0; });    // meaningful on water
    const topEdge = new Int16Array(W).fill(-1), botEdge = new Int16Array(W).fill(-1);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (water[y * W + x]) { if (topEdge[x] < 0) topEdge[x] = y; botEdge[x] = y; }
    return { water: water, dToWater: dToWater, dToLand: dToLand, topEdge: topEdge, botEdge: botEdge };
  }

  // =====================================================================================================
  // Painting primitives: leaf masses, trunks, grass, ferns, stones
  // =====================================================================================================
  // A mass of foliage built from overlapping little round clusters, each lit from the upper left. `tones` is
  // dark -> light (5 tones). The scalloped silhouette and per-cluster highlights give the hand-placed look.
  function leafMass(L, cx, cy, rx, ry, tones, seed, o) {
    o = o || {};
    const r = rng(seed), T = tones.length;
    const n = o.count || Math.max(4, Math.round(rx * ry / (o.area || 20)));
    const rmin = o.rmin || 3, rmax = o.rmax || 6, blobs = [];
    for (let i = 0; i < n; i++) { const a = r() * 6.2832, d = Math.sqrt(r()); blobs.push({ x: cx + Math.cos(a) * d * rx, y: cy + Math.sin(a) * d * ry, r: rmin + r() * (rmax - rmin) }); }
    blobs.sort(function (a, b) { return a.y - b.y; });
    blobs.forEach(function (b) {
      const R = Math.ceil(b.r), bx = Math.round(b.x), by = Math.round(b.y);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const dd = dx * dx + dy * dy; if (dd > b.r * b.r) continue;
        const nd = Math.sqrt(dd) / b.r;
        let s = (-dx * 0.5 - dy * 0.85) / b.r + (vnoise((bx + dx) * 0.7, (by + dy) * 0.7, seed) - 0.5) * 0.55;
        s += ((cy - (by + dy)) / Math.max(1, ry)) * (o.top === undefined ? 0.3 : o.top);
        let idx = s > 0.55 ? T - 1 : s > 0.18 ? T - 2 : s > -0.28 ? T - 3 : T - 4;
        if (nd > 0.78 && s < -0.12) idx = 0;
        put(L, bx + dx, by + dy, tones[Math.max(0, idx)]);
      }
      put(L, bx - Math.round(b.r * 0.35), by - Math.round(b.r * 0.55), tones[T - 1]);
    });
  }

  // A tree trunk: lit left edge, shaded right side, bark streaks, root flare and moss at the foot.
  function trunk(L, x0, y0, y1, w, lean, seed) {
    const r = rng(seed);
    for (let y = y0; y <= y1; y++) {
      const f = (y - y0) / Math.max(1, y1 - y0), fromFoot = y1 - y;
      const flare = fromFoot < 7 ? Math.round(Math.pow((7 - fromFoot) / 7, 2) * (w * 0.55 + 1)) : 0;
      const left = Math.round(x0 + lean * f + Math.sin(y * 0.13 + seed) * 0.8) - flare;
      const width = w + flare * 2;
      for (let k = 0; k < width; k++) {
        let t;
        if (k === 0) t = 4; else if (k === 1 && width > 4) t = 3; else if (k >= width - 1) t = 0; else if (k >= width - 2 && width > 4) t = 1; else t = 2;
        const streak = vnoise(k * 1.7 + seed, y * 0.35, seed + 3);
        if (t === 2 && streak > 0.68) t = 3; else if (t === 2 && streak < 0.22) t = 1; else if (t === 3 && streak < 0.2) t = 2;
        if (r() < 0.025 && t > 0 && t < 4) t -= 1;
        let c = BARK[t];
        if (fromFoot < 14 && k < width * 0.55 && fbm(k * 0.9, y * 0.5, seed + 5) > 0.5 + fromFoot * 0.012) c = MOSS[clamp(t === 4 ? 3 : t === 3 ? 2 : 1, 0, 4)];
        put(L, left + k, y, c);
      }
    }
  }

  function tuft(L, x, y, h, tones, seed, lean) {
    const r = rng(seed), n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const bx = x + Math.round((i - (n - 1) / 2) * 1.5 + (r() - 0.5)), bh = Math.max(3, Math.round(h * (0.55 + r() * 0.45)));
      const dir = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.9) + (lean || 0);
      for (let t = 0; t < bh; t++) {
        const f = t / bh;
        put(L, bx + Math.round(dir * f * f * 3), y - t, tones[Math.min(tones.length - 1, Math.floor(f * tones.length))]);
      }
    }
  }

  // An arching fern frond: curved stem with paired leaflets that shorten toward the tip.
  function fern(L, x, y, len, dir, tones, seed) {
    const T = tones.length;
    for (let t = 0; t <= len; t++) {
      const f = t / len;
      const px = x + dir * (t * t) / (len * 1.15), py = y - t + (t * t) / (len * 3.3);
      put(L, px, py, tones[1]);
      if (t >= 3 && t % 2 === 1) {
        const size = Math.max(1, Math.round((len * 0.28) * Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.95 + 0.05)), 0.8)));
        for (let k = 1; k <= size; k++) {
          const lift = k * 0.45, droop = f > 0.4 ? k * 0.25 : 0;
          const tone = tones[k === size ? T - 1 : (k > size / 2 ? T - 2 : 2)];
          put(L, px - k, py - lift + droop, tone);
          put(L, px + k, py - lift + droop, tones[Math.max(1, (k === size ? T - 1 : T - 3))]);
        }
      }
    }
  }

  // A rounded stone resting on the ground at baseline cy: lit top-left, shaded base, cracks, optional moss cap.
  function stone(L, cx, cy, w, h, seed, moss) {
    const r = rng(seed);
    for (let dy = -h; dy <= 0; dy++) for (let dx = -Math.ceil(w / 2) - 1; dx <= Math.ceil(w / 2) + 1; dx++) {
      const ex = dx / (w / 2 + 0.3), ey = dy / (h + 0.3);
      const edge = ex * ex + ey * ey + (vnoise(dx * 0.6 + seed, dy * 0.6, seed) - 0.5) * 0.28;
      if (edge > 1) continue;
      let s = (-dx / (w / 2)) * 0.5 + (dy / h) * -0.1 - (dy / h) * 0 + (-(dy + h * 0.5) / h) * -0.0;
      s = -ex * 0.45 + (-ey) * 0.0 + (ey < -0.1 ? 0.35 : -0.35) + (-ey * 0.0);
      s += (vnoise(dx * 0.8 + 3, dy * 0.8 + seed, seed) - 0.5) * 0.35;
      let t = s > 0.45 ? 5 : s > 0.15 ? 4 : s > -0.15 ? 3 : s > -0.45 ? 2 : 1;
      if (edge > 0.82 && ex > 0.25) t = Math.min(t, 1);
      if (edge > 0.88 && ey > -0.3) t = 0;
      put(L, cx + dx, cy + dy, STONE[t]);
    }
    for (let i = 0; i < Math.ceil(w / 4); i++) { // small cracks
      const px = cx + Math.round((r() - 0.5) * w * 0.6), py = cy - Math.round(r() * h * 0.7);
      if (at(L, px, py)) { put(L, px, py, STONE[1]); if (r() < 0.6) put(L, px + 1, py + 1, STONE[1]); }
    }
    if (moss) for (let dx = -Math.ceil(w / 2); dx <= Math.ceil(w / 2); dx++) for (let dy = -h; dy <= -Math.round(h * 0.45); dy++) {
      const m = fbm((cx + dx) * 0.5, (cy + dy) * 0.6, seed + 9);
      if (at(L, cx + dx, cy + dy) && m > 0.48 + (dy + h) * 0.05) put(L, cx + dx, cy + dy, MOSS[clamp(Math.floor((m - 0.4) * 9) - ((dx > 1) ? 1 : 0), 0, 4)]);
    }
  }

  // =====================================================================================================
  // Layer painters
  // =====================================================================================================
  function paintBack(L) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = (x - 108) / 105, gy = (y - 26) / 36, glow = 1 - Math.sqrt(gx * gx + gy * gy * 1.3);
      const t = 2.3 + glow * 3.3 + (fbm(x * 0.055, y * 0.085, 3) - 0.5) * 1.5;
      let c = FAR[clamp(quant(t, x, y), 0, 6)];
      const gt = 3.0 + (fbm(x * 0.1, y * 0.17, 21) - 0.5) * 2.2;
      if (y >= 30 && bayer(x, y) < Math.min(1, (y - 30) / 9)) c = LEAF[clamp(quant(gt, x, y), 1, 5)];
      put(L, x, y, c);
    }
    const r = rng(41);
    for (let i = 0; i < 17; i++) { // far, hazy trunks
      const x = 6 + i * 11 + Math.round((r() - 0.5) * 7), w = 2 + (r() < 0.35 ? 1 : 0), top = 4 + Math.round(r() * 8);
      for (let y = top; y < 38; y++) {
        if (y < top + 10 && bayer(x, y) > (y - top) / 10) continue;
        for (let k = 0; k < w; k++) put(L, x + k + Math.round(Math.sin(y * 0.2 + i) * 0.6), y, k === 0 ? FAR[2] : FAR[1]);
      }
    }
    const far = [FAR[1], FAR[2], FAR[3], FAR[4], FAR[5]];
    for (let i = 0; i < 12; i++) leafMass(L, 8 + i * 16 + (r() - 0.5) * 8, 10 + r() * 7, 13, 6, far, 50 + i, { count: 7, rmin: 4, rmax: 7, top: 0.15 });
    for (let i = 0; i < 9; i++) leafMass(L, 6 + i * 22 + (r() - 0.5) * 10, 31 + r() * 3, 14, 4, far, 80 + i, { count: 6, rmin: 4, rmax: 7, top: 0.15 });
  }

  function paintTrees(L) {
    const r = rng(77);
    // near trunks: x, width, lean, foot y
    [[20, 7, -1, 47], [47, 5, 1, 42], [64, 3, 0, 40], [132, 5, -1, 40], [152, 6, 1, 45], [178, 8, 1, 50]].forEach(function (t, i) {
      trunk(L, t[0], 0, t[3], t[1], t[2], 100 + i);
      for (let k = 0; k < 3; k++) { const by = 6 + Math.round(r() * (t[3] - 14)); put(L, t[0] + 1, by, BARK[1]); put(L, t[0] + 2, by + 1, BARK[1]); }
    });
    const tones = [LEAF[0], LEAF[1], LEAF[3], LEAF[5], LEAF[7]];
    // canopy: heavy at the corners, broken in the middle so the glow shows through
    leafMass(L, 8, 4, 34, 17, tones, 201, { count: 34, rmin: 4, rmax: 8, top: 0.5 });
    leafMass(L, 52, -1, 30, 11, tones, 202, { count: 20, rmin: 4, rmax: 7, top: 0.5 });
    leafMass(L, 90, -3, 18, 6, tones, 203, { count: 9, rmin: 4, rmax: 6, top: 0.5 });
    leafMass(L, 128, -2, 24, 9, tones, 204, { count: 14, rmin: 4, rmax: 7, top: 0.5 });
    leafMass(L, 170, 3, 34, 16, tones, 205, { count: 32, rmin: 4, rmax: 8, top: 0.5 });
    leafMass(L, 36, 20, 12, 5, tones, 206, { count: 6, rmin: 3, rmax: 5, top: 0.3 });
    leafMass(L, 158, 21, 12, 5, tones, 207, { count: 6, rmin: 3, rmax: 5, top: 0.3 });
    leafMass(L, 112, 8, 8, 3, tones, 208, { count: 4, rmin: 3, rmax: 4, top: 0.3 });
  }

  function paintBank(L, geo) {
    const ground = [LEAF[2], LEAF[3], LEAF[4], LEAF[5], LEAF[6], LEAF[7]];
    // 1) ground cover: moss at the water, shadowed grass on the far bank, sunlit grass on the near bank
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (geo.water[i] || y < 22) continue;
      if (y < 31 && hash2(x, y, 9) * 0.7 + fbm(x * 0.2, y * 0.4, 5) * 0.3 > (y - 22) / 9) continue; // dithered fade into the hazy forest, no hard horizon
      const d = geo.dToWater[i], far = y < CY - 1;
      const n = fbm(x * 0.12, y * 0.2, 21), n2 = fbm(x * 0.2, y * 0.33, 33);
      let v = far ? 0.9 + n * 2.3 : 2.5 + n * 2.5 - Math.max(0, y - 82) * 0.1 - (d > 9 ? 0.5 : 0);
      if (!far && fbm(x * 0.05 + 4, y * 0.1, 8) > 0.64) v += 0.9;  // a few sunlit patches
      let c = ground[clamp(quant(v, x, y), 0, 5)];
      if (d <= 5.5 && n2 > 0.36 - (d < 3 ? 0.1 : 0)) c = MOSS[clamp(quant((far ? 0.8 : 1.9) + n2 * 2.8 - d * 0.1, x, y), 0, 4)];
      if (!far && y > 68 && d > 4 && fbm(x * 0.07, y * 0.13, 31) > 0.76) c = EARTH[clamp(quant(1 + n2 * 2.4, x, y), 0, 3)];
      if (d < 1.4) c = far ? LEAF[0] : (n2 > 0.5 ? EARTH[1] : MOSS[1]);
      else if (d < 2.4 && !far && n2 > 0.4) c = MOSS[3];
      put(L, x, y, c);
    }
    // 2) blade/leaf speckle so the ground has grain instead of flat noise
    const r = rng(311);
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(r() * W), y = 28 + Math.floor(r() * (H - 28)), c = at(L, x, y);
      if (!c || geo.water[y * W + x]) continue;
      const up = lighterOf[c];
      if (up && r() < 0.6) { put(L, x, y, up); if (r() < 0.55) put(L, x, y - 1, up); }
      else if (darkerOf[c]) put(L, x, y, darkerOf[c]);
    }
    // 3) far-bank bushes: dark, dense, tucked behind the shore
    const bush = [LEAF[0], LEAF[1], LEAF[2], LEAF[4], LEAF[6]];
    for (let x = 4, k = 0; x < W + 10; x += 8 + Math.floor(r() * 7), k++) {
      const te = geo.topEdge[clamp(x, 0, W - 1)], by = te > 0 ? te - 6 - r() * 4 : 40 + r() * 6;
      leafMass(L, x, by, 9 + r() * 5, 5, bush, 400 + k, { count: 9, rmin: 3, rmax: 7, top: 0.5 });
      if (te > 0) leafMass(L, x + 4, te - 2, 8, 2.5, bush, 450 + k, { count: 5, rmin: 3, rmax: 5, top: 0.6 });
    }
    // 4) far-bank ferns and grass leaning toward the water
    const fernT = [LEAF[1], LEAF[3], LEAF[4], LEAF[6], LEAF[8]];
    [[34, 47, -1], [57, 40, 1], [76, 38, -1], [118, 38, 1], [141, 41, -1], [160, 48, 1], [14, 62, 1], [176, 60, -1]].forEach(function (f, i) {
      fern(L, f[0], f[1], 9 + (i % 3) * 2, f[2], fernT, 500 + i);
    });
    const gt = [LEAF[2], LEAF[4], LEAF[6], LEAF[8]];
    for (let x = 30; x < 166; x += 6 + Math.floor(r() * 7)) {
      const te = geo.topEdge[x]; if (te < 0) continue;
      tuft(L, x, te - 1, 5 + Math.floor(r() * 4), gt, 600 + x, 0);
    }
    // 5) side lands (left and right of the pond): bushes, tufts
    [[8, 58], [20, 66], [178, 64], [186, 54], [168, 72], [6, 74]].forEach(function (p, i) {
      leafMass(L, p[0], p[1], 8, 4, [LEAF[1], LEAF[2], LEAF[4], LEAF[5], LEAF[7]], 700 + i, { count: 6, rmin: 3, rmax: 5, top: 0.4 });
    });
    // 6) bank flowers: a few, muted, near the lit ground
    const fc = [BLOOM_WHITE, FLOWER_CREAM, FLOWER_LAV, FLOWER_BLUE, BLOOM_GOLD, FLOWER_LAV];
    for (let i = 0; i < 14; i++) {
      const x = 8 + Math.floor(r() * 176), y = 74 + Math.floor(r() * 18);
      if (geo.water[y * W + x] || geo.dToWater[y * W + x] < 3) continue;
      put(L, x, y, fc[i % fc.length]); put(L, x, y + 1, LEAF[3]);
    }
  }

  function paintLightShafts(layers, geo) {
    // soft light from the upper left: lift each colour one tone inside slanted bands, dithered at the borders
    [[44, 7], [86, 9], [124, 6]].forEach(function (s, k) {
      for (let y = 0; y < 62; y++) for (let x = 0; x < W; x++) {
        const xc = s[0] + 0.36 * y, hw = s[1] + y * 0.07, dx = Math.abs(x - xc);
        if (dx > hw) continue;
        const f = (1 - dx / hw) * (1 - y / 62) * (k === 1 ? 1 : 0.75);
        if (bayer(x, y) > f * 1.15) continue;
        for (let i = layers.length - 1; i >= 0; i--) {
          const c = at(layers[i], x, y);
          if (c) { if (lighterOf[c] && !(layers[i].name === 'trees' && y < 24)) put(layers[i], x, y, lighterOf[c]); break; }
        }
      }
    });
  }

  function paintVignette(layers) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - CX) / 112, dy = (y - 52) / 66, v = dx * dx + dy * dy;
      if (v < 0.5) continue;
      if (bayer(x + 1, y + 2) > (v - 0.5) * 1.1) continue;
      for (let i = layers.length - 1; i >= 0; i--) { const c = at(layers[i], x, y); if (c) { if (darkerOf[c]) put(layers[i], x, y, darkerOf[c]); break; } }
    }
  }

  function paintWater(L, geo, below) {
    const r = rng(907);
    const baseIdx = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!geo.water[i]) continue;
      const te = geo.topEdge[x], be = geo.botEdge[x], dl = geo.dToLand[i];
      const depthT = (y - te) / Math.max(1, be - te);
      let v = 2.7 + 3.4 * Math.exp(-dl / 3.2) + (1 - depthT) * 0.35 + (fbm(x * 0.07, y * 0.2, 61) - 0.5) * 0.9;
      if (y > CY && dl < 4) v += 0.5;               // clear shallows near the viewer
      baseIdx[i] = v;
    }
    // reflections of the far shore: mirrored about the far shoreline, wobbled sideways, fading with distance
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!geo.water[i]) continue;
      const te = geo.topEdge[x], dy = y - te;
      let v = baseIdx[i];
      const reach = 21;
      if (dy < reach) {
        const wob = Math.round(Math.sin(y * 1.15 + x * 0.05) * (0.6 + dy * 0.12)), sx = clamp(x + wob, 0, W - 1);
        const src = topOf(below, sx, clamp(te - 1 - Math.round(dy * 0.95), 0, H - 1));
        if (src) {
          const target = 0.4 + lum(src) * 9.6, k = Math.pow(Math.max(0, 1 - dy / reach), 0.8) * 1.0;
          v = v + (target - v) * k;
        }
      }
      // near-shore darkening under the far bank, a soft pale haze mid-pond on the sunlit side
      if (dy < 2) v -= 0.8 - dy * 0.3;
      const hz = 1 - Math.sqrt(Math.pow((x - 112) / 34, 2) + Math.pow((y - 47) / 7, 2));
      if (hz > 0) v += hz * 0.9;
      // dark mirror of the near bank edge
      if (y > CY && geo.dToLand[i] < 2.2) v += 0.0;
      put(L, x, y, WATER[clamp(quant(v, x, y), 0, 9)]);
    }
    // submerged detail in the clear shallows: pebbles and a few water-weed strokes
    for (let n = 0; n < 70; n++) {
      const x = 10 + Math.floor(r() * 172), y = CY + 3 + Math.floor(r() * 20), i = y * W + x;
      if (!geo.water[i] || geo.dToLand[i] > 5 || y < CY) continue;
      const c = at(L, x, y);
      if (r() < 0.55) { put(L, x, y, WATER[clamp(WATER.indexOf(c) + 1, 0, 9)]); put(L, x + 1, y, WATER[clamp(WATER.indexOf(c) - 1, 0, 9)]); }
      else { put(L, x, y, WATER[2]); put(L, x, y - 1, WATER[3]); if (r() < 0.5) put(L, x + 1, y - 2, WATER[3]); }
    }
    // ripples: short pale dashes, longer toward the viewer
    const taken = [];
    function ripple(x, y, len) {
      for (let k = 0; k < len; k++) if (!geo.water[y * W + x + k]) return false;
      if (!geo.water[(y + 1) * W + x]) return false;
      for (let k = 0; k < taken.length; k++) if (Math.abs(taken[k][0] - x) < 11 && Math.abs(taken[k][1] - y) < 3) return false;
      taken.push([x, y]);
      for (let k = 0; k < len; k++) {
        const c = at(L, x + k, y), idx = WATER.indexOf(c);
        put(L, x + k, y, WATER[clamp(idx + (k === 0 || k === len - 1 ? 1 : 2), 0, 9)]);
      }
      const c2 = at(L, x + 1, y + 1); if (c2) put(L, x + 1, y + 1, WATER[clamp(WATER.indexOf(c2) - 1, 0, 9)]);
      return true;
    }
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 34; tries++) {
      const y = 41 + Math.floor(r() * 33), x = 22 + Math.floor(r() * 148);
      const len = 2 + Math.floor(((y - 40) / 34) * 4 + r() * 3);
      if (ripple(x, y, len)) placed++;
    }
    // glints on the sunlit side
    [[108, 46], [118, 49], [102, 51], [124, 53], [112, 44]].forEach(function (g) {
      if (!geo.water[g[1] * W + g[0]]) return;
      put(L, g[0], g[1], WATER[9]); put(L, g[0] + 1, g[1], WATER[8]);
      if ((g[0] + g[1]) % 2) put(L, g[0] - 1, g[1] + 1, WATER[8]);
    });
  }

  function lilyPad(L, geo, cx, cy, rx, ry, notchDir, seed) {
    const r = rng(seed);
    for (let dy = -ry - 1; dy <= ry + 2; dy++) for (let dx = -rx - 1; dx <= rx + 1; dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (vnoise(dx * 0.7 + seed, dy * 0.7, seed) - 0.5) * 0.18;
      const x = cx + dx, y = cy + dy; if (!geo.water[y * W + x]) continue;
      if (dy > 0 && d > 1 && d < 1.7 && dx * dx < rx * rx * 0.9 && dy <= ry + 1) { // soft shadow under the pad
        put(L, x, y, WATER[clamp(WATER.indexOf(at(L, x, y)) - 2, 0, 9)]); continue;
      }
      if (d > 1) continue;
      if (notchDir * dx > rx * 0.25 && Math.abs(dy) <= (notchDir * dx - rx * 0.25) * 0.28 + 0.2) continue; // the notch
      let t = 2;
      if (dy < -ry * 0.25 && dx < rx * 0.2) t = 3;
      if (d > 0.72 && dy > 0) t = 1;
      if (d > 0.72 && dy < 0 && dx < 0) t = 3;
      if (dx === -Math.round(rx * 0.4) && dy === -Math.round(ry * 0.4)) t = 4;
      put(L, x, y, PAD[t]);
    }
    if (rx >= 4) put(L, cx - Math.round(notchDir * 0.2), cy, PAD[1]); // central vein
    if (r() < 0) put(L, cx, cy, PAD[0]);
  }

  function lily(L, x, y) {
    const m = { w: BLOOM_WHITE, p: BLOOM_PINK, m: BLOOM_MAUVE, y: BLOOM_GOLD };
    stamp(L, x, y, ['..m.m..', '.mpwpm.', 'pwwywwp', '.mpwpm.', '..mmm..'].map(function (s) { return s; }), m);
  }

  function paintWaterPlants(L, geo) {
    lilyPad(L, geo, 112, 63, 6, 3, 1, 1);     // the wide, open pad right of centre (room for later life)
    lilyPad(L, geo, 82, 52, 4, 2, -1, 2);
    lilyPad(L, geo, 96, 68, 3, 2, 1, 3);
    lilyPad(L, geo, 56, 61, 4, 2, 1, 4);
    lilyPad(L, geo, 51, 63, 3, 1, -1, 5);
    lilyPad(L, geo, 140, 52, 4, 2, -1, 6);
    lilyPad(L, geo, 146, 56, 3, 1, 1, 7);
    lilyPad(L, geo, 68, 47, 3, 1, 1, 8);
    lilyPad(L, geo, 128, 68, 3, 1, -1, 9);
    lily(L, 79, 45);        // two lilies, kept small and quiet
    lily(L, 138, 46);
  }

  function paintStones(L, geo) {
    // far-bank and side stones
    stone(L, 38, 50, 11, 6, 11, true); stone(L, 44, 52, 6, 3, 12, false);
    stone(L, 150, 47, 9, 5, 13, true); stone(L, 156, 49, 5, 3, 14, false);
    stone(L, 124, 37, 7, 4, 15, true);
    stone(L, 17, 70, 12, 7, 16, true); stone(L, 26, 72, 6, 3, 17, false);
    stone(L, 176, 72, 11, 6, 18, true);
    // front-bank stones at the water's edge, one flat stepping stone just in the water
    stone(L, 86, 77, 13, 5, 19, true); stone(L, 94, 78, 6, 3, 20, false);
    stone(L, 132, 76, 9, 4, 21, true);
    stone(L, 64, 74, 7, 3, 22, false);
    // ripple rings where stones meet the water
    [[80, 77, 7], [92, 78, 5], [128, 76, 6], [34, 51, 6], [148, 48, 6]].forEach(function (p) {
      for (let k = 0; k < p[2]; k++) {
        const x = p[0] + k, y = p[1];
        if (geo.water[(y + 1) * W + x]) put(L, x, y + 1, (k % 3 === 1) ? WATER[7] : WATER[2]);
      }
    });
    // a mossy fallen log on the far bank (a quiet landmark, near the left of centre)
    const lx = 57, ly = 36, len = 25, th = 5;
    for (let k = 0; k < len; k++) {
      const x = lx + k, sag = Math.round(Math.sin(k / len * Math.PI) * -0.9) + Math.round(k * 0.03);
      for (let j = 0; j < th; j++) {
        const t = j === 0 ? 4 : j === 1 ? 3 : j === th - 1 ? 0 : j === th - 2 ? 1 : 2;
        const streak = vnoise(k * 0.5, j * 1.4, 71) > 0.66 ? 1 : 0;
        put(L, x, ly + j + sag, BARK[clamp(t - streak, 0, 5)]);
      }
      if (fbm(k * 0.4, 3, 72) > 0.42) { put(L, x, ly + sag, MOSS[3]); if (fbm(k * 0.4, 9, 73) > 0.46) put(L, x, ly + sag - 1, MOSS[2]); }
    }
    for (let j = 0; j < th; j++) { put(L, lx - 1, ly + j, BARK[j === 0 ? 3 : j === th - 1 ? 0 : 2]); put(L, lx, ly + j, j % 2 ? BARK[5] : BARK[4]); }
    put(L, lx + 6, ly - 1, BARK[2]); put(L, lx + 6, ly - 2, BARK[3]);
    stamp(L, lx + 15, ly - 2, ['.c.', 'ccc', '.s.'], { c: MUSH_CAP, s: MUSH_STEM });
  }

  function paintReeds(L, geo) {
    const r = rng(1201);
    function reedClump(x, y, n, seed) {
      const rr = rng(seed);
      for (let i = 0; i < n; i++) {
        const bx = x + Math.round((i - (n - 1) / 2) * 2.4 + (rr() - 0.5) * 1.5), h = 16 + Math.round(rr() * 10), dir = (rr() - 0.5) * 2.2;
        for (let t = 0; t < h; t++) {
          const px = bx + Math.round(dir * Math.pow(t / h, 2) * 3);
          put(L, px, y - t, t < 3 ? LEAF[1] : (t < h * 0.55 ? LEAF[3] : LEAF[5]));
        }
        if (i % 2 === 0) { // cattail head
          const px = bx + Math.round(dir * Math.pow((h - 6) / h, 2) * 3);
          for (let t = 0; t < 5; t++) { put(L, px, y - h + 5 - t, t === 0 || t === 4 ? CATTAIL[0] : CATTAIL[1]); if (t > 0 && t < 4) put(L, px + 1, y - h + 5 - t, CATTAIL[2]); }
          put(L, px, y - h - 1, LEAF[5]);
        }
      }
      for (let k = -4; k <= 4; k++) put(L, x + k, y + 1, WATER[1]);
    }
    reedClump(33, 56, 5, 1);
    reedClump(28, 61, 4, 2);
    reedClump(161, 54, 5, 3);
    reedClump(167, 58, 4, 4);
    reedClump(48, 41, 3, 5);
    reedClump(143, 40, 3, 6);
  }

  function paintForeground(L, geo) {
    const r = rng(1501);
    const gt = [LEAF[1], LEAF[3], LEAF[5], LEAF[7], LEAF[9]];
    // lip tufts overhanging the near shore
    for (let x = 34; x < 160; x += 5 + Math.floor(r() * 6)) {
      const be = geo.botEdge[x]; if (be < 0) continue;
      tuft(L, x, be + 3 + Math.floor(r() * 2), 4 + Math.floor(r() * 4), gt, 1600 + x, 0.2);
    }
    // central foreground: low, so the water above stays readable
    for (let x = 58; x < 138; x += 7 + Math.floor(r() * 7)) tuft(L, x, 88 + Math.floor(r() * 5), 5 + Math.floor(r() * 4), gt, 1700 + x, 0);
    // framing clusters at both sides: big ferns and tall grass climbing from below
    const fernT = [LEAF[1], LEAF[3], LEAF[5], LEAF[7], LEAF[9]];
    [[10, 92, 1, 17], [24, 96, -1, 14], [18, 100, 1, 13], [34, 94, 1, 11]].forEach(function (f, i) { fern(L, f[0], f[1], f[3], f[2], fernT, 1800 + i); });
    [[182, 92, -1, 17], [168, 96, 1, 14], [174, 100, -1, 13], [158, 94, -1, 11]].forEach(function (f, i) { fern(L, f[0], f[1], f[3], f[2], fernT, 1900 + i); });
    for (let i = 0; i < 6; i++) { tuft(L, 6 + i * 5, 94 + (i % 3), 12 + (i % 3) * 3, gt, 2000 + i, -0.3); tuft(L, 186 - i * 5, 94 + (i % 3), 12 + (i % 3) * 3, gt, 2100 + i, 0.3); }
    // bottom leaf rim (mostly out of frame, but closes the scene on tall boxes)
    leafMass(L, 30, 106, 40, 5, [LEAF[0], LEAF[1], LEAF[2], LEAF[4], LEAF[5]], 2200, { count: 20, rmin: 4, rmax: 7, top: 0.2 });
    leafMass(L, 162, 106, 40, 5, [LEAF[0], LEAF[1], LEAF[2], LEAF[4], LEAF[5]], 2201, { count: 20, rmin: 4, rmax: 7, top: 0.2 });
    leafMass(L, 96, 108, 30, 3, [LEAF[0], LEAF[1], LEAF[2], LEAF[3], LEAF[4]], 2202, { count: 10, rmin: 3, rmax: 6, top: 0.2 });
    // tiny flowers in the foreground grass
    const fc = [BLOOM_WHITE, FLOWER_LAV, BLOOM_GOLD, FLOWER_CREAM, FLOWER_BLUE];
    for (let i = 0; i < 8; i++) { const x = 52 + Math.floor(r() * 92), y = 84 + Math.floor(r() * 8); put(L, x, y, fc[i % fc.length]); put(L, x, y + 1, LEAF[4]); }
  }

  // =====================================================================================================
  // Build the manifest parts from the layers (each layer -> one cropped frame with its own palette)
  // =====================================================================================================
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEF';
  function toPack(layers) {
    const palettes = {}, frames = {}, placed = [];
    layers.forEach(function (L) {
      let x0 = W, y0 = H, x1 = -1, y1 = -1; const used = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = L.g[y * W + x]; if (!c) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (used.indexOf(c) < 0) used.push(c);
      }
      if (x1 < 0) return;
      if (used.length > CHARS.length) throw new Error('layer "' + L.name + '" uses ' + used.length + ' colours (max ' + CHARS.length + ')');
      const pal = {}, map = {};
      used.sort(function (a, b) { return a - b; }).forEach(function (c, i) { pal[CHARS.charAt(i)] = COL[c]; map[c] = CHARS.charAt(i); });
      const rows = [];
      for (let y = y0; y <= y1; y++) { let s = ''; for (let x = x0; x <= x1; x++) { const c = L.g[y * W + x]; s += c ? map[c] : '.'; } rows.push(s); }
      palettes['p_' + L.name] = pal;
      frames['f_' + L.name] = { size: { w: x1 - x0 + 1, h: y1 - y0 + 1 }, palette: 'p_' + L.name, rows: rows };
      placed.push({ frame: 'f_' + L.name, x: x0, y: y0 });
    });
    return { palettes: palettes, frames: frames, layers: placed };
  }

    // =====================================================================================================
  // SIDE-VIEW (eye-level) POND — scene 256x144. Land on the left third sloping down into the water; water
  // fills the rest. The bank continues underwater so the pond is seen in section: surface, ripples, reflections,
  // lily pads on the surface, the soil slope, weeds and stones below.
  // =====================================================================================================
      const SURF = 80;                                   // y of the water surface
  const UW  = ramp(['#102a30', '#17363c', '#20444a', '#2c5559', '#3b6a66', '#528379']);   // soil seen through water
  const UWG = ramp(['#2b5b47', '#3a7355', '#4f8c5f']);                                    // underwater green
  const PADS = [[170, 44], [124, 22], [214, 26], [142, 12]];                                // pad centre x, width
  function groundY(x) {   // soil surface: gentle on land, steepening under the water
    const n = (fbm(x * 0.08, 3, 4) - 0.5) * 3;
            const y = x <= 80 ? 66 + 14 * Math.pow(x / 80, 1.7)
    return Math.round(y + n);
  }
  function surfY(x) { return SURF + Math.round(Math.sin(x * 0.085) * 0.9 + Math.sin(x * 0.21 + 1.3) * 0.6); }

  function sideBack(L) {
    const r = rng(2101);
    for (let y = 0; y <= SURF + 2; y++) for (let x = 0; x < W; x++) {
      const gx = (x - 176) / 150, gy = (y - 34) / 50, glow = 1 - Math.sqrt(gx * gx + gy * gy);
      const t = 1.3 + glow * 2.8 + (fbm(x * 0.05, y * 0.08, 3) - 0.5) * 1.6;
      put(L, x, y, FAR[clamp(quant(t, x, y), 0, 6)]);
    }
    for (let i = 0; i < 22; i++) { // far hazy trunks
      const x = 4 + i * 12 + Math.round((r() - 0.5) * 8), top = 2 + Math.round(r() * 10), w = 2 + (r() < 0.3 ? 1 : 0);
      for (let y = top; y < SURF - 2; y++) {
        if (y < top + 12 && bayer(x, y) > (y - top) / 12) continue;
        for (let k = 0; k < w; k++) put(L, x + k + Math.round(Math.sin(y * 0.2 + i) * 0.6), y, k === 0 ? FAR[2] : FAR[1]);
      }
    }
    const far = [FAR[0], FAR[1], FAR[2], FAR[3], FAR[4]];
    for (let i = 0; i < 16; i++) leafMass(L, 6 + i * 17 + (r() - 0.5) * 8, 14 + r() * 8, 14, 7, far, 2110 + i, { count: 8, rmin: 4, rmax: 8, top: 0.15 });
    for (let x = 84; x < W + 10; x += 9) leafMass(L, x, SURF - 8 - r() * 4, 10, 5, far, 2140 + x, { count: 6, rmin: 4, rmax: 7, top: 0.2 }); // far shore line
    for (let x = 84; x < W; x++) for (let y = SURF - 3; y <= SURF + 1; y++) put(L, x, y, FAR[1 + Math.floor(hash2(x, y, 5) * 2)]); // far bank at the waterline
  }

  function sideTrees(L) {
    [[24, 9, -1, 11], [52, 5, 1, 12]].forEach(function (t, i) { trunk(L, t[0], 0, groundY(t[0]) + 1, t[1], t[2], 2200 + i); });
    const tones = [LEAF[0], LEAF[1], LEAF[3], LEAF[5], LEAF[7]];
    leafMass(L, 14, 6, 38, 18, tones, 2210, { count: 40, rmin: 4, rmax: 8, top: 0.5 });
    leafMass(L, 64, -1, 30, 11, tones, 2211, { count: 20, rmin: 4, rmax: 7, top: 0.5 });
    leafMass(L, 110, -3, 22, 7, tones, 2212, { count: 10, rmin: 4, rmax: 6, top: 0.5 });
    leafMass(L, 160, -2, 26, 8, tones, 2213, { count: 12, rmin: 4, rmax: 6, top: 0.5 });
    leafMass(L, 226, 1, 40, 12, tones, 2214, { count: 22, rmin: 4, rmax: 8, top: 0.5 });
    leafMass(L, 44, 24, 12, 5, tones, 2215, { count: 6, rmin: 3, rmax: 5, top: 0.3 });
  }

  function soilStone(L, cx, cy, rx, ry, under, seed) {
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (vnoise(dx * 0.7 + seed, dy * 0.7, seed) - 0.5) * 0.3;
      if (e > 1 || cy + dy < groundY(cx + dx) + 3) continue;
      const s = -dx / rx * 0.5 - dy / ry * 0.5 + (vnoise(dx, dy, seed + 1) - 0.5) * 0.4;
      const t = s > 0.35 ? 4 : s > 0 ? 3 : s > -0.35 ? 2 : 1;
      put(L, cx + dx, cy + dy, under ? UW[Math.min(5, t + 1)] : STONE[t]);
    }
  }

  function sideGround(L) {
    const r = rng(2301);
    for (let x = 0; x < W; x++) {
      const gy = groundY(x); if (gy >= H) continue;
      const cap = 2 + Math.round(fbm(x * 0.22, 2, 8) * 3);
      for (let y = gy; y < H; y++) {
        const dep = y - gy, under = gy > SURF + 1;   // this column's top is under the water: only its skin is tinted, the cut soil below stays earth
        const n = fbm(x * 0.09, y * 0.12, 17), strata = Math.sin(dep * 0.5 + x * 0.04 + n * 3) * 0.5;
        let c;
        if (!under) {
          if (dep < cap) c = dep === 0 ? (n > 0.5 ? LEAF[8] : LEAF[7]) : dep === 1 ? (hash2(x, y, 3) < 0.3 ? MOSS[3] : LEAF[5]) : LEAF[3];
          else c = EARTH[clamp(quant(2.4 - dep * 0.03 + n * 1.6 + strata * 0.6, x, y), 0, 3)];
        } else if (dep < 2) c = UWG[dep === 0 ? 2 : 1];
        else if (dep < 5) c = UW[clamp(quant(3.4 + n * 1.5 + strata * 0.4 - dep * 0.25 - (y - SURF) * 0.012, x, y), 0, 5)];
        else c = EARTH[clamp(quant(1.9 - dep * 0.03 + n * 1.5 + strata * 0.5, x, y), 0, 3)];
        put(L, x, y, c);
      }
    }
    for (let i = 0; i < 7; i++) { // roots hanging in the soil
      const x0 = 4 + Math.floor(r() * 68), y0 = groundY(x0) + 5, len = 8 + Math.floor(r() * 9);
      for (let t = 0; t < len; t++) put(L, x0 + Math.round(Math.sin(t * 0.5 + i) * 1.4), y0 + t, t > len - 4 ? BARK[1] : BARK[2]);
    }
    [[18, 78, 6, 3, 0], [40, 90, 8, 4, 0], [60, 76, 5, 3, 0], [10, 112, 9, 5, 0], [30, 130, 10, 5, 0], [58, 120, 7, 4, 0],
     [104, 134, 6, 3, 0], [112, 142, 6, 3, 0]].forEach(function (s, i) { soilStone(L, s[0], s[1], s[2], s[3], !!s[4], 2400 + i); });
    for (let i = 0; i < 90; i++) { // pebbles and sediment glints on the underwater slope
      const x = 82 + Math.floor(r() * 36), gy = groundY(x), y = gy + 2 + Math.floor(r() * 4);
      if (y > SURF + 2 && y < H) { put(L, x, y, UW[5]); if (r() < 0.5) put(L, x + 1, y, UW[4]); }
    }
  }

  function sideWater(L, below) {
    const r = rng(2501);
    const bands = [[13, 1.6, 0.075, 0.6, 86], [26, 2.2, 0.06, 2.1, 98], [39, 2.6, 0.05, 4.0, 110]]; // the long ripple lines
    const shafts = [[118, 7], [150, 8], [190, 9], [236, 8]];
    for (let x = 0; x < W; x++) {
      const sy = surfY(x), gy = groundY(x);
      for (let y = sy; y < Math.min(gy, H); y++) {
        const d = y - sy, gd = gy - y;
        let v = 6.2 - Math.min(d, 74) * 0.065 + (fbm(x * 0.05, y * 0.09, 61) - 0.5) * 0.7;
        shafts.forEach(function (s) {
          const xc = s[0] - 0.45 * d, hw = s[1] + d * 0.09, dx = Math.abs(x - xc);
          if (dx < hw) v += (1 - dx / hw) * Math.max(0, 1 - d / 95) * 1.5;
        });
        if (gd < 6) v += (d < 24 ? 0.7 : -0.6) * (1 - gd / 6);
        if (d < 22) { // mirrored forest and pads, wobbled sideways, fading with depth
          const wob = Math.round(Math.sin(y * 1.1 + x * 0.06) * (0.5 + d * 0.07)), src = topOf(below, clamp(x + wob, 0, W - 1), clamp(sy - 1 - Math.round(d * 0.9), 0, H - 1));
          if (src) v += (0.4 + lum(src) * 9.6 - v) * Math.pow(1 - d / 22, 0.8) * 0.95;
        }
        bands.forEach(function (b) {
          if (x < b[4]) return;
          const fade = Math.min(1, (x - b[4]) / 16), yb = Math.round(SURF + b[0] + Math.sin(x * b[2] + b[3]) * b[1] * 2.2);
          if (y === yb) v += 1.9 * fade; else if (y === yb + 1) v -= 0.9 * fade;
        });
        if (d === 0) v = (x % 17 < 12) ? 8.4 : 7.2; else if (d === 1 && bayer(x, y) < 0.4) v = Math.max(v, 7);
        put(L, x, y, WATER[clamp(quant(v, x, y), 0, 9)]);
      }
    }
    for (let n = 0; n < 60; n++) { // short ripple dashes on and just under the surface
      const x = 82 + Math.floor(r() * 170), y = surfY(x) + 1 + Math.floor(r() * 5), len = 3 + Math.floor(r() * 6);
      for (let k = 0; k < len; k++) { const c = at(L, x + k, y); if (c) put(L, x + k, y, WATER[clamp(WATER.indexOf(c) + (k === 0 || k === len - 1 ? 1 : 2), 0, 9)]); }
    }
    PADS.forEach(function (p) { // little rings either side of each pad
      const sy = surfY(p[0]);
      for (let k = 2; k < 7; k++) { put(L, p[0] - p[1] / 2 - k, sy + 1, WATER[k % 2 ? 8 : 7]); put(L, p[0] + p[1] / 2 + k, sy + 1, WATER[k % 2 ? 8 : 7]); }
    });
    for (let x = 70; x < 100; x++) { // glints where the bank meets the surface
      const sy = surfY(x); if (groundY(x) >= sy && groundY(x) <= sy + 4 && at(L, x, sy)) put(L, x, sy, WATER[9]);
    }
    [[160, 5], [196, 6], [232, 4], [136, 8], [110, 5]].forEach(function (g) { if (at(L, g[0], surfY(g[0]) + g[1])) { put(L, g[0], surfY(g[0]) + g[1], WATER[9]); put(L, g[0] + 1, surfY(g[0]) + g[1], WATER[8]); } });
  }

  function sidePads(L) {
    PADS.forEach(function (p, i) {
      const cx = p[0], rx = Math.round(p[1] / 2), ry = Math.max(3, Math.round(p[1] / 9)), fy = surfY(cx) - 3;
      for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
        const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (vnoise(dx * 0.5 + i * 9, dy, 5) - 0.5) * 0.14;
        if (e > 1 || (dx > rx * 0.45 && Math.abs(dy) <= 0 && dx < rx * 0.95)) continue;
        let t = dy < -1 ? 4 : dy < 1 ? 3 : 2;
        if (dx % 6 === 0 && dy >= 0) t = 2;
        if (dx < -rx * 0.3 && dy < 0 && hash2(dx, dy, i) < 0.5) t = 4;
        put(L, cx + dx, fy + dy, PAD[t]);
      }
      for (let dx = -rx; dx <= rx; dx++) { // the pad's front rim, down to the water
        const yb = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx))));
        for (let y = fy + yb + 1; y <= fy + 3; y++) put(L, cx + dx, y, y === fy + 3 ? PAD[0] : PAD[1]);
      }
    });
    const m = { m: BLOOM_MAUVE, p: BLOOM_PINK, w: BLOOM_WHITE, y: BLOOM_GOLD };   // one small lily on the big pad
    stamp(L, 176, surfY(176) - 9, ['...m...', '..mpm..', '.mpwpm.', 'mpwywpm', '.mmwmm.'], m);
  }

  function sideRocks(L) {
    stone(L, 74, groundY(74) + 1, 13, 6, 2601, true); stone(L, 64, groundY(64) + 1, 8, 4, 2602, true); stone(L, 82, groundY(82) + 2, 6, 3, 2603, false);
  }

  function sidePlants(L) {
    const r = rng(2701), gt = [LEAF[2], LEAF[4], LEAF[6], LEAF[8]], bush = [LEAF[0], LEAF[1], LEAF[2], LEAF[4], LEAF[6]];
    const fernT = [LEAF[1], LEAF[3], LEAF[4], LEAF[6], LEAF[8]];
    for (let x = 1; x < 90; x += 3 + Math.floor(r() * 4)) {            // grass along the whole bank
      const tall = x > 6 && x < 24;
      tuft(L, x, groundY(x), (tall ? 14 : 6) + Math.floor(r() * (tall ? 14 : 7)), gt, 2710 + x, tall ? 0.1 : -0.2);
    }
    leafMass(L, 38, groundY(38) - 5, 11, 4, bush, 2720, { count: 8, rmin: 3, rmax: 6, top: 0.5 });
    leafMass(L, 58, groundY(58) - 5, 9, 4, bush, 2721, { count: 7, rmin: 3, rmax: 6, top: 0.5 });
    [[32, 1, 15], [48, -1, 13], [66, 1, 12]].forEach(function (f, i) { fern(L, f[0], groundY(f[0]), f[2], f[1], fernT, 2730 + i); });
    const fc = [BLOOM_WHITE, FLOWER_LAV, BLOOM_GOLD, FLOWER_CREAM, FLOWER_BLUE];
    for (let i = 0; i < 10; i++) { const x = 3 + Math.floor(r() * 66); put(L, x, groundY(x) - 2 - Math.floor(r() * 3), fc[i % fc.length]); }
    [[80, 5], [86, 4], [91, 3]].forEach(function (c, k) {              // reeds standing in the shallows
      for (let i = 0; i < c[1]; i++) {
        const bx = c[0] + Math.round((i - (c[1] - 1) / 2) * 2.3), base = groundY(bx) + 1, h = Math.min(base - SURF, 10) + 14 + Math.floor(r() * 10), dir = (r() - 0.5) * 2;
        for (let t = 0; t < h; t++) {
          const y = base - t, px = bx + Math.round(dir * Math.pow(t / h, 2) * 3);
          put(L, px, y, y > SURF ? UWG[t % 7 < 3 ? 0 : 1] : (t < h * 0.6 ? LEAF[3] : LEAF[5]));
        }
        if (i % 2 === 0) { const px = bx + Math.round(dir * Math.pow((h - 6) / h, 2) * 3); for (let t = 0; t < 5; t++) { put(L, px, base - h + 5 - t, t === 0 || t === 4 ? CATTAIL[0] : CATTAIL[1]); if (t > 0 && t < 4) put(L, px + 1, base - h + 5 - t, CATTAIL[2]); } }
      }
    });
    for (let n = 0; n < 9; n++) {                                        // weed strands waving on the underwater slope
      const x = 104 + Math.floor(r() * 12), base = groundY(x), len = 8 + Math.floor(r() * 9);
      for (let t = 0; t < len; t++) put(L, x + Math.round(Math.sin(t * 0.45 + n) * 1.6), base - t, UWG[t > len * 0.6 ? 2 : 1]);
    }
    PADS.forEach(function (p, i) {                                       // pad stems reaching down
      const len = 8 + (i % 3) * 5, sy = surfY(p[0]);
      for (let t = 1; t <= len; t++) put(L, p[0] - 3 + i + Math.round(Math.sin(t * 0.4 + i) * 1.2), sy + t, UWG[t > len - 3 ? 0 : 1]);
    });
  }

  function sideShafts(layers) {
    [[110, 9], [150, 10], [196, 9], [240, 8]].forEach(function (s, k) {
      for (let y = 0; y < SURF; y++) for (let x = 0; x < W; x++) {
        const xc = s[0] - 0.3 * y, hw = s[1] + y * 0.06, dx = Math.abs(x - xc);
        if (dx > hw) continue;
        const f = (1 - dx / hw) * (1 - y / SURF) * (k === 1 ? 1 : 0.75);
        if (bayer(x, y) > f * 1.15) continue;
        for (let i = layers.length - 1; i >= 0; i--) {
          const c = at(layers[i], x, y);
          if (c) { if (lighterOf[c] && !(layers[i].name === 'trees' && y < 24)) put(layers[i], x, y, lighterOf[c]); break; }
        }
      }
    });
  }

  function paintPond() {
    const back = makeLayer('back'), trees = makeLayer('trees'), ground = makeLayer('ground'), water = makeLayer('water'),
      rocks = makeLayer('rocks'), pads = makeLayer('pads'), plants = makeLayer('plants');
    sideBack(back); sideTrees(trees); sideGround(ground); sideRocks(rocks); sidePads(pads); sidePlants(plants);
    sideShafts([back, trees, ground]);
    sideWater(water, [back, trees, ground, rocks, pads, plants]);
    return toPack([back, trees, ground, water, rocks, pads, plants]);
  }

  // (previous top-down painter, no longer used)
  function paintPondTopDown() {
    const geo = buildGeometry();
    const back = makeLayer('back'), trees = makeLayer('trees'), bank = makeLayer('bank'), water = makeLayer('water'),
      stones = makeLayer('stones'), reeds = makeLayer('reeds'), fg = makeLayer('fg');
    paintBack(back);
    paintTrees(trees);
    paintBank(bank, geo);
    paintLightShafts([back, trees, bank], geo);
    paintVignette([back, trees, bank]);
    paintWater(water, geo, [back, trees, bank]);
    paintWaterPlants(water, geo);
    paintStones(stones, geo);
    paintReeds(reeds, geo);
    paintForeground(fg, geo);
    return toPack([back, trees, bank, water, stones, reeds, fg]);
  }

  // =====================================================================================================
  // The manifest
  // =====================================================================================================
  const pond = paintPond();
  const palettes = { base: { a: '#000000' } }, frames = { blank: { size: { w: 1, h: 1 }, palette: 'base', rows: ['.'] } };
  Object.keys(pond.palettes).forEach(function (k) { palettes[k] = pond.palettes[k]; });
  Object.keys(pond.frames).forEach(function (k) { frames[k] = pond.frames[k]; });

  const manifest = {
    format: 'lv-pack',
    category: 'dashboard-entity',
    manifestVersion: 1,
    engineVersion: 1,
    id: 'entity.lv1',
    name: 'LV1',
    version: '1.0.0',
    author: 'Lavender',
    description: 'Lavender\u2019s built-in Dashboard Entity.',
    palettes: palettes,
    frames: frames,
    animations: { still: { frames: ['blank'], frameMs: 1000, loop: true } },
    behaviors: { idle: { type: 'loop', animation: 'still' } },
    // Placeholder entity: invisible until the frog phase. The spec requires an entity, so one stays declared.
    entities: [{ id: 'placeholder', type: 'pixel-sprite', name: 'Placeholder', animations: ['still'], lifecycle: { onEnter: 'idle' } }],
    environments: [{ id: 'pond', type: 'pixel-scene', name: 'Pond', size: { w: W, h: H }, layers: pond.layers }],
    entry: { environment: 'pond', entity: 'placeholder' }
  };

  let registered = false;
  if (typeof EntityLVPackData !== 'undefined' && EntityLVPackData && typeof EntityLVPackData.registerBuiltin === 'function') {
    const r = EntityLVPackData.registerBuiltin(manifest);
    registered = !!(r && r.ok);
    if (!registered && typeof console !== 'undefined') console.error('[EntityLV1] could not register the built-in pack:', r && r.errors);
  } else if (typeof console !== 'undefined') {
    console.error('[EntityLV1] EntityLVPackData is not available; the built-in pack was not registered.');
  }

  return { id: manifest.id, isRegistered: function () { return registered; } };
})();
