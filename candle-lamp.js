/*
 * Lavender — Candle Lamp.
 *
 * A small interactive candle that normally sits in a corner. Clicking
 * an unlit candle ignites it and secretly commits to a random duration
 * between 10 and 90 minutes — the number is never shown anywhere.
 * While lit, its wax melts in real time to reflect genuine elapsed
 * time; clicking it again while lit only toggles the enlarged/dimmed
 * focus view, it never stops the burn.
 *
 * There is NO second timer system here: progress is derived every
 * tick from TimeEngine's own heartbeat (TimeEngine.subscribe), and the
 * elapsed time is committed to the SAME ledger Stopwatch/Timer runs
 * use (TimeEngine.recordStandaloneStudy + GamificationData.awardStudyTime),
 * exactly once, when the hidden duration completes. The in-progress
 * session (startedAt/durationMs) is persisted to State.get().miscCandle
 * purely so a page reload can resume the same hidden countdown — this
 * mirrors how studyClock already persists Stopwatch/Timer configuration,
 * it is not a parallel accounting system.
 *
 * The candle is hand-built pixel art drawn onto a small canvas (104 x 150
 * art pixels, each 2 CSS px) and shown with nearest-neighbour scaling, so
 * every pixel is a deliberate, hard-edged cell: banded wax shading with
 * ordered-dither transitions, a procedurally flickering flame, layered
 * dithered light, drifting embers and a wisp of smoke when it burns out.
 * No CSS gradients, blur or filters are used for the artwork.
 *
 * The melt visual (shrinking base, rim drips trailing the melting top,
 * a growing puddle) is our own implementation, adapted from an
 * open-source Sass candle animation the project owner supplied as a
 * reference — driven here by real fractional progress instead of a
 * fixed CSS animation-duration, since our duration is hidden/dynamic.
 *
 * Usage:
 *   const candle = CandleLamp.mount(container);
 *   candle.destroy();
 */
