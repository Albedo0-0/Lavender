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
// Water is never touched: no ripples, waves, shimmer or splashes. Raindrops fade out as they fall.
const EntityEnvironment = (function () {
  'use strict';

  const LV1_ID = 'entity.lv1';
  const MIN = 60000;
  const RAIN_MIN_MS = 21.5 * MIN, RAIN_VAR_MS = 9 * MIN;      // each event lasts 21.5 - 30.5 min (>= 20 continuous)
  const RAIN_GAP_MIN = 50, RAIN_GAP_VAR = 9;                   // next event starts 50 - 59 min after this one started (< 60)
  const RAMP_MS = 45000;                                       // gentle fade-in / fade-out of each event
  const MAX_DROPS = 84;
  const SLOW_TICK_MS = 20000;
  const FRAME_MS = 40;                                         // ~25 fps while raining

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
  function start(api) {
    const SW = api.scene.w, SH = api.scene.h;
    const L = new Array(NC).fill(0);
    let lightStamp = -1e9;
    const rain = { start: 0, end: 0, next: 0, p1: 0, p2: 0 };
    let rainI = 0;                       // current rain intensity 0..1
    const drops = [];
    let rafId = 0, timerId = 0, lastDraw = 0, lastStep = 0;

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
    }

    // ---- drops ----
    function respawn(p, fresh) {
      const d = Math.random();
      p.d = d; p.vy = 85 + 70 * d; p.len = 2 + Math.floor(d * 3); p.a = 0.10 + 0.16 * d;
      p.end = 46 + Math.random() * (SH - 46);
      p.x = Math.floor(Math.random() * SW);
      p.y = fresh ? Math.random() * p.end : -p.len - Math.random() * 30;
    }
    function ensureDrops() { if (drops.length) return; for (let i = 0; i < MAX_DROPS; i++) { const p = {}; respawn(p, true); drops.push(p); } }
    function active() { return rainI > 0.001 ? Math.min(MAX_DROPS, Math.ceil(MAX_DROPS * rainI)) : 0; }
    function step(dt) {
      ensureDrops();
      const n = active();
      for (let i = 0; i < n; i++) { const p = drops[i]; p.y += p.vy * dt; if (p.y >= p.end) respawn(p, false); }
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
      timerId = api.setTimeout(slow, wait);
    }
    function frame(t) {
      rafId = 0;
      if (t - lastDraw < FRAME_MS) { rafId = api.requestFrame(frame); return; }
      const now = Date.now();
      const dt = lastStep ? Math.min(0.1, (now - lastStep) / 1000) : FRAME_MS / 1000;
      lastStep = now; lastDraw = t;
      evaluate(now);
            if (busy()) step(dt);
      api.redrawEnvironment();
            if (busy() && !hidden()) rafId = api.requestFrame(frame); else { lastStep = 0; schedule(); }
    }
    function slow() {
      timerId = 0;
      evaluate(Date.now());
      api.redrawEnvironment();
      schedule();
    }
    function resume() {
      if (!api.alive()) return;
      lightStamp = -1e9; lastStep = 0;
      evaluate(Date.now());
      api.redrawEnvironment();
      schedule();
    }

    api.setOverlay(overlay);
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
