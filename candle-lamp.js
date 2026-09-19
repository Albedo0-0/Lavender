/*
 * Lavender — Candle Lamp.
 *
 * A small interactive candle that normally sits in a corner and, when
 * clicked, enlarges into a warm focal point while the rest of the
 * scene dims softly around it. It has NO timer UI and NO countdown of
 * its own — its wax simply melts to reflect progress that something
 * else feeds it.
 *
 * Production usage should drive the melt from the real Study/session
 * state (e.g. a TimeEngine.subscribe() tick wired in during
 * integration) via setProgress(fraction). The optional start(durationMs)
 * helper below is only a convenience for previewing the animation in
 * isolation — it is not a replacement for TimeEngine, does not persist
 * anything, and should not be wired to anything that needs to be
 * authoritative about elapsed study time.
 *
 * Usage:
 *   const candle = CandleLamp.mount(container);
 *   candle.setProgress(0.4);              // 40% melted
 *   candle.onExpire(function () { ... }); // fires once when progress hits 1
 */
const CandleLamp = (function () {
  const STYLE_ID = 'misc-candle-lamp-style';

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

  .candle-body { position: relative; width: 26px; height: 60px; }
  .candle-wax {
    position: absolute;
    bottom: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(180deg, #fdf1d8 0%, #f4dba8 100%);
    border-radius: 3px 3px 1px 1px;
    transform-origin: bottom center;
    transition: transform 0.8s ease;
    box-shadow: inset -2px 0 4px rgba(150,110,50,0.15);
  }
  .candle-drip { position: absolute; top: -2px; left: 6px; width: 4px; height: 10px; background: #f4dba8; border-radius: 0 0 3px 3px; opacity: 0.85; }
  .candle-wick { position: absolute; top: -8px; left: 50%; width: 1.5px; height: 8px; background: #5b4636; transform: translateX(-50%); }
  .candle-flame {
    position: absolute;
    top: -20px; left: 50%;
    width: 9px; height: 16px;
    transform: translateX(-50%);
    background: radial-gradient(ellipse at 50% 70%, #fff3c4 0%, #ffb84d 55%, rgba(255,120,30,0) 85%);
    border-radius: 50% 50% 50% 50% / 65% 65% 35% 35%;
    animation: candleFlicker 1.4s ease-in-out infinite;
    filter: drop-shadow(0 0 5px rgba(255,170,80,0.8));
  }
  .candle-lamp-mount.reduced-motion .candle-flame { animation: none; }
  .candle-lamp-mount.is-out .candle-flame { display: none; }
  @keyframes candleFlicker {
    0%, 100% { transform: translateX(-50%) scaleY(1) scaleX(1); }
    30% { transform: translateX(-52%) scaleY(1.06) scaleX(0.94); }
    60% { transform: translateX(-48%) scaleY(0.94) scaleX(1.04); }
  }

  .candle-message {
    position: absolute;
    bottom: 70px;
    left: 50%;
    transform: translateX(-50%);
    width: 170px;
    padding: 8px 10px;
    background: #fbf7ef;
    border-radius: 10px;
    box-shadow: 0 4px 14px rgba(90,70,120,0.2);
    font-size: 12px;
    color: #5b4b73;
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.6s ease;
  }
  .candle-message.is-visible { opacity: 1; }
  `;

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
      '<div class="candle-body">' +
      '<div class="candle-flame"></div>' +
      '<div class="candle-wick"></div>' +
      '<div class="candle-wax"><div class="candle-drip"></div></div>' +
      '</div>' +
      '<div class="candle-message"></div>';

    const dimOverlay = MiscCore.createEl('div', { className: 'candle-dim-overlay' });
    (options.dimTarget || document.body).appendChild(dimOverlay);
    container.appendChild(wrap);

    const wax = wrap.querySelector('.candle-wax');
    const messageEl = wrap.querySelector('.candle-message');

    let focused = false;
    let expired = false;
    let ignited = false;
    let expireCallbacks = [];
    let demoFrame = null;

    function setFocused(next) {
      focused = next;
      wrap.classList.toggle('is-focused', focused);
      dimOverlay.classList.toggle('is-active', focused);
    }

    wrap.addEventListener('click', function () {
      if (!ignited) {
        ignited = true;
        if (typeof MiscSound !== 'undefined') MiscSound.play('candleIgnite');
      }
      setFocused(!focused);
      if (focused && typeof MiscSound !== 'undefined') MiscSound.play('candleAmbience');
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.click(); }
    });

    function setProgress(fraction) {
      if (expired) return;
      fraction = MiscCore.clamp(fraction, 0, 1);
      wax.style.transform = 'scaleY(' + (1 - fraction) + ')';
      if (fraction >= 1) expire();
    }

    function expire() {
      if (expired) return;
      expired = true;
      wrap.classList.add('is-out');
      messageEl.textContent = options.expireMessage || 'The candle has burned down — this session has ended.';
      messageEl.classList.add('is-visible');
      expireCallbacks.forEach(function (cb) { try { cb(); } catch (e) { /* one bad callback shouldn't break the rest */ } });
    }

    // Convenience-only demo driver — see file header. Not used unless a
    // caller explicitly asks for it; production wiring should call
    // setProgress() from the real Study heartbeat instead.
    function start(durationMs) {
      stop();
      const startedAt = performance.now();
      function tick(now) {
        const fraction = (now - startedAt) / durationMs;
        setProgress(fraction);
        if (fraction < 1) demoFrame = requestAnimationFrame(tick);
      }
      demoFrame = requestAnimationFrame(tick);
    }
    function stop() {
      if (demoFrame) cancelAnimationFrame(demoFrame);
      demoFrame = null;
    }
    function reset() {
      stop();
      expired = false;
      wrap.classList.remove('is-out');
      messageEl.classList.remove('is-visible');
      wax.style.transform = 'scaleY(1)';
    }

    return {
      element: wrap,
      setProgress: setProgress,
      start: start,
      stop: stop,
      reset: reset,
      setFocused: setFocused,
      onExpire: function (cb) { expireCallbacks.push(cb); },
      destroy: function () {
        stop();
        wrap.remove();
        dimOverlay.remove();
      }
    };
  }

  return { mount: mount };
})();
