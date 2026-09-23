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
      completedAt: null
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
      return Object.assign({}, day, { status: 'abandoned' });
    }
    return day;
  }

  // ---------- state machine transitions (§13) ----------

  // Flips 'unpresented' -> 'awaiting_choice' and persists immediately, so a reload mid-decision
  // re-shows the gate because it's still 'awaiting_choice', not because a fresh 'unpresented' day
  // was re-detected (Section 14). No-op (returns the current day unchanged) if already past
  // 'unpresented' — presenting the gate is idempotent, never a redundant transition.
  function presentGate() {
    const day = getToday();
    if (day.status !== 'unpresented') return day;
    return setToday({ status: 'awaiting_choice' });
  }

  // Snapshots the chosen template's item definitions into today's items[] (Section 12's
  // reference-and-snapshot rule: refId is a pointer, never a copy of the referenced record's own
  // data). Each item starts 'pending' with no actual times yet.
  function chooseTemplate(templateId) {
    const day = getToday();
    if (day.status !== 'awaiting_choice') return day;
    const template = (typeof ItineraryTemplateData !== 'undefined') ? ItineraryTemplateData.getById(templateId) : null;
    if (!template) return day;
    const items = (template.items || []).map(function (def) {
      return {
        itemId: def.itemId,
        type: def.type,
        refId: def.refId || null,
        label: def.label,
        plannedStart: def.plannedStart,
        plannedEnd: def.plannedEnd,
        state: 'pending',
        actualStart: null,
        actualEnd: null
      };
    });
    return setToday({ status: 'itinerary_selected', templateId: templateId, items: items, diyChosen: false });
  }

  // Terminal choice for the day (Section 15) — no itinerary to start.
  function chooseDIY() {
    const day = getToday();
    if (day.status !== 'awaiting_choice') return day;
    return setToday({ status: 'diy_selected', templateId: null, items: [], checklist: [], diyChosen: true });
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
    const items = day.items.map(function (it) {
      if (it.itemId !== itemId) return it;
      changed = true;
      return Object.assign({}, it, fields);
    });
    if (!changed) return day;
    const patch = { items: items };
    if (itemsAllResolved(items)) {
      patch.status = 'completed';
      patch.completedAt = Date.now();
    }
    return setToday(patch);
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
        summaries[cursor] = finalizeDay(day);
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
    onRolloverFinalize: onRolloverFinalize
  };
})();
