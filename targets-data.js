// targets-data.js — Targets data layer (Targets + Subtargets). No UI here.
// State shape: State.get().targets = { targetId: {targetId, timeframe, dateKey, title, type,
//                                                  targetValue, currentValue, completed,
//                                                  subtargets: [subtargetId, ...]} }
//              State.get().subtargets = { subtargetId: {subtargetId, parentTargetId, title,
//                                                        dayAssigned, type, targetValue,
//                                                        currentValue, completed} }
// timeframe: 'daily' | 'weekly' | 'monthly'
// type: 'studyHours' | 'questions' | 'checkoff'
// Custom Day Goals = a Target with timeframe:'daily', type:'checkoff' — no separate model.
//
// Subtarget completion rollup rule:
// Parent's completion % = average of subtargets' (currentValue/targetValue), clamped 0–1.
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
      type: input.type || 'checkoff',
      targetValue: typeof input.targetValue === 'number' && input.targetValue > 0 ? input.targetValue : 1,
      currentValue: 0,
      completed: false,
      subtargets: []
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

  function toggleTargetComplete(targetId) {
    const target = getTarget(targetId);
    if (!target) return null;
    if (target.subtargets && target.subtargets.length > 0) return target;
    const nowCompleted = !target.completed;
    const updated = updateTarget(targetId, {
      completed: nowCompleted,
      currentValue: nowCompleted ? target.targetValue : 0
    });
    if (typeof GamificationData !== 'undefined' && GamificationData.awardTargetCompleted) {
      if (nowCompleted) GamificationData.awardTargetCompleted(updated);
      else if (GamificationData.retractTargetCompleted) GamificationData.retractTargetCompleted(target);
    }
    return updated;
  }

  function toggleSubtargetComplete(subtargetId) {
    const sub = getAllSubtargets()[subtargetId];
    if (!sub) return null;
    const nowCompleted = !sub.completed;
    return updateSubtarget(subtargetId, {
      completed: nowCompleted,
      currentValue: nowCompleted ? sub.targetValue : 0
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

  function getAllTargetsList() {
    const targets = getAllTargets();
    return Object.keys(targets).map(function (id) { return targets[id]; });
  }

  function getTargetsByTimeframe(timeframe) {
    return getAllTargetsList().filter(function (t) { return t.timeframe === timeframe; });
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

  function getTargetsForDate(dateStr) {
    return getAllTargetsList().filter(function (t) {
      if (t.timeframe === 'daily') return t.dateKey === dateStr;
      if (t.timeframe === 'weekly') return isSameWeek(t.dateKey, dateStr);
      if (t.timeframe === 'monthly') return isSameMonth(t.dateKey, dateStr);
      return false;
    });
  }

  function getTargetsForTopic(topicId) {
    return [];
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
