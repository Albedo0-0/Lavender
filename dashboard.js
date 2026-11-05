// dashboard.js — Dashboard screen shell + Phase 3B boxes (Tasks, Habits).
// Depends on: Nav (guarded). Load after nav.js. Owns the markup of #screen-dashboard.
// Nav.switchTo('dashboard') calls Dashboard.render(); Dashboard.init() wires the existing Lavender
// sidebar plaque (.nav-brand) to open this screen without touching its markup or styling.
// Box 8 (Tasks) is view-only: it reads PlanningAgentTasks and opens the existing Plan Viewer
// (PlanningAgentUI). Box 3 (Habits) is marking-only: it marks through Habits.mark -> HabitData.
// The only state held here is UI selection (task view/date, menu open); no task or habit data is
// copied or stored. The one listener on TimeEngine's shared heartbeat only detects change.
// Mobile (<= 600px) is pure CSS (dashboard.css): the same markup becomes a 2 x 3 snap-scrolling grid.
// The only mobile-aware code here is the Study Analytics plot, which uses tighter padding and one-letter
// weekday labels when its plot is narrow.

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
  let habIdx = 0;

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

  // Same slide mechanism as Daily Reflection: one habit per slide, arrows + dots, no scrollbar.
  // habIdx is UI selection only; it survives re-renders (marking, live refresh) and is clamped to the habit count.
  function habApply(host) {
    const slides = host.querySelectorAll('.dhb-slide');
    if (!slides.length) return;
    habIdx = ((habIdx % slides.length) + slides.length) % slides.length;
    slides.forEach(function (el, i) { el.hidden = i !== habIdx; });
    host.querySelectorAll('.drf-dot').forEach(function (el) {
      if (Number(el.dataset.hgo) === habIdx) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
    });
  }

  function renderHabits() {
    const host = document.querySelector('#dash-habits .dash-body');
    if (!host) return;
    bindHabits(host);
    if (typeof HabitData === 'undefined') { host.innerHTML = '<p class="dhb-empty">Habits are unavailable.</p>'; return; }
    const items = habItems();
    habSig = habSignature(items);
    const nav = items.length > 1
      ? '<div class="drf-nav" role="group" aria-label="Habit slides">' +
          '<button type="button" class="drf-arrow" data-hnav="-1" aria-label="Previous habit">\u2039</button>' +
          items.map(function (it, i) { return '<button type="button" class="drf-dot" data-hgo="' + i + '" aria-label="' + esc(it.h.title) + '"></button>'; }).join('') +
          '<button type="button" class="drf-arrow" data-hnav="1" aria-label="Next habit">\u203a</button>' +
        '</div>'
      : '';
    host.innerHTML = items.length
      ? nav + '<div class="dhb-track" role="list">' + items.map(function (it) {
          return '<div class="dhb-slide" role="listitem">' +
            '<span class="dhb-title">' + esc(it.h.title) + '</span>' +
            '<button type="button" class="dhb-mark' + (it.pct >= 100 ? ' dhb-full' : '') + '" data-habit="' + esc(it.h.habitId) + '" data-date="' + it.date + '" style="--dhb-fill:' + it.pct + '%" aria-label="Mark ' + esc(it.h.title) + '">' + esc(it.label) + '</button>' +
            '<span class="dhb-hint">Tap to mark \u00b7 hold to undo</span></div>';
        }).join('') + '</div>'
      : '<p class="dhb-empty">No habits yet.</p>';
    habApply(host);
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
      const nv = e.target.closest('[data-hnav]');
      if (nv) { habIdx += Number(nv.dataset.hnav); habApply(host); return; }
      const gv = e.target.closest('[data-hgo]');
      if (gv) { habIdx = Number(gv.dataset.hgo); habApply(host); return; }
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

  // ---------- Merged Box 5 + 6: Study Analytics (metric selector + current-week line graph) ----------
  // Read-only view over PTPE. Every value is PTPE.value(key, date): the single per-day interpretation layer that
  // Progress, the Calendar lenses and the Productivity score already use. Break Balance and Punctuality are not
  // PTPE metrics, so they are read from ProductivityData.getBreakdown(date).factors (the same factors
  // PTPE.whyProductivity() reads). Nothing is stored or recomputed here; only UI selection is held.
  // The week is Monday..today from PTPE.today() (the app's local date); it refreshes on the existing
  // 'dashboard-live' TimeEngine subscriber (liveTick), throttled, so no timer or subscription is added.
  const AN_DEFAULT = 'studyHours';
  const AN_CHECK_MS = 5000;
    let anKey = AN_DEFAULT;
  let anSeen = false;
  let anSel = '';
  let anMenu = false;
  let anModel = null;
  let anSigLast = '';
  let anCheckAt = 0;
  let anDocBound = false;

  function anR1(v) { return Math.round(v * 10) / 10; }
  function anOutOf(max) { return function (v) { return anR1(v) + ' / ' + max; }; }
  function anPct(v) { return Math.round(v) + '%'; }

  // lo/hi = fixed scale (hi null = fitted to the week); sum = PTPE treats an all-zero week as "no data"; grow = scale may extend.
  const AN_METRICS = [
    { id: 'productivity', label: 'Productivity', key: 'productivity', lo: 0, hi: 10, fmt: anOutOf(10), tick: anR1,
      note: 'Daily Productivity score out of 10, combining study, planned work, habits, sleep and more.' },
    { id: 'studyHours', label: 'Study Hours', key: 'studyHours', sum: true, lo: 0, hi: null,
      fmt: function (v) { return PTPE.fmtHours(v); }, tick: function (v) { return anR1(v) + 'h'; },
      note: 'Study time recorded that day: timer sessions plus any hours logged in the journal.' },
    { id: 'questions', label: 'Questions', key: 'questions', sum: true, lo: 0, hi: null,
      fmt: function (v) { const n = Math.round(v); return n + (n === 1 ? ' question' : ' questions'); }, tick: anR1,
      note: 'Questions recorded that day: timer sessions plus any logged in the journal.' },
    { id: 'exp', label: 'EXP', key: 'exp', sum: true, lo: 0, hi: null,
      fmt: function (v) { return Math.round(v) + ' EXP'; }, tick: anR1,
      note: 'EXP credited to that day in the EXP ledger.' },
    { id: 'sleep', label: 'Sleep', key: 'sleep', lo: 0, hi: 12, grow: true,
      fmt: function (v) { return anR1(v) + ' h'; }, tick: function (v) { return anR1(v) + 'h'; },
      note: 'Sleep duration recorded for that day.' },
    { id: 'water', label: 'Water', key: 'water', lo: 0, hi: 10, fmt: anOutOf(10), tick: anR1,
      note: 'Water intake recorded that day, scored out of 10.' },
    { id: 'breakBalance', label: 'Break Balance', factor: 'breakBalance', lo: 0, hi: 10, fmt: anOutOf(10), tick: anR1,
      note: 'Break time against study time: 10 when breaks stay within 30% of study, 0 when they match it. Needs study that day.' },
    { id: 'mood', label: 'Mood', key: 'mood', lo: 1, hi: 5,
      fmt: function (v) { return PTPE.METRICS.mood.fmt(v) + ' \u00b7 ' + anR1(v) + ' / 5'; }, tick: anR1,
      note: 'Mood logged in that day\u2019s journal entry (1 Rough to 5 Great).' },
    { id: 'punctuality', label: 'Punctuality', factor: 'punctuality', lo: 0, hi: 10, fmt: anOutOf(10), tick: anR1,
      note: 'How close study sessions started to their scheduled time: 10 on time, 0 when 45+ min late. Day average.' },
    { id: 'taskCompletion', label: 'Task Completion', key: 'plannerCompletion', lo: 0, hi: 100, fmt: anPct, tick: anPct,
      note: 'Share of that day\u2019s planned tasks marked complete.' },
    { id: 'habits', label: 'Habits', key: 'habitCompletion', lo: 0, hi: 100, fmt: anPct, tick: anPct,
      note: 'Average completion of that day\u2019s habits.' },
    { id: 'tests', label: 'Test Score', key: 'testScore', lo: 0, hi: 100, fmt: anPct, tick: anPct,
      note: 'Average score across tests recorded that day.' }
  ];

  function anMetric() {
    return AN_METRICS.filter(function (m) { return m.id === anKey; })[0] || AN_METRICS[1];
  }

  // Monday of the current week through today. Never a future day.
  function anDates() {
    const t = PTPE.today();
    const dow = (new Date(t + 'T00:00:00').getDay() + 6) % 7; // Monday = 0
    return PTPE.span(shiftDay(t, -dow), t);
  }

  // null = no record (kept distinct from a real 0); anything PTPE reports is passed through unchanged.
  function anValue(m, d) {
    try {
      let v = null;
      if (m.factor) {
        const b = typeof ProductivityData !== 'undefined' && ProductivityData.getBreakdown ? ProductivityData.getBreakdown(d) : null;
        v = b && b.score !== null && b.factors ? b.factors[m.factor] : null;
      } else {
        v = PTPE.value(m.key, d);
      }
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch (err) {
      console.warn('Dashboard analytics value failed', m.id, d, err);
      return null;
    }
  }

  function anSig() {
    const m = anMetric();
    return m.id + '|' + anDates().map(function (d) { return d + ':' + anValue(m, d); }).join(',');
  }

  function anNice(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    const f = v / p;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (let i = 0; i < steps.length; i++) if (f <= steps[i] + 1e-9) return steps[i] * p;
    return 10 * p;
  }

  function anLong(d) {
    const x = new Date(d + 'T00:00:00');
    return DOW[x.getDay()] + ', ' + x.getDate() + ' ' + MON[x.getMonth()] + ' ' + x.getFullYear();
  }

    function anShow(i, valueOnly) {
    const host = document.querySelector('#dash-analytics .dan-plot');
    const tip = host && host.querySelector('.dan-tip');
    if (!tip) return;
    host.querySelectorAll('.dan-pt').forEach(function (g) {
      const on = Number(g.dataset.i) === i;
      g.classList.toggle('dan-on', on);
      g.querySelector('.dan-dot').setAttribute('r', on ? '5' : '3.5');
    });
    const md = anModel;
    if (i < 0 || !md || md.vals[i] === null || md.vals[i] === undefined) { tip.hidden = true; return; }
        tip.innerHTML = valueOnly
      ? '<strong class="dan-tip-val">' + esc(md.m.fmt(md.vals[i])) + '</strong>'
      : '<span class="dan-tip-date">' + esc(anLong(md.dates[i])) + '</span>' +
        '<strong class="dan-tip-val">' + esc(md.m.fmt(md.vals[i])) + '</strong>' +
        '<span class="dan-tip-note">' + esc(md.m.note) + '</span>';
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, x = md.xs[i], y = md.ys[i];
    const left = Math.max(2, Math.min(md.W - tw - 2, x - tw / 2));
    let top = y - th - 12;
    if (top < 0) top = Math.min(Math.max(0, md.H - th), y + 12);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function anPinned() { return anModel ? anModel.dates.indexOf(anSel) : -1; }

  // Draws the selected metric for Monday..today. Returns false when the plot has no size yet (hidden screen);
  // the ResizeObserver / next heartbeat retries.
  function anDraw(animate) {
    const host = document.querySelector('#dash-analytics .dan-plot');
    if (!host) return false;
    const W = host.clientWidth, H = host.clientHeight;
    if (W < 60 || H < 50) return false;
    const m = anMetric(), dates = anDates();
    const vals = dates.map(function (d) { return anValue(m, d); });
    const real = vals.filter(function (v) { return v !== null; });
    anModel = null;
    host.classList.toggle('dan-anim', !!animate);
    if (!real.length || (m.sum && !real.some(function (v) { return v > 0; }))) {
      host.innerHTML = '<p class="dan-empty">Nothing recorded this week yet.</p>';
      return true;
    }
    // A narrow plot (the mobile box) gets tighter side padding and one-letter weekdays so seven labels fit.
    const narrow = W < 240;
    const PL = narrow ? 32 : 38, PR = narrow ? 10 : 20, PT = 12, PB = 22, iw = W - PL - PR, ih = H - PT - PB;
    const maxv = Math.max.apply(null, real);
    const lo = m.lo;
    let hi = m.hi === null ? anNice(maxv) : m.hi;
    if (maxv > hi) hi = m.grow ? Math.ceil(maxv) : anNice(maxv);
    const X = function (i) { return dates.length === 1 ? PL + iw / 2 : PL + i * iw / (dates.length - 1); };
    const Y = function (v) { return PT + (1 - (v - lo) / (hi - lo)) * ih; };
    let g = '';
    [lo, (lo + hi) / 2, hi].forEach(function (t) {
      g += '<text class="dan-ax" x="' + (PL - 8) + '" y="' + (Y(t) + 3.5).toFixed(1) + '" text-anchor="end">' + esc(m.tick(t)) + '</text>';
    });
    g += '<line class="dan-base" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(lo).toFixed(1) + '" y2="' + Y(lo).toFixed(1) + '"/>';
    dates.forEach(function (d, i) {
      const wd = DOW[new Date(d + 'T00:00:00').getDay()];
      g += '<text class="dan-ax" x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + (narrow ? wd.charAt(0) : wd) + '</text>';
    });
    let seg = [];
    const segs = [];
    vals.forEach(function (v, i) {
      if (v === null) { if (seg.length) segs.push(seg); seg = []; } else seg.push(i);
    });
    if (seg.length) segs.push(seg);
    segs.forEach(function (s) {
      if (s.length < 2) return;
      g += '<path class="dan-line" pathLength="1" d="' + s.map(function (i, k) { return (k ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(vals[i]).toFixed(1); }).join('') + '"/>';
    });
    vals.forEach(function (v, i) {
      if (v === null) return;
      const cx = X(i).toFixed(1), cy = Y(v).toFixed(1);
      g += '<g class="dan-pt" data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc(anLong(dates[i]) + ', ' + m.fmt(v)) + '">' +
        '<circle class="dan-hit" cx="' + cx + '" cy="' + cy + '" r="16"/>' +
        '<circle class="dan-dot" cx="' + cx + '" cy="' + cy + '" r="3.5"/></g>';
    });
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="' + esc(m.label) + ', this week">' + g + '</svg><div class="dan-tip" hidden></div>';
    anModel = { m: m, dates: dates, vals: vals, W: W, H: H,
      xs: dates.map(function (d, i) { return X(i); }),
      ys: vals.map(function (v) { return v === null ? null : Y(v); }) };
    const keep = anPinned();
    if (keep >= 0 && vals[keep] !== null) anShow(keep); else anSel = '';
    return true;
  }

  function anSync(host) {
    const m = anMetric(), sel = host.querySelector('.dan-sel');
    if (!sel) return;
    sel.classList.toggle('dtk-open', anMenu);
    const btn = sel.querySelector('.dtk-sel-btn');
    btn.textContent = m.label;
    btn.setAttribute('aria-expanded', String(anMenu));
    sel.querySelector('.dtk-menu').hidden = !anMenu;
    sel.querySelectorAll('.dtk-opt').forEach(function (o) {
      const on = o.dataset.id === m.id;
      o.classList.toggle('dtk-opt-on', on);
      o.parentNode.setAttribute('aria-selected', String(on));
    });
  }

  function anPtIndex(e) {
    const g = e.target && e.target.closest ? e.target.closest('.dan-pt') : null;
    return g ? Number(g.dataset.i) : -1;
  }

  function anBuild(host) {
    host.innerHTML = '<div class="dan">' +
      '<div class="dan-bar"><div class="dtk-sel dan-sel">' +
        '<button type="button" class="dtk-sel-btn" data-an="menu" aria-haspopup="listbox" aria-expanded="false"></button>' +
        '<ul class="dtk-menu dan-menu" role="listbox" aria-label="Study metric" hidden>' + AN_METRICS.map(function (m) {
          return '<li role="option" aria-selected="false"><button type="button" class="dtk-opt" data-an="pick" data-id="' + m.id + '">' + esc(m.label) + '</button></li>';
        }).join('') + '</ul>' +
      '</div></div>' +
      '<div class="dan-plot"></div></div>';
    const plot = host.querySelector('.dan-plot');
    host.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-an]') : null;
      if (!b) return;
      if (b.dataset.an === 'menu') { anMenu = !anMenu; anSync(host); }
      else if (b.dataset.an === 'pick') { anMenu = false; anPick(b.dataset.id); }
    });
    // Desktop: hover shows a point's tooltip. Touch and click pin it until another point or the background is tapped.
    plot.addEventListener('pointerover', function (e) {
      if (e.pointerType !== 'mouse') return;
      const i = anPtIndex(e);
            if (i >= 0) anShow(i, true);
    });
    plot.addEventListener('pointerout', function (e) {
      if (e.pointerType !== 'mouse' || anPtIndex(e) < 0) return;
      if (anPtIndex({ target: e.relatedTarget }) >= 0) return;
      anShow(anPinned());
    });
    plot.addEventListener('click', function (e) {
      const i = anPtIndex(e);
      if (i >= 0 && anModel) { anSel = anModel.dates[i]; anShow(i); }
      else { anSel = ''; anShow(-1); }
    });
    plot.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const i = anPtIndex(e);
      if (i >= 0 && anModel) { e.preventDefault(); anSel = anModel.dates[i]; anShow(i); }
    });
    plot.addEventListener('focusin', function (e) { const i = anPtIndex(e); if (i >= 0) anShow(i); });
    plot.addEventListener('focusout', function () { anShow(anPinned()); });
    if (typeof ResizeObserver !== 'undefined') {
      let rw = 0, rh = 0;
      new ResizeObserver(function () {
        if (plot.clientWidth === rw && plot.clientHeight === rh) return;
        rw = plot.clientWidth; rh = plot.clientHeight;
        if (anDraw(false)) anSigLast = anSig();
      }).observe(plot);
    }
    if (!anDocBound) {
      anDocBound = true;
      document.addEventListener('click', function (e) {
        if (!anMenu || (e.target.closest && e.target.closest('#dash-analytics .dan-sel'))) return;
        const h = document.querySelector('#dash-analytics .dash-body');
        anMenu = false;
        if (h) anSync(h);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const h = document.querySelector('#dash-analytics .dash-body');
        if (!h || !h.querySelector('.dan')) return;
        if (anMenu) { anMenu = false; anSync(h); }
        else if (anSel) { anSel = ''; anShow(-1); }
      });
    }
  }

  function anPick(id) {
    if (id === anKey) { renderAnalytics(false); return; }
    anKey = id;
    anSel = '';
    renderAnalytics(true);
  }

  function renderAnalytics(animate) {
    const host = document.querySelector('#dash-analytics .dash-body');
    if (!host) return;
    if (typeof PTPE === 'undefined') { host.innerHTML = '<p class="dan-empty">Analytics are unavailable.</p>'; return; }
    if (!host.querySelector('.dan')) anBuild(host);
    anSync(host);
    anSigLast = '';
    if (anDraw(animate)) anSigLast = anSig();
  }

  // Every Dashboard visit starts on Study Hours with nothing pinned.
    function anOpen() {
    anKey = AN_DEFAULT;
    anSel = '';
    anMenu = false;
    renderAnalytics(anSeen);
    anSeen = true;
  }

  // Called from liveTick (TimeEngine heartbeat): redraw only when this week's plotted values or the week itself changed.
  function anTick() {
    const now = Date.now();
    if (now - anCheckAt < AN_CHECK_MS || typeof PTPE === 'undefined') return;
    anCheckAt = now;
    if (anSig() !== anSigLast) renderAnalytics(false);
  }

  // One subscriber on TimeEngine's shared heartbeat (stable id, so a re-run replaces rather than stacks).
  // It only compares what is displayed against what is now canonical, so changes made in the Assistant
  // Habits menu (or anywhere else) show up here, and the day rolling over refreshes both boxes.
  // ---------- Box 8, slide 2: Upcoming Alarms (read-only) ----------
  // A view over Lavender's canonical general alarms (State.get().generalAlarms) that adds no alarm store, scheduler,
  // timer, notification or listener. Order and times come from GeneralAlarm._next(), the alarm module's own
  // next-occurrence calculation (recurrence, snooze, one-time dates, 'already rang today'), so recurring alarms show
  // their real next occurrence. Only enabled alarms with an occurrence still ahead are listed. Rows are not
  // interactive: nothing here creates, edits, toggles or deletes an alarm. It refreshes on the existing
  // 'dashboard-live' heartbeat (liveTick). Slide 1 is the untouched Tasks body, which is only hidden, never rebuilt.
  const AL_LABELS = ['Tasks', 'Alarms'];
  let alSlide = 0;
  let alSig = '';
  let alKeep = 0;

  function alUpcoming(now) {
    if (typeof GeneralAlarm === 'undefined' || !GeneralAlarm._next || typeof State === 'undefined' || !State.get) return null;
    const map = (State.get() && State.get().generalAlarms) || {};
    const minuteStart = Math.floor(now.getTime() / 60000) * 60000;
    return Object.keys(map).map(function (id) { return { id: id, a: map[id] }; })
      .filter(function (x) { return x.a && x.a.enabled; })
      .map(function (x) { x.ms = GeneralAlarm._next(x.a, now); return x; })
      .filter(function (x) { return x.ms != null && x.ms >= minuteStart; })
      .sort(function (p, q) { return p.ms - q.ms || (p.id < q.id ? -1 : 1); });
  }

  function alRel(ms, now) {
    const mins = Math.max(0, Math.ceil((ms - now.getTime()) / 60000));
    if (mins < 60) return 'in ' + Math.max(1, mins) + ' min';
    if (mins < 1440) return 'in ' + Math.floor(mins / 60) + ' h' + (mins % 60 ? ' ' + (mins % 60) + ' min' : '');
    return '';
  }

  function alRow(x, now) {
    const d = new Date(x.ms);
    const ds = dateStr(d);
    const today = dateStr(now);
    const day = ds === today ? 'Today' : (ds === shiftDay(today, 1) ? 'Tomorrow' : DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]);
    const type = x.a.recurrence && x.a.recurrence.type;
    const sub = [day, (type === 'daily' || type === 'weekdays') ? 'Repeats' : '', x.a.snoozedUntil ? 'Snoozed' : ''].filter(Boolean).join(' \u00b7 ');
    const rel = alRel(x.ms, now);
    return '<div class="dal-row">' +
      '<span class="dtk-when dal-when">' + esc(hm12(pad2(d.getHours()) + ':' + pad2(d.getMinutes()), true)) + '</span>' +
      '<span class="dtk-main"><span class="dtk-title">' + esc(x.a.text || 'Alarm') + '</span><span class="dtk-parent">' + esc(sub) + '</span></span>' +
      (rel ? '<span class="dtk-meta">' + esc(rel) + '</span>' : '') +
      '</div>';
  }

  function alRender(force) {
    const host = document.querySelector('#dash-tasks .dal-body');
    if (!host) return;
    const now = new Date();
    const list = alUpcoming(now);
    const sig = list === null ? 'none' : Math.floor(now.getTime() / 60000) + '#' + list.map(function (x) {
      return [x.id, x.a.text, x.ms, x.a.snoozedUntil ? 1 : 0, x.a.recurrence && x.a.recurrence.type].join('|');
    }).join('~');
    if (!force && sig === alSig) return;
    alSig = sig;
    const keep = host.scrollTop;
    host.innerHTML = list === null ? '<p class="dtk-empty">Alarms are unavailable.</p>'
      : (list.length ? list.map(function (x) { return alRow(x, now); }).join('') : '<p class="dtk-empty">No upcoming alarms.</p>');
    host.scrollTop = keep;
  }

  function alApply() {
    const sec = document.getElementById('dash-tasks');
    if (!sec) return;
    const tb = sec.querySelector('.dash-body');
    const lb = sec.querySelector('.dal-body');
    if (tb) tb.hidden = alSlide !== 0;
    if (lb) lb.hidden = alSlide !== 1;
    sec.querySelectorAll('.drf-dot').forEach(function (el) {
      if (Number(el.dataset.algo) === alSlide) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
    });
    const label = sec.querySelector('.dash-label');
    if (label) label.textContent = AL_LABELS[alSlide];
  }

  function alGo(i) {
    const sec = document.getElementById('dash-tasks');
    const tb = sec && sec.querySelector('.dash-body');
    const list = tb && tb.querySelector('.dtk-list');
    if (alSlide === 0 && list) alKeep = list.scrollTop;
    alSlide = ((i % AL_LABELS.length) + AL_LABELS.length) % AL_LABELS.length;
    alApply();
    if (alSlide === 1) { alRender(true); return; }
    renderTasks(false); // Tasks does not refresh while hidden; bring it up to date. tkView (the dropdown choice) is untouched.
    const l2 = tb && tb.querySelector('.dtk-list');
    if (l2) l2.scrollTop = alKeep;
  }

  // Built once, appended after the Tasks body so Tasks' own '#dash-tasks .dash-body' lookups are unaffected.
  function alShell() {
    const sec = document.getElementById('dash-tasks');
    if (!sec || sec.querySelector('.dal-body')) return;
    const nav = document.createElement('div');
    nav.className = 'drf-nav';
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Tasks slides');
    nav.innerHTML =
      '<button type="button" class="drf-arrow" data-alnav="-1" aria-label="Previous slide">\u2039</button>' +
      '<button type="button" class="drf-dot" data-algo="0" aria-label="Tasks"></button>' +
      '<button type="button" class="drf-dot" data-algo="1" aria-label="Upcoming alarms"></button>' +
      '<button type="button" class="drf-arrow" data-alnav="1" aria-label="Next slide">\u203a</button>';
    nav.addEventListener('click', function (e) {
      const n = e.target.closest('[data-alnav]');
      if (n) { alGo(alSlide + Number(n.dataset.alnav)); return; }
      const g = e.target.closest('[data-algo]');
      if (g) alGo(Number(g.dataset.algo));
    });
    const body = document.createElement('div');
    body.className = 'dal-body';
    body.hidden = true;
    sec.appendChild(nav);
    sec.appendChild(body);
    alSig = '';
  }

  // ---------- Box 4: Daily Reflection (two slides in one fixed box) ----------
  // Slide 1, Daily Summary: three read-only figures for today. Study Hours and Questions come from
  // PTPE.value(key, PTPE.today()), the same per-day source Study Analytics reads. Tasks Completed is
  // PlanningAgentTasks.getCompletedToday(), which filters on each task's real completedAt date (not its scheduled
  // date). Nothing is stored or recomputed here; a missing record shows as 0.
  // Slide 2, Music Player: a view over the existing Player (player.js). It reads Player.getStatus() and forwards
  // taps to Player.toggle / prev / next / seek, so it drives the same Radio/Music session as the Player modal. It owns
  // no audio, playback state, timer or global listener: it refreshes on the existing 'dashboard-live' heartbeat.
  // Only UI selection (the slide) is held here; Dashboard.render() resets it to the Daily Summary on each open.
  const RF_CHECK_MS = 5000;
  const RF_LABELS = ['Daily Reflection', 'Music Player'];
  const RF_ICON_PREV = '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 2h2v8H2zM10 2v8L4.5 6z"/></svg>';
  const RF_ICON_NEXT = '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M8 2h2v8H8zM2 2v8l5.5-4z"/></svg>';
  const RF_ICON_PLAY = '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1.5v9L10.5 6z"/></svg>';
  const RF_ICON_PAUSE = '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2.5 2H5v8H2.5zM7 2h2.5v8H7z"/></svg>';
  let rfSig = '';
  let rfCheckAt = 0;
  let rfSlide = 0;
  let rfPlSig = '';

  function rfNum(key) {
    try {
      if (typeof PTPE === 'undefined') return 0;
      const v = PTPE.value(key, PTPE.today());
      return typeof v === 'number' && isFinite(v) ? v : 0;
    } catch (err) {
      console.warn('Dashboard reflection value failed', key, err);
      return 0;
    }
  }

  function rfFigures() {
    let hours = '0';
    let tasks = 0;
    try { hours = PTPE.fmtHours(rfNum('studyHours')); } catch (err) { console.warn('Dashboard reflection hours failed', err); }
    try { if (typeof PlanningAgentTasks !== 'undefined') tasks = PlanningAgentTasks.getCompletedToday().length; } catch (err) { console.warn('Dashboard reflection tasks failed', err); }
    return [
      { name: 'Study Hours', value: String(hours) },
      { name: 'Questions Solved', value: String(Math.round(rfNum('questions'))) },
      { name: 'Tasks Completed', value: String(tasks) }
    ];
  }

  function rfSignature(items) {
    return (typeof PTPE !== 'undefined' && PTPE.today ? PTPE.today() : todayStr()) + '#' + items.map(function (it) { return it.value; }).join('|');
  }

  function rfFmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  }

  // Builds the fixed shell once: navigation plus the two slides. Slide contents are filled in place afterwards.
  function rfShell(host) {
    if (host.querySelector('.drf-slide')) return;
    host.innerHTML =
      '<div class="drf-nav" role="group" aria-label="Reflection slides">' +
        '<button type="button" class="drf-arrow" data-nav="-1" aria-label="Previous slide">\u2039</button>' +
        '<button type="button" class="drf-dot" data-go="0" aria-label="Daily Summary"></button>' +
        '<button type="button" class="drf-dot" data-go="1" aria-label="Music Player"></button>' +
        '<button type="button" class="drf-arrow" data-nav="1" aria-label="Next slide">\u203a</button>' +
      '</div>' +
      '<div class="drf-slide" data-slide="0"></div>' +
      '<div class="drf-slide" data-slide="1" hidden></div>';
    rfPlSig = '';
    rfBind(host);
  }

  function rfApplySlide() {
    const host = document.querySelector('#dash-reflection .dash-body');
    if (!host) return;
    host.querySelectorAll('.drf-slide').forEach(function (el) { el.hidden = Number(el.dataset.slide) !== rfSlide; });
    host.querySelectorAll('.drf-dot').forEach(function (el) {
      if (Number(el.dataset.go) === rfSlide) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
    });
    const label = document.querySelector('#dash-reflection .dash-label');
    if (label) label.textContent = RF_LABELS[rfSlide];
  }

  function rfGo(i) {
    rfSlide = ((i % RF_LABELS.length) + RF_LABELS.length) % RF_LABELS.length;
    rfApplySlide();
    if (rfSlide === 1) rfPlayerTick(true);
  }

  function rfAct(act) {
    if (typeof Player === 'undefined') return;
    try {
      if (act === 'toggle' && Player.toggle) Player.toggle();
      else if (act === 'prev' && Player.prev) Player.prev();
      else if (act === 'next' && Player.next) Player.next();
    } catch (err) { console.warn('Dashboard player action failed', act, err); }
    rfPlayerTick(false);
  }

  function rfBind(host) {
    host.addEventListener('click', function (e) {
      const nav = e.target.closest('[data-nav]');
      if (nav) { rfGo(rfSlide + Number(nav.dataset.nav)); return; }
      const go = e.target.closest('[data-go]');
      if (go) { rfGo(Number(go.dataset.go)); return; }
      const act = e.target.closest('[data-act]');
      if (act && !act.disabled) rfAct(act.dataset.act);
    });
    host.addEventListener('change', function (e) {
      if (!e.target.classList || !e.target.classList.contains('drf-range')) return;
      try { if (typeof Player !== 'undefined' && Player.seek) Player.seek(Number(e.target.value)); }
      catch (err) { console.warn('Dashboard player seek failed', err); }
    });
  }

  function rfPlayerHtml(s) {
    const playing = s.state === 'playing';
    const stateTxt = playing ? 'Playing' : (s.state === 'paused' ? 'Paused' : 'Stopped');
    const title = esc(s.title);
    return '<div class="drf-music" data-state="' + s.state + '">' +
      '<div class="drf-art" aria-hidden="true"><i></i><i></i></div>' +
      '<div class="drf-pl">' +
        '<span class="drf-pl-title" title="' + title + '">' + title + '</span>' +
        '<span class="drf-pl-sub">' + esc(stateTxt + ' \u00b7 ' + s.detail) + '</span>' +
        '<div class="drf-pl-ctl">' +
          (s.canSkip ? '<button type="button" class="drf-key" data-act="prev" aria-label="Previous track">' + RF_ICON_PREV + '</button>' : '') +
          '<button type="button" class="drf-key drf-key-main' + (playing ? ' drf-key-on' : '') + '" data-act="toggle" aria-label="' + (playing ? 'Pause' : 'Play') + '"' + (s.canPlay ? '' : ' disabled') + '>' + (playing ? RF_ICON_PAUSE : RF_ICON_PLAY) + '</button>' +
          (s.canSkip ? '<button type="button" class="drf-key" data-act="next" aria-label="Next track">' + RF_ICON_NEXT + '</button>' : '') +
        '</div>' +
        (s.canSeek ? '<div class="drf-pl-seek"><input type="range" class="drf-range" min="0" max="' + s.duration + '" value="' + s.position + '" step="1" aria-label="Seek"><span class="drf-pl-time"></span></div>' : '') +
      '</div></div>';
  }

  function rfPlayerProgress(s) {
    const slide = document.querySelector('#dash-reflection .drf-slide[data-slide="1"]');
    const bar = slide && slide.querySelector('.drf-range');
    if (!bar || !s.canSeek) return;
    if (!bar.matches(':active')) { bar.max = s.duration; bar.value = s.position; }
    const t = slide.querySelector('.drf-pl-time');
    if (t) t.textContent = rfFmtTime(bar.matches(':active') ? Number(bar.value) : s.position) + ' / ' + rfFmtTime(s.duration);
  }

  // Cheap, called from liveTick while slide 2 is showing: rebuilds the slide only when what is displayed changes
  // (track, station, state, available controls), otherwise just moves the progress bar.
  function rfPlayerTick(force) {
    const slide = document.querySelector('#dash-reflection .drf-slide[data-slide="1"]');
    if (!slide) return;
    if (typeof Player === 'undefined' || !Player.getStatus) {
      if (force || rfPlSig !== 'none') { rfPlSig = 'none'; slide.innerHTML = '<p class="dhb-empty">Player is unavailable.</p>'; }
      return;
    }
    let s;
    try { s = Player.getStatus(); }
    catch (err) { console.warn('Dashboard player status failed', err); return; }
    const sig = [s.kind, s.state, s.title, s.detail, s.canPlay, s.canSkip, s.canSeek].join('|');
    if (force || sig !== rfPlSig) {
      const ae = document.activeElement;
      const had = ae && slide.contains(ae) && ae.dataset ? ae.dataset.act : null;
      rfPlSig = sig;
      slide.innerHTML = rfPlayerHtml(s);
      if (had) { const b = slide.querySelector('[data-act="' + had + '"]'); if (b && !b.disabled) b.focus(); }
    }
    rfPlayerProgress(s);
  }

  function renderReflection() {
    const host = document.querySelector('#dash-reflection .dash-body');
    if (!host) return;
    rfShell(host);
    const items = rfFigures();
    rfSig = rfSignature(items);
    host.querySelector('.drf-slide[data-slide="0"]').innerHTML = '<div class="drf-grid">' + items.map(function (it) {
      return '<div class="drf-item"><span class="drf-value">' + esc(it.value) + '</span><span class="drf-name">' + esc(it.name) + '</span></div>';
    }).join('') + '</div>';
    rfApplySlide();
  }

  function liveTick() {
    const hb = document.querySelector('#dash-habits .dash-body');
    if (hb && hb.offsetParent !== null && typeof HabitData !== 'undefined' && habSignature(habItems()) !== habSig) renderHabits();
    const tb = document.querySelector('#dash-tasks .dash-body');
    if (tb && tb.offsetParent !== null && tkDay && tkDay !== todayStr()) renderTasks(false);
    const rb = document.querySelector('#dash-reflection .dash-body');
    if (rb && rb.offsetParent !== null) {
      if (rfSlide === 1) rfPlayerTick(false);
      if (Date.now() - rfCheckAt >= RF_CHECK_MS) {
        rfCheckAt = Date.now();
        if (rfSignature(rfFigures()) !== rfSig) renderReflection();
      }
    }
    const lb = document.querySelector('#dash-tasks .dal-body');
    if (lb && lb.offsetParent !== null) alRender(false);
    const ab = document.querySelector('#dash-analytics .dash-body');
    if (ab && ab.offsetParent !== null) anTick();
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
        box('dash-entity', 'dash-entity', '', 'Dashboard scene', false) +
        '<div class="dash-row dash-row-1">' +
          box('dash-b1', 'dash-reflection', 'Daily Reflection', 'Daily Reflection', true) +
          box('dash-b2', 'dash-custom', 'Custom Content', 'Custom Content', true) +
        '</div>' +
        '<div class="dash-row dash-row-2">' +
          box('dash-b3', 'dash-habits', 'Habits', 'Habits', true) +
          box('dash-b4', 'dash-personal', 'Personal Space', 'Personal Space', true) +
        '</div>' +
        '<div class="dash-row dash-row-3">' +
          box('dash-b56', 'dash-analytics', 'Study Analytics', 'Study Analytics', true) +
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
    if (typeof EntityRenderer !== 'undefined' && EntityRenderer.mount) EntityRenderer.mount(document.getElementById('dash-entity')); // idempotent; shows the active Entity pack or the built-in LV1
        if (typeof DashboardCalendar !== 'undefined' && DashboardCalendar.render) DashboardCalendar.render();
    renderTasks(false);
    alSlide = 0; // Tasks is the default slide each time the Dashboard opens
    alShell();
    alApply();
    renderHabits();
    rfSlide = 0; // the Daily Summary is the default slide each time the Dashboard opens
    renderReflection();
    anOpen();
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
