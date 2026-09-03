// modal.js — generic popup. Used for the Date Hub modal now; reusable for future popups.
// Expects #modal-overlay > #modal-content markup in index.html.

const Modal = (function () {
  function open(html) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!overlay || !content) return;
    content.innerHTML = html;
    overlay.style.display = 'flex';
  }

  function close() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function init() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
  }

  return { open: open, close: close, init: init };
})();

