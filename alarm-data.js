// alarm-data.js — General Alarm data layer (§B.6). No UI here. Depends on: State.
// Logically separate from Study's slot alarms (timeengine.js) — never reads/writes Time Engine's
// session schedule. State.get().generalAlarms[alarmId] = {
//   id, text, time: 'HH:MM',
//   recurrence: { type: 'once'|'daily'|'weekdays'|'date', days: ['SU',...], date: 'YYYY-MM-DD' },
//   enabled, lastFiredDate, snoozedUntil
// }
const AlarmData = (function () {
  const DAY_KEYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const SNOOZE_MIN = 10;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr(now) {
    const t = now || new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function nowTimeStr(now) {
    const t = now || new Date();
    return pad(t.getHours()) + ':' + pad(t.getMinutes());
  }

  function getAll() {
    return State.get().generalAlarms || {};
  }

  function getList() {
    const all = getAll();
    return Object.keys(all).map(function (id) { return all[id]; })
      .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
  }

  function getById(id) {
    return getAll()[id] || null;
  }

  // §6.4 — reject or safe-default an alarm with no valid days/date selected; never allow an
  // undefined schedule to be saved.
  function validateRecurrence(recurrence, time) {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return false;
    if (!recurrence || typeof recurrence !== 'object') return false;
    if (recurrence.type === 'once') return true;
    if (recurrence.type === 'daily') return true;
    if (recurrence.type === 'weekdays') {
      return Array.isArray(recurrence.days) && recurrence.days.length > 0 &&
        recurrence.days.every(function (d) { return DAY_KEYS.indexOf(d) !== -1; });
    }
    if (recurrence.type === 'date') {
      return !!recurrence.date && /^\d{4}-\d{2}-\d{2}$/.test(recurrence.date);
    }
    return false;
  }

  // §6.2 — create; returns the new alarm, or null if the recurrence is invalid (§6.4).
  function create(fields) {
    if (!validateRecurrence(fields.recurrence, fields.time)) return null;
    const id = 'al' + Date.now() + Math.floor(Math.random() * 1000);
    const alarm = {
      id: id,
      text: fields.text || 'Alarm',
      time: fields.time,
      recurrence: fields.recurrence,
      enabled: true,
      lastFiredDate: null,
      snoozedUntil: null
    };
    const all = Object.assign({}, getAll());
    all[id] = alarm;
    State.set({ generalAlarms: all });
    return alarm;
  }

  // §6.2 — edit; rejects the update (leaves the alarm unchanged) if the new recurrence is invalid.
  function update(id, fields) {
    const existing = getById(id);
    if (!existing) return null;
    const next = Object.assign({}, existing, fields);
    if (!validateRecurrence(next.recurrence, next.time)) return null;
    const all = Object.assign({}, getAll());
    all[id] = next;
    State.set({ generalAlarms: all });
    return next;
  }

  // §6.2 — delete.
  function remove(id) {
    const all = Object.assign({}, getAll());
    delete all[id];
    State.set({ generalAlarms: all });
  }

  function setEnabled(id, enabled) {
    return update(id, { enabled: enabled, snoozedUntil: null });
  }

  // §6.3 — Dismiss. One-shot types (once/date) disable themselves so they never fire again;
  // recurring types just mark today as fired so they don't re-fire until their next occurrence.
  function dismiss(id, now) {
    const alarm = getById(id);
    if (!alarm) return;
    const today = todayStr(now);
    if (alarm.recurrence.type === 'once' || alarm.recurrence.type === 'date') {
      update(id, { enabled: false, snoozedUntil: null, lastFiredDate: today });
    } else {
      update(id, { lastFiredDate: today, snoozedUntil: null });
    }
  }

  // §6.3 — Snooze 10 minutes.
  function snooze(id, now) {
    const base = (now || Date.now());
    update(id, { snoozedUntil: base + SNOOZE_MIN * 60000 });
  }

  function recurrenceMatchesToday(recurrence, now) {
    if (recurrence.type === 'once') return true; // gated by lastFiredDate/enabled instead
    if (recurrence.type === 'daily') return true;
    if (recurrence.type === 'weekdays') return recurrence.days.indexOf(DAY_KEYS[now.getDay()]) !== -1;
    if (recurrence.type === 'date') return recurrence.date === todayStr(now);
    return false;
  }

  // §6.3/3.4 — is this alarm due to fire right now? Never double-fires the same day/instance,
  // and a snooze only ever pushes the next check 10 minutes out (no backlog).
  function isDueNow(alarm, now) {
    now = now || new Date();
    if (!alarm.enabled) return false;
    if (alarm.snoozedUntil) return now.getTime() >= alarm.snoozedUntil;

    const today = todayStr(now);
    if (alarm.lastFiredDate === today) return false;
    if (!recurrenceMatchesToday(alarm.recurrence, now)) return false;
    return nowTimeStr(now) >= alarm.time;
  }

  function getDueAlarms(now) {
    return getList().filter(function (a) { return isDueNow(a, now); });
  }

  return {
    DAY_KEYS: DAY_KEYS,
    getList: getList,
    getById: getById,
    validateRecurrence: validateRecurrence,
    create: create,
    update: update,
    remove: remove,
    setEnabled: setEnabled,
    dismiss: dismiss,
    snooze: snooze,
    isDueNow: isDueNow,
    getDueAlarms: getDueAlarms
  };
})();
