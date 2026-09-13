// backup.js — Backup / Restore / Summary / Compare (Feature 14). Local export/import only, no
// cloud sync. Depends on: State. Load after state.js. Optionally calls into Nav/TimeEngine/screen
// modules after a successful restore if they exist on window — all such calls are guarded, matching
// the project's existing `typeof X !== 'undefined'` defensive-call pattern (see calendar.js's
// TargetsData guard).
//
// Export shape: { schemaVersion, version, exportedAt, calendar, planner, targets, journal, study,
// progress, water, sleep, gamification, assistant, alarms, dailySummaries, settings }. `version` is
// kept as a legacy alias of `schemaVersion` for any older reader.
//
// Restore shape: per-record merge, current/live data always wins on conflict, backup-only records
// are added, live-only records are preserved. Runtime session state (studyClock/timeEngine) is
// always forced idle. Singleton config (settings, gamification totals, journal lock, studyStreak,
// waterReminder, currentScreen) is never overwritten by a restore — only real per-ID record
// collections merge. Validation + merge happen fully in memory; State.replace() is only called once,
// with a single complete object covering every key State's defaultState defines, so nothing an
// older/partial backup doesn't mention can accidentally fall back to State's own defaults.
const Backup = (function () {
  const SCHEMA_VERSION = 2;

  // Mirrors state.js's defaultState.studyClock exactly — the canonical "idle" shape.
  const DEFAULT_IDLE_STUDY_CLOCK = {
    mode: 'stopwatch',
    running: false,
    startedAt: null,
    timerTotalMs: 0,
    elapsedMs: 0,
    awaitingDecision: false
  };

  let _restoring = false;

  // ---------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------

  function build() {
    const s = State.get();
    return {
      schemaVersion: SCHEMA_VERSION,
      version: SCHEMA_VERSION, // legacy alias
      exportedAt: new Date().toISOString(),
      calendar: {
        dateHubs: s.dateHubs,
        studyStreak: s.studyStreak,
        favoriteTopics: s.favoriteTopics
      },
      planner: {
        topics: s.topics,
        tasks: s.tasks
      },
      targets: {
        targets: s.targets,
        subtargets: s.subtargets
      },
      journal: {
        journalEntries: s.journalEntries,
        journalPasswordHash: s.journalPasswordHash,
        journalLocked: s.journalLocked
      },
      study: {
        studyClock: s.studyClock,
        timeEngine: s.timeEngine,
        sessionRecords: s.sessionRecords,
        timeEngineBreaks: s.timeEngineBreaks,
        studyLog: s.studyLog
      },
      progress: {}, // derived-only — Progress owns no data of its own; key reserved
      water: {
        waterEvents: s.waterEvents,
        waterReminder: s.waterReminder
      },
      sleep: {
        sleepRecords: s.sleepRecords
      },
      gamification: {
        totalExp: s.gamification.totalExp,
        lastSettledDate: s.gamification.lastSettledDate,
        streakBonusAwardedForRun: s.gamification.streakBonusAwardedForRun,
        expLedger: s.expLedger
      },
      assistant: {
        assistantNotes: s.assistantNotes
      },
      alarms: {
        generalAlarms: s.generalAlarms
      },
      dailySummaries: s.dailySummaries,
      settings: s.settings
    };
  }

  function exportJson() {
    return JSON.stringify(build(), null, 2);
  }

  // Local file download only, no network call — works fully offline.
  function downloadExport() {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lavender-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------
  // LOW-LEVEL VALIDATION HELPERS
  // ---------------------------------------------------------------------

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function isNonNegNum(v) {
    return isFiniteNum(v) && v >= 0;
  }

  function isValidDateStr(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00');
    return !isNaN(d.getTime());
  }

  function safeParse(jsonText) {
    try { return JSON.parse(jsonText); } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------
  // GENERIC RECORD-COLLECTION CLEANERS (drop individual bad records, never
  // abort the whole restore for one corrupt entry)
  // ---------------------------------------------------------------------

  // id-keyed map, e.g. topics/tasks/targets/subtargets/generalAlarms/assistantNotes.
  // idField: the field inside each record that should equal its own map key (or null to skip
  // that check, e.g. sessionRecords whose internal id field name isn't specified anywhere).
  function cleanIdMap(rawMap, idField, recordValidator) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (key) {
      const rec = rawMap[key];
      if (!isPlainObject(rec)) return;
      if (idField && rec[idField] !== undefined && rec[idField] !== key) return; // key/id mismatch
      if (recordValidator && !recordValidator(rec)) return;
      out[key] = rec;
    });
    return out;
  }

  // date-string-keyed map of single records, e.g. dateHubs/journalEntries/sleepRecords/dailySummaries.
  function cleanDateKeyedMap(rawMap, opts) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    const o = opts || {};
    Object.keys(rawMap).forEach(function (dateStr) {
      if (!isValidDateStr(dateStr)) return;
      const rec = rawMap[dateStr];
      if (!isPlainObject(rec)) return;
      if (o.dateField && rec[o.dateField] !== undefined && rec[o.dateField] !== dateStr) return;
      if (o.recordValidator && !o.recordValidator(rec)) return;
      out[dateStr] = rec;
    });
    return out;
  }

  // date-string-keyed map of arrays, e.g. waterEvents/studyLog. Each date's array is treated as
  // one atomic "record" for merge purposes — bad items inside an array are dropped individually.
  function cleanDateKeyedArrayMap(rawMap, itemValidator) {
    const out = {};
    if (!isPlainObject(rawMap)) return out;
    Object.keys(rawMap).forEach(function (dateStr) {
      if (!isValidDateStr(dateStr)) return;
      const arr = rawMap[dateStr];
      if (!Array.isArray(arr)) return;
      out[dateStr] = arr.filter(function (item) {
        return isPlainObject(item) && (!itemValidator || itemValidator(item));
      });
    });
    return out;
  }

  // plain array of id-carrying records, e.g. timeEngineBreaks/expLedger.
  function cleanIdArray(rawArr, idField, itemValidator) {
    const out = [];
    if (!Array.isArray(rawArr)) return out;
    const seen = {};
    rawArr.forEach(function (item) {
      if (!isPlainObject(item)) return;
      const id = item[idField];
      if (id === undefined || id === null || seen[id]) return;
      if (itemValidator && !itemValidator(item)) return;
      seen[id] = true;
      out.push(item);
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // PER-RECORD-TYPE VALIDATORS
  // ---------------------------------------------------------------------

  function validTopic(rec) {
    return typeof rec.topicId === 'string' && rec.topicId.length > 0
      && (rec.tags === undefined || Array.isArray(rec.tags));
  }

  function validTask(rec) {
    if (typeof rec.taskId !== 'string' || !rec.taskId) return false;
    if (rec.date != null && !isValidDateStr(rec.date)) return false;
    if (rec.completedDate != null && !isValidDateStr(rec.completedDate)) return false;
    if (rec.revisionNumber !== undefined && rec.revisionNumber !== null && !isNonNegNum(rec.revisionNumber)) return false;
    return true;
  }

  function validTarget(rec) {
    if (typeof rec.targetId !== 'string' || !rec.targetId) return false;
    if (rec.dateKey != null && !isValidDateStr(rec.dateKey)) return false;
    if (rec.targetValue !== undefined && !isNonNegNum(rec.targetValue)) return false;
    if (rec.currentValue !== undefined && !isFiniteNum(rec.currentValue)) return false;
    if (rec.subtargets !== undefined && !Array.isArray(rec.subtargets)) return false;
    return true;
  }

  function validSubtarget(rec) {
    if (typeof rec.subtargetId !== 'string' || !rec.subtargetId) return false;
    if (typeof rec.parentTargetId !== 'string' || !rec.parentTargetId) return false;
    if (rec.targetValue !== undefined && !isNonNegNum(rec.targetValue)) return false;
    if (rec.currentValue !== undefined && !isFiniteNum(rec.currentValue)) return false;
    return true;
  }

  function validSessionRecord() {
    return true; // exact shape isn't specified anywhere; structural (plain-object) check is enough
  }

  function validAlarm() {
    return true; // loosely typed upstream; key/id match is the only structural guarantee available
  }

  function validAssistantNote(rec) {
    if (rec.createdAt != null && isNaN(new Date(rec.createdAt).getTime())) return false;
    return true;
  }

  function validExpEntry(rec) {
    if (rec.id === undefined || rec.id === null) return false;
    // Award/retract pairs are the documented EXP pattern, so a negative delta is legitimate here —
    // only reject non-finite values, not negative ones.
    if (rec.exp !== undefined && !isFiniteNum(rec.exp)) return false;
    if (rec.date != null && !isValidDateStr(rec.date)) return false;
    return true;
  }

  function validBreakRecord(rec) {
    if (rec.id === undefined || rec.id === null) return false;
    if (rec.durationMs !== undefined && !isNonNegNum(rec.durationMs)) return false;
    if (rec.date != null && !isValidDateStr(rec.date)) return false;
    return true;
  }

  function validWaterEvent(rec) {
    if (rec.value !== undefined && !isNonNegNum(rec.value)) return false;
    return true;
  }

  function validSleepRecord(rec) {
    if (rec.durationMin != null && !isNonNegNum(rec.durationMin)) return false;
    return true;
  }

  function validDailySummary(rec) {
    if (rec.studyMs !== undefined && !isNonNegNum(rec.studyMs)) return false;
    if (rec.breakMs !== undefined && !isNonNegNum(rec.breakMs)) return false;
    if (rec.tasksTotal !== undefined && !isNonNegNum(rec.tasksTotal)) return false;
    if (rec.tasksCompleted !== undefined && !isNonNegNum(rec.tasksCompleted)) return false;
    return true;
  }

  function validDateHub(rec) {
    if (rec.studyHours != null && !isNonNegNum(rec.studyHours)) return false;
    return true;
  }

  // ---------------------------------------------------------------------
  // FLATTEN + VALIDATE THE PARSED BACKUP
  // ---------------------------------------------------------------------

  function flattenGroups(parsed) {
    const c = isPlainObject(parsed.calendar) ? parsed.calendar : {};
    const p = isPlainObject(parsed.planner) ? parsed.planner : {};
    const tg = isPlainObject(parsed.targets) ? parsed.targets : {};
    const j = isPlainObject(parsed.journal) ? parsed.journal : {};
    const st = isPlainObject(parsed.study) ? parsed.study : {};
    const w = isPlainObject(parsed.water) ? parsed.water : {};
    const sl = isPlainObject(parsed.sleep) ? parsed.sleep : {};
    const a = isPlainObject(parsed.assistant) ? parsed.assistant : {};
    const al = isPlainObject(parsed.alarms) ? parsed.alarms : {};

    return {
      dateHubs: c.dateHubs,
      favoriteTopics: c.favoriteTopics,
      topics: p.topics,
      tasks: p.tasks,
      targets: tg.targets,
      subtargets: tg.subtargets,
      journalEntries: j.journalEntries,
      studyClock: st.studyClock,
      timeEngine: st.timeEngine,
      sessionRecords: st.sessionRecords,
      timeEngineBreaks: st.timeEngineBreaks,
      studyLog: st.studyLog,
      waterEvents: w.waterEvents,
      sleepRecords: sl.sleepRecords,
      expLedger: (isPlainObject(parsed.gamification) ? parsed.gamification.expLedger : undefined),
      assistantNotes: a.assistantNotes,
      generalAlarms: al.generalAlarms,
      dailySummaries: parsed.dailySummaries
    };
  }

  // Returns { ok:false, error } for a structurally unrecognizable backup (nothing is written), or
  // { ok:true, exportedAt, cleaned } where `cleaned` holds only individually-valid records — bad
  // individual records are silently dropped rather than failing the whole restore.
  function validateAndClean(parsed) {
    if (!isPlainObject(parsed)) {
      return { ok: false, error: "That file isn't valid backup JSON." };
    }
    const schemaVersion = (typeof parsed.schemaVersion === 'number') ? parsed.schemaVersion
      : (typeof parsed.version === 'number' ? parsed.version : null);
    if (schemaVersion === null) {
      return { ok: false, error: "That file isn't a recognized Lavender backup." };
    }
    if (schemaVersion > SCHEMA_VERSION) {
      return { ok: false, error: "This backup is from a newer version of Lavender and can't be restored here." };
    }
    if (typeof parsed.exportedAt !== 'string' || isNaN(new Date(parsed.exportedAt).getTime())) {
      return { ok: false, error: "That file isn't a recognized Lavender backup." };
    }

    const flat = flattenGroups(parsed);
    const cleaned = {
      dateHubs: cleanDateKeyedMap(flat.dateHubs, { recordValidator: validDateHub }),
      topics: cleanIdMap(flat.topics, 'topicId', validTopic),
      tasks: cleanIdMap(flat.tasks, 'taskId', validTask),
      targets: cleanIdMap(flat.targets, 'targetId', validTarget),
      subtargets: cleanIdMap(flat.subtargets, 'subtargetId', validSubtarget),
      journalEntries: cleanDateKeyedMap(flat.journalEntries, {}),
      sessionRecords: cleanIdMap(flat.sessionRecords, null, validSessionRecord),
      timeEngineBreaks: cleanIdArray(flat.timeEngineBreaks, 'id', validBreakRecord),
      studyLog: cleanDateKeyedArrayMap(flat.studyLog, null),
      waterEvents: cleanDateKeyedArrayMap(flat.waterEvents, validWaterEvent),
      sleepRecords: cleanDateKeyedMap(flat.sleepRecords, { dateField: 'date', recordValidator: validSleepRecord }),
      dailySummaries: cleanDateKeyedMap(flat.dailySummaries, { dateField: 'date', recordValidator: validDailySummary }),
      generalAlarms: cleanIdMap(flat.generalAlarms, 'id', validAlarm),
      assistantNotes: cleanIdMap(flat.assistantNotes, 'id', validAssistantNote),
      expLedger: cleanIdArray(flat.expLedger, 'id', validExpEntry),
      favoriteTopics: Array.isArray(flat.favoriteTopics)
        ? flat.favoriteTopics.filter(function (id) { return typeof id === 'string'; })
        : []
    };

    return { ok: true, schemaVersion: schemaVersion, exportedAt: parsed.exportedAt, cleaned: cleaned };
  }

  // ---------------------------------------------------------------------
  // MERGE (current/live always wins on a same-ID conflict; backup-only
  // records are added; live-only records are preserved)
  // ---------------------------------------------------------------------

  function mergeIdMap(backupMap, liveMap) {
    return Object.assign({}, backupMap || {}, liveMap || {});
  }

  function mergeIdArrayById(backupArr, liveArr, idField) {
    const map = {};
    (backupArr || []).forEach(function (item) { map[item[idField]] = item; });
    (liveArr || []).forEach(function (item) { map[item[idField]] = item; }); // live overwrites on same id
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // Builds one complete object covering every State defaultState key. Runtime session state is
  // always forced idle. Singleton config/settings/gamification-total fields always keep the live
  // value — a restore never silently changes those. Tasks/subtargets referencing a topic/target
  // that doesn't exist anywhere after merging are dropped rather than creating an orphan.
  function buildMergedState(v, cur) {
    const c = v.cleaned;

    const mergedTopics = mergeIdMap(c.topics, cur.topics);
    const mergedTargets = mergeIdMap(c.targets, cur.targets);

    const backupOnlyTasks = {};
    Object.keys(c.tasks || {}).forEach(function (id) {
      if (cur.tasks && Object.prototype.hasOwnProperty.call(cur.tasks, id)) return; // live wins, untouched
      const t = c.tasks[id];
      if (!t.topicId || mergedTopics[t.topicId]) backupOnlyTasks[id] = t; // else: orphaned, drop
    });
    const mergedTasks = Object.assign({}, backupOnlyTasks, cur.tasks || {});

    const backupOnlySubtargets = {};
    Object.keys(c.subtargets || {}).forEach(function (id) {
      if (cur.subtargets && Object.prototype.hasOwnProperty.call(cur.subtargets, id)) return;
      const st = c.subtargets[id];
      if (mergedTargets[st.parentTargetId]) backupOnlySubtargets[id] = st; // else: orphaned, drop
    });
    const mergedSubtargets = Object.assign({}, backupOnlySubtargets, cur.subtargets || {});

    const mergedFavoriteTopics = Array.from(new Set([].concat(cur.favoriteTopics || [], c.favoriteTopics || [])))
      .filter(function (id) { return !!mergedTopics[id]; });

    return {
      currentScreen: cur.currentScreen,
      dateHubs: mergeIdMap(c.dateHubs, cur.dateHubs),
      studyStreak: cur.studyStreak,
      topics: mergedTopics,
      tasks: mergedTasks,
      journalEntries: mergeIdMap(c.journalEntries, cur.journalEntries),
      journalPasswordHash: cur.journalPasswordHash,
      journalLocked: cur.journalLocked,
      studyClock: Object.assign({}, DEFAULT_IDLE_STUDY_CLOCK), // always reset — never resume a session
      timeEngine: null, // always reset
      sessionRecords: mergeIdMap(c.sessionRecords, cur.sessionRecords),
      timeEngineBreaks: mergeIdArrayById(c.timeEngineBreaks, cur.timeEngineBreaks, 'id'),
      dailySummaries: mergeIdMap(c.dailySummaries, cur.dailySummaries),
      studyLog: mergeIdMap(c.studyLog, cur.studyLog),
      favoriteTopics: mergedFavoriteTopics,
      waterEvents: mergeIdMap(c.waterEvents, cur.waterEvents),
      waterReminder: cur.waterReminder,
      sleepRecords: mergeIdMap(c.sleepRecords, cur.sleepRecords),
      generalAlarms: mergeIdMap(c.generalAlarms, cur.generalAlarms),
      assistantNotes: mergeIdMap(c.assistantNotes, cur.assistantNotes),
      gamification: cur.gamification,
      expLedger: mergeIdArrayById(c.expLedger, cur.expLedger, 'id'),
      settings: cur.settings,
      targets: mergedTargets,
      subtargets: mergedSubtargets
    };
  }

  function countAdditions(cleanedMap, curMap) {
    let added = 0;
    Object.keys(cleanedMap || {}).forEach(function (k) {
      if (!curMap || !Object.prototype.hasOwnProperty.call(curMap, k)) added++;
    });
    return added;
  }

  function countArrayAdditions(cleanedArr, curArr, idField) {
    const curIds = {};
    (curArr || []).forEach(function (i) { curIds[i[idField]] = true; });
    let added = 0;
    (cleanedArr || []).forEach(function (i) { if (!curIds[i[idField]]) added++; });
    return added;
  }

  function summarizeApplied(v, cur) {
    const c = v.cleaned;
    return {
      topicsAdded: countAdditions(c.topics, cur.topics),
      tasksAdded: countAdditions(c.tasks, cur.tasks),
      targetsAdded: countAdditions(c.targets, cur.targets),
      subtargetsAdded: countAdditions(c.subtargets, cur.subtargets),
      dateHubsAdded: countAdditions(c.dateHubs, cur.dateHubs),
      journalEntriesAdded: countAdditions(c.journalEntries, cur.journalEntries),
      sessionRecordsAdded: countAdditions(c.sessionRecords, cur.sessionRecords),
      timeEngineBreaksAdded: countArrayAdditions(c.timeEngineBreaks, cur.timeEngineBreaks, 'id'),
      dailySummariesAdded: countAdditions(c.dailySummaries, cur.dailySummaries),
      sleepRecordsAdded: countAdditions(c.sleepRecords, cur.sleepRecords),
      generalAlarmsAdded: countAdditions(c.generalAlarms, cur.generalAlarms),
      assistantNotesAdded: countAdditions(c.assistantNotes, cur.assistantNotes),
      expLedgerAdded: countArrayAdditions(c.expLedger, cur.expLedger, 'id')
    };
  }

  // ---------------------------------------------------------------------
  // SUMMARY / COMPARE (non-persisted, read-only — safe to call repeatedly
  // without ever touching State)
  // ---------------------------------------------------------------------

  function countMap(m) { return m ? Object.keys(m).length : 0; }

  function extractSessionDate(rec) {
    const candidates = ['date', 'plannedDate', 'day', 'startedAt', 'createdAt'];
    for (let i = 0; i < candidates.length; i++) {
      const v = rec[candidates[i]];
      if (typeof v === 'string' && v.length >= 10) return v.slice(0, 10);
    }
    return null;
  }

  function computeDateRange(dateList) {
    let from = null, to = null;
    dateList.forEach(function (d) {
      if (!d) return;
      if (from === null || d < from) from = d;
      if (to === null || d > to) to = d;
    });
    return from === null ? null : { from: from, to: to };
  }

  function computeSummary(v, cur) {
    const c = v.cleaned;
    return {
      exportedAt: v.exportedAt,
      counts: {
        topics: countMap(c.topics),
        tasks: countMap(c.tasks),
        targets: countMap(c.targets),
        journalEntries: countMap(c.journalEntries),
        alarms: countMap(c.generalAlarms),
        sessions: countMap(c.sessionRecords)
      },
      sessionDateRange: computeDateRange(
        Object.keys(c.sessionRecords || {}).map(function (id) { return extractSessionDate(c.sessionRecords[id]); })
      ),
      journalDateRange: computeDateRange(Object.keys(c.journalEntries || {})),
      willChange: summarizeApplied(v, cur)
    };
  }

  function compareMaps(cleanedMap, curMap) {
    cleanedMap = cleanedMap || {};
    curMap = curMap || {};
    let onlyBackup = 0, onlyLive = 0, both = 0, conflicts = 0;
    const allKeys = new Set(Object.keys(cleanedMap).concat(Object.keys(curMap)));
    allKeys.forEach(function (k) {
      const inB = Object.prototype.hasOwnProperty.call(cleanedMap, k);
      const inL = Object.prototype.hasOwnProperty.call(curMap, k);
      if (inB && inL) {
        both++;
        if (JSON.stringify(cleanedMap[k]) !== JSON.stringify(curMap[k])) conflicts++;
      } else if (inB) {
        onlyBackup++;
      } else {
        onlyLive++;
      }
    });
    return { onlyInBackup: onlyBackup, onlyInLive: onlyLive, inBoth: both, conflicts: conflicts };
  }

  function compareArraysById(cleanedArr, curArr, idField) {
    const b = {}, l = {};
    (cleanedArr || []).forEach(function (i) { b[i[idField]] = i; });
    (curArr || []).forEach(function (i) { l[i[idField]] = i; });
    return compareMaps(b, l);
  }

  function computeCompare(v, cur) {
    const c = v.cleaned;
    return {
      exportedAt: v.exportedAt,
      topics: compareMaps(c.topics, cur.topics),
      tasks: compareMaps(c.tasks, cur.tasks),
      targets: compareMaps(c.targets, cur.targets),
      subtargets: compareMaps(c.subtargets, cur.subtargets),
      sessionRecords: compareMaps(c.sessionRecords, cur.sessionRecords),
      timeEngineBreaks: compareArraysById(c.timeEngineBreaks, cur.timeEngineBreaks, 'id'),
      dateHubs: compareMaps(c.dateHubs, cur.dateHubs),
      journalEntries: compareMaps(c.journalEntries, cur.journalEntries),
      sleepRecords: compareMaps(c.sleepRecords, cur.sleepRecords),
      dailySummaries: compareMaps(c.dailySummaries, cur.dailySummaries),
      waterEvents: compareMaps(c.waterEvents, cur.waterEvents),
      studyLog: compareMaps(c.studyLog, cur.studyLog),
      generalAlarms: compareMaps(c.generalAlarms, cur.generalAlarms),
      assistantNotes: compareMaps(c.assistantNotes, cur.assistantNotes),
      expLedger: compareArraysById(c.expLedger, cur.expLedger, 'id'),
      liveWinsOnConflict: true
    };
  }

  // Parses + validates without touching State — use to render a Summary/Compare confirmation
  // screen before the user commits to restoreFromJson().
  function inspectBackup(jsonText) {
    const parsed = safeParse(jsonText);
    if (parsed === null) return { ok: false, error: "That file isn't valid backup JSON." };
    const v = validateAndClean(parsed);
    if (!v.ok) return { ok: false, error: v.error };
    const cur = State.get();
    return { ok: true, exportedAt: v.exportedAt, summary: computeSummary(v, cur), compare: computeCompare(v, cur) };
  }

  function getSummary(jsonText) {
    const r = inspectBackup(jsonText);
    if (!r.ok) return r;
    return { ok: true, exportedAt: r.exportedAt, summary: r.summary };
  }

  function getCompare(jsonText) {
    const r = inspectBackup(jsonText);
    if (!r.ok) return r;
    return { ok: true, exportedAt: r.exportedAt, compare: r.compare };
  }

  // ---------------------------------------------------------------------
  // RESTORE
  // ---------------------------------------------------------------------

  function isRestoring() {
    return _restoring;
  }

  // Defensive, best-effort post-restore hooks. Every call is guarded so this never throws just
  // because a given module isn't loaded/available; each screen's own render()/init() is assumed
  // idempotent per the project's existing "no duplicate listeners on re-render" rule, so calling
  // it again here does not itself introduce duplicate listeners or subscriptions.
  function runPostRestoreHooks() {
    if (typeof Nav !== 'undefined' && typeof Nav.switchTo === 'function') {
      const screen = State.get().currentScreen;
      if (screen) Nav.switchTo(screen);
    }
    ['Library', 'Calendar', 'Study', 'Progress', 'Journal'].forEach(function (modName) {
      const mod = (typeof window !== 'undefined') ? window[modName] : undefined;
      if (mod && typeof mod.render === 'function') {
        try { mod.render(); } catch (e) { /* one screen failing to re-render shouldn't break restore */ }
      }
    });
    if (typeof TimeEngine !== 'undefined') {
      if (typeof TimeEngine.reinit === 'function') TimeEngine.reinit();
      else if (typeof TimeEngine.init === 'function') TimeEngine.init();
      if (typeof TimeEngine.stop === 'function') TimeEngine.stop();
    }
  }

  // Returns { ok, error } or { ok:true, summary }. Never throws. Rejects (with zero state changes)
  // a structurally-unrecognized backup or a schemaVersion newer than this app understands.
  // Individually corrupt records inside an otherwise-valid backup are dropped, not fatal. Safe to
  // call with the same backup twice — merging is idempotent, so no duplicates are created.
  function restoreFromJson(jsonText) {
    if (_restoring) {
      return { ok: false, error: 'A restore is already in progress.' };
    }
    _restoring = true;
    try {
      const parsed = safeParse(jsonText);
      if (parsed === null) return { ok: false, error: "That file isn't valid backup JSON." };

      const v = validateAndClean(parsed);
      if (!v.ok) return { ok: false, error: v.error };

      const cur = State.get();
      const merged = buildMergedState(v, cur);
      const summary = summarizeApplied(v, cur);

      State.replace(merged);
      runPostRestoreHooks();

      return { ok: true, summary: summary };
    } catch (e) {
      return { ok: false, error: 'Restore failed unexpectedly; no changes were made.' };
    } finally {
      _restoring = false;
    }
  }

  function clearAllData() {
    State.clear();
  }

  return {
    downloadExport: downloadExport,
    exportJson: exportJson,
    restoreFromJson: restoreFromJson,
    inspectBackup: inspectBackup,
    getSummary: getSummary,
    getCompare: getCompare,
    isRestoring: isRestoring,
    clearAllData: clearAllData
  };
})();
