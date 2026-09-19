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
position: fixed;
bottom: 0;
right: 16%;
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
    background: radial-gradient(ellipse 65% 75% at 80% 88%, rgba(40,20,8,0.55) 0%, rgba(8,5,14,0.9) 42%, rgba(3,2,8,0.95) 100%);
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
    width: 1500px;
    height: 1500px;
    left: 50%;
    margin-left: -750px;
    top: ${CANDLE_H * 0.12 - 750}px;
    transform: scale(0.2);
    background: radial-gradient(circle, rgba(255,176,92,0.55) 0%, rgba(255,150,70,0.22) 24%, rgba(255,130,50,0.07) 44%, rgba(255,130,50,0) 66%);
    opacity: 0;
    transition: opacity 2s ease, transform 2.2s cubic-bezier(0.22, 0.61, 0.36, 1), top 1.2s linear;
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
  .candle-riders { position: absolute; inset: 0; transition: transform 1.2s ease-out; }
  .candle-base {
    position: absolute;
    bottom: 0; left: 4px;
    width: ${CANDLE_W - 8}px;
    height: ${CANDLE_H * 0.7}px;
    background: linear-gradient(90deg, #cdb894 0%, #f6ecd4 22%, #fffaf0 45%, #efe2c4 72%, #c7b088 100%);
    border-radius: 6px 6px 3px 3px / 8px 8px 3px 3px;
    box-shadow: inset -7px 0 12px rgba(90,64,36,0.2);
    transition: height 1.2s ease-out;
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
    top: ${CANDLE_H * 0.3 + 2}px;
    width: 14px; height: 0;
    opacity: 0;
    background: linear-gradient(90deg, #efe2c4, #fffaf0 55%, #e6d6b2);
    border-radius: 0 0 6px 6px;
    box-shadow: 1px 2px 3px rgba(90,64,36,0.25);
    transition: height 1.2s ease-out, opacity 0.6s ease;
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
  .candle-blob[data-i="0"] { left: 10px; }
  .candle-blob[data-i="1"] { left: 34px; }
  .candle-blob[data-i="2"] { left: 58px; }
  .candle-blob[data-i="3"] { left: 80px; }
  .candle-wick {
    position: absolute;
    top: ${CANDLE_H * 0.2}px;
    left: 50%;
    width: 3px; height: ${CANDLE_H * 0.1 + 4}px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: linear-gradient(180deg, #1c130c 0%, #4a3421 60%, #3a2a1a 100%);
  }
  @keyframes candleIgnite {
    0% { transform: translateX(-50%) scale(0.05); opacity: 0; }
    55% { transform: translateX(-50%) scale(0.75); opacity: 1; }
    100% { transform: translateX(-50%) scale(1); opacity: 1; }
  }
.candle-lamp-mount.is-lit .candle-flame {
display: block;
animation: candleIgnite 2.6s cubic-bezier(0.16, 1, 0.3, 1) 1 both, candleFlicker 3.4s ease-in-out 2.6s infinite;
}
  .candle-flame {
    display: none;
    position: absolute;
    top: 4px; left: 50%;
    width: 32px; height: ${CANDLE_H * 0.25}px;
    transform: translateX(-50%);
    transform-origin: 50% 100%;
    background: radial-gradient(ellipse at 50% 72%, #fffbe0 0%, #ffd070 30%, #ff9a30 62%, rgba(255,110,20,0) 88%);
    border-radius: 50% 50% 50% 50% / 68% 68% 32% 32%;
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
    animation: candleSpark 2.6s ease-out infinite;
  }
  @keyframes candleFlicker {
    0%, 100% { transform: translateX(-50%) scaleY(1) scaleX(1); }
    20% { transform: translateX(-50.6%) scaleY(1.02) scaleX(0.99); }
    45% { transform: translateX(-51.5%) scaleY(1.04) scaleX(0.97); }
    65% { transform: translateX(-49%) scaleY(0.97) scaleX(1.03); }
    85% { transform: translateX(-49.6%) scaleY(1.01) scaleX(0.99); }
  }
  @keyframes candleSpark {
    0% { transform: translate(0, 0); opacity: 0; }
    15% { opacity: 0.5; }
    35% { opacity: 0.75; }
    80% { opacity: 0.2; }
    100% { transform: translate(3px, -46px); opacity: 0; }
  }

  .candle-ground-shadow {
    position: absolute;
    z-index: 0;
    bottom: 0;
    left: 50%;
    width: ${CANDLE_W * 1.7}px;
    height: 16px;
    transform: translateX(-50%) scaleX(0.6);
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 50%, rgba(60,42,22,0.32) 0%, rgba(60,42,22,0.15) 48%, rgba(60,42,22,0) 78%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 1.8s ease, transform 1.8s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .candle-lamp-mount.is-lit .candle-ground-shadow { opacity: 1; transform: translateX(-50%) scaleX(1); }
  .candle-puddle {
    position: absolute;
    z-index: 0;
    bottom: 3px;
    left: 50%;
    width: ${CANDLE_W}px;
    height: 0;
    background: radial-gradient(ellipse at 50% 40%, #fff6dc 0%, #ecdcb6 70%, #d9c4a3 100%);
    border-radius: 50%;
    box-shadow: 0 3px 6px rgba(30,18,8,0.35);
    transform: translateX(-50%);
    transition: width 1.2s ease-out, height 1.2s ease-out;
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

    const base = wrap.querySelector('.candle-base');
    
    const blobs = wrap.querySelectorAll('.candle-blob');
    const puddle = wrap.querySelector('.candle-puddle');
    const flame = wrap.querySelector('.candle-flame');
    const riders = wrap.querySelector('.candle-riders');
    const wick = wrap.querySelector('.candle-wick');
    const glow = wrap.querySelector('.candle-glow-pool');
    const messageEl = wrap.querySelector('.candle-message');

    let lit = false;
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

    function syncDim() {
      dimOverlay.classList.toggle('is-active', focused && container.offsetParent !== null);
    }

    function setFocused(next) {
      focused = next;
      wrap.classList.toggle('is-focused', focused);
      document.body.classList.toggle('candle-scroll-lock', focused);
      syncDim();
    }

    function updateVisual(fraction) {
      fraction = MiscCore.clamp(fraction, 0, 1);
      if (fraction === 0) {
        wrap.classList.add('no-anim');
        requestAnimationFrame(function () { requestAnimationFrame(function () { wrap.classList.remove('no-anim'); }); });
      }
      const fullH = CANDLE_H * 0.7, minH = CANDLE_H * 0.1;
      const baseH = fullH - (fullH - minH) * fraction;
      base.style.height = baseH + 'px';
      const drop = (CANDLE_H * 0.6) * fraction;
      riders.style.transform = 'translateY(' + drop + 'px)';
      glow.style.top = (CANDLE_H * 0.12 + drop - 750) + 'px';
      const wickCut = CANDLE_H * 0.05 * fraction;
      wick.style.height = (CANDLE_H * 0.1 + 4 - wickCut) + 'px';
      wick.style.marginTop = wickCut + 'px';
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
