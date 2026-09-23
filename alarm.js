// alarm.js — General Alarm UI (§B.6). Depends on: State, Modal, Notify, AlarmData, TimeEngine.
// Opened exclusively via Assistant → Alarms (assistant.js openAlarms() → Alarm.openList()).
//
// Feature 11 (Single Heartbeat): this module no longer runs its own setInterval poll. It rides
// TimeEngine's single 1s heartbeat via TimeEngine.subscribe(fn, id) — a stable id ('alarm') means
// re-calling init() replaces the callback in place instead of stacking a second listener that
// would double-fire (and, here, potentially double-open the fire modal) on every tick.
const Alarm = (function () {
  const SUBSCRIBER_ID = 'alarm';
  let editingId = null;

  const DAY_LABELS = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };

  function recurrenceSummary(recurrence) {
    if (recurrence.type === 'once') return 'One-time';
    if (recurrence.type === 'daily') return 'Daily';
    if (recurrence.type === 'weekdays') return (recurrence.days || []).map(function (d) { return DAY_LABELS[d]; }).join(', ');
    if (recurrence.type === 'date') return recurrence.date;
    return '';
  }

  // ---------- Tab row (Alarms | Itineraries) ----------

  function tabsHtml(active) {
    return '<div class="alarm-tabs">' +
      '<button id="alarm-tab-alarms-btn" class="btn ' + (active === 'alarms' ? 'btn-primary' : 'btn-secondary') + '">Alarms</button> ' +
      '<button id="alarm-tab-itineraries-btn" class="btn ' + (active === 'itineraries' ? 'btn-primary' : 'btn-secondary') + '">Itineraries</button>' +
    '</div><br>';
  }

  function wireTabs() {
    document.getElementById('alarm-tab-alarms-btn').addEventListener('click', openList);
    document.getElementById('alarm-tab-itineraries-btn').addEventListener('click', openItineraryList);
  }

  // ---------- List + form modal ----------

  function listHtml() {
    const alarms = AlarmData.getList();
    const rows = alarms.length ? alarms.map(function (a) {
      return '<div class="alarm-row list-row" data-id="' + a.id + '">' +
        '<span class="alarm-row-time">' + a.time + '</span> ' +
        '<span class="alarm-row-text">' + a.text + '</span> ' +
        '<span class="alarm-row-recurrence chip">' + recurrenceSummary(a.recurrence) + '</span> ' +
        '<label class="switch-label"><input type="checkbox" class="alarm-enabled-toggle switch-input" data-id="' + a.id + '" ' + (a.enabled ? 'checked' : '') + '> On</label> ' +
        '<button class="alarm-edit-btn btn btn-secondary" data-id="' + a.id + '">Edit</button>' +
        '<button class="alarm-delete-btn btn btn-danger" data-id="' + a.id + '">Delete</button>' +
      '</div>';
    }).join('') : '<p class="empty-state">No alarms yet.</p>';

    return tabsHtml('alarms') + '<h3 class="section-heading">General Alarms</h3>' + rows + '<button id="alarm-add-btn" class="btn btn-primary">+ Add Alarm</button>';
  }

  function openList() {
    Modal.open(listHtml());
    wireTabs();
    document.getElementById('alarm-add-btn').addEventListener('click', function () { openForm(null); });
    document.querySelectorAll('.alarm-enabled-toggle').forEach(function (cb) {
      cb.addEventListener('change', function () { AlarmData.setEnabled(cb.dataset.id, cb.checked); });
    });
    document.querySelectorAll('.alarm-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openForm(btn.dataset.id); });
    });
    document.querySelectorAll('.alarm-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { AlarmData.remove(btn.dataset.id); openList(); });
    });
  }

  function weekdayCheckboxesHtml(selectedDays) {
    selectedDays = selectedDays || [];
    return AlarmData.DAY_KEYS.map(function (d) {
      const checked = selectedDays.indexOf(d) !== -1 ? 'checked' : '';
      return '<label class="chip weekday-chip"><input type="checkbox" class="alarm-day-cb" value="' + d + '" ' + checked + '> ' + DAY_LABELS[d] + '</label>';
    }).join(' ');
  }

  function formHtml(alarm) {
    const recurrence = alarm ? alarm.recurrence : { type: 'once' };
    const type = recurrence.type;
    return '<h3 class="section-heading">' + (alarm ? 'Edit Alarm' : 'Add Alarm') + '</h3>' +
      '<label>Text<br><input type="text" id="alarm-text-input" class="input" value="' + (alarm ? alarm.text : '') + '"></label><br><br>' +
      '<label>Time<br><input type="time" id="alarm-time-input" class="input" value="' + (alarm ? alarm.time : '') + '"></label><br><br>' +
      '<label>Repeat<br><select id="alarm-recurrence-select" class="input">' +
        ['once', 'daily', 'weekdays', 'date'].map(function (t) {
          return '<option value="' + t + '"' + (t === type ? ' selected' : '') + '>' +
            (t === 'once' ? 'One-time' : t === 'daily' ? 'Daily' : t === 'weekdays' ? 'Selected weekdays' : 'Specific date') +
          '</option>';
        }).join('') +
      '</select></label><br><br>' +
      '<div id="alarm-weekdays-field" class="chip-row" style="display:' + (type === 'weekdays' ? 'block' : 'none') + '">' +
        weekdayCheckboxesHtml(recurrence.days) +
      '</div>' +
      '<div id="alarm-date-field" style="display:' + (type === 'date' ? 'block' : 'none') + '">' +
        '<input type="date" id="alarm-date-input" class="input" value="' + (recurrence.date || '') + '">' +
      '</div><br>' +
      '<div id="alarm-form-error" class="form-error"></div>' +
      '<button id="alarm-save-btn" class="btn btn-primary">Save</button> <button id="alarm-cancel-btn" class="btn btn-secondary">Cancel</button>';
  }

  function openForm(id) {
    editingId = id;
    const alarm = id ? AlarmData.getById(id) : null;
    Modal.open(formHtml(alarm));

    const select = document.getElementById('alarm-recurrence-select');
    select.addEventListener('change', function () {
      document.getElementById('alarm-weekdays-field').style.display = (select.value === 'weekdays') ? 'block' : 'none';
      document.getElementById('alarm-date-field').style.display = (select.value === 'date') ? 'block' : 'none';
    });

    document.getElementById('alarm-cancel-btn').addEventListener('click', openList);

    document.getElementById('alarm-save-btn').addEventListener('click', function () {
      const text = document.getElementById('alarm-text-input').value || 'Alarm';
      const time = document.getElementById('alarm-time-input').value;
      const type = select.value;
      let recurrence = { type: type };
      if (type === 'weekdays') {
        recurrence.days = Array.prototype.slice.call(document.querySelectorAll('.alarm-day-cb:checked')).map(function (cb) { return cb.value; });
      } else if (type === 'date') {
        recurrence.date = document.getElementById('alarm-date-input').value;
      }

      const fields = { text: text, time: time, recurrence: recurrence };
      const result = editingId ? AlarmData.update(editingId, fields) : AlarmData.create(fields);

      if (!result) {
        const reason = (typeof AlarmData.getLastError === 'function' && AlarmData.getLastError()) ||
          'Pick a valid time and recurrence (weekdays needs at least one day; specific date needs a date).';
        document.getElementById('alarm-form-error').textContent = reason;
        return;
      }
      openList();
    });
  }

  // ---------- Itinerary Templates list + form (§11) ----------

  let editingTemplateId = null;

  function itineraryListHtml() {
    const templates = ItineraryTemplateData.getList();
    const rows = templates.length ? templates.map(function (t) {
      return '<div class="itinerary-template-row list-row" data-id="' + t.templateId + '">' +
        '<span class="itinerary-template-row-name">' + t.name + '</span> ' +
        '<span class="itinerary-template-row-recurrence chip">' + recurrenceSummary(t.schedule) + '</span> ' +
        '<span class="itinerary-template-row-count chip">' + (t.items ? t.items.length : 0) + ' items</span> ' +
        '<button class="itinerary-template-edit-btn btn btn-secondary" data-id="' + t.templateId + '">Edit</button>' +
        '<button class="itinerary-template-delete-btn btn btn-danger" data-id="' + t.templateId + '">Delete</button>' +
      '</div>';
    }).join('') : '<p class="empty-state">No itinerary templates yet.</p>';

    return tabsHtml('itineraries') + '<h3 class="section-heading">Itinerary Templates</h3>' + rows +
      '<button id="itinerary-template-add-btn" class="btn btn-primary">+ Add Itinerary Template</button>';
  }

  function openItineraryList() {
    Modal.open(itineraryListHtml());
    wireTabs();
    document.getElementById('itinerary-template-add-btn').addEventListener('click', function () { openItineraryForm(null); });
    document.querySelectorAll('.itinerary-template-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openItineraryForm(btn.dataset.id); });
    });
    document.querySelectorAll('.itinerary-template-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { ItineraryTemplateData.remove(btn.dataset.id); openItineraryList(); });
    });
  }

  function itineraryFormHtml(template) {
    const schedule = template ? template.schedule : { type: 'once' };
    const type = schedule.type;
    return '<h3 class="section-heading">' + (template ? 'Edit Itinerary Template' : 'Add Itinerary Template') + '</h3>' +
      '<label>Name<br><input type="text" id="itinerary-template-name-input" class="input" value="' + (template ? template.name : '') + '"></label><br><br>' +
      '<label>Applies on<br><select id="itinerary-template-schedule-select" class="input">' +
        ['once', 'daily', 'weekdays', 'date'].map(function (t) {
          return '<option value="' + t + '"' + (t === type ? ' selected' : '') + '>' +
            (t === 'once' ? 'One-time (today)' : t === 'daily' ? 'Every day' : t === 'weekdays' ? 'Selected weekdays' : 'Specific date') +
          '</option>';
        }).join('') +
      '</select></label><br><br>' +
      '<div id="itinerary-template-weekdays-field" class="chip-row" style="display:' + (type === 'weekdays' ? 'block' : 'none') + '">' +
        weekdayCheckboxesHtml(schedule.days) +
      '</div>' +
      '<div id="itinerary-template-date-field" style="display:' + (type === 'date' ? 'block' : 'none') + '">' +
        '<input type="date" id="itinerary-template-date-input" class="input" value="' + (schedule.date || '') + '">' +
      '</div><br>' +
      '<p class="empty-state">Items are added in the Itinerary Builder (coming soon).</p>' +
      '<div id="itinerary-template-form-error" class="form-error"></div>' +
      '<button id="itinerary-template-save-btn" class="btn btn-primary">Save</button> <button id="itinerary-template-cancel-btn" class="btn btn-secondary">Cancel</button>';
  }

  function openItineraryForm(id) {
    editingTemplateId = id;
    const template = id ? ItineraryTemplateData.getById(id) : null;
    Modal.open(itineraryFormHtml(template));

    const select = document.getElementById('itinerary-template-schedule-select');
    select.addEventListener('change', function () {
      document.getElementById('itinerary-template-weekdays-field').style.display = (select.value === 'weekdays') ? 'block' : 'none';
      document.getElementById('itinerary-template-date-field').style.display = (select.value === 'date') ? 'block' : 'none';
    });

    document.getElementById('itinerary-template-cancel-btn').addEventListener('click', openItineraryList);

    document.getElementById('itinerary-template-save-btn').addEventListener('click', function () {
      const name = document.getElementById('itinerary-template-name-input').value;
      const type = select.value;
      let schedule = { type: type };
      if (type === 'weekdays') {
        schedule.days = Array.prototype.slice.call(document.querySelectorAll('.alarm-day-cb:checked')).map(function (cb) { return cb.value; });
      } else if (type === 'date') {
        schedule.date = document.getElementById('itinerary-template-date-input').value;
      }

      const fields = { name: name, schedule: schedule };
      const result = editingTemplateId ? ItineraryTemplateData.update(editingTemplateId, fields) : ItineraryTemplateData.create(fields);

      if (!result) {
        const reason = (typeof ItineraryTemplateData.getLastError === 'function' && ItineraryTemplateData.getLastError()) ||
          'Pick a valid name and schedule (weekdays needs at least one day; specific date needs a date).';
        document.getElementById('itinerary-template-form-error').textContent = reason;
        return;
      }
      openItineraryList();
    });
  }

  // ---------- Fire modal (§6.3) ----------

  function showFireModal(alarm) {
    Modal.open(
      '<h3 class="section-heading">Alarm</h3><p>' + alarm.text + '</p>' +
      '<button id="alarm-dismiss-btn" class="btn btn-primary">Dismiss</button> <button id="alarm-snooze-btn" class="btn btn-secondary">Snooze 10 min</button>'
    );
    document.getElementById('alarm-dismiss-btn').addEventListener('click', function () {
      AlarmData.dismiss(alarm.id);
      Modal.close();
    });
    document.getElementById('alarm-snooze-btn').addEventListener('click', function () {
      AlarmData.snooze(alarm.id);
      Modal.close();
    });
    Notify.deliver(alarm.text, 'Alarm');
  }

  function poll() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && overlay.style.display === 'flex') return; // never interrupt another open modal
    const due = AlarmData.getDueAlarms(new Date());
    if (due.length) showFireModal(due[0]); // one at a time; the rest catch the next heartbeat tick
  }

  function init() {
    // Single-heartbeat migration (Feature 11): ride TimeEngine's tick instead of our own
    // setInterval. Passing the stable id 'alarm' means calling init() again (re-render/reopen)
    // replaces this callback in TimeEngine's registry rather than accumulating a second one.
    TimeEngine.subscribe(poll, SUBSCRIBER_ID);
    poll();
  }

  return { init: init, openList: openList, openItineraryList: openItineraryList };
})();
