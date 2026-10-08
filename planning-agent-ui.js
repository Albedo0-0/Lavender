// planning-agent-ui.js — Centralized Planning Agent: User-Facing Interface
// The ONE user-facing planning interface for all of Lavender: every "plan new work" action opens this.
// Deterministic reasoning without AI/LLM network dependencies.
// Depends on: State, Modal, PlannerData, TargetsData, PlanningAgentData, PlanningAgent, ItineraryData, MiscSound.

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

const PlanningAgentUI = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }

  function todayStr() {
    return (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.todayStr === 'function')
      ? PlanningAgentData.todayStr()
      : (typeof PlannerData !== 'undefined' ? PlannerData.todayStr() : '');
  }

  function shiftDateStr(dateStr, delta) {
    if (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.shiftDateStr === 'function') {
      return PlanningAgentData.shiftDateStr(dateStr, delta);
    }
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatDateFriendly(dateStr) {
    if (!dateStr) return '';
    const today = todayStr();
    const tomorrow = shiftDateStr(today, 1);
    if (dateStr === today) return 'Today (' + dateStr + ')';
    if (dateStr === tomorrow) return 'Tomorrow (' + dateStr + ')';
    return dateStr;
  }

  // Active state within the modal
  let state = {
    prompt: '',
    intent: 'topic', // 'topic' | 'custom' | 'day' | 'pending' | 'catchup' | 'target'
    subject: '',
    topicId: '',
    taskMode: 'theory', // 'theory' | 'questions' | 'revision' | 'revision-cycle' (cycle only when explicitly chosen)
    date: '',
    targetId: '',
    customTitle: '', // free-text title for the 'custom' intent
    from: '', // 'assistant' when opened from the Assistant (enables the Back link)
    message: '', // calm inline notice (replaces alert())
    proposals: null, // array of generated proposal objects
    lastResult: null // result message after committing
  };

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

  // Earliest sensible start for a date: now (rounded up to 15m, not before 08:00) for today, else 08:00.
  function earliestStartFor(dateStr) {
    if (dateStr !== todayStr()) return '08:00';
    const now = new Date();
    const mins = Math.min(1439, Math.max(480, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15));
    return PlanningAgentData.minutesToTimeStr(mins);
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
    if (typeof PlannerData !== 'undefined') {
      const subjects = PlannerData.getAllSubjects();
      for (let i = 0; i < subjects.length; i++) {
        const s = subjects[i];
        if (text.includes(s.toLowerCase())) {
          result.subject = s;
          break;
        }
      }

      // 4. Match known topics
      const allTopics = PlannerData.getAllTopics();
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

  // ---------- Proposal Generation ----------

  function generateProposals() {
    const today = todayStr();
    const targetDate = state.date || today;
    const proposals = [];

    if (state.intent === 'topic') {
      // Must have subject & topic
      const subject = state.subject;
      const topicId = state.topicId;
      let topicName = '';
      if (topicId && typeof PlannerData !== 'undefined') {
        const t = PlannerData.getAllTopics()[topicId];
        if (t) topicName = t.topicName;
      }
      if (!topicName && topicId) topicName = topicId;
      if (!subject || !topicName) {
        return { ok: false, error: 'Choose a subject and topic, or pick \u201cSomething else\u201d.' };
      }

      if (state.taskMode === 'revision-cycle') {
        // Revision Cycle: Spaced repetition (R1-R6)
        const dur = 45;
        const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, '08:00');
        if (!slot) {
          return { ok: false, error: 'No free time slot available on ' + targetDate + '. Please pick another date or clear a slot.' };
        }

        const futureDates = PlanningAgentData.computeRevisionDates(targetDate);
        const offsets = PlanningAgentData.getRevisionOffsets();
        const labels = PlanningAgentData.getRevisionLabels();

        proposals.push({
          proposalId: 'prop_rev_cycle_' + Date.now(),
          kind: 'revision-cycle',
          subject: subject,
          topicName: topicName,
          title: subject + ' \u00b7 ' + topicName + ' (Spaced Revision Cycle)',
          baseDate: targetDate,
          startTime: slot.start,
          stopTime: slot.end,
          durationMin: dur,
          note: 'Full 6-stage spaced repetition cycle',
          futureSchedule: futureDates.map(function (d, i) {
            return { label: labels[i] || ('R' + (i + 1)), date: d, offset: offsets[i] };
          }),
          reason: 'Spaced repetition schedule (R1 base session + R2\u2013R6 spaced reviews)',
          confidence: 0.98
        });
      } else {
        // Single session: Theory, Questions, or Single Revision
        const taskType = state.taskMode;
        let dur = 50;
        if (taskType === 'questions') dur = 60;
        else if (taskType === 'revision') dur = 45;

        // Adaptive duration multiplier
        if (typeof PlanningAgentData.getDurationMultiplier === 'function') {
          const mult = PlanningAgentData.getDurationMultiplier(taskType);
          dur = Math.round(dur * mult.multiplier);
        }

        const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, '08:00');
        if (!slot) {
          return { ok: false, error: 'No free time slot found for ' + dur + 'm on ' + targetDate + '.' };
        }

        const typeLabel = taskType === 'theory' ? 'Theory Session' : (taskType === 'questions' ? 'Questions Practice' : 'Revision');
        proposals.push({
          proposalId: 'prop_single_' + Date.now(),
          kind: 'single-task',
          subject: subject,
          topicName: topicName,
          taskType: taskType,
          title: subject + ' \u00b7 ' + topicName + ' (' + typeLabel + ')',
          date: targetDate,
          startTime: slot.start,
          stopTime: slot.end,
          durationMin: dur,
          note: '',
          reason: 'Optimally placed in next free ' + (slot.start < '12:00' ? 'morning' : 'afternoon') + ' window',
          confidence: 0.92
        });
      }

    } else if (state.intent === 'custom') {
      // Free-text task (no Library topic): becomes a normal canonical custom Task on accept.
      const title = (state.customTitle || '').trim();
      if (!title) return { ok: false, error: 'Type what you want to plan first.' };
      const dur = 45;
      const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, earliestStartFor(targetDate));
      if (!slot) {
        return { ok: false, error: 'No free time slot found on ' + targetDate + '.' };
      }
      proposals.push({
        proposalId: 'prop_custom_' + Date.now(),
        kind: 'custom-task',
        title: title,
        date: targetDate,
        startTime: slot.start,
        stopTime: slot.end,
        durationMin: dur,
        note: '',
        reason: 'Placed in the next free slot',
        confidence: 0.9
      });

    } else if (state.intent === 'day') {
      // Plan entire day (due revisions + carried over overdue tasks + unslotted)
      const dayProps = PlanningAgentData.proposeScheduleForDate(targetDate);
      if (!dayProps || !dayProps.length) {
        return { ok: false, error: 'No unscheduled tasks, due revisions, or overdue carry-overs found for ' + targetDate + '.' };
      }
      dayProps.forEach(function (p) {
        proposals.push({
          proposalId: p.proposalId,
          kind: 'day-proposal',
          rawProposal: p,
          taskId: p.taskId,
          subject: p.subject || '',
          topicName: p.topicName || '',
          title: p.title,
          date: p.date,
          startTime: p.proposedStart,
          stopTime: p.proposedEnd,
          durationMin: p.durationMin,
          reason: p.reason,
          confidence: p.confidence || 0.9
        });
      });

    } else if (state.intent === 'pending') {
      // Overdue & pending work carry-forward
      const snap = PlanningAgentData.getSnapshot();
      let pending = snap.pendingTasks || [];
      if (state.subject) {
        pending = pending.filter(function (t) { return (t.subject || '').toLowerCase() === state.subject.toLowerCase(); });
      }

      if (!pending.length) {
        return { ok: false, error: 'No pending incomplete tasks found' + (state.subject ? ' for ' + state.subject : '') + '.' };
      }

      // Sort with postponement risk first
      pending.sort(function (a, b) {
        const aRisk = PlanningAgentData.isPostponementRisk(a) ? 1 : 0;
        const bRisk = PlanningAgentData.isPostponementRisk(b) ? 1 : 0;
        if (aRisk !== bRisk) return bRisk - aRisk;
        return (a.date || '').localeCompare(b.date || '');
      });

      let cursorTime = targetDate === today ? PlanningAgentData.minutesToTimeStr(Math.max(480, (new Date()).getHours() * 60 + (new Date()).getMinutes())) : '08:00';

      pending.slice(0, 4).forEach(function (t) {
        const isRisk = PlanningAgentData.isPostponementRisk(t);
        const dur = isRisk ? 35 : 45;
        const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, cursorTime);
        if (slot) {
          proposals.push({
            proposalId: 'prop_pend_' + t.taskId,
            kind: 'reschedule-task',
            taskId: t.taskId,
            subject: t.subject || '',
            topicName: t.topicName || '',
            title: (t.topicName || t.title || 'Task') + ' (Overdue)',
            date: targetDate,
            startTime: slot.start,
            stopTime: slot.end,
            durationMin: dur,
            reason: isRisk
              ? 'Overdue from ' + t.date + ' (' + (t.rescheduleCount || 1) + 'x delayed \u2014 bite-sized duration)'
              : 'Overdue from ' + t.date + ' \u2014 placed in next free slot',
            confidence: 0.88
          });
          cursorTime = PlanningAgentData.minutesToTimeStr(slot.endMin + 15);
        }
      });

      if (!proposals.length) {
        return { ok: false, error: 'Could not find free slots on ' + targetDate + ' to schedule pending tasks.' };
      }

    } else if (state.intent === 'catchup') {
      // Catch-up plan for today's itinerary
      if (typeof ItineraryData === 'undefined') {
        return { ok: false, error: 'Itinerary is not loaded.' };
      }
      const day = ItineraryData.getToday();
      if (!day || day.status !== 'in_progress') {
        return { ok: false, error: 'Catch-up is available while today\u2019s itinerary is running.' };
      }
      const plan = PlanningAgentData.computeCatchUpPlan(day);
      if (!plan.needed || !plan.changes.length) {
        return { ok: false, error: 'No delays today \u2014 everything is on track.' };
      }

      plan.changes.forEach(function (c) {
        proposals.push({
          proposalId: 'prop_catchup_' + c.itemId,
          kind: 'catchup-change',
          rawChange: c,
          taskId: c.refId,
          itemId: c.itemId,
          title: c.label || 'Itinerary Task',
          date: today,
          startTime: c.newStart,
          stopTime: c.newEnd,
          durationMin: null,
          reason: 'Pushed back to ' + c.newStart + ' (was scheduled for ' + c.originalStart + ')',
          confidence: 0.95
        });
      });

    } else if (state.intent === 'target') {
      // Allocate sessions for a target
      const targetId = state.targetId;
      if (!targetId) {
        return { ok: false, error: 'Choose a goal to plan.' };
      }
      const targetProps = PlanningAgentData.proposeTargetAllocation(targetId, targetDate);
      if (!targetProps || !targetProps.length) {
        return { ok: false, error: 'No sessions needed or no free slots found for this goal.' };
      }

      targetProps.forEach(function (tp) {
        proposals.push({
          proposalId: tp.proposalId,
          kind: 'target-allocation',
          targetId: tp.targetId,
          subtargetId: tp.subtargetId,
          title: tp.title,
          date: tp.date,
          startTime: tp.proposedStart,
          stopTime: tp.proposedEnd,
          durationMin: tp.durationMin,
          reason: tp.reason,
          confidence: tp.confidence || 0.9
        });
      });
    }

    if (!proposals.length) {
      return { ok: false, error: 'Agent could not generate any proposals for this request.' };
    }

    return { ok: true, proposals: proposals };
  }

  // ---------- Commit Proposals ----------

  function acceptProposals() {
    if (!state.proposals || !state.proposals.length) return;

    let committedCount = 0;
    const errors = [];
    const catchUpChanges = [];

    const createsTasks = state.proposals.some(function (p) {
      return p.kind === 'revision-cycle' || p.kind === 'single-task' || p.kind === 'custom-task' || p.kind === 'target-allocation';
    });
    if (createsTasks && typeof TimeEngine !== 'undefined' && TimeEngine.isManualClockActive && TimeEngine.isManualClockActive()) {
      state.message = 'Finish or reset your Stopwatch/Timer before scheduling a task.';
      render();
      return;
    }

    state.proposals.forEach(function (p) {
      if (p.kind === 'revision-cycle') {
        const res = PlanningAgent.createRevisionCycle(
          p.subject,
          p.topicName,
          p.baseDate,
          p.note || '',
          p.startTime,
          p.stopTime,
          'agent'
        );
        if (res.ok) committedCount += 6; // base + 5 revisions
        else errors.push(res.error);

      } else if (p.kind === 'single-task') {
        const res = PlanningAgent.createTask({
          subject: p.subject,
          topicName: p.topicName,
          taskType: p.taskType,
          date: p.date,
          startTime: p.startTime,
          stopTime: p.stopTime,
          note: p.note || '',
          planReason: p.reason
        }, 'agent');
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'day-proposal') {
        const res = PlanningAgent.applyProposal(p.rawProposal);
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'reschedule-task') {
        const res = PlanningAgent.rescheduleTask(
          p.taskId,
          p.date,
          p.startTime,
          p.stopTime,
          'agent',
          p.reason
        );
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'custom-task') {
        const res = PlanningAgent.createTask({
          title: p.title,
          taskType: 'custom',
          date: p.date,
          startTime: p.startTime,
          stopTime: p.stopTime,
          note: p.note || '',
          planReason: p.reason
        }, 'agent');
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'catchup-change') {
        // Applied once below through the canonical path (ItineraryData.applyCatchUpPlan).
        catchUpChanges.push(p.rawChange);

      } else if (p.kind === 'target-allocation') {
        const res = PlanningAgent.createTask({
          title: p.title,
          taskType: 'custom',
          date: p.date,
          startTime: p.startTime,
          stopTime: p.stopTime,
          targetId: p.targetId,
          subtargetId: p.subtargetId,
          planReason: p.reason
        }, 'agent');
        if (res.ok) committedCount++;
        else errors.push(res.error);
      }
    });

    if (catchUpChanges.length) {
      if (typeof ItineraryData !== 'undefined' && typeof ItineraryData.applyCatchUpPlan === 'function') {
        ItineraryData.applyCatchUpPlan(catchUpChanges);
        committedCount += catchUpChanges.length;
      } else {
        errors.push('Itinerary is not available.');
      }
    }

    if (typeof MiscSound !== 'undefined') {
      MiscSound.play('uiSuccess');
    }

    // Refresh views across Lavender
    if (typeof Planner !== 'undefined' && Planner.render) Planner.render();
    if (typeof Library !== 'undefined' && Library.render) Library.render();
    if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel();
    if (typeof Calendar !== 'undefined' && Calendar.render) Calendar.render();
    if (typeof Itinerary !== 'undefined' && Itinerary.render) Itinerary.render();

    state.lastResult = {
      committedCount: committedCount,
      errors: errors
    };
    state.proposals = null;
    render();
  }

  // ---------- HTML Rendering ----------
  // Calm, scoped markup: everything lives under .plan-agent (see style.css). No decorative panels.

  var INTENT_OPTIONS = [
    { value: 'topic', label: 'A topic from my library' },
    { value: 'custom', label: 'Something else' },
    { value: 'day', label: 'My day' },
    { value: 'pending', label: 'Overdue work' },
    { value: 'target', label: 'A goal' },
    { value: 'catchup', label: 'Catch up today' }
  ];

  var MODE_OPTIONS = [
    { value: 'theory', label: 'Study session' },
    { value: 'questions', label: 'Practice questions' },
    { value: 'revision', label: 'Revise once' },
    { value: 'revision-cycle', label: 'Spaced revision cycle (R1\u2013R6)' }
  ];

  function optionsHtml(list, selected) {
    return list.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
  }

  function fieldsHtml(currentDate) {
    const subjects = (typeof PlannerData !== 'undefined' ? PlannerData.getAllSubjects() : []);
    const dateField =
      '<div><label class="plan-agent-label" for="plan-ctrl-date">Date</label>' +
      '<input type="date" id="plan-ctrl-date" value="' + esc(currentDate) + '"></div>';

    if (state.intent === 'topic') {
      const activeSubject = state.subject || subjects[0] || '';
      const topicsMap = (typeof PlannerData !== 'undefined' ? PlannerData.getTopicsBySubject() : {});
      const topicsForSubject = topicsMap[activeSubject] || [];
      return (
        '<div class="plan-agent-row">' +
          '<div><label class="plan-agent-label" for="plan-ctrl-subject">Subject</label>' +
            '<select id="plan-ctrl-subject">' +
              subjects.map(function (s) {
                return '<option value="' + esc(s) + '"' + (s === activeSubject ? ' selected' : '') + '>' + esc(s) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div><label class="plan-agent-label" for="plan-ctrl-topic">Topic</label>' +
            '<select id="plan-ctrl-topic">' +
              (topicsForSubject.length
                ? topicsForSubject.map(function (t) {
                    return '<option value="' + esc(t.topicId) + '"' + (t.topicId === state.topicId ? ' selected' : '') + '>' + esc(t.topicName) + '</option>';
                  }).join('')
                : '<option value="">No topics yet</option>') +
            '</select></div>' +
        '</div>' +
        '<div class="plan-agent-row">' +
          '<div><label class="plan-agent-label" for="plan-ctrl-mode">How</label>' +
            '<select id="plan-ctrl-mode">' + optionsHtml(MODE_OPTIONS, state.taskMode) + '</select></div>' +
          dateField +
        '</div>'
      );
    }

    if (state.intent === 'custom') {
      return (
        '<div><label class="plan-agent-label" for="plan-ctrl-title">What do you want to plan?</label>' +
        '<input type="text" id="plan-ctrl-title" maxlength="120" placeholder="e.g. Solve 20 questions" value="' + esc(state.customTitle) + '"></div>' +
        dateField
      );
    }

    if (state.intent === 'day') {
      return dateField + '<p class="plan-agent-hint">Looks at due revisions, carried-over tasks and unscheduled work, then fits them into free time.</p>';
    }

    if (state.intent === 'pending') {
      const snap = (typeof PlanningAgentData !== 'undefined' ? PlanningAgentData.getSnapshot() : { pendingTasks: [] });
      const n = (snap.pendingTasks || []).length;
      return (
        '<div class="plan-agent-row">' +
          dateField +
          '<div><label class="plan-agent-label" for="plan-ctrl-subject">Subject</label>' +
            '<select id="plan-ctrl-subject"><option value="">All subjects</option>' +
              subjects.map(function (s) {
                return '<option value="' + esc(s) + '"' + (s === state.subject ? ' selected' : '') + '>' + esc(s) + '</option>';
              }).join('') +
            '</select></div>' +
        '</div>' +
        '<p class="plan-agent-hint">' + n + ' overdue task' + (n === 1 ? '' : 's') + '. Tasks that keep slipping get shorter sessions.</p>'
      );
    }

    if (state.intent === 'catchup') {
      return '<p class="plan-agent-hint">Running behind? Shifts the rest of today\u2019s itinerary into the next free gaps. Finished work stays as it is.</p>';
    }

    if (state.intent === 'target') {
      const active = getTargetsList().filter(function (t) { return !t.completed && !t.archived; });
      return (
        '<div class="plan-agent-row">' +
          '<div><label class="plan-agent-label" for="plan-ctrl-target">Goal</label>' +
            '<select id="plan-ctrl-target">' +
              (active.length
                ? active.map(function (t) {
                    return '<option value="' + esc(t.targetId) + '"' + (t.targetId === state.targetId ? ' selected' : '') + '>' + esc(t.title) + (t.timeframe ? ' (' + esc(t.timeframe) + ')' : '') + '</option>';
                  }).join('')
                : '<option value="">No active goals</option>') +
            '</select></div>' +
          dateField +
        '</div>'
      );
    }
    return '';
  }

  function proposalsHtml() {
    if (!state.proposals || !state.proposals.length) return '';
    return (
      '<div class="plan-agent-proposals">' +
        '<p class="plan-agent-proposals-title">' + state.proposals.length + (state.proposals.length === 1 ? ' suggestion' : ' suggestions') + '</p>' +
        '<ul class="plan-agent-list">' +
          state.proposals.map(function (p, idx) {
            const when = formatDateFriendly(p.date || p.baseDate) +
              (p.startTime ? ' \u00b7 ' + esc(p.startTime) + '\u2013' + esc(p.stopTime || '') : '');
            const followUp = (p.futureSchedule && p.futureSchedule.length)
              ? '<div class="plan-agent-item-why">Then ' + p.futureSchedule.map(function (fs) { return esc(fs.label) + ' ' + esc(fs.date); }).join(', ') + '</div>'
              : '';
            return (
              '<li class="plan-agent-item">' +
                '<div class="plan-agent-item-main">' +
                  '<div class="plan-agent-item-title">' + esc(p.title) + '</div>' +
                  '<div class="plan-agent-item-when">' + when + '</div>' +
                  (p.reason ? '<div class="plan-agent-item-why">' + esc(p.reason) + '</div>' : '') +
                  followUp +
                '</div>' +
                '<button type="button" class="plan-agent-x" data-idx="' + idx + '" aria-label="Remove this suggestion">&times;</button>' +
              '</li>'
            );
          }).join('') +
        '</ul>' +
        '<div class="plan-agent-actions">' +
          '<button type="button" id="plan-agent-cancel" class="btn btn-secondary">Cancel</button>' +
          '<button type="button" id="plan-agent-accept" class="btn btn-primary">Add to my plan</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderHtml() {
    const currentDate = state.date || todayStr();
    const head =
      '<div class="plan-agent-head">' +
        '<h3 class="plan-agent-title">Plan</h3>' +
        '<button type="button" id="plan-agent-tasks" class="plan-agent-link">All tasks</button>' +
        (state.from === 'assistant'
          ? '<button type="button" id="plan-agent-back" class="plan-agent-link">\u2190 Back</button>'
          : '<button type="button" id="plan-agent-close" class="plan-agent-link">Close</button>') +
      '</div>';

    if (state.lastResult) {
      const r = state.lastResult;
      return (
        '<div class="plan-agent">' + head +
          '<div class="plan-agent-done">' +
            '<p class="plan-agent-done-title">' + (r.committedCount ? 'All set.' : 'Nothing was added.') + '</p>' +
            (r.committedCount ? '<p class="plan-agent-muted">' + r.committedCount + (r.committedCount === 1 ? ' task' : ' tasks') + ' added to your plan.</p>' : '') +
            (r.errors.length ? '<p class="plan-agent-muted">' + r.errors.map(esc).join('<br>') + '</p>' : '') +
            '<div class="plan-agent-actions plan-agent-actions-center">' +
              '<button type="button" id="plan-agent-again" class="btn btn-secondary">Plan something else</button>' +
              '<button type="button" id="plan-agent-done" class="btn btn-primary">Done</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    return (
      '<div class="plan-agent">' + head +
        '<label class="plan-agent-label" for="plan-ctrl-intent">What would you like to plan?</label>' +
        '<select id="plan-ctrl-intent">' + optionsHtml(INTENT_OPTIONS, state.intent) + '</select>' +
        '<div class="plan-agent-fields">' + fieldsHtml(currentDate) + '</div>' +
        (state.message ? '<p class="plan-agent-message" role="status">' + esc(state.message) + '</p>' : '') +
        (state.proposals && state.proposals.length
          ? proposalsHtml()
          : '<div class="plan-agent-actions"><button type="button" id="plan-agent-go" class="btn btn-primary">Plan</button></div>') +
      '</div>'
    );
  }

  // ---------- Event Wiring ----------

  function byId(id) { return document.getElementById(id); }

  function on(id, evt, fn) {
    const el = byId(id);
    if (el) el.addEventListener(evt, fn);
  }

  function resetResults() {
    state.proposals = null;
    state.message = '';
  }

  function runPlan() {
    state.lastResult = null;
    state.message = '';
    const res = generateProposals();
    if (!res.ok) {
      state.proposals = null;
      state.message = res.error || 'Could not generate a plan.';
    } else {
      state.proposals = res.proposals;
    }
    render();
  }

  function bindEvents() {
    on('plan-agent-back', 'click', function () {
      Modal.close();
      if (typeof Assistant !== 'undefined' && Assistant.openMain) Assistant.openMain();
    });
    on('plan-agent-close', 'click', function () { Modal.close(); });
    on('plan-agent-tasks', 'click', function () { TaskManagerUI.open({}); });
    on('plan-agent-done', 'click', function () { Modal.close(); });
    on('plan-agent-again', 'click', function () { state.lastResult = null; resetResults(); render(); });

    on('plan-ctrl-intent', 'change', function (e) {
      state.intent = e.target.value;
      resetResults();
      render();
    });

    on('plan-ctrl-subject', 'change', function (e) {
      state.subject = e.target.value;
      if (state.intent === 'topic') {
        const topicsMap = (typeof PlannerData !== 'undefined' ? PlannerData.getTopicsBySubject() : {});
        const tList = topicsMap[state.subject] || [];
        state.topicId = tList.length ? tList[0].topicId : '';
      }
      resetResults();
      render();
    });
    on('plan-ctrl-topic', 'change', function (e) { state.topicId = e.target.value; resetResults(); render(); });
    on('plan-ctrl-mode', 'change', function (e) { state.taskMode = e.target.value; resetResults(); render(); });
    on('plan-ctrl-date', 'change', function (e) { state.date = e.target.value; resetResults(); render(); });
    on('plan-ctrl-target', 'change', function (e) { state.targetId = e.target.value; resetResults(); render(); });

    const titleInput = byId('plan-ctrl-title');
    if (titleInput) {
      titleInput.addEventListener('input', function () { state.customTitle = titleInput.value; });
      titleInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); state.customTitle = titleInput.value; runPlan(); }
      });
    }

    on('plan-agent-go', 'click', runPlan);

    document.querySelectorAll('.plan-agent-x').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = Number(btn.dataset.idx);
        if (state.proposals && state.proposals[idx]) {
          state.proposals.splice(idx, 1);
          if (!state.proposals.length) state.proposals = null;
          render();
        }
      });
    });

    on('plan-agent-accept', 'click', acceptProposals);
    on('plan-agent-cancel', 'click', function () { resetResults(); render(); });
  }

  function render(first) {
    const html = renderHtml();
    const content = document.getElementById('modal-content');
    // After the first open, swap the contents in place so the modal doesn't re-animate on every change.
    if (!first && content && content.querySelector('.plan-agent')) {
      content.innerHTML = html;
    } else {
      Modal.open(html, { size: 'md' });
    }
    bindEvents();
  }

  // ---------- Public Universal API ----------
  // open(context): context may carry { date, intent, subject, topicId, chapterId, targetId, title, prompt, catchup, from }.
  // chapterId is the same thing as topicId and is normalised here, at the entry boundary.

  function normalizeContext(options) {
    const o = Object.assign({}, options || {});
    if (!o.topicId && o.chapterId) o.topicId = o.chapterId;
    delete o.chapterId;
    if (o.catchup) o.intent = 'catchup';
    if (o.topicId && !o.subject && typeof PlannerData !== 'undefined') {
      const t = PlannerData.getAllTopics()[o.topicId];
      if (t) o.subject = t.subject;
    }
    return o;
  }

  function open(options) {
    const opts = normalizeContext(options);
    state.proposals = null;
    state.lastResult = null;
    state.message = '';
    state.prompt = opts.prompt || '';
    state.customTitle = opts.title || '';
    state.from = opts.from || '';
    state.intent = opts.intent || (opts.title ? 'custom' : 'topic');
    state.taskMode = 'theory'; // default: ONE Study Task. A full revision cycle only when explicitly chosen.
    state.date = opts.date || todayStr();
    state.targetId = '';

    const allSub = (typeof PlannerData !== 'undefined') ? PlannerData.getAllSubjects() : [];
    state.subject = opts.subject || allSub[0] || '';
    state.topicId = '';
    if (opts.topicId) {
      state.topicId = opts.topicId;
      state.intent = 'topic';
    } else if (state.subject && typeof PlannerData !== 'undefined') {
      const tList = PlannerData.getTopicsBySubject()[state.subject] || [];
      state.topicId = tList.length ? tList[0].topicId : '';
    }

    if (opts.targetId) {
      state.targetId = opts.targetId;
      state.intent = 'target';
    } else {
      const act = getTargetsList().filter(function (t) { return !t.completed && !t.archived; });
      state.targetId = act.length ? act[0].targetId : '';
    }

    if (opts.prompt) {
      const parsed = parseNaturalInput(opts.prompt);
      if (parsed.intent) state.intent = parsed.intent;
      if (parsed.date) state.date = parsed.date;
      if (parsed.subject) state.subject = parsed.subject;
      if (parsed.topicId) state.topicId = parsed.topicId;
      if (parsed.targetId) state.targetId = parsed.targetId;
      if (parsed.taskMode) state.taskMode = parsed.taskMode;
    }

    // An explicit context (topic, goal, day, catch-up) is already specific: show the proposal right away.
    if (opts.topicId || opts.targetId || opts.intent === 'day' || state.intent === 'catchup') {
      const res = generateProposals();
      if (res.ok) state.proposals = res.proposals;
      else state.message = res.error || '';
    }

    render(true);
  }

    return {
    open: open,
    parseNaturalInput: parseNaturalInput,
    store: CanonicalTaskStore
  };
})();

