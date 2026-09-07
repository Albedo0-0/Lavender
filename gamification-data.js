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
  const STREAK_BONUS_EXP = 200;
  const DOUBLE_HOURS_THRESHOLD = 5;   // §8.3 both doubling conditions require >5h studied

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

  function taskExpValue(task) {
    return (task.taskType === 'revision' && task.revisionNumber === 6) ? 400 : 100;
  }

  // Called from PlannerData.toggleComplete the instant a task is checked off.
  function awardTaskCompleted(task) {
    const dateStr = task.completedDate || todayStr();
    const isR6 = task.taskType === 'revision' && task.revisionNumber === 6;
    const label = isR6
      ? 'Revision cycle completed (R6): ' + (task.topicName || '')
      : 'Task completed: ' + (task.topicName || task.title || PlannerData.taskLabel(task));
    awardLive(dateStr, label, taskExpValue(task), { taskId: task.taskId, kind: 'task' });
  }

  // Called from PlannerData.toggleComplete if a task is un-checked again — reverses the exact
  // amount awardTaskCompleted granted, so toggling on/off can't be farmed for free EXP.
  function retractTaskCompleted(task) {
    const dateStr = task.completedDate || todayStr();
    const label = 'Task un-completed: ' + (task.topicName || task.title || PlannerData.taskLabel(task));
    awardLive(dateStr, label, -taskExpValue(task), { taskId: task.taskId, kind: 'task-retract' });
  }

  // Called from Study.commitSegment for every committed Stopwatch/Timer segment — 100 EXP/hour,
  // proportional, logged even for very short segments (min 1 EXP so a 1-minute segment ~= 1-2 EXP
  // never rounds away to nothing).
  function awardStudyTime(ms, mode) {
    if (!ms || ms <= 0) return;
    const exp = Math.max(1, Math.round((ms / 3600000) * 100));
    const label = (mode === 'timer' ? 'Timer' : 'Stopwatch') + ' session (' + Math.round(ms / 60000) + ' min)';
    awardLive(todayStr(), label, exp, { kind: 'study' });
  }

  // ---------- §8.3 Daily settlement (cutoff-only events) ----------

  function settleDay(dateStr) {
    const gam = getGamState();
    if (gam.lastSettledDate === dateStr) return; // never double-settle the same date

    const events = [];

    // Task left pending (-50 per task) / Revision cycle incomplete at R6 (-400, replaces the -50).
    PlannerData.getTasksForDate(dateStr).filter(function (t) { return !t.completed; }).forEach(function (t) {
      if (t.taskType === 'revision' && t.revisionNumber === 6) {
        events.push({ label: 'Revision cycle incomplete: ' + (t.topicName || ''), exp: -400 });
      } else {
        events.push({ label: 'Task left pending: ' + (t.topicName || t.title || PlannerData.taskLabel(t)), exp: -50 });
      }
    });

    // Breaks exceeding study time (-200).
    const stats = TimeEngine.getDayStats(dateStr);
    if (stats.studyMs > 0 && stats.breakMs > stats.studyMs) {
      events.push({ label: 'Breaks exceeded study time', exp: -200 });
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

    // Doubling — see the flagged open question at the top of this file. Now covers today's
    // LIVE-awarded EXP (tasks + study time, already applied to totalExp as they happened) as well
    // as this cutoff's own events, so >5h studied still doubles the whole day, not just the part
    // that happened to be computed at cutoff.
    const liveTotalToday = getLedger()
      .filter(function (e) { return e.date === dateStr && e.live; })
      .reduce(function (sum, e) { return sum + e.exp; }, 0);
    const cutoffRawTotal = events.reduce(function (sum, e) { return sum + e.exp; }, 0);
    const rawTotal = liveTotalToday + cutoffRawTotal;

    const studiedHours = stats.studyMs / 3600000;
    const doubled = studiedHours > DOUBLE_HOURS_THRESHOLD;
    // cutoffRawTotal hasn't been applied to totalExp yet (unlike liveTotalToday, applied already
    // when each event happened) — so the delta to ADD here is just cutoffRawTotal at 1x, plus a
    // full extra rawTotal if doubled (which doubles both the live part and the cutoff part).
    const finalDelta = cutoffRawTotal + (doubled ? rawTotal : 0);

    const ledger = getLedger().slice();
    events.forEach(function (e) {
      ledger.push({ id: generateId('exp'), date: dateStr, label: e.label, exp: e.exp, doubled: doubled, at: Date.now() });
    });
    if (doubled && rawTotal !== 0) {
      ledger.push({ id: generateId('exp'), date: dateStr, label: 'Doubled EXP day (>5h studied)', exp: rawTotal, doubled: true, at: Date.now() });
    }

    const newTotal = Math.max(0, gam.totalExp + finalDelta);
    State.set({
      expLedger: ledger,
      gamification: { totalExp: newTotal, lastSettledDate: dateStr, streakBonusAwardedForRun: nextStreakFlag }
    });
  }

  // Called from a poll (§ same pattern as Water/Alarm). Settles today once past the 11 PM cutoff,
  // plus a one-day catch-up if the app was closed across a cutoff entirely.
  function maybeSettle() {
    const gam = getGamState();
    const today = todayStr();
    const yesterday = shiftDateStr(today, -1);

    if (gam.lastSettledDate && gam.lastSettledDate !== yesterday && gam.lastSettledDate !== today) {
      settleDay(yesterday);
    }
    if (TimeEngine.isPastCutoff() && getGamState().lastSettledDate !== today) {
      settleDay(today);
    }
  }

  return {
    getGamState: getGamState,
    getLedger: getLedger,
    getLevelInfo: getLevelInfo,
    settleDay: settleDay,
    maybeSettle: maybeSettle,
    awardTaskCompleted: awardTaskCompleted,
    retractTaskCompleted: retractTaskCompleted,
    awardStudyTime: awardStudyTime
  };
})();
