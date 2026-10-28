// datehub.js — centralized per-date record. Every date's data lives at
// State.get().dateHubs[dateStr] = { color, note, ...future keys from Planner/Journal/Progress }.
// Other tabs should read/write through DateHub.update(), keyed by the same date string,
// instead of building their own separate per-date storage.
//
// Events: hub.events stays an array of title strings (the original storage format, so every older
// reader — search, backups, saved data — keeps working). Each event's extra details live in the
// parallel array hub.eventMeta, aligned by index: eventMeta[i] = { id, note, tag } for events[i].
// Always read through getEvents() and write through setEvents() so the two arrays stay aligned.
// Legacy fields hub.important / hub.label are no longer written by the UI but are left untouched.
//
// Reminders: an event may carry meta.reminder = { daysBefore: 0|1|2|7, time: 'HH:MM' } and
// meta.remindedAt = the due timestamp (ms) that already fired. Delivery rides the existing
// TimeEngine heartbeat (one subscriber, id 'datehub-reminders') and the shared Notify layer —
// there is no timer or notification system of its own.

const DateHub = (function () {

  function blank() {
    return { color: null, note: '', important: false, label: '', studyHours: 0, events: [], eventMeta: [] };
  }

  function getAll() {
    return State.get().dateHubs || {};
  }

  function get(dateStr) {
    const hubs = getAll();
    return hubs[dateStr] || blank();
  }

  function update(dateStr, partial) {
    const hubs = Object.assign({}, getAll());
    const existing = hubs[dateStr] || blank();
    hubs[dateStr] = Object.assign({}, existing, partial);
    State.set({ dateHubs: hubs });
  }

  function newEventId() {
    return 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // Events for a date as [{ index, id, title, note, tag, ...any other stored meta }].
  // Older events saved as bare strings simply come back with an empty note and tag.
  function getEvents(dateStr) {
    const hub = get(dateStr);
    const titles = Array.isArray(hub.events) ? hub.events : [];
    const meta = Array.isArray(hub.eventMeta) ? hub.eventMeta : [];
    return titles.map(function (t, i) {
      const m = meta[i] && typeof meta[i] === 'object' ? meta[i] : {};
      return Object.assign({}, m, {
        index: i,
        id: m.id || null,
        title: String(t == null ? '' : t),
        note: String(m.note == null ? '' : m.note),
        tag: String(m.tag == null ? '' : m.tag)
      });
    });
  }

  // Replace a date's events with `list` (the shape getEvents returns). Writes titles and meta together.
  function setEvents(dateStr, list) {
    const events = [];
    const eventMeta = [];
    (list || []).forEach(function (e) {
      const title = String(e.title == null ? '' : e.title).trim();
      if (!title) return;
      const meta = Object.assign({}, e);
      delete meta.index;
      delete meta.title;
      meta.id = e.id || newEventId();
      meta.note = String(e.note == null ? '' : e.note);
      meta.tag = String(e.tag == null ? '' : e.tag).trim();
      events.push(title);
      eventMeta.push(meta);
    });
    update(dateStr, { events: events, eventMeta: eventMeta });
  }

  // Display title for any raw entry of hub.events (for callers that only hold the stored array).
  function eventTitle(ev) {
    return String(ev == null ? '' : ev);
  }

  // Every tag already used on any event, A-Z. Derived on read; nothing is stored.
  function knownEventTags() {
    const seen = Object.create(null);
    const hubs = getAll();
    Object.keys(hubs).forEach(function (d) {
      (Array.isArray(hubs[d].eventMeta) ? hubs[d].eventMeta : []).forEach(function (m) {
        const t = m && typeof m === 'object' && m.tag ? String(m.tag).trim() : '';
        if (t) seen[t.toLowerCase()] = seen[t.toLowerCase()] || t;
      });
    });
    return Object.keys(seen).map(function (k) { return seen[k]; }).sort(function (a, b) { return a.localeCompare(b); });
  }

  // ---------- Event reminders ----------
  const REMINDER_OFFSETS = [
    { days: 0, label: 'On the day' },
    { days: 1, label: '1 day before' },
    { days: 2, label: '2 days before' },
    { days: 7, label: '1 week before' }
  ];
  const REMINDER_DEFAULT_TIME = '09:00';
  const REMINDER_SUB_ID = 'datehub-reminders';
  const REMINDER_KEY = 'evrem:';
  const REMINDER_MAX_PER_TICK = 3;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  function normalizeReminder(r) {
    if (!r || typeof r !== 'object') return null;
    const d = Number(r.daysBefore);
    if (!REMINDER_OFFSETS.some(function (o) { return o.days === d; })) return null;
    const time = typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : REMINDER_DEFAULT_TIME;
    return { daysBefore: d, time: time };
  }

  // The moment (ms) a reminder is due for an event on dateStr, or null if there is no valid reminder.
  function reminderDueMs(dateStr, rem) {
    const r = normalizeReminder(rem);
    if (!r || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const p = dateStr.split('-'), t = r.time.split(':');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) - r.daysBefore, Number(t[0]), Number(t[1]), 0, 0).getTime();
  }

  function reminderLabel(rem) {
    const r = normalizeReminder(rem);
    if (!r) return '';
    const o = REMINDER_OFFSETS.filter(function (x) { return x.days === r.daysBefore; })[0];
    return o.label + ' \u00b7 ' + r.time;
  }

  // What to store when an event is saved with `nextRem`. An unchanged reminder keeps its fired
  // state; a new or changed one starts fresh — except one set for a moment that has already
  // passed, which is marked as passed so saving never fires it instantly.
  function reminderPatch(dateStr, prev, nextRem) {
    const rem = normalizeReminder(nextRem);
    if (!rem) return { reminder: null, remindedAt: null };
    const prevRem = prev ? normalizeReminder(prev.reminder) : null;
    if (prevRem && prevRem.daysBefore === rem.daysBefore && prevRem.time === rem.time) {
      return { reminder: rem, remindedAt: prev.remindedAt == null ? null : prev.remindedAt };
    }
    const due = reminderDueMs(dateStr, rem);
    return { reminder: rem, remindedAt: due !== null && due <= Date.now() ? due : null };
  }

  function reminderBody(dateStr) {
    const d = new Date(dateStr + 'T00:00:00'), base = new Date(todayStr() + 'T00:00:00');
    const diff = Math.round((d - base) / 86400000);
    const when = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (diff === 0) return 'Today \u00b7 All day';
    if (diff === 1) return 'Tomorrow \u00b7 ' + when;
    return 'In ' + diff + ' days \u00b7 ' + when;
  }

  // Every reminder-enabled event from today on, with its due time and whether it already fired.
  // Past dates are skipped: a reminder for a day that is over is never delivered.
  function buildReminderIndex() {
    const hubs = getAll(), today = todayStr(), out = [];
    Object.keys(hubs).forEach(function (d) {
      if (d < today) return;
      const hub = hubs[d] || {};
      const titles = Array.isArray(hub.events) ? hub.events : [];
      const meta = Array.isArray(hub.eventMeta) ? hub.eventMeta : [];
      meta.forEach(function (m, i) {
        if (!m || typeof m !== 'object' || !m.id) return;
        const rem = normalizeReminder(m.reminder);
        if (!rem) return;
        const due = reminderDueMs(d, rem);
        if (due === null) return;
        const title = String(titles[i] == null ? '' : titles[i]);
        out.push({ dateStr: d, id: m.id, title: title, due: due, fired: Number(m.remindedAt) === due, sig: d + '|' + title + '|' + due });
      });
    });
    return out;
  }

  let remRef = null, remDay = '', remList = [];

  function refreshReminderIndex() {
    const hubs = getAll(), today = todayStr();
    if (hubs === remRef && today === remDay) return;
    remRef = hubs; remDay = today;
    remList = buildReminderIndex();
    sweepStaleReminderPopups();
  }

  // An edited (title / date / reminder changed) or deleted event must not leave a stale popup behind.
  function sweepStaleReminderPopups() {
    if (typeof Notify === 'undefined' || !Notify.popupInfo) return;
    Notify.popupInfo(REMINDER_KEY).forEach(function (p) {
      const id = p.key.slice(REMINDER_KEY.length);
      const match = remList.filter(function (r) { return r.id === id; })[0];
      if (!match || match.sig !== p.sig) Notify.dismissByKey(p.key);
    });
  }

  function markReminderFired(dateStr, id, due) {
    const list = getEvents(dateStr);
    const i = list.findIndex(function (e) { return e.id === id; });
    if (i < 0) return;
    list[i] = Object.assign({}, list[i], { remindedAt: due });
    setEvents(dateStr, list);
  }

  function modalOpen() {
    const ov = typeof document !== 'undefined' ? document.getElementById('modal-overlay') : null;
    return !!ov && getComputedStyle(ov).display !== 'none';
  }

  function fireReminder(r) {
    markReminderFired(r.dateStr, r.id, r.due); // first, so a failure below can never repeat it
    const title = 'Reminder: ' + r.title;
    const body = reminderBody(r.dateStr);
    Notify.deliver(title, body);
    Notify.popup({
      key: REMINDER_KEY + r.id,
      sig: r.sig,
      className: 'dh-reminder-pill',
      title: title,
      body: body,
      onClick: function () {
        if (Notify.isItineraryActive()) return;
        if (typeof Calendar !== 'undefined' && Calendar.openDateHub) Calendar.openDateHub(r.dateStr);
      }
    });
  }

  function reminderTick() {
    if (typeof Notify === 'undefined' || !Notify.popup) return;
    refreshReminderIndex();
    // Wait (never drop) while an Itinerary decision or any modal is open, so the popup is actually seen.
    if (Notify.isItineraryActive() || modalOpen()) return;
    const now = Date.now();
    let fired = 0;
    for (let i = 0; i < remList.length && fired < REMINDER_MAX_PER_TICK; i++) {
      const r = remList[i];
      if (r.fired || r.due > now) continue;
      r.fired = true;
      fireReminder(r);
      fired++;
    }
  }

  // Call once after TimeEngine exists. Re-calling replaces the subscriber by id (no duplicates).
  function startReminders() {
    if (typeof TimeEngine === 'undefined' || !TimeEngine.subscribe) return;
    TimeEngine.subscribe(reminderTick, REMINDER_SUB_ID);
    reminderTick();
  }

  // Immediate re-check after an event is edited or deleted, instead of waiting for the next tick.
  function syncReminders() {
    remRef = null;
    refreshReminderIndex();
  }

  return {
    get: get, getAll: getAll, update: update,
    getEvents: getEvents, setEvents: setEvents, eventTitle: eventTitle, knownEventTags: knownEventTags,
    reminderOffsets: REMINDER_OFFSETS, normalizeReminder: normalizeReminder, reminderDueMs: reminderDueMs,
    reminderLabel: reminderLabel, reminderPatch: reminderPatch, startReminders: startReminders, syncReminders: syncReminders
  };
})();
