/*
 * Lavender — Rain Ambience.
 *
 * A lightweight, non-interactive rain overlay: a handful of thin
 * streaks at varied depth/speed/opacity, optionally with a faint haze.
 * Purely cosmetic — no weather system, no gameplay effect.
 *
 * Usage:
 *   const rain = RainAmbience.mount(container);
 *   rain.start();
 *   rain.stop();
 *   rain.destroy();
 */
const RainAmbience = (function () {
  const STYLE_ID = 'misc-rain-style';

  const CSS = `
  .rain-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity 1s ease; z-index: 2; }
  .rain-layer.is-active { opacity: 1; }
  .rain-streak {
    position: absolute;
    top: -20%;
    width: 1px;
    background: linear-gradient(180deg, rgba(190,205,230,0) 0%, rgba(190,205,230,0.55) 100%);
    animation: rainFall linear infinite;
  }
  .rain-layer.reduced-motion .rain-streak { animation: none; opacity: 0.25; }
  .rain-haze {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(200,210,230,0.08) 0%, rgba(200,210,230,0.02) 100%);
  }
  @keyframes rainFall {
    0% { transform: translateY(0); }
    100% { transform: translateY(140%); }
  }
  `;

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    const reduced = MiscCore.prefersReducedMotion();
    const count = MiscCore.clamp(options.count || 28, 6, 60);

    const layer = MiscCore.createEl('div', { className: 'rain-layer' + (reduced ? ' reduced-motion' : '') });
    if (options.haze !== false) layer.appendChild(MiscCore.createEl('div', { className: 'rain-haze' }));

    for (let i = 0; i < count; i++) {
      const streak = MiscCore.createEl('div', { className: 'rain-streak' });
      const depth = MiscCore.rand(0.3, 1);
      streak.style.left = MiscCore.rand(0, 100) + '%';
      streak.style.height = (18 + depth * 40) + 'px';
      streak.style.opacity = String(0.25 + depth * 0.5);
      streak.style.animationDuration = (1.1 / depth) + 's';
      streak.style.animationDelay = '-' + MiscCore.rand(0, 2) + 's';
      layer.appendChild(streak);
    }
    container.appendChild(layer);

    let active = false;
    function start() {
      active = true;
      layer.classList.add('is-active');
      if (options.withSound && typeof MiscSound !== 'undefined') MiscSound.play('rainAmbience');
    }
    function stop() { active = false; layer.classList.remove('is-active'); }

    return {
      element: layer,
      start: start,
      stop: stop,
      isActive: function () { return active; },
      destroy: function () { layer.remove(); }
    };
  }

  return { mount: mount };
})();
