// backup.js — Backup / Restore (§B.10). Local export/import only, no cloud sync (§10.3).
// Depends on: State. Load after state.js.
//
// §10.1 — versioned JSON: { version, exportedAt } + one top-level key per module (calendar,
// planner, journal, study, progress, water, sleep, gamification, assistant, alarms,
// dailySummaries, settings). This file owns the exact grouping of State's flat keys into those
// module buckets (and back) — the shape referenced as "decided when this item is actually built".
//
// §10.2 — restore rebuilds full app state, including non-visible persisted state (session
// records, EXP ledger, retention summaries), not just what's currently on screen. A group missing
// from an older/partial backup falls back to the current value instead of wiping it.
const Backup = (function () {
  const VERSION = 1;

  function build() {
    const s = State.get();
    return {
      version: VERSION,
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
        studyLog: s.studyLog,
        studyLinks: s.studyLinks
      },
      progress: {}, // derived-only (§A.V) — Progress owns no data of its own; key reserved
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

  function toFlatState(backup) {
    const cur = State.get();
    const c = backup.calendar || {};
    const p = backup.planner || {};
    const j = backup.journal || {};
    const st = backup.study || {};
    const w = backup.water || {};
    const sl = backup.sleep || {};
    const g = backup.gamification || {};
    const a = backup.assistant || {};
    const al = backup.alarms || {};

    return {
      dateHubs: c.dateHubs !== undefined ? c.dateHubs : cur.dateHubs,
      studyStreak: c.studyStreak !== undefined ? c.studyStreak : cur.studyStreak,
      favoriteTopics: c.favoriteTopics !== undefined ? c.favoriteTopics : cur.favoriteTopics,
      topics: p.topics !== undefined ? p.topics : cur.topics,
      tasks: p.tasks !== undefined ? p.tasks : cur.tasks,
      journalEntries: j.journalEntries !== undefined ? j.journalEntries : cur.journalEntries,
      journalPasswordHash: j.journalPasswordHash !== undefined ? j.journalPasswordHash : cur.journalPasswordHash,
      journalLocked: j.journalLocked !== undefined ? j.journalLocked : cur.journalLocked,
      studyClock: st.studyClock !== undefined ? st.studyClock : cur.studyClock,
      timeEngine: st.timeEngine !== undefined ? st.timeEngine : cur.timeEngine,
      sessionRecords: st.sessionRecords !== undefined ? st.sessionRecords : cur.sessionRecords,
      timeEngineBreaks: st.timeEngineBreaks !== undefined ? st.timeEngineBreaks : cur.timeEngineBreaks,
      studyLog: st.studyLog !== undefined ? st.studyLog : cur.studyLog,
      studyLinks: st.studyLinks !== undefined ? st.studyLinks : cur.studyLinks,
      waterEvents: w.waterEvents !== undefined ? w.waterEvents : cur.waterEvents,
      waterReminder: w.waterReminder !== undefined ? w.waterReminder : cur.waterReminder,
      sleepRecords: sl.sleepRecords !== undefined ? sl.sleepRecords : cur.sleepRecords,
      gamification: {
        totalExp: g.totalExp !== undefined ? g.totalExp : cur.gamification.totalExp,
        lastSettledDate: g.lastSettledDate !== undefined ? g.lastSettledDate : cur.gamification.lastSettledDate,
        streakBonusAwardedForRun: g.streakBonusAwardedForRun !== undefined ? g.streakBonusAwardedForRun : cur.gamification.streakBonusAwardedForRun
      },
      expLedger: g.expLedger !== undefined ? g.expLedger : cur.expLedger,
      assistantNotes: a.assistantNotes !== undefined ? a.assistantNotes : cur.assistantNotes,
      generalAlarms: al.generalAlarms !== undefined ? al.generalAlarms : cur.generalAlarms,
      dailySummaries: backup.dailySummaries !== undefined ? backup.dailySummaries : cur.dailySummaries,
      settings: backup.settings !== undefined ? backup.settings : cur.settings
    };
  }

  function exportJson() {
    return JSON.stringify(build(), null, 2);
  }

  // §10.3 — local file download only, no network call.
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

  // Returns { ok, error } instead of throwing, so the caller can show a message and never
  // silently corrupt state. Rejects a newer/unrecognized version rather than guessing (§B.16).
  function restoreFromJson(jsonText) {
    let parsed;
    try { parsed = JSON.parse(jsonText); } catch (e) { return { ok: false, error: "That file isn't valid backup JSON." }; }
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: "That file isn't valid backup JSON." };
    if (typeof parsed.version !== 'number' || parsed.version > VERSION) {
      return { ok: false, error: "This backup is from a newer version of Lavender and can't be restored here." };
    }
    // Version 1 is the floor — nothing older to migrate from yet.
    State.replace(toFlatState(parsed));
    return { ok: true };
  }

  function clearAllData() {
    State.clear();
  }

  return {
    downloadExport: downloadExport,
    exportJson: exportJson,
    restoreFromJson: restoreFromJson,
    clearAllData: clearAllData
  };
})();
