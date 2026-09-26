// notify.js — shared notification/reminder delivery layer (§B.3). One delivery layer for every
// reminder source: Study's slot alarms (already wired below), Water (§B.4), General Alarms (§B.6).
// In-app delivery (a Modal, a toast, whatever the caller already shows) stays the caller's own
// job — always guaranteed regardless of permissions. This module only handles the OPTIONAL extra
// channels (browser notification, sound, vibration), each independently toggleable via Settings
// and each failing silently on its own so one blocked/unsupported channel never blocks another.
// No push/service-worker backend (§3.3) — foreground-only, same tab-open-only limitation Study's
// alarms already have.
// Depends on: State. Load after state.js, before any module that fires reminders.

const Notify = (function () {
  function getSettings() { return State.get().settings || {}; }

  function permissionGranted() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  function requestPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  function fireBrowserNotification(title, body) {
    if (getSettings().notificationsEnabled === false) return;
    if (!permissionGranted()) return;
    try { new Notification(title, { body: body || '' }); } catch (e) { /* best-effort only */ }
  }

  function playSound() {
    if (getSettings().soundEnabled === false) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) { /* best-effort only */ }
  }

  function vibrate() {
    if (getSettings().vibrationEnabled === false) return;
    if (navigator.vibrate) { try { navigator.vibrate(200); } catch (e) { /* best-effort only */ } }
  }

  // §3.1/3.2 — single entry point every reminder source calls once per fire.
  function deliver(title, body) {
    fireBrowserNotification(title, body);
    playSound();
    vibrate();
  }

  // §3.4 — resume-from-current-state: never a backlog. lastFiredAt null means "due now" (first
  // fire). Callers store their own lastFiredAt/interval; this just answers "is it due" and
  // "what's next", always relative to now, never stacking missed intervals.
  function isDue(lastFiredAt, intervalMs, now) {
    const nowMs = now || Date.now();
    if (!lastFiredAt) return true;
    return nowMs >= lastFiredAt + intervalMs;
  }
  function nextFireAt(intervalMs, now) {
    return (now || Date.now()) + intervalMs;
  }

  // Priority lock — held while an Itinerary decision prompt (late-start, Auto-adjust, gate) is
  // visible. Lower-priority callers (Study/Planner handlePrompt) check isItineraryActive() and
  // defer instead of replacing the active notification. Modal.isLocked() is now the single
  // authoritative source for this (Simplification Finding 5/14) — Modal already knows exactly
  // when its persistent, priority-locked prompt is open/closed, so a second count kept here "in
  // sync by convention" was duplicated state, not a second real concept. lockItinerary()/
  // unlockItinerary() remain as harmless no-ops so any existing caller keeps compiling unchanged.
  function lockItinerary() {}
  function unlockItinerary() {}
  function isItineraryActive() { return typeof Modal !== 'undefined' && Modal.isLocked(); }

  return {
    requestPermission: requestPermission,
    deliver: deliver,
    isDue: isDue,
    nextFireAt: nextFireAt,
    lockItinerary: lockItinerary,
    unlockItinerary: unlockItinerary,
    isItineraryActive: isItineraryActive
  };
})();
