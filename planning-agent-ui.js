// planning-agent-ui.js — Centralized Planning Agent: User-Facing Interface
// The ONE user-facing planning interface for all of Lavender: every "plan new work" action opens this.
// Deterministic reasoning without AI/LLM network dependencies.
// Self-contained: PlanningAgentData and PlanningAgent are defined in this file (Phase 7).
// Depends on: State, Modal, GamificationData, TimeEngine (optional), MiscSound.

// ============================================================================
// SECTIONS 1-2 - CANONICAL TASK STORE (Planning Architecture, Phase 1)
// Single storage key: 'lavender_canonical_tasks'. Owns schema validation, CRUD,
// in-memory cache, change events and one-way legacy migration.
// Legacy sources are READ ONLY in Phase 1 (never modified or deleted):
//   - localStorage 'lavender_planner_tasks' (array or id->task map; backed up once)
//   - State.get().tasks (the planner's live store: taskId -> task)
// ============================================================================
const CanonicalTaskStore = (function () {
  const STORAGE_KEY = 'lavender_canonical_tasks';
  const CORRUPT_BACKUP_KEY = 'lavender_canonical_tasks_corrupt_backup';
  const LEGACY_PLANNER_KEY = 'lavender_planner_tasks';
  const LEGACY_BACKUP_KEY = 'lavender_legacy_backup_planner_tasks';
  const SCHEMA_VERSION = 1;

  const STATUSES = ['pending', 'completed', 'cancelled'];
  const TYPES = ['study', 'custom', 'revision', 'practice', 'break', 'exercise'];
  const REVISION_LEVELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
  const ID_FIELDS = ['subjectId', 'topicId', 'targetId', 'subtaskId'];
  const LEGACY_TYPE_MAP = {
    theory: 'study', study: 'study', questions: 'practice', practice: 'practice',
    revision: 'revision', custom: 'custom', 'break': 'break', exercise: 'exercise'
  };

  let cache = null; // { version, tasks: [], migratedLegacyIds: { legacyId: canonicalId } }
  let migrationRan = false;
  const listeners = [];

  // ---------- helpers ----------

  function fail(msg) { return { ok: false, error: msg }; }
  function isBlank(v) { return v === undefined || v === null || v === ''; }
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    return d.getFullYear() === Number(s.slice(0, 4)) &&
           d.getMonth() + 1 === Number(s.slice(5, 7)) &&
           d.getDate() === Number(s.slice(8, 10));
  }

  function isValidTime(s) {
    return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  }

  function toMin(hhmm) {
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  }

  function emit(evt) {
    listeners.slice().forEach(function (fn) {
      try { fn(evt); } catch (e) { console.warn('CanonicalTaskStore listener error', e); }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  // ---------- schema validation ----------
  // Every field except the identifiers/status is optional; nothing is required to satisfy legacy shapes.

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return fail('Task must be an object.');
    if (typeof raw.id !== 'string' || !raw.id) return fail('Task id is missing.');
    if (!isFiniteNum(raw.createdAt) || !isFiniteNum(raw.updatedAt)) return fail('Task timestamps are invalid.');

    const t = {
      id: raw.id,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      status: isBlank(raw.status) ? 'pending' : raw.status
    };
    if (STATUSES.indexOf(t.status) === -1) return fail('Invalid status: ' + t.status);

    if (!isBlank(raw.title)) {
      if (typeof raw.title !== 'string') return fail('title must be a string.');
      const title = raw.title.trim();
      if (title) t.title = title;
    }
    if (!isBlank(raw.type)) {
      if (TYPES.indexOf(raw.type) === -1) return fail('Invalid type: ' + raw.type);
      t.type = raw.type;
    }
    if (!isBlank(raw.date)) {
      if (!isValidDate(raw.date)) return fail('date must be a valid YYYY-MM-DD string.');
      t.date = raw.date;
    }
    if (!isBlank(raw.time)) {
      if (!isValidTime(raw.time)) return fail('time must be HH:mm (24-hour).');
      t.time = raw.time;
    }
    if (!isBlank(raw.duration)) {
      const d = Number(raw.duration);
      if (!isFiniteNum(d) || d <= 0) return fail('duration must be a positive number of minutes.');
      t.duration = d;
    }
    for (let i = 0; i < ID_FIELDS.length; i++) {
      const k = ID_FIELDS[i];
      if (!isBlank(raw[k])) {
        if (typeof raw[k] !== 'string' && typeof raw[k] !== 'number') return fail(k + ' must be a string.');
        t[k] = String(raw[k]);
      }
    }
    if (!isBlank(raw.checklist)) {
      if (!Array.isArray(raw.checklist)) return fail('checklist must be an array.');
      const items = [];
      raw.checklist.forEach(function (it) {
        const isObj = it && typeof it === 'object';
        const text = String(isObj ? (isBlank(it.text) ? '' : it.text) : (isBlank(it) ? '' : it)).trim();
        if (!text) return;
        items.push({
          id: (isObj && !isBlank(it.id)) ? String(it.id) : 'c_' + uuid().slice(0, 8),
          text: text,
          completed: !!(isObj && it.completed)
        });
      });
      if (items.length) t.checklist = items;
    }
    if (!isBlank(raw.alarm)) {
      if (typeof raw.alarm !== 'object' || Array.isArray(raw.alarm)) return fail('alarm must be an object.');
      const off = isBlank(raw.alarm.offsetMinutes) ? 0 : Number(raw.alarm.offsetMinutes);
      if (!isFiniteNum(off) || off < 0) return fail('alarm.offsetMinutes must be zero or more.');
      t.alarm = {
        enabled: !!raw.alarm.enabled,
        offsetMinutes: off,
        sound: isBlank(raw.alarm.sound) ? 'chime' : String(raw.alarm.sound),
        notified: !!raw.alarm.notified
      };
    }
    
    if (!isBlank(raw.revisionMeta)) {
      const rm = raw.revisionMeta;
      if (typeof rm !== 'object' || Array.isArray(rm)) return fail('revisionMeta must be an object.');
      const meta = {};
      if (!isBlank(rm.level)) {
        if (REVISION_LEVELS.indexOf(rm.level) === -1) return fail('revisionMeta.level must be R1 to R6.');
        meta.level = rm.level;
      }
      if (!isBlank(rm.cycleId)) meta.cycleId = String(rm.cycleId);
      const src = !isBlank(rm.sourceTaskId) ? rm.sourceTaskId : rm.originalTaskId;
      if (!isBlank(src)) meta.sourceTaskId = String(src);
      if (Object.keys(meta).length) t.revisionMeta = meta;
    }
    if (!isBlank(raw.completedAt)) {
      if (!isFiniteNum(raw.completedAt)) return fail('completedAt must be an epoch timestamp.');
      t.completedAt = raw.completedAt;
    }
    return { ok: true, task: t };
  }

  // completedAt always mirrors status: set when completed, removed otherwise.
  function finalize(t, ts) {
    if (t.status === 'completed') { if (!t.completedAt) t.completedAt = ts; }
    else delete t.completedAt;
    return t;
  }

  // ---------- persistence ----------

  function load() {
    if (cache) return cache;
    let parsed = null;
    let rawStr = null;
    try {
      rawStr = localStorage.getItem(STORAGE_KEY);
      if (rawStr) parsed = JSON.parse(rawStr);
    } catch (e) {
      parsed = null;
      try { if (rawStr) localStorage.setItem(CORRUPT_BACKUP_KEY, rawStr); } catch (e2) {}
    }
    const tasks = [];
    if (parsed && Array.isArray(parsed.tasks)) {
      parsed.tasks.forEach(function (t) {
        const n = normalize(t);
        if (n.ok) tasks.push(n.task);
      });
    }
    const tomb = (parsed && parsed.migratedLegacyIds && typeof parsed.migratedLegacyIds === 'object') ? parsed.migratedLegacyIds : {};
    cache = { version: SCHEMA_VERSION, tasks: tasks, migratedLegacyIds: tomb };
    return cache;
  }

  function draft(s) {
    return { version: SCHEMA_VERSION, tasks: s.tasks.slice(), migratedLegacyIds: Object.assign({}, s.migratedLegacyIds) };
  }

  function persist(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      cache = next;
      return true;
    } catch (e) {
      return false;
    }
  }

  function indexOfId(s, id) {
    for (let i = 0; i < s.tasks.length; i++) if (s.tasks[i].id === id) return i;
    return -1;
  }

  // Loads the store and runs the (idempotent) legacy migration once per page load.
  function ready() {
    load();
    if (!migrationRan) {
      migrationRan = true;
      migrateLegacyPlannerData();
    }
    return load();
  }

  // ---------- legacy migration ----------

  function extractLegacyList(parsed) {
    if (!parsed || typeof parsed !== 'object') return [];
    if (Array.isArray(parsed)) return parsed;
    if (parsed.tasks && typeof parsed.tasks === 'object') return extractLegacyList(parsed.tasks);
    return Object.keys(parsed).map(function (k) {
      const v = parsed[k];
      return (v && typeof v === 'object') ? Object.assign({}, v, { taskId: v.taskId || v.id || k }) : null;
    });
  }

  function mapLegacyTask(l, key, topics, ts) {
    const topic = (!isBlank(l.topicId) && topics && topics[l.topicId]) || null;
    const subject = l.subject || (topic && topic.subject) || '';
    const topicName = l.topicName || (topic && topic.topicName) || '';
    const type = LEGACY_TYPE_MAP[String(l.taskType || '').toLowerCase()] || 'study';

    const time = isValidTime(l.startTime) ? l.startTime : (isValidTime(l.time) ? l.time : undefined);
    let duration;
    if (Number(l.durationMin) > 0) duration = Number(l.durationMin);
    else if (isValidTime(l.startTime) && isValidTime(l.stopTime) && toMin(l.stopTime) > toMin(l.startTime)) {
      duration = toMin(l.stopTime) - toMin(l.startTime);
    }

    let title = (typeof l.title === 'string' && l.title.trim()) ? l.title : '';
    if (!title) title = (subject && topicName) ? subject + ' \u00b7 ' + topicName : (topicName || subject);

    const rn = Math.floor(Number(l.revisionNumber));
    const level = (rn >= 1 && rn <= 6) ? 'R' + rn : undefined;
    const revisionMeta = (level || l.cycleId) ? { level: level, cycleId: l.cycleId } : undefined;

    const completed = !!l.completed;
    return {
      id: 'legacy_' + key,
      createdAt: isFiniteNum(l.createdAt) ? l.createdAt : ts,
      updatedAt: ts,
      status: completed ? 'completed' : 'pending',
      title: title,
      type: type,
      date: isValidDate(l.date) ? l.date : undefined,
      time: time,
      duration: duration,
      subjectId: subject,
      topicId: l.topicId,
      targetId: isBlank(l.targetId) ? undefined : l.targetId,
      subtaskId: isBlank(l.subtargetId) ? undefined : l.subtargetId,
      revisionMeta: revisionMeta,
      completedAt: completed ? (isValidDate(l.completedDate) ? new Date(l.completedDate + 'T00:00:00').getTime() : ts) : undefined
    };
  }

  // Idempotent: each legacy task id is migrated once (tracked in migratedLegacyIds), so deleting a
  // migrated task never resurrects it. Safe to call repeatedly.
  function migrateLegacyPlannerData() {
    const s = load();
    const summary = { migrated: 0, skipped: 0, failed: 0, sources: [] };
    const found = [];
    const seen = {};
    let topics = {};

    function collect(list, source) {
      if (!list.length) return;
      summary.sources.push(source);
      list.forEach(function (l) {
        const lid = l && (l.taskId || l.id);
        if (isBlank(lid)) { summary.failed++; return; }
        const key = String(lid);
        if (seen[key]) return;
        seen[key] = true;
        found.push({ key: key, legacy: l });
      });
    }

    try {
      const rawStr = localStorage.getItem(LEGACY_PLANNER_KEY);
      if (rawStr) {
        if (!localStorage.getItem(LEGACY_BACKUP_KEY)) localStorage.setItem(LEGACY_BACKUP_KEY, rawStr);
        collect(extractLegacyList(JSON.parse(rawStr)), LEGACY_PLANNER_KEY);
      }
    } catch (e) { summary.failed++; }

    try {
      if (typeof State !== 'undefined' && State && typeof State.get === 'function') {
        const st = State.get() || {};
        topics = st.topics || {};
        collect(extractLegacyList(st.tasks), 'State.tasks');
      }
    } catch (e) { summary.failed++; }

    const next = draft(s);
    const ts = Date.now();
    found.forEach(function (f) {
      if (next.migratedLegacyIds[f.key]) { summary.skipped++; return; }
      const raw = mapLegacyTask(f.legacy, f.key, topics, ts);
      if (indexOfId(next, raw.id) !== -1) {
        next.migratedLegacyIds[f.key] = raw.id;
        summary.skipped++;
        return;
      }
      const n = normalize(raw);
      if (!n.ok) { summary.failed++; return; }
      finalize(n.task, ts);
      next.tasks.push(n.task);
      next.migratedLegacyIds[f.key] = n.task.id;
      summary.migrated++;
    });

    if (summary.migrated) {
      if (!persist(next)) {
        summary.migrated = 0;
        summary.error = 'Could not save migrated tasks (storage unavailable or full).';
        return summary;
      }
      emit({ type: 'migrated', count: summary.migrated });
    }
    return summary;
  }

  // ---------- CRUD ----------

  function createTask(dto) {
    if (dto !== undefined && (dto === null || typeof dto !== 'object' || Array.isArray(dto))) {
      return fail('createTask expects an object.');
    }
    const s = ready();
    const ts = Date.now();
    const n = normalize(Object.assign({}, dto || {}, { id: uuid(), createdAt: ts, updatedAt: ts }));
    if (!n.ok) return n;
    finalize(n.task, ts);
    const next = draft(s);
    next.tasks.push(n.task);
    if (!persist(next)) return fail('Could not save tasks (storage unavailable or full).');
    emit({ type: 'created', id: n.task.id });
    return { ok: true, task: clone(n.task) };
  }

  function updateTask(id, updates) {
    const s = ready();
    const idx = indexOfId(s, id);
    if (idx === -1) return fail('Task not found: ' + id);
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return fail('updateTask expects an object of changes.');

    const raw = Object.assign({}, s.tasks[idx]);
    Object.keys(updates).forEach(function (k) {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
      if (updates[k] === undefined) return;
      if (updates[k] === null) delete raw[k]; else raw[k] = updates[k];
    });
    const ts = Date.now();
    raw.updatedAt = ts;

    const n = normalize(raw);
    if (!n.ok) return n;
    finalize(n.task, ts);
    if ((updates.date !== undefined || updates.time !== undefined) && n.task.alarm && updates.alarm === undefined) {
      n.task.alarm.notified = false;
    }
    const next = draft(s);
    next.tasks[idx] = n.task;
    if (!persist(next)) return fail('Could not save tasks (storage unavailable or full).');
    emit({ type: 'updated', id: id });
    return { ok: true, task: clone(n.task) };
  }

  function deleteTask(id) {
    const s = ready();
    const idx = indexOfId(s, id);
    if (idx === -1) return fail('Task not found: ' + id);
    const next = draft(s);
    next.tasks.splice(idx, 1);
    if (!persist(next)) return fail('Could not save tasks (storage unavailable or full).');
    emit({ type: 'deleted', id: id });
    return { ok: true };
  }

  function toggleTaskComplete(id) {
    const s = ready();
    const idx = indexOfId(s, id);
    if (idx === -1) return fail('Task not found: ' + id);
    return updateTask(id, { status: s.tasks[idx].status === 'completed' ? 'pending' : 'completed' });
  }

  function getTask(id) {
    const s = ready();
    const idx = indexOfId(s, id);
    return idx === -1 ? null : clone(s.tasks[idx]);
  }

  // ---------- queries ----------
  // filter: { id, status, type, subjectId, topicId, targetId, subtaskId } (each a value or an array of values),
  //         { date } exact, { dateFrom, dateTo } inclusive range (undated tasks excluded),
  //         { scheduled: 'timed' | 'untimed' | 'undated' }, { search } (title, subjectId, topicId, checklist text).

  function matches(actual, wanted) {
    if (isBlank(wanted)) return true;
    return Array.isArray(wanted) ? wanted.indexOf(actual) !== -1 : actual === wanted;
  }

  function getTasks(filter) {
    const f = filter || {};
    const s = ready();
    const q = isBlank(f.search) ? '' : String(f.search).trim().toLowerCase();

    const list = s.tasks.filter(function (t) {
      if (!matches(t.id, f.id)) return false;
      if (!matches(t.status, f.status)) return false;
      if (!matches(t.type, f.type)) return false;
      for (let i = 0; i < ID_FIELDS.length; i++) {
        if (!matches(t[ID_FIELDS[i]], f[ID_FIELDS[i]])) return false;
      }
      if (!isBlank(f.date) && t.date !== f.date) return false;
      if (!isBlank(f.dateFrom) && (!t.date || t.date < f.dateFrom)) return false;
      if (!isBlank(f.dateTo) && (!t.date || t.date > f.dateTo)) return false;
      if (f.scheduled === 'timed' && !(t.date && t.time)) return false;
      if (f.scheduled === 'untimed' && !(t.date && !t.time)) return false;
      if (f.scheduled === 'undated' && t.date) return false;
      if (q) {
        const hay = [t.title, t.subjectId, t.topicId].concat((t.checklist || []).map(function (c) { return c.text; }));
        const hit = hay.some(function (h) { return h && String(h).toLowerCase().indexOf(q) !== -1; });
        if (!hit) return false;
      }
      return true;
    });

    // Default order: date, then time (dated first, untimed after timed), then creation order.
    list.sort(function (a, b) {
      if (a.date !== b.date) {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? -1 : 1;
      }
      if (a.time !== b.time) {
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time < b.time ? -1 : 1;
      }
      return a.createdAt - b.createdAt;
    });
    return clone(list);
  }

  // ---------- lifecycle ----------

  function init() {
    load();
    migrationRan = true;
    const summary = migrateLegacyPlannerData();
    try {
      if (localStorage.getItem(STORAGE_KEY) === null) persist(draft(load()));
    } catch (e) {}
    return summary;
  }

  // Console/testing only: wipes the canonical key and legacy backup, forgets in-memory state.
  function _debugReset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_BACKUP_KEY);
    } catch (e) {}
    cache = null;
    migrationRan = false;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    STATUSES: STATUSES.slice(),
    TYPES: TYPES.slice(),
    init: init,
    createTask: createTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    toggleTaskComplete: toggleTaskComplete,
    getTask: getTask,
    getTasks: getTasks,
    migrateLegacyPlannerData: migrateLegacyPlannerData,
    subscribe: subscribe,
    _debugReset: _debugReset
  };
})();

// PlanData: subjects, topics and the task store the Library/Calendar/Assistant views read (ported from the retired planner-data.js).
const PlanData = (function () {
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
    // Back-compat alias for any caller still reading PlanData.SUBJECTS: now the live active list.
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
    slotLabel: slotLabel,
    todayStr: todayStr

  };
})();

