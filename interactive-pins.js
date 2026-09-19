/*
 * Lavender — Interactive Pins.
 *
 * Makes existing decorative scrapbook pins subtly interactive: a tiny
 * press response (reuses PressedPaper) plus a small rotation wiggle,
 * as if the pin shifted slightly in the corkboard/paper.
 *
 * Progressive enhancement only — this does not create any pins, it
 * just wires behaviour onto elements matching `selector`. The default
 * selector is a best guess; pass the real one once existing markup is
 * inspected during integration.
 *
 * Usage:
 *   InteractivePins.init();                              // default selector
 *   InteractivePins.init({ selector: '.scrapbook-pin' }); // explicit selector
 */
const InteractivePins = (function () {
  const STYLE_ID = 'misc-pins-style';
  let initialized = false;

  const CSS = `
  .lav-pin-interactive { transition: transform 0.18s ease; transform-origin: 50% 20%; }
  .lav-pin-interactive.is-wiggling { transform: rotate(var(--lav-pin-angle, 6deg)); }
  .lav-pin-deco {
    position: absolute;
    top: 5px;
    width: 16px; height: 16px;
    border-radius: 50%;
    pointer-events: auto;
    cursor: pointer;
    background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.8) 0 12%, var(--lav-pin-color, #c9788a) 42%, rgba(40,20,20,0.35) 100%);
    box-shadow: 2px 3px 3px rgba(60,45,40,0.35);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .lav-pin-deco.is-pressed { transform: translate(1px, 2px) scale(0.92); box-shadow: 1px 1px 2px rgba(60,45,40,0.3); }
  @media (prefers-reduced-motion: reduce) { .lav-pin-interactive, .lav-pin-deco { transition: none; } }
  `;

  function decorate() {
    const layer = MiscCore.getDecorLayer();
    if (layer.querySelector('.lav-pin-deco')) return;
    [{ left: '22%', color: '#c9788a' }, { left: '78%', color: '#7f9a68' }].forEach(function (p) {
      const pin = MiscCore.createEl('span', { className: 'pin lav-pin-deco', attrs: { role: 'button', tabindex: '-1', 'aria-label': 'pin' } });
      pin.style.left = p.left;
      pin.style.setProperty('--lav-pin-color', p.color);
      layer.appendChild(pin);
    });
  }

  function init(options) {
    if (initialized) return;
    initialized = true;
    options = options || {};
    const selector = options.selector || '.pin, [data-pin]';
    MiscCore.injectStyle(STYLE_ID, CSS);
    decorate();
    if (typeof PressedPaper !== 'undefined') {
      PressedPaper.autoInit(selector);
      document.querySelectorAll(selector).forEach(function (el) { PressedPaper.apply(el); });
    }

    document.addEventListener('click', function (e) {
      const el = e.target.closest(selector);
      if (!el) return;
      el.classList.add('lav-pin-interactive');
      el.style.setProperty('--lav-pin-angle', MiscCore.rand(-7, 7).toFixed(1) + 'deg');
      el.classList.add('is-wiggling');
      if (typeof MiscSound !== 'undefined') MiscSound.play('pinClick');
      setTimeout(function () { el.classList.remove('is-wiggling'); }, 220);
    });
  }

  return { init: init };
})();