// ============================================================================
// SECTION 7 - TASK MANAGEMENT UI (Planning Architecture, Phase 2)
// The single Task Management interface: Day / Week / Month / All Tasks views, search,
// filters, sorting, and the Task Inspector (view, edit, reschedule, delete, create).
// Reads and writes ONLY through CanonicalTaskStore - no legacy planner/itinerary DOM or stores.
// Optional lookups (names only): PlannerData (subjects/topics), TargetsData (goals).
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

  function freshFilters() { return { search: '', type: '', subject: '', target: '', status: '', scheduled: '' }; }

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
    try {
      if (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.todayStr === 'function') return PlanningAgentData.todayStr();
      if (typeof PlannerData !== 'undefined' && typeof PlannerData.todayStr === 'function') return PlannerData.todayStr();
    } catch (e) {}
    return fmtDate(new Date());
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
    try { if (typeof PlannerData !== 'undefined' && PlannerData.getAllSubjects) return PlannerData.getAllSubjects() || []; } catch (e) {}
    return [];
  }
  function topicsFor(subject) {
    try {
      if (subject && typeof PlannerData !== 'undefined' && PlannerData.getTopicsBySubject) return PlannerData.getTopicsBySubject()[subject] || [];
    } catch (e) {}
    return [];
  }
  function topicName(id) {
    if (!id) return '';
    try {
      if (typeof PlannerData !== 'undefined' && PlannerData.getAllTopics) {
        const t = PlannerData.getAllTopics()[id];
        if (t && t.topicName) return t.topicName;
      }
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
    if (t.targetId) bits.push(tag('Goal: ' + targetTitle(t.targetId), 'tm-tag-neutral'));
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

  function rowHtml(t, showWhen) {
    return (
      '<li class="tm-row tm-st-' + esc(t.status) + '" data-tm="open" data-id="' + esc(t.id) + '" tabindex="0" role="button">' +
        checkHtml(t) +
        '<div class="tm-row-main">' +
          '<div class="tm-row-title">' + esc(taskTitle(t)) + (t.status === 'cancelled' ? ' <em>(cancelled)</em>' : '') + '</div>' +
          '<div class="tm-row-tags">' + chipsHtml(t) + '</div>' +
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

  function newInspector(ctx) {
    ctx = ctx || {};
    const d = draftFromTask({ status: 'pending' });
    d.date = isDateStr(ctx.date) ? ctx.date : (st.view === 'all' ? '' : st.date);
    if (ctx.time) d.time = ctx.time;
    if (ctx.title) d.title = ctx.title;
    if (ctx.type) d.type = ctx.type;
    if (ctx.subjectId) d.subjectId = ctx.subjectId;
    if (ctx.topicId) d.topicId = ctx.topicId;
    if (ctx.targetId) d.targetId = ctx.targetId;
    return { id: null, draft: d, original: null, confirmDelete: false, error: '' };
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
      res = Store.updateTask(ins.id, up);
    }
    if (!res.ok) return inspectorError(res.error || 'Could not save the task.');
    st.inspector = null;
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
            '<button type="button" class="btn btn-primary tm-small" data-tm="add">+ Add task</button>' +
            '<button type="button" class="btn btn-secondary tm-small" data-tm="plan">Plan with agent</button>') +
          '<button type="button" class="tm-link" data-tm="' + (inInspector ? 'back' : 'close') + '">' + (inInspector ? '← Back to tasks' : 'Close') + '</button>' +
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
      case 'close': Modal.close(); break;
      case 'plan':
        if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open({ date: st.view === 'all' ? '' : st.date });
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
        res = Store.toggleTaskComplete(id);
        if (!res.ok) st.message = res.error;
        requestRender();
        break;
      case 'assign':
        res = Store.updateTask(id, { date: st.date });
        st.message = res.ok ? 'Added to ' + friendly(st.date).toLowerCase() + '.' : res.error;
        requestRender();
        break;
      case 'add': st.inspector = newInspector(); render(); break;
      case 'back': st.inspector = null; render(); break;
      case 'save': saveInspector(); break;
      case 'delete': collectDraft(); st.inspector.confirmDelete = true; render(); break;
      case 'delete-cancel': collectDraft(); st.inspector.confirmDelete = false; render(); break;
      case 'delete-confirm':
        res = Store.deleteTask(st.inspector.id);
        if (!res.ok) { inspectorError(res.error); break; }
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
    st.view = VIEWS.some(function (v) { return v[0] === opts.view; }) ? opts.view : 'day';
    st.date = isDateStr(opts.date) ? opts.date : today();
    st.filters = Object.assign(freshFilters(), opts.filters || {});
    st.sort = Object.assign({ by: 'date', dir: 'asc' }, opts.sort || {});
    st.message = '';
    st.inspector = null;
    if (opts.taskId) st.inspector = inspectorFor(opts.taskId);
    else if (opts.create) st.inspector = newInspector(opts.create === true ? {} : opts.create);
    Store.init();
    render(true);
  }

  return {
    open: open,
    openTask: function (id) { open({ taskId: id }); },
    openCreate: function (ctx) { open({ create: ctx || true, view: (ctx && ctx.view) || 'day', date: ctx && ctx.date }); }
  };
})();

if (typeof window !== 'undefined') {
  window.CanonicalTaskStore = CanonicalTaskStore;
  // Re-runs the idempotent legacy migration after boot, once State has loaded its saved data.
  if (document.readyState === 'complete') CanonicalTaskStore.init();
  else window.addEventListener('load', function () { CanonicalTaskStore.init(); });
  window.PlanningAgentUI = PlanningAgentUI;
  PlanningAgentUI.openManager = TaskManagerUI.open;
  window.TaskManagerUI = TaskManagerUI;
  if (typeof PlanningAgent !== 'undefined') {
    PlanningAgent.openUI = function (opts) {
      PlanningAgentUI.open(opts);
    };
  }
}
