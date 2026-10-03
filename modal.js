// modal.js — generic popup. Used for the Date Hub modal now; reusable for future popups.
// Expects #modal-overlay > #modal-content markup in index.html.

const Modal = (function () {
  let closeTimer = null; // pending hide from close(); must be cancelled if open() runs before it fires
  let lastFocused = null; // restored on close — keyboard/screen-reader users land back where they left off

  // Priority lock (Itinerary notification priority) — while a persistent, high-priority modal
  // is showing (Itinerary's late-start / auto-adjust decision prompts), it holds this lock so it
  // can't be dismissed by an outside click or Escape — only an explicit resolution can clear it
  // (close({ resolve: true })). This is the same single Modal every feature already shares; no
  // second notification system. Automatic/heartbeat-driven callers that could otherwise try to
  // open over it (e.g. Study's session prompts) check isLocked() themselves before opening, so a
  // locked tick is simply skipped and retried the next tick — nothing is lost, nothing crashes.
  let lock = null;

  // Popup presentation (phone-style floating card): used for notifications/prompts — opted into
  // with opts.popup, and always for persistent (priority-locked) prompts. Same single Modal, no
  // second system. Non-blocking: the page underneath stays usable. An ignored popup auto-closes
  // after ~1 minute and an upward swipe dismisses it; a locked (decision) prompt does neither —
  // it stays until explicitly resolved, so a required decision is never lost.
  const POPUP_AUTO_MS = 60000;
  const POPUP_SWIPE_PX = 40;
  let popupTimer = null;
  let isPopup = false;

  function clearPopupTimer() {
    if (popupTimer) { window.clearTimeout(popupTimer); popupTimer = null; }
  }

  function isLocked() { return !!lock; }

  function open(html, opts) {
    // Refuse to overwrite an unresolved persistent lock (B3) — mirrors close()'s own
    // { resolve: true } escape hatch, so only the lock holder resolving it can replace it.
    if (lock && !(opts && opts.resolve)) return;
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
    clearPopupTimer();
    isPopup = !!(opts && (opts.popup || opts.persistent));
    overlay.classList.toggle('modal-popup', isPopup);
    content.style.translate = '';
    if (opts && opts.size) content.classList.add('modal-' + opts.size);
    content.innerHTML = html;
    overlay.style.display = 'flex';
    // Move focus into the modal so screen readers announce it and Escape/Tab work immediately,
    // without requiring every caller to remember to do this themselves.
    content.setAttribute('tabindex', '-1');
    content.focus({ preventScroll: true });
    // A caller opts into the priority lock explicitly (opts.persistent) — every other Modal.open()
    // call (the vast majority of the app) behaves exactly as before: no lock, closes normally.
    lock = (opts && opts.persistent) ? { priority: opts.priority || 'normal' } : null;
    if (isPopup && !lock) popupTimer = window.setTimeout(function () { popupTimer = null; close(); }, POPUP_AUTO_MS);
  }

  function close(opts) {
    // An unresolved persistent lock survives outside-click/Escape (both call close() with no
    // opts) — only an explicit { resolve: true } clears it.
    if (lock && !(opts && opts.resolve)) return;
    lock = null;
    clearPopupTimer();
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
      if (content) content.style.translate = '';
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
    // Upward-swipe dismissal for popup-mode modals (bound once; delegated on the shared content).
    const content = document.getElementById('modal-content');
    if (content) {
      let sy = 0, dy = 0, pid = null, moved = false;
      content.addEventListener('pointerdown', function (e) {
        if (!isPopup || lock) return;
        if (e.target.closest && e.target.closest('input, textarea, select')) return;
        pid = e.pointerId; sy = e.clientY; dy = 0; moved = false;
      });
      content.addEventListener('pointermove', function (e) {
        if (pid === null || e.pointerId !== pid) return;
        dy = Math.min(0, e.clientY - sy);
        if (Math.abs(dy) > 6) {
          if (!moved) { moved = true; try { content.setPointerCapture(pid); } catch (err) { /* best-effort */ } }
          content.style.translate = '0 ' + dy + 'px';
        }
      });
      function endSwipe(e) {
        if (pid === null || e.pointerId !== pid) return;
        try { content.releasePointerCapture(pid); } catch (err) { /* best-effort */ }
        pid = null;
        if (!moved) return;
        if (e.type === 'pointerup' && -dy >= POPUP_SWIPE_PX) close();
        else content.style.translate = '';
        content.__swiped = true;
        window.setTimeout(function () { content.__swiped = false; }, 0);
      }
      content.addEventListener('pointerup', endSwipe);
      content.addEventListener('pointercancel', endSwipe);
      // A swipe only dismisses — never fires a button's own action.
      content.addEventListener('click', function (e) {
        if (content.__swiped) { e.stopImmediatePropagation(); e.preventDefault(); }
      }, true);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.style.display !== 'none') close();
    });
  }

  return { open: open, close: close, init: init, isLocked: isLocked };
})();
