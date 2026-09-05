// timeengine.js — unified Time Engine. Single source of truth for ALL timing/session state:
// timetable session times, running session, breaks, pauses, start/stop prompts, 3-min timeout,
// 5-min auto-breaks, alarm timing, relative schedule shifting, session records.
// Depends on: State, PlannerData. Must load AFTER planner-data.js and BEFORE study.js.
//
// Persisted state:
//   State.get().timeEngine        -> header/control state (see defaultEngine())
//   State.get().sessionRecords    -> { sessionId: SessionRecord }
//   State.get().timeEngineBreaks  -> [ { id, date, type: 'auto'|'global'|'manual', durationMs, startedAt } ]
//
// SessionRecord:
//   taskId is null for a standalone Stopwatch/Timer record (see recordStandaloneStudy) —
//   those carry a `source: 'stopwatch'|'timer'` tag instead and are created already 'completed'.
//   { sessionId, taskId, date,
//     plannedStart, plannedEnd,      // 'HH:MM' as originally scheduled in Planner
//     adjustedStart, adjustedEnd,    // 'HH:MM' current, shifts with breaks/pauses
//     actualStart, actualEnd,        // timestamps (ms) or null
//     state: 'scheduled'|'active'|'paused'|'completed'|'rescheduled'|'stale',
//     studyMs, breakMs,              // accumulated (finalized) durations
//     activeSince, pausedSince,      // timestamps (ms) or null — live deltas computed from these
//     endPromptFired, createdAt }

