// planner.js — Planner tab UI. Depends on: State, PlannerData.
// Builds into #planner-form and #planner-tab-content (see index.html).

const Planner = (function () {
let activeTab = 'today'; // 'today' | 'pending' | 'history'
  let historyView = 'subjects'; // 'subjects' | 'chapters' | 'chapter'
  let historySubject = null;
  let historyTopicId = null;

  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  // ---------- Task creation form ----------

  function renderForm() {
    const container = document.getElementById('planner-form');
    if (!container) return;

    container.innerHTML =
      '<label class="planner-field-label">Subject</label>' +
      '<select id="planner-subject">' +
        '<option value="Biology">Biology</option>' +
        '<option value="Chemistry">Chemistry</option>' +
        '<option value="Physics">Physics</option>' +
      '</select>' +
      '<label class="planner-field-label">Topic</label>' +
      '<input type="text" id="planner-topic" list="planner-topic-options" placeholder="e.g. Cell, Genetics">' +
      '<datalist id="planner-topic-options"></datalist>' +
      '<label class="planner-field-label">Date</label>' +
      '<input type="date" id="planner-date">' +
      '<label class="planner-field-label">Task Type</label>' +
      '<div class="planner-tasktype-row">' +
        '<label><input type="radio" name="planner-tasktype" value="revision" checked> Repeated Revision (6-cycle)</label>' +
        '<label><input type="radio" name="planner-tasktype" value="theory"> Theory</label>' +
        '<label><input type="radio" name="planner-tasktype" value="questions"> Questions</label>' +
      '</div>' +
      '<label class="planner-field-label">Note (optional)</label>' +
      '<textarea id="planner-note" rows="3"></textarea>' +
      '<button id="planner-save-task">Add Task</button>';

    const dateInput = document.getElementById('planner-date');
    if (dateInput) dateInput.value = todayStr();

    updateTopicOptions();

    document.getElementById('planner-subject').addEventListener('change', updateTopicOptions);
    document.getElementById('planner-save-task').addEventListener('click', handleSave);
  }

  function updateTopicOptions() {
    const subjectEl = document.getElementById('planner-subject');
    const list = document.getElementById('planner-topic-options');
    if (!subjectEl || !list) return;
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[subjectEl.value] || [];
    list.innerHTML = topics.map(function (t) {
      return '<option value="' + t.topicName + '">';
    }).join('');
  }

  function handleSave() {
    const subject = document.getElementById('planner-subject').value;
    const topicName = document.getElementById('planner-topic').value.trim();
    const dateStr = document.getElementById('planner-date').value;
    const taskTypeInput = document.querySelector('input[name="planner-tasktype"]:checked');
    const taskType = taskTypeInput ? taskTypeInput.value : 'theory';
    const note = document.getElementById('planner-note').value;

    if (!topicName || !dateStr) {
      alert('Please enter a topic and a date.');
      return;
    }

    if (taskType === 'revision') {
      PlannerData.createRevisionCycle(subject, topicName, dateStr, note);
    } else {
      PlannerData.createSingleTask(subject, topicName, taskType, dateStr, note);
    }

    document.getElementById('planner-topic').value = '';
    document.getElementById('planner-note').value = '';
    updateTopicOptions();
    renderSidePanel();
  }

  // ---------- Side panel: 3 slides ----------

  function renderSidePanel() {
    document.querySelectorAll('.planner-tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    });
    renderTabContent();
  }

  function renderTabContent() {
    const container = document.getElementById('planner-tab-content');
    if (!container) return;

    if (activeTab === 'history') {
      renderHistoryTab(container);
      return;
    }

    const tasks = activeTab === 'pending' ? PlannerData.getPendingTasks() : PlannerData.getTodayTasks();
    renderTaskList(container, tasks);
  }

  function renderHistoryTab(container) {
    if (historyView === 'chapters') {
      renderHistoryChapters(container);
    } else if (historyView === 'chapter') {
      renderHistoryChapter(container);
    } else {
      renderHistorySubjects(container);
    }
  }

  function renderHistorySubjects(container) {
    const html = PlannerData.SUBJECTS.map(function (subject) {
      return '<button class="planner-history-subject-btn" data-subject="' + subject + '">' + subject + '</button>';
    }).join('');

    container.innerHTML = '<div class="planner-history-subject-list">' + html + '</div>';

    container.querySelectorAll('.planner-history-subject-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        historySubject = btn.dataset.subject;
        historyView = 'chapters';
        renderTabContent();
      });
    });
  }

  function renderHistoryChapters(container) {
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[historySubject] || [];

    let html = '<button class="planner-history-back">&lt; Subjects</button>' +
      '<h4 class="planner-history-heading">' + historySubject + '</h4>';

    if (topics.length === 0) {
      html += '<p class="planner-empty">No chapters yet for ' + historySubject + '.</p>';
    } else {
      html += '<div class="planner-history-chapter-list">' + topics.map(function (t) {
        return '<button class="planner-history-chapter-btn" data-topic-id="' + t.topicId + '">' + t.topicName + '</button>';
      }).join('') + '</div>';
    }

    container.innerHTML = html;

    const backBtn = container.querySelector('.planner-history-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      historyView = 'subjects';
      renderTabContent();
    });

    container.querySelectorAll('.planner-history-chapter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        historyTopicId = btn.dataset.topicId;
        historyView = 'chapter';
        renderTabContent();
      });
    });
  }

  function renderHistoryChapter(container) {
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[historySubject] || [];
    const topic = topics.find(function (t) { return t.topicId === historyTopicId; });
    const chapterName = topic ? topic.topicName : '';

    const tasks = PlannerData.getHistoryTasks().filter(function (t) { return t.topicId === historyTopicId; });

    container.innerHTML =
      '<button class="planner-history-back">&lt; ' + historySubject + '</button>' +
      '<h4 class="planner-history-heading">' + chapterName + '</h4>' +
      '<div id="planner-history-list"></div>';

    container.querySelector('.planner-history-back').addEventListener('click', function () {
      historyView = 'chapters';
      renderTabContent();
    });

    renderTaskList(document.getElementById('planner-history-list'), tasks);
  }

  function renderTaskList(container, tasks) {
    if (!container) return;
    if (tasks.length === 0) {
      container.innerHTML = '<p class="planner-empty">' + emptyMessage() + '</p>';
      return;
    }
    container.innerHTML = tasks.map(renderTaskRow).join('');

    tasks.forEach(function (t) {
      const cb = document.getElementById('planner-check-' + t.taskId);
      if (cb) {
        cb.addEventListener('change', function () {
          PlannerData.toggleComplete(t.taskId);
          renderSidePanel();
        });
      }
    });
  }

  function emptyMessage() {
    if (activeTab === 'history') return 'No completed tasks for this chapter yet.';
    if (activeTab === 'pending') return 'Nothing pending — nice!';
    return 'Nothing scheduled for today.';
  }

  function renderTaskRow(t) {
    const meta = t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t);
    const checkedAttr = t.completed ? ' checked' : '';
    const dateLine = t.completed
      ? 'Scheduled: ' + t.date + ' \u2014 Completed: ' + t.completedDate
      : 'Scheduled: ' + t.date;

    return '<div class="planner-task-row' + (t.completed ? ' planner-task-done' : '') + '">' +
      '<label class="planner-task-check-label">' +
        '<input type="checkbox" id="planner-check-' + t.taskId + '"' + checkedAttr + '>' +
        '<span class="planner-task-meta">' + meta + '</span>' +
      '</label>' +
      '<div class="planner-task-sub">' + dateLine + '</div>' +
      (t.note ? '<div class="planner-task-note">' + t.note + '</div>' : '') +
    '</div>';
  }

  function init() {
    renderForm();

    document.querySelectorAll('.planner-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = btn.dataset.tab;
        renderSidePanel();
      });
    });

    renderSidePanel();
  }

  return { init: init, render: function () { renderForm(); renderSidePanel(); } };
})();
