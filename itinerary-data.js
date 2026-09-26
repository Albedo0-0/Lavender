// itinerary-data.js — Itinerary Engine data/state layer (Itinerary Phase 4). No UI here.
// Depends on: State, TimeEngine, ItineraryTemplateData. Must load AFTER timeengine.js and
// itinerary-template-data.js.
//
// This module owns State.get().dailyItinerary (today's live itinerary) and
// State.get().dailyItinerarySummaries (dateStr -> finalized snapshot, Section 45's retention
// decision). It never duplicates a Planner task's/Target's/Journal entry's own data — items[]
// hold references and scheduling snapshots only (Section 12); actual results are always read
// live from the owning system at render time.
//
// State.get().dailyItinerary = {
//   date, status: 'unpresented'|'awaiting_choice'|'itinerary_selected'|'diy_selected'
//               |'in_progress'|'completed'|'partially_completed'|'abandoned',
//   templateId, items: [ { itemId, type, refId, label, plannedStart, plannedEnd, state, actualStart, actualEnd } ],
//   checklist: [], diyChosen, startedAt, completedAt
// }
const ItineraryData = (function () {
  const SUBSCRIBER_ID = 'itinerary';

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

  function defaultDay(dateStr) {
    return {
      date: dateStr,
      status: 'unpresented',
      templateId: null,
      items: [],
      checklist: [],
      diyChosen: false,
      startedAt: null,
      completedAt: null,
      shiftMs: 0
    };
  }

  // §13 daily reset — precisely WaterData.getReminderState()'s pattern: read the stored object,
  // and if it's missing or stale (not today), return a fresh shell WITHOUT persisting it. Callers
  // that mean to commit a transition go through setToday()/the transition functions below, which
  // persist against this same fresh baseline.
  function getToday() {
    const stored = State.get().dailyItinerary;
    const today = todayStr();
    if (!stored || stored.date !== today) return defaultDay(today);
    return stored;
  }

  function setToday(partial) {
    const next = Object.assign({}, getToday(), partial, { date: todayStr() });
    State.set({ dailyItinerary: next });
    return next;
  }

  function getSummaries() { return State.get().dailyItinerarySummaries || {}; }
  function getSummaryForDate(dateStr) { return getSummaries()[dateStr] || null; }

  function itemsAllResolved(items) {
    return (items || []).every(function (it) { return it.state === 'completed' || it.state === 'skipped'; });
  }

  // §13 — maps a non-terminal day to its terminal status at end-of-day. Only the transitions the
  // state machine (Section 13) actually documents: an in_progress day resolves to
  // completed/partially_completed depending on whether every item was resolved; anything that
  // never got past selecting/choosing is logged as abandoned rather than silently discarded
  // (Section 33). diy_selected and the four already-terminal statuses pass through unchanged.
  function finalizeDay(day) {
    if (day.status === 'in_progress') {
      return Object.assign({}, day, {
        status: itemsAllResolved(day.items) ? 'completed' : 'partially_completed',
        completedAt: day.completedAt || Date.now()
      });
    }
    if (day.status === 'unpresented' || day.status === 'awaiting_choice' || day.status === 'itinerary_selected') {
      // awaiting_choice is the only one of these three that ever locked (via presentGate) and
      // never unlocked — chooseTemplate/chooseDIY already unlock on the other two paths out of
      // awaiting_choice (B7).
      if (day.status === 'awaiting_choice' && typeof Notify !== 'undefined') Notify.unlockItinerary();
      return Object.assign({}, day, { status: 'abandoned' });
    }
    return day;
  }

  // §19 — rolls up today's checklist items by tagIds into DateHub's itineraryTagRollup so
  // Progress's tag stats survive past the 14-day sessionRecords window (Section 27).
  function writeChecklistTagRollup(day) {
    const items = (day.items || []).filter(function (it) { return it.type === 'checklist'; });
    if (!items.length) return;
    const byTag = {};
    items.forEach(function (it) {
      (it.tagIds || []).forEach(function (tagId) {
        if (!byTag[tagId]) byTag[tagId] = { completedCount: 0, totalCount: 0 };
        byTag[tagId].totalCount++;
        if (it.state === 'completed') byTag[tagId].completedCount++;
      });
    });
    if (!Object.keys(byTag).length) return;
    const existing = (typeof DateHub !== 'undefined') ? DateHub.get(day.date) : null;
    const rollup = Object.assign({}, existing && existing.itineraryTagRollup);
    Object.keys(byTag).forEach(function (tagId) { rollup[tagId] = byTag[tagId]; });
    if (typeof DateHub !== 'undefined') DateHub.update(day.date, { itineraryTagRollup: rollup });
  }

  function writeItinerarySummary(day) {
    const items = day.items || [];
    const counts = {
      total: items.length,
      completed: items.filter(function (it) { return it.state === 'completed'; }).length,
      skipped: items.filter(function (it) { return it.state === 'skipped'; }).length,
      rescheduled: items.filter(function (it) { return it.state === 'rescheduled'; }).length
    };
    const summary = {
      status: day.status,
      diyChosen: !!day.diyChosen,
      templateId: day.templateId || null,
      counts: counts
    };
    if (typeof DateHub !== 'undefined') DateHub.update(day.date, { itinerarySummary: summary });
  }
  
  // ---------- state machine transitions (§13) ----------

  // Flips 'unpresented' -> 'awaiting_choice' and persists immediately, so a reload mid-decision
  // re-shows the gate because it's still 'awaiting_choice', not because a fresh 'unpresented' day
  // was re-detected (Section 14). No-op (returns the current day unchanged) if already past
  // 'unpresented' — presenting the gate is idempotent, never a redundant transition.
  function presentGate() {
    const day = getToday();
    if (day.status !== 'unpresented') return day;
    // Lock once when transitioning into awaiting_choice — the status flip below makes this
    // branch unreachable on subsequent ticks, so the lock is acquired exactly once per gate.
    if (typeof Notify !== 'undefined') Notify.lockItinerary();
    return setToday({ status: 'awaiting_choice' });
  }

  // Snapshots the chosen template's item definitions into today's items[] (Section 12's
  // reference-and-snapshot rule: refId is a pointer, never a copy of the referenced record's own
  // data). Each item starts 'pending' with no actual times yet.
  function chooseTemplate(templateId) {
    const day = getToday();
    if (day.status !== 'awaiting_choice') return day;
    if (typeof Notify !== 'undefined') Notify.unlockItinerary();
    const template = (typeof ItineraryTemplateData !== 'undefined') ? ItineraryTemplateData.getById(templateId) : null;
    if (!template) return day;
    const items = (template.items || []).map(function (def) {
      // Keep every authored field (subject/topicName/taskType for study items, destination for
      // nav items, checkAt/tagIds for checklist items, durationMin, etc.) — only the execution
      // fields reset for the new day. A hardcoded subset here previously dropped fields the
      // orchestrator needs (ensureStudyTask's item.subject/topicName/taskType, openForType's
      // item.destination), silently breaking study/nav items snapshotted from a template.
      return Object.assign({}, def, {
        state: 'pending',
        actualStart: null,
        actualEnd: null,
        tagIds: def.tagIds || [],
        syncedFromPlanner: false
      });
    });
    return setToday({ status: 'itinerary_selected', templateId: templateId, items: items, diyChosen: false });
  }

  // Terminal choice for the day (Section 15) — no itinerary to start.
  function chooseDIY() {
    const day = getToday();
    if (day.status !== 'awaiting_choice') return day;
    if (typeof Notify !== 'undefined') Notify.unlockItinerary();
    const nextDay = setToday({ status: 'diy_selected', templateId: null, items: [], checklist: [], diyChosen: true });
    writeItinerarySummary(nextDay);
    return nextDay;
  }

  function startItinerary() {
    const day = getToday();
    if (day.status !== 'itinerary_selected') return day;
    return setToday({ status: 'in_progress', startedAt: Date.now() });
  }

  // Updates a single item's execution state (used by the Phase 7 orchestrator and, for study
  // items, by whatever reads TimeEngine's resulting session state). Only valid while in_progress.
  // Automatically resolves the day to 'completed' once every item is completed/skipped.
  function updateItemState(itemId, fields) {
    const day = getToday();
    if (day.status !== 'in_progress') return day;
    let changed = false;
    const nowTimeStr = (function () { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); })();
    const items = day.items.map(function (it) {
      if (it.itemId !== itemId) return it;
      changed = true;
      const merged = Object.assign({}, it, fields);
      // Auto-stamp actual times when not explicitly supplied; plannedStart/plannedEnd are
      // immutable (original schedule) so the early-delta calculation remains valid after
      // completion (Section 12/18 — preserve original planned times separately).
      if (fields.state === 'active' && !merged.actualStart) merged.actualStart = nowTimeStr;
      if ((fields.state === 'completed' || fields.state === 'skipped') && !merged.actualEnd) merged.actualEnd = nowTimeStr;
      return merged;
    });
    if (!changed) return day;
    const patch = { items: items };
    if (itemsAllResolved(items)) {
      patch.status = 'completed';
      patch.completedAt = Date.now();
    }
    const nextDay = setToday(patch);
    if (patch.status === 'completed') {
      writeChecklistTagRollup(nextDay);
      writeItinerarySummary(nextDay);
    }
    return nextDay;
  }

  // ---------- Planner sync (new) ----------
  // Keeps today's itinerary synchronized with Planner: any task PlannerData already has
  // scheduled for today that isn't yet referenced by an itinerary item is pulled in as a new
  // 'planner-task' item, flagged syncedFromPlanner so it can be told apart from an item the user
  // deliberately built with a Planner-task reference (Section 21's "these are NOT necessarily
  // the same operation" rule extended to this new sync direction). Only ever ADDS references —
  // never copies a task's own data (Section 12's rule) and never mutates PlannerData. No-op
  // (and no write) when there's nothing new to add, so this is safe to call on every tick.
  function syncPlannerTasks() {
    const day = getToday();
    if (day.status !== 'itinerary_selected' && day.status !== 'in_progress') return day;
    if (typeof PlannerData === 'undefined' || typeof PlannerData.getTasksForDate !== 'function') return day;
    const todaysTasks = PlannerData.getTasksForDate(todayStr());
    if (!todaysTasks.length) return day;
    const tasksById = {};
    todaysTasks.forEach(function (t) { tasksById[t.taskId] = t; });
    function labelForTask(t) {
      return t.subject
        ? (t.subject + ' \u00b7 ' + t.topicName + ' \u00b7 ' + (typeof PlannerData.taskLabel === 'function' ? PlannerData.taskLabel(t) : ''))
        : (typeof PlannerData.taskLabel === 'function' ? PlannerData.taskLabel(t) : (t.title || 'Task'));
    }
    // B8: refresh an already-referenced synced item whose source task's own schedule/label has
    // since changed in Planner — only while still 'pending', since once it's active/completed/
    // skipped its actual times are canonical (Section 12) and must never be overwritten by a
    // later Planner-side edit.
    let refreshed = false;
    const refreshedItems = (day.items || []).map(function (it) {
      if (!it.syncedFromPlanner || it.type !== 'planner-task' || it.state !== 'pending' || !it.refId) return it;
      const t = tasksById[it.refId];
      if (!t) return it;
      const newLabel = labelForTask(t);
      if (it.plannedStart === (t.startTime || null) && it.plannedEnd === (t.stopTime || null) && it.label === newLabel) return it;
      refreshed = true;
      return Object.assign({}, it, { plannedStart: t.startTime || null, plannedEnd: t.stopTime || null, label: newLabel });
    });
    const referencedTaskIds = {};
    refreshedItems.forEach(function (it) {
      if (it.refId && (it.type === 'planner-task' || it.type === 'study')) referencedTaskIds[it.refId] = true;
    });
    const missing = todaysTasks.filter(function (t) { return !t.completed && !referencedTaskIds[t.taskId]; });
    if (!missing.length && !refreshed) return day;
    const newItems = missing.map(function (t) {
      return {
        itemId: 'sync-' + t.taskId,
        type: 'planner-task',
        refId: t.taskId,
        label: labelForTask(t),
        plannedStart: t.startTime || null,
        plannedEnd: t.stopTime || null,
        state: 'pending',
        actualStart: null,
        actualEnd: null,
        tagIds: [],
        syncedFromPlanner: true
      };
    });
    const merged = refreshedItems.concat(newItems).sort(function (a, b) {
      const as = a.plannedStart || '99:99', bs = b.plannedStart || '99:99';
      return as < bs ? -1 : (as > bs ? 1 : 0);
    });
    return setToday({ items: merged });
  }

  // Removing a SYNCED item (one Planner sync itself added, not one the user chose to reference
  // in the builder) is a two-way operation, unlike the ordinary "reference only" removal Section
  // 21 describes: it drops the itinerary row AND unschedules the underlying Planner task from
  // today (clears date/startTime/stopTime via PlannerData's own patch function) so the task
  // doesn't keep re-appearing via syncPlannerTasks on the next tick. The task itself, its topic,
  // and any session history are left completely intact — only today's schedule slot is cleared,
  // preserving existing Planner data per the "never a shadow copy / never touch Planner's own
  // record beyond its own functions" rule (Section 21/30). A non-synced item's removal is left to
  // whatever narrower per-item action already exists elsewhere (the builder's own Remove button);
  // this function only ever acts on items flagged syncedFromPlanner.
  function removeSyncedItem(itemId) {
    const day = getToday();
    if (day.status !== 'itinerary_selected' && day.status !== 'in_progress') return day;
    const item = (day.items || []).find(function (it) { return it.itemId === itemId; });
    if (!item) return day;
    const items = day.items.filter(function (it) { return it.itemId !== itemId; });
    const patch = { items: items };
    if (day.status === 'in_progress' && itemsAllResolved(items)) {
      patch.status = 'completed';
      patch.completedAt = Date.now();
    }
    const nextDay = setToday(patch);
    if (item.syncedFromPlanner && item.refId && typeof PlannerData !== 'undefined' && typeof PlannerData.updateTask === 'function') {
      PlannerData.updateTask(item.refId, { date: null, startTime: null, stopTime: null });
    }
    if (patch.status === 'completed') {
      writeChecklistTagRollup(nextDay);
      writeItinerarySummary(nextDay);
    }
    return nextDay;
  }

  // ---------- adaptive timing (§18, Phase 8) ----------
  // Itinerary's own lag tracker for non-study items — deliberately SEPARATE from TimeEngine's
  // own engine.shiftMs (different item types; must not cross-contaminate each other's math).

  function getShiftMs() { return getToday().shiftMs || 0; }

  // Composes from each item's ORIGINAL planned time (not stacking deltas), the same way
  // TimeEngine.applyShift keeps relative gaps intact (Section 3.1/18). No-op when the day's
  // chosen template is fixed-mode (adaptive:false) — later items then simply show as "delayed"
  // without their displayed time moving (Section 18's Test Day example).
  function applyItineraryShift(deltaMs) {
    const day = getToday();
    if (day.status !== 'in_progress') return day;
    const template = (typeof ItineraryTemplateData !== 'undefined' && day.templateId) ? ItineraryTemplateData.getById(day.templateId) : null;
    if (template && template.adaptive === false) return day;
    return setToday({ shiftMs: (day.shiftMs || 0) + deltaMs });
  }

  function shiftTimeStr(hhmm, shiftMs) {
    if (!hhmm) return hhmm;
    const ms = new Date(todayStr() + 'T' + hhmm + ':00').getTime() + (shiftMs || 0);
    const d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Current adjusted HH:MM for an item's planned start/end, folding in today's cumulative
  // shiftMs — read-only display helpers, same role Study's own UI already gives
  // sessionRecords[...].adjustedStart/adjustedEnd (Section 18).
  // Completed/skipped items keep their original planned times for display — their actualStart/
  // actualEnd is the canonical execution record. Only pending/active items have the accumulated
  // shiftMs applied, so auto-adjusting after an early finish never retroactively moves a
  // completed item's displayed schedule slot (Section 18).
  function adjustedStart(item) {
    if (item.state === 'completed' || item.state === 'skipped') return item.plannedStart;
    return shiftTimeStr(item.plannedStart, getShiftMs());
  }
  function adjustedEnd(item) {
    if (item.state === 'completed' || item.state === 'skipped') return item.plannedEnd;
    return shiftTimeStr(item.plannedEnd, getShiftMs());
  }

  // ---------- rollover (§13) ----------

  // Mirrors GamificationData.onRolloverCatchUp's multi-day-gap walk: TimeEngine.onRollover fires
  // once even if several midnights were missed, carrying the true (fromDateStr, toDateStr) pair.
  // Walk every date in between, finalizing whatever was actually stored for the outgoing date and
  // synthesizing an 'abandoned' record (via defaultDay -> finalizeDay) for any date that was never
  // even opened — so closing the app across several midnights logs every missed day, not just the
  // most recent one. Then clear the live slot so the next getToday() starts a genuinely fresh day
  // without waiting for its own staleness check (Section 13's explicit requirement).
  function onRolloverFinalize(fromDateStr, toDateStr) {
    if (!fromDateStr || !toDateStr || fromDateStr === toDateStr) return;
    const stored = State.get().dailyItinerary;
    const summaries = Object.assign({}, getSummaries());
    let cursor = fromDateStr;
    let guard = 0; // sanity cap so a corrupt/garbage date pair can never loop forever
    while (cursor < toDateStr && guard < 3660) {
      if (!summaries[cursor]) {
        const day = (stored && stored.date === cursor) ? stored : defaultDay(cursor);
        const finalized = finalizeDay(day);
        summaries[cursor] = finalized;
        writeChecklistTagRollup(finalized);
        writeItinerarySummary(finalized);
      }
      cursor = shiftDateStr(cursor, 1);
      guard++;
    }
    State.set({ dailyItinerarySummaries: summaries, dailyItinerary: null });
  }

  // Wire into TimeEngine's Feature 12 rollover signal once, under a stable id (Section 4's
  // canonical pattern) so re-running init-style setup code never stacks a duplicate subscription.
  if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.onRollover === 'function') {
    TimeEngine.onRollover(onRolloverFinalize, SUBSCRIBER_ID);
  }

  return {
    getToday: getToday,
    getSummaryForDate: getSummaryForDate,
    presentGate: presentGate,
    chooseTemplate: chooseTemplate,
    chooseDIY: chooseDIY,
    startItinerary: startItinerary,
    updateItemState: updateItemState,
    syncPlannerTasks: syncPlannerTasks,
    removeSyncedItem: removeSyncedItem,
    getShiftMs: getShiftMs,
    applyItineraryShift: applyItineraryShift,
    adjustedStart: adjustedStart,
    adjustedEnd: adjustedEnd,
    onRolloverFinalize: onRolloverFinalize
  };
})();
