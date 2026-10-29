// study.js — Study tab: clock (stopwatch/timer, §3.1) + alarm-driven timetable execution (§3.2).
// Depends on: State, PlannerData, Modal. Loaded after planner.js (see index.html).

const Study = (function () {
  let timeInputOpen = false;
  let breakInputOpen = false;
  let questionsInputOpen = false;
  // Guards the Timer/Stopwatch completion lifecycle (Save and natural auto-completion both
  // funnel through this). Prevents: the natural-completion tick firing while a Save click is
  // still being processed (or vice versa), a stale/delayed callback re-finalizing a run that's
  // already been logged and reset, and any accidental recursive completion — all of which
  // previously could log the same run more than once.
  let clockCompleting = false;
  const QUESTION_TASK_TYPES = ['revision', 'theory', 'questions'];
  // ---------- helpers ----------

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function tomorrowStr() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  
  function nowHHMM() {
    const t = new Date();
    return pad(t.getHours()) + ':' + pad(t.getMinutes());
  }

  function timeStrToMs(dateStr, hhmm) {
    return new Date(dateStr + 'T' + hhmm + ':00').getTime();
  }

  function fmtDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
  }

  function taskLabelFull(task) {
    if (!task) return '';
    return task.taskType === 'custom'
      ? task.title
      : (task.subject + ' \u00B7 ' + task.topicName + ' \u00B7 ' + PlannerData.taskLabel(task));
  }

  
    // ---------- Planning Agent link (plan box, loaded plan, reschedule, complete) ----------
  // The loaded plan is just the canonical task id kept on State.studyClock (planTaskId). Tasks, scheduling and
  // completion all go through PlanningAgent / PlanningAgentTasks; nothing is stored or scheduled here.
  let pbView = 'today';
  let pbDate = '';

  function hmToMin(hm) { return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)); }
  function planStartable(t) {
    return !!(t && t.date && /^\d{2}:\d{2}$/.test(t.startTime || '') && /^\d{2}:\d{2}$/.test(t.stopTime || '') && t.stopTime > t.startTime);
  }
  function planTitleOf(t) {
    const lt = (typeof PlanData !== 'undefined' && t.taskId) ? PlanData.getTask(t.taskId) : null;
    return (lt && lt.title) || t.title || (lt && lt.topicName) || t.topicName || 'Task';
  }

  // The task currently loaded into the clock, or null. A task that was completed, cancelled, archived or deleted elsewhere is unloaded.
  function getLoadedPlan() {
    const c = getClock();
    if (!c.planTaskId) return null;
    const t = (typeof PlanningAgent !== 'undefined' && PlanningAgent.getTask) ? PlanningAgent.getTask(c.planTaskId) : null;
    if (!t || t.completed || t.archived || t.status === 'cancelled') {
      setClock({ planTaskId: null, planTitle: '' });
      return null;
    }
    return t;
  }

  function loadPlanTask(id) {
    if (isClockActive(getClock())) return;                  // never replace a run in progress
    const t = (typeof PlanningAgent !== 'undefined') ? PlanningAgent.getTask(id) : null;
    if (!t || t.completed || !planStartable(t)) return;     // unscheduled / no end time: not startable
    const dur = hmToMin(t.stopTime) - hmToMin(t.startTime);
    if (dur < 1) return;
    pendingTimerMin = dur;
    pendingPreset = null;
    setClock({ mode: 'timer', timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false, planTaskId: t.id, planTitle: planTitleOf(t) });
    renderClockPanel();                                     // loads only; Start is always an explicit click
  }

  function unloadPlanTask() {
    if (isClockActive(getClock())) return;
    setClock({ planTaskId: null, planTitle: '' });
    renderClockPanel();
  }

    function stopClockForPlanTask(taskKey) {
    const c = getClock();
    if (!c.planTaskId || !isClockActive(c)) return;
    const loaded = String(c.planTaskId);
    const key = String(taskKey);
    if (loaded !== key && loaded !== 'legacy_' + key) return;
    saveClockAndReset();
  }

  function reschedulePlanTask(t, date, start, stop) {
    const key = String(t.id).indexOf('legacy_') === 0 ? String(t.id).slice(7) : null;
    if (key && typeof PlanData !== 'undefined' && PlanData.getTask(key)) {
      const r = PlanningAgent.rescheduleTask(key, date, start, stop, 'user', 'study-reschedule');
      if (r && r.ok) PlanningAgentTasks.sync();
      return r;
    }
    return CanonicalTaskStore.updateTask(t.id, { date: date, time: start, duration: hmToMin(stop) - hmToMin(start) });
  }

  function openPlanReschedule() {
    const t = getLoadedPlan();
    if (!t) return;
    Modal.open(
      '<h3>Reschedule</h3>' +
      '<p>' + escHtml(planTitleOf(t)) + '</p>' +
      '<input type="date" id="study-resched-date" value="' + escHtml(t.date || todayStr()) + '" min="' + todayStr() + '">' +
      '<div class="planner-slot-row">' +
        '<div><label class="planner-field-label">Start</label><input type="time" id="study-resched-start" value="' + escHtml(t.startTime || '') + '"></div>' +
        '<div><label class="planner-field-label">End</label><input type="time" id="study-resched-stop" value="' + escHtml(t.stopTime || '') + '"></div>' +
      '</div>' +
      '<button id="study-resched-confirm">Reschedule</button>'
    );
    const btn = document.getElementById('study-resched-confirm');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const date = document.getElementById('study-resched-date').value;
      const start = document.getElementById('study-resched-start').value;
      const stop = document.getElementById('study-resched-stop').value;
      if (!date) { alert('Pick a date.'); return; }
      if (!start || !stop) { alert('Set both a start time and an end time.'); return; }
      if (stop <= start) { alert('The end time must be after the start time.'); return; }
      const cur = getLoadedPlan();
      if (!cur) { Modal.close(); return; }
      const r = reschedulePlanTask(cur, date, start, stop);
      if (!r || !r.ok) { alert((r && r.error) || 'Could not reschedule this task.'); return; }
      Modal.close();
      syncPlanTitle();
      renderPlanBox();
    });
  }

  // Completes the exact loaded task through the Agent's own completion path (EXP / goal progress stay correct).
  function completePlanFromStudy() {
    const t = getLoadedPlan();
    if (!t) return;
    saveClockAndReset();                                    // logs any elapsed study time exactly once, then resets the clock
    PlanningAgent.toggleTask(t.taskId);
    setClock({ planTaskId: null, planTitle: '' });
    renderClockPanel();
  }

  function syncPlanTitle() {
    const had = !!getClock().planTaskId;
    const t = getLoadedPlan();
    if (had && !t) { renderClockPanel(); return; }
    const el = document.getElementById('study-plan-title-text');
    if (t && el) {
      const txt = planTitleOf(t);
      if (el.textContent !== txt) el.textContent = txt;
    }
  }

  function pbTasks() {
    if (typeof PlanningAgent === 'undefined') return [];
    const today = todayStr();
    let list = [];
    if (pbView === 'today') list = PlanningAgent.getTasksForDateRange(today, today);
    else if (pbView === 'overdue') list = PlanningAgent.getPendingTasks();
    else if (pbView === 'pick') list = pbDate ? PlanningAgent.getTasksForDateRange(pbDate, pbDate) : [];
    else if (pbView === 'unscheduled') list = PlanningAgentTasks.getOpenTasks().filter(function (t) { return !t.date; });
    else list = PlanningAgentTasks.getOpenTasks();
    return list.filter(function (t) { return !t.completed && !t.archived && t.type !== 'break'; })
      .sort(function (a, b) {
        const ka = (a.date || '~') + (a.startTime || '~'), kb = (b.date || '~') + (b.startTime || '~');
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
  }

  function pbWhen(t) {
    const bits = [];
    if (!t.date) bits.push('Unscheduled');
    else if (t.date !== todayStr()) bits.push(t.date.slice(5));
    if (planStartable(t)) bits.push(t.startTime + '\u2013' + t.stopTime);
    else if (t.date) bits.push(t.startTime ? 'No end time' : 'No time');
    return bits.join(' \u00B7 ');
  }

  function renderPlanBox() {
    const box = document.getElementById('study-empty-box');
    if (!box) return;
    if (!box.dataset.pbBuilt) {
      box.dataset.pbBuilt = '1';
      box.classList.add('sp-pb');
      box.removeAttribute('aria-hidden');
      box.innerHTML =
        '<div class="sp-pb-head">' +
          '<select id="study-pb-view" class="sp-pb-select" aria-label="Plans to show">' +
            '<option value="today">Today</option><option value="overdue">Overdue</option><option value="unscheduled">Unscheduled</option>' +
            '<option value="pick">Pick a date</option><option value="all">All plans</option>' +
          '</select>' +
          '<input type="date" id="study-pb-date" class="sp-pb-date" aria-label="Date" hidden>' +
        '</div>' +
        '<div id="study-pb-list" class="sp-pb-list"></div>';
      document.getElementById('study-pb-view').addEventListener('change', function (e) {
        pbView = e.target.value;
        if (pbView === 'pick' && !pbDate) pbDate = todayStr();
        renderPlanBox();
      });
      document.getElementById('study-pb-date').addEventListener('change', function (e) {
        pbDate = e.target.value;
        renderPlanBox();
      });
      box.addEventListener('click', function (e) {
        const row = e.target.closest('[data-pb-id]');
        if (row && !row.disabled) loadPlanTask(row.getAttribute('data-pb-id'));
      });
    }
    const sel = document.getElementById('study-pb-view');
    const dIn = document.getElementById('study-pb-date');
    const listEl = document.getElementById('study-pb-list');
    if (!sel || !dIn || !listEl) return;
    if (sel.value !== pbView) sel.value = pbView;
    dIn.hidden = pbView !== 'pick';
    if (pbView === 'pick' && dIn.value !== pbDate) dIn.value = pbDate;

    const busy = isClockActive(getClock());
    const loadedId = getClock().planTaskId || '';
    const tasks = pbTasks();
    const groups = [], idx = {};
    tasks.forEach(function (t) {
      const tg = (t.targetId && typeof TargetsData !== 'undefined') ? TargetsData.getTarget(t.targetId) : null;
      const gk = (tg && tg.isPlan) ? tg.targetId : '';
      if (!idx.hasOwnProperty(gk)) { idx[gk] = groups.length; groups.push({ title: gk ? (tg.title || 'Plan') : '', items: [] }); }
      groups[idx[gk]].items.push(t);
    });
    const html = !groups.length ? '<div class="sp-pb-empty">Nothing here.</div>' : groups.map(function (g) {
      return (g.title ? '<div class="sp-pb-group-h">' + escHtml(g.title) + '</div>' : '') + g.items.map(function (t) {
        const ok = planStartable(t) && !busy;
        return '<button type="button" class="sp-pb-row' + (t.id === loadedId ? ' is-on' : '') + (planStartable(t) ? '' : ' is-locked') + '" data-pb-id="' + escHtml(t.id) + '"' + (ok ? '' : ' disabled') + '>' +
          '<span class="sp-pb-name">' + escHtml(planTitleOf(t)) + '</span><span class="sp-pb-when">' + escHtml(pbWhen(t)) + '</span></button>';
      }).join('');
    }).join('');
    if (listEl._pbHtml !== html) { listEl._pbHtml = html; listEl.innerHTML = html; }
  }

  // ---------- 3.1 Clock ----------

  function getClock() { return State.get().studyClock; }
  function setClock(partial) { State.set({ studyClock: Object.assign({}, getClock(), partial) }); }

  // Commits only the CURRENT segment (since the last Start/Resume) — never the whole run.
  // elapsedMs is always the fully-committed baseline already sent to TimeEngine, so calling
  // this repeatedly (Pause after Pause after Pause) can never double-record anything.
  function commitSegment() {
    const c = getClock();
    if (!c.running || !c.startedAt) return 0;
    const elapsed = TimeEngine.safeElapsed(c.startedAt, Date.now());
    const remaining = c.mode === 'timer' ? Math.max(0, TimeEngine.safeMs(c.timerTotalMs) - TimeEngine.safeMs(c.elapsedMs)) : Infinity;
    const capped = Math.min(elapsed, remaining);
    // Reject anything non-finite or non-positive outright — a suspended/throttled tab, a clock
    // jump, or a corrupted timerTotalMs/elapsedMs must never turn into a logged/recorded segment.
    if (!isFinite(capped) || capped <= 0) return 0;
    TimeEngine.recordStandaloneStudy(capped, c.mode);
    // Live EXP (item 1) — 100/hour, proportional, logged even for very short segments.
    if (typeof GamificationData !== 'undefined') GamificationData.awardStudyTime(capped, c.mode);
    return capped;
  }

  function startClock(mode, timerTotalMs) {
    setClock({ mode: mode, running: true, startedAt: Date.now(), timerTotalMs: timerTotalMs || 0, elapsedMs: 0, awaitingDecision: false });
        // Fullscreen is manual only (#study-fs-btn) — starting a clock never changes the layout.
    renderClockPanel();
  }
  function startStopwatch() { startClock('stopwatch', 0); }
  function startTimer(minutes) { startClock('timer', minutes * 60 * 1000); }

  // Normal pause/resume: freezes the display, continues from the same point on Resume.
  function resumeClock() {
    const c = getClock();
    if (c.running) return;
    setClock({ running: true, startedAt: Date.now() });
    renderClockPanel();
  }

  function pauseClock() {
    const c = getClock();
    if (!c.running) return;
    const segment = commitSegment();
    setClock({ running: false, startedAt: null, elapsedMs: (c.elapsedMs || 0) + segment });
    renderClockPanel();
  }

  // Save — the ONLY action that ever writes a visible log entry. Commits whatever segment is
  // still running (if any), logs the full accumulated total exactly once, then resets the
  // clock to a blank idle state. Pause/Resume never call this and never log.
  function saveClockAndReset() {
    if (clockCompleting) return; // a completion (auto or manual) is already finalizing this run
    clockCompleting = true;
    const c = getClock();
    let total = c.elapsedMs || 0;
    if (c.running) total += commitSegment();
    if (total > 0) TimeEngine.pushLog(todayStr(), c.mode === 'timer' ? 'Timer' : 'Stopwatch', total, 'min');
    setClock({ mode: 'stopwatch', running: false, startedAt: null, timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
    State.patch('settings', { userExitedFullscreen: false });
    renderClockPanel();
    clockCompleting = false;
  }

  // Timer hit its target
  // yet, log the full originally-entered duration exactly once, and reset immediately. No
  // freeze, no separate decision step: natural completion behaves like an automatic Save.
  function autoCompleteTimer() {
    if (clockCompleting) return; // duplicate/re-entrant/stale trigger for a run already finalizing
    clockCompleting = true;
    const c = getClock();
    // Natural completion always logs exactly the originally entered duration — never a re-derived
    // sum of live segments, which could drift from a stale Date.now() - startedAt read (e.g. a
    // throttled/backgrounded tab) into more or less than what was actually promised to the user.
    const originalDuration = TimeEngine.safeMs(c.timerTotalMs);
    // Still commit the true final live segment to TimeEngine/Gamification (already capped to
    // remaining time by commitSegment, so it can never push actual tracked study time past the
    // timer's own duration) — this is separate from, and unaffected by, the value logged below.
    commitSegment();
    if (originalDuration > 0) TimeEngine.pushLog(todayStr(), 'Timer', originalDuration, 'min');
    // Stop everything about this run — mode/running/startedAt/timerTotalMs all reset together so
    // any stale/delayed callback that still fires afterward reads a dead run and is a no-op.
    setClock({ mode: 'stopwatch', running: false, startedAt: null, timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
    State.patch('settings', { userExitedFullscreen: false });
    renderClockPanel();
    clockCompleting = false;
  }

  // Records the run state on the layout (data attribute only) and refreshes shared chrome visibility.
  // The Study layout never switches to a separate Focus screen.
  function applyClockFocusUI(active) {
    const layout = document.getElementById('study-layout');
    if (layout) {
      const _ss = TimeEngine.getActiveSession();
      layout.dataset.studyState = _ss ? (_ss.state === 'paused' ? 'paused' : 'running') : (active ? (getClock().running ? 'running' : 'paused') : 'idle');
    }
    applyChromeVisibility();
  }
  function isClockActive(c) {
    return !!(c.running || (c.elapsedMs || 0) > 0 || c.awaitingDecision);
  }

  // Single source of truth for the shared chrome (links icon, break button) — hidden
  // whenever EITHER a planner session OR the manual Stopwatch/Timer is active, computed fresh
  // every time so the two flows can never fight each other and cause a flicker.
  function applyChromeVisibility() {
        const active = !!TimeEngine.getActiveSession();
    const linksIcon = document.getElementById('study-links-icon');
    const breakBtn = document.getElementById('global-break-btn');
    const autofsRow = document.getElementById('study-autofs-toggle-row');
    if (linksIcon) linksIcon.style.display = active ? 'none' : 'inline-block';
        if (breakBtn) breakBtn.style.display = active ? 'none' : '';
    if (autofsRow) autofsRow.style.display = active ? 'none' : '';
  }
  function currentClockMs() {
    const c = getClock();
    const liveDelta = c.running ? TimeEngine.safeElapsed(c.startedAt, Date.now()) : 0;
    const totalElapsed = TimeEngine.safeMs(c.elapsedMs) + liveDelta;
    return c.mode === 'timer' ? Math.max(0, c.timerTotalMs - totalElapsed) : totalElapsed;
  }

  let lastClockUiMode = null; // 'normal' | 'decision' — tracks which markup renderClockPanel last drew

  // Item 3 fix — this check used to live only inside renderClock(), which onEngineTick only
  // calls under certain conditions (not past cutoff, session signature unchanged). If a running
  // Timer crossed its target on a tick where those conditions weren't met, the freeze got skipped
  // and the state stayed "running" with a stale startedAt — the next time it WAS checked, elapsed
  // could be hours old. Pulling this out and calling it unconditionally, first thing, on every
  // single tick (see onEngineTick) closes that gap regardless of cutoff/session state.
  function checkTimerTarget() {
    if (clockCompleting) return false; // a completion is already being finalized — never re-enter
    const c = getClock();
    if (c.mode === 'timer' && c.running && !c.awaitingDecision) {
      const target = TimeEngine.safeMs(c.timerTotalMs);
      const totalElapsed = TimeEngine.safeMs(c.elapsedMs) + TimeEngine.safeElapsed(c.startedAt, Date.now());
      // target > 0 rejects an impossible/corrupted timerTotalMs from ever satisfying completion.
      if (target > 0 && totalElapsed >= target) { autoCompleteTimer(); return true; }
    }
    return false;
  }

function renderClock() {
    if (checkTimerTarget()) return;
    const fresh = getClock();
    const uiMode = isClockActive(fresh) ? 'active' : 'idle';
    if (uiMode !== lastClockUiMode) {
      lastClockUiMode = uiMode;
      renderClockPanel();
      return;
    }
        const act = isClockActive(fresh);
    const ms = displayClockMs(fresh, act);
    setPixelClock(fmtDuration(ms));
    updateClockProgress(fresh, ms, act);
    const cap = document.getElementById('study-clock-caption');
    const capText = clockCaption(fresh, act);
    if (cap && cap.textContent !== capText) cap.textContent = capText;
    const toggleBtn = document.getElementById('study-clock-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('is-running', !!fresh.running);
      const lbl = document.getElementById('study-clock-toggle-label');
      if (lbl) lbl.textContent = fresh.running ? 'Pause' : 'Resume';
    }
    applyClockFocusUI(act);
    renderStudyLog();
  }
  // ---------- temporary chronological study log (bottom-left, Study tab only) ----------
  function fmtLogEntry(entry) {
    const totalMin = Math.round(entry.ms / 60000);
    if (entry.kind === 'hr') {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return entry.label + ' - ' + (m > 0 ? (h + 'hr ' + m + 'min') : (h + 'hr'));
    }
    return entry.label + ' - ' + totalMin + 'min';
  }

    function fmtLogDur(e) {
    const t = Math.round(e.ms / 60000);
    if (e.kind === 'hr') {
      const h = Math.floor(t / 60), m = t % 60;
      return m > 0 ? (h + 'hr ' + m + 'min') : (h + 'hr');
    }
    return t + 'min';
  }

  function renderStudyLog() {
    const panel = document.getElementById('study-log-panel');
    if (!panel) return;
    const entries = TimeEngine.getLogForDate(todayStr());
    const total = entries.reduce(function (a, e) { return a + (e.ms || 0); }, 0);
    const head = '<div class="sp-log-head"><span>Today\u2019s study log</span>' +
      (entries.length ? '<span class="sp-log-total">' + fmtLogDur({ ms: total, kind: 'hr' }) + '</span>' : '') + '</div>';
    const html = !entries.length
      ? head + '<div class="sp-log-empty">Nothing recorded yet.</div>'
      : head + '<div class="sp-log-list">' + entries.map(function (e) {
          return '<div class="sp-log-row"><span class="sp-log-label">' + e.label + '</span><span class="sp-log-dur">' + fmtLogDur(e) + '</span></div>';
        }).join('') + '</div>';
    if (panel._spHtml === html) return; // renderClock calls this every tick — only touch the DOM when it changed
    panel._spHtml = html;
    panel.innerHTML = html;
  }

  
    // ---------- Study workspace UI (Phase 6 · Part 1) — presentation only; timing/state untouched ----------
  let pendingTimerMin = 25;   // configured (not yet started) timer length, in minutes
  let pendingPreset = null;   // null | 'pomodoro' — which preset the configured length came from
  let pxFill = -1;

  function spIco(path, cls) {
    return '<svg class="sp-ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  const SP_ICONS = {
    timer: spIco('<path d="M7 3h10M7 21h10M8 3v3.5c0 1.6 1.2 2.6 4 5.5-2.8 2.9-4 3.9-4 5.5V21M16 3v3.5c0 1.6-1.2 2.6-4 5.5 2.8 2.9 4 3.9 4 5.5V21"/>'),
    pomodoro: spIco('<path d="M12 7.5c-4.6 0-7.5 2.8-7.5 6.6 0 3.6 3 6.4 7.5 6.4s7.5-2.8 7.5-6.4c0-3.8-2.9-6.6-7.5-6.6z"/><path d="M9 6.2c1 .3 2 .9 3 1.3 1-.4 2-1 3-1.3M12 7.5V4.5"/>'),
    stopwatch: spIco('<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M10 3h4M18.2 6.8l1.3-1.3"/>'),
    templates: spIco('<rect x="4" y="4" width="16" height="4.5" rx="1.2"/><rect x="4" y="10.5" width="16" height="4.5" rx="1.2"/><path d="M4 18.5h10"/>'),
    duration: spIco('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
    play: spIco('<path d="M8.5 5.5v13l10-6.5z" fill="currentColor" stroke="none"/>', 'sp-ico-play'),
    pause: spIco('<path d="M8 6v12M16 6v12" stroke-width="2.4"/>', 'sp-ico-pause'),
    check: spIco('<path d="M5 12.5l4.5 4.5L19 7.5"/>')
  };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  }
  function fmtPendingMin(m) {
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (h + ' h' + (r ? ' ' + r + ' min' : '')) : (r + ' min');
  }

  // 5x7 pixel glyphs (colon is 3 wide). Unlit cells are drawn as faint "ghost" pixels.
  const SPX_GLYPHS = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ':': ['000', '000', '010', '000', '010', '000', '000']
  };
  function spxSvg(ch) {
    const g = SPX_GLYPHS[ch];
    if (!g) return '';
    const w = g[0].length;
    let r = '';
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < w; x++) {
        r += '<rect x="' + (x + 0.07) + '" y="' + (y + 0.07) + '" width="0.86" height="0.86" rx="0.14"' + (g[y].charAt(x) === '1' ? ' class="on"' : '') + '/>';
      }
    }
    return '<svg viewBox="0 0 ' + w + ' 7" shape-rendering="crispEdges" aria-hidden="true">' + r + '</svg>';
  }

  // Builds the digit row only when its shape changes (e.g. 59:59 -> 1:00:00); otherwise only changed digits are swapped.
  function setPixelClock(str) {
    const root = document.getElementById('study-clock-display');
    if (!root) return;
    const shape = str.replace(/\d/g, '9');
    if (root.dataset.shape !== shape) {
      root.dataset.shape = shape;
      root.dataset.long = shape.length > 5 ? '1' : '';
      root.innerHTML = str.split('').map(function (ch) {
        return '<span class="' + (ch === ':' ? 'px-c' : 'px-d') + '" data-ch="' + ch + '">' + spxSvg(ch) + '</span>';
      }).join('');
      root.setAttribute('aria-label', str);
      return;
    }
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const ch = str.charAt(i);
      if (kids[i].dataset.ch === ch) continue;
      kids[i].dataset.ch = ch;
      kids[i].innerHTML = spxSvg(ch);
      kids[i].classList.remove('px-swap');
      void kids[i].offsetWidth;
      kids[i].classList.add('px-swap');
    }
    root.setAttribute('aria-label', str);
  }

  // Timer: a 60-cell bar that drains toward the left. Stopwatch: a seconds track that fills toward the right.
  function updateClockProgress(c, ms, active) {
    const bar = document.getElementById('study-clock-progress');
    if (!bar) return;
    let fill;
    if (c.mode === 'timer') {
      const tot = active ? TimeEngine.safeMs(c.timerTotalMs) : 0;
      fill = active ? (tot > 0 ? Math.min(60, Math.ceil(60 * ms / tot)) : 0) : 60;
    } else {
      fill = active ? Math.floor((ms / 1000) % 60) + 1 : 0;
    }
    bar.dataset.kind = c.mode;
    bar.classList.toggle('is-idle', !active);
    bar.classList.toggle('is-paused', active && !c.running);
    const cells = bar.children;
    for (let i = 0; i < cells.length; i++) {
      const on = i < fill;
      const edge = active && i === fill - 1;
      if (cells[i].classList.contains('on') !== on) cells[i].classList.toggle('on', on);
      if (cells[i].classList.contains('edge') !== edge) cells[i].classList.toggle('edge', edge);
    }
    pxFill = fill;
  }

  function displayClockMs(c, active) {
    return (c.mode === 'timer' && !active) ? pendingTimerMin * 60000 : currentClockMs();
  }
  function clockCaption(c, active) {
    const name = c.mode === 'stopwatch' ? 'Stopwatch' : (pendingPreset === 'pomodoro' ? 'Pomodoro' : 'Timer');
    return name + ' \u00B7 ' + (active ? (c.running ? 'Running' : 'Paused') : 'Ready');
  }

  function applyPomodoroPreset() {
    const list = (typeof StudyTemplatesData !== 'undefined') ? StudyTemplatesData.getAllTemplates() : [];
    const p = list.find(function (t) { return t.isPomodoroDefault; });
    pendingTimerMin = (p && p.workMin) || 25;
    pendingPreset = 'pomodoro';
    setClock({ mode: 'timer', timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
  }

  // Custom duration picker (replaces any native time input).
  function openDurationPicker() {
    let h = Math.floor(pendingTimerMin / 60), m = pendingTimerMin % 60;
    function opts(n, padIt) {
      let s = '';
      for (let i = 0; i < n; i++) s += '<button type="button" class="sp-opt" data-v="' + i + '">' + (padIt ? pad(i) : i) + '</button>';
      return s;
    }
    Modal.open(
      '<div class="sp-modal">' +
        '<h3 class="sp-title">Set duration</h3>' +
        '<div class="sp-picker">' +
          '<div class="sp-col-wrap"><span class="sp-col-label">Hours</span><div class="sp-col" data-col="h">' + opts(13, false) + '</div></div>' +
          '<span class="sp-sep">:</span>' +
          '<div class="sp-col-wrap"><span class="sp-col-label">Minutes</span><div class="sp-col" data-col="m">' + opts(60, true) + '</div></div>' +
        '</div>' +
        '<div class="sp-presets">' + [5, 10, 15, 25, 45, 60, 90].map(function (p) {
          return '<button type="button" class="sp-chip sp-preset" data-min="' + p + '">' + fmtPendingMin(p) + '</button>';
        }).join('') + '</div>' +
        '<div class="sp-modal-actions"><button type="button" id="sp-dur-cancel" class="sp-btn">Cancel</button><button type="button" id="sp-dur-ok" class="sp-btn sp-primary">Set time</button></div>' +
      '</div>'
    );
    const root = document.querySelector('.sp-modal');
    if (!root) return;
    const cols = { h: root.querySelector('[data-col="h"]'), m: root.querySelector('[data-col="m"]') };
    const ok = document.getElementById('sp-dur-ok');
    function paint(smooth) {
      [['h', h], ['m', m]].forEach(function (p) {
        const col = cols[p[0]];
        col.querySelectorAll('.sp-opt').forEach(function (b) { b.classList.toggle('is-on', +b.dataset.v === p[1]); });
        const on = col.querySelector('.is-on');
        if (on) col.scrollTo({ top: on.offsetTop - (col.clientHeight - on.offsetHeight) / 2, behavior: smooth ? 'smooth' : 'auto' });
      });
      ok.disabled = (h * 60 + m) < 1;
    }
    ['h', 'm'].forEach(function (k) {
      cols[k].addEventListener('click', function (e) {
        const b = e.target.closest('.sp-opt');
        if (!b) return;
        if (k === 'h') h = +b.dataset.v; else m = +b.dataset.v;
        paint(true);
      });
    });
    root.querySelectorAll('.sp-preset').forEach(function (b) {
      b.addEventListener('click', function () { const p = +b.dataset.min; h = Math.floor(p / 60); m = p % 60; paint(true); });
    });
    document.getElementById('sp-dur-cancel').addEventListener('click', function () { Modal.close(); });
    ok.addEventListener('click', function () {
      if (h * 60 + m < 1) return;
      pendingTimerMin = h * 60 + m;
      pendingPreset = null;
      Modal.close();
      renderClockPanel();
    });
    paint(false);
  }

  // Template picker — selecting configures the clock only; Start is always explicit.
  function openTemplatesModal() {
    const list = (typeof StudyTemplatesData !== 'undefined') ? StudyTemplatesData.getAllTemplates() : [];
    Modal.open(
      '<div class="sp-modal">' +
        '<h3 class="sp-title">Templates</h3>' +
        '<div class="sp-tpl-list">' + (list.map(function (t) {
          return '<div class="sp-tpl" role="button" tabindex="0" data-template-id="' + escHtml(t.templateId) + '">' +
            '<span class="sp-tpl-name">' + escHtml(t.name) + '</span>' +
            '<span class="sp-tpl-meta">' + fmtPendingMin(t.workMin || 25) + '</span>' +
            (t.isPomodoroDefault ? '' : '<button type="button" class="sp-tpl-del" aria-label="Delete template" data-template-id="' + escHtml(t.templateId) + '">&times;</button>') +
          '</div>';
        }).join('') || '<p class="sp-empty">No templates yet.</p>') + '</div>' +
        '<div id="sp-tpl-form" class="sp-tpl-form" hidden>' +
          '<input type="text" id="sp-tpl-name" placeholder="Template name" maxlength="40">' +
          '<input type="number" id="sp-tpl-work" min="1" placeholder="Work min">' +
          '<input type="number" id="sp-tpl-break" min="0" placeholder="Break min">' +
          '<input type="number" id="sp-tpl-cycles" min="1" placeholder="Cycles">' +
        '</div>' +
        '<div class="sp-modal-actions"><button type="button" id="sp-tpl-new" class="sp-btn">New template</button><button type="button" id="sp-tpl-close" class="sp-btn">Close</button></div>' +
      '</div>'
    );
    const root = document.querySelector('.sp-modal');
    if (!root) return;
    root.querySelectorAll('.sp-tpl').forEach(function (row) {
      function choose() {
        const tpl = StudyTemplatesData.getTemplate(row.dataset.templateId);
        if (!tpl || isClockActive(getClock())) { Modal.close(); return; }
        setClock({ mode: 'timer', timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
        pendingTimerMin = tpl.workMin || 25;
        pendingPreset = tpl.isPomodoroDefault ? 'pomodoro' : null;
        Modal.close();
        renderClockPanel();
      }
      row.addEventListener('click', function (e) { if (!e.target.closest('.sp-tpl-del')) choose(); });
      row.addEventListener('keydown', function (e) { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(); } });
    });
    root.querySelectorAll('.sp-tpl-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        StudyTemplatesData.deleteTemplate(btn.dataset.templateId);
        renderClockPanel();
        openTemplatesModal();
      });
    });
    document.getElementById('sp-tpl-close').addEventListener('click', function () { Modal.close(); });
    const form = document.getElementById('sp-tpl-form');
    const newBtn = document.getElementById('sp-tpl-new');
    newBtn.addEventListener('click', function () {
      if (form.hidden) {
        form.hidden = false;
        newBtn.textContent = 'Save template';
        newBtn.classList.add('sp-primary');
        document.getElementById('sp-tpl-name').focus();
        return;
      }
      const name = document.getElementById('sp-tpl-name').value.trim();
      if (!name) { document.getElementById('sp-tpl-name').focus(); return; }
      const workMin = parseInt(document.getElementById('sp-tpl-work').value, 10) || 25;
      const breakMin = parseInt(document.getElementById('sp-tpl-break').value, 10) || 0;
      const cycles = parseInt(document.getElementById('sp-tpl-cycles').value, 10) || 1;
      StudyTemplatesData.createTemplate(name, workMin, breakMin, cycles);
      renderClockPanel();
      openTemplatesModal();
    });
  }

  function renderClockPanel() {
    const container = document.getElementById('study-clock-panel');
    if (!container) return;
    const dock = document.getElementById('study-dock');
    const c = getClock();
    const active = isClockActive(c);
    const isTimer = c.mode === 'timer';
        const dis = active ? ' disabled' : '';
    const loadedPlan = getLoadedPlan();
    function seg(key, label, on) {
      return '<button type="button" class="sp-seg' + (on ? ' is-on' : '') + '" data-mode-key="' + key + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + dis + '>' + SP_ICONS[key] + '<span>' + label + '</span></button>';
    }

    container.innerHTML =
      '<div id="study-clock-caption" class="sp-caption"></div>' +
      '<div id="study-clock-display" class="px-clock" role="timer"></div>' +
            '<div id="study-clock-progress" class="px-progress" aria-hidden="true">' + new Array(61).join('<i></i>') + '</div>' +
      (loadedPlan
        ? '<div id="study-plan-title" class="sp-plan-title"><span id="study-plan-title-text">' + escHtml(planTitleOf(loadedPlan)) + '</span>' +
          (active ? '' : '<button type="button" id="study-plan-unload" class="sp-plan-x" aria-label="Unload plan" title="Unload">&times;</button>') + '</div>'
        : '') +
      '<div class="study-clock-controls sp-actions">' +
        '<button type="button" id="study-clock-start" class="sp-btn sp-primary" style="display:' + (active ? 'none' : 'inline-flex') + '">' + SP_ICONS.play + '<span>Start</span></button>' +
        '<button type="button" id="study-clock-toggle" class="sp-btn' + (c.running ? ' is-running' : '') + '" style="display:' + (active ? 'inline-flex' : 'none') + '">' + SP_ICONS.play + SP_ICONS.pause + '<span id="study-clock-toggle-label">' + (c.running ? 'Pause' : 'Resume') + '</span></button>' +
                '<button type="button" id="study-clock-save" class="sp-btn" style="display:' + (active ? 'inline-flex' : 'none') + '">' + SP_ICONS.check + '<span>Save</span></button>' +
        (loadedPlan
          ? '<button type="button" id="study-plan-resched" class="sp-btn">' + SP_ICONS.duration + '<span>Reschedule</span></button>' +
            '<button type="button" id="study-plan-done" class="sp-btn">' + SP_ICONS.check + '<span>Done</span></button>'
          : '') +
      '</div>';

    if (dock) {
      dock.innerHTML =
        '<div class="sp-segs" role="group" aria-label="Clock mode">' +
          seg('timer', 'Timer', isTimer && pendingPreset !== 'pomodoro') +
          seg('pomodoro', 'Pomodoro', isTimer && pendingPreset === 'pomodoro') +
          seg('stopwatch', 'Stopwatch', !isTimer) +
        '</div>' +
        '<div class="sp-dock-row">' +
          '<div class="sp-dock-col">' +
            '<button type="button" id="study-duration-btn" class="sp-chip"' + ((active || !isTimer) ? ' disabled' : '') + '>' + SP_ICONS.duration + '<span>' + (isTimer ? fmtPendingMin(pendingTimerMin) : 'No limit') + '</span></button>' +
            '<button type="button" id="study-template-open" class="sp-chip"' + dis + '>' + SP_ICONS.templates + '<span>Templates</span></button>' +
          '</div>' +
          '<div id="study-candle-slot" class="sp-candle-slot" aria-hidden="true"></div>' +
        '</div>';

      dock.querySelectorAll('.sp-seg').forEach(function (btn) {
        btn.addEventListener('click', function () {
          // Switching modes is only allowed from a fully idle clock (same rule as before).
          if (isClockActive(getClock())) return;
          const key = btn.dataset.modeKey;
          if (key === 'stopwatch') {
            pendingPreset = null;
            setClock({ mode: 'stopwatch', timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
          } else if (key === 'pomodoro') {
            applyPomodoroPreset();
          } else {
            if (pendingPreset === 'pomodoro') pendingPreset = null;
            setClock({ mode: 'timer', timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
          }
          renderClockPanel();
        });
      });
      document.getElementById('study-duration-btn').addEventListener('click', function () {
        if (!isClockActive(getClock())) openDurationPicker();
      });
      document.getElementById('study-template-open').addEventListener('click', function () {
        if (!isClockActive(getClock())) openTemplatesModal();
      });
    }

    document.getElementById('study-clock-start').addEventListener('click', function () {
      if (getClock().mode === 'timer') {
        if (!pendingTimerMin || pendingTimerMin <= 0) { openDurationPicker(); return; }
        startTimer(pendingTimerMin);
      } else {
        startStopwatch();
      }
    });
    document.getElementById('study-clock-toggle').addEventListener('click', function () {
      if (getClock().running) pauseClock(); else resumeClock();
    });
    document.getElementById('study-clock-save').addEventListener('click', function (e) {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      saveClockAndReset();
    });

        const reschedBtn = document.getElementById('study-plan-resched');
    if (reschedBtn) reschedBtn.addEventListener('click', openPlanReschedule);
    const doneBtn = document.getElementById('study-plan-done');
    if (doneBtn) doneBtn.addEventListener('click', function (e) {
      if (e.currentTarget.disabled) return;
      e.currentTarget.disabled = true;
      completePlanFromStudy();
    });
    const unloadBtn = document.getElementById('study-plan-unload');
    if (unloadBtn) unloadBtn.addEventListener('click', unloadPlanTask);

    lastClockUiMode = active ? 'active' : 'idle';
    applyClockFocusUI(active);
    renderClock();
    syncCandleSlot();
    renderPlanBox();
  }

  // Visual only: anchors the candle's existing element (its bottom-centre, which is also its scale origin and
  // its base's centre) to the Tools Box slot via two CSS variables. Resting, lit and focused all share that
  // anchor, so nothing about the candle's position changes with state or fullscreen. Logic/state untouched.
  function syncCandleSlot() {
    const screen = document.getElementById('screen-study');
    const slot = document.getElementById('study-candle-slot');
    const mount = screen && screen.querySelector(':scope > .candle-lamp-mount');
    if (!slot || !mount) return;
    const sr = slot.getBoundingClientRect();
    if (!sr.width) return;
    const GAP = 14; // px between the slot's bottom edge and the candle's bottom (leaves room for the base)
    const op = mount.offsetParent;
    const cr = op ? op.getBoundingClientRect() : { right: window.innerWidth, bottom: window.innerHeight };
    const cs = getComputedStyle(mount);
    const bx = cr.right - (parseFloat(cs.right) || 0) - mount.offsetWidth / 2; // untranslated bottom-centre
    const by = cr.bottom - (parseFloat(cs.bottom) || 0);
    mount.style.setProperty('--candle-dx', Math.round(sr.left + sr.width / 2 - bx) + 'px');
    mount.style.setProperty('--candle-dy', Math.round(sr.bottom - GAP - by) + 'px');
  }

    // ---- Manual fullscreen: ONLY #study-clock-box morphs. #study-layout, the Study Log, the Empty Box and the
  // Tools Box (and the candle's slot inside it) never move, so nothing else is re-rendered or re-laid-out. ----
  let studyFsBusy = false;
    // The fullscreen target is read from the Clock Box's real fullscreen CSS geometry (position: fixed; inset: 0),
  // so the morph ends on exactly the rect the stylesheet gives it. This keeps scrollbar, dynamic toolbars and
  // safe-area differences from causing a snap. Call it only while .study-fs-on is set and no morph is running.
  function studyFsViewport(box) {
    const r = box.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, r: 0 };
  }
  // The Clock Box's own grid-cell rect (viewport coords), measured fresh so a resize or scroll while in
  // fullscreen cannot leave a stale target. While fullscreen the box is fixed, so the fullscreen class is
  // lifted for one synchronous read and put straight back (no paint happens in between).
  function studyFsHomeRect(screen, box) {
    const wasOn = screen.classList.contains('study-fs-on');
    if (wasOn) screen.classList.remove('study-fs-on');
    const r = box.getBoundingClientRect();
    if (wasOn) screen.classList.add('study-fs-on');
    return { top: r.top, left: r.left, width: r.width, height: r.height, r: 22 };
  }
  // Morphs the SAME #study-clock-box element between two viewport rects. Its wallpaper, blur panel, nav buttons,
  // fullscreen toggle are children of the box, so they stay clipped to it and scale with it.
  // The candle is anchored to the (unmoving) Tools Box slot, so it is only re-synced once, when the morph ends.
  function studyFsMorph(box, from, to, done) {
    if (!box.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    function frame(r) {
      return { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: r.r + 'px' };
    }
    const a = box.animate([frame(from), frame(to)], { duration: 560, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'forwards' });
    a.onfinish = function () {
      a.cancel(); // release the forwards-fill first, so the reads in done() see the real CSS geometry
      done();
      window.dispatchEvent(new Event('lavender-candle-recenter'));
    };
  }
  function setStudyFsBtn(on) {
    const btn = document.getElementById('study-fs-btn');
    if (!btn) return;
    btn.classList.toggle('is-fs', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Exit fullscreen' : 'Enter fullscreen';
  }
    function enterStudyFs() {
    const screen = document.getElementById('screen-study');
    const box = document.getElementById('study-clock-box');
    if (!screen || !box) return;
    studyFsBusy = true;
    const br = box.getBoundingClientRect();
    const first = { top: br.top, left: br.left, width: br.width, height: br.height, r: 22 };
    document.body.classList.add('study-fs-busy');
    screen.classList.add('study-fs-on');
    document.body.classList.add('study-fs-on');
    setStudyFsBtn(true);
    syncCandleSlot();
        studyFsMorph(box, first, studyFsViewport(box), function () {
      studyFsBusy = false;
      document.body.classList.remove('study-fs-busy');
      syncCandleSlot();
      if (!isBrowserFullscreen()) requestBrowserFullscreen().catch(function () {});
    });
  }
  function leaveStudyFs(skipApi) {
    const screen = document.getElementById('screen-study');
    const box = document.getElementById('study-clock-box');
    if (!screen || !box) return;
    studyFsBusy = true;
    document.body.classList.add('study-fs-busy');
    function finish() {
      screen.classList.remove('study-fs-on');
      document.body.classList.remove('study-fs-on');
      setStudyFsBtn(false);
      syncCandleSlot();
      requestAnimationFrame(function () {
        document.body.classList.remove('study-fs-busy');
        studyFsBusy = false;
      });
    }
    function run() {
            studyFsMorph(box, studyFsViewport(box), studyFsHomeRect(screen, box), finish);
    }
    if (!skipApi && isBrowserFullscreen()) {
      exitBrowserFullscreen().catch(function () {}).then(function () {
        requestAnimationFrame(function () { requestAnimationFrame(run); });
      });
    } else {
      run();
    }
  }
  function toggleStudyFullscreen() {
    if (studyFsBusy) return;
    const screen = document.getElementById('screen-study');
    if (screen && screen.classList.contains('study-fs-on')) leaveStudyFs(false); else enterStudyFs();
  }

    function initStudyWorkspace() {
    if (typeof CanonicalTaskStore !== 'undefined' && CanonicalTaskStore.subscribe) {
      let pbTimer = null;
      CanonicalTaskStore.subscribe(function () {
        if (pbTimer) return;
        pbTimer = setTimeout(function () { pbTimer = null; syncPlanTitle(); renderPlanBox(); }, 60);
      });
    }
    const layout = document.getElementById('study-layout');
    if (!layout || layout.dataset.wsBound) return;
    layout.dataset.wsBound = '1';
    const fsBtn = document.getElementById('study-fs-btn');
    if (fsBtn) fsBtn.addEventListener('click', toggleStudyFullscreen);
    window.addEventListener('resize', syncCandleSlot);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(syncCandleSlot);
      ro.observe(layout);
      const dock = document.getElementById('study-dock');
      if (dock) ro.observe(dock);
    }
  }


  
  
  


  // ---------- 3.2 Timetable execution — delegates entirely to TimeEngine (single source of truth) ----------
  let promptToken = null;   // dedupe: which exact prompt-state is currently shown as a modal
  let doItLaterOpen = false;
  let lastSessionSig = null;

  function startTaskSession(taskId) { TimeEngine.startTaskSession(taskId); }
  function isSessionActive() { return TimeEngine.isSessionActive(); }

  function renderAlarmPanel() {
    const container = document.getElementById('study-session-panel');
    if (!container) return;
    const active = TimeEngine.getActiveSession();

    if (active) { renderFocusMode(active); return; }
    exitFocusMode();

    const upcoming = TimeEngine.getUpcomingSession();
    if (upcoming) {
      const task = PlannerData.getAllTasks()[upcoming.taskId];
      container.innerHTML = '<p class="study-active-label">Next up: ' + taskLabelFull(task) + ' at ' + upcoming.adjustedStart + '</p>' +
        '<button id="study-start-now">Start Now</button>';
      document.getElementById('study-start-now').addEventListener('click', function (e) {
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        startTaskSession(upcoming.taskId);
      });
    } else {
      container.innerHTML = '<p class="study-active-label">No active slot session.</p>';
    }
  }

  const EARLY_COMPLETE_THRESHOLD_MS = 60000;
  function showEarlyCompleteDecision(earlyByMs, btn) {
    const mins = Math.max(1, Math.round(earlyByMs / 60000));
    Modal.open(
      '<h3>Finished early</h3>' +
      '<p>About ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' early. Use the recovered time to move the rest of today\u2019s schedule earlier, or keep it on the original schedule?</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="study-early-keep">Keep schedule unchanged</button>' +
        '<button id="study-early-adjust">Auto-adjust remaining</button>' +
      '</div>'
    );
    const keepBtn = document.getElementById('study-early-keep');
    const adjustBtn = document.getElementById('study-early-adjust');
    // If the decision modal didn't actually open (refused/locked), never leave Completed dead —
    // complete through the same canonical path instead, with no schedule change.
    if (!keepBtn || !adjustBtn) { TimeEngine.completeActive(); return; }
    function finish() { TimeEngine.completeActive(); Modal.close(); }
    keepBtn.addEventListener('click', finish);
    adjustBtn.addEventListener('click', function () {
      TimeEngine.applyShift(-earlyByMs);
      finish();
    });
  }

  // Title of the active Itinerary item that launched this task's session (if any) — read from the
  // Itinerary's own today-state, never stored or duplicated here.
  function itineraryTitleForTask(taskId) {
    if (typeof ItineraryData === 'undefined' || !taskId) return '';
    const items = ItineraryData.getToday().items || [];
    const it = items.find(function (x) {
      return x.state === 'active' && x.refId === taskId && (x.type === 'study' || x.type === 'planner-task');
    });
    return (it && it.label) ? String(it.label).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) : '';
  }

  // Focus Mode (§4): large clock + only Links / Completed / Pause / Do it later.
function renderFocusMode(active) {
    const container = document.getElementById('study-session-panel');
    const task = PlannerData.getAllTasks()[active.taskId];
    const clockPanel = document.getElementById('study-clock-panel');
    if (clockPanel) clockPanel.style.display = 'none';
    applyChromeVisibility();

    const itineraryTitle = itineraryTitleForTask(active.taskId);
    container.innerHTML =
      '<div class="study-focus-mode">' +
                '<p class="study-active-label study-note-top">' + (itineraryTitle || taskLabelFull(task)) + '</p>' +
        '<div id="study-focus-clock" class="study-focus-clock"></div>' +
        '<div id="study-focus-remaining" class="study-focus-remaining study-note"></div>' +
        (active.state === 'paused' ? '<p class="study-paused-note">Paused</p>' : '') +
        '<div class="study-focus-actions">' +
          '<button id="study-focus-complete" class="btn btn-primary">Completed</button>' +
          '<button id="study-focus-pause" class="btn btn-secondary">' + (active.state === 'paused' ? 'Resume' : 'Pause') + '</button>' +
          '<button id="study-focus-later" class="btn btn-secondary">Do it later</button>' +
          (itineraryTitle ? '<button id="study-focus-back-to-itinerary" class="btn btn-secondary">Back to Itinerary</button>' : '') +
        '</div>' +
      '</div>';

    renderFocusClock();
    document.getElementById('study-focus-complete').addEventListener('click', function (e) {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const cur = TimeEngine.getActiveSession();
        if (!cur) return; // session already ended elsewhere (e.g. item removed/unscheduled) — nothing to complete
        const endMs = cur.adjustedEndAt || timeStrToMs(cur.date, cur.adjustedEnd);
        const earlyByMs = endMs ? endMs - Date.now() : 0;
        // Itinerary-launched sessions never auto-shift the schedule: complete directly through the
        // canonical path (the orchestrator resolves the item from TimeEngine's own record).
        const launchedByItinerary = !!itineraryTitleForTask(cur.taskId);
        if (!launchedByItinerary && earlyByMs > EARLY_COMPLETE_THRESHOLD_MS) { showEarlyCompleteDecision(earlyByMs, btn); return; }
        TimeEngine.completeActive();
      } catch (err) {
        console.warn('study-focus-complete click failed — re-enabling button', err);
      } finally {
        if (document.getElementById('study-focus-complete') === btn) btn.disabled = false;
      }
    });
    document.getElementById('study-focus-pause').addEventListener('click', function (e) {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const cur = TimeEngine.getActiveSession();
        if (!cur) return;
        if (cur.state === 'paused') TimeEngine.resumeActive(); else TimeEngine.pauseActive();
      } catch (err) {
        console.warn('study-focus-pause click failed — re-enabling button', err);
      } finally {
        if (document.getElementById('study-focus-pause') === btn) btn.disabled = false;
      }
    });
    document.getElementById('study-focus-later').addEventListener('click', function () {
      try { confirmDoItLater(active.taskId); }
      catch (err) { console.warn('study-focus-later click failed', err); }
    });
    const backToItineraryBtn = document.getElementById('study-focus-back-to-itinerary');
    if (backToItineraryBtn) backToItineraryBtn.addEventListener('click', function () {
      if (typeof ItineraryToday !== 'undefined' && ItineraryToday.openTodayView) ItineraryToday.openTodayView();
    });
  }

  function renderFocusClock() {
    const el = document.getElementById('study-focus-clock');
    if (el) el.textContent = fmtDuration(TimeEngine.getClockDisplayMs());
    const remainEl = document.getElementById('study-focus-remaining');
    if (remainEl) {
      const active = TimeEngine.getActiveSession();
      if (active) {
        const endMs = active.adjustedEndAt || timeStrToMs(active.date, active.adjustedEnd);
        const nowRef = active.state === 'paused' ? active.pausedSince : Date.now();
        remainEl.textContent = 'Remaining: ' + fmtDuration(Math.max(0, endMs - nowRef));
      } else {
        remainEl.textContent = '';
      }
    }
  }

  function exitFocusMode() {
    const clockPanel = document.getElementById('study-clock-panel');
    if (clockPanel) clockPanel.style.display = 'block';
    applyChromeVisibility();
  }

  function confirmDoItLater(taskId) {
    Modal.open(
      '<h3>Do it later?</h3>' +
      '<p>This will end your current session and reschedule the task. Continue?</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="study-later-proceed">Yes, reschedule</button>' +
        '<button id="study-later-cancel">Cancel</button>' +
      '</div>'
    );
    const proceedBtn = document.getElementById('study-later-proceed');
    const cancelBtn = document.getElementById('study-later-cancel');
    if (!proceedBtn || !cancelBtn) return; // Modal didn't actually open (e.g. refused) — nothing to wire
    proceedBtn.addEventListener('click', function () { openDoItLaterModal(taskId); });
    cancelBtn.addEventListener('click', function () { Modal.close(); });
  }

  function openDoItLaterModal(taskId) {
    doItLaterOpen = true;
    const task = PlannerData.getAllTasks()[taskId];
    Modal.open(
      '<h3>Do it later</h3>' +
      '<input type="date" id="study-later-date" value="' + tomorrowStr() + '" min="' + todayStr() + '">' +
      '<div class="planner-slot-row">' +
        '<div><label class="planner-field-label">Start</label><input type="time" id="study-later-start" value="' + ((task && task.startTime) || '') + '"></div>' +
        '<div><label class="planner-field-label">Stop</label><input type="time" id="study-later-stop" value="' + ((task && task.stopTime) || '') + '"></div>' +
      '</div>' +
      '<button id="study-later-confirm">Reschedule</button>'
    );
    const confirmBtn = document.getElementById('study-later-confirm');
    if (!confirmBtn) { doItLaterOpen = false; return; } // Modal didn't actually open (e.g. refused) — nothing to wire
    confirmBtn.addEventListener('click', function () {
      const dateVal = document.getElementById('study-later-date').value;
      const startVal = document.getElementById('study-later-start').value;
      const stopVal = document.getElementById('study-later-stop').value;
      if (!dateVal) { alert('Pick a date.'); return; }
      const ok = TimeEngine.doItLater(taskId, dateVal, startVal, stopVal);
      if (!ok) { alert('That slot is invalid or overlaps another task on ' + dateVal + '. Pick a different date/time.'); return; }
      doItLaterOpen = false;
      Modal.close();
    });
  }

  
  function renderBreakStatus() {
    const btn = document.getElementById('global-break-btn');
    if (!btn) return;
    const gb = TimeEngine.getGlobalBreak();
    if ((gb && gb.active) || TimeEngine.isSessionActive()) { btn.style.display = 'none'; return; }
        btn.style.display = '';
    if (btn.textContent !== '\u2615') btn.textContent = '\u2615';
    btn.disabled = false;
  }

  // §2.3 — full-takeover break screen: Break / remaining time / Add Time / End Break, nothing
  // else. Wallpaper (§2.5, Settings-only for now) shown as background when configured.
  function renderBreakTakeover() {
    const container = document.getElementById('global-break-takeover');
    if (!container) return;
    const gb = TimeEngine.getGlobalBreak();
    if (!gb || !gb.active) { container.style.display = 'none'; container.dataset.built = ''; return; }
    const remainingMin = Math.max(0, Math.ceil((gb.resumeAt - Date.now()) / 60000));
    const settings = State.get().settings || {};
    container.style.display = 'flex';
    container.style.backgroundImage = settings.breakWallpaper ? 'url(' + settings.breakWallpaper + ')' : 'none';
    // Only build the DOM once per break (guarded by dataset.built) — rebuilding every
    // tick on innerHTML was what caused the continuous reload/glitch. Every subsequent
    // tick just updates the remaining-time text in place.
    if (container.dataset.built !== gb.startedAt + '') {
      container.dataset.built = gb.startedAt + '';
      container.innerHTML =
        '<div class="break-takeover-inner">' +
          '<h2>Break</h2>' +
          '<div class="break-takeover-remaining" id="break-takeover-remaining">' + remainingMin + 'm left</div>' +
          '<div class="break-takeover-actions">' +
            '<button id="break-takeover-add">Add Time</button>' +
            '<button id="break-takeover-end">End Break</button>' +
          '</div>' +
        '</div>';
      document.getElementById('break-takeover-add').addEventListener('click', openAddBreakTimeModal);
      document.getElementById('break-takeover-end').addEventListener('click', function () {
        TimeEngine.endGlobalBreak();
        container.dataset.built = '';
        renderBreakTakeover();
        renderBreakStatus();
      });
    } else {
      const remainingEl = document.getElementById('break-takeover-remaining');
      if (remainingEl) remainingEl.textContent = remainingMin + 'm left';
    }
  }

  function openAddBreakTimeModal() {
    Modal.open(
      '<h3>Add time</h3>' +
      '<input type="number" id="break-add-minutes" min="1" placeholder="Minutes">' +
      '<button id="break-add-confirm">Add</button>'
    );
    document.getElementById('break-add-confirm').addEventListener('click', function () {
      const minutes = parseInt(document.getElementById('break-add-minutes').value, 10);
      if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
      TimeEngine.addGlobalBreakTime(minutes);
      Modal.close();
      renderBreakTakeover();
    });
  }

  function openBreakInputModal() {
    breakInputOpen = true;
    const defaultMin = (State.get().settings || {}).defaultBreakDuration;
    Modal.open(
            '<div class="break-modal">' +
        '<h3>Take a break</h3>' +
        '<div class="break-modal-presets">' +
          '<button type="button" class="break-chip" data-min="5">5 min</button>' +
          '<button type="button" class="break-chip" data-min="10">10 min</button>' +
          '<button type="button" class="break-chip" data-min="15">15 min</button>' +
          '<button type="button" class="break-chip" data-min="30">30 min</button>' +
        '</div>' +
        '<input type="number" id="global-break-minutes" min="1" placeholder="Minutes"' + (defaultMin ? ' value="' + defaultMin + '"' : '') + '>' +
        '<input type="text" id="global-break-note" placeholder="Note (optional)">' +
        '<div class="break-modal-actions">' +
          '<button type="button" id="break-timeline-toggle" class="break-btn-ghost">Timeline</button>' +
          '<button type="button" id="global-break-confirm">Start Break</button>' +
        '</div>' +
        '<details class="break-modal-log">' +
          '<summary>Already took a break?</summary>' +
          '<div class="break-modal-log-body">' +
            '<input type="number" id="unrecorded-break-minutes" min="1" placeholder="Minutes">' +
            '<input type="text" id="unrecorded-break-note" placeholder="Note (optional)">' +
            '<div class="break-modal-actions">' +
              '<button type="button" id="unrecorded-break-confirm">Log it</button>' +
            '</div>' +
          '</div>' +
        '</details>' +
      '</div>'
    );
        document.querySelectorAll('.break-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.getElementById('global-break-minutes').value = chip.dataset.min;
      });
    });
    document.getElementById('global-break-confirm').addEventListener('click', function () {
      const minutes = parseInt(document.getElementById('global-break-minutes').value, 10);
      if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
      breakInputOpen = false;
      Modal.close();
      const note = document.getElementById('global-break-note').value.trim();
TimeEngine.startGlobalBreak(minutes, note);
      renderBreakStatus();
      renderBreakTakeover();
    });
    document.getElementById('unrecorded-break-confirm').addEventListener('click', function () {
      const minutes = parseInt(document.getElementById('unrecorded-break-minutes').value, 10);
      if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
      const note = document.getElementById('unrecorded-break-note').value.trim();
TimeEngine.logUnrecordedBreak(minutes, note);
      breakInputOpen = false;
      Modal.close();
    });
    document.getElementById('break-timeline-toggle').addEventListener('click', function() {
    openBreakTimelinePanel();
});
  }

  function promptTokenFor(prompt) {
    return prompt ? [prompt.sessionId, prompt.kind, prompt.fireAt, prompt.autoBreakActive].join('|') : null;
  }

  function showPrompt(prompt) {
    const task = PlannerData.getAllTasks()[prompt.taskId];
    const heading = prompt.kind === 'start' ? 'Time for: ' : 'Wrap up: ';
    // Wrap-up (kind 'end') primary action is "Completed" — it ends the session for real.
    // The start prompt's primary action is still "Started".
      const primaryLabel = prompt.kind === 'end' ? 'Completed' : 'Started';
    const primaryChoice = prompt.kind === 'end' ? 'complete' : 'start';
    Notify.deliver(heading.trim(), task ? taskLabelFull(task) : '');
    Modal.open(
      '<h3>' + heading + (task ? taskLabelFull(task) : '') + '</h3>' +
      '<div class="study-prompt-actions">' +
        '<button id="study-prompt-start">' + primaryLabel + '</button>' +
        '<button id="study-prompt-break">Need a break</button>' +
        '<button id="study-prompt-time">Need more time</button>' +
      '</div>'
    );
    document.getElementById('study-prompt-start').addEventListener('click', function () {
      if (prompt.kind === 'end' && task && QUESTION_TASK_TYPES.indexOf(task.taskType) !== -1) { showQuestionsInput(); return; }
      TimeEngine.resolvePrompt(primaryChoice);
      Modal.close();
    });
    document.getElementById('study-prompt-break').addEventListener('click', function () { TimeEngine.resolvePrompt('break'); Modal.close(); });
    document.getElementById('study-prompt-time').addEventListener('click', function () { showTimeInput(); });
  }

  function showTimeInput() {
    timeInputOpen = true;
    Modal.open(
      '<h3>How many minutes?</h3>' +
      '<input type="number" id="study-time-minutes" min="1">' +
      '<button id="study-time-confirm">Confirm</button>'
    );
    document.getElementById('study-time-confirm').addEventListener('click', function () {
      const minutes = parseInt(document.getElementById('study-time-minutes').value, 10);
      if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
      timeInputOpen = false;
      TimeEngine.resolvePrompt('time', minutes);
      Modal.close();
    });
  }

  function showQuestionsInput() {
    questionsInputOpen = true;
    Modal.open(
      '<h3>How many questions did you solve?</h3>' +
      '<input type="number" id="study-questions-count" min="0" step="1">' +
      '<button id="study-questions-confirm">Confirm</button>'
    );
    document.getElementById('study-questions-confirm').addEventListener('click', function () {
      const n = Math.max(0, parseInt(document.getElementById('study-questions-count').value, 10) || 0);
      questionsInputOpen = false;
      TimeEngine.resolvePrompt('complete', null, n);
      Modal.close();
    });
  }

  function showAutoBreakNotice(prompt) {
    const remainMin = Math.max(0, Math.ceil((prompt.autoBreakResumeAt - Date.now()) / 60000));
    Notify.deliver('On a short break', 'Back in ' + remainMin + ' min \u2014 you\'ll be asked again.');
    Modal.open('<h3>On a short break</h3><p>No response, so a 5-minute break started automatically. Back in ' + remainMin + ' min \u2014 you\'ll be asked again.</p>');
  }

