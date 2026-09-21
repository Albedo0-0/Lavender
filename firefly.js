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
  .firefly.is-clicked { animation: none; transition: transform 1.4s ease-out, opacity 1.4s ease-out; }
  .firefly.firefly-magical {
    background: radial-gradient(circle, #fff9e0 0%, #ffe27a 40%, rgba(255,226,122,0.6) 65%, rgba(255,226,122,0) 78%);
    box-shadow: 0 0 6px rgba(255,226,122,0.8);
  }
  .firefly-dust-dot {
    position: absolute;
    width: 3px; height: 3px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff9e0 0%, rgba(255,226,122,0) 75%);
    transform: translate(-50%, -50%);
    opacity: 0.7;
    transition: opacity 1.1s ease, transform 1.1s ease;
    pointer-events: none;
  }
  .firefly-dust-dot.is-fading { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
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
    const magical = !!opts.magical;
    const size = opts.size || MiscCore.randInt(4, 9);
    const el = MiscCore.createEl('div', {
      className: 'firefly' + (magical ? ' firefly-magical' : '') + (reduced ? ' reduced-motion' : ''),
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
    let dustTimer = null;
    if (magical && !reduced) {
      dustTimer = setInterval(function () {
        const pos = trailPos();
        const dust = MiscCore.createEl('div', { className: 'firefly-dust-dot' });
        dust.style.left = pos.left + '%';
        dust.style.top = pos.top + '%';
        container.appendChild(dust);
        requestAnimationFrame(function () { dust.classList.add('is-fading'); });
        setTimeout(function () { dust.remove(); }, 1100);
      }, MiscCore.rand(450, 850));
    }
    el._dispose = function () { if (dustTimer) { clearInterval(dustTimer); dustTimer = null; } };
    function onActivate() {
      if (el.classList.contains('is-clicked')) return;
      const cs = getComputedStyle(el);
      const curOpacity = cs.opacity, curTransform = cs.transform;
      el.classList.add('is-clicked');
      el.style.opacity = curOpacity;
      el.style.transform = curTransform === 'none' ? '' : curTransform;
      void el.offsetWidth;
      if (dustTimer) { clearInterval(dustTimer); dustTimer = null; }
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
      destroy: function () { els.forEach(function (el) { if (el._dispose) el._dispose(); el.remove(); }); }
    };
  }

  return { mount: mount, spawnOne: spawnOne };
})();
