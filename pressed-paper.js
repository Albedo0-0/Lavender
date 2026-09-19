/*
 * Lavender — Pressed Paper effect.
 *
 * Reusable tactile "paper pressed down" interaction: on press, an
 * element settles down slightly with a softened shadow, then eases
 * back on release. No bounce, no exaggerated scale — meant to feel
 * physical rather than like a generic button animation.
 *
 * Usage:
 *   PressedPaper.apply(someElement);                 // wire one element
 *   PressedPaper.autoInit('[data-pressable]');        // delegate app-wide
 */
const PressedPaper = (function () {
  const STYLE_ID = 'misc-pressed-paper-style';
  let delegated = false;
  let delegatedSelector = '[data-pressable]';

  const CSS = `
  .lav-pressable { transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .lav-pressable.is-pressed {
    transform: translateY(1px) scale(0.99);
    box-shadow: 0 1px 3px rgba(60,45,80,0.18);
  }
  `;

  function wire(el) {
    if (!el || el.__pressedPaperWired) return;
    el.__pressedPaperWired = true;
    el.classList.add('lav-pressable');
    const press = function () { el.classList.add('is-pressed'); };
    const release = function () { el.classList.remove('is-pressed'); };
    el.addEventListener('mousedown', press);
    el.addEventListener('touchstart', press, { passive: true });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(function (evt) {
      el.addEventListener(evt, release);
    });
  }

  function apply(el) {
    MiscCore.injectStyle(STYLE_ID, CSS);
    wire(el);
  }

  // Event-delegated version so elements added later (re-renders) are
  // covered automatically, without attaching a fresh listener per element
  // and without ever attaching more than one delegated listener set.
  function autoInit(selector) {
    MiscCore.injectStyle(STYLE_ID, CSS);
    if (delegated) return;
    delegated = true;
    delegatedSelector = selector || delegatedSelector;

    document.addEventListener('mousedown', function (e) {
      const el = e.target.closest(delegatedSelector);
      if (el) el.classList.add('lav-pressable', 'is-pressed');
    });
    document.addEventListener('touchstart', function (e) {
      const el = e.target.closest(delegatedSelector);
      if (el) el.classList.add('lav-pressable', 'is-pressed');
    }, { passive: true });

    // mouseleave doesn't bubble, so instead of trying to delegate it,
    // release every currently-pressed match on any plausible "let go"
    // signal — this can never leave a stuck .is-pressed element behind.
    function releaseAll() {
      document.querySelectorAll(delegatedSelector + '.is-pressed').forEach(function (el) {
        el.classList.remove('is-pressed');
      });
    }
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel', 'blur'].forEach(function (evt) {
      window.addEventListener(evt, releaseAll, true);
    });
  }

  return { apply: apply, autoInit: autoInit };
})();
