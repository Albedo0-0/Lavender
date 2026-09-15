// sleep.js — Sleep Tracker UI (§B.5). Depends on: State, Modal, SleepData.
// No standalone icon entry point anymore — Sleep is reached inline via Journal
// (renderSleepSection). open() is retained only for the auto-prompt flow below.
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

  function init() {}

  return { init: init };
})();
