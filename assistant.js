// assistant.js — Assistant UI (§B.7). Depends on: State, Modal, Settings, AssistantData,
// PlannerData, Alarm (folded in here per §6.1 "near Notepad"). History (item 6) renders inline
// from PlannerData directly — no Nav/Planner dependency anymore, so opening Assistant never
// leaves the Assistant modal or switches tabs underneath the user.
// Global icon at the bottom of the app (#assistant-icon), not tab-specific. Not an AI chatbot —
// every screen here is a plain read-only render of existing data.
// Note: Assistant no longer has its own subject/topic browsing UI — Library is the single
// place to browse topics (Feature 10, resolving prior Assistant/Library overlap).
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

    return (
      '<h3>' + esc(Settings.assistantLabel()) + '</h3>' +
      '<p>Today: ' + fmtMs(totals.studyMs) + ' studied \u00b7 ' + fmtMs(totals.breakMs) + ' break \u00b7 ' + totals.questionsSolved + ' questions</p>' +
      '<hr>' +
      '<div id="assistant-menu">' +
        '<button data-go="store">Store</button>' +
        '<button data-go="timeline">History</button>' +
        '<button data-go="tomorrow">Tomorrow</button>' +
        '<button data-go="leftoff">Resume</button>' +
        '<button data-go="search">Global Search</button>' +
        '<button data-go="summary">Daily Summary</button>' +
        '<button data-go="alarms">Alarms</button>' +
      '</div>'
    );
  }

  function openMain() {
    Modal.open(mainHtml());
    document.querySelectorAll('#assistant-menu button').forEach(function (btn) {
      btn.addEventListener('click', function () { routeTo(btn.dataset.go); });
    });
  }

  function routeTo(key) {
    if (key === 'store') return openStore();
    if (key === 'timeline') return openTimeline();
    if (key === 'tomorrow') return openTomorrow();
    if (key === 'leftoff') return openWhereLeftOff();
    if (key === 'search') return openSearch();
    if (key === 'summary') return openSummary(AssistantData.todayStr());
    if (key === 'alarms') return openAlarms();
  }

  function backBtnHtml() { return '<button id="assistant-back-btn">\u2190 Back</button><br><br>'; }
  function wireBack() { document.getElementById('assistant-back-btn').addEventListener('click', openMain); }

 

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
    Modal.open(backBtnHtml() + '<h3>History</h3>' + rows);
    wireBack();
  }

  

    // ---------- Tomorrow (§7.3) ----------

  function taskRowHtml(t) {
    return '<div class="assistant-task-row">' + esc(t.date) + ' \u2014 ' + esc(t.topicName || t.title || PlannerData.taskLabel(t)) + '</div>';
  }

  

  function openTomorrow() {
    const list = AssistantData.getTomorrow();
    const rows = list.length ? list.map(taskRowHtml).join('') : '<p>Nothing scheduled for tomorrow yet.</p>';
    Modal.open(backBtnHtml() + '<h3>Tomorrow</h3>' + rows);
    wireBack();
  }

  // ---------- Resume / Where I Left Off (§7.3) ----------

  function openWhereLeftOff() {
    const w = AssistantData.getWhereLeftOff();
    const body = w ?
      '<p><strong>' + esc(w.topicName) + '</strong>' + (w.subject ? ' (' + esc(w.subject) + ')' : '') + '</p>' +
      '<p>' + (w.taskLabel ? esc(w.taskLabel) + ' \u2014 ' : '') + esc(w.state) + ' \u00b7 ' + fmtMs(w.studyMs) + (w.isToday ? '' : ' \u00b7 ' + esc(w.date)) + '</p>' +
      (w.note ? '<p>' + esc(w.note) + '</p>' : '')
      : '<p>No study sessions found yet.</p>';
    Modal.open(backBtnHtml() + '<h3>Resume</h3>' + body);
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
