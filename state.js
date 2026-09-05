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
    studyClock: { mode: 'stopwatch', running: false, startedAt: null, elapsedMs: 0, timerTotalMs: 0 }, // Study §3.1
    sessionLog: [], // Study §0/§3.2: [{ taskId, date, startTime, stopTime, outcome }]
    alarmState: { date: null, delayMs: 0, activeTaskId: null, sessionStartedAt: null, prompt: null, handledTaskIds: [], globalBreak: { active: false, resumeAt: null, wasClockRunning: false } }, // Study §3.2
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
