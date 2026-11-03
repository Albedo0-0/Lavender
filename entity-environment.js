// entity-environment.js — LV1-only optional environment module: ambient rain + real-time day/night lighting.
// Not part of the LV Pack format. It registers one session hook with EntityRenderer and acts ONLY when the
// built-in "entity.lv1" pack is the live session. Imported packs never touch this file; if it is missing or
// throws, the renderer and every other pack work unchanged.
//
// Integration: the renderer's per-session ctx (timers, frames, listeners, disposers) owns every resource, and its
// optional setOverlay() paint step draws on the renderer's existing canvas after the pond artwork. No second
// canvas exists. One scheduler drives everything: an animation frame loop only while it is raining and the page is
// visible, otherwise one slow timer. Rain schedule lives in memory only (nothing is stored); on resume the wall
// clock decides whether a rain event is due, and missed events are never replayed.
//
// Lighting is a continuous function of the device's local time (timezone and DST included), smoothly
// interpolated between keyframes with cubic Hermite curves, so there are no discrete presets or switches.
// Rain interacts with the scene instead of sitting on top of it: drops land on the water as soft, flattened ripples
// (perspective-scaled), tick the lily pad, leaves and stones as tiny splashes, and the whole scene responds (overcast, cooler,
// darker, softer contrast, calmer water tone). When it is not raining the water is perfectly still.
const EntityEnvironment = (function () {
  'use strict';

  const LV1_ID = 'entity.lv1';
  const MIN = 60000;
  const RAIN_MIN_MS = 21.5 * MIN, RAIN_VAR_MS = 9 * MIN;      // each event lasts 21.5 - 30.5 min (>= 20 continuous)
  const RAIN_GAP_MIN = 50, RAIN_GAP_VAR = 9;                   // next event starts 50 - 59 min after this one started (< 60)
  const RAMP_MS = 45000;                                       // gentle fade-in / fade-out of each event
  const MAX_DROPS = 84;
  const SLOW_TICK_MS = 20000;
    const FRAME_MS = 40;                                         // ~25 fps while animating
    // Fireflies: small, warm and unhurried. They are about from 19:00 until first light and are re-seeded without end.
    const FF_FROM_H = 19, FF_UNTIL_H = 5.5, FF_MAX = 16;
  const FF_ZONES = [                                           // fractions of the scene; z = depth (0 far .. 1 near); w = share of new fireflies
    { w: 0.26, x0: 0.62, x1: 0.97, y0: 0.20, y1: 0.50, z0: 0.15, z1: 0.75 },   // beneath the right-side tree
    { w: 0.30, x0: 0.36, x1: 0.97, y0: 0.44, y1: 0.55, z0: 0.05, z1: 0.45 },   // along the far shoreline
    { w: 0.28, x0: 0.42, x1: 0.68, y0: 0.47, y1: 0.66, z0: 0.50, z1: 0.95 },   // across the pond, near the lily pad
    { w: 0.16, x0: 0.38, x1: 0.88, y0: 0.56, y1: 0.72, z0: 0.40, z1: 0.90 }    // low over open water
  ];
  const SWAY_TREE_X = 0.58;                                    // foliage right of this fraction of the scene belongs to the right-side tree
  const MAX_FX = 40;                                           // live ripples + splashes
  const WATER_BAND = 46;                                       // rows below the far shoreline where drops land on the water
  const CLOUD_IN_MS = 150000, CLOUD_OUT_MS = 240000;           // overcast builds before the rain peaks and lingers after it                                         // ~25 fps while raining

  // ---------------------------------------------------------------------------------------------------
  // Lighting keyframes: [hour, [mulR, mulG, mulB, liftR, liftG, liftB, skyR, skyG, skyB, skyA, glowR, glowG, glowB, glowA]]
  //   mul  : multiplied over the scene (1 = the approved artwork untouched)
  //   lift : screened over the scene (keeps shadows readable and tints them)
  //   sky  : soft vertical gradient behind the far bank; glow: soft radial light where the artwork's haze glows
  // ---------------------------------------------------------------------------------------------------
  const KEYS = [
    [0,    [0.40, 0.54, 0.72, 10, 26, 34,  40,  80, 110, 0.10,  90, 130, 170, 0.06]],   // night
    [4,    [0.42, 0.55, 0.74, 11, 27, 36,  50,  85, 120, 0.12, 100, 130, 175, 0.07]],   // late night
    [5.5,  [0.62, 0.70, 0.86, 14, 24, 34, 150, 150, 190, 0.14, 210, 160, 170, 0.12]],   // dawn
    [6.6,  [0.90, 0.86, 0.88, 20, 18, 12, 250, 190, 130, 0.16, 255, 200, 130, 0.20]],   // sunrise
    [8.5,  [0.98, 0.98, 0.97,  3,  5,  5, 200, 225, 235, 0.05, 255, 240, 200, 0.08]],   // morning
    [12,   [1.00, 1.00, 1.00,  0,  0,  0, 220, 235, 240, 0.03, 255, 250, 225, 0.04]],   // midday
    [15,   [1.00, 0.99, 0.97,  0,  0,  0, 225, 235, 235, 0.03, 255, 245, 210, 0.05]],   // afternoon
    [17.3, [1.00, 0.93, 0.80, 14,  8,  0, 255, 200, 120, 0.09, 255, 205, 120, 0.16]],   // golden hour
    [18.7, [0.96, 0.76, 0.72, 22, 10, 10, 255, 150, 100, 0.14, 255, 150,  90, 0.20]],   // sunset
    [19.7, [0.62, 0.60, 0.80, 16, 14, 32, 130, 110, 180, 0.12, 190, 130, 170, 0.10]],   // dusk
    [21,   [0.48, 0.57, 0.76, 11, 22, 34,  70,  95, 150, 0.10, 110, 130, 180, 0.06]],   // evening
    [24,   [0.40, 0.54, 0.72, 10, 26, 34,  40,  80, 110, 0.10,  90, 130, 170, 0.06]]    // night again (wraps to 0)
  ];
  const KN = KEYS.length, NC = 14;

  function lightAt(h, out) {
    let i = 0;
    while (i < KN - 2 && h >= KEYS[i + 1][0]) i++;
    const k0 = KEYS[i], k1 = KEYS[i + 1], t0 = k0[0], t1 = k1[0], dt = t1 - t0, u = (h - t0) / dt;
    const pm = i === 0 ? KEYS[KN - 2] : KEYS[i - 1], pmT = i === 0 ? pm[0] - 24 : pm[0];
    const nx = i + 1 === KN - 1 ? KEYS[1] : KEYS[i + 2], nxT = i + 1 === KN - 1 ? nx[0] + 24 : nx[0];
    const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let c = 0; c < NC; c++) {
      const v0 = k0[1][c], v1 = k1[1][c];
      const m0 = (v1 - pm[1][c]) / (t1 - pmT), m1 = (nx[1][c] - v0) / (nxT - t0);
      out[c] = h00 * v0 + h10 * dt * m0 + h01 * v1 + h11 * dt * m1;
    }
    for (let c = 0; c < 3; c++) { out[c] = Math.min(1, Math.max(0, out[c])); out[3 + c] = Math.min(255, Math.max(0, out[3 + c])); out[6 + c] = Math.min(255, Math.max(0, out[6 + c])); out[10 + c] = Math.min(255, Math.max(0, out[10 + c])); }
    out[9] = Math.min(1, Math.max(0, out[9])); out[13] = Math.min(1, Math.max(0, out[13]));
    return out;
  }

  function localHours(d) { return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3600000; }
  function rgb(r, g, b) { return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')'; }
  function rgba(r, g, b, a) { return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + a.toFixed(4) + ')'; }

  // ---------------------------------------------------------------------------------------------------
  // One live environment per LV1 session
  // ---------------------------------------------------------------------------------------------------
    // Midpoint ellipse: calls plot(dx, dy) once for every pixel of an ellipse outline centred on 0,0.
  function ellipse(rx, ry, plot) {
    function quad(x, y) { plot(x, y); if (x) plot(-x, y); if (y) { plot(x, -y); if (x) plot(-x, -y); } }
    let x = 0, y = ry, rx2 = rx * rx, ry2 = ry * ry, dx = 0, dy = 2 * rx2 * y, d1 = ry2 - rx2 * ry + 0.25 * rx2;
    while (dx < dy) {
      quad(x, y);
      if (d1 < 0) { x++; dx += 2 * ry2; d1 += dx + ry2; } else { x++; y--; dx += 2 * ry2; dy -= 2 * rx2; d1 += dx - dy + ry2; }
    }
    let d2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    while (y >= 0) {
      quad(x, y);
      if (d2 > 0) { y--; dy -= 2 * rx2; d2 += rx2 - dy; } else { y--; x++; dx += 2 * ry2; dy -= 2 * rx2; d2 += dx - dy + rx2; }
    }
  }
  function smooth(x) { return x * x * (3 - 2 * x); }

  function cl01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ffWindow(h) {                                       // 0..1: how open the firefly hours are (in from 19:00, out toward first light)
    if (h >= FF_FROM_H) return cl01((h - FF_FROM_H) / 0.5);
    if (h < FF_UNTIL_H) return cl01((FF_UNTIL_H - h) / 0.8);
    return 0;
  }

  // Reads the pack's own painted layers (read-only) to learn where the open water, the lily pad and the land are, so
  // rain can land on each correctly. Returns null if anything is missing; rain then simply falls without landing effects.
  function buildSurface(api) {
    try {
      const pack = api.pack, SW = api.scene.w, SH = api.scene.h;
      const env = (pack.environments || []).filter(function (e) { return e.id === pack.entry.environment; })[0];
      if (!env) return null;
      function each(frameId, fn) {
        env.layers.forEach(function (l) {
          if (l.frame !== frameId) return;
          const f = pack.frames[l.frame]; if (!f) return;
          for (let y = 0; y < f.rows.length; y++) { const row = f.rows[y]; for (let x = 0; x < row.length; x++) if (row.charAt(x) !== '.') fn(l.x + x, l.y + y); }
        });
      }
      function inside(x, y) { return x >= 0 && y >= 0 && x < SW && y < SH; }
      const mask = new Uint8Array(SW * SH), pad = [], groundTop = new Int16Array(SW).fill(-1);
      each('f_water', function (x, y) { if (inside(x, y)) mask[y * SW + x] = 1; });
      ['f_rocks', 'f_pads', 'f_plants'].forEach(function (id) { each(id, function (x, y) { if (inside(x, y)) mask[y * SW + x] = 0; }); });
      each('f_pads', function (x, y) { if (inside(x, y)) pad.push(x, y); });
      each('f_ground', function (x, y) { if (inside(x, y) && (groundTop[x] < 0 || y < groundTop[x])) groundTop[x] = y; });
      const top = new Int16Array(SW).fill(-1), bot = new Int16Array(SW).fill(-1), cols = [], land = [];
      for (let x = 0; x < SW; x++) {
        for (let y = 0; y < SH; y++) if (mask[y * SW + x]) { if (top[x] < 0) top[x] = y; bot[x] = y; }
        if (top[x] >= 0 && bot[x] - top[x] >= 8) cols.push(x); else land.push(x);
      }
      if (cols.length < 8) return null;
      const runs = [];
      for (let y = 0; y < SH; y++) { let x = 0; while (x < SW) { if (!mask[y * SW + x]) { x++; continue; } const x0 = x; while (x < SW && mask[y * SW + x]) x++; runs.push(x0, y, x - x0); } }
      let path = null;
      if (typeof Path2D !== 'undefined') { path = new Path2D(); for (let i = 0; i < runs.length; i += 3) path.rect(runs[i], runs[i + 1], runs[i + 2], 1); }
      return { mask: mask, top: top, bot: bot, cols: cols, land: land, pad: pad, groundTop: groundTop, runs: runs, path: path };
    } catch (e) { return null; }
  }

  // Reads the pack's painted layers (read-only) to find the right-side tree's leaves and the distant shore grass, and
  // turns them into thin clip bands. The overlay slides the artwork one pixel sideways inside a band now and then.
  function buildSway(api) {
    try {
      if (typeof Path2D === 'undefined') return null;
      const pack = api.pack, SW = api.scene.w;
      const env = (pack.environments || []).filter(function (e) { return e.id === pack.entry.environment; })[0];
      if (!env) return null;
      const bands = [], byKey = {};
      function bandFor(key, ph, rate, amp) {
        let b = byKey[key];
        if (!b) { b = byKey[key] = { path: new Path2D(), ph: ph, rate: rate, amp: amp, s: 0 }; bands.push(b); }
        return b;
      }
      function leaves(frameId, x0, fn) {
        env.layers.forEach(function (l) {
          if (l.frame !== frameId) return;
          const f = pack.frames[l.frame]; if (!f) return;
          const pal = pack.palettes[f.palette], leaf = {};
          Object.keys(pal).forEach(function (ch) {
            let h = String(pal[ch]).slice(1); if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
            leaf[ch] = parseInt(h.slice(2, 4), 16) > parseInt(h.slice(0, 2), 16) + 8;      // green-dominant colours are foliage; bark and soil are not
          });
          for (let y = 0; y < f.rows.length; y++) {
            const row = f.rows[y]; let x = 0;
            while (x < row.length) {
              if (!leaf[row.charAt(x)] || l.x + x < x0) { x++; continue; }
              const s = x; while (x < row.length && leaf[row.charAt(x)]) x++;
              fn(l.x + s, l.y + y, x - s);
            }
          }
        });
      }
      leaves('f_trees', Math.round(SW * SWAY_TREE_X), function (x, y, n) {
        const k = Math.floor(y / 6);
        bandFor('t' + k, k * 0.62, 0.46 + (k % 3) * 0.06, 0.74).path.rect(x - 1, y, n + 2, 1);
      });
      leaves('f_mid', 84, function (x, y, n) {
        const k = Math.floor(x / 20);
        bandFor('g' + k, k * 1.3, 0.7 + (k % 3) * 0.08, 0.7).path.rect(x - 1, y, n + 2, 1);
      });
      return bands.length ? bands : null;
    } catch (e) { return null; }
  }

  function start(api) {
    const SW = api.scene.w, SH = api.scene.h;
    const L = new Array(NC).fill(0);
    let lightStamp = -1e9;
    const rain = { start: 0, end: 0, next: 0, p1: 0, p2: 0 };
        let rainI = 0;                       // current rain intensity 0..1 (drop density)
    let cloudV = 0;                      // 0..1 overcast build-up and clear-up around each event (slower than the rain itself)
    let dark = 0;                        // combined overcast strength that drives the lighting and the water tone
    let simT = 0;                        // seconds of simulated rain time (advances only while frames run)
    const drops = [];
    const fx = [];                       // live ripples and splashes
        let rafId = 0, timerId = 0, lastDraw = 0, lastStep = 0;
    const actors = [];                   // LV1-only actors (the frog) that ride this one clock, scheduler and redraw
    let actorDirty = false, lastSlowDraw = 0;
    const surf = buildSurface(api);      // where water, pad and land are (read from the pack's layers, never modified)

    function hidden() { try { return !!document.hidden; } catch (e) { return false; } }

    // ---- rain schedule (in memory, wall-clock based) ----
    function startEvent(now) {
      rain.start = now;
      rain.end = now + RAIN_MIN_MS + Math.random() * RAIN_VAR_MS;
      rain.next = now + (RAIN_GAP_MIN + Math.random() * RAIN_GAP_VAR) * MIN;
      rain.p1 = Math.random() * 6.2832; rain.p2 = Math.random() * 6.2832;
    }
    function intensityAt(now) {
      if (now >= rain.end || now < rain.start) return 0;
      const env = Math.max(0, Math.min(1, (now - rain.start) / RAMP_MS, (rain.end - now) / RAMP_MS));
      const t = (now - rain.start) / MIN;
      const v = 0.62 + 0.28 * Math.sin(t * 6.2832 / 7.3 + rain.p1) + 0.10 * Math.sin(t * 6.2832 / 2.9 + rain.p2);
      return env * Math.max(0.2, Math.min(1, v));
    }
    function evaluate(now) {
      if (now >= rain.next) startEvent(now);   // first activation, or resume after a gap: one event, never a replay
      rainI = intensityAt(now);
      cloudV = cloudAt(now);
            dark = cloudV * (0.78 + 0.22 * rainI);
      for (let i = 0; i < actors.length; i++) { try { if (actors[i].update(now)) actorDirty = true; } catch (e) { /* an actor can never stop the scene */ } }
      try { if (ffStep(now)) actorDirty = true; if (swayStep(now)) actorDirty = true; } catch (e) { /* ambience can never stop the scene */ }
    }
    function cloudAt(now) {                    // the sky closes in ahead of the rain and clears slowly afterwards
      if (now < rain.start) return 0;
      if (now < rain.end) return smooth(Math.min(1, (now - rain.start) / CLOUD_IN_MS));
      return smooth(Math.max(0, 1 - (now - rain.end) / CLOUD_OUT_MS));
    }

    // ---- drops: each one is aimed at something real (open water, the lily pad, or leaves / stone / ground) ----
    function pickTarget(p) {
      const s = surf;
      if (!s) { p.x = Math.floor(Math.random() * SW); p.end = 46 + Math.random() * (SH - 46); p.kind = 0; return; }
      if (s.pad.length && Math.random() < 0.035) {
        const k = Math.floor(Math.random() * (s.pad.length / 2)) * 2;
        p.x = s.pad[k]; p.end = s.pad[k + 1]; p.kind = 2; return;
      }
      if (Math.random() < s.cols.length / SW) {
        for (let tries = 0; tries < 6; tries++) {
          const x = s.cols[Math.floor(Math.random() * s.cols.length)];
          const y = s.top[x] + 2 + Math.floor(Math.random() * Math.max(1, Math.min(WATER_BAND, s.bot[x] - s.top[x] - 3)));
          if (s.mask[y * SW + x]) { p.x = x; p.end = y; p.kind = 1; return; }
        }
      }
      const x = s.land.length ? s.land[Math.floor(Math.random() * s.land.length)] : Math.floor(Math.random() * SW);
      const gt = s.groundTop[x] > 36 ? s.groundTop[x] : Math.round(SH * 0.5);
      p.x = x; p.end = 30 + Math.random() * Math.max(6, gt - 32); p.kind = 0;
    }
    function respawn(p, fresh) {
      pickTarget(p);
      const d = Math.max(0, Math.min(1, (p.end - 30) / (SH - 30)));   // lower targets are nearer: longer, faster, brighter
      p.d = d; p.vy = 85 + 70 * d; p.len = 2 + Math.floor(d * 3); p.a = 0.10 + 0.16 * d;
      p.y = fresh ? Math.random() * p.end : -p.len - Math.random() * 30;
    }
    function ensureDrops() { if (drops.length) return; for (let i = 0; i < MAX_DROPS; i++) { const p = {}; respawn(p, true); drops.push(p); } }
    function active() { return rainI > 0.001 ? Math.min(MAX_DROPS, Math.ceil(MAX_DROPS * rainI)) : 0; }
    function addFx(kind, x, y, r, amp) {
      if (fx.length >= MAX_FX) fx.shift();
      fx.push({ k: kind, x: x, y: y, r: r, amp: amp, t0: simT, life: kind === 1 ? 1.7 + Math.random() * 1.1 : 0.26 });
    }
    function landing(p) {
      if (!surf) return;
      const y = Math.round(p.end);
      if (p.kind === 1) {                                              // water: a ripple, wider the nearer it lands
        const w = Math.max(0, Math.min(1, (p.end - surf.top[p.x]) / WATER_BAND));
        addFx(1, p.x, y, 2.5 + 6 * w + Math.random() * 1.5, 1);
      } else addFx(2, p.x, y, 0, p.kind === 2 ? 1 : 0.7);               // pad / leaves / stone: a tiny splash
    }
        function rainBusy() { return rainI > 0.001 || fx.length > 0; }
    function actorBusy() { for (let i = 0; i < actors.length; i++) { try { if (actors[i].busy()) return true; } catch (e) { /* ignore */ } } return false; }
    function busy() { return rainBusy() || actorBusy(); }
    function step(dt) {
      ensureDrops();
      simT += dt;
      const n = active();
      for (let i = 0; i < n; i++) { const p = drops[i]; p.y += p.vy * dt; if (p.y >= p.end) { landing(p); respawn(p, false); } }
      let k = 0;
      for (let i = 0; i < fx.length; i++) if (simT < fx[i].t0 + fx[i].life) fx[k++] = fx[i];
      fx.length = k;
    }

        // ---- ripples: thin flattened rings (lit on the far arc, shaded on the near arc), only ever drawn on open water ----
    function ring(g, f, r, a, hi, sh) {
      const rx = Math.round(r); if (rx < 1) return;
      const ry = Math.max(1, Math.round(rx * 0.32)), m = surf.mask;
      ellipse(rx, ry, function (dx, dy) {
        const x = f.x + dx, y = f.y + dy;
        if (x < 0 || y < 0 || x >= SW || y >= SH || !m[y * SW + x]) return;
        const lit = dy < 0 || (dy === 0 && dx > 0);
        g.globalAlpha = a * (lit ? 0.5 : 0.34); g.fillStyle = lit ? hi : sh; g.fillRect(x, y, 1, 1);
      });
    }
    function drawFx(g, b, I) {
      const hi = rgb(214 * b, 232 * b, 236 * b), sh = rgb(6 + 6 * b, 22 + 10 * b, 28 + 12 * b), gain = 0.6 + 0.4 * I;
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < fx.length; i++) {
        const f = fx[i], u = (simT - f.t0) / f.life;
        if (u < 0 || u >= 1) continue;
        if (f.k === 1) {
          const a = Math.pow(1 - u, 1.4) * gain;
          ring(g, f, f.r * (1 - (1 - u) * (1 - u)), a, hi, sh);
          if (u > 0.22) { const u2 = (u - 0.22) / 0.78; ring(g, f, f.r * 0.58 * (1 - (1 - u2) * (1 - u2)), a * 0.6, hi, sh); }
          if (u < 0.14) { g.globalAlpha = 0.5 * (1 - u / 0.14) * gain; g.fillStyle = hi; g.fillRect(f.x, f.y, 1, 1); g.fillRect(f.x, f.y - 1, 1, 1); }
        } else {
          const rise = Math.round(u * 2);
          g.globalAlpha = (1 - u) * 0.5 * gain * f.amp; g.fillStyle = hi;
          g.fillRect(f.x - 1, f.y - 1 - rise, 1, 1); g.fillRect(f.x + 1, f.y - 1 - rise, 1, 1); g.fillRect(f.x, f.y - 2 - rise, 1, 1);
        }
      }
      g.globalAlpha = 1;
    }

    // ---- overlay: runs inside the renderer's redraw, on the renderer's own canvas ----
    function overlay(g) {
      const now = Date.now();
      if (now - lightStamp > 4000 || now < lightStamp) { lightAt(localHours(new Date(now)), L); lightStamp = now; }
      const I = rainI, D = dark, lum = (L[0] + L[1] + L[2]) / 3, b = 0.45 + 0.55 * lum;
            drawSway(g);                                                        // foliage and distant grass: a barely-there one-pixel sway
      // 0) actors (the frog) are painted first, so the light below is applied to them like to everything else
      for (let i = 0; i < actors.length; i++) { g.save(); try { actors[i].draw(g); } catch (e) { /* an actor can never stop the scene */ } g.restore(); }
      // 1) ambient light. Overcast darkens and cools the whole scene, takes the glow away and greys the sky.
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = rgb(L[0] * (1 - 0.30 * D) * 255, L[1] * (1 - 0.24 * D) * 255, L[2] * (1 - 0.16 * D) * 255);
      g.fillRect(0, 0, SW, SH);
      g.globalCompositeOperation = 'screen';
      g.fillStyle = rgb(L[3], L[4], L[5]);
      g.fillRect(0, 0, SW, SH);
      const skyH = Math.round(SH * 0.65), skyA = L[9] * (1 - 0.35 * D), k = 0.6 * D;
      if (skyA > 0.002) {
        const sr = L[6] + (118 - L[6]) * k, sg2 = L[7] + (136 - L[7]) * k, sb = L[8] + (148 - L[8]) * k;
        const sg = g.createLinearGradient(0, 0, 0, skyH);
        sg.addColorStop(0, rgba(sr, sg2, sb, skyA * 0.45));
        sg.addColorStop(0.8, rgba(sr, sg2, sb, skyA));
        sg.addColorStop(1, rgba(sr, sg2, sb, 0));
        g.fillStyle = sg; g.fillRect(0, 0, SW, skyH);
      }
      const glowA = L[13] * (1 - 0.85 * D);
      if (glowA > 0.002) {
        g.save();
        g.translate(SW * 0.69, SH * 0.24); g.scale(1.5, 1);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, 100);
        rg.addColorStop(0, rgba(L[10], L[11], L[12], glowA));
        rg.addColorStop(0.55, rgba(L[10], L[11], L[12], glowA * 0.35));
        rg.addColorStop(1, rgba(L[10], L[11], L[12], 0));
        g.fillStyle = rg; g.fillRect(-160, -100, 320, 220);
        g.restore();
      }
      // 1b) night: the water and the far shore lift very slightly, so the pond stays readable with no visible light source
      const nt = cl01((0.70 - lum) / 0.14) * (1 - 0.8 * D);
      if (nt > 0.01) {
        g.globalCompositeOperation = 'screen';
        if (surf) {
          g.fillStyle = rgba(70, 118, 134, 0.04 * nt);
          if (surf.path) g.fill(surf.path);
          else for (let i = 0; i < surf.runs.length; i += 3) g.fillRect(surf.runs[i], surf.runs[i + 1], surf.runs[i + 2], 1);
        }
        const hy0 = Math.round(SH * 0.34), hy1 = Math.round(SH * 0.58), hg = g.createLinearGradient(0, hy0, 0, hy1);
        hg.addColorStop(0, rgba(96, 140, 150, 0)); hg.addColorStop(0.65, rgba(96, 140, 150, 0.035 * nt)); hg.addColorStop(1, rgba(96, 140, 150, 0));
        g.fillStyle = hg; g.fillRect(0, hy0, SW, hy1 - hy0);
      }
      // 2) a hushed, moody air: colours soften, contrast flattens, edges close in, the water settles to a flat sky-grey tone
      if (D > 0.01) {
        g.globalCompositeOperation = 'saturation';
        if (g.globalCompositeOperation === 'saturation') { g.fillStyle = 'rgba(128,128,128,' + (0.34 * D).toFixed(3) + ')'; g.fillRect(0, 0, SW, SH); }
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = rgba(110 * b, 128 * b, 140 * b, 0.07 * D);
        g.fillRect(0, 0, SW, SH);
        const vg = g.createRadialGradient(SW * 0.5, SH * 0.48, SH * 0.30, SW * 0.5, SH * 0.48, SW * 0.62);
        vg.addColorStop(0, 'rgba(8,20,28,0)'); vg.addColorStop(1, 'rgba(8,20,28,' + (0.34 * D).toFixed(3) + ')');
        g.fillStyle = vg; g.fillRect(0, 0, SW, SH);
        if (surf) {
          g.fillStyle = rgba(86 * b, 112 * b, 118 * b, 0.16 * D);
          if (surf.path) g.fill(surf.path);
          else for (let i = 0; i < surf.runs.length; i += 3) g.fillRect(surf.runs[i], surf.runs[i + 1], surf.runs[i + 2], 1);
        }
      }
      drawFireflies(g, now, 0.55 + 0.45 * cl01((0.80 - lum) / 0.20));   // their own light: painted after the ambient light, never dimmed by it
      // 3) the rain meeting the scene: ripples on the water
      if (fx.length && surf) drawFx(g, b, I);
      // 4) falling drops: they stop exactly where they land
      const n = active();
      if (n > 0 && drops.length) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = rgb(196 * b, 214 * b, 226 * b);
        const gain = 0.55 + 0.45 * I;
        for (let i = 0; i < n; i++) {
          const p = drops[i], len = Math.min(p.len, Math.floor(p.end - p.y));
          if (len <= 0 || p.y < -p.len) continue;
          g.globalAlpha = p.a * gain;
          g.fillRect(p.x, Math.floor(p.y), 1, len);
        }
        g.globalAlpha = 1;
      }
    }

    // ---- ambience: barely-there sway in the right-side tree and the distant grass, and the fireflies ----
    const sway = buildSway(api);
    let swayKey = '';
    function swayStep(now) {                       // true when any band has moved since the last look
      if (!sway) return false;
      const t = now / 1000; let key = '';
      for (let i = 0; i < sway.length; i++) {
        const b = sway[i], s = Math.round(b.amp * Math.sin(t * b.rate + b.ph) * (0.75 + 0.25 * Math.sin(t * 0.09 + 1)));
        b.s = s; key += s + ',';
      }
      if (key === swayKey) return false;
      swayKey = key; return true;
    }
    function drawSway(g) {                         // drawn first, so the frog and the light sit on top of it; the water is never touched
      if (!sway) return;
      for (let i = 0; i < sway.length; i++) {
        const b = sway[i]; if (!b.s) continue;
        g.save(); g.clip(b.path); g.drawImage(api.envCanvas, b.s, 0); g.restore();
      }
    }

    // Fireflies. The frog reads this same list (api.state.entityFireflies) through its own catch system.
    const ff = [];
        let ffNextAt = 0, ffTarget = 12, ffRetargetAt = 0, ffLast = 0;
    function ffZone(f) { const Z = f.Z; return { x0: Z.x0 * SW, x1: Z.x1 * SW, y0: Z.y0 * SH, y1: Z.y1 * SH }; }
        function ffCrowd(x, y, self) {                                         // true when another firefly is already close to this spot
      const d = SW * 0.06, d2 = d * d;
      for (let i = 0; i < ff.length; i++) {
        const o = ff[i]; if (o === self || o.eaten) continue;
        const dx = x - o.x, dy = (y - o.y) * 2;
        if (dx * dx + dy * dy < d2) return true;
      }
      return false;
    }
    function ffAnchor(f, now) {
      const z = ffZone(f);
      for (let n = 0; n < 4; n++) {                                        // a few tries to drift somewhere uncrowded
        f.ax = Math.max(z.x0, Math.min(z.x1, f.bx + rnd(-30, 30)));
        f.ay = Math.max(z.y0, Math.min(z.y1, f.by + rnd(-9, 9)));
        if (!ffCrowd(f.ax, f.ay, f)) break;
      }
      f.reAt = now + rnd(4500, 10000);
    }
    function ffPlace(f, now) {
      const t = now / 1000, k = 0.6 + 0.6 * f.z;                           // nearer ones wander a touch wider
      f.x = f.bx + (Math.sin(t * 0.9 + f.s1) * 1.4 + Math.sin(t * 0.37 + f.s2) * 2.2) * k;
      f.y = f.by + (Math.sin(t * 1.1 + f.s3) * 0.8 + Math.sin(t * 0.43 + f.s4) * 1.4) * k;
    }
    function ffSpawn(now) {
      const r = Math.random(); let Z = FF_ZONES[FF_ZONES.length - 1], acc = 0;
      for (let i = 0; i < FF_ZONES.length; i++) { acc += FF_ZONES[i].w; if (r < acc) { Z = FF_ZONES[i]; break; } }
      const f = { ff: true, Z: Z, born: now, life: rnd(20000, 46000), fi: rnd(2200, 3800), fo: rnd(2800, 4600), z: rnd(Z.z0, Z.z1),
        s1: rnd(0, 6.28), s2: rnd(0, 6.28), s3: rnd(0, 6.28), s4: rnd(0, 6.28), w1: rnd(1.7, 2.7), w2: rnd(0.3, 0.55), w3: rnd(0.16, 0.3),
        bx: 0, by: 0, ax: 0, ay: 0, reAt: 0, x: 0, y: 0, vis: 0, glow: 0, caught: false, eaten: false, eatAt: 0 };
      const z = ffZone(f);
            for (let n = 0; n < 8; n++) {                                        // start away from the others; later tries are accepted if the zone is full
        f.bx = rnd(z.x0, z.x1); f.by = rnd(z.y0, z.y1);
        if (!ffCrowd(f.bx, f.by, f)) break;
      }
      ffAnchor(f, now); ffPlace(f, now); ff.push(f);
    }
    function ffStep(now) {
      const dt = ffLast ? Math.min(0.25, Math.max(0, (now - ffLast) / 1000)) : 0, t = now / 1000;
      ffLast = now;
      const win = ffWindow(localHours(new Date(now)));
      let live = 0;
      for (let i = ff.length - 1; i >= 0; i--) {
        const f = ff[i], age = now - f.born;
        if (f.eaten || (f.caught && f.eatAt && now >= f.eatAt) || age >= f.life) { ff.splice(i, 1); continue; }   // eaten: gone with its light
        if (win <= 0.05 && f.life > age + f.fo + 600) f.life = age + f.fo + 600;                                   // first light: let them drift out
        if (!f.caught) {                                                                                           // a caught firefly holds still for the tongue
          if (now >= f.reAt) ffAnchor(f, now);
          const k = Math.min(1, dt * 0.2);
          f.bx += (f.ax - f.bx) * k; f.by += (f.ay - f.by) * k;
          ffPlace(f, now);
          if (age < f.life - f.fo) live++;
        }
        const fin = cl01(age / f.fi), fout = cl01((f.life - age) / f.fo);
        const p = 0.5 + 0.5 * Math.sin(t * f.w1 + f.s1 * 1.7), q = 0.5 + 0.5 * Math.sin(t * f.w2 + f.s2 * 1.3);
        const gap = cl01((Math.sin(t * f.w3 + f.s3 * 2.1) + 0.8) / 0.55);                                        // now and then it fades out and back in
        f.vis = smooth(fin) * smooth(fout) * smooth(gap);
        f.glow = 0.34 + 0.66 * Math.pow(p, 1.5) * (0.6 + 0.4 * q);                                               // gentle, irregular pulse
      }
            if (now >= ffRetargetAt) { ffTarget = Math.random() < 0.15 ? 10 : (Math.random() < 0.5 ? 13 : 12); ffRetargetAt = now + rnd(50000, 140000); }
      const want = Math.min(FF_MAX, Math.ceil(ffTarget * win - 0.001));
      if (win > 0.05 && dark < 0.5 && live < want && ff.length < FF_MAX && now >= ffNextAt) {
        ffSpawn(now);
                ffNextAt = now + (live < want - 3 ? rnd(500, 1400) : (Math.random() < 0.45 ? rnd(800, 2200) : rnd(2000, 5200)));
      }
      return ff.length > 0;
    }
    function drawFireflies(g, now, nk) {
      if (!ff.length) return;
      const veil = 1 - 0.85 * dark;                                        // rain and overcast hush them
      g.globalCompositeOperation = 'screen';
      for (let i = 0; i < ff.length; i++) {
        const f = ff[i];
        if (f.eaten || (f.caught && f.eatAt && now >= f.eatAt)) continue;  // eaten: no light is left behind
        const a = f.vis * f.glow * nk * veil; if (a < 0.02) continue;
        const x = Math.round(f.x), y = Math.round(f.y);
                if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
        {                                                                  // soft warm pool of light: brightest at the firefly, easing out into the scenery
          const tt = now / 1000;
          const br = 0.88 + 0.12 * Math.sin(tt * f.w2 * 2.3 + f.s4 * 1.9) + 0.06 * Math.sin(tt * f.w1 * 0.7 + f.s2);   // slow, irregular swell
          const r = SH * (0.05 + 0.035 * f.z) * br, ga = a * (0.16 + 0.10 * f.z);
          const rg = g.createRadialGradient(x, y, 0, x, y, r);
          rg.addColorStop(0, 'rgba(255,214,120,' + ga.toFixed(3) + ')');
          rg.addColorStop(0.2, 'rgba(255,196,92,' + (ga * 0.62).toFixed(3) + ')');
          rg.addColorStop(0.5, 'rgba(255,180,70,' + (ga * 0.2).toFixed(3) + ')');
          rg.addColorStop(0.78, 'rgba(255,170,60,' + (ga * 0.055).toFixed(3) + ')');
          rg.addColorStop(1, 'rgba(255,170,60,0)');
          g.globalAlpha = 1; g.fillStyle = rg;
          g.fillRect(x - Math.ceil(r), y - Math.ceil(r), Math.ceil(r) * 2 + 1, Math.ceil(r) * 2 + 1);
        }
        if (f.z > 0.3) {                                                   // a faint warm halo, only on the nearer ones                                                   // a faint warm halo, only on the nearer ones
          g.fillStyle = 'rgb(255,186,64)'; g.globalAlpha = a * (0.07 + 0.11 * f.z);
          g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); g.fillRect(x, y - 1, 1, 1); g.fillRect(x, y + 1, 1, 1);
        }
                g.fillStyle = 'rgb(255,242,182)'; g.globalAlpha = Math.min(0.95, a * (0.68 + 0.4 * f.z));
        g.fillRect(x, y, 1, 1);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }

    // ---- the single scheduler ----
    function schedule() {
      if (rafId) { api.cancelFrame(rafId); rafId = 0; }
      if (timerId) { api.clearTimeout(timerId); timerId = 0; }
      if (!api.alive()) return;
            if (hidden()) fx.length = 0;
      else if (busy()) { rafId = api.requestFrame(frame); return; }
      const now = Date.now();
            let wait = (cloudV > 0 && cloudV < 1) ? 1000 : SLOW_TICK_MS;
      if (rain.next > now) wait = Math.min(wait, Math.max(250, rain.next - now));
            if (rain.end > now) wait = Math.min(wait, Math.max(250, rain.end - now + 50));
      if (!hidden()) for (let i = 0; i < actors.length; i++) { try { wait = Math.min(wait, actors[i].wakeIn(now)); } catch (e) { /* ignore */ } }
      if (!hidden()) {                                                    // ambience: fireflies about ten times a second, foliage twice
        if (ff.length) wait = Math.min(wait, 100);
        else if (ffWindow(localHours(new Date(now))) > 0.05) wait = Math.min(wait, Math.max(500, ffNextAt - now));
        if (sway) wait = Math.min(wait, 500);
      }
      timerId = api.setTimeout(slow, wait);
    }
    function frame(t) {
      rafId = 0;
      if (t - lastDraw < FRAME_MS) { rafId = api.requestFrame(frame); return; }
      const now = Date.now();
      const dt = lastStep ? Math.min(0.1, (now - lastStep) / 1000) : FRAME_MS / 1000;
      lastStep = now; lastDraw = t;
      evaluate(now);
            if (rainBusy()) step(dt);
      api.redrawEnvironment();
            if (busy() && !hidden()) rafId = api.requestFrame(frame); else { lastStep = 0; schedule(); }
    }
        function slow() {
      timerId = 0;
      const now = Date.now();
      evaluate(now);
      if (actorDirty || now - lastSlowDraw >= 900) { actorDirty = false; lastSlowDraw = now; api.redrawEnvironment(); }
      schedule();
    }
    function wake() {                        // an actor (click, music change) asks for an immediate look
      if (!api.alive()) return;
      evaluate(Date.now());
      actorDirty = false; lastSlowDraw = Date.now();
      api.redrawEnvironment();
      schedule();
    }
    function resume() {
      if (!api.alive()) return;
            lightStamp = -1e9; lastStep = 0;
      for (let i = 0; i < actors.length; i++) { try { actors[i].resume(Date.now()); } catch (e) { /* ignore */ } }
      evaluate(Date.now());
      api.redrawEnvironment();
      schedule();
    }

        api.setOverlay(overlay);
    api.state.entityEnvironment = {
      addActor: function (actor) { actors.push(actor); wake(); return function () { const i = actors.indexOf(actor); if (i >= 0) actors.splice(i, 1); }; },
      wake: wake
    };
    api.state.entityFireflies = { list: function () { return ff; } };    // read by the frog's existing catch system
    api.on(document, 'visibilitychange', function () { if (!hidden()) resume(); });
    api.on(window, 'pageshow', resume);
         api.addDisposer(function () { drops.length = 0; fx.length = 0; ff.length = 0; });
    resume();
  }

  function hook(api, pack, info) {
    if (!info || info.id !== LV1_ID || !info.builtin) return;   // imported packs never run this module
    start(api);
  }

  let registered = false;
  try {
    if (typeof EntityRenderer !== 'undefined' && EntityRenderer && typeof EntityRenderer.registerSessionHook === 'function') {
      registered = EntityRenderer.registerSessionHook(hook) === true;
    }
  } catch (e) { try { console.warn('[EntityEnvironment] could not register', e); } catch (e2) { /* no console */ } }

  return { id: 'entity.lv1.environment', isRegistered: function () { return registered; } };
})();
