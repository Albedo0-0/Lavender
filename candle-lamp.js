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
 const CANDLE_H = 260; // px — scene height (base + wick + flame headroom)
  const CANDLE_W = 104; // px
  const MIN_MINUTES = 10;
  const MAX_MINUTES = 90;

  const CSS = `
  .candle-lamp-mount {
    position: absolute;
    bottom: 8px;
    right: 16%;
    width: ${CANDLE_W}px;
    height: ${CANDLE_H}px;
    z-index: 4;
    cursor: pointer;
    transform-origin: 50% 100%;
    transition: transform 1.6s cubic-bezier(0.22, 0.61, 0.36, 1);
    -webkit-tap-highlight-color: transparent;
  }
  .candle-lamp-mount.is-focused { transform: scale(1.25); z-index: 31; }
  .candle-dim-overlay {
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse 65% 75% at 80% 88%, rgba(40,20,8,0.55) 0%, rgba(8,5,14,0.9) 42%, rgba(3,2,8,0.95) 100%);
    opacity: 0;
    transition: opacity 2s ease;
    pointer-events: none;
    z-index: 30;
  }
  .candle-dim-overlay.is-active { opacity: 1; }
  .candle-glow-pool {
    position: absolute;
    z-index: -1;
    width: 1100px;
    height: 1100px;
    left: 50%;
    margin-left: -550px;
    bottom: calc(100% - 510px);
    transform: scale(0.3);
    background: radial-gradient(circle, rgba(255,176,92,0.5) 0%, rgba(255,150,70,0.2) 26%, rgba(255,130,50,0.06) 46%, rgba(255,130,50,0) 68%);
    opacity: 0;
    transition: opacity 0.9s ease, transform 1.2s ease;
    pointer-events: none;
  }
  .candle-lamp-mount.is-focused .candle-glow-pool { opacity: 1; transform: scale(1); }
  .candle-lamp-mount.is-out .candle-glow-pool { opacity: 0; }

  .candle-scene { position: relative; z-index: 1; width: ${CANDLE_W}px; height: ${CANDLE_H}px; overflow: visible; }
  .candle-base {
    position: absolute;
    bottom: 0; left: 0;
    width: 100%;
    height: ${CANDLE_H * 0.62}px;
    background: linear-gradient(90deg, #cdb894 0%, #f6ecd4 22%, #fffaf0 45%, #efe2c4 72%, #c7b088 100%);
    border-radius: 6px 6px 4px 4px / 8px 8px 4px 4px;
    box-shadow: inset -6px 0 10px rgba(90,64,36,0.18), 0 6px 10px rgba(30,18,8,0.45);
    transition: height 1.2s linear;
  }
  .candle-base::before {
    content: "";
    position: absolute;
    top: -7px; left: 2px; right: 2px;
    height: 14px;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 45%, #ffe2a0 0%, #f7d99b 45%, #e6cf9f 100%);
    box-shadow: 0 0 14px rgba(255,190,100,0.55);
  }
  .candle-blob {
    position: absolute;
    top: 2px;
    width: 10px; height: 0;
    opacity: 0;
    background: linear-gradient(90deg, #efe2c4, #fffaf0 55%, #e6d6b2);
    border-radius: 0 0 6px 6px;
    box-shadow: 1px 2px 3px rgba(90,64,36,0.25);
    transition: height 1.2s linear, opacity 0.6s ease;
  }
  .candle-blob::after {
    content: "";
    position: absolute;
    left: -1px; bottom: -4px;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #fffaf0, #e6d6b2);
    box-shadow: 1px 2px 3px rgba(90,64,36,0.25);
  }
  .candle-blob[data-i="0"] { left: 8%; }
  .candle-blob[data-i="1"] { left: 32%; }
  .candle-blob[data-i="2"] { left: 58%; }
  .candle-blob[data-i="3"] { left: 80%; }
  .candle-wick {
    position: absolute;
    bottom: calc(100% - 3px);
    left: 50%;
    width: 3px; height: 24px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: linear-gradient(180deg, #1c130c 0%, #4a3421 60%, #3a2a1a 100%);
  }
  .candle-flame {
    position: absolute;
    bottom: calc(100% + 12px); left: 50%;
    width: 26px; height: 56px;
    transform: translateX(-50%);
    transform-origin: 50% 100%;
    background: radial-gradient(ellipse at 50% 72%, #fffbe0 0%, #ffd070 30%, #ff9a30 62%, rgba(255,110,20,0) 88%);
    border-radius: 50% 50% 50% 50% / 68% 68% 32% 32%;
    animation: candleFlicker 1.4s ease-in-out infinite;
    filter: drop-shadow(0 0 12px rgba(255,160,60,0.9));
    transition: opacity 0.9s ease;
  }
  .candle-lamp-mount.reduced-motion .candle-flame,
  .candle-lamp-mount.reduced-motion .candle-spark { animation: none; }
  .candle-lamp-mount.reduced-motion, .candle-lamp-mount.reduced-motion * { transition-duration: 0.01s !important; }
  .candle-lamp-mount.is-out .candle-flame,
  .candle-lamp-mount.is-out .candle-spark { display: none; }
  .candle-spark {
    position: absolute;
    bottom: 8px; left: 11px;
    width: 3px; height: 3px;
    background: #ffe27a;
    border-radius: 50%;
    opacity: 0;
    animation: candleSpark 1.6s ease-in infinite;
  }
  @keyframes candleFlicker {
    0%, 100% { transform: translateX(-50%) scaleY(1) scaleX(1); }
    30% { transform: translateX(-52%) scaleY(1.06) scaleX(0.94); }
    60% { transform: translateX(-48%) scaleY(0.94) scaleX(1.04); }
  }
  @keyframes candleSpark {
    0% { transform: translate(0, 0); opacity: 0; }
    20% { opacity: 0.75; }
    100% { transform: translate(3px, -46px); opacity: 0; }
  }

  .candle-puddle {
    position: absolute;
    z-index: 0;
    bottom: -5px;
    left: 50%;
    width: ${CANDLE_W}px;
    height: 0;
    background: radial-gradient(ellipse at 50% 40%, #fff6dc 0%, #ecdcb6 70%, #d9c4a3 100%);
    border-radius: 50%;
    box-shadow: 0 3px 6px rgba(30,18,8,0.35);
    transform: translateX(-50%);
    transition: width 1.2s linear, height 1.2s linear;
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
      '<div class="candle-puddle"></div>' +
      '<div class="candle-scene">' +
      '<div class="candle-base">' +
      '<div class="candle-glow-pool"></div>' +
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

    const base = wrap.querySelector('.candle-base');
    
    const blobs = wrap.querySelectorAll('.candle-blob');
    const puddle = wrap.querySelector('.candle-puddle');
    const flame = wrap.querySelector('.candle-flame');
    const messageEl = wrap.querySelector('.candle-message');

    let lit = false;
    let expired = false;
    let focused = false;
    let expireCallbacks = [];

    function syncDim() {
      dimOverlay.classList.toggle('is-active', focused && container.offsetParent !== null);
    }

    function setFocused(next) {
      focused = next;
      wrap.classList.toggle('is-focused', focused);
      syncDim();
    }

    function updateVisual(fraction) {
      fraction = MiscCore.clamp(fraction, 0, 1);
      const fullH = CANDLE_H * 0.62, minH = CANDLE_H * 0.08;
      const baseH = fullH - (fullH - minH) * fraction;
      base.style.height = baseH + 'px';
      const reach = [0.5, 0.85, 0.35, 0.65];
      blobs.forEach(function (blob, i) {
        const len = Math.max(0, Math.min(Math.max(0, fraction - 0.06 * (i + 1)) * reach[i % 4] * fullH * 1.3, baseH - 12));
        blob.style.height = len + 'px';
        blob.style.opacity = len > 2 ? '1' : '0';
      });
      const puddleT = MiscCore.clamp((fraction - 0.15) / 0.85, 0, 1);
      puddle.style.width = (CANDLE_W * (1 + 0.9 * puddleT)) + 'px';
      puddle.style.height = (18 * puddleT) + 'px';
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
      unsubscribeTick();
      document.removeEventListener('keydown', onKey);
      persist(null);
      wrap.classList.remove('is-out');
      messageEl.classList.remove('is-visible');
      updateVisual(0);
      setFocused(false);
    }

    function ignite() {
      if (lit || expired) return;
      lit = true;
      updateVisual(0);
      const durationMs = minutesToMs(MiscCore.randInt(MIN_MINUTES, MAX_MINUTES));
      const startedAt = Date.now();
      persist(startedAt, durationMs);
      if (typeof MiscSound !== 'undefined') MiscSound.play('candleIgnite');
      subscribeTick();
      document.addEventListener('keydown', onKey);
      setFocused(true);
    }

    function finish(durationMs) {
      if (expired) return;
      expired = true;
      lit = false;
      unsubscribeTick();
      document.removeEventListener('keydown', onKey);
      setFocused(false);
      const elapsedMs = TimeEngine.safeMs(durationMs);
      if (elapsedMs > 0) {
        TimeEngine.recordStandaloneStudy(elapsedMs, 'candle');
        if (typeof GamificationData !== 'undefined' && GamificationData.awardStudyTime) {
          GamificationData.awardStudyTime(elapsedMs, 'candle');
        }
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
      subscribeTick();
      document.addEventListener('keydown', onKey);
      setFocused(true);
    })();

    return {
      element: wrap,
      isLit: function () { return lit; },
      setFocused: setFocused,
      onExpire: function (cb) { expireCallbacks.push(cb); },
      destroy: function () {
        unsubscribeTick();
        document.removeEventListener('keydown', onKey);
        wrap.remove();
        dimOverlay.remove();
      }
    };
  }

  return { mount: mount };
})();
