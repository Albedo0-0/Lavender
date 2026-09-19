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
  .lav-washi-deco {
    position: absolute;
    width: 78px; height: 20px;
    background: repeating-linear-gradient(45deg, var(--lav-washi-a, rgba(196,181,214,0.82)) 0 6px, var(--lav-washi-b, rgba(238,228,246,0.82)) 6px 12px);
    border-left: 3px dotted rgba(255,255,255,0.55);
    border-right: 3px dotted rgba(255,255,255,0.55);
    box-shadow: 0 1px 2px rgba(60,45,80,0.2);
    transform: rotate(var(--lav-washi-base, 0deg));
    pointer-events: auto;
    cursor: pointer;
  }
  .lav-washi-interactive { transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .lav-washi-interactive:hover {
    transform: translateY(-1px) rotate(calc(var(--lav-washi-base, 0deg) + var(--lav-washi-tilt, 0deg)));
    box-shadow: 0 3px 6px rgba(60,45,80,0.24);
  }
  .lav-washi-interactive.is-peeling {
    transform: translateY(-3px) rotate(calc(var(--lav-washi-base, 0deg) + var(--lav-washi-tilt, 0deg) + 2deg));
  }
  @media (prefers-reduced-motion: reduce) { .lav-washi-interactive { transition: none; } }
  `;

  function refresh(options) {
    const selector = (options && options.selector) || activeSelector;
    document.querySelectorAll(selector).forEach(function (el) {
      if (el.classList.contains('lav-washi-interactive')) return;
      el.style.setProperty('--lav-washi-tilt', MiscCore.rand(-3, 3).toFixed(1) + 'deg');
      el.classList.add('lav-washi-interactive');
    });
  }

  function decorate() {
    const layer = MiscCore.getDecorLayer();
    if (layer.querySelector('.lav-washi-deco')) return;
    [
      { pos: 'left:-20px;top:8px;', base: '-38deg', a: 'rgba(196,181,214,0.82)', b: 'rgba(238,228,246,0.82)' },
      { pos: 'right:-20px;top:8px;', base: '38deg', a: 'rgba(214,190,160,0.82)', b: 'rgba(244,234,214,0.82)' }
    ].forEach(function (p) {
      const el = MiscCore.createEl('div', { className: 'washi-tape lav-washi-deco', attrs: { 'aria-hidden': 'true' } });
      el.style.cssText = p.pos;
      el.style.setProperty('--lav-washi-base', p.base);
      el.style.setProperty('--lav-washi-a', p.a);
      el.style.setProperty('--lav-washi-b', p.b);
      layer.appendChild(el);
    });
  }

  function init(options) {
    options = options || {};
    activeSelector = options.selector || activeSelector;
    decorate();
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
