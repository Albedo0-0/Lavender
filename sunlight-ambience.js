/*
 * Lavender — Sunlight Ambience.
 *
 * A soft, reusable warm-light overlay: a gentle glow patch with subtle
 * drift and faint dust motes, meant to feel like sunlight falling
 * across paper rather than a big gradient wash. Purely cosmetic.
 *
 * Usage:
 *   const sun = SunlightAmbience.mount(container);
 *   sun.start();
 *   sun.stop();
 *   sun.destroy();
 */
const SunlightAmbience = (function () {
  const STYLE_ID = 'misc-sunlight-style';

  const CSS = `
  .sunlight-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity 1.2s ease; z-index: 2; }
  .sunlight-layer.is-active { opacity: 1; }
  .sunlight-patch {
    position: absolute;
    width: 55%;
    height: 55%;
    top: -10%;
    left: 55%;
    background: radial-gradient(circle, rgba(255,236,190,0.5) 0%, rgba(255,236,190,0.14) 45%, rgba(255,236,190,0) 75%);
    animation: sunlightDrift 14s ease-in-out infinite;
  }
  .sunlight-layer.reduced-motion .sunlight-patch { animation: none; }
  .sunlight-mote {
    position: absolute;
    width: 2px; height: 2px;
    background: rgba(255,246,214,0.8);
    border-radius: 50%;
    animation: sunlightMote linear infinite;
  }
  .sunlight-layer.reduced-motion .sunlight-mote { display: none; }
  @keyframes sunlightDrift {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(-3%, 2%); }
  }
  @keyframes sunlightMote {
    0% { transform: translateY(0) translateX(0); opacity: 0; }
    10% { opacity: 0.8; }
    100% { transform: translateY(-60px) translateX(12px); opacity: 0; }
  }
  `;

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    const reduced = MiscCore.prefersReducedMotion();
    const layer = MiscCore.createEl('div', { className: 'sunlight-layer' + (reduced ? ' reduced-motion' : '') });
    layer.appendChild(MiscCore.createEl('div', { className: 'sunlight-patch' }));

    if (!reduced) {
      const moteCount = MiscCore.clamp(options.motes || 10, 0, 25);
      for (let i = 0; i < moteCount; i++) {
        const mote = MiscCore.createEl('div', { className: 'sunlight-mote' });
        mote.style.left = MiscCore.rand(45, 95) + '%';
        mote.style.top = MiscCore.rand(0, 60) + '%';
        mote.style.animationDuration = MiscCore.rand(6, 12) + 's';
        mote.style.animationDelay = '-' + MiscCore.rand(0, 8) + 's';
        layer.appendChild(mote);
      }
    }
    container.appendChild(layer);

    let active = false;
    function start() {
      active = true;
      layer.classList.add('is-active');
      if (options.withSound && typeof MiscSound !== 'undefined') MiscSound.play('sunlightAmbience');
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