function handlePrompt() {
    const prompt = TimeEngine.getPrompt();
    if (timeInputOpen && document.getElementById('study-time-minutes')) return;
    if (questionsInputOpen && document.getElementById('study-questions-count')) return;
    if (!prompt) { promptToken = null; return; }
    const token = promptTokenFor(prompt);
    const overlay = document.getElementById('modal-overlay');
    const overlayOpen = !!overlay && overlay.style.display !== 'none';
    // Re-show even if the token hasn't changed when the overlay got dismissed (e.g. backdrop
    // click) — an unanswered prompt must stay visible until answered or it auto-times out.
    if (token === promptToken && overlayOpen) return;
    promptToken = token;
    timeInputOpen = false;
    questionsInputOpen = false;
    if (prompt.autoBreakActive) showAutoBreakNotice(prompt); else showPrompt(prompt);
  }

  function isPastCutoff() {
    return new Date().getHours() >= 23;
  }

  function renderCutoffView() {
    const container = document.getElementById('study-cutoff-view');
    if (!container) return;
    const today = todayStr();
    const stats = TimeEngine.getDayStats(today);
    const tasks = PlannerData.getTasksForDate(today);
    const doneCount = tasks.filter(function (t) { return t.completed; }).length;
    const totalCount = tasks.length;
    const workDonePct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
    const totalTrackedMs = stats.studyMs + stats.breakMs;
    const breakPct = totalTrackedMs === 0 ? 0 : Math.round((stats.breakMs / totalTrackedMs) * 100);
    const studyPct = totalTrackedMs === 0 ? 0 : 100 - breakPct;
    const pendingTomorrow = PlannerData.getTasksForDate(tomorrowStr()).filter(function (t) { return !t.completed; }).length;

    container.innerHTML =
      '<p class="study-goodnight-msg">Goodnight, you did well. Proud of you... We will be better tomorrow</p>' +
      '<div class="study-cutoff-stats">' +
        '<div class="study-cutoff-stat"><div>Work done: ' + workDonePct + '% (' + doneCount + '/' + totalCount + ')</div>' +
          '<div>Not done: ' + (100 - workDonePct) + '%</div></div>' +
        '<div class="study-cutoff-stat"><div>Study: ' + studyPct + '%</div>' +
          '<div>Breaks: ' + breakPct + '%</div></div>' +
      '</div>' +
      '<div class="study-cutoff-reminders">' +
        '<p>Pending tasks for tomorrow: ' + pendingTomorrow + '</p>' +
        '<p class="study-reminder-highlight">Add tomorrow\'s goal in Calendar.</p>' +
        '<p class="study-reminder-highlight">Fill out today\'s journal.</p>' +
      '</div>';
  }

  function setCutoffMode(active) {
    const sessionPanel = document.getElementById('study-session-panel');
    const cutoffView = document.getElementById('study-cutoff-view');
    const clockPanel = document.getElementById('study-clock-panel');
    if (active) {
      if (clockPanel) clockPanel.style.display = 'none';
      if (sessionPanel) sessionPanel.style.display = 'none';
      if (cutoffView) cutoffView.style.display = 'block';
      renderCutoffView();
    } else {
      if (cutoffView) cutoffView.style.display = 'none';
    }
    // Never force-show clockPanel/sessionPanel/alarmIcon/linksIcon/breakBtn here — that's what
    // was fighting with renderFocusMode/applyClockFocusUI and causing the flicker. Leave those
    // to whichever flow (Planner session or manual clock) is actually authoritative right now.
    applyChromeVisibility();
  }

  // Single re-render callback — invoked by TimeEngine's one-and-only heartbeat (every 1s)
  // and immediately after every user action, so there is exactly one timer driving the UI.
   function onEngineTick() {
    checkTimerTarget(); // unconditional — see comment on the function, must never be gated
    renderStudyLog();
    const pastCutoff = isPastCutoff();
    setCutoffMode(pastCutoff);
    renderBreakStatus();
    renderBreakTakeover();
    if (!pastCutoff) {
      const active = TimeEngine.getActiveSession();
      const upcoming = TimeEngine.getUpcomingSession();
      const sig = active ? (active.sessionId + ':' + active.state) : ('idle:' + (upcoming ? upcoming.sessionId : 'none'));
      if (sig !== lastSessionSig) {
        lastSessionSig = sig;
        renderAlarmPanel();
      } else if (active) {
        renderFocusClock();
      } else {
        renderClock();
      }
    }
    if (pastCutoff) return;
    if (breakInputOpen && document.getElementById('global-break-minutes')) return;
    if (doItLaterOpen && document.getElementById('study-later-date')) return;
    handlePrompt();
  }

  
