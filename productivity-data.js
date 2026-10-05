// productivity-data.js — THE single canonical Productivity Score (0-10), per user's unified spec.
// Depends on: JournalData, ProgressData, PlannerData, TimeEngine, WaterData, SleepData, PTPE.
// PTPE rules: effort and delivered work dominate; manual self-reports are discounted and capped;
// missed/overdue work and runaway breaks subtract; wellbeing-only days cannot read as "productive".
// Habit interpretation comes from PTPE (HabitData stays the recorder). Optional `dim` ({type:'tag'|
// 'subject', id}) scopes the same formula to one tag/subject, so there is still one calculation path.
// Nobody else stores or recalculates this number: Progress's productivityValue() (progress-data.js)
// and Gamification's meter (gamification.js) both call ONLY getScore() below and display the result
// directly — no separate "gamificationProductivity" or duplicate formula anywhere.
const ProductivityData = (function () {
  // Weights sum to 1.0 (100%).
  const WEIGHTS = {
    study: 0.30,
    delivery: 0.20,
    questions: 0.13,
    punctuality: 0.10,
    habits: 0.10,
    sleep: 0.05,
    water: 0.04,
    breakBalance: 0.05,
    mood: 0.03
  };

  const STUDY_HOURS_CAP = 6;            // 6 effective hours is a full day; more adds nothing (no marathon inflation)
  const QUESTIONS_CAP = 40;
  const SCOPED_STUDY_CAP = 3;           // same curve for a single tag/subject, against a smaller daily cap
  const SCOPED_QUESTIONS_CAP = 20;
  const MANUAL_CREDIT = 0.7;            // self-reported (Journal/Unrecorded) time counts less than timer-recorded time
  const MANUAL_STUDY_CAP = 8;           // hours of manual entry that can ever count in one day
  const MANUAL_QUESTIONS_CAP = 60;
  const LATE_WEIGHT = 0.5;              // work finished after its due date earns half credit
  const COVERAGE_FLOOR = 0.4;           // sparse days are scaled down: a day with little recorded can't score 10
  const NO_EFFORT_CAP = 4;              // delivery with no recorded study/questions tops out here
  const SOFT_ONLY_CAP = 3;              // sleep/water/mood/habits alone can never make a productive day

  const PUNCTUALITY_TOLERANCE_MIN = 5;   // tiny delays don't hurt the score at all
  const PUNCTUALITY_LATE_CAP_MIN = 45;   // this late (or later) zeroes out that session's punctuality

  const SLEEP_IDEAL_HOURS = 8;           // simple productivity heuristic, not a medical target
  const SLEEP_PENALTY_PER_HOUR = 2;      // points lost per hour of deviation from the ideal

  const BREAK_RATIO_OK = 0.3;            // breaks up to 30% of study time are not penalized at all
  const BREAK_RATIO_ZERO = 1.0;          // breaks >= study time zeroes this factor out

  function clamp10(v) { return Math.max(0, Math.min(10, v)); }

  // ---------- Study (30%) — Time Engine hours at full credit + capped, discounted manual (Journal) hours,
  // run through a gentle diminishing-returns curve. ----------
  function curve(raw, cap) { return clamp10(10 * Math.pow(Math.min(1, raw / cap), 1.15)); }

  function studyFactor(entry, dateStr, dim) {
    if (dim) { const hs = PTPE.dimStudyHours(dateStr, dim); return hs > 0 ? curve(hs, SCOPED_STUDY_CAP) : null; }
    const engineH = (TimeEngine.getDayStats(dateStr).studyMs || 0) / 3600000;
    const manualH = Math.min(MANUAL_STUDY_CAP, Math.max(0, Number(entry && entry.hoursStudied) || 0));
    if (engineH <= 0 && manualH <= 0) return null;
    return curve(engineH + MANUAL_CREDIT * manualH, STUDY_HOURS_CAP);
  }

  // ---------- Questions (13%) — Time Engine questions at full credit + capped, discounted manual questions;
  // never assigned to a subject/tag unless a session recorded them. ----------
  function questionsFactor(entry, dateStr, dim) {
    if (dim) { const qs = PTPE.dimQuestions(dateStr, dim); return qs > 0 ? curve(qs, SCOPED_QUESTIONS_CAP) : null; }
    const engineQ = TimeEngine.getQuestionsForDate(dateStr) || 0;
    const manualQ = Math.min(MANUAL_QUESTIONS_CAP, Math.max(0, Number(entry && entry.questionsSolved) || 0));
    if (engineQ <= 0 && manualQ <= 0) return null;
    return curve(engineQ + MANUAL_CREDIT * manualQ, QUESTIONS_CAP);
  }

  // ---------- Punctuality (10%) — how close actualStart lands to the (shift-adjusted) scheduled
  // start, across today's scheduled sessions. Early starts are never penalized; only lateness is. ----------
  function scheduledStartMs(rec) {
    const hhmm = rec.adjustedStart || rec.plannedStart;
    if (!hhmm) return null;
    return new Date(rec.date + 'T' + hhmm + ':00').getTime();
  }

  function punctualityFactor(dateStr, dim) {
    const allTasks = dim ? PlannerData.getAllTasks() : null;
    const recs = TimeEngine.getRecordsForDate(dateStr).filter(function (r) {
      if (!r.taskId || !r.actualStart) return false;
      return !dim || (allTasks[r.taskId] && PTPE.taskInDim(allTasks[r.taskId], dim));
    });
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

  // ---------- Delivery (20%) — Planner's own tasks for the date (revision work weighs 1.5x). Work finished
  // after its due date earns LATE_WEIGHT; unfinished work earns nothing. Archived-incomplete tasks are ignored. ----------
  function deliveryFactor(dateStr, dim) {
    const tasks = (dim ? PTPE.dimTasks(dateStr, dim) : PlannerData.getTasksForDate(dateStr)).filter(function (t) { return !t.archived || t.completed; });
    if (!tasks.length) return null;
    let got = 0, total = 0;
    tasks.forEach(function (t) {
      const w = t.taskType === 'revision' ? 1.5 : 1;
      total += w;
      if (t.completed) got += w * ((t.completedDate && t.completedDate > dateStr) ? LATE_WEIGHT : 1);
    });
    return (got / total) * 10;
  }

  // ---------- Penalties — negative behaviour the data supports, bounded so one bad day can't crater a score. ----------
  function penaltiesFor(dateStr) {
    const out = [];
    if (dateStr > PTPE.today()) return out;
    const tasks = PlannerData.getTasksList().filter(function (t) { return t.date && !t.archived; });
    if (dateStr < PTPE.today()) {
      const missed = tasks.filter(function (t) { return t.date === dateStr && !t.completed; }).length;
      if (missed) out.push({ key: 'missed', label: 'Missed tasks', value: Math.min(2, 0.4 * missed) });
    }
    const lo = PTPE.shift(dateStr, -7);
    const overdue = tasks.filter(function (t) {
      return t.date < dateStr && t.date >= lo && (!t.completed || (t.completedDate && t.completedDate > dateStr));
    }).length;
    if (overdue) out.push({ key: 'overdue', label: 'Overdue work', value: Math.min(1, 0.15 * overdue) });
    const st = TimeEngine.getDayStats(dateStr);
    if (st.studyMs > 0 && st.breakMs > st.studyMs) out.push({ key: 'breaks', label: 'Long breaks', value: 0.5 });
    return out;
  }

  // ---------- Sleep (5%) — simple productivity heuristic off recorded duration, not diagnostic. ----------
  function sleepFactor(dateStr) {
    if (typeof SleepData === 'undefined') return null;
    const rec = SleepData.getRecord(dateStr);
    if (!rec || !rec.completed || rec.durationMin === null || rec.durationMin === undefined) return null;
    const hours = rec.durationMin / 60;
    return clamp10(10 - Math.abs(hours - SLEEP_IDEAL_HOURS) * SLEEP_PENALTY_PER_HOUR);
  }

  // ---------- Water (4%) — WaterData's own normalized 0-10 score, used as-is; never recomputed
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

  // ---------- Mood (3%) — existing Journal mood scale, low-weighted by design. ----------
  function moodFactor(entry) {
    const raw = ProgressData.moodValue(entry); // 1-5 scale, or null
    return (raw === null || raw === undefined) ? null : clamp10(raw * 2);
  }

  function getFactorScores(dateStr, dim) {
    const entry = JournalData.getEntry(dateStr);
    const f = {
      study: studyFactor(entry, dateStr, dim),
      delivery: deliveryFactor(dateStr, dim),
      questions: questionsFactor(entry, dateStr, dim),
      punctuality: punctualityFactor(dateStr, dim),
      habits: dim ? null : PTPE.habitFactor(dateStr),
      sleep: dim ? null : sleepFactor(dateStr),
      water: dim ? null : waterFactor(dateStr),
      breakBalance: dim ? null : breakBalanceFactor(dateStr),
      mood: dim ? null : moodFactor(entry)
    };
    // Planned work with no study behind it is a real zero, not "no data".
    if (f.delivery !== null && f.study === null) f.study = 0;
    // Questions with no study evidence at all are heavily discounted.
    if (f.questions !== null && !(f.study > 0)) f.questions = Math.min(f.questions, 4);
    return f;
  }

  // Missing-data handling: factors with no applicable data are excluded and the rest renormalized, but never
  // below COVERAGE_FLOOR of the total weight, so sparse days stay modest. Penalties then subtract.
  function getBreakdown(dateStr, dim) {
    const factors = getFactorScores(dateStr, dim);
    let weightedSum = 0, totalWeight = 0;
    Object.keys(WEIGHTS).forEach(function (key) {
      const v = factors[key];
      if (v === null || v === undefined || isNaN(v)) return;
      weightedSum += WEIGHTS[key] * v;
      totalWeight += WEIGHTS[key];
    });
    if (totalWeight <= 0) return { score: null, factors: factors, penalties: [] };
    let base = weightedSum / Math.max(totalWeight, COVERAGE_FLOOR);
    const hasCore = ['study', 'delivery', 'questions'].some(function (k) { return factors[k] !== null && factors[k] > 0; });
    if (!hasCore) base = Math.min(base, SOFT_ONLY_CAP);
    // Tasks ticked off with no study time or questions behind them can't read as a strongly productive day.
    else if (!(factors.study > 0) && !(factors.questions > 0)) base = Math.min(base, NO_EFFORT_CAP);
    const penalties = dim ? [] : penaltiesFor(dateStr);
    const penalty = penalties.reduce(function (a, p) { return a + p.value; }, 0);
    return { score: Math.round(clamp10(base - penalty) * 10) / 10, factors: factors, penalties: penalties };
  }

  function getScore(dateStr, dim) {
    const b = getBreakdown(dateStr, dim);
    return { score: b.score, factors: b.factors };
  }

  return { WEIGHTS: WEIGHTS, getFactorScores: getFactorScores, getBreakdown: getBreakdown, getScore: getScore };
})();
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
