// state.js — single shared app state. Loaded after storage.js, before nav.js.
// Later phases add their own keys to defaultState and read/write via State.get()/State.set().

const State = (function () {
  const STORAGE_KEY = 'appState';

  const defaultState = {
    currentScreen: 'calendar',
    dateHubs: {}, // Feature 1/2B: per-date record { color, note, important, label, studyHours, ... }
    studyStreak: { highScore: 0 }, // Feature 2B: persisted high score; current streak is always derived live
    topics: {}, // Planner: topicId -> { topicId, subject, topicName, tags: [] }
    tasks: {},  // Planner: taskId -> { taskId, topicId, subject, topicName, taskType, date, completed, completedDate, note, revisionNumber, cycleId }
    journalEntries: {}, // Journal: dateStr -> { morningQuote, weather, mood, hoursStudied, diaryText, photos, manifestationText, challenge }
    journalPasswordHash: null, // Journal: global lock password hash
    journalLocked: false, // Journal: global lock state
    studyClock: { mode: 'stopwatch', running: false, startedAt: null, timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false },    timeEngine: null, // Time Engine §1: header/control state (date, activeSessionId, shiftMs, prompt, globalBreak) — see timeengine.js
    sessionRecords: {}, // Time Engine §1: sessionId -> SessionRecord (planned/adjusted/actual times, durations, state) — source of truth for Progress
    timeEngineBreaks: [], // Time Engine: [{ id, date, type: 'auto'|'global', durationMs, startedAt }]
    dailySummaries: {}, // Time Engine retention: dateStr -> { date, studyMs, breakMs, tasksTotal, tasksCompleted } for dates older than RETENTION_DAYS
    studyLog: {}, // dateStr -> [{ label, ms, kind: 'min'|'hr', at }] — chronological "what was studied where" log for Study tab
    favoriteTopics: [], // History nav: topicIds marked as favorite
    waterEvents: {}, // Water (§B.4): dateStr -> [{ id, category, value, at }]
    waterReminder: null, // Water (§B.4): { date, lastFiredAt, lastCategory, snoozedUntil } — reset per date
    sleepRecords: {}, // Sleep (§B.5): dateStr -> { date, sleepTime, wakeTime, durationMin, completed, dismissed }
    generalAlarms: {}, // General Alarm (§B.6): alarmId -> { id, text, time, recurrence, enabled, lastFiredDate, snoozedUntil }
    itineraryTemplates: {}, // Itinerary (Phase 2 key, CRUD built Phase 3): templateId -> { templateId, name, schedule, adaptive, items: [...] } — reusable day-templates (Light Day, Heavy Day, etc.), built in Alarm's UI
    dailyItinerary: null, // Itinerary (Phase 2 key, state machine built Phase 4): today's itinerary — { date, status, templateId, items, checklist, diyChosen, startedAt, completedAt }. Read via ItineraryData.getToday(), which compares .date to todayStr() and returns a fresh 'unpresented' shell when stale, mirroring WaterData.getReminderState()'s per-date pattern. Null until Phase 4 backfills the first shell.
    dailyItinerarySummaries: {}, // Itinerary (Phase 4 key): dateStr -> finalized dailyItinerary snapshot (status locked to completed/partially_completed/diy_selected/abandoned), archived here by ItineraryData's TimeEngine.onRollover('itinerary') handler when a day ends — mirrors TimeEngine's own dailySummaries retention pattern (Section 45) so history survives dailyItinerary's single "today" slot being replaced.
    assistantNotes: {}, // Notepad (relocated from Assistant, §B.7): id -> { id, text, createdAt, promotedToTaskId,
                        //   folder: string (default 'General'), type: 'text'|'checklist' (default 'text'),
                        //   checklistItems: [{ id, text, done }], favorite: boolean }
    notepadFolders: [], // Notepad: explicit folder name list (persists empty folders independent of notes)
    gamification: { totalExp: 0, lastSettledDate: null, streakBonusAwardedForRun: false }, // §B.8.3/8.4 — level is derived, never stored
    expLedger: [], // §B.8.3: append-only [{ id, date, label, exp, doubled, at }], settled once/day at cutoff
    settings: { breakWallpaper: null, defaultBreakDuration: null, notificationsEnabled: true, soundEnabled: true, vibrationEnabled: true, assistantName: '', studyWallpapers: [], studyWallpaperIndex: 0, studyWallpaperSlideshow: { enabled: false, intervalMin: 5 }, hasSeenFullscreenPrompt: false, userExitedFullscreen: false },
    targets: {},
    subtargets: {},
    tags: {},
    tagsMigrated: false,
    studyTemplates: {},
    musicPlaylist: [],
    miscCandle: null, // Miscellaneous Candle Lamp: { lit, startedAt, durationMs } while a hidden-duration burn is active, else null
    miscWeather: null, // Miscellaneous weather ambience cycle: { state: 'clear'|'rain'|'sunlight', since }
  };
  let data = Object.assign({}, defaultState);

  function get() {
    return data;
  }

  // set() only shallow-merges at the TOP level. State.set({ settings: { foo: 1 } }) replaces the
  // whole settings object, silently dropping every other settings field — always spread the
  // current value first (Object.assign({}, State.get().settings, {...})), or use patch() below.
    function set(partial) {
    const next = Object.assign({}, data, partial);
    const ok = Storage.save(STORAGE_KEY, next);
    if (ok) data = next;
    return ok;
  }

  // Safe nested-merge helper (item 9, bug-proofing) — patch('settings', { soundEnabled: false })
  // merges into the existing settings object instead of replacing it, so a caller can never
  // accidentally wipe sibling fields the way a raw set({ settings: {...} }) can.
  function patch(key, partial) {
    const current = data[key];
    const merged = (current && typeof current === 'object' && !Array.isArray(current))
      ? Object.assign({}, current, partial)
      : partial;
    return set({ [key]: merged });
  }

  function init() {
    const saved = Storage.load(STORAGE_KEY);
    if (saved) {
      data = Object.assign({}, defaultState, saved);
    }
  }

  // §B.10 Restore — full replace (not a shallow merge onto current data) so a restored backup
  // can't be partially shadowed by whatever was already in memory; still merges over defaultState
  // so keys a backup doesn't know about (added by a later version) keep their default.
  function replace(newData) {
    data = Object.assign({}, defaultState, newData);
    Storage.save(STORAGE_KEY, data);
  }

  // §B.10 Clear all data — wipes persisted storage and resets in-memory state to defaults.
  function clear() {
    data = Object.assign({}, defaultState);
    Storage.remove(STORAGE_KEY);
  }

  return { get, set, patch, init, replace, clear };
})();
