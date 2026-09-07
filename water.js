// water.js — Water Tracker UI (§B.4). Depends on: State, Modal, Notify, WaterData.
// Icon button lives outside the tab screens (#water-icon, see index.html). Reminder loop polls
// every 30s (foreground-only, §3.3) and delivers via the shared Notify layer (§3.1) plus an
// in-app modal offering Done (log intake) / Later (snooze 10 min, §4.4).
const Water = (function () {
  const POLL_MS = 30000;
  let pollHandle = null;

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
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(poll, POLL_MS);
    poll();
  }

  return { init: init, openPicker: openPicker };
})();
