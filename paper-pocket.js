/*
 * Lavender — Paper Pocket.
 *
 * A minimal, contemporary paper envelope for the diary sidebar: a clean silhouette, soft paper
 * grain, quiet folds, a flap that hinges open and closed, and a letter that rises out of it.
 * The label card (.pocket-contents) holding the kept photo / note is unchanged in behaviour.
 *
 * The artwork is generated in code (no SVG, no image assets, no emoji): every layer is drawn
 * pixel-by-pixel onto its own canvas on a 64×58 art grid and scaled with pixelated rendering.
 * Everything is sized in the pocket's own width (container units), so the envelope grows and
 * shrinks with the sidebar and keeps its aspect ratio. Layers are separate elements:
 *
 *   .pp-back     inner lining of the envelope
 *   .pp-paper    the letter (rises on open)
 *   .pp-front    folded front panels (side + bottom flaps, fold lines, paper grain)
 *   .pocket-contents  small card that shows the kept photo / note (existing element; hidden while empty)
 *   .pp-flap     3D hinge wrapper with two faces: .pp-flap-out (outside paper) / .pp-flap-in (lining)
 *
 * Art grid: the envelope body is rows 22..57; the 22 rows above it are headroom for the open
 * flap and the raised letter. The pocket's layout box is the body only; the headroom overflows
 * upward (--pp-reach tells the note panel how far).
 *
 * Usage:
 *   const pocket = PaperPocket.mount(container);
 *   pocket.contentsElement.appendChild(someCardEl); // drop something in later
 */
