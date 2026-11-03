// entity-frog.js — the frog of the built-in Entity LV1 pond.
//
// Built-in LV1 only. It is not part of the LV Pack format: it registers one session hook with EntityRenderer
// and acts ONLY for the built-in pack, so imported packs never need or run it. It adds no canvas, clock, state
// system or scheduler of its own. The frog is an "actor" of the environment module: it is drawn inside the
// environment's overlay (under the day/night light, so it is lit like the rest of the pond), it is advanced by
// the environment's single scheduler, and it is released with the Entity session (ctx.on / ctx.addDisposer).
//
// Real-world day (device-local time, never accelerated, never replayed):
//   08:00 eggs · 09:30 hatching · 10:30 tadpole · 13:00 hind legs · 15:00 front legs, tail shrinks
//   17:00 froglet on the lilypad · 18:00 looks around · 19:00 adult · 20:00 lays eggs · 22:00 jumps out
// A transition plays only if it is crossed while the pond is on screen. Opening the app later simply shows the
// stage the clock is in now.
//
// Animation priority: 1 lifecycle · 2 fly-catching · 3 click · 4 music sway · 5 idle.
// Music: read-only from Player.getStatus() and the player's own audio elements. No second music state.

const EntityFrog = (function () {
  'use strict';

  const LV1_ID = 'entity.lv1';
  const FLOW_MIN = 480;                 // 08:00 minutes of the day
  const STAGES = [['night', 0], ['eggs', 480], ['hatch', 570], ['tadpole', 630], ['hind', 780], ['front', 900],
    ['froglet', 1020], ['look', 1080], ['adult', 1140], ['laid', 1200], ['night', 1320]];
  const BOUNDS = [480, 570, 630, 780, 900, 1020, 1080, 1140, 1200, 1320];

  // ---------------------------------------------------------------- palette
    // One colour identity for the whole life cycle: a warm olive-gold skin (distinct from the pad's blue-greens and the
  // teal water) with a cream belly and golden eyes. Dark-brown outline, softened; no black.
  const PAL = {
    o: '#443f21', m: '#2b2814', d: '#686a2f', g: '#929041', l: '#bcb25a', h: '#e2d88e', n: '#78763a',   // skin: outline, deepest, shade, mid, light, highlight, spot
    q: '#dccf9c', p: '#f4ecca',                                                                             // belly: shade, cream
    y: '#e8b43c', w: '#fff6d6', k: '#1c1b11',                                                               // eye: iris, glint, pupil
    x: '#744230', r: '#c96a60', t: '#ea978c',                                                               // mouth line, mouth inside, tongue tip
    a: '#2f2c18', b: '#59552b', c: '#85803a', e: '#bdb274', v: '#8b8a3b',                                   // tadpole and larva tones
        s: '#b9d6da',
        O: '#14210f', D: '#2c4f22', S: '#46772f', M: '#78a83e', L: '#9cc95a', H: '#b6ee86', G: '#fcc93e',       // adult: outline and pupil, deep, shade, mid, light, cheek blush; eye gold
    Q: '#d7cbd0', P: '#fffdeb'                                                                              // adult belly: soft lavender shade, cream                                                  // adult belly shade, cream; mouth line, soft mouth corner
  };
  // ---------------------------------------------------------------- sprites
  function makeSprite(rows) {
    const runs = [];
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]; let x = 0;
      while (x < row.length) {
        const c = row.charAt(x);
        if (c === '.') { x++; continue; }
        let e = x + 1; while (e < row.length && row.charAt(e) === c) e++;
        runs.push([x, y, e - x, c]); x = e;
      }
    }
    return { w: rows[0].length, h: rows.length, runs: runs };
  }

  // blit: o.alpha, o.flip, o.shear (number or per-row array), o.clip (rows at y >= clip are not drawn)
  function blit(g, spr, x, y, o) {
    const alpha = (o && o.alpha != null) ? o.alpha : 1, flip = !!(o && o.flip), clip = (o && o.clip != null) ? o.clip : 1e9;
    const sh = o && o.shear;
    let last = '';
    g.globalAlpha = alpha;
    for (let i = 0; i < spr.runs.length; i++) {
      const r = spr.runs[i], yy = y + r[1];
      if (yy >= clip) continue;
      const s = sh == null ? 0 : (typeof sh === 'number' ? sh : (sh[r[1]] || 0));
      const xx = flip ? x + spr.w - r[0] - r[2] + s : x + r[0] + s;
      if (r[3] !== last) { g.fillStyle = PAL[r[3]]; last = r[3]; }
      g.fillRect(xx, yy, r[2], 1);
    }
    g.globalAlpha = 1;
  }
  function dot(g, x, y, col, a) { g.globalAlpha = a; g.fillStyle = col; g.fillRect(x, y, 1, 1); g.globalAlpha = 1; }

    // adult (12 x 10): head 12x7 built from small eye pieces set inside the head outline, body 12x3
  const EL = { open: ['GGM', 'OOG', 'OGM'], lookL: ['GGM', 'OGG', 'OGM'], lookR: ['GGM', 'GOO', 'GOM'],
    up: ['OOM', 'OGG', 'GGM'], blink: ['MMM', 'DDD', 'MMM'], happy: ['MDM', 'DMD', 'MMM'] };
  const ER = { open: ['MGG', 'GOO', 'MGO'], lookL: ['MGG', 'OOG', 'MOG'], lookR: ['MGG', 'GGO', 'MGO'],
    up: ['MOO', 'GGO', 'MGG'], blink: ['MMM', 'DDD', 'MMM'], happy: ['MDM', 'DMD', 'MMM'] };
  const MID = ['OO', 'MM', 'MM'];
  const EDGE_L = ['.O', '.O', '.O'], EDGE_R = ['O.', 'O.', 'O.'];
  const headCache = {};
  function headSprite(le, re, mouth, throat) {
    const key = le + '|' + re + '|' + mouth + '|' + throat;
    if (headCache[key]) return headCache[key];
    const rows = [];
            rows.push('..OOO..OOO..');                                             // low eye brows over a dipped crown
    for (let i = 0; i < 3; i++) rows.push(EDGE_L[i] + EL[le][i] + MID[i] + ER[re][i] + EDGE_R[i]);
    rows.push('OHMSMMMMSMHO');                                             // cheeks with a soft blush and two small smile corners
    rows.push(mouth === 'open' ? 'OMMDrrrrDMMO' : 'OMMMDDDDMMMO');         // small gentle smile (row 5 stays the tongue origin)
    rows.push(throat ? 'OSPPPPPPPPSO' : 'OSQPPPPPPQSO');                   // cream chest, brighter while the throat pulses
    return (headCache[key] = makeSprite(rows));
  }
  const BODY = makeSprite(['.OSQPPPPQSO.', 'OSMQPPPPQMSO', 'OLLSPPPPSLLO']);
  const BODY_AIR = makeSprite(['.OSQPPPPQSO.', 'OSMQPPPPQMSO', '.OL......LO.']);

  // froglet (8 x 6)
  const FEYE = {
        open: ['.dd..dd.', 'dyk..kyd'], lookL: ['.dd..dd.', 'dky..kyd'], lookR: ['.dd..dd.', 'dyk..ykd'],
    blink: ['........', '.gg..gg.'], happy: ['........', '.dd..dd.']
  };
  const fCache = {};
  function frogletSprite(eye, mouth, air) {
    const key = eye + '|' + mouth + '|' + (air ? 1 : 0);
    if (fCache[key]) return fCache[key];
    const e = FEYE[eye];
        const rows = [e[0], e[1], eye === 'blink' ? 'oogllgoo' : 'oglhllgo', mouth === 'open' ? 'ogxrrxgo' : 'ogxxxxgo', '.odqqdo.',
      air ? '.ol..lo.' : 'olhgdllo'];
    return (fCache[key] = makeSprite(rows));
  }

  // submerged frog silhouette (9 x 4), facing right
      const SWIM = makeSprite(['...SMLM..', '.SSMMLMyM', 'SS.SMMS.M', 'S.......S']);
  // ---------------------------------------------------------------- time
  function minutesOfDay(now) { const d = new Date(now); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000; }
  function stageAt(m) { let id = 'night'; for (let i = 0; i < STAGES.length; i++) if (m >= STAGES[i][1]) id = STAGES[i][0]; return id; }
  function msToNextBoundary(now) {
    const d = new Date(now); let best = Infinity;
    for (let day = 0; day < 2; day++) for (let i = 0; i < BOUNDS.length; i++) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, 0, BOUNDS[i], 0, 0).getTime();
      if (t > now && t - now < best) best = t - now;
    }
    return best;
  }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------- geometry (read from the pack, never modified)
  function readGeometry(api) {
    try {
      const pack = api.pack;
      const env = (pack.environments || []).filter(function (e) { return e.id === pack.entry.environment; })[0];
      if (!env) return null;
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      env.layers.forEach(function (l) {
        if (l.frame !== 'f_pads') return;
        const f = pack.frames[l.frame]; if (!f) return;
        for (let y = 0; y < f.rows.length; y++) { const row = f.rows[y]; for (let x = 0; x < row.length; x++) if (row.charAt(x) !== '.') {
          const X = l.x + x, Y = l.y + y; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; } }
      });
      if (x1 < 0) return null;
      let sx = 0, sn = 0;
      env.layers.forEach(function (l) {
        if (l.frame !== 'f_plants') return;
        const f = pack.frames[l.frame]; if (!f) return;
        for (let y = 0; y < f.rows.length; y++) { const row = f.rows[y]; for (let x = 0; x < row.length; x++) if (row.charAt(x) !== '.') {
          const X = l.x + x, Y = l.y + y; if (X >= x0 && X <= x1 && Y > y1 && Y <= y1 + 8) { sx += X; sn++; } } }
      });
      const cx = (x0 + x1 + 1) / 2;
      return {
        padX0: x0, padX1: x1, padY0: y0, padY1: y1, cx: cx,
        wy: y1 + 1,                                           // first row of open water under the pad
        stemX: sn ? Math.round(sx / sn) : Math.round(cx) - 2  // eggs cling to the pad's own submerged stem
      };
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- session
  function start(api, host) {
    const geo = readGeometry(api);
    if (!geo) return;
    const SW = api.scene.w, SH = api.scene.h;
    const sitLeftA = Math.round(geo.cx) - 6, sitBottom = geo.padY1 - 2, sitTopA = sitBottom - 9;   // adult 12x10
    const sitLeftF = Math.round(geo.cx) - 4, sitTopF = sitBottom - 5;                               // froglet 8x6
    const WY = geo.wy;
    const EGX = geo.stemX, EGY = geo.padY1 + 2;
    const EGG_SETS = [
      [[-4, 1], [-2, 0], [0, 0], [-3, 3], [-1, 2], [1, 2], [3, 1], [-2, 5], [0, 4], [2, 4]],
      [[-3, 0], [-1, -1], [1, 0], [-4, 2], [-2, 2], [0, 3], [2, 2], [-1, 5], [1, 5], [3, 4]]
    ];
    const HATCH_AT = [0.08, 0.2, 0.3, 0.42, 0.5, 0.6, 0.7, 0.78, 0.85, 0.9];

    let stage = null, lastUpdate = 0, view = emptyView(), lastKey = '', wakeAt = Infinity;
    let anim = null;           // priority 1: lifecycle transition
    let act = null;            // priority 2 (catch) / 3 (click)
    let eggSwap = null;        // 08:00 egg cross-fade
    let clickNo = 0;
        let swaying = false, swayStart = 0, musicOn = false, yesSince = 0, lastYes = 0, lastPoll = -1e9, busyPrev = false;
    let prevPos = -1, posAdvAt = 0;
    let blinkAt = 0, blinkUntil = 0, glanceAt = 0, glanceUntil = 0, glanceDir = 'lookL';
    const flies = []; let nextFlyAt = 0, catchReadyAt = 0, boundaryAt = 0;

    function emptyView() { return { eggs: [], tad: null, wrig: [], sit: null, swim: null, rip: [], flies: [], tongue: null }; }
    function hiddenDoc() { try { return !!document.hidden; } catch (e) { return false; } }

    // ---- stage helpers ----
    function sitStage(s) { return s === 'froglet' || s === 'look' || s === 'adult' || s === 'laid'; }
    function formOf(s) { return (s === 'froglet' || s === 'look') ? 'froglet' : 'adult'; }
    function snap(s) { anim = null; act = null; eggSwap = null; }

    function onStage(prev, next, now, live) {
      stage = next;
      if (prev === null || !live) { snap(next); return; }
      if (next === 'eggs') eggSwap = { t0: now };
      else if (next === 'froglet') startAnim('climb', now);
      else if (next === 'adult') startAnim('grow', now);
      else if (next === 'laid') startAnim('lay', now);
      else if (next === 'night' && prev === 'laid') startAnim('depart', now);
    }
        const ANIM_MS = { climb: 1900, grow: 900, lay: 13600, depart: 1810 };       // depart: 560 ms crouch and push-off + 1250 ms leap
    function startAnim(kind, now) {
      if (act && act.kind === 'catch' && act.fly) act.fly.caught = false;     // a lifecycle transition always wins
      act = null;
      anim = { kind: kind, t0: now, dur: ANIM_MS[kind] };
    }

    // ---- music: the player's own state, read-only ----
    function readMusic(now) {
      let s = null;
      try { s = (typeof Player !== 'undefined' && Player && typeof Player.getStatus === 'function') ? Player.getStatus() : null; } catch (e) { s = null; }
      if (!s || s.state !== 'playing') { prevPos = -1; return 'no'; }
      const radio = s.kind === 'radio';
      const yt = !radio && /youtube/i.test(String(s.detail || ''));
      if (!yt) {
        let el = null; try { el = document.getElementById(radio ? 'radio-audio-el' : 'music-audio-el'); } catch (e) { el = null; }
        if (el && typeof el.paused === 'boolean') {
          if (!el.paused && !el.ended && !el.error && el.readyState >= 3) return 'yes';
          return 'maybe';                       // flag says playing but nothing is flowing (loading, stalled, blocked)
        }
        return 'maybe';
      }
      const pos = Number(s.position);           // YouTube has no element to inspect: the position must be moving
      if (!isFinite(pos)) return 'maybe';
      if (prevPos >= 0 && pos > prevPos + 0.05 && pos - prevPos < 8) posAdvAt = now;
      prevPos = pos;
      return (now - posAdvAt < 2300) ? 'yes' : 'maybe';
    }
    function pollMusic(now, force) {
      if (!force && now - lastPoll < 240) return;
      lastPoll = now;
      const r = readMusic(now);
      if (r === 'yes') { if (!yesSince) yesSince = now; lastYes = now; if (!musicOn && now - yesSince >= 300) { musicOn = true; swayStart = now; swaying = true; } }
      else if (r === 'no') { yesSince = 0; musicOn = false; }
      else { yesSince = 0; if (musicOn && now - lastYes > 1400) musicOn = false; }   // track change / brief stall rides through
    }
    function swayStep(now) { return Math.floor((now - swayStart) / 280) % 4; }
    function swayLean(now) { return [0, 1, 0, -1][swayStep(now)]; }

    // ---- tadpole path: a pure function of the clock ----
    function tadPos(now) {
      const q = Math.floor(now / 120) * 0.12, t = Math.floor(now / 120) * 120 / 1000;
      const x = geo.cx + 16 * Math.sin(t * 0.11 + 1.3) + 6 * Math.sin(t * 0.27 + 0.4);
      const y = WY + 9 + 5 * Math.sin(t * 0.083 + 2.1) + 2 * Math.sin(t * 0.31);
      const t2 = t + 0.5, x2 = geo.cx + 16 * Math.sin(t2 * 0.11 + 1.3) + 6 * Math.sin(t2 * 0.27 + 0.4);
      return { x: Math.round(x), y: Math.round(y), face: x2 >= x ? 1 : -1, ph: q };
    }
    function tadView(now, m, alpha) {
      const p = tadPos(now);
      const legs = (stage === 'hind') ? 1 : (stage === 'front' ? 2 : 0);
      let tail = 5;
      if (stage === 'front') tail = Math.max(0, Math.round(5 * (1 - (m - 900) / 120)));
      return { x: p.x, y: p.y, face: p.face, ph: Math.floor(now / 120) % 8, legs: legs, tail: tail, a: alpha == null ? 1 : alpha };
    }

    // ---- flies ----
    function canCatch() { return !anim && sitStage(stage) && view.sit && !view.sit.air; }
    function mouth() {
      const f = formOf(stage) === 'froglet';
      return f ? { x: sitLeftF + 3.5, y: sitTopF + 3, reach: 15 } : { x: sitLeftA + 5.5, y: sitTopA + 5, reach: 22 };
    }
    function pickAnchor(f) {
      if (canCatch() && Math.random() < 0.7) {
        const mo = mouth(), a = -Math.PI * rnd(0.12, 0.88), r = rnd(8, mo.reach - 5);
        f.ax = mo.x + Math.cos(a) * r; f.ay = mo.y + Math.sin(a) * r;
      } else { f.ax = rnd(geo.cx - 46, geo.cx + 46); f.ay = rnd(geo.padY0 - 22, geo.padY0 - 3); }
      f.ax = Math.max(4, Math.min(SW - 4, f.ax)); f.ay = Math.max(6, Math.min(WY - 3, f.ay));
    }
        function glowFlies() { try { const h = api.state && api.state.entityFireflies; return h ? h.list() : []; } catch (e) { return []; } }   // the pond's fireflies (read-only list)
    function flyPos(f, now) {
      if (f.ff) return { x: Math.round(f.x), y: Math.round(f.y) };
      const t = (now - f.born) / 1000;
      return { x: Math.round(f.cx + Math.sin(t * 1.9 + f.s1) * 2.2 + Math.sin(t * 0.7 + f.s2) * 1.2),
        y: Math.round(f.cy + Math.sin(t * 2.3 + f.s3) * 1.5) };
    }
    function updateFlies(now, dt) {
      const day = minutesOfDay(now) >= FLOW_MIN && minutesOfDay(now) < 1320;
      for (let i = flies.length - 1; i >= 0; i--) {
        const f = flies[i], age = now - f.born;
        if (f.caught) continue;
        if (age > f.life || !day) { flies.splice(i, 1); continue; }
        if (now >= f.dartAt) { pickAnchor(f); f.dartAt = now + rnd(1500, 3600); }
        const k = Math.min(1, dt * 6); f.cx += (f.ax - f.cx) * k; f.cy += (f.ay - f.cy) * k;
      }
      if (day && now >= nextFlyAt) {
        if (flies.length < (Math.random() < 0.25 ? 2 : 1)) {
          const f = { born: now, life: rnd(8000, 17000), s1: rnd(0, 6.28), s2: rnd(0, 6.28), s3: rnd(0, 6.28), dartAt: now + rnd(1500, 3000), caught: false, cx: 0, cy: 0, ax: 0, ay: 0 };
          pickAnchor(f); f.cx = f.ax + rnd(-10, 10); f.cy = Math.max(6, f.ay - 6); flies.push(f);
        }
        nextFlyAt = now + rnd(40000, 110000);
      }
    }
    function startCatch(now) {
      if (act || anim || now < catchReadyAt || !canCatch()) return;
            const mo = mouth(), pool = flies.concat(glowFlies());
      for (let i = 0; i < pool.length; i++) {
        const f = pool[i], p = flyPos(f, now), age = now - f.born;
        if (f.caught || age < 1100 || age > f.life - 900 || (f.ff && f.vis < 0.6)) continue;
        const dx = p.x - mo.x, dy = p.y - mo.y;
        if (dx * dx + dy * dy <= (mo.reach - 2) * (mo.reach - 2) && dy < 4 && Math.random() < 0.6) {
          act = { kind: 'catch', t0: now, fly: f, tx: 0, ty: 0, launched: false, dx: dx, dy: dy };
          return;
        }
      }
    }

    // ---- pose of the resting frog (priority 3 click, 4 sway, 5 idle) ----
    function eyesFromDir(dx, dy) { if (dy < -6 && Math.abs(dx) < 8) return 'up'; return dx < -1 ? 'lookL' : (dx > 1 ? 'lookR' : 'open'); }
    function restPose(now) {
      const pose = { eye: 'open', eyeR: null, mouth: 'smile', throat: 0, lean: 0, bob: 0 };
      if (act && act.kind === 'click') {
        const t = now - act.t0, v = act.v;
                if (v === 0) {                                         // a friendly wink
          if (t < 90) pose.eye = 'blink';
          else if (t < 540) { pose.eye = 'happy'; pose.eyeR = 'open'; pose.lean = (t < 330) ? 1 : 0; pose.bob = (t < 180) ? 1 : 0; }
          else pose.eye = (t < 620) ? 'blink' : 'open';
        } else if (v === 1) {                                  // a quick double nod
          pose.eye = (t < 90 || (t >= 300 && t < 400)) ? 'blink' : 'open';
          pose.bob = ((t >= 90 && t < 210) || (t >= 330 && t < 450)) ? 1 : 0;
        } else {                                               // a happy little croak
          if (t < 700) { pose.eye = 'happy'; pose.throat = (Math.floor(t / 160) % 2); pose.lean = [0, 1, 0, -1][Math.floor(t / 175) % 4]; }
        }
        return pose;
      }
      if (swaying) { pose.eye = 'happy'; pose.lean = swayLean(now); return pose; }
      if (stage === 'look') {                                  // 18:00: stationary look-around on the lilypad
        const c = (now / 1000) % 6.4;
        if (c < 0.8) pose.eye = 'open';
        else if (c < 2.0) { pose.eye = 'lookL'; pose.lean = -1; }
        else if (c < 2.6) pose.eye = 'open';
        else if (c < 3.8) { pose.eye = 'lookR'; pose.lean = 1; }
        else if (c < 4.4) pose.eye = 'open';
        else if (c < 5.3) pose.eye = 'up';
        else pose.eye = (c > 5.7 && c < 5.85) ? 'blink' : 'open';
      } else {
        if (now >= glanceAt) { glanceDir = ['lookL', 'lookR', 'up'][Math.floor(Math.random() * 3)]; glanceUntil = now + rnd(800, 1500); glanceAt = now + rnd(7000, 16000); }
        if (now < glanceUntil) pose.eye = glanceDir;
      }
      if (now >= blinkAt) { blinkUntil = now + 140; blinkAt = now + rnd(2800, 7000); }
      if (now < blinkUntil) pose.eye = 'blink';
      pose.throat = ((now % 2600) < 650) ? 1 : 0;
      return pose;
    }

    // ---- compose the view for this instant ----
    function arcPos(p, x0, y0, x1, y1, h) { return { x: lerp(x0, x1, p), y: lerp(y0, y1, p) - 4 * h * p * (1 - p) }; }
    function eggsView(now, m) {
      const out = [], n = EGG_SETS[0].length;
      if (stage === 'night' || stage === 'laid') {
        if (stage === 'laid' && anim && anim.kind === 'lay') {
          const lay = Math.max(0, Math.min(1, (now - anim.t0 - 2300) / 9000));
          out.push({ set: 0, a: 1, n: Math.ceil(lay * n), h: 0 });
        } else out.push({ set: 0, a: 1, n: n, h: 0 });
      } else if (stage === 'eggs') {
        if (eggSwap) { const a = smooth((now - eggSwap.t0) / 3000); out.push({ set: 0, a: 1 - a, n: n, h: 0 }); out.push({ set: 1, a: a, n: n, h: 0 }); if (a >= 1) eggSwap = null; }
        else out.push({ set: 1, a: 1, n: n, h: 0 });
      } else if (stage === 'hatch') {
        out.push({ set: 1, a: 1, n: n, h: (m - 570) / 60 });
      }
      return out;
    }
    function compute(now) {
      const v = emptyView();
      const m = minutesOfDay(now);
      v.eggs = eggsView(now, m);

      // tadpoles / wrigglers
      if (stage === 'hatch') {
        const p = (m - 570) / 60;
        for (let i = 0; i < HATCH_AT.length; i++) {
          if (p < HATCH_AT[i]) continue;
          const e = EGG_SETS[1][i], t = now / 1000;
          let x = EGX + e[0] + 1 + Math.sin(t * 1.7 + i) * 1.4, y = EGY + e[1] + 1 + Math.min(6, (p - HATCH_AT[i]) * 40) + Math.sin(t * 2.3 + i * 2);
          let a = 1;
          if (i === 0 && p > 0.7) { const tp = tadPos(now), k = smooth((p - 0.7) / 0.3); x = lerp(x, tp.x, k); y = lerp(y, tp.y, k); }
          else if (p > 0.85) a = Math.max(0, 1 - (p - 0.85) / 0.15);
          if (a > 0) v.wrig.push({ x: Math.round(x), y: Math.round(y), a: Math.round(a * 20) / 20, w: Math.floor(now / 160 + i) % 2 });
        }
      }
            if ((stage === 'tadpole' || stage === 'hind' || stage === 'front') && !(anim && anim.kind === 'climb')) {
        const sinceHatch = (stage === 'tadpole') ? (m - 630) * 60000 : 1e9;      // first 1.5 s of 10:30: the last wriggler hands over to the tadpole
        const fade = sinceHatch < 1500 ? smooth(sinceHatch / 1500) : 1;
        v.tad = tadView(now, m, fade);
        if (fade < 1) { const tp = tadPos(now); v.wrig.push({ x: tp.x, y: tp.y, a: Math.round((1 - fade) * 20) / 20, w: Math.floor(now / 160) % 2 }); }
      }

      // lifecycle animations (priority 1)
      let sit = null;
      if (anim) {
        const t = now - anim.t0, p = Math.min(1, t / anim.dur);
        if (anim.kind === 'climb') {
                    const tp = tadView(now, m, 1), tp0 = anim.from || (anim.from = { x: tp.x, y: tp.y, face: tp.face });
          const T1 = 1000, T2 = 700, FD = 140;                    // FD: tadpole and froglet cross-fade at the take-off point
          const sx = geo.padX0 - 1, sy = WY + 2;
          if (t < T1 + FD) { const k = smooth(t / T1); v.tad = { x: Math.round(lerp(tp0.x, sx, k)), y: Math.round(lerp(tp0.y, sy, k)), face: t < 250 ? tp0.face : (sx >= tp0.x ? 1 : -1), ph: Math.floor(now / 120) % 8, legs: 2, tail: 0, a: t < T1 ? 1 : 1 - smooth((t - T1) / FD) }; }
          if (t >= T1 && t < T1 + T2) { const q = (t - T1) / T2, a = arcPos(q, sx - 3, sy - 2, sitLeftF, sitTopF, 7); sit = { form: 'froglet', x: Math.round(a.x), y: Math.round(a.y), air: true, a: smooth((t - T1) / FD), pose: { eye: 'open', mouth: 'smile', lean: 0 } };
            if (q < 0.2) v.rip.push({ x: sx, y: WY, r: 1 + Math.floor(q * 10) }); }
          else if (t >= T1 + T2) { sit = { form: 'froglet', x: sitLeftF, y: sitTopF, air: false, pose: { eye: (t < T1 + T2 + 150) ? 'blink' : 'open', mouth: 'smile', lean: 0 } }; }
        } else if (anim.kind === 'grow') {
                    // squat, one small hop on the spot; the two forms swap over a very short cross-fade at the top of the hop.
          // Both share the same centre and feet line, so nothing pops and the forms overlap only for a moment.
          const hop = (t > 200 && t < 560) ? Math.round(3 * Math.sin(Math.PI * (t - 200) / 360)) : 0;
          const k = smooth((t - 290) / 170);
          if (t < 200) sit = { form: 'froglet', x: sitLeftF, y: sitTopF, air: false, pose: { eye: 'open', mouth: 'smile', lean: 0, bob: t > 80 ? 1 : 0 } };
          else if (t < 560) {
            if (k > 0) sit = { form: 'adult', x: sitLeftA, y: sitTopA - hop, air: hop > 0, a: k, pose: { eye: 'open', mouth: 'smile', lean: 0 } };
            if (k < 1) v.growFrom = { x: sitLeftF, y: sitTopF - hop, a: 1 - k, air: hop > 0 };
          }
          else sit = { form: 'adult', x: sitLeftA, y: sitTopA, air: false, pose: { eye: t < 700 ? 'blink' : 'open', mouth: 'smile', lean: 0, bob: t < 640 ? 1 : 0 } };
        } else if (anim.kind === 'lay') {
          const wl = geo.padX0 - 8, T0 = 800, T1 = T0 + 1500, T2 = T1 + 9000, T3 = T2 + 1500;
          const eg = EGX - 5;
          if (t < T0) { const q = t / T0, a = arcPos(q, sitLeftA, sitTopA, wl, WY - 6, 8); sit = { form: 'adult', x: Math.round(a.x), y: Math.round(a.y), air: q < 0.9, clip: WY, pose: { eye: 'open', mouth: 'smile', lean: 0 } }; }
          else if (t < T1) { const q = smooth((t - T0) / 1500); v.swim = { x: Math.round(lerp(wl, eg, q)), y: WY + 3, face: 1, a: Math.min(1, (t - T0) / 300) };
            if (t - T0 < 500) { sit = { form: 'adult', x: wl, y: WY - 6 + Math.min(4, Math.floor((t - T0) / 120)), air: false, clip: WY, a: 1 - (t - T0) / 500, pose: { eye: 'open', mouth: 'smile', lean: 0 } }; } }
          else if (t < T2) { v.swim = { x: eg, y: WY + 5 + (Math.floor((t - T1) / 700) % 2), face: 1 }; }
          else if (t < T3) { const q = smooth((t - T2) / 1500); v.swim = { x: Math.round(lerp(eg, wl, q)), y: WY + 3, face: -1, a: Math.min(1, (T3 - t) / 400) };
            if (t - T2 > 1000) sit = { form: 'adult', x: wl, y: WY - 2 - Math.min(4, Math.floor((t - T2 - 1000) / 120)), air: false, clip: WY, a: Math.min(1, (t - T2 - 1000) / 500), pose: { eye: 'open', mouth: 'smile', lean: 0 } }; }
          else { const q = (t - T3) / (anim.dur - T3), a = arcPos(q, wl, WY - 6, sitLeftA, sitTopA, 8); sit = { form: 'adult', x: Math.round(a.x), y: Math.round(a.y), air: q < 0.9, clip: q < 0.3 ? WY : null, pose: { eye: 'open', mouth: 'smile', lean: 0 } };
            if (q < 0.2) v.rip.push({ x: wl + 5, y: WY, r: 1 + Math.floor(q * 10) }); }
          if (t >= T0 && t < T0 + 400) v.rip.push({ x: wl + 5, y: WY, r: 1 + Math.floor((t - T0) / 130) });
        } else if (anim.kind === 'depart') {
                    // A frog's leap: squat, deeper squat leaning forward, push-off, then one ballistic arc (constant forward speed,
          // parabolic rise and fall, no easing) that carries the frog past the edge of the pond scene.
          const TC = 200, TD = 480, TP = 560, TF = ANIM_MS.depart - TP;      // squat · deep squat · push-off · flight
          const x0 = sitLeftA, y0 = sitTopA, x1 = SW + 14, rise = 44;
          const pose = { eye: 'open', mouth: 'smile', throat: 0, lean: 0, bob: 0, stretch: 0 };
          if (t < TP) {
            let y = y0;
            if (t < TC) pose.bob = t > 70 ? 1 : 0;
            else if (t < TD) { pose.bob = 2; pose.lean = 1; pose.eye = 'lookR'; }
            else { pose.stretch = 1; pose.lean = 2; pose.eye = 'lookR'; y = y0 - 1; }       // legs drive, body extends, feet still on the pad
            sit = { form: 'adult', x: x0, y: y, air: false, pose: pose };
          } else {
            const u = Math.min(1, (t - TP) / TF), up = u < 0.5;
            pose.eye = 'lookR'; pose.lean = up ? 2 : 1; pose.stretch = up ? 1 : 0;           // extended on the way up, legs gathered for the way down
            sit = { form: 'adult', x: Math.round(x0 + (x1 - x0) * u), y: Math.round(y0 - 4 * rise * u * (1 - u)) - pose.stretch, air: u < 0.62, pose: pose };
          }
        }
      } else if (sitStage(stage)) {
        const form = formOf(stage);
        let pose = restPose(now);
        // fly-catching (priority 2)
        if (act && act.kind === 'catch') {
          const t = now - act.t0, mo = mouth(), f = act.fly;
                    if (t < 450) {                                           // notice, then focus: eyes lock on, a slight lean and hunch toward the fly
            const p = flyPos(f, now), side = p.x - mo.x;
            pose = { eye: eyesFromDir(side, p.y - mo.y), mouth: 'smile', throat: 0, lean: (t > 200 && Math.abs(side) > 5) ? (side < 0 ? -1 : 1) : 0, bob: t > 320 ? 1 : 0 };
          }
          else if (t < 700) {                                      // strike: a fast tongue out, a brief hold, back in
            if (!act.launched) { const p = flyPos(f, now), dx = p.x - mo.x, dy = p.y - mo.y; act.launched = true; act.tx = p.x; act.ty = p.y; f.caught = true; f.hold = p; if (f.ff) f.eatAt = act.t0 + 530; if (dx * dx + dy * dy > mo.reach * mo.reach) { act.miss = true; f.caught = false; } }
            pose = { eye: 'open', mouth: 'open', throat: 0, lean: 0, bob: 0 };
            if (!act.miss) {
                            const k = t < 530 ? smooth((t - 450) / 80) : (t < 580 ? 1 : 1 - smooth((t - 580) / 120));
              v.tongue = { ox: mo.x, oy: mo.y, tx: Math.round(lerp(mo.x, act.tx, k)), ty: Math.round(lerp(mo.y, act.ty, k)), fly: (t >= 530) };
            }
          } else if (t < 1100) pose = { eye: (t >= 760 && t < 900) ? 'blink' : 'open', mouth: 'smile', throat: (Math.floor((t - 700) / 110) % 2), lean: 0, bob: 0 };
        }
        sit = { form: form, x: form === 'froglet' ? sitLeftF : sitLeftA, y: form === 'froglet' ? sitTopF : sitTopA, air: false, pose: pose };
      }
      v.sit = sit;
      if (sit) {
        const w = sit.form === 'froglet' ? 8 : 12, h = sit.form === 'froglet' ? 6 : 10;
        sit.w = w; sit.h = h;
      }

      // flies
      for (let i = 0; i < flies.length; i++) {
        const f = flies[i], age = now - f.born;
        if (f.caught) continue;
        const p = flyPos(f, now);
        const a = Math.min(1, age / 500, Math.max(0, (f.life - age) / 600));
        v.flies.push({ x: p.x, y: p.y, a: Math.round(a * 10) / 10, w: Math.floor(now / 70) % 3 });
      }
      return v;
    }

    // ---- update: called by the environment's single scheduler ----
    function update(now) {
      const live = lastUpdate > 0 && now - lastUpdate < 4000 && !hiddenDoc() && now >= lastUpdate;
      const dt = lastUpdate > 0 ? Math.min(0.25, Math.max(0, (now - lastUpdate) / 1000)) : 0.04;
      lastUpdate = now;
      const m = minutesOfDay(now), sid = stageAt(m);
      if (sid !== stage) onStage(stage, sid, now, live);

      pollMusic(now, false);
      if (anim && now - anim.t0 >= anim.dur) { anim = null; if (stage === 'night') { /* departed: nothing is drawn */ } }
            if (!sitStage(stage) && !anim) { swaying = false; if (act) act = null; }
      else if (musicOn && !swaying && !anim && !act) { swaying = true; swayStart = now; }   // music already playing when the frog appears or an action ends
      if (swaying && !musicOn && swayStep(now) % 2 === 0) swaying = false;   // settle at the centre pose, never mid-lean
      const busyNow = !!(anim || act); if (busyPrev && !busyNow && swaying) swayStart = now; busyPrev = busyNow;   // sway resumes from the centre pose

      updateFlies(now, dt);
      if (act) {
        const t = now - act.t0;
        if (act.kind === 'click' && t >= 800) act = null;
        else if (act.kind === 'catch' && t >= 1100) { if (act.fly) { const i = flies.indexOf(act.fly); if (i >= 0 && act.fly.caught) flies.splice(i, 1); else { if (act.fly.ff && act.fly.caught) act.fly.eaten = true; act.fly.caught = false; } } catchReadyAt = now + rnd(6000, 14000); act = null; }
      }
      if (!act) startCatch(now);

      view = compute(now);
      const key = JSON.stringify(view);
      // wake plan (the environment sleeps for this long when nothing needs frames)
      if (now >= boundaryAt) boundaryAt = now + msToNextBoundary(now);
      let w = boundaryAt - now + 40;
      if (view.tad || view.wrig.length) w = Math.min(w, 125 - (now % 120));
      if (view.sit || anim) w = Math.min(w, (swaying || stage === 'look' || act) ? 90 : 450);
      if (yesSince && !musicOn) w = Math.min(w, Math.max(40, yesSince + 320 - now));
      if (sitStage(stage) || flies.length) w = Math.min(w, 450);
      if (!flies.length && minutesOfDay(now) >= FLOW_MIN && minutesOfDay(now) < 1320) w = Math.min(w, Math.max(40, nextFlyAt - now));
      wakeAt = now + Math.max(30, w);
      if (key !== lastKey) { lastKey = key; return true; }
      return false;
    }
    function busy() { return !!(anim || act || flies.length); }
    function wakeIn(now) { return Math.max(30, wakeAt - now); }
    function resume(now) {
            lastUpdate = 0; anim = null; act = null; eggSwap = null; flies.length = 0; swaying = false; musicOn = false; yesSince = 0; prevPos = -1; stage = null; busyPrev = false;
      boundaryAt = 0; nextFlyAt = now + rnd(20000, 60000); catchReadyAt = now + 4000; blinkAt = now + rnd(2000, 5000); glanceAt = now + rnd(6000, 12000); lastKey = '';
    }

    // ---- draw: inside the environment overlay, before the light is applied ----
    function drawEggs(g, e) {
      const set = EGG_SETS[e.set], n = Math.min(e.n, set.length);
      for (let i = 0; i < n; i++) {
        if (e.h > 0 && e.h >= HATCH_AT[i]) continue;
        const x = EGX + set[i][0], y = EGY + set[i][1];
                const nx = (i % 2) ? 1 : 0, ny = (i % 3 === 0) ? 0 : 1;           // the dark nucleus sits a little differently in each egg
        for (let k = 0; k < 4; k++) {                                      // clear jelly: bright rim on the lit side, a cooler shade opposite, a dark nucleus
          const px = k % 2, py = k >> 1;
          if (px === nx && py === ny) dot(g, x + px, y + py, '#22301f', 0.88 * e.a);
          else if (px === 1 - nx && py === 1 - ny) dot(g, x + px, y + py, '#8fbdb0', 0.3 * e.a);
          else if (py === 0) dot(g, x + px, y + py, '#e6f4ec', 0.55 * e.a);
          else dot(g, x + px, y + py, '#b7dacd', 0.34 * e.a);
        }
      }
    }
    function drawTad(g, t) {
      const f = t.face, a = t.a;
      for (let i = 1; i <= t.tail; i++) {
        const ty = t.y + 1 + Math.round(Math.sin(t.ph * 0.9 - i * 1.1) * Math.min(1.4, 0.4 + 0.25 * i));
                const tx = t.x - f * i + (f > 0 ? 0 : 3), fade = 1 - (i - 1) / (t.tail + 1) * 0.5;
        dot(g, tx, ty, i < 3 ? PAL.b : PAL.a, a * fade);
        if (i < t.tail) dot(g, tx, ty + 1, PAL.c, a * fade * 0.4);                 // a thin translucent tail fin
      }
      const body = f > 0 ? ['.bbc', 'abkc', '.cee'] : ['cbb.', 'ckba', 'eec.'];     // darker back, golden snout, pale belly, one dark eye
      for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) { const c = body[y].charAt(x); if (c !== '.') dot(g, t.x + x, t.y + y, PAL[c], a); }
      if (t.legs >= 1) { const k = t.ph % 4 < 2 ? 0 : 1; dot(g, f > 0 ? t.x + (k ? 0 : 1) : t.x + 3 - (k ? 0 : 1), t.y + 3, PAL.c, a); dot(g, f > 0 ? t.x - 1 + k : t.x + 4 - k, t.y + 3, PAL.e, a * 0.85); }
      if (t.legs >= 2) { dot(g, f > 0 ? t.x + 3 : t.x, t.y + 3, PAL.c, a); dot(g, f > 0 ? t.x + 4 : t.x - 1, t.y + 3, PAL.e, a * 0.85); }
    }
    function drawSit(g, s) {
      const a = s.a == null ? 1 : s.a, p = s.pose || {};
      const o = { alpha: a, clip: s.clip != null ? s.clip : 1e9 };
      if (s.form === 'froglet') {
        const eye = p.eye === 'up' ? 'open' : (p.eye || 'open');
        const spr = frogletSprite(eye, p.mouth || 'smile', s.air);
        o.shear = [p.lean || 0, p.lean || 0, p.lean || 0, p.lean || 0, 0, 0];
                blit(g, spr, s.x, s.y + Math.min(1, p.bob || 0), o);
      } else {
        const le = p.eye || 'open', re = p.eyeR || le;
        o.shear = [p.lean || 0, 0, 0];
                const bodySpr = s.air ? BODY_AIR : BODY;
        if (p.stretch) blit(g, bodySpr, s.x, s.y + 8, o);                 // push-off stretch: the lower body is drawn once more, one row lower
        blit(g, bodySpr, s.x, s.y + 7, o);
        const oh = { alpha: a, clip: o.clip, shear: p.lean || 0 };
        blit(g, headSprite(le, re, p.mouth || 'smile', p.throat ? 1 : 0), s.x, s.y + (p.bob || 0), oh);
      }
    }
    function line(g, x0, y0, x1, y1, col, a) {
      let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, n = 0;
      while (n++ < 80) { dot(g, x0, y0, col, a); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
    }
    function drawFly(g, f) {
      dot(g, f.x, f.y, '#1b1f16', f.a); dot(g, f.x + 1, f.y, '#2b3022', f.a * 0.9);
      if (f.w === 0) dot(g, f.x, f.y - 1, '#e6f0ee', 0.7 * f.a); else if (f.w === 1) dot(g, f.x + 1, f.y - 1, '#e6f0ee', 0.7 * f.a);
    }
    function draw(g) {
      const v = view;
      for (let i = 0; i < v.eggs.length; i++) drawEggs(g, v.eggs[i]);
      for (let i = 0; i < v.wrig.length; i++) { const w = v.wrig[i]; dot(g, w.x, w.y, PAL.c, w.a); dot(g, w.x + w.w, w.y + 1, PAL.b, w.a); dot(g, w.x, w.y + 2, PAL.a, w.a * 0.8); }
      if (v.tad) drawTad(g, v.tad);
            if (v.swim) blit(g, SWIM, v.swim.x, v.swim.y, { flip: v.swim.face < 0, alpha: 0.6 * (v.swim.a == null ? 1 : v.swim.a) });
      for (let i = 0; i < v.rip.length; i++) { const r = v.rip[i]; dot(g, r.x - r.r, r.y, PAL.s, 0.45); dot(g, r.x + r.r, r.y, PAL.s, 0.45); dot(g, r.x - r.r + 1, r.y + 1, PAL.s, 0.25); dot(g, r.x + r.r - 1, r.y + 1, PAL.s, 0.25); }
            if (v.growFrom) blit(g, frogletSprite('open', 'smile', !!v.growFrom.air), v.growFrom.x, v.growFrom.y, { alpha: v.growFrom.a });
      if (v.sit) drawSit(g, v.sit);
      if (v.tongue) { const t = v.tongue; line(g, Math.round(t.ox), Math.round(t.oy), t.tx, t.ty, PAL.r, 1); dot(g, t.tx, t.ty, PAL.t, 1); if (t.fly) { dot(g, t.tx, t.ty - 1, '#1b1f16', 1); } }
      for (let i = 0; i < v.flies.length; i++) drawFly(g, v.flies[i]);
    }

    // ---- interaction ----
    function hitFrog(e) {
      const s = view.sit; if (!s || anim || s.air) return false;
      const r = api.canvas.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const x = (e.clientX - r.left) * SW / r.width, y = (e.clientY - r.top) * SH / r.height;
      return x >= s.x - 2 && x <= s.x + s.w + 2 && y >= s.y - 2 && y <= s.y + s.h + 2;
    }
    function onClick(e) {
      try {
        if (!sitStage(stage) || anim || act) return;
        if (e && e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
        if (!hitFrog(e)) return;
        act = { kind: 'click', t0: Date.now(), v: clickNo++ % 3 };
        host.wake();
      } catch (err) { /* a click can never break the scene */ }
    }
    function mediaHint() { if (!api.alive()) return; pollMusic(Date.now(), true); host.wake(); }
    function hintLater() { api.setTimeout(mediaHint, 60); api.setTimeout(mediaHint, 420); }

    const el = (function () { try { return document.getElementById('dash-entity') || (api.canvas.parentNode && api.canvas.parentNode.parentNode); } catch (e) { return null; } })();
    if (el) api.on(el, 'click', onClick);
    ['play', 'playing', 'pause', 'ended', 'emptied', 'abort', 'error', 'stalled', 'waiting'].forEach(function (t) { api.on(document, t, mediaHint, true); });
    api.on(document, 'click', hintLater, true);             // a hint only: the real state is always read from the player
    const remove = host.addActor({ update: update, draw: draw, busy: busy, wakeIn: wakeIn, resume: resume });
    api.addDisposer(function () { try { remove(); } catch (e) { /* gone */ } flies.length = 0; anim = null; act = null; view = emptyView(); });
  }

  function hook(api, pack, info) {
    if (!info || info.id !== LV1_ID || !info.builtin) return;           // imported packs never run this module
    const host = api.state && api.state.entityEnvironment;
    if (!host || typeof host.addActor !== 'function') return;           // needs the environment's clock and scheduler
    start(api, host);
  }

  let registered = false;
  try {
    if (typeof EntityRenderer !== 'undefined' && EntityRenderer && typeof EntityRenderer.registerSessionHook === 'function') {
      registered = EntityRenderer.registerSessionHook(hook) === true;
    }
  } catch (e) { try { console.warn('[EntityFrog] could not register', e); } catch (e2) { /* no console */ } }

  return { id: 'entity.lv1.frog', isRegistered: function () { return registered; }, _stageAt: stageAt };
})();
