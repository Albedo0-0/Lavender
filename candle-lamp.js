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
  const CANDLE_H = 60; // px — matches the .candle-scene proportions below
  const MIN_MINUTES = 10;
  const MAX_MINUTES = 90;

  const CSS = `
  .candle-lamp-mount {
    position: absolute;
    bottom: 12px;
    right: 16px;
    z-index: 4;
    cursor: pointer;
    transition: transform 0.6s ease;
  }
  .candle-lamp-mount.is-focused { transform: scale(1.9); z-index: 5; }
  .candle-dim-overlay {
    position: fixed;
    inset: 0;
    background: rgba(20, 14, 30, 0);
    transition: background 0.6s ease;
    pointer-events: none;
    z-index: 3;
  }
  .candle-dim-overlay.is-active { background: rgba(20, 14, 30, 0.55); }
  .candle-glow-pool {
    position: absolute;
    width: 260px;
    height: 260px;
    left: 50%;
    bottom: -40px;
    transform: translateX(-50%) scale(0.3);
    background: radial-gradient(circle, rgba(255,190,120,0.55) 0%, rgba(255,190,120,0.18) 40%, rgba(255,190,120,0) 72%);
    opacity: 0;
    transition: opacity 0.7s ease, transform 0.7s ease;
    pointer-events: none;
    z-index: 3;
  }
  .candle-lamp-mount.is-focused .candle-glow-pool { opacity: 1; transform: translateX(-50%) scale(1); }

  .candle-scene { position: relative; width: 48px; height: ${CANDLE_H}px; overflow: visible; }
  .candle-riders { position: relative; width: 100%; height: 100%; transition: transform 0.9s var(--ease-soft, ease); }
  .candle-base {
    position: absolute;
    bottom: 0; left: 4px;
    width: 40px;
    height: ${CANDLE_H * 0.7}px;
    background: linear-gradient(180deg, var(--color-cream-050, #fffdf8) 0%, var(--color-kraft-300, #d9c4a3) 100%);
    border-radius: 3px 3px 1px 1px;
    box-shadow: inset -2px 0 4px rgba(63,47,33,0.15);
    transition: height 0.9s var(--ease-soft, ease);
  }
  .candle-blob {
    position: absolute;
    width: 12px; height: 5px;
    top: ${CANDLE_H * 0.28}px;
    background: linear-gradient(180deg, var(--color-cream-050, #fffdf8) 0%, var(--color-kraft-300, #d9c4a3) 100%);
    border-radius: 5px;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(63,47,33,0.15));
    transition: height 0.9s var(--ease-soft, ease);
  }
  .candle-blob[data-i="0"] { left: 2px; }
  .candle-blob[data-i="1"] { left: 14px; }
  .candle-blob[data-i="2"] { left: 26px; }
  .candle-blob[data-i="3"] { left: 36px; }
  .candle-wick { position: absolute; top: -8px; left: 50%; width: 1.5px; height: 8px; background: var(--color-brown-800, #3f2f21); transform: translateX(-50%); }
  .candle-flame {
    position: absolute;
    top: -20px; left: 50%;
    width: 9px; height: 16px;
    transform: translateX(-50%);
    background: radial-gradient(ellipse at 50% 70%, #fff3c4 0%, #ffb84d 55%, rgba(255,120,30,0) 85%);
    border-radius: 50% 50% 50% 50% / 65% 65% 35% 35%;
    animation: candleFlicker 1.4s ease-in-out infinite;
    filter: drop-shadow(0 0 5px rgba(255,170,80,0.8));
    transition: opacity 0.9s ease;
  }
  .candle-lamp-mount.reduced-motion .candle-flame,
  .candle-lamp-mount.reduced-motion .candle-spark { animation: none; }
  .candle-lamp-mount.is-out .candle-flame,
  .candle-lamp-mount.is-out .candle-spark { display: none; }
  .candle-spark {
    position: absolute;
    bottom: 2px; left: 2px;
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
    100% { transform: translate(2px, -14px); opacity: 0; }
  }

  .candle-puddle {
    position: absolute;
    bottom: -2px;
    left: 50%;
    width: 46px;
    height: 0px;
    background: linear-gradient(180deg, var(--color-cream-050, #fffdf8), var(--color-kraft-300, #d9c4a3));
    border-radius: 0;
    transform: translateX(-50%);
    transition: width 0.9s var(--ease-soft, ease), height 0.9s var(--ease-soft, ease), border-radius 0.9s var(--ease-soft, ease);
  }

  .candle-message {
    position: absolute;
    bottom: 70px;
    left: 50%;
    transform: translateX(-50%);
    width: 180px;
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
  .candle-message.is-visible { opacity: 1; transform: translateX(-50%) translateY(-4px); }
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
      '<div class="candle-scene">' +
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
      '<div class="candle-base"></div>' +
      '</div>' +
      '<div class="candle-puddle"></div>' +
      '<div class="candle-message"></div>';

    const dimOverlay = MiscCore.createEl('div', { className: 'candle-dim-overlay' });
    (options.dimTarget || document.body).appendChild(dimOverlay);
    container.appendChild(wrap);

    const base = wrap.querySelector('.candle-base');
    const riders = wrap.querySelector('.candle-riders');
    const blobs = wrap.querySelectorAll('.candle-blob');
    const puddle = wrap.querySelector('.candle-puddle');
    const flame = wrap.querySelector('.candle-flame');
    const messageEl = wrap.querySelector('.candle-message');

    let lit = false;
    let expired = false;
    let focused = false;
    let expireCallbacks = [];

    function setFocused(next) {
      focused = next;
      wrap.classList.toggle('is-focused', focused);
      dimOverlay.classList.toggle('is-active', focused);
    }

    function updateVisual(fraction) {
      fraction = MiscCore.clamp(fraction, 0, 1);
      const baseFullH = CANDLE_H * 0.7, baseMinH = CANDLE_H * 0.1;
      const baseH = baseFullH - (baseFullH - baseMinH) * fraction;
      base.style.height = baseH + 'px';
      const dropPx = (CANDLE_H * 0.6) * fraction;
      riders.style.transform = 'translateY(' + dropPx + 'px)';
      blobs.forEach(function (blob, i) {
        blob.style.height = (fraction * (CANDLE_H * 0.5) * (1 + i / 8)) + 'px';
      });
      const puddleT = MiscCore.clamp((fraction - 0.38) / 0.62, 0, 1);
      puddle.style.width = (46 + 54 * puddleT) + 'px';
      puddle.style.height = (10 * puddleT) + 'px';
      puddle.style.borderRadius = puddleT > 0 ? '50px / 6px' : '0px';
      flame.style.opacity = String(1 - fraction * 0.5);
    }

    function persist(startedAt, durationMs) {
      State.set({ miscCandle: startedAt ? { lit: true, startedAt: startedAt, durationMs: durationMs } : null });
    }

    function tick() {
      const saved = State.get().miscCandle;
      if (!lit || !saved || !saved.startedAt) return;
      const elapsed = TimeEngine.safeElapsed(saved.startedAt, Date.now());
      updateVisual(elapsed / saved.durationMs);
      if (elapsed >= saved.durationMs) finish(saved.durationMs);
    }

    function ignite() {
      if (lit || expired) return;
      lit = true;
      const durationMs = minutesToMs(MiscCore.randInt(MIN_MINUTES, MAX_MINUTES));
      const startedAt = Date.now();
      persist(startedAt, durationMs);
      if (typeof MiscSound !== 'undefined') MiscSound.play('candleIgnite');
      if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) TimeEngine.subscribe(tick, SUBSCRIBER_ID);
      setFocused(true);
    }

    function finish(durationMs) {
      if (expired) return;
      expired = true;
      lit = false;
      if (typeof TimeEngine !== 'undefined' && TimeEngine.unsubscribe) TimeEngine.unsubscribe(SUBSCRIBER_ID);
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
      setFocused(!focused);
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
      if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) TimeEngine.subscribe(tick, SUBSCRIBER_ID);
    })();

    return {
      element: wrap,
      isLit: function () { return lit; },
      setFocused: setFocused,
      onExpire: function (cb) { expireCallbacks.push(cb); },
      destroy: function () {
        if (typeof TimeEngine !== 'undefined' && TimeEngine.unsubscribe) TimeEngine.unsubscribe(SUBSCRIBER_ID);
        wrap.remove();
        dimOverlay.remove();
      }
    };
  }

  return { mount: mount };
})();
