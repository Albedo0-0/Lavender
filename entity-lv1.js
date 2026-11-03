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
// LAYERS (painter's order, back to front; the side-view pond that paintPond() builds):
//   back     mist and the glow behind the far bank (one smooth gradient, no halftone grain)
//   farther  farthest forest: pale ghost trunks and crowns
//   far      hazy trunks and crowns (the original positions)
//   mid      mid-distance undergrowth along the far bank, a low hedge behind the near bank, slim hazy trunks
//   trees    near trunks and the canopy that frames the top
//   ground   the land in section: turf, moss, mossy forest soil, set stones, roots
//   bed      the same section where it slopes under the water: algae skin, sediment, soil
//   water    depth colour, light shafts, mirrored scenery, ripples, glints, pad shadows
//   rocks    waterline stones and the small turf details (moss cushions, pebbles, toadstools)
//   pads     lily pads with veins and lit rims, the lily
//   plants   grass, bushes, ferns, bank flowers, reeds and cattails, weeds, pad stems
// Light comes from the upper right everywhere (glow, shafts and every lit edge agree).
// Geometry (groundY, surfY, SURF, PADS, trunk and canopy placements, reed and tuft positions) is unchanged.
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
  const BARK  = ramp(['#1a1813', '#292620', '#3a352b', '#4f4838', '#6a6048', '#8a7e5e']);
  const STONE = ramp(['#283135', '#38444a', '#4c585a', '#64706c', '#818b81', '#9fa797', '#bec2ad']);
  const MOSS  = ramp(['#25461f', '#356229', '#4a7e32', '#65993b', '#86b448', '#a8ce63']);
  const EARTH = ramp(['#15110c', '#241c13', '#372a1b', '#4d3a24']);
  const WATER = ramp(['#0c2531', '#11313f', '#173e4d', '#1f4e5b', '#2a6068', '#397472', '#4d8c7e', '#69a68b', '#8fc29e', '#bcdcb0']);
  const PAD   = ramp(['#143d2a', '#1e5434', '#2b6d3b', '#3e8744', '#58a24f', '#7fbd62', '#a5d67e']);
  const CATTAIL = ramp(['#2f2116', '#4f3623', '#7a5230', '#a07040']);
  const BLOOM_WHITE = col('#ece6dc'), BLOOM_PINK = col('#d8b6cc'), BLOOM_MAUVE = col('#b394b6'), BLOOM_GOLD = col('#e6c768');
  const FLOWER_LAV = col('#a99bd0'), FLOWER_CREAM = col('#ebe5cf'), FLOWER_BLUE = col('#86a4d2');
  const MUSH_CAP = col('#d9c9a8'), MUSH_STEM = col('#efe6d0');
  // --- pond ramps. Light comes from the upper right everywhere (the glow, the shafts and every lit edge agree).
  // Depth ramps run pale/cool (far) -> deep/saturated (near): atmospheric perspective lives in the palettes.
  const HAZE  = ramp(['#5f8872', '#729a7d', '#87aa89', '#9dbb95', '#b4cda2', '#cddeb0', '#e3eec4', '#f3f8d9']);   // forest mist and glow
  const FAR2  = ramp(['#55806f', '#648d7a', '#759d86', '#88ae92']);                                              // farthest crowns
  const FAR1  = ramp(['#3d6955', '#487862', '#558870', '#659a7b', '#78ac88', '#8dbd94']);                          // hazy trunks and crowns
  const MIDF  = ramp(['#16302a', '#1e3f33', '#27503b', '#326144', '#3f734c', '#508655']);                          // mid-distance undergrowth
  const SOILG = ramp(['#0b1611', '#111e17', '#18281d', '#213423', '#2c442b', '#3a5733', '#4a6b3b']);               // mossy forest soil
  const WDEEP = ramp(['#091a2c', '#0d2438', '#122f46', '#193c54', '#224b61']);                                    // deep water
  const WGREEN = ramp(['#12281f', '#1a3a2a', '#244d34', '#30613c', '#3f7845', '#559254', '#72ab63', '#95c47a']);   // reflected foliage
  const WSPARK = ramp(['#dff0c6', '#f3f9dc']);
    const DEW = col('#e6f4d0'), MUSH_RED = col('#b9736a');
  // --- open garden: muted sage ramps (dark -> light). Pale and cool in the distance, deeper and clearer near the water.
  const SAGE1 = ramp(['#8ea78c', '#9bb396', '#a8bfa1', '#b8cfb0', '#c8dcbf']);                                  // farthest rolling lawn
  const SAGE2 = ramp(['#56755a', '#648466', '#739473', '#82a280', '#93b28f', '#a5c19f']);                        // far hedges and lawn
  const SAGE3 = ramp(['#3b5139', '#476043', '#546f50', '#628060', '#729070', '#84a27c', '#98b48c']);             // mid lawn terrace
  const SAGE4 = ramp(['#1f3322', '#2a4430', '#365639', '#436646', '#527852', '#648f5f', '#7aa371']);             // low shrubs and the shore lip
  const PEBBLE = ramp(['#5d6a62', '#6e7b70', '#808d7e', '#939f8d', '#a6b19c', '#bac3ac']);                       // quiet garden stones

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
  // Colour helpers: snap a continuous colour onto a small ramp, step a colour along its ramp, tidy a layer
  // =====================================================================================================
  const RGBC = [];
  function rgbOf(id) { let v = RGBC[id]; if (!v) { const h = COL[id]; v = RGBC[id] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; } return v; }
  function snapTo(ids) {
    const pal = ids.map(rgbOf);
    return function (r, g, b) {
      let best = 0, bd = 1e12;
      for (let i = 0; i < pal.length; i++) { const p = pal[i], dr = r - p[0], dg = g - p[1], db = b - p[2], d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7; if (d < bd) { bd = d; best = i; } }
      return ids[best];
    };
  }
  function shade(c, n) { while (n > 0 && lighterOf[c]) { c = lighterOf[c]; n--; } while (n < 0 && darkerOf[c]) { c = darkerOf[c]; n++; } return c; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Hard-edged tone quantiser: flat tones, with a single-pixel checker seam only where two tones meet.
  function qh(v, x, y) { const b = Math.floor(v), f = v - b; if (f < 0.44) return b; if (f > 0.56) return b + 1; return ((x + y) & 1) ? b + 1 : b; }
  // An isolated pixel adopts its commonest neighbour, so tone fields read as clean clusters, not grain.
  function despeckle(L, x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = at(L, x, y); if (!c) continue;
      const nb = [at(L, x - 1, y), at(L, x + 1, y), at(L, x, y - 1), at(L, x, y + 1)];
      if (nb[0] === c || nb[1] === c || nb[2] === c || nb[3] === c) continue;
      let best = 0, bn = 0;
      for (let i = 0; i < 4; i++) { if (!nb[i]) continue; let n = 0; for (let j = 0; j < 4; j++) if (nb[j] === nb[i]) n++; if (n > bn) { bn = n; best = nb[i]; } }
      if (best && bn >= 2) put(L, x, y, best);
    }
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
  // A mass of foliage built from overlapping little round clusters, lit from the upper right. `tones` is dark ->
  // light. Each cluster has a lit crown, a shaded underside, a nibbled leafy rim, a few leaf-gap strokes and a
  // two-pixel highlight, so the mass reads as hand-placed leaves rather than a blob. Placement (the seeded
  // rng) is untouched, so every mass sits exactly where it always did.
  function leafMass(L, cx, cy, rx, ry, tones, seed, o) {
    o = o || {};
    const r = rng(seed), T = tones.length;
    const n = o.count || Math.max(4, Math.round(rx * ry / (o.area || 20)));
    const rmin = o.rmin || 3, rmax = o.rmax || 6, blobs = [];
    for (let i = 0; i < n; i++) { const a = r() * 6.2832, d = Math.sqrt(r()); blobs.push({ x: cx + Math.cos(a) * d * rx, y: cy + Math.sin(a) * d * ry, r: rmin + r() * (rmax - rmin) }); }
    blobs.sort(function (a, b) { return a.y - b.y; });
    const topK = o.top === undefined ? 0.3 : o.top;
    function tone(i) { return tones[Math.max(0, Math.min(T - 1, i))]; }
    blobs.forEach(function (b, bi) {
      const R = Math.ceil(b.r * 1.2) + 1, bx = Math.round(b.x), by = Math.round(b.y);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const X = bx + dx, Y = by + dy;
        const rr = b.r * (1 + (vnoise(X * 0.55, Y * 0.55, seed + 3) - 0.5) * 0.26), dd = dx * dx + dy * dy;
        if (dd > rr * rr) continue;
        const nd = Math.sqrt(dd) / rr;
        if (nd > 0.88 && dy > -rr * 0.3 && hash2(X, Y, seed + 5) < 0.12) continue;       // nibbled leaf rim
        let s = (dx * 0.55 - dy * 0.9) / rr;                                              // light from the upper right
        s += (vnoise(X * 0.5, Y * 0.5, seed) - 0.5) * 0.45;                              // leaf-clump variation
        s += ((cy - Y) / Math.max(1, ry)) * topK;
        let idx = s > 0.62 ? T - 1 : s > 0.28 ? T - 2 : s > -0.08 ? T - 3 : s > -0.45 ? T - 4 : T - 5;
        if (nd > 0.78 && s < 0.02) idx = 0;                                               // shaded rim
        put(L, X, Y, tone(idx));
      }
      for (let k = 0; k < 2; k++) {                                                       // leaf-gap strokes
        const gx = bx + Math.round((hash2(bi, k, seed) - 0.5) * b.r * 1.1), gy = by + Math.round(hash2(k, bi, seed + 1) * b.r * 0.6);
        if (at(L, gx, gy) && at(L, gx + 1, gy + 1)) { put(L, gx, gy, tone(Math.max(0, T - 5))); put(L, gx + 1, gy + 1, tone(Math.max(0, T - 5))); }
      }
      const hx = bx + Math.round(b.r * 0.35), hy = by - Math.round(b.r * 0.5);            // crown highlight
            put(L, hx, hy, tone(T - 1)); put(L, hx - 1, hy, tone(T - 2)); put(L, hx, hy + 1, tone(T - 2));
    });
    despeckle(L, Math.floor(cx - rx - rmax - 2), Math.floor(cy - ry - rmax - 2), Math.ceil(cx + rx + rmax + 2), Math.ceil(cy + ry + rmax + 2));
  }

  // A tree trunk: dark left edge, lit right edge, vertical bark ridges and cracks, moss on the shaded side,
  // root flare at the foot and (on the thick ones) a knot.
  function trunk(L, x0, y0, y1, w, lean, seed) {
    const r = rng(seed);
    for (let y = y0; y <= y1; y++) {
      const f = (y - y0) / Math.max(1, y1 - y0), fromFoot = y1 - y;
      const flare = fromFoot < 7 ? Math.round(Math.pow((7 - fromFoot) / 7, 2) * (w * 0.55 + 1)) : 0;
      const left = Math.round(x0 + lean * f + Math.sin(y * 0.13 + seed) * 0.8) - flare;
      const width = w + flare * 2;
      for (let k = 0; k < width; k++) {
        let t;
        if (k === 0) t = 0; else if (k === 1 && width > 4) t = 1; else if (k >= width - 1) t = 4; else if (k >= width - 2 && width > 4) t = 3; else t = 2;
        const ridge = vnoise(k * 1.9 + seed, y * 0.16, seed + 3);
        if (t === 2) { if (ridge > 0.66) t = 3; else if (ridge < 0.3) t = 1; } else if (t === 3 && ridge < 0.25) t = 2;
        if (t > 0 && t < 4 && k > 1 && k < width - 2 && (y & 3) < 3 && hash2(k + (y >> 2) * 7, y >> 2, seed) < 0.08) t = Math.max(0, t - 2);   // bark crack
        if (r() < 0.02 && t > 0 && t < 4) t -= 1;
        let c = BARK[t];
        const mossy = (fromFoot < 16 && k < width * 0.62 && fbm(k * 0.9, y * 0.5, seed + 5) > 0.5 + fromFoot * 0.012) || (k < width * 0.5 && fbm(k * 0.7, y * 0.12, seed + 9) > 0.74);
        if (mossy) c = MOSS[clamp(t + 1, 0, 5)];
        put(L, left + k, y, c);
      }
    }
    if (w >= 7) {                                                                          // a knot
      const ky = Math.round(y0 + (y1 - y0) * 0.42), kx = Math.round(x0 + lean * 0.42 + w * 0.45);
      put(L, kx, ky, BARK[0]); put(L, kx + 1, ky, BARK[1]); put(L, kx, ky + 1, BARK[0]); put(L, kx + 1, ky + 1, BARK[1]); put(L, kx, ky + 2, BARK[1]); put(L, kx + 2, ky, BARK[4]); put(L, kx + 1, ky - 1, BARK[3]);
    }
  }

  // A grass tuft: blades darken toward the root and brighten toward the tip, blades leaning to the lit side are
  // a tone brighter, the thick ones are two pixels wide at the base.
  function tuft(L, x, y, h, tones, seed, lean) {
    const r = rng(seed), n = 3 + Math.floor(r() * 3), T = tones.length;
    for (let i = 0; i < n; i++) {
      const bx = x + Math.round((i - (n - 1) / 2) * 1.5 + (r() - 0.5)), bh = Math.max(3, Math.round(h * (0.55 + r() * 0.45)));
      const dir = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.9) + (lean || 0);
      for (let t = 0; t < bh; t++) {
        const f = t / bh, px = bx + Math.round(dir * f * f * 3);
        const k = Math.min(T - 1, Math.floor(f * T) + (dir > 0 ? 1 : 0));
        put(L, px, y - t, tones[k]);
        if (bh > 8 && t < bh * 0.35) put(L, px + 1, y - t, tones[Math.max(0, k - 1)]);
      }
            // blade tip is already carried by the top tone of the blade itself
    }
  }

  // An arching fern frond: curved stem with paired leaflets that shorten toward the tip; the right (lit) leaflets
  // are brighter, the old leaflets near the base are darker.
  function fern(L, x, y, len, dir, tones, seed) {
    const T = tones.length;
    function tn(i) { return tones[Math.max(0, Math.min(T - 1, i))]; }
    let tipx = x, tipy = y;
    for (let t = 0; t <= len; t++) {
      const f = t / len;
      const px = x + dir * (t * t) / (len * 1.15), py = y - t + (t * t) / (len * 3.3);
      put(L, px, py, tn(f < 0.5 ? 1 : 2)); tipx = px; tipy = py;
      if (t >= 3 && t % 2 === 1) {
        const size = Math.max(1, Math.round((len * 0.28) * Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.95 + 0.05)), 0.8)));
        for (let k = 1; k <= size; k++) {
          const lift = k * 0.45, droop = f > 0.4 ? k * 0.25 : 0, old = f < 0.35 ? 1 : 0;
          put(L, px - k, py - lift + droop, tn((k === size ? T - 2 : (k > size / 2 ? T - 3 : 2)) - old));
          put(L, px + k, py - lift + droop, tn((k === size ? T - 1 : (k > size / 2 ? T - 2 : 3)) - old));
        }
      }
    }
    put(L, tipx, tipy - 1, tn(T - 1));
  }

  // A rounded stone resting on the ground at baseline cy: lit top/right, shaded left and base, facet noise,
  // cracks, lichen specks, an optional moss cap, a dark contact line and a wet lit rim.
  function stone(L, cx, cy, w, h, seed, moss) {
    const r = rng(seed);
    for (let dy = -h; dy <= 0; dy++) for (let dx = -Math.ceil(w / 2) - 1; dx <= Math.ceil(w / 2) + 1; dx++) {
      const ex = dx / (w / 2 + 0.3), ey = dy / (h + 0.3);
      const edge = ex * ex + ey * ey + (vnoise(dx * 0.6 + seed, dy * 0.6, seed) - 0.5) * 0.28;
      if (edge > 1) continue;
      let s = ex * 0.45 - ey * 0.55 - 0.18 + (vnoise(dx * 0.5 + seed, dy * 0.75, seed + 1) - 0.5) * 0.55;
      let t = s > 0.62 ? 5 : s > 0.36 ? 4 : s > 0.08 ? 3 : s > -0.22 ? 2 : 1;
      if (edge > 0.82 && ex < -0.2) t = Math.min(t, 1);
      if (edge > 0.82 && ey < -0.45 && ex > -0.3) t = 6;                                   // lit top edge
      if (edge > 0.88 && ey > -0.3) t = 0;
      put(L, cx + dx, cy + dy, STONE[t]);
    }
    for (let i = 0; i < Math.ceil(w / 4); i++) {                                            // cracks
      const px = cx + Math.round((r() - 0.5) * w * 0.6), py = cy - Math.round(r() * h * 0.7);
      if (at(L, px, py)) { put(L, px, py, STONE[0]); put(L, px - 1, py + 1, STONE[1]); if (r() < 0.6) put(L, px - 2, py + 2, STONE[1]); }
    }
    for (let i = 0; i < Math.ceil(w / 3); i++) {                                            // pale lichen specks
      const px = cx + Math.round((r() - 0.3) * w * 0.7), py = cy - Math.round(r() * h * 0.8);
      if (at(L, px, py) && at(L, px + 1, py)) put(L, px, py, STONE[5]);
    }
    if (moss) for (let dx = -Math.ceil(w / 2); dx <= Math.ceil(w / 2); dx++) for (let dy = -h; dy <= -Math.round(h * 0.4); dy++) {
      const m = fbm((cx + dx) * 0.5, (cy + dy) * 0.6, seed + 9);
      if (at(L, cx + dx, cy + dy) && m > 0.46 + (dy + h) * 0.05) put(L, cx + dx, cy + dy, MOSS[clamp(Math.floor((m - 0.38) * 9) + (dx > 1 ? 1 : 0) - (dy > -h * 0.6 ? 1 : 0), 0, 5)]);
    }
    for (let dx = -Math.floor(w / 2) + 1; dx < Math.floor(w / 2); dx++) if (at(L, cx + dx, cy) && (dx + seed) % 3 !== 0) put(L, cx + dx, cy + 1, STONE[0]);   // contact shadow
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
  const PADS = [[170, 14]];                                // pad centre x, width
  function groundY(x) {   // soil surface: gentle on land, steepening under the water
    const n = (fbm(x * 0.08, 3, 4) - 0.5) * 3;
                const y = x <= 80 ? 66 + 14 * Math.pow(x / 80, 1.7) + Math.sin(x * 0.21) * 0.9 : SURF + 76 * Math.pow((x - 80) / 34, 1.5);
    return Math.round(y + n);
  }
  function surfY(x) { return SURF + Math.round(Math.sin(x * 0.085) * 0.9 + Math.sin(x * 0.21 + 1.3) * 0.6); }

  // glow: the bright haze behind the far bank, upper right of centre (also where the shafts originate)
  function glowAt(x, y) { const gx = (x - 176) / 150, gy = (y - 34) / 50; return clamp(1 - Math.sqrt(gx * gx + gy * gy), -0.3, 1); }
  // lift a hazy layer toward the glow so the lit middle is airy and the edges recede
  function liftByGlow(L, k) {
    for (let y = 0; y <= SURF + 2; y++) for (let x = 0; x < W; x++) {
      const c = at(L, x, y); if (!c) continue;
      const n = Math.floor(clamp(glowAt(x, y), 0, 1) * k + (fbm(x * 0.06, y * 0.09, 77) - 0.5) * 0.8);
      if (n > 0) put(L, x, y, shade(c, n));
    }
  }

    // =====================================================================================================
  // Open garden background: layered sage lawns, trimmed hedges, low shrubs and a few quiet stones. Depth comes
  // from the layers themselves: pale and soft far away, deeper and crisper toward the water. Light is upper right.
  // =====================================================================================================
  function gRidge(x, base, amp, k) {
    return Math.round(base + Math.sin(x * 0.043 + k) * amp + Math.sin(x * 0.097 + k * 2.3) * amp * 0.45 + Math.sin(x * 0.017 + k * 0.7) * amp * 0.6);
  }
  // a rolling lawn strip: lit crest, flat body tones in clean contour bands, deeper toward the foot; slopes facing the light are a tone brighter
  function gTerrain(L, tones, top, bottom) {
    const T = tones.length;
    for (let x = 0; x < W; x++) {
      const t0 = top(x), lit = top(x + 1) > t0, shaded = top(x + 1) < t0;
      for (let y = t0; y <= bottom; y++) {
        const d = y - t0;
        const t = d === 0 ? (shaded ? T - 2 : T - 1) : d === 1 ? (lit ? T - 1 : T - 2) : d < 8 ? T - 3 : d < 15 ? T - 4 : T - 5;
        put(L, x, y, tones[clamp(t, 0, T - 1)]);
      }
    }
  }
  // a low, rounded shrub: lit upper right, shaded left and base, a bright rim and a few clipped-leaf gaps
  function gMound(L, cx, by, rx, ry, tones, seed) {
    const T = tones.length;
    for (let dy = -ry; dy <= 0; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const ex = dx / (rx + 0.4), ey = dy / (ry + 0.4), e = ex * ex + ey * ey;
      if (e > 1) continue;
      const s = ex * 0.5 - ey * 0.7 - 0.2 + (vnoise(dx * 0.45 + seed, dy * 0.6, seed) - 0.5) * 0.3;
      let t = s > 0.62 ? T - 1 : s > 0.32 ? T - 2 : s > 0.02 ? T - 3 : s > -0.3 ? T - 4 : T - 5;
      if (e > 0.78 && ex < -0.1) t = Math.min(t, T - 4);
      if (e > 0.78 && ey < -0.5 && ex > -0.2) t = T - 1;
      if (dy === 0) t = T - 5;
      put(L, cx + dx, by + dy, tones[clamp(t, 0, T - 1)]);
    }
    for (let k = 0; k < 2; k++) {
      const gx = cx + Math.round((hash2(seed, k, 3) - 0.5) * rx * 1.1), gy = by - 1 - Math.round(hash2(k, seed, 4) * ry * 0.6);
      if (at(L, gx, gy) && at(L, gx + 1, gy)) { put(L, gx, gy, tones[clamp(T - 4, 0, T - 1)]); put(L, gx + 1, gy, tones[clamp(T - 4, 0, T - 1)]); }
    }
  }
  // a clipped hedge row following the lawn crest: squared body, tapered ends, lit top, shaded foot
  function gHedgeRow(L, x0, x1, top, h, tones) {
    const T = tones.length, n = x1 - x0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + i, cap = Math.min(i, n - i), inset = cap === 0 ? 2 : cap === 1 ? 1 : 0, ty = top(x);
      for (let j = inset; j < h; j++) {
        const t = j === inset ? T - 1 : j === inset + 1 ? T - 2 : j < h - 2 ? T - 3 : T - 4;
        put(L, x, ty + j, tones[clamp(t, 0, T - 1)]);
      }
    }
  }
  // a neatly mown lawn patch: tapered ends, a lit rim, evenly alternating mowing stripes, a shaded foot
  function gLawn(L, x0, w, top, h, tones, stripe) {
    const T = tones.length;
    for (let i = 0; i < w; i++) {
      const edge = Math.min(i, w - 1 - i), inset = edge === 0 ? 2 : edge < 3 ? 1 : 0;
      for (let j = inset; j < h; j++) {
        const t = j === inset ? T - 1 : j === h - 1 ? T - 4 : ((Math.floor((x0 + i) / stripe) & 1) ? T - 2 : T - 3);
        put(L, x0 + i, top + j, tones[clamp(t, 0, T - 1)]);
      }
    }
  }
  // a smooth garden stone resting on the lawn: lit top and right, shaded left and base, soft contact shadow
  function gStone(L, cx, by, rx, ry, seed) {
    for (let dy = -ry; dy <= 0; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const ex = dx / (rx + 0.4), ey = dy / (ry + 0.4), e = ex * ex + ey * ey + (vnoise(dx * 0.6 + seed, dy * 0.8, seed) - 0.5) * 0.2;
      if (e > 1) continue;
      const s = ex * 0.45 - ey * 0.6 - 0.15 + (vnoise(dx * 0.5 + seed, dy * 0.7, seed + 1) - 0.5) * 0.3;
      let t = s > 0.55 ? 4 : s > 0.3 ? 3 : s > 0.02 ? 2 : s > -0.28 ? 1 : 0;
      if (e > 0.76 && ey < -0.4 && ex > -0.3) t = 5;
      if (dy === 0) t = Math.min(t, 1);
      put(L, cx + dx, by + dy, PEBBLE[t]);
    }
    for (let dx = -rx + 1; dx < rx; dx++) if (at(L, cx + dx, by)) put(L, cx + dx, by + 1, SAGE4[0]);
  }

  function sideBack(back, far2, far1, mid) {
    const r = rng(2101), rm = rng(2180);
    // 1) the sky and its haze: one open, airy glow with soft flat bands of mist (no halftone grain)
    for (let y = 0; y <= SURF + 2; y++) for (let x = 0; x < W; x++) {
      const t = 1.7 + clamp(y / 46, 0, 1) * 2.9 + glowAt(x, y) * 1.5 + (fbm(x * 0.02, y * 0.09, 3) - 0.5) * 0.7 + (fbm(x * 0.012, y * 0.22, 19) - 0.5) * 0.4;
      put(back, x, y, HAZE[clamp(Math.floor(t), 0, 7)]);
    }
    despeckle(back, 0, 0, W - 1, SURF + 2);
    // 2) the farthest lawn: a pale, soft ridge with a few distant shrub mounds
    gTerrain(far2, SAGE1, function (x) { return gRidge(x, 40, 3, 1.1); }, SURF + 1);
    for (let x = 9; x < W; x += 16 + Math.floor(r() * 10)) gMound(far2, x, gRidge(x, 40, 3, 1.1) + 2, 3 + Math.floor(r() * 3), 2 + Math.floor(r() * 2), SAGE1, 2160 + x);
    [[18, 42], [116, 140], [198, 226]].forEach(function (h) { gHedgeRow(far2, h[0], h[1], function (x) { return gRidge(x, 40, 3, 1.1) - 1; }, 5, SAGE1); });
    // 3) the far garden: a second ridge with trimmed hedge blocks and a few rounded shrubs
    gTerrain(far1, SAGE2, function (x) { return gRidge(x, 53, 3, 2.4); }, SURF + 1);
    [[3, 36], [90, 128], [146, 174], [194, 238]].forEach(function (h) {
      gHedgeRow(far1, h[0], h[1], function (x) { return gRidge(x, 53, 3, 2.4) - 2; }, 8, SAGE2.slice(0, 5));
    });
    [[66, 6, 4], [136, 6, 4], [184, 6, 4], [248, 6, 4]].forEach(function (m, i) {
      gMound(far1, m[0], gRidge(m[0], 53, 3, 2.4) + 5, m[1], m[2], SAGE2, 2110 + i);
    });
    // 4) the near lawn terrace: neatly mown patches, low shrubs, a quiet stone, and the lip along the far shore
    gTerrain(mid, SAGE3.slice(0, 6), function (x) { return gRidge(x, 65, 2.2, 3.9); }, SURF + 1);
    [[20, 30], [94, 34], [146, 30], [200, 40]].forEach(function (p) {
      gLawn(mid, p[0], p[1], gRidge(p[0] + (p[1] >> 1), 65, 2.2, 3.9) + 3, 6, SAGE3, 4);
    });
    [[8, 6, 4], [22, 8, 5], [44, 7, 4], [60, 8, 5], [76, 7, 4]].forEach(function (m, i) {    // low shrubs on the left bank, resting on the turf
      gMound(mid, m[0], groundY(m[0]) - 1, m[1], m[2], SAGE4, 3100 + i);
    });
    [[92, 5, 3], [127, 6, 4], [180, 5, 3], [233, 6, 4]].forEach(function (m, i) {
      gMound(mid, m[0], gRidge(m[0], 65, 2.2, 3.9) + 9, m[1], m[2], SAGE4, 3150 + i);
    });
    gStone(mid, 148, gRidge(148, 65, 2.2, 3.9) + 10, 3, 2, 3201);
    gStone(mid, 233, gRidge(233, 65, 2.2, 3.9) + 11, 4, 2, 3202);
    for (let x = 84; x < W; x++) for (let y = SURF - 2; y <= SURF + 1; y++) put(mid, x, y, y === SURF + 1 ? SAGE4[0] : y === SURF ? SAGE4[1] : y === SURF - 1 ? SAGE4[2] : SAGE4[3]);
    for (let x = 90; x < W - 4; x += 15 + Math.floor(rm() * 9)) tuft(mid, x, SURF - 3, 4, [SAGE4[3], SAGE4[4], SAGE4[5], SAGE4[6]], 3300 + x, 0);
  }

  function sideTrees(L) {
    // the nearest garden layer, sitting on the far shore: sparse, low shrubs and two quiet stones
    [[104, 8, 4], [142, 9, 5], [196, 8, 4], [238, 7, 4]].forEach(function (m, i) {
      gMound(L, m[0], SURF - 1, m[1], m[2], SAGE4, 2210 + i);
    });
    gStone(L, 124, SURF - 1, 5, 3, 2221);
    gStone(L, 216, SURF - 1, 4, 2, 2222);
  }

  // a stone set into the soil: lit upper right, dark outline against the earth, moss on top, lichen
  function soilStone(L, cx, cy, rx, ry, seed) {
    const inside = {};
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (vnoise(dx * 0.7 + seed, dy * 0.7, seed) - 0.5) * 0.3;
      if (e > 1 || cy + dy < groundY(cx + dx) + 3) continue;
      inside[(cx + dx) + ',' + (cy + dy)] = 1;
      const s = dx / rx * 0.5 - dy / ry * 0.5 + (vnoise(dx, dy, seed + 1) - 0.5) * 0.45;
      let t = s > 0.5 ? 5 : s > 0.22 ? 4 : s > -0.1 ? 3 : s > -0.4 ? 2 : 1;
      if (e > 0.8 && dx < 0 && dy > 0) t = Math.min(t, 1);
      put(L, cx + dx, cy + dy, STONE[t]);
      if (dy < -ry * 0.35 && fbm((cx + dx) * 0.5, (cy + dy) * 0.6, seed + 4) > 0.55) put(L, cx + dx, cy + dy, MOSS[clamp(Math.floor((fbm((cx + dx) * 0.5, (cy + dy) * 0.6, seed + 4) - 0.4) * 9), 1, 4)]);
    }
    Object.keys(inside).forEach(function (k) {                                                      // outline in the soil
      const p = k.split(','), x = +p[0], y = +p[1];
      [[-1, 0], [1, 0], [0, 1], [0, -1]].forEach(function (d) { if (!inside[(x + d[0]) + ',' + (y + d[1])]) put(L, x + d[0], y + d[1], (d[0] === 1 || d[1] === -1) ? SOILG[2] : SOILG[0]); });
    });
  }

  // a soft moss cushion or low mound sitting on the turf
  function cushion(L, cx, by, w) {
    for (let dx = -w; dx <= w; dx++) {
      const h = Math.max(1, Math.round(Math.sqrt(1 - (dx * dx) / (w * w + 1)) * (w * 0.55 + 0.6)));
      for (let t = 0; t < h; t++) put(L, cx + dx, by - t, MOSS[clamp((t === h - 1 ? 4 : t === 0 ? 2 : 3) + (dx > 0 ? 0 : -1) + (dx > w * 0.5 ? 1 : 0), 1, 5)]);
    }
  }

  function sideGround(L, B) {
    const r = rng(2301);
    for (let x = 0; x < W; x++) {
      const gy = groundY(x); if (gy >= H) continue;
      const under = gy > SURF + 1, D = under ? B : L;
      const cap = 2 + Math.round(fbm(x * 0.22, 2, 8) * 3);
      const drip = fbm(x * 0.4, 5, 12) > 0.6 ? 2 + Math.floor(fbm(x * 0.9, 1, 14) * 6) : 0;       // moss running down the face
      for (let y = gy; y < H; y++) {
        const dep = y - gy;
        const n = fbm(x * 0.09, y * 0.12, 17), n2 = fbm(x * 0.16 + 5, y * 0.2, 29), strata = Math.sin(dep * 0.55 + x * 0.035 + n * 3) * 0.5;
        let c;
        if (!under && dep < cap) c = dep === 0 ? (n > 0.55 ? LEAF[9] : LEAF[8]) : dep === 1 ? (fbm(x * 0.35, 3, 3) > 0.58 ? LEAF[7] : LEAF[6]) : dep === cap - 1 ? LEAF[3] : LEAF[dep === 2 ? 5 : 4];
        else if (!under && dep < cap + drip) c = dep - cap < drip - 1 ? LEAF[3] : LEAF[2];
        else if (under && dep < 2) c = UWG[dep === 0 ? 2 : 1];
        else if (under && dep < 5) c = UW[clamp(qh(3.4 + n * 1.5 + strata * 0.4 - dep * 0.25 - (y - SURF) * 0.012, x, y), 0, 5)];
        else {
          const v = 4.0 - dep * 0.024 + (n - 0.5) * 1.8 + strata * 1.25 + (x / 110) * 0.5 - Math.max(0, y - 100) * 0.014;
          c = SOILG[clamp(qh(v, x, y), 0, 6)];
          if (n2 > 0.72 && dep > 4) c = EARTH[clamp(qh(1.3 + (v - 2.6) * 0.8, x, y), 0, 3)];     // a few muted earthy pockets
          else if (dep < 20 && fbm(x * 0.12 + 3, y * 0.3, 41) > 0.72) c = LEAF[2 + (n2 > 0.5 ? 1 : 0)];   // mossy veins near the turf
          else if (Math.abs(strata) < 0.025 && fbm(x * 0.1, y * 0.4, 51) > 0.45) c = shade(c, 1);       // a lit seam between strata
        }
        put(D, x, y, c);
      }
    }
    despeckle(L, 0, 60, 112, H - 1); despeckle(B, 78, 78, 130, H - 1);
    for (let i = 0; i < 5; i++) {                                                                      // roots hanging in the soil
      const x0 = 4 + Math.floor(r() * 68), y0 = groundY(x0) + 5, len = 8 + Math.floor(r() * 9);
      for (let t = 0; t < len; t++) {
        const px = x0 + Math.round(Math.sin(t * 0.5 + i) * 1.4);
        put(L, px, y0 + t, t > len - 4 ? EARTH[2] : EARTH[3]); if (t < len * 0.6) put(L, px + 1, y0 + t, EARTH[2]);
        if (t % 4 === 2 && t < len - 3) { put(L, px + 1, y0 + t, EARTH[2]); put(L, px + 2, y0 + t + 1, EARTH[1]); }
      }
    }
    [[18, 78, 6, 3], [40, 90, 8, 4], [60, 76, 5, 3], [10, 112, 9, 5], [30, 130, 10, 5], [58, 120, 7, 4], [104, 134, 6, 3], [112, 142, 6, 3]]
      .forEach(function (s, i) { soilStone(s[0] < 81 ? L : B, s[0], s[1], s[2], s[3], 2400 + i); });
    for (let i = 0; i < 36; i++) {                                                                  // pebbles and sediment glints on the underwater slope
      const x = 82 + Math.floor(r() * 36), gy = groundY(x), y = gy + 2 + Math.floor(r() * 4);
      if (y > SURF + 2 && y < H) { put(B, x, y, UW[5]); if (r() < 0.5) put(B, x + 1, y, UW[4]); put(B, x, y + 1, UW[2]); }
    }
  }

  function sideRocks(L) {
    stone(L, 74, groundY(74) + 1, 13, 6, 2601, true); stone(L, 64, groundY(64) + 1, 8, 4, 2602, true); stone(L, 82, groundY(82) + 2, 6, 3, 2603, false);
  }

  // =====================================================================================================
  // Water: a continuous colour field (depth, light shafts, shallows, mirrored scenery) snapped onto the water
  // ramps, then hand-placed ripples, glints and shadows.
  // =====================================================================================================
  const WSTOPS = [[0, [116, 178, 150]], [5, [88, 154, 132]], [14, [58, 120, 114]], [30, [40, 90, 102]], [55, [27, 65, 88]], [90, [18, 46, 72]], [130, [12, 33, 58]]];
  function wcol(d) {
    if (d <= 0) return WSTOPS[0][1].slice();
    for (let i = 1; i < WSTOPS.length; i++) if (d <= WSTOPS[i][0]) { const a = WSTOPS[i - 1], b = WSTOPS[i], t = (d - a[0]) / (b[0] - a[0]); return [lerp(a[1][0], b[1][0], t), lerp(a[1][1], b[1][1], t), lerp(a[1][2], b[1][2], t)]; }
    return WSTOPS[WSTOPS.length - 1][1].slice();
  }
  const WSNAP = snapTo(WATER.concat(WDEEP, WGREEN));

  function sideWater(L, below) {
    const r = rng(2501);
    const bands = [];   // the long ripple lines
    const shafts = [[118, 7], [150, 8], [190, 9], [236, 8]];
    for (let x = 0; x < W; x++) {
      const sy = surfY(x), gy = groundY(x);
      for (let y = sy; y < Math.min(gy, H); y++) {
        const d = y - sy, gd = gy - y;
        const c = wcol(d + (fbm(x * 0.04, y * 0.07, 61) - 0.5) * 7), flow = (fbm(x * 0.05, y * 0.42, 83) - 0.5) * 6;
        c[0] += flow * 0.7; c[1] += flow; c[2] += flow * 0.8;
        let lk = 0;
        for (let s = 0; s < shafts.length; s++) { const xc = shafts[s][0] - 0.45 * d, hw = shafts[s][1] + d * 0.09, dx = Math.abs(x - xc); if (dx < hw) { const q = 1 - dx / hw; lk += q * q * Math.max(0, 1 - d / 95) * (0.55 + 0.9 * fbm(x * 0.05, y * 0.22, 91)); } }
        c[0] += 16 * lk; c[1] += 22 * lk; c[2] += 12 * lk;
        if (gd < 9) { const k = 1 - gd / 9; if (d < 26) { c[0] = lerp(c[0], 98, k * 0.3); c[1] = lerp(c[1], 146, k * 0.3); c[2] = lerp(c[2], 98, k * 0.3); } else { c[0] *= 1 - 0.25 * k; c[1] *= 1 - 0.25 * k; c[2] *= 1 - 0.2 * k; } }
        if (d < 24) {                                                                              // mirrored forest, bank and pads, wobbled sideways, fading with depth
          const wob = 0, src =topOf(below, clamp(x + wob, 0, W - 1), clamp(sy - 1 - Math.round(d * 0.9), 0, H - 1));
          if (src) {
            const p = rgbOf(src), k = Math.pow(1 - d / 24, 0.8) * 0.9;
            c[0] = lerp(c[0], p[0] * 0.72 + 10, k); c[1] = lerp(c[1], p[1] * 0.78 + 16, k); c[2] = lerp(c[2], p[2] * 0.8 + 24, k);
          }
        }
        put(L, x, y, WSNAP(c[0], c[1], c[2]));
      }
    }
    despeckle(L, 78, SURF - 3, W - 1, H - 1);
    bands.forEach(function (b, bi) {                                                                // long ripple lines: lit crest, shaded trough, broken by gaps
      for (let x = b[4]; x < W; x++) {
        if (vnoise(x * 0.11, bi * 7, 5) < 0.3) continue;
        const fade = Math.min(1, (x - b[4]) / 16), yb = Math.round(SURF + b[0] + Math.sin(x * b[2] + b[3]) * b[1] * 2.2);
        const c = at(L, x, yb); if (!c) continue;
        put(L, x, yb, shade(c, fade < 1 ? 1 : 2)); const c2 = at(L, x, yb + 1); if (c2) put(L, x, yb + 1, shade(c2, -1));
      }
    });
    for (let n = 0; n < 0; n++) {                                                                  // short ripple dashes on and just under the surface
      const x = 82 + Math.floor(r() * 170), y = surfY(x) + 1 + Math.floor(r() * 5), len = 3 + Math.floor(r() * 6);
      for (let k = 0; k < len; k++) { const c = at(L, x + k, y); if (c) put(L, x + k, y, shade(c, k === 0 || k === len - 1 ? 1 : 2)); }
    }
    const rw = rng(2550);
    for (let n = 0; n < 0; n++) {                                                                  // soft streaks of light and shade in the deeper water
      const x = 86 + Math.floor(rw() * 160), y = surfY(x) + 7 + Math.floor(rw() * 48), len = 5 + Math.floor(rw() * 9);
      for (let k = 0; k < len; k++) { const c = at(L, x + k, y); if (c) { put(L, x + k, y, shade(c, k === 0 || k === len - 1 ? 0 : 1)); const c2 = at(L, x + k + 1, y + 1); if (c2 && k < len - 1) put(L, x + k + 1, y + 1, shade(c2, -1)); } }
    }
    for (let x = 81; x < W; x++) {                                                                  // the surface: a bright broken line over a soft second row
      const sy = surfY(x), c = at(L, x, sy); if (!c) continue;
      put(L, x, sy, shade(c, 2));
      const c1 = at(L, x, sy + 1); if (c1) put(L, x, sy + 1, shade(c1, 1));
    }
    PADS.forEach(function (p) {                                                                     // shadow under each pad, then rings either side
      const sy = surfY(p[0]), rx = Math.round(p[1] / 2);
      for (let dy = 1; dy <= 3; dy++) for (let dx = -rx + dy; dx <= rx - dy; dx++) { const c = at(L, p[0] + dx, sy + dy); if (c) put(L, p[0] + dx, sy + dy, shade(c, dy === 1 ? -3 : -2)); }
      for (let k = 2; k < 2; k++) for (let sgn = -1; sgn <= 1; sgn += 2) { const x = p[0] + sgn * (rx + k), c = at(L, x, sy + 1); if (c) put(L, x, sy + 1, shade(c, k % 2 ? 2 : 1)); }
      for (let k = 4; k < 4; k++) for (let sgn = -1; sgn <= 1; sgn += 2) { const x = p[0] + sgn * (rx + k), c = at(L, x, sy + 2); if (c && k % 3) put(L, x, sy + 2, shade(c, 1)); }
    });
    for (let x = 70; x < 100; x++) { const sy = surfY(x); if (groundY(x) >= sy && groundY(x) <= sy + 4 && at(L, x, sy)) void 0;}   // glints where the bank meets the surface
[].forEach(function (g) {
      const y = surfY(g[0]) + g[1];
      if (at(L, g[0], y) && at(L, g[0] + 2, y)) { put(L, g[0], y, WSPARK[0]); put(L, g[0] + 1, y, WSPARK[1]); put(L, g[0] + 2, y, WSPARK[0]); }
    });
  }

  function sidePads(L) {
    const N = 7;
    PADS.forEach(function (p, i) {
      const cx = p[0], rx = Math.round(p[1] / 2), ry = Math.max(3, Math.round(p[1] / 9)), fy = surfY(cx) - 3;
      for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
        const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (vnoise(dx * 0.5 + i * 9, dy, 5) - 0.5) * 0.14;
        if (e > 1 || (dx > rx * 0.45 && Math.abs(dy) <= 0 && dx < rx * 0.95)) continue;
        const ndx = dx / rx, ndy = dy / ry;
        const s = -ndy * 0.5 + ndx * 0.38 + (vnoise(dx * 0.4 + i, dy * 0.9, 7) - 0.5) * 0.35;
        let t = s > 0.55 ? 5 : s > 0.3 ? 4 : s > 0.02 ? 3 : s > -0.3 ? 2 : 1;
        if (e > 0.7) t = dy <= 0 ? Math.min(6, t + 2) : Math.max(1, t - 1);                       // the far rim catches light, the near rim is shaded
        if (rx >= 6 && e < 0.9 && e > 0.06) {                                                       // radial veins
          const a = Math.atan2(ndy, ndx) / 6.2832 * N, fr = a - Math.floor(a);
          if (Math.abs(fr - 0.5) < 0.07) t = Math.max(1, t - 1);
        }
        put(L, cx + dx, fy + dy, PAD[t]);
      }
      for (let dx = -rx; dx <= rx; dx++) {                                                           // the pad's front rim, down to the water
        const yb = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx))));
        for (let y = fy + yb + 1; y <= fy + 3; y++) put(L, cx + dx, y, y === fy + 3 ? PAD[0] : (y === fy + yb + 1 && dx > rx * 0.1 ? PAD[2] : PAD[1]));
      }
      const rd = rng(5100 + i);                                                                      // dew drops
      for (let k = 0; k < Math.max(1, Math.round(rx / 6)); k++) { const dx = Math.round((rd() - 0.5) * rx * 1.2), dy = -Math.round(rd() * ry * 0.5); if (at(L, cx + dx, fy + dy) && !(dx > rx * 0.45)) put(L, cx + dx, fy + dy, PAD[6]); }
    });
    const m = { m: BLOOM_MAUVE, p: BLOOM_PINK, w: BLOOM_WHITE, y: BLOOM_GOLD, d: col('#8f7aa0') };   // one small lily on the big pad
    // a single small pad only; no bloom
  }

  function reedBlade(L, bx, base, h, dir, r) {
    for (let t = 0; t < h; t++) {
      const y = base - t, px = bx + Math.round(dir * Math.pow(t / h, 2) * 3);
      put(L, px, y, y > SURF ? UWG[t % 7 < 3 ? 0 : 1] : (t < h * 0.6 ? LEAF[3] : LEAF[5]));
      if (y <= SURF && t > 2 && t < h * 0.45) put(L, px + 1, y, LEAF[2]);                              // blade body, shaded side
    }
  }

  function sidePlants(L) {
    const r = rng(2701), gt = [LEAF[2], LEAF[4], LEAF[6], LEAF[8]], bush = [LEAF[0], LEAF[1], LEAF[2], LEAF[4], LEAF[6], LEAF[8]];
    const fernT = [LEAF[1], LEAF[3], LEAF[4], LEAF[6], LEAF[8]];
    for (let x = 1; x < 90; x += 3 + Math.floor(r() * 4)) {            // grass along the whole bank
      const tall = x > 6 && x < 24;
      tuft(L, x, groundY(x), (tall ? 8 : 5) + Math.floor(r() * (tall ? 5 : 4)), gt, 2710 + x, tall ? 0.1 : -0.2);
    }
    leafMass(L, 38, groundY(38) - 5, 11, 4, bush, 2720, { count: 8, rmin: 3, rmax: 6, top: 0.5 });
    leafMass(L, 58, groundY(58) - 5, 9, 4, bush, 2721, { count: 7, rmin: 3, rmax: 6, top: 0.5 });
    [[32, 1, 15], [48, -1, 13], [66, 1, 12]].forEach(function (f, i) { fern(L, f[0], groundY(f[0]), f[2], f[1], fernT, 2730 + i); });
    const fc = [BLOOM_WHITE, FLOWER_LAV, BLOOM_GOLD, FLOWER_CREAM, FLOWER_BLUE];
    for (let i = 0; i < 10; i++) {                                     // bank flowers on short stems
      const x = 3 + Math.floor(r() * 66), fy = groundY(x) - 2 - Math.floor(r() * 3);
      for (let y = fy + 1; y < groundY(x); y++) put(L, x, y, LEAF[4]);
      put(L, x, fy, fc[i % fc.length]); put(L, x - 1, fy + 1, LEAF[5]);
    }
    [[80, 5], [86, 4], [91, 3]].forEach(function (c, k) {              // reeds standing in the shallows
      for (let i = 0; i < c[1]; i++) {
        const bx = c[0] + Math.round((i - (c[1] - 1) / 2) * 2.3), base = groundY(bx) + 1, h = Math.min(base - SURF, 10) + 14 + Math.floor(r() * 10), dir = (r() - 0.5) * 2;
        reedBlade(L, bx, base, h, dir, r);
        if (i % 2 === 0) {                                              // cattail head: dark ends, brown body, lit right edge, thin tip
          const px = bx + Math.round(dir * Math.pow((h - 6) / h, 2) * 3);
          for (let t = 0; t < 5; t++) { put(L, px, base - h + 5 - t, t === 0 || t === 4 ? CATTAIL[0] : CATTAIL[1]); if (t > 0 && t < 4) { put(L, px + 1, base - h + 5 - t, t === 2 ? CATTAIL[3] : CATTAIL[2]); } }
          put(L, px, base - h, LEAF[5]); put(L, px, base - h - 1, LEAF[6]);
        }
      }
    });
    for (let n = 0; n < 9; n++) {                                       // weed strands waving on the underwater slope
      const x = 104 + Math.floor(r() * 12), base = groundY(x), len = 8 + Math.floor(r() * 9);
      for (let t = 0; t < len; t++) { const px = x + Math.round(Math.sin(t * 0.45 + n) * 1.6); put(L, px, base - t, UWG[t > len * 0.6 ? 2 : 1]); if (t % 3 === 1 && t < len - 2) put(L, px + 1, base - t, UWG[0]); }
    }
    PADS.forEach(function (p, i) {                                       // pad stems reaching down
      const len = 8 + (i % 3) * 5, sy = surfY(p[0]);
      for (let t = 1; t <= len; t++) put(L, p[0] - 3 + i + Math.round(Math.sin(t * 0.4 + i) * 1.2), sy + t, UWG[t > len - 3 ? 0 : 1]);
    });
  }

  function sideDetails(L) {
    // small natural details on the turf: moss cushions, clover, pebbles, a few toadstools (own rng; nothing above moves)
    const rs = rng(3300);
    for (let x = 4; x < 78; x += 7 + Math.floor(rs() * 6)) { const k = rs(); if (k < 0.4) cushion(L, x, groundY(x) - 1, 2 + Math.floor(rs() * 2)); else if (k < 0.75) stone(L, x, groundY(x) + 1, 3 + Math.floor(rs() * 3), 2, 3400 + x, k < 0.5); else { cushion(L, x, groundY(x) - 1, 2); } }
    [[30, 1], [45, 0]].forEach(function (m) { const x = m[0], y = groundY(x) - 1; stamp(L, x, y - 3, ['.cc.', 'cccc', '.ss.', '.ss.'], { c: m[1] ? MUSH_RED : MUSH_CAP, s: MUSH_STEM }); });
  }

  function sideShafts(layers) {
    [[72, 8], [110, 9], [150, 10], [196, 9], [240, 8]].forEach(function (s, k) {
      for (let y = 0; y < SURF; y++) for (let x = 0; x < W; x++) {
        const xc = s[0] - 0.3 * y, hw = s[1] + y * 0.06, dx = Math.abs(x - xc);
        if (dx > hw) continue;
        const f = (1 - dx / hw) * (1 - y / SURF) * (k === 2 ? 1 : 0.8) + (fbm(x * 0.1, y * 0.1, k + 40) - 0.5) * 0.18;
        if (f < 0.26) continue;
        for (let i = layers.length - 1; i >= 0; i--) {
          const c = at(layers[i], x, y);
          if (c) { if (lighterOf[c] && !(layers[i].name === 'trees' && y < 24)) put(layers[i], x, y, shade(c, f > 0.62 && layers[i].name !== 'plants' ? 2 : 1)); break; }
        }
      }
    });
  }

  function paintPond() {
    const back = makeLayer('back'), far = makeLayer('far'), farther = makeLayer('farther'), mid = makeLayer('mid'), trees = makeLayer('trees'),
      ground = makeLayer('ground'), bed = makeLayer('bed'), water = makeLayer('water'), rocks = makeLayer('rocks'), pads = makeLayer('pads'), plants = makeLayer('plants');
    sideBack(back, farther, far, mid); sideTrees(trees); sideGround(ground, bed); sideRocks(rocks); sideDetails(rocks); sidePads(pads); sidePlants(plants);
        sideShafts([farther, far, mid, trees, ground, plants]);
    sideWater(water, [back, farther, far, mid, trees, ground, bed, rocks, pads, plants]);
    return toPack([back, farther, far, mid, trees, ground, bed, water, rocks, pads, plants]);
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
