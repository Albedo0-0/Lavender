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
  `;

  function init(options) {
    if (initialized) return;
    initialized = true;
    options = options || {};
    const selector = options.selector || '.pin, [data-pin]';
    MiscCore.injectStyle(STYLE_ID, CSS);
    if (typeof PressedPaper !== 'undefined') PressedPaper.autoInit(selector);

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
