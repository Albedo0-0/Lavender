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
    width: 80px;
    height: 54px;
    cursor: pointer;
    pointer-events: auto;
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
    left: 4px; right: 4px; top: 0;
    height: 17px;
    transform-origin: 50% 0;
    transition: transform 0.35s ease;
    background: #ece0ca;
    border-radius: 3px 3px 40px 40px / 3px 3px 14px 14px;
    box-shadow: inset 0 -3px 5px rgba(90,70,50,0.08);
  }
  .pocket-stitch {
    position: absolute;
    left: 4px; right: 4px; bottom: 3px;
    border-top: 1px dashed rgba(120,95,70,0.35);
  }
  .pocket-tape {
    position: absolute;
    top: -5px; left: 50%;
    width: 24px; height: 9px;
    transform: translateX(-50%) rotate(-2deg);
    background: rgba(230,210,180,0.75);
    box-shadow: 0 1px 2px rgba(90,70,50,0.15);
  }
  .paper-pocket.is-open .pocket-flap { transform: translateY(-4px) scaleY(0.8); }
  .pocket-panel {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    width: 190px;
    padding: 10px;
    background: #fffdf8;
    border: 1px solid #ddd3bd;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(90,70,50,0.18);
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
    transition: opacity 0.25s ease, transform 0.25s ease;
    z-index: 5;
    cursor: default;
  }
  .paper-pocket.is-open .pocket-panel { opacity: 1; transform: none; pointer-events: auto; }
  .pocket-panel textarea {
    width: 100%; box-sizing: border-box; resize: none;
    border: 1px solid #ddd3bd; border-radius: 6px; padding: 5px 7px;
    font: inherit; font-size: 12px; background: #fffdf8; color: #3a3226;
  }
  .pocket-panel .pp-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
  .pocket-panel button { font: inherit; font-size: 11px; border: none; background: none; color: #6b6252; cursor: pointer; padding: 3px 6px; }
  .pocket-panel button.pp-save { background: #8a9468; color: #fffdf8; border-radius: 6px; }
  .pocket-contents {
    position: absolute;
    left: 5px; right: 5px; bottom: 5px; top: 20px;
    overflow: hidden;
  }
  `;

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);

    const el = MiscCore.createEl('div', { className: 'paper-pocket' });
    if (options.rotation !== undefined) el.style.transform = 'rotate(' + options.rotation + 'deg)';
    if (options.position) Object.assign(el.style, options.position);
    el.innerHTML =
      '<div class="pocket-tape"></div>' +
      '<div class="pocket-flap"></div>' +
      '<div class="pocket-contents"></div>' +
      '<div class="pocket-stitch"></div>';
    container.appendChild(el);

    const contentsEl = el.querySelector('.pocket-contents');
    let content = null; // { type: 'photo'|'message', value } — only one slot at a time

    function clear() {
      content = null;
      contentsEl.innerHTML = '';
    }
    function setPhoto(url) {
      clear();
      content = { type: 'photo', value: url };
      const img = MiscCore.createEl('img', { attrs: { src: url, alt: 'kept photo' } });
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '2px';
      contentsEl.appendChild(img);
    }
    function setMessage(text) {
      clear();
      content = { type: 'message', value: text };
      const note = MiscCore.createEl('div', { text: text });
      note.style.fontFamily = 'var(--font-hand, inherit)';
      note.style.fontSize = '11px';
      note.style.lineHeight = '1.2';
      note.style.color = 'var(--color-text, #3a3226)';
      contentsEl.appendChild(note);
    }

    const panel = MiscCore.createEl('div', { className: 'pocket-panel' });
    panel.innerHTML =
      '<textarea rows="3" maxlength="120" placeholder="a little note&hellip;"></textarea>' +
      '<div class="pp-actions">' +
      '<button type="button" class="pp-photo">photo</button>' +
      '<button type="button" class="pp-clear">empty</button>' +
      '<button type="button" class="pp-save">keep note</button>' +
      '</div>' +
      '<input type="file" accept="image/*" hidden>';
    el.appendChild(panel);
    const ta = panel.querySelector('textarea');
    const fileIn = panel.querySelector('input[type="file"]');

    function setOpen(next) {
      el.classList.toggle('is-open', next);
      if (next) ta.value = content && content.type === 'message' ? content.value : '';
    }
    el.addEventListener('click', function (e) {
      if (e.target.closest('.pocket-panel')) return;
      setOpen(!el.classList.contains('is-open'));
    });
    panel.querySelector('.pp-save').addEventListener('click', function () {
      const t = ta.value.trim();
      if (t) setMessage(t);
      setOpen(false);
    });
    panel.querySelector('.pp-clear').addEventListener('click', function () {
      clear();
      ta.value = '';
      setOpen(false);
    });
    panel.querySelector('.pp-photo').addEventListener('click', function () { fileIn.click(); });
    fileIn.addEventListener('change', function () {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () { setPhoto(reader.result); setOpen(false); };
      reader.readAsDataURL(f);
      fileIn.value = '';
    });

    return {
      element: el,
      contentsElement: contentsEl,
      setPhoto: setPhoto,
      setMessage: setMessage,
      clear: clear,
      getContent: function () { return content; },
      destroy: function () { el.remove(); }
    };
  }

  return { mount: mount };
})();
