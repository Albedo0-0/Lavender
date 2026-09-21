// modal.js — generic popup. Used for the Date Hub modal now; reusable for future popups.
// Expects #modal-overlay > #modal-content markup in index.html.

const Modal = (function () {
  let closeTimer = null; // pending hide from close(); must be cancelled if open() runs before it fires
  let lastFocused = null; // restored on close — keyboard/screen-reader users land back where they left off

  function open(html, opts) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!overlay || !content) return;
    if (typeof MiscSound !== 'undefined') MiscSound.play('uiOpen');
    if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = null; }
    lastFocused = document.activeElement;
    overlay.classList.remove('modal-closing');
    content.classList.remove('modal-closing');
    // Reset any size modifier on every open — the shared #modal-content element persists
    // across unrelated modals, so a size requested by one caller must never leak into the next.
    content.classList.remove('modal-sm', 'modal-md', 'modal-lg');
    if (opts && opts.size) content.classList.add('modal-' + opts.size);
    content.innerHTML = html;
    overlay.style.display = 'flex';
    // Move focus into the modal so screen readers announce it and Escape/Tab work immediately,
    // without requiring every caller to remember to do this themselves.
    content.setAttribute('tabindex', '-1');
    content.focus({ preventScroll: true });
  }

  function close() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!overlay || overlay.style.display === 'none') return;
    if (typeof MiscSound !== 'undefined') MiscSound.play('uiClose');
    overlay.classList.add('modal-closing');
    if (content) content.classList.add('modal-closing');
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(function () {
      closeTimer = null;
      overlay.style.display = 'none';
      overlay.classList.remove('modal-closing');
      if (content) content.classList.remove('modal-closing');
    }, 180);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }

  function init() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.style.display !== 'none') close();
    });
  }

  return { open: open, close: close, init: init };
})();

