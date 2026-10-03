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
    content.style.opacity = '';
    content.style.transition = '';
    if (opts && opts.size) content.classList.add('modal-' + opts.size);
    content.innerHTML = html;
    overlay.style.display = 'flex';
    // Popup cards that fit take any-direction swipes (touch-action none); a scrollable one
    // keeps vertical scrolling and accepts horizontal swipes only.
    content.style.touchAction = isPopup
      ? (content.scrollHeight > content.clientHeight + 1 ? 'pan-y' : 'none')
      : '';
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
      if (content) { content.style.translate = ''; content.style.opacity = ''; content.style.transition = ''; }
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
    // Swipe-to-dismiss for popup-mode modals (bound once; delegated on the shared content).
    const content = document.getElementById('modal-content');
    if (content) {
      let sx = 0, sy = 0, dx = 0, dy = 0, pid = null, moved = false, t0 = 0;
      content.addEventListener('pointerdown', function (e) {
        if (!isPopup || lock) return;
        if (e.target.closest && e.target.closest('input, textarea, select')) return;
        pid = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; dy = 0; moved = false; t0 = Date.now();
        content.style.transition = '';
      });
      content.addEventListener('pointermove', function (e) {
        if (pid === null || e.pointerId !== pid) return;
        dx = e.clientX - sx;
        dy = Math.min(0, e.clientY - sy);
        if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
          // A scrollable card's vertical drag is a scroll, not a dismiss.
          if (content.style.touchAction === 'pan-y' && Math.abs(dy) > Math.abs(dx)) { pid = null; return; }
          moved = true;
          try { content.setPointerCapture(pid); } catch (err) { /* best-effort */ }
        }
        if (moved) {
          content.style.translate = dx + 'px ' + dy + 'px';
          content.style.opacity = String(Math.max(0.2, 1 - Math.hypot(dx, dy) / 240));
        }
      });
      function endSwipe(e) {
        if (pid === null || e.pointerId !== pid) return;
        try { content.releasePointerCapture(pid); } catch (err) { /* best-effort */ }
        pid = null;
        if (!moved) return;
        content.__swiped = true;
        window.setTimeout(function () { content.__swiped = false; }, 0);
        const dist = Math.hypot(dx, dy);
        const speed = dist / Math.max(1, Date.now() - t0);
        if (dist >= POPUP_SWIPE_PX || (speed > 0.5 && dist > 15)) {
          const far = Math.max(window.innerWidth, 400);
          content.style.transition = 'translate 0.18s ease-out, opacity 0.18s ease-out';
          content.style.translate = Math.abs(dx) > Math.abs(dy) ? ((dx > 0 ? far : -far) + 'px 0px') : '0px -200px';
          content.style.opacity = '0';
          close();
        } else {
          content.style.transition = 'translate 0.15s ease-out, opacity 0.15s ease-out';
          content.style.translate = '0px 0px';
          content.style.opacity = '1';
        }
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
