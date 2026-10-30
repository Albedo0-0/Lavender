/*
 * Lavender — Paper Pocket.
 *
 * A decorative, physical-looking diary envelope: layered paper construction, a flap that
 * hinges open and closed, a letter that slides out, a glued label card holding the kept
 * photo/note, and a little depth. Reusable component only — no new storage/data system.
 *
 * The artwork is generated in code (no SVG, no image assets, no emoji): every layer is drawn
 * pixel-by-pixel onto its own canvas on a 160×108 art grid (2 art px per CSS px), then shown
 * at 80×54 CSS px with pixelated scaling. Layers are separate elements so each can be
 * restyled or animated independently:
 *
 *   .pp-back     inner lining of the envelope
 *   .pp-paper    the letter (slides up on open)
 *   .pp-front    folded front panels (side flaps + bottom flap, fold lines, paper texture)
 *   .pocket-contents  glued label card that shows the kept photo / note (existing element)
 *   .pp-corners  photo corners holding the card
 *   .pp-flap     3D hinge wrapper with two faces: .pp-flap-out (wax seal) / .pp-flap-in (lining)
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
  const GW = 160, GH = 108;                       // art grid
  // envelope body, hinge, apex of the folded "X", and flap tip (art px)
  const BX0 = 2, BX1 = 158, BY0 = 22, BY1 = 106, CX = 80, AY = 58, FT = 62;
  // glued label card (art px) — mirrored by .pocket-contents in CSS (left/right 11px, top 31px, bottom 3px)
  const CARD = { x0: 22, y0: 62, x1: 138, y1: 102 };

  function rgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function ramp(list) { return list.map(rgb); }

  // warm cream paper, light → deep (index 5 doubles as the soft ink line)
  const PAPER = ramp(['#fdf9ef', '#f8f0df', '#f1e5cc', '#e8d9bb', '#decba8', '#c7b08a']);
  // lavender lining
  const LINING = { base: rgb('#ddd3ec'), dot: rgb('#cdc1e1'), deep: rgb('#a898c4'), edge: rgb('#8f7fb0') };
  // wax seal
  const WAX = ramp(['#c1b4dc', '#a595c9', '#8877b0', '#6a5892', '#52427a']);
  const SAGE = { l: rgb('#9db89e'), d: rgb('#6f8f78') };
  const SHADOW = rgb('#4d3a5e');
  const WHITE = rgb('#fffdf6');

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
  function yTop(x) { return BY0 + (AY - BY0) * tt(x); }                    // fold line, top corners → apex (mouth edge)
  function yBot(x) { return BY1 - (BY1 - AY) * tt(x); }                    // fold line, bottom corners → apex
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
  function inBody(x, y) { return x >= BX0 && x < BX1 && y >= BY0 && y < BY1; }

  // paper grain: speckle + short horizontal fibres, returned as a ramp-level offset
  function grain(x, y) {
    let g = (hash(x, y, 1) - 0.5) * 0.34;
    if (hash(x >> 2, y, 7) > 0.94) g += 0.55;                // fibre dash
    if (hash(x, y >> 1, 11) > 0.985) g -= 0.5;               // light fleck
    return g;
  }

  function envelopeOutline(buf, x, y) {                      // soft ink edge + paper thickness on the body
    if (x === BX0 || x === BX1 - 1 || y === BY1 - 1) { buf.set(x, y, PAPER[5]); return true; }
    if (y === BY1 - 2) { buf.set(x, y, PAPER[4]); return true; }
    if (x === BX0 + 1) { buf.set(x, y, PAPER[0]); return true; }
    if (x === BX1 - 2) { buf.set(x, y, PAPER[4]); return true; }
    return false;
  }

  function drawBack() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      if ((x === BX0 || x === BX1 - 1) && (y === BY0)) continue;               // softened top corners
      let c = LINING.base;
      const row = (y >> 2), off = (row & 1) * 4;
      if ((((x + off) & 7) < 2) && ((y & 7) < 2)) c = LINING.dot;               // fine staggered dot print
      // shade under the flap hinge
      const k = (y - BY0) / 16;
      if (k < 1 && (1 - k) * 0.55 > bayer(x, y)) c = LINING.deep;
      b.set(x, y, c);
      if (y === BY0 || x === BX0 || x === BX1 - 1 || y === BY1 - 1) b.set(x, y, PAPER[5]);
      else if (y === BY0 + 1) b.set(x, y, LINING.edge);
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
        if (dT < 5 && (1 - dT / 5) * 0.9 > bayer(x, y)) b.mix(x, y, SHADOW, 0.2);   // dithered, stays crisp
        continue;
      }
      let f;
      if (py > bot) f = 0.45 + 1.0 * ((py - bot) / (BY1 - bot));                // bottom flap: lightest at the fold
      else if (left) f = 1.35 + 0.8 * t * t;                                     // left side flap (lit)
      else f = 2.35 + 0.9 * t * t;                                               // right side flap (in shade)
      f += grain(x, y);
      // folds: ink line, lit lip on the flap side, shade where one panel tucks under another
      let c = null;
      if (dT < 1.0) c = PAPER[5];
      else if (dT < 2.0) c = PAPER[0];
      else if (dB < 1.0) c = PAPER[5];
      else if (dB < 2.0 && py > bot) c = WHITE;
      else if (dB < 3.6 && py <= bot) c = PAPER[4];
      else if (dB < 4.6 && py <= bot && bayer(x, y) < 0.5) c = PAPER[3];
      b.set(x, y, c || dith(PAPER, f, x, y));
      envelopeOutline(b, x, y);
    }
    // contact shadow under the glued card
    for (let y = CARD.y1; y < CARD.y1 + 3; y++) for (let x = CARD.x0 + 1; x < CARD.x1 + 2; x++)
      b.mix(x, y, SHADOW, y === CARD.y1 ? 0.22 : 0.12);
    for (let y = CARD.y0 + 1; y < CARD.y1 + 1; y++) for (let x = CARD.x1; x < CARD.x1 + 2; x++)
      b.mix(x, y, SHADOW, x === CARD.x1 ? 0.2 : 0.1);
    return toCanvas(b);
  }

  function drawPaper() {
    const b = new Buf();
    const X0 = 16, X1 = 144, Y0 = 26, Y1 = 98;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      let c = WHITE;
      const n = hash(x, y, 3);
      if (n > 0.9) c = PAPER[0]; else if (n < 0.04) c = PAPER[1];
      if (hash(x >> 2, y, 5) > 0.965) c = PAPER[1];
      if (x === X0 || y === Y0) c = PAPER[2];
      if (x === X1 - 1 || y === Y1 - 1) c = PAPER[3];
      b.set(x, y, c);
    }
    // faint lavender ruling
    for (let y = Y0 + 18; y < Y1 - 6; y += 7) {
      const end = (y === Y0 + 18) ? X1 - 46 : X1 - 14;
      for (let x = X0 + 12; x < end; x++) if (hash(x, y, 9) > 0.04) b.set(x, y, rgb('#e2daef'));
    }
    // folded-letter crease
    for (let y = 58; y < 62; y++) for (let x = X0 + 1; x < X1 - 1; x++) b.mix(x, y, SHADOW, (y === 59 || y === 60) ? 0.07 : 0.03);
    // small pressed sprig, top right
    const sx = X1 - 22, sy = Y0 + 6;
    for (let i = 0; i < 14; i++) b.set(sx + Math.round(Math.sin(i / 3.2) * 1.2), sy + i, SAGE.d);
    [[3, 'l'], [6, 'r'], [9, 'l'], [12, 'r']].forEach(function (p, i) {
      const yy = sy + p[0], dir = p[1] === 'l' ? -1 : 1, x0 = sx + Math.round(Math.sin(p[0] / 3.2) * 1.2);
      b.set(x0 + dir, yy - 1, SAGE.l); b.set(x0 + dir * 2, yy - 1, SAGE.l); b.set(x0 + dir * 3, yy - 2, SAGE.l);
      b.set(x0 + dir, yy, SAGE.d);
    });
    return toCanvas(b);
  }

  function drawCorners() {
    const b = new Buf();
    const K = rgb('#a9946e'), KH = rgb('#d6c498'), KD = rgb('#7e6b4c');
    const L = 11;
    function corner(cx, cy, sx, sy) {                       // sx, sy = ±1 pointing into the card
      for (let j = 0; j < L; j++) for (let i = 0; i < L; i++) {
        if (i + j > L - 1) continue;
        const x = cx + sx * i, y = cy + sy * j;
        let c = K;
        if (i + j >= L - 2) c = KD;                          // hypotenuse edge
        else if (i === 0 || j === 0) c = KD;                 // cut edges
        else if (i === 1 || j === 1) c = KH;                 // lit lip
        b.set(x, y, c);
      }
    }
    corner(CARD.x0 - 1, CARD.y0 - 1, 1, 1);
    corner(CARD.x1, CARD.y0 - 1, -1, 1);
    corner(CARD.x0 - 1, CARD.y1, 1, -1);
    corner(CARD.x1, CARD.y1, -1, -1);
    return toCanvas(b);
  }

  function drawFlapOut() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      const py = y + 0.5, edgeY = yFlap(x);
      if (py > edgeY) continue;
      if ((x === BX0 || x === BX1 - 1) && y === BY0) continue;
      const left = (x + 0.5) < CX, d = dFlapEdge(x, y);
      let f = 0.0 + 0.85 * ((py - BY0) / (FT - BY0)) + (left ? 0 : 0.35) + grain(x, y);
      let c = dith(PAPER, f, x, y);
      if (d < 1.0) c = PAPER[5];                                                // ink edge
      else if (d < 2.2) c = (bayer(x, y) < 0.6) ? PAPER[3] : PAPER[2];          // paper thickness on the lower edge
      if (y === BY0) c = PAPER[5];                                              // hinge fold
      else if (y === BY0 + 1) c = PAPER[3];
      else if (y === BY0 + 2 && d >= 2.2) c = PAPER[0];
      if (x === BX0 || x === BX1 - 1) c = PAPER[5];
      b.set(x, y, c);
    }
    // wax seal (embossed sprig), with a soft contact shadow
    const sx = 80, sy = 51, R = 8.2;
    for (let y = sy - 11; y <= sy + 12; y++) for (let x = sx - 11; x <= sx + 11; x++) {
      const dx = x + 0.5 - sx, dy = y + 0.5 - sy, r = Math.sqrt(dx * dx + dy * dy);
      const wob = (hash(x, y, 21) - 0.5) * 0.9 + Math.sin(Math.atan2(dy, dx) * 5) * 0.35;
      const sdx = dx - 1.6, sdy = dy - 2.2, sr = Math.sqrt(sdx * sdx + sdy * sdy);
      if (r > R + wob && sr < R + 1.8 && sr > R - 1 + wob && bayer(x, y) < 0.6) b.mix(x, y, SHADOW, 0.22);
      if (r > R + wob) continue;
      const light = Math.sqrt((dx + 2.4) * (dx + 2.4) + (dy + 2.8) * (dy + 2.8)) / (R * 1.9);
      let c = dith(WAX, 0.3 + light * 3.0, x, y);
      if (r > R - 1.3 + wob) c = WAX[3];                                       // rim
      else if (r > R - 2.4 && r < R - 1.5) c = dith(WAX, 1.4 + light * 2.4, x, y); // inner groove
      b.set(x, y, c);
    }
    // sprig imprint
    for (let i = 0; i < 9; i++) b.set(sx - 1, sy - 4 + i, WAX[4]), b.set(sx, sy - 4 + i, WAX[4]);
    [[-2, -1], [-3, -2], [1, 0], [2, -1], [-2, 2], [-3, 1], [1, 3], [2, 2]].forEach(function (p) { b.set(sx + p[0] - (p[0] < 0 ? 0 : 0), sy + p[1], WAX[4]); });
    [[-1, -4], [0, -5]].forEach(function (p) { b.set(sx + p[0], sy + p[1], WAX[0]); });
    return toCanvas(b);
  }

  function drawFlapIn() {
    const b = new Buf();
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
      const py = y + 0.5, edgeY = yFlap(x);
      if (py > edgeY) continue;
      if ((x === BX0 || x === BX1 - 1) && y === BY0) continue;
      const d = dFlapEdge(x, y);
      let c = LINING.base;
      const row = (y >> 2), off = (row & 1) * 4;
      if ((((x + off) & 7) < 2) && ((y & 7) < 2)) c = LINING.dot;
      const k = (py - BY0) / 14;                                               // hinge end is the shaded end
      if (k < 1 && (1 - k) * 0.7 > bayer(x, y)) c = LINING.deep;
      if (d < 1.0) c = PAPER[5];
      else if (d < 2.2) c = (bayer(x, y) < 0.55) ? PAPER[1] : PAPER[0];
      if (y === BY0) c = PAPER[5];
      if (x === BX0 || x === BX1 - 1) c = PAPER[5];
      b.set(x, y, c);
    }
    return toCanvas(b);
  }

  let ART = null;
  function art() {
    if (!ART) ART = {
      back: drawBack(), paper: drawPaper(), front: drawFront(),
      corners: drawCorners(), flapOut: drawFlapOut(), flapIn: drawFlapIn()
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
   *  Styles
   * ------------------------------------------------------------------ */
  const CSS = `
  .paper-pocket {
    position: relative;
    width: 80px;
    height: 54px;
    cursor: pointer;
    pointer-events: auto;
    transform: rotate(-1.2deg);
    --pp-body-dip: 1px;                         /* how far the envelope settles while the letter is drawn out */
    --pp-open-flap: .62s;                       /* per-layer timings, tweak independently */
    --pp-open-paper: .52s;
    --pp-close-flap: .5s;
    --pp-close-paper: .34s;
  }
  .pp-art {
    position: absolute;
    left: 50%; bottom: 0;                       /* native 80×54 art box, centred in whatever box the pocket is given */
    width: 80px; height: 54px;
    margin-left: -40px;
    perspective: 260px;
    perspective-origin: 50% 20%;
    filter: drop-shadow(0 2px 1.5px rgba(90, 70, 50, 0.22));
  }
  .pp-layer {
    position: absolute;
    left: 0; top: 0;
    width: 80px; height: 54px;
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    transition: transform .3s cubic-bezier(.3, .7, .3, 1);
  }
  .pp-back    { z-index: 1; }
  .pp-paper   {
    z-index: 2;
    transform-origin: 50% 100%;
    transition: transform var(--pp-close-paper) cubic-bezier(.5, 0, .3, 1);
  }
  .pp-front   { z-index: 3; }
  .pp-corners { z-index: 5; }

  .pp-flap {
    position: absolute;
    left: 0; top: 0;
    width: 80px; height: 54px;
    z-index: 6;
    transform-origin: 50% 11px;                 /* the hinge: top edge of the envelope body */
    transform-style: preserve-3d;
    transition: transform var(--pp-close-flap) cubic-bezier(.5, 0, .25, 1) .14s, z-index 0s linear .2s;
    will-change: transform;
  }
  .pp-flap .pp-layer {
    -webkit-backface-visibility: hidden;
            backface-visibility: hidden;
    transition: none;
  }
  .pp-flap-in { transform: rotateY(180deg); }

  .pocket-contents {
    position: absolute;
    left: 11px; right: 11px; top: 31px; bottom: 3px;   /* the glued label card */
    z-index: 4;
    overflow: hidden;
    box-sizing: border-box;
    padding: 1px 3px;
    background: #fbf6ea;
    box-shadow: inset 0 0 0 1px #d8c7a4, inset 0 1px 0 #fffdf6;
    transition: transform .3s cubic-bezier(.3, .7, .3, 1);
  }

  /* open: flap hinges back, letter slides up, the body settles a pixel */
  .paper-pocket.is-open .pp-flap {
    transform: translateY(var(--pp-body-dip)) rotateX(-180deg);
    z-index: 1;                                 /* once past vertical it lies behind the letter */
    transition: transform var(--pp-open-flap) cubic-bezier(.3, 1.08, .5, 1), z-index 0s linear .27s;
  }
  .paper-pocket.is-open .pp-paper {
    transform: translateY(-15px) rotate(-1.1deg);
    transition: transform var(--pp-open-paper) cubic-bezier(.22, .8, .3, 1) .16s;
  }
  .paper-pocket.is-open .pp-back,
  .paper-pocket.is-open .pp-front,
  .paper-pocket.is-open .pp-corners,
  .paper-pocket.is-open .pocket-contents { transform: translateY(var(--pp-body-dip)); }

  @media (hover: hover) {
    .paper-pocket:not(.is-open):hover .pp-flap { transform: rotateX(-16deg); transition-delay: 0s; }
    .paper-pocket:not(.is-open):hover .pp-paper { transform: translateY(-1px); }
  }

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
    stage.appendChild(layerCanvas('pp-corners', A.corners));
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
      note.style.fontSize = '9px';
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