// ============================================================================
// SECTION 3 - PLANNING AGENT CORE (Planning Architecture, Phase 7)
// Absorbed from the retired planning-agent-data.js and planning-agent.js. This file is now
// self-contained: PlanningAgentData (pure perception / revision spacing / plan generator) and
// PlanningAgent (action engine with provenance) live here, ahead of every consumer below.
// Dropped as dead code (Itinerary was retired in Phase 4; CatchUpUI replaces it):
// computeCatchUpPlan, requestCatchUp, snapshot.itineraryToday.
// ============================================================================
const PlanningAgentData = (function () {
  // Default study availability window (08:00 - 22:00)
  const DEFAULT_DAY_START = '08:00';
  const DEFAULT_DAY_END = '22:00';
  const DEFAULT_SLOT_DURATION_MIN = 45;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

  function todayStr() {
    if (typeof ItineraryTime !== 'undefined' && typeof ItineraryTime.todayStr === 'function') {
      return ItineraryTime.todayStr();
    }
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function shiftDateStr(dateStr, delta) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function timeStrToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function minutesToTimeStr(mins) {
    if (mins === null || mins === undefined || isNaN(mins)) return '';
    let m = Math.floor(mins);
    if (m < 0) m = 0;
    if (m >= 1440) m = 1439;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return pad(h) + ':' + pad(rem);
  }

  // Check if [startA, endA) overlaps [startB, endB) in minutes
  function overlaps(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
  }

  // True if [startTime, stopTime) overlaps any other scheduled task on the same date.
  function hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId) {
    if (typeof PlanData !== 'undefined' && typeof PlanData.hasSlotConflict === 'function') {
      return PlanData.hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId);
    }
    const sMin = timeStrToMinutes(startTime);
    const eMin = timeStrToMinutes(stopTime);
    if (sMin === null || eMin === null || sMin >= eMin) return false;

    const allTasks = (State.get().tasks || {});
    return Object.keys(allTasks).some(function (id) {
      if (id === excludeTaskId) return false;
      const t = allTasks[id];
      if (t.date !== dateStr || t.completed || t.archived) return false;
      if (!t.startTime || !t.stopTime) return false;
      const tS = timeStrToMinutes(t.startTime);
      const tE = timeStrToMinutes(t.stopTime);
      if (tS === null || tE === null || tS >= tE) return false;
      return overlaps(sMin, eMin, tS, tE);
    });
  }

  // Get placed occupied time intervals (in minutes) for a date from scheduled tasks & alarms
  function getOccupiedIntervalsForDate(dateStr, excludeTaskId) {
    const intervals = [];
    const allTasks = (State.get().tasks || {});

    Object.keys(allTasks).forEach(function (id) {
      if (id === excludeTaskId) return;
      const t = allTasks[id];
      if (t.date !== dateStr || t.completed || t.archived) return;
      if (!t.startTime || !t.stopTime) return;
      const sMin = timeStrToMinutes(t.startTime);
      const eMin = timeStrToMinutes(t.stopTime);
      if (sMin !== null && eMin !== null && sMin < eMin) {
        intervals.push({ start: sMin, end: eMin, label: t.topicName || t.title || 'Task', refId: t.taskId });
      }
    });

    // Also factor in active global breaks or sessions for today if available
    if (dateStr === todayStr() && typeof TimeEngine !== 'undefined') {
      const gb = TimeEngine.getGlobalBreak ? TimeEngine.getGlobalBreak() : null;
      if (gb && gb.active && gb.startedAt && gb.durationMs) {
        const startMin = timeStrToMinutes(minutesToTimeStr(Math.floor((new Date(gb.startedAt)).getHours() * 60 + (new Date(gb.startedAt)).getMinutes())));
        const durMin = Math.ceil(gb.durationMs / 60000);
        if (startMin !== null) {
          intervals.push({ start: startMin, end: startMin + durMin, label: 'Global Break', refId: 'break' });
        }
      }
    }

    intervals.sort(function (a, b) { return a.start - b.start; });
    return intervals;
  }

  // Find the earliest free slot of durationMin on dateStr at or after earliestTimeStr
  function findNextFreeSlot(dateStr, durationMin, earliestTimeStr, excludeTaskId, windowEndStr) {
    const dur = Math.max(15, parseInt(durationMin, 10) || DEFAULT_SLOT_DURATION_MIN);
    const earliestMin = Math.max(
      timeStrToMinutes(DEFAULT_DAY_START),
      earliestTimeStr ? (timeStrToMinutes(earliestTimeStr) || 0) : timeStrToMinutes(DEFAULT_DAY_START)
    );
    const limitMin = windowEndStr ? (timeStrToMinutes(windowEndStr) || timeStrToMinutes(DEFAULT_DAY_END)) : timeStrToMinutes(DEFAULT_DAY_END);

    const placed = getOccupiedIntervalsForDate(dateStr, excludeTaskId);
    let candidate = earliestMin;
    let guard = 0;

    while (guard < 150) {
      guard++;
      if (candidate + dur > limitMin) return null;
      let blocker = null;
      for (let i = 0; i < placed.length; i++) {
        if (overlaps(candidate, candidate + dur, placed[i].start, placed[i].end)) {
          blocker = placed[i];
          break;
        }
      }
      if (!blocker) {
        return {
          start: minutesToTimeStr(candidate),
          end: minutesToTimeStr(candidate + dur),
          startMin: candidate,
          endMin: candidate + dur,
          durationMin: dur
        };
      }
      candidate = blocker.end;
    }
    return null;
  }

  // Find all free slots available on dateStr
  function findFreeSlotsForDate(dateStr, slotDurationMin, windowStartStr, windowEndStr, excludeTaskId) {
    const dur = Math.max(15, parseInt(slotDurationMin, 10) || DEFAULT_SLOT_DURATION_MIN);
    const startMin = windowStartStr ? (timeStrToMinutes(windowStartStr) || timeStrToMinutes(DEFAULT_DAY_START)) : timeStrToMinutes(DEFAULT_DAY_START);
    const endMin = windowEndStr ? (timeStrToMinutes(windowEndStr) || timeStrToMinutes(DEFAULT_DAY_END)) : timeStrToMinutes(DEFAULT_DAY_END);
    const slots = [];
    let cur = startMin;

    while (cur + dur <= endMin) {
      const slot = findNextFreeSlot(dateStr, dur, minutesToTimeStr(cur), excludeTaskId, minutesToTimeStr(endMin));
      if (!slot) break;
      slots.push(slot);
      cur = slot.endMin + 15; // 15 min buffer between suggested sessions
    }
    return slots;
  }

  // ---------- Snapshot / Perception Layer ----------
  // Reads the complete current system state without modifying or duplicating anything.
  function getSnapshot(dateRange) {
    const today = todayStr();
    const tasks = (typeof PlanData !== 'undefined' && typeof PlanData.getAllTasks === 'function')
      ? PlanData.getAllTasks()
      : (State.get().tasks || {});
    const tasksList = Object.keys(tasks).map(function (k) { return tasks[k]; });

    const activeTasksToday = tasksList.filter(function (t) {
      return t.date === today && !t.completed && !t.archived;
    });

    const pendingTasks = tasksList.filter(function (t) {
      return t.date && t.date < today && !t.completed && !t.archived;
    });

    const dueRevisionsToday = tasksList.filter(function (t) {
      return t.date === today && t.taskType === 'revision' && !t.completed && !t.archived;
    });

    const rawTargets = (typeof TargetsData !== 'undefined' && typeof TargetsData.getAllTargets === 'function')
      ? TargetsData.getAllTargets()
      : (typeof TargetsData !== 'undefined' && typeof TargetsData.getAllTargetsList === 'function'
          ? TargetsData.getAllTargetsList()
          : (State.get().targets || {}));
    const targetsList = Array.isArray(rawTargets) ? rawTargets : Object.keys(rawTargets).map(function (k) { return rawTargets[k]; });
    const activeTargets = targetsList.filter(function (t) {
      return !t.completed && !t.archived;
    });

    const todaySessions = (typeof TimeEngine !== 'undefined' && typeof TimeEngine.getRecordsForDate === 'function')
      ? TimeEngine.getRecordsForDate(today)
      : [];

    return {
      today: today,
      activeTasksToday: activeTasksToday,
      pendingTasks: pendingTasks,
      dueRevisionsToday: dueRevisionsToday,
      activeTargets: activeTargets,
      todaySessions: todaySessions,
      totalTasksCount: tasksList.length
    };
  }

  // ---------- Revision Policy ----------
  const REVISION_OFFSETS = [1, 3, 5, 8, 15, 30];
  const REVISION_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

  function getRevisionOffsets() {
    return REVISION_OFFSETS.slice();
  }

  function getRevisionLabels() {
    return REVISION_LABELS.slice();
  }

  function computeRevisionDates(baseDateStr) {
    let cursor = baseDateStr;
    const dates = [];
    REVISION_OFFSETS.forEach(function (offset) {
      cursor = shiftDateStr(cursor, offset);
      dates.push(cursor);
    });
    return dates;
  }

  // ---------- Historical Memory & Adaptive Analytics ----------

  // Read historical planning outcomes from sessionRecords and planningHistory
  function getHistoricalData() {
    const s = State.get();
    const sessionRecords = s.sessionRecords || {};
    const planningHistory = s.planningHistory || {};
    const dailySummaries = s.dailySummaries || {};

    return {
      sessionRecords: sessionRecords,
      planningHistory: planningHistory,
      dailySummaries: dailySummaries
    };
  }

  // Adaptive Duration Multiplier (Phase 8):
  // Formula: median of (actual / planned) blended toward 1.0 by n / (n + 5).
  // Requires at least 5 completed sessions; clamped to 0.7 - 1.5.
  function getDurationMultiplier(taskType) {
    const hist = getHistoricalData();
    const records = Object.keys(hist.sessionRecords).map(function (k) { return hist.sessionRecords[k]; });
    const tasks = State.get().tasks || {};

    const ratios = [];
    records.forEach(function (rec) {
      if (!rec || rec.state !== 'completed' || !rec.studyMs || !rec.plannedStart || !rec.plannedEnd) return;
      const task = rec.taskId ? tasks[rec.taskId] : null;
      if (taskType && task && task.taskType !== taskType) return;

      const pS = timeStrToMinutes(rec.plannedStart);
      const pE = timeStrToMinutes(rec.plannedEnd);
      if (pS === null || pE === null || pE <= pS) return;
      const plannedMin = pE - pS;
      const actualMin = Math.round(rec.studyMs / 60000);
      if (plannedMin >= 10 && actualMin >= 5) {
        ratios.push(actualMin / plannedMin);
      }
    });

    const sampleSize = ratios.length;
    if (sampleSize < 5) {
      return { multiplier: 1.0, sampleSize: sampleSize, learned: false, reason: 'insufficient samples (< 5)' };
    }

    ratios.sort(function (a, b) { return a - b; });
    const mid = Math.floor(sampleSize / 2);
    const median = sampleSize % 2 !== 0 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;

    // Blend median toward 1.0 based on sample confidence: n / (n + 5)
    const blendWeight = sampleSize / (sampleSize + 5);
    const blended = 1.0 * (1 - blendWeight) + median * blendWeight;
    const clamped = Math.max(0.7, Math.min(1.5, Math.round(blended * 100) / 100));

    return {
      multiplier: clamped,
      sampleSize: sampleSize,
      learned: true,
      reason: 'Adjusted ' + clamped + 'x based on ' + sampleSize + ' completed ' + (taskType || 'study') + ' sessions'
    };
  }

  // Rolling daily study capacity in minutes (Phase 8)
  function getDailyCapacityMinutes() {
    const s = State.get();
    const recs = s.sessionRecords || {};
    const sums = s.dailySummaries || {};
    const dayTotals = {};

    Object.keys(recs).forEach(function (k) {
      const r = recs[k];
      if (r && r.date && r.studyMs && r.state === 'completed') {
        dayTotals[r.date] = (dayTotals[r.date] || 0) + Math.round(r.studyMs / 60000);
      }
    });

    Object.keys(sums).forEach(function (d) {
      const sm = sums[d];
      if (sm && sm.studyMs && !dayTotals[d]) {
        dayTotals[d] = Math.round(sm.studyMs / 60000);
      }
    });

    const activeDays = Object.keys(dayTotals).map(function (d) { return dayTotals[d]; }).filter(function (m) { return m >= 15; });
    if (activeDays.length < 5) {
      return { capacityMin: 180, learned: false, reason: 'Standard baseline (3h)' };
    }

    activeDays.sort(function (a, b) { return a - b; });
    const mid = Math.floor(activeDays.length / 2);
    const median = activeDays.length % 2 !== 0 ? activeDays[mid] : Math.round((activeDays[mid - 1] + activeDays[mid]) / 2);

    return {
      capacityMin: Math.max(60, Math.min(480, median)),
      learned: true,
      sampleDays: activeDays.length,
      reason: 'Rolling median capacity ' + median + 'm over ' + activeDays.length + ' active days'
    };
  }

  // Preferred time of day window (Phase 8): morning (08-12), afternoon (12-17), evening (17-22)
  function getPreferredTimeWindows() {
    const recs = (State.get().sessionRecords || {});
    const buckets = {
      morning: { name: 'Morning (08:00–12:00)', start: '08:00', end: '12:00', completed: 0, total: 0 },
      afternoon: { name: 'Afternoon (12:00–17:00)', start: '12:00', end: '17:00', completed: 0, total: 0 },
      evening: { name: 'Evening (17:00–22:00)', start: '17:00', end: '22:00', completed: 0, total: 0 }
    };

    Object.keys(recs).forEach(function (k) {
      const r = recs[k];
      if (!r || !r.plannedStart) return;
      const m = timeStrToMinutes(r.plannedStart);
      if (m === null) return;
      let bKey = 'evening';
      if (m >= 480 && m < 720) bKey = 'morning';
      else if (m >= 720 && m < 1020) bKey = 'afternoon';
      buckets[bKey].total++;
      if (r.state === 'completed') buckets[bKey].completed++;
    });

    const totalSamples = buckets.morning.total + buckets.afternoon.total + buckets.evening.total;
    if (totalSamples < 8) {
      return { preferred: 'morning', learned: false, buckets: buckets };
    }

    let bestKey = 'morning';
    let bestRate = -1;
    ['morning', 'afternoon', 'evening'].forEach(function (k) {
      const rate = buckets[k].total > 0 ? (buckets[k].completed / buckets[k].total) : 0;
      if (rate > bestRate) {
        bestRate = rate;
        bestKey = k;
      }
    });

    return {
      preferred: bestKey,
      learned: true,
      buckets: buckets,
      bestWindow: buckets[bestKey]
    };
  }

  // Check postponement risk (task rescheduled 2 or more times)
  function isPostponementRisk(task) {
    return !!(task && (task.rescheduleCount || 0) >= 2);
  }

  // ---------- Proposal Generation Engine (Phase 4, 5, 8) ----------

  // Proposes schedules for revisions due on dateStr and carried-over pending tasks
  function proposeScheduleForDate(dateStr, options) {
    const opts = options || {};
    const proposals = [];
    const targetDate = dateStr || todayStr();
    const isToday = (targetDate === todayStr());
    const nowMin = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : timeStrToMinutes(DEFAULT_DAY_START);
    const earliestTimeStr = isToday ? minutesToTimeStr(Math.max(nowMin, timeStrToMinutes(DEFAULT_DAY_START))) : DEFAULT_DAY_START;

    const allTasks = State.get().tasks || {};
    const tasksList = Object.keys(allTasks).map(function (k) { return allTasks[k]; });

    // 1. Revision tasks due on targetDate that have no slot
    const dueRevisions = tasksList.filter(function (t) {
      return t.date === targetDate && t.taskType === 'revision' && !t.completed && !t.archived && (!t.startTime || !t.stopTime);
    });

    // 2. Pending incomplete tasks from earlier dates
    const pendingTasks = tasksList.filter(function (t) {
      return t.date && t.date < targetDate && !t.completed && !t.archived;
    });

    // 3. Unslotted tasks already scheduled on targetDate
    const unslottedToday = tasksList.filter(function (t) {
      return t.date === targetDate && t.taskType !== 'revision' && !t.completed && !t.archived && (!t.startTime || !t.stopTime);
    });

    // Determine task duration with adaptive multiplier
    function estimateDuration(task) {
      const base = task.taskType === 'questions' ? 60 : (task.taskType === 'revision' ? 45 : 50);
      const multObj = getDurationMultiplier(task.taskType);
      return Math.round(base * multObj.multiplier);
    }

    let cursorTimeStr = earliestTimeStr;

    // Process due revisions first (Priority: due work before carry-over)
    dueRevisions.forEach(function (t) {
      const dur = estimateDuration(t);
      const slot = findNextFreeSlot(targetDate, dur, cursorTimeStr);
      if (slot) {
        proposals.push({
          proposalId: 'prop_rev_' + t.taskId,
          kind: 'slot-revision',
          taskId: t.taskId,
          subject: t.subject,
          topicName: t.topicName,
          title: 'Revision ' + (t.revisionNumber || 'R') + ' \u00b7 ' + (t.topicName || ''),
          date: targetDate,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: dur,
          reason: 'Revision ' + (t.revisionNumber || '') + ' due today',
          confidence: 0.95
        });
        cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
      }
    });

    // Next: unslotted tasks already on targetDate
    unslottedToday.forEach(function (t) {
      const dur = estimateDuration(t);
      const slot = findNextFreeSlot(targetDate, dur, cursorTimeStr);
      if (slot) {
        proposals.push({
          proposalId: 'prop_unslot_' + t.taskId,
          kind: 'slot-task',
          taskId: t.taskId,
          subject: t.subject,
          topicName: t.topicName,
          title: t.topicName || t.title || 'Study Session',
          date: targetDate,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: dur,
          reason: 'Scheduled for ' + targetDate + ' (unslotted)',
          confidence: 0.9
        });
        cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
      }
    });

    // Next: carry forward pending tasks (most overdue first, or highest postponement risk given earlier slot)
    pendingTasks.sort(function (a, b) {
      const aRisk = isPostponementRisk(a) ? 1 : 0;
      const bRisk = isPostponementRisk(b) ? 1 : 0;
      if (aRisk !== bRisk) return bRisk - aRisk; // High postponement risk gets planned first
      return (a.date || '').localeCompare(b.date || '');
    });

    // Cap pending carry-over to avoid overloading a single day
    const cap = opts.maxPending || 4;
    pendingTasks.slice(0, cap).forEach(function (t) {
      let dur = estimateDuration(t);
      if (isPostponementRisk(t)) {
        dur = Math.min(dur, 35); // Bite-sized session for repeatedly postponed tasks
      }
      const slot = findNextFreeSlot(targetDate, dur, cursorTimeStr);
      if (slot) {
        proposals.push({
          proposalId: 'prop_pend_' + t.taskId,
          kind: 'carry-pending',
          taskId: t.taskId,
          subject: t.subject,
          topicName: t.topicName,
          title: (t.topicName || t.title || 'Task') + ' (Overdue)',
          date: targetDate,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: dur,
          reason: isPostponementRisk(t)
            ? 'Carried over (' + t.rescheduleCount + 'x rescheduled \u2014 bite-sized focus)'
            : 'Carried over from ' + t.date,
          confidence: 0.85
        });
        cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
      }
    });

    return proposals;
  }

  // Proposes task allocations for an active Target (Phase 5)
  function proposeTargetAllocation(targetId, targetDate) {
    if (typeof TargetsData === 'undefined') return [];
    const target = TargetsData.getTarget(targetId);
    if (!target || target.completed || target.archived) return [];

    const dateStr = targetDate || target.dateKey || todayStr();
    const proposals = [];
    const subtargets = TargetsData.getSubtargetsForTarget(targetId);

    // If target has subtargets that are incomplete
    if (subtargets && subtargets.length > 0) {
      const incompleteSubs = subtargets.filter(function (s) { return !s.completed; });
      let cursorTimeStr = DEFAULT_DAY_START;

      incompleteSubs.slice(0, 2).forEach(function (sub) {
        const dur = 45;
        const slot = findNextFreeSlot(dateStr, dur, cursorTimeStr);
        if (slot) {
          proposals.push({
            proposalId: 'prop_tgt_sub_' + sub.subtargetId,
            kind: 'target-subtarget',
            targetId: targetId,
            subtargetId: sub.subtargetId,
            title: target.title + ' \u2014 ' + sub.title,
            date: dateStr,
            proposedStart: slot.start,
            proposedEnd: slot.end,
            durationMin: dur,
            reason: 'Goal: ' + target.title,
            confidence: 0.9
          });
          cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
        }
      });
    } else {
      // Single target without subtargets: propose study session
      const slot = findNextFreeSlot(dateStr, 60, DEFAULT_DAY_START);
      if (slot) {
        proposals.push({
          proposalId: 'prop_tgt_' + target.targetId,
          kind: 'target-task',
          targetId: targetId,
          title: target.title,
          date: dateStr,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: 60,
          reason: 'Goal: ' + target.title,
          confidence: 0.85
        });
      }
    }
    return proposals;
  }

  return {
    timeStrToMinutes: timeStrToMinutes,
    minutesToTimeStr: minutesToTimeStr,
    overlaps: overlaps,
    hasSlotConflict: hasSlotConflict,
    getOccupiedIntervalsForDate: getOccupiedIntervalsForDate,
    findNextFreeSlot: findNextFreeSlot,
    findFreeSlotsForDate: findFreeSlotsForDate,
    getSnapshot: getSnapshot,
    getRevisionOffsets: getRevisionOffsets,
    getRevisionLabels: getRevisionLabels,
    computeRevisionDates: computeRevisionDates,
    getDurationMultiplier: getDurationMultiplier,
    getDailyCapacityMinutes: getDailyCapacityMinutes,
    getPreferredTimeWindows: getPreferredTimeWindows,
    isPostponementRisk: isPostponementRisk,
    proposeScheduleForDate: proposeScheduleForDate,
    proposeTargetAllocation: proposeTargetAllocation,
    todayStr: todayStr,
    shiftDateStr: shiftDateStr
  };
})();

const PlanningAgent = (function () {
  function todayStr() {
    return PlanningAgentData.todayStr();
  }

  // ---------- Provenance & Validation Primitives ----------

  function validateSlot(startTime, stopTime) {
    if (typeof PlanData !== 'undefined' && typeof PlanData.isValidSlot === 'function') {
      return PlanData.isValidSlot(startTime, stopTime);
    }
    if (!startTime && !stopTime) return true;
    if (!startTime || !stopTime) return false;
    return stopTime > startTime;
  }

  // PlanData only knows legacy-mapped tasks. Timed tasks that live only in the canonical store (Task Manager,
  // routines) are checked here as well, so the same overlap rule covers every task. Nothing is ever moved.
  function validateConflict(dateStr, startTime, stopTime, excludeTaskId) {
    if (PlanningAgentData.hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId)) return true;
    if (!dateStr || !startTime || !stopTime) return false;
    const mins = function (hm) { return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)); };
    const s = mins(startTime), e = mins(stopTime);
    return CanonicalTaskStore.getTasks({ date: dateStr, scheduled: 'timed', status: 'pending' }).some(function (o) {
      if (o.id.indexOf('legacy_') === 0 || o.id === excludeTaskId) return false;   // legacy-mapped tasks are covered above
      const os = mins(o.time);
      return s < os + (o.duration || 30) && os < e;
    });
  }

  // ---------- Canonical Task Operations ----------

  // Create a single or custom task with stamped provenance
  function createTask(input, origin) {
    const isAgent = (origin === 'agent');
    const orig = isAgent ? 'agent' : 'user';
    const dateStr = input.date || todayStr();
    const startTime = input.startTime || null;
    const stopTime = input.stopTime || null;

    if (!validateSlot(startTime, stopTime)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(dateStr, startTime, stopTime, null)) {
      return { ok: false, error: 'That time slot overlaps an existing task on this date.' };
    }

    let task = null;
    if (input.taskType === 'custom' || !input.subject) {
      const title = (input.title || input.topicName || 'Task').trim();
      task = PlanData.createCustomTask(title, dateStr, input.note || '', startTime, stopTime);
    } else {
      const subject = input.subject;
      const topicName = input.topicName || '';
      const taskType = input.taskType || 'theory';
      task = PlanData.createSingleTask(subject, topicName, taskType, dateStr, input.note || '', startTime, stopTime);
    }

    if (!task) return { ok: false, error: 'Could not create task.' };

    // Stamp provenance on the canonical task
    const provenance = {
      origin: orig,
      rescheduleCount: 0,
      planReason: input.planReason || (isAgent ? 'agent-created' : ''),
      targetId: input.targetId || null,
      subtargetId: input.subtargetId || null,
      agentSlot: isAgent ? { date: dateStr, startTime: startTime, stopTime: stopTime } : null
    };

    PlanData.updateTask(task.taskId, provenance);
    return { ok: true, task: PlanData.getTask(task.taskId) };
  }

  // Create repeated revision cycle with stamped provenance
  function createRevisionCycle(subject, topicName, baseDateStr, note, startTime, stopTime, origin) {
    const orig = (origin === 'agent') ? 'agent' : 'user';
    if (!validateSlot(startTime, stopTime)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(baseDateStr, startTime, stopTime, null)) {
      return { ok: false, error: 'That time slot overlaps an existing task on this date.' };
    }

    const baseTask = PlanData.createRevisionCycle(subject, topicName, baseDateStr, note, startTime, stopTime);
    if (!baseTask) return { ok: false, error: 'Could not create revision cycle.' };

    PlanData.updateTask(baseTask.taskId, {
      origin: orig,
      rescheduleCount: 0,
      planReason: 'base-revision-study',
      agentSlot: (orig === 'agent') ? { date: baseDateStr, startTime: startTime, stopTime: stopTime } : null
    });

    return { ok: true, baseTask: PlanData.getTask(baseTask.taskId) };
  }

  // Update existing task fields while maintaining canonical ownership
  function updateTask(taskId, patch, origin) {
    const existing = PlanData.getTask(taskId);
    if (!existing) return { ok: false, error: 'Task not found.' };

    const newDate = ('date' in patch) ? patch.date : existing.date;
    const newStart = ('startTime' in patch) ? patch.startTime : existing.startTime;
    const newStop = ('stopTime' in patch) ? patch.stopTime : existing.stopTime;

    if (!validateSlot(newStart, newStop)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(newDate, newStart, newStop, taskId)) {
      return { ok: false, error: 'That slot overlaps an existing task on ' + newDate + '.' };
    }

    const safePatch = Object.assign({}, patch);

    // If slot changed by user, mark origin as user
    const slotChanged = (newDate !== existing.date || newStart !== existing.startTime || newStop !== existing.stopTime);
    if (slotChanged) {
      if (origin === 'agent') {
        safePatch.origin = 'agent';
        safePatch.agentSlot = { date: newDate, startTime: newStart, stopTime: newStop };
      } else {
        safePatch.origin = 'user';
      }
    }

    const updated = PlanData.updateTask(taskId, safePatch);
    return { ok: true, task: updated };
  }

  // Reschedule a task (single authoritative path for moves)
  function rescheduleTask(taskId, newDateStr, newStartTime, newStopTime, origin, reason) {
    const existing = PlanData.getTask(taskId);
    if (!existing) return { ok: false, error: 'Task not found.' };

    const startTime = newStartTime || null;
    const stopTime = newStopTime || null;

    if (!validateSlot(startTime, stopTime)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(newDateStr, startTime, stopTime, taskId)) {
      return { ok: false, error: 'That slot overlaps another task on ' + newDateStr + '.' };
    }

    const today = todayStr();
    // If rescheduling a task on today's active schedule, route through TimeEngine.doItLater
    // so active/scheduled session records are cleanly kept in sync
    const hadSessionToday = (existing.date === today && typeof TimeEngine !== 'undefined');
    if (hadSessionToday) {
      const ok = TimeEngine.doItLater(taskId, newDateStr, startTime, stopTime);
      if (!ok) {
        return { ok: false, error: 'Could not reschedule task via Time Engine.' };
      }
    } else {
      PlanData.rescheduleTask(taskId, newDateStr, startTime, stopTime);
    }

    // Provenance stamp
    const isAgent = (origin === 'agent');
    const newRescheduleCount = (existing.rescheduleCount || 0) + 1;
    const provPatch = {
      rescheduleCount: newRescheduleCount,
      origin: isAgent ? 'agent' : 'user',
      planReason: reason || (isAgent ? 'agent-reschedule' : 'user-reschedule')
    };
    if (isAgent) {
      provPatch.agentSlot = { date: newDateStr, startTime: startTime, stopTime: stopTime };
    }
    PlanData.updateTask(taskId, provPatch);

    return { ok: true, task: PlanData.getTask(taskId) };
  }

  // Unschedule a task: clears start/stop time while KEEPING date (solves P2 / Q5).
  // The task remains active and visible on that date in unslotted/suggested pool.
  function unscheduleTask(taskId) {
    const existing = PlanData.getTask(taskId);
    if (!existing) return { ok: false, error: 'Task not found.' };

    // End active session in TimeEngine if currently active
    if (typeof TimeEngine !== 'undefined' && existing.date === todayStr()) {
      const active = TimeEngine.getActiveSession ? TimeEngine.getActiveSession() : null;
      if (active && active.taskId === taskId) {
        TimeEngine.skipActive(taskId);
      }
    }

    const updated = PlanData.updateTask(taskId, {
      startTime: null,
      stopTime: null,
      rescheduleCount: (existing.rescheduleCount || 0) + 1,
      planReason: 'unscheduled'
    });

    return { ok: true, task: updated };
  }

  // Delete task
  function deleteTask(taskId) {
    PlanData.deleteTask(taskId);
    return { ok: true };
  }

  // Completion hook: updates EXP, Target progress, and records session outcome
  function toggleComplete(taskId) {
    const taskBefore = PlanData.getTask(taskId);
    if (!taskBefore) return;

    PlanData.toggleComplete(taskId);
    const taskAfter = PlanData.getTask(taskId);

    // If task was linked to a Target, update target progress cleanly (Phase 5)
    if (taskAfter && taskAfter.completed && taskAfter.targetId && typeof TargetsData !== 'undefined') {
      const target = TargetsData.getTarget(taskAfter.targetId);
            if (target && !target.completed && !target.startDate) {
        if (taskAfter.subtargetId) {
          TargetsData.updateSubtarget(taskAfter.subtargetId, { completed: true });
        } else {
          const nextVal = (target.currentValue || 0) + 1;
          TargetsData.updateTarget(taskAfter.targetId, {
            currentValue: nextVal,
            completed: nextVal >= (target.targetValue || 1)
          });
        }
      }
    }

    // Record planning outcome for adaptive history (Phase 7)
    if (taskAfter && taskAfter.completed) {
      recordTaskOutcome(taskAfter);
    }
  }

  // Record outcome into State.planningHistory for long-term learning (Phase 7)
  function recordTaskOutcome(task) {
    const dStr = task.completedDate || todayStr();
    const st = State.get();
    const history = Object.assign({}, st.planningHistory || {});
    const dayEntry = Object.assign({
      date: dStr,
      completedCount: 0,
      rescheduledCount: 0,
      taskTypeStats: {}
    }, history[dStr] || {});

    dayEntry.completedCount++;
    const tType = task.taskType || 'theory';
    if (!dayEntry.taskTypeStats[tType]) {
      dayEntry.taskTypeStats[tType] = { count: 0 };
    }
    dayEntry.taskTypeStats[tType].count++;

    history[dStr] = dayEntry;
    State.set({ planningHistory: history });
  }

  // ---------- Decision Actions (Proposals, Catch-up, Target Allocation) ----------

  // Apply a proposal from PlanningAgentData
  function applyProposal(proposal) {
    if (!proposal || !proposal.taskId) return { ok: false, error: 'Invalid proposal' };
    return rescheduleTask(
      proposal.taskId,
      proposal.date || todayStr(),
      proposal.proposedStart,
      proposal.proposedEnd,
      'agent',
      proposal.reason || 'proposal-applied'
    );
  }

  // Propose day plan
  function proposeDayPlan(dateStr) {
    return PlanningAgentData.proposeScheduleForDate(dateStr || todayStr());
  }

  // Register single rollover subscriber with stable id
  if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.onRollover === 'function') {
    TimeEngine.onRollover(function (fromDateStr) {
      if (!fromDateStr || typeof PlanData === 'undefined') return;
      const tasks = PlanData.getTasksForDate(fromDateStr);
      const history = Object.assign({}, State.get().planningHistory || {});
      if (!history[fromDateStr]) {
        const completed = tasks.filter(function (t) { return t.completed; }).length;
        const total = tasks.length;
        history[fromDateStr] = {
          date: fromDateStr,
          completedCount: completed,
          missedCount: Math.max(0, total - completed),
          rescheduledCount: tasks.reduce(function (sum, t) { return sum + (t.rescheduleCount || 0); }, 0),
          taskTypeStats: {}
        };
        State.set({ planningHistory: history });
      }
    }, 'planning-agent');
  }

  return {
    createTask: createTask,
    createRevisionCycle: createRevisionCycle,
    updateTask: updateTask,
    rescheduleTask: rescheduleTask,
    unscheduleTask: unscheduleTask,
    deleteTask: deleteTask,
    toggleComplete: toggleComplete,
    applyProposal: applyProposal,
    proposeDayPlan: proposeDayPlan,
    openUI: function (opts) {
      if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open(opts);
    }
  };
})();

