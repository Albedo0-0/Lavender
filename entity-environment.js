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
      // 3) the rain meeting the scene: ripples on the water, splashes on the pad, leaves and stone
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
    api.on(document, 'visibilitychange', function () { if (!hidden()) resume(); });
    api.on(window, 'pageshow', resume);
         api.addDisposer(function () { drops.length = 0; fx.length = 0; });
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
