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
      '<div class="unrecorded-slip">' +
      '<h3 class="modal-title">Unrecorded Study</h3>' +
      '<p class="micro-label">Hours and questions not tracked by the Study timer.</p>' +
      '<div class="form-row"><label for="unrecorded-hours">Hours studied</label>' +
        '<input type="number" id="unrecorded-hours" class="input" min="0" step="0.5" value="' + (entry.hoursStudied || 0) + '"></div>' +
      '<div class="form-row"><label for="unrecorded-questions">Questions solved</label>' +
        '<input type="number" id="unrecorded-questions" class="input" min="0" step="1" value="' + (entry.questionsSolved || 0) + '"></div>' +
      '<button id="unrecorded-save" class="btn-primary">Save</button>' +
      '</div>'
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
