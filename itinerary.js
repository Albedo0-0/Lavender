// itinerary.js — Itinerary Builder UI (Itinerary Phase 5, revised). Depends on: State, Modal,
// ItineraryTemplateData, PlannerData, TargetsData, GamificationData, Nav.
//
// "One editor, two entry points" (Section 16): this builder edits an itineraryTemplates entry's
// items[] + dayStartTime. Right now the only entry point is Alarm's Itineraries tab (its "Items"
// button); a later phase's "Create Itinerary" action from the morning gate reuses this same
// Itinerary.openBuilder(templateId), unmodified.
//
// Side-panel + drag & drop revision: items are added by dragging a tile from a side palette
// into the itinerary list (or by clicking a tile, for keyboard/no-drag accessibility) instead of
// opening a second modal to pick a type. The palette tile itself is never consumed/moved/removed
// by a drag — native HTML5 drag-and-drop only creates a drag *image*, the source element is left
// completely alone, so the tile is always there ready to create another item. A dropped tile
// creates the item in the exact slot it was dropped into and expands that row in place to reveal
// its type-specific fields (e.g. Study exposes subject/topic/duration) directly inside the row —
// no second modal for editing either. Existing itinerary items model, reordering, editing,
// deleting, validation, and persistence are all preserved; this is a UI/interaction change only.
//
// itineraryItemDef (what this module writes into itineraryTemplates[id].items[]):
//   { itemId, type, refId, label, durationMin, plannedStart, plannedEnd,
//     subject, topicName, taskType,   // study items only — the Planner task blueprint (Section 16)
//     destination,                    // nav items only — { kind:'screen', screen } | { kind:'modal', opener } (Section 20)
//     tagIds, checkAt }               // checklist items only — canonical Tags refs + an optional
//                                      // pinned clock time this item surfaces at (see recomputeTimes)
// Editing happens on an in-memory draft only ("no store write per keystroke", Section 16) —
// nothing is persisted until the top-level Save button.
const Itinerary = (function () {
  const ITEM_TYPES = ['study', 'planner-task', 'target', 'break', 'journal', 'water', 'checklist', 'custom', 'nav'];
  const TYPE_LABELS = {
    study: 'Study', 'planner-task': 'Planner Task (existing)', target: 'Target (existing)',
    break: 'Break', journal: 'Journal', water: 'Water', checklist: 'Checklist Entry',
    custom: 'Custom', nav: 'Go To\u2026'
  };
  // Small pictographic hint per palette tile — decorative only, TYPE_LABELS above is the source
  // of truth for the actual label text.
  const PALETTE_ICONS = {
    study: '\ud83d\udcda', 'planner-task': '\ud83d\udcc5', target: '\ud83c\udfaf', break: '\u2615',
    journal: '\ud83d\udcd6', water: '\ud83d\udca7', checklist: '\u2611\ufe0f', custom: '\u2728', nav: '\ud83e\udded'
  };
  const DEFAULT_DURATION = { study: 30, 'planner-task': 30, target: 10, break: 10, journal: 15, water: 5, checklist: 5, custom: 15, nav: 5 };
  const DEFAULT_DAY_START = '07:00';
  // MIME type used to mark a drag originating from a palette tile (a new item), distinct from a
  // plain text/plain payload used when dragging an existing row to reorder it — this is how the
  // single list drop handler tells "create new" apart from "reorder existing" (Section 16).
  const NEW_ITEM_MIME = 'application/x-itinerary-new-type';

  // §20 fixed allow-list — the 6 Nav.switchTo screens plus the modal-opening entry points
  // already in index.html/module init()s. Built here (Phase 5) per Section 20; invocation
  // (invokeDestination below) is exercised by the Phase 7 orchestrator, not called by anything
  // yet in this phase. Tags' own opener (Tags.openManagerForTopic) is NOT included — checked
  // tags.js directly and it takes a required topicId, so it has no parameterless "go to" form
  // the way Section 20 assumes; including it would need a topic picker of its own, out of scope here.
  const NAV_DESTINATIONS = [
    { key: 'screen:calendar', label: 'Calendar', kind: 'screen', screen: 'calendar' },
    { key: 'screen:journal', label: 'Journal screen', kind: 'screen', screen: 'journal' },
    { key: 'screen:library', label: 'Library', kind: 'screen', screen: 'library' },
    { key: 'screen:study', label: 'Study', kind: 'screen', screen: 'study' },
    { key: 'screen:progress', label: 'Progress', kind: 'screen', screen: 'progress' },
    { key: 'screen:myworld', label: 'My World', kind: 'screen', screen: 'myworld' },
    { key: 'modal:assistant', label: 'Assistant', kind: 'modal', opener: 'assistant' },
    { key: 'modal:water', label: 'Water log', kind: 'modal', opener: 'water' },
    { key: 'modal:notepad', label: 'Notepad', kind: 'modal', opener: 'notepad' },
    { key: 'modal:settings', label: 'Settings', kind: 'modal', opener: 'settings' },
    { key: 'modal:alarms', label: 'Alarms', kind: 'modal', opener: 'alarms' },
    { key: 'modal:targets', label: 'Targets', kind: 'modal', opener: 'targets' }
  ];
  const NAV_OPENERS = {
    assistant: function () { if (typeof Assistant !== 'undefined') Assistant.openMain(); },
    water: function () { if (typeof Water !== 'undefined') Water.openPicker(); },
    notepad: function () { if (typeof Notepad !== 'undefined') Notepad.open(); },
    settings: function () { if (typeof Settings !== 'undefined') Settings.open(); },
    alarms: function () { if (typeof Alarm !== 'undefined') Alarm.openList(); },
    targets: function () { if (typeof Targets !== 'undefined') Targets.open(); }
  };
  // Invokes a nav-type item's destination directly — no new routing table (Section 20/23 of the
  // original brief). Not called anywhere in Phase 5; kept here so Phase 7 doesn't have to
  // re-derive the allow-list.
  function invokeDestination(destination) {
    if (!destination) return;
    if (destination.kind === 'screen' && typeof Nav !== 'undefined') { Nav.switchTo(destination.screen); return; }
    if (destination.kind === 'modal' && NAV_OPENERS[destination.opener]) NAV_OPENERS[destination.opener]();
  }

  function genId() { return 'itm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&\"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '\"': '&quot;' }[c]; }); }

  // ---------- time helpers ----------

  function timeStrToMinutes(hhmm) {
    const parts = (hhmm || DEFAULT_DAY_START).split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }
  function minutesToTimeStr(totalMin) {
    const m = ((totalMin % 1440) + 1440) % 1440; // wrap a day that runs past midnight
    const h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function formatDuration(min) {
    min = Math.round(min || 0);
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  // Recomputes plannedStart/plannedEnd for every draft item, sequentially, from dayStartTime.
  // Re-run on every add/remove/edit/resize/reorder per Section 16 — in-memory only.
  function recomputeTimes(items, dayStartTime) {
    let cursor = timeStrToMinutes(dayStartTime);
    return items.map(function (it) {
      // A checklist item with an explicit "Check At" time is pinned to that clock time instead
      // of the running cursor — it surfaces at the assigned time of day, not at whatever slot
      // sequential placement would otherwise give it. The cursor still advances past it (to that
      // pinned start + its own duration) so later items keep flowing sequentially from there.
      const pinned = it.type === 'checklist' && it.checkAt;
      const start = pinned ? timeStrToMinutes(it.checkAt) : cursor;
      const end = start + (Number(it.durationMin) || 0);
      cursor = end;
      return Object.assign({}, it, { plannedStart: minutesToTimeStr(start), plannedEnd: minutesToTimeStr(end) });
    });
  }

  // ---------- live counters (§16 — exact format: "12 tasks \u00B7 4h 30m study \u00B7 45m breaks \u00B7 5h 15m total \u00B7 +820 EXP") ----------

  // Expected-EXP per item, using the *actual* per-action EXP values (GamificationData.
  // taskExpValue/targetExpValue) as a read-only estimate — never writes to expLedger (§30).
  // Study/planner-task items become real Planner tasks at execution time (§17) and are paid via
  // awardTaskCompleted -> taskExpValue, a flat per-task amount unrelated to duration — so the
  // estimate uses that, not the separate stopwatch-style studyExpValue(ms) formula. A brand-new
  // study item (not yet an existing task) is estimated as a plain non-R6 task (100 EXP) since R6
  // only applies to a specific occurrence of a revision cycle, unknowable at build time.
  function expectedExpForItem(it) {
    if (typeof GamificationData === 'undefined') return 0;
    if (it.type === 'study') return GamificationData.taskExpValue({ taskType: it.taskType, revisionNumber: null });
    if (it.type === 'planner-task') {
      const task = (typeof PlannerData !== 'undefined' && it.refId) ? PlannerData.getTask(it.refId) : null;
      return task ? GamificationData.taskExpValue(task) : 0;
    }
    if (it.type === 'target') {
      const target = (typeof TargetsData !== 'undefined' && it.refId) ? TargetsData.getTarget(it.refId) : null;
      return target ? GamificationData.targetExpValue(target) : 0;
    }
    return 0; // break/journal/water/checklist/custom/nav have no EXP mechanic of their own
  }

  function computeCounters(items) {
    let studyMin = 0, breakMin = 0, totalMin = 0, exp = 0;
    items.forEach(function (it) {
      const d = Number(it.durationMin) || 0;
      totalMin += d;
      if (it.type === 'study' || it.type === 'planner-task') studyMin += d;
      if (it.type === 'break') breakMin += d;
      exp += expectedExpForItem(it);
    });
    return { count: items.length, studyMin: studyMin, breakMin: breakMin, totalMin: totalMin, exp: exp };
  }

  function countersHtml(items) {
    const c = computeCounters(items);
    return '<div class="itinerary-counters chip">' +
      c.count + ' tasks \u00B7 ' + formatDuration(c.studyMin) + ' study \u00B7 ' +
      formatDuration(c.breakMin) + ' breaks \u00B7 ' + formatDuration(c.totalMin) + ' total \u00B7 +' + c.exp + ' EXP' +
      '</div>';
  }

  // ---------- draft state (in-memory only while the builder modal is open) ----------

  let editingTemplateId = null;
  let draftItems = [];
  let draftDayStartTime = DEFAULT_DAY_START;
  // Which item's row is currently expanded in place (showing its type-specific fields), or null
  // if every row is collapsed. Only one row expands at a time — keeps the inline-form wiring
  // simple and mirrors the old modal's "one form open at a time" behavior.
  let expandedItemId = null;
  // Where Save/Cancel return to — "one editor, two entry points" (Section 16): Alarm's
  // Itineraries tab passes its own list re-render; the Phase 6 morning gate passes its own
  // re-render instead, so "Create Itinerary" from the gate comes back to the gate, not to Alarm.
  let editingReturnFn = null;
  function returnFromBuilder() {
    if (typeof editingReturnFn === 'function') { editingReturnFn(); return; }
    if (typeof Alarm !== 'undefined') Alarm.openItineraryList();
  }

  // ---------- new-item defaults (used by both palette drag-drop and palette click) ----------

  function createDefaultItem(type) {
    const item = {
      itemId: genId(), type: type, refId: null,
      label: TYPE_LABELS[type] || type,
      durationMin: DEFAULT_DURATION[type] || 15,
      plannedStart: null, plannedEnd: null
    };
    if (type === 'study') {
      item.subject = (typeof PlannerData !== 'undefined' && PlannerData.SUBJECTS[0]) || '';
      item.topicName = '';
      item.taskType = 'theory';
      item.label = item.subject + ' \u00b7 (choose topic)';
    } else if (type === 'planner-task') {
      const tasks = (typeof PlannerData !== 'undefined') ? PlannerData.getTodayTasks().concat(PlannerData.getUpcomingTasks()) : [];
      if (tasks[0]) {
        item.refId = tasks[0].taskId;
        item.label = tasks[0].subject ? (tasks[0].subject + ' \u00b7 ' + tasks[0].topicName + ' \u00b7 ' + PlannerData.taskLabel(tasks[0])) : PlannerData.taskLabel(tasks[0]);
      } else {
        item.label = 'No scheduled tasks';
      }
    } else if (type === 'target') {
      const targets = (typeof TargetsData !== 'undefined') ? TargetsData.getAllTargetsList().filter(function (t) { return !t.archived; }) : [];
      if (targets[0]) { item.refId = targets[0].targetId; item.label = targets[0].title; }
      else item.label = 'No targets';
    } else if (type === 'nav') {
      const dest = NAV_DESTINATIONS[0];
      item.destination = (dest.kind === 'screen') ? { kind: 'screen', screen: dest.screen } : { kind: 'modal', opener: dest.opener };
      item.label = dest.label;
    } else if (type === 'checklist' || type === 'custom') {
      item.label = '';
      if (type === 'checklist') { item.tagIds = []; item.checkAt = null; }
    }
    return item;
  }

  function updateItemField(itemId, patch) {
    draftItems = draftItems.map(function (it) { return it.itemId === itemId ? Object.assign({}, it, patch) : it; });
  }

  // ---------- validation (run once, at Save Itinerary time — Section 16 "preserve validation") ----------

  function validateDraftItems(items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type === 'study' && !it.topicName) return 'Give every Study item a topic.';
      if (it.type === 'planner-task' && !it.refId) return 'Pick an existing task for every Planner Task item.';
      if (it.type === 'target' && !it.refId) return 'Pick an existing target for every Target item.';
      if ((it.type === 'checklist' || it.type === 'custom') && !it.label) return 'Give every ' + TYPE_LABELS[it.type] + ' item a label.';
      if (it.type === 'nav' && !it.destination) return 'Pick a destination for every Go To\u2026 item.';
    }
    return null;
  }

  // ---------- inline (in-row) field forms, replacing the old separate add/edit modal ----------

  function topicDatalistHtml(subject) {
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[subject] || [];
    return topics.map(function (t) { return '<option value="' + esc(t.topicName) + '">'; }).join('');
  }

  function plannerTaskOptionsHtml(selectedTaskId) {
    const tasks = PlannerData.getTodayTasks().concat(PlannerData.getUpcomingTasks());
    if (!tasks.length) return '<option value="">No scheduled tasks found</option>';
    return tasks.map(function (t) {
      const label = t.subject ? (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t)) : PlannerData.taskLabel(t);
      return '<option value="' + t.taskId + '"' + (t.taskId === selectedTaskId ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function targetOptionsHtml(selectedTargetId) {
    const targets = TargetsData.getAllTargetsList().filter(function (t) { return !t.archived; });
    if (!targets.length) return '<option value="">No targets found</option>';
    return targets.map(function (t) {
      return '<option value="' + t.targetId + '"' + (t.targetId === selectedTargetId ? ' selected' : '') + '>' + esc(t.title) + ' (' + t.timeframe + ')</option>';
    }).join('');
  }

  function navOptionsHtml(selectedKey) {
    return NAV_DESTINATIONS.map(function (d) {
      return '<option value="' + d.key + '"' + (d.key === selectedKey ? ' selected' : '') + '>' + esc(d.label) + '</option>';
    }).join('');
  }

  // Recovers a nav item's destination back into its allow-list key when re-editing.
  function navKeyForDestination(destination) {
    if (!destination) return '';
    const match = NAV_DESTINATIONS.find(function (d) {
      return d.kind === destination.kind && (d.kind === 'screen' ? d.screen === destination.screen : d.opener === destination.opener);
    });
    return match ? match.key : '';
  }

  // Builds the type-specific fields for one item's expanded row, in place. Field ids are
  // data-id-scoped (not fixed element ids) since more than one row could theoretically render
  // its markup in the same pass — even though only one is ever expanded at a time.
  function itemFormFieldsInlineHtml(it) {
    const type = it.type;
    if (type === 'study') {
      const subject = it.subject || PlannerData.SUBJECTS[0];
      const taskType = it.taskType || 'theory';
      return '<label>Subject<br><select class="input itinerary-field-subject" data-id="' + it.itemId + '">' +
          PlannerData.SUBJECTS.map(function (s) { return '<option value="' + s + '"' + (s === subject ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></label>' +
        '<label>Topic<br><input type="text" class="input itinerary-field-topic" data-id="' + it.itemId + '" list="itinerary-item-topic-options-' + it.itemId + '" value="' + esc(it.topicName || '') + '"></label>' +
        '<datalist id="itinerary-item-topic-options-' + it.itemId + '">' + topicDatalistHtml(subject) + '</datalist>' +
        '<div class="chip-row itinerary-field-tasktype-row">' +
          ['revision', 'theory', 'questions'].map(function (t) {
            return '<label class="chip"><input type="radio" name="itinerary-field-tasktype-' + it.itemId + '" class="itinerary-field-tasktype" data-id="' + it.itemId + '" value="' + t + '"' + (t === taskType ? ' checked' : '') + '> ' + (t === 'revision' ? 'Revision' : t === 'theory' ? 'Theory' : 'Qs') + '</label>';
          }).join('') +
        '</div>';
    }
    if (type === 'planner-task') {
      return '<label>Existing task<br><select class="input itinerary-field-task" data-id="' + it.itemId + '">' + plannerTaskOptionsHtml(it.refId) + '</select></label>';
    }
    if (type === 'target') {
      return '<label>Existing target<br><select class="input itinerary-field-target" data-id="' + it.itemId + '">' + targetOptionsHtml(it.refId) + '</select></label>';
    }
    if (type === 'nav') {
      const selectedKey = navKeyForDestination(it.destination);
      return '<label>Go to<br><select class="input itinerary-field-nav" data-id="' + it.itemId + '">' + navOptionsHtml(selectedKey) + '</select></label>';
    }
    if (type === 'checklist' || type === 'custom') {
      const labelField = '<label>Label<br><input type="text" class="input itinerary-field-label" data-id="' + it.itemId + '" value="' + esc(it.label || '') + '"></label>';
      if (type !== 'checklist') return labelField;
      const checkAtField = '<label>Check at (optional)<br><input type="time" class="input itinerary-field-checkat" data-id="' + it.itemId + '" value="' + esc(it.checkAt || '') + '"></label>';
      const allTags = (typeof TagsData !== 'undefined') ? TagsData.getAllTagsList() : [];
      const tagIds = it.tagIds || [];
      const tagsField = '<div class="itinerary-field-tags"><span class="micro-label">Tags</span>' +
        '<div class="chip-row itinerary-field-tags-row" data-id="' + it.itemId + '">' +
          (allTags.length ? allTags.map(function (tag) {
            const on = tagIds.indexOf(tag.tagId) !== -1;
            return '<button type="button" class="tag-chip chip itinerary-field-tag-toggle' + (on ? ' tag-chip-active' : '') + '" data-id="' + it.itemId + '" data-tag-id="' + tag.tagId + '" style="border-color:' + tag.color + ';background:' + (on ? tag.color : 'transparent') + '">' + esc(tag.name) + '</button>';
          }).join('') : '<span class="planner-empty empty-state">No tags yet \u2014 add some in Library.</span>') +
        '</div></div>';
      return labelField + checkAtField + tagsField;
    }
    return ''; // break/journal/water — no extra fields, just duration below
  }

  function wireExpandedFields() {
    document.querySelectorAll('.itinerary-field-tag-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.id;
        const tagId = btn.dataset.tagId;
        const it = draftItems.find(function (x) { return x.itemId === id; });
        const current = (it && it.tagIds) || [];
        const next = current.indexOf(tagId) !== -1
          ? current.filter(function (t) { return t !== tagId; })
          : current.concat([tagId]);
        updateItemField(id, { tagIds: next });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-topic').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const id = inp.dataset.id;
        const it = draftItems.find(function (x) { return x.itemId === id; });
        const subject = (it && it.subject) || PlannerData.SUBJECTS[0];
        const topicName = inp.value.trim();
        updateItemField(id, { topicName: topicName, label: subject + ' \u00b7 ' + (topicName || '(choose topic)') });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-tasktype').forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        updateItemField(r.dataset.id, { taskType: r.value });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-task').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const task = PlannerData.getTask(sel.value);
        if (!task) return;
        const label = task.subject ? (task.subject + ' \u00b7 ' + task.topicName + ' \u00b7 ' + PlannerData.taskLabel(task)) : PlannerData.taskLabel(task);
        updateItemField(sel.dataset.id, { refId: sel.value, label: label });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-target').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const target = TargetsData.getTarget(sel.value);
        if (!target) return;
        updateItemField(sel.dataset.id, { refId: sel.value, label: target.title });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-nav').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const dest = NAV_DESTINATIONS.find(function (d) { return d.key === sel.value; });
        if (!dest) return;
        updateItemField(sel.dataset.id, {
          destination: (dest.kind === 'screen') ? { kind: 'screen', screen: dest.screen } : { kind: 'modal', opener: dest.opener },
          label: dest.label
        });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-checkat').forEach(function (inp) {
      inp.addEventListener('change', function () {
        updateItemField(inp.dataset.id, { checkAt: inp.value || null });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-field-label').forEach(function (inp) {
      inp.addEventListener('change', function () {
        updateItemField(inp.dataset.id, { label: inp.value.trim() });
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-item-duration-input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        updateItemField(inp.dataset.id, { durationMin: Math.max(5, Number(inp.value) || 5) });
        renderBuilder();
      });
    });
  }

  // ---------- main builder view ----------

  function itemRowHtml(it, index) {
    const expanded = it.itemId === expandedItemId;
    const timeRange = (it.plannedStart || '') + '\u2013' + (it.plannedEnd || '');
    const header =
      '<span class="itinerary-item-drag-handle" title="Drag to reorder">\u283F</span> ' +
      '<span class="itinerary-item-time chip">' + timeRange + '</span> ' +
      '<span class="itinerary-item-type chip">' + (TYPE_LABELS[it.type] || it.type) + '</span> ' +
      '<span class="itinerary-item-label">' + esc(it.label || '(untitled)') + '</span> ' +
      '<span class="itinerary-item-duration">' + formatDuration(it.durationMin) + '</span> ' +
      '<button class="itinerary-item-toggle-btn btn btn-secondary" data-id="' + it.itemId + '">' + (expanded ? 'Done' : 'Edit') + '</button>' +
      '<button class="itinerary-item-remove-btn btn btn-danger" data-id="' + it.itemId + '">Remove</button>';
    const body = expanded
      ? '<div class="itinerary-item-expanded-fields">' +
          itemFormFieldsInlineHtml(it) +
          '<label>Duration (minutes)<br><input type="number" class="input itinerary-item-duration-input" data-id="' + it.itemId + '" min="5" step="5" value="' + (Number(it.durationMin) || 0) + '"></label>' +
        '</div>'
      : '';
    return '<div class="itinerary-item-row list-row' + (expanded ? ' itinerary-item-row-expanded' : '') + '" draggable="' + (expanded ? 'false' : 'true') + '" data-index="' + index + '" data-id="' + it.itemId + '">' +
      '<div class="itinerary-item-row-header">' + header + '</div>' + body +
    '</div>';
  }

  function paletteHtml() {
    return '<div class="itinerary-palette" id="itinerary-palette">' +
      '<div class="itinerary-palette-heading micro-label">Item Types</div>' +
      ITEM_TYPES.map(function (t) {
        return '<div class="itinerary-palette-tile" draggable="true" data-type="' + t + '" title="Drag into the itinerary, or click to add">' +
          '<span class="itinerary-palette-tile-icon" aria-hidden="true">' + (PALETTE_ICONS[t] || '\u2022') + '</span>' +
          '<span class="itinerary-palette-tile-label">' + TYPE_LABELS[t] + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function builderHtml() {
    draftItems = recomputeTimes(draftItems, draftDayStartTime);
    const rows = draftItems.length ? draftItems.map(itemRowHtml).join('') : '<p class="empty-state">Drag a tile from the palette to add your first item.</p>';
    return '<h3 class="section-heading">Itinerary Builder</h3>' +
      '<div class="itinerary-builder-layout">' +
        paletteHtml() +
        '<div class="itinerary-builder-main">' +
          '<label>Day starts at<br><input type="time" id="itinerary-daystart-input" class="input" value="' + draftDayStartTime + '"></label><br><br>' +
          countersHtml(draftItems) + '<br><br>' +
          '<div class="itinerary-list-panel" id="itinerary-items-list">' + rows + '</div>' +
        '</div>' +
      '</div><br>' +
      '<div id="itinerary-builder-error" class="form-error"></div>' +
      '<button id="itinerary-builder-save-btn" class="btn btn-primary">Save Itinerary</button> ' +
      '<button id="itinerary-builder-cancel-btn" class="btn btn-secondary">Cancel</button>';
  }

  // Finds which draftItems index a drop at this Y-coordinate should insert at, by comparing
  // against each existing row's vertical midpoint. Used for both a new-tile drop and a
  // reordering drop, so both land exactly where the user visually dropped.
  function computeDropIndex(list, clientY) {
    const rows = Array.prototype.slice.call(list.querySelectorAll('.itinerary-item-row'));
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return Number(rows[i].dataset.index);
    }
    return draftItems.length;
  }

  function wirePalette() {
    document.querySelectorAll('.itinerary-palette-tile').forEach(function (tile) {
      // Native HTML5 drag-and-drop only ever drags a *ghost image* of the source element — the
      // tile itself is never removed, moved, or altered by this, so it's always here ready to
      // create the next item (the "must never disappear" requirement holds by construction).
      tile.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData(NEW_ITEM_MIME, tile.dataset.type);
        e.dataTransfer.setData('text/plain', ''); // Firefox requires text/plain to be set for drag to start
        e.dataTransfer.effectAllowed = 'copy';
        tile.classList.add('itinerary-palette-tile-dragging');
      });
      tile.addEventListener('dragend', function () { tile.classList.remove('itinerary-palette-tile-dragging'); });
      // Click-to-add: same outcome as a drop at the end of the list, for anyone who can't or
      // doesn't want to drag (keyboard users, touch devices without long-press DnD support).
      tile.addEventListener('click', function () {
        const item = createDefaultItem(tile.dataset.type);
        draftItems = draftItems.concat([item]);
        expandedItemId = item.itemId;
        renderBuilder();
      });
    });
  }

  function wireListDrop() {
    const list = document.getElementById('itinerary-items-list');
    if (!list) return;
    list.addEventListener('dragover', function (e) {
      e.preventDefault();
      const isNewTile = Array.prototype.indexOf.call(e.dataTransfer.types, NEW_ITEM_MIME) >= 0;
      e.dataTransfer.dropEffect = isNewTile ? 'copy' : 'move';
      list.classList.add('itinerary-list-dragover');
    });
    list.addEventListener('dragleave', function (e) {
      if (e.target === list) list.classList.remove('itinerary-list-dragover');
    });
    list.addEventListener('drop', function (e) {
      e.preventDefault();
      list.classList.remove('itinerary-list-dragover');
      const dropIndex = computeDropIndex(list, e.clientY);
      const newType = e.dataTransfer.getData(NEW_ITEM_MIME);
      if (newType) {
        // Dropping a palette tile creates the corresponding item in the exact slot dropped,
        // and expands it in place so its fields are immediately visible/editable.
        const item = createDefaultItem(newType);
        draftItems.splice(dropIndex, 0, item);
        expandedItemId = item.itemId;
        renderBuilder();
        return;
      }
      const reorderIndexRaw = e.dataTransfer.getData('text/plain');
      if (reorderIndexRaw !== '') {
        const dragIndex = Number(reorderIndexRaw);
        if (!isNaN(dragIndex) && draftItems[dragIndex] !== undefined) {
          let insertAt = dropIndex;
          if (dragIndex < insertAt) insertAt -= 1; // account for the removal shifting later indices
          if (insertAt !== dragIndex) {
            const moved = draftItems.splice(dragIndex, 1)[0];
            draftItems.splice(insertAt, 0, moved);
            renderBuilder();
          }
        }
      }
    });
  }

  function wireRowReorderDrag() {
    document.querySelectorAll('.itinerary-item-row').forEach(function (row) {
      row.addEventListener('dragstart', function (e) {
        if (row.getAttribute('draggable') !== 'true') return;
        e.dataTransfer.setData('text/plain', row.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
      });
    });
  }

  function renderBuilder() {
    Modal.open(builderHtml(), { size: 'lg' });

    // Update in place — re-rendering the modal on every change destroyed the input mid-edit,
    // so the time could never be typed/picked. Timing still flows through recomputeTimes().
    const dayStartInput = document.getElementById('itinerary-daystart-input');
    function applyDayStart() {
      if (!dayStartInput.value) return; // partially typed — keep the last valid start time
      draftDayStartTime = dayStartInput.value;
      draftItems = recomputeTimes(draftItems, draftDayStartTime);
      document.querySelectorAll('#itinerary-items-list .itinerary-item-row').forEach(function (row) {
        const it = draftItems.filter(function (x) { return x.itemId === row.dataset.id; })[0];
        const chip = row.querySelector('.itinerary-item-time');
        if (it && chip) chip.textContent = (it.plannedStart || '') + '\u2013' + (it.plannedEnd || '');
      });
    }
    dayStartInput.addEventListener('input', applyDayStart);
    dayStartInput.addEventListener('change', applyDayStart);
    dayStartInput.addEventListener('blur', function () {
      if (!dayStartInput.value) dayStartInput.value = draftDayStartTime;
    });

    wirePalette();
    wireListDrop();
    wireRowReorderDrag();

    document.querySelectorAll('.itinerary-item-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.id;
        expandedItemId = (expandedItemId === id) ? null : id;
        renderBuilder();
      });
    });
    document.querySelectorAll('.itinerary-item-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (expandedItemId === btn.dataset.id) expandedItemId = null;
        draftItems = draftItems.filter(function (it) { return it.itemId !== btn.dataset.id; });
        renderBuilder();
      });
    });

    wireExpandedFields();

    document.getElementById('itinerary-builder-cancel-btn').addEventListener('click', returnFromBuilder);
    document.getElementById('itinerary-builder-save-btn').addEventListener('click', function () {
      const validationError = validateDraftItems(draftItems);
      if (validationError) {
        document.getElementById('itinerary-builder-error').textContent = validationError;
        return;
      }
      const result = ItineraryTemplateData.update(editingTemplateId, { items: draftItems, dayStartTime: draftDayStartTime });
      if (!result) {
        document.getElementById('itinerary-builder-error').textContent =
          (typeof ItineraryTemplateData.getLastError === 'function' && ItineraryTemplateData.getLastError()) || 'Could not save.';
        return;
      }
      returnFromBuilder();
    });
  }

  // returnFn: optional callback invoked instead of Alarm.openItineraryList() on Save/Cancel —
  // lets a caller other than Alarm's own list (e.g. the Phase 6 morning gate's "Create
  // Itinerary" action) reopen itself once the builder is done, with no page reload.
  function openBuilder(templateId, returnFn) {
    const template = ItineraryTemplateData.getById(templateId);
    if (!template) return;
    editingTemplateId = templateId;
    editingReturnFn = (typeof returnFn === 'function') ? returnFn : null;
    draftItems = (template.items || []).map(function (it) { return Object.assign({}, it); });
    draftDayStartTime = template.dayStartTime || DEFAULT_DAY_START;
    expandedItemId = null;
    renderBuilder();
  }

  return { openBuilder: openBuilder, invokeDestination: invokeDestination };
})();
