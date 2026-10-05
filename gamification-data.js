// gamification-data.js — Gamification EXP/level data layer (§B.8.1/8.3/8.4). Depends on: State,
// PlannerData, TimeEngine, Streak. Never stores its own Productivity value — see productivity-data.js,
// the single shared source both Progress and Gamification read from.
//
// EXP is an append-only event ledger, SETTLED ONCE per day at the 11 PM cutoff (TimeEngine.isPastCutoff),
// never applied live as events happen — matches §8.3 exactly.
//
// OPEN QUESTION FLAGGED, NOT GUESSED (§8.3): the spec lists two doubling conditions —
// ">5 hours studied" and "7-day streak maintained (only after 5h studied)". Since the second
// condition is a strict subset of the first (both require >5h studied), this implementation
// treats them as ONE shared "doubled" flag (doubled = studied > 5h that day) rather than
// stacking multiplicatively. If the intent was a separate 2x+2x=4x stack when both are true,
// that needs to be confirmed and this function updated.
const GamificationData = (function () {
  const LEVEL_THRESHOLDS_1_10 = [0, 100, 200, 400, 600, 900, 1200, 1500, 1800, 2100]; // §8.4, hardcoded
  const POST_10_BASE_INCREMENT = 300; // §8.4 "+300/level" beyond level 10
  const POST_10_INCREMENT_STEP = 100; // §8.4 "+100 to that increment every 5 levels"
  const MAX_PRECOMPUTED_LEVEL = 60;   // plenty of headroom; extend if ever needed

    const STREAK_BONUS_THRESHOLD = 3;   // §8.3 "3-day streak reached"
  const STREAK_BONUS_EXP = 150;
  const DOUBLE_HOURS_THRESHOLD = 5;   // long-study bonus needs >5h of Time-Engine-recorded study
  // PTPE EXP rules — meaningful progress, not button presses. Everything below is idempotent per task/target/day.
  const LONG_STUDY_BONUS_RATE = 0.5;  // +50% of the day's earned EXP (never of penalties), replacing the old 2x
  const LONG_STUDY_BONUS_CAP = 300;
  const STUDY_EXP_PER_HOUR = 75;
  const MIN_STUDY_SEGMENT_MS = 60000; // sub-minute start/stop segments earn nothing (no tap-farming)
  const STUDY_FULL_MS = 6 * 3600000;  // study EXP is full-rate to 6h, half-rate to 9h, nothing beyond
  const STUDY_HARD_MS = 9 * 3600000;
  const LATE_TASK_MULT = 0.5;         // tasks finished after their due date
  const DAILY_FULL_TASKS = 6;         // tasks beyond this per day earn half; beyond DAILY_MAX_TASKS earn nothing
  const DAILY_MAX_TASKS = 12;
  const PENDING_PENALTY_CAP = 200;    // one bad day cannot cost more than this in pending-task penalties

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
  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- §8.4 Levels ----------

  function buildThresholds() {
    const arr = LEVEL_THRESHOLDS_1_10.slice();
    let increment = POST_10_BASE_INCREMENT;
    for (let lvl = 11; lvl <= MAX_PRECOMPUTED_LEVEL; lvl++) {
      if (lvl > 11 && (lvl - 11) % 5 === 0) increment += POST_10_INCREMENT_STEP;
      arr.push(arr[arr.length - 1] + increment);
    }
    return arr;
  }
  const THRESHOLDS = buildThresholds();

  function getLevelInfo(totalExp) {
    const exp = Math.max(0, totalExp || 0);
    let level = 1;
    for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
      if (exp >= THRESHOLDS[i]) { level = i + 1; break; }
    }
    const currentThreshold = THRESHOLDS[level - 1];
    const nextThreshold = THRESHOLDS[level] !== undefined ? THRESHOLDS[level] : (currentThreshold + POST_10_BASE_INCREMENT);
    return {
      level: level,
      totalExp: exp,
      expIntoLevel: exp - currentThreshold,
      expForNextLevel: nextThreshold - currentThreshold
    };
  }

  // ---------- State access ----------

  function getGamState() {
    return State.get().gamification || { totalExp: 0, lastSettledDate: null, streakBonusAwardedForRun: false };
  }
  function getLedger() {
    return State.get().expLedger || [];
  }

  // ---------- Live awards (task completion + standalone study time) ----------
  // Task completion and Stopwatch/Timer study time are now awarded THE MOMENT they happen,
  // not batched to the 11 PM cutoff — makes the EXP bar feel live. The cutoff settlement below
  // no longer recomputes "task completed" (that would double-count); it only adds what genuinely
  // can't be known until the day is over: pending penalties, the streak bonus, the break penalty,
  // and the >5h doubling supplement (which now doubles live-awarded EXP too, see rawTotal below).

  function awardLive(dateStr, label, exp, meta) {
    if (!exp) return;
    const ledger = getLedger().slice();
    ledger.push(Object.assign(
      { id: generateId('exp'), date: dateStr, label: label, exp: exp, doubled: false, live: true, at: Date.now() },
      meta || {}
    ));
    const gam = getGamState();
    const newTotal = Math.max(0, gam.totalExp + exp);
    State.set({ expLedger: ledger, gamification: Object.assign({}, gam, { totalExp: newTotal }) });
  }

    // Base value only (Itinerary reads this for expected-EXP counters). Standalone custom tasks are worth less
  // than topic work; R6 is the cycle's capstone.
  function taskExpValue(task) {
    if (task.taskType === 'revision' && task.revisionNumber === 'R6') return 250;
    if (task.taskType === 'revision' && task.revisionNumber === 6) return 250;
    return task.taskType === 'custom' ? 40 : 100;
  }

  // Net EXP currently held for one task/target: the ledger is the single record, so awards are
  // idempotent (already rewarded = no second reward) and a retract reverses exactly what was granted.
  function netAwarded(idField, id, kinds) {
    return getLedger().reduce(function (sum, e) {
      return (e[idField] === id && kinds.indexOf(e.kind) !== -1) ? sum + e.exp : sum;
    }, 0);
  }

  function tasksRewardedOn(dateStr) {
    const net = {};
    getLedger().forEach(function (e) {
      if (e.kind !== 'task' && e.kind !== 'task-retract') return;
      net[e.taskId] = (net[e.taskId] || 0) + e.exp;
    });
    const dated = {};
    getLedger().forEach(function (e) { if (e.kind === 'task' && e.date === dateStr && e.exp > 0) dated[e.taskId] = true; });
    return Object.keys(dated).filter(function (id) { return net[id] > 0; }).length;
  }

  // R6 only pays the capstone value once R1-R5 of the same cycle are actually done.
  function earlierRevisionsDone(task) {
    if (!task.cycleId) return true;
    return PlannerData.getTasksList().filter(function (t) {
      return t.cycleId === task.cycleId && t.taskType === 'revision' && t.revisionNumber !== task.revisionNumber && t.revisionNumber !== 'R6' && t.revisionNumber !== 6;
    }).every(function (t) { return t.completed; });
  }

  // Called from PlannerData.toggleComplete the instant a task is checked off.
  function awardTaskCompleted(task) {
    if (netAwarded('taskId', task.taskId, ['task', 'task-retract']) > 0) return; // duplicate completion event
    const dateStr = task.completedDate || todayStr();
    const isR6 = task.taskType === 'revision' && (task.revisionNumber === 'R6' || task.revisionNumber === 6);
    let exp = (isR6 && !earlierRevisionsDone(task)) ? 100 : taskExpValue(task);
    if (task.date && task.date < dateStr) exp *= LATE_TASK_MULT;
    const already = tasksRewardedOn(dateStr);
    if (already >= DAILY_MAX_TASKS) return;
    if (already >= DAILY_FULL_TASKS) exp *= 0.5;
    const label = isR6
      ? 'Revision cycle completed (R6): ' + (task.topicName || '')
      : 'Task completed: ' + (task.topicName || task.title || PlannerData.taskLabel(task));
    awardLive(dateStr, label, Math.round(exp), { taskId: task.taskId, kind: 'task' });
  }

  // Called from PlannerData.toggleComplete if a task is un-checked again — reverses exactly the
  // net amount held for that task, so toggling on/off can never be farmed.
  function retractTaskCompleted(task) {
    const net = netAwarded('taskId', task.taskId, ['task', 'task-retract']);
    if (net <= 0) return;
    const label = 'Task un-completed: ' + (task.topicName || task.title || PlannerData.taskLabel(task));
    awardLive(task.completedDate || todayStr(), label, -net, { taskId: task.taskId, kind: 'task-retract' });
  }

  function targetExpValue(target) {
    if (target.timeframe === 'monthly') return 400;
    if (target.timeframe === 'weekly') return 200;
    return 100; // daily
  }

  function awardTargetCompleted(target) {
    if (netAwarded('targetId', target.targetId, ['target', 'target-retract']) > 0) return;
    awardLive(todayStr(), 'Target completed: ' + target.title, targetExpValue(target), { targetId: target.targetId, kind: 'target' });
  }

  function retractTargetCompleted(target) {
    const net = netAwarded('targetId', target.targetId, ['target', 'target-retract']);
    if (net <= 0) return;
    awardLive(todayStr(), 'Target uncompleted: ' + target.title, -net, { targetId: target.targetId, kind: 'target-retract' });
  }

  function spendExp(amount, label) {
    const cost = Math.max(0, amount || 0);
    if (!cost) return true;
    const gam = getGamState();
    if (gam.totalExp < cost) return false;
    awardLive(todayStr(), label || 'Purchase', -cost, { kind: 'purchase' });
    return true;
  }
  
    // Called from Study.commitSegment for every committed Stopwatch/Timer segment — proportional EXP per
  // hour, full-rate to 6h/day and half-rate to 9h/day (nothing beyond). Sub-minute segments earn nothing.
  function awardStudyTime(ms, mode) {
    if (!ms || ms < MIN_STUDY_SEGMENT_MS) return;
    const dateStr = todayStr();
    const doneMs = getLedger().reduce(function (sum, e) { return (e.kind === 'study' && e.date === dateStr) ? sum + (e.ms || 0) : sum; }, 0);
    const credit = function (x) { return Math.min(x, STUDY_FULL_MS) + 0.5 * Math.max(0, Math.min(x, STUDY_HARD_MS) - STUDY_FULL_MS); };
    const exp = Math.round(((credit(doneMs + ms) - credit(doneMs)) / 3600000) * STUDY_EXP_PER_HOUR);
    if (exp <= 0) return;
    const label = (mode === 'timer' ? 'Timer' : 'Stopwatch') + ' session (' + Math.round(ms / 60000) + ' min)';
    awardLive(dateStr, label, exp, { kind: 'study', ms: ms });
  }

  // ---------- §8.3 Daily settlement (cutoff-only events) ----------

  function settleDay(dateStr) {
    const gam = getGamState();
    if (gam.lastSettledDate === dateStr) return; // never double-settle the same date

    const events = [];

        // Task left pending (-50 each) / Revision cycle incomplete at R6 (-150, replaces the -50) — capped per day.
    let pendingTotal = 0;
    PlannerData.getTasksForDate(dateStr).filter(function (t) { return !t.completed && !t.archived; }).forEach(function (t) {
      const isR6 = t.taskType === 'revision' && (t.revisionNumber === 'R6' || t.revisionNumber === 6);
      const e = isR6
        ? { label: 'Revision cycle incomplete: ' + (t.topicName || ''), exp: -150 }
        : { label: 'Task left pending: ' + (t.topicName || t.title || PlannerData.taskLabel(t)), exp: -50 };
      if (pendingTotal + e.exp < -PENDING_PENALTY_CAP) return;
      pendingTotal += e.exp;
      events.push(e);
    });

    // Breaks exceeding study time (-100).
    const stats = TimeEngine.getDayStats(dateStr);
    if (stats.studyMs > 0 && stats.breakMs > stats.studyMs) {
      events.push({ label: 'Breaks exceeded study time', exp: -100 });
    }

    // PTPE interprets Habit Tracker / consistency data into EXP events (settled once per day, here only).
    if (typeof PTPE !== 'undefined' && PTPE.dayExpEvents) {
      PTPE.dayExpEvents(dateStr).forEach(function (e) { events.push(e); });
    }

    // 3-day streak reached (+200, one-time per run — resets once the streak breaks below 3).
    const streakInfo = Streak.recalc();
    const streak = streakInfo.current;
    let nextStreakFlag = gam.streakBonusAwardedForRun;
    if (streak < STREAK_BONUS_THRESHOLD) {
      nextStreakFlag = false;
    } else if (!gam.streakBonusAwardedForRun) {
      events.push({ label: STREAK_BONUS_THRESHOLD + '-day streak reached', exp: STREAK_BONUS_EXP });
      nextStreakFlag = true;
    }

        // Long-study bonus (replaces the old 2x doubling): >5h of Time-Engine-recorded study adds 50% of what
    // the day EARNED (net live EXP + positive cutoff events — penalties are never amplified), capped.
    const liveNetToday = getLedger()
      .filter(function (e) { return e.date === dateStr && e.live; })
      .reduce(function (sum, e) { return sum + e.exp; }, 0);
    const cutoffRawTotal = events.reduce(function (sum, e) { return sum + e.exp; }, 0);
    const cutoffGain = events.reduce(function (sum, e) { return e.exp > 0 ? sum + e.exp : sum; }, 0);

    const studiedHours = stats.studyMs / 3600000;
    const bonus = studiedHours > DOUBLE_HOURS_THRESHOLD
      ? Math.min(LONG_STUDY_BONUS_CAP, Math.round(LONG_STUDY_BONUS_RATE * Math.max(0, liveNetToday + cutoffGain)))
      : 0;
    const finalDelta = cutoffRawTotal + bonus;

    const ledger = getLedger().slice();
    events.forEach(function (e) {
      ledger.push({ id: generateId('exp'), date: dateStr, label: e.label, exp: e.exp, doubled: false, at: Date.now() });
    });
    if (bonus > 0) {
      ledger.push({ id: generateId('exp'), date: dateStr, label: 'Long-study bonus (>5h studied)', exp: bonus, doubled: false, at: Date.now() });
    }

    const newTotal = Math.max(0, gam.totalExp + finalDelta);
    State.set({
      expLedger: ledger,
      gamification: { totalExp: newTotal, lastSettledDate: dateStr, streakBonusAwardedForRun: nextStreakFlag }
    });
  }

  // Called from Gamification's TimeEngine heartbeat subscriber (Feature 11 — previously its own
  // setInterval poll, same pattern Water/Alarm used before their migration). Settles today once
  // past the 11 PM cutoff. Multi-day catch-up (the app was closed across more than one cutoff)
  // is now handled separately by onRolloverCatchUp below, wired to TimeEngine's Feature 12
  // rollover signal — this function no longer re-derives "yesterday" from the wall clock itself,
  // since that only ever covered a one-day gap and silently dropped anything older.
  function maybeSettle() {
    const today = todayStr();
    if (TimeEngine.isPastCutoff() && getGamState().lastSettledDate !== today) {
      settleDay(today);
    }
  }

  // Feature 12 catch-up — called with the true (fromDateStr, toDateStr) of a real rollover, from
  // TimeEngine.onRollover. Walks every date strictly between the last settled date and today
  // (inclusive of the outgoing day) and settles each one in order, so closing the app across
  // several midnights no longer silently skips all but the most recent day. lastSettledDate
  // naturally advances one day at a time inside settleDay's own State.set, so re-reading
  // getGamState() between iterations keeps settleDay's own "never double-settle" guard correct.
  function onRolloverCatchUp(fromDateStr, toDateStr) {
    if (!fromDateStr || !toDateStr || fromDateStr === toDateStr) return;
    const gam = getGamState();
    // Start from whichever is later: the day the engine rolled over FROM, or the day after
    // whatever was last actually settled — never re-walks a date that's already settled, and
    // never starts earlier than the outgoing engine date (that's not this module's gap to fill).
    let cursor = (gam.lastSettledDate && gam.lastSettledDate >= fromDateStr)
      ? shiftDateStr(gam.lastSettledDate, 1)
      : fromDateStr;
    let guard = 0; // sanity cap so a corrupt/garbage date pair can never loop forever
    while (cursor < toDateStr && guard < 3660) {
      settleDay(cursor);
      cursor = shiftDateStr(cursor, 1);
      guard++;
    }
  }

  // Wire into TimeEngine's Feature 12 rollover signal once, under a stable id so re-running
  // init-style setup code never stacks a duplicate subscription.
  if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.onRollover === 'function') {
    TimeEngine.onRollover(onRolloverCatchUp, 'gamification');
  }

  return {
    getGamState: getGamState,
    getLedger: getLedger,
    getLevelInfo: getLevelInfo,
    settleDay: settleDay,
    maybeSettle: maybeSettle,
    onRolloverCatchUp: onRolloverCatchUp,
    awardTaskCompleted: awardTaskCompleted,
    retractTaskCompleted: retractTaskCompleted,
    awardStudyTime: awardStudyTime,
    awardTargetCompleted: awardTargetCompleted,
    retractTargetCompleted: retractTargetCompleted,
    spendExp: spendExp,
    // Exposed read-only for Itinerary's expected-EXP counters (Phase 5 §16, Phase 6 §14) — pure
    // functions, never write to expLedger themselves. Not previously exported; itinerary.js's
    // builder already called these, so this was a latent bug fixed while wiring Phase 5 in.
    taskExpValue: taskExpValue,
    targetExpValue: targetExpValue
  };
})();
