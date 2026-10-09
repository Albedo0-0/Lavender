// general-alarm.js — standalone alarm clock. Canonical data: State.get().generalAlarms (state.js schema:
// alarmId -> { id, text, time, recurrence, enabled, lastFiredDate, snoozedUntil }).
// Fully independent of tasks, revisions and study sessions: it never reads or writes the task store.
// Recurrence types (same vocabulary the retired alarm UI used): 'date' {date}, 'daily', 'weekdays' {days:['MO'..]},
// plus legacy 'once' (next occurrence) which is still honoured when found in saved data.
// Rides the single TimeEngine heartbeat via a stable subscriber id (re-calling init() replaces, never stacks).
// Delivery goes through Notify.deliver (browser notification / sound / vibration, each optional) plus an in-app popup.
// LIMITATION: foreground only. There is no push or service-worker scheduling, so an alarm can only ring while
// Lavender is open in a tab or installed app that the browser has not suspended. Timers in background tabs may be
// throttled, and an alarm that came due while the app was closed is retired silently (never replayed as a backlog).
// Depends on: State, Modal, Notify, TimeEngine (all guarded).

const GeneralAlarm = (function () {
  const SUBSCRIBER_ID = 'general-alarm';
  const GRACE_MIN = 10;     // an alarm first seen more than this long after it was due is retired without ringing
  const SNOOZE_MIN = 10;
  const DAY_KEYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR'];
  const DAY_NAMES = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };

  let lastMinute = null;
  let queue = [];           // alarm ids waiting to show their prompt (in-memory only)
  let promptId = null;      // alarm whose prompt is currently on screen

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function validTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function all() { return (State.get() && State.get().generalAlarms) || {}; }

  function update(id, patch) {
    const map = Object.assign({}, all());
    if (!map[id]) return false;
    map[id] = Object.assign({}, map[id], patch);
    return State.set({ generalAlarms: map });
  }

  // Next date (today or tomorrow) on which HH:MM has not yet passed.
  function nextDate(time, now) {
    const n = now || new Date();
    const d = new Date(n);
    if (time <= pad(n.getHours()) + ':' + pad(n.getMinutes())) d.setDate(d.getDate() + 1);
    return fmt(d);
  }

  function repeats(a) {
    const t = a.recurrence && a.recurrence.type;
    return t === 'daily' || t === 'weekdays';
  }

  function matchesDay(a, now, today) {
    const r = a.recurrence || { type: 'once' };
    if (r.type === 'daily') return true;
    if (r.type === 'weekdays') return (r.days || []).indexOf(DAY_KEYS[now.getDay()]) !== -1;
    if (r.type === 'date') return r.date === today;
    return r.type === 'once';
  }

  function repeatText(a) {
    const r = a.recurrence || {};
    if (r.type === 'daily') return 'Every day';
    if (r.type === 'weekdays') {
      const days = r.days || [];
      if (days.length === 5 && WEEKDAYS.every(function (k) { return days.indexOf(k) !== -1; })) return 'Weekdays';
      return days.map(function (k) { return DAY_NAMES[k] || k; }).join(' ') || 'Weekly';
    }
    if (r.type === 'date' && r.date) return 'Once \u00b7 ' + r.date;
    return 'Once';
  }

  // ---------- ringing ----------

  function ring(id, a) {
    if (typeof Notify !== 'undefined' && Notify.deliver) Notify.deliver(a.text || 'Alarm', a.time);
    if (queue.indexOf(id) === -1 && promptId !== id) queue.push(id);
  }

  // Heartbeat: the real scan runs once per minute; a pending prompt is retried every tick.
  function scan(now) {
    const nowMs = now.getTime();
    const today = fmt(now);
    const map = all();
    Object.keys(map).forEach(function (id) {
      const a = map[id];
      if (!a || !a.enabled || !validTime(a.time)) return;

      if (a.snoozedUntil) {
        if (nowMs < a.snoozedUntil) return;
        const patch = { snoozedUntil: null };
        if (!repeats(a)) patch.enabled = false;
        update(id, patch);
        if (nowMs - a.snoozedUntil <= GRACE_MIN * 60000) ring(id, a);
        return;
      }

      if (a.lastFiredDate === today || !matchesDay(a, now, today)) return;
      const dueMs = new Date(today + 'T' + a.time + ':00').getTime();
      if (nowMs < dueMs) return;
      const patch = { lastFiredDate: today };
      if (!repeats(a)) patch.enabled = false;   // one-time alarms switch off once rung or missed
      update(id, patch);
      if (nowMs - dueMs <= GRACE_MIN * 60000) ring(id, a);
    });
  }

  function modalBusy() {
    const ov = document.getElementById('modal-overlay');
    if (!ov || ov.style.display !== 'flex') return false;
    if (document.getElementById('ga-root') || document.getElementById('ga-ring')) return false; // our own screens may be replaced
    return true;
  }

  function endPrompt() {
    if (promptId) queue = queue.filter(function (q) { return q !== promptId; });
    promptId = null;
  }

  function showPrompt() {
    if (promptId) {
      // popup closed by its own timeout / swipe without a choice: treated as dismissed
      if (!document.getElementById('ga-ring')) endPrompt();
      return;
    }
    if (!queue.length || typeof Modal === 'undefined') return;
    if ((Modal.isLocked && Modal.isLocked()) || modalBusy()) return;   // retried next tick, nothing is lost
    const id = queue[0];
    const a = all()[id];
    if (!a) { queue.shift(); return; }
    promptId = id;
    Modal.open(
      '<div id="ga-ring" class="ga-ring"><h3 class="section-heading">Alarm</h3>' +
      '<p class="ga-ring-time">' + esc(a.time) + '</p>' +
      (a.text ? '<p class="ga-ring-text">' + esc(a.text) + '</p>' : '') +
      '<div class="ga-ring-actions">' +
        '<button type="button" id="ga-snooze" class="btn btn-secondary">Snooze ' + SNOOZE_MIN + ' min</button> ' +
        '<button type="button" id="ga-dismiss" class="btn btn-primary">Dismiss</button>' +
      '</div></div>',
      { popup: true }
    );
    const snooze = document.getElementById('ga-snooze');
    const dismiss = document.getElementById('ga-dismiss');
    if (snooze) snooze.addEventListener('click', function () {
      update(id, { enabled: true, snoozedUntil: Date.now() + SNOOZE_MIN * 60000 });
      endPrompt();
      Modal.close();
    });
    if (dismiss) dismiss.addEventListener('click', function () {
      update(id, { snoozedUntil: null });
      endPrompt();
      Modal.close();
    });
  }

  function tick() {
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      try { scan(now); } catch (e) { console.warn('General alarm scan failed', e); }
    }
    try { showPrompt(); } catch (e) { console.warn('General alarm prompt failed', e); }
  }

  // ---------- manager screen ----------

  function rowsHtml() {
    const map = all();
    const list = Object.keys(map).map(function (id) { return map[id]; })
      .filter(function (a) { return a && validTime(a.time); })
      .sort(function (a, b) { return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
    if (!list.length) return '<p class="ga-empty">No alarms yet.</p>';
    return '<ul class="ga-list">' + list.map(function (a) {
      const snoozed = a.enabled && a.snoozedUntil;
      return '<li class="ga-row' + (a.enabled ? '' : ' is-off') + '">' +
        '<span class="ga-time">' + esc(a.time) + '</span>' +
        '<span class="ga-meta"><span class="ga-label">' + esc(a.text || 'Alarm') + '</span>' +
          '<span class="ga-sub">' + esc(repeatText(a)) + (snoozed ? ' \u00b7 snoozed' : '') + '</span></span>' +
        '<label class="switch-label"><input type="checkbox" class="switch-input" data-ga-toggle="' + esc(a.id) + '"' + (a.enabled ? ' checked' : '') + ' aria-label="Alarm on"></label>' +
        '<button type="button" class="ga-del" data-ga-del="' + esc(a.id) + '" aria-label="Delete alarm">&times;</button>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function html(note) {
    return '<div class="ga" id="ga-root">' +
      '<div class="modal-header"><h2 class="modal-title">Alarm clock</h2>' +
        '<button type="button" class="modal-close" data-ga-close aria-label="Close">\u00d7</button></div>' +
      '<div class="ga-form">' +
        '<div class="ga-field"><label for="ga-time">Time</label><input type="time" id="ga-time"></div>' +
        '<div class="ga-field ga-field-grow"><label for="ga-text">Label</label><input type="text" id="ga-text" maxlength="60" placeholder="Optional"></div>' +
        '<div class="ga-field"><label for="ga-repeat">Repeat</label>' +
          '<select id="ga-repeat"><option value="once">Once</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option></select></div>' +
        '<button type="button" id="ga-add" class="btn btn-primary">Add</button>' +
      '</div>' +
      (note ? '<p class="ga-note" role="status">' + esc(note) + '</p>' : '') +
      rowsHtml() +
      '<p class="ga-foot">Alarms ring only while Lavender is open.</p>' +
    '</div>';
  }

  function render(note) {
    const c = document.getElementById('modal-content');
    if (c && c.querySelector('#ga-root')) c.innerHTML = html(note);
    else Modal.open(html(note), { size: 'md' });
    bind();
  }

  function bind() {
    const root = document.getElementById('ga-root');
    if (!root) return;
    const close = root.querySelector('[data-ga-close]');
    if (close) close.addEventListener('click', function () { Modal.close(); });

    const add = document.getElementById('ga-add');
    if (add) add.addEventListener('click', function () {
      const time = document.getElementById('ga-time').value;
      if (!validTime(time)) { render('Pick a time for the alarm.'); return; }
      const text = document.getElementById('ga-text').value.trim();
      const kind = document.getElementById('ga-repeat').value;
      const recurrence = kind === 'daily' ? { type: 'daily' }
        : (kind === 'weekdays' ? { type: 'weekdays', days: WEEKDAYS.slice() }
        : { type: 'date', date: nextDate(time) });
      const id = 'alarm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const map = Object.assign({}, all());
      map[id] = { id: id, text: text, time: time, recurrence: recurrence, enabled: true, lastFiredDate: null, snoozedUntil: null };
      if (!State.set({ generalAlarms: map })) { render('Could not save the alarm (storage unavailable or full).'); return; }
      if (typeof Notify !== 'undefined' && Notify.requestPermission) Notify.requestPermission();
      render('Alarm set for ' + time + '.');
    });

    root.querySelectorAll('[data-ga-toggle]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const id = cb.getAttribute('data-ga-toggle');
        const a = all()[id];
        if (!a) return;
        const patch = { enabled: cb.checked, snoozedUntil: null };
        // Turning a one-time alarm back on arms its next occurrence instead of a date that already passed.
        if (cb.checked && !repeats(a) && validTime(a.time)) {
          patch.recurrence = { type: 'date', date: nextDate(a.time) };
          patch.lastFiredDate = null;
        }
        update(id, patch);
        render();
      });
    });

    root.querySelectorAll('[data-ga-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-ga-del');
        const map = Object.assign({}, all());
        delete map[id];
        State.set({ generalAlarms: map });
        queue = queue.filter(function (q) { return q !== id; });
        render();
      });
    });
  }

  function open() { render(); }

  function init() {
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) TimeEngine.subscribe(tick, SUBSCRIBER_ID);
  }

  return { init: init, open: open, _scan: scan, _tick: tick };
})();
