// sleep-data.js — Sleep Tracker data layer (§B.5). No UI here. Depends on: State.
// One record per date: State.get().sleepRecords[dateStr] = { date, sleepTime, wakeTime, durationMin, completed, dismissed }.
// sleepTime is the previous night's bedtime, wakeTime is this date's wake time — both 'HH:MM' 24h strings.
// Feeds Progress (§5.3) via ProgressData's 'sleep' metric — no separate sleep analytics system here.
const SleepData = (function () {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function yesterdayOf(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function getAllRecords() {
    return State.get().sleepRecords || {};
  }

  function getRecord(dateStr) {
    const all = getAllRecords();
    return all[dateStr] || { date: dateStr, sleepTime: null, wakeTime: null, durationMin: null, completed: false, dismissed: false };
  }

  // §5.1 — duration handles the midnight crossing (e.g. 23:30 -> 07:00 = 7h30m) and the
  // less common same-night-after-midnight case (e.g. 00:30 -> 07:00 = 6h30m) with one formula.
  function computeDurationMin(sleepTime, wakeTime) {
    if (!sleepTime || !wakeTime) return null;
    const sp = sleepTime.split(':'); const wp = wakeTime.split(':');
    const sleepMin = Number(sp[0]) * 60 + Number(sp[1]);
    const wakeMin = Number(wp[0]) * 60 + Number(wp[1]);
    if (isNaN(sleepMin) || isNaN(wakeMin)) return null;
    return (wakeMin <= sleepMin) ? (1440 - sleepMin) + wakeMin : wakeMin - sleepMin;
  }

  function saveRecord(dateStr, fields) {
    const all = Object.assign({}, getAllRecords());
    const existing = getRecord(dateStr);
    const next = Object.assign({}, existing, fields, { date: dateStr });
    next.durationMin = computeDurationMin(next.sleepTime, next.wakeTime);
    next.completed = !!(next.sleepTime && next.wakeTime);
    if (next.completed) next.dismissed = false;
    all[dateStr] = next;
    State.set({ sleepRecords: all });
    return next;
  }

  // §5.2 — safe way to leave the prompt incomplete: dismiss persists so the auto-prompt
  // doesn't re-nag every reopen, without marking the record complete.
  function dismiss(dateStr) {
    const all = Object.assign({}, getAllRecords());
    const existing = getRecord(dateStr);
    all[dateStr] = Object.assign({}, existing, { date: dateStr, dismissed: true });
    State.set({ sleepRecords: all });
  }

  // §5.2 — prompted once per date until completed.
  function isPromptDue(dateStr) {
    const rec = getRecord(dateStr);
    return !rec.completed && !rec.dismissed;
  }

  // §4.5 support — is `now` inside last night's recorded sleep window for the given wake date?
  // Falls back safely (returns false) when either half of the window is missing.
  function isWithinSleepWindow(nowDate, wakeDateStr) {
    const wakeRec = getRecord(wakeDateStr);
    const sleepRec = getRecord(yesterdayOf(wakeDateStr));
    if (!sleepRec.sleepTime || !wakeRec.wakeTime) return false;

    const sp = sleepRec.sleepTime.split(':');
    const wp = wakeRec.wakeTime.split(':');
    const bedStart = new Date(yesterdayOf(wakeDateStr) + 'T00:00:00');
    bedStart.setHours(Number(sp[0]), Number(sp[1]), 0, 0);
    let wakeEnd = new Date(wakeDateStr + 'T00:00:00');
    wakeEnd.setHours(Number(wp[0]), Number(wp[1]), 0, 0);
    if (wakeEnd <= bedStart) wakeEnd.setDate(wakeEnd.getDate() + 1);
    return nowDate >= bedStart && nowDate <= wakeEnd;
  }

  function getWakeTimeFor(dateStr) {
    const rec = getRecord(dateStr);
    return rec.wakeTime || null;
  }

  return {
    todayStr: todayStr,
    getAllRecords: getAllRecords,
    getRecord: getRecord,
    saveRecord: saveRecord,
    dismiss: dismiss,
    isPromptDue: isPromptDue,
    isWithinSleepWindow: isWithinSleepWindow,
    getWakeTimeFor: getWakeTimeFor,
    computeDurationMin: computeDurationMin
  };
})();
