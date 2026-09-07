// modal.js — generic popup. Used for the Date Hub modal now; reusable for future popups.
// Expects #modal-overlay > #modal-content markup in index.html.

const Modal = (function () {
  let lastFocused = null; // restored on close — keyboard/screen-reader users land back where they left off

  function open(html) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!overlay || !content) return;
    lastFocused = document.activeElement;
    content.innerHTML = html;
    overlay.style.display = 'flex';
    // Move focus into the modal so screen readers announce it and Escape/Tab work immediately,
    // without requiring every caller to remember to do this themselves.
    content.setAttribute('tabindex', '-1');
    content.focus({ preventScroll: true });
  }

  function close() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
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

