/*
 * Lavender — Ladybug.
 *
 * A tiny ladybug that wanders slowly across a container, pausing and
 * changing direction naturally. Click it for a small tactile wiggle.
 * No gameplay system attached.
 *
 * Usage:
 *   const bug = Ladybug.mount(container);
 *   bug.destroy(); // stops wandering and removes it
 */
const Ladybug = (function () {
  const STYLE_ID = 'misc-ladybug-style';

  const CSS = `
  .ladybug {
    position: absolute;
    width: 14px;
    height: 11px;
    cursor: pointer;
    transition: left 3.5s ease-in-out, top 3.5s ease-in-out, transform 0.2s ease;
  }
  .ladybug.reduced-motion { transition: transform 0.2s ease; }
  .ladybug svg { width: 100%; height: 100%; display: block; }
  .ladybug.is-tapped { transform: scale(1.25) rotate(-8deg); }
  `;

  function svgMarkup() {
    return (
      '<svg viewBox="0 0 14 11" xmlns="http://www.w3.org/2000/svg">' +
      '<ellipse cx="7" cy="6" rx="6" ry="5" fill="#d94f4f"/>' +
      '<path d="M7 1 V11" stroke="#3a2b2b" stroke-width="0.6"/>' +
      '<circle cx="4.5" cy="4.5" r="0.9" fill="#3a2b2b"/>' +
      '<circle cx="9.5" cy="4.5" r="0.9" fill="#3a2b2b"/>' +
      '<circle cx="5" cy="8" r="0.8" fill="#3a2b2b"/>' +
      '<circle cx="9" cy="8" r="0.8" fill="#3a2b2b"/>' +
      '<circle cx="7" cy="1.6" r="1.6" fill="#2b2020"/>' +
      '</svg>'
    );
  }

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    const reduced = MiscCore.prefersReducedMotion();

    const el = MiscCore.createEl('div', {
      className: 'ladybug' + (reduced ? ' reduced-motion' : ''),
      html: svgMarkup(),
      attrs: { role: 'button', tabindex: '0', 'aria-label': 'ladybug' }
    });
    const bounds = options.bounds || { top: 5, left: 5, bottom: 90, right: 90 };
    let x = MiscCore.rand(bounds.left, bounds.right);
    let y = MiscCore.rand(bounds.top, bounds.bottom);
    el.style.left = x + '%';
    el.style.top = y + '%';
    container.appendChild(el);

    let wanderTimer = null;
    let destroyed = false;

    function step() {
      if (destroyed) return;
      const pause = reduced ? 4000 : MiscCore.rand(1500, 4000);
      wanderTimer = setTimeout(function () {
        if (destroyed) return;
        if (!reduced) {
          x = MiscCore.clamp(x + MiscCore.rand(-14, 14), bounds.left, bounds.right);
          y = MiscCore.clamp(y + MiscCore.rand(-10, 10), bounds.top, bounds.bottom);
          el.style.left = x + '%';
          el.style.top = y + '%';
        }
        step();
      }, pause);
    }
    step();

    function onActivate() {
      el.classList.add('is-tapped');
      if (typeof MiscSound !== 'undefined') MiscSound.play('ladybugTap');
      setTimeout(function () { el.classList.remove('is-tapped'); }, 220);
    }
    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    });

    return {
      element: el,
      destroy: function () {
        destroyed = true;
        if (wanderTimer) clearTimeout(wanderTimer);
        el.remove();
      }
    };
  }

  return { mount: mount };
})();
