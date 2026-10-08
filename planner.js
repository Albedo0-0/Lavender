// planner.js — Planner task workspace (task list, edit, delete, reschedule, complete, history).
// Planning NEW work is not done here: the single "✨ Plan" button opens PlanningAgentUI.
// Depends on: State, PlannerData, PlanningAgent, PlanningAgentUI.
// Builds into #planner-form and #planner-tab-content (see index.html).

const Planner = (function () {
let activeTab = 'today'; // 'today' | 'pending' | 'history'
  let historyTopicId = null;
  let planDate = null; // date requested via openDate(); used as the date context for the Plan button

  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }
  // Called by Assistant search (or anywhere else) to point the Planner at a specific date. The date
  // becomes the context for the Plan button until the next render.
  function openDate(dateStr) {
    planDate = dateStr;
    activeTab = 'today';
    renderSidePanel();
  }

  // ---------- Plan entry (single front door) ----------

  function renderForm() {
    const container = document.getElementById('planner-form');
    if (!container) return;

    container.innerHTML =
      '<button id="planner-open-agent-btn" class="btn btn-secondary" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;">\u2728 Plan</button>';

    const agentBtn = document.getElementById('planner-open-agent-btn');
    if (agentBtn) {
      agentBtn.addEventListener('click', function () {
        const d = planDate || todayStr();
        planDate = null; // one-shot: consumed by the click
        if (typeof PlanningAgentUI !== 'undefined') {
          PlanningAgentUI.open({ date: d });
        }
      });
    }
  }

  // Called by Library after subjects are renamed/removed so the task list re-reads the canonical names.
  // (The old Planner subject form no longer exists; the Agent reads subjects fresh each time it opens.)
  function refreshSubjectOptions(renamed) {
    if (renamed) renderSidePanel();
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

  // Entry point for Assistant's History shortcut — jumps straight into this existing view.
  function openHistory(subject, topicId) {
    activeTab = 'history';
    historyTopicId = topicId || null;
    renderSidePanel();
  }  
  return {
    init: init,
    render: function () { renderForm(); renderSidePanel(); },
    openHistory: openHistory,
    openDate: openDate,
    openPlan: function (opts) { if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open(opts); },
    refreshSubjectOptions: refreshSubjectOptions
  };
})();
