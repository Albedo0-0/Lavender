// itinerary-orchestrator.js — Sequential Execution (Itinerary Phase 7) + Adaptive Timing (Phase 8).
// Depends on: State, TimeEngine, ItineraryData, ItineraryTemplateData, PlannerData, TargetsData,
// JournalData, WaterData, Nav, Water, Targets, Itinerary (for invokeDestination), Modal. Must load
// after all of those.
//
// Section 17's central rule: study items are executed by the EXISTING TimeEngine/Study/Planner —
// this module's only job for a 'study' item is to make sure the underlying Planner task exists
// (lazily, exactly once, when the item becomes current) and then mirror TimeEngine's own session
// state back into the itinerary item. For every other item type (break/journal/water/target/
// checklist/custom/nav) this module IS the sequential executor, driven by the same single
// TimeEngine heartbeat (subscribe id 'itinerary' — no second timer, Section 4/38).
//
// "Current item" = the first item in dailyItinerary.items whose state is not yet resolved
// (completed/skipped/rescheduled) — items only ever advance one at a time, in order (Section 17
// point 4). An item is only acted on once its (adjusted) planned start time has arrived AND every
// item before it has resolved (Section 17 point 1).
const ItineraryOrchestrator = (function () {
  const SUBSCRIBER_ID = 'itinerary';

  // In-memory only (Section 24's "don't fake completion" rule needs a real before/after compare
  // for Journal/Water, not a new persisted "completion" flag on journalEntries/waterEvents
  // themselves, per Sections 24/25). Reset on reload — acceptable: a reload mid-item just means
  // the item re-snapshots from whatever the entry/event list looks like at that moment.
  const journalSnapshots = {};
  const waterSnapshots = {};

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function timeStrToMs(dateStr, hhmm) { return new Date(dateStr + 'T' + hhmm + ':00').getTime(); }
  function nowMs() { return Date.now(); }

  function isResolved(it) { return it.state === 'completed' || it.state === 'skipped' || it.state === 'rescheduled'; }

  function currentItem(day) {
    const items = day.items || [];
    for (let i = 0; i < items.length; i++) {
      if (!isResolved(items[i])) return items[i];
    }
    return null;
  }

  // Folds the real finish time's delta from the CURRENTLY adjusted planned end into the
  // itinerary's own shiftMs (Section 18) — composed via ItineraryData.applyItineraryShift, not
  // stacked, and a no-op in fixed mode. Called on every resolution (completed or skipped) so
  // "running late/early automatically reshuffles the rest of the day" applies uniformly, not just
  // to study items.
  function foldLag(item, actualEndMs) {
    if (!item.plannedEnd) return;
    const expected = timeStrToMs(todayStr(), item.plannedEnd) + ItineraryData.getShiftMs();
    ItineraryData.applyItineraryShift(actualEndMs - expected);
  }

  function resolveItem(item, fields) {
    delete journalSnapshots[item.itemId];
    delete waterSnapshots[item.itemId];
    ItineraryData.updateItemState(item.itemId, fields);
  }

  // ---------- manual confirmation (called from ItineraryToday's "Mark Done"/"Skip" buttons) ----------

  // For 'checklist'/'custom'/'nav' items there is no other system to report a real completion —
  // Section 19's shared checklist store doesn't exist until Phase 11, and 'nav' is pure
  // navigation with no completion signal of its own — so the itinerary's own confirm button IS
  // the authoritative "real toggle" for these three types (Section 17 point 3).
  function markItemDone(itemId) {
    const day = ItineraryData.getToday();
    const item = (day.items || []).find(function (it) { return it.itemId === itemId; });
    if (!item || item.state !== 'active') return;
    const now = nowMs();
    foldLag(item, now);
    resolveItem(item, { state: 'completed', actualEnd: now });
  }

  // Safety valve for every item type (a stuck/misbehaving underlying system, or the user simply
  // choosing not to do this item today) — advances the sequence without claiming a real
  // completion happened. Explicitly ends a still-running Global Break rather than leaving
  // TimeEngine's own break timer orphaned after the itinerary item has moved on.
  function skipItem(itemId) {
    const day = ItineraryData.getToday();
    const item = (day.items || []).find(function (it) { return it.itemId === itemId; });
    if (!item || (item.state !== 'active' && item.state !== 'pending')) return;
    if (item.type === 'break') {
      const gb = TimeEngine.getGlobalBreak();
      if (gb && gb.active) TimeEngine.endGlobalBreak();
    }
    const now = nowMs();
    foldLag(item, now);
    resolveItem(item, { state: 'skipped', actualEnd: now });
  }

  // ---------- activation (fires exactly once, at the pending -> active transition) ----------

  // Lazily creates the underlying Planner task for a from-scratch 'study' item, exactly once
  // (guarded by refId still being null), using the CURRENTLY adjusted start/end — by the time an
  // item becomes current every upstream item has already resolved, so the itinerary's own shiftMs
  // is stable and this is the correct real-world slot to schedule it into (Section 21). A
  // 'planner-task' item already references an existing task (Section 21) and needs no creation —
  // TimeEngine's own syncSessionsForToday() already picks up any task with a date/startTime/
  // stopTime on every tick, itinerary or not.
  function ensureStudyTask(item) {
    if (item.type !== 'study' || item.refId) return;
    const start = ItineraryData.adjustedStart(item) || item.plannedStart;
    const end = ItineraryData.adjustedEnd(item) || item.plannedEnd;
    const task = PlannerData.createSingleTask(item.subject, item.topicName, item.taskType || 'theory', todayStr(), '', start, end);
    if (!task) return;
    // Additive, non-breaking tag (Section 22) — lets a future view find "which itinerary item
    // does this session belong to" without PlannerData/TimeEngine needing to know Itinerary
    // exists at all.
    PlannerData.updateTask(task.taskId, { sourceItineraryItemId: item.itemId });
    ItineraryData.updateItemState(item.itemId, { refId: task.taskId });
  }

  // Opens the relevant existing screen/modal for a non-study item (Section 17 point 3). Closes
  // the shared Modal first when the target is a full screen switch (journal, or a nav item whose
  // destination is a screen) — Nav.switchTo never touches the modal overlay itself, and the
  // Itinerary Today view may still be the thing on top of it. Water/Target/other nav destinations
  // open their OWN Modal.open() call, which already overwrites whatever modal is showing.
  function openForType(item) {
    if (item.type === 'journal') {
      journalSnapshots[item.itemId] = JSON.stringify(JournalData.getEntry(todayStr()));
      if (typeof Modal !== 'undefined') Modal.close();
      if (typeof Nav !== 'undefined') Nav.switchTo('journal');
    } else if (item.type === 'water') {
      waterSnapshots[item.itemId] = WaterData.getEventsForDate(todayStr()).length;
      if (typeof Water !== 'undefined') Water.openPicker();
    } else if (item.type === 'target') {
      if (typeof Targets !== 'undefined') Targets.open();
    } else if (item.type === 'nav') {
      if (item.destination && item.destination.kind === 'screen' && typeof Modal !== 'undefined') Modal.close();
      if (typeof Itinerary !== 'undefined') Itinerary.invokeDestination(item.destination);
    } else if (item.type === 'break') {
      // Section 17 point 2 / 23 — routed entirely through the EXISTING Global Break system, no
      // second timer. Duration is the item's own planned span; shifting doesn't change a span's
      // length, so plannedEnd - plannedStart is exact regardless of accumulated shiftMs.
      const durationMs = Math.max(60000, timeStrToMs(todayStr(), item.plannedEnd) - timeStrToMs(todayStr(), item.plannedStart));
      TimeEngine.startGlobalBreak(Math.round(durationMs / 60000), item.label || 'Break');
    }
    // 'study'/'planner-task': nothing to open here — handled via ensureStudyTask + TimeEngine's
    // own existing prompt flow. 'checklist'/'custom': no existing screen to open (Section 17
    // point 3's list has no home for these two yet) — the user confirms directly from the Today
    // view's "Mark Done" button once they've done the thing.
  }

  function activateItem(item) {
    ItineraryData.updateItemState(item.itemId, { state: 'active', actualStart: nowMs() });
    openForType(item);
  }

  // ---------- per-type completion detection (only while item.state === 'active') ----------

  function checkStudyLike(item) {
    if (!item.refId) return; // 'study' item not yet turned into a task (shouldn't happen post-activation)
    const rec = TimeEngine.getRecordForTask(item.refId, todayStr());
    if (rec && rec.state === 'completed') {
      resolveItem(item, { state: 'completed', actualStart: rec.actualStart || item.actualStart, actualEnd: rec.actualEnd || nowMs() });
    }
  }

  function checkBreak() {
    const gb = TimeEngine.getGlobalBreak();
    if (!gb || !gb.active) return true; // ended naturally (processGlobalBreak) or via endGlobalBreak
    return false;
  }

  // Section 24 — completion = a real change to today's entry while this item was the one asking
  // for it, not merely "the entry has some content" (which could predate the item entirely).
  function checkJournal(item) {
    const snap = journalSnapshots[item.itemId];
    if (snap === undefined) return;
    if (JSON.stringify(JournalData.getEntry(todayStr())) !== snap) {
      resolveItem(item, { state: 'completed', actualEnd: nowMs() });
    }
  }

  // Section 25 — completion = a NEW waterEvents entry appears after this item's own activation,
  // not merely "today already has some logged water".
  function checkWater(item) {
    const base = waterSnapshots[item.itemId];
    if (base === undefined) return;
    if (WaterData.getEventsForDate(todayStr()).length > base) {
      resolveItem(item, { state: 'completed', actualEnd: nowMs() });
    }
  }

  // Section 26 — reads TargetsData's own completion flag; never re-implements completion math.
  function checkTarget(item) {
    if (!item.refId) return;
    const target = TargetsData.getTarget(item.refId);
    if (target && target.completed) resolveItem(item, { state: 'completed', actualEnd: nowMs() });
  }

  function tickActive(item) {
    if (item.type === 'study' || item.type === 'planner-task') { checkStudyLike(item); return; }
    if (item.type === 'break') { if (checkBreak()) resolveItem(item, { state: 'completed', actualEnd: nowMs() }); return; }
    if (item.type === 'journal') { checkJournal(item); return; }
    if (item.type === 'water') { checkWater(item); return; }
    if (item.type === 'target') { checkTarget(item); return; }
    // 'checklist'/'custom'/'nav': no automatic signal — waits for markItemDone()/skipItem().
  }

  function tick() {
    const day = ItineraryData.getToday();
    if (day.status !== 'in_progress') return;
    const item = currentItem(day);
    if (!item) return; // every item resolved — ItineraryData.updateItemState already flips status to 'completed'

    if (item.state === 'active') { tickActive(item); return; }

    // item.state === 'pending' — only act once its (adjusted) start time has arrived (Section 17
    // point 1's "the current item's start time has arrived AND the previous item is resolved" —
    // the previous-resolved half is already guaranteed by currentItem() returning the first
    // unresolved item in order).
    const startMs = item.plannedStart ? timeStrToMs(todayStr(), item.plannedStart) + ItineraryData.getShiftMs() : nowMs();
    if (nowMs() < startMs) return;

    if (item.type === 'study') ensureStudyTask(item);
    activateItem(item);
  }

  function init() { TimeEngine.subscribe(tick, SUBSCRIBER_ID); }

  return { init: init, markItemDone: markItemDone, skipItem: skipItem };
})();
