// itinerary-template-data.js — Itinerary Template data layer (Itinerary Phase 3). No UI here.
// Depends on: State, AlarmData (reused read-only for its recurrence shape/validation/matching —
// this module never extends or mutates AlarmData's own generalAlarms contract, per the
// "preserve current behavior" rule). A sibling store to AlarmData, not a merge into it.
//
// State.get().itineraryTemplates[templateId] = {
//   templateId, name,                 // "Light Day", "Heavy Day", "Revision Day", "Custom"
//   items: [ itineraryItemDef, ... ],  // populated by the Itinerary Builder screen (Phase 5); [] until then
//   schedule: { type: 'once'|'daily'|'weekdays'|'date', days: [...], date: '...' },
//                                      // mirrors AlarmData's recurrence shape 1:1 (no `time` field —
//                                      // a template says WHICH DAY it applies to, not a clock trigger)
//   createdAt, updatedAt
// }
const ItineraryTemplateData = (function () {
  // §11 rejection reason from create()/update(), surfaced by alarm.js's Itineraries tab form.
  let lastError = null;
  function getLastError() { return lastError; }

  function genId() { return 'tpl' + Date.now() + Math.floor(Math.random() * 1000); }

  // §11 — validates the schedule sub-object only (no `time` field to check here, unlike
  // AlarmData.validateRecurrence — a template is date-scoped, not clock-scoped).
  function validateSchedule(schedule) {
    if (!schedule || typeof schedule !== 'object') return false;
    if (schedule.type === 'once') return true;
    if (schedule.type === 'daily') return true;
    if (schedule.type === 'weekdays') {
      return Array.isArray(schedule.days) && schedule.days.length > 0 &&
        schedule.days.every(function (d) { return AlarmData.DAY_KEYS.indexOf(d) !== -1; });
    }
    if (schedule.type === 'date') {
      return !!schedule.date && /^\d{4}-\d{2}-\d{2}$/.test(schedule.date);
    }
    return false;
  }

  function getAll() {
    return State.get().itineraryTemplates || {};
  }

  function getList() {
    const all = getAll();
    return Object.keys(all).map(function (id) { return all[id]; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
  }

  function getById(id) {
    return getAll()[id] || null;
  }

  // §11 — create; returns the new template, or null if the schedule is invalid. On null, call
  // getLastError() for the specific reason.
  function create(fields) {
    lastError = null;
    if (!fields || !fields.name || !fields.name.trim()) {
      lastError = 'Give the itinerary template a name.';
      return null;
    }
    if (!validateSchedule(fields.schedule)) {
      lastError = 'Pick a valid schedule (weekdays needs at least one day; specific date needs a date).';
      return null;
    }
    const id = genId();
    const now = Date.now();
    const template = {
      templateId: id,
      name: fields.name.trim(),
      items: Array.isArray(fields.items) ? fields.items : [],
      schedule: fields.schedule,
      adaptive: fields.adaptive !== false, // §18 — default true; explicit false = fixed mode
      createdAt: now,
      updatedAt: now
    };
    const all = Object.assign({}, getAll());
    all[id] = template;
    State.set({ itineraryTemplates: all });
    return template;
  }

  // §11 — edit; rejects the update (leaves the template unchanged) if the new schedule is
  // invalid. Fields not passed (e.g. `items`, left to the Phase 5 builder) are preserved as-is,
  // same merge behavior as AlarmData.update().
  function update(id, fields) {
    lastError = null;
    const existing = getById(id);
    if (!existing) return null;
    const next = Object.assign({}, existing, fields);
    if (!next.name || !next.name.trim()) {
      lastError = 'Give the itinerary template a name.';
      return null;
    }
    if (!validateSchedule(next.schedule)) {
      lastError = 'Pick a valid schedule (weekdays needs at least one day; specific date needs a date).';
      return null;
    }
    next.name = next.name.trim();
    next.updatedAt = Date.now();
    const all = Object.assign({}, getAll());
    all[id] = next;
    State.set({ itineraryTemplates: all });
    return next;
  }

  function remove(id) {
    const all = Object.assign({}, getAll());
    delete all[id];
    State.set({ itineraryTemplates: all });
  }

  // §11 conflict rule (Section 26 of the original brief) — absent an explicit user choice, when
  // more than one template's schedule matches a given day, the most recently created/edited one
  // wins. Reuses AlarmData.dateMatchesRecurrence (exported read-only from alarm-data.js) rather
  // than re-implementing recurrence matching. Returns matches sorted most-recent-first; the
  // morning gate (Phase 6) applies the "explicit selection always wins outright" half of the rule
  // on top of this list — this function only resolves the auto-match half.
  function getMatchingForDate(dateStr) {
    return getList()
      .filter(function (t) { return AlarmData.dateMatchesRecurrence(t.schedule, dateStr); })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  return {
    getList: getList,
    getById: getById,
    validateSchedule: validateSchedule,
    create: create,
    update: update,
    remove: remove,
    getMatchingForDate: getMatchingForDate,
    getLastError: getLastError
  };
})();
