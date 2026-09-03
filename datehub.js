// datehub.js — centralized per-date record. Every date's data lives at
// State.get().dateHubs[dateStr] = { color, note, ...future keys from Planner/Journal/Progress }.
// Other tabs should read/write through DateHub.update(), keyed by the same date string,
// instead of building their own separate per-date storage.

const DateHub = (function () {

  function getAll() {
    return State.get().dateHubs || {};
  }

  function get(dateStr) {
    const hubs = getAll();
    return hubs[dateStr] || { color: null, note: '', important: false, label: '' };
  }

  function update(dateStr, partial) {
    const hubs = Object.assign({}, getAll());
    const existing = hubs[dateStr] || { color: null, note: '', important: false, label: '' };
    hubs[dateStr] = Object.assign({}, existing, partial);
    State.set({ dateHubs: hubs });
  }

  return { get: get, getAll: getAll, update: update };
})();

