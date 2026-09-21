/*
 * Lavender — Ladybug.
 *
 * A persistent, ambient little creature living in #misc-ambient-layer
 * (position:fixed, viewport-spanning). It wanders, faces its direction
 * of travel, gets startled by the cursor, gets excited on click, climbs
 * buttons and occasionally slips off them, can walk off any screen edge
 * and later re-enter from another, orbits the lit Study candle, and
 * naps in place. Every state transition eases out of the creature's
 * current position/velocity/facing rather than snapping, so it always
 * reads as one continuous animal.
 *
 * Usage:
 *   const bug = Ladybug.mount(container);
 *   bug.destroy(); // stops the loop and removes it
 */
const Ladybug = (function () {
  const STYLE_ID = 'misc-ladybug-style';

  // ---- Tunables ---------------------------------------------------------
  const SIZE = 14;                 // px, base sprite width (height ~ 11/14 of this)
  const WALK_SPEED = 16;           // px/sec, normal ground speed
  const EXCITED_SPEED = 46;        // px/sec, speed right after a click
  const FLEE_SPEED = 58;           // px/sec, running from the cursor
  const FLY_SPEED = 34;            // px/sec, cross-screen / edge travel
  const ORBIT_SPEED = 0.9;         // radians/sec around the candle flame
  const ORBIT_RADIUS = 26;         // px, distance kept from the flame
  const CURSOR_NOTICE_RADIUS = 46; // px, distance at which the cursor can startle it
  const CURSOR_NOTICE_CHANCE = 0.018; // per-tick chance to actually notice, once in range
  const EXCITED_MS = 4200;
  const FLEE_MS_MIN = 1400;
  const FLEE_MS_MAX = 2600;
  const SCARE_REACT_MS = 340;
  const SLEEP_CHANCE_PER_PAUSE = 0.12;
  const SLEEP_MS_MIN = 9000;
  const SLEEP_MS_MAX = 22000;
  const GRIP_LOSE_CHANCE_PER_SEC = 0.006; // while climbing on a button
  const EDGE_EXIT_CHANCE_PER_PAUSE = 0.05;
  const PETAL_CARRY_CHANCE = 0.16;

  // -- Fidget / liveliness tunables (kept separate for easy re-balancing) --
  const FIDGET_CHANCE_PER_PAUSE = 0.4;      // chance a given pause includes a small fidget
  const FIDGET_MIN_GAP_MS = 2000;           // floor between two fidgets, so they don't stack
  const ALERT_CHANCE_PER_PAUSE = 0.02;      // rare "what was that?" trigger when idle
  const ALERT_DURING_WALK_CHANCE = 0.015;   // per second of walking, chance to stop startled
  const BURST_CHANCE_PER_PAUSE = 0.045;     // rare short scurry of energy
  const WATCH_INSTEAD_OF_FLEE_CHANCE = 0.4; // chance to watch the cursor instead of fleeing
  const WATCH_MS_MIN = 900;
  const WATCH_MS_MAX = 2200;
  const EDGE_HESITATE_MS_MIN = 380;         // pause-and-look-back before actually exiting
  const EDGE_HESITATE_MS_MAX = 900;
  const PACE_CHANCE = 0.4;                  // chance a walk opens with a couple small paces
  const GLANCE_BACK_CHANCE_PER_SEC = 0.05;  // while walking, brief look back over the path
  const BALANCE_CHANCE_PER_SEC = 0.8;       // only rolled while near a climb-sway extreme

  const CSS = `
  .ladybug-layer-pos { position: fixed; left: 0; top: 0; will-change: transform; }
  .ladybug {
    width: ${SIZE}px;
    height: ${Math.round(SIZE * 11 / 14)}px;
    cursor: pointer;
    pointer-events: auto;
    transform-origin: 50% 60%;
  }
  .ladybug-body {
    width: 100%;
    height: 100%;
    display: block;
    transform-origin: 50% 60%;
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .ladybug-body.facing-left { transform: scaleX(-1); }
  .ladybug svg { width: 100%; height: 100%; display: block; overflow: visible; }

  .ladybug-wings {
    transform-origin: 7px 5px;
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .ladybug.is-flying .ladybug-wings,
  .ladybug.is-fleeing .ladybug-wings,
  .ladybug.is-excited.is-airborne .ladybug-wings,
  .ladybug.is-orbiting .ladybug-wings { opacity: 1; }
  @keyframes ladybugFlutter {
    0%, 100% { transform: scaleY(1) translateY(0); }
    50% { transform: scaleY(0.55) translateY(-0.5px); }
  }
  .ladybug.is-flying .ladybug-wings,
  .ladybug.is-fleeing .ladybug-wings,
  .ladybug.is-orbiting .ladybug-wings {
    animation: ladybugFlutter 0.11s linear infinite;
  }
  @keyframes ladybugTakeoff {
    0% { transform: scaleY(0.15); opacity: 0; }
    100% { transform: scaleY(1); opacity: 1; }
  }
  .ladybug.is-taking-off .ladybug-wings { animation: ladybugTakeoff 0.32s ease-out both, ladybugFlutter 0.11s linear infinite 0.32s; }

  .ladybug-legs { transform-origin: 7px 6px; }
  @keyframes ladybugWalk {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(2.5deg); }
  }
  .ladybug.is-walking .ladybug-legs,
  .ladybug.is-climbing .ladybug-legs { animation: ladybugWalk 0.28s ease-in-out infinite; }
  .ladybug.is-fleeing .ladybug-legs,
  .ladybug.is-excited .ladybug-legs { animation: ladybugWalk 0.14s ease-in-out infinite; }

  .ladybug.is-scared .ladybug-body { animation: ladybugScareJolt 0.34s ease-out; }
  @keyframes ladybugScareJolt {
    0% { transform: translateY(0) scale(1); }
    30% { transform: translateY(-2.5px) scale(1.08, 0.9); }
    55% { transform: translateY(0.5px) scale(0.95, 1.06); }
    100% { transform: translateY(0) scale(1); }
  }

  .ladybug.is-excited .ladybug-body { animation: ladybugExcitedBob 0.22s ease-in-out infinite; }
  @keyframes ladybugExcitedBob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-1.2px); }
  }

  .ladybug.is-falling .ladybug-body { animation: ladybugTumble 0.5s ease-in; }
  @keyframes ladybugTumble {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(210deg); }
  }

  .ladybug.is-sleeping .ladybug-body { animation: ladybugSleepBreathe 3.4s ease-in-out infinite; }
  @keyframes ladybugSleepBreathe {
    0%, 100% { transform: rotate(4deg) scale(0.96); }
    50% { transform: rotate(6deg) scale(0.965); }
  }
  .ladybug-zzz {
    position: absolute;
    left: 60%;
    top: -2px;
    font-size: 5px;
    font-family: Georgia, serif;
    color: rgba(90, 70, 70, 0.55);
    opacity: 0;
    pointer-events: none;
    user-select: none;
  }
  .ladybug.is-sleeping .ladybug-zzz { animation: ladybugZzz 2.6s ease-in-out infinite; }
  @keyframes ladybugZzz {
    0% { opacity: 0; transform: translate(0, 0) scale(0.7); }
    15% { opacity: 0.7; }
    70% { opacity: 0.35; transform: translate(4px, -7px) scale(1); }
    100% { opacity: 0; transform: translate(6px, -10px) scale(1.05); }
  }

  .ladybug-petal {
    position: absolute;
    left: -6px;
    top: 2px;
    width: 5px;
    height: 5px;
    opacity: 0;
    transform-origin: 50% 50%;
  }
  .ladybug.is-carrying .ladybug-petal { opacity: 0.95; animation: ladybugPetalSway 1.4s ease-in-out infinite; }
  @keyframes ladybugPetalSway {
    0%, 100% { transform: rotate(-8deg) translateY(0); }
    50% { transform: rotate(8deg) translateY(-0.6px); }
  }

  .ladybug-sparkle {
    position: fixed;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff2c4 0%, #ffcf5c 60%, rgba(255,207,92,0) 100%);
    pointer-events: none;
    z-index: 3;
    animation: ladybugSparklePop 0.55s ease-out forwards;
  }
  @keyframes ladybugSparklePop {
    0% { transform: translate(0, 0) scale(0.4); opacity: 1; }
    100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
  }

  /* ---- Fidget & alertness additions (subtle, low-frequency liveliness) ---- */
  .ladybug-antennae { transform-origin: 7px 1px; }
  .ladybug.is-sleeping .ladybug-antennae {
    transform: rotate(18deg);
    opacity: 0.65;
    transition: transform 0.6s ease, opacity 0.6s ease;
  }

  @keyframes ladybugAntennaeTwitch {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(-9deg); }
  }
  .ladybug.is-fidget-antennae .ladybug-antennae { animation: ladybugAntennaeTwitch 0.22s ease-in-out 2; }
  .ladybug.is-watching .ladybug-antennae,
  .ladybug.is-alert-react .ladybug-antennae,
  .ladybug.is-alert-look .ladybug-antennae { animation: ladybugAntennaeTwitch 0.4s ease-in-out infinite; }

  .ladybug.is-fidget-shuffle .ladybug-legs { animation: ladybugWalk 0.2s ease-in-out 3; }

  @keyframes ladybugWingTest {
    0%, 100% { transform: scaleY(1); opacity: 0; }
    20%, 80% { opacity: 0.85; }
    50% { transform: scaleY(0.5); opacity: 0.85; }
  }
  .ladybug.is-fidget-wingtest .ladybug-wings { animation: ladybugWingTest 0.6s ease-in-out; }

  @keyframes ladybugGroom {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-10deg); }
    50% { transform: rotate(4deg); }
    75% { transform: rotate(-6deg); }
  }
  .ladybug.is-fidget-groom .ladybug-legs { animation: ladybugGroom 0.7s ease-in-out; }

  @keyframes ladybugLookAround {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-7deg); }
    55% { transform: rotate(6deg); }
    80% { transform: rotate(-3deg); }
  }
  .ladybug.is-fidget-look .ladybug-body,
  .ladybug.is-alert-look .ladybug-body { animation: ladybugLookAround 0.85s ease-in-out; }

  @keyframes ladybugDrowsyNod {
    0%, 100% { transform: rotate(0deg) translateY(0); }
    45% { transform: rotate(6deg) translateY(1.2px); }
  }
  .ladybug.is-fidget-drowsy .ladybug-body { animation: ladybugDrowsyNod 0.9s ease-in-out; }
  .ladybug.is-fidget-drowsy .ladybug-antennae { animation: ladybugDrowsyNod 0.9s ease-in-out; }

  @keyframes ladybugPetalAdjust {
    0%, 100% { transform: rotate(-8deg) translateY(0) scale(1); }
    50% { transform: rotate(14deg) translateY(-1.4px) scale(1.08); }
  }
  .ladybug.is-fidget-petal .ladybug-petal { animation: ladybugPetalAdjust 0.55s ease-in-out; }

  .ladybug.is-watching .ladybug-body { transform: scale(1.04); }

  .ladybug.is-bursting .ladybug-legs { animation: ladybugWalk 0.12s ease-in-out infinite; }
  @keyframes ladybugBurstLean {
    0%, 100% { transform: scaleX(1); }
    50% { transform: scaleX(1.06); }
  }
  .ladybug.is-bursting .ladybug-body { animation: ladybugBurstLean 0.18s ease-in-out infinite; }

  .ladybug.is-alert-react .ladybug-body { animation: ladybugScareJolt 0.3s ease-out; }
  .ladybug.is-alert-investigate .ladybug-legs { animation: ladybugWalk 0.22s ease-in-out infinite; }

  @keyframes ladybugBalanceWobble {
    0%, 100% { transform: rotate(0deg); }
    30% { transform: rotate(-6deg); }
    65% { transform: rotate(5deg); }
  }
  .ladybug.is-balancing .ladybug-body { animation: ladybugBalanceWobble 0.26s ease-in-out; }

  @keyframes ladybugQuickGlance {
    0%, 100% { transform: scale(1); }
    40% { transform: scale(1.03); }
  }
  .ladybug.is-glancing-back .ladybug-body { animation: ladybugQuickGlance 0.4s ease-in-out; }

  .ladybug.reduced-motion,
  .ladybug.reduced-motion * { animation: none !important; transition: transform 0.2s ease !important; }
  `;

  function svgMarkup() {
    return (
      '<svg viewBox="0 0 14 11" xmlns="http://www.w3.org/2000/svg">' +
        '<g class="ladybug-wings">' +
          '<ellipse cx="4.5" cy="4" rx="3.6" ry="4.6" fill="rgba(255,255,255,0.55)" stroke="rgba(120,110,110,0.4)" stroke-width="0.2"/>' +
          '<ellipse cx="9.5" cy="4" rx="3.6" ry="4.6" fill="rgba(255,255,255,0.55)" stroke="rgba(120,110,110,0.4)" stroke-width="0.2"/>' +
        '</g>' +
        '<g class="ladybug-legs" stroke="#3a2b2b" stroke-width="0.5" stroke-linecap="round">' +
          '<path d="M3 5 L0.8 3.6 M3 7 L0.6 7.4 M11 5 L13.2 3.6 M11 7 L13.4 7.4 M4 8.3 L2.6 10 M10 8.3 L11.4 10"/>' +
        '</g>' +
        '<ellipse cx="7" cy="6" rx="6" ry="5" fill="#d94f4f"/>' +
        '<path d="M7 1 V11" stroke="#3a2b2b" stroke-width="0.6"/>' +
        '<circle cx="4.5" cy="4.5" r="0.9" fill="#3a2b2b"/>' +
        '<circle cx="9.5" cy="4.5" r="0.9" fill="#3a2b2b"/>' +
        '<circle cx="5" cy="8" r="0.8" fill="#3a2b2b"/>' +
        '<circle cx="9" cy="8" r="0.8" fill="#3a2b2b"/>' +
        '<circle cx="7" cy="1.6" r="1.6" fill="#2b2020"/>' +
        '<g class="ladybug-antennae" stroke="#3a2b2b" stroke-width="0.45" stroke-linecap="round" fill="none">' +
          '<path d="M6.3 0.7 C5.6 -0.3 5 -0.9 4.6 -1.2"/>' +
          '<path d="M7.7 0.7 C8.4 -0.3 9 -0.9 9.4 -1.2"/>' +
        '</g>' +
      '</svg>'
    );
  }

  function petalMarkup() {
    return '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 0 C8 1 9 4 5 10 C1 4 2 1 5 0 Z" fill="#f4a6c8" stroke="#e488b0" stroke-width="0.4"/>' +
      '</svg>';
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
    return true;
  }

  function findClimbTargets() {
    const nodes = document.querySelectorAll('#main-nav .nav-btn, #utility-drawer button, #app-header button, header button');
    const out = [];
    nodes.forEach(function (el) {
      if (isVisible(el)) out.push(el);
    });
    return out;
  }

  function findLitCandle() {
    const studyScreen = document.getElementById('screen-study');
    if (!studyScreen || getComputedStyle(studyScreen).display === 'none') return null;
    const mount = document.querySelector('.candle-lamp-mount.is-lit');
    if (!mount || !isVisible(mount)) return null;
    return mount;
  }

  function candleFlamePoint(mount) {
    // The flame sits near the top-center of the scaled candle scene;
    // reading the live rect keeps this correct through the mount's own
    // scale/position transitions instead of hardcoding pixel math.
    const rect = mount.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.12 };
  }

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    const reduced = MiscCore.prefersReducedMotion();

    const el = MiscCore.createEl('div', {
      className: 'ladybug ladybug-layer-pos',
      attrs: { role: 'button', tabindex: '0', 'aria-label': 'ladybug' }
    });
    const body = MiscCore.createEl('div', { className: 'ladybug-body', html: svgMarkup() });
    const zzz = MiscCore.createEl('div', { className: 'ladybug-zzz', text: 'z z z' });
    const petal = MiscCore.createEl('div', { className: 'ladybug-petal', html: petalMarkup() });
    el.appendChild(body);
    el.appendChild(zzz);
    el.appendChild(petal);
    container.appendChild(el);

    // ---- Physical state -------------------------------------------------
    const vw = function () { return window.innerWidth; };
    const vh = function () { return window.innerHeight; };
    let x = MiscCore.rand(vw() * 0.1, vw() * 0.85);
    let y = MiscCore.rand(vh() * 0.55, vh() * 0.85);
    let vx = 0, vy = 0;
    let facing = 1; // 1 = right, -1 = left
    let destroyed = false;
    let carryingPetal = Math.random() < PETAL_CARRY_CHANCE;
    petal.style.display = carryingPetal ? '' : 'none';

    // Mode: 'walk' | 'pause' | 'sleep' | 'flee' | 'excited' | 'climb' | 'fall'
    //     | 'orbit' | 'exit' | 'enter' | 'burst' | 'watch' | 'alert'
    let mode = 'pause';
    let modeUntil = 0;
    let climbTarget = null;
    let climbAnchor = { x: 0, y: 0 };
    let wanderTargetX = x, wanderTargetY = y;
    let lastTick = null;
    let rafId = null;
    let scareTimer = null;

    // -- fidget / liveliness state --
    let pacingStepsLeft = 0;       // small dawdling steps left before heading to the real wander target
    let exitHesitateUntil = 0;     // holds still (looking back) before actually flying off an edge
    let glanceBackUntil = 0;       // suppresses auto-facing while glancing back mid-walk
    let lastFidgetAt = 0;
    let alertPhase = null;         // 'react' | 'look' | 'investigate', during mode 'alert'
    let alertReturnMode = 'pause'; // what to resume once the "what was that?" beat ends
    let alertResumeX = 0, alertResumeY = 0;

    function setPos() {
      el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    }
    setPos();

    function setFacing(next) {
      if (next === facing) return;
      facing = next;
      body.classList.toggle('facing-left', facing === -1);
    }

    function clearClasses() {
      el.classList.remove(
        'is-walking', 'is-flying', 'is-fleeing', 'is-excited', 'is-climbing',
        'is-falling', 'is-sleeping', 'is-scared', 'is-orbiting', 'is-taking-off', 'is-airborne',
        'is-watching', 'is-bursting', 'is-alert-react', 'is-alert-look', 'is-alert-investigate',
        'is-balancing', 'is-glancing-back',
        'is-fidget-antennae', 'is-fidget-shuffle', 'is-fidget-wingtest', 'is-fidget-groom',
        'is-fidget-look', 'is-fidget-drowsy', 'is-fidget-petal'
      );
    }

    function pickWanderTarget() {
      wanderTargetX = MiscCore.clamp(x + MiscCore.rand(-90, 90), 4, vw() - 4);
      wanderTargetY = MiscCore.clamp(y + MiscCore.rand(-60, 60), 4, vh() - 4);
    }

    function pickSmallStepTarget() {
      // A tiny, close-by target used for a couple of dawdling steps before
      // she commits to the real wander target — reuses the normal 'walk'
      // mode/animation, just with a much shorter leash.
      wanderTargetX = MiscCore.clamp(x + MiscCore.rand(-14, 14), 4, vw() - 4);
      wanderTargetY = MiscCore.clamp(y + MiscCore.rand(-9, 9), 4, vh() - 4);
    }

    // -- Fidgets: brief, purely decorative CSS beats layered on top of an
    // idle pause. They never touch x/y/mode, so a mode change (clearClasses)
    // simply cuts them short with no ill effect. --
    const FIDGET_POOL = ['antennae', 'shuffle', 'wingtest', 'groom', 'look', 'drowsy'];
    function maybeFidget() {
      const now = performance.now();
      if (now - lastFidgetAt < FIDGET_MIN_GAP_MS) return;
      if (Math.random() >= FIDGET_CHANCE_PER_PAUSE) return;
      const pool = carryingPetal ? FIDGET_POOL.concat(['petal']) : FIDGET_POOL;
      runFidget(MiscCore.pick(pool));
      lastFidgetAt = now;
    }

    function runFidget(type) {
      const map = {
        antennae: ['is-fidget-antennae', 480],
        shuffle: ['is-fidget-shuffle', 620],
        wingtest: ['is-fidget-wingtest', 620],
        groom: ['is-fidget-groom', 720],
        look: ['is-fidget-look', 880],
        drowsy: ['is-fidget-drowsy', 920],
        petal: ['is-fidget-petal', 560]
      };
      const entry = map[type];
      if (!entry) return;
      const cls = entry[0], dur = entry[1];
      el.classList.add(cls);
      setTimeout(function () {
        if (destroyed) return;
        el.classList.remove(cls);
      }, dur);
    }

    function enterPause() {
      mode = 'pause';
      modeUntil = performance.now() + MiscCore.rand(1200, 3200);
      clearClasses();
      vx = 0; vy = 0;
      maybeFidget();
    }

    function enterSleep() {
      mode = 'sleep';
      modeUntil = performance.now() + MiscCore.rand(SLEEP_MS_MIN, SLEEP_MS_MAX);
      clearClasses();
      el.classList.add('is-sleeping');
      vx = 0; vy = 0;
    }

    function enterWalk() {
      mode = 'walk';
      if (Math.random() < PACE_CHANCE) {
        // A little dawdling before committing: 2-3 short steps, then the
        // real wander target picks up from wherever that leaves her.
        pacingStepsLeft = MiscCore.pick([2, 3]);
        pickSmallStepTarget();
      } else {
        pacingStepsLeft = 0;
        pickWanderTarget();
      }
      clearClasses();
      el.classList.add('is-walking');
      if (climbTarget) el.classList.add('is-climbing');
    }

    function takeOff() {
      clearClasses();
      el.classList.add('is-taking-off', 'is-flying', 'is-airborne');
    }

    function enterFlee() {
      mode = 'flee';
      modeUntil = performance.now() + MiscCore.rand(FLEE_MS_MIN, FLEE_MS_MAX);
      climbTarget = null;
      clearClasses();
      el.classList.add('is-scared');
      if (scareTimer) clearTimeout(scareTimer);
      scareTimer = setTimeout(function () {
        if (destroyed || mode !== 'flee') return;
        el.classList.remove('is-scared');
        el.classList.add('is-fleeing', 'is-flying', 'is-airborne');
      }, SCARE_REACT_MS);
    }

    function enterExcited() {
      mode = 'excited';
      modeUntil = performance.now() + EXCITED_MS;
      clearClasses();
      el.classList.add('is-excited');
      if (Math.random() < 0.5) el.classList.add('is-airborne');
      pickWanderTarget();
    }

    function enterClimb(target) {
      mode = 'climb';
      climbTarget = target;
      const r = target.getBoundingClientRect();
      climbAnchor = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      modeUntil = performance.now() + MiscCore.rand(2500, 6000);
      clearClasses();
      el.classList.add('is-climbing');
    }

    function enterFall() {
      mode = 'fall';
      const startX = x, startY = y;
      const dropTo = Math.min(vh() - 6, y + MiscCore.rand(26, 46));
      clearClasses();
      el.classList.add('is-falling');
      const t0 = performance.now();
      const dur = 480;
      (function step(now) {
        if (destroyed) return;
        const t = Math.min(1, (now - t0) / dur);
        x = startX + (Math.random() - 0.5) * 0.4;
        y = startY + (dropTo - startY) * (t * t);
        setPos();
        if (t < 1) { requestAnimationFrame(step); }
        else { climbTarget = null; enterPause(); }
      })(t0);
    }

    function enterExitEdge() {
      // Walk out through whichever edge is currently nearer, then park
      // just offscreen and wait before re-entering from a (possibly
      // different) edge — never teleports. Now opens with a brief
      // hesitation/glance-back before she actually commits to leaving.
      mode = 'exit';
      clearClasses();
      el.classList.add('is-alert-look');
      setFacing(facing * -1);
      const distances = {
        left: x, right: vw() - x, top: y, bottom: vh() - y
      };
      const edge = Object.keys(distances).reduce(function (a, b) { return distances[a] < distances[b] ? a : b; });
      if (edge === 'left') { wanderTargetX = -24; wanderTargetY = y; }
      else if (edge === 'right') { wanderTargetX = vw() + 24; wanderTargetY = y; }
      else if (edge === 'top') { wanderTargetX = x; wanderTargetY = -20; }
      else { wanderTargetX = x; wanderTargetY = vh() + 20; }
      exitHesitateUntil = performance.now() + MiscCore.rand(EDGE_HESITATE_MS_MIN, EDGE_HESITATE_MS_MAX);
      modeUntil = performance.now() + 20000; // safety cap; step() below re-checks arrival every tick
    }

    function enterOffscreenWait() {
      mode = 'offscreen';
      modeUntil = performance.now() + MiscCore.rand(6000, 16000);
      vx = 0; vy = 0;
    }

    function enterReturnEdge() {
      mode = 'enter';
      clearClasses();
      el.classList.add('is-flying', 'is-airborne');
      const edges = ['left', 'right', 'top', 'bottom'];
      const edge = MiscCore.pick(edges);
      if (edge === 'left') { x = -24; y = MiscCore.rand(vh() * 0.2, vh() * 0.85); wanderTargetX = 30; wanderTargetY = y; }
      else if (edge === 'right') { x = vw() + 24; y = MiscCore.rand(vh() * 0.2, vh() * 0.85); wanderTargetX = vw() - 30; wanderTargetY = y; }
      else if (edge === 'top') { x = MiscCore.rand(vw() * 0.15, vw() * 0.85); y = -20; wanderTargetX = x; wanderTargetY = 30; }
      else { x = MiscCore.rand(vw() * 0.15, vw() * 0.85); y = vh() + 20; wanderTargetX = x; wanderTargetY = vh() - 30; }
      setFacing(wanderTargetX >= x ? 1 : -1);
      setPos();
      carryingPetal = Math.random() < PETAL_CARRY_CHANCE;
      petal.style.display = carryingPetal ? '' : 'none';
      modeUntil = performance.now() + 15000;
    }

    function enterOrbit(mountEl) {
      mode = 'orbit';
      climbTarget = null;
      clearClasses();
      el.classList.add('is-orbiting', 'is-flying', 'is-airborne');
      modeUntil = performance.now() + MiscCore.rand(6000, 14000);
    }

    function enterBurst() {
      // A rare, short-lived scurry — like she's suddenly full of energy —
      // to a nearby point, then right back to normal idling.
      mode = 'burst';
      clearClasses();
      el.classList.add('is-bursting');
      wanderTargetX = MiscCore.clamp(x + MiscCore.rand(-46, 46), 4, vw() - 4);
      wanderTargetY = MiscCore.clamp(y + MiscCore.rand(-30, 30), 4, vh() - 4);
      modeUntil = performance.now() + 900;
    }

    function enterWatch() {
      // Alert but not (yet) afraid: turns to face the cursor and holds
      // still instead of immediately fleeing.
      mode = 'watch';
      modeUntil = performance.now() + MiscCore.rand(WATCH_MS_MIN, WATCH_MS_MAX);
      clearClasses();
      el.classList.add('is-watching');
      vx = 0; vy = 0;
    }

    function enterAlert(resumeWalking) {
      // The "what was that?" beat: stop -> react -> look around -> turn
      // toward something -> investigate briefly -> resume what she was
      // doing (walking on toward the same target, or idling).
      mode = 'alert';
      clearClasses();
      el.classList.add('is-alert-react');
      alertPhase = 'react';
      alertReturnMode = resumeWalking ? 'walk' : 'pause';
      if (resumeWalking) { alertResumeX = wanderTargetX; alertResumeY = wanderTargetY; }
      vx = 0; vy = 0;
      modeUntil = performance.now() + MiscCore.rand(220, 340);
    }

    // ---- Interaction ------------------------------------------------------
    function cursorNear(px, py) {
      const dx = px - x, dy = py - y;
      return Math.sqrt(dx * dx + dy * dy) <= CURSOR_NOTICE_RADIUS;
    }

    let lastCursor = null;
    // Single cursor-position source for mouse AND S Pen hover. Touch is
    // excluded on purpose so a finger drag never acts like a hovering
    // cursor. Every existing check (cursorNear, flee, watch, alert) reads
    // lastCursor.x/y exactly as before — nothing downstream changes.
    function onPointerMove(e) {
      if (e.pointerType === 'touch') return;
      lastCursor = { x: e.clientX, y: e.clientY, pointerType: e.pointerType };
    }
    // Flagging: new listener/function, added only to clear a hovering pen's
    // position once it lifts out of range, so reactions stop naturally.
    // Only clears when the departing pointer is the pen that set lastCursor —
    // mouse behavior is untouched.
    function onPointerLeave(e) {
      if (e.pointerType === 'pen' && lastCursor && lastCursor.pointerType === 'pen') {
        lastCursor = null;
      }
    }
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave, { passive: true });
    document.addEventListener('pointercancel', onPointerLeave, { passive: true });

    function spawnClickSparkles() {
      const layer = document.body;
      for (let i = 0; i < 6; i++) {
        const s = MiscCore.createEl('div', { className: 'ladybug-sparkle' });
        const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
        const dist = MiscCore.rand(10, 22);
        s.style.left = x + 'px';
        s.style.top = y + 'px';
        s.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
        s.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
        layer.appendChild(s);
        setTimeout(function () { s.remove(); }, 600);
      }
    }

    function onActivate() {
      if (typeof MiscSound !== 'undefined') MiscSound.play('ladybugTap');
      if (!reduced) spawnClickSparkles();
      enterExcited();
    }
    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    });

    // ---- Main loop --------------------------------------------------------
    function moveToward(tx, ty, speed, dt) {
      const dx = tx - x, dy = ty - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return true;
      const step = speed * dt;
      if (step >= dist) { x = tx; y = ty; }
      else { x += (dx / dist) * step; y += (dy / dist) * step; }
      if (Math.abs(dx) > 0.5 && performance.now() >= glanceBackUntil) setFacing(dx >= 0 ? 1 : -1);
      return dist <= step;
    }

    function tick(now) {
      if (destroyed) return;
      if (lastTick === null) lastTick = now;
      const dt = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;

      if (reduced) {
        // Respect reduced motion: stay put, no autonomous travel, click still works.
        rafId = requestAnimationFrame(tick);
        return;
      }

      const candleMount = findLitCandle();

      switch (mode) {
        case 'pause': {
          el.classList.remove('is-walking', 'is-flying', 'is-airborne');
          if (candleMount) { enterOrbit(candleMount); break; }
          if (now >= modeUntil) {
            if (Math.random() < ALERT_CHANCE_PER_PAUSE) { enterAlert(false); break; }
            if (Math.random() < SLEEP_CHANCE_PER_PAUSE) { enterSleep(); break; }
            if (Math.random() < BURST_CHANCE_PER_PAUSE) { enterBurst(); break; }
            if (Math.random() < EDGE_EXIT_CHANCE_PER_PAUSE) { enterExitEdge(); break; }
            const targets = findClimbTargets();
            if (targets.length && Math.random() < 0.22) {
              enterClimb(MiscCore.pick(targets));
              break;
            }
            enterWalk();
          } else if (lastCursor && cursorNear(lastCursor.x, lastCursor.y) && Math.random() < CURSOR_NOTICE_CHANCE) {
            if (Math.random() < WATCH_INSTEAD_OF_FLEE_CHANCE) { enterWatch(); } else { enterFlee(); }
          }
          break;
        }

        case 'fall': {
          // enterFall()'s own rAF step drives position and ends the fall; don't cut it short.
          break;
        }

        case 'sleep': {
          if (now >= modeUntil) { enterPause(); }
          break;
        }

        case 'walk': {
          const arrived = moveToward(wanderTargetX, wanderTargetY, WALK_SPEED, dt);
          setPos();
          if (now >= glanceBackUntil && Math.random() < GLANCE_BACK_CHANCE_PER_SEC * dt) {
            const dur = MiscCore.rand(280, 520);
            glanceBackUntil = now + dur;
            setFacing(facing * -1);
            el.classList.add('is-glancing-back');
            setTimeout(function () { if (!destroyed) el.classList.remove('is-glancing-back'); }, dur);
          }
          if (Math.random() < ALERT_DURING_WALK_CHANCE * dt) { enterAlert(true); break; }
          if (lastCursor && cursorNear(lastCursor.x, lastCursor.y) && Math.random() < CURSOR_NOTICE_CHANCE * 1.6) {
            if (Math.random() < WATCH_INSTEAD_OF_FLEE_CHANCE) { enterWatch(); } else { enterFlee(); }
            break;
          }
          if (arrived) {
            if (pacingStepsLeft > 0) {
              pacingStepsLeft--;
              if (pacingStepsLeft > 0) { pickSmallStepTarget(); } else { pickWanderTarget(); }
            } else {
              enterPause();
            }
          }
          break;
        }

        case 'climb': {
          if (!climbTarget || !isVisible(climbTarget)) { climbTarget = null; enterPause(); break; }
          const r = climbTarget.getBoundingClientRect();
          const phase = Math.sin(now * 0.001);
          const targetX = r.left + r.width * 0.5 + phase * (r.width * 0.28);
          const targetY = r.top + r.height * 0.4;
          moveToward(targetX, targetY, WALK_SPEED * 0.8, dt);
          setPos();
          if (Math.abs(phase) > 0.92 && Math.random() < BALANCE_CHANCE_PER_SEC * dt) {
            el.classList.add('is-balancing');
            setTimeout(function () { if (!destroyed) el.classList.remove('is-balancing'); }, 260);
          }
          if (Math.random() < GRIP_LOSE_CHANCE_PER_SEC * dt * 60) { enterFall(); break; }
          if (now >= modeUntil) { climbTarget = null; enterPause(); }
          break;
        }

        case 'excited': {
          const arrived = moveToward(wanderTargetX, wanderTargetY, EXCITED_SPEED, dt);
          setPos();
          if (arrived) pickWanderTarget();
          if (now >= modeUntil) enterPause();
          break;
        }

        case 'flee': {
          if (el.classList.contains('is-scared') && !el.classList.contains('is-fleeing')) {
            // still in the brief scared-reaction beat before running
            break;
          }
          const cx = lastCursor ? lastCursor.x : x, cy = lastCursor ? lastCursor.y : y;
          let dx = x - cx, dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= dist; dy /= dist;
          x = MiscCore.clamp(x + dx * FLEE_SPEED * dt, -30, vw() + 30);
          y = MiscCore.clamp(y + dy * FLEE_SPEED * dt, -30, vh() + 30);
          setFacing(dx >= 0 ? 1 : -1);
          setPos();
          if (now >= modeUntil) enterPause();
          break;
        }

        case 'exit': {
          if (now < exitHesitateUntil) break; // holding still, looking back
          if (!el.classList.contains('is-flying')) {
            clearClasses();
            el.classList.add('is-flying', 'is-airborne', 'is-taking-off');
          }
          const arrived = moveToward(wanderTargetX, wanderTargetY, FLY_SPEED, dt);
          setPos();
          if (arrived || x < -20 || x > vw() + 20 || y < -18 || y > vh() + 18) {
            enterOffscreenWait();
          }
          break;
        }

        case 'offscreen': {
          if (now >= modeUntil) enterReturnEdge();
          break;
        }

        case 'enter': {
          const arrived = moveToward(wanderTargetX, wanderTargetY, FLY_SPEED, dt);
          setPos();
          if (arrived || now >= modeUntil) enterPause();
          break;
        }

        case 'orbit': {
          if (!candleMount) { enterPause(); break; }
          const flame = candleFlamePoint(candleMount);
          const angle = now * 0.001 * ORBIT_SPEED;
          const tx = flame.x + Math.cos(angle) * ORBIT_RADIUS;
          const ty = flame.y + Math.sin(angle) * ORBIT_RADIUS * 0.6 - 4;
          moveToward(tx, ty, FLY_SPEED * 1.4, dt);
          setPos();
          if (now >= modeUntil || !findLitCandle()) enterPause();
          break;
        }

        case 'burst': {
          const arrived = moveToward(wanderTargetX, wanderTargetY, EXCITED_SPEED * 0.85, dt);
          setPos();
          if (arrived || now >= modeUntil) enterPause();
          break;
        }

        case 'watch': {
          if (lastCursor) setFacing(lastCursor.x >= x ? 1 : -1);
          if (lastCursor && cursorNear(lastCursor.x, lastCursor.y) && Math.random() < CURSOR_NOTICE_CHANCE * 2.2) {
            enterFlee();
            break;
          }
          if (now >= modeUntil) enterPause();
          break;
        }

        case 'alert': {
          if (alertPhase === 'investigate') {
            const arrived = moveToward(wanderTargetX, wanderTargetY, WALK_SPEED * 0.65, dt);
            setPos();
            if (arrived || now >= modeUntil) {
              alertPhase = null;
              if (alertReturnMode === 'walk') {
                wanderTargetX = alertResumeX; wanderTargetY = alertResumeY;
                mode = 'walk';
                clearClasses();
                el.classList.add('is-walking');
              } else {
                enterPause();
              }
            }
            break;
          }
          if (now < modeUntil) break;
          if (alertPhase === 'react') {
            alertPhase = 'look';
            clearClasses();
            el.classList.add('is-alert-look');
            setFacing(facing * -1);
            modeUntil = now + MiscCore.rand(500, 850);
          } else if (alertPhase === 'look') {
            const ix = MiscCore.clamp(x + MiscCore.rand(-42, 42), 4, vw() - 4);
            const iy = MiscCore.clamp(y + MiscCore.rand(-22, 22), 4, vh() - 4);
            wanderTargetX = ix; wanderTargetY = iy;
            setFacing(ix >= x ? 1 : -1);
            clearClasses();
            el.classList.add('is-alert-investigate', 'is-walking');
            modeUntil = now + 700;
            alertPhase = 'investigate';
          }
          break;
        }

        default: {
          enterPause();
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    enterPause();
    rafId = requestAnimationFrame(tick);

    return {
      element: el,
      destroy: function () {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        if (scareTimer) clearTimeout(scareTimer);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('pointercancel', onPointerLeave);
        el.remove();
      }
    };
  }

  return { mount: mount };
})();
