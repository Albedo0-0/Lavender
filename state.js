// state.js — single shared app state. Loaded after storage.js, before nav.js.
// Later phases add their own keys to defaultState and read/write via State.get()/State.set().

const State = (function () {
  const STORAGE_KEY = 'appState';

  const defaultState = {
    currentScreen: 'calendar',
    dateHubs: {}, // Feature 1/2B: per-date record { color, note, important, label, studyHours, ... }
    studyStreak: { highScore: 0 }, // Feature 2B: persisted high score; current streak is always derived live
    topics: {}, // Planner: topicId -> { topicId, subject, topicName }
    tasks: {},  // Planner: taskId -> { taskId, topicId, subject, topicName, taskType, date, completed, completedDate, note, revisionNumber, cycleId }
    journalEntries: {}, // Journal: dateStr -> { morningQuote, weather, mood, hoursStudied, diaryText, photos, manifestationText, challenge }
    journalPasswordHash: null, // Journal: global lock password hash
    journalLocked: false, // Journal: global lock state
    studyClock: { mode: 'stopwatch', running: false, startedAt: null, elapsedMs: 0, timerTotalMs: 0 }, // Study §3.1 — independent manual stopwatch/timer, not tied to sessions
    timeEngine: null, // Time Engine §1: header/control state (date, activeSessionId, shiftMs, prompt, globalBreak) — see timeengine.js
    sessionRecords: {}, // Time Engine §1: sessionId -> SessionRecord (planned/adjusted/actual times, durations, state) — source of truth for Progress
    timeEngineBreaks: [], // Time Engine: [{ id, date, type: 'auto'|'global', durationMs, startedAt }]
    dailySummaries: {}, // Time Engine retention: dateStr -> { date, studyMs, breakMs, tasksTotal, tasksCompleted } for dates older than RETENTION_DAYS
 studyLinks: {}, // Study §3.4: linkId -> { linkId, subject, url, note }
    favoriteTopics: [], // History nav: topicIds marked as favorite
    // Later: exp, level, etc.
  };

  let data = Object.assign({}, defaultState);

  function get() {
    return data;
  }

  function set(partial) {
    data = Object.assign({}, data, partial);
    Storage.save(STORAGE_KEY, data);
  }

  function init() {
    const saved = Storage.load(STORAGE_KEY);
    if (saved) {
      data = Object.assign({}, defaultState, saved);
    }
  }

  return { get, set, init };
})();