const PaperPocket = (function () {
  const STYLE_ID = 'misc-paper-pocket-style';

  /* ------------------------------------------------------------------ *
   *  Pixel-art generator
   * ------------------------------------------------------------------ */
  const GW = 64, GH = 58;                         // art grid
  // envelope body, centre line, apex of the folded "V", and the closed flap's tip (art px)
  const BX0 = 1, BX1 = 63, BY0 = 22, BY1 = 58, CX = 32, AY = 40, FT = 43;

  function rgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function ramp(list) { return list.map(rgb); }

  // soft warm-white paper, light → deep
  const PAPER = ramp(['#fefdfa', '#f8f6ef', '#efece2', '#e2ded1', '#cfcabb', '#aaa595']);
  // quiet grey-sage lining, light → deep
  const LIN = ramp(['#e4e9e5', '#d5ddd8', '#c2ccc6', '#aab7b0']);
  const INK = rgb('#3a4547');                     // outline, as in the reference
  const INK2 = rgb('#7d8a88');                    // softer interior fold line
  const TEXT = rgb('#74827f');                    // letter lines
  const WHITE = rgb('#fffefb');
  const SHADOW = rgb('#2f3a3c');

  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function bayer(x, y) { return (BAYER[y & 3][x & 3] + 0.5) / 16; }
  function hash(x, y, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  // pick from a ramp at fractional level f, ordered-dithered between neighbours
  function dith(list, f, x, y) {
    if (f < 0) f = 0;
    if (f > list.length - 1) f = list.length - 1;
    const i = Math.floor(f), fr = f - i;
    return list[Math.min(list.length - 1, i + (fr > bayer(x, y) ? 1 : 0))];
  }

  function Buf() { this.d = new Uint8ClampedArray(GW * GH * 4); }
  Buf.prototype.set = function (x, y, c, a) {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return;
    const i = (y * GW + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a === undefined ? 255 : a;
  };
  Buf.prototype.mix = function (x, y, c, a) {           // alpha-over, a in 0..1
    if (x < 0 || y < 0 || x >= GW || y >= GH || a <= 0) return;
    const i = (y * GW + x) * 4, ea = this.d[i + 3] / 255, oa = a + ea * (1 - a);
    for (let k = 0; k < 3; k++) this.d[i + k] = (c[k] * a + this.d[i + k] * ea * (1 - a)) / oa;
    this.d[i + 3] = oa * 255;
  };
  function toCanvas(buf) {
    const c = document.createElement('canvas');
    c.width = GW; c.height = GH;
    c.getContext('2d').putImageData(new ImageData(buf.d, GW, GH), 0, 0);
    return c;
  }

  // ---- geometry ----
  function tt(x) { return 1 - Math.abs(x + 0.5 - CX) / (CX - BX0); }      // 0 at the sides → 1 at the centre
  function yTop(x) { return BY0 + (AY - BY0) * tt(x); }                    // mouth edge, top corners → apex
  function yBot(x) { return BY1 - (BY1 - AY) * tt(x); }                    // bottom fold, bottom corners → apex
  function yFlap(x) { return BY0 + (FT - BY0) * tt(x); }                   // closed flap's lower edge
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
  }
  function dTopLine(x, y) {
    const px = x + 0.5, py = y + 0.5;
    return px < CX ? distSeg(px, py, BX0, BY0, CX, AY) : distSeg(px, py, BX1, BY0, CX, AY);
  }
  function dBotLine(x, y) {
    const px = x + 0.5, py = y + 0.5;
    return px < CX ? distSeg(px, py, BX0, BY1, CX, AY) : distSeg(px, py, BX1, BY1, CX, AY);
  }
  function dFlapEdge(x, y) {
    const px = x + 0.5, py = y + 0.5;
    return px < CX ? distSeg(px, py, BX0, BY0, CX, FT) : distSeg(px, py, BX1, BY0, CX, FT);
  }

  // fine paper grain, returned as a small ramp-level offset
  function grain(x, y) {
    let g = (hash(x, y, 1) - 0.5) * 0.22;
    if (hash(x >> 2, y, 7) > 0.95) g += 0.3;                 // faint fibre
    return g;
  }

  function drawBack() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      if ((x === BX0 || x === BX1 - 1) && y === BY0) continue;
      const f = 2.2 * Math.max(0, 1 - (y - BY0) / 14) + (hash(x, y, 4) - 0.5) * 0.2;   // shade under the hinge
      let c = dith(LIN, f, x, y);
      if (y === BY0 || x === BX0 || x === BX1 - 1) c = INK;
      b.set(x, y, c);
    }
    return toCanvas(b);
  }

  function drawFront() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      if ((x === BX0 || x === BX1 - 1) && y === BY0) continue;
      const py = y + 0.5, t = tt(x), left = (x + 0.5) < CX;
      const top = yTop(x), bot = yBot(x);
      const dT = dTopLine(x, y), dB = dBotLine(x, y);

      if (py < top) {                                                           // the open mouth: only a soft cast shadow
        if (dT < 4 && (1 - dT / 4) * 0.7 > bayer(x, y)) b.mix(x, y, SHADOW, 0.16);
        continue;
      }
      let f;
      if (py > bot) f = 0.15 + 0.9 * ((py - bot) / (BY1 - bot));                // bottom panel: lightest at the fold
      else if (left) f = 0.55 + 0.5 * t * t;                                     // left side panel (lit)
      else f = 1.1 + 0.6 * t * t;                                                // right side panel (in shade)
      f += grain(x, y) * 0.6;

      let c = null;                                                              // folds: soft line, lit lip, tuck shade
      if (dT < 1.0) c = INK2;
      else if (dT < 2.0) c = PAPER[0];
      else if (dB < 1.0) c = PAPER[4];
      else if (dB < 2.0 && py > bot) c = PAPER[0];
      else if (dB < 3.4 && py <= bot) c = (bayer(x, y) < 0.55) ? PAPER[3] : PAPER[2];
      b.set(x, y, c || dith(PAPER, f, x, y));

      // outer edge: ink outline, paper thickness along the foot, lit inner lip
      if (x === BX0 || x === BX1 - 1 || y === BY1 - 1) b.set(x, y, INK);
      else if (y === BY1 - 2) b.set(x, y, PAPER[3]);
      else if (x === BX0 + 1) b.set(x, y, PAPER[0]);
      else if (x === BX1 - 2) b.set(x, y, PAPER[3]);
    }
    return toCanvas(b);
  }

  function drawPaper() {
    const b = new Buf();
    const X0 = 11, X1 = 53, Y0 = 28, Y1 = BY1;                // letter, in its closed (tucked) position
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      let c = WHITE;
      const n = hash(x, y, 3);
      if (n > 0.93) c = PAPER[0]; else if (n < 0.03) c = PAPER[1];
      if (x === X1 - 2) c = PAPER[2];                          // soft shade along the right edge
      if (x === X0 || x === X1 - 1 || y === Y0) c = INK;
      b.set(x, y, c);
    }
    // handwritten-looking lines, short title first (like the reference)
    const rows = [[5, 16, 11], [9, 6, 31], [13, 6, 31], [17, 6, 24], [21, 6, 31], [25, 6, 27], [29, 6, 20]];
    rows.forEach(function (r, ri) {
      const y = Y0 + r[0], xs = X0 + r[1];
      let gap = 4 + Math.floor(hash(ri, 3, 31) * 5);
      for (let i = 0; i < r[2]; i++) {
        if (i === gap) { gap += 5 + Math.floor(hash(ri, i, 33) * 6); continue; }   // word space
        b.set(xs + i, y, TEXT);
      }
    });
    // faint fold crease across the letter
    for (let y = Y0 + 13; y < Y0 + 15; y++) for (let x = X0 + 1; x < X1 - 1; x++) b.mix(x, y, SHADOW, y === Y0 + 13 ? 0.05 : 0.03);
    return toCanvas(b);
  }

  function drawFlapOut() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      const py = y + 0.5, edgeY = yFlap(x);
      if (py > edgeY) continue;
      if ((x === BX0 || x === BX1 - 1) && y === BY0) continue;
      const left = (x + 0.5) < CX, d = dFlapEdge(x, y);
      const f = 0.05 + 0.55 * ((py - BY0) / (FT - BY0)) + (left ? 0 : 0.3) + grain(x, y) * 0.5;
      let c = dith(PAPER, f, x, y);
      if (d < 1.0) c = INK;                                                      // outline
      else if (d < 2.2) c = (bayer(x, y) < 0.55) ? PAPER[3] : PAPER[2];          // paper thickness
      else if (y === BY0 + 1) c = PAPER[0];                                      // lit hinge lip
      if (y === BY0 || x === BX0 || x === BX1 - 1) c = INK;
      b.set(x, y, c);
    }
    return toCanvas(b);
  }

  function drawFlapIn() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      const py = y + 0.5, edgeY = yFlap(x);
      if (py > edgeY) continue;
      if ((x === BX0 || x === BX1 - 1) && y === BY0) continue;
      const d = dFlapEdge(x, y);
      const f = 2.2 * Math.max(0, 1 - (py - BY0) / 14) + (hash(x, y, 4) - 0.5) * 0.2;   // hinge end is the shaded end
      let c = dith(LIN, f, x, y);
      if (d < 1.0) c = INK;
      else if (d < 2.2) c = (bayer(x, y) < 0.55) ? PAPER[1] : PAPER[0];
      if (y === BY0 || x === BX0 || x === BX1 - 1) c = INK;
      b.set(x, y, c);
    }
    return toCanvas(b);
  }

  let ART = null;
  function art() {
    if (!ART) ART = {
      back: drawBack(), paper: drawPaper(), front: drawFront(),
      flapOut: drawFlapOut(), flapIn: drawFlapIn()
    };
    return ART;
  }
  function layerCanvas(cls, source) {
    const c = document.createElement('canvas');
    c.width = GW; c.height = GH;
    c.className = 'pp-layer ' + cls;
    c.setAttribute('aria-hidden', 'true');
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  }

  /* ------------------------------------------------------------------ *
   *  Styles — every size is a share of the pocket's own width (cqw), so the envelope
   *  scales with the sidebar. Layout box = envelope body (64:36); art stage = 64:58.
   * ------------------------------------------------------------------ */
  const CSS = `
  .paper-pocket {
    position: relative;
    width: 80px;                                /* standalone default; the sidebar sets 100% */
    height: auto;
    aspect-ratio: 64 / 36;
    container-type: inline-size;
    cursor: pointer;
    pointer-events: auto;
    --pp-reach: 61.2%;                          /* headroom above the body (22 of 36 rows), used by the note panel */
    --pp-hinge: 37.93%;                         /* hinge row (22 of 58) within the art stage */
    --pp-lift: -34.5%;                          /* how far the letter rises (20 of 58 rows) */
    --pp-dip: 1.4%;                             /* the body settles slightly while the letter is drawn out */
    --pp-open-flap: .6s;                        /* per-layer timings, tweak independently */
    --pp-open-paper: .5s;
    --pp-close-flap: .5s;
    --pp-close-paper: .36s;
  }
  .pp-art {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    aspect-ratio: 64 / 58;                      /* taller than the box: the extra rises above it */
    perspective: 300cqw;
    perspective-origin: 50% 30%;
    filter: drop-shadow(0 0.9cqw 0.8cqw rgba(20, 34, 26, 0.26));
  }
  .pp-layer {
    position: absolute;
    left: 0; top: 0;
    width: 100%; height: 100%;
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    transition: transform .3s cubic-bezier(.3, .7, .3, 1);
  }
  .pp-back  { z-index: 1; }
  .pp-paper {
    z-index: 2;
    transition: transform var(--pp-close-paper) cubic-bezier(.5, 0, .3, 1);
  }
  .pp-front { z-index: 3; }

  .pp-flap {
    position: absolute;
    left: 0; top: 0;
    width: 100%; height: 100%;
    z-index: 6;
    transform-origin: 50% var(--pp-hinge);      /* the hinge: top edge of the envelope body */
    transform-style: preserve-3d;
    transition: transform var(--pp-close-flap) cubic-bezier(.45, 0, .25, 1) .14s, z-index 0s linear .2s;
    will-change: transform;
  }
  .pp-flap .pp-layer {
    -webkit-backface-visibility: hidden;
            backface-visibility: hidden;
    transition: none;
  }
  .pp-flap-in { transform: rotateY(180deg); }

  .pocket-contents {                            /* small card for the kept photo / note */
    position: absolute;
    left: 21.9%; right: 21.9%; top: 75.9%; bottom: 5.2%;
    z-index: 4;
    overflow: hidden;
    box-sizing: border-box;
    padding: 1.2cqw 1.8cqw;
    background: #fbfaf5;
    font-size: clamp(5px, 5.4cqw, 12px);
    box-shadow: 0 0 0 1px rgba(58, 69, 71, 0.7), 0 1.2cqw 1.6cqw -0.8cqw rgba(30, 40, 38, 0.35);
    transition: transform .3s cubic-bezier(.3, .7, .3, 1), opacity .25s ease;
  }
  .pocket-contents:empty { opacity: 0; visibility: hidden; }   /* nothing kept → a clean envelope */

  /* open: flap hinges back, letter rises, the body settles a touch */
  .paper-pocket.is-open .pp-flap {
    transform: translateY(var(--pp-dip)) rotateX(-180deg);
    z-index: 1;                                 /* once past vertical it lies behind the letter */
    transition: transform var(--pp-open-flap) cubic-bezier(.4, 0, .2, 1), z-index 0s linear .27s;
  }
  .paper-pocket.is-open .pp-paper {
    transform: translateY(var(--pp-lift));
    transition: transform var(--pp-open-paper) cubic-bezier(.22, .8, .3, 1) .18s;
  }
  .paper-pocket.is-open .pp-back,
  .paper-pocket.is-open .pp-front,
  .paper-pocket.is-open .pocket-contents { transform: translateY(var(--pp-dip)); }

  @media (hover: hover) {
    .paper-pocket:not(.is-open):hover .pp-flap { transform: rotateX(-14deg); transition-delay: 0s; }
    .paper-pocket:not(.is-open):hover .pp-paper { transform: translateY(-1.5%); }
  }

  .pocket-panel {
    position: absolute;
    bottom: calc(100% + var(--pp-reach) + 10px);   /* clears the raised flap and letter */
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
  .paper-pocket.is-open .pocket-panel { opacity: 1; transform: none; pointer-events: auto; transition-delay: .3s; }
  .pocket-panel textarea {
    width: 100%; box-sizing: border-box; resize: none;
    border: 1px solid #ddd3bd; border-radius: 6px; padding: 5px 7px;
    font: inherit; font-size: 12px; background: #fffdf8; color: #3a3226;
  }
  .pocket-panel .pp-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
  .pocket-panel button { font: inherit; font-size: 11px; border: none; background: none; color: #6b6252; cursor: pointer; padding: 3px 6px; }
  .pocket-panel button.pp-save { background: #8a9468; color: #fffdf8; border-radius: 6px; }

  @media (prefers-reduced-motion: reduce) {
    .pp-layer, .pp-flap, .pocket-contents, .pocket-panel { transition-duration: 0.01s !important; transition-delay: 0s !important; }
  }
  `;

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);

    const el = MiscCore.createEl('div', { className: 'paper-pocket' });
    if (options.rotation !== undefined) el.style.transform = 'rotate(' + options.rotation + 'deg)';
    if (options.position) Object.assign(el.style, options.position);

    // layered pixel-art stage (all canvases generated in code)
    const A = art();
    const stage = MiscCore.createEl('div', { className: 'pp-art' });
    stage.appendChild(layerCanvas('pp-back', A.back));
    stage.appendChild(layerCanvas('pp-paper', A.paper));
    stage.appendChild(layerCanvas('pp-front', A.front));
    const contentsHost = MiscCore.createEl('div', { className: 'pocket-contents' });
    stage.appendChild(contentsHost);
    const flap = MiscCore.createEl('div', { className: 'pp-flap' });
    flap.appendChild(layerCanvas('pp-flap-out', A.flapOut));
    flap.appendChild(layerCanvas('pp-flap-in', A.flapIn));
    stage.appendChild(flap);
    el.appendChild(stage);
    container.appendChild(el);

    const contentsEl = contentsHost;
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
      img.style.display = 'block';
      contentsEl.appendChild(img);
      contentsEl.style.padding = '0';
    }
    function setMessage(text) {
      clear();
      content = { type: 'message', value: text };
      contentsEl.style.padding = '';
      const note = MiscCore.createEl('div', { text: text });
      note.style.fontFamily = 'var(--font-hand, inherit)';
      note.style.fontSize = 'clamp(5px, 5.4cqw, 12px)';
      note.style.lineHeight = '1.1';
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