const PlanningAgentUI = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }

  function todayStr() { return PlanningAgentData.todayStr(); }

  function shiftDateStr(dateStr, delta) { return PlanningAgentData.shiftDateStr(dateStr, delta); }

  // Canonical target list. TargetsData.getAllTargets() returns the id->target map; getAllTargetsList() the array.
  function getTargetsList() {
    if (typeof TargetsData !== 'undefined') {
      if (typeof TargetsData.getAllTargetsList === 'function') return TargetsData.getAllTargetsList();
      if (typeof TargetsData.getAllTargets === 'function') {
        const m = TargetsData.getAllTargets() || {};
        return Array.isArray(m) ? m : Object.keys(m).map(function (k) { return m[k]; });
      }
    }
    return [];
  }

  // ---------- Deterministic Intent & Text Parser ----------

  function parseNaturalInput(raw) {
    if (!raw || typeof raw !== 'string') return {};
    const text = raw.trim().toLowerCase();
    const result = {};

    const today = todayStr();
    const tomorrow = shiftDateStr(today, 1);

    // 1. Detect date
    if (text.includes('tomorrow')) {
      result.date = tomorrow;
    } else if (text.includes('today')) {
      result.date = today;
    } else {
      const dateMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (dateMatch) result.date = dateMatch[0];
    }

    // 2. Detect intent keywords
    if (text.includes('catch up') || text.includes('catchup') || text.includes('behind') || text.includes('delay')) {
      result.intent = 'catchup';
      return result;
    }
    if (text.includes('pending') || text.includes('overdue') || text.includes('remaining') || text.includes('carry over') || text.includes('carryover')) {
      result.intent = 'pending';
    } else if (text.includes('goal') || text.includes('target')) {
      result.intent = 'target';
    } else if (text.includes('day') || text.includes('tomorrow') || text.includes('fit') || text.includes('schedule')) {
      result.intent = result.intent || 'day';
    }

    // 3. Match known subjects
    {
      const subjects = PlanData.getAllSubjects();
      for (let i = 0; i < subjects.length; i++) {
        const s = subjects[i];
        if (text.includes(s.toLowerCase())) {
          result.subject = s;
          break;
        }
      }

      // 4. Match known topics
      const allTopics = PlanData.getAllTopics();
      const topicKeys = Object.keys(allTopics);
      let bestTopic = null;
      let bestMatchLen = 0;

      topicKeys.forEach(function (tid) {
        const t = allTopics[tid];
        const tName = (t.topicName || '').toLowerCase();
        if (tName && text.includes(tName) && tName.length > bestMatchLen) {
          bestTopic = t;
          bestMatchLen = tName.length;
        }
      });

      if (bestTopic) {
        result.topicId = bestTopic.topicId;
        result.subject = bestTopic.subject;
        result.intent = 'topic';
      }
    }

    // 5. Match active targets
    if (typeof TargetsData !== 'undefined' && (!result.intent || result.intent === 'target')) {
      const targetList = getTargetsList();
      for (let i = 0; i < targetList.length; i++) {
        const tgt = targetList[i];
        if (!tgt.completed && !tgt.archived && text.includes((tgt.title || '').toLowerCase())) {
          result.targetId = tgt.targetId;
          result.intent = 'target';
          break;
        }
      }
    }

    // 6. Mode / Type detection for topic
    if (text.includes('cycle') || text.includes('spaced') || /\br1\b/.test(text)) {
      result.taskMode = 'revision-cycle';
    } else if (text.includes('theory')) {
      result.taskMode = 'theory';
    } else if (text.includes('question') || text.includes('qs')) {
      result.taskMode = 'questions';
    } else if (text.includes('revision') || text.includes('revise')) {
      result.taskMode = 'revision';
    }

    return result;
  }

  // ---------- Unified Plan creation ----------
  // One Plan = one TargetsData folder record (startDate/endDate) whose subtasks are ordinary tasks created through
  // PlanningAgent.createTask and linked by targetId. Subjects come from PlanData, tags from TagsData (shared stores).

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    let subUid = 0;
  let state = freshState({});
  let screen = 'dash';
  let dash = null;
  let toTop = false;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function freshState(o) {
    return { from: o.from || '', date: o.date || '', subject: o.subject || '', topicId: o.topicId || '', title: o.title || '', tags: [], subs: [],
      pop: '', popErr: '', cal: '', err: '', msg: '', done: null, editId: '' };
  }

    function blankSub(date) {
    return { uid: ++subUid, title: '', date: date || '', start: '', end: '', note: '', tags: [], subject: '', topicId: '', open: false, err: '', isNew: true };
  }

  function holderOf(who) {
    if (who === 'p') return state;
    for (let i = 0; i < state.subs.length; i++) if (String(state.subs[i].uid) === who) return state.subs[i];
    return null;
  }

  function isFilled(s) {
    return !!(s.title.trim() || s.date || s.start || s.end || s.note.trim() || s.tags.length || s.subject || s.topicId);
  }

  function dayLabel(s) {
    if (!s) return '';
    const t = todayStr();
    if (s === t) return 'Today';
    if (s === shiftDateStr(t, 1)) return 'Tomorrow';
    const d = new Date(s + 'T00:00:00');
    return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
  }

  function refreshViews() {
    PlanningAgentTasks.sync();
    TargetsData.syncFromTasks();
    if (typeof Library !== 'undefined' && Library.render) Library.render();
    if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel();
    if (typeof Calendar !== 'undefined' && Calendar.render) Calendar.render();
  }

  // ---------- Choosers ----------

  function newRow(act, key, placeholder, max) {
    return '<div class="pl-new"><input type="text" class="pl-input" data-new="' + key + '" maxlength="' + max + '" placeholder="' + placeholder + '" aria-label="' + placeholder + '" autocomplete="off">' +
      '<button type="button" class="pl-mini" data-pl="' + act + '" data-key="' + key + '">Add</button></div>' +
      (state.popErr ? '<p class="pl-err" role="alert">' + esc(state.popErr) + '</p>' : '');
  }

  // locked: the plan's Subject, inherited by its subtasks; shown but not selectable.
  function subjectChooser(who, holder, emptyLabel, locked) {
    if (locked) return '<div class="pl-chooser"><button type="button" class="pl-field pl-pick" disabled aria-disabled="true"><span>' + esc(locked) + '</span></button></div>';
    const key = 'subj:' + who, open = state.pop === key;
    let list = PlanData.getAllSubjects();
    if (holder.subject && list.indexOf(holder.subject) === -1) list = list.concat([holder.subject]);
    const pop = !open ? '' :
      '<div class="pl-pop" role="listbox" aria-label="Subject">' +
        [''].concat(list).map(function (s) {
          const on = s === holder.subject;
          return '<button type="button" role="option" aria-selected="' + on + '" class="pl-row' + (on ? ' is-on' : '') + '" data-pl="subj" data-key="' + key + '" data-val="' + esc(s) + '">' +
            '<span class="pl-row-text">' + esc(s || emptyLabel) + '</span></button>';
        }).join('') +
        newRow('subj-new', key, 'New subject', 40) +
      '</div>';
    return '<div class="pl-chooser"><button type="button" class="pl-field pl-pick" data-pl="pop" data-key="' + key + '" aria-haspopup="listbox" aria-expanded="' + open + '">' +
      '<span class="' + (holder.subject ? '' : 'is-empty') + '">' + esc(holder.subject || emptyLabel) + '</span><span class="pl-caret" aria-hidden="true"></span></button>' + pop + '</div>';
  }

  // Topic is plan-level and always a live Library topic of the chosen Subject (PlanData is the one source).
  function topicLabel(id) {
    const t = id ? PlanData.getAllTopics()[id] : null;
    return t ? t.topicName : '';
  }

  // Drops a Topic that was deleted or no longer belongs to the Subject (subject changed or cleared).
  function cleanTopic() {
    const topics = PlanData.getAllTopics();
    if (state.topicId) {
      const t = topics[state.topicId];
      if (!state.subject || !t || t.subject !== state.subject) state.topicId = '';
    }
    // Subtasks inherit the plan's Subject / Topic when it has one; otherwise their own pick must stay a valid pair.
    state.subs.forEach(function (s) {
      if (state.subject) s.subject = '';
      if (state.topicId) { s.topicId = ''; return; }
      const subj = state.subject || s.subject, t = s.topicId ? topics[s.topicId] : null;
      if (s.topicId && (!subj || !t || t.subject !== subj)) s.topicId = '';
    });
  }

  // who/holder: 'p'/state for the plan, or a subtask. lockedId: the plan's Topic, inherited by subtasks (not selectable).
  function topicChooser(who, holder, subject, lockedId) {
    if (lockedId) return '<div class="pl-chooser"><button type="button" class="pl-field pl-pick" disabled aria-disabled="true"><span>' + esc(topicLabel(lockedId)) + '</span></button></div>';
    const key = 'topic:' + who, has = !!subject, open = has && state.pop === key;
    const list = has ? (PlanData.getTopicsBySubject()[subject] || []) : [];
    const cur = topicLabel(holder.topicId);
    const pop = !open ? '' :
      '<div class="pl-pop" role="listbox" aria-label="Topic">' +
        [{ topicId: '', topicName: 'No topic' }].concat(list).map(function (t) {
          const on = t.topicId === holder.topicId;
          return '<button type="button" role="option" aria-selected="' + on + '" class="pl-row' + (on ? ' is-on' : '') + '" data-pl="topic" data-key="' + key + '" data-val="' + esc(t.topicId) + '"><span class="pl-row-text">' + esc(t.topicName) + '</span></button>';
        }).join('') +
        (list.length ? '' : '<p class="pl-empty">No topics in ' + esc(subject) + ' yet.</p>') +
      '</div>';
    const label = cur || (has ? 'No topic' : 'Choose a subject first');
    return '<div class="pl-chooser"><button type="button" class="pl-field pl-pick" data-pl="pop" data-key="' + key + '" aria-haspopup="listbox" aria-expanded="' + open + '"' + (has ? '' : ' disabled aria-disabled="true"') + '>' +
      '<span class="' + (cur ? '' : 'is-empty') + '">' + esc(label) + '</span><span class="pl-caret" aria-hidden="true"></span></button>' + pop + '</div>';
  }

  // Edit mode: re-stamps the plan's existing subtasks (legacy + canonical) so they follow the plan's Topic.
  function restampSubs(base) {
    const old = base.planTopicId || '', topics = PlanData.getAllTopics();
    planSubs(base.targetId).forEach(function (x) {
      const lt = x.key ? PlanData.getTask(x.key) : null;
      if (!lt) return;
      const subj0 = lt.subject || '', top0 = lt.topicId || '';
      const subj = state.subject || subj0;
      let top = state.topicId || top0;
      if (!state.topicId && top && top === old) top = '';                                        // the plan's Topic was removed
      if (top && (!topics[top] || (subj && topics[top].subject !== subj))) top = '';              // never leave an invalid pair
      if (subj === subj0 && top === top0) return;
      PlanData.updateTask(x.key, { subject: subj || null, topicId: top || null, topicName: top ? topics[top].topicName : null });
      CanonicalTaskStore.updateTask(x.id, { subjectId: subj || null, topicId: top || null });
    });
  }

  function tagsChooser(who, holder) {
    const key = 'tag:' + who, open = state.pop === key;
    const chips = holder.tags.map(function (id) {
      const t = TagsData.getTag(id);
      return t ? '<span class="pl-chip" style="--c:' + esc(t.color) + '">' + esc(t.name) + '</span>' : '';
    }).join('');
    const all = TagsData.getAllTagsList();
    const pop = !open ? '' :
      '<div class="pl-pop" role="group" aria-label="Tags">' +
        (all.length ? all.map(function (t) {
          const on = holder.tags.indexOf(t.tagId) !== -1;
          return '<button type="button" role="checkbox" aria-checked="' + on + '" class="pl-row' + (on ? ' is-on' : '') + '" data-pl="tag" data-key="' + key + '" data-val="' + esc(t.tagId) + '">' +
            '<span class="pl-box" aria-hidden="true"></span><span class="pl-dot" style="background:' + esc(t.color) + '"></span><span class="pl-row-text">' + esc(t.name) + '</span></button>';
        }).join('') : '<p class="pl-empty">No tags yet.</p>') +
        newRow('tag-new', key, 'New tag', 30) +
      '</div>';
    return '<div class="pl-chooser"><div class="pl-chips">' + chips +
      '<button type="button" class="pl-chip pl-chip-add" data-pl="pop" data-key="' + key + '" aria-expanded="' + open + '">+ Tag</button></div>' + pop + '</div>';
  }

  // ---------- Date and time pickers (custom, no browser-default controls) ----------

  function calHtml(sub) {
    const p = state.cal.split('-'), y = Number(p[0]), m = Number(p[1]) - 1;
    const lead = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), today = todayStr();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const v = y + '-' + pad(m + 1) + '-' + pad(d), on = v === sub.date;
      cells += '<button type="button" class="pl-day' + (on ? ' is-on' : '') + (v === today ? ' is-today' : '') + '" data-pl="cal-pick" data-val="' + v + '" aria-pressed="' + on + '" aria-label="' + MONTHS[m] + ' ' + d + '">' + d + '</button>';
    }
    return '<div class="pl-pop pl-cal" role="dialog" aria-label="Choose a date">' +
      '<div class="pl-cal-head"><button type="button" class="pl-nav" data-pl="cal-nav" data-dir="-1" aria-label="Previous month">\u2039</button>' +
        '<span class="pl-cal-title">' + MONTHS[m] + ' ' + y + '</span>' +
        '<button type="button" class="pl-nav" data-pl="cal-nav" data-dir="1" aria-label="Next month">\u203A</button></div>' +
      '<div class="pl-cal-week" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>' +
      '<div class="pl-cal-grid">' + cells + '</div>' +
      '<div class="pl-pop-foot"><button type="button" class="pl-link" data-pl="cal-clear">Clear</button><button type="button" class="pl-link" data-pl="cal-today">Today</button></div>' +
    '</div>';
  }

  // ---------- Analog 12-hour time picker ----------
  // Edits a private 12-hour draft (clk); the stored "HH:mm" 24-hour string is written only on Confirm.

  let clk = null;

  function fmt12(t) {
    if (!/^\d{2}:\d{2}$/.test(t || '')) return '';
    const h = Number(t.slice(0, 2));
    return ((h % 12) || 12) + ':' + t.slice(3) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function to24(c) { return pad((c.h % 12) + (c.ap === 'PM' ? 12 : 0)) + ':' + pad(c.m); }

  function clkAim(c) {
    const to = c.step === 'h' ? (c.h % 12) * 30 : c.m * 6;
    return c.ang + ((((to - c.ang) % 360) + 540) % 360) - 180;
  }

  function clkInit(sub, field) {
    const cur = sub[field];
    let h24 = 9, m = 0;
    if (/^\d{2}:\d{2}$/.test(cur || '')) { h24 = Number(cur.slice(0, 2)); m = Number(cur.slice(3, 5)); }
    else if (field === 'end' && /^\d{2}:\d{2}$/.test(sub.start || '') && Number(sub.start.slice(0, 2)) < 23) {
      h24 = Number(sub.start.slice(0, 2)) + 1; m = Number(sub.start.slice(3, 5));
    }
    clk = { key: state.pop, field: field, h: h24 % 12 || 12, m: m, ap: h24 >= 12 ? 'PM' : 'AM', step: 'h', ang: 0, drag: false };
    clk.ang = clkAim(clk);
  }

  function timePopHtml(sub, field) {
    if (!clk || clk.key !== state.pop) clkInit(sub, field);
    const c = clk, hr = c.step === 'h';
    let ticks = '', hn = '', mn = '';
    for (let i = 0; i < 60; i++) ticks += '<i class="pl-clk-tick' + (i % 5 ? '' : ' is-maj') + '" style="--r:' + (i * 6) + 'deg"></i>';
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, at = 'left:' + (50 + 37 * Math.sin(a)).toFixed(2) + '%;top:' + (50 - 37 * Math.cos(a)).toFixed(2) + '%';
      const hv = i || 12, mv = i * 5;
      hn += '<span class="pl-clk-num' + (hv === c.h ? ' is-on' : '') + '" data-n="' + hv + '" style="' + at + '">' + hv + '</span>';
      mn += '<span class="pl-clk-num' + (mv === c.m ? ' is-on' : '') + '" data-n="' + mv + '" style="' + at + '">' + pad(mv) + '</span>';
    }
    const apBtn = function (v) {
      return '<button type="button" class="pl-clk-apb' + (c.ap === v ? ' is-on' : '') + '" data-pl="clk-ap" data-val="' + v + '" aria-pressed="' + (c.ap === v) + '">' + v + '</button>';
    };
    const stepBtn = function (v, n, label) {
      return '<button type="button" class="pl-clk-step' + (c.step === v ? ' is-on' : '') + '" data-pl="clk-step" data-val="' + v + '"' + (c.step === v ? ' aria-current="step"' : '') + '><b>' + n + '</b>' + label + '</button>';
    };
    return '<div class="pl-pop pl-time pl-clk" role="dialog" aria-label="Choose a time" data-field="' + field + '">' +
      '<div class="pl-clk-head">' +
        '<div class="pl-clk-read"><span class="pl-clk-hv' + (hr ? ' is-on' : '') + '">' + c.h + '</span><span class="pl-clk-colon">:</span><span class="pl-clk-mv' + (hr ? '' : ' is-on') + '">' + pad(c.m) + '</span></div>' +
        '<div class="pl-clk-ap" role="group" aria-label="AM or PM">' + apBtn('AM') + apBtn('PM') + '</div>' +
      '</div>' +
      '<div class="pl-clk-steps">' + stepBtn('h', 1, 'Hour') + '<span class="pl-clk-sep" aria-hidden="true"></span>' + stepBtn('m', 2, 'Minute') + '</div>' +
      '<div class="pl-clk-face" data-step="' + c.step + '" role="slider" tabindex="0" aria-label="' + (hr ? 'Hour' : 'Minute') + '" aria-valuemin="' + (hr ? 1 : 0) + '" aria-valuemax="' + (hr ? 12 : 59) + '" aria-valuenow="' + (hr ? c.h : c.m) + '" aria-valuetext="' + (hr ? c.h + ' ' + c.ap : c.m + ' minutes') + '">' +
        ticks +
        '<div class="pl-clk-hand" style="--a:' + c.ang + 'deg"><span class="pl-clk-bob' + (!hr && c.m % 5 ? ' is-off5' : '') + '"></span></div>' +
        '<div class="pl-clk-layer pl-clk-layer-h" aria-hidden="true">' + hn + '</div>' +
        '<div class="pl-clk-layer pl-clk-layer-m" aria-hidden="true">' + mn + '</div>' +
        '<span class="pl-clk-pivot" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="pl-clk-foot">' +
        '<button type="button" class="pl-link" data-pl="clk-clear">Clear</button>' +
        '<button type="button" class="pl-link" data-pl="clk-cancel">Cancel</button>' +
        '<button type="button" class="pl-clk-ok" data-pl="clk-ok">Confirm</button>' +
      '</div>' +
    '</div>';
  }

  function clkPaint() {
    const pop = document.querySelector('.pl .pl-clk');
    if (!pop || !clk) return;
    const c = clk, hr = c.step === 'h', face = pop.querySelector('.pl-clk-face');
    face.dataset.step = c.step;
    face.setAttribute('aria-label', hr ? 'Hour' : 'Minute');
    face.setAttribute('aria-valuemin', hr ? 1 : 0);
    face.setAttribute('aria-valuemax', hr ? 12 : 59);
    face.setAttribute('aria-valuenow', hr ? c.h : c.m);
    face.setAttribute('aria-valuetext', hr ? c.h + ' ' + c.ap : c.m + ' minutes');
    pop.querySelector('.pl-clk-hand').style.setProperty('--a', c.ang + 'deg');
    pop.querySelector('.pl-clk-bob').classList.toggle('is-off5', !hr && c.m % 5 !== 0);
    const hv = pop.querySelector('.pl-clk-hv'), mv = pop.querySelector('.pl-clk-mv');
    hv.textContent = c.h; mv.textContent = pad(c.m);
    hv.classList.toggle('is-on', hr); mv.classList.toggle('is-on', !hr);
    pop.querySelectorAll('.pl-clk-step').forEach(function (b) {
      const on = b.dataset.val === c.step;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    pop.querySelectorAll('.pl-clk-apb').forEach(function (b) {
      const on = b.dataset.val === c.ap;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on);
    });
    pop.querySelectorAll('.pl-clk-layer-h .pl-clk-num').forEach(function (n) { n.classList.toggle('is-on', Number(n.dataset.n) === c.h); });
    pop.querySelectorAll('.pl-clk-layer-m .pl-clk-num').forEach(function (n) { n.classList.toggle('is-on', Number(n.dataset.n) === c.m); });
  }

  function clkSet(v) {
    if (clk.step === 'h') clk.h = v; else clk.m = v;
    clk.ang = clkAim(clk);
    clkPaint();
  }

  function clkStep(step) {
    if (!clk || clk.step === step) return;
    clk.step = step;
    clk.ang = clkAim(clk);
    clkPaint();
  }

  function clkClose(mode) {
    const key = state.pop, at = key.indexOf(':');
    const sub = at > 0 ? holderOf(key.slice(at + 1)) : null, field = key.slice(0, at);
    if (sub && clk) {
      if (mode === 'ok') { sub[field] = to24(clk); sub.err = ''; }
      else if (mode === 'clear') { sub[field] = ''; sub.err = ''; }
    }
    clk = null;
    state.pop = '';
    render(false, '[data-key="' + key + '"]');
  }

  function clkKey(e) {
    if (!clk || e.ctrlKey || e.metaKey || e.altKey || !e.target.closest || !e.target.closest('.pl-clk-face')) return false;
    const k = e.key, hr = clk.step === 'h';
    let d = 0, v = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') d = 1;
    else if (k === 'ArrowLeft' || k === 'ArrowDown') d = -1;
    else if (k === 'PageUp') d = hr ? 3 : 5;
    else if (k === 'PageDown') d = hr ? -3 : -5;
    else if (k === 'Home') v = hr ? 1 : 0;
    else if (k === 'End') v = hr ? 12 : 59;
    else if (k === 'a' || k === 'A') { clk.ap = 'AM'; clkPaint(); }
    else if (k === 'p' || k === 'P') { clk.ap = 'PM'; clkPaint(); }
    else if (k === 'Enter' || k === ' ') { if (hr) clkStep('m'); else clkClose('ok'); }
    else return false;
    e.preventDefault();
    if (d) v = hr ? ((((clk.h - 1 + d) % 12) + 12) % 12) + 1 : (((clk.m + d) % 60) + 60) % 60;
    if (v !== null) clkSet(v);
    return true;
  }

  function onPointer(e) {
    const face = e.target.closest ? e.target.closest('.pl-clk-face') : null;
    if (!face || !clk) return;
    const c = clk;
    if (e.type === 'pointerdown') {
      if (e.button) return;
      c.drag = true;
      face.classList.add('is-drag');
      try { face.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      face.focus({ preventScroll: true });
      e.preventDefault();
    } else if (!c.drag) return;
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      c.drag = false;
      face.classList.remove('is-drag');
      if (e.type === 'pointerup' && c.step === 'h') setTimeout(function () { if (clk === c && c.step === 'h') clkStep('m'); }, 240);
      return;
    }
    const r = face.getBoundingClientRect();
    let deg = Math.atan2(e.clientX - (r.left + r.width / 2), (r.top + r.height / 2) - e.clientY) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    clkSet(c.step === 'h' ? (Math.round(deg / 30) % 12) || 12 : Math.round(deg / 6) % 60);
  }

  function fieldBtn(key, label, value, empty) {
    const open = state.pop === key;
    return '<div class="pl-cell"><span class="pl-label">' + label + '</span>' +
      '<button type="button" class="pl-field" data-pl="pop" data-key="' + key + '" aria-expanded="' + open + '" aria-label="' + label + ': ' + esc(value || empty) + '">' +
      '<span class="' + (value ? '' : 'is-empty') + '">' + esc(value || empty) + '</span></button></div>';
  }

  // ---------- Subtasks ----------

  function summaryHtml(s) {
    const bits = [];
    if (s.date) bits.push(dayLabel(s.date));
    if (s.start && s.end) bits.push(fmt12(s.start) + '\u2013' + fmt12(s.end));
    if (s.note.trim()) bits.push('Note');
    if (s.tags.length) bits.push(s.tags.length + (s.tags.length === 1 ? ' tag' : ' tags'));
    if (s.subject) bits.push(s.subject);
    if (s.topicId) bits.push(topicLabel(s.topicId));
    return bits.length ? '<div class="pl-sum">' + bits.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('') + '</div>' : '';
  }

  function detailsHtml(s) {
    const u = String(s.uid);
    let pop = '';
    if (state.pop === 'date:' + u) pop = calHtml(s);
    else if (state.pop === 'start:' + u) pop = timePopHtml(s, 'start');
    else if (state.pop === 'end:' + u) pop = timePopHtml(s, 'end');
    return '<div class="pl-details">' +
      '<div class="pl-grid">' +
        fieldBtn('date:' + u, 'Date', s.date ? dayLabel(s.date) : '', 'Add date') +
        fieldBtn('start:' + u, 'Start', fmt12(s.start), '--:-- --') +
        fieldBtn('end:' + u, 'End', fmt12(s.end), '--:-- --') +
      '</div>' + pop +
      '<label class="pl-label" for="pl-note-' + u + '">Note</label>' +
      '<textarea id="pl-note-' + u + '" class="pl-input" rows="2" maxlength="300" data-f="s-note" data-u="' + u + '" placeholder="Anything to remember">' + esc(s.note) + '</textarea>' +
      '<span class="pl-label">Tags</span>' + tagsChooser(u, s) +
      '<span class="pl-label">Subject</span>' + subjectChooser(u, s, 'No subject', state.subject) +
      '<span class="pl-label">Topic</span>' + topicChooser(u, s, state.subject || s.subject, state.topicId) +
    '</div>';
  }

    function subHtml(s, i) {
    const u = String(s.uid);
    const fresh = s.isNew;
    s.isNew = false;
    return '<div class="pl-sub' + (s.open ? ' is-open' : '') + (fresh ? ' is-new' : '') + '">' +
      '<div class="pl-sub-row"><span class="pl-num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<input type="text" class="pl-input" id="pl-st-' + u + '" data-f="s-title" data-u="' + u + '" maxlength="120" placeholder="Subtask title" aria-label="Subtask ' + (i + 1) + ' title" value="' + esc(s.title) + '">' +
        '<button type="button" class="pl-more" data-pl="toggle" data-u="' + u + '" aria-expanded="' + s.open + '" aria-label="' + (s.open ? 'Hide' : 'Show') + ' details for subtask ' + (i + 1) + '"><span class="pl-caret" aria-hidden="true"></span></button></div>' +
      (s.open ? detailsHtml(s) : summaryHtml(s)) +
      (s.err ? '<p class="pl-err" role="alert">' + esc(s.err) + '</p>' : '') +
    '</div>';
  }

  // ---------- Dashboard (the viewer) ----------
  // Reads go through PlanningAgentTasks / CanonicalTaskStore / TargetsData. Writes reuse the Agent's existing paths:
  // PlanningAgentTasks.toggleTask, PlanningAgent.deleteTask, TaskManagerUI (task edit) and the composer (plan edit).

  const DASH_VIEWS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Week'], ['month', 'Month'], ['pick', 'Pick a date'], ['timeline', 'History']];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function ico(paths) {
    return '<svg class="pl-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>';
  }

  const ICONS = {
    plus: ico('<path d="M12 5v14M5 12h14"/>'),
    edit: ico('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    trash: ico('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>'),
    close: ico('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: ico('<path d="M15 5l-7 7 7 7"/>'),
    chevron: ico('<path d="M6 9l6 6 6-6"/>')
  };

  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function isDash(v) { return DASH_VIEWS.some(function (d) { return d[0] === v; }); }

  function freshDash(o) {
    const d = isDateStr(o.date) ? o.date : todayStr();
    return { from: o.from || '', view: isDash(o.view) ? o.view : 'today', anchor: d, date: d, cal: d.slice(0, 7), tray: '', open: {}, confirm: '', limit: 14, subject: o.subject || '', pulse: '' };
  }

  function toMin(hm) { return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)); }
  function addMin(hm, min) { const m = toMin(hm) + min; return m >= 1440 ? '' : pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  function info(t) {
    const key = String(t.id).indexOf('legacy_') === 0 ? String(t.id).slice(7) : '';
    const lt = key ? PlanData.getTask(key) : null;
    return {
      id: t.id, key: key, targetId: t.targetId || '', date: t.date || '', start: t.time || '', done: t.status === 'completed',
      title: (lt && lt.title) || t.title || (lt && lt.topicName) || 'Task',
      stop: (t.time && t.duration) ? addMin(t.time, t.duration) : '',
      subject: (lt && lt.subject) || t.subjectId || '',
      note: (lt && lt.note) || '',
      tags: lt ? TagsData.getTagIdsForTask({ topicId: lt.topicId || '', tagIds: lt.tagIds }) : []
    };
  }

  function toggleKey(id) {
    const key = String(id).indexOf('legacy_') === 0 ? String(id).slice(7) : '';
    return key && PlanData.getTask(key) ? key : id;
  }

  function isOverdue(t) { return !t.done && !!t.date && t.date < todayStr(); }

  function keepTask(t) {
    return !t.archived && !t.completed && t.type !== 'break' && (!dash.subject || info(t).subject === dash.subject);
  }

  function dashTasks(from, to) { return PlanningAgentTasks.getTasksForDateRange(from, to).filter(keepTask); }

  function planOf(t) {
    const tg = t.targetId ? TargetsData.getTarget(t.targetId) : null;
    return tg && tg.isPlan ? tg : null;
  }

  function planSubs(targetId) {
    PlanningAgentTasks.sync();
    return CanonicalTaskStore.getTasks({ targetId: targetId, status: ['pending', 'completed'] }).map(info);
  }

  function itemsFor(tasks) {
    const seen = {}, out = [];
    tasks.forEach(function (t) {
      const tg = planOf(t), sort = (t.date || '~') + (t.time || '~');
      if (!tg) { out.push({ kind: 'task', task: info(t), sort: sort }); return; }
      if (seen[tg.targetId]) { if (sort < seen[tg.targetId].sort) seen[tg.targetId].sort = sort; return; }
      seen[tg.targetId] = { kind: 'plan', target: tg, sort: sort };
      out.push(seen[tg.targetId]);
    });
    return out.sort(function (a, b) { return a.sort < b.sort ? -1 : (a.sort > b.sort ? 1 : 0); });
  }

  function emptyPlans() {
    PlanningAgentTasks.sync();
    return TargetsData.getAllTargetsList().filter(function (p) {
      return p.isPlan && !p.archived && (!dash.subject || p.subject === dash.subject) &&
        !CanonicalTaskStore.getTasks({ targetId: p.targetId, status: ['pending', 'completed'] }).length;
    });
  }

  function overdueTasks() { return PlanningAgentTasks.getPendingTasks().filter(keepTask); }

  function unscheduledItems() {
    const items = itemsFor(PlanningAgentTasks.getOpenTasks().filter(function (t) { return !t.date && keepTask(t); }));
    return items.concat(emptyPlans().map(function (p) { return { kind: 'plan', target: p, sort: '~~' }; }));
  }

  function mdLabel(s) {
    const d = new Date(s + 'T00:00:00');
    return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
  }

  function dayName(s) {
    const t = todayStr(), d = new Date(s + 'T00:00:00');
    const base = DOW[d.getDay()] + ', ' + mdLabel(s);
    if (s === t) return 'Today \u00b7 ' + base;
    if (s === shiftDateStr(t, 1)) return 'Tomorrow \u00b7 ' + base;
    if (s === shiftDateStr(t, -1)) return 'Yesterday \u00b7 ' + base;
    return base;
  }

  function whenText(t, hideDate) {
    const bits = [];
    if (!t.date) bits.push('Unscheduled');
    else if (!hideDate) bits.push(dayLabel(t.date));
    if (t.start) bits.push(fmt12(t.start) + (t.stop ? '\u2013' + fmt12(t.stop) : ''));
    if (!bits.length) bits.push('Anytime');
    return bits.join(' \u00b7 ');
  }

  function chipsHtml(subject, tagIds) {
    const c = (subject ? '<span class="pl-chip pl-chip-subj">' + esc(subject) + '</span>' : '') +
      (tagIds || []).map(function (id) {
        const t = TagsData.getTag(id);
        return t ? '<span class="pl-chip" style="--c:' + esc(t.color) + '">' + esc(t.name) + '</span>' : '';
      }).join('');
    return c ? '<div class="pl-chips">' + c + '</div>' : '';
  }

  function checkHtml(t) {
    return '<button type="button" class="pl-check' + (t.done ? ' is-on' : '') + (dash.pulse === t.id ? ' is-pulse' : '') + '" role="checkbox" aria-checked="' + t.done +
      '" data-pl="d-toggle" data-id="' + esc(t.id) + '" aria-label="' + esc(t.title) + '"><span aria-hidden="true"></span></button>';
  }

  function actsHtml(kind, id, title) {
    return '<span class="pl-acts">' +
      '<button type="button" class="pl-ib" data-pl="' + (kind === 'plan' ? 'd-edit-plan' : 'd-edit') + '" data-id="' + esc(id) + '" aria-label="Edit ' + esc(title) + '" title="Edit">' + ICONS.edit + '</button>' +
      '<button type="button" class="pl-ib pl-ib-del" data-pl="d-del" data-kind="' + kind + '" data-id="' + esc(id) + '" aria-label="Delete ' + esc(title) + '" title="Delete">' + ICONS.trash + '</button>' +
    '</span>';
  }

  function confirmHtml(kind, id) {
    const yes = function (mode, label) {
      return '<button type="button" class="pl-cbtn is-danger" data-pl="d-del-yes" data-kind="' + kind + '" data-id="' + esc(id) + '"' + (mode ? ' data-mode="' + mode + '"' : '') + '>' + label + '</button>';
    };
    return '<div class="pl-confirm" role="group" aria-label="Confirm delete"><span>' + (kind === 'plan' ? 'Delete this plan?' : 'Delete this task?') + '</span>' +
      '<span class="pl-confirm-acts">' +
        (kind === 'plan'
          ? yes('all', 'Delete with subtasks') + '<button type="button" class="pl-cbtn" data-pl="d-del-yes" data-kind="plan" data-mode="keep" data-id="' + esc(id) + '">Keep subtasks</button>'
          : yes('', 'Delete')) +
        '<button type="button" class="pl-cbtn" data-pl="d-del-no">Cancel</button>' +
      '</span></div>';
  }

  function taskDetailHtml(t) {
    const when = t.date
      ? dayName(t.date) + (t.start ? ' \u00b7 ' + fmt12(t.start) + (t.stop ? '\u2013' + fmt12(t.stop) : '') : '')
      : 'Not scheduled';
    return '<p class="pl-when">' + esc(when) + '</p>' + chipsHtml(t.subject, t.tags) + (t.note.trim() ? '<p class="pl-note">' + esc(t.note) + '</p>' : '');
  }

  function taskItemHtml(t, gk, hideDate) {
    const k = 't:' + t.id + ':' + gk, open = !!dash.open[k];
    return '<li class="pl-item pl-task ' + (t.done ? 'is-done' : 'is-todo') + (open ? ' is-expanded' : '') + '">' +
      '<div class="pl-item-row">' + checkHtml(t) +
        '<button type="button" class="pl-item-main" data-pl="d-open" data-k="' + esc(k) + '" aria-expanded="' + open + '">' +
          '<span class="pl-item-text">' +
            '<span class="pl-item-title">' + esc(t.title) + '</span>' +
            '<span class="pl-item-meta">' + esc(whenText(t, hideDate)) + (isOverdue(t) ? ' <span class="pl-badge is-over">Overdue</span>' : '') + '</span>' +
          '</span>' +
          '<span class="pl-chev" aria-hidden="true">' + ICONS.chevron + '</span>' +
        '</button>' + actsHtml('task', t.id, t.title) +
      '</div>' +
      (dash.confirm === 'task:' + t.id ? confirmHtml('task', t.id) : '') +
      (open ? '<div class="pl-details' + (dash.pulse === k ? ' is-fresh' : '') + '">' + taskDetailHtml(t) + '</div>' : '') +
    '</li>';
  }

  function subLineHtml(t) {
    return '<li class="pl-subi ' + (t.done ? 'is-done' : 'is-todo') + '">' +
      '<div class="pl-item-row">' + checkHtml(t) +
        '<div class="pl-item-main pl-static"><div class="pl-item-text">' +
          '<span class="pl-item-title">' + esc(t.title) + '</span>' +
          '<span class="pl-item-meta">' + esc(whenText(t, false)) + (isOverdue(t) ? ' <span class="pl-badge is-over">Overdue</span>' : '') + '</span>' +
          (t.note.trim() ? '<span class="pl-note">' + esc(t.note) + '</span>' : '') + chipsHtml(t.subject, t.tags) +
        '</div></div>' +
        actsHtml('task', t.id, t.title) +
      '</div>' + (dash.confirm === 'task:' + t.id ? confirmHtml('task', t.id) : '') + '</li>';
  }

  function planItemHtml(tg, gk) {
    const subs = planSubs(tg.targetId), total = subs.length, done = subs.filter(function (s) { return s.done; }).length;
    const pending = subs.filter(function (s) { return !s.done; });
    const st = total && done === total ? 'done' : (done ? 'part' : 'open');
    const k = 'p:' + tg.targetId + ':' + gk, open = !!dash.open[k];
    const status = st === 'done' ? 'All done'
      : (st === 'part' ? 'In progress \u00b7 ' + done + ' of ' + total
        : (total ? 'Not started \u00b7 ' + total + (total === 1 ? ' subtask' : ' subtasks') : 'No subtasks yet'));
    return '<li class="pl-item pl-plan is-' + st + (open ? ' is-expanded' : '') + '">' +
      '<div class="pl-item-row">' + planCheckHtml(tg.targetId, st, tg.title || 'Plan') +
        '<button type="button" class="pl-item-main" data-pl="d-open" data-k="' + esc(k) + '" aria-expanded="' + open + '">' +
          '<span class="pl-item-text">' +
            '<span class="pl-item-title">' + esc(tg.title || 'Plan') + countHtml(done, total) + '</span>' +
            '<span class="pl-item-meta">' + esc(status) + '</span>' +
            (total ? '<span class="pl-prog" aria-hidden="true"><i style="width:' + Math.round(done / total * 100) + '%"></i></span>' : '') +
          '</span>' +
          '<span class="pl-chev" aria-hidden="true">' + ICONS.chevron + '</span>' +
        '</button>' + actsHtml('plan', tg.targetId, tg.title || 'plan') +
      '</div>' +
      (dash.confirm === 'plan:' + tg.targetId ? confirmHtml('plan', tg.targetId) : '') +
      (open ? '<div class="pl-details' + (dash.pulse === k ? ' is-fresh' : '') + '">' + chipsHtml(tg.subject, tg.tagIds) +
        (pending.length ? '<ul class="pl-subl">' + pending.map(subLineHtml).join('') + '</ul>' : '<p class="pl-empty">' + (total ? 'All subtasks are done.' : 'No subtasks yet.') + '</p>') +
        '<button type="button" class="pl-add" data-pl="d-add-sub" data-id="' + esc(tg.targetId) + '">' + ICONS.plus + '<span>Add subtask</span></button>' +
      '</div>' : '') +
    '</li>';
  }

  // Tiny secondary completion count, e.g. 2/5.
  function countHtml(done, total) {
    return total ? '<span class="pl-count" title="' + done + ' of ' + total + ' done" aria-label="' + done + ' of ' + total + ' done">' + done + '/' + total + '</span>' : '';
  }

  // st: 'done' | 'part' | 'open'
  function planCheckHtml(targetId, st, title) {
    return '<button type="button" class="pl-check' + (st === 'done' ? ' is-on' : '') + '" role="checkbox" aria-checked="' + (st === 'done' ? 'true' : (st === 'part' ? 'mixed' : 'false')) +
      '" data-pl="d-plan-toggle" data-id="' + esc(targetId) + '" aria-label="' + esc(title) + '"><span aria-hidden="true"></span></button>';
  }

  // Main-task completion: completes every subtask, or (when all are already done) restores every subtask.
  // Task ids, plan link and dates are untouched; only completion flips, via the Agent's one completion path.
  function togglePlan(targetId) {
    const subs = planSubs(targetId);
    if (!subs.length) { TargetsData.toggleTargetComplete(targetId); return; }   // no subtasks: the plan itself carries completion
    const complete = !subs.every(function (s) { return s.done; });
    subs.forEach(function (s) { if (s.done !== complete) PlanningAgentTasks.toggleTask(toggleKey(s.id)); });
  }

  function localDate(ms) {
    const x = new Date(ms);
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }

  function histEntryHtml(e) {
    if (e.kind === 'task') {
      const t = e.task;
      return '<li class="pl-item pl-task is-done"><div class="pl-item-row">' + checkHtml(t) +
        '<div class="pl-item-main pl-static"><span class="pl-item-text"><span class="pl-item-title">' + esc(t.title) + '</span>' +
          (e.parent ? '<span class="pl-ctx">' + esc(e.parent) + '</span>' : '') + '</span></div>' +
        actsHtml('task', t.id, t.title) + '</div>' +
        (dash.confirm === 'task:' + t.id ? confirmHtml('task', t.id) : '') + '</li>';
    }
    const k = 'h:' + e.targetId, open = !!dash.open[k];
    return '<li class="pl-item pl-plan is-done' + (open ? ' is-expanded' : '') + '"><div class="pl-item-row">' + planCheckHtml(e.targetId, 'done', e.title) +
      (e.subs.length
        ? '<button type="button" class="pl-item-main" data-pl="d-open" data-k="' + esc(k) + '" aria-expanded="' + open + '"><span class="pl-item-text">' +
          '<span class="pl-item-title">' + esc(e.title) + countHtml(e.subs.length, e.subs.length) + '</span></span>' +
          '<span class="pl-chev" aria-hidden="true">' + ICONS.chevron + '</span></button>'
        : '<div class="pl-item-main pl-static"><span class="pl-item-text"><span class="pl-item-title">' + esc(e.title) + '</span></span></div>') +
      actsHtml('plan', e.targetId, e.title) + '</div>' +
      (dash.confirm === 'plan:' + e.targetId ? confirmHtml('plan', e.targetId) : '') +
      (open ? '<div class="pl-details"><ul class="pl-subl">' + e.subs.map(function (s) {
        return '<li class="pl-subi is-done"><div class="pl-item-row">' + checkHtml(s) +
          '<div class="pl-item-main pl-static"><span class="pl-item-text"><span class="pl-item-title">' + esc(s.title) + '</span></span></div></div></li>';
      }).join('') + '</ul></div>' : '') + '</li>';
  }

  function historyHtml() {
    const list = PlanningAgentTasks.getHistory({ subject: dash.subject }), map = {}, days = [];
    list.forEach(function (e) {
      const d = e.at ? localDate(e.at) : '';
      if (!map[d]) { map[d] = []; days.push(d); }
      map[d].push(e);
    });
    if (!days.length) return '<div class="pl-timeline">' + blankHtml('Completed tasks will appear here.') + '</div>';
    return '<div class="pl-timeline"><div class="pl-groups">' + days.slice(0, dash.limit).map(function (d) {
      return '<section class="pl-group"><h4 class="pl-group-h">' + (d ? esc(dayName(d)) : 'Earlier') + '</h4><ul class="pl-list pl-hist">' + map[d].map(histEntryHtml).join('') + '</ul></section>';
    }).join('') + '</div>' +
      (days.length > dash.limit ? '<button type="button" class="pl-add" data-pl="d-more">Show earlier days</button>' : '') + '</div>';
  }

  function itemsHtml(items, gk, hideDate) {
    return '<ul class="pl-list">' + items.map(function (it) {
      return it.kind === 'plan' ? planItemHtml(it.target, gk) : taskItemHtml(it.task, gk, hideDate);
    }).join('') + '</ul>';
  }

  function blankHtml(msg, withNew) {
    return '<div class="pl-blank"><p>' + esc(msg) + '</p>' +
      (withNew ? '<button type="button" class="btn btn-primary pl-new-btn" data-pl="d-new">' + ICONS.plus + '<span>New plan</span></button>' : '') + '</div>';
  }

  function dayHtml(d) {
    const items = itemsFor(dashTasks(d, d));
    return '<p class="pl-date">' + esc(dayName(d)) + '</p>' +
      (items.length ? itemsHtml(items, d, true) : blankHtml(d === todayStr() ? 'Nothing planned for today.' : 'Nothing planned for this day.', true));
  }

  function groupsHtml(tasks, dates, emptyMsg) {
    if (!dates.length) return blankHtml(emptyMsg);
    const map = {}, today = todayStr();
    tasks.forEach(function (t) { (map[t.date] = map[t.date] || []).push(t); });
    return '<div class="pl-groups">' + dates.map(function (d) {
      const items = itemsFor(map[d] || []);
      return '<section class="pl-group"><h4 class="pl-group-h' + (d === today ? ' is-today' : '') + '">' + esc(dayName(d)) + '</h4>' +
        (items.length ? itemsHtml(items, d, true) : '<p class="pl-empty">Nothing planned.</p>') + '</section>';
    }).join('') + '</div>';
  }

  function navBar(label, resetLabel) {
    return '<div class="pl-navbar"><button type="button" class="pl-nav" data-pl="d-nav" data-dir="-1" aria-label="Previous">\u2039</button>' +
      '<span class="pl-nav-label" aria-live="polite">' + esc(label) + '</span>' +
      '<button type="button" class="pl-nav" data-pl="d-nav" data-dir="1" aria-label="Next">\u203A</button>' +
      '<button type="button" class="pl-link" data-pl="d-nav" data-dir="0">' + resetLabel + '</button></div>';
  }

  function dashCalHtml() {
    const p = dash.cal.split('-'), y = Number(p[0]), m = Number(p[1]) - 1, today = todayStr();
    const lead = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), has = {};
    dashTasks(y + '-' + pad(m + 1) + '-01', y + '-' + pad(m + 1) + '-' + pad(days)).forEach(function (t) { has[t.date] = true; });
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const v = y + '-' + pad(m + 1) + '-' + pad(d), on = v === dash.date;
      cells += '<button type="button" class="pl-day' + (on ? ' is-on' : '') + (v === today ? ' is-today' : '') + (has[v] ? ' has-dot' : '') +
        '" data-pl="d-day" data-val="' + v + '" aria-pressed="' + on + '" aria-label="' + MONTHS[m] + ' ' + d + (has[v] ? ', has plans' : '') + '">' + d + '</button>';
    }
    return '<div class="pl-minical">' + navBar(MONTHS[m] + ' ' + y, 'Today') +
      '<div class="pl-cal-week" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>' +
      '<div class="pl-cal-grid">' + cells + '</div></div>';
  }

  function dashBodyHtml(od, un) {
    const v = dash.view, t = todayStr();
    if (dash.tray === 'overdue') {
      const items = itemsFor(od);
      return '<p class="pl-date">Overdue</p>' + (items.length ? itemsHtml(items, 'tray', false) : blankHtml('Nothing overdue.'));
    }
    if (dash.tray === 'unscheduled') {
      return '<p class="pl-date">Unscheduled</p>' + (un.length ? itemsHtml(un, 'tray', false) : blankHtml('Nothing is waiting for a date.'));
    }
    if (v === 'today') return dayHtml(t);
    if (v === 'tomorrow') return dayHtml(shiftDateStr(t, 1));
    if (v === 'pick') return dashCalHtml() + dayHtml(dash.date);
    if (v === 'week') {
      const from = shiftDateStr(dash.anchor, -new Date(dash.anchor + 'T00:00:00').getDay()), dates = [];
      for (let i = 0; i < 7; i++) dates.push(shiftDateStr(from, i));
      return navBar(mdLabel(dates[0]) + ' \u2013 ' + mdLabel(dates[6]), 'This week') + groupsHtml(dashTasks(dates[0], dates[6]), dates, '');
    }
    if (v === 'month') {
      const p = dash.anchor.split('-'), y = Number(p[0]), m = Number(p[1]) - 1, seen = {};
      const tasks = dashTasks(y + '-' + pad(m + 1) + '-01', y + '-' + pad(m + 1) + '-' + pad(new Date(y, m + 1, 0).getDate()));
      tasks.forEach(function (x) { seen[x.date] = true; });
      return navBar(MONTHS[m] + ' ' + y, 'This month') + groupsHtml(tasks, Object.keys(seen).sort(), 'Nothing planned this month.');
    }
    return historyHtml();
  }

  function dashHtml() {
    const od = overdueTasks(), un = unscheduledItems();
    const tabs = DASH_VIEWS.map(function (d) {
      const on = !dash.tray && dash.view === d[0];
      return '<button type="button" role="tab" class="pl-tab' + (on ? ' is-on' : '') + '" data-pl="d-view" data-val="' + d[0] + '" aria-selected="' + on + '" tabindex="' + (dash.view === d[0] ? 0 : -1) + '">' + d[1] + '</button>';
    }).join('');
    const tray = function (id, label, n) {
      const on = dash.tray === id;
      return '<button type="button" class="pl-tray' + (on ? ' is-on' : '') + (n ? ' has-n' : '') + '" data-pl="d-tray" data-val="' + id + '" aria-pressed="' + on + '"><span>' + label + '</span><b>' + n + '</b></button>';
    };
    return '<div class="plan-agent pl pl-dash">' +
      '<header class="pl-head"><h3 class="plan-agent-title">Plans</h3><span class="pl-head-acts">' +
        (dash.from === 'assistant' ? '<button type="button" class="pl-hbtn" data-pl="back">' + ICONS.back + '<span>Back</span></button>' : '') +
        '<button type="button" class="btn btn-primary pl-new-btn" data-pl="d-new">' + ICONS.plus + '<span>New plan</span></button>' +
        '<button type="button" class="pl-ib pl-close" data-pl="close" aria-label="Close" title="Close">' + ICONS.close + '</button></span></header>' +
      '<div class="pl-side">' +
        '<div class="pl-tabs" role="tablist" aria-label="Plan views">' + tabs + '</div>' +
        '<div class="pl-trays">' + tray('overdue', 'Overdue', od.length) + tray('unscheduled', 'Unscheduled', un.length) +
          (dash.subject ? '<button type="button" class="pl-chip pl-chip-subj pl-filter" data-pl="d-clear-subject" aria-label="Clear subject filter">' + esc(dash.subject) + ' \u00d7</button>' : '') + '</div>' +
      '</div>' +
      '<section class="pl-body" role="tabpanel">' + dashBodyHtml(od, un) + '</section>' +
    '</div>';
  }

  function dashView(v, focus) {
    dash.view = v; dash.tray = ''; dash.open = {}; dash.confirm = ''; dash.limit = 14;
    if (v === 'week' || v === 'month') dash.anchor = todayStr();
    if (v === 'pick') dash.cal = dash.date.slice(0, 7);
    render(false, focus ? '[data-pl="d-view"][data-val="' + v + '"]' : '');
  }

  function dashNav(dir) {
    const t = todayStr();
    if (dash.view === 'week') dash.anchor = dir ? shiftDateStr(dash.anchor, 7 * dir) : t;
    else {
      const pickView = dash.view === 'pick', base = (pickView ? dash.cal + '-01' : dash.anchor).split('-');
      const d = dir ? new Date(Number(base[0]), Number(base[1]) - 1 + dir, 1) : new Date(t + 'T00:00:00');
      const ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      if (pickView) { dash.cal = ym; if (!dir) dash.date = t; } else dash.anchor = ym + '-01';
    }
    dash.open = {}; dash.confirm = '';
    render(false, '[data-pl="d-nav"][data-dir="' + dir + '"]');
  }

  function removeTask(id) {
    const key = String(id).indexOf('legacy_') === 0 ? String(id).slice(7) : '';
    if (key && PlanData.getTask(key)) { PlanningAgent.deleteTask(key); PlanningAgentTasks.sync(); }
    else CanonicalTaskStore.deleteTask(id);
  }

  function dashRemove(kind, id, mode) {
    if (kind === 'task') removeTask(id);
    else {
      CanonicalTaskStore.getTasks({ targetId: id }).forEach(function (t) {
        if (mode === 'all') { removeTask(t.id); return; }
        const key = t.id.indexOf('legacy_') === 0 ? t.id.slice(7) : '';
        if (key) PlanData.updateTask(key, { targetId: null, subtargetId: null });
        CanonicalTaskStore.updateTask(t.id, { targetId: null, subtaskId: null });
      });
      PlanningAgentTasks.sync();
      TargetsData.deleteTarget(id);
    }
    dash.confirm = '';
    refreshViews();
    render(false);
  }

  function editPlan(targetId, addSub) {
    const tg = TargetsData.getTarget(targetId);
    if (!tg) return;
    state = freshState({ from: dash ? dash.from : '', subject: tg.subject, topicId: tg.planTopicId, title: tg.title });
    state.editId = targetId;
    state.tags = (tg.tagIds || []).slice();
    if (addSub) state.subs.push(blankSub(''));
    screen = 'compose'; toTop = true;
    render(false, addSub ? '#pl-st-' + state.subs[0].uid : '#pl-title');
  }

  function showDashboard() {
    if (!dash) dash = freshDash({});
    screen = 'dash';
    render(true);
  }

  // ---------- Render ----------

  function composeHead(title) {
    return '<header class="pl-head"><h3 class="plan-agent-title">' + esc(title) + '</h3><span class="pl-head-acts">' +
      '<button type="button" class="pl-hbtn" data-pl="d-home">' + ICONS.back + '<span>Plans</span></button>' +
      '<button type="button" class="pl-ib pl-close" data-pl="close" aria-label="Close" title="Close">' + ICONS.close + '</button></span></header>';
  }

  function renderHtml() {
    if (screen === 'dash') return dashHtml();
    const head = composeHead(state.editId ? 'Edit plan' : 'New plan');

    if (state.done) {
      const n = state.done.count, edited = state.done.edited;
      return '<div class="plan-agent pl">' + head +
        '<div class="plan-agent-done"><p class="plan-agent-done-title">' + (edited ? 'Plan updated.' : 'Plan created.') + '</p>' +
          '<p class="plan-agent-muted">\u201c' + esc(state.done.title) + '\u201d' + (n ? (edited ? ' now has ' + n + ' new ' : ' with ' + n + ' ') + (n === 1 ? 'subtask.' : 'subtasks.') : '.') + '</p>' +
          '<div class="plan-agent-actions plan-agent-actions-center">' +
            '<button type="button" class="btn btn-secondary" data-pl="again">Plan something else</button>' +
            '<button type="button" class="btn btn-primary" data-pl="d-home">View plans</button>' +
          '</div></div></div>';
    }

    cleanTopic();
    const kept = state.editId ? planSubs(state.editId).length : 0;
    return '<div class="plan-agent pl">' + head +
      '<div class="pl-card">' +
        '<div class="pl-pair">' +
          '<div class="pl-cell"><span class="pl-label">Subject <em>optional</em></span>' + subjectChooser('p', state, 'No subject') + '</div>' +
          '<div class="pl-cell"><span class="pl-label">Topic <em>optional</em></span>' + topicChooser('p', state, state.subject, '') + '</div>' +
        '</div>' +
        '<label class="pl-label" for="pl-title">Plan</label>' +
        '<input type="text" id="pl-title" class="pl-input pl-title" data-f="title" maxlength="120" placeholder="What are you planning?" value="' + esc(state.title) + '"' + (state.err ? ' aria-invalid="true"' : '') + '>' +
        (state.err ? '<p class="pl-err" role="alert">' + esc(state.err) + '</p>' : '') +
        '<span class="pl-label">Tags <em>optional</em></span>' + tagsChooser('p', state) +
      '</div>' +
      (kept ? '<p class="plan-agent-muted">' + kept + (kept === 1 ? ' subtask is' : ' subtasks are') + ' already in this plan. Edit or remove them from the plan list.</p>' : '') +
      (state.subs.length ? '<div class="pl-subs">' + state.subs.map(subHtml).join('') + '</div>' : '') +
      '<button type="button" class="pl-add" data-pl="add-sub">' + ICONS.plus + '<span>Add subtask</span></button>' +
      (state.msg ? '<p class="pl-err" role="alert">' + esc(state.msg) + '</p>' : '') +
      '<div class="plan-agent-actions"><button type="button" class="btn btn-primary pl-primary" data-pl="save">' + (state.editId ? 'Save changes' : 'Plan') + '</button></div>' +
    '</div>';
  }

    function render(first, focusSel) {
    const html = renderHtml();
    const content = document.getElementById('modal-content');
    const inPlace = !first && content && content.querySelector('.pl');
    const keep = inPlace && !toTop ? content.scrollTop : 0;
    toTop = false;
    if (inPlace) { content.innerHTML = html; content.scrollTop = keep; }
    else Modal.open(html, { size: 'xl' });
    bindEvents();
    if (focusSel) {
      const el = document.querySelector('.pl ' + focusSel);
      if (el && el.focus) el.focus({ preventScroll: false });
    }
  }

  function openPop(key) {
    clk = null;
    state.pop = state.pop === key ? '' : key;
    state.popErr = '';
    if (state.pop.indexOf('date:') === 0) {
      const s = holderOf(state.pop.slice(5));
      state.cal = (s && s.date ? s.date : todayStr()).slice(0, 7);
    }
    render(false, state.pop ? (/^(start|end):/.test(state.pop) ? '.pl-clk-face' : '.pl-pop button, .pl-pop input') : '[data-key="' + key + '"]');
  }

  function onClick(e) {
    const el = e.target.closest('[data-pl]');
    if (!el) {
      if (state.pop && !e.target.closest('.pl-pop')) { state.pop = ''; render(false); }
      return;
    }
    const a = el.dataset.pl, key = el.dataset.key || '', val = el.dataset.val;
    const who = key.slice(key.indexOf(':') + 1), holder = key ? holderOf(who) : null;
    const popSub = state.pop ? holderOf(state.pop.slice(state.pop.indexOf(':') + 1)) : null;
    const popField = state.pop ? state.pop.slice(0, state.pop.indexOf(':')) : '';
    switch (a) {
      case 'close': Modal.close(); return;
            case 'd-view': dashView(val, true); return;
      case 'd-nav': dashNav(Number(el.dataset.dir)); return;
      case 'd-day':
        dash.date = val; dash.open = {}; dash.confirm = '';
        render(false, '.pl-day[data-val="' + val + '"]');
        return;
      case 'd-tray':
        dash.tray = dash.tray === val ? '' : val; dash.open = {}; dash.confirm = '';
        render(false, '[data-pl="d-tray"][data-val="' + val + '"]');
        return;
      case 'd-open': {
        const k = el.dataset.k;
        dash.open[k] = !dash.open[k];
        dash.pulse = dash.open[k] ? k : '';
        render(false, '[data-k="' + k + '"]');
        dash.pulse = '';
        return;
      }
      case 'd-toggle': {
        const id = el.dataset.id;
        PlanningAgentTasks.toggleTask(toggleKey(id));
        refreshViews();
        dash.pulse = id;
        render(false, '[data-pl="d-toggle"][data-id="' + id + '"]');
        dash.pulse = '';
        return;
      }
      case 'd-plan-toggle': {
        const pid = el.dataset.id;
        togglePlan(pid);
        refreshViews();
        render(false, '[data-pl="d-plan-toggle"][data-id="' + pid + '"]');
        return;
      }
      case 'd-edit': TaskManagerUI.open({ taskId: el.dataset.id, backToDash: true }); return;
      case 'd-edit-plan': editPlan(el.dataset.id, false); return;
      case 'd-add-sub': editPlan(el.dataset.id, true); return;
      case 'd-del':
        dash.confirm = el.dataset.kind + ':' + el.dataset.id;
        render(false, '.pl-confirm .is-danger');
        return;
      case 'd-del-no': {
        const c = dash.confirm;
        dash.confirm = '';
        render(false, '[data-pl="d-del"][data-id="' + c.slice(c.indexOf(':') + 1) + '"]');
        return;
      }
      case 'd-del-yes': dashRemove(el.dataset.kind, el.dataset.id, el.dataset.mode); return;
      case 'd-more': dash.limit += 14; render(false); return;
      case 'd-clear-subject': dash.subject = ''; render(false); return;
      case 'd-new':
        state = freshState({ from: dash ? dash.from : '' });
        screen = 'compose'; toTop = true;
        render(false, '#pl-title');
        return;
      case 'd-home':
        state.pop = ''; clk = null;
        if (!dash) dash = freshDash({ from: state.from });
        screen = 'dash'; toTop = true;
        render(false);
        return;
      case 'back':
        Modal.close();
        if (typeof Assistant !== 'undefined' && Assistant.openMain) Assistant.openMain();
        return;
      case 'again': state = freshState({ from: state.from, date: state.date }); render(false, '#pl-title'); return;
      case 'pop': openPop(key); return;
      case 'pop-close': state.pop = ''; render(false); return;
      case 'toggle': {
        const s = holderOf(el.dataset.u);
        if (s) { s.open = !s.open; if (!s.open) state.pop = ''; }
        render(false, '[data-pl="toggle"][data-u="' + el.dataset.u + '"]');
        return;
      }
      case 'add-sub': {
        const s = blankSub(state.date);
        state.subs.push(s);
        state.pop = '';
        render(false, '#pl-st-' + s.uid);
        return;
      }
      case 'topic':
        if (holder) holder.topicId = val || '';
        state.pop = '';
        render(false, '[data-key="' + key + '"]');
        return;
      case 'subj':
        if (holder) holder.subject = val;
        cleanTopic();
        state.pop = '';
        render(false, '[data-key="' + key + '"]');
        return;
      case 'subj-new': {
        const input = document.querySelector('.pl [data-new="' + key + '"]');
        const res = PlanData.addSubject(input ? input.value : '');   // the Library's own subject mechanism; an existing name is reused
        if (!res.subject) { state.popErr = res.error || 'Could not add the subject.'; render(false, '.pl-pop input'); return; }
        if (holder) holder.subject = res.subject;
        cleanTopic();
        state.pop = ''; state.popErr = '';
        refreshViews();
        render(false, '[data-key="' + key + '"]');
        return;
      }
      case 'tag': {
        if (!holder) return;
        const at = holder.tags.indexOf(val);
        if (at === -1) holder.tags.push(val); else holder.tags.splice(at, 1);
        render(false, '.pl-pop [data-val="' + val + '"]');
        return;
      }
      case 'tag-new': {
        const input = document.querySelector('.pl [data-new="' + key + '"]');
        const name = (input ? input.value : '').replace(/\s+/g, ' ').trim();
        if (!name) { state.popErr = 'Enter a tag name.'; render(false, '.pl-pop input'); return; }
        const tag = TagsData.createTag(name);   // shared tag store; an existing name is reused
        if (holder && holder.tags.indexOf(tag.tagId) === -1) holder.tags.push(tag.tagId);
        state.popErr = '';
        render(false, '.pl-pop input');
        return;
      }
      case 'cal-nav': {
        const p = state.cal.split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1 + Number(el.dataset.dir), 1);
        state.cal = d.getFullYear() + '-' + pad(d.getMonth() + 1);
        render(false, '.pl-cal [data-pl="cal-nav"][data-dir="' + el.dataset.dir + '"]');
        return;
      }
      case 'cal-pick': case 'cal-clear': case 'cal-today':
        if (popSub) { popSub.date = a === 'cal-clear' ? '' : (a === 'cal-today' ? todayStr() : val); popSub.err = ''; }
        state.pop = '';
        render(false, '[data-key="date:' + (popSub ? popSub.uid : '') + '"]');
        return;
      case 'clk-step': clkStep(val); return;
      case 'clk-ap': if (clk) { clk.ap = val; clkPaint(); } return;
      case 'clk-ok': clkClose('ok'); return;
      case 'clk-cancel': clkClose('cancel'); return;
      case 'clk-clear': clkClose('clear'); return;
      case 'save': save(); return;
    }
  }

  function onInput(e) {
    const t = e.target, f = t.dataset ? t.dataset.f : '';
    if (!f) return;
    if (f === 'title') { state.title = t.value; state.err = ''; return; }
    const s = holderOf(t.dataset.u);
    if (!s) return;
    if (f === 's-title') s.title = t.value; else if (f === 's-note') s.note = t.value;
    s.err = '';
  }

    function onKey(e) {
    if (clkKey(e)) return;
    if (screen === 'dash') {
      const t = e.target;
      if (t && t.dataset && t.dataset.pl === 'd-view' && /^Arrow(Right|Left|Down|Up)$/.test(e.key)) {
        const at = DASH_VIEWS.map(function (d) { return d[0]; }).indexOf(dash.view);
        e.preventDefault();
        dashView(DASH_VIEWS[(at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : DASH_VIEWS.length - 1)) % DASH_VIEWS.length][0], true);
      } else if (e.key === 'Escape' && dash.confirm) {
        e.stopPropagation();
        dash.confirm = '';
        render(false);
      }
      return;
    }
    if (e.key === 'Escape' && state.pop) {
      clk = null;
      e.stopPropagation();
      const key = state.pop;
      state.pop = '';
      render(false, '[data-key="' + key + '"]');
    } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      if (e.target.dataset.new) e.target.parentNode.querySelector('.pl-mini').click();
    }
  }

  function bindEvents() {
    const root = document.querySelector('.pl');
    if (!root) return;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (t) { root.addEventListener(t, onPointer); });
  }

  // ---------- Save ----------

  function subError(s) {
    if (!s.title.trim()) return 'Give this subtask a title.';
    if (!!s.start !== !!s.end) return 'Add both a start and an end time, or leave both empty.';
    if (s.start && s.end <= s.start) return 'The end time must be after the start time.';
    if (s.start && !s.date) return 'Choose a date to set a time.';
    return '';
  }

  function save() {
    state.err = ''; state.msg = '';
    cleanTopic();
    const title = state.title.trim();
    const subs = state.subs.filter(isFilled);
    let bad = false;
    if (!title) { state.err = 'Give your plan a title.'; bad = true; }
    state.subs.forEach(function (s) { s.err = ''; });
    subs.forEach(function (s) {
      s.err = subError(s);
      if (s.err) { bad = true; if (s.title.trim()) s.open = true; }
    });
    if (bad) { render(false, state.err ? '#pl-title' : ''); return; }
    if (subs.some(function (s) { return s.start; }) && typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive && TimeEngine.isManualClockActive()) {
      state.msg = 'Finish or reset your Stopwatch/Timer before scheduling a task.';
      render(false);
      return;
    }

    const base = state.editId ? TargetsData.getTarget(state.editId) : null;
    const dates = subs.map(function (s) { return s.date; }).filter(Boolean);
    if (base) planSubs(base.targetId).forEach(function (x) { if (x.date) dates.push(x.date); });
    dates.sort();
    const first = dates[0] || (base && base.startDate) || todayStr(), last = dates[dates.length - 1] || (base && base.endDate) || first;
    let target = base;
    if (!base) {
      target = TargetsData.createTarget({ title: title, timeframe: 'daily', dateKey: first, type: 'custom' });
      const fields = { startDate: first, endDate: last, startTime: '', endTime: '', isPlan: true };
      if (state.subject) fields.subject = state.subject;
      if (state.topicId) fields.planTopicId = state.topicId;
      if (state.tags.length) fields.tagIds = state.tags.slice();
      TargetsData.updateTarget(target.targetId, fields);
    }

    const made = [];
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const res = PlanningAgent.createTask({
        taskType: 'custom', title: s.title.trim(), date: s.date || todayStr(),
        startTime: s.start || null, stopTime: s.end || null, note: s.note.trim(), targetId: target.targetId
      }, 'user');
      if (!res.ok) {
        made.forEach(function (k) { PlanningAgent.deleteTask(k); });
        if (!base) TargetsData.deleteTarget(target.targetId);
        refreshViews();
        s.err = res.error || 'Could not add this subtask.';
        s.open = true;
        state.msg = 'Nothing was saved. Fix the subtask and try again.';
        render(false);
        return;
      }
      const key = res.task.taskId, patch = {}, subject = state.subject || s.subject;
      made.push(key);
      if (!s.date) patch.date = null;   // createTask defaults to today; an unscheduled subtask stays undated
      if (subject) patch.subject = subject;
      const topicId = state.topicId || s.topicId, tp = topicId ? PlanData.getAllTopics()[topicId] : null;
      if (tp && tp.subject === subject) { patch.topicId = topicId; patch.topicName = tp.topicName; }
      if (s.tags.length) patch.tagIds = s.tags.slice();
      if (Object.keys(patch).length) PlanData.updateTask(key, patch);
    }
    if (base) {
      restampSubs(base);
      TargetsData.updateTarget(base.targetId, { title: title, dateKey: first, startDate: first, endDate: last, subject: state.subject, planTopicId: state.topicId || null, tagIds: state.tags.slice() });
    }

    if (typeof MiscSound !== 'undefined') MiscSound.play('uiSuccess');
    refreshViews();
    state.done = { title: title, count: made.length, edited: !!base };
    render(false);
  }

  // ---------- Public Universal API ----------
  // open(context): context may carry { date, intent, subject, topicId, chapterId, targetId, title, prompt, catchup, from }.
  // chapterId is the same thing as topicId and is normalised here, at the entry boundary.

  function normalizeContext(options) {
    const o = Object.assign({}, options || {});
        if (!o.topicId && o.chapterId) o.topicId = o.chapterId;
    if (!o.subject && o.subjectId) o.subject = o.subjectId;
    delete o.chapterId;
    if (o.catchup) o.intent = 'catchup';
    if (o.topicId) {
      const t = PlanData.getAllTopics()[o.topicId];
      if (t) o.subject = t.subject; else delete o.topicId;   // the Library topic is authoritative; a deleted topic is dropped
    }
    return o;
  }

    function open(options) {
    const opts = normalizeContext(options);
    if (opts.intent === 'catchup') { CatchUpUI.open(); return; }
    const compose = !!opts.create || (!opts.view && !!(opts.date || opts.intent || opts.subject || opts.title || opts.prompt || opts.targetId));
    if (!compose) {
      dash = freshDash({ from: opts.from, view: opts.view === 'day' ? 'pick' : opts.view, date: opts.date, subject: opts.filterSubject });
      screen = 'dash';
      render(true);
      return;
    }
    screen = 'compose';
    state = freshState({ from: opts.from, date: opts.date, subject: opts.subject, topicId: opts.topicId, title: opts.title });
    if (opts.prompt) {
      const parsed = parseNaturalInput(opts.prompt);
      if (parsed.date) state.date = parsed.date;
      if (parsed.subject) state.subject = parsed.subject;
    }
    render(true);
  }

  return {
    open: open,
    showDashboard: showDashboard,
    parseNaturalInput: parseNaturalInput,
    store: CanonicalTaskStore
  };
})();

