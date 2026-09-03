// state.js — single shared app state. Loaded after storage.js, before nav.js.
// Later phases add their own keys to defaultState and read/write via State.get()/State.set().

const State = (function () {
  const STORAGE_KEY = 'appState';

  const defaultState = {
    currentScreen: 'calendar',
    dateHubs: {}, // Feature 1: per-date record { color, note, ...future: revisions/journal/mood/exp/streak }
    // Later: tasks, journalEntries, exp, level, streak, etc.
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
