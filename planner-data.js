// planner-data.js — Planner data layer (topics + tasks). No UI here.
// State shape: State.get().topics = { topicId: {topicId, subject, topicName} }
//              State.get().tasks  = { taskId:  {taskId, topicId, subject, topicName,
//                                                taskType, date, startTime, stopTime,
//                                                completed, completedDate,
//                                                note, revisionNumber, cycleId, title} }
// taskType: 'base' | 'theory' | 'questions' | 'revision' | 'custom'
// title is only used for taskType 'custom' (no subject/topic link); others use topicName.

const PlannerData = (function () {
  // Seed for a fresh install ONLY. Never used as a validity list: the active list lives in
  // State.get().subjects (see getAllSubjects below).
  const DEFAULT_SUBJECTS = ['Biology', 'Physics', 'Chemistry'];
  const MAX_SUBJECT_LENGTH = 40;
  const REVISION_OFFSETS = [1, 3, 5, 8, 15, 30]; // sequential, each from the previous revision
  const REVISION_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function shiftDateStr(dateStr, delta) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Topics ----------

  function getAllTopics() {
    return State.get().topics || {};
  }

  function findTopic(subject, topicName) {
    const name = topicName.trim().toLowerCase();
    const topics = getAllTopics();
    return Object.keys(topics)
      .map(function (id) { return topics[id]; })
      .find(function (t) { return t.subject === subject && t.topicName.trim().toLowerCase() === name; }) || null;
  }

  function getOrCreateTopic(subject, topicName) {
    const existing = findTopic(subject, topicName);
    if (existing) return existing;

    const topics = Object.assign({}, getAllTopics());
    const topic = {
      topicId: generateId('topic'),
      subject: subject,
      topicName: topicName.trim()
    };
    topics[topic.topicId] = topic;
    State.set({ topics: topics });
    return topic;
  }

  function getTopicsBySubject() {
    const topics = getAllTopics();
    const grouped = {};
    getAllSubjects().forEach(function (s) { grouped[s] = []; }); // active subjects always present, even when empty
    Object.keys(topics).forEach(function (id) {
      const t = topics[id];
      if (!t.subject) return;
      if (!grouped[t.subject]) grouped[t.subject] = [];
      grouped[t.subject].push(t);
    });
    Object.keys(grouped).forEach(function (s) {
      grouped[s].sort(function (a, b) { return a.topicName.localeCompare(b.topicName); });
    });
    return grouped;
  }

  // ---------- Subjects: the ONE canonical list ----------
  // Subjects stay plain strings (records already store the name; no IDs, no migration). The active
  // list is State.get().subjects. While that is null (fresh install, or an existing user who has
  // never touched subjects) the list is the defaults plus any custom subject already in use by a
  // topic — exactly what the app showed before — and nothing is written until the user edits it.
  // Removing a subject only removes it from this list; topics/tasks keep their subject string.

  function normalizeSubjectName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  }

  function subjectsInTopics() {
    const topics = getAllTopics();
    const seen = {};
    Object.keys(topics).forEach(function (id) { if (topics[id].subject) seen[topics[id].subject] = true; });
    return Object.keys(seen);
  }

  // Active subjects, in display order.
  function getAllSubjects() {
    const stored = State.get().subjects;
    if (Array.isArray(stored)) return stored.slice();
    const extra = subjectsInTopics().filter(function (s) { return DEFAULT_SUBJECTS.indexOf(s) === -1; }).sort();
    return DEFAULT_SUBJECTS.concat(extra);
  }

  // Subjects that still own chapters but are no longer active (removed by the user).
  function getHistoricalSubjects() {
    const active = getAllSubjects();
    return subjectsInTopics().filter(function (s) { return active.indexOf(s) === -1; }).sort();
  }

  // Case-insensitive match against the ACTIVE list; returns the canonical name or null.
  function resolveSubject(name) {
    const clean = normalizeSubjectName(name).toLowerCase();
    if (!clean) return null;
    return getAllSubjects().find(function (s) { return s.toLowerCase() === clean; }) || null;
  }

  function isActiveSubject(name) { return resolveSubject(name) !== null; }

  // Returns { ok, subject, error }. Re-adding a removed subject reuses its historical spelling,
  // so its old chapters/tasks re-attach automatically.
  function addSubject(name) {
    const clean = normalizeSubjectName(name);
    if (!clean) return { ok: false, error: 'Enter a subject name.' };
    if (clean.length > MAX_SUBJECT_LENGTH) return { ok: false, error: 'Subject names can be up to ' + MAX_SUBJECT_LENGTH + ' characters.' };
    const existing = resolveSubject(clean);
    if (existing) return { ok: false, subject: existing, error: '"' + existing + '" is already in your subjects.' };
    const historical = getHistoricalSubjects().find(function (s) { return s.toLowerCase() === clean.toLowerCase(); });
    const canonical = historical || clean;
    if (!State.set({ subjects: getAllSubjects().concat([canonical]) })) return { ok: false, error: 'Could not save the subject.' };
    return { ok: true, subject: canonical };
  }

  // Removes from the active list only. Never touches topics, tasks, or any history.
  function removeSubject(name) {
    const current = getAllSubjects();
    if (current.indexOf(name) === -1) return false;
    return State.set({ subjects: current.filter(function (s) { return s !== name; }) });
  }

  // Renames an ACTIVE subject in place. This is the one canonical rename: the active list entry
  // keeps its position, and every record that stores the old name in a SUBJECT field (topics, tasks,
  // itinerary study items in templates / today / archived days) gets the new name. IDs, dates,
  // completion, revision data and all relationships are untouched; free-text fields that merely
  // contain the word are never rewritten. Only the stored "Subject · ..." display prefix on
  // itinerary labels that were generated from the old subject is refreshed. All changes are written
  // in ONE State.set so a failed save changes nothing.
  // Returns { ok, subject, unchanged?, counts?, error? }.
  function renameSubject(oldName, newName) {
    const oldCanon = resolveSubject(oldName);
    if (!oldCanon) return { ok: false, error: 'That subject is no longer in your list.' };
    const clean = normalizeSubjectName(newName);
    if (!clean) return { ok: false, error: 'Enter a subject name.' };
    if (clean.length > MAX_SUBJECT_LENGTH) return { ok: false, error: 'Subject names can be up to ' + MAX_SUBJECT_LENGTH + ' characters.' };
    if (clean === oldCanon) return { ok: true, subject: clean, unchanged: true, counts: { topics: 0, tasks: 0, itineraryItems: 0 } };

    // Same duplicate rule as addSubject: case-insensitive against the active list. A case-only
    // respelling of the SAME subject ("physics" -> "Physics") is allowed.
    const clash = resolveSubject(clean);
    if (clash && clash !== oldCanon) return { ok: false, subject: clash, error: '"' + clash + '" is already in your subjects.' };
    // A removed subject that still owns history under that name would silently merge with this
    // one's history, so refuse; re-adding it from Library is the way to reconnect it.
    if (clean.toLowerCase() !== oldCanon.toLowerCase()) {
      const historicalClash = getHistoricalSubjects().find(function (s) { return s.toLowerCase() === clean.toLowerCase(); });
      if (historicalClash) return { ok: false, error: 'A removed subject named "' + historicalClash + '" still has history. Add it back from Library, or choose a different name.' };
    }

    const counts = { topics: 0, tasks: 0, itineraryItems: 0 };
    const patch = {
      subjects: getAllSubjects().map(function (s) { return s === oldCanon ? clean : s; })
    };

    const topics = getAllTopics();
    const nextTopics = Object.assign({}, topics);
    Object.keys(topics).forEach(function (id) {
      if (topics[id] && topics[id].subject === oldCanon) {
        nextTopics[id] = Object.assign({}, topics[id], { subject: clean });
        counts.topics++;
      }
    });
    if (counts.topics) patch.topics = nextTopics;

    const tasks = State.get().tasks || {};
    const nextTasks = Object.assign({}, tasks);
    const renamedTaskIds = {};
    Object.keys(tasks).forEach(function (id) {
      if (tasks[id] && tasks[id].subject === oldCanon) {
        nextTasks[id] = Object.assign({}, tasks[id], { subject: clean });
        renamedTaskIds[id] = true;
        counts.tasks++;
      }
    });
    if (counts.tasks) patch.tasks = nextTasks;

    // Itinerary: study items carry a `subject` field; their stored label (and a planner-task item's
    // label, which links to a task by refId) start with "<subject> \u00b7 ".
    const SEP = ' \u00b7 ';
    function relabel(label) {
      return (typeof label === 'string' && label.indexOf(oldCanon + SEP) === 0) ? clean + label.slice(oldCanon.length) : label;
    }
    function fixItem(it) {
      if (!it || typeof it !== 'object') return it;
      if (it.subject === oldCanon) { counts.itineraryItems++; return Object.assign({}, it, { subject: clean, label: relabel(it.label) }); }
      if (it.type === 'planner-task' && it.refId && renamedTaskIds[it.refId]) {
        const label = relabel(it.label);
        if (label !== it.label) return Object.assign({}, it, { label: label });
      }
      return it;
    }
    function fixItems(items) {
      if (!Array.isArray(items)) return items;
      let changed = false;
      const out = items.map(function (it) { const n = fixItem(it); if (n !== it) changed = true; return n; });
      return changed ? out : items;
    }
    function fixContainer(c) { // template / today's itinerary / archived day: anything with items[]
      if (!c || typeof c !== 'object') return c;
      const items = fixItems(c.items);
      return items === c.items ? c : Object.assign({}, c, { items: items });
    }
    function fixMap(map) {
      if (!map || typeof map !== 'object') return map;
      let changed = false;
      const out = Object.assign({}, map);
      Object.keys(map).forEach(function (k) { const n = fixContainer(map[k]); if (n !== map[k]) { out[k] = n; changed = true; } });
      return changed ? out : map;
    }
    const st = State.get();
    const nextTemplates = fixMap(st.itineraryTemplates);
    if (nextTemplates !== st.itineraryTemplates) patch.itineraryTemplates = nextTemplates;
    const nextSummaries = fixMap(st.dailyItinerarySummaries);
    if (nextSummaries !== st.dailyItinerarySummaries) patch.dailyItinerarySummaries = nextSummaries;
    const nextToday = fixContainer(st.dailyItinerary);
    if (nextToday !== st.dailyItinerary) patch.dailyItinerary = nextToday;

    if (!State.set(patch)) return { ok: false, error: 'Could not save the new name.' };
    return { ok: true, subject: clean, counts: counts };
  }

  // For the delete-confirm message: what stays behind as history.
  function getSubjectUsage(subject) {
    const topics = getAllTopics();
    return {
      topics: Object.keys(topics).filter(function (id) { return topics[id].subject === subject; }).length,
      tasks: getTasksList().filter(function (t) { return t.subject === subject; }).length
    };
  }

  function getTasksForTopic(topicId) {
    return getTasksList().filter(function (t) { return t.topicId === topicId; });
  }

  function renameTopic(topicId, newName) {
    const topics = Object.assign({}, getAllTopics());
    if (!topics[topicId]) return false;
    topics[topicId] = Object.assign({}, topics[topicId], { topicName: newName.trim() });
    State.set({ topics: topics });
    const tasks = Object.assign({}, State.get().tasks || {});
    Object.keys(tasks).forEach(function (id) {
      if (tasks[id].topicId === topicId) tasks[id] = Object.assign({}, tasks[id], { topicName: newName.trim() });
    });
    State.set({ tasks: tasks });
    return true;
  }

  function updateTopicMeta(topicId, meta) {
    const topics = Object.assign({}, getAllTopics());
    if (!topics[topicId]) return false;
    topics[topicId] = Object.assign({}, topics[topicId], meta);
    State.set({ topics: topics });
    return true;
  }

  function deleteTopic(topicId) {
    if (getTasksForTopic(topicId).some(function (t) { return !t.archived; })) return false;
    const topics = Object.assign({}, getAllTopics());
    delete topics[topicId];
    State.set({ topics: topics });
    return true;
  }
  // ---------- Tasks: creation ----------

  function computeRevisionDates(baseDateStr) {
    let cursor = baseDateStr;
    const dates = [];
    REVISION_OFFSETS.forEach(function (offset) {
      cursor = shiftDateStr(cursor, offset);
      dates.push(cursor);
    });
    return dates;
  }

  function blankTask(overrides) {
    return Object.assign({
      taskId: generateId('task'),
      topicId: null,
      subject: null,
      topicName: null,
      taskType: null,
      date: null,
      completed: false,
      completedDate: null,
      note: '',
      revisionNumber: null,
      cycleId: null,
      archived: false,
      archivedAt: null
    }, overrides);
  }

  // Repeated Revision: creates the base study task + R1..R6, all sharing topicId + cycleId.
  // Only the base task gets the slot entered now; R1..R6 are slot-less until their own day
  // arrives, where they show up in the Planner's "Suggested" mode to be given a per-occurrence slot.
  function createRevisionCycle(subject, topicName, baseDateStr, note, startTime, stopTime) {
    const topic = getOrCreateTopic(subject, topicName);
    const cycleId = generateId('cycle');
    const tasks = Object.assign({}, State.get().tasks || {});

    const baseTask = blankTask({
      topicId: topic.topicId,
      subject: subject,
      topicName: topic.topicName,
      taskType: 'base',
      date: baseDateStr,
      startTime: startTime || null,
      stopTime: stopTime || null,
      note: note || '',
      cycleId: cycleId
    });
    tasks[baseTask.taskId] = baseTask;

    computeRevisionDates(baseDateStr).forEach(function (dateStr, idx) {
      const revTask = blankTask({
        topicId: topic.topicId,
        subject: subject,
        topicName: topic.topicName,
        taskType: 'revision',
        date: dateStr,
        revisionNumber: REVISION_LABELS[idx],
        cycleId: cycleId
      });
      tasks[revTask.taskId] = revTask;
    });

    State.set({ tasks: tasks });
    return baseTask;
  }

  // Theory / Questions: single task, no repeats.
  function createSingleTask(subject, topicName, taskType, dateStr, note, startTime, stopTime) {
    const topic = getOrCreateTopic(subject, topicName);
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = blankTask({
      topicId: topic.topicId,
      subject: subject,
      topicName: topic.topicName,
      taskType: taskType,
      date: dateStr,
      startTime: startTime || null,
      stopTime: stopTime || null,
      note: note || ''
    });
    tasks[task.taskId] = task;
    State.set({ tasks: tasks });
    return task;
  }

  // Custom task: no subject/topic link, free title. Covers non-study slots.
  function createCustomTask(title, dateStr, note, startTime, stopTime) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = blankTask({
      title: title.trim(),
      taskType: 'custom',
      date: dateStr,
      startTime: startTime || null,
      stopTime: stopTime || null,
      note: note || ''
    });
    tasks[task.taskId] = task;
    State.set({ tasks: tasks });
    return task;
  }
  // Move an existing task (e.g. a suggested pending/revision task) onto a new date/slot.
  function rescheduleTask(taskId, dateStr, startTime, stopTime) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = tasks[taskId];
    if (!task) return;
    tasks[taskId] = Object.assign({}, task, {
      date: dateStr,
      startTime: startTime || null,
      stopTime: stopTime || null
    });
    State.set({ tasks: tasks });
  }

  // Generic patch for an existing task's editable fields (note, date, startTime, stopTime,
  // taskType, title). Mirrors rescheduleTask's immutable-update pattern. Used by the Edit
  // action in Library/Planner task rows.
  function updateTask(taskId, patch) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = tasks[taskId];
    if (!task) return null;
    tasks[taskId] = Object.assign({}, task, patch);
    State.set({ tasks: tasks });
    return tasks[taskId];
  }

  function getTask(taskId) {
    const tasks = State.get().tasks || {};
    return tasks[taskId] || null;
  }

  // Deletes exactly one task instance (by taskId). Revision-cycle siblings, if any, are left
  // untouched — deletion is always single-instance, never whole-cycle. Does not touch
  // TimeEngine's sessionRecords, so completed-session history for this task is preserved even
  // after the schedule row is gone.
  function deleteTask(taskId) {
    const tasks = Object.assign({}, State.get().tasks || {});
    if (!tasks[taskId]) return;
    delete tasks[taskId];
    State.set({ tasks: tasks });
  }

  // ---------- Tasks: archive ----------
  // Archiving is a soft-hide flag, not deletion — archived tasks stay in State.tasks with their
  // ID intact and remain fully recoverable via unarchiveTask. They're excluded from the active
  // Today/Pending/Upcoming/History queries below but retrievable via getArchivedTasks.
  function archiveTask(taskId) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = tasks[taskId];
    if (!task || task.archived) return;
    tasks[taskId] = Object.assign({}, task, { archived: true, archivedAt: todayStr() });
    State.set({ tasks: tasks });
  }

  function unarchiveTask(taskId) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = tasks[taskId];
    if (!task || !task.archived) return;
    tasks[taskId] = Object.assign({}, task, { archived: false, archivedAt: null });
    State.set({ tasks: tasks });
  }

  function getArchivedTasks() {
    return sortByDate(getTasksList().filter(function (t) { return t.archived; }));
  }
  // ---------- Tasks: completion ----------
  // ---------- Tasks: completion ----------

  function toggleComplete(taskId) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = tasks[taskId];
    if (!task) return;
    const nowCompleted = !task.completed;
    const updated = Object.assign({}, task, {
      completed: nowCompleted,
      completedDate: nowCompleted ? todayStr() : null,
      // Completing a task frees its slot so it stops blocking hasSlotConflict checks for new/rescheduled tasks.
      // The original slot is stashed in savedStartTime/savedStopTime so uncompleting restores it exactly.
      startTime: nowCompleted ? null : (task.startTime || task.savedStartTime || null),
      stopTime: nowCompleted ? null : (task.stopTime || task.savedStopTime || null),
      savedStartTime: nowCompleted ? (task.startTime || null) : null,
      savedStopTime: nowCompleted ? (task.stopTime || null) : null
    });
    tasks[taskId] = updated;
    State.set({ tasks: tasks });
    // Live EXP (§B.8.3 redesign — see gamification-data.js): awarded/retracted the instant a
    // task's completion state flips, not batched to the cutoff.
    if (typeof GamificationData !== 'undefined') {
      if (nowCompleted) GamificationData.awardTaskCompleted(updated);
      else GamificationData.retractTaskCompleted(task);
    }
  }

  // ---------- Tasks: queries ----------

  function getAllTasks() {
    return State.get().tasks || {};
  }

  function getTasksList() {
    const tasks = getAllTasks();
    return Object.keys(tasks).map(function (id) { return tasks[id]; });
  }

  function sortByDate(list) {
    return list.slice().sort(function (a, b) {
      if (a.date === b.date) return (a.topicName || a.title || '').localeCompare(b.topicName || b.title || '');
      return a.date < b.date ? -1 : 1;
    });
  }

  function sortByCompletedDesc(list) {
    return list.slice().sort(function (a, b) {
      if (a.completedDate === b.completedDate) return (a.topicName || a.title || '').localeCompare(b.topicName || b.title || '');
      return a.completedDate > b.completedDate ? -1 : 1;
    });
  }

  function getTodayTasks() {
    const today = todayStr();
    return sortByDate(getTasksList().filter(function (t) { return t.date === today && !t.completed && !t.archived; }));
  }

  // Incomplete tasks whose date has already passed — today's undone work lands here once the day ends.
  function getPendingTasks() {
    const today = todayStr();
    return sortByDate(getTasksList().filter(function (t) { return t.date < today && !t.completed && !t.archived; }));
  }

  // Scheduled, not-yet-due incomplete tasks — same records as Today/Pending, just date > today.
  function getUpcomingTasks() {
    const today = todayStr();
    return sortByDate(getTasksList().filter(function (t) { return t.date > today && !t.completed && !t.archived; }));
  }

  function getHistoryTasks() {
    return sortByCompletedDesc(getTasksList().filter(function (t) { return t.completed && !t.archived; }));
  }

  function getTasksForDate(dateStr) {
    return sortByDate(getTasksList().filter(function (t) { return t.date === dateStr; }));
  }

  // Time validation (approved optimisation #1): a session's end time must be strictly after
  // its start time, on the same day — 'HH:MM' strings compare correctly lexicographically, and
  // this also rejects overnight sessions (e.g. 23:00 -> 01:00), since there's no way to express
  // "next day" in this single time-of-day field. A task may still have no slot at all
  // (both blank = unscheduled); only reject when a slot is actually being set.
  function isValidSlot(startTime, stopTime) {
    if (!startTime && !stopTime) return true;
    if (!startTime || !stopTime) return false;
    return stopTime > startTime;
  }

  // True if [startTime, stopTime) overlaps any other task's slot on the same date.
  // Tasks without a full slot (missing start or stop) are ignored on both sides.
  function hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId) {
    if (!startTime || !stopTime) return false;
    return getTasksForDate(dateStr).some(function (t) {
      if (t.taskId === excludeTaskId) return false;
      if (!t.startTime || !t.stopTime) return false;
      return startTime < t.stopTime && t.startTime < stopTime;
    });
  }
  
  function getIncompleteTasksForDate(dateStr) {
    return getTasksForDate(dateStr).filter(function (t) { return !t.completed; });
  }

  // Suggestion pools for the Planner's "Suggested" add-mode, kept scoped separately:
  // pending = all overdue incomplete tasks (any past date); dueRevisions = revision
  // occurrences whose own date is exactly dateStr (this is how per-occurrence slots get set).
  function getSuggestedTasksForDate(dateStr) {
    return {
      pending: getPendingTasks(),
      dueRevisions: getTasksForDate(dateStr).filter(function (t) {
        return t.taskType === 'revision' && !t.completed;
      })
    };
  }
  
  function taskLabel(t) {
    if (t.taskType === 'revision') return 'Revision ' + t.revisionNumber;
    if (t.taskType === 'base') return 'Study';
    if (t.taskType === 'theory') return 'Theory';
    if (t.taskType === 'questions') return 'Questions';
    if (t.taskType === 'custom') return t.title;
    return t.taskType;
  }
  