// ============================================================================
// SECTION 7 - TASK MANAGEMENT UI (Planning Architecture, Phase 2)
// The single Task Management interface: Day / Week / Month / All Tasks views, search,
// filters, sorting, and the Task Inspector (view, edit, reschedule, delete, create).
// Reads and writes ONLY through CanonicalTaskStore - no legacy planner/itinerary DOM or stores.
// Optional lookups (names only): PlanData (subjects/topics), TargetsData (goals).
// Entry points: TaskManagerUI.open({ view, date, filters, taskId, create }),
//               PlanningAgentUI.openManager(...) (same thing).
// ============================================================================
const TaskManagerUI = (function () {
  const Store = CanonicalTaskStore;

  const VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['all', 'All tasks']];
  const TYPE_LABELS = { study: 'Study', custom: 'Custom', revision: 'Revision', practice: 'Practice', 'break': 'Break', exercise: 'Exercise' };
  const STATUS_LABELS = { pending: 'Pending', completed: 'Completed', cancelled: 'Cancelled' };
  const SCHEDULED_LABELS = { timed: 'Timed', untimed: 'Date only', undated: 'Undated (backlog)' };
  const SORTS = [['date', 'Date & time'], ['title', 'Title'], ['status', 'Status'], ['created', 'Created'], ['subject', 'Subject']];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DEFAULT_DURATION = 30; // minutes, for drawing a timed task that has no duration
  const HOUR_PX = 48;
  const MONTH_CHIPS = 3;

    function freshFilters() { return { search: '', type: '', subject: '', target: '', status: '', scheduled: '', alarm: '' }; }

  const st = {
    view: 'day',
    date: '',
    filters: freshFilters(),
    sort: { by: 'date', dir: 'asc' },
    inspector: null, // { id|null, draft, original, confirmDelete, error }
    message: ''
  };

  // ---------- small helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { return new Date(s + 'T00:00:00'); }
  function shift(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
  function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s).getTime()); }
  function toMin(hhmm) { return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)); }
  function minToTime(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function endTime(t) { return minToTime((toMin(t.time) + (t.duration || DEFAULT_DURATION)) % 1440); }
  function rand() { return Math.random().toString(36).slice(2, 10); }

  function today() {
    return PlanningAgentData.todayStr();
  }
  function weekStart(s) { const dow = (parseDate(s).getDay() + 6) % 7; return shift(s, -dow); }
  function addMonths(s, n) {
    const d = parseDate(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
    return fmtDate(d);
  }
  function dayLabel(s) {
    const d = parseDate(s);
    return DOW_FULL[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  }
  function friendly(s) {
    if (!s) return 'No date';
    const t = today();
    if (s === t) return 'Today';
    if (s === shift(t, 1)) return 'Tomorrow';
    if (s === shift(t, -1)) return 'Yesterday';
    const d = parseDate(s);
    const sameYear = d.getFullYear() === parseDate(t).getFullYear();
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + (sameYear ? '' : ' ' + d.getFullYear());
  }
  function navLabel() {
    if (st.view === 'day') return dayLabel(st.date);
    if (st.view === 'week') {
      const a = weekStart(st.date), b = shift(a, 6);
      const da = parseDate(a), db = parseDate(b);
      return da.getDate() + ' ' + MONTHS[da.getMonth()].slice(0, 3) + ' – ' + db.getDate() + ' ' + MONTHS[db.getMonth()].slice(0, 3) + ' ' + db.getFullYear();
    }
    const d = parseDate(st.date);
    return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ---------- optional lookups (names only; never required) ----------

  function plannerSubjects() {
    try { return PlanData.getAllSubjects(); } catch (e) {}
    return [];
  }
  function topicsFor(subject) {
    try {
      if (subject) return PlanData.getTopicsBySubject()[subject] || [];
    } catch (e) {}
    return [];
  }
  function topicName(id) {
    if (!id) return '';
    try {
      const t = PlanData.getAllTopics()[id];
      if (t && t.topicName) return t.topicName;
    } catch (e) {}
    return id;
  }
  function targetsList() {
    try {
      if (typeof TargetsData !== 'undefined') {
        if (typeof TargetsData.getAllTargetsList === 'function') return TargetsData.getAllTargetsList() || [];
        if (typeof TargetsData.getAllTargets === 'function') {
          const m = TargetsData.getAllTargets() || {};
          return Array.isArray(m) ? m : Object.keys(m).map(function (k) { return m[k]; });
        }
      }
    } catch (e) {}
    return [];
  }
  function targetTitle(id) {
    if (!id) return '';
    const list = targetsList();
    for (let i = 0; i < list.length; i++) if (list[i].targetId === id) return list[i].title || id;
    return id;
  }
  function allSubjects(tasks) {
    const seen = {}, out = [];
    plannerSubjects().concat((tasks || Store.getTasks()).map(function (t) { return t.subjectId; })).forEach(function (s) {
      if (s && !seen[s]) { seen[s] = true; out.push(s); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function allTargets(tasks) {
    const seen = {}, out = [];
    targetsList().filter(function (t) { return !t.archived; }).forEach(function (t) {
      if (t.targetId && !seen[t.targetId]) { seen[t.targetId] = true; out.push({ id: t.targetId, title: t.title || t.targetId }); }
    });
    (tasks || Store.getTasks()).forEach(function (t) {
      if (t.targetId && !seen[t.targetId]) { seen[t.targetId] = true; out.push({ id: t.targetId, title: targetTitle(t.targetId) }); }
    });
    return out;
  }
  function taskTitle(t) {
    return t.title || (t.topicId ? topicName(t.topicId) : '') || t.subjectId || 'Untitled task';
  }

  // ---------- query / sort ----------

  function matchesSearch(t, q) {
    const hay = [t.title, t.subjectId, t.topicId, topicName(t.topicId), targetTitle(t.targetId), TYPE_LABELS[t.type]]
      .concat((t.checklist || []).map(function (c) { return c.text; }));
    return hay.some(function (h) { return h && String(h).toLowerCase().indexOf(q) !== -1; });
  }

  function sortTasks(list) {
    const by = st.sort.by, m = st.sort.dir === 'desc' ? -1 : 1;
    const str = function (a, b) { return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' }); };
    return list.slice().sort(function (a, b) {
      let r = 0;
      if (by === 'title') r = str(taskTitle(a), taskTitle(b));
      else if (by === 'status') r = str(a.status, b.status);
      else if (by === 'created') r = a.createdAt - b.createdAt;
      else if (by === 'subject') r = str(a.subjectId, b.subjectId);
      else {
        // Undated tasks always sort last, whichever direction is chosen.
        if (!a.date || !b.date) {
          if (a.date || b.date) return a.date ? -1 : 1;
        } else if (a.date !== b.date) {
          r = a.date < b.date ? -1 : 1;
        } else {
          const ta = a.time || '99:99', tb = b.time || '99:99';
          r = ta < tb ? -1 : ta > tb ? 1 : 0;
        }
      }
      if (r === 0) r = a.createdAt - b.createdAt;
      return r * m;
    });
  }

  function queryTasks() {
    const f = st.filters, q = {};
    if (f.type) q.type = f.type;
    if (f.subject) q.subjectId = f.subject;
    if (f.target) q.targetId = f.target;
    if (f.status) q.status = f.status;
    if (f.scheduled) q.scheduled = f.scheduled;
        let list = Store.getTasks(q);
    if (f.alarm) list = list.filter(function (t) { return t.alarm && t.alarm.enabled; });
    const s = String(f.search || '').trim().toLowerCase();
    if (s) list = list.filter(function (t) { return matchesSearch(t, s); });
    return sortTasks(list);
  }

  // ---------- shared task pieces ----------

  function tag(text, cls) { return '<span class="tm-tag' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>'; }

  function chipsHtml(t) {
    const bits = [];
    if (t.type) bits.push(tag(TYPE_LABELS[t.type] || t.type));
    if (t.revisionMeta && t.revisionMeta.level) bits.push(tag(t.revisionMeta.level, 'tm-tag-kraft'));
    if (t.subjectId) bits.push(tag(t.subjectId + (t.topicId ? ' · ' + topicName(t.topicId) : '')));
    else if (t.topicId) bits.push(tag(topicName(t.topicId)));
        if (t.targetId) {
      bits.push(tag('Goal: ' + targetTitle(t.targetId), 'tm-tag-neutral'));
      const gp = TargetsData.getProgress(t.targetId);
      if (gp) bits.push(targetProgressBarHtml(gp.pct));
    }
    if (t.checklist && t.checklist.length) {
      const done = t.checklist.filter(function (c) { return c.completed; }).length;
      bits.push(tag(done + '/' + t.checklist.length + ' items', 'tm-tag-neutral'));
    }
    if (t.alarm && t.alarm.enabled) bits.push(tag('Alarm', 'tm-tag-neutral'));
    return bits.join('');
  }

  function whenText(t) {
    const parts = [];
    if (t.date) parts.push(friendly(t.date));
    if (t.time) parts.push(t.time + '–' + endTime(t));
    return parts.join(' · ') || 'Undated';
  }

  function checkHtml(t) {
    return '<input type="checkbox" class="tm-check" data-tm="toggle" data-id="' + esc(t.id) + '"' +
      (t.status === 'completed' ? ' checked' : '') + ' aria-label="Mark “' + esc(taskTitle(t)) + '” complete">';
  }

    function inlineChecklistHtml(t) {
    if (!t.checklist || !t.checklist.length) return '';
    return '<ul class="tm-cl-inline" style="list-style:none;margin:4px 0 0;padding:0">' + t.checklist.map(function (c) {
      return '<li><input type="checkbox" data-tm="cl-toggle" data-id="' + esc(t.id) + '" data-cid="' + esc(c.id) + '"' +
        (c.completed ? ' checked' : '') + ' aria-label="Toggle ' + esc(c.text) + '"> ' +
        '<span' + (c.completed ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' + esc(c.text) + '</span></li>';
    }).join('') + '</ul>';
  }

  function rowHtml(t, showWhen) {
    return (
      '<li class="tm-row tm-st-' + esc(t.status) + '" data-tm="open" data-id="' + esc(t.id) + '" tabindex="0" role="button">' +
        checkHtml(t) +
        '<div class="tm-row-main">' +
          '<div class="tm-row-title">' + esc(taskTitle(t)) + (t.status === 'cancelled' ? ' <em>(cancelled)</em>' : '') + '</div>' +
                    '<div class="tm-row-tags">' + chipsHtml(t) + '</div>' +
          inlineChecklistHtml(t) +
        '</div>' +
        (showWhen ? '<div class="tm-row-when">' + esc(whenText(t)) + '</div>' : '') +
      '</li>'
    );
  }

  function listHtml(tasks, showWhen, emptyText) {
    if (!tasks.length) return '<p class="tm-empty">' + esc(emptyText) + '</p>';
    return '<ul class="tm-list">' + tasks.map(function (t) { return rowHtml(t, showWhen); }).join('') + '</ul>';
  }

  // ---------- Day view ----------

  function layoutLanes(timed) {
    const items = timed.map(function (t) {
      const s = toMin(t.time);
      return { t: t, s: s, e: Math.min(1440, s + (t.duration || DEFAULT_DURATION)), lane: 0 };
    }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });
    const laneEnds = [];
    items.forEach(function (it) {
      let i = 0;
      while (i < laneEnds.length && laneEnds[i] > it.s) i++;
      laneEnds[i] = it.e;
      it.lane = i;
    });
    return { items: items, lanes: Math.max(1, laneEnds.length) };
  }

  function timelineHtml(timed) {
    if (!timed.length) return '';
    const lay = layoutLanes(timed);
    let minH = 7, maxH = 21;
    lay.items.forEach(function (it) {
      minH = Math.min(minH, Math.floor(it.s / 60));
      maxH = Math.max(maxH, Math.ceil(it.e / 60));
    });
    maxH = Math.min(24, maxH);
    const total = (maxH - minH) * HOUR_PX;
    let hours = '';
    for (let h = minH; h < maxH; h++) {
      hours += '<span class="tm-hour" style="top:' + ((h - minH) * HOUR_PX) + 'px">' + pad(h) + ':00</span>';
    }
    const blocks = lay.items.map(function (it) {
      const t = it.t;
      const top = (it.s - minH * 60) / 60 * HOUR_PX;
      const height = Math.max(26, (it.e - it.s) / 60 * HOUR_PX - 2);
      const w = 100 / lay.lanes;
      return (
        '<div class="tm-block tm-st-' + esc(t.status) + '" data-tm="open" data-id="' + esc(t.id) + '" tabindex="0" role="button"' +
          ' style="top:' + top + 'px;height:' + height + 'px;left:' + (it.lane * w) + '%;width:calc(' + w + '% - 4px)">' +
          checkHtml(t) +
          '<span class="tm-block-text"><span class="tm-block-time">' + esc(t.time) + '–' + esc(endTime(t)) + '</span> ' +
          '<span class="tm-block-title">' + esc(taskTitle(t)) + '</span></span>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="tm-timeline" style="height:' + total + 'px">' +
        '<div class="tm-hours">' + hours + '</div>' +
        '<div class="tm-lane-area">' + blocks + '</div>' +
      '</div>'
    );
  }

  function dayViewHtml() {
    const tasks = Store.getTasks({ date: st.date });
    const timed = tasks.filter(function (t) { return t.time; });
    const untimed = tasks.filter(function (t) { return !t.time; });
    const backlog = Store.getTasks({ scheduled: 'undated', status: 'pending' });
    let html = '';
    if (!tasks.length) html += '<p class="tm-empty">Nothing planned for this day.</p>';
    if (timed.length) html += '<h4 class="tm-sec">Scheduled</h4>' + timelineHtml(timed);
    if (untimed.length) html += '<h4 class="tm-sec">Anytime this day</h4>' + listHtml(untimed, false, '');
    html += '<details class="tm-backlog"' + (!tasks.length && backlog.length ? ' open' : '') + '>' +
      '<summary>Unscheduled backlog (' + backlog.length + ')</summary>' +
      (backlog.length
        ? '<ul class="tm-list">' + backlog.map(function (t) {
            return '<li class="tm-row">' +
              '<div class="tm-row-main" data-tm="open" data-id="' + esc(t.id) + '" tabindex="0" role="button">' +
                '<div class="tm-row-title">' + esc(taskTitle(t)) + '</div>' +
                '<div class="tm-row-tags">' + chipsHtml(t) + '</div></div>' +
              '<button type="button" class="btn btn-secondary tm-small" data-tm="assign" data-id="' + esc(t.id) + '">Add to this day</button>' +
            '</li>';
          }).join('') + '</ul>'
        : '<p class="tm-empty">No undated tasks.</p>') +
    '</details>';
    return html;
  }

  // ---------- Week view ----------

  function weekViewHtml() {
    const start = weekStart(st.date), end = shift(start, 6), t0 = today();
    const tasks = Store.getTasks({ dateFrom: start, dateTo: end });
    let cols = '';
    for (let i = 0; i < 7; i++) {
      const d = shift(start, i);
      const day = tasks.filter(function (t) { return t.date === d; });
      const untimed = day.filter(function (t) { return !t.time; });
      const timed = day.filter(function (t) { return t.time; });
      const chip = function (t, withTime) {
        return '<div class="tm-chip tm-st-' + esc(t.status) + '" data-tm="open" data-id="' + esc(t.id) + '" tabindex="0" role="button" title="' + esc(taskTitle(t)) + '">' +
          (withTime ? '<span class="tm-chip-time">' + esc(t.time) + '</span> ' : '') + esc(taskTitle(t)) + '</div>';
      };
      cols +=
        '<div class="tm-wk-col' + (d === t0 ? ' tm-today' : '') + '">' +
          '<button type="button" class="tm-wk-head" data-tm="goday" data-date="' + d + '">' +
            '<span class="tm-wk-dow">' + DOW_SHORT[i] + '</span><span class="tm-wk-num">' + parseDate(d).getDate() + '</span></button>' +
          '<div class="tm-wk-items">' +
            untimed.map(function (t) { return chip(t, false); }).join('') +
            timed.map(function (t) { return chip(t, true); }).join('') +
            (!day.length ? '<span class="tm-wk-none">—</span>' : '') +
          '</div>' +
        '</div>';
    }
    return '<div class="tm-week">' + cols + '</div>';
  }

  // ---------- Month view ----------

  function monthViewHtml() {
    const first = st.date.slice(0, 8) + '01';
    const dim = new Date(parseDate(first).getFullYear(), parseDate(first).getMonth() + 1, 0).getDate();
    const offset = (parseDate(first).getDay() + 6) % 7;
    const cells = Math.ceil((offset + dim) / 7) * 7;
    const gridStart = shift(first, -offset), gridEnd = shift(gridStart, cells - 1);
    const byDate = {};
    Store.getTasks({ dateFrom: gridStart, dateTo: gridEnd }).forEach(function (t) { (byDate[t.date] = byDate[t.date] || []).push(t); });
    const month = parseDate(first).getMonth(), t0 = today();
    let html = '<div class="tm-month">' + DOW_SHORT.map(function (d) { return '<div class="tm-mo-dow">' + d + '</div>'; }).join('');
    for (let i = 0; i < cells; i++) {
      const d = shift(gridStart, i), day = byDate[d] || [];
      const open = day.filter(function (t) { return t.status === 'pending'; }).length;
      html +=
        '<div class="tm-mo-cell' + (parseDate(d).getMonth() !== month ? ' tm-mo-out' : '') + (d === t0 ? ' tm-today' : '') + '"' +
          ' data-tm="goday" data-date="' + d + '" tabindex="0" role="button" aria-label="' + esc(dayLabel(d) + ', ' + day.length + ' tasks') + '">' +
          '<div class="tm-mo-num">' + parseDate(d).getDate() + (open ? '<span class="tm-mo-dot" title="' + open + ' pending"></span>' : '') + '</div>' +
          day.slice(0, MONTH_CHIPS).map(function (t) {
            return '<div class="tm-mo-line tm-st-' + esc(t.status) + '">' + esc(taskTitle(t)) + '</div>';
          }).join('') +
          (day.length > MONTH_CHIPS ? '<div class="tm-mo-more">+' + (day.length - MONTH_CHIPS) + ' more</div>' : '') +
        '</div>';
    }
    return html + '</div>';
  }

  // ---------- All Tasks view ----------

  function selectHtml(attrs, options, selected) {
    return '<select ' + attrs + '>' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(selected) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  function resultsHtml() {
    const list = queryTasks(), total = Store.getTasks().length;
    return '<p class="tm-count" role="status">' + list.length + ' of ' + total + (total === 1 ? ' task' : ' tasks') + '</p>' +
      listHtml(list, true, total ? 'No tasks match these filters.' : 'No tasks yet. Use “Add task” to create one.');
  }

  function allViewHtml() {
    const f = st.filters, all = Store.getTasks();
    const typeOpts = [['', 'All types']].concat(Object.keys(TYPE_LABELS).map(function (k) { return [k, TYPE_LABELS[k]]; }));
    const subjOpts = [['', 'All subjects']].concat(allSubjects(all).map(function (s) { return [s, s]; }));
    const tgtOpts = [['', 'All goals']].concat(allTargets(all).map(function (t) { return [t.id, t.title]; }));
    const statusOpts = [['', 'Any status']].concat(Object.keys(STATUS_LABELS).map(function (k) { return [k, STATUS_LABELS[k]]; }));
    const schedOpts = [['', 'Any scheduling']].concat(Object.keys(SCHEDULED_LABELS).map(function (k) { return [k, SCHEDULED_LABELS[k]]; }));
    const anyFilter = Object.keys(f).some(function (k) { return f[k]; });
    return (
      '<div class="tm-filters">' +
        '<input type="search" id="tm-search" class="tm-search" placeholder="Search title, subject, topic, checklist…" value="' + esc(f.search) + '" aria-label="Search tasks">' +
        '<div class="tm-filter-row">' +
          selectHtml('data-tm-filter="type" aria-label="Task type"', typeOpts, f.type) +
          selectHtml('data-tm-filter="subject" aria-label="Subject"', subjOpts, f.subject) +
          selectHtml('data-tm-filter="target" aria-label="Goal"', tgtOpts, f.target) +
          selectHtml('data-tm-filter="status" aria-label="Status"', statusOpts, f.status) +
                    selectHtml('data-tm-filter="scheduled" aria-label="Scheduling"', schedOpts, f.scheduled) +
          selectHtml('data-tm-filter="alarm" aria-label="Reminders"', [['', 'Any reminders'], ['1', 'With reminder']], f.alarm) +
        '</div>' +
        '<div class="tm-filter-row tm-sort-row">' +
          '<label class="tm-sort-label" for="tm-sort-by">Sort by</label>' +
          selectHtml('id="tm-sort-by"', SORTS, st.sort.by) +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="sort-dir" aria-label="Toggle sort direction">' + (st.sort.dir === 'asc' ? 'Ascending ↑' : 'Descending ↓') + '</button>' +
          (anyFilter ? '<button type="button" class="tm-link" data-tm="clear-filters">Clear filters</button>' : '') +
        '</div>' +
      '</div>' +
      '<div id="tm-results">' + resultsHtml() + '</div>'
    );
  }

  // ---------- Task Inspector ----------

  function draftFromTask(t) {
    return {
      title: t.title || '', type: t.type || '', status: t.status || 'pending',
      date: t.date || '', time: t.time || '', duration: t.duration || '',
      subjectId: t.subjectId || '', topicId: t.topicId || '', targetId: t.targetId || '', subtaskId: t.subtaskId || '',
      checklist: (t.checklist || []).map(function (c) { return { id: c.id, text: c.text, completed: !!c.completed }; }),
      alarmEnabled: !!(t.alarm && t.alarm.enabled),
      alarmOffset: t.alarm ? t.alarm.offsetMinutes : 15,
      alarmSound: t.alarm ? t.alarm.sound : 'chime'
    };
  }

    function inspectorFor(id) {
    const t = Store.getTask(id);
    if (!t) return null;
    return { id: id, draft: draftFromTask(t), original: t, confirmDelete: false, error: '' };
  }

  function field(label, inner, cls) {
    return '<div class="tm-field' + (cls ? ' ' + cls : '') + '"><label>' + esc(label) + inner.label + '</label></div>';
  }
  function fieldBlock(label, forId, control, cls) {
    return '<div class="tm-field' + (cls ? ' ' + cls : '') + '"><label class="tm-label" for="' + forId + '">' + esc(label) + '</label>' + control + '</div>';
  }
  function optionsWithCurrent(options, current) {
    if (current && !options.some(function (o) { return o[0] === current; })) options = options.concat([[current, current]]);
    return options;
  }

  function inspectorHtml() {
    const ins = st.inspector, d = ins.draft, isNew = !ins.id, t = ins.original;
    const typeOpts = [['', 'None']].concat(Object.keys(TYPE_LABELS).map(function (k) { return [k, TYPE_LABELS[k]]; }));
    const statusOpts = Object.keys(STATUS_LABELS).map(function (k) { return [k, STATUS_LABELS[k]]; });

    const subjects = allSubjects();
    const subjectControl = subjects.length || d.subjectId
      ? selectHtml('id="tm-f-subjectId"', optionsWithCurrent([['', 'None']].concat(subjects.map(function (s) { return [s, s]; })), d.subjectId), d.subjectId)
      : '<input type="text" id="tm-f-subjectId" value="" placeholder="Optional">';

    const topics = topicsFor(d.subjectId);
    const topicControl = topics.length || (d.topicId && topicName(d.topicId) !== d.topicId)
      ? selectHtml('id="tm-f-topicId"', optionsWithCurrent([['', 'None']].concat(topics.map(function (x) { return [x.topicId, x.topicName]; })), d.topicId), d.topicId)
      : '<input type="text" id="tm-f-topicId" value="' + esc(d.topicId) + '" placeholder="Optional">';

    const targets = allTargets();
    const targetControl = targets.length || d.targetId
      ? selectHtml('id="tm-f-targetId"', optionsWithCurrent([['', 'None']].concat(targets.map(function (x) { return [x.id, x.title]; })), d.targetId), d.targetId)
      : '<input type="text" id="tm-f-targetId" value="" placeholder="Optional">';

    const checklist = d.checklist.map(function (c, i) {
      return '<div class="tm-cl-row" data-cid="' + esc(c.id) + '">' +
        '<input type="checkbox" class="tm-cl-done"' + (c.completed ? ' checked' : '') + ' aria-label="Item done">' +
        '<input type="text" class="tm-cl-text" value="' + esc(c.text) + '" aria-label="Checklist item">' +
        '<button type="button" class="tm-x" data-tm="cl-remove" data-idx="' + i + '" aria-label="Remove item">&times;</button>' +
      '</div>';
    }).join('');

    const rm = t && t.revisionMeta;
    const revision = rm
      ? '<p class="tm-meta">Revision' + (rm.level ? ' ' + esc(rm.level) : '') + (rm.cycleId ? ' · cycle ' + esc(rm.cycleId) : '') +
        (rm.sourceTaskId ? ' · from ' + esc(rm.sourceTaskId) : '') + '</p>'
      : '';
    const stamps = t
      ? '<p class="tm-meta">Created ' + esc(new Date(t.createdAt).toLocaleString()) +
        (t.completedAt ? ' · Completed ' + esc(new Date(t.completedAt).toLocaleString()) : '') + '</p>'
      : '';

    const deleteBtn = isNew ? '<span></span>'
      : ins.confirmDelete
        ? '<span class="tm-confirm">Delete this task? <button type="button" class="btn btn-danger tm-small" data-tm="delete-confirm">Yes, delete</button> ' +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="delete-cancel">Keep</button></span>'
        : '<button type="button" class="btn btn-secondary tm-small tm-danger" data-tm="delete">Delete</button>';

    return (
      '<div class="tm-inspector">' +
        '<h4 class="tm-sec">' + (isNew ? 'New task' : 'Task') + '</h4>' +
        (ins.error ? '<p class="tm-error" role="alert">' + esc(ins.error) + '</p>' : '') +
        fieldBlock('Title', 'tm-f-title', '<input type="text" id="tm-f-title" maxlength="160" value="' + esc(d.title) + '" placeholder="e.g. Solve 20 questions">') +
        '<div class="tm-grid2">' +
          fieldBlock('Type', 'tm-f-type', selectHtml('id="tm-f-type"', typeOpts, d.type)) +
          fieldBlock('Status', 'tm-f-status', selectHtml('id="tm-f-status"', statusOpts, d.status)) +
        '</div>' +
        '<div class="tm-grid3">' +
          fieldBlock('Date', 'tm-f-date', '<input type="date" id="tm-f-date" value="' + esc(d.date) + '">') +
          fieldBlock('Time', 'tm-f-time', '<input type="time" id="tm-f-time" value="' + esc(d.time) + '">') +
          fieldBlock('Duration (min)', 'tm-f-duration', '<input type="number" id="tm-f-duration" min="1" step="5" value="' + esc(d.duration) + '" placeholder="30">') +
        '</div>' +
        '<div class="tm-quick" role="group" aria-label="Reschedule">' +
          '<span class="tm-label">Reschedule</span>' +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="quick" data-q="today">Today</button>' +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="quick" data-q="tomorrow">Tomorrow</button>' +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="quick" data-q="week">Next week</button>' +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="quick" data-q="clear">Clear date &amp; time</button>' +
        '</div>' +
        '<div class="tm-grid2">' +
          fieldBlock('Subject', 'tm-f-subjectId', subjectControl) +
          fieldBlock('Topic', 'tm-f-topicId', topicControl) +
        '</div>' +
        '<div class="tm-grid2">' +
          fieldBlock('Goal', 'tm-f-targetId', targetControl) +
          fieldBlock('Subtask', 'tm-f-subtaskId', '<input type="text" id="tm-f-subtaskId" value="' + esc(d.subtaskId) + '" placeholder="Optional">') +
        '</div>' +
        '<div class="tm-field"><span class="tm-label">Checklist</span>' +
          '<div id="tm-checklist">' + checklist + '</div>' +
          '<div class="tm-cl-add"><input type="text" id="tm-cl-new" placeholder="Add an item" aria-label="New checklist item">' +
          '<button type="button" class="btn btn-secondary tm-small" data-tm="cl-add">Add</button></div>' +
        '</div>' +
        '<div class="tm-field tm-alarm"><label class="tm-check-label"><input type="checkbox" id="tm-f-alarmEnabled"' + (d.alarmEnabled ? ' checked' : '') + '> Remind me</label>' +
          '<span class="tm-alarm-fields">' +
            '<input type="number" id="tm-f-alarmOffset" min="0" step="5" value="' + esc(d.alarmOffset) + '" aria-label="Minutes before"> min before' +
            selectHtml('id="tm-f-alarmSound" aria-label="Sound"', [['chime', 'Chime']].concat(d.alarmSound && d.alarmSound !== 'chime' ? [[d.alarmSound, d.alarmSound]] : []), d.alarmSound) +
          '</span>' +
        '</div>' +
        revision + stamps +
        '<div class="tm-actions">' + deleteBtn +
          '<span class="tm-actions-right">' +
            '<button type="button" class="btn btn-secondary" data-tm="back">Cancel</button>' +
            '<button type="button" class="btn btn-primary" data-tm="save">' + (isNew ? 'Add task' : 'Save changes') + '</button>' +
          '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function valOf(id) { const el = document.getElementById(id); return el ? el.value : null; }

  // Copies the form's current values into the draft so a re-render never loses typing.
  function collectDraft() {
    const ins = st.inspector;
    if (!ins || !document.getElementById('tm-f-title')) return;
    const d = ins.draft;
    ['title', 'type', 'status', 'date', 'time', 'duration', 'subjectId', 'topicId', 'targetId', 'subtaskId'].forEach(function (k) {
      const v = valOf('tm-f-' + k);
      if (v !== null) d[k] = v;
    });
    const cb = document.getElementById('tm-f-alarmEnabled');
    if (cb) d.alarmEnabled = cb.checked;
    const off = valOf('tm-f-alarmOffset'); if (off !== null) d.alarmOffset = off;
    const snd = valOf('tm-f-alarmSound'); if (snd !== null) d.alarmSound = snd;
    const rows = document.querySelectorAll('#tm-checklist .tm-cl-row');
    d.checklist = Array.prototype.map.call(rows, function (row) {
      return {
        id: row.getAttribute('data-cid') || 'c_' + rand(),
        text: row.querySelector('.tm-cl-text').value,
        completed: row.querySelector('.tm-cl-done').checked
      };
    });
  }

  function inspectorError(msg) {
    st.inspector.error = msg;
    render();
  }

  // ---------- legacy-mapped tasks ----------
  // Tasks with a 'legacy_<key>' id are owned by PlanData and mirrored into the canonical store by
  // PlanningAgentTasks.sync(). A write to the canonical copy alone is reverted by that mirror (and a completion
  // written there never reaches EXP), so date / time / status / delete go through PlanningAgent instead.
  // Canonical-only tasks keep writing to the store directly.
  function legacyKey(id) {
    const key = String(id).indexOf('legacy_') === 0 ? String(id).slice(7) : null;
    return (key && typeof PlanData !== 'undefined' && PlanData.getTask(key)) ? key : null;
  }

  function writeTask(id, up) {
    const key = legacyKey(id);
    if (!key) return Store.updateTask(id, up);
    const cur = Store.getTask(id);
    if (!cur) return { ok: false, error: 'Task not found.' };
    const rest = Object.assign({}, up);
    ['date', 'time', 'duration', 'status'].forEach(function (k) { delete rest[k]; });

    // date / time / duration -> PlanData slot (validated, conflict-checked by PlanningAgent)
    if (up.date !== undefined || up.time !== undefined || up.duration !== undefined) {
      const date = up.date !== undefined ? up.date : (cur.date || null);
      const time = date ? (up.time !== undefined ? up.time : (cur.time || null)) : null;
      const dur = time ? (up.duration !== undefined ? up.duration : (cur.duration || null)) : null;
      if (time && !dur) return { ok: false, error: 'A timed task needs a duration.' };
      const endMin = time ? toMin(time) + dur : 0;
      if (endMin >= 1440) return { ok: false, error: 'A timed task must finish before midnight.' };
      const stop = time ? minToTime(endMin) : null;
      if ((date || null) !== (cur.date || null) || (time || null) !== (cur.time || null) || (dur || null) !== (cur.duration || null)) {
        const r = PlanningAgent.updateTask(key, { date: date, startTime: time, stopTime: stop }, 'user');
        if (!r.ok) return r;
      }
    }

    // status -> completion keeps EXP / target progress; dismissed tasks are soft-hidden in PlanData too
    if (up.status !== undefined && up.status !== cur.status) {
      if (up.status === 'cancelled') { PlanData.archiveTask(key); rest.status = 'cancelled'; }
      else {
        if (cur.status === 'cancelled') { PlanData.unarchiveTask(key); rest.status = 'pending'; }
        if ((up.status === 'completed') !== (cur.status === 'completed')) PlanningAgentTasks.toggleTask(key);
      }
    }
    PlanningAgentTasks.sync();
    return Object.keys(rest).length ? Store.updateTask(id, rest) : { ok: true };
  }

  function toggleTask(id) {
    const key = legacyKey(id);
    return key ? PlanningAgentTasks.toggleTask(key) : Store.toggleTaskComplete(id);
  }

  function deleteTask(id) {
    const key = legacyKey(id);
    if (!key) return Store.deleteTask(id);
    PlanningAgent.deleteTask(key);
    PlanningAgentTasks.sync();     // sync drops the canonical mirror once PlanData no longer has it
    return { ok: true };
  }

  function saveInspector() {
    collectDraft();
    const ins = st.inspector, d = ins.draft, isNew = !ins.id;

    let duration = '';
    if (String(d.duration).trim() !== '') {
      duration = Number(d.duration);
      if (!isFinite(duration) || duration <= 0) return inspectorError('Duration must be a positive number of minutes.');
    }
    let alarm = null;
    if (d.alarmEnabled) {
      if (!d.date || !d.time) return inspectorError('A reminder needs both a date and a time.');
      const off = Number(String(d.alarmOffset).trim() === '' ? 0 : d.alarmOffset);
      if (!isFinite(off) || off < 0) return inspectorError('Reminder offset must be zero or more minutes.');
      const prev = ins.original;
      const same = prev && prev.alarm && prev.date === d.date && prev.time === d.time && prev.alarm.offsetMinutes === off;
      alarm = { enabled: true, offsetMinutes: off, sound: d.alarmSound || 'chime', notified: same ? !!prev.alarm.notified : false };
    }
    const checklist = d.checklist
      .filter(function (c) { return String(c.text).trim(); })
      .map(function (c) { return { id: c.id, text: String(c.text).trim(), completed: !!c.completed }; });

    const fields = {
      title: d.title.trim(), type: d.type, status: d.status || 'pending',
      date: d.date, time: d.time, duration: duration,
      subjectId: String(d.subjectId).trim(), topicId: String(d.topicId).trim(),
      targetId: String(d.targetId).trim(), subtaskId: String(d.subtaskId).trim()
    };

    let res;
    if (isNew) {
      const dto = {};
      Object.keys(fields).forEach(function (k) { if (fields[k] !== '') dto[k] = fields[k]; });
      if (checklist.length) dto.checklist = checklist;
      if (alarm) dto.alarm = alarm;
      res = Store.createTask(dto);
    } else {
      const up = {};
      Object.keys(fields).forEach(function (k) { up[k] = fields[k] === '' ? null : fields[k]; });
      up.checklist = checklist.length ? checklist : null;
      up.alarm = alarm;
      res = writeTask(ins.id, up);
    }
    if (!res.ok) return inspectorError(res.error || 'Could not save the task.');
    st.inspector = null;
    if (st.backToDash) { Modal.close(); PlanningAgentUI.showDashboard(); return; }
    st.message = isNew ? 'Task added.' : 'Changes saved.';
    requestRender();
  }

  // ---------- shell ----------

  function headHtml() {
    const inInspector = !!st.inspector;
    let html =
      '<div class="tm-head">' +
        '<h3 class="tm-title">Tasks</h3>' +
        '<div class="tm-head-actions">' +
          (inInspector ? '' :
                        '<button type="button" class="btn btn-primary tm-small" data-tm="plan">+ Plan</button>') +
          '<button type="button" class="tm-link" data-tm="' + (inInspector ? 'back' : 'close') + '">' + (inInspector ? (st.backToDash ? '← Back to plans' : '← Back to tasks') : 'Close') + '</button>' +
        '</div>' +
      '</div>';
    if (inInspector) return html;

    html += '<div class="tm-seg" role="tablist">' + VIEWS.map(function (v) {
      return '<button type="button" role="tab" class="tm-tab' + (st.view === v[0] ? ' on' : '') + '" aria-selected="' + (st.view === v[0]) + '" data-tm="view" data-view="' + v[0] + '">' + v[1] + '</button>';
    }).join('') + '</div>';

    if (st.view !== 'all') {
      html += '<div class="tm-nav">' +
        '<button type="button" class="btn btn-secondary tm-small" data-tm="nav" data-dir="-1" aria-label="Previous">‹</button>' +
        '<button type="button" class="btn btn-secondary tm-small" data-tm="nav" data-dir="0">Today</button>' +
        '<button type="button" class="btn btn-secondary tm-small" data-tm="nav" data-dir="1" aria-label="Next">›</button>' +
        '<span class="tm-nav-label">' + esc(navLabel()) + '</span>' +
      '</div>';
    }
    return html;
  }

  function renderHtml() {
    if (st.inspector && st.inspector.id && !Store.getTask(st.inspector.id)) {
      st.inspector = null; // deleted elsewhere
      st.message = 'That task no longer exists.';
    }
    let body;
    if (st.inspector) body = inspectorHtml();
    else if (st.view === 'week') body = weekViewHtml();
    else if (st.view === 'month') body = monthViewHtml();
    else if (st.view === 'all') body = allViewHtml();
    else body = dayViewHtml();
    const msg = st.message ? '<p class="tm-message" role="status">' + esc(st.message) + '</p>' : '';
    return '<div class="tm">' + headHtml() + msg + '<div class="tm-body">' + body + '</div></div>';
  }

  // ---------- rendering & events ----------

  let renderPending = false;
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    setTimeout(function () {
      renderPending = false;
      if (document.querySelector('.tm')) render();
    }, 0);
  }

  function focusKey() {
    const ae = document.activeElement;
    if (!ae || !ae.closest || !ae.closest('.tm')) return null;
    if (ae.id) return '#' + ae.id;
    const f = ae.getAttribute && ae.getAttribute('data-tm-filter');
    return f ? '[data-tm-filter="' + f + '"]' : null;
  }

  function render(first) {
    const content = document.getElementById('modal-content');
    const reuse = !first && content && content.querySelector('.tm');
    const body = reuse ? content.querySelector('.tm-body') : null;
    const scroll = body ? body.scrollTop : 0;
    const fk = reuse ? focusKey() : null;
    const html = renderHtml();
    st.message = ''; // messages show once
    if (reuse) content.innerHTML = html;
    else Modal.open(html, { size: 'xl' });
    bind();
    const nb = document.querySelector('.tm .tm-body');
    if (nb && scroll) nb.scrollTop = scroll;
    if (fk) { const el = document.querySelector('.tm ' + fk); if (el && el.focus) el.focus(); }
  }

  function updateResults() {
    const host = document.getElementById('tm-results');
    if (host) host.innerHTML = resultsHtml();
  }

  function onClick(e) {
    const el = e.target.closest ? e.target.closest('[data-tm]') : null;
    if (!el || !el.closest('.tm')) return;
    const a = el.getAttribute('data-tm'), id = el.getAttribute('data-id');
    let res;
    switch (a) {
            case 'close':
        Modal.close();
        if (st.backToDash && typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.showDashboard();
        break;
      case 'plan':
        if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open({ create: true, date: st.view === 'all' ? '' : st.date });
        break;
      case 'view': st.view = el.getAttribute('data-view'); render(); break;
      case 'nav': {
        const dir = Number(el.getAttribute('data-dir'));
        if (dir === 0) st.date = today();
        else if (st.view === 'day') st.date = shift(st.date, dir);
        else if (st.view === 'week') st.date = shift(st.date, 7 * dir);
        else st.date = addMonths(st.date, dir);
        render();
        break;
      }
      case 'goday': st.date = el.getAttribute('data-date'); st.view = 'day'; render(); break;
      case 'open': {
        const ins = inspectorFor(id);
        if (ins) { st.inspector = ins; } else { st.message = 'That task no longer exists.'; }
        render();
        break;
      }
      case 'toggle':
        res = toggleTask(id);
        if (!res.ok) st.message = res.error;
        requestRender();
        break;
            case 'cl-toggle':
        res = TaskChecklist.toggleItem(id, el.getAttribute('data-cid'));
        if (!res.ok) st.message = res.error;
        requestRender();
        break;
      case 'assign':
        res = writeTask(id, { date: st.date });
        st.message = res.ok ? 'Added to ' + friendly(st.date).toLowerCase() + '.' : res.error;
        requestRender();
        break;
      case 'back':
        if (st.backToDash) { st.inspector = null; Modal.close(); PlanningAgentUI.showDashboard(); break; }
        st.inspector = null; render(); break;
      case 'save': saveInspector(); break;
      case 'delete': collectDraft(); st.inspector.confirmDelete = true; render(); break;
      case 'delete-cancel': collectDraft(); st.inspector.confirmDelete = false; render(); break;
      case 'delete-confirm':
        res = deleteTask(st.inspector.id);
        if (!res.ok) { inspectorError(res.error); break; }
        if (st.backToDash) { st.inspector = null; Modal.close(); PlanningAgentUI.showDashboard(); break; }
        st.inspector = null;
        st.message = 'Task deleted.';
        requestRender();
        break;
      case 'cl-add': {
        collectDraft();
        const inp = document.getElementById('tm-cl-new');
        const text = inp ? inp.value.trim() : '';
        if (text) st.inspector.draft.checklist.push({ id: 'c_' + rand(), text: text, completed: false });
        render();
        const again = document.getElementById('tm-cl-new');
        if (again) again.focus();
        break;
      }
      case 'cl-remove':
        collectDraft();
        st.inspector.draft.checklist.splice(Number(el.getAttribute('data-idx')), 1);
        render();
        break;
      case 'quick': {
        collectDraft();
        const q = el.getAttribute('data-q'), d = st.inspector.draft, t0 = today();
        if (q === 'today') d.date = t0;
        else if (q === 'tomorrow') d.date = shift(t0, 1);
        else if (q === 'week') d.date = shift(t0, 7);
        else { d.date = ''; d.time = ''; }
        render();
        break;
      }
      case 'sort-dir': st.sort.dir = st.sort.dir === 'asc' ? 'desc' : 'asc'; render(); break;
      case 'clear-filters': st.filters = freshFilters(); render(); break;
    }
  }

  function onChange(e) {
    const t = e.target;
    if (!t.closest || !t.closest('.tm')) return;
    const fk = t.getAttribute('data-tm-filter');
    if (fk) { st.filters[fk] = t.value; render(); return; }
    if (t.id === 'tm-sort-by') { st.sort.by = t.value; render(); return; }
    if (t.id === 'tm-f-subjectId' && st.inspector) {
      collectDraft();
      st.inspector.draft.topicId = '';
      render();
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t && t.id === 'tm-search' && t.closest && t.closest('.tm')) {
      st.filters.search = t.value;
      updateResults();
    }
  }

  function onKey(e) {
    const t = e.target;
    if (!t || !t.closest || !t.closest('.tm')) return;
    if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute && t.getAttribute('data-tm') &&
        ['open', 'goday'].indexOf(t.getAttribute('data-tm')) !== -1) {
      e.preventDefault();
      onClick({ target: t });
    } else if (e.key === 'Enter' && t.id === 'tm-f-title') {
      e.preventDefault();
      saveInspector();
    } else if (e.key === 'Enter' && t.id === 'tm-cl-new') {
      e.preventDefault();
      onClick({ target: document.querySelector('[data-tm="cl-add"]') });
    }
  }

  function bind() {
    const content = document.getElementById('modal-content');
    if (!content || content._tmBound) return;
    content._tmBound = true;
    content.addEventListener('click', onClick);
    content.addEventListener('change', onChange);
    content.addEventListener('input', onInput);
    content.addEventListener('keydown', onKey);
  }

  // Re-render when tasks change from anywhere else (never while the user is mid-edit in the inspector).
  Store.subscribe(function () {
    if (typeof document !== 'undefined' && !st.inspector && document.querySelector('.tm')) requestRender();
  });

  // ---------- public API ----------
  // open({ view: 'day'|'week'|'month'|'all', date, filters: {type,subject,target,status,scheduled,search},
  //        sort: {by,dir}, taskId (opens the inspector), create (true or { date,time,title,... }) })

    function open(opts) {
    opts = opts || {};
    if (opts.create && !opts.taskId && typeof PlanningAgentUI !== 'undefined') {
      const c = opts.create === true ? {} : opts.create;
      PlanningAgentUI.open({ create: true, date: c.date || opts.date || '', title: c.title || '', subjectId: c.subjectId || '' });
      return;
    }
    st.backToDash = !!opts.backToDash;
    st.view = VIEWS.some(function (v) { return v[0] === opts.view; }) ? opts.view : 'day';
    st.date = isDateStr(opts.date) ? opts.date : today();
    st.filters = Object.assign(freshFilters(), opts.filters || {});
    st.sort = Object.assign({ by: 'date', dir: 'asc' }, opts.sort || {});
    st.message = '';
    st.inspector = null;
        if (opts.taskId) st.inspector = inspectorFor(opts.taskId);
    Store.init();
    render(true);
  }

  return {
    open: open,
    openTask: function (id) { open({ taskId: id }); },
    openCreate: function (ctx) { open({ create: ctx || true, view: (ctx && ctx.view) || 'day', date: ctx && ctx.date }); }
  };
})();

// ============================================================================
// SECTION 8 - CATCH-UP & ROUTINES (Planning Architecture, Phase 4)
// Replaces the retired Itinerary system. Overdue = status 'pending' AND date < today.
// One unified catch-up prompt: per overdue task choose Reschedule / Complete / Dismiss.
// Routines: saved templates (State.itineraryTemplates) become canonical tasks on demand.
// Entry points: PlanningAgent.evaluateOverdueTasks(), PlanningAgent.openCatchUp(),
//               PlanningAgent.generateRoutineTasks({ templateId, date }), PlanningAgentUI.openRoutines(date).
// Only this module subscribes to TimeEngine for the overdue check (id 'planning-agent-catchup').
// ============================================================================
const CatchUpUI = (function () {
  const Store = CanonicalTaskStore;
  const DAY_BUDGET_MIN = 180;   // suggested reschedule load per day
  const DEFAULT_DUR = 30;
  const CHECK_EVERY_MS = 60000;
  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  let rows = [];
  let note = '';
  let result = null;
  let promptedFor = '';
  let lastCheck = 0;
  let routineState = { date: '', note: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { return new Date(s + 'T00:00:00'); }
  function shift(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
  function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s).getTime()); }
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function toMin(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); }
  function today() {
    return PlanningAgentData.todayStr();
  }
  function topicName(id) {
    try {
      const t = PlanData.getAllTopics()[id];
      if (t && t.topicName) return t.topicName;
    } catch (e) {}
    return id;
  }
  function titleOf(t) {
    return t.title || (t.topicId ? topicName(t.topicId) : '') || t.subjectId || 'Untitled task';
  }
  function refreshViews() {
    if (typeof Library !== 'undefined' && Library.render) Library.render();
    if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel();
    if (typeof Calendar !== 'undefined' && Calendar.render) Calendar.render();
  }

  // ---------- overdue evaluation ----------

  // All pending, dated tasks whose date is before today (breaks excluded), oldest first.
  function evaluateOverdueTasks() {
    const t = today();
    return Store.getTasks({}).filter(function (x) {
      return x.status === 'pending' && x.date && x.date < t && x.type !== 'break';
    });
  }

  // One row per overdue task with a suggested new date (spread across days, DAY_BUDGET_MIN each).
  function buildCatchUpSequence(tasks) {
    const t0 = today();
    let day = t0, used = 0;
    return (tasks || []).map(function (task) {
      const dur = task.duration || DEFAULT_DUR;
      if (used > 0 && used + dur > DAY_BUDGET_MIN) { day = shift(day, 1); used = 0; }
      used += dur;
      return {
        task: task,
        daysLate: Math.max(1, Math.round((parseDate(t0) - parseDate(task.date)) / 86400000)),
        suggestedDate: day
      };
    });
  }

  // decisions: [{ id, action: 'reschedule'|'complete'|'dismiss', date }]
  function applyCatchUp(decisions) {
    const out = { rescheduled: 0, completed: 0, dismissed: 0, errors: [] };
    (decisions || []).forEach(function (d) {
      let res;
      // Legacy-mapped tasks ('legacy_<key>') are owned by PlanData and mirrored into the canonical store by
      // PlanningAgentTasks.sync(); a write to the canonical copy alone is reverted by that mirror, so they go through
      // PlanningAgent (the one write path). Canonical-only tasks keep writing to the store directly.
      const key = String(d.id).indexOf('legacy_') === 0 ? String(d.id).slice(7) : null;
      if (d.action === 'complete') {
        res = PlanningAgentTasks.toggleTask(key || d.id);
        if (res && res.ok) out.completed++;
      } else if (d.action === 'dismiss') {
        res = Store.updateTask(d.id, { status: 'cancelled' });
        if (res.ok) {
          out.dismissed++;
          if (key) {
            PlanningAgent.updateTask(key, { startTime: null, stopTime: null }, 'user'); // free the slot
            PlanData.archiveTask(key);   // PlanData owns its own copy: hide it there too so it stops counting as overdue
          }
        }
      } else {
        if (!isDateStr(d.date)) { out.errors.push('Pick a valid date.'); return; }
        if (key) {
          res = PlanningAgent.rescheduleTask(key, d.date, null, null, 'user', 'catch-up');
          if (res.ok) PlanningAgentTasks.sync();
        } else {
          res = Store.updateTask(d.id, { date: d.date, time: null });
        }
        if (res.ok) out.rescheduled++;
      }
      if (res && !res.ok) out.errors.push(res.error);
    });
    return out;
  }

  // ---------- catch-up modal ----------

  function html() {
    const t0 = today();
    let body;
    if (result) {
      const bits = [];
      if (result.rescheduled) bits.push(result.rescheduled + ' rescheduled');
      if (result.completed) bits.push(result.completed + ' completed');
      if (result.dismissed) bits.push(result.dismissed + ' dismissed');
      body = '<p class="plan-agent-hint">' + esc(bits.join(', ') || 'Nothing changed') + '.</p>' +
        (result.errors.length ? '<p class="plan-agent-hint">' + esc(result.errors.join(' ')) + '</p>' : '');
    } else if (!rows.length) {
      body = '<p class="plan-agent-hint">Nothing overdue \u2014 you\u2019re all caught up.</p>';
    } else {
      body = '<p class="plan-agent-hint">' + rows.length + ' overdue task' + (rows.length === 1 ? '' : 's') +
        '. Choose what to do with each.</p>' +
        rows.map(function (r, i) {
          const t = r.task;
          return '<div class="list-row cu-row" data-cu-row="' + i + '">' +
            '<div class="list-row-title">' + esc(titleOf(t)) + '</div>' +
            '<div class="list-row-meta">' + esc(t.date) + ' \u00b7 ' + r.daysLate + 'd late' + (t.duration ? ' \u00b7 ' + t.duration + ' min' : '') + '</div>' +
            '<div class="list-row-actions">' +
              '<select class="cu-action" data-cu-i="' + i + '" aria-label="Action">' +
                '<option value="reschedule">Reschedule</option><option value="complete">Mark done</option><option value="dismiss">Dismiss</option>' +
              '</select> ' +
              '<input type="date" class="cu-date" data-cu-i="' + i + '" value="' + esc(r.suggestedDate) + '" min="' + esc(t0) + '" aria-label="New date">' +
            '</div></div>';
        }).join('');
    }
    return '<div class="modal-header"><h2 class="modal-title">Catch up</h2>' +
        '<button type="button" class="modal-close" data-cu="close" aria-label="Close">\u00d7</button></div>' +
      '<div class="modal-body cu">' + body + '</div>' +
      '<div class="modal-footer">' +
        (rows.length && !result
          ? '<button type="button" class="btn btn-secondary" data-cu="close">Not now</button>' +
            '<button type="button" class="btn btn-primary" data-cu="apply">Apply</button>'
          : '<button type="button" class="btn btn-primary" data-cu="close">Done</button>') +
      '</div>';
  }

  function render(first) {
    const c = document.getElementById('modal-content');
    const h = html();
    if (!first && c && c.querySelector('.cu')) c.innerHTML = h;
    else Modal.open(h, { size: 'md' });
  }

  function open() {
    rows = buildCatchUpSequence(evaluateOverdueTasks());
    result = null;
    render(true);
  }

  function onChange(e) {
    const el = e.target;
    if (!el || !el.closest || !el.closest('.cu') || !el.classList.contains('cu-action')) return;
    const d = el.closest('.cu-row').querySelector('.cu-date');
    if (d) d.style.visibility = el.value === 'reschedule' ? '' : 'hidden';
  }

  function onClick(e) {
    const el = e.target.closest ? e.target.closest('[data-cu]') : null;
    if (!el) return;
    const wrap = el.closest('.modal-header, .modal-footer, .cu, .cu-routines');
    const a = el.getAttribute('data-cu');
    if (a === 'close') { Modal.close(); return; }
    if (a === 'apply') {
      const c = document.getElementById('modal-content');
      const decisions = rows.map(function (r, i) {
        const act = c.querySelector('.cu-action[data-cu-i="' + i + '"]');
        const dt = c.querySelector('.cu-date[data-cu-i="' + i + '"]');
        return { id: r.task.id, action: act ? act.value : 'reschedule', date: dt ? dt.value : r.suggestedDate };
      });
      result = applyCatchUp(decisions);
      if (typeof MiscSound !== 'undefined') MiscSound.play('uiSuccess');
      refreshViews();
      rows = buildCatchUpSequence(evaluateOverdueTasks());
      render();
      return;
    }
    if (a === 'routine') {
      const res = generateRoutineTasks({ templateId: el.getAttribute('data-id'), date: routineState.date });
      routineState.note = res.ok
        ? res.created + ' task' + (res.created === 1 ? '' : 's') + ' added' + (res.skipped ? ' (' + res.skipped + ' already there)' : '') + '.'
        : res.error;
      if (res.ok) refreshViews();
      renderRoutines();
    }
  }

  function bindOnce() {
    const c = document.getElementById('modal-content');
    if (!c) return;
    c.onclick = function (e) { if (e.target.closest && e.target.closest('.cu, .cu-routines, [data-cu]')) onClick(e); };
    c.onchange = onChange;
  }

  // ---------- routines (template -> canonical tasks) ----------

  function getRoutineTemplates() {
    const all = (typeof State !== 'undefined' && State.get().itineraryTemplates) || {};
    return Object.keys(all).map(function (k) { return all[k]; }).filter(Boolean)
      .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
  }

  function templateMatchesDate(tpl, date) {
    const s = tpl && tpl.schedule;
    if (!s) return false;
    if (s.type === 'daily') return true;
    if (s.type === 'date') return s.date === date;
    if (s.type === 'once') return tpl.scheduledFor === date;
    if (s.type === 'weekdays') {
      const dow = parseDate(date).getDay();
      return (s.days || []).some(function (d) { return String(d).toLowerCase().slice(0, 3) === DOW[dow] || Number(d) === dow; });
    }
    return false;
  }

  function typeFor(it) {
    if (it.type === 'break') return 'break';
    if (it.type === 'study') return (it.taskType === 'questions' || it.taskType === 'practice') ? 'practice' : 'study';
    return 'custom';
  }

  // Proposal only (nothing is written): the canonical task DTOs a template would create on `date`.
  // planner-task items are skipped (they already exist as canonical tasks).
  function proposeRoutine(o) {
    const opts = o || {};
    const date = isDateStr(opts.date) ? opts.date : today();
    const tpl = getRoutineTemplates().find(function (t) { return t.templateId === opts.templateId; });
    if (!tpl) return { ok: false, error: 'Routine not found.' };
    const existing = Store.getTasks({ date: date });
    let skipped = 0;
    const tasks = [];
    (tpl.items || []).forEach(function (it) {
      if (!it || it.type === 'planner-task') return;
      const dto = { title: it.label || it.topicName || 'Routine task', date: date, type: typeFor(it) };
      if (isTime(it.plannedStart)) dto.time = it.plannedStart;
      let dur = Number(it.durationMin);
      if (!(dur > 0) && isTime(it.plannedStart) && isTime(it.plannedEnd)) {
        dur = toMin(it.plannedEnd) - toMin(it.plannedStart);
        if (dur <= 0) dur += 1440;
      }
      if (dur > 0) dto.duration = dur;
      if (it.subject) dto.subjectId = it.subject;
      if (it.topicId) dto.topicId = it.topicId;
      if (it.targetId) dto.targetId = it.targetId;
      const dupe = existing.some(function (x) { return x.title === dto.title && (x.time || '') === (dto.time || '') && x.status !== 'cancelled'; });
      if (dupe) { skipped++; return; }
      tasks.push(dto);
    });
    return { ok: true, template: tpl, date: date, tasks: tasks, skipped: skipped };
  }

  // Creates the proposed tasks (idempotent: same title + time on the date is not duplicated).
  function generateRoutineTasks(o) {
    const p = proposeRoutine(o);
    if (!p.ok) return p;
    const errors = [];
    let created = 0;
    p.tasks.forEach(function (dto) {
      const r = Store.createTask(dto);
      if (r.ok) created++; else errors.push(r.error);
    });
    return { ok: !errors.length || created > 0, created: created, skipped: p.skipped, errors: errors, error: errors.join(' ') };
  }

  function renderRoutines(first) {
    const date = routineState.date;
    const list = getRoutineTemplates();
    const match = list.filter(function (t) { return templateMatchesDate(t, date); }).map(function (t) { return t.templateId; });
    const h = '<div class="modal-header"><h2 class="modal-title">Routines</h2>' +
        '<button type="button" class="modal-close" data-cu="close" aria-label="Close">\u00d7</button></div>' +
      '<div class="modal-body cu-routines">' +
        '<p class="plan-agent-hint">Add a routine to ' + esc(date) + '. Each block becomes a normal task.</p>' +
        (routineState.note ? '<p class="plan-agent-hint">' + esc(routineState.note) + '</p>' : '') +
        (list.length ? list.map(function (t) {
          const n = (t.items || []).filter(function (i) { return i && i.type !== 'planner-task'; }).length;
          return '<div class="list-row"><div class="list-row-title">' + esc(t.name) +
            (match.indexOf(t.templateId) !== -1 ? ' <span class="tag tag-neutral">scheduled for this day</span>' : '') + '</div>' +
            '<div class="list-row-meta">' + n + ' task' + (n === 1 ? '' : 's') + '</div>' +
            '<div class="list-row-actions"><button type="button" class="btn btn-secondary" data-cu="routine" data-id="' + esc(t.templateId) + '">Add</button></div></div>';
        }).join('') : '<p class="plan-agent-hint">No saved routines.</p>') +
      '</div><div class="modal-footer"><button type="button" class="btn btn-primary" data-cu="close">Done</button></div>';
    const c = document.getElementById('modal-content');
    if (!first && c && c.querySelector('.cu-routines')) c.innerHTML = h;
    else Modal.open(h, { size: 'md' });
  }

  function openRoutines(date) {
    routineState = { date: isDateStr(date) ? date : today(), note: '' };
    bindOnce();
    renderRoutines(true);
    bindOnce();
  }

  // ---------- automatic prompt (single heartbeat consumer) ----------

  function modalBusy() {
    const ov = document.getElementById('modal-overlay'), c = document.getElementById('modal-content');
    if (!ov || !c) return false;
    const cs = getComputedStyle(ov);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && c.innerHTML.trim() !== '';
  }

  // Fires at most once per calendar day, when overdue work exists and no other modal is open.
  function maybePrompt() {
    const t = today();
    if (promptedFor === t) return;
    const now = Date.now();
    if (now - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = now;
    if (!evaluateOverdueTasks().length) return;
    if (modalBusy()) { lastCheck = 0; return; }
    promptedFor = t;
    open();
  }

  function init() {
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) TimeEngine.subscribe(maybePrompt, 'planning-agent-catchup');
  }

  // Modal content is replaced on every open, so (re)bind right after open() as well.
  const _open = open;
  open = function () { _open(); bindOnce(); };

  return {
    init: init,
    open: open,
    openRoutines: openRoutines,
    evaluateOverdueTasks: evaluateOverdueTasks,
    buildCatchUpSequence: buildCatchUpSequence,
    applyCatchUp: applyCatchUp,
    getRoutineTemplates: getRoutineTemplates,
    proposeRoutine: proposeRoutine,
    generateRoutineTasks: generateRoutineTasks,
    maybePrompt: maybePrompt
  };
})();

// ============================================================================
// SECTION 9 - TARGETS, CHECKLISTS & ALARMS (Planning Architecture, Phase 5)
// Replaces targets-data.js, targets.js, alarm-data.js and alarm.js.
//   TargetsData    - goal/subgoal store (State.targets / State.subtargets) + progress maths.
//                    Same public API as the retired file, so calendar/library/progress keep working.
//   TaskChecklist  - inline checklist item toggling on canonical tasks.
//   AlarmEngine    - handleClockTick(): fires task alarms from the TimeEngine heartbeat.
// ============================================================================

const TargetsData = (function () {
  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function clamp01(n) {
    if (typeof n !== 'number' || isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function getAllTargets() { return State.get().targets || {}; }
  function getAllSubtargets() { return State.get().subtargets || {}; }
  function getTarget(targetId) { return getAllTargets()[targetId] || null; }
  function getAllTargetsList() {
    const targets = getAllTargets();
    return Object.keys(targets).map(function (id) { return targets[id]; });
  }

  function createTarget(input) {
    const targets = Object.assign({}, getAllTargets());
    const targetId = generateId('target');
    const target = {
      targetId: targetId,
      timeframe: input.timeframe || 'daily',
      dateKey: input.dateKey || todayStr(),
      title: (input.title || '').trim(),
      type: input.type || 'custom',
      targetValue: typeof input.targetValue === 'number' && input.targetValue > 0 ? input.targetValue : 1,
      currentValue: 0,
      completed: false,
      subtargets: [],
      topicId: input.topicId || null,
      note: input.note || '',
      completedNote: '',
      archived: false,
      archivedAt: null
    };
    targets[targetId] = target;
    State.set({ targets: targets });
    return target;
  }

  function updateTarget(targetId, patch) {
    const targets = Object.assign({}, getAllTargets());
    const existing = targets[targetId];
    if (!existing) return null;
    const safePatch = Object.assign({}, patch);
    if ('targetValue' in safePatch) {
      const tv = parseFloat(safePatch.targetValue);
      safePatch.targetValue = (!isNaN(tv) && tv >= 1) ? tv : existing.targetValue;
    }
    if ('currentValue' in safePatch) {
      const cv = parseFloat(safePatch.currentValue);
      const maxVal = ('targetValue' in safePatch) ? safePatch.targetValue : existing.targetValue;
      safePatch.currentValue = isNaN(cv) ? existing.currentValue : Math.max(0, Math.min(maxVal, cv));
    }
    const updated = Object.assign({}, existing, safePatch);
    targets[targetId] = updated;
    State.set({ targets: targets });
    return updated;
  }

  function deleteTarget(targetId) {
    const targets = Object.assign({}, getAllTargets());
    if (!targets[targetId]) return;
    const subtargets = Object.assign({}, getAllSubtargets());
    (targets[targetId].subtargets || []).forEach(function (sid) { delete subtargets[sid]; });
    delete targets[targetId];
    State.set({ targets: targets, subtargets: subtargets });
  }

  function archiveTarget(targetId) {
    const target = getTarget(targetId);
    if (!target || target.archived) return;
    updateTarget(targetId, { archived: true, archivedAt: todayStr() });
  }
  function unarchiveTarget(targetId) {
    const target = getTarget(targetId);
    if (!target || !target.archived) return;
    updateTarget(targetId, { archived: false, archivedAt: null });
  }
  function getArchivedTargetsList() {
    return getAllTargetsList().filter(function (t) { return t.archived; });
  }

  function getSubtargetsForTarget(targetId) {
    const target = getTarget(targetId);
    if (!target) return [];
    const subtargets = getAllSubtargets();
    return (target.subtargets || []).map(function (id) { return subtargets[id]; }).filter(Boolean);
  }

  function createSubtarget(parentTargetId, input) {
    const target = getTarget(parentTargetId);
    if (!target) return null;
    const subtargets = Object.assign({}, getAllSubtargets());
    const subtargetId = generateId('subtarget');
    const subtarget = {
      subtargetId: subtargetId,
      parentTargetId: parentTargetId,
      title: (input.title || '').trim(),
      dayAssigned: input.dayAssigned || todayStr(),
      type: input.type || target.type,
      targetValue: typeof input.targetValue === 'number' && input.targetValue > 0 ? input.targetValue : 1,
      currentValue: 0,
      completed: false
    };
    subtargets[subtargetId] = subtarget;
    const targets = Object.assign({}, getAllTargets());
    targets[parentTargetId] = Object.assign({}, target, { subtargets: (target.subtargets || []).concat([subtargetId]) });
    State.set({ subtargets: subtargets, targets: targets });
    recomputeParentCompletion(parentTargetId);
    return subtarget;
  }

  function updateSubtarget(subtargetId, patch) {
    const subtargets = Object.assign({}, getAllSubtargets());
    const existing = subtargets[subtargetId];
    if (!existing) return null;
    const safePatch = Object.assign({}, patch);
    if ('targetValue' in safePatch) {
      const tv = parseFloat(safePatch.targetValue);
      safePatch.targetValue = (!isNaN(tv) && tv >= 1) ? tv : existing.targetValue;
    }
    if ('currentValue' in safePatch) {
      const cv = parseFloat(safePatch.currentValue);
      const maxVal = ('targetValue' in safePatch) ? safePatch.targetValue : existing.targetValue;
      safePatch.currentValue = isNaN(cv) ? existing.currentValue : Math.max(0, Math.min(maxVal, cv));
    }
    const updated = Object.assign({}, existing, safePatch);
    subtargets[subtargetId] = updated;
    State.set({ subtargets: subtargets });
    recomputeParentCompletion(existing.parentTargetId);
    return updated;
  }

  function deleteSubtarget(subtargetId) {
    const subtargets = Object.assign({}, getAllSubtargets());
    const existing = subtargets[subtargetId];
    if (!existing) return;
    delete subtargets[subtargetId];
    const targets = Object.assign({}, getAllTargets());
    const parent = targets[existing.parentTargetId];
    if (parent) {
      const remaining = (parent.subtargets || []).filter(function (id) { return id !== subtargetId; });
      targets[existing.parentTargetId] = Object.assign({}, parent, {
        subtargets: remaining,
        currentValue: remaining.length === 0 ? 0 : parent.currentValue,
        completed: remaining.length === 0 ? false : parent.completed
      });
    }
    State.set({ subtargets: subtargets, targets: targets });
    recomputeParentCompletion(existing.parentTargetId);
  }

  // Parent progress = average of its subtargets' completion (each clamped 0-1).
  function recomputeParentCompletion(targetId) {
    const target = getTarget(targetId);
    if (!target || !target.subtargets || target.subtargets.length === 0) return;
    const subs = getSubtargetsForTarget(targetId);
    if (subs.length === 0) return;
    const avgPct = subs.reduce(function (sum, s) {
      return sum + clamp01(s.targetValue > 0 ? s.currentValue / s.targetValue : 0);
    }, 0) / subs.length;
    const allComplete = subs.every(function (s) { return s.completed; });
    updateTarget(targetId, { currentValue: Math.round(avgPct * target.targetValue), completed: allComplete });
    if (allComplete) archiveTarget(targetId);
  }

  function toggleTargetComplete(targetId, recordedValue) {
    const target = getTarget(targetId);
    if (!target) return null;
    const nowCompleted = !target.completed;

    if (target.subtargets && target.subtargets.length > 0) {
      target.subtargets.forEach(function (sid) {
        const sub = getAllSubtargets()[sid];
        if (!sub) return;
        updateSubtarget(sid, { completed: nowCompleted, currentValue: nowCompleted ? sub.targetValue : 0 });
      });
      recomputeParentCompletion(targetId);
      if (nowCompleted) archiveTarget(targetId); else unarchiveTarget(targetId);
      return getTarget(targetId);
    }

    const value = (target.type === 'hours' || target.type === 'questions')
      ? (typeof recordedValue === 'number' && !isNaN(recordedValue) && recordedValue >= 0 ? recordedValue : target.targetValue)
      : (nowCompleted ? target.targetValue : 0);
    const updated = updateTarget(targetId, { completed: nowCompleted, currentValue: nowCompleted ? value : 0 });

    if (typeof GamificationData !== 'undefined' && GamificationData.awardTargetCompleted) {
      if (nowCompleted) GamificationData.awardTargetCompleted(updated);
      else if (GamificationData.retractTargetCompleted) GamificationData.retractTargetCompleted(target);
    }
    if (nowCompleted) archiveTarget(targetId); else unarchiveTarget(targetId);
    return getTarget(targetId);
  }

  function toggleSubtargetComplete(subtargetId) {
    const sub = getAllSubtargets()[subtargetId];
    if (!sub) return null;
    const nowCompleted = !sub.completed;
    return updateSubtarget(subtargetId, { completed: nowCompleted, currentValue: nowCompleted ? sub.targetValue : 0 });
  }

  function setProgressValue(targetId, value) {
    const target = getTarget(targetId);
    if (!target) return null;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return null;
    const clamped = Math.max(0, Math.min(target.targetValue, parsed));
    return updateTarget(targetId, { currentValue: clamped, completed: clamped >= target.targetValue });
  }

  function getTargetsByTimeframe(timeframe) {
    return getAllTargetsList().filter(function (t) { return t.timeframe === timeframe && !t.archived; });
  }
  function isSameMonth(a, b) { return a && b && a.slice(0, 7) === b.slice(0, 7); }
  function isSameWeek(a, b) {
    if (!a || !b) return false;
    const startOfWeek = function (s) {
      const d = new Date(s + 'T00:00:00');
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    return startOfWeek(a) === startOfWeek(b);
  }
  function getTargetsForDate(dateStr) {
    return getAllTargetsList().filter(function (t) {
      if (t.archived) return false;
      if (t.timeframe === 'daily') return t.dateKey === dateStr;
      if (t.timeframe === 'weekly') return isSameWeek(t.dateKey, dateStr);
      if (t.timeframe === 'monthly') return isSameMonth(t.dateKey, dateStr);
      return false;
    });
  }
  function getTargetsForTopic(topicId) {
    return getAllTargetsList().filter(function (t) { return t.topicId === topicId && !t.archived; });
  }

  // ---------- Phase 5: dynamic progress from canonical tasks ----------
  // pct source, in order: subtargets (average) -> linked canonical tasks (custom targets: done/total)
  // -> currentValue/targetValue. Cancelled tasks never count.
  function getProgress(targetId) {
    const t = getTarget(targetId);
    if (!t) return null;
    const linked = CanonicalTaskStore.getTasks({ targetId: targetId, status: ['pending', 'completed'] });
    const taskDone = linked.filter(function (x) { return x.status === 'completed'; }).length;
    const subs = getSubtargetsForTarget(targetId);
    let ratio;
    if (subs.length) {
      ratio = subs.reduce(function (sum, s) {
        return sum + clamp01(s.targetValue > 0 ? s.currentValue / s.targetValue : 0);
      }, 0) / subs.length;
    } else if (t.type === 'custom' && linked.length) {
      ratio = taskDone / linked.length;
    } else {
      ratio = clamp01(t.targetValue > 0 ? t.currentValue / t.targetValue : 0);
    }
    return {
      pct: Math.round(ratio * 100),
      taskDone: taskDone,
      taskTotal: linked.length,
      currentValue: t.currentValue,
      targetValue: t.targetValue,
      completed: !!t.completed
    };
  }

  // Keeps custom, subtarget-less targets in step with their linked tasks. Called on every task change.
  function syncFromTasks() {
    getAllTargetsList().forEach(function (t) {
      if (t.archived || t.type !== 'custom' || (t.subtargets && t.subtargets.length)) return;
      const linked = CanonicalTaskStore.getTasks({ targetId: t.targetId, status: ['pending', 'completed'] });
      if (!linked.length) return;
      const done = linked.filter(function (x) { return x.status === 'completed'; }).length;
      const value = Math.round(t.targetValue * done / linked.length);
      const completed = done === linked.length;
      if (value !== t.currentValue || completed !== !!t.completed) {
        updateTarget(t.targetId, { currentValue: value, completed: completed });
      }
    });
  }

  return {
    createTarget: createTarget,
    updateTarget: updateTarget,
    deleteTarget: deleteTarget,
    archiveTarget: archiveTarget,
    unarchiveTarget: unarchiveTarget,
    getArchivedTargetsList: getArchivedTargetsList,
    getTarget: getTarget,
    getAllTargets: getAllTargets,
    getAllTargetsList: getAllTargetsList,
    getAllSubtargets: getAllSubtargets,
    getTargetsByTimeframe: getTargetsByTimeframe,
    getTargetsForDate: getTargetsForDate,
    getTargetsForTopic: getTargetsForTopic,
    createSubtarget: createSubtarget,
    updateSubtarget: updateSubtarget,
    deleteSubtarget: deleteSubtarget,
    getSubtargetsForTarget: getSubtargetsForTarget,
    toggleTargetComplete: toggleTargetComplete,
    toggleSubtargetComplete: toggleSubtargetComplete,
    setProgressValue: setProgressValue,
    getProgress: getProgress,
    syncFromTasks: syncFromTasks
  };
})();

function targetProgressBarHtml(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return '<span class="tm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p + '" ' +
    'style="display:inline-block;width:64px;height:6px;border-radius:3px;background:rgba(128,128,128,.25);vertical-align:middle;overflow:hidden">' +
    '<span style="display:block;height:100%;width:' + p + '%;background:currentColor"></span></span> ' +
    '<span class="tm-progress-pct">' + p + '%</span>';
}

const TaskChecklist = (function () {
  function toggleItem(taskId, itemId) {
    const t = CanonicalTaskStore.getTask(taskId);
    if (!t || !t.checklist) return { ok: false, error: 'Checklist not found.' };
    let hit = false;
    const next = t.checklist.map(function (c) {
      if (c.id !== itemId) return c;
      hit = true;
      return { id: c.id, text: c.text, completed: !c.completed };
    });
    if (!hit) return { ok: false, error: 'Checklist item not found.' };
    return CanonicalTaskStore.updateTask(taskId, { checklist: next });
  }
  function progress(task) {
    const list = (task && task.checklist) || [];
    const done = list.filter(function (c) { return c.completed; }).length;
    return { done: done, total: list.length, pct: list.length ? Math.round(done * 100 / list.length) : 0 };
  }
  return { toggleItem: toggleItem, progress: progress };
})();

const AlarmEngine = (function () {
  const SUBSCRIBER_ID = 'planning-agent-alarms';
  const GRACE_MIN = 10;                 // an alarm older than this when first seen is retired silently (no backlog)
  const MIGRATION_FLAG = 'lavender_general_alarms_migrated_v1';
  const MIGRATION_DAYS = 30;            // recurring legacy alarms are expanded into this many days of tasks
  const DAY_KEYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  let lastMinute = null;
  let migrated = false;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function asMs(x) {
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number' && isFinite(x)) return x;
    return Date.now();
  }
  function fireAtMs(t) {
    return new Date(t.date + 'T' + t.time + ':00').getTime() - t.alarm.offsetMinutes * 60000;
  }

  function modalBusy() {
    const ov = document.getElementById('modal-overlay'), c = document.getElementById('modal-content');
    if (!ov || !c) return false;
    const cs = getComputedStyle(ov);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && c.innerHTML.trim() !== '';
  }

  function trigger(t) {
    const title = t.title || 'Task reminder';
    const body = t.alarm.offsetMinutes ? 'Starts in ' + t.alarm.offsetMinutes + ' min (' + t.time + ')' : 'Starting now (' + t.time + ')';
    if (typeof Notify !== 'undefined' && Notify.deliver) Notify.deliver(title, body);
    if (typeof Modal === 'undefined' || modalBusy()) return;   // sound/notification already delivered
    Modal.open(
      '<h3 class="section-heading">Reminder</h3><p><strong>' + esc(title) + '</strong><br>' + esc(body) + '</p>' +
      '<button id="pa-alarm-open" class="btn btn-primary">Open task</button> ' +
      '<button id="pa-alarm-done" class="btn btn-secondary">Mark complete</button> ' +
      '<button id="pa-alarm-dismiss" class="btn btn-secondary">Dismiss</button>'
    );
    const on = function (id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('pa-alarm-dismiss', function () { Modal.close(); });
    on('pa-alarm-done', function () { CanonicalTaskStore.updateTask(t.id, { status: 'completed' }); Modal.close(); });
    on('pa-alarm-open', function () { TaskManagerUI.open({ taskId: t.id }); });
  }

  // Called by the TimeEngine heartbeat (every second); does real work once per minute.
  // currentTime: Date | epoch ms (defaults to now). Returns the ids of the tasks that fired.
  function handleClockTick(currentTime) {
    const now = asMs(currentTime);
    const minute = Math.floor(now / 60000);
    if (minute === lastMinute) return [];
    lastMinute = minute;
    migrateGeneralAlarms();

    const fired = [];
    CanonicalTaskStore.getTasks({ status: 'pending', scheduled: 'timed' }).forEach(function (t) {
      if (!t.alarm || !t.alarm.enabled || t.alarm.notified) return;
      const fireAt = fireAtMs(t);
      if (isNaN(fireAt) || now < Math.floor(fireAt / 60000) * 60000) return;
      const res = CanonicalTaskStore.updateTask(t.id, { alarm: Object.assign({}, t.alarm, { notified: true }) });
      if (!res.ok) return;
      if (now - fireAt > GRACE_MIN * 60000) return;            // stale: retired without firing
      trigger(t);
      fired.push(t.id);
    });
    return fired;
  }

  // One-time: legacy State.generalAlarms -> canonical tasks with an alarm (offset 0). The canonical
  // schema has no recurrence, so daily/weekday alarms become one task per matching day for 30 days.
  function migrateGeneralAlarms() {
    // Retired: standalone alarms (State.generalAlarms) are handled by general-alarm.js and are never copied into tasks.
    // The export stays so existing callers keep working; tasks already created by the old conversion are left as they are.
    return;
    if (migrated) return;
    migrated = true;
    try {
      if (localStorage.getItem(MIGRATION_FLAG) === '1') return;
      const all = (State.get() && State.get().generalAlarms) || {};
      const now = new Date(), today = fmt(now), nowHm = pad(now.getHours()) + ':' + pad(now.getMinutes());
      Object.keys(all).forEach(function (id) {
        const a = all[id];
        if (!a || !a.enabled || !a.time || !a.recurrence) return;
        const r = a.recurrence, dates = [];
        if (r.type === 'once') {
          const d = new Date(now); if (a.time <= nowHm) d.setDate(d.getDate() + 1);
          dates.push(fmt(d));
        } else if (r.type === 'date' && r.date) {
          dates.push(r.date);
        } else if (r.type === 'daily' || r.type === 'weekdays') {
          for (let i = 0; i < MIGRATION_DAYS; i++) {
            const d = new Date(now); d.setDate(d.getDate() + i);
            if (r.type === 'daily' || (r.days || []).indexOf(DAY_KEYS[d.getDay()]) !== -1) dates.push(fmt(d));
          }
        }
        dates.forEach(function (date) {
          CanonicalTaskStore.createTask({
            title: a.text || 'Alarm', type: 'custom', date: date, time: a.time,
            alarm: { enabled: true, offsetMinutes: 0, sound: 'chime', notified: date === today && a.lastFiredDate === today }
          });
        });
      });
      localStorage.setItem(MIGRATION_FLAG, '1');
    } catch (e) { console.warn('General alarm migration failed', e); }
  }

  function init() {
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) {
      TimeEngine.subscribe(function () { handleClockTick(new Date()); }, SUBSCRIBER_ID);
    }
  }

  return { init: init, handleClockTick: handleClockTick, migrateGeneralAlarms: migrateGeneralAlarms };
})();

// Goals follow their linked tasks: any task change re-syncs custom targets.
CanonicalTaskStore.subscribe(function () {
  try { TargetsData.syncFromTasks(); } catch (e) { console.warn('Target sync failed', e); }
});

// ============================================================================
// SECTION 10 - VIEW BRIDGE (Planning Architecture, Phase 6)
// Today / Calendar / Library / Assistant are consumers only: they read tasks through these
// PlanningAgent methods and open the Agent to plan. Reads come from CanonicalTaskStore.
// Tasks created through PlanningAgent.createTask (State.tasks, via PlanData) are
// reconciled into the canonical store before every read, so a new task shows up immediately.
// Returned task views carry the canonical fields AND the legacy aliases the existing views render
// (taskId, startTime, stopTime, taskType, subject, topicName, completed, archived, revisionNumber).
// ============================================================================
const PlanningAgentTasks = (function () {
  const LEGACY_PREFIX = 'legacy_';
  const TYPE_TO_LEGACY = { study: 'theory', revision: 'revision', practice: 'questions', custom: 'custom', 'break': 'custom', exercise: 'custom' };
  let syncedRef = null;
  let hasSynced = false;
  let syncing = false;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function toMin(hm) { return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)); }
  function addMin(hm, min) {
    const m = toMin(hm) + min;
    return m >= 1440 ? '' : pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function legacyKey(id) { return String(id).indexOf(LEGACY_PREFIX) === 0 ? String(id).slice(LEGACY_PREFIX.length) : null; }
  function legacyTasks() { return (typeof PlanData !== 'undefined') ? PlanData.getAllTasks() : {}; }

  // Mirrors State.tasks changes (create / reschedule / complete / delete) into legacy-mapped canonical tasks.
  function sync() {
    if (syncing || typeof State === 'undefined' || !State.get) return;
    const ref = State.get().tasks;
    if (hasSynced && ref === syncedRef) return;
    syncing = true;
    try {
      CanonicalTaskStore.getTasks();
      CanonicalTaskStore.migrateLegacyPlannerData();
      const legacy = legacyTasks();
      CanonicalTaskStore.getTasks().forEach(function (t) {
        const key = legacyKey(t.id);
        if (!key) return;
        const lt = legacy[key];
        if (!lt) { CanonicalTaskStore.deleteTask(t.id); return; }
        const start = lt.startTime || lt.savedStartTime || null;
        const stop = lt.stopTime || lt.savedStopTime || null;
        const duration = (start && stop && toMin(stop) > toMin(start)) ? toMin(stop) - toMin(start) : null;
        const status = lt.completed ? 'completed' : 'pending';
        const patch = {};
        if ((lt.date || null) !== (t.date || null)) patch.date = lt.date || null;
        if (start !== (t.time || null)) patch.time = start;
        if (duration !== (t.duration || null)) patch.duration = duration;
        if (status !== t.status && t.status !== 'cancelled') patch.status = status;
        if (lt.targetId && lt.targetId !== t.targetId) patch.targetId = lt.targetId;
        if (lt.subtargetId && lt.subtargetId !== t.subtaskId) patch.subtaskId = lt.subtargetId;
        if (lt.topicId && !t.topicId) patch.topicId = lt.topicId;   // topic stamped after mirroring; never overwrites a canonical edit
        if (Object.keys(patch).length) CanonicalTaskStore.updateTask(t.id, patch);
      });
      syncedRef = State.get().tasks;
      hasSynced = true;
    } catch (e) {
      console.warn('PlanningAgent task sync failed', e);
    } finally {
      syncing = false;
    }
  }

  function toView(t) {
    const key = legacyKey(t.id);
    const lt = key ? legacyTasks()[key] : null;
    const topic = (t.topicId && typeof PlanData !== 'undefined') ? PlanData.getAllTopics()[t.topicId] : null;
    const level = t.revisionMeta && t.revisionMeta.level;
    return Object.assign({}, t, {
      taskId: key || t.id,
      completed: t.status === 'completed',
      archived: !!(lt && lt.archived),
      startTime: t.time || '',
      stopTime: (t.time && t.duration) ? addMin(t.time, t.duration) : '',
      savedStartTime: '',
      savedStopTime: '',
      taskType: TYPE_TO_LEGACY[t.type] || 'theory',
      subject: t.subjectId || (topic && topic.subject) || '',
      topicName: (topic && topic.topicName) || t.title || '',
      revisionNumber: level ? Number(level.slice(1)) : undefined
    });
  }

  function getTasksForDateRange(from, to) {
    sync();
    return CanonicalTaskStore.getTasks({ dateFrom: from, dateTo: to })
      .filter(function (t) { return t.status !== 'cancelled'; })
      .map(toView);
  }
  function getTasksByDate(date) { return getTasksForDateRange(date, date); }
  function getIncompleteTasksForDate(date) {
    return getTasksByDate(date).filter(function (t) { return !t.completed && !t.archived; });
  }
  // Today dashboard: today's tasks that are still open.
  function getTodayTasks() { return getIncompleteTasksForDate(todayStr()); }
  // Overdue: open tasks dated before today.
  function getPendingTasks() {
    sync();
    const today = todayStr();
    return CanonicalTaskStore.getTasks({ status: 'pending' })
      .filter(function (t) { return t.date && t.date < today; })
      .map(toView)
      .filter(function (t) { return !t.archived; });
  }
  // Every open task for the Agent's Suggested tab (overdue, today, upcoming, undated). Read-only; breaks and archived excluded.
  function getOpenTasks() {
    sync();
    return CanonicalTaskStore.getTasks({ status: 'pending' })
      .map(toView)
      .filter(function (t) { return !t.archived && t.type !== 'break'; });
  }
  function getTask(id) {
    sync();
    const t = CanonicalTaskStore.getTask(id) || CanonicalTaskStore.getTask(LEGACY_PREFIX + id);
    return t ? toView(t) : null;
  }
  // Reminders for a date (timed tasks with an enabled alarm), shaped for the day calendar.
  function getAlarmsForDate(date) {
    sync();
    return CanonicalTaskStore.getTasks({ date: date, scheduled: 'timed' })
      .filter(function (t) { return t.alarm && t.alarm.enabled && t.status !== 'cancelled'; })
      .map(function (t) {
        return { id: t.id, time: t.time, text: t.title || 'Reminder', enabled: true, lastFiredDate: t.alarm.notified ? date : null };
      });
  }
  // Tasks completed today, by their real completion timestamp (not their scheduled date). Read-only, canonical view
  // objects (same shape as getTodayTasks). Unchecking a task drops it from here by itself; its date is never touched.
  function getCompletedToday() {
    sync();
    const today = todayStr();
    return CanonicalTaskStore.getTasks({ status: 'completed' }).filter(function (t) {
      if (!t.completedAt || t.type === 'break') return false;
      const d = new Date(t.completedAt);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) === today;
    }).map(toView).filter(function (t) { return !t.archived; });
  }

  // Completed work, grouped for display (Plan viewer History + Library topic timeline). Derived live from the canonical
  // store; nothing is stored, so restoring a task (back to pending) removes its entry and duplicates cannot exist.
  // A plan whose in-scope subtasks are ALL completed becomes one group entry; otherwise each completed subtask
  // stands alone with its plan as context. filter: { topicId } or { subject } (optional). Newest first.
  function getHistory(filter) {
    filter = filter || {};
    sync();
    const legacy = legacyTasks();
    const targets = (typeof TargetsData !== 'undefined') ? TargetsData.getAllTargets() : {};
    const rows = CanonicalTaskStore.getTasks({ status: ['pending', 'completed'] }).map(function (t) {
      const key = legacyKey(t.id), lt = key ? legacy[key] : null;
      return {
        id: t.id, done: t.status === 'completed', at: t.completedAt || 0, targetId: t.targetId || '', type: t.type,
        title: (lt && lt.title) || t.title || (lt && lt.topicName) || 'Task',
        topicId: t.topicId || '', subject: (lt && lt.subject) || t.subjectId || '', hidden: !!(lt && lt.archived)
      };
    }).filter(function (r) { return !r.hidden && r.type !== 'break'; });
    const inScope = function (r) {
      if (filter.topicId) return r.topicId === filter.topicId;
      return !filter.subject || r.subject === filter.subject;
    };
    const byRecent = function (a, b) { return b.at - a.at; };
    const byPlan = {}, out = [];
    rows.forEach(function (r) {
      const tg = r.targetId ? targets[r.targetId] : null;
      if (tg && tg.isPlan) (byPlan[r.targetId] = byPlan[r.targetId] || []).push(r);
      else if (r.done && inScope(r)) out.push({ kind: 'task', task: r, parent: '', at: r.at });
    });
    Object.keys(byPlan).forEach(function (tid) {
      const scope = byPlan[tid].filter(inScope), done = scope.filter(function (r) { return r.done; }).sort(byRecent);
      if (!done.length) return;
      const title = targets[tid].title || 'Plan';
      if (done.length === scope.length) out.push({ kind: 'group', targetId: tid, title: title, subs: done, at: done[0].at });
      else done.forEach(function (r) { out.push({ kind: 'task', task: r, parent: title, at: r.at }); });
    });
    // A completed plan with no subtasks at all is archived by TargetsData.toggleTargetComplete; it is history too.
    Object.keys(targets).forEach(function (tid) {
      const tg = targets[tid];
      if (!tg.isPlan || !tg.completed || !tg.archived || byPlan[tid]) return;
      if (filter.topicId ? tg.planTopicId !== filter.topicId : (filter.subject && tg.subject !== filter.subject)) return;
      out.push({ kind: 'group', targetId: tid, title: tg.title || 'Plan', subs: [], at: tg.archivedAt ? new Date(tg.archivedAt + 'T00:00:00').getTime() : 0 });
    });
    return out.sort(byRecent);
  }

  // Single completion path for every view. Legacy-mapped tasks go through PlanData so EXP awards stay correct.
  function toggleTask(id) {
    if (typeof PlanData !== 'undefined' && PlanData.getTask(id)) {
      PlanningAgent.toggleComplete(id);
      sync();
      return { ok: true };
    }
    const t = CanonicalTaskStore.getTask(id);
    if (!t) return { ok: false, error: 'Task not found.' };
    return CanonicalTaskStore.toggleTaskComplete(id);
  }

  return {
    sync: sync,
    getTasksForDateRange: getTasksForDateRange,
    getTasksByDate: getTasksByDate,
    getIncompleteTasksForDate: getIncompleteTasksForDate,
    getTodayTasks: getTodayTasks,
    getPendingTasks: getPendingTasks,
    getOpenTasks: getOpenTasks,
    getTask: getTask,
    getAlarmsForDate: getAlarmsForDate,
    getHistory: getHistory,
    getCompletedToday: getCompletedToday,
    toggleTask: toggleTask
  };
})();

if (typeof window !== 'undefined') {
  window.CanonicalTaskStore = CanonicalTaskStore;
  window.PlanningAgentData = PlanningAgentData;
  window.PlanningAgent = PlanningAgent;
  // Re-runs the idempotent legacy migration after boot, once State has loaded its saved data.
  if (document.readyState === 'complete') CanonicalTaskStore.init();
  else window.addEventListener('load', function () { CanonicalTaskStore.init(); });
  window.PlanningAgentUI = PlanningAgentUI;
  PlanningAgentUI.openManager = TaskManagerUI.open;
  window.CatchUpUI = CatchUpUI;
  PlanningAgentUI.openCatchUp = CatchUpUI.open;
  PlanningAgentUI.openRoutines = CatchUpUI.openRoutines;
  PlanningAgentUI.evaluateOverdueTasks = CatchUpUI.evaluateOverdueTasks;
  CatchUpUI.init();
  AlarmEngine.init();
  PlanningAgentUI.openAlarms = function () { TaskManagerUI.open({ view: 'all', filters: { alarm: '1' } }); };
  PlanningAgentUI.handleClockTick = AlarmEngine.handleClockTick;
  PlanningAgentUI.toggleChecklistItem = TaskChecklist.toggleItem;
  (function () {
    const PA = PlanningAgent;
    PA.evaluateOverdueTasks = CatchUpUI.evaluateOverdueTasks;
    PA.openCatchUp = CatchUpUI.open;
        PA.generateRoutineTasks = CatchUpUI.generateRoutineTasks;
    PA.open = PlanningAgentUI.open;
    PA.getTasksForDateRange = PlanningAgentTasks.getTasksForDateRange;
    PA.getTasksByDate = PlanningAgentTasks.getTasksByDate;
    PA.getIncompleteTasksForDate = PlanningAgentTasks.getIncompleteTasksForDate;
    PA.getTodayTasks = PlanningAgentTasks.getTodayTasks;
    PA.getPendingTasks = PlanningAgentTasks.getPendingTasks;
    PA.getTask = PlanningAgentTasks.getTask;
    PA.getHistory = PlanningAgentTasks.getHistory;
    PA.getCompletedToday = PlanningAgentTasks.getCompletedToday;
    PA.getAlarmsForDate = PlanningAgentTasks.getAlarmsForDate;
    PA.toggleTask = PlanningAgentTasks.toggleTask;

    // Live refresh: any task change re-renders the open views (debounced), no page reload needed.
    let viewRefreshTimer = null;
    CanonicalTaskStore.subscribe(function () {
      if (viewRefreshTimer) return;
      viewRefreshTimer = setTimeout(function () {
        viewRefreshTimer = null;
        try { if (typeof Calendar !== 'undefined' && Calendar.render) Calendar.render(); } catch (e) {}
        try { if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel(); } catch (e) {}
      }, 50);
    });
    PA.proposeRoutine = CatchUpUI.proposeRoutine;
  })();
    window.TaskManagerUI = TaskManagerUI;
  // study.js and timeengine.js still call PlannerData, whose file was retired in Phase 3.
  // PlanData has every method they use, so alias it rather than patch both files.
  if (typeof window.PlannerData === 'undefined') window.PlannerData = PlanData;
  window.Planner = {
    init: function () {},
    render: function () {},
    refreshSubjectOptions: function () {},
    openDate: function (d) { TaskManagerUI.open({ view: 'day', date: d }); },
        openHistory: function (subject) { PlanningAgentUI.open({ view: 'timeline', filterSubject: subject || '' }); },
    openPlan: function (o) { PlanningAgentUI.open(o); }
  };
  PlanningAgent.openUI = function (opts) { PlanningAgentUI.open(opts); };
}
