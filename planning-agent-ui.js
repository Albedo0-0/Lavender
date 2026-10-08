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

if (typeof window !== 'undefined') {
  window.CanonicalTaskStore = CanonicalTaskStore;
  // Re-runs the idempotent legacy migration after boot, once State has loaded its saved data.
  if (document.readyState === 'complete') CanonicalTaskStore.init();
  else window.addEventListener('load', function () { CanonicalTaskStore.init(); });
  window.PlanningAgentUI = PlanningAgentUI;
  if (typeof PlanningAgent !== 'undefined') {
    PlanningAgent.openUI = function (opts) {
      PlanningAgentUI.open(opts);
    };
  }
}
