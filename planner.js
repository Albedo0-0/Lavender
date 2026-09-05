// planner.js — Planner tab UI. Depends on: State, PlannerData.
// Builds into #planner-form and #planner-tab-content (see index.html).

const Planner = (function () {
let activeTab = 'today'; // 'today' | 'pending' | 'history'
  let addMode = 'subject'; // 'subject' | 'custom' | 'suggested'
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
      '<label class="planner-field-label">Date</label>' +
      '<input type="date" id="planner-date">' +
      '<div class="planner-slot-row">' +
        '<div><label class="planner-field-label">Start</label><input type="time" id="planner-start-time"></div>' +
        '<div><label class="planner-field-label">Stop</label><input type="time" id="planner-stop-time"></div>' +
      '</div>' +
      '<div class="planner-addmode-tabs">' +
        '<button class="planner-addmode-btn" data-mode="subject">Subject/Chapter</button>' +
        '<button class="planner-addmode-btn" data-mode="custom">Custom</button>' +
        '<button class="planner-addmode-btn" data-mode="suggested">Suggested</button>' +
      '</div>' +
      '<div id="planner-addmode-body"></div>';

    const dateInput = document.getElementById('planner-date');
    if (dateInput) {
      dateInput.value = todayStr();
      dateInput.addEventListener('change', renderAddModeBody);
    }

    renderAddModeTabs();
    renderAddModeBody();
  }

  function renderAddModeTabs() {
    document.querySelectorAll('.planner-addmode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === addMode);
      btn.addEventListener('click', function () {
        addMode = btn.dataset.mode;
        renderAddModeTabs();
        renderAddModeBody();
      });
    });
  }

  function renderAddModeBody() {
    const body = document.getElementById('planner-addmode-body');
    if (!body) return;
    if (addMode === 'custom') renderCustomModeBody(body);
    else if (addMode === 'suggested') renderSuggestedModeBody(body);
    else renderSubjectModeBody(body);
  }

  function renderSubjectModeBody(body) {
    body.innerHTML =
      '<label class="planner-field-label">Subject</label>' +
      '<select id="planner-subject">' +
        '<option value="Biology">Biology</option>' +
        '<option value="Chemistry">Chemistry</option>' +
        '<option value="Physics">Physics</option>' +
      '</select>' +
      '<label class="planner-field-label">Topic</label>' +
      '<input type="text" id="planner-topic" list="planner-topic-options" placeholder="e.g. Cell, Genetics">' +
      '<datalist id="planner-topic-options"></datalist>' +
      '<label class="planner-field-label">Task Type</label>' +
      '<div class="planner-tasktype-row">' +
        '<label><input type="radio" name="planner-tasktype" value="revision" checked> Repeated Revision (6-cycle)</label>' +
        '<label><input type="radio" name="planner-tasktype" value="theory"> Theory</label>' +
        '<label><input type="radio" name="planner-tasktype" value="questions"> Questions</label>' +
      '</div>' +
      '<label class="planner-field-label">Note (optional)</label>' +
      '<textarea id="planner-note" rows="3"></textarea>' +
      '<button id="planner-save-task">Add Task</button>';

    updateTopicOptions();
    document.getElementById('planner-subject').addEventListener('change', updateTopicOptions);
    document.getElementById('planner-save-task').addEventListener('click', handleSaveSubjectTask);
  }

  function renderCustomModeBody(body) {
    body.innerHTML =
      '<label class="planner-field-label">Title</label>' +
      '<input type="text" id="planner-custom-title" placeholder="e.g. Call dentist">' +
      '<label class="planner-field-label">Note (optional)</label>' +
      '<textarea id="planner-custom-note" rows="3"></textarea>' +
      '<button id="planner-save-custom">Add Task</button>';

    document.getElementById('planner-save-custom').addEventListener('click', handleSaveCustomTask);
  }

  function renderSuggestedModeBody(body) {
    const dateStr = document.getElementById('planner-date').value || todayStr();
    const suggestions = PlannerData.getSuggestedTasksForDate(dateStr);

    if (suggestions.pending.length === 0 && suggestions.dueRevisions.length === 0) {
      body.innerHTML = '<p class="planner-empty">No pending or due-revision tasks to suggest.</p>';
      return;
    }

    function suggestionGroup(title, list) {
      if (list.length === 0) return '';
      return '<div class="planner-suggested-group">' +
        '<div class="planner-suggested-group-title">' + title + '</div>' +
        '<div class="planner-suggested-list">' + list.map(function (t) {
          const label = t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t);
          return '<button class="planner-suggested-btn" data-task-id="' + t.taskId + '">' + label + '</button>';
        }).join('') + '</div>' +
      '</div>';
    }

    body.innerHTML =
      suggestionGroup('Pending', suggestions.pending) +
      suggestionGroup('Due Revisions', suggestions.dueRevisions);

    body.querySelectorAll('.planner-suggested-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { handleUseSuggestion(btn.dataset.taskId); });
    });
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

  function handleSaveSubjectTask() {
    const subject = document.getElementById('planner-subject').value;
    const topicName = document.getElementById('planner-topic').value.trim();
    const dateStr = document.getElementById('planner-date').value;
    const startTime = document.getElementById('planner-start-time').value;
    const stopTime = document.getElementById('planner-stop-time').value;
    const taskTypeInput = document.querySelector('input[name="planner-tasktype"]:checked');
    const taskType = taskTypeInput ? taskTypeInput.value : 'theory';
    const note = document.getElementById('planner-note').value;

    if (!topicName || !dateStr) {
      alert('Please enter a topic and a date.');
      return;
    }

    if (PlannerData.hasSlotConflict(dateStr, startTime, stopTime, null)) {
      alert('That time slot overlaps an existing task on this date.');
      return;
    }

    if (taskType === 'revision') {
      PlannerData.createRevisionCycle(subject, topicName, dateStr, note, startTime, stopTime);
    } else {
      PlannerData.createSingleTask(subject, topicName, taskType, dateStr, note, startTime, stopTime);
    }

    document.getElementById('planner-topic').value = '';
    document.getElementById('planner-note').value = '';
    updateTopicOptions();
    renderSidePanel();
  }

  function handleSaveCustomTask() {
    const title = document.getElementById('planner-custom-title').value.trim();
    const dateStr = document.getElementById('planner-date').value;
    const startTime = document.getElementById('planner-start-time').value;
    const stopTime = document.getElementById('planner-stop-time').value;
    const note = document.getElementById('planner-custom-note').value;

    if (!title || !dateStr) {
      alert('Please enter a title and a date.');
      return;
    }

    if (PlannerData.hasSlotConflict(dateStr, startTime, stopTime, null)) {
      alert('That time slot overlaps an existing task on this date.');
      return;
    }

    PlannerData.createCustomTask(title, dateStr, note, startTime, stopTime);

    document.getElementById('planner-custom-title').value = '';
    document.getElementById('planner-custom-note').value = '';
    renderSidePanel();
  }

  function handleUseSuggestion(taskId) {
    const dateStr = document.getElementById('planner-date').value;
    const startTime = document.getElementById('planner-start-time').value;
    const stopTime = document.getElementById('planner-stop-time').value;
    if (!dateStr) {
      alert('Please pick a date first.');
      return;
    }

    if (PlannerData.hasSlotConflict(dateStr, startTime, stopTime, taskId)) {
      alert('That time slot overlaps an existing task on this date.');
      return;
    }
    
    PlannerData.rescheduleTask(taskId, dateStr, startTime, stopTime);
    renderAddModeBody();
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
    } else if (historyView === 'today') {
      renderHistoryToday(container);
    } else {
      renderHistorySubjects(container);
    }
  }

  function toggleFavoriteTopic(topicId) {
    const favs = State.get().favoriteTopics || [];
    const idx = favs.indexOf(topicId);
    const updated = idx === -1 ? favs.concat([topicId]) : favs.filter(function (id) { return id !== topicId; });
    State.set({ favoriteTopics: updated });
  }

  function renderHistorySubjects(container) {
    const favIds = State.get().favoriteTopics || [];
    const allTopics = PlannerData.getAllTopics();
    const favTopics = favIds.map(function (id) { return allTopics[id]; }).filter(Boolean);

    let html = '<div class="planner-history-toolbar">' +
      '<button class="planner-history-today-btn">Today</button>' +
    '</div>';

    if (favTopics.length > 0) {
      html += '<div class="planner-history-favorites">' +
        '<div class="planner-suggested-group-title">Favorites</div>' +
        favTopics.map(function (t) {
          return '<button class="planner-history-fav-btn" data-subject="' + t.subject + '" data-topic-id="' + t.topicId + '">' + t.subject + ' \u00B7 ' + t.topicName + '</button>';
        }).join('') +
      '</div>';
    }

    html += '<div class="planner-history-subject-list">' + PlannerData.SUBJECTS.map(function (subject) {
      return '<button class="planner-history-subject-btn" data-subject="' + subject + '">' + subject + '</button>';
    }).join('') + '</div>';

    container.innerHTML = html;

    container.querySelector('.planner-history-today-btn').addEventListener('click', function () {
      historyView = 'today';
      renderTabContent();
    });

    container.querySelectorAll('.planner-history-fav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        historySubject = btn.dataset.subject;
        historyTopicId = btn.dataset.topicId;
        historyView = 'chapter';
        renderTabContent();
      });
    });

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
    const favIds = State.get().favoriteTopics || [];

    let html = '<button class="planner-history-back">&lt; Subjects</button>' +
      '<h4 class="planner-history-heading">' + historySubject + '</h4>' +
      '<input type="text" id="planner-history-search" placeholder="Search chapters...">';

    if (topics.length === 0) {
      html += '<p class="planner-empty">No chapters yet for ' + historySubject + '.</p>';
    } else {
      html += '<div class="planner-history-chapter-list" id="planner-history-chapter-list">' + topics.map(function (t) {
        const isFav = favIds.indexOf(t.topicId) !== -1;
        return '<div class="planner-history-chapter-item" data-name="' + t.topicName.toLowerCase() + '">' +
          '<button class="planner-history-chapter-btn" data-topic-id="' + t.topicId + '">' + t.topicName + '</button>' +
          '<button class="planner-history-fav-toggle' + (isFav ? ' active' : '') + '" data-topic-id="' + t.topicId + '">' + (isFav ? '\u2605' : '\u2606') + '</button>' +
        '</div>';
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

    container.querySelectorAll('.planner-history-fav-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleFavoriteTopic(btn.dataset.topicId);
        renderTabContent();
      });
    });

    const searchInput = document.getElementById('planner-history-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        const q = searchInput.value.trim().toLowerCase();
        document.querySelectorAll('#planner-history-chapter-list .planner-history-chapter-item').forEach(function (item) {
          item.style.display = item.dataset.name.indexOf(q) === -1 ? 'none' : 'flex';
        });
      });
    }
  }

  function renderHistoryToday(container) {
    const today = todayStr();
    const todaysTasks = PlannerData.getTasksForDate(today).filter(function (t) { return t.topicId; });
    const grouped = {};
    todaysTasks.forEach(function (t) {
      if (!grouped[t.topicId]) grouped[t.topicId] = { subject: t.subject, topicName: t.topicName, topicId: t.topicId, tasks: [] };
      grouped[t.topicId].tasks.push(t);
    });
    const rows = Object.keys(grouped).map(function (id) { return grouped[id]; });

    let html = '<button class="planner-history-back">&lt; Subjects</button>' +
      '<h4 class="planner-history-heading">Today\'s Chapter Activity</h4>';

    if (rows.length === 0) {
      html += '<p class="planner-empty">No chapter-linked tasks scheduled for today.</p>';
    } else {
      html += '<div class="planner-history-chapter-list">' + rows.map(function (r) {
        return '<button class="planner-history-today-row" data-subject="' + r.subject + '" data-topic-id="' + r.topicId + '">' +
          r.subject + ' \u00B7 ' + r.topicName + ' (' + r.tasks.length + ')' +
        '</button>';
      }).join('') + '</div>';
    }

    container.innerHTML = html;

    container.querySelector('.planner-history-back').addEventListener('click', function () {
      historyView = 'subjects';
      renderTabContent();
    });

    container.querySelectorAll('.planner-history-today-row').forEach(function (btn) {
      btn.addEventListener('click', function () {
        historySubject = btn.dataset.subject;
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

    container.querySelectorAll('.planner-start-study-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof Study !== 'undefined' && Study.startTaskSession) Study.startTaskSession(btn.dataset.taskId);
      });
    });
  }

  function emptyMessage() {
    if (activeTab === 'history') return 'No completed tasks for this chapter yet.';
    if (activeTab === 'pending') return 'Nothing pending — nice!';
    return 'Nothing scheduled for today.';
  }

  function renderTaskRow(t) {
    const meta = t.taskType === 'custom' ? t.title : (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t));
    const checkedAttr = t.completed ? ' checked' : '';
    const slot = PlannerData.slotLabel(t);
    const dateLine = (t.completed
      ? 'Scheduled: ' + t.date + ' \u2014 Completed: ' + t.completedDate
      : 'Scheduled: ' + t.date) + (slot ? ' \u00B7 ' + slot : '');

    const sessionActive = typeof Study !== 'undefined' && Study.isSessionActive && Study.isSessionActive();
    const studyBtn = (t.startTime && !t.completed)
      ? '<button class="planner-start-study-btn"' + (sessionActive ? ' disabled' : '') + ' data-task-id="' + t.taskId + '">Start in Study</button>'
      : '';

    return '<div class="planner-task-row' + (t.completed ? ' planner-task-done' : '') + '">' +
      '<label class="planner-task-check-label">' +
        '<input type="checkbox" id="planner-check-' + t.taskId + '"' + checkedAttr + '>' +
        '<span class="planner-task-meta">' + meta + '</span>' +
      '</label>' +
      '<div class="planner-task-sub">' + dateLine + '</div>' +
      (t.note ? '<div class="planner-task-note">' + t.note + '</div>' : '') +
      studyBtn +
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
