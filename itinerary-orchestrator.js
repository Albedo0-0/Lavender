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

  // Phase C / P7: tracks which itinerary item (if any) started the currently-active Global
  // Break, so skipItem() only ever ends a Break that this exact item owns — never an unrelated
  // Break started elsewhere. Set on activation, cleared on that item's own resolution.
  let activeBreakItemId = null;

  

function todayStr() { return ItineraryTime.todayStr(); }
  function timeStrToMs(dateStr, hhmm) { return ItineraryTime.timeStrToMs(dateStr, hhmm); }
  function nowMs() { return Date.now(); }

  function isResolved(it) { return it.state === 'completed' || it.state === 'skipped' || it.state === 'rescheduled'; }

  function currentItem(day) {
    const items = day.items || [];
    for (let i = 0; i < items.length; i++) {
      if (!isResolved(items[i])) return items[i];
    }
    return null;
  }


  function resolveItem(item, fields) {
    delete journalSnapshots[item.itemId];
    delete waterSnapshots[item.itemId];
    if (activeBreakItemId === item.itemId) activeBreakItemId = null;
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
    // Record the actual completion time first (Section 12's actual-times-separate rule) —
    // planned times are never touched here either way; foldLag only decides afterward whether
    // the recovered/lost time folds into the rest of today's schedule.
    resolveItem(item, { state: 'completed', actualEnd: now });
  }

  // Safety valve for every item type (a stuck/misbehaving underlying system, or the user simply
  // choosing not to do this item today) — advances the sequence without claiming a real
  // completion happened. Explicitly ends a still-running Global Break rather than leaving
  // TimeEngine's own break timer orphaned after the itinerary item has moved on.
  function skipItem(itemId) {
    const day = ItineraryData.getToday();
    const item = (day.items || []).find(function (it) { return it.itemId === itemId; });
    // Phase C / P3: Skip is only ever valid on the current (active) item — a 'pending' item is
    // upcoming, and skipping it out of order could shift timings/skip the wrong slot. The UI no
    // longer renders a Skip control on upcoming items either (itinerary-today.js); this is the
    // authoritative guard.
    if (!item || item.state !== 'active') return;
    // Phase C / P7: only end the Global Break if THIS item is the one that started it — never an
    // unrelated Break started elsewhere.
    if (item.type === 'break' && activeBreakItemId === item.itemId) {
      const gb = TimeEngine.getGlobalBreak();
      if (gb && gb.active) TimeEngine.endGlobalBreak();
    }
    const now = nowMs();
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
    const start = item.plannedStart;
    const end = item.plannedEnd;
    const task = PlannerData.createSingleTask(item.subject, item.topicName, item.taskType || 'theory', todayStr(), '', start, end);
    if (!task) return;
    // Additive, non-breaking tag (Section 22) — lets a future view find "which itinerary item
    // does this session belong to" without PlannerData/TimeEngine needing to know Itinerary
    // exists at all.
    PlannerData.updateTask(task.taskId, { sourceItineraryItemId: item.itemId });
    ItineraryData.updateItemState(item.itemId, { refId: task.taskId });
    // Phase D / P6: item.refId is no longer mutated directly here. The canonical store write
    // above (updateItemState) is the one source of truth; the in-memory object is re-read from
    // the store by checkStudyLike on the next tick via currentItem(), so no direct mutation needed.
  }

  // Opens the relevant existing screen/modal
  // the shared Modal first when the target is a full screen switch (journal, or a nav item whose
  // destination is a screen) — Nav.switchTo never touches the modal overlay itself, and the
  // Itinerary Today view may still be the thing on top of it. Water/Target/other nav destinations
  // open their OWN Modal.open() call, which already overwrites whatever modal is showing.
  function openForType(item) {
    if (item.type === 'study' || item.type === 'planner-task') {
      // Section 17 previously left this branch empty, relying on TimeEngine's own passive
      // start-prompt to eventually pick the task up. A strictly guided itinerary needs the
      // opposite: begin the underlying session immediately and leave the Itinerary screen for
      // Study, exactly the way Planner's/Library's own "Start in Study" buttons already do via
      // this same public function (TimeEngine.startTaskSession — it starts the session AND calls
      // Nav.switchTo('study') itself, so there is nothing itinerary-specific to duplicate here).
      if (typeof Modal !== 'undefined') Modal.close();
      if (item.refId && typeof TimeEngine !== 'undefined' && typeof TimeEngine.startTaskSession === 'function') {
        TimeEngine.startTaskSession(item.refId);
      }
    } else if (item.type === 'journal') {
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
      activeBreakItemId = item.itemId;
      TimeEngine.startGlobalBreak(Math.round(durationMs / 60000), item.label || 'Break');
    }
     // 'checklist'/'custom'/'nav': no existing screen leaves the user with a visible "Mark Done"/
    // "Skip" control — checklist/custom have no home screen of their own, and nav navigates away
    // from Today entirely (B9). All three reopen Today so the confirm controls are always reachable.
    if ((item.type === 'checklist' || item.type === 'custom' || item.type === 'nav') && typeof ItineraryToday !== 'undefined') {
      ItineraryToday.openTodayView();
    }
  }

  function activateItem(item) {
    ItineraryData.updateItemState(item.itemId, { state: 'active', actualStart: nowMs() });
    openForType(item);
  }

  // ---------- per-type completion detection (only while item.state === 'active') ----------

  // Automatic per-type completions record the same way manual ones do (Early Completion +
  // Auto-Adjust, new): record state + actualEnd first, then let foldLag decide whether an early
  // finish needs to ask before reshuffling the rest of the day.
  function checkStudyLike(item) {
    if (!item.refId) return; // 'study' item not yet turned into a task (shouldn't happen post-activation)
    const rec = TimeEngine.getRecordForTask(item.refId, todayStr());
    if (rec && rec.state === 'completed') {
      const endMs = rec.actualEnd || nowMs();
      resolveItem(item, { state: 'completed', actualStart: rec.actualStart || item.actualStart, actualEnd: endMs });
      return;
    }
    if (rec && (rec.state === 'rescheduled' || rec.state === 'stale')) {
      const endMs = rec.actualEnd || nowMs();
      resolveItem(item, { state: 'skipped', actualStart: rec.actualStart || item.actualStart, actualEnd: endMs });
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
    if (journalSnapshots[item.itemId] === undefined) journalSnapshots[item.itemId] = JSON.stringify(JournalData.getEntry(todayStr()));
    const snap = journalSnapshots[item.itemId];
    if (JSON.stringify(JournalData.getEntry(todayStr())) !== snap) {
      const endMs = nowMs();
      resolveItem(item, { state: 'completed', actualEnd: endMs });
    }
  }

  // Section 25 — completion = a NEW waterEvents entry appears after this item's own activation,
  // not merely "today already has some logged water".
  function checkWater(item) {
    if (waterSnapshots[item.itemId] === undefined) waterSnapshots[item.itemId] = WaterData.getEventsForDate(todayStr()).length;
    const base = waterSnapshots[item.itemId];
    if (WaterData.getEventsForDate(todayStr()).length > base) {
      const endMs = nowMs();
      resolveItem(item, { state: 'completed', actualEnd: endMs });
    }
  }

  // Section 26 — reads TargetsData's own completion flag; never re-implements completion math.
  function checkTarget(item) {
    if (!item.refId) return;
    const target = TargetsData.getTarget(item.refId);
    if (target && target.completed) {
      const endMs = nowMs();
      resolveItem(item, { state: 'completed', actualEnd: endMs });
    }
  }

  function tickActive(item) {
    if (item.type === 'study' || item.type === 'planner-task') { checkStudyLike(item); return; }
    if (item.type === 'break') {
      if (checkBreak()) {
        const endMs = nowMs();
        resolveItem(item, { state: 'completed', actualEnd: endMs });
      }
      return;
    }
    if (item.type === 'journal') { checkJournal(item); return; }
    if (item.type === 'water') { checkWater(item); return; }
    if (item.type === 'target') { checkTarget(item); return; }
    // 'checklist'/'custom'/'nav': no automatic signal — waits for markItemDone()/skipItem().
  }

  function tick() {
    if (typeof ItineraryData.syncPlannerTasks === 'function') ItineraryData.syncPlannerTasks();

    const day = ItineraryData.getToday();
    if (day.status !== 'in_progress') return;
    const item = currentItem(day);
    if (!item) return;

    if (item.state === 'active') { tickActive(item); return; }

    const startMs = item.plannedStart ? timeStrToMs(todayStr(), item.plannedStart) : nowMs();
    if (nowMs() < startMs) return;

    if (item.type === 'study') ensureStudyTask(item);
    activateItem(item);
  }

  function resetOnRollover() {
    activeBreakItemId = null;
  }

  function init() {
    TimeEngine.subscribe(tick, SUBSCRIBER_ID);
    if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.onRollover === 'function') {
      TimeEngine.onRollover(resetOnRollover, SUBSCRIBER_ID);
    }
  }

  return { init: init, markItemDone: markItemDone, skipItem: skipItem };
})();
