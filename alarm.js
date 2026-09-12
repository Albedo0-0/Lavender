// alarm.js — General Alarm UI (§B.6). Depends on: State, Modal, Notify, AlarmData, TimeEngine.
// §6.1 says this belongs inside Assistant, near Notepad — Assistant (§B.7) doesn't exist yet
// (build order: B.6 before B.7), so it temporarily lives on its own icon (#alarm-icon, same
// pattern as #water-icon/#sleep-icon) and should move inside Assistant's modal once B.7 is built.
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

  // ---------- List + form modal ----------

  function listHtml() {
    const alarms = AlarmData.getList();
    const rows = alarms.length ? alarms.map(function (a) {
      return '<div class="alarm-row" data-id="' + a.id + '">' +
        '<span class="alarm-row-time">' + a.time + '</span> ' +
        '<span class="alarm-row-text">' + a.text + '</span> ' +
        '<span class="alarm-row-recurrence">' + recurrenceSummary(a.recurrence) + '</span> ' +
        '<label><input type="checkbox" class="alarm-enabled-toggle" data-id="' + a.id + '" ' + (a.enabled ? 'checked' : '') + '> On</label> ' +
        '<button class="alarm-edit-btn" data-id="' + a.id + '">Edit</button>' +
        '<button class="alarm-delete-btn" data-id="' + a.id + '">Delete</button>' +
      '</div>';
    }).join('') : '<p>No alarms yet.</p>';

    return '<h3>General Alarms</h3>' + rows + '<button id="alarm-add-btn">+ Add Alarm</button>';
  }

  function openList() {
    Modal.open(listHtml());
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
      return '<label><input type="checkbox" class="alarm-day-cb" value="' + d + '" ' + checked + '> ' + DAY_LABELS[d] + '</label>';
    }).join(' ');
  }

  function formHtml(alarm) {
    const recurrence = alarm ? alarm.recurrence : { type: 'once' };
    const type = recurrence.type;
    return '<h3>' + (alarm ? 'Edit Alarm' : 'Add Alarm') + '</h3>' +
      '<label>Text<br><input type="text" id="alarm-text-input" value="' + (alarm ? alarm.text : '') + '"></label><br><br>' +
      '<label>Time<br><input type="time" id="alarm-time-input" value="' + (alarm ? alarm.time : '') + '"></label><br><br>' +
      '<label>Repeat<br><select id="alarm-recurrence-select">' +
        ['once', 'daily', 'weekdays', 'date'].map(function (t) {
          return '<option value="' + t + '"' + (t === type ? ' selected' : '') + '>' +
            (t === 'once' ? 'One-time' : t === 'daily' ? 'Daily' : t === 'weekdays' ? 'Selected weekdays' : 'Specific date') +
          '</option>';
        }).join('') +
      '</select></label><br><br>' +
      '<div id="alarm-weekdays-field" style="display:' + (type === 'weekdays' ? 'block' : 'none') + '">' +
        weekdayCheckboxesHtml(recurrence.days) +
      '</div>' +
      '<div id="alarm-date-field" style="display:' + (type === 'date' ? 'block' : 'none') + '">' +
        '<input type="date" id="alarm-date-input" value="' + (recurrence.date || '') + '">' +
      '</div><br>' +
      '<div id="alarm-form-error" style="color:#c00"></div>' +
      '<button id="alarm-save-btn">Save</button> <button id="alarm-cancel-btn">Cancel</button>';
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

  // ---------- Fire modal (§6.3) ----------

  function showFireModal(alarm) {
    Modal.open(
      '<h3>Alarm</h3><p>' + alarm.text + '</p>' +
      '<button id="alarm-dismiss-btn">Dismiss</button> <button id="alarm-snooze-btn">Snooze 10 min</button>'
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

  function handleIconClick() { openList(); }

  function init() {
    const btn = document.getElementById('alarm-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
    // Single-heartbeat migration (Feature 11): ride TimeEngine's tick instead of our own
    // setInterval. Passing the stable id 'alarm' means calling init() again (re-render/reopen)
    // replaces this callback in TimeEngine's registry rather than accumulating a second one.
    TimeEngine.subscribe(poll, SUBSCRIBER_ID);
    poll();
  }

  return { init: init, openList: openList };
})();
