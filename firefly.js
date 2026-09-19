/*
 * Lavender — Fireflies.
 *
 * Small ambient decorative lights scattered around a container. Click
 * one and it briefly brightens, gives a tiny chime (if sound is
 * enabled), then fades back into the ambience. Purely cosmetic — no
 * collection, no progression, no ties to My World.
 *
 * Usage:
 *   const swarm = Firefly.mount(container, { count: 6 });
 *   swarm.destroy(); // removes every firefly it created
 */
const Firefly = (function () {
  const STYLE_ID = 'misc-firefly-style';

  const CSS = `
  .firefly {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(circle, #fff6c8 0%, #f4e06a 45%, rgba(244,224,106,0) 75%);
    cursor: pointer;
    animation: fireflyDrift linear infinite, fireflyPulse ease-in-out infinite;
  }
  .firefly.reduced-motion { animation: none; opacity: 0.6; }
  .firefly.is-clicked { animation-play-state: paused; transition: opacity 0.9s ease, transform 0.6s ease; }
  @keyframes fireflyPulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.9; }
  }
  @keyframes fireflyDrift {
    0% { transform: translate(0, 0); }
    25% { transform: translate(8px, -10px); }
    50% { transform: translate(-6px, -4px); }
    75% { transform: translate(6px, 6px); }
    100% { transform: translate(0, 0); }
  }
  `;

  function spawnOne(container, opts) {
    opts = opts || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    const reduced = MiscCore.prefersReducedMotion();
    const size = opts.size || MiscCore.randInt(4, 9);
    const el = MiscCore.createEl('div', {
      className: 'firefly' + (reduced ? ' reduced-motion' : ''),
      attrs: { role: 'button', tabindex: '0', 'aria-label': 'firefly' }
    });
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.top = (opts.top !== undefined ? opts.top : MiscCore.rand(5, 90)) + '%';
    el.style.left = (opts.left !== undefined ? opts.left : MiscCore.rand(5, 95)) + '%';
    el.style.animationDuration = MiscCore.rand(9, 16) + 's, ' + MiscCore.rand(2, 4) + 's';
    el.style.animationDelay = '-' + MiscCore.rand(0, 8) + 's';

    function onActivate() {
      if (el.classList.contains('is-clicked')) return;
      el.classList.add('is-clicked');
      el.style.opacity = '1';
      el.style.transform = 'scale(1.8)';
      if (typeof MiscSound !== 'undefined') MiscSound.play('fireflySparkle');
      setTimeout(function () { el.style.opacity = '0'; }, 250);
    }

    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    });

    container.appendChild(el);
    return el;
  }

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    const count = MiscCore.clamp(options.count || 5, 1, 20);
    const els = [];
    for (let i = 0; i < count; i++) {
      els.push(spawnOne(container, options));
    }
    return {
      elements: els,
      destroy: function () { els.forEach(function (el) { el.remove(); }); }
    };
  }

  return { mount: mount, spawnOne: spawnOne };
})();
