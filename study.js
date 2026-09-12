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
    renderClockPanel();
    clockCompleting = false;
  }

  // Timer hit its target — commit whatever tail segment wasn't committed by an earlier pause
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
    renderClockPanel();
    clockCompleting = false;
  }

  // While a Stopwatch/Timer run (or the end-of-timer decision) is active, it takes over the
  // whole Study tab like a session: big clock, everything else hidden.
  function applyClockFocusUI(active) {
    const sessionPanel = document.getElementById('study-session-panel');
    const clockPanel = document.getElementById('study-clock-panel');
    if (sessionPanel) sessionPanel.style.display = active ? 'none' : 'block';
    if (clockPanel) clockPanel.classList.toggle('study-clock-focus', !!active);
    applyChromeVisibility();
  }
  function isClockActive(c) {
    return !!(c.running || (c.elapsedMs || 0) > 0 || c.awaitingDecision);
  }

  // Single source of truth for the shared chrome (alarm icon, links icon, break button) — hidden
  // whenever EITHER a planner session OR the manual Stopwatch/Timer is active, computed fresh
  // every time so the two flows can never fight each other and cause a flicker.
  function applyChromeVisibility() {
    const active = !!TimeEngine.getActiveSession() || isClockActive(getClock());
    const alarmIcon = document.getElementById('study-alarm-icon');
    const linksIcon = document.getElementById('study-links-icon');
    const breakBtn = document.getElementById('global-break-btn');
    if (alarmIcon) alarmIcon.style.display = active ? 'none' : 'inline-block';
    if (linksIcon) linksIcon.style.display = active ? 'none' : 'inline-block';
    if (breakBtn) breakBtn.style.display = active ? 'none' : 'inline-block';
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
    const display = document.getElementById('study-clock-display');
    if (display) display.textContent = fmtDuration(currentClockMs());
    const toggleBtn = document.getElementById('study-clock-toggle');
    if (toggleBtn) toggleBtn.textContent = fresh.running ? 'Pause' : 'Resume';
    applyClockFocusUI(isClockActive(fresh));
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

  function renderStudyLog() {
    const panel = document.getElementById('study-log-panel');
    if (!panel) return;
    const entries = TimeEngine.getLogForDate(todayStr());
    if (!entries.length) { panel.innerHTML = '<strong>Today\'s study log</strong><div>Nothing recorded yet.</div>'; return; }
    panel.innerHTML = '<strong>Today\'s study log</strong>' +
      entries.map(function (e) { return '<div>' + fmtLogEntry(e) + '</div>'; }).join('');
  }

  
  function renderClockPanel() {
    const container = document.getElementById('study-clock-panel');
    if (!container) return;
    const c = getClock();
    const active = isClockActive(c);

    container.innerHTML =
      '<div id="study-clock-modes" class="study-clock-modes" style="display:' + (active ? 'none' : 'flex') + '">' +
        '<button class="study-mode-btn" data-mode="stopwatch">Stopwatch</button>' +
        '<button class="study-mode-btn" data-mode="timer">Timer</button>' +
      '</div>' +
      '<div id="study-timer-setup" class="study-timer-setup" style="display:' + (c.mode === 'timer' && !active ? 'block' : 'none') + '">' +
        '<input type="number" id="study-timer-minutes" min="1" placeholder="Minutes">' +
      '</div>' +
      '<div id="study-clock-display" class="study-clock-display"></div>' +
      '<div class="study-clock-controls">' +
        '<button id="study-clock-start" style="display:' + (active ? 'none' : 'inline-block') + '">Start</button>' +
        '<button id="study-clock-toggle" style="display:' + (active ? 'inline-block' : 'none') + '">' + (c.running ? 'Pause' : 'Resume') + '</button>' +
        '<button id="study-clock-save" style="display:' + (active ? 'inline-block' : 'none') + '">Save</button>' +
      '</div>';

    document.querySelectorAll('.study-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === c.mode);
      btn.addEventListener('click', function () {
        // Switching modes is only allowed from a fully idle clock — switching away from an
        // active/paused-with-time run would otherwise be an implicit, silent save (or silent
        // data loss), which the "only Save logs" rule doesn't allow. Save first, then switch.
        if (isClockActive(getClock())) return;
        setClock({ mode: btn.dataset.mode, timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
        renderClockPanel();
      });
    });

    document.getElementById('study-clock-start').addEventListener('click', function () {
      const cur = getClock();
      if (cur.mode === 'timer') {
        const minutes = parseInt(document.getElementById('study-timer-minutes').value, 10);
        if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
        startTimer(minutes);
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

    lastClockUiMode = active ? 'active' : 'idle';
    applyClockFocusUI(active);
    renderClock();
  }

  
  
  


  // ---------- 3.2 Timetable execution — delegates entirely to TimeEngine (single source of truth) ----------
  let promptToken = null;   // dedupe: which exact prompt-state is currently shown as a modal
  let doItLaterOpen = false;
  let lastSessionSig = null;

  function renderAlarmIcon() {
    const btn = document.getElementById('study-alarm-icon');
    if (btn) btn.onclick = openAlarmListModal;
  }

  let alarmModalOpen = false;

  function buildAlarmListHtml() {
    const today = todayStr();
    const slots = PlannerData.getTasksForDate(today)
      .filter(function (t) { return t.startTime; })
      .sort(function (a, b) { return a.startTime < b.startTime ? -1 : 1; });

    return slots.map(function (t) {
      const rec = TimeEngine.getRecordForTask(t.taskId, today);
      let status = 'Upcoming';
      if (t.completed) status = 'Done';
      else if (rec && rec.state === 'active') status = 'In progress';
      else if (rec && rec.state === 'paused') status = 'Paused';
      else if (rec && rec.state === 'rescheduled') status = 'Moved to another day';
      const slotTime = rec ? (rec.adjustedStart + '\u2013' + rec.adjustedEnd) : (t.startTime + '\u2013' + t.stopTime);
      const reschedBtn = !t.completed ? '<button class="study-alarm-resched-btn" data-task-id="' + t.taskId + '">Reschedule</button>' : '';
      const deleteBtn = '<button class="study-alarm-delete-btn" data-task-id="' + t.taskId + '">Delete</button>';
      return '<div class="study-alarm-row"><span>' + slotTime + '</span>' +
        '<span>' + taskLabelFull(t) + '</span><span>' + status + '</span>' + reschedBtn + deleteBtn + '</div>';
    }).join('') || '<p class="planner-empty">No slots scheduled today.</p>';
  }

  function attachAlarmListListeners() {
    document.querySelectorAll('.study-alarm-resched-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openDoItLaterModal(btn.dataset.taskId); });
    });
    document.querySelectorAll('.study-alarm-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { confirmDeleteScheduledTask(btn.dataset.taskId); });
    });
  }

  function confirmDeleteScheduledTask(taskId) {
    Modal.open(
      '<h3>Delete task?</h3>' +
      '<p>This removes it from your schedule. This cannot be undone.</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="study-delete-confirm">Delete</button>' +
        '<button id="study-delete-cancel">Cancel</button>' +
      '</div>'
    );
    document.getElementById('study-delete-confirm').addEventListener('click', function () {
      PlannerData.deleteTask(taskId);
      openAlarmListModal();
    });
    document.getElementById('study-delete-cancel').addEventListener('click', function () { openAlarmListModal(); });
  }

  function openAlarmListModal() {
    alarmModalOpen = true;
    Modal.open('<h3>Today\'s Alarms</h3><div id="study-alarm-list" class="study-alarm-list">' + buildAlarmListHtml() + '</div>');
    attachAlarmListListeners();
  }

  function refreshAlarmListModal() {
    if (!alarmModalOpen) return;
    const overlay = document.getElementById('modal-overlay');
    const list = document.getElementById('study-alarm-list');
    if (!overlay || overlay.style.display === 'none' || !list) { alarmModalOpen = false; return; }
    list.innerHTML = buildAlarmListHtml();
    attachAlarmListListeners();
  }

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

  // Focus Mode (§4): large clock + only Links / Completed / Pause / Do it later.
  function renderFocusMode(active) {
    const container = document.getElementById('study-session-panel');
    const task = PlannerData.getAllTasks()[active.taskId];
    const clockPanel = document.getElementById('study-clock-panel');
    if (clockPanel) clockPanel.style.display = 'none';
    applyChromeVisibility();

    container.innerHTML =
      '<div class="study-focus-mode">' +
        '<p class="study-active-label">' + taskLabelFull(task) + '</p>' +
           '<div id="study-focus-clock" class="study-focus-clock"></div>' +
        '<div id="study-focus-remaining" class="study-focus-remaining"></div>' +
        (active.state === 'paused' ? '<p class="study-paused-note">Paused</p>' : '') +
        '<div class="study-focus-actions">' +
          '<button id="study-focus-complete">Completed</button>' +
          '<button id="study-focus-pause">' + (active.state === 'paused' ? 'Resume' : 'Pause') + '</button>' +
          '<button id="study-focus-later">Do it later</button>' +
        '</div>' +
      '</div>';

    renderFocusClock();
    document.getElementById('study-focus-complete').addEventListener('click', function (e) {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      TimeEngine.completeActive();
    });
    document.getElementById('study-focus-pause').addEventListener('click', function (e) {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      const cur = TimeEngine.getActiveSession();
      if (cur && cur.state === 'paused') TimeEngine.resumeActive(); else TimeEngine.pauseActive();
    });
    document.getElementById('study-focus-later').addEventListener('click', function () { confirmDoItLater(active.taskId); });
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
    document.getElementById('study-later-proceed').addEventListener('click', function () { openDoItLaterModal(taskId); });
    document.getElementById('study-later-cancel').addEventListener('click', function () { Modal.close(); });
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
    document.getElementById('study-later-confirm').addEventListener('click', function () {
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
    btn.style.display = 'inline-block';
    btn.textContent = 'Break';
    btn.disabled = false;
  }

  // §2.3 — full-takeover break screen: Break / remaining time / Add Time / End Break, nothing
  // else. Wallpaper (§2.5, Settings-only for now) shown as background when configured.
  function renderBreakTakeover() {
    const container = document.getElementById('global-break-takeover');
    if (!container) return;
    const gb = TimeEngine.getGlobalBreak();
    if (!gb || !gb.active) { container.style.display = 'none'; return; }
    const remainingMin = Math.max(0, Math.ceil((gb.resumeAt - Date.now()) / 60000));
    const settings = State.get().settings || {};
    container.style.display = 'flex';
    container.style.backgroundImage = settings.breakWallpaper ? 'url(' + settings.breakWallpaper + ')' : 'none';
    container.innerHTML =
      '<div class="break-takeover-inner">' +
        '<h2>Break</h2>' +
        '<div class="break-takeover-remaining">' + remainingMin + 'm left</div>' +
        '<div class="break-takeover-actions">' +
          '<button id="break-takeover-add">Add Time</button>' +
          '<button id="break-takeover-end">End Break</button>' +
        '</div>' +
      '</div>';
    document.getElementById('break-takeover-add').addEventListener('click', openAddBreakTimeModal);
    document.getElementById('break-takeover-end').addEventListener('click', function () {
      TimeEngine.endGlobalBreak();
      renderBreakTakeover();
      renderBreakStatus();
    });
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
      '<h3>Take a break</h3>' +
'<input type="number" id="global-break-minutes" min="1" placeholder="Minutes"' + (defaultMin ? ' value="' + defaultMin + '"' : '') + '>' +
'<input type="text" id="global-break-note" placeholder="Note (optional)">' +
'<button id="global-break-confirm">Start Break</button>' +
'<button id="break-timeline-toggle" style="margin-left:8px">Timeline</button>' +
'<hr>' +
'<h4>Already took a break?</h4>' +
'<input type="number" id="unrecorded-break-minutes" min="1" placeholder="Minutes">' +
'<input type="text" id="unrecorded-break-note" placeholder="Note (optional)">' +
'<button id="unrecorded-break-confirm">Log it</button>'
    );
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
    refreshAlarmListModal();
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
    
  function init() {
    Notify.requestPermission();
    renderClockPanel();
    renderAlarmIcon();
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
    renderAlarmIcon();
    lastSessionSig = null;
    renderAlarmPanel();
    setCutoffMode(isPastCutoff());
    renderBreakStatus();
    renderBreakTakeover();
    renderStudyLog();
  }
  return { init: init, render: render, startTaskSession: startTaskSession, isSessionActive: isSessionActive };
})();
