// habit-data.js — Habit Tracker data layer. No UI here. Depends on: State.
// Canonical store for every habit. The Habit Tracker is the RECORDER only: it stores facts
// (definitions, per-date logs, order); EXP / productivity interpretation belongs to PTPE later.
//
// State.get().habits    = { habitId: { habitId, title, systemKey: null|'water'|'sleep', tagId, color,
//                           type: 'binary'|'target'|'counter', target, subHabits: [{id,title,time}],
//                           order, archived, archivedAt, reminder: null|{enabled,mode:'time'|'open',time,lastFiredDate},
//                           createdAt } }
// State.get().habitLogs = { habitId + '__' + dateStr: { habitId, date, count, completed, target, updatedAt,
//                           events?  (Water: the original waterEvents objects, unchanged),
//                           subStates?, durationMin?, dismissed? (Sleep) } }
//   completed: true/false for binary + target; null for counter (tracking only, no completion rule).
// Habits are never deleted — archived:true hides them but every log stays for PTPE analytics.
//
// WaterData / SleepData remain as thin adapters over this module, so Progress, Productivity, Journal
// and Itinerary keep reading the same shapes they always did. waterEvents / sleepRecords in State are
// the legacy archive: read once by migrateLegacy(), never written again.
const HabitData = (function () {
  const WATER_ID = 'habit_water';
  const SLEEP_ID = 'habit_sleep';
  const WATER_CAP = 24; // identical to WaterData's former HYDRATION_SCORE_CAP: 24 value-units = 10/10

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return toDateStr(new Date()); }
  function shiftDate(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  // Weeks run Monday–Sunday.
  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return toDateStr(d);
  }
  function genId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function logKey(habitId, dateStr) { return habitId + '__' + dateStr; }

  // ---------- habit definitions ----------
  function allHabits() { return State.get().habits || {}; }

  function getHabits(opts) {
    const all = allHabits();
    const includeArchived = !!(opts && opts.includeArchived);
    return Object.keys(all).map(function (id) { return all[id]; })
      .filter(function (h) { return includeArchived || !h.archived; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function getHabit(habitId) { return allHabits()[habitId] || null; }

  // Create (no habitId) or update (habitId given). Only fields passed are changed on update.
  function saveHabit(fields) {
    const habits = Object.assign({}, allHabits());
    const existing = fields.habitId ? habits[fields.habitId] : null;
    const id = existing ? existing.habitId : (fields.habitId || genId('habit'));
    const maxOrder = Object.keys(habits).reduce(function (m, k) { return Math.max(m, habits[k].order || 0); }, -1);
    habits[id] = Object.assign(
      { habitId: id, title: '', systemKey: null, tagId: null, color: '#b39ddb', type: 'binary', target: null,
        subHabits: [], order: maxOrder + 1, archived: false, archivedAt: null, reminder: null, createdAt: Date.now() },
      existing || {}, fields, { habitId: id }
    );
    State.set({ habits: habits });
    return habits[id];
  }

  // Soft-delete: hides the habit, keeps every log. System habits (Water/Sleep) cannot be archived.
  function archiveHabit(habitId) {
    const h = getHabit(habitId);
    if (!h || h.systemKey) return false;
    saveHabit({ habitId: habitId, archived: true, archivedAt: Date.now() });
    return true;
  }

  function reorder(orderedIds) {
    const habits = Object.assign({}, allHabits());
    orderedIds.forEach(function (id, i) {
      if (habits[id]) habits[id] = Object.assign({}, habits[id], { order: i });
    });
    State.set({ habits: habits });
  }

  function markReminderFired(habitId, dateStr) {
    const h = getHabit(habitId);
    if (!h || !h.reminder) return;
    saveHabit({ habitId: habitId, reminder: Object.assign({}, h.reminder, { lastFiredDate: dateStr }) });
  }

  // ---------- daily logs ----------
  function allLogs() { return State.get().habitLogs || {}; }
  function getLog(habitId, dateStr) { return allLogs()[logKey(habitId, dateStr)] || null; }

  function writeLog(habitId, dateStr, fields) {
    const logs = Object.assign({}, allLogs());
    const k = logKey(habitId, dateStr);
    logs[k] = Object.assign({ habitId: habitId, date: dateStr, count: 0, completed: false, target: null },
      logs[k] || {}, fields, { updatedAt: Date.now() });
    State.set({ habitLogs: logs });
    return logs[k];
  }

  // Generic tap for user habits. dir = -1 undoes one step. Water/Sleep go through their own entry points.
  function tap(habitId, dateStr, dir) {
    const h = getHabit(habitId);
    if (!h || h.systemKey) return null;
    const log = getLog(habitId, dateStr);
    const c = log ? (log.count || 0) : 0;
    const down = dir < 0;
    let n;
    if (h.type === 'binary') n = down ? 0 : (c >= 1 ? 0 : 1);
    else if (h.type === 'target') n = down ? Math.max(0, c - 1) : Math.min(h.target || 1, c + 1);
    else n = down ? Math.max(0, c - 1) : c + 1;
    const tgt = h.type === 'target' ? (h.target || 1) : null;
    const completed = h.type === 'counter' ? null : (h.type === 'binary' ? n >= 1 : n >= tgt);
    return writeLog(habitId, dateStr, { count: n, target: tgt, completed: completed });
  }

  // ---------- Water (adapter backing WaterData) ----------
  function sumValues(events) { return events.reduce(function (a, e) { return a + (e.value || 0); }, 0); }
  function writeWater(dateStr, events) {
    const sum = sumValues(events);
    return writeLog(WATER_ID, dateStr, { events: events, count: sum, target: WATER_CAP, completed: sum >= WATER_CAP });
  }
  function getWaterEvents(dateStr) {
    const l = getLog(WATER_ID, dateStr);
    return (l && l.events) ? l.events : [];
  }
  function getWaterEventsMap() {
    const out = {};
    const logs = allLogs();
    Object.keys(logs).forEach(function (k) {
      const l = logs[k];
      if (l.habitId === WATER_ID && l.events && l.events.length) out[l.date] = l.events;
    });
    return out;
  }
  function addWaterEvent(dateStr, event) { return writeWater(dateStr, getWaterEvents(dateStr).concat([event])); }
  function removeLastWaterEvent(dateStr) {
    const e = getWaterEvents(dateStr);
    if (e.length) writeWater(dateStr, e.slice(0, -1));
  }

  // ---------- Sleep (adapter backing SleepData) ----------
  // Legacy meaning preserved: sleepTime = previous night's bedtime, wakeTime = this date's wake time.
  function sleepFields(rec) {
    const bed = rec.sleepTime || null, wake = rec.wakeTime || null;
    return {
      subStates: { sleep: { done: !!bed, time: bed }, wake_up: { done: !!wake, time: wake } },
      durationMin: rec.durationMin == null ? null : rec.durationMin,
      dismissed: !!rec.dismissed,
      count: (bed ? 1 : 0) + (wake ? 1 : 0),
      completed: !!(bed && wake)
    };
  }
  function sleepRecordFromLog(l) {
    const s = l.subStates || {};
    const bed = (s.sleep && s.sleep.time) || null, wake = (s.wake_up && s.wake_up.time) || null;
    return { date: l.date, sleepTime: bed, wakeTime: wake, durationMin: l.durationMin == null ? null : l.durationMin,
      completed: !!(bed && wake), dismissed: !!l.dismissed };
  }
  function getSleepRecord(dateStr) {
    const l = getLog(SLEEP_ID, dateStr);
    return l ? sleepRecordFromLog(l) : null;
  }
  function getSleepRecordsMap() {
    const out = {};
    const logs = allLogs();
    Object.keys(logs).forEach(function (k) {
      if (logs[k].habitId === SLEEP_ID) out[logs[k].date] = sleepRecordFromLog(logs[k]);
    });
    return out;
  }
  function saveSleepRecord(dateStr, rec) { return writeLog(SLEEP_ID, dateStr, sleepFields(rec)); }

  // ---------- defaults + one-time, re-runnable-safe migration ----------
  function systemDefaults() {
    return [
      { habitId: WATER_ID, title: 'Water', systemKey: 'water', color: '#7fb8d9', type: 'target', target: WATER_CAP, order: 0 },
      { habitId: SLEEP_ID, title: 'Sleep', systemKey: 'sleep', color: '#b39ddb', type: 'binary', order: 1,
        subHabits: [{ id: 'wake_up', title: 'Wake up', time: '07:30' }, { id: 'sleep', title: 'Sleep', time: '23:00' }] }
    ];
  }

  // Adds Water / Sleep only if no habit with that systemKey exists. Never touches existing habits.
  function ensureSystemHabits() {
    const habits = allHabits();
    const have = {};
    Object.keys(habits).forEach(function (id) { if (habits[id].systemKey) have[habits[id].systemKey] = true; });
    const missing = systemDefaults().filter(function (d) { return !have[d.systemKey]; });
    missing.forEach(function (d) { saveHabit(d); });
    return missing.length > 0;
  }

  // Folds legacy waterEvents / sleepRecords into habitLogs. Guarded by habitsMigrated AND merges by
  // event id / existing-log-wins, so running it again can never duplicate or overwrite. Legacy keys
  // are left untouched (archive); nothing is deleted from storage.
  function migrateLegacy() {
    const s = State.get();
    if (s.habitsMigrated) return;
    ensureSystemHabits();
    const logs = Object.assign({}, allLogs());

    const wev = s.waterEvents || {};
    Object.keys(wev).forEach(function (date) {
      const k = logKey(WATER_ID, date);
      const cur = logs[k];
      const merged = (cur && cur.events ? cur.events : []).slice();
      const seen = {};
      merged.forEach(function (e) { seen[e.id || ('at' + e.at)] = true; });
      (wev[date] || []).forEach(function (e) {
        const id = e && (e.id || ('at' + e.at));
        if (e && !seen[id]) { seen[id] = true; merged.push(e); }
      });
      if (!merged.length) return;
      merged.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
      const sum = sumValues(merged);
      logs[k] = Object.assign({ habitId: WATER_ID, date: date, updatedAt: Date.now() }, cur,
        { events: merged, count: sum, target: WATER_CAP, completed: sum >= WATER_CAP });
    });

    const srec = s.sleepRecords || {};
    Object.keys(srec).forEach(function (date) {
      const k = logKey(SLEEP_ID, date);
      if (logs[k] || !srec[date]) return; // existing habit log always wins
      logs[k] = Object.assign({ habitId: SLEEP_ID, date: date, target: null, updatedAt: Date.now() }, sleepFields(srec[date]));
    });

    State.set({ habitLogs: logs, habitsMigrated: true });
  }

  function init() {
    ensureSystemHabits();
    migrateLegacy();
  }

  return {
    WATER_ID: WATER_ID, SLEEP_ID: SLEEP_ID, WATER_CAP: WATER_CAP,
    init: init, ensureSystemHabits: ensureSystemHabits, migrateLegacy: migrateLegacy,
    todayStr: todayStr, shiftDate: shiftDate, weekStart: weekStart,
    getHabits: getHabits, getHabit: getHabit, saveHabit: saveHabit, archiveHabit: archiveHabit,
    reorder: reorder, markReminderFired: markReminderFired,
    getLog: getLog, tap: tap,
    getWaterEvents: getWaterEvents, getWaterEventsMap: getWaterEventsMap,
    addWaterEvent: addWaterEvent, removeLastWaterEvent: removeLastWaterEvent,
    getSleepRecord: getSleepRecord, getSleepRecordsMap: getSleepRecordsMap, saveSleepRecord: saveSleepRecord
  };
})();
