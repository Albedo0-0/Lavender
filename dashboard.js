// dashboard.js — Dashboard screen shell + Phase 3B boxes (Tasks, Habits).
// Depends on: Nav (guarded). Load after nav.js. Owns the markup of #screen-dashboard.
// Nav.switchTo('dashboard') calls Dashboard.render(); Dashboard.init() wires the existing Lavender
// sidebar plaque (.nav-brand) to open this screen without touching its markup or styling.
// Box 8 (Tasks) is view-only: it reads PlanningAgentTasks and opens the existing Plan Viewer
// (PlanningAgentUI). Box 3 (Habits) is marking-only: it marks through Habits.mark -> HabitData.
// The only state held here is UI selection (task view/date, menu open); no task or habit data is
// copied or stored. The one listener on TimeEngine's shared heartbeat only detects change.

const Dashboard = (function () {
    let bound = false;

  // ---------- Phase 3B: shared display helpers ----------
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function shiftDay(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return dateStr(d); }
  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }

  // ---------- Box 8: Tasks (viewing only) ----------
  // Reads: PlanningAgentTasks (getTasksForDateRange / getCompletedToday / getPendingTasks / getOpenTasks),
  // which return the canonical store's own order (date, then time). Click -> PlanningAgentUI.open().
  const TASK_VIEWS = [['today', 'Today'], ['date', 'Specific date'], ['tomorrow', 'Tomorrow'], ['timeline', 'Timeline'], ['overdue', 'Overdue'], ['unscheduled', 'Unscheduled']];
  let tkView = 'today';
  let tkDate = '';
  let tkMenu = false;
  let tkDay = '';
  let tkBusy = false;
  let tkQueued = false;
  let tkSubscribed = false;
  let tkDocBound = false;

  function hm12(hm, suffix) {
    const h = Number(hm.slice(0, 2));
    return ((h % 12) || 12) + ':' + hm.slice(3, 5) + (suffix ? (h < 12 ? ' AM' : ' PM') : '');
  }

  function timeRange(t) {
    if (!t.startTime) return '';
    if (!t.stopTime) return hm12(t.startTime, true);
    const same = (Number(t.startTime.slice(0, 2)) < 12) === (Number(t.stopTime.slice(0, 2)) < 12);
    return hm12(t.startTime, !same) + '\u2013' + hm12(t.stopTime, true);
  }

  function dayHead(s) {
    const t0 = todayStr(), d = new Date(s + 'T00:00:00');
    const base = DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
    if (s === t0) return 'Today \u00b7 ' + base;
    if (s === shiftDay(t0, 1)) return 'Tomorrow \u00b7 ' + base;
    return base;
  }

  // Same title precedence as the Plan Viewer: legacy planner title, canonical title, topic name.
  function tkTitle(t) {
    const key = String(t.id).indexOf('legacy_') === 0 ? String(t.id).slice(7) : '';
    const lt = (key && typeof PlanData !== 'undefined') ? PlanData.getTask(key) : null;
    return (lt && lt.title) || t.title || (lt && lt.topicName) || 'Task';
  }

  function tkUsable(t) { return !t.archived && !t.completed && t.type !== 'break'; }

  // Keeps the store's order; only starts a new section when the date changes.
  function tkByDay(tasks) {
    const out = [], idx = {};
    tasks.forEach(function (t) {
      const k = t.date || '';
      if (!(k in idx)) { idx[k] = out.length; out.push({ head: k ? dayHead(k) : '', tasks: [] }); }
      out[idx[k]].tasks.push(t);
    });
    return out;
  }

  function tkData() {
    if (typeof PlanningAgentTasks === 'undefined') return null;
    const t0 = todayStr();
    if (tkView === 'overdue') return { sections: tkByDay(PlanningAgentTasks.getPendingTasks().filter(tkUsable)), empty: 'Nothing overdue.', ctx: function (t) { return 'tray:overdue'; }, when: true };
        if (tkView === 'unscheduled') return { sections: [{ head: '', tasks: PlanningAgentTasks.getOpenTasks().filter(function (t) { return tkUsable(t) && !t.date; }).concat(tkEmptyPlans()) }], empty: 'Nothing is waiting for a date.', ctx: function (t) { return 'tray:unscheduled'; }, when: false };
    if (tkView === 'timeline') return { sections: tkByDay(PlanningAgentTasks.getOpenTasks().filter(function (t) { return tkUsable(t) && t.date && t.date >= t0; })), empty: 'Nothing planned ahead.', ctx: function (t) { return 'day:' + t.date; }, when: true };
    const d = tkView === 'tomorrow' ? shiftDay(t0, 1) : (tkView === 'date' ? (tkDate || t0) : t0);
    let list = PlanningAgentTasks.getTasksForDateRange(d, d).filter(tkUsable);
    if (d === t0) {
      // Today also lists what was completed today, exactly like the Plan Viewer's Today view.
      const seen = {};
      list.forEach(function (t) { seen[t.id] = true; });
      list = list.concat(PlanningAgentTasks.getCompletedToday().filter(function (t) { return !seen[t.id] && !t.archived && t.type !== 'break'; }));
    }
    return { sections: [{ head: '', tasks: list }], empty: d === t0 ? 'Nothing planned for today.' : 'Nothing planned for this day.', ctx: function (t) { return 'day:' + d; }, when: true };
  }

    // A subtask's parent is its Plan (a target with isPlan), exactly as the Plan Viewer groups them.
  function tkParent(t) {
    if (t.isPlan || !t.targetId || typeof TargetsData === 'undefined') return '';
    const tg = TargetsData.getTarget(t.targetId);
    return tg && tg.isPlan ? (tg.title || 'Plan') : '';
  }

  // Plans with no subtasks have nothing else to stand in for them, so they are listed as themselves
  // (same rule and same place as the Plan Viewer: its Unscheduled tray).
  function tkEmptyPlans() {
    if (typeof TargetsData === 'undefined' || typeof CanonicalTaskStore === 'undefined') return [];
    PlanningAgentTasks.sync();
    return TargetsData.getAllTargetsList().filter(function (p) {
      return p.isPlan && !p.archived && !CanonicalTaskStore.getTasks({ targetId: p.targetId, status: ['pending', 'completed'] }).length;
    }).map(function (p) { return { id: p.targetId, isPlan: true, title: p.title, subject: p.subject || '', completed: false }; });
  }

  function tkRow(t, ctx, withWhen) {
    const parent = tkParent(t);
    return '<button type="button" class="dtk-row' + (t.completed ? ' dtk-done' : '') + '" data-id="' + esc(t.id) + '" data-kind="' + (t.isPlan ? 'plan' : 'task') + '" data-open="' + esc(ctx) + '">' +
      (withWhen ? '<span class="dtk-when">' + esc(timeRange(t) || 'Anytime') + '</span>' : '') +
      '<span class="dtk-main"><span class="dtk-title">' + esc(tkTitle(t)) + '</span>' +
        (parent ? '<span class="dtk-parent">' + esc(parent) + '</span>' : '') + '</span>' +
      (t.subject ? '<span class="dtk-meta">' + esc(t.subject) + '</span>' : '') +
      '</button>';
  }

  function tkBarHtml() {
    const cur = TASK_VIEWS.filter(function (v) { return v[0] === tkView; })[0] || TASK_VIEWS[0];
    return '<div class="dtk-bar">' +
      '<div class="dtk-sel' + (tkMenu ? ' dtk-open' : '') + '">' +
        '<button type="button" class="dtk-sel-btn" data-dtk="menu" aria-haspopup="listbox" aria-expanded="' + tkMenu + '">' + esc(cur[1]) + '</button>' +
        (tkMenu ? '<ul class="dtk-menu" role="listbox" aria-label="Task view">' + TASK_VIEWS.map(function (v) {
          const on = v[0] === tkView;
          return '<li role="option" aria-selected="' + on + '"><button type="button" class="dtk-opt' + (on ? ' dtk-opt-on' : '') + '" data-dtk="view" data-val="' + v[0] + '">' + esc(v[1]) + '</button></li>';
        }).join('') + '</ul>' : '') +
      '</div>' +
      (tkView === 'date'
        ? '<div class="dtk-date"><button type="button" class="dtk-nav" data-dtk="prev" aria-label="Previous day">&lsaquo;</button>' +
          '<input type="date" class="dtk-date-input" value="' + esc(tkDate || todayStr()) + '" aria-label="Choose a date">' +
          '<button type="button" class="dtk-nav" data-dtk="next" aria-label="Next day">&rsaquo;</button></div>'
        : '') +
    '</div>';
  }

  function tkListHtml(data) {
    if (!data) return '<div class="dtk-list"><p class="dtk-empty">Tasks are unavailable.</p></div>';
    const total = data.sections.reduce(function (n, s) { return n + s.tasks.length; }, 0);
    if (!total) return '<div class="dtk-list"><p class="dtk-empty">' + esc(data.empty) + '</p></div>';
    return '<div class="dtk-list">' + data.sections.map(function (s) {
      return '<div class="dtk-group">' + (s.head ? '<div class="dtk-day">' + esc(s.head) + '</div>' : '') +
        s.tasks.map(function (t) { return tkRow(t, data.ctx(t), data.when); }).join('') + '</div>';
    }).join('') + '</div>';
  }

  function renderTasks(resetScroll) {
    const host = document.querySelector('#dash-tasks .dash-body');
    if (!host) return;
    bindTasks(host);
    subscribeTasks();
    const prev = host.querySelector('.dtk-list');
    const keep = (prev && !resetScroll) ? prev.scrollTop : 0;
    let html;
    tkBusy = true;
    try { html = tkBarHtml() + tkListHtml(tkData()); }
    catch (err) { console.warn('Dashboard tasks render failed', err); html = tkBarHtml() + '<div class="dtk-list"><p class="dtk-empty">Tasks are unavailable.</p></div>'; }
    finally { tkBusy = false; }
    host.innerHTML = html;
    const list = host.querySelector('.dtk-list');
    if (list) list.scrollTop = keep;
    tkDay = todayStr();
  }

  // Opens the existing Plan Viewer on the day (or Overdue / Unscheduled tray) the task belongs to,
  // then expands that task using the viewer's own controls. Nothing is edited from the Dashboard.
    function openInViewer(id, ctx, kind) {
    if (typeof PlanningAgentUI === 'undefined' || !PlanningAgentUI.open) return;
        const where = String(ctx).split(':')[0], val = String(ctx).slice(where.length + 1);
    PlanningAgentUI.open(where === 'tray' ? { view: 'today' } : (val === todayStr() ? { view: 'today' } : { view: 'pick', date: val }));
    try {
      const root = document.getElementById('modal-content');
      if (!root) return;
            if (where === 'tray') {
        const tray = root.querySelector('[data-pl="d-tray"][data-val="' + val + '"]');
        if (tray) tray.click();
      }
      const want = (kind === 'plan' ? 'p:' : 't:') + id + ':' + (where === 'tray' ? 'tray' : val);
      const hit = Array.prototype.filter.call(root.querySelectorAll('[data-pl="d-open"]'), function (b) { return b.dataset.k === want; })[0];
      if (hit) hit.click();
    } catch (err) { /* the viewer is open; expanding the row is best-effort */ }
  }

  function bindTasks(host) {
    if (!tkDocBound) {
      tkDocBound = true;
      document.addEventListener('click', function (e) {
        if (!tkMenu) return;
        const path = e.composedPath ? e.composedPath() : [];
        const inside = path.some(function (n) { return n.classList && n.classList.contains('dtk-sel'); });
        if (!inside) { tkMenu = false; renderTasks(false); }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && tkMenu) { tkMenu = false; renderTasks(false); }
      });
    }
    if (host.dataset.dtkBound) return;
    host.dataset.dtkBound = '1';
    host.addEventListener('click', function (e) {
      const row = e.target.closest('.dtk-row');
            if (row) { openInViewer(row.dataset.id, row.dataset.open, row.dataset.kind); return; }
      const el = e.target.closest('[data-dtk]');
      if (!el) return;
      const act = el.dataset.dtk;
      if (act === 'menu') { tkMenu = !tkMenu; renderTasks(false); }
      else if (act === 'view') {
        if (!TASK_VIEWS.some(function (v) { return v[0] === el.dataset.val; })) return;
        tkView = el.dataset.val; tkMenu = false;
        if (tkView === 'date' && !tkDate) tkDate = todayStr();
        renderTasks(true);
      } else if (act === 'prev' || act === 'next') {
        tkDate = shiftDay(tkDate || todayStr(), act === 'next' ? 1 : -1);
        renderTasks(true);
      }
    });
    host.addEventListener('change', function (e) {
      const inp = e.target.closest('.dtk-date-input');
      if (inp && isDateStr(inp.value)) { tkDate = inp.value; renderTasks(true); }
    });
  }

  // The store's own change event keeps the box current (the Plan Viewer, Task Manager, Calendar and
  // alarms all write through it). Coalesced to one render; skipped while the Dashboard is hidden.
  function subscribeTasks() {
    if (tkSubscribed || typeof CanonicalTaskStore === 'undefined' || !CanonicalTaskStore.subscribe) return;
    tkSubscribed = true;
    CanonicalTaskStore.subscribe(function () {
      if (tkBusy || tkQueued) return;
      tkQueued = true;
      Promise.resolve().then(function () {
        tkQueued = false;
        const host = document.querySelector('#dash-tasks .dash-body');
        if (host && host.offsetParent !== null) renderTasks(false);
      });
    });
  }

  // ---------- Box 3: Habits (marking only) ----------
  // Every mark goes through Habits.mark(), which runs habits.js's own tap / long-press-undo code
  // (Water, Sleep and the generic HabitData.tap). This box only displays today's log and forwards gestures.
  const HAB_LONG_PRESS_MS = 450; // same threshold as habits.js
  let habSig = '';
  let liveOn = false;

  function habState(h, log) {
    const c = log ? (log.count || 0) : 0;
    if (h.systemKey === 'sleep') {
      const st = (log && log.subStates) || {};
      const bed = st.sleep && st.sleep.done ? st.sleep.time : null;
      const wake = st.wake_up && st.wake_up.done ? st.wake_up.time : null;
      return { pct: (bed ? 50 : 0) + (wake ? 50 : 0), label: 'Bed ' + (bed || '\u2013') + '   Wake ' + (wake || '\u2013') };
    }
    if (h.systemKey === 'water') {
      const t = (log && log.target) || h.target || 1;
      const p = Math.min(100, Math.round(c / t * 100));
      return { pct: p, label: p + '%' };
    }
    if (h.type === 'binary') return { pct: c >= 1 ? 100 : 0, label: c >= 1 ? 'Done' : 'Not done' };
    if (h.type === 'target') {
      const t = (log && log.target) || h.target || 1;
      return { pct: Math.min(100, Math.round(c / t * 100)), label: c + ' / ' + t };
    }
    return { pct: c > 0 ? 35 : 0, label: String(c) }; // counter: tracking only
  }

  function habItems() {
    const d = HabitData.todayStr();
    return HabitData.getHabits().map(function (h) {
      const s = habState(h, HabitData.getLog(h.habitId, d));
      return { h: h, date: d, pct: s.pct, label: s.label };
    });
  }

  function habSignature(items) {
    return HabitData.todayStr() + '#' + items.map(function (it) {
      return [it.h.habitId, it.h.title, it.h.type, it.h.target, it.pct, it.label].join('|');
    }).join('~');
  }

  function renderHabits() {
    const host = document.querySelector('#dash-habits .dash-body');
    if (!host) return;
    bindHabits(host);
    if (typeof HabitData === 'undefined') { host.innerHTML = '<p class="dhb-empty">Habits are unavailable.</p>'; return; }
    const items = habItems();
    habSig = habSignature(items);
    const prev = host.querySelector('.dhb-track');
    const keep = prev ? prev.scrollLeft : 0;
    host.innerHTML = items.length
      ? '<div class="dhb-track" role="list">' + items.map(function (it) {
          return '<div class="dhb-slide" role="listitem">' +
            '<span class="dhb-title">' + esc(it.h.title) + '</span>' +
            '<button type="button" class="dhb-mark' + (it.pct >= 100 ? ' dhb-full' : '') + '" data-habit="' + esc(it.h.habitId) + '" data-date="' + it.date + '" style="--dhb-fill:' + it.pct + '%" aria-label="Mark ' + esc(it.h.title) + '">' + esc(it.label) + '</button>' +
            '<span class="dhb-hint">Tap to mark \u00b7 hold to undo</span></div>';
        }).join('') + '</div>'
      : '<p class="dhb-empty">No habits yet.</p>';
    const track = host.querySelector('.dhb-track');
    if (track) track.scrollLeft = keep;
  }

  function markHabit(habitId, date, dir) {
    if (typeof Habits === 'undefined' || !Habits.mark) { console.warn('Dashboard habits: Habits.mark is not available'); return; }
    Habits.mark(habitId, date, dir);
    renderHabits();
  }

  // Same gesture scheme as habits.js: tap = step forward, long press = step back.
  function bindHabits(host) {
    if (host.dataset.dhbBound) return;
    host.dataset.dhbBound = '1';
    let press = null;
    let suppress = false;
    host.addEventListener('click', function (e) {
      if (suppress) { e.stopImmediatePropagation(); e.preventDefault(); return; }
      const b = e.target.closest('.dhb-mark');
      if (b && !b.disabled) markHabit(b.dataset.habit, b.dataset.date, 1);
    });
    host.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      const b = e.target.closest('.dhb-mark');
      if (!b) return;
      const p = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false, habit: b.dataset.habit, date: b.dataset.date };
      press = p;
      p.timer = setTimeout(function () { p.fired = true; markHabit(p.habit, p.date, -1); }, HAB_LONG_PRESS_MS);
    });
    host.addEventListener('pointermove', function (e) {
      if (!press || e.pointerId !== press.id || press.fired) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; }
    });
    function endPress(e) {
      if (!press || e.pointerId !== press.id) return;
      clearTimeout(press.timer);
      const p = press;
      press = null;
      if (p.fired) { suppress = true; setTimeout(function () { suppress = false; }, 0); }
    }
    host.addEventListener('pointerup', endPress);
    host.addEventListener('pointercancel', endPress);
    host.addEventListener('contextmenu', function (e) { if (e.target.closest('.dhb-mark')) e.preventDefault(); });
  }

  // One subscriber on TimeEngine's shared heartbeat (stable id, so a re-run replaces rather than stacks).
  // It only compares what is displayed against what is now canonical, so changes made in the Assistant
  // Habits menu (or anywhere else) show up here, and the day rolling over refreshes both boxes.
  function liveTick() {
    const hb = document.querySelector('#dash-habits .dash-body');
    if (hb && hb.offsetParent !== null && typeof HabitData !== 'undefined' && habSignature(habItems()) !== habSig) renderHabits();
    const tb = document.querySelector('#dash-tasks .dash-body');
    if (tb && tb.offsetParent !== null && tkDay && tkDay !== todayStr()) renderTasks(false);
  }

  function startLive() {
    if (liveOn || typeof TimeEngine === 'undefined' || !TimeEngine.subscribe) return;
    liveOn = true;
    TimeEngine.subscribe(liveTick, 'dashboard-live');
  }

  function box(cls, id, label, aria, hasBody) {
    return '<section class="dash-box ' + cls + '" id="' + id + '" aria-label="' + aria + '">' +
      (label ? '<span class="dash-label" aria-hidden="true">' + label + '</span>' : '') +
      (hasBody ? '<div class="dash-body"></div>' : '') +
      '</section>';
  }

  function markup() {
    return '<div class="dash">' +
      '<div class="dash-left">' +
        box('dash-entity', 'dash-entity', 'Entity', 'Entity area', false) +
        '<div class="dash-row dash-row-1">' +
          box('dash-b1', 'dash-reflection', 'Daily Reflection', 'Daily Reflection', true) +
          box('dash-b2', 'dash-custom', 'Custom Content', 'Custom Content', true) +
        '</div>' +
        '<div class="dash-row dash-row-2">' +
          box('dash-b3', 'dash-habits', 'Habits', 'Habits', true) +
          box('dash-b4', 'dash-personal', 'Personal Space', 'Personal Space', true) +
        '</div>' +
        '<div class="dash-row dash-row-3">' +
          box('dash-b5', 'dash-overview', 'Study Overview', 'Study Overview', true) +
          box('dash-b6', 'dash-analytics', 'Study Analytics', 'Study Analytics', true) +
        '</div>' +
      '</div>' +
      '<div class="dash-right">' +
        box('dash-b7', 'dash-calendar', '', 'Calendar and Upcoming', true) +
        box('dash-b8', 'dash-tasks', 'Tasks', 'Unified Task Workspace', true) +
      '</div>' +
    '</div>';
  }

  // Idempotent: builds the shell once, safe to call on every visit and after a backup restore.
  function render() {
    const root = document.getElementById('screen-dashboard');
    if (!root) return;
    if (!root.querySelector('.dash')) root.innerHTML = markup();
    const ctx = document.getElementById('nav-context-label');
    if (ctx) ctx.textContent = 'Dashboard';
        if (typeof DashboardCalendar !== 'undefined' && DashboardCalendar.render) DashboardCalendar.render();
    renderTasks(false);
    renderHabits();
    startLive();
  }

  // Binds the existing Lavender plaque once. Adds no attributes, classes or styles to it.
  function init() {
    if (bound) return;
    const brand = document.querySelector('#main-nav .nav-brand');
    if (!brand) return;
    bound = true;
    brand.addEventListener('click', function () {
      if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('dashboard');
    });
  }

  return { init, render };
})();