const CandleLamp = (function () {
  const STYLE_ID = 'misc-candle-lamp-style';
  const SUBSCRIBER_ID = 'misc-candle';
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  const CANDLE_H = 260; // px — scene height (base + wick + flame headroom)
  const CANDLE_W = 104; // px
  const MIN_MINUTES = 10;
  const MAX_MINUTES = 90;
  const GLOW = 1504;     // px — ambient glow texture size (188 cells)
  const GLOW_CELL = 8;   // px — one ambient glow cell
  const FULL_H = 180;    // px — unmelted body height
  const MIN_H = 24;      // px — fully melted body height

  // --- Art canvas: 104 x 150 art pixels, 2 CSS px each ------------------
  const ART = 2;
  const AW = 104, AH = 150;
  const YO = 20;                      // art rows of headroom above the scene
  const BODY_L = 28, BODY_W = 48;     // body columns (96px wide, as before)
  const FCX = 51.5, CX = 52;          // flame axis / body centre
  const BODY_FULL = FULL_H / ART;     // 90 art rows
  const BODY_MIN = MIN_H / ART;       // 12 art rows

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bay(x, y) { return (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16; }
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function mixc(a, b, t) {
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
  }
  // Reads one of Lavender's design tokens so the candle's outline and shadow
  // pick up the site's own brown / sage; falls back to a fixed colour.
  function cssColorRgb(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) {
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = '#010203';
        c.fillStyle = v;
        const out = c.fillStyle;
        if (out !== '#010203') {
          if (out.charAt(0) === '#') return hexToRgb(out);
          const m = out.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) return [+m[1], +m[2], +m[3]];
        }
      }
    } catch (e) { /* fall through to fallback */ }
    return hexToRgb(fallback);
  }

  // Wax ramp, dark -> light. The candle's own cream identity.
  const WAX = ['#a8926a', '#c7b088', '#cdb894', '#dccaa2', '#efe2c4', '#f6ecd4', '#fffaf0', '#fffdf5'].map(hexToRgb);
  const WARM = [255, 214, 138];

  // --- Ambient glow texture: ordered-dither, 4 alpha tiers, baked once ---
  let glowURL = null;
  function buildGlowTexture() {
    if (glowURL !== null) return glowURL;
    glowURL = '';
    try {
      const N = GLOW / GLOW_CELL;
      const c = document.createElement('canvas');
      c.width = N; c.height = N;
      const ctx = c.getContext('2d');
      if (!ctx) return glowURL;
      const img = ctx.createImageData(N, N);
      const MAXA = 0.36;
      const tiers = [null, [255, 130, 50], [255, 145, 65], [255, 160, 80], [255, 176, 92]];
      const half = N / 2;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
          let a;
          if (d < 0.3) a = MAXA - 0.22 * (d / 0.3);
          else if (d < 0.62) a = 0.14 - 0.10 * ((d - 0.3) / 0.32);
          else if (d < 1) a = 0.04 * (1 - (d - 0.62) / 0.38);
          else a = 0;
          const sc = a / MAXA * 4;
          const fl = Math.floor(sc);
          const lvl = fl + ((sc - fl) > bay(x, y) ? 1 : 0);
          if (lvl <= 0) continue;
          const col = tiers[Math.min(4, lvl)];
          const i = (y * N + x) * 4;
          img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2];
          img.data[i + 3] = Math.round(lvl / 4 * MAXA * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      glowURL = c.toDataURL();
    } catch (e) { glowURL = ''; }
    return glowURL;
  }

  // --- The candle artwork ------------------------------------------------
  function createArt(canvas, reduced) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = AW; canvas.height = AH;
    const img = ctx.createImageData(AW, AH);
    const buf = img.data;

    const OUT_DARK = cssColorRgb('--color-brown-600', '#6f5c40');
    const OUT_LIGHT = mixc(OUT_DARK, WAX[1], 0.45);
    const SAGE = cssColorRgb('--color-sage-300', '#9db5a5');
    const SHADOW = mixc(OUT_DARK, [40, 28, 16], 0.5);

    // Pre-mixed wax colours: [shade][warm light level 0..3]
    const WC = [];
    for (let i = 0; i < 8; i++) {
      for (let lv = 0; lv < 4; lv++) {
        let c = WAX[i];
        if (lv === 0 && i <= 2) c = mixc(c, SAGE, 0.12);   // cool desk bounce in the shade
        if (lv > 0) c = mixc(c, WARM, 0.14 * lv);           // flame light on the wax
        WC.push(c);
      }
    }
    function wax(idx, lv) { return WC[clamp(idx, 0, 7) * 4 + lv]; }

    const C_WHITE = hexToRgb('#fffdf0'), C_CORE = hexToRgb('#fff1b0'), C_MID = hexToRgb('#ffc94d');
    const C_ORANGE = hexToRgb('#ff8c26'), C_RED = hexToRgb('#e8611a'), C_TIP = hexToRgb('#c8461a');
    const C_BLUE1 = hexToRgb('#5f7fd0'), C_BLUE2 = hexToRgb('#8aa4e6');
    const HALO_TIERS = [null, [255, 130, 50], [255, 150, 66], [255, 170, 80], [255, 190, 100]];
    const GLINTS = [[-13, -7], [12, -11], [-9, 7], [15, 3], [1, -21], [-17, -1]];
    const EMBER_COLS = [hexToRgb('#fff1b0'), hexToRgb('#ffc94d'), hexToRgb('#ff8c26'), hexToRgb('#b84a1c')];
    const DRIP_X = [30, 42, 54, 66];
    const DRIP_REACH = [0.5, 0.85, 0.35, 0.65];
    const DRIP_RAMP = [3, 5, 6, 7, 6, 6, 4, 2];
    const embers = [];

    function put(x, y, c, a) {
      if (x < 0 || y < 0 || x >= AW || y >= AH) return;
      const i = (y * AW + x) * 4;
      if (a === undefined || a >= 1) {
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
        return;
      }
      const da = buf[i + 3] / 255;
      const oa = a + da * (1 - a);
      if (oa <= 0) return;
      buf[i] = (c[0] * a + buf[i] * da * (1 - a)) / oa;
      buf[i + 1] = (c[1] * a + buf[i + 1] * da * (1 - a)) / oa;
      buf[i + 2] = (c[2] * a + buf[i + 2] * da * (1 - a)) / oa;
      buf[i + 3] = oa * 255;
    }

    function lightAt(x, y, s) {
      if (!s.lightI) return 0;
      const d = Math.hypot(x - FCX, (y - s.fy) * 0.85);
      const a = Math.max(0, 1 - d / 34) * s.lightI;
      return Math.min(3, Math.floor(a * 3 + bay(x, y)));
    }

    function drawGround(s) {
      if (s.groundA < 0.03) return;
      const hws = [30, 40, 44, 34];
      for (let j = 0; j < 4; j++) {
        const hw = Math.round(hws[j] * (0.6 + 0.4 * s.groundA));
        const y = AH - 4 + j;
        for (let x = CX - hw; x < CX + hw; x++) {
          const edge = (x < CX - hw + 3 || x >= CX + hw - 3);
          if (edge && ((x + y) & 1)) continue;
          put(x, y, SHADOW, 0.3 * s.groundA);
        }
      }
    }

    function drawHalo(s) {
      const R = 30 * (0.4 + 0.6 * s.ign) * (0.97 + 0.03 * s.flick);
      const k = s.lightI * (1 + s.burst * 0.6);
      const y0 = Math.max(0, Math.floor(s.fy - R * 1.2)), y1 = Math.min(AH - 1, Math.ceil(s.fy + R * 1.2));
      const x0 = Math.max(0, Math.floor(CX - R)), x1 = Math.min(AW - 1, Math.ceil(CX + R));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - CX) / R, dy = (y + 0.5 - s.fy) / (R * 1.2);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= 1) continue;
          const v = Math.pow(1 - d, 1.8) * k;
          const lv = Math.floor(v * 4 + bay(x, y));
          if (lv <= 0) continue;
          const l = Math.min(4, lv);
          put(x, y, HALO_TIERS[l], l / 4 * 0.46);
        }
      }
    }

    function drawPuddle(s, ph, pw) {
      if (ph < 1) return;
      const a = pw / 2, b = ph / 2;
      for (let j = 0; j < ph; j++) {
        const yy = (j + 0.5 - b) / b;
        const hw = a * Math.sqrt(Math.max(0, 1 - yy * yy));
        const y = AH - ph + j;
        for (let x = Math.ceil(CX - hw - 0.5); x <= Math.floor(CX + hw - 0.5); x++) {
          let c;
          const edge = Math.abs(x + 0.5 - CX) > hw - 1.1;
          if (edge) c = hexToRgb('#c4ac82');
          else if (j === 0) c = hexToRgb('#fff6dc');
          else if (j === ph - 1) c = hexToRgb('#d9c4a3');
          else c = (bay(x, y) > 0.7 && j < b) ? hexToRgb('#fff6dc') : hexToRgb('#ecdcb6');
          if (s.lit && !edge && j < b && Math.abs(x + 0.5 - CX) < 9 && bay(x, y) < 0.35 * s.lightI) c = hexToRgb('#ffe8b0');
          put(x, y, c);
        }
      }
    }

    function drawBody(topY, s) {
      for (let y = topY; y < AH; y++) {
        const yb = AH - y; // texture is anchored to the ground so melting reveals it
        for (let i = 0; i < BODY_W; i++) {
          const x = BODY_L + i;
          if (i === 0) { put(x, y, OUT_LIGHT); continue; }
          if (i === BODY_W - 1) { put(x, y, OUT_DARK); continue; }
          const n = (i + 0.5 - BODY_W / 2) / (BODY_W / 2);
          const nz = Math.sqrt(Math.max(0, 1 - n * n));
          const L = 0.1 + 0.78 * nz - n * 0.2;
          let idx = Math.floor(L * 7.6 + (bay(x, y) - 0.5) * 0.9 + 0.5);
          if (i >= BODY_W - 3) idx += 1;
          const hn = hash(x, yb, 7);
          if (hn < 0.035) idx -= 1; else if (hn > 0.975) idx += 1;
          if (hash(i, 0, 3) > 0.82 && hash(i, yb >> 3, 5) > 0.5) idx -= 1;
          put(x, y, wax(idx, lightAt(x, y, s)));
        }
      }
    }

    function drawCap(topY, s) {
      const lit = s.lit;
      for (let j = 0; j < 8; j++) {
        const y = topY - 4 + j;
        const yy = (j + 0.5 - 4) / 4;
        const hw = 24 * Math.sqrt(Math.max(0, 1 - yy * yy));
        for (let x = BODY_L - 1; x <= BODY_L + BODY_W; x++) {
          if (Math.abs(x + 0.5 - CX) > hw) continue;
          const dn = Math.hypot((x + 0.5 - CX) / 24, yy) + (bay(x, y) - 0.5) * 0.12;
          let c;
          if (dn > 0.86) c = yy < 0 ? hexToRgb('#c4aa74') : hexToRgb(lit ? '#fff3cf' : '#efe2c4');
          else if (dn < 0.26) c = hexToRgb(lit ? (hash(x, s.frame >> 1, 4) > 0.6 ? '#ffe9b0' : '#ffd98a') : '#e6cf9f');
          else if (dn < 0.55) c = hexToRgb(lit ? '#ffeab4' : '#ffe2a0');
          else c = hexToRgb('#f7d99b');
          put(x, y, c);
        }
      }
    }

    function drawDrips(topY, baseHA, df, s) {
      for (let d = 0; d < 4; d++) {
        const lenCss = Math.min(Math.max(0, df - 0.06 * (d + 1)) * DRIP_REACH[d] * FULL_H * 1.3, baseHA * ART - 12);
        const len = Math.floor(Math.max(0, lenCss) / ART);
        if (len < 2) continue;
        const x0 = DRIP_X[d];
        for (let y = topY; y < topY + len; y++) {
          for (let k = 0; k < 8; k++) {
            const x = x0 + k;
            if (k === 0) { put(x, y, WAX[1]); continue; }
            if (k === 7) { put(x, y, WAX[0]); continue; }
            put(x, y, wax(DRIP_RAMP[k] + (hash(x, y, 11) > 0.93 ? -1 : 0), lightAt(x, y, s)));
          }
        }
        const hws = [3.9, 3.3, 2.5, 1.3];
        for (let r = 0; r < 4; r++) {
          const y = topY + len + r;
          for (let x = Math.ceil(x0 + 3.5 - hws[r]); x <= Math.floor(x0 + 3.5 + hws[r] - 0.01); x++) {
            const k = x - x0;
            const edge = Math.abs(x + 0.5 - (x0 + 4)) > hws[r] - 1;
            put(x, y, edge ? WAX[1] : wax(DRIP_RAMP[clamp(k, 0, 7)], lightAt(x, y, s)));
          }
        }
        put(x0 + 2, topY + len, wax(7, 0));   // specular glint on the bulb
        put(x0 + 3, topY + len + 1, wax(7, 0));
      }
    }

    function drawWick(wickTop, topY, s) {
      for (let y = wickTop; y < topY + 1; y++) {
        put(51, y, [58, 42, 26]);
        put(52, y, [28, 19, 12]);
      }
      put(51, wickTop, [24, 16, 10]);
      if (s.lit && hash(s.frame, 3, 3) > 0.25) put(52, wickTop, [255, 106, 32]);
      if (s.out && s.outT < 3.5) put(52, wickTop, [255, 90, 26], 1 - s.outT / 3.5);
    }

    function drawFlame(s, flameBottom, size, sway) {
      const Hf = Math.round(32 * size);
      if (Hf < 2) return;
      const Wmax = 7.4 * Math.pow(Math.min(1.05, size), 0.85);
      for (let yb = 0; yb < Hf; yb++) {
        const q = yb / (Hf - 1);
        let hw;
        if (q < 0.28) { const k = (0.28 - q) / 0.3; hw = Wmax * Math.sqrt(Math.max(0, 1 - k * k)); }
        else hw = Wmax * Math.pow((1 - q) / 0.72, 1.35);
        hw = Math.max(hw, 0.5);
        const cxr = FCX + Math.round(sway * Math.pow(q, 1.5));
        const y = flameBottom - 1 - yb;
        for (let x = Math.ceil(cxr - hw); x <= Math.floor(cxr + hw); x++) {
          const r = Math.abs(x - cxr) / hw;
          if (r > 0.78 && hash(x, yb, s.frame) < 0.16 * (0.4 + q)) continue; // ragged licking edge
          const e = r + (bay(x, y) - 0.5) * 0.14;
          const coreLim = 0.34 * (1 - 0.75 * q);
          let c, a = 1;
          if (yb === 0 && r < 0.6) { c = C_BLUE1; a = 0.85; }
          else if (yb === 1 && r < 0.4) { c = C_BLUE2; a = 0.75; }
          else if (q > 0.9) c = C_TIP;
          else if (q < 0.62 && e < coreLim * 0.55) c = C_WHITE;
          else if (q < 0.7 && e < coreLim) c = C_CORE;
          else if (e < 0.58 - 0.15 * q) c = C_MID;
          else if (e < 0.84) c = C_ORANGE;
          else c = C_RED;
          put(x, y, c, a);
        }
      }
    }

    function drawGlints(s, fy) {
      for (let k = 0; k < GLINTS.length; k++) {
        if (hash(s.frame >> 1, k, 21) < 0.5) continue;
        const bright = hash(s.frame >> 1, k, 22) > 0.7;
        put(Math.round(CX + GLINTS[k][0] * s.ign), Math.round(fy + GLINTS[k][1] * s.ign), WARM, bright ? 0.9 : 0.5);
      }
    }

    function stepEmbers(s, flameBottom, size) {
      if (s.lit && !reduced && s.ign >= 1 && embers.length < 5 && hash(s.frame, 9, 9) < 0.09) {
        embers.push({
          x0: FCX + (hash(s.frame, 1, 9) - 0.5) * 7,
          y0: flameBottom - Math.round(32 * size) + 2,
          ph: hash(s.frame, 2, 9) * 6.28,
          sp: 8 + hash(s.frame, 3, 9) * 3,
          born: s.t,
          max: 1.1 + hash(s.frame, 4, 9) * 0.5
        });
      }
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        const age = s.t - e.born;
        if (age > e.max || !s.lit) { embers.splice(i, 1); continue; }
        const p = age / e.max;
        const x = Math.round(e.x0 + Math.sin(age * 3 + e.ph) * (1 + age * 1.6));
        const y = Math.round(e.y0 - age * e.sp);
        const c = EMBER_COLS[p < 0.25 ? 0 : p < 0.55 ? 1 : p < 0.8 ? 2 : 3];
        put(x, y, c, 1 - p * p);
        if (p < 0.4) put(x, y - 1, c, 0.45);
      }
    }

    function drawSmoke(s, wickTop) {
      if (!s.out || reduced || s.outT > 5) return;
      for (let j = 0; j < 14; j++) {
        const age = s.outT - j * 0.18;
        if (age < 0 || age > 2.6) continue;
        const y = Math.round(wickTop - 2 - age * 14);
        const x = Math.round(FCX + Math.sin(age * 2.6 + j) * (1 + age * 2.2));
        const a = (1 - age / 2.6) * 0.55;
        const c = j % 2 ? [201, 195, 184] : [154, 148, 138];
        put(x, y, c, a);
        if (age > 1) put(x + 1, y, c, a * 0.6);
      }
    }

    function draw(s) {
      buf.fill(0);
      const baseHA = Math.round(BODY_FULL - (BODY_FULL - BODY_MIN) * s.df);
      const topY = AH - baseHA;
      const dropA = BODY_FULL - baseHA;
      const flameBottom = YO + 34 + dropA;
      const wickTop = YO + 26 + dropA + Math.round(6.5 * s.df);
      s.fy = flameBottom - 14;

      // flame life: smooth noise quantised to whole pixels
      const tf = s.still ? 0 : s.t;
      const n = 0.55 * Math.sin(tf * 1.7) + 0.3 * Math.sin(tf * 3.1 + 2.1) + 0.15 * Math.sin(tf * 6.3 + 0.7);
      let sway = n * 2.4;
      if (!s.still && hash(s.frame >> 3, 0, 9) > 0.9) sway += (hash(s.frame >> 3, 1, 9) > 0.5 ? 1 : -1) * 1.5;
      let hs = 0.95 + 0.05 * Math.sin(tf * 4.3 + 1);
      if (!s.still && hash(s.frame, 1, 2) < 0.06) hs -= 0.07;
      s.flick = s.still ? 1 : (hs - 0.9) / 0.1;
      const size = s.ign * (1 - 0.12 * s.df) * hs;
      s.lightI = s.lit ? clamp(0.9 + 0.2 * (s.flick - 0.5), 0.8, 1.1) * Math.min(1, s.ign * 1.2) : 0;

      drawGround(s);
      if (s.lit) drawHalo(s);
      drawPuddle(s, Math.round(9 * clamp((s.df - 0.15) / 0.85, 0, 1)), Math.round(52 * (1 + 0.9 * clamp((s.df - 0.15) / 0.85, 0, 1))));
      drawBody(topY, s);
      drawDrips(topY, baseHA, s.df, s);
      drawCap(topY, s);
      drawWick(wickTop, topY, s);
      if (s.lit) {
        drawFlame(s, flameBottom, size, sway);
        drawGlints(s, s.fy);
      }
      stepEmbers(s, flameBottom, size);
      drawSmoke(s, wickTop);
      ctx.putImageData(img, 0, 0);
      return dropA * ART;
    }

    return { draw: draw, hasEmbers: function () { return embers.length > 0; } };
  }

  const CSS = `
  .candle-lamp-mount,
  #study-layout > .candle-lamp-mount:not(#study-wallpaper-layer) {
    position: absolute;
    bottom: 0;
    right: clamp(14px, 5%, 64px);
    width: ${CANDLE_W}px;
    height: ${CANDLE_H}px;
    z-index: 4;
    cursor: pointer;
    transform: scale(0.32);
    transform-origin: 100% 100%;
    transition: transform 2.2s cubic-bezier(0.16, 1, 0.3, 1);
    -webkit-tap-highlight-color: transparent;
  }
  .candle-lamp-mount.is-focused { transform: scale(1.25); z-index: 31; }
  .candle-dim-overlay {
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse 65% 75% at var(--candle-x, 80%) var(--candle-y, 88%), rgba(40,20,8,0.3) 0%, rgba(8,5,14,0.82) 46%, rgba(3,2,8,0.92) 100%);
    opacity: 0;
    transition: opacity 2s ease;
    pointer-events: none;
    z-index: 30;
  }
  .candle-dim-overlay.is-active { opacity: 1; pointer-events: auto; }
  body.candle-scroll-lock { overflow: hidden; height: 100%; }

  /* Ambient light: a baked, ordered-dither texture (see buildGlowTexture). */
  .candle-glow-pool {
    position: absolute;
    z-index: 0;
    width: ${GLOW}px;
    height: ${GLOW}px;
    left: 50%;
    margin-left: -${GLOW / 2}px;
    top: ${40 - GLOW / 2}px;
    transform: scale(0.2);
    opacity: 0;
    transition: opacity 2s ease, transform 2.2s cubic-bezier(0.22, 0.61, 0.36, 1), top 1.2s steps(3, end);
    pointer-events: none;
  }
  .candle-glow-pool::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: var(--candle-glow);
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    animation: candleGlowPulse 3.6s steps(1, end) infinite;
  }
  @keyframes candleGlowPulse {
    0% { opacity: 1; }
    22% { opacity: 0.9; }
    41% { opacity: 0.97; }
    63% { opacity: 0.86; }
    80% { opacity: 0.95; }
    100% { opacity: 1; }
  }
  .candle-lamp-mount.is-focused .candle-glow-pool { opacity: 1; transform: scale(1); }
  .candle-lamp-mount.is-out .candle-glow-pool { opacity: 0; }
  .candle-lamp-mount.reduced-motion .candle-glow-pool::before { animation: none; }
  .candle-lamp-mount.reduced-motion, .candle-lamp-mount.reduced-motion * { transition-duration: 0.01s !important; }

  /* The artwork: ${AW} x ${AH} art pixels shown at ${ART}x with hard edges. */
  .candle-art {
    position: absolute;
    z-index: 1;
    left: ${-((AW * ART - CANDLE_W) / 2)}px;
    top: ${-YO * ART}px;
    width: ${AW * ART}px;
    height: ${AH * ART}px;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
    pointer-events: none;
  }

  .candle-message {
    position: absolute;
    bottom: ${CANDLE_H + 30}px;
    right: 0;
    width: 200px;
    padding: 9px 12px;
    background: var(--color-surface, #fffdf8);
    border: 1px solid var(--color-border, #ddd3bd);
    border-radius: var(--radius-md, 10px);
    box-shadow: var(--shadow-md, 0 3px 10px rgba(63,47,33,0.12));
    font-family: var(--font-hand, cursive);
    font-size: var(--text-sm, 13px);
    color: var(--color-text, #3a3226);
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.8s ease, transform 0.8s ease;
  }
  .candle-message.is-visible { opacity: 1; transform: translateY(-4px); }
  .candle-ambient-firefly { z-index: 32; }
  `;

  function minutesToMs(min) { return min * 60 * 1000; }

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    const reduced = MiscCore.prefersReducedMotion();

    const wrap = MiscCore.createEl('div', {
      className: 'candle-lamp-mount' + (reduced ? ' reduced-motion' : ''),
      attrs: { role: 'button', tabindex: '0', 'aria-label': 'candle' }
    });
    wrap.innerHTML =
      '<div class="candle-glow-pool"></div>' +
      '<canvas class="candle-art" aria-hidden="true"></canvas>' +
      '<div class="candle-message"></div>';

    const dimOverlay = MiscCore.createEl('div', { className: 'candle-dim-overlay' });
