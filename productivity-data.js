// productivity-data.js — THE single canonical Productivity Score (0-10), per user's unified spec.
// Depends on: JournalData, ProgressData, PlannerData, TimeEngine, WaterData, SleepData.
// Nobody else stores or recalculates this number: Progress's productivityValue() (progress-data.js)
// and Gamification's meter (gamification.js) both call ONLY getScore() below and display the result
// directly — no separate "gamificationProductivity" or duplicate formula anywhere.
const ProductivityData = (function () {
  // Weights sum to 1.0 (100%).
  const WEIGHTS = {
    study: 0.30,
    questions: 0.15,
    punctuality: 0.15,
    taskCompletion: 0.10,
    sleep: 0.10,
    water: 0.10,
    breakBalance: 0.05,
    mood: 0.05
  };

  // Same caps ProgressData already uses to normalize its own unbounded numbers onto 0-10 —
  // duplicated here (not imported) only because they're plain constants, so both stay in sync
  // by convention rather than a shared reference; if ProgressData's caps ever change, update here too.
  const STUDY_HOURS_CAP = 8;
  const QUESTIONS_CAP = 40;

  const PUNCTUALITY_TOLERANCE_MIN = 5;   // tiny delays don't hurt the score at all
  const PUNCTUALITY_LATE_CAP_MIN = 45;   // this late (or later) zeroes out that session's punctuality

  const SLEEP_IDEAL_HOURS = 8;           // simple productivity heuristic, not a medical target
  const SLEEP_PENALTY_PER_HOUR = 2;      // points lost per hour of deviation from the ideal

  const BREAK_RATIO_OK = 0.3;            // breaks up to 30% of study time are not penalized at all
  const BREAK_RATIO_ZERO = 1.0;          // breaks >= study time zeroes this factor out

  function clamp10(v) { return Math.max(0, Math.min(10, v)); }
  function normalize(raw, cap) {
    if (raw === null || raw === undefined || isNaN(raw)) return null;
    return clamp10((raw / cap) * 10);
  }

  // ---------- Study (30%) — actual elapsed time (journal-unspecified + Time Engine), existing
  // reconciliation rule reused verbatim via ProgressData.studyHoursValue. ----------
  function studyFactor(entry, dateStr) {
    return normalize(ProgressData.studyHoursValue(entry, dateStr), STUDY_HOURS_CAP);
  }

  // ---------- Questions (15%) — same source-merge rule as Progress; never assigns Journal's
  // unspecified questions to any subject (ProgressData.questionsValue already keeps them subject-less). ----------
  function questionsFactor(entry, dateStr) {
    return normalize(ProgressData.questionsValue(entry, dateStr), QUESTIONS_CAP);
  }

  // ---------- Punctuality (15%) — how close actualStart lands to the (shift-adjusted) scheduled
  // start, across today's scheduled sessions. Early starts are never penalized; only lateness is. ----------
  function scheduledStartMs(rec) {
    const hhmm = rec.adjustedStart || rec.plannedStart;
    if (!hhmm) return null;
    return new Date(rec.date + 'T' + hhmm + ':00').getTime();
  }

  function punctualityFactor(dateStr) {
    const recs = TimeEngine.getRecordsForDate(dateStr).filter(function (r) { return r.taskId && r.actualStart; });
    const scored = [];
    recs.forEach(function (rec) {
      const schedMs = scheduledStartMs(rec);
      if (schedMs === null) return;
      const lateMin = (rec.actualStart - schedMs) / 60000;
      let score;
      if (lateMin <= PUNCTUALITY_TOLERANCE_MIN) score = 10;
      else if (lateMin >= PUNCTUALITY_LATE_CAP_MIN) score = 0;
      else score = 10 * (1 - (lateMin - PUNCTUALITY_TOLERANCE_MIN) / (PUNCTUALITY_LATE_CAP_MIN - PUNCTUALITY_TOLERANCE_MIN));
      scored.push(score);
    });
    if (!scored.length) return null;
    return scored.reduce(function (a, b) { return a + b; }, 0) / scored.length;
  }

  // ---------- Task Completion (10%) — Planner's own task list for the date, one entry per task
  // (revision cycles/timetable slots are already single Planner tasks, never duplicated here). ----------
  function taskCompletionFactor(dateStr) {
    const tasks = PlannerData.getTasksForDate(dateStr);
    if (!tasks.length) return null;
    const completed = tasks.filter(function (t) { return t.completed; }).length;
    return (completed / tasks.length) * 10;
  }

  // ---------- Sleep (10%) — simple productivity heuristic off recorded duration, not diagnostic. ----------
  function sleepFactor(dateStr) {
    if (typeof SleepData === 'undefined') return null;
    const rec = SleepData.getRecord(dateStr);
    if (!rec || !rec.completed || rec.durationMin === null || rec.durationMin === undefined) return null;
    const hours = rec.durationMin / 60;
    return clamp10(10 - Math.abs(hours - SLEEP_IDEAL_HOURS) * SLEEP_PENALTY_PER_HOUR);
  }

  // ---------- Water (10%) — WaterData's own normalized 0-10 score, used as-is; never recomputed
  // from raw ml/bottle units here. ----------
  function waterFactor(dateStr) {
    return (typeof WaterData !== 'undefined') ? WaterData.getScoreForDate(dateStr) : null;
  }

  // ---------- Break Balance (5%) — break time relative to study time, from Time Engine. ----------
  function breakBalanceFactor(dateStr) {
    const stats = TimeEngine.getDayStats(dateStr);
    if (!stats.studyMs || stats.studyMs <= 0) return null;
    const ratio = stats.breakMs / stats.studyMs;
    if (ratio <= BREAK_RATIO_OK) return 10;
    if (ratio >= BREAK_RATIO_ZERO) return 0;
    return 10 * (1 - (ratio - BREAK_RATIO_OK) / (BREAK_RATIO_ZERO - BREAK_RATIO_OK));
  }

  // ---------- Mood (5%) — existing Journal mood scale, low-weighted by design. ----------
  function moodFactor(entry) {
    const raw = ProgressData.moodValue(entry); // 1-5 scale, or null
    return (raw === null || raw === undefined) ? null : clamp10(raw * 2);
  }

  function getFactorScores(dateStr) {
    const entry = JournalData.getEntry(dateStr);
    return {
      study: studyFactor(entry, dateStr),
      questions: questionsFactor(entry, dateStr),
      punctuality: punctualityFactor(dateStr),
      taskCompletion: taskCompletionFactor(dateStr),
      sleep: sleepFactor(dateStr),
      water: waterFactor(dateStr),
      breakBalance: breakBalanceFactor(dateStr),
      mood: moodFactor(entry)
    };
  }

  // Missing-data handling: any factor with no applicable data is excluded, and the remaining
  // weights are renormalized so the score stays meaningful — never invents a value, never
  // punishes the user just because something wasn't recorded that day.
  function getScore(dateStr) {
    const factors = getFactorScores(dateStr);
    let weightedSum = 0, totalWeight = 0;
    Object.keys(WEIGHTS).forEach(function (key) {
      const v = factors[key];
      if (v === null || v === undefined || isNaN(v)) return;
      weightedSum += WEIGHTS[key] * v;
      totalWeight += WEIGHTS[key];
    });
    if (totalWeight <= 0) return { score: null, factors: factors };
    const score = Math.round(clamp10(weightedSum / totalWeight) * 10) / 10;
    return { score: score, factors: factors };
  }

  return { WEIGHTS: WEIGHTS, getFactorScores: getFactorScores, getScore: getScore };
})();
