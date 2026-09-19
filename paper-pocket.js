/*
 * Lavender — Paper Pocket.
 *
 * A decorative physical-looking scrapbook pocket: folded paper
 * construction, a visible opening, a taped edge, a little depth and
 * shadow. Reusable component only — no new storage/data system. It is
 * built to visually hold small paper elements/cards later, but does
 * not implement that behaviour yet.
 *
 * Usage:
 *   const pocket = PaperPocket.mount(container);
 *   pocket.contentsElement.appendChild(someCardEl); // drop something in later
 */
const PaperPocket = (function () {
  const STYLE_ID = 'misc-paper-pocket-style';

  const CSS = `
  .paper-pocket {
    position: relative;
    width: 160px;
    height: 110px;
    background: #f3ead9;
    border-radius: 3px;
    box-shadow: 0 4px 10px rgba(90,70,50,0.16);
    transform: rotate(-1.2deg);
  }
  .paper-pocket::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0) 70%, rgba(90,70,50,0.06) 100%);
    border-radius: inherit;
  }
  .pocket-flap {
    position: absolute;
    left: 8px; right: 8px; top: 0;
    height: 34px;
    background: #ece0ca;
    border-radius: 3px 3px 40px 40px / 3px 3px 14px 14px;
    box-shadow: inset 0 -3px 5px rgba(90,70,50,0.08);
  }
  .pocket-stitch {
    position: absolute;
    left: 6px; right: 6px; bottom: 6px;
    border-top: 1px dashed rgba(120,95,70,0.35);
  }
  .pocket-tape {
    position: absolute;
    top: -8px; left: 50%;
    width: 46px; height: 16px;
    transform: translateX(-50%) rotate(-2deg);
    background: rgba(230,210,180,0.75);
    box-shadow: 0 1px 2px rgba(90,70,50,0.15);
  }
  .pocket-contents {
    position: absolute;
    left: 10px; right: 10px; bottom: 10px; top: 40px;
    overflow: hidden;
  }
  `;

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);

    const el = MiscCore.createEl('div', { className: 'paper-pocket' });
    if (options.rotation !== undefined) el.style.transform = 'rotate(' + options.rotation + 'deg)';
    el.innerHTML =
      '<div class="pocket-tape"></div>' +
      '<div class="pocket-flap"></div>' +
      '<div class="pocket-contents"></div>' +
      '<div class="pocket-stitch"></div>';
    container.appendChild(el);

    return {
      element: el,
      contentsElement: el.querySelector('.pocket-contents'),
      destroy: function () { el.remove(); }
    };
  }

  return { mount: mount };
})();