if (reduced) dimOverlay.style.transition = 'none';
        (options.dimTarget || document.body).appendChild(dimOverlay);
    container.appendChild(wrap);
    dimOverlay.addEventListener('click', function (e) {
      if (!focused) return;
      const r = wrap.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) wrap.click();
    });

    const artCanvas = wrap.querySelector('.candle-art');
    const glow = wrap.querySelector('.candle-glow-pool');
    const glowTex = buildGlowTexture();
    if (glowTex) glow.style.setProperty('--candle-glow', 'url(' + glowTex + ')');
    const messageEl = wrap.querySelector('.candle-message');
    const art = createArt(artCanvas, reduced);

    let lit = false;
    let flameDrop = 0;
    let expired = false;
    let focused = false;
    let expireCallbacks = [];
    let fireflySwarm = null;

    // --- Render loop: runs only while something is animating ------------
    const FRAME_MS = 1000 / 14;      // pixel-art cadence: ~14 steps per second
    let target = 0, df = 0, visualInit = false;
    let rafId = 0, running = false, lastDraw = 0, frame = 0;
    let igniteAt = 0, outAt = 0, wasLit = false, wasOut = false, groundA = 0, lastDropCss = -1;

    function requestRender() {
      if (running || !art) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }

    function loop(now) {
      rafId = 0;
      if (now - lastDraw < FRAME_MS - 1) { rafId = requestAnimationFrame(loop); return; }
      const dt = Math.min(0.25, (now - lastDraw) / 1000);
      lastDraw = now;
      frame++;

      if (lit && !wasLit) igniteAt = now;
      wasLit = lit;
      if (expired && !wasOut) outAt = now;
      wasOut = expired;

      const rawIgn = lit ? (reduced ? 1 : Math.min(1, (now - igniteAt) / 2600)) : 0;
      const ign = Math.round((1 - Math.pow(1 - rawIgn, 2.2)) * 12) / 12;   // stepped ease-out
      const burst = lit && !reduced ? Math.max(0, 1 - (now - igniteAt) / 700) : 0;

      const diff = target - df;
      if (Math.abs(diff) < 0.0008) df = target; else df += diff * Math.min(1, dt * 3.2);

      const groundGoal = wrap.classList.contains('is-lit') ? 1 : 0;
      groundA += (groundGoal - groundA) * Math.min(1, dt * 1.8);
      if (Math.abs(groundGoal - groundA) < 0.01) groundA = groundGoal;

      const dropCss = art.draw({
        df: df, lit: lit, out: expired, outT: (now - outAt) / 1000,
        ign: ign, burst: burst, t: now / 1000, frame: frame,
        groundA: groundA, still: reduced, fy: 0, lightI: 0, flick: 1
      });
      if (dropCss !== lastDropCss) {
        lastDropCss = dropCss;
        flameDrop = dropCss;
        glow.style.top = (40 + dropCss - GLOW / 2) + 'px';
      }

      const needs = lit ||
        (expired && !reduced && now - outAt < 5200) ||
        Math.abs(target - df) > 0.0008 ||
        Math.abs(groundGoal - groundA) > 0.01 ||
        art.hasEmbers();
      if (needs) rafId = requestAnimationFrame(loop); else running = false;
    }

    function spawnAmbientFireflies() {
      if (fireflySwarm || typeof Firefly === 'undefined' || reduced) return;
      fireflySwarm = Firefly.mount(options.dimTarget || document.body, { count: 14, magical: true });
      if (fireflySwarm && fireflySwarm.elements) {
        fireflySwarm.elements.forEach(function (el) { el.classList.add('candle-ambient-firefly'); });
      }
    }

    function clearAmbientFireflies() {
      if (fireflySwarm) { fireflySwarm.destroy(); fireflySwarm = null; }
    }

    // Centre the dim overlay's clear zone on the flame (not on the screen corner).
    function centerDimOnFlame() {
      const r = wrap.getBoundingClientRect();
      if (!r.width) return;
      dimOverlay.style.setProperty('--candle-x', (r.left + r.width * (CANDLE_W / 2) / CANDLE_W) + 'px');
      dimOverlay.style.setProperty('--candle-y', (r.top + r.height * (40 + flameDrop) / CANDLE_H) + 'px');
    }

    function trackDimCenter() {
      const t0 = performance.now();
      (function step() {
        centerDimOnFlame();
        if (performance.now() - t0 < 2600) requestAnimationFrame(step);
      })();
    }

    function syncDim() {
      const showing = focused && container.offsetParent !== null;
      if (showing) centerDimOnFlame();
      dimOverlay.classList.toggle('is-active', showing);
      document.body.classList.toggle('candle-scroll-lock', showing);
      if (showing) spawnAmbientFireflies(); else clearAmbientFireflies();
    }

    function setFocused(next) {
      focused = next;
      wrap.classList.toggle('is-focused', focused);
      trackDimCenter();
      document.body.classList.toggle('candle-scroll-lock', focused);
      syncDim();
    }

    function updateVisual(fraction) {
      fraction = MiscCore.clamp(fraction, 0, 1);
      target = fraction;
      if (fraction === 0 || !visualInit) df = fraction;   // resets and resumes jump, never animate
      visualInit = true;
      requestRender();
    }

    function persist(startedAt, durationMs) {
      State.set({ miscCandle: startedAt ? { lit: true, startedAt: startedAt, durationMs: durationMs } : null });
    }

    function tick() {
      syncDim();
      const saved = State.get().miscCandle;
      if (!lit || !saved || !saved.startedAt) return;
      const elapsed = TimeEngine.safeElapsed(saved.startedAt, Date.now());
      updateVisual(elapsed / saved.durationMs);
      if (elapsed >= saved.durationMs) finish(saved.durationMs);
    }

    function subscribeTick() {
      if (typeof TimeEngine === 'undefined' || !TimeEngine.subscribe) return;
      if (TimeEngine.unsubscribe) TimeEngine.unsubscribe(SUBSCRIBER_ID);
      TimeEngine.subscribe(tick, SUBSCRIBER_ID);
    }

    function unsubscribeTick() {
      if (typeof TimeEngine !== 'undefined' && TimeEngine.unsubscribe) TimeEngine.unsubscribe(SUBSCRIBER_ID);
    }

    function onKey(e) {
      if (e.key === 'Escape') closeAndReset();
    }

    function closeAndReset() {
      if (!lit) return;
      lit = false;
      wrap.classList.remove('is-lit');
      unsubscribeTick();
      document.removeEventListener('keydown', onKey);
      persist(null);
      wrap.classList.remove('is-out');
      messageEl.classList.remove('is-visible');
      updateVisual(0);
      setFocused(false);
      clearAmbientFireflies();
    }

    function ignite() {
      if (lit || expired) return;
      lit = true;
      updateVisual(0);
      const durationMs = minutesToMs(MiscCore.randInt(MIN_MINUTES, MAX_MINUTES));
      const startedAt = Date.now();
      persist(startedAt, durationMs);
      if (typeof MiscSound !== 'undefined') MiscSound.play('candleIgnite');
      wrap.classList.add('is-lit');
      subscribeTick();
      document.addEventListener('keydown', onKey);
      setFocused(true);
      spawnAmbientFireflies();
    }

    function finish(durationMs) {
      if (expired) return;
      expired = true;
      lit = false;
      unsubscribeTick();
      document.removeEventListener('keydown', onKey);
      setFocused(false);
      clearAmbientFireflies();
      const elapsedMs = TimeEngine.safeMs(durationMs);
      if (elapsedMs > 0) {
        TimeEngine.recordStandaloneStudy(elapsedMs, 'candle');
        if (typeof GamificationData !== 'undefined' && GamificationData.awardStudyTime) {
          GamificationData.awardStudyTime(elapsedMs, 'candle');
        }
        // Same visible Study log entry a Stopwatch/Timer run gets on completion (study.js's
        // saveClockAndReset/autoCompleteTimer) — the SAME TimeEngine.pushLog call, not a second
        // logging system, so Candle time shows up in the Study tab's log exactly like normal
        // Study timer time.
        if (typeof TimeEngine.pushLog === 'function') TimeEngine.pushLog(todayStr(), 'Candle', elapsedMs, 'min');
      }
      persist(null);
      wrap.classList.add('is-out');
      updateVisual(1);
      messageEl.textContent = options.expireMessage || 'Study completed \u2014 the candle has burned down.';
      messageEl.classList.add('is-visible');
      setTimeout(function () { messageEl.classList.remove('is-visible'); }, 8000);
      expireCallbacks.forEach(function (cb) { try { cb(); } catch (e) { /* one bad callback shouldn't break the rest */ } });
    }

    function resetForRelight() {
      if (!expired) return;
      expired = false;
      wrap.classList.remove('is-lit');
      wrap.classList.remove('is-out');
      messageEl.classList.remove('is-visible');
      updateVisual(0);
      setFocused(false);
    }

    wrap.addEventListener('click', function () {
      if (expired) { resetForRelight(); return; }
      if (!lit) { ignite(); return; }
      closeAndReset();
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.click(); }
    });

    // Resume a hidden session that was already burning before a reload.
    (function resume() {
      const saved = State.get().miscCandle;
      if (!saved || !saved.lit || !saved.startedAt || !saved.durationMs) return;
      lit = true;
      const elapsed = TimeEngine.safeElapsed(saved.startedAt, Date.now());
      if (elapsed >= saved.durationMs) { finish(saved.durationMs); return; }
      updateVisual(elapsed / saved.durationMs);
      wrap.classList.add('is-lit');
      subscribeTick();
      document.addEventListener('keydown', onKey);
      setFocused(true);
      spawnAmbientFireflies();
    })();

    requestRender();

    return {
      element: wrap,
      isLit: function () { return lit; },
      setFocused: setFocused,
      onExpire: function (cb) { expireCallbacks.push(cb); },
      destroy: function () {
        unsubscribeTick();
        document.removeEventListener('keydown', onKey);
        clearAmbientFireflies();
        if (rafId) cancelAnimationFrame(rafId);
        running = false;
        document.body.classList.remove('candle-scroll-lock');
        wrap.remove();
        dimOverlay.remove();
      }
    };
  }

  return { mount: mount };
})();
