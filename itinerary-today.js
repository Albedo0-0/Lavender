// itinerary-today.js — Morning Gate + Today view (Itinerary Phase 6). Depends on: State, Modal,
// ItineraryData, ItineraryTemplateData, Alarm (for "Create Itinerary"), GamificationData,
// PlannerData, TargetsData. Must load after all of those.
//
// This module is a VIEW only (Section 14): every mutation goes through ItineraryData's own
// functions (presentGate/chooseTemplate/chooseDIY/startItinerary) — it never writes
// State.dailyItinerary directly, so there is exactly one writer of itinerary state.
//
// Two screens, per Section 14/15:
//   - the morning gate ("daily-board/hotel-menu screen"): shown once automatically the first
//     time `dailyItinerary` resolves to 'unpresented' for today, and reachable again afterwards
//     any time the day is still 'awaiting_choice' (Section 13's "asking, not blocking" rule).
//   - the Today view: a read-only live summary (current/upcoming/done items, live counters)
//     plus the START ITINERARY control (Section 17) once a template is chosen.
// open() is the single entry point Assistant's "Today" ribbon calls — it routes to whichever of
// the two screens fits the day's current status, so Assistant never has to know the state
// machine itself.
const ItineraryToday = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  // ---------- time / counters (mirrors itinerary.js's builder counters, Section 16, but reads
  // the already-snapshotted dailyItinerary.items instead of an in-progress draft) ----------

  function timeStrToMinutes(hhmm) {
    if (!hhmm || hhmm.indexOf(':') === -1) return null;
    const parts = hhmm.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }
  function itemDurationMin(it) {
    const s = timeStrToMinutes(it.plannedStart), e = timeStrToMinutes(it.plannedEnd);
    if (s === null || e === null) return 0;
    let d = e - s;
    if (d < 0) d += 1440; // a day that runs past midnight — same convention as the builder
    return d;
  }
  function formatDuration(min) {
    min = Math.round(min || 0);
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  // Same read-only estimate the builder uses (Section 16/30: never writes expLedger itself). A
  // 'study' item hasn't become a real Planner task yet at this layer (that wiring is Phase 7's
  // job, Section 21/22) so it's estimated as a plain non-R6 task, same fallback the builder uses.
  function expectedExpForItem(it) {
    if (typeof GamificationData === 'undefined') return 0;
    if (it.type === 'study') return GamificationData.taskExpValue({});
    if (it.type === 'planner-task') {
      const task = (typeof PlannerData !== 'undefined' && it.refId) ? PlannerData.getTask(it.refId) : null;
      return task ? GamificationData.taskExpValue(task) : 0;
    }
    if (it.type === 'target') {
      const target = (typeof TargetsData !== 'undefined' && it.refId) ? TargetsData.getTarget(it.refId) : null;
      return target ? GamificationData.targetExpValue(target) : 0;
    }
    return 0;
  }

  function computeCounters(items) {
    let studyMin = 0, breakMin = 0, totalMin = 0, exp = 0;
    items.forEach(function (it) {
      const d = itemDurationMin(it);
      totalMin += d;
      if (it.type === 'study' || it.type === 'planner-task') studyMin += d;
      if (it.type === 'break') breakMin += d;
      exp += expectedExpForItem(it);
    });
    return { count: items.length, studyMin: studyMin, breakMin: breakMin, totalMin: totalMin, exp: exp };
  }

  // Exact format from Section 16: "12 tasks \u00B7 4h 30m study \u00B7 45m breaks \u00B7 5h 15m total \u00B7 +820 EXP"
  function countersHtml(items) {
    const c = computeCounters(items);
    return '<div class="itinerary-counters chip">' +
      c.count + ' tasks \u00B7 ' + formatDuration(c.studyMin) + ' study \u00B7 ' +
      formatDuration(c.breakMin) + ' breaks \u00B7 ' + formatDuration(c.totalMin) + ' total \u00B7 +' + c.exp + ' EXP' +
      '</div>';
  }

  // ---------- Morning gate (Section 14/15) ----------

  // Matching templates (today's schedule) first, everything else saved as a fallback list —
  // Section 15's "filtered first to whatever matches today's schedule, then all saved templates".
  function gateTemplateListHtml() {
    const matching = ItineraryTemplateData.getMatchingForDate(todayStr());
    const matchingIds = matching.map(function (t) { return t.templateId; });
    const rest = ItineraryTemplateData.getList().filter(function (t) { return matchingIds.indexOf(t.templateId) === -1; });

    function row(t, isMatch) {
      return '<div class="itinerary-gate-template-row list-row" data-id="' + t.templateId + '">' +
        '<span class="itinerary-gate-template-name">' + esc(t.name) + '</span> ' +
        (isMatch ? '<span class="chip itinerary-gate-suggested-chip">Suggested</span> ' : '') +
        '<span class="chip">' + (t.items ? t.items.length : 0) + ' items</span> ' +
        '<button class="itinerary-gate-choose-btn btn btn-primary" data-id="' + t.templateId + '">Choose</button>' +
      '</div>';
    }

    if (!matching.length && !rest.length) {
      return '<p class="empty-state">No itinerary templates yet \u2014 create one below.</p>';
    }
    return matching.map(function (t) { return row(t, true); }).join('') +
      (rest.length ? '<h4 class="section-heading">Other templates</h4>' + rest.map(function (t) { return row(t, false); }).join('') : '');
  }

  // The "daily-board/hotel-menu screen" (Section 14). Persists unpresented -> awaiting_choice
  // immediately (presentGate() is idempotent, so re-showing this later — the persistent
  // affordance from Section 13 — never re-triggers a transition). Never a full-screen block:
  // it's a normal closable modal, matching "Lavender is asking, not blocking".
  function openGate() {
    ItineraryData.presentGate();
    Modal.open(
      '<h3 class="section-heading">Good morning \u2014 plan today</h3>' +
      '<div id="itinerary-gate-templates">' + gateTemplateListHtml() + '</div><br>' +
      '<button id="itinerary-gate-diy-btn" class="btn btn-secondary">I\u2019ll do it myself</button> ' +
      '<button id="itinerary-gate-create-btn" class="btn btn-primary">+ Create Itinerary</button>',
      { size: 'lg' }
    );

    document.querySelectorAll('.itinerary-gate-choose-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ItineraryData.chooseTemplate(btn.dataset.id);
        openTodayView();
      });
    });
    document.getElementById('itinerary-gate-diy-btn').addEventListener('click', function () {
      ItineraryData.chooseDIY();
      Modal.close();
    });
    document.getElementById('itinerary-gate-create-btn').addEventListener('click', function () {
      if (typeof Alarm !== 'undefined' && Alarm.openItineraryForm) Alarm.openItineraryForm(null, openGate);
    });
  }

  // Called once from bootstrap, right after TimeEngine.init() (Section 14) — not duplicated into
  // any individual screen's own init(). Only fires the very first time a day is unpresented;
  // once presentGate() has run (even from a prior page load that same day), status is already
  // past 'unpresented' and this is a no-op, so a reload mid-decision does not re-trigger it.
  function maybePresentGate() {
    if (ItineraryData.getToday().status === 'unpresented') openGate();
  }

  // ---------- Today view (Section 14) ----------

  const STATE_LABELS = { pending: 'Upcoming', active: 'In progress', completed: 'Done', skipped: 'Skipped', rescheduled: 'Rescheduled' };

  // Types with no existing system to report a real completion of their own (Section 17 point 3)
  // — the itinerary's own Mark Done button is the authoritative confirm for these.
  const MANUAL_CONFIRM_TYPES = { checklist: true, custom: true, nav: true };

  // Section 18 — reads the orchestrator's adjusted display time the same way Study's own UI
  // already reads sessionRecords[...].adjustedStart/adjustedEnd, falling back to the planned
  // time before Phase 7/8 wiring exists or while the orchestrator module isn't loaded.
  function itemRowHtml(it) {
    const start = (typeof ItineraryData.adjustedStart === 'function') ? (ItineraryData.adjustedStart(it) || it.plannedStart) : it.plannedStart;
    const end = (typeof ItineraryData.adjustedEnd === 'function') ? (ItineraryData.adjustedEnd(it) || it.plannedEnd) : it.plannedEnd;
    const shifted = start !== it.plannedStart || end !== it.plannedEnd;
    let actions = '';
    if (typeof ItineraryOrchestrator !== 'undefined') {
      if (it.state === 'active') {
        if (MANUAL_CONFIRM_TYPES[it.type]) {
          actions += '<button class="btn btn-primary itinerary-today-done-btn" data-id="' + it.itemId + '">Mark Done</button> ';
        }
        actions += '<button class="btn btn-secondary itinerary-today-skip-btn" data-id="' + it.itemId + '">Skip</button> ';
      } else if (it.state === 'pending') {
        actions += '<button class="btn btn-secondary itinerary-today-skip-btn" data-id="' + it.itemId + '">Skip</button> ';
      }
    }
    // Planner-synced items (new): a distinct Remove action, separate from Skip, that also
    // unschedules the underlying Planner task for today (ItineraryData.removeSyncedItem) —
    // available whenever the item hasn't already resolved.
    if (it.syncedFromPlanner && (it.state === 'pending' || it.state === 'active')) {
      actions += '<button class="btn btn-danger itinerary-today-remove-btn" data-id="' + it.itemId + '" title="Remove from today and unschedule in Planner">Remove</button>';
    }
    return '<div class="itinerary-today-item-row list-row itinerary-today-item-' + esc(it.state) + '" data-item-id="' + esc(it.itemId) + '">' +
      '<span class="chip itinerary-today-item-time' + (shifted ? ' itinerary-today-item-shifted' : '') + '">' + esc(start || '') + '\u2013' + esc(end || '') + '</span> ' +
      '<span class="itinerary-today-item-label">' + esc(it.label) + '</span> ' +
      '<span class="chip">' + (STATE_LABELS[it.state] || it.state) + '</span> ' +
      (it.syncedFromPlanner ? '<span class="chip itinerary-today-synced-chip">From Planner</span> ' : '') +
      actions +
    '</div>';
  }

  function todayBodyHtml(day) {
    if (day.status === 'diy_selected') {
      return '<p class="empty-state">You chose to do it yourself today \u2014 no itinerary to run.</p>';
    }
    const items = day.items || [];
    if (!items.length) return '<p class="empty-state">No itinerary chosen yet.</p>';

    const current = items.filter(function (it) { return it.state === 'active'; });
    const upcoming = items.filter(function (it) { return it.state === 'pending'; });
    const done = items.filter(function (it) { return it.state === 'completed' || it.state === 'skipped' || it.state === 'rescheduled'; });

    return countersHtml(items) + '<br>' +
      (current.length ? '<h4 class="section-heading">Now</h4>' + current.map(itemRowHtml).join('') : '') +
      (upcoming.length ? '<h4 class="section-heading">Up next</h4>' + upcoming.map(itemRowHtml).join('') : '') +
      (done.length ? '<h4 class="section-heading">Done</h4>' + done.map(itemRowHtml).join('') : '');
  }

  // START ITINERARY is the single control (Section 17) — no per-item Start buttons anywhere in
  // this view. Only enabled while status is exactly 'itinerary_selected'. Its actual sequencing
  // (advancing items, invoking Break/Journal/Water/etc.) is the Phase 7 orchestrator's job; here
  // it only performs the state-machine transition to 'in_progress' that orchestrator will watch.
  function todayViewHtml(day) {
    const startBtn = (day.status === 'itinerary_selected')
      ? '<button id="itinerary-today-start-btn" class="btn btn-primary">START ITINERARY</button> ' : '';
    const changeBtn = (day.status === 'itinerary_selected' || day.status === 'diy_selected')
      ? '<button id="itinerary-today-change-btn" class="btn btn-secondary">Change plan</button>' : '';
    // The id="itinerary-today-live" marker lets refreshIfOpen() find and replace just this
    // view's content in place (no Modal.open(), so no re-triggered open sound/focus-steal) —
    // see refreshIfOpen below.
    return '<h3 class="section-heading">Today</h3><div id="itinerary-today-live">' + todayBodyHtml(day) + '</div><br>' + startBtn + changeBtn;
  }

    // Static listeners: wired once per modal open (start/change-plan) — never re-attached on
  // heartbeat refreshes because those buttons live outside #itinerary-today-live and their DOM
  // nodes are never torn down by refreshIfOpen (Phase B / P2).
  function attachStaticListeners() {
    const startBtn = document.getElementById('itinerary-today-start-btn');
    if (startBtn) startBtn.addEventListener('click', function () { ItineraryData.startItinerary(); openTodayView(); });
    const changeBtn = document.getElementById('itinerary-today-change-btn');
    // Re-picking before the day is actually running is just re-opening the gate; Section 11's
    // "must go through the same confirmation the morning gate uses" is satisfied because
    // openGate() is that same confirmation screen, not a silent swap.
    if (changeBtn) changeBtn.addEventListener('click', openGate);
  }

  // Dynamic listeners: wired to freshly-rendered item rows inside #itinerary-today-live after
  // every content replacement. Each call operates on new DOM nodes so there is no accumulation
  // (Phase B / P2).
  function attachDynamicListeners() {
    document.querySelectorAll('.itinerary-today-done-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { ItineraryOrchestrator.markItemDone(btn.dataset.id); refreshIfOpen(); });
    });
    document.querySelectorAll('.itinerary-today-skip-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { ItineraryOrchestrator.skipItem(btn.dataset.id); refreshIfOpen(); });
    });
    document.querySelectorAll('.itinerary-today-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { ItineraryData.removeSyncedItem(btn.dataset.id); refreshIfOpen(); });
    });
  }

  function openTodayView() {
    // Pick up any Planner task scheduled for today that isn't reflected yet, so opening this
    // view never lags a heartbeat behind (new Planner \u2194 Itinerary sync requirement).
    if (typeof ItineraryData.syncPlannerTasks === 'function') ItineraryData.syncPlannerTasks();
    const day = ItineraryData.getToday();
    Modal.open(todayViewHtml(day), { size: 'lg' });
    attachStaticListeners();
    attachDynamicListeners();
  }

  // Section 17/18's automatic progression (orchestrator ticks; a break ending naturally; a
  // water/journal/target completion landing while the user is elsewhere) needs the open Today
  // view to reflect it without waiting for the next manual open. Driven off the same TimeEngine
  // heartbeat (Section 4/38 — no second timer). Only touches the DOM while this exact view is
  // still the thing showing (the gate and other modals own their own content otherwise) and
  // never while it's mid-decision (awaiting_choice/unpresented are the gate's own screens).
  function refreshIfOpen() {
    const live = document.getElementById('itinerary-today-live');
    if (!live) return;
    if (typeof ItineraryData.syncPlannerTasks === 'function') ItineraryData.syncPlannerTasks();
    const day = ItineraryData.getToday();
    if (day.status === 'unpresented' || day.status === 'awaiting_choice' || day.status === 'diy_selected') return;
    // Collect item ids already rendered so their rows don't replay the entrance animation (B6).
    const existing = {};
    live.querySelectorAll('.itinerary-today-item-row[data-item-id]').forEach(function (el) {
      existing[el.dataset.itemId] = true;
    });
    // Replace only the live subtree — not the full modal-content — so the header, START, and
    // Change-plan controls are never torn down and rewired on every heartbeat tick.
    live.innerHTML = todayBodyHtml(day);
    // Suppress the fade-in on rows that were already showing; only genuinely new rows animate.
    live.querySelectorAll('.itinerary-today-item-row[data-item-id]').forEach(function (el) {
      if (existing[el.dataset.itemId]) el.style.animation = 'none';
    });
    // Dynamic listeners only — static (start/change-plan) buttons are outside the refreshed
    // subtree and were already wired once in openTodayView (Phase B / P2).
    attachDynamicListeners();
  }

  // Single entry point for Assistant's "Today" ribbon (Section 13's persistent affordance) — routes
  // to the gate while the day is still undecided, and to the live Today view once it isn't.
  function open() {
    const status = ItineraryData.getToday().status;
    if (status === 'unpresented' || status === 'awaiting_choice') { openGate(); return; }
    openTodayView();
  }

  // Lets Assistant decide whether to visually highlight its "Today" ribbon (Section 13's
  // "persistent affordance" reads better with a nudge while a choice is still pending).
  function isAwaitingChoice() { return ItineraryData.getToday().status === 'awaiting_choice'; }

  function init() {
    maybePresentGate();
    if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.onRollover === 'function') {
      TimeEngine.onRollover(maybePresentGate, 'itinerary-today');
    }
    if (typeof TimeEngine !== 'undefined' && typeof TimeEngine.subscribe === 'function') {
      TimeEngine.subscribe(refreshIfOpen, 'itinerary-today');
    }
  }

  return {
    init: init,
    open: open,
    openGate: openGate,
    openTodayView: openTodayView,
    isAwaitingChoice: isAwaitingChoice
  };
})();
