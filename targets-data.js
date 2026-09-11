// targets-data.js — Targets data layer (Targets + Subtargets). No UI here.
// State shape: State.get().targets = { targetId: {targetId, timeframe, dateKey, title, type,
//                                                  targetValue, currentValue, completed,
//                                                  subtargets: [subtargetId, ...]} }
//              State.get().subtargets = { subtargetId: {subtargetId, parentTargetId, title,
//                                                        dayAssigned, type, targetValue,
//                                                        currentValue, completed} }
// timeframe: 'daily' | 'weekly' | 'monthly'
// type: 'custom' (free-text note, checkbox completion) | 'hours' (numeric, logs to study hours) | 'questions' (numeric, logs count)
//
// Subtarget completion rollup rule (documented per LAVENDER_MASTER §5, Feature 5):
// a parent's currentValue/completion % is the average of its subtargets' completion percentages
// (each subtarget's own percentage = currentValue/targetValue, clamped 0–1) when it has subtargets.
// A parent with no subtargets tracks currentValue/targetValue directly.

const TargetsData = (function () {
  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function clamp01(n) {
    if (typeof n !== 'number' || isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  // ---------- Targets: CRUD ----------

  function getAllTargets() {
    return State.get().targets || {};
  }

  function getTarget(targetId) {
    return getAllTargets()[targetId] || null;
  }

  function createTarget(input) {
    const targets = Object.assign({}, getAllTargets());
    const targetId = generateId('target');
    const target = {
      targetId: targetId,
      timeframe: input.timeframe || 'daily',
      dateKey: input.dateKey || todayStr(),
      title: (input.title || '').trim(),
      type: input.type || 'custom',
      targetValue: typeof input.targetValue === 'number' && input.targetValue > 0 ? input.targetValue : 1,
      currentValue: 0,
      completed: false,
      subtargets: [],
      topicId: input.topicId || null,
      note: input.note || '',
      completedNote: ''
    };
    targets[targetId] = target;
    State.set({ targets: targets });
    return target;
  }

  function updateTarget(targetId, patch) {
    const targets = Object.assign({}, getAllTargets());
    const existing = targets[targetId];
    if (!existing) return null;
    const updated = Object.assign({}, existing, patch);
    targets[targetId] = updated;
    State.set({ targets: targets });
    return updated;
  }

  function deleteTarget(targetId) {
    const targets = Object.assign({}, getAllTargets());
    if (!targets[targetId]) return;
    const subtargets = Object.assign({}, getAllSubtargets());
    (targets[targetId].subtargets || []).forEach(function (sid) { delete subtargets[sid]; });
    delete targets[targetId];
    State.set({ targets: targets, subtargets: subtargets });
  }

  // ---------- Subtargets: CRUD ----------

  function getAllSubtargets() {
    return State.get().subtargets || {};
  }

  function getSubtargetsForTarget(targetId) {
    const target = getTarget(targetId);
    if (!target) return [];
    const subtargets = getAllSubtargets();
    return (target.subtargets || []).map(function (id) { return subtargets[id]; }).filter(Boolean);
  }

  function createSubtarget(parentTargetId, input) {
    const target = getTarget(parentTargetId);
    if (!target) return null;

    const subtargets = Object.assign({}, getAllSubtargets());
    const subtargetId = generateId('subtarget');
    const subtarget = {
      subtargetId: subtargetId,
      parentTargetId: parentTargetId,
      title: (input.title || '').trim(),
      dayAssigned: input.dayAssigned || todayStr(),
      type: input.type || target.type,
      targetValue: typeof input.targetValue === 'number' && input.targetValue > 0 ? input.targetValue : 1,
      currentValue: 0,
      completed: false
    };
    subtargets[subtargetId] = subtarget;

    const targets = Object.assign({}, getAllTargets());
    targets[parentTargetId] = Object.assign({}, target, {
      subtargets: (target.subtargets || []).concat([subtargetId])
    });

    State.set({ subtargets: subtargets, targets: targets });
    recomputeParentCompletion(parentTargetId);
    return subtarget;
  }

  function updateSubtarget(subtargetId, patch) {
    const subtargets = Object.assign({}, getAllSubtargets());
    const existing = subtargets[subtargetId];
    if (!existing) return null;
    const updated = Object.assign({}, existing, patch);
    subtargets[subtargetId] = updated;
    State.set({ subtargets: subtargets });
    recomputeParentCompletion(existing.parentTargetId);
    return updated;
  }

  function deleteSubtarget(subtargetId) {
    const subtargets = Object.assign({}, getAllSubtargets());
    const existing = subtargets[subtargetId];
    if (!existing) return;
    delete subtargets[subtargetId];

    const targets = Object.assign({}, getAllTargets());
    const parent = targets[existing.parentTargetId];
    if (parent) {
      targets[existing.parentTargetId] = Object.assign({}, parent, {
        subtargets: (parent.subtargets || []).filter(function (id) { return id !== subtargetId; })
      });
    }

    State.set({ subtargets: subtargets, targets: targets });
    recomputeParentCompletion(existing.parentTargetId);
  }

  // ---------- Completion ----------

  // Rolls a parent target's currentValue/completed up from its subtargets' completion percentages
  // (average of each subtarget's currentValue/targetValue, clamped). No-op if the target has no subtargets.
  function recomputeParentCompletion(targetId) {
    const target = getTarget(targetId);
    if (!target || !target.subtargets || target.subtargets.length === 0) return;

    const subs = getSubtargetsForTarget(targetId);
    if (subs.length === 0) return;

    const avgPct = subs.reduce(function (sum, s) {
      return sum + clamp01(s.targetValue > 0 ? s.currentValue / s.targetValue : 0);
    }, 0) / subs.length;

    const allComplete = subs.every(function (s) { return s.completed; });

    updateTarget(targetId, {
      currentValue: Math.round(avgPct * target.targetValue),
      completed: allComplete
    });
  }

  function toggleTargetComplete(targetId, recordedValue) {
    const target = getTarget(targetId);
    if (!target) return null;
    const nowCompleted = !target.completed;

    // For targets with subtargets, toggling the parent toggles all subtargets
    if (target.subtargets && target.subtargets.length > 0) {
      target.subtargets.forEach(function (sid) {
        const sub = getAllSubtargets()[sid];
        if (!sub) return;
        updateSubtarget(sid, {
          completed: nowCompleted,
          currentValue: nowCompleted ? sub.targetValue : 0
        });
      });
      recomputeParentCompletion(targetId);
      return getTarget(targetId);
    }

    const value = (target.type === 'hours' || target.type === 'questions')
      ? (typeof recordedValue === 'number' ? recordedValue : target.targetValue)
      : (nowCompleted ? target.targetValue : 0);

    const updated = updateTarget(targetId, {
      completed: nowCompleted,
      currentValue: nowCompleted ? value : 0
    });

    if (typeof GamificationData !== 'undefined' && GamificationData.awardTargetCompleted) {
      if (nowCompleted) GamificationData.awardTargetCompleted(updated);
      else if (GamificationData.retractTargetCompleted) GamificationData.retractTargetCompleted(target);
    }
    return updated;
  }
  function toggleSubtargetComplete(subtargetId) {
    const subtargets = getAllSubtargets();
    const sub = subtargets[subtargetId];
    if (!sub) return null;
    const nowCompleted = !sub.completed;
    return updateSubtarget(subtargetId, {
      completed: nowCompleted,
      currentValue: nowCompleted ? value : 0
    });
    if (typeof GamificationData !== 'undefined') {
      const updated = targets[targetId];
      if (nowCompleted) GamificationData.awardTargetCompleted(updated);
      else GamificationData.retractTargetCompleted(updated);
    });
  }

  function setProgressValue(targetId, value) {
    const target = getTarget(targetId);
    if (!target) return null;
    const clamped = Math.max(0, Math.min(target.targetValue, value));
    return updateTarget(targetId, {
      currentValue: clamped,
      completed: clamped >= target.targetValue
    });
  }

  // ---------- Queries ----------

  function getAllTargetsList() {
    const targets = getAllTargets();
    return Object.keys(targets).map(function (id) { return targets[id]; });
  }

  function getTargetsByTimeframe(timeframe) {
    return getAllTargetsList().filter(function (t) { return t.timeframe === timeframe; });
  }

  // Used by calendar.js's renderTargetsSection(dateStr) — daily targets whose dateKey matches,
  // plus weekly/monthly targets whose dateKey falls within the relevant period for dateStr.
  function getTargetsForDate(dateStr) {
    return getAllTargetsList().filter(function (t) {
      if (t.timeframe === 'daily') return t.dateKey === dateStr;
      if (t.timeframe === 'weekly') return isSameWeek(t.dateKey, dateStr);
      if (t.timeframe === 'monthly') return isSameMonth(t.dateKey, dateStr);
      return false;
    });
  }

  function isSameMonth(a, b) {
    return a && b && a.slice(0, 7) === b.slice(0, 7);
  }

  function isSameWeek(a, b) {
    if (!a || !b) return false;
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    const startOfWeek = function (d) {
      const copy = new Date(d);
      copy.setDate(copy.getDate() - copy.getDay());
      copy.setHours(0, 0, 0, 0);
      return copy.getTime();
    };
    return startOfWeek(da) === startOfWeek(db);
  }

  function getTargetsForTopic(topicId) {
    return getAllTargetsList().filter(function (t) { return t.topicId === topicId; });
  }

  return {
    createTarget: createTarget,
    updateTarget: updateTarget,
    deleteTarget: deleteTarget,
    getTarget: getTarget,
    getAllTargetsList: getAllTargetsList,
    getTargetsByTimeframe: getTargetsByTimeframe,
    getTargetsForDate: getTargetsForDate,
    getTargetsForTopic: getTargetsForTopic,

    createSubtarget: createSubtarget,
    updateSubtarget: updateSubtarget,
    deleteSubtarget: deleteSubtarget,
    getSubtargetsForTarget: getSubtargetsForTarget,

    toggleTargetComplete: toggleTargetComplete,
    toggleSubtargetComplete: toggleSubtargetComplete,
    setProgressValue: setProgressValue
  };
})();
