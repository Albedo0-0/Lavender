/*
 * Lavender — Forced Fullscreen.
 *
 * A setting, not a standalone screen: when enabled, uses the real
 * browser Fullscreen API (Element.requestFullscreen) to keep the app
 * in fullscreen, and tries to restore fullscreen if the browser/user
 * exits it while the setting is still on. Nothing here fakes
 * fullscreen with CSS (100vh containers, hidden chrome, etc.) — if the
 * browser refuses the request, the app just stays as it is and tries
 * again on the next user gesture, per the Fullscreen API's own rules.
 *
 * Persistence: reuses the existing `settings` key in state.js
 * (`State.get().settings.forcedFullscreen`), the same object
 * settings.js already owns — this does not create a second store.
 *
 * Usage (wire into settings.js):
 *   ForcedFullscreen.init();                 // once, on app start
 *   ForcedFullscreen.isEnabled();             // -> boolean, for rendering a checkbox
 *   ForcedFullscreen.setEnabled(checkbox.checked); // on the checkbox's change handler
 */
const ForcedFullscreen = (function () {
  let wired = false;
  let retryOnGesture = false;

  function isSupported() {
    return !!(document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen);
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function isEnabled() {
    const settings = (State.get().settings || {});
    return !!settings.forcedFullscreen;
  }

  function persist(enabled) {
    State.patch('settings', { forcedFullscreen: enabled });
  }

  function requestFullscreen() {
    if (!isSupported() || isFullscreen()) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      const result = req.call(el);
      if (result && result.catch) {
        result.then(function () { retryOnGesture = false; }).catch(function () {
          // Browser refused (no user gesture yet, or the user's own
          // browser settings block it) — wait for the next real click/key
          // press and try again then, instead of looping or faking it.
          retryOnGesture = true;
        });
      } else {
        retryOnGesture = false;
      }
    } catch (e) {
      retryOnGesture = true;
    }
  }

  function onGestureRetry() {
    if (!retryOnGesture || !isEnabled() || isFullscreen()) return;
    requestFullscreen();
  }

  function onFullscreenChange() {
    if (isEnabled() && !isFullscreen()) {
      // Exited (Esc, browser UI, OS gesture) while the setting is still
      // on — attempt to restore. If this call itself needs a gesture,
      // onGestureRetry above will pick it back up on the next click/key.
      requestFullscreen();
    }
  }

  function setEnabled(enabled) {
    persist(!!enabled);
    if (enabled) {
      requestFullscreen();
    } else {
      retryOnGesture = false;
      if (isFullscreen()) {
        if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    }
  }

  function init() {
    if (wired) return;
    wired = true;
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    // Fullscreen requests only succeed inside a user gesture, so re-attempt
    // on the next click/keypress if enabled and not currently fullscreen —
    // covers both "setting was on from a previous session" and "browser
    // rejected an earlier programmatic attempt".
    document.addEventListener('click', onGestureRetry, true);
    document.addEventListener('keydown', onGestureRetry, true);
    if (isEnabled() && !isFullscreen()) retryOnGesture = true;
  }

  return {
    init: init,
    isSupported: isSupported,
    isEnabled: isEnabled,
    isFullscreen: isFullscreen,
    setEnabled: setEnabled
  };
})();
