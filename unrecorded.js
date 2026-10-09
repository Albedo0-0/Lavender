// unrecorded.js — Global "Unrecorded Study" icon handler.
// Opens a modal to log hours + questions not tracked via TimeEngine.
// Delegates to existing JournalData functions — no new data store.
const UnrecordedStudy = (function () {
  function todayStr() {
    const t = new Date();
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

    // ---- Test Marks: canonical records live in State.testMarks (testId -> record). PTPE reads them. ----
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function byId(id) { return document.getElementById(id); }
  function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function markNum(v) { return String(round2(Number(v) || 0)); }
  function fmtDate(d) { const x = new Date(d + 'T00:00:00'); return isNaN(x.getTime()) ? String(d) : x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear(); }
  // '' -> null (blank), unparseable -> NaN, otherwise the number.
  function readMark(el) {
    const raw = el ? String(el.value).trim() : '';
    if (raw === '') return null;
    const n = Number(raw);
    return isFinite(n) ? n : NaN;
  }
  function newTestId() { return 'test_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function putTest(rec) {
    const next = Object.assign({}, State.get().testMarks || {});
    next[rec.testId] = rec;
    return State.set({ testMarks: next });
  }
  function removeTest(id) {
    const cur = State.get().testMarks || {};
    if (!Object.prototype.hasOwnProperty.call(cur, id)) return false;
    const next = Object.assign({}, cur);
    delete next[id];
    return State.set({ testMarks: next });
  }
  // Newest first. Only records that can be shown safely (valid date, total > 0, finite obtained).
  function allTests() {
    const m = State.get().testMarks || {};
    return Object.keys(m).map(function (k) { return Object.assign({}, m[k], { testId: k }); }).filter(function (r) {
      return r && typeof r.date === 'string' && Number(r.total) > 0 && isFinite(Number(r.total)) && isFinite(Number(r.obtained));
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); });
  }
  // Library renames a subject everywhere else; keep stored test subject names in step with it.
  function renameTestSubject(from, to) {
    if (!from || !to || from === to) return;
    const cur = State.get().testMarks || {}, next = {};
    let changed = false;
    Object.keys(cur).forEach(function (id) {
      const rec = cur[id], subs = rec && Array.isArray(rec.subjects) ? rec.subjects : null;
      if (!subs || !subs.some(function (s) { return s && s.subject === from; }) || subs.some(function (s) { return s && s.subject === to; })) { next[id] = rec; return; }
      changed = true;
      next[id] = Object.assign({}, rec, { subjects: subs.map(function (s) { return s && s.subject === from ? Object.assign({}, s, { subject: to }) : s; }) });
    });
    if (changed) State.set({ testMarks: next });
  }
  function afterTestChange() {
    try { if (typeof PTPEView !== 'undefined' && PTPEView.refresh) PTPEView.refresh(); } catch (e) { /* Progress redraws on next visit */ }
    try { if (typeof Calendar !== 'undefined' && Calendar.isReady && Calendar.isReady()) Calendar.render(); } catch (e) { /* Calendar redraws on next visit */ }
  }

  function testSectionHtml(subjects, dateStr) {
    const chips = subjects.length
      ? '<div class="chip-row unrecorded-subject-chips">' + subjects.map(function (s, i) {
          return '<button type="button" class="chip" data-idx="' + i + '" aria-pressed="false">' + esc(s) + '</button>';
        }).join('') + '</div>'
      : '<p class="field-hint">No subjects yet \u2014 add some in Library.</p>';
    const rows = subjects.map(function (s, i) {
      return '<div class="unrecorded-subject-row" data-idx="' + i + '" hidden>' +
        '<span class="unrecorded-subject-name">' + esc(s) + '</span>' +
        '<input type="number" class="input" data-f="obtained" min="0" step="any" inputmode="decimal" placeholder="Got" aria-label="' + esc(s) + ' obtained marks">' +
        '<span class="unrecorded-slash" aria-hidden="true">/</span>' +
        '<input type="number" class="input" data-f="total" min="0" step="any" inputmode="decimal" placeholder="Out of" aria-label="' + esc(s) + ' total marks">' +
        '</div>';
    }).join('');
    return '<div class="unrecorded-tests">' +
      '<div class="unrecorded-tests-head"><h4 class="unrecorded-tests-title">Tests</h4>' +
        '<button type="button" id="unrecorded-test-toggle" class="btn-secondary" aria-expanded="false" aria-controls="unrecorded-test-form">Add a test</button></div>' +
      '<p class="micro-label">Marks from a practice or mock test. Kept apart from study time.</p>' +
      '<div id="unrecorded-test-form" class="unrecorded-test-form" hidden>' +
        '<div class="form-row"><label for="unrecorded-test-date">Test date</label>' +
          '<input type="date" id="unrecorded-test-date" value="' + dateStr + '" max="' + dateStr + '"></div>' +
        '<div class="unrecorded-pair">' +
          '<div class="form-row"><label for="unrecorded-test-total">Total marks</label>' +
            '<input type="number" id="unrecorded-test-total" min="1" step="any" inputmode="decimal"></div>' +
          '<div class="form-row"><label for="unrecorded-test-obtained">Obtained marks</label>' +
            '<input type="number" id="unrecorded-test-obtained" min="0" step="any" inputmode="decimal"></div>' +
        '</div>' +
        '<div class="form-row"><span class="field-label">Subjects <span class="field-hint-inline">(optional)</span></span>' + chips + rows + '</div>' +
        '<p id="unrecorded-test-msg" class="field-error" role="alert" hidden></p>' +
        '<button type="button" id="unrecorded-test-save" class="btn-primary">Save test</button>' +
      '</div>' +
      '<div id="unrecorded-test-list" class="unrecorded-test-list"></div>' +
    '</div>';
  }

  function renderTestList() {
    const host = byId('unrecorded-test-list');
    if (!host) return;
    const all = allTests();
    if (!all.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="field-label">Recent tests</div>' + all.slice(0, 5).map(function (r) {
      const pct = Math.round(Number(r.obtained) / Number(r.total) * 100);
      return '<div class="unrecorded-test-item"><span class="unrecorded-test-when">' + esc(fmtDate(r.date)) + '</span>' +
        '<span class="unrecorded-test-score">' + markNum(r.obtained) + ' / ' + markNum(r.total) + ' <em>' + pct + '%</em></span>' +
        '<button type="button" class="btn-icon btn-danger" data-del="' + esc(r.testId) + '" aria-label="Delete test from ' + esc(fmtDate(r.date)) + '" title="Delete test">&times;</button></div>';
    }).join('') + (all.length > 5 ? '<p class="field-hint">' + (all.length - 5) + ' earlier ' + (all.length - 5 === 1 ? 'test is' : 'tests are') + ' kept in Progress.</p>' : '');
  }

  // Every call builds on the freshly-rendered modal DOM, so reopening the modal never stacks listeners.
  function wireTests(subjects) {
    const toggle = byId('unrecorded-test-toggle'), form = byId('unrecorded-test-form'), msg = byId('unrecorded-test-msg'), list = byId('unrecorded-test-list');
    if (!toggle || !form || !msg || !list) return;
    let lastSaveAt = 0;
    function say(text, ok) {
      msg.textContent = text || '';
      msg.hidden = !text;
      msg.className = ok ? 'field-hint unrecorded-test-ok' : 'field-error';
    }
    toggle.addEventListener('click', function () {
      const opening = form.hidden;
      form.hidden = !opening;
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      toggle.textContent = opening ? 'Close' : 'Add a test';
      say('');
    });
    form.querySelectorAll('.unrecorded-subject-chips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const on = chip.getAttribute('aria-pressed') !== 'true';
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        const row = form.querySelector('.unrecorded-subject-row[data-idx="' + chip.dataset.idx + '"]');
        if (!row) return;
        row.hidden = !on;
        if (on) { const f = row.querySelector('input'); if (f) f.focus(); }
      });
    });
    byId('unrecorded-test-save').addEventListener('click', function () {
      if (Date.now() - lastSaveAt < 600) return; // a double tap must not create a second record
      const date = byId('unrecorded-test-date').value;
      const total = readMark(byId('unrecorded-test-total')), got = readMark(byId('unrecorded-test-obtained'));
      if (!isDateStr(date) || date > todayStr()) { say('Choose a test date that is today or earlier.'); return; }
      if (total === null || isNaN(total) || total < 0.01) { say('Enter the total marks.'); return; }
      if (got === null || isNaN(got) || got < 0) { say('Enter the obtained marks (0 or more).'); return; }
      if (got > total) { say('Obtained marks can\u2019t be higher than the total.'); return; }
      const subs = [];
      for (let i = 0; i < subjects.length; i++) {
        const chip = form.querySelector('.unrecorded-subject-chips .chip[data-idx="' + i + '"]');
        if (!chip || chip.getAttribute('aria-pressed') !== 'true') continue;
        const row = form.querySelector('.unrecorded-subject-row[data-idx="' + i + '"]');
        if (!row) continue;
        const so = readMark(row.querySelector('[data-f="obtained"]')), st = readMark(row.querySelector('[data-f="total"]'));
        if (so === null && st === null) continue; // selected but left empty: not recorded, never invented
        if (so === null || st === null || isNaN(so) || isNaN(st) || st < 0.01 || so < 0) { say('Add both marks for ' + subjects[i] + ', or switch it off.'); return; }
        if (so > st) { say(subjects[i] + ': obtained can\u2019t be higher than its total.'); return; }
        subs.push({ subject: subjects[i], total: round2(st), obtained: round2(so) });
      }
      const rec = { testId: newTestId(), date: date, total: round2(total), obtained: round2(got), subjects: subs, createdAt: Date.now() };
      if (!putTest(rec)) { say('Couldn\u2019t save this test. Try again.'); return; }
      lastSaveAt = Date.now();
      byId('unrecorded-test-obtained').value = '';
      form.querySelectorAll('.unrecorded-subject-row input').forEach(function (inp) { inp.value = ''; });
      say('Test saved.', true);
      renderTestList();
      afterTestChange();
    });
    list.addEventListener('click', function (e) {
      const btn = e.target.closest ? e.target.closest('[data-del]') : null;
      if (!btn) return;
      if (!window.confirm('Delete this test?')) return;
      if (removeTest(btn.getAttribute('data-del'))) { renderTestList(); afterTestChange(); }
    });
    renderTestList();
  }

  function open() {
    const dateStr = todayStr();
    const subjects = (typeof PlannerData !== 'undefined' && PlannerData.getAllSubjects) ? PlannerData.getAllSubjects().slice() : [];
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
      testSectionHtml(subjects, dateStr) +
      '</div>'
    );
        wireTests(subjects);
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

    return { init: init, open: open, renameTestSubject: renameTestSubject };
})();