const TimeEngine = (function () {
  const START_BREAK_MS = 10 * 60 * 1000;   // "Need a break" default at a start prompt
  const END_BREAK_MS = 10 * 60 * 1000;     // "Need a break" default at an end/stop prompt
  const PROMPT_TIMEOUT_MS = 3 * 60 * 1000; // 3-minute unanswered timeout
  const AUTO_BREAK_MS = 5 * 60 * 1000;     // automatic break length when a prompt times out
  const RETENTION_DAYS = 14;               // days of full-detail sessionRecords/timeEngineBreaks kept before rollup


  const listeners = [];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function timeStrToMs(dateStr, hhmm) { return new Date(dateStr + 'T' + hhmm + ':00').getTime(); }
  function hhmmFromMs(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function genId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  // ---------- persistence helpers ----------

  function defaultEngine(dateStr) {
    return { date: dateStr || todayStr(), activeSessionId: null, shiftMs: 0, prompt: null, globalBreak: null, manualBreakUntil: null };
  }
  function getEngine() { return State.get().timeEngine || defaultEngine(); }
  function setEngine(partial) { State.set({ timeEngine: Object.assign({}, getEngine(), partial) }); }

  function getRecords() { return State.get().sessionRecords || {}; }
  function setRecords(records) { State.set({ sessionRecords: records }); }
  function upsertRecord(rec) { const r = Object.assign({}, getRecords()); r[rec.sessionId] = rec; setRecords(r); }
  function updateRecord(sessionId, partial) {
    const r = Object.assign({}, getRecords());
    if (!r[sessionId]) return;
    r[sessionId] = Object.assign({}, r[sessionId], partial);
    setRecords(r);
  }
  function getRecord(sessionId) { return getRecords()[sessionId] || null; }
  function getRecordsForDate(dateStr) {
    const r = getRecords();
    return Object.keys(r).map(function (id) { return r[id]; }).filter(function (rec) { return rec.date === dateStr; });
  }

  function pushBreak(dateStr, type, durationMs) {
    const list = (State.get().timeEngineBreaks || []).slice();
    list.push({ id: genId('brk'), date: dateStr, type: type, durationMs: durationMs, startedAt: Date.now() });
    State.set({ timeEngineBreaks: list });
  }

  // ---------- retention: roll old daily detail into summaries, then prune (approved approach) ----------

  function getSummaries() { return State.get().dailySummaries || {}; }
  function setSummaries(summaries) { State.set({ dailySummaries: summaries }); }
  function getDailySummary(dateStr) { return getSummaries()[dateStr] || null; }

  function daysAgo(dateStr, refDateStr) {
    const a = new Date(dateStr + 'T00:00:00').getTime();
    const b = new Date(refDateStr + 'T00:00:00').getTime();
    return Math.round((b - a) / 86400000);
  }

  function summarizeDate(dateStr) {
    const recs = getRecordsForDate(dateStr);
    let studyMs = 0, breakMs = 0;
    recs.forEach(function (rec) { studyMs += liveStudyMs(rec); breakMs += liveBreakMs(rec); });
    (State.get().timeEngineBreaks || []).filter(function (b) { return b.date === dateStr; }).forEach(function (b) { breakMs += b.durationMs; });
    return {
      date: dateStr,
      studyMs: studyMs,
      breakMs: breakMs,
      tasksTotal: recs.length,
      tasksCompleted: recs.filter(function (r) { return r.state === 'completed'; }).length
    };
  }

  // Rolls any sessionRecords/timeEngineBreaks older than RETENTION_DAYS into dailySummaries,
  // then drops the raw entries for those dates. Runs once per day (from ensureDate's rollover),
  // scans all dates each time so it also catches any backlog.
  function pruneOldRecords(today) {
    const records = getRecords();
    const breaks = State.get().timeEngineBreaks || [];
    const staleDates = {};
    Object.keys(records).forEach(function (id) {
      if (daysAgo(records[id].date, today) > RETENTION_DAYS) staleDates[records[id].date] = true;
    });
    breaks.forEach(function (b) { if (daysAgo(b.date, today) > RETENTION_DAYS) staleDates[b.date] = true; });
    const staleList = Object.keys(staleDates);
    if (!staleList.length) return;

    const summaries = Object.assign({}, getSummaries());
    staleList.forEach(function (d) { summaries[d] = summarizeDate(d); });

    const keptRecords = {};
    Object.keys(records).forEach(function (id) { if (!staleDates[records[id].date]) keptRecords[id] = records[id]; });
    const keptBreaks = breaks.filter(function (b) { return !staleDates[b.date]; });

    setSummaries(summaries);
    setRecords(keptRecords);
    State.set({ timeEngineBreaks: keptBreaks });
  }

  // ---------- rollover ----------

  function ensureDate() {
    const today = todayStr();
    const engine = getEngine();
    if (engine.date === today) return;
    // finalize any still-open session from a previous day as stale (refresh-safe, no data loss).
    const active = engine.activeSessionId ? getRecord(engine.activeSessionId) : null;
    if (active && !active.actualEnd) {
      const studyMs = (active.studyMs || 0) + (active.state === 'active' && active.activeSince ? Date.now() - active.activeSince : 0);
      updateRecord(active.sessionId, { state: 'stale', actualEnd: Date.now(), studyMs: studyMs, activeSince: null, pausedSince: null });
    }
    pruneOldRecords(today);
    setEngine(defaultEngine(today));
  }

  // ---------- session creation ----------

  function findOpenRecordForTask(taskId, dateStr) {
    return getRecordsForDate(dateStr).find(function (r) {
      return r.taskId === taskId && r.state !== 'rescheduled' && r.state !== 'completed' && r.state !== 'stale';
    }) || null;
  }

  function syncSessionsForToday() {
    const today = todayStr();
    const tasks = PlannerData.getTasksForDate(today).filter(function (t) { return t.startTime && t.stopTime && !t.completed; });
    const engine = getEngine();
    tasks.forEach(function (task) {
      if (findOpenRecordForTask(task.taskId, today)) return;
      const rec = {
        sessionId: genId('sess'),
        taskId: task.taskId,
        date: today,
        plannedStart: task.startTime,
        plannedEnd: task.stopTime,
        adjustedStart: hhmmFromMs(timeStrToMs(today, task.startTime) + (engine.shiftMs || 0)),
        adjustedEnd: hhmmFromMs(timeStrToMs(today, task.stopTime) + (engine.shiftMs || 0)),
        actualStart: null,
        actualEnd: null,
        state: 'scheduled',
        studyMs: 0,
        breakMs: 0,
        activeSince: null,
        pausedSince: null,
        endPromptFired: false,
        createdAt: Date.now()
      };
      upsertRecord(rec);
    });
  }

  // ---------- shifting (Global Break / need-break / need-more-time) ----------

  // Recomputes adjustedStart/adjustedEnd for every not-yet-started session today from its
  // ORIGINAL planned time + the engine's total cumulative shift. Composing shifts this way
  // (instead of stacking deltas) keeps relative gaps intact and avoids overlaps/drift.
  function applyShift(deltaMs) {
    const engine = getEngine();
    const newShift = (engine.shiftMs || 0) + deltaMs;
    setEngine({ shiftMs: newShift });
    const today = todayStr();
    getRecordsForDate(today).forEach(function (rec) {
      if (rec.state !== 'scheduled') return;
      updateRecord(rec.sessionId, {
        adjustedStart: hhmmFromMs(timeStrToMs(today, rec.plannedStart) + newShift),
        adjustedEnd: hhmmFromMs(timeStrToMs(today, rec.plannedEnd) + newShift)
      });
    });
  }

  // Extends the CURRENTLY ACTIVE session's own adjustedEnd (a break/extension taken mid-session)
  // and separately shifts every other still-scheduled session by the same amount.
  function extendActiveAndShift(deltaMs) {
    const active = getActiveSession();
    if (active) {
      updateRecord(active.sessionId, {
        adjustedEnd: hhmmFromMs(timeStrToMs(active.date, active.adjustedEnd) + deltaMs),
        endPromptFired: false
      });
    }
    applyShift(deltaMs);
  }

  // ---------- pause/resume primitives (no shifting side-effects — callers decide shifting) ----------

  function pauseSessionInternal(sessionId) {
    const rec = getRecord(sessionId);
    if (!rec || rec.state !== 'active') return;
    const studyMs = (rec.studyMs || 0) + (rec.activeSince ? Date.now() - rec.activeSince : 0);
    updateRecord(sessionId, { state: 'paused', studyMs: studyMs, activeSince: null, pausedSince: Date.now() });
  }

  function resumeSessionInternal(sessionId) {
    const rec = getRecord(sessionId);
    if (!rec || rec.state !== 'paused') return;
    const breakMs = (rec.breakMs || 0) + (rec.pausedSince ? Date.now() - rec.pausedSince : 0);
    updateRecord(sessionId, { state: 'active', breakMs: breakMs, activeSince: Date.now(), pausedSince: null });
  }

  // ---------- public actions ----------

  function getActiveSession() {
    const engine = getEngine();
    return engine.activeSessionId ? getRecord(engine.activeSessionId) : null;
  }

  function isSessionActive() { return !!getEngine().activeSessionId; }

  function getPrompt() { return getEngine().prompt; }

  function getUpcomingSession() {
    const today = todayStr();
    const candidates = getRecordsForDate(today).filter(function (r) { return r.state === 'scheduled'; });
    candidates.sort(function (a, b) { return a.adjustedStart < b.adjustedStart ? -1 : 1; });
    return candidates[0] || null;
  }

  function beginActiveSession(sessionId) {
    const rec = getRecord(sessionId);
    if (!rec) return;
    const now = Date.now();
    // Anchor this session's own end to the ACTUAL start time + its originally planned duration,
    // not to the original wall-clock stop time. Whatever caused the late start (an explicit break,
    // a slow tap on "Started", anything) the person still gets the full duration they planned for —
    // e.g. a 10:00-11:00 task started at 10:10 now ends at 11:10, not 11:00.
    const durationMs = timeStrToMs(rec.date, rec.plannedEnd) - timeStrToMs(rec.date, rec.plannedStart);
    updateRecord(sessionId, {
      state: 'active',
      actualStart: now,
      activeSince: now,
      studyMs: 0,
      breakMs: 0,
      adjustedStart: hhmmFromMs(now),
      adjustedEnd: hhmmFromMs(now + Math.max(0, durationMs))
    });
    setEngine({ activeSessionId: sessionId, prompt: null });
  }
  // "Started" chosen at a START prompt (or Study's "Start Now" shortcut, or Planner's "Start in Study").
  function startTaskSession(taskId) {
    if (isSessionActive()) return;
    syncSessionsForToday();
    let rec = findOpenRecordForTask(taskId, todayStr());
    if (!rec) return; // task has no valid slot today
    beginActiveSession(rec.sessionId);
    if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('study');
    notify();
  }

  // Resolve whichever prompt (start or end) is currently showing.
  function resolvePrompt(choice, minutes) {
    const engine = getEngine();
    const prompt = engine.prompt;
    if (!prompt) return;

    if (prompt.kind === 'start') {
      if (choice === 'start') {
        beginActiveSession(prompt.sessionId);
      } else if (choice === 'break') {
        applyShift(START_BREAK_MS);
        pushBreak(todayStr(), 'manual', START_BREAK_MS);
        setEngine({ prompt: null });
      } else if (choice === 'time') {
        applyShift(Math.max(1, minutes || 1) * 60 * 1000);
        setEngine({ prompt: null });
      }
    } else if (prompt.kind === 'end') {
      if (choice === 'start') { // "Started" == keep going a bit longer
        extendActiveAndShift(END_CONTINUE_MS);
        setEngine({ prompt: null });
      } else if (choice === 'break') {
        extendActiveAndShift(END_BREAK_MS);
        const active = getActiveSession();
        if (active) {
          pauseSessionInternal(active.sessionId);
          setEngine({ prompt: null, manualBreakUntil: Date.now() + END_BREAK_MS });
        } else {
          setEngine({ prompt: null });
        }
      } else if (choice === 'time') {
        extendActiveAndShift(Math.max(1, minutes || 1) * 60 * 1000);
        setEngine({ prompt: null });
      }
    }
    notify();
  }

  function pauseActive() {
    const active = getActiveSession();
    if (!active) return;
    pauseSessionInternal(active.sessionId);
    notify();
  }

  function resumeActive() {
    const active = getActiveSession();
    if (!active || active.state !== 'paused') return;
    const pauseDur = active.pausedSince ? Date.now() - active.pausedSince : 0;
    resumeSessionInternal(active.sessionId);
    // Extend the session's own adjustedEnd by however long the pause actually lasted (not just
    // a fixed default like the prompt-driven breaks), and shift the rest of the day the same amount —
    // otherwise a manual mid-session pause would silently shorten the remaining study time.
    extendActiveAndShift(pauseDur);
    notify();
  }

  function completeActive() {
    const active = getActiveSession();
    if (!active) return;
    const studyMs = (active.studyMs || 0) + (active.state === 'active' && active.activeSince ? Date.now() - active.activeSince : 0);
    updateRecord(active.sessionId, { state: 'completed', actualEnd: Date.now(), studyMs: studyMs, activeSince: null, pausedSince: null });
    if (!PlannerData.getAllTasks()[active.taskId].completed) PlannerData.toggleComplete(active.taskId);
    setEngine({ activeSessionId: null, prompt: null, manualBreakUntil: null });
    notify();
  }

  // "Do it later" — works on the active session's task OR any scheduled task for today.
  // Returns true on success, false if the task's slot would overlap an existing slot on the
  // target date (nothing is touched in that case — caller should tell the user and let them
  // pick a different date/time instead of silently creating an overlapping schedule).
  function doItLater(taskId, newDateStr) {
    const today = todayStr();
    const rec = findOpenRecordForTask(taskId, today);
    const task = PlannerData.getAllTasks()[taskId];
    if (!task) return false;
    if (PlannerData.hasSlotConflict(newDateStr, task.startTime, task.stopTime, taskId)) return false;
    const engine = getEngine();
    if (rec && engine.activeSessionId === rec.sessionId) {
      const studyMs = (rec.studyMs || 0) + (rec.state === 'active' && rec.activeSince ? Date.now() - rec.activeSince : 0);
      updateRecord(rec.sessionId, { state: 'rescheduled', actualEnd: Date.now(), studyMs: studyMs, activeSince: null, pausedSince: null });
      setEngine({ activeSessionId: null, prompt: null, manualBreakUntil: null });
    } else if (rec) {
      updateRecord(rec.sessionId, { state: 'rescheduled' });
      if (engine.prompt && engine.prompt.sessionId === rec.sessionId) setEngine({ prompt: null });
    }
    PlannerData.rescheduleTask(taskId, newDateStr, task.startTime, task.stopTime);
    notify();
    return true;
  }

  function startGlobalBreak(minutes) {
    const engine = getEngine();
    if (engine.globalBreak && engine.globalBreak.active) return false;
    const breakMs = Math.max(1, minutes || 1) * 60 * 1000;
    const active = getActiveSession();
    let pausedActiveSession = false;
    if (active && active.state === 'active') { pauseSessionInternal(active.sessionId); pausedActiveSession = true; }
    // an open prompt's timeout clock is pushed back so it doesn't unfairly expire mid-break.
    const promptNow = getEngine().prompt;
    const shiftedPrompt = promptNow && !promptNow.autoBreakActive
      ? Object.assign({}, promptNow, { deadline: promptNow.deadline + breakMs })
      : promptNow;
    applyShift(breakMs);
    // Only log a standalone break entry when there's no paused session to track it instead —
    // if we just paused the active session, its own breakMs (finalized on resume) already
    // covers this time in getDayStats, and pushBreak here would double-count it.
    if (!pausedActiveSession) pushBreak(todayStr(), 'global', breakMs);
    setEngine({ prompt: shiftedPrompt, globalBreak: { active: true, resumeAt: Date.now() + breakMs, startedAt: Date.now(), pausedActiveSession: pausedActiveSession } });
    notify();
    return true;
  }

  function getGlobalBreak() { return getEngine().globalBreak; }

  // ---------- tick (single heartbeat for the whole app) ----------

  function processGlobalBreak() {
    const engine = getEngine();
    const gb = engine.globalBreak;
    if (!gb || !gb.active) return;
    if (Date.now() < gb.resumeAt) return;
    if (gb.pausedActiveSession) resumeSessionInternal(engine.activeSessionId);
    setEngine({ globalBreak: null });
  }

  function processPrompt() {
    const engine = getEngine();
    const prompt = engine.prompt;
    if (!prompt) return;
    const now = Date.now();
    if (prompt.autoBreakActive) {
      if (now >= prompt.autoBreakResumeAt) {
        if (prompt.autoPaused) resumeSessionInternal(prompt.sessionId);
        setEngine({ prompt: Object.assign({}, prompt, { autoBreakActive: false, autoPaused: false, fireAt: now, deadline: now + PROMPT_TIMEOUT_MS }) });
      }
      return;
    }
    if (now < prompt.deadline) return;
    // unanswered for 3 minutes -> automatic 5-minute break, then re-ask.
    let autoPaused = false;
    if (prompt.kind === 'end') {
      const active = getActiveSession();
      if (active && active.sessionId === prompt.sessionId && active.state === 'active') { pauseSessionInternal(active.sessionId); autoPaused = true; }
      extendActiveAndShift(AUTO_BREAK_MS);
      // No pushBreak here: the paused session's own breakMs (finalized on resume, below) already
      // accounts for this time in getDayStats — an extra pushBreak would double-count it.
    } else {
      applyShift(AUTO_BREAK_MS);
      pushBreak(todayStr(), 'auto', AUTO_BREAK_MS);
    }
    setEngine({ prompt: Object.assign({}, prompt, { autoBreakActive: true, autoPaused: autoPaused, autoBreakResumeAt: now + AUTO_BREAK_MS, autoBreakCount: (prompt.autoBreakCount || 0) + 1 }) });
  }

  function processManualBreak() {
    const engine = getEngine();
    if (!engine.manualBreakUntil) return;
    if (Date.now() < engine.manualBreakUntil) return;
    const active = getActiveSession();
    if (active && active.state === 'paused') resumeSessionInternal(active.sessionId);
    setEngine({ manualBreakUntil: null });
  }

  function detectDue() {
    const engine = getEngine();
    if (engine.prompt) return;
    if (engine.globalBreak && engine.globalBreak.active) return;
    const now = Date.now();
    const today = todayStr();

    const active = getActiveSession();
    if (active) {
      if (active.state === 'active' && !active.endPromptFired) {
        const stopMs = timeStrToMs(today, active.adjustedEnd);
        if (now >= stopMs) {
          updateRecord(active.sessionId, { endPromptFired: true });
          setEngine({ prompt: { sessionId: active.sessionId, taskId: active.taskId, kind: 'end', fireAt: now, deadline: now + PROMPT_TIMEOUT_MS, autoBreakActive: false, autoBreakCount: 0 } });
        }
      }
      return; // only one focus session at a time — no start prompts while one is running/paused
    }

    const next = getUpcomingSession();
    if (!next) return;
    const startMs = timeStrToMs(today, next.adjustedStart);
    if (now >= startMs) {
      setEngine({ prompt: { sessionId: next.sessionId, taskId: next.taskId, kind: 'start', fireAt: now, deadline: now + PROMPT_TIMEOUT_MS, autoBreakActive: false, autoBreakCount: 0 } });
    }
  }

  function tick() {
    ensureDate();
    syncSessionsForToday();
    processGlobalBreak();
    processManualBreak();
    processPrompt();
    detectDue();
    notify();
  }

  // ---------- read-only helpers for UI / Progress ----------

  function liveStudyMs(rec) { return (rec.studyMs || 0) + (rec.state === 'active' && rec.activeSince ? Date.now() - rec.activeSince : 0); }
  function liveBreakMs(rec) { return (rec.breakMs || 0) + (rec.state === 'paused' && rec.pausedSince ? Date.now() - rec.pausedSince : 0); }

  function getClockDisplayMs() {
    const active = getActiveSession();
    return active ? liveStudyMs(active) : 0;
  }

  function getDayStats(dateStr) {
    const d = dateStr || todayStr();
    const recs = getRecordsForDate(d);
    if (!recs.length) {
      const summary = getDailySummary(d);
      if (summary) return { studyMs: summary.studyMs, breakMs: summary.breakMs };
    }
    let studyMs = 0, breakMs = 0;
    recs.forEach(function (rec) { studyMs += liveStudyMs(rec); breakMs += liveBreakMs(rec); });
    (State.get().timeEngineBreaks || []).filter(function (b) { return b.date === d; }).forEach(function (b) { breakMs += b.durationMs; });
    return { studyMs: studyMs, breakMs: breakMs };
  }

  // ---------- subscriptions ----------

  function subscribe(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore listener errors */ } }); }

  let tickHandle = null;
  function init() {
    ensureDate();
    syncSessionsForToday();
    if (!tickHandle) tickHandle = setInterval(tick, 1000);
  }

  return {
    init: init,
    subscribe: subscribe,
    isSessionActive: isSessionActive,
    getActiveSession: getActiveSession,
    getPrompt: getPrompt,
    getUpcomingSession: getUpcomingSession,
    getGlobalBreak: getGlobalBreak,
    startTaskSession: startTaskSession,
    resolvePrompt: resolvePrompt,
    pauseActive: pauseActive,
    resumeActive: resumeActive,
    completeActive: completeActive,
    doItLater: doItLater,
    startGlobalBreak: startGlobalBreak,
    getClockDisplayMs: getClockDisplayMs,
    getDayStats: getDayStats,
    getRecord: getRecord,
    getRecordForTask: findOpenRecordForTask,
    getRecordsForDate: getRecordsForDate,
    getDailySummary: getDailySummary,
    getAllDailySummaries: getSummaries
  };
})();
