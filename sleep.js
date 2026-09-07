// sleep.js — Sleep Tracker UI (§B.5). Depends on: State, Modal, SleepData.
// Icon button lives outside the tab screens (#sleep-icon, see index.html), same pattern as
// #global-break-btn / #journal-lock-toggle. Opens a Modal form; auto-opens once per date (§5.2).
const Sleep = (function () {
  let autoPromptedFor = null; // in-memory guard: don't re-open twice in the same page session

  function formHtml(rec) {
    return (
      '<h3>Sleep</h3>' +
      '<label>Bedtime (last night)<br>' +
      '<input type="time" id="sleep-bedtime-input" value="' + (rec.sleepTime || '') + '"></label><br><br>' +
      '<label>Wake time (today)<br>' +
      '<input type="time" id="sleep-waketime-input" value="' + (rec.wakeTime || '') + '"></label><br><br>' +
      (rec.completed ? '<p>Slept ' + fmtDuration(rec.durationMin) + '</p>' : '') +
      '<button id="sleep-save-btn">Save</button> ' +
      '<button id="sleep-skip-btn">Not now</button>'
    );
  }

  function fmtDuration(min) {
    if (min === null || min === undefined) return '\u2013';
    const h = Math.floor(min / 60), m = min % 60;
    return h + 'h ' + (m < 10 ? '0' + m : m) + 'm';
  }

  function open(dateStr) {
    const rec = SleepData.getRecord(dateStr);
    Modal.open(formHtml(rec));

    document.getElementById('sleep-save-btn').addEventListener('click', function () {
      const sleepTime = document.getElementById('sleep-bedtime-input').value;
      const wakeTime = document.getElementById('sleep-waketime-input').value;
      if (!sleepTime || !wakeTime) { document.getElementById('sleep-skip-btn').click(); return; }
      SleepData.saveRecord(dateStr, { sleepTime: sleepTime, wakeTime: wakeTime });
      Modal.close();
    });

    document.getElementById('sleep-skip-btn').addEventListener('click', function () {
      SleepData.dismiss(dateStr);
      Modal.close();
    });
  }

  // §5.2 — checked once at startup; only opens if today's record isn't completed/dismissed yet.
  function maybeAutoPrompt() {
    const today = SleepData.todayStr();
    if (autoPromptedFor === today) return;
    if (SleepData.isPromptDue(today)) {
      autoPromptedFor = today;
      open(today);
    }
  }

  function handleIconClick() {
    open(SleepData.todayStr());
  }

  function init() {
    const btn = document.getElementById('sleep-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
    maybeAutoPrompt();
  }

  return { init: init, open: open };
})();
