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
//               // chooseTemplate(id, true) goes awaiting_choice -> in_progress directly, skipping
//               // itinerary_selected (Phase 6/Finding 7); the two-step path stays available for
//               // any caller that omits the flag.
//   templateId,
//   items: [ { itemId, type, refId, label, plannedStart, plannedEnd, state, actualStart, actualEnd } ],
//   checklist: [], diyChosen, startedAt, completedAt
// }
const ItineraryData = (function () {
  const SUBSCRIBER_ID = 'itinerary';

  function pad(n) { return ItineraryTime.pad(n); }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() { return ItineraryTime.todayStr(); }
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
      const rows = it.rows || (it.tagIds || []).map(function (tagId) { return { tagId: tagId, done: it.state === 'completed' }; });
      rows.forEach(function (row) {
        if (!row.tagId) return;
        if (!byTag[row.tagId]) byTag[row.tagId] = { completedCount: 0, totalCount: 0 };
        byTag[row.tagId].totalCount++;
        if (row.done) byTag[row.tagId].completedCount++;
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
  // was re-detected (Section 14). No-op (returns the current day unchanged) if the day is already
  // past a re-enterable state — presenting the gate is idempotent, never a redundant transition.
  //
  // Phase 7 / Finding 8: also handles the "Change Plan" re-entry from 'itinerary_selected' or
  // 'diy_selected' (a plan was picked, or DIY was chosen, but the day hasn't started yet).
  // Previously only 'unpresented' -> 'awaiting_choice' was allowed here, so re-opening the gate
  // from those two states left status unchanged and chooseTemplate/chooseDIY below silently
  // no-op'd (both guard on day.status === 'awaiting_choice') — the gate would open but no
  // selection could ever actually complete. Any other status (in_progress/completed/etc.) still
  // has no valid "change plan" path, so it remains an untouched no-op here, matching the
  // itinerary-today.js UI, which already hides the Change Plan button outside these two states.
  //
  // allowRestart (optional, used only by Alarm's explicit template "Start" button): also allows
  // re-entry from a finished or running day ('completed'/'partially_completed'/'abandoned'/
  // 'in_progress') so choosing a template again starts a fresh run instead of silently no-op'ing
  // against the old execution state. The previous run's items are archived (never rewritten) in
  // previousRuns before today's execution instance is replaced by chooseTemplate.
  function presentGate(allowRestart) {
    const day = getToday();
    const reenterable = day.status === 'unpresented' || day.status === 'itinerary_selected' || day.status === 'diy_selected';
    const restartable = day.status === 'completed' || day.status === 'partially_completed' ||
      day.status === 'abandoned' || day.status === 'in_progress';
    if (!reenterable && !(allowRestart && restartable)) return day;
    // Lock once when transitioning into awaiting_choice — the status flip below makes this
    // branch unreachable on subsequent ticks, so the lock is acquired exactly once per gate.
    if (typeof Notify !== 'undefined') Notify.lockItinerary();
    if (restartable) {
      const prev = { templateId: day.templateId || null, status: day.status, startedAt: day.startedAt || null, completedAt: day.completedAt || null, items: day.items || [] };
      return setToday({ status: 'awaiting_choice', previousRuns: (day.previousRuns || []).concat([prev]), startedAt: null, completedAt: null });
    }
    return setToday({ status: 'awaiting_choice' });
  }

  // Snapshots the chosen template's item definitions into today's items[] (Section 12's
  // reference-and-snapshot rule: refId is a pointer, never a copy of the referenced record's own
  // data). Each item starts 'pending' with no actual times yet.
  //
  // Phase 6 / Finding 7: startImmediately (optional) collapses the normal
  // "Choose Template -> Start Itinerary" two-step path into one transition, going straight to
  // 'in_progress' instead of stopping at 'itinerary_selected'. The existing two-step path is
  // unchanged and still available for any caller that omits the flag (e.g. a review screen that
  // still wants the itinerary_selected pause before Start).
  function chooseTemplate(templateId, startImmediately) {
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
    const patch = { status: 'itinerary_selected', templateId: templateId, items: items, diyChosen: false };
    if (startImmediately) {
      patch.status = 'in_progress';
      patch.startedAt = Date.now();
    }
    return setToday(patch);
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

    // Mid-day edit of today's plan (Itinerary Improvement Phase B). Merges builder output into the
  // live items without touching execution records: resolved and active items are kept exactly as
  // they are, Planner-synced items the builder never knew about are kept, and genuinely new
  // items start 'pending'. Never calls chooseTemplate; no other item's time is moved.
  function editTodayItems(newItems) {
    const day = getToday();
    if (day.status !== 'in_progress' && day.status !== 'itinerary_selected') return day;
    if (!Array.isArray(newItems)) return day;
    const liveById = {};
    (day.items || []).forEach(function (it) { liveById[it.itemId] = it; });
    const incomingIds = {};
    const merged = newItems.map(function (def) {
      incomingIds[def.itemId] = true;
      const live = liveById[def.itemId];
      if (live && live.state !== 'pending') return live;
      return Object.assign({}, def, {
        state: 'pending',
        actualStart: null,
        actualEnd: null,
        refId: def.refId || (live && live.refId) || null,
        tagIds: def.tagIds || [],
        syncedFromPlanner: !!(live && live.syncedFromPlanner)
      });
    });
    (day.items || []).forEach(function (it) {
      if (incomingIds[it.itemId]) return;
      if (it.state !== 'pending' || it.syncedFromPlanner) merged.push(it);
    });
    merged.sort(function (a, b) {
      const as = a.plannedStart || '99:99', bs = b.plannedStart || '99:99';
      return as < bs ? -1 : (as > bs ? 1 : 0);
    });
    const patch = { items: merged };
    if (day.status === 'in_progress' && merged.length && itemsAllResolved(merged)) {
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
  
  // ---------- Plan the rest of today (Phase 8, optional catch-up suggestion) ----------
  // Pure, stateless, deterministic: reads today's items and the current clock only, never
  // writes State. Applying a returned suggestion goes through updateItemState() above — the
  // same single write path every other item edit already uses.

  function timeStrToMin(t) {
    if (!t) return null;
    const p = t.split(':');
    return (+p[0]) * 60 + (+p[1]);
  }
  function minToTimeStr(min) {
    min = ((min % 1440) + 1440) % 1440;
    return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  }
  function catchUpItemSpan(it) {
    const s = timeStrToMin(it.plannedStart);
    if (s === null) return null;
    const e = timeStrToMin(it.plannedEnd);
    const dur = (e === null) ? (typeof it.durationMin === 'number' ? it.durationMin : 0) : (e >= s ? e - s : e + 1440 - s);
    return { start: s, dur: dur };
  }

  // Rule set, applied in order: never touch completed/skipped/rescheduled history; never move an
  // already-running item (its footprint is reserved instead); a still-future pending item that
  // doesn't conflict with anything keeps its original time; an overdue pending item, or one that
  // now genuinely conflicts with a reserved/placed block, moves to the next free slot at or after
  // now; an item with no realistic slot left today is left alone rather than forced past midnight.
  function computeCatchUpPlan() {
    const day = getToday();
    if (day.status !== 'in_progress') return { needed: false, reason: 'not-running', changes: [] };
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const items = day.items || [];
    const placed = [];
    const movable = [];

    items.forEach(function (it) {
      if (it.state === 'completed' || it.state === 'skipped' || it.state === 'rescheduled') return;
      const span = catchUpItemSpan(it);
      if (it.state === 'active') {
        const start = span ? span.start : nowMin;
        const end = span ? start + span.dur : nowMin;
        placed.push({ start: Math.min(start, nowMin), end: Math.max(end, nowMin) });
        return;
      }
      if (it.state !== 'pending' || !span) return;
      movable.push({ item: it, origStart: span.start, dur: span.dur });
    });

    if (!movable.length) return { needed: false, reason: 'nothing-to-plan', changes: [] };
    movable.sort(function (a, b) { return a.origStart - b.origStart; });

    function overlaps(aS, aE, bS, bE) { return aS < bE && bS < aE; }
    function fits(start, dur) {
      const end = start + dur;
      for (let i = 0; i < placed.length; i++) { if (overlaps(start, end, placed[i].start, placed[i].end)) return false; }
      return true;
    }
    function nextFreeSlot(earliest, dur) {
      let candidate = earliest, guard = 0;
      while (guard < 200) {
        guard++;
        if (candidate + dur > 1440) return null;
        let blocker = null;
        for (let i = 0; i < placed.length; i++) {
          if (overlaps(candidate, candidate + dur, placed[i].start, placed[i].end)) { blocker = placed[i]; break; }
        }
        if (!blocker) return candidate;
        candidate = blocker.end;
      }
      return null;
    }

    const changes = [];
    movable.forEach(function (m) {
      const overdue = m.origStart < nowMin;
      let start = m.origStart, slot;
      if (overdue) {
        slot = nextFreeSlot(nowMin, m.dur);
        if (slot === null) return;
        start = slot;
      } else if (!fits(start, m.dur)) {
        slot = nextFreeSlot(Math.max(start, nowMin), m.dur);
        if (slot === null) return;
        start = slot;
      }
      placed.push({ start: start, end: start + m.dur });
      if (start !== m.origStart) {
        changes.push({
          itemId: m.item.itemId,
          label: m.item.label,
          originalStart: m.item.plannedStart,
          originalEnd: m.item.plannedEnd,
          newStart: minToTimeStr(start),
          newEnd: (m.item.plannedEnd != null) ? minToTimeStr(start + m.dur) : null
        });
      }
    });

    if (!changes.length) return { needed: false, reason: 'no-changes-needed', changes: [] };
    return { needed: true, changes: changes };
  }

  // Apply = a direct one-time edit per changed item via updateItemState (identical to a manual
  // builder edit) — no shiftMs, no cascade, no second write path. Re-checks live state per item
  // so nothing is touched if it stopped being pending between preview and Apply.
  function applyCatchUpPlan(changes) {
    const day = getToday();
    if (day.status !== 'in_progress') return day;
    (changes || []).forEach(function (c) {
      const live = (day.items || []).find(function (it) { return it.itemId === c.itemId; });
      if (!live || live.state !== 'pending') return;
      const fields = { plannedStart: c.newStart };
      if (c.newEnd != null) fields.plannedEnd = c.newEnd;
      updateItemState(c.itemId, fields);
    });
    return getToday();
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
    const usedTemplateIds = {};
    while (cursor < toDateStr && guard < 3660) {
      if (!summaries[cursor]) {
        const day = (stored && stored.date === cursor) ? stored : defaultDay(cursor);
        const finalized = finalizeDay(day);
        if (finalized.templateId) usedTemplateIds[finalized.templateId] = true;
        (finalized.previousRuns || []).forEach(function (r) { if (r && r.templateId) usedTemplateIds[r.templateId] = true; });
        summaries[cursor] = finalized;
        writeChecklistTagRollup(finalized);
        writeItinerarySummary(finalized);
      }
      cursor = shiftDateStr(cursor, 1);
      guard++;
    }
    State.set({ dailyItinerarySummaries: summaries, dailyItinerary: null });
    // Itinerary Improvement Phase B: drop one-day templates once their day has passed. Only
    // itineraryTemplates is touched; summaries / DateHub history are never modified here.
    if (typeof ItineraryTemplateData !== 'undefined') {
      const removedTemplateIds = [];
      ItineraryTemplateData.getList().forEach(function (t) {
        const s = t.schedule || {};
        const expired = (s.type === 'once' && usedTemplateIds[t.templateId]) ||
          (s.type === 'date' && s.date && s.date < toDateStr);
        if (!expired) return;
        ItineraryTemplateData.remove(t.templateId);
        removedTemplateIds.push(t.templateId);
      });
      if (removedTemplateIds.length) console.log('[itinerary] removed expired one-day templates: ' + removedTemplateIds.join(', '));
    }
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
    editTodayItems: editTodayItems,
    syncPlannerTasks: syncPlannerTasks,
    removeSyncedItem: removeSyncedItem,
    onRolloverFinalize: onRolloverFinalize,
    computeCatchUpPlan: computeCatchUpPlan,
    applyCatchUpPlan: applyCatchUpPlan
  };
})();
