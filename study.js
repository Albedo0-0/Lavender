// study.js — Study tab: clock (stopwatch/timer, §3.1) + alarm-driven timetable execution (§3.2).
// Depends on: State, PlannerData, Modal. Loaded after planner.js (see index.html).

const Study = (function () {
  let timeInputOpen = false;
  let breakInputOpen = false;

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

  function startStopwatch() {
    setClock({ mode: 'stopwatch', running: true, startedAt: Date.now(), elapsedMs: 0, timerTotalMs: 0 });
    renderClock();
  }

  function startTimer(minutes) {
    setClock({ mode: 'timer', running: true, startedAt: Date.now(), elapsedMs: 0, timerTotalMs: minutes * 60 * 1000 });
    renderClock();
  }

  function pauseClock() {
    const c = getClock();
    if (!c.running) return;
    const elapsed = c.elapsedMs + (Date.now() - c.startedAt);
    setClock({ running: false, elapsedMs: elapsed, startedAt: null });
    renderClock();
  }

  function resetClock() {
    setClock({ running: false, startedAt: null, elapsedMs: 0, timerTotalMs: 0 });
    renderClock();
  }

  function currentClockMs() {
    const c = getClock();
    const elapsed = c.running ? (c.elapsedMs + (Date.now() - c.startedAt)) : c.elapsedMs;
    return c.mode === 'timer' ? Math.max(0, c.timerTotalMs - elapsed) : elapsed;
  }

  function renderClock() {
    const display = document.getElementById('study-clock-display');
    if (display) display.textContent = fmtDuration(currentClockMs());
    const startBtn = document.getElementById('study-clock-start');
    const pauseBtn = document.getElementById('study-clock-pause');
    if (startBtn) startBtn.style.display = getClock().running ? 'none' : 'inline-block';
    if (pauseBtn) pauseBtn.style.display = getClock().running ? 'inline-block' : 'none';
  }

  function renderClockPanel() {
    const container = document.getElementById('study-clock-panel');
    if (!container) return;
    const c = getClock();

    container.innerHTML =
      '<div class="study-clock-modes">' +
        '<button class="study-mode-btn" data-mode="stopwatch">Stopwatch</button>' +
        '<button class="study-mode-btn" data-mode="timer">Timer</button>' +
      '</div>' +
      '<div id="study-timer-setup" class="study-timer-setup" style="display:' + (c.mode === 'timer' ? 'block' : 'none') + '">' +
        '<input type="number" id="study-timer-minutes" min="1" placeholder="Minutes">' +
      '</div>' +
      '<div id="study-clock-display" class="study-clock-display"></div>' +
      '<div class="study-clock-controls">' +
        '<button id="study-clock-start">Start</button>' +
        '<button id="study-clock-pause">Pause</button>' +
        '<button id="study-clock-reset">Reset</button>' +
      '</div>';

    document.querySelectorAll('.study-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === c.mode);
      btn.addEventListener('click', function () {
        if (getClock().running) return;
        setClock({ mode: btn.dataset.mode, elapsedMs: 0, timerTotalMs: 0 });
        renderClockPanel();
      });
    });

    document.getElementById('study-clock-start').addEventListener('click', function () {
      if (getClock().mode === 'timer') {
        const minutes = parseInt(document.getElementById('study-timer-minutes').value, 10);
        if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
        startTimer(minutes);
      } else {
        startStopwatch();
      }
    });
    document.getElementById('study-clock-pause').addEventListener('click', pauseClock);
    document.getElementById('study-clock-reset').addEventListener('click', resetClock);

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
      return '<div class="study-alarm-row"><span>' + slotTime + '</span>' +
        '<span>' + taskLabelFull(t) + '</span><span>' + status + '</span></div>';
    }).join('') || '<p class="planner-empty">No slots scheduled today.</p>';
  }

  function openAlarmListModal() {
    alarmModalOpen = true;
    Modal.open('<h3>Today\'s Alarms</h3><div id="study-alarm-list" class="study-alarm-list">' + buildAlarmListHtml() + '</div>');
  }

  function refreshAlarmListModal() {
    if (!alarmModalOpen) return;
    const overlay = document.getElementById('modal-overlay');
    const list = document.getElementById('study-alarm-list');
    if (!overlay || overlay.style.display === 'none' || !list) { alarmModalOpen = false; return; }
    list.innerHTML = buildAlarmListHtml();
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
    const alarmIcon = document.getElementById('study-alarm-icon');
    const breakBtn = document.getElementById('global-break-btn');
    if (clockPanel) clockPanel.style.display = 'none';
    if (alarmIcon) alarmIcon.style.display = 'none';
    if (breakBtn) breakBtn.style.display = 'none';

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
      remainEl.textContent = active ? ('Remaining: ' + fmtDuration(Math.max(0, timeStrToMs(active.date, active.adjustedEnd) - Date.now()))) : '';
    }
  }

  function exitFocusMode() {
    const clockPanel = document.getElementById('study-clock-panel');
    const alarmIcon = document.getElementById('study-alarm-icon');
    const breakBtn = document.getElementById('global-break-btn');
    if (clockPanel) clockPanel.style.display = 'block';
    if (alarmIcon) alarmIcon.style.display = 'inline-block';
    if (breakBtn) breakBtn.style.display = 'inline-block';
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
    Modal.open(
      '<h3>Do it later</h3>' +
      '<input type="date" id="study-later-date" value="' + tomorrowStr() + '" min="' + todayStr() + '">' +
      '<button id="study-later-confirm">Reschedule</button>'
    );
    document.getElementById('study-later-confirm').addEventListener('click', function () {
      const dateVal = document.getElementById('study-later-date').value;
      if (!dateVal) { alert('Pick a date.'); return; }
      const ok = TimeEngine.doItLater(taskId, dateVal);
      if (!ok) { alert('That slot overlaps another task on ' + dateVal + '. Pick a different date.'); return; }
      doItLaterOpen = false;
      Modal.close();
    });
  }

  function renderBreakStatus() {
    const btn = document.getElementById('global-break-btn');
    if (!btn) return;
    if (TimeEngine.isSessionActive()) { btn.style.display = 'none'; return; }
    btn.style.display = 'inline-block';
    const gb = TimeEngine.getGlobalBreak();
    if (gb && gb.active) {
      const remainingMin = Math.ceil((gb.resumeAt - Date.now()) / 60000);
      btn.textContent = 'Break (' + Math.max(0, remainingMin) + 'm)';
      btn.disabled = true;
    } else {
      btn.textContent = 'Break';
      btn.disabled = false;
    }
  }

  function openBreakInputModal() {
    breakInputOpen = true;
    Modal.open(
      '<h3>Take a break</h3>' +
      '<input type="number" id="global-break-minutes" min="1" placeholder="Minutes">' +
      '<button id="global-break-confirm">Start Break</button>'
    );
    document.getElementById('global-break-confirm').addEventListener('click', function () {
      const minutes = parseInt(document.getElementById('global-break-minutes').value, 10);
      if (!minutes || minutes <= 0) { alert('Enter a valid number of minutes.'); return; }
      breakInputOpen = false;
      Modal.close();
      TimeEngine.startGlobalBreak(minutes);
      renderBreakStatus();
    });
  }

  function promptTokenFor(prompt) {
    return prompt ? [prompt.sessionId, prompt.kind, prompt.fireAt, prompt.autoBreakActive].join('|') : null;
  }

  function showPrompt(prompt) {
    const task = PlannerData.getAllTasks()[prompt.taskId];
    const heading = prompt.kind === 'start' ? 'Time for: ' : 'Wrap up: ';
    Modal.open(
      '<h3>' + heading + (task ? taskLabelFull(task) : '') + '</h3>' +
      '<div class="study-prompt-actions">' +
        '<button id="study-prompt-start">Started</button>' +
        '<button id="study-prompt-break">Need a break</button>' +
        '<button id="study-prompt-time">Need more time</button>' +
      '</div>'
    );
    document.getElementById('study-prompt-start').addEventListener('click', function () { TimeEngine.resolvePrompt('start'); Modal.close(); });
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

  function showAutoBreakNotice(prompt) {
    const remainMin = Math.max(0, Math.ceil((prompt.autoBreakResumeAt - Date.now()) / 60000));
    Modal.open('<h3>On a short break</h3><p>No response, so a 5-minute break started automatically. Back in ' + remainMin + ' min \u2014 you\'ll be asked again.</p>');
  }

  function handlePrompt() {
    const prompt = TimeEngine.getPrompt();
    if (timeInputOpen && document.getElementById('study-time-minutes')) return;
    if (!prompt) { promptToken = null; return; }
    const token = promptTokenFor(prompt);
    const overlay = document.getElementById('modal-overlay');
    const overlayOpen = !!overlay && overlay.style.display !== 'none';
    // Re-show even if the token hasn't changed when the overlay got dismissed (e.g. backdrop
    // click) — an unanswered prompt must stay visible until answered or it auto-times out.
    if (token === promptToken && overlayOpen) return;
    promptToken = token;
    timeInputOpen = false;
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
    const linksIcon = document.getElementById('study-links-icon');
    const hideForCutoff = active && !TimeEngine.isSessionActive();
    const clockPanel = document.getElementById('study-clock-panel');
    const alarmIcon = document.getElementById('study-alarm-icon');
    if (clockPanel && !TimeEngine.isSessionActive()) clockPanel.style.display = hideForCutoff ? 'none' : 'block';
    if (sessionPanel) sessionPanel.style.display = hideForCutoff ? 'none' : 'block';
    if (cutoffView) cutoffView.style.display = active ? 'block' : 'none';
    if (alarmIcon && !TimeEngine.isSessionActive()) alarmIcon.style.display = active ? 'none' : 'inline-block';
    if (linksIcon) linksIcon.style.display = active ? 'none' : 'inline-block';
    if (active) renderCutoffView();
  }

  // Single re-render callback — invoked by TimeEngine's one-and-only heartbeat (every 1s)
  // and immediately after every user action, so there is exactly one timer driving the UI.
  function onEngineTick() {
    const pastCutoff = isPastCutoff();
    setCutoffMode(pastCutoff);
    renderBreakStatus();
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
    if (breakInputOpen && document.getElementById('global-break-minutes')) return;
    if (doItLaterOpen && document.getElementById('study-later-date')) return;
    handlePrompt();
  }

  function getLinks() { return State.get().studyLinks || {}; }

  function addLink(subject, url, note) {
    const links = Object.assign({}, getLinks());
    const id = 'link_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    links[id] = { linkId: id, subject: subject, url: url.trim(), note: note || '' };
    State.set({ studyLinks: links });
  }

  function deleteLink(linkId) {
    const links = Object.assign({}, getLinks());
    delete links[linkId];
    State.set({ studyLinks: links });
  }

  function getLinksBySubject(subject) {
    const links = getLinks();
    return Object.keys(links).map(function (id) { return links[id]; }).filter(function (l) { return l.subject === subject; });
  }

  function renderLinksIcon() {
    const btn = document.getElementById('study-links-icon');
    if (btn) btn.onclick = function () { openLinksModal(); };
  }

  function openLinksModal(activeSubject) {
    const subject = activeSubject || PlannerData.SUBJECTS[0];
    const tabsHtml = PlannerData.SUBJECTS.map(function (s) {
      return '<button class="study-links-tab-btn' + (s === subject ? ' active' : '') + '" data-subject="' + s + '">' + s + '</button>';
    }).join('');

    const list = getLinksBySubject(subject);
    const listHtml = list.length === 0
      ? '<p class="planner-empty">No links yet for ' + subject + '.</p>'
      : list.map(function (l) {
          return '<div class="study-link-row">' +
            '<a href="' + l.url + '" target="_blank" rel="noopener">' + l.url + '</a>' +
            (l.note ? '<div class="study-link-note">' + l.note + '</div>' : '') +
            '<button class="study-link-delete" data-link-id="' + l.linkId + '">Remove</button>' +
          '</div>';
        }).join('');

    Modal.open(
      '<h3>Links</h3>' +
      '<div class="study-links-tabs">' + tabsHtml + '</div>' +
      '<div class="study-links-list">' + listHtml + '</div>' +
      '<div class="study-links-form">' +
        '<input type="url" id="study-link-url" placeholder="YouTube URL">' +
        '<textarea id="study-link-note" rows="2" placeholder="Note (optional)"></textarea>' +
        '<button id="study-link-save">Add Link</button>' +
      '</div>'
    );

    document.querySelectorAll('.study-links-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openLinksModal(btn.dataset.subject); });
    });

    document.querySelectorAll('.study-link-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteLink(btn.dataset.linkId);
        openLinksModal(subject);
      });
    });

    document.getElementById('study-link-save').addEventListener('click', function () {
      const url = document.getElementById('study-link-url').value.trim();
      if (!url) { alert('Enter a URL.'); return; }
      const note = document.getElementById('study-link-note').value;
      addLink(subject, url, note);
      openLinksModal(subject);
    });
  }

  function init() {
    renderClockPanel();
    renderAlarmIcon();
    renderLinksIcon();
    renderAlarmPanel();
    lastSessionSig = null;
    setCutoffMode(isPastCutoff());
    renderBreakStatus();
    const breakBtn = document.getElementById('global-break-btn');
    if (breakBtn) breakBtn.addEventListener('click', openBreakInputModal);
    // TimeEngine owns the single interval for all timing/session state (see timeengine.js §1).
    TimeEngine.subscribe(onEngineTick);
  }

  function render() {
    renderClockPanel();
    renderAlarmIcon();
    renderLinksIcon();
    lastSessionSig = null;
    renderAlarmPanel();
    setCutoffMode(isPastCutoff());
    renderBreakStatus();
  }

  return { init: init, render: render, startTaskSession: startTaskSession, isSessionActive: isSessionActive };
})();
