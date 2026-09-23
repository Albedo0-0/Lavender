// itinerary.js — Itinerary Builder UI (Itinerary Phase 5). Depends on: State, Modal,
// ItineraryTemplateData, PlannerData, TargetsData, GamificationData, Nav.
//
// "One editor, two entry points" (Section 16): this builder edits an itineraryTemplates entry's
// items[] + dayStartTime. Right now the only entry point is Alarm's Itineraries tab (its "Items"
// button); a later phase's "Create Itinerary" action from the morning gate reuses this same
// Itinerary.openBuilder(templateId), unmodified.
//
// itineraryItemDef (what this module writes into itineraryTemplates[id].items[]):
//   { itemId, type, refId, label, durationMin, plannedStart, plannedEnd,
//     subject, topicName, taskType,   // study items only — the Planner task blueprint (Section 16)
//     destination }                   // nav items only — { kind:'screen', screen } | { kind:'modal', opener } (Section 20)
// Editing happens on an in-memory draft only ("no store write per keystroke", Section 16) —
// nothing is persisted until the top-level Save button.
const Itinerary = (function () {
  const ITEM_TYPES = ['study', 'planner-task', 'target', 'break', 'journal', 'water', 'checklist', 'custom', 'nav'];
  const TYPE_LABELS = {
    study: 'Study', 'planner-task': 'Planner Task (existing)', target: 'Target (existing)',
    break: 'Break', journal: 'Journal', water: 'Water', checklist: 'Checklist Entry',
    custom: 'Custom', nav: 'Go To\u2026'
  };
  const DEFAULT_DURATION = { study: 30, 'planner-task': 30, target: 10, break: 10, journal: 15, water: 5, checklist: 5, custom: 15, nav: 5 };
  const DEFAULT_DAY_START = '07:00';

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

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

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
      const start = cursor;
      const end = cursor + (Number(it.durationMin) || 0);
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
  let editingItemId = null; // item being edited in the add/edit sub-view, or null for "adding new"

  // ---------- main builder view ----------

  function itemRowHtml(it, index) {
    const timeRange = (it.plannedStart || '') + '\u2013' + (it.plannedEnd || '');
    return '<div class="itinerary-item-row list-row" draggable="true" data-index="' + index + '">' +
      '<span class="itinerary-item-drag-handle" title="Drag to reorder">\u283F</span> ' +
      '<span class="itinerary-item-time chip">' + timeRange + '</span> ' +
      '<span class="itinerary-item-type chip">' + (TYPE_LABELS[it.type] || it.type) + '</span> ' +
      '<span class="itinerary-item-label">' + esc(it.label) + '</span> ' +
      '<span class="itinerary-item-duration">' + formatDuration(it.durationMin) + '</span> ' +
      '<button class="itinerary-item-edit-btn btn btn-secondary" data-id="' + it.itemId + '">Edit</button>' +
      '<button class="itinerary-item-remove-btn btn btn-danger" data-id="' + it.itemId + '">Remove</button>' +
    '</div>';
  }

  function builderHtml() {
    draftItems = recomputeTimes(draftItems, draftDayStartTime);
    const rows = draftItems.length ? draftItems.map(itemRowHtml).join('') : '<p class="empty-state">No items yet.</p>';
    return '<h3 class="section-heading">Itinerary Builder</h3>' +
      '<label>Day starts at<br><input type="time" id="itinerary-daystart-input" class="input" value="' + draftDayStartTime + '"></label><br><br>' +
      countersHtml(draftItems) + '<br><br>' +
      '<div id="itinerary-items-list">' + rows + '</div>' +
      '<button id="itinerary-add-item-btn" class="btn btn-primary">+ Add Item</button><br><br>' +
      '<div id="itinerary-builder-error" class="form-error"></div>' +
      '<button id="itinerary-builder-save-btn" class="btn btn-primary">Save Itinerary</button> ' +
      '<button id="itinerary-builder-cancel-btn" class="btn btn-secondary">Cancel</button>';
  }

  function wireDragReorder() {
    const list = document.getElementById('itinerary-items-list');
    if (!list) return;
    let dragIndex = null;
    list.querySelectorAll('.itinerary-item-row').forEach(function (row) {
      row.addEventListener('dragstart', function (e) {
        dragIndex = Number(row.dataset.index);
        e.dataTransfer.setData('text/plain', String(dragIndex));
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        const dropIndex = Number(row.dataset.index);
        if (dragIndex === null || dropIndex === dragIndex) return;
        const moved = draftItems.splice(dragIndex, 1)[0];
        draftItems.splice(dropIndex, 0, moved);
        dragIndex = null;
        renderBuilder();
      });
    });
  }

  function renderBuilder() {
    Modal.open(builderHtml());

    document.getElementById('itinerary-daystart-input').addEventListener('change', function (e) {
      draftDayStartTime = e.target.value || DEFAULT_DAY_START;
      renderBuilder();
    });
    document.getElementById('itinerary-add-item-btn').addEventListener('click', function () { openTypePicker(); });
    document.querySelectorAll('.itinerary-item-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openItemForm(btn.dataset.id, null); });
    });
    document.querySelectorAll('.itinerary-item-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        draftItems = draftItems.filter(function (it) { return it.itemId !== btn.dataset.id; });
        renderBuilder();
      });
    });
    document.getElementById('itinerary-builder-cancel-btn').addEventListener('click', function () {
      if (typeof Alarm !== 'undefined') Alarm.openItineraryList();
    });
    document.getElementById('itinerary-builder-save-btn').addEventListener('click', function () {
      const result = ItineraryTemplateData.update(editingTemplateId, { items: draftItems, dayStartTime: draftDayStartTime });
      if (!result) {
        document.getElementById('itinerary-builder-error').textContent =
          (typeof ItineraryTemplateData.getLastError === 'function' && ItineraryTemplateData.getLastError()) || 'Could not save.';
        return;
      }
      if (typeof Alarm !== 'undefined') Alarm.openItineraryList();
    });

    wireDragReorder();
  }

  function openBuilder(templateId) {
    const template = ItineraryTemplateData.getById(templateId);
    if (!template) return;
    editingTemplateId = templateId;
    draftItems = (template.items || []).map(function (it) { return Object.assign({}, it); });
    draftDayStartTime = template.dayStartTime || DEFAULT_DAY_START;
    renderBuilder();
  }

  // ---------- add/edit item type picker + type-specific form ----------

  function openTypePicker() {
    editingItemId = null;
    const options = ITEM_TYPES.map(function (t) {
      return '<button class="itinerary-type-pick-btn btn btn-secondary" data-type="' + t + '">' + TYPE_LABELS[t] + '</button>';
    }).join(' ');
    Modal.open('<h3 class="section-heading">Add Item</h3><div class="chip-row">' + options + '</div><br>' +
      '<button id="itinerary-type-pick-cancel-btn" class="btn btn-secondary">Cancel</button>');
    document.querySelectorAll('.itinerary-type-pick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openItemForm(null, btn.dataset.type); });
    });
    document.getElementById('itinerary-type-pick-cancel-btn').addEventListener('click', renderBuilder);
  }

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

  function itemFormFieldsHtml(type, existing) {
    if (type === 'study') {
      const subject = existing ? existing.subject : PlannerData.SUBJECTS[0];
      const taskType = existing ? existing.taskType : 'theory';
      return '<label>Subject<br><select id="itinerary-item-subject" class="input">' +
          PlannerData.SUBJECTS.map(function (s) { return '<option value="' + s + '"' + (s === subject ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></label><br><br>' +
        '<label>Topic<br><input type="text" id="itinerary-item-topic" class="input" list="itinerary-item-topic-options" value="' + esc(existing ? existing.topicName : '') + '"></label>' +
        '<datalist id="itinerary-item-topic-options">' + topicDatalistHtml(subject) + '</datalist><br><br>' +
        '<div class="chip-row">' +
          ['revision', 'theory', 'questions'].map(function (t) {
            return '<label class="chip"><input type="radio" name="itinerary-item-tasktype" value="' + t + '"' + (t === taskType ? ' checked' : '') + '> ' + (t === 'revision' ? 'Revision' : t === 'theory' ? 'Theory' : 'Qs') + '</label>';
          }).join('') +
        '</div><br>';
    }
    if (type === 'planner-task') {
      return '<label>Existing task<br><select id="itinerary-item-task" class="input">' + plannerTaskOptionsHtml(existing ? existing.refId : null) + '</select></label><br><br>';
    }
    if (type === 'target') {
      return '<label>Existing target<br><select id="itinerary-item-target" class="input">' + targetOptionsHtml(existing ? existing.refId : null) + '</select></label><br><br>';
    }
    if (type === 'nav') {
      const selectedKey = existing ? navKeyForDestination(existing.destination) : '';
      return '<label>Go to<br><select id="itinerary-item-nav" class="input">' + navOptionsHtml(selectedKey) + '</select></label><br><br>';
    }
    if (type === 'checklist' || type === 'custom') {
      return '<label>Label<br><input type="text" id="itinerary-item-label" class="input" value="' + esc(existing ? existing.label : '') + '"></label><br><br>';
    }
    return ''; // break/journal/water — no extra fields, just duration below
  }

  function openItemForm(itemId, forcedType) {
    editingItemId = itemId;
    const existing = itemId ? draftItems.find(function (it) { return it.itemId === itemId; }) : null;
    const type = forcedType || (existing ? existing.type : ITEM_TYPES[0]);
    const duration = existing ? existing.durationMin : DEFAULT_DURATION[type];

    Modal.open('<h3 class="section-heading">' + (existing ? 'Edit' : 'Add') + ' ' + TYPE_LABELS[type] + ' Item</h3>' +
      itemFormFieldsHtml(type, existing) +
      '<label>Duration (minutes)<br><input type="number" id="itinerary-item-duration" class="input" min="5" step="5" value="' + duration + '"></label><br><br>' +
      '<div id="itinerary-item-form-error" class="form-error"></div>' +
      '<button id="itinerary-item-save-btn" class="btn btn-primary">Save Item</button> ' +
      '<button id="itinerary-item-cancel-btn" class="btn btn-secondary">Cancel</button>');

    const subjectSelect = document.getElementById('itinerary-item-subject');
    if (subjectSelect) {
      subjectSelect.addEventListener('change', function () {
        document.getElementById('itinerary-item-topic-options').innerHTML = topicDatalistHtml(subjectSelect.value);
      });
    }

    document.getElementById('itinerary-item-cancel-btn').addEventListener('click', renderBuilder);

    document.getElementById('itinerary-item-save-btn').addEventListener('click', function () {
      const durationMin = Number(document.getElementById('itinerary-item-duration').value) || DEFAULT_DURATION[type];
      let item = {
        itemId: existing ? existing.itemId : genId(),
        type: type,
        refId: existing ? existing.refId : null,
        label: existing ? existing.label : '',
        durationMin: durationMin,
        plannedStart: null,
        plannedEnd: null
      };

      if (type === 'study') {
        const subject = document.getElementById('itinerary-item-subject').value;
        const topicName = document.getElementById('itinerary-item-topic').value.trim();
        const taskTypeInput = document.querySelector('input[name="itinerary-item-tasktype"]:checked');
        if (!topicName) {
          document.getElementById('itinerary-item-form-error').textContent = 'Give the study item a topic.';
          return;
        }
        item.subject = subject;
        item.topicName = topicName;
        item.taskType = taskTypeInput ? taskTypeInput.value : 'theory';
        item.label = subject + ' \u00B7 ' + topicName;
      } else if (type === 'planner-task') {
        const taskId = document.getElementById('itinerary-item-task').value;
        const task = taskId ? PlannerData.getTask(taskId) : null;
        if (!task) {
          document.getElementById('itinerary-item-form-error').textContent = 'Pick an existing scheduled task.';
          return;
        }
        item.refId = taskId;
        item.label = task.subject ? (task.subject + ' \u00B7 ' + task.topicName + ' \u00B7 ' + PlannerData.taskLabel(task)) : PlannerData.taskLabel(task);
      } else if (type === 'target') {
        const targetId = document.getElementById('itinerary-item-target').value;
        const target = targetId ? TargetsData.getTarget(targetId) : null;
        if (!target) {
          document.getElementById('itinerary-item-form-error').textContent = 'Pick an existing target.';
          return;
        }
        item.refId = targetId;
        item.label = target.title;
      } else if (type === 'nav') {
        const key = document.getElementById('itinerary-item-nav').value;
        const dest = NAV_DESTINATIONS.find(function (d) { return d.key === key; });
        if (!dest) {
          document.getElementById('itinerary-item-form-error').textContent = 'Pick a destination.';
          return;
        }
        item.destination = (dest.kind === 'screen') ? { kind: 'screen', screen: dest.screen } : { kind: 'modal', opener: dest.opener };
        item.label = dest.label;
      } else if (type === 'checklist' || type === 'custom') {
        const label = document.getElementById('itinerary-item-label').value.trim();
        if (!label) {
          document.getElementById('itinerary-item-form-error').textContent = 'Give the item a label.';
          return;
        }
        item.label = label;
      } else if (type === 'journal') {
        item.label = 'Journal';
      } else if (type === 'water') {
        item.label = 'Water';
      } else if (type === 'break') {
        item.label = existing && existing.label ? existing.label : 'Break';
      }

      if (existing) {
        draftItems = draftItems.map(function (it) { return it.itemId === item.itemId ? item : it; });
      } else {
        draftItems = draftItems.concat([item]);
      }
      renderBuilder();
    });
  }

  return { openBuilder: openBuilder, invokeDestination: invokeDestination };
})();
