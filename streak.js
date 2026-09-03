// streak.js — Study Streak calculation for Feature 2B.
// Reads dateHubs[dateStr].studyHours (owned by Journal, written there later).
// Calendar/this module never writes studyHours — only the persisted high score.

const Streak = (function () {
  const QUALIFY_THRESHOLD = 5; // > 5 hours qualifies a date

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function shiftDateStr(dateStr, delta) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function qualifies(dateStr) {
    const hub = DateHub.get(dateStr);
    return typeof hub.studyHours === 'number' && hub.studyHours > QUALIFY_THRESHOLD;
  }

  // Current streak = consecutive qualifying days walking backward.
  // If today has no study-hours entry yet, start from yesterday instead of
  // treating an unlogged "today" as a break — the day isn't over yet.
  function getCurrentStreak() {
    const today = todayStr();
    let cursor = qualifies(today) ? today : shiftDateStr(today, -1);
    let count = 0;
    while (qualifies(cursor)) {
      count++;
      cursor = shiftDateStr(cursor, -1);
    }
    return count;
  }

  // Longest consecutive qualifying run found anywhere in stored history (never counts future dates).
  function getLongestRun() {
    const today = todayStr();
    const hubs = DateHub.getAll();
    const qualifyingDates = Object.keys(hubs)
      .filter(function (dateStr) { return dateStr <= today && qualifies(dateStr); })
      .sort();

    let longest = 0, run = 0, prev = null;
    qualifyingDates.forEach(function (dateStr) {
      run = (prev && shiftDateStr(prev, 1) === dateStr) ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = dateStr;
    });
    return longest;
  }

  function getHighScore() {
    return (State.get().studyStreak || {}).highScore || 0;
  }

  // Recalculates current streak and updates the persisted high score if a
  // longer run (current or historical) is found. Call whenever dateHubs changes.
  function recalc() {
    const current = getCurrentStreak();
    const longestRun = getLongestRun();
    const savedHighScore = getHighScore();
    const highScore = Math.max(savedHighScore, longestRun);

    if (highScore !== savedHighScore) {
      State.set({ studyStreak: { highScore: highScore } });
    }

    return { current: current, highScore: highScore };
  }

  function qualifiesForFire(dateStr) {
    return qualifies(dateStr);
  }

  return { recalc: recalc, qualifiesForFire: qualifiesForFire };
})();
