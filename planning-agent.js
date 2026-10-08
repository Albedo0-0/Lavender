// planning-agent.js — Centralized Planning Agent: Single Action Engine & Authority.
// The ONLY planning brain in Lavender.
// Authority principle:
// «ONE PLANNING AGENT -> ONE CANONICAL TASK SYSTEM -> EVERYTHING ELSE IS A VIEW, GOAL, DATA SOURCE, OR EXECUTION SYSTEM»
// Depends on: State, PlanData, TargetsData, TimeEngine, PlanningAgentData.
// Load order: after planning-agent-data.js; before planner.js, itinerary.js, calendar.js, assistant.js.

const PlanningAgent = (function () {
  function todayStr() {
    return (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.todayStr === 'function')
      ? PlanningAgentData.todayStr()
      : (typeof PlanData !== 'undefined' ? PlanData.todayStr() : '');
  }

  // ---------- Provenance & Validation Primitives ----------

  function validateSlot(startTime, stopTime) {
    if (typeof PlanData !== 'undefined' && typeof PlanData.isValidSlot === 'function') {
      return PlanData.isValidSlot(startTime, stopTime);
    }
    if (!startTime && !stopTime) return true;
    if (!startTime || !stopTime) return false;
    return stopTime > startTime;
  }

  function validateConflict(dateStr, startTime, stopTime, excludeTaskId) {
    if (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.hasSlotConflict === 'function') {
      return PlanningAgentData.hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId);
    }
    if (typeof PlanData !== 'undefined' && typeof PlanData.hasSlotConflict === 'function') {
      return PlanData.hasSlotConflict(dateStr, startTime, stopTime, excludeTaskId);
    }
    return false;
  }

  // ---------- Canonical Task Operations ----------

  // Create a single or custom task with stamped provenance
  function createTask(input, origin) {
    const isAgent = (origin === 'agent');
    const orig = isAgent ? 'agent' : 'user';
    const dateStr = input.date || todayStr();
    const startTime = input.startTime || null;
    const stopTime = input.stopTime || null;

    if (!validateSlot(startTime, stopTime)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(dateStr, startTime, stopTime, null)) {
      return { ok: false, error: 'That time slot overlaps an existing task on this date.' };
    }

    let task = null;
    if (input.taskType === 'custom' || !input.subject) {
      const title = (input.title || input.topicName || 'Task').trim();
      task = PlanData.createCustomTask(title, dateStr, input.note || '', startTime, stopTime);
    } else {
      const subject = input.subject;
      const topicName = input.topicName || '';
      const taskType = input.taskType || 'theory';
      task = PlanData.createSingleTask(subject, topicName, taskType, dateStr, input.note || '', startTime, stopTime);
    }

    if (!task) return { ok: false, error: 'Could not create task.' };

    // Stamp provenance on the canonical task
    const provenance = {
      origin: orig,
      rescheduleCount: 0,
      planReason: input.planReason || (isAgent ? 'agent-created' : ''),
      targetId: input.targetId || null,
      subtargetId: input.subtargetId || null,
      agentSlot: isAgent ? { date: dateStr, startTime: startTime, stopTime: stopTime } : null
    };

    PlanData.updateTask(task.taskId, provenance);
    return { ok: true, task: PlanData.getTask(task.taskId) };
  }

  // Create repeated revision cycle with stamped provenance
  function createRevisionCycle(subject, topicName, baseDateStr, note, startTime, stopTime, origin) {
    const orig = (origin === 'agent') ? 'agent' : 'user';
    if (!validateSlot(startTime, stopTime)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(baseDateStr, startTime, stopTime, null)) {
      return { ok: false, error: 'That time slot overlaps an existing task on this date.' };
    }

    const baseTask = PlanData.createRevisionCycle(subject, topicName, baseDateStr, note, startTime, stopTime);
    if (!baseTask) return { ok: false, error: 'Could not create revision cycle.' };

    PlanData.updateTask(baseTask.taskId, {
      origin: orig,
      rescheduleCount: 0,
      planReason: 'base-revision-study',
      agentSlot: (orig === 'agent') ? { date: baseDateStr, startTime: startTime, stopTime: stopTime } : null
    });

    return { ok: true, baseTask: PlanData.getTask(baseTask.taskId) };
  }

  // Update existing task fields while maintaining canonical ownership
  function updateTask(taskId, patch, origin) {
    const existing = PlanData.getTask(taskId);
    if (!existing) return { ok: false, error: 'Task not found.' };

    const newDate = ('date' in patch) ? patch.date : existing.date;
    const newStart = ('startTime' in patch) ? patch.startTime : existing.startTime;
    const newStop = ('stopTime' in patch) ? patch.stopTime : existing.stopTime;

    if (!validateSlot(newStart, newStop)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(newDate, newStart, newStop, taskId)) {
      return { ok: false, error: 'That slot overlaps an existing task on ' + newDate + '.' };
    }

    const safePatch = Object.assign({}, patch);

    // If slot changed by user, mark origin as user
    const slotChanged = (newDate !== existing.date || newStart !== existing.startTime || newStop !== existing.stopTime);
    if (slotChanged) {
      if (origin === 'agent') {
        safePatch.origin = 'agent';
        safePatch.agentSlot = { date: newDate, startTime: newStart, stopTime: newStop };
      } else {
        safePatch.origin = 'user';
      }
    }

    const updated = PlanData.updateTask(taskId, safePatch);
    return { ok: true, task: updated };
  }

  // Reschedule a task (single authoritative path for moves)
  function rescheduleTask(taskId, newDateStr, newStartTime, newStopTime, origin, reason) {
    const existing = PlanData.getTask(taskId);
    if (!existing) return { ok: false, error: 'Task not found.' };

    const startTime = newStartTime || null;
    const stopTime = newStopTime || null;

    if (!validateSlot(startTime, stopTime)) {
      return { ok: false, error: 'End time must be after start time on the same day.' };
    }
    if (validateConflict(newDateStr, startTime, stopTime, taskId)) {
      return { ok: false, error: 'That slot overlaps another task on ' + newDateStr + '.' };
    }

    const today = todayStr();
    // If rescheduling a task on today's active schedule, route through TimeEngine.doItLater
    // so active/scheduled session records are cleanly kept in sync
    const hadSessionToday = (existing.date === today && typeof TimeEngine !== 'undefined');
    if (hadSessionToday) {
      const ok = TimeEngine.doItLater(taskId, newDateStr, startTime, stopTime);
      if (!ok) {
        return { ok: false, error: 'Could not reschedule task via Time Engine.' };
      }
    } else {
      PlanData.rescheduleTask(taskId, newDateStr, startTime, stopTime);
    }

    // Provenance stamp
    const isAgent = (origin === 'agent');
    const newRescheduleCount = (existing.rescheduleCount || 0) + 1;
    const provPatch = {
      rescheduleCount: newRescheduleCount,
      origin: isAgent ? 'agent' : 'user',
      planReason: reason || (isAgent ? 'agent-reschedule' : 'user-reschedule')
    };
    if (isAgent) {
      provPatch.agentSlot = { date: newDateStr, startTime: startTime, stopTime: stopTime };
    }
    PlanData.updateTask(taskId, provPatch);

    return { ok: true, task: PlanData.getTask(taskId) };
  }

  // Unschedule a task: clears start/stop time while KEEPING date (solves P2 / Q5).
  // The task remains active and visible on that date in unslotted/suggested pool.
  function unscheduleTask(taskId) {
    const existing = PlanData.getTask(taskId);
    if (!existing) return { ok: false, error: 'Task not found.' };

    // End active session in TimeEngine if currently active
    if (typeof TimeEngine !== 'undefined' && existing.date === todayStr()) {
      const active = TimeEngine.getActiveSession ? TimeEngine.getActiveSession() : null;
      if (active && active.taskId === taskId) {
        TimeEngine.skipActive(taskId);
      }
    }

    const updated = PlanData.updateTask(taskId, {
      startTime: null,
      stopTime: null,
      rescheduleCount: (existing.rescheduleCount || 0) + 1,
      planReason: 'unscheduled'
    });

    return { ok: true, task: updated };
  }

  // Delete task
  function deleteTask(taskId) {
    PlanData.deleteTask(taskId);
    return { ok: true };
  }

  // Completion hook: updates EXP, Target progress, and records session outcome
  function toggleComplete(taskId) {
    const taskBefore = PlanData.getTask(taskId);
    if (!taskBefore) return;

    PlanData.toggleComplete(taskId);
    const taskAfter = PlanData.getTask(taskId);

    // If task was linked to a Target, update target progress cleanly (Phase 5)
    if (taskAfter && taskAfter.completed && taskAfter.targetId && typeof TargetsData !== 'undefined') {
      const target = TargetsData.getTarget(taskAfter.targetId);
      if (target && !target.completed) {
        if (taskAfter.subtargetId) {
          TargetsData.updateSubtarget(taskAfter.subtargetId, { completed: true });
        } else {
          const nextVal = (target.currentValue || 0) + 1;
          TargetsData.updateTarget(taskAfter.targetId, {
            currentValue: nextVal,
            completed: nextVal >= (target.targetValue || 1)
          });
        }
      }
    }

    // Record planning outcome for adaptive history (Phase 7)
    if (taskAfter && taskAfter.completed) {
      recordTaskOutcome(taskAfter);
    }
  }

  // Record outcome into State.planningHistory for long-term learning (Phase 7)
  function recordTaskOutcome(task) {
    const dStr = task.completedDate || todayStr();
    const st = State.get();
    const history = Object.assign({}, st.planningHistory || {});
    const dayEntry = Object.assign({
      date: dStr,
      completedCount: 0,
      rescheduledCount: 0,
      taskTypeStats: {}
    }, history[dStr] || {});

    dayEntry.completedCount++;
    const tType = task.taskType || 'theory';
    if (!dayEntry.taskTypeStats[tType]) {
      dayEntry.taskTypeStats[tType] = { count: 0 };
    }
    dayEntry.taskTypeStats[tType].count++;

    history[dStr] = dayEntry;
    State.set({ planningHistory: history });
  }

  // ---------- Decision Actions (Proposals, Catch-up, Target Allocation) ----------

  // Apply a proposal from PlanningAgentData
  function applyProposal(proposal) {
    if (!proposal || !proposal.taskId) return { ok: false, error: 'Invalid proposal' };
    return rescheduleTask(
      proposal.taskId,
      proposal.date || todayStr(),
      proposal.proposedStart,
      proposal.proposedEnd,
      'agent',
      proposal.reason || 'proposal-applied'
    );
  }

  // Execute full Catch-Up plan across Itinerary and Tasks (Phase 3)
  function requestCatchUp(nowMin) {
    if (typeof ItineraryData === 'undefined' || typeof PlanningAgentData === 'undefined') {
      return { needed: false, reason: 'modules-unavailable' };
    }

    const day = ItineraryData.getToday();
    const plan = PlanningAgentData.computeCatchUpPlan(day, nowMin);
    if (!plan.needed || !plan.changes.length) return plan;

    // Apply to itinerary items and sync to canonical tasks
    (plan.changes || []).forEach(function (c) {
      if (c.refId) {
        // Canonical task update
        rescheduleTask(c.refId, day.date, c.newStart, c.newEnd, 'agent', 'catch-up');
      }
      if (typeof ItineraryData.updateItemState === 'function') {
        const itemFields = { plannedStart: c.newStart };
        if (c.newEnd != null) itemFields.plannedEnd = c.newEnd;
        ItineraryData.updateItemState(c.itemId, itemFields);
      }
    });

    return { needed: true, changes: plan.changes };
  }

  // Propose day plan
  function proposeDayPlan(dateStr) {
    if (typeof PlanningAgentData === 'undefined') return [];
    return PlanningAgentData.proposeScheduleForDate(dateStr || todayStr());
  }

  // Register single rollover subscriber with stable id
  if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.onRollover === 'function') {
    TimeEngine.onRollover(function (fromDateStr) {
      if (!fromDateStr || typeof PlanData === 'undefined') return;
      const tasks = PlanData.getTasksForDate(fromDateStr);
      const history = Object.assign({}, State.get().planningHistory || {});
      if (!history[fromDateStr]) {
        const completed = tasks.filter(function (t) { return t.completed; }).length;
        const total = tasks.length;
        history[fromDateStr] = {
          date: fromDateStr,
          completedCount: completed,
          missedCount: Math.max(0, total - completed),
          rescheduledCount: tasks.reduce(function (sum, t) { return sum + (t.rescheduleCount || 0); }, 0),
          taskTypeStats: {}
        };
        State.set({ planningHistory: history });
      }
    }, 'planning-agent');
  }

  return {
    createTask: createTask,
    createRevisionCycle: createRevisionCycle,
    updateTask: updateTask,
    rescheduleTask: rescheduleTask,
    unscheduleTask: unscheduleTask,
    deleteTask: deleteTask,
    toggleComplete: toggleComplete,
    applyProposal: applyProposal,
    requestCatchUp: requestCatchUp,
    proposeDayPlan: proposeDayPlan,
    openUI: function (opts) {
      if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open(opts);
    }
  };
})();

if (typeof window !== 'undefined') {
  window.PlanningAgent = PlanningAgent;
}
