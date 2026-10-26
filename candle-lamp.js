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
 * The candle is drawn as pixel art on a strict 4px grid (PX): hard-stop
 * colour bands, stepped corners, sprite-built flame frames and an
 * ordered-dither glow texture — no smooth gradients or blur.
 *
 * The melt visual (shrinking base, rim drips trailing the melting top,
 * a growing puddle) is our own CSS-in-JS implementation, adapted from
 * an open-source Sass candle animation the project owner supplied as a
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
  const PX = 4;          // px — one art pixel
  const GLOW = 1504;     // px — glow pool size (188 cells of 8px)
  const GLOW_CELL = 8;   // px — one glow cell (2 art pixels)
  const FULL_H = 180;    // px — unmelted body height (grid-snapped)
  const MIN_H = 24;      // px — fully melted body height (grid-snapped)

  function snap(v) { return Math.round(v / PX) * PX; }

  // --- Flame sprite frames (8 x 16 art pixels) -------------------------
  const FLAME_COLORS = { r: '#e8611a', o: '#ff8c26', m: '#ffc94d', c: '#fff1b0', w: '#fffdf0' };
  const FLAME_A = [
    '...rr...', '...oo...', '..oooo..', '..oooo..',
    '..ommo..', '.oommoo.', '.ommmmo.', '.ommmmo.',
    'ommccmmo', 'ommccmmo', 'ommcwcmo', 'ommcwcmo',
    '.omccmo.', '.ommmmo.', '..oooo..', '...oo...'
  ];
  const FLAME_B = [
    '........', '..rr....', '..oooo..', '..ooooo.',
    '.oommo..', '.oommoo.', '.ommmmo.', '.ommmmo.',
    'ommccmmo', 'ommccmmo', 'ommcwcmo', 'ommcwcmo',
    '.omccmo.', '.ommmmo.', '..oooo..', '...oo...'
  ];
  const FLAME_C = [
    '....rr..', '...oo...', '...ooo..', '..oooo..',
    '..ommoo.', '.oommoo.', '.ommmmo.', '.ommmmo.',
    'ommccmmo', 'ommccmmo', 'ommcwcmo', 'ommcwcmo',
    '.omccmo.', '.ommmmo.', '..oooo..', '...oo...'
  ];

  function spriteShadow(rows) {
    const out = [];
    rows.forEach(function (row, y) {
      for (let x = 0; x < row.length; x++) {
        const ch = row.charAt(x);
        if (ch !== '.') out.push((x * PX) + 'px ' + (y * PX) + 'px 0 0 ' + FLAME_COLORS[ch]);
      }
    });
    return out.join(',');
  }

  function mod(n, m) { return ((n % m) + m) % m; }

  // Warm glow around the flame: discrete, stippled 4px clusters.
  function haloShadow() {
    const out = [];
    for (let y = -1; y <= 17; y++) {
      for (let x = -4; x <= 11; x++) {
        const d = Math.hypot((x + 0.5 - 4) / 7, (y + 0.5 - 8) / 9.5);
        let a = 0;
        if (d < 0.62) a = 0.3;
        else if (d < 0.85) a = mod(x + y, 2) === 0 ? 0.24 : 0;
        else if (d < 1.15) a = mod(x + 2 * y, 4) === 0 ? 0.15 : 0;
        if (a > 0) out.push((x * PX) + 'px ' + (y * PX) + 'px 0 0 rgba(255,170,70,' + a + ')');
      }
    }
    return out.join(',');
  }

  const FLAME_SHADOW_A = spriteShadow(FLAME_A);
  const FLAME_SHADOW_B = spriteShadow(FLAME_B);
  const FLAME_SHADOW_C = spriteShadow(FLAME_C);
  const HALO_SHADOW = haloShadow();

  // --- Glow texture: ordered-dither, 4 alpha tiers, baked once ----------
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
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const tiers = [null, [255, 130, 50], [255, 145, 65], [255, 160, 80], [255, 176, 92]];
      const half = N / 2;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
          let a;
          if (d < 0.36) a = 0.55 - 0.33 * (d / 0.36);
          else if (d < 0.67) a = 0.22 - 0.15 * ((d - 0.36) / 0.31);
          else if (d < 1) a = 0.07 * (1 - (d - 0.67) / 0.33);
          else a = 0;
          const sc = a / 0.55 * 4;
          const fl = Math.floor(sc);
          const lvl = fl + ((sc - fl) > (bayer[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? 1 : 0);
          if (lvl <= 0) continue;
          const col = tiers[Math.min(4, lvl)];
          const i = (y * N + x) * 4;
          img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2];
          img.data[i + 3] = Math.round(lvl / 4 * 0.55 * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      glowURL = c.toDataURL();
    } catch (e) { glowURL = ''; }
    return glowURL;
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
  .candle-glow-pool {
    position: absolute;
    z-index: 0;
    width: ${GLOW}px;
    height: ${GLOW}px;
    left: 50%;
    margin-left: -${GLOW / 2}px;
    top: ${40 - GLOW / 2}px;
    transform: scale(0.2);
    background-size: 100% 100%;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
    opacity: 0;
    transition: opacity 2s ease, transform 2.2s cubic-bezier(0.22, 0.61, 0.36, 1), top 1.2s steps(3, end);
    pointer-events: none;
  }
  .candle-lamp-mount.no-anim .candle-base,
  .candle-lamp-mount.no-anim .candle-riders,
  .candle-lamp-mount.no-anim .candle-blob,
  .candle-lamp-mount.no-anim .candle-puddle { transition: none !important; }
  .candle-lamp-mount.no-anim .candle-glow-pool { transition: opacity 2s ease, transform 2.2s cubic-bezier(0.22, 0.61, 0.36, 1); }
  .candle-lamp-mount.is-focused .candle-glow-pool { opacity: 1; transform: scale(1); }
  .candle-lamp-mount.is-out .candle-glow-pool { opacity: 0; }

  .candle-scene { position: relative; z-index: 1; width: ${CANDLE_W}px; height: ${CANDLE_H}px; overflow: hidden; }
  .candle-riders { position: absolute; inset: 0; transition: transform 1.2s steps(3, end); }

  /* Body: hard-stop colour bands on the 4px grid, no smooth shading. */
  .candle-base {
    position: absolute;
    bottom: 0; left: 4px;
    width: ${CANDLE_W - 8}px;
    height: ${FULL_H}px;
    background: linear-gradient(90deg,
      #8a7350 0, #8a7350 4px,
      #cdb894 4px, #cdb894 12px,
      #f6ecd4 12px, #f6ecd4 24px,
      #fffaf0 24px, #fffaf0 48px,
      #efe2c4 48px, #efe2c4 68px,
      #dccaa2 68px, #dccaa2 84px,
      #c7b088 84px, #c7b088 92px,
      #8a7350 92px, #8a7350 100%);
    transition: height 1.2s steps(3, end);
  }
  /* Lit: the wax is warmed by the flame, so the body reads bright against the dark. */
  .candle-lamp-mount.is-lit:not(.is-out) .candle-base {
    background-image:
      repeating-conic-gradient(rgba(255,214,130,0.55) 0 25%, transparent 0 50%),
      linear-gradient(90deg,
        #a68a5c 0, #a68a5c 4px,
        #e2c78f 4px, #e2c78f 12px,
        #fbeccb 12px, #fbeccb 24px,
        #fffdf3 24px, #fffdf3 48px,
        #f6e6bb 48px, #f6e6bb 68px,
        #ecd5a2 68px, #ecd5a2 84px,
        #d3b67e 84px, #d3b67e 92px,
        #a68a5c 92px, #a68a5c 100%);
    background-size: 8px 8px, 100% 100%;
    background-position: 0 8px, 0 0;
    background-repeat: repeat-x, no-repeat;
  }
  /* Molten top: stepped oval, banded colours. */
  .candle-base::before {
    content: "";
    position: absolute;
    top: -8px; left: 0; right: 0;
    height: 16px;
    background:
      linear-gradient(180deg, transparent 0, transparent 12px, rgba(138,115,80,0.45) 12px),
      linear-gradient(90deg,
        #d8bf86 0, #d8bf86 8px,
        #f7d99b 8px, #f7d99b 24px,
        #ffe2a0 24px, #ffe2a0 72px,
        #f7d99b 72px, #f7d99b 88px,
        #d8bf86 88px, #d8bf86 100%);
    clip-path: polygon(8px 0, calc(100% - 8px) 0, calc(100% - 8px) 4px, 100% 4px, 100% 12px, calc(100% - 8px) 12px, calc(100% - 8px) 16px, 8px 16px, 8px 12px, 0 12px, 0 4px, 8px 4px);
  }
  /* Wax specks: single art pixels. */
  .candle-base::after {
    content: "";
    position: absolute;
    top: 0; left: 0;
    width: ${PX}px; height: ${PX}px;
    box-shadow:
      28px 40px 0 0 #e6d6b2, 60px 76px 0 0 #e6d6b2, 44px 112px 0 0 #fff6dc,
      16px 140px 0 0 #dccaa2, 72px 24px 0 0 #fff6dc, 68px 148px 0 0 #d3c09a;
  }

  /* Drips: banded columns with a stepped bulb. */
  .candle-blob {
    position: absolute;
    top: ${CANDLE_H * 0.3 + 2}px;
    width: 16px; height: 0;
    opacity: 0;
    background: linear-gradient(90deg, #cdb894 0, #cdb894 4px, #fffaf0 4px, #fffaf0 12px, #e6d6b2 12px, #e6d6b2 100%);
    transition: height 1.2s steps(3, end), opacity 0.6s steps(2, end);
  }
  .candle-blob::after {
    content: "";
    position: absolute;
    left: 0; bottom: -4px;
    width: 16px; height: 8px;
    background: linear-gradient(90deg, #cdb894 0, #cdb894 4px, #fffaf0 4px, #fffaf0 12px, #e6d6b2 12px, #e6d6b2 100%);
    clip-path: polygon(0 0, 100% 0, 100% 4px, calc(100% - 4px) 4px, calc(100% - 4px) 100%, 4px 100%, 4px 4px, 0 4px);
  }
  .candle-blob[data-i="0"] { left: 8px; }
  .candle-blob[data-i="1"] { left: 32px; }
  .candle-blob[data-i="2"] { left: 56px; }
  .candle-blob[data-i="3"] { left: 80px; }

  .candle-wick {
    position: absolute;
    top: ${CANDLE_H * 0.2}px;
    left: 48px;
    width: ${PX}px; height: ${FULL_H - CANDLE_H * 0.2 - 100}px;
    background: linear-gradient(180deg, #1c130c 0, #1c130c 4px, #4a3421 4px, #4a3421 20px, #3a2a1a 20px, #3a2a1a 100%);
  }
  @keyframes candleIgnite {
    0% { transform: translateX(-50%) scale(0.05); opacity: 0; }
    55% { transform: translateX(-50%) scale(0.75); opacity: 1; }
    100% { transform: translateX(-50%) scale(1); opacity: 1; }
  }
  .candle-lamp-mount.is-lit .candle-flame {
    display: block;
    animation: candleIgnite 2.6s steps(8, end) 1 both, candleFlicker 3.4s step-end 2.6s infinite;
  }
  /* Flame: transparent 32x64 box; the art lives in box-shadow sprites. */
  .candle-flame {
    display: none;
    position: absolute;
    top: 4px; left: 50%;
    width: 32px; height: 64px;
    transform: translateX(-50%);
    transform-origin: 50% 100%;
    transition: opacity 0.9s steps(6, end);
  }
  .candle-flame::before {
    content: "";
    position: absolute;
    left: 0; top: 0;
    width: ${PX}px; height: ${PX}px;
    z-index: 1;
    box-shadow: ${FLAME_SHADOW_A};
    animation: candleFlamePx 1.6s step-end infinite;
  }
  .candle-flame::after {
    content: "";
    position: absolute;
    left: 0; top: 0;
    width: ${PX}px; height: ${PX}px;
    z-index: -1;
    box-shadow: ${HALO_SHADOW};
  }
  @keyframes candleFlamePx {
    0% { box-shadow: ${FLAME_SHADOW_A}; }
    28% { box-shadow: ${FLAME_SHADOW_B}; }
    46% { box-shadow: ${FLAME_SHADOW_A}; }
    70% { box-shadow: ${FLAME_SHADOW_C}; }
    84% { box-shadow: ${FLAME_SHADOW_A}; }
    100% { box-shadow: ${FLAME_SHADOW_A}; }
  }
  .candle-lamp-mount.reduced-motion .candle-flame,
  .candle-lamp-mount.reduced-motion .candle-flame::before,
  .candle-lamp-mount.reduced-motion .candle-spark { animation: none; }
  .candle-lamp-mount.reduced-motion, .candle-lamp-mount.reduced-motion * { transition-duration: 0.01s !important; }
  .candle-lamp-mount.is-out .candle-flame,
  .candle-lamp-mount.is-out .candle-spark { display: none; }
  .candle-spark {
    position: absolute;
    bottom: 8px; left: 12px;
    width: ${PX}px; height: ${PX}px;
    background: #ffe27a;
    opacity: 0;
    animation: candleSpark 2.6s steps(6, end) infinite;
  }
  @keyframes candleFlicker {
    0%, 100% { transform: translateX(-50%); }
    52% { transform: translateX(calc(-50% - 4px)); }
    60% { transform: translateX(-50%); }
    82% { transform: translateX(calc(-50% + 4px)); }
    88% { transform: translateX(-50%); }
  }
  @keyframes candleSpark {
    0% { transform: translate(0, 0); opacity: 0; }
    15% { opacity: 0.5; }
    35% { opacity: 0.75; }
    80% { opacity: 0.2; }
    100% { transform: translate(4px, -48px); opacity: 0; }
  }

  /* Ground shadow: flat colour, stepped oval. */
  .candle-ground-shadow {
    position: absolute;
    z-index: 0;
    bottom: 0;
    left: 50%;
    width: 176px;
    height: 16px;
    transform: translateX(-50%) scaleX(0.6);
    background: rgba(60,42,22,0.26);
    clip-path: polygon(24px 0, calc(100% - 24px) 0, calc(100% - 24px) 4px, calc(100% - 8px) 4px, calc(100% - 8px) 12px, calc(100% - 24px) 12px, calc(100% - 24px) 16px, 24px 16px, 24px 12px, 8px 12px, 8px 4px, 24px 4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 1.8s ease, transform 1.8s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .candle-lamp-mount.is-lit .candle-ground-shadow { opacity: 1; transform: translateX(-50%) scaleX(1); }
  .candle-puddle {
    position: absolute;
    z-index: 0;
    bottom: 0;
    left: 50%;
    width: ${CANDLE_W}px;
    height: 0;
    background: linear-gradient(180deg, #fff6dc 0, #fff6dc 4px, #ecdcb6 4px, #ecdcb6 calc(100% - 4px), #d9c4a3 calc(100% - 4px), #d9c4a3 100%);
    clip-path: polygon(4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px), 0 4px, 4px 4px);
    transform: translateX(-50%);
    transition: width 1.2s steps(3, end), height 1.2s steps(3, end);
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
      '<div class="candle-ground-shadow"></div>' +
      '<div class="candle-puddle"></div>' +
      '<div class="candle-scene">' +
      '<div class="candle-base"></div>' +
      '<div class="candle-riders">' +
      '<div class="candle-blob" data-i="0"></div>' +
      '<div class="candle-blob" data-i="1"></div>' +
      '<div class="candle-blob" data-i="2"></div>' +
      '<div class="candle-blob" data-i="3"></div>' +
      '<div class="candle-wick"></div>' +
      '<div class="candle-flame">' +
      '<div class="candle-spark" style="animation-delay:-0.1s"></div>' +
      '<div class="candle-spark" style="animation-delay:-0.5s"></div>' +
      '<div class="candle-spark" style="animation-delay:-0.9s"></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
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

    const base = wrap.querySelector('.candle-base');
    
    const blobs = wrap.querySelectorAll('.candle-blob');
    const puddle = wrap.querySelector('.candle-puddle');
    const flame = wrap.querySelector('.candle-flame');
    const riders = wrap.querySelector('.candle-riders');
    const wick = wrap.querySelector('.candle-wick');
    const glow = wrap.querySelector('.candle-glow-pool');
    const glowTex = buildGlowTexture();
    if (glowTex) glow.style.backgroundImage = 'url(' + glowTex + ')';
    const messageEl = wrap.querySelector('.candle-message');

    let lit = false;
    let flameDrop = 0;
    let expired = false;
    let focused = false;
    let expireCallbacks = [];
    let fireflySwarm = null;

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
      if (fraction === 0) {
        wrap.classList.add('no-anim');
        requestAnimationFrame(function () { requestAnimationFrame(function () { wrap.classList.remove('no-anim'); }); });
      }
      const baseH = snap(FULL_H - (FULL_H - MIN_H) * fraction);
      base.style.height = baseH + 'px';
      const drop = FULL_H - baseH;
      flameDrop = drop;
      riders.style.transform = 'translateY(' + drop + 'px)';
      glow.style.top = (40 + drop - GLOW / 2) + 'px';
      const wickFull = FULL_H - CANDLE_H * 0.2 - 100;
      const wickCut = snap(CANDLE_H * 0.05 * fraction);
      wick.style.height = (wickFull - wickCut) + 'px';
      wick.style.marginTop = wickCut + 'px';
      const reach = [0.5, 0.85, 0.35, 0.65];
      blobs.forEach(function (blob, i) {
        const len = snap(Math.max(0, Math.min(Math.max(0, fraction - 0.06 * (i + 1)) * reach[i % 4] * FULL_H * 1.3, baseH - 12)));
        blob.style.height = len + 'px';
        blob.style.opacity = len > 2 ? '1' : '0';
      });
      const puddleT = MiscCore.clamp((fraction - 0.15) / 0.85, 0, 1);
      puddle.style.width = (Math.round(CANDLE_W * (1 + 0.9 * puddleT) / 8) * 8) + 'px';
      puddle.style.height = snap(18 * puddleT) + 'px';
      flame.style.opacity = String(1 - fraction * 0.35);
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

    return {
      element: wrap,
      isLit: function () { return lit; },
      setFocused: setFocused,
      onExpire: function (cb) { expireCallbacks.push(cb); },
      destroy: function () {
        unsubscribeTick();
        document.removeEventListener('keydown', onKey);
        clearAmbientFireflies();
        document.body.classList.remove('candle-scroll-lock');
        wrap.remove();
        dimOverlay.remove();
      }
    };
  }

  return { mount: mount };
})();
