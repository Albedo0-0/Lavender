// assistant.js — Assistant UI (§B.7). Depends on: State, Modal, Settings, AssistantData,
// PlannerData, Alarm (folded in here per §6.1 "near Notepad"). History (item 6) renders inline
// from PlannerData directly — no Nav/Planner dependency anymore, so opening Assistant never
// leaves the Assistant modal or switches tabs underneath the user.
// Global icon at the bottom of the app (#assistant-icon), not tab-specific. Not an AI chatbot —
// every screen here is a plain read-only render of existing data.
const Assistant = (function () {
  function fmtMs(ms) {
    const totalMin = Math.round((ms || 0) / 60000);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h + 'h ' + (m < 10 ? '0' + m : m) + 'm';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }); }

  // ---------- §7.1 Main modal ----------

  function mainHtml() {
    const totals = AssistantData.getTodayTotals();
    const breakdown = AssistantData.getTodaySubjectBreakdown();
    const subjectCards = PlannerData.SUBJECTS.map(function (s) {
      const b = breakdown[s];
      return '<div class="assistant-subject-card" data-subject="' + s + '">' +
        '<strong>' + s + '</strong><br>' + fmtMs(b.studyMs) + ' \u00b7 ' + b.questionsSolved + ' questions' +
      '</div>';
    }).join('');

    return (
      '<h3>' + esc(Settings.assistantLabel()) + '</h3>' +
      '<p>Today: ' + fmtMs(totals.studyMs) + ' studied \u00b7 ' + fmtMs(totals.breakMs) + ' break \u00b7 ' + totals.questionsSolved + ' questions</p>' +
      subjectCards +
      '<hr>' +
      '<div id="assistant-menu">' +
        '<button data-go="notepad">Notepad</button>' +
        '<button data-go="store">Store</button>' +
        '<button data-go="timeline">Timeline</button>' +
        '<button data-go="history">History</button>' +
        '<button data-go="pending">Pending</button>' +
        '<button data-go="tomorrow">Tomorrow</button>' +
        '<button data-go="leftoff">Where I Left Off</button>' +
        '<button data-go="search">Global Search</button>' +
        '<button data-go="summary">Daily Summary</button>' +
        '<button data-go="alarms">Alarms</button>' +
      '</div>'
    );
  }

  function openMain() {
    Modal.open(mainHtml());
    document.querySelectorAll('.assistant-subject-card').forEach(function (card) {
      card.addEventListener('click', function () { openSubject(card.dataset.subject); });
    });
    document.querySelectorAll('#assistant-menu button').forEach(function (btn) {
      btn.addEventListener('click', function () { routeTo(btn.dataset.go); });
    });
  }

  function routeTo(key) {
    if (key === 'notepad') return openNotepad();
    if (key === 'store') return openStore();
    if (key === 'timeline') return openTimeline();
    if (key === 'history') return openHistory();
    if (key === 'pending') return openPending();
    if (key === 'tomorrow') return openTomorrow();
    if (key === 'leftoff') return openWhereLeftOff();
    if (key === 'search') return openSearch();
    if (key === 'summary') return openSummary(AssistantData.todayStr());
    if (key === 'alarms') return openAlarms();
  }

  function backBtnHtml() { return '<button id="assistant-back-btn">\u2190 Back</button><br><br>'; }
  function wireBack() { document.getElementById('assistant-back-btn').addEventListener('click', openMain); }

  // ---------- §7.2 Subject drill-down ----------

  function openSubject(subject) {
    const topics = AssistantData.getSubjectTopicsToday(subject);
    const rows = topics.length ? topics.map(function (t) {
      return '<div class="assistant-topic-row">' +
        '<strong>' + esc(t.topicName) + '</strong> \u2014 ' + fmtMs(t.studyMs) + ' \u00b7 ' + t.questionsSolved + ' questions' +
        (t.note ? '<div class="assistant-topic-note">' + esc(t.note) + '</div>' : '') +
        '<button class="assistant-topic-history-btn" data-topic="' + t.topicId + '" data-subject="' + esc(subject) + '">View history</button>' +
      '</div>';
    }).join('') : '<p>Nothing studied in ' + esc(subject) + ' today yet.</p>';

    Modal.open(backBtnHtml() + '<h3>' + esc(subject) + ' \u2014 Today</h3>' + rows);
    wireBack();
    document.querySelectorAll('.assistant-topic-history-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openHistory(btn.dataset.subject, btn.dataset.topic); });
    });
  }

  // ---------- Notepad / Quick Capture (merged — one feature, per instruction) ----------

  function notepadHtml() {
    const notes = AssistantData.getNotes();
    const rows = notes.length ? notes.map(function (n) {
      return '<div class="assistant-note-row" data-id="' + n.id + '">' +
        '<span class="assistant-note-text">' + esc(n.text) + '</span> ' +
        '<button class="assistant-note-delete-btn" data-id="' + n.id + '">Delete</button>' +
      '</div>';
    }).join('') : '<p>No notes yet.</p>';

    return backBtnHtml() + '<h3>Notepad</h3>' +
      '<textarea id="assistant-note-input" placeholder="Capture anything — a note, a to-do, a thought..."></textarea><br>' +
      '<button id="assistant-note-add-btn">Add</button><br><br>' + rows;
  }

  function openNotepad() {
    Modal.open(notepadHtml());
    wireBack();
    document.getElementById('assistant-note-add-btn').addEventListener('click', function () {
      const input = document.getElementById('assistant-note-input');
      AssistantData.addNote(input.value);
      openNotepad();
    });
    document.querySelectorAll('.assistant-note-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { AssistantData.removeNote(btn.dataset.id); openNotepad(); });
    });
  }

  // ---------- Store (placeholder, §7.3) ----------

  function openStore() {
    Modal.open(backBtnHtml() + '<h3>Store</h3><p>Coming soon \u2014 will link to Gamification\u2019s store (\u00a7B.8).</p>');
    wireBack();
  }

  // ---------- Timeline (§7.3) ----------

  function openTimeline() {
    const items = AssistantData.getTodayTimeline();
    const rows = items.length ? items.map(function (it) {
      return '<div class="assistant-timeline-row">' + it.at + ' \u2014 ' + esc(it.label) + ' (' + fmtMs(it.durationMs) + (it.type === 'break' ? ', break' : '') + ')</div>';
    }).join('') : '<p>Nothing recorded yet today.</p>';
    Modal.open(backBtnHtml() + '<h3>Timeline</h3>' + rows);
    wireBack();
  }

  // ---------- History (§7.3, item 6) — subjects -> chapters -> tasks, inline in this modal.
  // Reuses PlannerData's topic/task data directly (same source Planner's own history view reads,
  // §7.2) so there's no second data model — just an Assistant-local presentation of it, since
  // routing out to the Planner tab (the old behavior) broke the Assistant flow.

  let historySubject = null;
  let historyTopicId = null;

  function historySubjectsHtml() {
    return backBtnHtml() + '<h3>History</h3>' +
      PlannerData.SUBJECTS.map(function (s) {
        return '<button class="assistant-history-subject-btn" data-subject="' + s + '">' + s + '</button>';
      }).join('<br>');
  }

  function historyChaptersHtml(subject) {
    const topics = (PlannerData.getTopicsBySubject()[subject] || []);
    const rows = topics.length ? topics.map(function (t) {
      return '<button class="assistant-history-chapter-btn" data-topic-id="' + t.topicId + '">' + esc(t.topicName) + '</button>';
    }).join('<br>') : '<p>No chapters yet for ' + esc(subject) + '.</p>';
    return '<button id="assistant-history-back-subjects">\u2190 Subjects</button><br><br>' +
      '<h3>' + esc(subject) + '</h3>' + rows;
  }

  function historyTasksHtml(subject, topicId) {
    const topics = (PlannerData.getTopicsBySubject()[subject] || []);
    const topic = topics.find(function (t) { return t.topicId === topicId; });
    const tasks = PlannerData.getHistoryTasks().filter(function (t) { return t.topicId === topicId; });
    const rows = tasks.length ? tasks.map(function (t) {
      return '<div class="assistant-history-task-row">' +
        esc(t.completedDate || t.date) + ' \u2014 ' + esc(PlannerData.taskLabel(t)) +
        (t.note ? '<div class="assistant-topic-note">' + esc(t.note) + '</div>' : '') +
      '</div>';
    }).join('') : '<p>No completed tasks for this chapter yet.</p>';
    return '<button id="assistant-history-back-chapters">\u2190 ' + esc(subject) + '</button><br><br>' +
      '<h3>' + esc(topic ? topic.topicName : '') + '</h3>' + rows;
  }

  function openHistory(subject, topicId) {
    historySubject = subject || null;
    historyTopicId = topicId || null;

    if (historyTopicId) {
      Modal.open(historyTasksHtml(historySubject, historyTopicId));
      document.getElementById('assistant-history-back-chapters').addEventListener('click', function () { openHistory(historySubject, null); });
    } else if (historySubject) {
      Modal.open(historyChaptersHtml(historySubject));
      document.getElementById('assistant-history-back-subjects').addEventListener('click', function () { openHistory(null, null); });
      document.querySelectorAll('.assistant-history-chapter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openHistory(historySubject, btn.dataset.topicId); });
      });
    } else {
      Modal.open(historySubjectsHtml());
      wireBack();
      document.querySelectorAll('.assistant-history-subject-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { openHistory(btn.dataset.subject, null); });
      });
    }
  }

  // ---------- Pending / Tomorrow (§7.3) ----------

  function taskRowHtml(t) {
    return '<div class="assistant-task-row">' + esc(t.date) + ' \u2014 ' + esc(t.topicName || t.title || PlannerData.taskLabel(t)) + '</div>';
  }

  function openPending() {
    const list = AssistantData.getPending();
    const rows = list.length ? list.map(taskRowHtml).join('') : '<p>Nothing pending.</p>';
    Modal.open(backBtnHtml() + '<h3>Pending</h3>' + rows);
    wireBack();
  }

  function openTomorrow() {
    const list = AssistantData.getTomorrow();
    const rows = list.length ? list.map(taskRowHtml).join('') : '<p>Nothing scheduled for tomorrow yet.</p>';
    Modal.open(backBtnHtml() + '<h3>Tomorrow</h3>' + rows);
    wireBack();
  }

  // ---------- Where I Left Off (§7.3) ----------

  function openWhereLeftOff() {
    const w = AssistantData.getWhereLeftOff();
    const body = w ?
      '<p><strong>' + esc(w.topicName) + '</strong>' + (w.subject ? ' (' + esc(w.subject) + ')' : '') + '</p>' +
      '<p>' + (w.taskLabel ? esc(w.taskLabel) + ' \u2014 ' : '') + esc(w.state) + ' \u00b7 ' + fmtMs(w.studyMs) + (w.isToday ? '' : ' \u00b7 ' + esc(w.date)) + '</p>' +
      (w.note ? '<p>' + esc(w.note) + '</p>' : '')
      : '<p>No study sessions found yet.</p>';
    Modal.open(backBtnHtml() + '<h3>Where I Left Off</h3>' + body);
    wireBack();
  }

  // ---------- Global Search (§7.3) ----------

  function resultRowHtml(r) {
    const ref = r.ref || {};
    return '<div class="assistant-search-row assistant-search-result" data-kind="' + esc(ref.kind || '') + '" data-task-id="' + esc(ref.taskId || '') + '" data-subject="' + esc(ref.subject || '') + '" data-topic-id="' + esc(ref.topicId || '') + '" data-date="' + esc(ref.date || r.date || '') + '">' +
      '<strong>' + esc(r.type) + '</strong> (' + esc(r.date) + ') \u2014 ' + esc(r.text) + '</div>';
  }

  function navigateToResult(ds) {
    if (ds.kind === 'task') {
      const task = PlannerData.getAllTasks()[ds.taskId];
      if (!task) return;
      Modal.close();
      if (task.completed && Planner.openHistory) Planner.openHistory(task.subject, task.topicId);
      else if (Planner.openDate) Planner.openDate(task.date);
      Nav.switchTo('library');
    } else if (ds.kind === 'topic') {
      Modal.close();
      if (Planner.openForTopic) Planner.openForTopic(ds.subject, ds.topicId);
      Nav.switchTo('library');
    } else if (ds.kind === 'journal') {
      Modal.close();
      if (typeof Journal !== 'undefined' && Journal.openDate) Journal.openDate(ds.date);
      Nav.switchTo('journal');
    }
  }

  function openSearch() {
    Modal.open(backBtnHtml() + '<h3>Global Search</h3>' +
      '<input type="text" id="assistant-search-input" placeholder="Search everything..."><button id="assistant-search-btn">Search</button>' +
      '<div id="assistant-search-results"></div>');
    wireBack();
    function runSearch() {
      const results = AssistantData.search(document.getElementById('assistant-search-input').value);
      document.getElementById('assistant-search-results').innerHTML = results.length ? results.map(resultRowHtml).join('') : '<p>No matches.</p>';
      document.querySelectorAll('.assistant-search-result').forEach(function (el) {
        el.addEventListener('click', function () { navigateToResult(el.dataset); });
      });
    }
    document.getElementById('assistant-search-btn').addEventListener('click', runSearch);
    document.getElementById('assistant-search-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
  }

  // ---------- Daily Summary (§7.4/§7.5) ----------

  function summaryHtml(dateStr) {
    const s = AssistantData.getDailySummary(dateStr);
    return backBtnHtml() + '<h3>Daily Summary</h3>' +
      '<input type="date" id="assistant-summary-date" value="' + dateStr + '"><br><br>' +
      '<p>Study: ' + fmtMs(s.studyMs) + ' \u00b7 Break: ' + fmtMs(s.breakMs) + ' \u00b7 Questions: ' + s.questionsSolved + '</p>' +
      '<p>Hydration: ' + (s.hydrationScore === null ? '\u2013' : s.hydrationScore + '/10') + ' \u00b7 Sleep: ' + (s.sleepHours === null ? '\u2013' : s.sleepHours + 'h') + '</p>' +
      '<p>Tasks: ' + s.tasksCompleted + ' / ' + s.tasksTotal + ' completed</p>';
  }

  function openSummary(dateStr) {
    Modal.open(summaryHtml(dateStr));
    wireBack();
    document.getElementById('assistant-summary-date').addEventListener('change', function (e) { openSummary(e.target.value); });
  }

  // ---------- Alarms (§6.1 — General Alarm lives here, near Notepad, now that Assistant exists) ----------

  function openAlarms() {
    Alarm.openList();
  }

  function handleIconClick() { openMain(); }

  function init() {
    const btn = document.getElementById('assistant-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
  }

  return { init: init, openMain: openMain };
})();
