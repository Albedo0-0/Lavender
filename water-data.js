// water-data.js — Water Tracker data layer (§B.4). No UI here. Depends on: State, Notify, SleepData.
// State.get().waterEvents[dateStr] = [{ id, category, value, at }] — manual entry and reminder-driven
// logging both write here (§4.2, no separate tables). State.get().waterReminder holds the single
// adaptive reminder schedule (§4.4), reset per date (§B.12's per-module daily reset, applied inline
// here since there's no separate rollover module).
const WaterData = (function () {
  // §4.1 — exactly four categories; internal values are calculation-only, never shown to the user.
  const CATEGORIES = {
    tiny: { label: 'Tiny sip', value: 1, intervalMin: 30 },
    few: { label: 'Few sips', value: 3, intervalMin: 60 },
    good: { label: 'Good amount', value: 6, intervalMin: 90 },
    lot: { label: 'Lot', value: 10, intervalMin: 120 }
  };
  const DEFAULT_INTERVAL_MIN = 60;
  const MIN_INTERVAL_MIN = 20;   // §4.4 sensible bound floor
  const MAX_INTERVAL_MIN = 150;  // §4.4 sensible bound ceiling
  const LATER_SNOOZE_MIN = 10;
  const DEFAULT_MORNING_HOUR = 8; // fallback wake time when Sleep has no record (§4.5)
  const HYDRATION_SCORE_CAP = 24; // ~ 4x "Good amount" worth of events counts as a full 10/10 day

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function getAllEvents() {
    return State.get().waterEvents || {};
  }

  function getEventsForDate(dateStr) {
    return getAllEvents()[dateStr] || [];
  }

  // §4.3 — normalized 0-10 daily hydration score, feeds Progress the same way other daily metrics do.
  function getScoreForDate(dateStr) {
    const events = getEventsForDate(dateStr);
    if (!events.length) return null;
    const sum = events.reduce(function (acc, e) { return acc + (e.value || 0); }, 0);
    return Math.max(0, Math.min(10, Math.round((sum / HYDRATION_SCORE_CAP) * 100) / 10));
  }

  function getReminderState() {
    const rs = State.get().waterReminder;
    const today = todayStr();
    // Per-date reset (§B.12 pattern) — a new day always starts a fresh schedule.
    if (!rs || rs.date !== today) {
      return { date: today, lastFiredAt: null, lastCategory: null, snoozedUntil: null };
    }
    return rs;
  }

  function setReminderState(partial) {
    const next = Object.assign({}, getReminderState(), partial, { date: todayStr() });
    State.set({ waterReminder: next });
    return next;
  }

  // §4.2/4.1 — manual entry and reminder "Done" both call this; single event source.
  function logEvent(dateStr, categoryKey) {
    const cat = CATEGORIES[categoryKey];
    if (!cat) return null;
    const all = Object.assign({}, getAllEvents());
    const list = (all[dateStr] || []).slice();
    const event = { id: 'w' + Date.now() + Math.floor(Math.random() * 1000), category: categoryKey, value: cat.value, at: Date.now() };
    list.push(event);
    all[dateStr] = list;
    State.set({ waterEvents: all });
    // Logging also counts as "responding" to the reminder cycle — advance the schedule.
    setReminderState({ lastFiredAt: Date.now(), lastCategory: categoryKey, snoozedUntil: null });
    return event;
  }

  // §4.4 — interval adapts to the last reported amount, bounded so it can never create excessive gaps.
  function nextIntervalMs() {
    const rs = getReminderState();
    const cat = rs.lastCategory ? CATEGORIES[rs.lastCategory] : null;
    const minutes = Math.max(MIN_INTERVAL_MIN, Math.min(MAX_INTERVAL_MIN, cat ? cat.intervalMin : DEFAULT_INTERVAL_MIN));
    return minutes * 60000;
  }

  // §4.5 — morning reminder anchor: recorded wake time if available, else a safe default.
  function morningAnchor(dateStr) {
    const wake = (typeof SleepData !== 'undefined') ? SleepData.getWakeTimeFor(dateStr) : null;
    const anchor = new Date(dateStr + 'T00:00:00');
    if (wake) {
      const wp = wake.split(':');
      anchor.setHours(Number(wp[0]), Number(wp[1]), 0, 0);
    } else {
      anchor.setHours(DEFAULT_MORNING_HOUR, 0, 0, 0);
    }
    return anchor;
  }

  // §4.4/4.5/3.4 — is a reminder due right now? Mandatory first-of-day reminder once past the
  // morning anchor; after that, adaptive interval; never fires inside the recorded sleep window;
  // "Later" snooze is honored but never allowed to create a backlog beyond its own 10 min.
  function isReminderDueNow(now) {
    now = now || new Date();
    const today = todayStr();
    if (typeof SleepData !== 'undefined' && SleepData.isWithinSleepWindow(now, today)) return false;

    const rs = getReminderState();
    if (rs.snoozedUntil && now.getTime() < rs.snoozedUntil) return false;

    if (!rs.lastFiredAt) {
      // First reminder of the day — mandatory, gated only by the morning anchor.
      return now >= morningAnchor(today);
    }
    return Notify.isDue(rs.lastFiredAt, nextIntervalMs(), now.getTime());
  }

  // Call when a reminder is actually shown (not just logged) — marks it fired without a category
  // change, so the interval stays based on the last real intake report.
  function markFired() {
    setReminderState({ lastFiredAt: Date.now() });
  }

  // §4.4 "Later" — re-fires in 10 minutes, inherently capped since it only ever pushes the next
  // check 10 minutes out (never stacks additional reminders on top of itself).
  function markLater() {
    setReminderState({ snoozedUntil: Date.now() + LATER_SNOOZE_MIN * 60000 });
  }

  return {
    CATEGORIES: CATEGORIES,
    getEventsForDate: getEventsForDate,
    getScoreForDate: getScoreForDate,
    logEvent: logEvent,
    isReminderDueNow: isReminderDueNow,
    markFired: markFired,
    markLater: markLater,
    todayStr: todayStr
  };
})();
