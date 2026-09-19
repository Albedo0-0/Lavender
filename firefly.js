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
  .firefly { pointer-events: auto; }
  .firefly.is-clicked { animation-play-state: paused; transition: transform 1.4s ease-out, opacity 1.4s ease-out; }
  .firefly-trail-dot {
    position: absolute;
    width: 5px; height: 5px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff6c8 0%, rgba(244,224,106,0) 75%);
    transform: translate(-50%, -50%);
    opacity: 0.85;
    transition: opacity 0.9s ease, transform 0.9s ease;
    pointer-events: none;
  }
  .firefly-trail-dot.is-fading { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
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

    function trailPos() {
      const r = el.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      return {
        left: ((r.left + r.width / 2 - cr.left) / cr.width) * 100,
        top: ((r.top + r.height / 2 - cr.top) / cr.height) * 100
      };
    }
    function spawnTrailDot() {
      const pos = trailPos();
      const dot = MiscCore.createEl('div', { className: 'firefly-trail-dot' });
      dot.style.left = pos.left + '%';
      dot.style.top = pos.top + '%';
      container.appendChild(dot);
      requestAnimationFrame(function () { dot.classList.add('is-fading'); });
      setTimeout(function () { dot.remove(); }, 900);
    }
    function onActivate() {
      if (el.classList.contains('is-clicked')) return;
      el.classList.add('is-clicked');
      if (typeof MiscSound !== 'undefined') MiscSound.play('fireflySparkle');
      const dx = MiscCore.rand(-40, 40), dy = MiscCore.rand(-70, -25);
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.4)';
      el.style.opacity = '0';
      if (!reduced) {
        let n = 0;
        const trailTimer = setInterval(function () {
          n++;
          spawnTrailDot();
          if (n >= 6) clearInterval(trailTimer);
        }, 200);
      }
      setTimeout(function () { el.remove(); }, 1500);
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
