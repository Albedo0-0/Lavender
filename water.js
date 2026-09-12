// water.js — Water Tracker UI (§B.4). Depends on: State, Modal, Notify, WaterData, TimeEngine.
// Icon button lives outside the tab screens (#water-icon, see index.html). Reminder loop rides
// the shared TimeEngine heartbeat (Feature 11, foreground-only, §3.3) and delivers via the shared
// Notify layer (§3.1) plus an in-app modal offering Done (log intake) / Later (snooze 10 min, §4.4).
//
// Feature 11 (Single Heartbeat): this module no longer runs its own setInterval poll. It rides
// TimeEngine's single 1s heartbeat via TimeEngine.subscribe(fn, id) — a stable id ('water') means
// re-calling init() replaces the callback in place instead of stacking a second listener that
// would double-fire (and, here, potentially double-open the reminder prompt) on every tick.
const Water = (function () {
  const SUBSCRIBER_ID = 'water';

  function pickerHtml(title) {
    const buttons = Object.keys(WaterData.CATEGORIES).map(function (key) {
      return '<button class="water-cat-btn" data-cat="' + key + '">' + WaterData.CATEGORIES[key].label + '</button>';
    }).join('');
    return '<h3>' + title + '</h3><div id="water-cat-list">' + buttons + '</div>';
  }

  function openPicker(title) {
    Modal.open(pickerHtml(title || 'Log water'));
    document.querySelectorAll('.water-cat-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        WaterData.logEvent(WaterData.todayStr(), btn.dataset.cat);
        Modal.close();
      });
    });
  }

  // §4.4 — the reminder prompt itself: Done opens the category picker, Later snoozes 10 min.
  function showReminderPrompt() {
    Modal.open(
      '<h3>Hydration check-in</h3>' +
      '<p>How much water have you had?</p>' +
      '<button id="water-reminder-done">Done</button> ' +
      '<button id="water-reminder-later">Later</button>'
    );
    document.getElementById('water-reminder-done').addEventListener('click', function () {
      openPicker('How much did you drink?');
    });
    document.getElementById('water-reminder-later').addEventListener('click', function () {
      WaterData.markLater();
      Modal.close();
    });
    WaterData.markFired();
    Notify.deliver('Hydration check-in', 'How much water have you had?');
  }

  function poll() {
    // Never interrupt if a modal is already open (e.g. Sleep's prompt, or this one already showing).
    const overlay = document.getElementById('modal-overlay');
    if (overlay && overlay.style.display === 'flex') return;
    if (WaterData.isReminderDueNow(new Date())) showReminderPrompt();
  }

  function handleIconClick() {
    openPicker('Log water');
  }

  function init() {
    const btn = document.getElementById('water-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
    // Single-heartbeat migration (Feature 11): ride TimeEngine's tick instead of our own
    // setInterval. Passing the stable id 'water' means calling init() again (re-render/reopen)
    // replaces this callback in TimeEngine's registry rather than accumulating a second one.
    TimeEngine.subscribe(poll, SUBSCRIBER_ID);
    poll();
  }

  return { init: init, openPicker: openPicker };
})();
