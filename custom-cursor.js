/*
 * Lavender — Custom Cursor.
 *
 * A small, subtle scrapbook-flavoured cursor replacement: a soft dot
 * that trails the pointer and gives a gentle response over clickable
 * elements. Disabled automatically on touch/coarse-pointer devices,
 * and always falls back to the native cursor over text inputs,
 * textareas, contenteditable areas and selectable text so it never
 * interferes with typing, selection or accessibility.
 *
 * Usage:
 *   CustomCursor.init();
 *   CustomCursor.destroy(); // fully restores native cursor behaviour
 */
const CustomCursor = (function () {
  const STYLE_ID = 'misc-custom-cursor-style';
  let active = false;
  let reduced = false;
  let dot = null;
  let ring = null;
  let raf = null;
  let mouseX = -100, mouseY = -100;
  let ringX = -100, ringY = -100;

  const CSS = `
  body.lav-custom-cursor, body.lav-custom-cursor * { cursor: none !important; }
  body.lav-custom-cursor input, body.lav-custom-cursor textarea,
  body.lav-custom-cursor [contenteditable="true"], body.lav-custom-cursor [contenteditable=""] {
    cursor: text !important;
  }
  .lav-cursor-dot, .lav-cursor-ring {
    position: fixed;
    top: 0; left: 0;
    pointer-events: none;
    border-radius: 50%;
    z-index: 9999;
    transform: translate(-50%, -50%);
  }
  .lav-cursor-dot {
    width: 6px; height: 6px;
    background: #a98fd6;
    transition: opacity 0.15s ease;
  }
  .lav-cursor-ring {
    width: 22px; height: 22px;
    border: 1px solid rgba(169,143,214,0.5);
    transition: width 0.18s ease, height 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
  }
  .lav-cursor-ring.is-hovering { width: 30px; height: 30px; border-color: rgba(169,143,214,0.85); }
  .lav-cursor-ring.is-pressed { width: 18px; height: 18px; }
  .lav-cursor-dot.is-hidden, .lav-cursor-ring.is-hidden { opacity: 0; }
  `;

  function isCoarsePointer() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function isTextContext(el) {
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  function frame() {
    if (!active) return;
    const ease = reduced ? 1 : 0.35;
    ringX += (mouseX - ringX) * ease;
    ringY += (mouseY - ringY) * ease;
    dot.style.left = mouseX + 'px';
    dot.style.top = mouseY + 'px';
    ring.style.left = ringX + 'px';
    ring.style.top = ringY + 'px';
    raf = requestAnimationFrame(frame);
  }

  function onMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    const overText = isTextContext(e.target);
    dot.classList.toggle('is-hidden', overText);
    ring.classList.toggle('is-hidden', overText);
    const overClickable = !overText && !!e.target.closest('a, button, [role="button"], .lav-pressable, .pin, .washi-tape');
    ring.classList.toggle('is-hovering', overClickable);
  }
  function onDown() { ring.classList.add('is-pressed'); }
  function onUp() { ring.classList.remove('is-pressed'); }
  function onLeaveWindow() {
    dot.classList.add('is-hidden');
    ring.classList.add('is-hidden');
  }

  function init() {
    if (active || isCoarsePointer()) return;
    active = true;
    reduced = MiscCore.prefersReducedMotion();
    MiscCore.injectStyle(STYLE_ID, CSS);
    document.body.classList.add('lav-custom-cursor');

    dot = MiscCore.createEl('div', { className: 'lav-cursor-dot' });
    ring = MiscCore.createEl('div', { className: 'lav-cursor-ring' });
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', onLeaveWindow);

    raf = requestAnimationFrame(frame);
  }

  function destroy() {
    if (!active) return;
    active = false;
    document.body.classList.remove('lav-custom-cursor');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('mouseleave', onLeaveWindow);
    if (raf) cancelAnimationFrame(raf);
    if (dot) dot.remove();
    if (ring) ring.remove();
    dot = null;
    ring = null;
  }

  return { init: init, destroy: destroy };
})();