function slotLabel(t) {
    if (!t.startTime && !t.stopTime) return '';
    return (t.startTime || '?') + '\u2013' + (t.stopTime || '?');
  }
  
  return {

    DEFAULT_SUBJECTS: DEFAULT_SUBJECTS,
    // Back-compat alias for any caller still reading PlannerData.SUBJECTS: now the live active list.
    get SUBJECTS() { return getAllSubjects(); },
    getHistoricalSubjects: getHistoricalSubjects,
    resolveSubject: resolveSubject,
    isActiveSubject: isActiveSubject,
    addSubject: addSubject,
    removeSubject: removeSubject,
    renameSubject: renameSubject,
    getSubjectUsage: getSubjectUsage,
    updateTopicMeta: updateTopicMeta,
    getAllTopics: getAllTopics,
    getOrCreateTopic: getOrCreateTopic,
    findTopic: findTopic,
        getTopicsBySubject: getTopicsBySubject,
    getAllSubjects: getAllSubjects,
    getTasksForTopic: getTasksForTopic,
    renameTopic: renameTopic,
    deleteTopic: deleteTopic,
    createRevisionCycle: createRevisionCycle,
    createSingleTask: createSingleTask,
    createCustomTask: createCustomTask,
    rescheduleTask: rescheduleTask,
    deleteTask: deleteTask,
    updateTask: updateTask,
    getTask: getTask,
    archiveTask: archiveTask,
    unarchiveTask: unarchiveTask,
    getArchivedTasks: getArchivedTasks,
    toggleComplete: toggleComplete,
    getAllTasks: getAllTasks,
    getTasksList: getTasksList,
    getTodayTasks: getTodayTasks,
    getPendingTasks: getPendingTasks,
    getUpcomingTasks: getUpcomingTasks,
    getHistoryTasks: getHistoryTasks,
    getTasksForDate: getTasksForDate,
    getIncompleteTasksForDate: getIncompleteTasksForDate,
    getSuggestedTasksForDate: getSuggestedTasksForDate,
    isValidSlot: isValidSlot,
    hasSlotConflict: hasSlotConflict,
    taskLabel: taskLabel,
    slotLabel: slotLabel

  };
})();
