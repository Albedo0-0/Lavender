// general-alarm.js — standalone alarm clock. Canonical data: State.get().generalAlarms (state.js schema:
// alarmId -> { id, text, time, recurrence, enabled, lastFiredDate, snoozedUntil, snoozeMin? }).
// snoozeMin is the only addition (optional, 1-60, default 10) so existing saved alarms and backups stay valid.
// Fully independent of tasks, revisions, targets and study sessions: it never reads or writes the task store.
// Recurrence vocabulary is unchanged: 'date' {date}, 'daily', 'weekdays' {days:['MO'..]} (any subset of days),
// plus legacy 'once', which is converted to a dated alarm the first time it is scanned.
// Rides the single TimeEngine heartbeat via one stable subscriber id.
// Delivery goes through Notify.deliver (browser notification / sound / vibration, each optional) plus an in-app popup.
// LIMITATION: foreground only. There is no push or service-worker scheduling, so an alarm can only ring while
// Lavender is open in a tab or installed app that the browser has not suspended. An alarm that came due while the
// app was closed (more than GRACE_MIN ago) is skipped silently, never replayed as a backlog.
// Depends on: State, Modal, Notify, TimeEngine (all guarded).

const GeneralAlarm = (function () {
  const SUBSCRIBER_ID = 'general-alarm';
  const GRACE_MIN = 10;               // an alarm first seen more than this long after it was due is skipped without ringing
  const DEFAULT_SNOOZE_MIN = 10;
  const SNOOZE_CHOICES = [5, 10, 15, 20, 30];
  const DAY_KEYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];      // index = Date.getDay()
  const DAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];     // display order
  const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR'];
  const WEEKENDS = ['SA', 'SU'];
  const DAY_NAMES = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };

  let lastMinute = null;
  let subscribed = false;
  let queue = [];            // alarm ids waiting to show their prompt (in-memory only)
  let promptId = null;       // alarm whose prompt is currently on screen
  let view = 'list';         // manager screen: 'list' | 'edit'
  let editingId = null;      // alarm being edited, or null for a new one

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
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

  function snoozeMinOf(a) {
    const n = Math.round(Number(a && a.snoozeMin));
    return (n >= 1 && n <= 60) ? n : DEFAULT_SNOOZE_MIN;
  }

  // Next date (today or tomorrow) on which HH:MM has not yet passed.
  function nextDate(time, now) {
    const n = now || new Date();
    const d = new Date(n);
    if (time <= hm(n)) d.setDate(d.getDate() + 1);
    return fmt(d);
  }

  function repeats(a) {
    const t = a.recurrence && a.recurrence.type;
    return t === 'daily' || t === 'weekdays';
  }

  // Does alarm `a` occur on calendar day `d` (a Date)?
  function dayMatches(a, d) {
    const r = a.recurrence || { type: 'once' };
    if (r.type === 'daily') return true;
    if (r.type === 'weekdays') return (r.days || []).indexOf(DAY_KEYS[d.getDay()]) !== -1;
    if (r.type === 'date') return r.date === fmt(d);
    return r.type === 'once';
  }

  // Epoch ms of the next time this alarm will ring (snooze wins), or null when it has none left.
  function nextOccurrenceMs(a, now) {
    if (!a || !validTime(a.time)) return null;
    if (a.snoozedUntil) return a.snoozedUntil;
    const n = now || new Date();
    const minuteStart = Math.floor(n.getTime() / 60000) * 60000;
    for (let i = 0; i < 8; i++) {
      const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + i);
      const ds = fmt(d);
      if (!dayMatches(a, d)) continue;
      const ms = new Date(ds + 'T' + a.time + ':00').getTime();
      if (i === 0 && (a.lastFiredDate === ds || ms < minuteStart)) continue;
      return ms;
    }
    const r = a.recurrence || {};
    if (r.type === 'date' && r.date) {
      const ms = new Date(r.date + 'T' + a.time + ':00').getTime();
      if (ms >= minuteStart) return ms;
    }
    return null;
  }

  function sameDays(days, wanted) {
    return days.length === wanted.length && wanted.every(function (k) { return days.indexOf(k) !== -1; });
  }

  function repeatText(a) {
    const r = a.recurrence || {};
    if (r.type === 'daily') return 'Every day';
    if (r.type === 'weekdays') {
      const days = r.days || [];
      if (days.length === 7) return 'Every day';
      if (sameDays(days, WEEKDAYS)) return 'Weekdays';
      if (sameDays(days, WEEKENDS)) return 'Weekends';
      return DAY_ORDER.filter(function (k) { return days.indexOf(k) !== -1; }).map(function (k) { return DAY_NAMES[k]; }).join(' ') || 'Once';
    }
    return 'Once';
  }

  function whenText(a, now) {
    if (a.snoozedUntil) return 'Snoozed until ' + hm(new Date(a.snoozedUntil));
    const ms = nextOccurrenceMs(a, now);
    if (ms == null) return '';
    const d = new Date(ms), n = now || new Date();
    const today = fmt(n), tomorrow = fmt(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1));
    const ds = fmt(d);
    return ds === today ? 'Today' : (ds === tomorrow ? 'Tomorrow' : DAY_NAMES[DAY_KEYS[d.getDay()]]);
  }

  // ---------- ringing ----------

  function ring(id, a) {
    if (queue.indexOf(id) !== -1 || promptId === id) return;      // one ring per occurrence
    if (typeof Notify !== 'undefined' && Notify.deliver) Notify.deliver(a.text || 'Alarm', a.time);
    queue.push(id);
  }

  // Heartbeat: the real scan runs once per minute; a pending prompt is retried every tick.
  function scan(now) {
    const nowMs = now.getTime();
    const today = fmt(now);
    const map = all();
    Object.keys(map).forEach(function (id) {
      const a = map[id];
      if (!a || !a.enabled || !validTime(a.time)) return;
      const r = a.recurrence || { type: 'once' };

      // Legacy 'once' (meant "next occurrence"): pin it to a real date now, ring on a later scan.
      if (r.type === 'once') { update(id, { recurrence: { type: 'date', date: nextDate(a.time, now) } }); return; }

      if (a.snoozedUntil) {
        if (nowMs < a.snoozedUntil) return;
        const patch = { snoozedUntil: null };
        if (!repeats(a)) patch.enabled = false;
        update(id, patch);
        if (nowMs - a.snoozedUntil <= GRACE_MIN * 60000) ring(id, a);
        return;
      }

      // A dated alarm whose day has passed (app was closed) is retired quietly instead of staying "upcoming" forever.
      if (r.type === 'date' && r.date && r.date < today) { update(id, { enabled: false }); return; }

      if (a.lastFiredDate === today || !dayMatches(a, now)) return;
      const dueMs = new Date(today + 'T' + a.time + ':00').getTime();
      if (nowMs < dueMs) return;
      const patch = { lastFiredDate: today };
      if (!repeats(a)) patch.enabled = false;   // one-time alarms switch off once rung or missed
      update(id, patch);
      if (nowMs - dueMs <= GRACE_MIN * 60000) ring(id, a);
    });
  }

  function modalBusy() {
    const ov = document.getElementById('modal-overlay'), c = document.getElementById('modal-content');
    if (!ov || !c) return false;
    const cs = getComputedStyle(ov);
    const open = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && c.innerHTML.trim() !== '';
    if (!open) return false;
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
    const mins = snoozeMinOf(a);
    Modal.open(
      '<div id="ga-ring" class="ga-ring"><h3 class="section-heading">Alarm</h3>' +
      '<p class="ga-ring-time">' + esc(a.time) + '</p>' +
      (a.text ? '<p class="ga-ring-text">' + esc(a.text) + '</p>' : '') +
      '<div class="ga-ring-actions">' +
        '<button type="button" id="ga-snooze" class="btn btn-secondary">Snooze ' + mins + ' min</button> ' +
        '<button type="button" id="ga-dismiss" class="btn btn-primary">Dismiss</button>' +
      '</div></div>',
      { popup: true }
    );
    const snooze = document.getElementById('ga-snooze');
    const dismiss = document.getElementById('ga-dismiss');
    if (snooze) snooze.addEventListener('click', function () {
      update(id, { enabled: true, snoozedUntil: Date.now() + mins * 60000 });
      endPrompt();
      Modal.close();
    });
    if (dismiss) dismiss.addEventListener('click', function () {
      update(id, { snoozedUntil: null });    // recurring alarms keep their schedule; one-time alarms are already off
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

  function rowHtml(a, now) {
    const sub = [repeatText(a), a.enabled ? whenText(a, now) : ''].filter(Boolean).join(' \u00b7 ');
    return '<li class="ga-row' + (a.enabled ? '' : ' is-off') + '">' +
      '<button type="button" class="ga-row-main" data-ga-edit="' + esc(a.id) + '" aria-label="Edit alarm ' + esc(a.time) + '">' +
        '<span class="ga-time">' + esc(a.time) + '</span>' +
        '<span class="ga-meta"><span class="ga-label">' + esc(a.text || 'Alarm') + '</span>' +
          '<span class="ga-sub">' + esc(sub) + '</span></span>' +
      '</button>' +
      '<label class="switch-label"><input type="checkbox" class="switch-input" data-ga-toggle="' + esc(a.id) + '"' + (a.enabled ? ' checked' : '') + ' aria-label="Alarm on"></label>' +
      '<button type="button" class="ga-del" data-ga-del="' + esc(a.id) + '" aria-label="Delete alarm">&times;</button>' +
    '</li>';
  }

  function listHtml(note) {
    const now = new Date();
    const map = all();
    const list = Object.keys(map).map(function (id) { return map[id]; }).filter(function (a) { return a && validTime(a.time); });
    const on = list.filter(function (a) { return a.enabled; }).sort(function (a, b) {
      const x = nextOccurrenceMs(a, now), y = nextOccurrenceMs(b, now);
      if (x == null && y == null) return a.time < b.time ? -1 : 1;
      if (x == null) return 1;
      if (y == null) return -1;
      return x - y;
    });
    const off = list.filter(function (a) { return !a.enabled; }).sort(function (a, b) { return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0); });
    return '<div class="ga" id="ga-root">' +
      '<div class="modal-header"><h2 class="modal-title">Alarm clock</h2>' +
        '<button type="button" class="modal-close" data-ga-close aria-label="Close">\u00d7</button></div>' +
      '<div class="ga-actions"><button type="button" id="ga-new" class="btn btn-primary">+ New alarm</button></div>' +
      (note ? '<p class="ga-note" role="status">' + esc(note) + '</p>' : '') +
      (on.length ? '<ul class="ga-list">' + on.map(function (a) { return rowHtml(a, now); }).join('') + '</ul>'
                 : '<p class="ga-empty">' + (off.length ? 'No upcoming alarms.' : 'No alarms yet.') + '</p>') +
      (off.length ? '<h4 class="ga-section">Off</h4><ul class="ga-list">' + off.map(function (a) { return rowHtml(a, now); }).join('') + '</ul>' : '') +
      '<p class="ga-foot">Alarms ring only while Lavender is open. One that comes due while it is closed is skipped.</p>' +
    '</div>';
  }

  function editHtml(note) {
    const a = editingId ? all()[editingId] : null;
    const days = a && a.recurrence
      ? (a.recurrence.type === 'daily' ? DAY_KEYS.slice() : (a.recurrence.type === 'weekdays' ? (a.recurrence.days || []) : []))
      : [];
    const snooze = a ? snoozeMinOf(a) : DEFAULT_SNOOZE_MIN;
    return '<div class="ga" id="ga-root">' +
      '<div class="modal-header"><h2 class="modal-title">' + (a ? 'Edit alarm' : 'New alarm') + '</h2>' +
        '<button type="button" class="modal-close" data-ga-back aria-label="Back">\u00d7</button></div>' +
      '<div class="ga-edit">' +
        '<div class="ga-field"><label for="ga-time">Time</label><input type="time" id="ga-time" value="' + esc(a ? a.time : '') + '"></div>' +
        '<div class="ga-field"><label for="ga-text">Label <span class="ga-opt">optional</span></label>' +
          '<input type="text" id="ga-text" maxlength="60" placeholder="e.g. Wake up" value="' + esc(a ? a.text : '') + '"></div>' +
        '<div class="ga-field"><span class="ga-lbl">Repeat</span>' +
          '<div class="ga-days" role="group" aria-label="Repeat days">' + DAY_ORDER.map(function (k) {
            return '<label class="ga-day"><input type="checkbox" data-ga-day="' + k + '"' + (days.indexOf(k) !== -1 ? ' checked' : '') + '><span>' + DAY_NAMES[k] + '</span></label>';
          }).join('') + '</div>' +
          '<div class="ga-quick">' +
            '<button type="button" class="plan-agent-link" data-ga-quick="all">Every day</button>' +
            '<button type="button" class="plan-agent-link" data-ga-quick="weekdays">Weekdays</button>' +
            '<button type="button" class="plan-agent-link" data-ga-quick="weekends">Weekends</button>' +
            '<button type="button" class="plan-agent-link" data-ga-quick="none">Once</button>' +
          '</div></div>' +
        '<div class="ga-field"><label for="ga-snooze-min">Snooze</label><select id="ga-snooze-min">' +
          SNOOZE_CHOICES.map(function (m) { return '<option value="' + m + '"' + (m === snooze ? ' selected' : '') + '>' + m + ' minutes</option>'; }).join('') +
        '</select></div>' +
        (note ? '<p class="ga-note" role="status">' + esc(note) + '</p>' : '') +
        '<div class="ga-actions ga-actions-end">' +
          '<button type="button" class="btn btn-secondary" data-ga-back>Cancel</button>' +
          '<button type="button" id="ga-save" class="btn btn-primary">Save</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function render(note) {
    const c = document.getElementById('modal-content');
    const h = view === 'edit' ? editHtml(note) : listHtml(note);
    if (c && c.querySelector('#ga-root')) c.innerHTML = h;
    else Modal.open(h, { size: 'md' });
    bind();
  }

  function selectedDays(root) {
    return DAY_ORDER.filter(function (k) {
      const cb = root.querySelector('[data-ga-day="' + k + '"]');
      return cb && cb.checked;
    });
  }

  function save(root) {
    const timeEl = document.getElementById('ga-time');
    const time = timeEl ? timeEl.value : '';
    if (!validTime(time)) {                       // keep what was typed: show the notice in place instead of re-rendering
      let n = root.querySelector('.ga-note');
      if (!n) { n = document.createElement('p'); n.className = 'ga-note'; n.setAttribute('role', 'status'); const act = root.querySelector('.ga-actions'); if (act) act.parentNode.insertBefore(n, act); }
      n.textContent = 'Pick a time for the alarm.';
      if (timeEl) timeEl.focus();
      return;
    }
    const text = (document.getElementById('ga-text').value || '').trim();
    const snoozeMin = Math.round(Number(document.getElementById('ga-snooze-min').value)) || DEFAULT_SNOOZE_MIN;
    const days = selectedDays(root);
    const now = new Date();
    const passedToday = time <= hm(now);
    let recurrence, lastFiredDate = null;
    if (days.length === 7) recurrence = { type: 'daily' };
    else if (days.length) recurrence = { type: 'weekdays', days: days };
    else recurrence = { type: 'date', date: nextDate(time, now) };
    // A repeating alarm whose time already passed today must wait for its next day instead of ringing late.
    if (days.length && passedToday) lastFiredDate = fmt(now);

    const map = Object.assign({}, all());
    let id = editingId;
    if (id && map[id]) {
      map[id] = Object.assign({}, map[id], { text: text, time: time, recurrence: recurrence, snoozeMin: snoozeMin, enabled: true, snoozedUntil: null, lastFiredDate: lastFiredDate });
    } else {
      id = 'alarm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      map[id] = { id: id, text: text, time: time, recurrence: recurrence, enabled: true, lastFiredDate: lastFiredDate, snoozedUntil: null, snoozeMin: snoozeMin };
    }
    if (!State.set({ generalAlarms: map })) { render('Could not save the alarm (storage unavailable or full).'); return; }
    queue = queue.filter(function (q) { return q !== id; });
    if (typeof Notify !== 'undefined' && Notify.requestPermission) Notify.requestPermission();
    view = 'list';
    editingId = null;
    render('Alarm set for ' + time + '.');
  }

  function bind() {
    const root = document.getElementById('ga-root');
    if (!root) return;
    function on(sel, fn) { root.querySelectorAll(sel).forEach(function (el) { el.addEventListener('click', function () { fn(el); }); }); }

    on('[data-ga-close]', function () { view = 'list'; editingId = null; Modal.close(); });
    on('[data-ga-back]', function () { view = 'list'; editingId = null; render(); });
    on('#ga-new', function () { view = 'edit'; editingId = null; render(); });
    on('[data-ga-edit]', function (el) { view = 'edit'; editingId = el.getAttribute('data-ga-edit'); render(); });
    on('#ga-save', function () { save(root); });
    on('[data-ga-quick]', function (el) {
      const which = el.getAttribute('data-ga-quick');
      const set = which === 'all' ? DAY_KEYS : (which === 'weekdays' ? WEEKDAYS : (which === 'weekends' ? WEEKENDS : []));
      root.querySelectorAll('[data-ga-day]').forEach(function (cb) { cb.checked = set.indexOf(cb.getAttribute('data-ga-day')) !== -1; });
    });

    root.querySelectorAll('[data-ga-toggle]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const id = cb.getAttribute('data-ga-toggle');
        const a = all()[id];
        if (!a) return;
        const now = new Date();
        const patch = { enabled: cb.checked, snoozedUntil: null };
        if (cb.checked && validTime(a.time)) {
          if (repeats(a)) patch.lastFiredDate = a.time <= hm(now) ? fmt(now) : null;      // no late ring for a time that already passed
          else { patch.recurrence = { type: 'date', date: nextDate(a.time, now) }; patch.lastFiredDate = null; }
        }
        update(id, patch);
        if (!cb.checked) queue = queue.filter(function (q) { return q !== id; });
        render();
      });
    });

    on('[data-ga-del]', function (btn) {
      const id = btn.getAttribute('data-ga-del');
      const map = Object.assign({}, all());
      delete map[id];
      State.set({ generalAlarms: map });
      queue = queue.filter(function (q) { return q !== id; });
      render();
    });
  }

  function open() { view = 'list'; editingId = null; render(); }

  function init() {
    if (!subscribed && typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) {
      TimeEngine.subscribe(tick, SUBSCRIBER_ID);
      subscribed = true;
    }
    const btn = typeof document !== 'undefined' ? document.getElementById('alarm-clock-btn') : null;
    if (btn && !btn.__gaBound) { btn.__gaBound = true; btn.addEventListener('click', open); }
  }

  return { init: init, open: open, _scan: scan, _tick: tick, _show: showPrompt, _next: nextOccurrenceMs };
})();
