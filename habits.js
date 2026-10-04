// habits.js — Habit Tracker UI (Utility Drawer -> Habits). Depends on: State, Modal, Notify, TimeEngine,
// TagsData, HabitData, WaterData, Water, SleepData. Reuses the shared Modal for the tracker, builder,
// sleep editor and reminder popup; reuses TagsData for tags; colours go through the same color-mix
// pastel rule as Calendar's .cal-colored (see style.css). Reminders ride TimeEngine's single heartbeat
// via a stable subscriber id and are delivered through Modal popup + Notify.deliver, like Water's.
const Habits = (function () {
  const SUBSCRIBER_ID = 'habits';
  const LONG_PRESS_MS = 450;
  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  let weekStartStr = null;
  let editMode = false;
  let _iconBtnRef = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDay(dateStr) { return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

  // ---------- cell rendering ----------
  function cellInfo(h, log) {
    const c = log ? (log.count || 0) : 0;
    if (h.systemKey === 'sleep') {
      const st = (log && log.subStates) || {};
      const on = function (id) { return st[id] && st[id].done; };
      const dot = function (id) { return '<span class="hab-dot' + (on(id) ? ' hab-dot-on' : '') + '"></span>'; };
      // Two quiet dots (bedtime, wake-up); the cell tints once either is recorded.
      return { pct: (on('sleep') || on('wake_up')) ? 100 : 0, text: '<span class="hab-dots">' + dot('sleep') + dot('wake_up') + '</span>', noCheck: true };
    }
    if (h.type === 'binary') return { pct: c >= 1 ? 100 : 0, text: '' };
    if (h.type === 'target') {
      const t = (log && log.target) || h.target || 1;
      return { pct: Math.min(100, Math.round(c / t * 100)), text: '' };
    }
    return { pct: c > 0 ? 35 : 0, text: c > 0 ? String(c) : '' }; // counter: tracking only
  }

  function rowHtml(h, dates, today) {
    const cells = dates.map(function (d) {
      const info = cellInfo(h, HabitData.getLog(h.habitId, d));
      return '<button type="button" class="hab-cell' + (d === today ? ' hab-today' : '') + (info.pct > 0 ? ' hab-has' : '') + (info.pct >= 100 && !info.noCheck ? ' hab-full' : '') + '"' +
        ' data-habit="' + h.habitId + '" data-date="' + d + '" style="--hab-fill:' + info.pct + '%"' + (d > today ? ' disabled' : '') +
        ' aria-label="' + esc(h.title) + ' ' + d + '">' + info.text + '</button>';
    }).join('');
    return '<div class="hab-row" data-habit="' + h.habitId + '" style="--hab-color:' + esc(h.color) + '">' +
      '<div class="hab-title-wrap">' +
        (editMode ? '<button type="button" class="hab-mini" data-act="edit" data-habit="' + h.habitId + '" aria-label="Edit">&#9998;</button>' : '') +
        '<span class="hab-title">' + esc(h.title) + '</span>' +
        (editMode && !h.systemKey ? '<button type="button" class="hab-mini" data-act="del" data-habit="' + h.habitId + '" aria-label="Delete">&times;</button>' : '') +
      '</div>' + cells + '</div>';
  }

  function render() {
    const root = document.getElementById('habits-root');
    if (!root) return;
    const today = HabitData.todayStr();
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(HabitData.shiftDate(weekStartStr, i));
    const atCurrentWeek = weekStartStr >= HabitData.weekStart(today);
    const habits = HabitData.getHabits();
    root.innerHTML =
      '<div class="hab-nav"><button type="button" data-act="prev" aria-label="Previous week">&lsaquo;</button>' +
        '<span>' + fmtDay(dates[0]) + ' &ndash; ' + fmtDay(dates[6]) + '</span>' +
        '<button type="button" data-act="next" aria-label="Next week"' + (atCurrentWeek ? ' disabled' : '') + '>&rsaquo;</button></div>' +
      '<div class="hab-days"><span class="hab-col-label">Habit</span>' + dates.map(function (d, i) {
        return '<span' + (d === today ? ' class="hab-today-label"' : '') + '>' + DAY_LABELS[i] + '<small>' + parseInt(d.slice(8), 10) + '</small></span>';
      }).join('') + '</div>' +
      '<div id="habits-list">' + (habits.length ? habits.map(function (h) { return rowHtml(h, dates, today); }).join('')
        : '<p class="empty-state">No habits yet.</p>') + '</div>' +
      '<div class="hab-controls">' +
        '<button type="button" data-act="toggle-edit" class="hab-ctl' + (editMode ? ' hab-ctl-on' : '') + '" aria-label="Edit mode">&#9998;</button>' +
        '<button type="button" data-act="add" class="hab-ctl" aria-label="Add habit">+</button></div>';
  }

  // ---------- open / interactions ----------
  function show(reset) {
    HabitData.ensureSystemHabits(); // self-heals after Settings -> clear all data without a reload
    if (reset || !weekStartStr) { weekStartStr = HabitData.weekStart(HabitData.todayStr()); editMode = false; }
    Modal.open('<div class="hab-shell"><h3 class="section-heading">Habits</h3><div id="habits-root"></div></div>', { size: 'lg' });
    bindRoot(document.getElementById('habits-root'));
    render();
  }
  function reopen() { show(false); }

  // Water tap: one WaterData entry (the smallest category) per tap, stopping at the day's target
  // like Target habits do. Goes through the existing WaterData adapter, so history stays canonical.
  function waterTap(dateStr) {
    const log = HabitData.getLog(HabitData.WATER_ID, dateStr);
    if (log && (log.count || 0) >= (log.target || HabitData.WATER_CAP)) return;
    const cats = WaterData.CATEGORIES || {};
    const keys = Object.keys(cats).sort(function (a, b) { return (cats[a].value || 0) - (cats[b].value || 0); });
    if (keys.length) WaterData.logEvent(dateStr, keys[0]);
  }

  // Sleep tap: one step per tap (bedtime, then wake-up), saved through SleepData with the times
  // configured on the Sleep habit. dir = -1 steps back one. No editor, no modal.
  function sleepTap(h, dateStr, dir) {
    const rec = SleepData.getRecord(dateStr) || {};
    const subs = h.subHabits || [];
    const planned = function (id, fallback) {
      const s = subs.filter(function (x) { return x.id === id; })[0];
      return s && s.time ? s.time : fallback;
    };
    let bed = rec.sleepTime || null, wake = rec.wakeTime || null;
    if (dir < 0) {
      if (!bed && !wake) return;
      if (wake) wake = null; else bed = null;
    } else if (!bed) bed = planned('sleep', '23:00');
    else if (!wake) wake = planned('wake_up', '07:30');
    else return;
    SleepData.saveRecord(dateStr, { sleepTime: bed, wakeTime: wake });
  }

  function onCell(habitId, dateStr) {
    const h = HabitData.getHabit(habitId);
    if (!h) return;
    if (h.systemKey === 'water') waterTap(dateStr);
    else if (h.systemKey === 'sleep') sleepTap(h, dateStr, 1);
    else HabitData.tap(habitId, dateStr, 1);
    render();
  }

  function onCellUndo(habitId, dateStr) {
    const h = HabitData.getHabit(habitId);
    if (!h) return;
    if (h.systemKey === 'sleep') sleepTap(h, dateStr, -1);
    else if (h.systemKey === 'water') HabitData.removeLastWaterEvent(dateStr);
    else HabitData.tap(habitId, dateStr, -1);
    render();
  }

  function bindRoot(root) {
    if (!root) return;
    let press = null;
    let suppress = false;

    root.addEventListener('click', function (e) {
      if (suppress) { e.stopImmediatePropagation(); e.preventDefault(); return; }
      const cell = e.target.closest('.hab-cell');
      if (cell) { if (!cell.disabled) onCell(cell.dataset.habit, cell.dataset.date); return; }
      const actEl = e.target.closest('[data-act]');
      if (!actEl || actEl.disabled) return;
      const act = actEl.dataset.act;
      if (act === 'prev') { weekStartStr = HabitData.shiftDate(weekStartStr, -7); render(); }
      else if (act === 'next') { weekStartStr = HabitData.shiftDate(weekStartStr, 7); render(); }
      else if (act === 'toggle-edit') { editMode = !editMode; render(); }
      else if (act === 'add') openBuilder(null);
      else if (act === 'edit') openBuilder(actEl.dataset.habit);
      else if (act === 'del') {
        const h = HabitData.getHabit(actEl.dataset.habit);
        if (h && confirm('Archive "' + h.title + '"? Its history is kept.')) { HabitData.archiveHabit(h.habitId); render(); }
      }
    }, true);

    root.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      const el = e.target.closest('.hab-title, .hab-cell');
      if (!el || el.disabled) return;
      const p = { el: el, x: e.clientX, y: e.clientY, id: e.pointerId, fired: false, drag: false, row: null };
      press = p;
      p.timer = setTimeout(function () {
        p.fired = true;
        if (el.classList.contains('hab-title')) {
          p.row = el.closest('.hab-row');
          if (!p.row) return;
          p.drag = true;
          p.row.classList.add('hab-dragging');
          try { root.setPointerCapture(p.id); } catch (err) { /* best-effort */ }
        } else {
          onCellUndo(el.dataset.habit, el.dataset.date);
        }
      }, LONG_PRESS_MS);
    });

    root.addEventListener('pointermove', function (e) {
      if (!press || e.pointerId !== press.id) return;
      if (!press.fired) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; }
        return;
      }
      if (!press.drag) return;
      const list = document.getElementById('habits-list');
      const rows = Array.prototype.slice.call(list.querySelectorAll('.hab-row')).filter(function (r) { return r !== press.row; });
      const before = rows.find(function (r) { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
      if (before) list.insertBefore(press.row, before); else list.appendChild(press.row);
    });

    function endPress(e) {
      if (!press || e.pointerId !== press.id) return;
      clearTimeout(press.timer);
      const p = press;
      press = null;
      if (p.drag) {
        const ids = Array.prototype.map.call(document.querySelectorAll('#habits-list .hab-row'), function (r) { return r.dataset.habit; });
        HabitData.reorder(ids);
        try { root.releasePointerCapture(p.id); } catch (err) { /* best-effort */ }
        render();
      }
      if (p.fired) { suppress = true; setTimeout(function () { suppress = false; }, 0); }
    }
    root.addEventListener('pointerup', endPress);
    root.addEventListener('pointercancel', endPress);
    // Once a reorder drag is armed, stop the page from scrolling under the finger.
    root.addEventListener('touchmove', function (e) { if (press && press.drag) e.preventDefault(); }, { passive: false });
    root.addEventListener('contextmenu', function (e) { if (e.target.closest('.hab-title, .hab-cell')) e.preventDefault(); });
  }

  // ---------- Sleep editor (writes through SleepData -> HabitData) ----------
  function openSleepEditor(h, dateStr) {
    const rec = SleepData.getRecord(dateStr);
    const subs = h.subHabits || [];
    const planned = function (id) { const s = subs.filter(function (x) { return x.id === id; })[0]; return s && s.time ? s.time : ''; };
    Modal.open(
      '<h3 class="section-heading">Sleep &middot; ' + fmtDay(dateStr) + '</h3>' +
      '<label>Bedtime (night before)<br><input type="time" id="hab-sleep-bed" class="input" value="' + (rec.sleepTime || planned('sleep')) + '"></label>' +
      '<label>Wake up<br><input type="time" id="hab-sleep-wake" class="input" value="' + (rec.wakeTime || planned('wake_up')) + '"></label>' +
      '<div class="chip-row"><button type="button" id="hab-sleep-save" class="btn btn-primary">Save</button>' +
      '<button type="button" id="hab-sleep-clear" class="btn btn-secondary">Clear</button>' +
      '<button type="button" id="hab-sleep-cancel" class="btn btn-secondary">Cancel</button></div>'
    );
    document.getElementById('hab-sleep-save').addEventListener('click', function () {
      SleepData.saveRecord(dateStr, {
        sleepTime: document.getElementById('hab-sleep-bed').value || null,
        wakeTime: document.getElementById('hab-sleep-wake').value || null
      });
      reopen();
    });
    document.getElementById('hab-sleep-clear').addEventListener('click', function () {
      SleepData.saveRecord(dateStr, { sleepTime: null, wakeTime: null });
      reopen();
    });
    document.getElementById('hab-sleep-cancel').addEventListener('click', reopen);
  }

  // ---------- Habit builder ----------
  function openBuilder(habitId) {
    const h = habitId ? HabitData.getHabit(habitId) : null;
    const sys = h ? h.systemKey : null;
    const tags = TagsData.getAllTagsList();
    const rem = (h && h.reminder) || { enabled: false, mode: 'time', time: '' };
    const remValue = rem.enabled ? rem.mode : 'none';
    const subs = (h && h.subHabits) || [];
    const subTime = function (id) { const s = subs.filter(function (x) { return x.id === id; })[0]; return s && s.time ? s.time : ''; };
    const type = h ? h.type : 'binary';

    Modal.open(
      '<h3 class="section-heading">' + (h ? 'Edit habit' : 'New habit') + '</h3>' +
      '<div class="hab-form">' +
      '<label>Name<input type="text" id="hab-f-title" class="input" value="' + esc(h ? h.title : '') + '"></label>' +
      '<label>Tag<select id="hab-f-tag" class="input"><option value="">None</option>' +
        tags.map(function (t) { return '<option value="' + t.tagId + '" data-color="' + esc(t.color) + '"' + (h && h.tagId === t.tagId ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<label>Or new tag<input type="text" id="hab-f-newtag" class="input" placeholder="New tag name"></label>' +
      '<label>Colour<input type="color" id="hab-f-color" class="input" value="' + esc(h ? h.color : '#b39ddb') + '"></label>' +
      '<label>Type<select id="hab-f-type" class="input"' + (sys ? ' disabled' : '') + '>' +
        ['binary', 'target', 'counter'].map(function (t) { return '<option value="' + t + '"' + (type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join('') +
      '</select></label>' +
      '<label id="hab-f-target-row"' + (type === 'target' ? '' : ' style="display:none"') + '>Target amount<input type="number" min="1" id="hab-f-target" class="input" value="' + (h && h.target ? h.target : 3) + '"' + (sys ? ' disabled' : '') + '></label>' +
      (sys === 'sleep'
        ? '<label>Wake up time<input type="time" id="hab-f-wake" class="input" value="' + subTime('wake_up') + '"></label>' +
          '<label>Sleep time<input type="time" id="hab-f-sleep" class="input" value="' + subTime('sleep') + '"></label>' : '') +
      (sys === 'water' ? '' :
        '<label>Reminder<select id="hab-f-rem" class="input">' +
          [['none', 'None'], ['time', 'At a specific time'], ['open', 'When the app opens']].map(function (o) { return '<option value="' + o[0] + '"' + (remValue === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></label>' +
        '<label id="hab-f-remtime-row"' + (remValue === 'time' ? '' : ' style="display:none"') + '>Reminder time<input type="time" id="hab-f-remtime" class="input" value="' + (rem.time || '') + '"></label>') +
      '</div><p id="hab-f-error" class="form-error"></p>' +
      '<div class="chip-row"><button type="button" id="hab-f-save" class="btn btn-primary">Save</button>' +
      '<button type="button" id="hab-f-cancel" class="btn btn-secondary">Cancel</button></div>'
    );

    const $ = function (id) { return document.getElementById(id); };
    $('hab-f-tag').addEventListener('change', function () {
      const opt = $('hab-f-tag').selectedOptions[0];
      if (opt && opt.dataset.color) $('hab-f-color').value = opt.dataset.color;
    });
    $('hab-f-type').addEventListener('change', function () { $('hab-f-target-row').style.display = $('hab-f-type').value === 'target' ? '' : 'none'; });
    if ($('hab-f-rem')) $('hab-f-rem').addEventListener('change', function () { $('hab-f-remtime-row').style.display = $('hab-f-rem').value === 'time' ? '' : 'none'; });
    $('hab-f-cancel').addEventListener('click', reopen);

    $('hab-f-save').addEventListener('click', function () {
      const title = $('hab-f-title').value.trim();
      if (!title) { $('hab-f-error').textContent = 'Give the habit a name.'; return; }
      const color = $('hab-f-color').value;
      const newTag = $('hab-f-newtag').value.trim();
      const tagId = newTag ? TagsData.getOrCreateTagByName(newTag, color).tagId : ($('hab-f-tag').value || null);
      const t = sys ? h.type : $('hab-f-type').value;
      const target = t === 'target' ? (sys ? h.target : Math.max(1, parseInt($('hab-f-target').value, 10) || 1)) : null;
      const fields = { habitId: h ? h.habitId : undefined, title: title, tagId: tagId, color: color, type: t, target: target };
      if (sys === 'sleep') {
        fields.subHabits = subs.map(function (s) {
          const el = $(s.id === 'wake_up' ? 'hab-f-wake' : 'hab-f-sleep');
          return Object.assign({}, s, { time: el && el.value ? el.value : s.time });
        });
      }
      if (sys !== 'water') {
        const mode = $('hab-f-rem').value;
        const time = $('hab-f-remtime').value;
        if (mode === 'time' && !time) { $('hab-f-error').textContent = 'Pick a reminder time.'; return; }
        fields.reminder = mode === 'none' ? (h && h.reminder ? Object.assign({}, h.reminder, { enabled: false }) : null)
          : { enabled: true, mode: mode, time: mode === 'time' ? time : '', lastFiredDate: h && h.reminder ? h.reminder.lastFiredDate || null : null };
      }
      HabitData.saveHabit(fields);
      reopen();
    });
  }

  // ---------- reminders (TimeEngine heartbeat -> shared Modal popup + Notify) ----------
  function pollReminders() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && overlay.style.display === 'flex') return; // never interrupt an open modal/prompt
    const now = new Date();
    const today = HabitData.todayStr();
    const hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const due = HabitData.getHabits().filter(function (h) {
      const r = h.reminder;
      if (!r || !r.enabled || h.systemKey === 'water' || r.lastFiredDate === today) return false;
      const log = HabitData.getLog(h.habitId, today);
      if (log && log.completed) return false;
      return r.mode === 'open' || (r.mode === 'time' && r.time && hhmm >= r.time);
    })[0];
    if (due) showReminder(due, today);
  }

  function showReminder(h, today) {
    HabitData.markReminderFired(h.habitId, today); // once per day; no backlog
    Modal.open(
      '<h3 class="section-heading">' + esc(h.title) + '</h3><p>Habit reminder</p>' +
      '<button type="button" id="hab-rem-open" class="btn btn-primary">Open Habits</button> ' +
      '<button type="button" id="hab-rem-later" class="btn btn-secondary">Dismiss</button>',
      { popup: true }
    );
    document.getElementById('hab-rem-open').addEventListener('click', function () { show(true); });
    document.getElementById('hab-rem-later').addEventListener('click', function () { Modal.close(); });
    Notify.deliver('Habit reminder', h.title);
  }

  function handleIconClick() { show(true); }

  function init() {
    const btn = document.getElementById('habits-icon');
    if (btn) {
      if (_iconBtnRef) _iconBtnRef.removeEventListener('click', handleIconClick);
      btn.addEventListener('click', handleIconClick);
      _iconBtnRef = btn;
    }
    TimeEngine.subscribe(pollReminders, SUBSCRIBER_ID); // stable id: re-init replaces, never stacks
  }

  return { init: init, open: function () { show(true); } };
})();