function openBreakTimelinePanel() {
    const breaks = TimeEngine.getBreaksForDate();
    if (!breaks.length) { Modal.open('<h3>Break Timeline</h3><p>No breaks recorded today.</p>'); return; }
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function fmtTime(ms) { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function fmtMin(ms) { return Math.round(ms / 60000) + 'min'; }
    const rows = breaks.map(function(b) {
        return '<div class="break-timeline-row">' +
            '<span class="break-timeline-time">' + fmtTime(b.startedAt) + '</span>' +
            '<span class="break-timeline-type">' + b.type + '</span>' +
            '<span class="break-timeline-dur">' + fmtMin(b.durationMs) + '</span>' +
            (b.note ? '<span class="break-timeline-note">' + b.note + '</span>' : '') +
        '</div>';
    }).join('');
    Modal.open('<h3>Break Timeline</h3><div class="break-timeline">' + rows + '</div>');
}
    
  function isBrowserFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }
  function requestBrowserFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!req) return Promise.reject(new Error('Fullscreen API unavailable'));
    return req.call(el);
  }
  function exitBrowserFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!exit) return Promise.reject(new Error('Fullscreen API unavailable'));
    return exit.call(document);
  }
  function syncFullscreenBtn() {
    const btn = document.getElementById('fullscreen-btn');
    if (btn) btn.classList.toggle('is-fullscreen-active', isBrowserFullscreen());
  }
  let fullscreenPending = false;
  function toggleBrowserFullscreen() {
    if (fullscreenPending) return;
    fullscreenPending = true;
    const done = function () { fullscreenPending = false; };
    if (isBrowserFullscreen()) {
      exitBrowserFullscreen().then(done).catch(done);
    } else {
      requestBrowserFullscreen().then(done).catch(done);
    }
  }

  function init() {
    Notify.requestPermission();
    if (typeof StudyTemplatesData !== 'undefined') StudyTemplatesData.seedDefaultIfMissing();
     const wpLayout = document.getElementById('study-layout');
    if (wpLayout && !wpLayout.dataset.wpNavBound) {
      wpLayout.dataset.wpNavBound = '1';
      let wpNavLock = false;
      wpLayout.addEventListener('click', function (e) {
        const btn = e.target.closest('#study-wallpaper-prev, #study-wallpaper-next');
        if (!btn || typeof StudyWallpaper === 'undefined') return;
        if (wpNavLock) return;
        wpNavLock = true;
        requestAnimationFrame(function () { wpNavLock = false; });
        if (btn.id === 'study-wallpaper-prev') StudyWallpaper.prev();
        else StudyWallpaper.next();
      });
    }
    const autoFsToggle = document.getElementById('study-autofs-toggle');
    if (autoFsToggle) {
      autoFsToggle.checked = !!(State.get().settings || {}).studyAutoFullscreen;
      autoFsToggle.addEventListener('change', function () {
        State.patch('settings', { studyAutoFullscreen: autoFsToggle.checked });
      });
    }
        const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) fsBtn.addEventListener('click', toggleBrowserFullscreen);
    initStudyWorkspace();
    function onFullscreenChange() {
      syncFullscreenBtn();
            const _wasFs = isBrowserFullscreen();
      State.patch('settings', { userExitedFullscreen: !_wasFs });
      const _studyScr = document.getElementById('screen-study');
      if (!_wasFs && _studyScr && _studyScr.classList.contains('study-fs-on') && !studyFsBusy) leaveStudyFs(true);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    syncFullscreenBtn();
    if (typeof StudyWallpaper !== 'undefined' && !document.body.dataset.studyWpVisBound) {
      document.body.dataset.studyWpVisBound = '1';
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) StudyWallpaper.pauseVideo();
        else {
          const screenEl = document.getElementById('screen-study');
          if (screenEl && !screenEl.classList.contains('screen-hidden') && screenEl.offsetParent !== null) StudyWallpaper.resumeVideo();
        }
      });
    }
    renderClockPanel();
    renderAlarmPanel();
    lastSessionSig = null;
    setCutoffMode(isPastCutoff());
    renderBreakStatus();
    renderBreakTakeover();
    renderStudyLog();
    const breakBtn = document.getElementById('global-break-btn');
    if (breakBtn) breakBtn.addEventListener('click', openBreakInputModal);
    // TimeEngine owns the single interval for all timing/session state (see timeengine.js §1).
    // Fixed id ('study') makes re-subscription idempotent if init() ever runs again — it
    // replaces this module's callback in the registry instead of accumulating a second one.
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) {
      TimeEngine.subscribe(onEngineTick, 'study');
    }
    }
  function render() {
    renderClockPanel();
    lastSessionSig = null;
    renderAlarmPanel();
    setCutoffMode(isPastCutoff());
    renderBreakStatus();
    renderBreakTakeover();
    renderStudyLog();
  }
        return { init: init, render: render, startTaskSession: startTaskSession, isSessionActive: isSessionActive, syncCandleSlot: syncCandleSlot, stopClockForPlanTask: stopClockForPlanTask };
})();
