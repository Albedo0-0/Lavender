// planner.js — Planner tab UI. Depends on: State, PlannerData.
// Builds into #planner-form and #planner-tab-content (see index.html).

const Planner = (function () {
let activeTab = 'today'; // 'today' | 'pending' | 'history'
  let addMode = 'subject'; // 'subject' | 'custom' | 'suggested'
  let historyTopicId = null;
  let pendingOpenDate = null; // bug fix: date requested via openDate(), consumed once by renderForm()

  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  // Called by Calendar's Date Hub (or anywhere else) to make the next render() open on a specific
  // date instead of defaulting to today. One-shot: consumed by renderForm(), so normal Planner
  // navigation afterwards is unaffected.
  function openDate(dateStr) {
    pendingOpenDate = dateStr;
    activeTab = 'today';
    renderSidePanel();
  }

  // ---------- Task creation form ----------

  function renderForm() {
    const container = document.getElementById('planner-form');
    if (!container) return;

    container.innerHTML =
      '<div class="planner-compact-row">' +
        '<input type="date" id="planner-date" title="Date">' +
        '<input type="time" id="planner-start-time" title="Start" placeholder="Start">' +
'<input type="time" id="planner-stop-time" title="End" placeholder="End">' +
      '</div>' +
      '<div class="planner-addmode-arrow-row">' +
        '<button id="planner-mode-prev">&#8592;</button>' +
        '<span id="planner-mode-label">Subject/Chapter</span>' +
        '<button id="planner-mode-next">&#8594;</button>' +
      '</div>' +
      '<div id="planner-addmode-body"></div>';

    const dateInput = document.getElementById('planner-date');
    if (dateInput) {
      dateInput.value = pendingOpenDate || todayStr();
      pendingOpenDate = null; // consumed — subsequent normal renders default to today again
      dateInput.addEventListener('change', renderAddModeBody);
    }

    renderAddModeTabs();
    renderAddModeBody();
  }

  const ADD_MODES = ['subject', 'custom', 'suggested', 'target'];
  const ADD_MODE_LABELS = { subject: 'Subject/Chapter', custom: 'Custom', suggested: 'Suggested', target: 'Target' };

  function renderAddModeTabs() {
    const label = document.getElementById('planner-mode-label');
    if (label) label.textContent = ADD_MODE_LABELS[addMode] || addMode;
    const prev = document.getElementById('planner-mode-prev');
    const next = document.getElementById('planner-mode-next');
    if (prev) { prev.onclick = function () {
      const i = ADD_MODES.indexOf(addMode);
      addMode = ADD_MODES[(i - 1 + ADD_MODES.length) % ADD_MODES.length];
      renderAddModeTabs(); renderAddModeBody();
    }; }
    if (next) { next.onclick = function () {
      const i = ADD_MODES.indexOf(addMode);
      addMode = ADD_MODES[(i + 1) % ADD_MODES.length];
      renderAddModeTabs(); renderAddModeBody();
    }; }
  }

  function renderAddModeBody() {
    const body = document.getElementById('planner-addmode-body');
    if (!body) return;
    if (addMode === 'custom') renderCustomModeBody(body);
    else if (addMode === 'suggested') renderSuggestedModeBody(body);
    else if (addMode === 'target') renderTargetModeBody(body);
    else renderSubjectModeBody(body);
  }

  function renderSubjectModeBody(body) {
    body.innerHTML =
      '<div class="planner-compact-row">' +
        '<select id="planner-subject" title="Subject">' +
          '<option value="Biology">Bio</option>' +
          '<option value="Chemistry">Chem</option>' +
          '<option value="Physics">Phys</option>' +
        '</select>' +
        '<input type="text" id="planner-topic" list="planner-topic-options" placeholder="Topic">' +
        '<datalist id="planner-topic-options"></datalist>' +
      '</div>' +
      '<div class="planner-tasktype-row">' +
        '<label><input type="radio" name="planner-tasktype" value="revision" checked> Revision</label>' +
        '<label><input type="radio" name="planner-tasktype" value="theory"> Theory</label>' +
        '<label><input type="radio" name="planner-tasktype" value="questions"> Qs</label>' +
      '</div>' +
      '<label class="planner-field-label">Note (optional)</label>' +
      '<textarea id="planner-note" rows="3"></textarea>' +
      '<button id="planner-save-task"' + ((typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) ? ' disabled' : '') + '>Add Task</button>';

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
      '<button id="planner-save-custom"' + ((typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) ? ' disabled' : '') + '>Add Task</button>';

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

  let pendingSubtargets = []; // in-progress subtarget drafts for the Target form, cleared on save

  function renderTargetModeBody(body) {
    const grouped = PlannerData.getTopicsBySubject();
    const subjectOptions = Object.keys(grouped).map(function (subj) {
      return '<optgroup label="' + subj + '">' + grouped[subj].map(function (t) {
        return '<option value="' + t.topicId + '">' + t.topicName + '</option>';
      }).join('') + '</optgroup>';
    }).join('');

    body.innerHTML =
      '<label class="planner-field-label">Title</label>' +
      '<input type="text" id="planner-target-title" placeholder="e.g. Solve 20 questions">' +
      '<div class="planner-compact-row">' +
        '<select id="planner-target-type">' +
          '<option value="custom">Custom</option>' +
          '<option value="hours">Hours</option>' +
          '<option value="questions">Questions</option>' +
        '</select>' +
        '<select id="planner-target-type">' +
          '<option value="checkoff">Checkoff</option>' +
          '<option value="studyHours">Study Hours</option>' +
          '<option value="questions">Questions</option>' +
        '</select>' +
        '<input type="number" id="planner-target-value" placeholder="Value" min="1" value="1">' +
      '</div>' +
      '<label class="planner-field-label">Link to topic (optional)</label>' +
      '<select id="planner-target-topic">' +
        '<option value="">\u2014 None \u2014</option>' +
        subjectOptions +
      '</select>' +
      '<label class="planner-field-label">Subtargets (optional)</label>' +
      '<div id="planner-target-subtargets-list"></div>' +
      '<div class="planner-compact-row">' +
        '<input type="text" id="planner-target-subtitle" placeholder="Subtarget title">' +
        '<input type="number" id="planner-target-subvalue" placeholder="Value" min="1" value="1" style="max-width:70px">' +
        '<button id="planner-target-subadd-btn" type="button">+</button>' +
      '</div>' +
      '<button id="planner-save-target">Add Target</button>';

    function renderSubtargetDrafts() {
      const list = document.getElementById('planner-target-subtargets-list');
      if (!list) return;
      list.innerHTML = pendingSubtargets.length === 0
        ? '<p class="planner-empty">No subtargets added.</p>'
        : pendingSubtargets.map(function (s, i) {
            return '<div class="planner-task-row"><div class="planner-task-meta">' + s.title + ' (' + s.targetValue + ')</div>' +
              '<button class="planner-target-subdraft-del" data-idx="' + i + '" type="button">&times;</button></div>';
          }).join('');
      list.querySelectorAll('.planner-target-subdraft-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          pendingSubtargets.splice(Number(btn.dataset.idx), 1);
          renderSubtargetDrafts();
        });
      });
    }
    renderSubtargetDrafts();

    document.getElementById('planner-target-subadd-btn').addEventListener('click', function () {
      const title = document.getElementById('planner-target-subtitle').value.trim();
      if (!title) return;
      const val = Number(document.getElementById('planner-target-subvalue').value) || 1;
      pendingSubtargets.push({ title: title, targetValue: val });
      document.getElementById('planner-target-subtitle').value = '';
      document.getElementById('planner-target-subvalue').value = '1';
      renderSubtargetDrafts();
    });

    document.getElementById('planner-save-target').addEventListener('click', function () {
      const title = document.getElementById('planner-target-title').value.trim();
      if (!title) { alert('Please enter a title.'); return; }
      const dateStr = document.getElementById('planner-date').value || todayStr();
      const timeframe = document.getElementById('planner-target-timeframe').value;
      const type = document.getElementById('planner-target-type').value;
      const targetValue = Number(document.getElementById('planner-target-value').value) || 1;
      const topicId = document.getElementById('planner-target-topic').value || null;

      const target = TargetsData.createTarget({
        title: title, timeframe: timeframe, type: type, targetValue: targetValue, dateKey: dateStr, topicId: topicId
      });

      pendingSubtargets.forEach(function (s) {
        TargetsData.createSubtarget(target.targetId, { title: s.title, targetValue: s.targetValue, type: type });
      });

      pendingSubtargets = [];
      renderTargetModeBody(body);
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
    if (typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) { alert('Finish or reset your Stopwatch/Timer before scheduling a task.'); return; }
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

    if (!PlannerData.isValidSlot(startTime, stopTime)) {
      alert('End time must be after start time, on the same day (no overnight sessions). Leave both blank for no time slot.');
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
    if (typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) { alert('Finish or reset your Stopwatch/Timer before scheduling a task.'); return; }
    const title = document.getElementById('planner-custom-title').value.trim();
    const dateStr = document.getElementById('planner-date').value;
    const startTime = document.getElementById('planner-start-time').value;
    const stopTime = document.getElementById('planner-stop-time').value;
    const note = document.getElementById('planner-custom-note').value;

    if (!title || !dateStr) {
      alert('Please enter a title and a date.');
      return;
    }

    if (!PlannerData.isValidSlot(startTime, stopTime)) {
      alert('End time must be after start time, on the same day (no overnight sessions). Leave both blank for no time slot.');
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
    if (typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) { alert('Finish or reset your Stopwatch/Timer before scheduling a task.'); return; }
    const dateStr = document.getElementById('planner-date').value;
    const startTime = document.getElementById('planner-start-time').value;
    const stopTime = document.getElementById('planner-stop-time').value;
    if (!dateStr) {
      alert('Please pick a date first.');
      return;
    }

    if (!PlannerData.isValidSlot(startTime, stopTime)) {
      alert('End time must be after start time, on the same day (no overnight sessions). Leave both blank for no time slot.');
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

    const tasks = activeTab === 'pending' ? PlannerData.getPendingTasks()
      : activeTab === 'upcoming' ? PlannerData.getUpcomingTasks()
      : PlannerData.getTodayTasks();
    renderTaskList(container, tasks);
  }

  function renderHistoryTab(container) {
    if (historyTopicId) {
      renderHistoryChapter(container);
    } else {
      container.innerHTML = '<p class="planner-empty">Open a chapter\'s History from Library to see its completed tasks here.</p>';
    }
  }

  

    
    
  

  function renderHistoryChapter(container) {
    const topic = PlannerData.getAllTopics()[historyTopicId];
    const chapterName = topic ? topic.topicName : '';

    const tasks = PlannerData.getHistoryTasks().filter(function (t) { return t.topicId === historyTopicId; });

    container.innerHTML =
      '<h4 class="planner-history-heading">' + chapterName + '</h4>' +
      '<div id="planner-history-list"></div>';

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

    container.querySelectorAll('.planner-reschedule-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openRescheduleModal(btn.dataset.taskId); });
    });

    container.querySelectorAll('.planner-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { confirmDeleteTask(btn.dataset.taskId); });
    });
  }

  function openRescheduleModal(taskId) {
    const task = PlannerData.getAllTasks()[taskId];
    if (!task) return;
    Modal.open(
      '<h3>Reschedule</h3>' +
      '<label class="planner-field-label">Date</label>' +
      '<input type="date" id="planner-resched-date" value="' + task.date + '">' +
      '<div class="planner-slot-row">' +
        '<div><label class="planner-field-label">Start</label><input type="time" id="planner-resched-start" value="' + (task.startTime || '') + '"></div>' +
        '<div><label class="planner-field-label">Stop</label><input type="time" id="planner-resched-stop" value="' + (task.stopTime || '') + '"></div>' +
      '</div>' +
      '<button id="planner-resched-confirm">Reschedule</button>'
    );
    document.getElementById('planner-resched-confirm').addEventListener('click', function () {
      const dateVal = document.getElementById('planner-resched-date').value;
      const startVal = document.getElementById('planner-resched-start').value;
      const stopVal = document.getElementById('planner-resched-stop').value;
      if (!dateVal) { alert('Pick a date.'); return; }
      const ok = TimeEngine.doItLater(taskId, dateVal, startVal, stopVal);
      if (!ok) { alert('That slot is invalid or overlaps another task on ' + dateVal + '.'); return; }
      Modal.close();
      renderSidePanel();
    });
  }

  function confirmDeleteTask(taskId) {
    Modal.open(
      '<h3>Delete task?</h3>' +
      '<p>This removes it from your schedule. This cannot be undone.</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="planner-delete-confirm">Delete</button>' +
        '<button id="planner-delete-cancel">Cancel</button>' +
      '</div>'
    );
    document.getElementById('planner-delete-confirm').addEventListener('click', function () {
      PlannerData.deleteTask(taskId);
      Modal.close();
      renderSidePanel();
    });
    document.getElementById('planner-delete-cancel').addEventListener('click', function () { Modal.close(); });
  }
  function emptyMessage() {
     if (activeTab === 'history') return 'No completed tasks for this chapter yet.';
    if (activeTab === 'pending') return 'Nothing pending — nice!';
    if (activeTab === 'upcoming') return 'Nothing upcoming yet.';
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
    const reschedBtn = !t.completed
      ? '<button class="planner-reschedule-btn" data-task-id="' + t.taskId + '">Reschedule</button>'
      : '';
    const deleteBtn = '<button class="planner-delete-btn" data-task-id="' + t.taskId + '">Delete</button>';

    return '<div class="planner-task-row' + (t.completed ? ' planner-task-done' : '') + '">' +
      '<label class="planner-task-check-label">' +
        '<input type="checkbox" id="planner-check-' + t.taskId + '"' + checkedAttr + '>' +
        '<span class="planner-task-meta">' + meta + '</span>' +
      '</label>' +
      '<div class="planner-task-sub">' + dateLine + '</div>' +
      (t.note ? '<div class="planner-task-note">' + t.note + '</div>' : '') +
      studyBtn + reschedBtn + deleteBtn +
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

  // Entry point for Assistant's History shortcut (§7.3/§6.1-style reuse) — jumps straight into
  // this existing view instead of building a second one. Only sets state; caller (Assistant) is
  // responsible for switching to the Planner tab, which triggers render() via Nav.
function openForTopic(subject, topicId) {
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[subject] || [];
    const topic = topics.find(function (t) { return t.topicId === topicId; });
    if (!topic) return;
    activeTab = 'today';
    pendingOpenDate = null;
    renderForm();
    const subjectEl = document.getElementById('planner-subject');
    const topicEl = document.getElementById('planner-topic');
    if (subjectEl) { subjectEl.value = subject; updateTopicOptions(); }
    if (topicEl) topicEl.value = topic.topicName;
    renderSidePanel();
  }

  function openHistory(subject, topicId) {
    activeTab = 'history';
    historyTopicId = topicId || null;
    renderSidePanel();
  }  
  return { init: init, render: function () { renderForm(); renderSidePanel(); }, openHistory: openHistory, openDate: openDate, openForTopic: openForTopic };
})();
