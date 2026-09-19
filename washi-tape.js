/*
 * Lavender — Interactive Washi Tape.
 *
 * Adds a small hover lift and a peel-on-click response to washi tape
 * decorations, without animating every piece constantly. Each tape
 * element gets its own slight tilt so pieces don't look identical.
 *
 * Progressive enhancement via event delegation — pass the real
 * selector once existing tape markup is inspected during integration.
 *
 * Usage:
 *   WashiTape.init();
 *   WashiTape.init({ selector: '.washi' });
 *   WashiTape.refresh();  // call again after a screen re-renders new tape
 */
const WashiTape = (function () {
  const STYLE_ID = 'misc-washi-style';
  let initialized = false;
  let activeSelector = '.washi-tape, [data-washi]';

  const CSS = `
  .lav-washi-interactive { transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .lav-washi-interactive:hover {
    transform: translateY(-1px) rotate(var(--lav-washi-tilt, 0deg));
    box-shadow: 0 3px 6px rgba(60,45,80,0.14);
  }
  .lav-washi-interactive.is-peeling {
    transform: translateY(-3px) rotate(calc(var(--lav-washi-tilt, 0deg) + 2deg));
  }
  `;

  function refresh(options) {
    const selector = (options && options.selector) || activeSelector;
    document.querySelectorAll(selector).forEach(function (el) {
      if (el.classList.contains('lav-washi-interactive')) return;
      el.style.setProperty('--lav-washi-tilt', MiscCore.rand(-3, 3).toFixed(1) + 'deg');
      el.classList.add('lav-washi-interactive');
    });
  }

  function init(options) {
    options = options || {};
    activeSelector = options.selector || activeSelector;
    MiscCore.injectStyle(STYLE_ID, CSS);
    refresh({ selector: activeSelector });

    if (initialized) return;
    initialized = true;

    document.addEventListener('click', function (e) {
      const el = e.target.closest(activeSelector);
      if (!el) return;
      el.classList.add('lav-washi-interactive', 'is-peeling');
      if (typeof MiscSound !== 'undefined') MiscSound.play('washiMove');
      setTimeout(function () { el.classList.remove('is-peeling'); }, 260);
    });
  }

  return { init: init, refresh: refresh };
})();
