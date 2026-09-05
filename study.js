// study.js — Study tab: clock (stopwatch/timer, §3.1) + alarm-driven timetable execution (§3.2).
// Depends on: State, PlannerData, Modal. Loaded after planner.js (see index.html).

const Study = (function () {
  let tickHandle = null;
  let timeInputOpen = false;

  // ---------- helpers ----------

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    const t = new Date();
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

  function defaultAlarmState(dateStr) {
    return { date: dateStr || todayStr(), delayMs: 0, activeTaskId: null, sessionStartedAt: null, prompt: null, handledTaskIds: [] };
  }

  function getAlarmState() { return State.get().alarmState || defaultAlarmState(); }
  function setAlarmState(partial) { State.set({ alarmState: Object.assign({}, getAlarmState(), partial) }); }

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

  // ---------- 3.2 Alarm-driven execution ----------

  function renderAlarmIcon() {
    const btn = document.getElementById('study-alarm-icon');
    if (btn) btn.onclick = openAlarmListModal;
  }

  function openAlarmListModal() {
    const today = todayStr();
    const alarmState = getAlarmState();
    const slots = PlannerData.getTasksForDate(today)
      .filter(function (t) { return t.startTime; })
      .sort(function (a, b) { return a.startTime < b.startTime ? -1 : 1; });

    const rows = slots.map(function (t) {
      let status = 'Upcoming';
      if (t.completed) status = 'Done';
      else if (alarmState.activeTaskId === t.taskId) status = 'In progress';
      else if ((alarmState.handledTaskIds || []).indexOf(t.taskId) !== -1) status = 'Started earlier';
      return '<div class="study-alarm-row"><span>' + t.startTime + '\u2013' + t.stopTime + '</span>' +
        '<span>' + taskLabelFull(t) + '</span><span>' + status + '</span></div>';
    }).join('') || '<p class="planner-empty">No slots scheduled today.</p>';

    Modal.open('<h3>Today\'s Alarms</h3><div class="study-alarm-list">' + rows + '</div>');
  }

  function renderAlarmPanel() {
    const container = document.getElementById('study-session-panel');
    if (!container) return;
    const alarmState = getAlarmState();

    if (alarmState.activeTaskId) {
      const task = PlannerData.getAllTasks()[alarmState.activeTaskId];
      container.innerHTML = '<p class="study-active-label">Studying: ' + taskLabelFull(task) + '</p>' +
        '<button id="study-finish-session">Finish Session</button>';
      document.getElementById('study-finish-session').addEventListener('click', finishSession);
    } else {
      container.innerHTML = '<p class="study-active-label">No active slot session.</p>';
    }
  }

  function showPrompt(taskId) {
    const task = PlannerData.getAllTasks()[taskId];
    if (!task) { resolvePrompt(taskId, 'start'); return; } // task vanished — don't get stuck
    Modal.open(
      '<h3>Time for: ' + taskLabelFull(task) + '</h3>' +
      '<p>Scheduled ' + task.startTime + '\u2013' + task.stopTime + '</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="study-prompt-start">Started</button>' +
        '<button id="study-prompt-break">Need break (10 min)</button>' +
        '<button id="study-prompt-time">Need time</button>' +
      '</div>'
    );
    document.getElementById('study-prompt-start').addEventListener('click', function () { resolvePrompt(taskId, 'start'); });
    document.getElementById('study-prompt-break').addEventListener('click', function () { resolvePrompt(taskId, 'break'); });
    document.getElementById('study-prompt-time').addEventListener('click', function () { showTimeInput(taskId); });
  }

  function showTimeInput(taskId) {
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
      resolvePrompt(taskId, 'time', minutes);
    });
  }

  function resolvePrompt(taskId, choice, minutes) {
    const alarmState = getAlarmState();
    if (choice === 'start') {
      beginSession(taskId);
      setAlarmState({ prompt: null, handledTaskIds: (alarmState.handledTaskIds || []).concat([taskId]) });
    } else if (choice === 'break') {
      setAlarmState({ delayMs: (alarmState.delayMs || 0) + 10 * 60 * 1000, prompt: { taskId: taskId, fireAt: Date.now() + 10 * 60 * 1000 } });
    } else if (choice === 'time') {
      setAlarmState({ delayMs: (alarmState.delayMs || 0) + minutes * 60 * 1000, prompt: { taskId: taskId, fireAt: Date.now() + minutes * 60 * 1000 } });
    }
    Modal.close();
  }

  function beginSession(taskId) {
    startStopwatch();
    const entry = { taskId: taskId, date: todayStr(), startTime: nowHHMM(), stopTime: null, outcome: 'in-progress' };
    State.set({ sessionLog: (State.get().sessionLog || []).concat([entry]) });
    setAlarmState({ activeTaskId: taskId, sessionStartedAt: Date.now() });
    renderAlarmPanel();
  }

  function finishSession() {
    const alarmState = getAlarmState();
    const taskId = alarmState.activeTaskId;
    if (!taskId) return;
    pauseClock();
    const log = (State.get().sessionLog || []).map(function (e) {
      if (e.taskId === taskId && e.stopTime === null) return Object.assign({}, e, { stopTime: nowHHMM(), outcome: 'completed' });
      return e;
    });
    State.set({ sessionLog: log });
    PlannerData.toggleComplete(taskId);
    setAlarmState({ activeTaskId: null, sessionStartedAt: null });
    resetClock();
    renderAlarmPanel();
  }

  function checkMidFlightRecovery() {
    const alarmState = getAlarmState();
    if (!alarmState.activeTaskId) return;

    if (alarmState.date !== todayStr()) {
      const log = (State.get().sessionLog || []).map(function (e) {
        if (e.taskId === alarmState.activeTaskId && e.stopTime === null) return Object.assign({}, e, { stopTime: null, outcome: 'ended (stale)' });
        return e;
      });
      State.set({ sessionLog: log });
      setAlarmState(defaultAlarmState());
      return;
    }

    const task = PlannerData.getAllTasks()[alarmState.activeTaskId];
    Modal.open(
      '<h3>Welcome back</h3>' +
      '<p>Did you keep studying ' + taskLabelFull(task) + ' while this tab was closed?</p>' +
      '<button id="study-recover-yes">Yes</button>' +
      '<button id="study-recover-no">No</button>'
    );
    document.getElementById('study-recover-yes').addEventListener('click', function () {
      setClock({ mode: 'stopwatch', running: true, startedAt: alarmState.sessionStartedAt, elapsedMs: 0 });
      Modal.close();
      renderAlarmPanel();
    });
    document.getElementById('study-recover-no').addEventListener('click', function () {
      const log = (State.get().sessionLog || []).map(function (e) {
        if (e.taskId === alarmState.activeTaskId && e.stopTime === null) return Object.assign({}, e, { stopTime: nowHHMM(), outcome: 'ended (recovered)' });
        return e;
      });
      State.set({ sessionLog: log });
      setAlarmState({ activeTaskId: null, sessionStartedAt: null });
      Modal.close();
      renderAlarmPanel();
    });
  }

  function tick() {
    const today = todayStr();
    let alarmState = getAlarmState();
    if (alarmState.date !== today) {
      alarmState = defaultAlarmState(today);
      setAlarmState(alarmState);
    }

    renderClock();

    if (alarmState.activeTaskId) return;
    if (timeInputOpen) return;

    if (alarmState.prompt) {
      if (Date.now() >= alarmState.prompt.fireAt) showPrompt(alarmState.prompt.taskId);
      return;
    }

    const handled = alarmState.handledTaskIds || [];
    const slots = PlannerData.getTasksForDate(today)
      .filter(function (t) { return t.startTime && !t.completed && handled.indexOf(t.taskId) === -1; })
      .sort(function (a, b) { return a.startTime < b.startTime ? -1 : 1; });

    if (slots.length === 0) return;
    const next = slots[0];
    const effectiveStart = timeStrToMs(today, next.startTime) + (alarmState.delayMs || 0);
    if (Date.now() >= effectiveStart) {
      setAlarmState({ prompt: { taskId: next.taskId, fireAt: Date.now() } });
    }
  }

  function init() {
    renderClockPanel();
    renderAlarmPanel();
    renderAlarmIcon();
    checkMidFlightRecovery();
    if (!tickHandle) tickHandle = setInterval(tick, 1000);
  }

  function render() {
    renderClockPanel();
    renderAlarmPanel();
    renderAlarmIcon();
  }

  return { init: init, render: render };
})();
