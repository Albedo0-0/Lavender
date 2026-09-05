// planner-data.js — Planner data layer (topics + tasks). No UI here.
// State shape: State.get().topics = { topicId: {topicId, subject, topicName} }
//              State.get().tasks  = { taskId:  {taskId, topicId, subject, topicName,
//                                                taskType, date, startTime, stopTime,
//                                                completed, completedDate,
//                                                note, revisionNumber, cycleId, title} }
// taskType: 'base' | 'theory' | 'questions' | 'revision' | 'custom'
// title is only used for taskType 'custom' (no subject/topic link); others use topicName.

const PlannerData = (function () {
  const SUBJECTS = ['Biology', 'Chemistry', 'Physics'];
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
    const grouped = { Biology: [], Chemistry: [], Physics: [] };
    Object.keys(topics).forEach(function (id) {
      const t = topics[id];
      if (grouped[t.subject]) grouped[t.subject].push(t);
    });
    SUBJECTS.forEach(function (s) {
      grouped[s].sort(function (a, b) { return a.topicName.localeCompare(b.topicName); });
    });
    return grouped;
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
      cycleId: null
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
  function createSingleTask(subject, topicName, taskType, dateStr, note) {
    const topic = getOrCreateTopic(subject, topicName);
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = blankTask({
      topicId: topic.topicId,
      subject: subject,
      topicName: topic.topicName,
      taskType: taskType,
      date: dateStr,
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
  // ---------- Tasks: completion ----------

  function toggleComplete(taskId) {
    const tasks = Object.assign({}, State.get().tasks || {});
    const task = tasks[taskId];
    if (!task) return;
    const nowCompleted = !task.completed;
    tasks[taskId] = Object.assign({}, task, {
      completed: nowCompleted,
      completedDate: nowCompleted ? todayStr() : null
    });
    State.set({ tasks: tasks });
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
    return sortByDate(getTasksList().filter(function (t) { return t.date === today && !t.completed; }));
  }

  // Incomplete tasks whose date has already passed — today's undone work lands here once the day ends.
  function getPendingTasks() {
    const today = todayStr();
    return sortByDate(getTasksList().filter(function (t) { return t.date < today && !t.completed; }));
  }

  function getHistoryTasks() {
    return sortByCompletedDesc(getTasksList().filter(function (t) { return t.completed; }));
  }

  function getTasksForDate(dateStr) {
    return sortByDate(getTasksList().filter(function (t) { return t.date === dateStr; }));
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
    SUBJECTS: SUBJECTS,
    getOrCreateTopic: getOrCreateTopic,
    findTopic: findTopic,
    getTopicsBySubject: getTopicsBySubject,
    createRevisionCycle: createRevisionCycle,
    createSingleTask: createSingleTask,
    createCustomTask: createCustomTask,
    rescheduleTask: rescheduleTask,
    toggleComplete: toggleComplete,
    getAllTasks: getAllTasks,
    getTasksList: getTasksList,
    getTodayTasks: getTodayTasks,
    getPendingTasks: getPendingTasks,
    getHistoryTasks: getHistoryTasks,
    getTasksForDate: getTasksForDate,
    getIncompleteTasksForDate: getIncompleteTasksForDate,
    getSuggestedTasksForDate: getSuggestedTasksForDate,
    taskLabel: taskLabel,
    slotLabel: slotLabel
  };
})();
