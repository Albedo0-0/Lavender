// unrecorded.js — Global "Unrecorded Study" icon handler.
// Opens a modal to log hours + questions not tracked via TimeEngine.
// Delegates to existing JournalData functions — no new data store.
const UnrecordedStudy = (function () {
  function todayStr() {
    const t = new Date();
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  function open() {
    const dateStr = todayStr();
    const entry = JournalData.getEntry(dateStr);
    Modal.open(
      '<h3>Unrecorded Study</h3>' +
      '<p style="font-size:12px;opacity:0.7;">Hours and questions not tracked by the Study timer.</p>' +
      '<label>Hours studied&nbsp;' +
        '<input type="number" id="unrecorded-hours" min="0" step="0.5" value="' + (entry.hoursStudied || 0) + '">' +
      '</label><br><br>' +
      '<label>Questions solved&nbsp;' +
        '<input type="number" id="unrecorded-questions" min="0" step="1" value="' + (entry.questionsSolved || 0) + '">' +
      '</label><br><br>' +
      '<button id="unrecorded-save">Save</button>'
    );
    document.getElementById('unrecorded-save').addEventListener('click', function () {
      const hours = document.getElementById('unrecorded-hours').value;
      const questions = Math.max(0, Number(document.getElementById('unrecorded-questions').value) || 0);
      JournalData.setHoursStudied(dateStr, hours);
      JournalData.updateEntry(dateStr, { questionsSolved: questions });
      Modal.close();
    });
  }

  function init() {
    const btn = document.getElementById('unrecorded-study-icon');
    if (btn) btn.addEventListener('click', open);
  }

  return { init: init, open: open };
})();
