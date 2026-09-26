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

  // ---------- automatic transition between items (new) ----------
  // A short, purely in-memory countdown shown right before every item after the first is
  // engaged — "after every completed task" in practice, since the NEXT pending item only ever
  // becomes engageable once the one before it has resolved (currentItem() always returns the
  // first unresolved item, in order). Deliberately NOT applied to the very first item of the
  // day: START ITINERARY is already its own explicit "go" action (Section 17), so that one
  // engages immediately, same as before this change.
   const TRANSITION_MS = 3000;
  let transition = null; // { itemId, until, label } while a countdown is showing

  // Central execution lock (Phase A / P1+P4): set while a late-start or early-completion decision
  // modal is open and unresolved. tick() checks this first and stops immediately — nothing may
  // advance/activate until the decision is explicitly resolved and this is cleared back to null.
  let pendingDecision = null;

  // Phase C / P7: tracks which itinerary item (if any) started the currently-active Global
  // Break, so skipItem() only ever ends a Break that this exact item owns — never an unrelated
  // Break started elsewhere. Set on activation, cleared on that item's own resolution.
  let activeBreakItemId = null;

  function transitionEl() {
    let el = document.getElementById('itinerary-transition-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'itinerary-transition-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'z-index:9999;padding:8px 16px;border-radius:999px;font-size:13px;line-height:1.3;' +
        'background:rgba(30,30,30,0.88);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,0.25);' +
        'pointer-events:none;transition:opacity 0.25s ease;opacity:0;';
      document.body.appendChild(el);
    }
    return el;
  }
  function renderTransition() {
    if (!transition) return;
    const el = transitionEl();
    const secs = Math.max(0, Math.ceil((transition.until - nowMs()) / 1000));
    el.textContent = 'Next: ' + (transition.label || 'item') + ' in ' + secs + 's\u2026';
    el.style.opacity = '1';
  }
  function clearTransition() {
    transition = null;
    const el = document.getElementById('itinerary-transition-toast');
    if (el) el.style.opacity = '0';
  }

  // ---------- late-start confirmation (new) ----------
  // Only asked once per item (guarded by item.lateChoiceAsked, persisted so a reload mid-decision
  // doesn't re-ask) and only when the gap between the item's own (already-shifted) planned start
  // and right now is more than a trivial tick-to-tick amount — an item that's merely a few
  // seconds "late" because the heartbeat polls once a second isn't a real late start.
  const LATE_THRESHOLD_MS = 60000;

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

  // Early Completion + Auto-Adjust (new): a few seconds early from tick-to-tick rounding isn't a
  // real early finish — mirrors LATE_THRESHOLD_MS's same reasoning for late starts.
  const EARLY_THRESHOLD_MS = 60000;

  // Applies the real finish time's delta from the CURRENTLY adjusted planned end into the
  // itinerary's own shiftMs (Section 18) — composed via ItineraryData.applyItineraryShift, not
  // stacked, and a no-op in fixed mode. Used directly for skips and for on-time/late completions;
  // an early completion goes through foldLag below instead, which asks first.
  function foldLagNow(item, actualEndMs) {
    if (!item.plannedEnd) return;
    const expected = timeStrToMs(todayStr(), item.plannedEnd) + ItineraryData.getEffectiveShiftMs(item);
    applyResolvedShift(item, actualEndMs - expected);
  }

  // Asks once whether to use the recovered time to auto-adjust the rest of today's itinerary
  // forward, or leave the remaining planned times exactly as they are (Section 18's same
  // two-choice pattern promptLateStart already uses for a late start, mirrored here for an early
  // finish). The item's own completed state + actualEnd are already recorded by the time this
  // shows (resolveItem has already run in foldLag below) — this only decides whether shiftMs
  // moves, never whether the completion itself is recorded.
  function promptEarlyCompletion(item, actualEndMs, earlyByMs) {
    if (typeof Modal === 'undefined') return;
    pendingDecision = item.itemId;
    if (typeof Notify !== 'undefined') Notify.lockItinerary();
    const mins = Math.max(1, Math.round(earlyByMs / 60000));
    // High-priority + persistent (Itinerary notification priority): this is exactly the
    // "Auto-adjust prompt" decision — it must appear first and stay up over any lower-priority
    // Study/Planner notification until the user explicitly picks an option below.
    Modal.open(
      '<h3 class="section-heading">Finished early</h3>' +
      '<p>\u201c' + (item.label || 'This item') + '\u201d finished about ' + mins + ' minute' + (mins === 1 ? '' : 's') +
      ' early. Use the recovered time to move the rest of today\u2019s itinerary earlier, or keep it on the original schedule?</p>' +
      '<button id="itinerary-early-keep-btn" class="btn btn-secondary">Keep schedule unchanged</button> ' +
      '<button id="itinerary-early-adjust-btn" class="btn btn-primary">Auto-adjust remaining tasks</button>',
      { size: 'md', priority: 'high', persistent: true }
    );
    function afterChoice() {
      pendingDecision = null;
      if (typeof Notify !== 'undefined') Notify.unlockItinerary();
      Modal.close({ resolve: true });
      if (typeof ItineraryToday !== 'undefined' && typeof ItineraryToday.openTodayView === 'function') ItineraryToday.openTodayView();
    }
    const keepBtn = document.getElementById('itinerary-early-keep-btn');
    const adjustBtn = document.getElementById('itinerary-early-adjust-btn');
    // Modal failed to actually open (e.g. DOM missing, or refused due to an existing unresolved
    // lock) — don't leave pendingDecision/the Notify lock stuck forever with no button to click.
    if (!keepBtn && !adjustBtn) { afterChoice(); return; }
    if (keepBtn) keepBtn.addEventListener('click', afterChoice);
    if (adjustBtn) adjustBtn.addEventListener('click', function () { foldLagNow(item, actualEndMs); afterChoice(); });
  }

  // Central lag-folding decision for a resolution: skips, and on-time/late completions, fold
  // automatically (existing behavior, unchanged). A genuinely early COMPLETION (not a skip) asks
  // first instead of silently reshuffling the rest of the day.
  function foldLag(item, actualEndMs, resolvedState) {
    if (!item.plannedEnd) return;
    const expected = timeStrToMs(todayStr(), item.plannedEnd) + ItineraryData.getEffectiveShiftMs(item);
    const lagMs = actualEndMs - expected;
    if (resolvedState === 'completed' && lagMs < -EARLY_THRESHOLD_MS) {
      promptEarlyCompletion(item, actualEndMs, -lagMs);
      return;
    }
    applyResolvedShift(item, lagMs);
  }

  // Phase A (Itinerary simplification, Priority 1) — the write-side counterpart of
  // ItineraryData.getEffectiveShiftMs: a resolved item's delta goes to TimeEngine for
  // study/planner-task items (the canonical owner of that timing) and to Itinerary's own
  // shiftMs for every other type, instead of writing both on every resolution "kept in sync by
  // convention" (Section 1).
  function applyResolvedShift(item, deltaMs) {
    if ((item.type === 'study' || item.type === 'planner-task') &&
        typeof TimeEngine !== 'undefined' && typeof TimeEngine.applyShift === 'function') {
      TimeEngine.applyShift(deltaMs);
      return;
    }
    ItineraryData.applyItineraryShift(deltaMs);
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
    foldLag(item, now, 'completed');
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
    foldLag(item, now, 'skipped'); // a skip is never "early completion" — always folds automatically
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

  // Asks once whether to keep today's remaining items on their original planned times or shift
  // them all forward by the lateness just observed. "Keep" leaves plannedStart/plannedEnd (and
  // TimeEngine's own records) completely untouched, so the original planned times stay intact
  // for reference/analytics either way (Section 12's snapshot rule already guarantees this —
  // plannedStart/plannedEnd are never overwritten, only the separate adjusted*/shiftMs values
  // move). "Shift" composes the lateness into ItineraryData's own shiftMs (Section 18, for the
  // itinerary's non-study items) AND TimeEngine's engine.shiftMs (for today's other Planner
  // sessions), the same two-system-in-sync approach foldLag already uses on normal resolution.
  function promptLateStart(item, startMs) {
    ItineraryData.updateItemState(item.itemId, { lateChoiceAsked: true });
    if (typeof Modal === 'undefined') { if (item.type === 'study') ensureStudyTask(item); activateItem(item); return; }
    pendingDecision = item.itemId;
    if (typeof Notify !== 'undefined') Notify.lockItinerary();
    const lateMs = nowMs() - startMs;
    // High-priority + persistent (Itinerary notification priority): an important Itinerary
    // decision — must appear first and stay up over any lower-priority Study/Planner
    // notification (including that same item's own Study start/end prompt) until resolved below.
    Modal.open(
      '<h3 class="section-heading">Starting late</h3>' +
      '<p>\u201c' + (item.label || 'This item') + '\u201d was due to start earlier. Continue on the ' +
      'original schedule, or shift the rest of today\u2019s itinerary forward to match?</p>' +
      '<button id="itinerary-late-keep-btn" class="btn btn-secondary">Keep original schedule</button> ' +
      '<button id="itinerary-late-shift-btn" class="btn btn-primary">Shift remaining items forward</button>',
      { size: 'md', priority: 'high', persistent: true }
    );
    function proceed() {
      pendingDecision = null;
      if (typeof Notify !== 'undefined') Notify.unlockItinerary();
      Modal.close({ resolve: true });
      if (item.type === 'study') ensureStudyTask(item);
      activateItem(item);
    }
    const keepBtn = document.getElementById('itinerary-late-keep-btn');
    const shiftBtn = document.getElementById('itinerary-late-shift-btn');
    // Modal failed to actually open (e.g. DOM missing, or refused due to an existing unresolved
    // lock) — don't leave pendingDecision/the Notify lock stuck forever with no button to click.
    if (!keepBtn && !shiftBtn) { proceed(); return; }
    if (keepBtn) keepBtn.addEventListener('click', proceed);
    if (shiftBtn) shiftBtn.addEventListener('click', function () {
      // promptLateStart only ever runs for study/planner-task items (guarded in tick()), so this
      // always resolves to TimeEngine.applyShift \u2014 no more double-write to ItineraryData's own
      // shiftMs "kept in sync by convention" with TimeEngine's.
      applyResolvedShift(item, lateMs);
      proceed();
    });
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
      foldLag(item, endMs, 'completed');
      return;
    }
    if (rec && (rec.state === 'rescheduled' || rec.state === 'stale')) {
      const endMs = rec.actualEnd || nowMs();
      resolveItem(item, { state: 'skipped', actualStart: rec.actualStart || item.actualStart, actualEnd: endMs });
      foldLag(item, endMs, 'skipped');
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
      foldLag(item, endMs, 'completed');
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
      foldLag(item, endMs, 'completed');
    }
  }

  // Section 26 — reads TargetsData's own completion flag; never re-implements completion math.
  function checkTarget(item) {
    if (!item.refId) return;
    const target = TargetsData.getTarget(item.refId);
    if (target && target.completed) {
      const endMs = nowMs();
      resolveItem(item, { state: 'completed', actualEnd: endMs });
      foldLag(item, endMs, 'completed');
    }
  }

  function tickActive(item) {
    if (item.type === 'study' || item.type === 'planner-task') { checkStudyLike(item); return; }
    if (item.type === 'break') {
      if (checkBreak()) {
        const endMs = nowMs();
        resolveItem(item, { state: 'completed', actualEnd: endMs });
        foldLag(item, endMs, 'completed');
      }
      return;
    }
    if (item.type === 'journal') { checkJournal(item); return; }
    if (item.type === 'water') { checkWater(item); return; }
    if (item.type === 'target') { checkTarget(item); return; }
    // 'checklist'/'custom'/'nav': no automatic signal — waits for markItemDone()/skipItem().
  }

  function tick() {
    // Phase A / P1: nothing may advance/activate while a decision (late-start, early-completion)
    // is still open and unresolved.
    if (pendingDecision) return;
    // Keep today's itinerary synchronized with Planner (new requirement) on every heartbeat —
    // cheap no-op unless there's genuinely a new unreferenced Planner task for today, per
    // ItineraryData.syncPlannerTasks' own early-return.
    if (typeof ItineraryData.syncPlannerTasks === 'function') ItineraryData.syncPlannerTasks();

    const day = ItineraryData.getToday();
    if (day.status !== 'in_progress') { clearTransition(); return; }
    const item = currentItem(day);
    if (!item) { clearTransition(); return; } // every item resolved — status already flipped to 'completed'

    if (item.state === 'active') { tickActive(item); return; }

    // item.state === 'pending' — only act once its (adjusted) start time has arrived (Section 17
    // point 1's "the current item's start time has arrived AND the previous item is resolved" —
    // the previous-resolved half is already guaranteed by currentItem() returning the first
    // unresolved item in order).
    const startMs = item.plannedStart ? timeStrToMs(todayStr(), item.plannedStart) + ItineraryData.getEffectiveShiftMs(item) : nowMs();
    if (nowMs() < startMs) return;

    // Automatic transition (new requirement): every item after the first gets a short countdown
    // right before it's engaged, instead of snapping straight from the previous item's
    // resolution into this one.
    const isFirstItem = (day.items || []).length > 0 && day.items[0].itemId === item.itemId;
    if (!isFirstItem) {
      if (!transition || transition.itemId !== item.itemId) {
        transition = { itemId: item.itemId, until: nowMs() + TRANSITION_MS, label: item.label };
      }
      if (nowMs() < transition.until) { renderTransition(); return; }
      clearTransition();
    }

    // Late-start confirmation (new requirement) — study-type items only, asked once.
    if ((item.type === 'study' || item.type === 'planner-task') && !item.lateChoiceAsked && (nowMs() - startMs) > LATE_THRESHOLD_MS) {
      promptLateStart(item, startMs);
      return;
    }

    if (item.type === 'study') ensureStudyTask(item);
    activateItem(item);
  }

  function resetOnRollover() {
    if (pendingDecision) {
      if (typeof Notify !== 'undefined') Notify.unlockItinerary();
      if (typeof Modal !== 'undefined') Modal.close({ resolve: true });
    }
    pendingDecision = null;
    clearTransition();
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
