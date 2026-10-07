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

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }
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
        '<input type="date" id="planner-date" class="input" title="Date">' +
        '<input type="time" id="planner-start-time" class="input" title="Start" placeholder="Start">' +
'<input type="time" id="planner-stop-time" class="input" title="End" placeholder="End">' +
      '</div>' +
      '<div class="planner-addmode-arrow-row">' +
        '<button id="planner-mode-prev" class="btn btn-secondary">&#8592;</button>' +
        '<span id="planner-mode-label" class="section-heading">Subject/Chapter</span>' +
        '<button id="planner-mode-next" class="btn btn-secondary">&#8594;</button>' +
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
                '<input type="text" id="planner-subject" class="input" list="planner-subject-options" placeholder="Subject" title="Subject" value="' + esc(PlannerData.getAllSubjects()[0] || '') + '">' +
        '<datalist id="planner-subject-options">' +
          PlannerData.getAllSubjects().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') +
        '</datalist>' +
        '<input type="text" id="planner-topic" class="input" list="planner-topic-options" placeholder="Topic">' +
        '<datalist id="planner-topic-options"></datalist>' +
      '</div>' +
      '<div class="planner-tasktype-row chip-row">' +
        '<label class="chip"><input type="radio" name="planner-tasktype" value="revision" checked> Revision</label>' +
        '<label class="chip"><input type="radio" name="planner-tasktype" value="theory"> Theory</label>' +
        '<label class="chip"><input type="radio" name="planner-tasktype" value="questions"> Qs</label>' +
      '</div>' +
      '<label class="planner-field-label">Note (optional)</label>' +
      '<textarea id="planner-note" class="input" rows="3"></textarea>' +
      '<button id="planner-save-task" class="btn btn-primary"' + ((typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) ? ' disabled' : '') + '>Add Task</button>';

    updateTopicOptions();
    document.getElementById('planner-subject').addEventListener('input', updateTopicOptions);
    document.getElementById('planner-save-task').addEventListener('click', handleSaveSubjectTask);
  }

  function renderCustomModeBody(body) {
    body.innerHTML =
      '<label class="planner-field-label">Title</label>' +
      '<input type="text" id="planner-custom-title" class="input" placeholder="e.g. Call dentist">' +
      '<label class="planner-field-label">Note (optional)</label>' +
      '<textarea id="planner-custom-note" class="input" rows="3"></textarea>' +
      '<button id="planner-save-custom" class="btn btn-primary"' + ((typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) ? ' disabled' : '') + '>Add Task</button>';

    document.getElementById('planner-save-custom').addEventListener('click', handleSaveCustomTask);
  }
  function renderSuggestedModeBody(body) {
    const dateStr = document.getElementById('planner-date').value || todayStr();
    const suggestions = PlannerData.getSuggestedTasksForDate(dateStr);
    const proposals = (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.proposeScheduleForDate === 'function')
      ? PlanningAgentData.proposeScheduleForDate(dateStr)
      : [];
    const proposalsByTaskId = {};
    proposals.forEach(function (p) { proposalsByTaskId[p.taskId] = p; });

    if (suggestions.pending.length === 0 && suggestions.dueRevisions.length === 0 && proposals.length === 0) {
      body.innerHTML = '<p class="planner-empty empty-state">No pending or due-revision tasks to suggest.</p>';
      return;
    }

    function suggestionGroup(title, list) {
      if (list.length === 0) return '';
      return '<div class="planner-suggested-group">' +
        '<div class="planner-suggested-group-title section-heading">' + title + '</div>' +
        '<div class="planner-suggested-list list-row-group">' + list.map(function (t) {
          const prop = proposalsByTaskId[t.taskId];
          const label = t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t);
          const slotBadge = prop ? (' <span class="chip" style="font-size:0.75rem;">' + prop.proposedStart + '\u2013' + prop.proposedEnd + '</span>') : '';
          const reasonMeta = prop ? ('<div style="font-size:0.75rem;color:var(--text-muted,#8b949e);margin-top:2px;">' + esc(prop.reason) + '</div>') : '';
          return '<div class="planner-suggested-row list-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:6px;border-radius:6px;background:rgba(255,255,255,0.03);">' +
            '<div style="flex:1;min-width:0;cursor:pointer;" class="planner-suggested-fill-btn" data-task-id="' + t.taskId + '" data-start="' + (prop ? prop.proposedStart : '') + '" data-stop="' + (prop ? prop.proposedEnd : '') + '">' +
              '<div style="font-weight:500;">' + esc(label) + slotBadge + '</div>' +
              reasonMeta +
            '</div>' +
            (prop ? ('<button type="button" class="btn btn-secondary planner-suggested-auto-btn" style="padding:4px 10px;font-size:0.8rem;margin-left:8px;" data-task-id="' + t.taskId + '" data-start="' + prop.proposedStart + '" data-stop="' + prop.proposedEnd + '">Plan</button>') : '') +
          '</div>';
        }).join('') + '</div>' +
      '</div>';
    }

    body.innerHTML =
      suggestionGroup('Due Revisions', suggestions.dueRevisions) +
      suggestionGroup('Pending (Overdue)', suggestions.pending);

    body.querySelectorAll('.planner-suggested-auto-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        handleUseSuggestion(btn.dataset.taskId, dateStr, btn.dataset.start, btn.dataset.stop);
      });
    });

    body.querySelectorAll('.planner-suggested-fill-btn').forEach(function (el) {
      el.addEventListener('click', function () {
        const sInput = document.getElementById('planner-start-time');
        const eInput = document.getElementById('planner-stop-time');
        if (sInput && el.dataset.start) sInput.value = el.dataset.start;
        if (eInput && el.dataset.stop) eInput.value = el.dataset.stop;
        handleUseSuggestion(el.dataset.taskId, dateStr, el.dataset.start || null, el.dataset.stop || null);
      });
    });
  }

  let pendingSubtargets = []; // in-progress subtarget drafts for the Target form, cleared on save

  function renderTargetModeBody(body) {
    pendingSubtargets = [];
    const grouped = PlannerData.getTopicsBySubject();
    const subjectOptions = Object.keys(grouped).filter(function (subj) { return PlannerData.isActiveSubject(subj); }).map(function (subj) {
      return '<optgroup label="' + esc(subj) + '">' + grouped[subj].map(function (t) {
        return '<option value="' + t.topicId + '">' + t.topicName + '</option>';
      }).join('') + '</optgroup>';
    }).join('');

    body.innerHTML =
      '<label class="planner-field-label">Title</label>' +
      '<input type="text" id="planner-target-title" class="input" placeholder="e.g. Solve 20 questions">' +
      '<div class="planner-compact-row">' +
        '<select id="planner-target-timeframe" class="input">' +
          '<option value="daily">Daily</option>' +
          '<option value="weekly">Weekly</option>' +
          '<option value="monthly">Monthly</option>' +
        '</select>' +
        '<select id="planner-target-type" class="input">' +
          '<option value="custom">Custom</option>' +
          '<option value="hours">Hours</option>' +
          '<option value="questions">Questions</option>' +
        '</select>' +
        '<input type="number" id="planner-target-value" class="input" placeholder="Value" min="1" value="1">' +
      '</div>' +
      '<label class="planner-field-label">Link to topic (optional)</label>' +
      '<select id="planner-target-topic" class="input">' +
        '<option value="">\u2014 None \u2014</option>' +
        subjectOptions +
      '</select>' +
      '<label class="planner-field-label">Subtargets (optional)</label>' +
      '<div id="planner-target-subtargets-list"></div>' +
      '<div class="planner-compact-row">' +
        '<input type="text" id="planner-target-subtitle" class="input" placeholder="Subtarget title">' +
        '<input type="number" id="planner-target-subvalue" class="input" placeholder="Value" min="1" value="1" style="max-width:70px">' +
        '<button id="planner-target-subadd-btn" class="btn btn-secondary" type="button">+</button>' +
      '</div>' +
      '<button id="planner-save-target" class="btn btn-primary">Add Target</button>';

    function renderSubtargetDrafts() {
      const list = document.getElementById('planner-target-subtargets-list');
      if (!list) return;
      list.innerHTML = pendingSubtargets.length === 0
        ? '<p class="planner-empty empty-state">No subtargets added.</p>'
        : pendingSubtargets.map(function (s, i) {
            return '<div class="planner-task-row list-row"><div class="planner-task-meta">' + esc(s.title) + ' (' + s.targetValue + ')</div>' +
              '<button class="planner-target-subdraft-del" data-idx="' + i + '" type="button" aria-label="Remove subtarget">&times;</button></div>';
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
      const titleEl = document.getElementById('planner-target-title');
      const dateEl = document.getElementById('planner-date');
      const timeframeEl = document.getElementById('planner-target-timeframe');
      const typeEl = document.getElementById('planner-target-type');
      const valueEl = document.getElementById('planner-target-value');
      const topicEl = document.getElementById('planner-target-topic');
      if (!titleEl || !timeframeEl || !typeEl || !valueEl) return;
      const title = titleEl.value.trim();
      if (!title) { alert('Please enter a title.'); return; }
      const dateStr = (dateEl && dateEl.value) || todayStr();
      const timeframe = timeframeEl.value;
      const type = typeEl.value;
      const targetValue = Number(valueEl.value) || 1;
      const topicId = (topicEl && topicEl.value) || null;
      const target = TargetsData.createTarget({
        title: title, timeframe: timeframe, type: type, targetValue: targetValue, dateKey: dateStr, topicId: topicId
      });
      pendingSubtargets.forEach(function (s) {
        TargetsData.createSubtarget(target.targetId, { title: s.title, targetValue: s.targetValue, type: type });
      });
      pendingSubtargets = [];
      renderAddModeBody();
    });
  }

  // Re-reads the canonical subject list into the Planner's subject datalist without touching
  // anything the user has typed. Called by Library after subjects are added/removed.
  // `renamed` ({ from, to }) is passed after a subject rename: if the form's subject box still holds
  // the old name it follows the rename (otherwise Save would offer to add the old name as new),
  // and the task list re-reads the renamed subject.
  function refreshSubjectOptions(renamed) {
    const list = document.getElementById('planner-subject-options');
    if (list) list.innerHTML = PlannerData.getAllSubjects().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('');
    if (renamed) {
      const subjectEl = document.getElementById('planner-subject');
      if (subjectEl && subjectEl.value.trim().toLowerCase() === String(renamed.from).toLowerCase()) {
        subjectEl.value = renamed.to;
        updateTopicOptions();
      }
      renderSidePanel();
    }
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
    let subject = document.getElementById('planner-subject').value.trim();
    const topicName = document.getElementById('planner-topic').value.trim();
    const dateStr = document.getElementById('planner-date').value;
    const startTime = document.getElementById('planner-start-time').value;
    const stopTime = document.getElementById('planner-stop-time').value;
    const taskTypeInput = document.querySelector('input[name="planner-tasktype"]:checked');
    const taskType = taskTypeInput ? taskTypeInput.value : 'theory';
    const note = document.getElementById('planner-note').value;

        if (!subject || !topicName || !dateStr) {
      alert('Please enter a subject, a topic and a date.');
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

    // Subject must come from the canonical list. An exact/case-insensitive match is normalised to
    // the canonical spelling; a brand-new name is added only if the user confirms (so typos and
    // removed subjects never silently re-enter the list).
    const resolvedSubject = PlannerData.resolveSubject(subject);
    if (resolvedSubject) {
      subject = resolvedSubject;
    } else {
      if (!window.confirm('"' + subject + '" is not in your subject list. Add it as a new subject?')) return;
      const added = PlannerData.addSubject(subject);
      if (!added.ok) { alert(added.error); return; }
      subject = added.subject;
      refreshSubjectOptions();
    }

    if (taskType === 'revision') {
      if (typeof PlanningAgent !== 'undefined') {
        PlanningAgent.createRevisionCycle(subject, topicName, dateStr, note, startTime, stopTime, 'user');
      } else {
        PlannerData.createRevisionCycle(subject, topicName, dateStr, note, startTime, stopTime);
      }
    } else {
      if (typeof PlanningAgent !== 'undefined') {
        PlanningAgent.createTask({
          subject: subject,
          topicName: topicName,
          taskType: taskType,
          date: dateStr,
          note: note,
          startTime: startTime,
          stopTime: stopTime
        }, 'user');
      } else {
        PlannerData.createSingleTask(subject, topicName, taskType, dateStr, note, startTime, stopTime);
      }
    }

    document.getElementById('planner-topic').value = '';
    document.getElementById('planner-note').value = '';
    updateTopicOptions();
    renderSidePanel();
     if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel();
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

    if (typeof PlanningAgent !== 'undefined') {
      PlanningAgent.createTask({
        title: title,
        taskType: 'custom',
        date: dateStr,
        note: note,
        startTime: startTime,
        stopTime: stopTime
      }, 'user');
    } else {
      PlannerData.createCustomTask(title, dateStr, note, startTime, stopTime);
    }
    document.getElementById('planner-custom-title').value = '';
    document.getElementById('planner-custom-note').value = '';
    renderSidePanel();
        if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel();
  }

  function handleUseSuggestion(taskId, overrideDate, overrideStart, overrideStop) {
    if (typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive()) { alert('Finish or reset your Stopwatch/Timer before scheduling a task.'); return; }
    const dateStr = overrideDate || document.getElementById('planner-date').value;
    const startTime = overrideStart || document.getElementById('planner-start-time').value;
    const stopTime = overrideStop || document.getElementById('planner-stop-time').value;
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
    
    if (typeof PlanningAgent !== 'undefined') {
      PlanningAgent.rescheduleTask(taskId, dateStr, startTime, stopTime, 'user');
    } else {
      PlannerData.rescheduleTask(taskId, dateStr, startTime, stopTime);
    }
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
      container.innerHTML = '<p class="planner-empty empty-state">Open a chapter\'s History from Library to see its completed tasks here.</p>';
    }
  }

  

    
    
  

  function renderHistoryChapter(container) {
    const topic = PlannerData.getAllTopics()[historyTopicId];
    const chapterName = topic ? topic.topicName : '';

    const tasks = PlannerData.getHistoryTasks().filter(function (t) { return t.topicId === historyTopicId; });

    container.innerHTML =
      '<h4 class="planner-history-heading section-heading">' + chapterName + '</h4>' +
      '<div id="planner-history-list"></div>';

    renderTaskList(document.getElementById('planner-history-list'), tasks);
  }
  function renderTaskList(container, tasks) {
    if (!container) return;
    if (tasks.length === 0) {
      container.innerHTML = '<p class="planner-empty empty-state">' + emptyMessage() + '</p>';
      return;
    }
    container.innerHTML = tasks.map(renderTaskRow).join('');

    tasks.forEach(function (t) {
      const cb = document.getElementById('planner-check-' + t.taskId);
      if (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked && typeof MiscSound !== 'undefined') MiscSound.play('uiSuccess');
          if (typeof PlanningAgent !== 'undefined') {
            PlanningAgent.toggleComplete(t.taskId);
          } else {
            PlannerData.toggleComplete(t.taskId);
          }
          renderSidePanel();
        });
      }
    });

    container.querySelectorAll('.planner-start-study-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof Study !== 'undefined' && Study.startTaskSession) Study.startTaskSession(btn.dataset.taskId);
        if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('study');
      });
    });

    container.querySelectorAll('.planner-reschedule-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openRescheduleModal(btn.dataset.taskId); });
    });

    container.querySelectorAll('.planner-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditModal(btn.dataset.taskId); });
    });
    
    container.querySelectorAll('.planner-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { confirmDeleteTask(btn.dataset.taskId); });
    });
  }

  function openRescheduleModal(taskId) {
    const task = PlannerData.getAllTasks()[taskId];
    if (!task) return;
    Modal.open(
      '<h3 class="section-heading">Reschedule</h3>' +
      '<label class="planner-field-label">Date</label>' +
      '<input type="date" id="planner-resched-date" class="input" value="' + task.date + '">' +
      '<div class="planner-slot-row">' +
        '<div><label class="planner-field-label">Start</label><input type="time" id="planner-resched-start" class="input" value="' + (task.startTime || '') + '"></div>' +
        '<div><label class="planner-field-label">Stop</label><input type="time" id="planner-resched-stop" class="input" value="' + (task.stopTime || '') + '"></div>' +
      '</div>' +
      '<button id="planner-resched-confirm" class="btn btn-primary">Reschedule</button>'
    );
    document.getElementById('planner-resched-confirm').addEventListener('click', function () {
      const dateVal = document.getElementById('planner-resched-date').value;
      const startVal = document.getElementById('planner-resched-start').value;
      const stopVal = document.getElementById('planner-resched-stop').value;
      if (!dateVal) { alert('Pick a date.'); return; }
      let ok = false;
      if (typeof PlanningAgent !== 'undefined') {
        const res = PlanningAgent.rescheduleTask(taskId, dateVal, startVal, stopVal, 'user');
        ok = res.ok;
      } else {
        ok = TimeEngine.doItLater(taskId, dateVal, startVal, stopVal);
      }
      if (!ok) { alert('That slot is invalid or overlaps another task on ' + dateVal + '.'); return; }
      Modal.close();
      renderSidePanel();
    });
  }

  function openEditModal(taskId) {
    const task = PlannerData.getAllTasks()[taskId];
    if (!task) return;
    const isCustom = task.taskType === 'custom';
    Modal.open(
      '<h3 class="section-heading">Edit Task</h3>' +
      (isCustom ? '<label class="planner-field-label">Title</label><input type="text" id="planner-edit-title" class="input" value="' + esc(task.title || '') + '">' : '') +
      '<label class="planner-field-label">Note</label><input type="text" id="planner-edit-note" class="input" value="' + esc(task.note || '') + '">' +
      '<label class="planner-field-label">Date</label><input type="date" id="planner-edit-date" class="input" value="' + (task.date || '') + '">' +
      '<div class="planner-slot-row">' +
        '<div><label class="planner-field-label">Start</label><input type="time" id="planner-edit-start" class="input" value="' + (task.startTime || '') + '"></div>' +
        '<div><label class="planner-field-label">Stop</label><input type="time" id="planner-edit-stop" class="input" value="' + (task.stopTime || '') + '"></div>' +
      '</div>' +
      '<button id="planner-edit-confirm" class="btn btn-primary">Save</button>'
    );
    document.getElementById('planner-edit-confirm').addEventListener('click', function () {
      const dateVal = document.getElementById('planner-edit-date').value;
      const startVal = document.getElementById('planner-edit-start').value;
      const stopVal = document.getElementById('planner-edit-stop').value;
      const noteVal = document.getElementById('planner-edit-note').value.trim();
      if (!dateVal) { alert('Pick a date.'); return; }
      if (!PlannerData.isValidSlot(startVal, stopVal)) { alert('End time must be after start time. Leave both blank for no time slot.'); return; }
      if (PlannerData.hasSlotConflict(dateVal, startVal, stopVal, taskId)) { alert('That slot overlaps another task on ' + dateVal + '.'); return; }
      
      const patch = {
        date: dateVal,
        startTime: startVal || null,
        stopTime: stopVal || null,
        note: noteVal
      };
      if (isCustom) {
        const titleVal = document.getElementById('planner-edit-title').value.trim();
        if (titleVal) patch.title = titleVal;
      }

      if (typeof PlanningAgent !== 'undefined') {
        PlanningAgent.updateTask(taskId, patch, 'user');
      } else {
        PlannerData.rescheduleTask(taskId, dateVal, startVal, stopVal);
        const tasks = State.get().tasks;
        const existing = tasks[taskId];
        if (existing) {
          const updated = Object.assign({}, tasks);
          updated[taskId] = Object.assign({}, existing, patch);
          State.set({ tasks: updated });
        }
      }
      Modal.close();
      renderSidePanel();
    });
  }
  
  function confirmDeleteTask(taskId) {
    Modal.open(
      '<h3 class="section-heading">Delete task?</h3>' +
      '<p>This removes it from your schedule. This cannot be undone.</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="planner-delete-confirm" class="btn btn-danger">Delete</button>' +
        '<button id="planner-delete-cancel" class="btn btn-secondary">Cancel</button>' +
      '</div>'
    );
    document.getElementById('planner-delete-confirm').addEventListener('click', function () {
      if (typeof PlanningAgent !== 'undefined') {
        PlanningAgent.deleteTask(taskId);
      } else {
        PlannerData.deleteTask(taskId);
      }
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
    // Phase B / B-9: ItineraryData is a global already loaded by this point in the page — a
    // defensive typeof check, same pattern this file already uses for Study.
    const inItinerary = typeof ItineraryData !== 'undefined' &&
      (ItineraryData.getToday().items || []).some(function (it) { return it.refId === t.taskId; });
    const itineraryChip = inItinerary ? '<span class="chip planner-itinerary-chip">In today\u2019s itinerary</span> ' : '';

    const sessionActive = typeof Study !== 'undefined' && Study.isSessionActive && Study.isSessionActive();
    const studyBtn = (t.startTime && !t.completed)
      ? '<button class="planner-start-study-btn btn btn-primary"' + (sessionActive ? ' disabled' : '') + ' data-task-id="' + t.taskId + '">Start in Study</button>'
      : '';
    const reschedBtn = !t.completed
      ? '<button class="planner-reschedule-btn btn btn-secondary" data-task-id="' + t.taskId + '">Reschedule</button>'
      : '';
    
    const editBtn = '<button class="planner-edit-btn btn btn-secondary" data-task-id="' + t.taskId + '">Edit</button>';
    const deleteBtn = '<button class="planner-delete-btn btn btn-danger" data-task-id="' + t.taskId + '">Delete</button>';

    return '<div class="planner-task-row list-row' + (t.completed ? ' planner-task-done' : '') + '">' +
      '<label class="planner-task-check-label switch-label">' +
        '<input type="checkbox" id="planner-check-' + t.taskId + '" class="switch-input"' + checkedAttr + '>' +
        '<span class="planner-task-meta">' + meta + '</span>' +
      '</label>' +
      '<div class="planner-task-sub">' + dateLine + '</div>' +
      (t.note ? '<div class="planner-task-note">' + t.note + '</div>' : '') +
      itineraryChip + studyBtn + reschedBtn + editBtn + deleteBtn +
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
    addMode = 'subject'; // the subject/topic prefill below needs the Subject/Chapter form
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
  return { init: init, render: function () { renderForm(); renderSidePanel(); }, openHistory: openHistory, openDate: openDate, openForTopic: openForTopic, refreshSubjectOptions: refreshSubjectOptions };
})();
