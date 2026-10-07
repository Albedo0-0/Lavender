// planning-agent-data.js — Centralized Planning Agent: Perception, Modeling, Decision Logic & Shared Utilities.
// Pure functions only. No direct State mutations here.
// Depends on: State, PlannerData, TargetsData, TimeEngine, ItineraryTime.
// Load order: after planner-data.js, targets-data.js, timeengine.js, itinerary-time.js; before planning-agent.js and views.

const PlanningAgentData = (function () {
  // Default study availability window (08:00 - 22:00)
  const DEFAULT_DAY_START = '08:00';
  const DEFAULT_DAY_END = '22:00';
  const DEFAULT_SLOT_DURATION_MIN = 45;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

  function todayStr() {
    if (typeof ItineraryTime !== 'undefined' && typeof ItineraryTime.todayStr === 'function') {
      return ItineraryTime.todayStr();
    }
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function shiftDateStr(dateStr, delta) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function timeStrToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function minutesToTimeStr(mins) {
    if (mins === null || mins === undefined || isNaN(mins)) return '';
    let m = Math.floor(mins);
    if (m < 0) m = 0;
    if (m >= 1440) m = 1439;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return pad(h) + ':' + pad(rem);
  }

  // Check if [startA, endA) overlaps [startB, endB) in minutes
  function overlaps(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
  }

  // True if [startTime, stopTime) overlaps any other scheduled task on the same date.
  function hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId) {
    if (typeof PlannerData !== 'undefined' && typeof PlannerData.hasSlotConflict === 'function') {
      return PlannerData.hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId);
    }
    const sMin = timeStrToMinutes(startTime);
    const eMin = timeStrToMinutes(stopTime);
    if (sMin === null || eMin === null || sMin >= eMin) return false;

    const allTasks = (State.get().tasks || {});
    return Object.keys(allTasks).some(function (id) {
      if (id === excludeTaskId) return false;
      const t = allTasks[id];
      if (t.date !== dateStr || t.completed || t.archived) return false;
      if (!t.startTime || !t.stopTime) return false;
      const tS = timeStrToMinutes(t.startTime);
      const tE = timeStrToMinutes(t.stopTime);
      if (tS === null || tE === null || tS >= tE) return false;
      return overlaps(sMin, eMin, tS, tE);
    });
  }

  // Get placed occupied time intervals (in minutes) for a date from scheduled tasks & alarms
  function getOccupiedIntervalsForDate(dateStr, excludeTaskId) {
    const intervals = [];
    const allTasks = (State.get().tasks || {});

    Object.keys(allTasks).forEach(function (id) {
      if (id === excludeTaskId) return;
      const t = allTasks[id];
      if (t.date !== dateStr || t.completed || t.archived) return;
      if (!t.startTime || !t.stopTime) return;
      const sMin = timeStrToMinutes(t.startTime);
      const eMin = timeStrToMinutes(t.stopTime);
      if (sMin !== null && eMin !== null && sMin < eMin) {
        intervals.push({ start: sMin, end: eMin, label: t.topicName || t.title || 'Task', refId: t.taskId });
      }
    });

    // Also factor in active global breaks or sessions for today if available
    if (dateStr === todayStr() && typeof TimeEngine !== 'undefined') {
      const gb = TimeEngine.getGlobalBreak ? TimeEngine.getGlobalBreak() : null;
      if (gb && gb.active && gb.startedAt && gb.durationMs) {
        const startMin = timeStrToMinutes(minutesToTimeStr(Math.floor((new Date(gb.startedAt)).getHours() * 60 + (new Date(gb.startedAt)).getMinutes())));
        const durMin = Math.ceil(gb.durationMs / 60000);
        if (startMin !== null) {
          intervals.push({ start: startMin, end: startMin + durMin, label: 'Global Break', refId: 'break' });
        }
      }
    }

    intervals.sort(function (a, b) { return a.start - b.start; });
    return intervals;
  }

  // Find the earliest free slot of durationMin on dateStr at or after earliestTimeStr
  function findNextFreeSlot(dateStr, durationMin, earliestTimeStr, excludeTaskId, windowEndStr) {
    const dur = Math.max(15, parseInt(durationMin, 10) || DEFAULT_SLOT_DURATION_MIN);
    const earliestMin = Math.max(
      timeStrToMinutes(DEFAULT_DAY_START),
      earliestTimeStr ? (timeStrToMinutes(earliestTimeStr) || 0) : timeStrToMinutes(DEFAULT_DAY_START)
    );
    const limitMin = windowEndStr ? (timeStrToMinutes(windowEndStr) || timeStrToMinutes(DEFAULT_DAY_END)) : timeStrToMinutes(DEFAULT_DAY_END);

    const placed = getOccupiedIntervalsForDate(dateStr, excludeTaskId);
    let candidate = earliestMin;
    let guard = 0;

    while (guard < 150) {
      guard++;
      if (candidate + dur > limitMin) return null;
      let blocker = null;
      for (let i = 0; i < placed.length; i++) {
        if (overlaps(candidate, candidate + dur, placed[i].start, placed[i].end)) {
          blocker = placed[i];
          break;
        }
      }
      if (!blocker) {
        return {
          start: minutesToTimeStr(candidate),
          end: minutesToTimeStr(candidate + dur),
          startMin: candidate,
          endMin: candidate + dur,
          durationMin: dur
        };
      }
      candidate = blocker.end;
    }
    return null;
  }

  // Find all free slots available on dateStr
  function findFreeSlotsForDate(dateStr, slotDurationMin, windowStartStr, windowEndStr, excludeTaskId) {
    const dur = Math.max(15, parseInt(slotDurationMin, 10) || DEFAULT_SLOT_DURATION_MIN);
    const startMin = windowStartStr ? (timeStrToMinutes(windowStartStr) || timeStrToMinutes(DEFAULT_DAY_START)) : timeStrToMinutes(DEFAULT_DAY_START);
    const endMin = windowEndStr ? (timeStrToMinutes(windowEndStr) || timeStrToMinutes(DEFAULT_DAY_END)) : timeStrToMinutes(DEFAULT_DAY_END);
    const slots = [];
    let cur = startMin;

    while (cur + dur <= endMin) {
      const slot = findNextFreeSlot(dateStr, dur, minutesToTimeStr(cur), excludeTaskId, minutesToTimeStr(endMin));
      if (!slot) break;
      slots.push(slot);
      cur = slot.endMin + 15; // 15 min buffer between suggested sessions
    }
    return slots;
  }

  // ---------- Snapshot / Perception Layer ----------
  // Reads the complete current system state without modifying or duplicating anything.
  function getSnapshot(dateRange) {
    const today = todayStr();
    const tasks = (typeof PlannerData !== 'undefined' && typeof PlannerData.getAllTasks === 'function')
      ? PlannerData.getAllTasks()
      : (State.get().tasks || {});
    const tasksList = Object.keys(tasks).map(function (k) { return tasks[k]; });

    const activeTasksToday = tasksList.filter(function (t) {
      return t.date === today && !t.completed && !t.archived;
    });

    const pendingTasks = tasksList.filter(function (t) {
      return t.date && t.date < today && !t.completed && !t.archived;
    });

    const dueRevisionsToday = tasksList.filter(function (t) {
      return t.date === today && t.taskType === 'revision' && !t.completed && !t.archived;
    });

    const rawTargets = (typeof TargetsData !== 'undefined' && typeof TargetsData.getAllTargets === 'function')
      ? TargetsData.getAllTargets()
      : (typeof TargetsData !== 'undefined' && typeof TargetsData.getAllTargetsList === 'function'
          ? TargetsData.getAllTargetsList()
          : (State.get().targets || {}));
    const targetsList = Array.isArray(rawTargets) ? rawTargets : Object.keys(rawTargets).map(function (k) { return rawTargets[k]; });
    const activeTargets = targetsList.filter(function (t) {
      return !t.completed && !t.archived;
    });

    const todaySessions = (typeof TimeEngine !== 'undefined' && typeof TimeEngine.getRecordsForDate === 'function')
      ? TimeEngine.getRecordsForDate(today)
      : [];

    const itineraryToday = (typeof ItineraryData !== 'undefined' && typeof ItineraryData.getToday === 'function')
      ? ItineraryData.getToday()
      : (State.get().dailyItinerary || null);

    return {
      today: today,
      activeTasksToday: activeTasksToday,
      pendingTasks: pendingTasks,
      dueRevisionsToday: dueRevisionsToday,
      activeTargets: activeTargets,
      todaySessions: todaySessions,
      itineraryToday: itineraryToday,
      totalTasksCount: tasksList.length
    };
  }

  // ---------- Revision Policy ----------
  const REVISION_OFFSETS = [1, 3, 5, 8, 15, 30];
  const REVISION_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

  function getRevisionOffsets() {
    return REVISION_OFFSETS.slice();
  }

  function getRevisionLabels() {
    return REVISION_LABELS.slice();
  }

  function computeRevisionDates(baseDateStr) {
    let cursor = baseDateStr;
    const dates = [];
    REVISION_OFFSETS.forEach(function (offset) {
      cursor = shiftDateStr(cursor, offset);
      dates.push(cursor);
    });
    return dates;
  }

  // ---------- Historical Memory & Adaptive Analytics ----------

  // Read historical planning outcomes from sessionRecords and planningHistory
  function getHistoricalData() {
    const s = State.get();
    const sessionRecords = s.sessionRecords || {};
    const planningHistory = s.planningHistory || {};
    const dailySummaries = s.dailySummaries || {};

    return {
      sessionRecords: sessionRecords,
      planningHistory: planningHistory,
      dailySummaries: dailySummaries
    };
  }

  // Adaptive Duration Multiplier (Phase 8):
  // Formula: median of (actual / planned) blended toward 1.0 by n / (n + 5).
  // Requires at least 5 completed sessions; clamped to 0.7 - 1.5.
  function getDurationMultiplier(taskType) {
    const hist = getHistoricalData();
    const records = Object.keys(hist.sessionRecords).map(function (k) { return hist.sessionRecords[k]; });
    const tasks = State.get().tasks || {};

    const ratios = [];
    records.forEach(function (rec) {
      if (!rec || rec.state !== 'completed' || !rec.studyMs || !rec.plannedStart || !rec.plannedEnd) return;
      const task = rec.taskId ? tasks[rec.taskId] : null;
      if (taskType && task && task.taskType !== taskType) return;

      const pS = timeStrToMinutes(rec.plannedStart);
      const pE = timeStrToMinutes(rec.plannedEnd);
      if (pS === null || pE === null || pE <= pS) return;
      const plannedMin = pE - pS;
      const actualMin = Math.round(rec.studyMs / 60000);
      if (plannedMin >= 10 && actualMin >= 5) {
        ratios.push(actualMin / plannedMin);
      }
    });

    const sampleSize = ratios.length;
    if (sampleSize < 5) {
      return { multiplier: 1.0, sampleSize: sampleSize, learned: false, reason: 'insufficient samples (< 5)' };
    }

    ratios.sort(function (a, b) { return a - b; });
    const mid = Math.floor(sampleSize / 2);
    const median = sampleSize % 2 !== 0 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;

    // Blend median toward 1.0 based on sample confidence: n / (n + 5)
    const blendWeight = sampleSize / (sampleSize + 5);
    const blended = 1.0 * (1 - blendWeight) + median * blendWeight;
    const clamped = Math.max(0.7, Math.min(1.5, Math.round(blended * 100) / 100));

    return {
      multiplier: clamped,
      sampleSize: sampleSize,
      learned: true,
      reason: 'Adjusted ' + clamped + 'x based on ' + sampleSize + ' completed ' + (taskType || 'study') + ' sessions'
    };
  }

  // Rolling daily study capacity in minutes (Phase 8)
  function getDailyCapacityMinutes() {
    const s = State.get();
    const recs = s.sessionRecords || {};
    const sums = s.dailySummaries || {};
    const dayTotals = {};

    Object.keys(recs).forEach(function (k) {
      const r = recs[k];
      if (r && r.date && r.studyMs && r.state === 'completed') {
        dayTotals[r.date] = (dayTotals[r.date] || 0) + Math.round(r.studyMs / 60000);
      }
    });

    Object.keys(sums).forEach(function (d) {
      const sm = sums[d];
      if (sm && sm.studyMs && !dayTotals[d]) {
        dayTotals[d] = Math.round(sm.studyMs / 60000);
      }
    });

    const activeDays = Object.keys(dayTotals).map(function (d) { return dayTotals[d]; }).filter(function (m) { return m >= 15; });
    if (activeDays.length < 5) {
      return { capacityMin: 180, learned: false, reason: 'Standard baseline (3h)' };
    }

    activeDays.sort(function (a, b) { return a - b; });
    const mid = Math.floor(activeDays.length / 2);
    const median = activeDays.length % 2 !== 0 ? activeDays[mid] : Math.round((activeDays[mid - 1] + activeDays[mid]) / 2);

    return {
      capacityMin: Math.max(60, Math.min(480, median)),
      learned: true,
      sampleDays: activeDays.length,
      reason: 'Rolling median capacity ' + median + 'm over ' + activeDays.length + ' active days'
    };
  }

  // Preferred time of day window (Phase 8): morning (08-12), afternoon (12-17), evening (17-22)
  function getPreferredTimeWindows() {
    const recs = (State.get().sessionRecords || {});
    const buckets = {
      morning: { name: 'Morning (08:00–12:00)', start: '08:00', end: '12:00', completed: 0, total: 0 },
      afternoon: { name: 'Afternoon (12:00–17:00)', start: '12:00', end: '17:00', completed: 0, total: 0 },
      evening: { name: 'Evening (17:00–22:00)', start: '17:00', end: '22:00', completed: 0, total: 0 }
    };

    Object.keys(recs).forEach(function (k) {
      const r = recs[k];
      if (!r || !r.plannedStart) return;
      const m = timeStrToMinutes(r.plannedStart);
      if (m === null) return;
      let bKey = 'evening';
      if (m >= 480 && m < 720) bKey = 'morning';
      else if (m >= 720 && m < 1020) bKey = 'afternoon';
      buckets[bKey].total++;
      if (r.state === 'completed') buckets[bKey].completed++;
    });

    const totalSamples = buckets.morning.total + buckets.afternoon.total + buckets.evening.total;
    if (totalSamples < 8) {
      return { preferred: 'morning', learned: false, buckets: buckets };
    }

    let bestKey = 'morning';
    let bestRate = -1;
    ['morning', 'afternoon', 'evening'].forEach(function (k) {
      const rate = buckets[k].total > 0 ? (buckets[k].completed / buckets[k].total) : 0;
      if (rate > bestRate) {
        bestRate = rate;
        bestKey = k;
      }
    });

    return {
      preferred: bestKey,
      learned: true,
      buckets: buckets,
      bestWindow: buckets[bestKey]
    };
  }

  // Check postponement risk (task rescheduled 2 or more times)
  function isPostponementRisk(task) {
    return !!(task && (task.rescheduleCount || 0) >= 2);
  }

  // ---------- Proposal Generation Engine (Phase 4, 5, 8) ----------

  // Proposes schedules for revisions due on dateStr and carried-over pending tasks
  function proposeScheduleForDate(dateStr, options) {
    const opts = options || {};
    const proposals = [];
    const targetDate = dateStr || todayStr();
    const isToday = (targetDate === todayStr());
    const nowMin = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : timeStrToMinutes(DEFAULT_DAY_START);
    const earliestTimeStr = isToday ? minutesToTimeStr(Math.max(nowMin, timeStrToMinutes(DEFAULT_DAY_START))) : DEFAULT_DAY_START;

    const allTasks = State.get().tasks || {};
    const tasksList = Object.keys(allTasks).map(function (k) { return allTasks[k]; });

    // 1. Revision tasks due on targetDate that have no slot
    const dueRevisions = tasksList.filter(function (t) {
      return t.date === targetDate && t.taskType === 'revision' && !t.completed && !t.archived && (!t.startTime || !t.stopTime);
    });

    // 2. Pending incomplete tasks from earlier dates
    const pendingTasks = tasksList.filter(function (t) {
      return t.date && t.date < targetDate && !t.completed && !t.archived;
    });

    // 3. Unslotted tasks already scheduled on targetDate
    const unslottedToday = tasksList.filter(function (t) {
      return t.date === targetDate && t.taskType !== 'revision' && !t.completed && !t.archived && (!t.startTime || !t.stopTime);
    });

    // Determine task duration with adaptive multiplier
    function estimateDuration(task) {
      const base = task.taskType === 'questions' ? 60 : (task.taskType === 'revision' ? 45 : 50);
      const multObj = getDurationMultiplier(task.taskType);
      return Math.round(base * multObj.multiplier);
    }

    let cursorTimeStr = earliestTimeStr;

    // Process due revisions first (Priority: due work before carry-over)
    dueRevisions.forEach(function (t) {
      const dur = estimateDuration(t);
      const slot = findNextFreeSlot(targetDate, dur, cursorTimeStr);
      if (slot) {
        proposals.push({
          proposalId: 'prop_rev_' + t.taskId,
          kind: 'slot-revision',
          taskId: t.taskId,
          subject: t.subject,
          topicName: t.topicName,
          title: 'Revision ' + (t.revisionNumber || 'R') + ' \u00b7 ' + (t.topicName || ''),
          date: targetDate,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: dur,
          reason: 'Revision ' + (t.revisionNumber || '') + ' due today',
          confidence: 0.95
        });
        cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
      }
    });

    // Next: unslotted tasks already on targetDate
    unslottedToday.forEach(function (t) {
      const dur = estimateDuration(t);
      const slot = findNextFreeSlot(targetDate, dur, cursorTimeStr);
      if (slot) {
        proposals.push({
          proposalId: 'prop_unslot_' + t.taskId,
          kind: 'slot-task',
          taskId: t.taskId,
          subject: t.subject,
          topicName: t.topicName,
          title: t.topicName || t.title || 'Study Session',
          date: targetDate,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: dur,
          reason: 'Scheduled for ' + targetDate + ' (unslotted)',
          confidence: 0.9
        });
        cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
      }
    });

    // Next: carry forward pending tasks (most overdue first, or highest postponement risk given earlier slot)
    pendingTasks.sort(function (a, b) {
      const aRisk = isPostponementRisk(a) ? 1 : 0;
      const bRisk = isPostponementRisk(b) ? 1 : 0;
      if (aRisk !== bRisk) return bRisk - aRisk; // High postponement risk gets planned first
      return (a.date || '').localeCompare(b.date || '');
    });

    // Cap pending carry-over to avoid overloading a single day
    const cap = opts.maxPending || 4;
    pendingTasks.slice(0, cap).forEach(function (t) {
      let dur = estimateDuration(t);
      if (isPostponementRisk(t)) {
        dur = Math.min(dur, 35); // Bite-sized session for repeatedly postponed tasks
      }
      const slot = findNextFreeSlot(targetDate, dur, cursorTimeStr);
      if (slot) {
        proposals.push({
          proposalId: 'prop_pend_' + t.taskId,
          kind: 'carry-pending',
          taskId: t.taskId,
          subject: t.subject,
          topicName: t.topicName,
          title: (t.topicName || t.title || 'Task') + ' (Overdue)',
          date: targetDate,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: dur,
          reason: isPostponementRisk(t)
            ? 'Carried over (' + t.rescheduleCount + 'x rescheduled \u2014 bite-sized focus)'
            : 'Carried over from ' + t.date,
          confidence: 0.85
        });
        cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
      }
    });

    return proposals;
  }

  // Pure catch-up calculation for today's itinerary items (Phase 3)
  function computeCatchUpPlan(day, nowMinOverride) {
    if (!day || !day.items || !day.items.length) {
      return { needed: false, reason: 'no-items', changes: [] };
    }
    const nowMin = (nowMinOverride !== undefined && nowMinOverride !== null)
      ? nowMinOverride
      : (new Date().getHours() * 60 + new Date().getMinutes());

    const placed = [];
    const movable = [];

    (day.items || []).forEach(function (it) {
      const sMin = timeStrToMinutes(it.plannedStart);
      const eMin = timeStrToMinutes(it.plannedEnd);
      if (sMin === null) return;
      const dur = (eMin !== null && eMin > sMin) ? (eMin - sMin) : DEFAULT_SLOT_DURATION_MIN;

      // Completed, skipped, or currently active items cannot move
      if (it.state === 'completed' || it.state === 'skipped' || it.state === 'active') {
        placed.push({ start: sMin, end: sMin + dur });
        return;
      }

      // Items still pending are candidates for catch-up
      if (it.state === 'pending') {
        movable.push({ item: it, origStart: sMin, origEnd: eMin, dur: dur });
      }
    });

    if (!movable.length) return { needed: false, reason: 'nothing-to-plan', changes: [] };
    movable.sort(function (a, b) { return a.origStart - b.origStart; });

    function itemFits(start, dur) {
      const end = start + dur;
      for (let i = 0; i < placed.length; i++) {
        if (overlaps(start, end, placed[i].start, placed[i].end)) return false;
      }
      return true;
    }

    function itemNextFree(earliest, dur) {
      let cand = earliest;
      let guard = 0;
      while (guard < 180) {
        guard++;
        if (cand + dur > 1440) return null;
        let blocker = null;
        for (let i = 0; i < placed.length; i++) {
          if (overlaps(cand, cand + dur, placed[i].start, placed[i].end)) {
            blocker = placed[i];
            break;
          }
        }
        if (!blocker) return cand;
        cand = blocker.end;
      }
      return null;
    }

    const changes = [];
    movable.forEach(function (m) {
      const overdue = m.origStart < nowMin;
      let start = m.origStart;
      let slot = null;

      if (overdue) {
        slot = itemNextFree(nowMin, m.dur);
        if (slot === null) return;
        start = slot;
      } else if (!itemFits(start, m.dur)) {
        slot = itemNextFree(Math.max(start, nowMin), m.dur);
        if (slot === null) return;
        start = slot;
      }

      placed.push({ start: start, end: start + m.dur });
      if (start !== m.origStart) {
        changes.push({
          itemId: m.item.itemId,
          refId: m.item.refId || null,
          label: m.item.label,
          originalStart: m.item.plannedStart,
          originalEnd: m.item.plannedEnd,
          newStart: minutesToTimeStr(start),
          newEnd: m.item.plannedEnd != null ? minutesToTimeStr(start + m.dur) : null
        });
      }
    });

    if (!changes.length) return { needed: false, reason: 'no-changes-needed', changes: [] };
    return { needed: true, changes: changes };
  }

  // Proposes task allocations for an active Target (Phase 5)
  function proposeTargetAllocation(targetId, targetDate) {
    if (typeof TargetsData === 'undefined') return [];
    const target = TargetsData.getTarget(targetId);
    if (!target || target.completed || target.archived) return [];

    const dateStr = targetDate || target.dateKey || todayStr();
    const proposals = [];
    const subtargets = TargetsData.getSubtargetsForTarget(targetId);

    // If target has subtargets that are incomplete
    if (subtargets && subtargets.length > 0) {
      const incompleteSubs = subtargets.filter(function (s) { return !s.completed; });
      let cursorTimeStr = DEFAULT_DAY_START;

      incompleteSubs.slice(0, 2).forEach(function (sub) {
        const dur = 45;
        const slot = findNextFreeSlot(dateStr, dur, cursorTimeStr);
        if (slot) {
          proposals.push({
            proposalId: 'prop_tgt_sub_' + sub.subtargetId,
            kind: 'target-subtarget',
            targetId: targetId,
            subtargetId: sub.subtargetId,
            title: target.title + ' \u2014 ' + sub.title,
            date: dateStr,
            proposedStart: slot.start,
            proposedEnd: slot.end,
            durationMin: dur,
            reason: 'Goal: ' + target.title,
            confidence: 0.9
          });
          cursorTimeStr = minutesToTimeStr(slot.endMin + 15);
        }
      });
    } else {
      // Single target without subtargets: propose study session
      const slot = findNextFreeSlot(dateStr, 60, DEFAULT_DAY_START);
      if (slot) {
        proposals.push({
          proposalId: 'prop_tgt_' + target.targetId,
          kind: 'target-task',
          targetId: targetId,
          title: target.title,
          date: dateStr,
          proposedStart: slot.start,
          proposedEnd: slot.end,
          durationMin: 60,
          reason: 'Goal: ' + target.title,
          confidence: 0.85
        });
      }
    }
    return proposals;
  }

  return {
    timeStrToMinutes: timeStrToMinutes,
    minutesToTimeStr: minutesToTimeStr,
    overlaps: overlaps,
    hasSlotConflict: hasSlotConflict,
    getOccupiedIntervalsForDate: getOccupiedIntervalsForDate,
    findNextFreeSlot: findNextFreeSlot,
    findFreeSlotsForDate: findFreeSlotsForDate,
    getSnapshot: getSnapshot,
    getRevisionOffsets: getRevisionOffsets,
    getRevisionLabels: getRevisionLabels,
    computeRevisionDates: computeRevisionDates,
    getDurationMultiplier: getDurationMultiplier,
    getDailyCapacityMinutes: getDailyCapacityMinutes,
    getPreferredTimeWindows: getPreferredTimeWindows,
    isPostponementRisk: isPostponementRisk,
    proposeScheduleForDate: proposeScheduleForDate,
    computeCatchUpPlan: computeCatchUpPlan,
    proposeTargetAllocation: proposeTargetAllocation,
    todayStr: todayStr,
    shiftDateStr: shiftDateStr
  };
})();

if (typeof window !== 'undefined') {
  window.PlanningAgentData = PlanningAgentData;
}
