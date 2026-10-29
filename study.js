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

  // While a Stopwatch/Timer run
  // whole Study tab like a session: big clock, everything else hidden.
  function applyClockFocusUI(active) {
    const sessionPanel = document.getElementById('study-session-panel');
    const clockPanel = document.getElementById('study-clock-panel');
        if (sessionPanel) sessionPanel.style.display = 'block';
    if (clockPanel) clockPanel.classList.remove('study-clock-focus');
        const layout = document.getElementById('study-layout');
    if (layout) {
      const _ss = TimeEngine.getActiveSession();
            layout.classList.toggle('study-wallpaper-fullscreen', !!_ss);
      layout.dataset.studyState = _ss ? (_ss.state === 'paused' ? 'paused' : 'running') : (active ? (getClock().running ? 'running' : 'paused') : 'idle');
    }
    applyChromeVisibility();
  }
  function isClockActive(c) {
    return !!(c.running || (c.elapsedMs || 0) > 0 || c.awaitingDecision);
  }

  // Single source of truth for the shared chrome (alarm icon, links icon, break button) — hidden
  // whenever EITHER a planner session OR the manual Stopwatch/Timer is active, computed fresh
  // every time so the two flows can never fight each other and cause a flicker.
  function applyChromeVisibility() {
        const active = !!TimeEngine.getActiveSession();
    const alarmIcon = document.getElementById('study-alarm-icon');
    const linksIcon = document.getElementById('study-links-icon');
    const breakBtn = document.getElementById('global-break-btn');
    const autofsRow = document.getElementById('study-autofs-toggle-row');
    if (alarmIcon) alarmIcon.style.display = active ? 'none' : 'inline-block';
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
    function seg(key, label, on) {
      return '<button type="button" class="sp-seg' + (on ? ' is-on' : '') + '" data-mode-key="' + key + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + dis + '>' + SP_ICONS[key] + '<span>' + label + '</span></button>';
    }

    container.innerHTML =
      '<div id="study-clock-caption" class="sp-caption"></div>' +
      '<div id="study-clock-display" class="px-clock" role="timer"></div>' +
      '<div id="study-clock-progress" class="px-progress" aria-hidden="true">' + new Array(61).join('<i></i>') + '</div>' +
      '<div class="study-clock-controls sp-actions">' +
        '<button type="button" id="study-clock-start" class="sp-btn sp-primary" style="display:' + (active ? 'none' : 'inline-flex') + '">' + SP_ICONS.play + '<span>Start</span></button>' +
        '<button type="button" id="study-clock-toggle" class="sp-btn' + (c.running ? ' is-running' : '') + '" style="display:' + (active ? 'inline-flex' : 'none') + '">' + SP_ICONS.play + SP_ICONS.pause + '<span id="study-clock-toggle-label">' + (c.running ? 'Pause' : 'Resume') + '</span></button>' +
        '<button type="button" id="study-clock-save" class="sp-btn" style="display:' + (active ? 'inline-flex' : 'none') + '">' + SP_ICONS.check + '<span>Save</span></button>' +
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

    lastClockUiMode = active ? 'active' : 'idle';
    applyClockFocusUI(active);
    renderClock();
    syncCandleSlot();
  }

  // Visual only: slides the candle's existing element between the dock slot (resting) and its original
  // corner (lit/focused) by setting two CSS variables. The candle's logic and state are never touched.
  function syncCandleSlot() {
    const screen = document.getElementById('screen-study');
    const slot = document.getElementById('study-candle-slot');
    const mount = screen && screen.querySelector(':scope > .candle-lamp-mount');
    if (!slot || !mount) return;
    const sr = slot.getBoundingClientRect();
    if (!sr.width) return;
    const op = mount.offsetParent;
    const cr = op ? op.getBoundingClientRect() : { right: window.innerWidth, bottom: window.innerHeight };
    const cs = getComputedStyle(mount);
    const S = 0.32; // candle-lamp.js resting scale (transform-origin: bottom right)
    const cx = cr.right - (parseFloat(cs.right) || 0) - mount.offsetWidth * S / 2;
    const cy = cr.bottom - (parseFloat(cs.bottom) || 0) - mount.offsetHeight * S / 2;
    mount.style.setProperty('--candle-dx', Math.round(sr.left + sr.width / 2 - cx) + 'px');
    mount.style.setProperty('--candle-dy', Math.round(sr.top + sr.height / 2 - cy) + 'px');
  }

  // ---- Manual workspace fullscreen: the whole #study-layout expands; nothing is re-rendered ----
  let studyFsBusy = false;
    let studyFsHome = null; // the window's own rect (viewport coords) when fullscreen was entered
  function studyFsViewport() {
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, r: 0 };
  }
  // Morphs the SAME #study-layout element (wallpaper, blur box and clock all live inside it) between two rects.
  function studyFsMorph(layout, from, to, done) {
    if (!layout.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    function frame(r) {
      return { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: r.r + 'px' };
    }
    const a = layout.animate([frame(from), frame(to)], { duration: 560, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'forwards' });
    a.onfinish = function () { done(); a.cancel(); };
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
    const layout = document.getElementById('study-layout');
    if (!screen || !layout) return;
    studyFsBusy = true;
        const fr = layout.getBoundingClientRect();
    const first = { top: fr.top, left: fr.left, width: fr.width, height: fr.height, r: 22 };
    studyFsHome = first;
    const scs = getComputedStyle(screen);
    const spad = scs.boxSizing === 'border-box' ? (parseFloat(scs.paddingTop) + parseFloat(scs.paddingBottom)) : 0;
    screen.style.minHeight = (first.height + spad) + 'px'; // keeps the page from collapsing while the window is fixed
    document.body.classList.add('study-fs-busy');
    screen.classList.add('study-fs-on');
    document.body.classList.add('study-fs-on');
    setStudyFsBtn(true);
    syncCandleSlot();
        studyFsMorph(layout, first, studyFsViewport(), function () {
      studyFsBusy = false;
      document.body.classList.remove('study-fs-busy');
      syncCandleSlot();
      if (!isBrowserFullscreen()) requestBrowserFullscreen().catch(function () {});
    });
  }
  function leaveStudyFs(skipApi) {
    const screen = document.getElementById('screen-study');
    const layout = document.getElementById('study-layout');
    if (!screen || !layout) return;
    studyFsBusy = true;
    document.body.classList.add('study-fs-busy');
    function finish() {
      screen.classList.remove('study-fs-on');
      document.body.classList.remove('study-fs-on');
      screen.style.minHeight = '';
      setStudyFsBtn(false);
      syncCandleSlot();
      requestAnimationFrame(function () {
        document.body.classList.remove('study-fs-busy');
        studyFsBusy = false;
      });
    }
        function run() {
      const b = screen.getBoundingClientRect();
      const home = studyFsHome || { top: b.top, left: b.left, width: b.width, height: b.height, r: 22 };
      studyFsMorph(layout, studyFsViewport(), home, finish);
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

  // Legacy (pre-redesign) clock renderer — no longer called; Part 2 removes it.
  function renderClockPanelLegacy() {
    const container = document.getElementById('study-clock-panel');
    if (!container) return;
    const c = getClock();
    const active = isClockActive(c);
    const templates = (typeof StudyTemplatesData !== 'undefined') ? StudyTemplatesData.getAllTemplates() : [];

    container.innerHTML =
      '<div id="study-clock-modes" class="study-clock-modes" style="display:' + (active ? 'none' : 'flex') + '">' +
        '<button class="study-mode-btn" data-mode="stopwatch">Stopwatch</button>' +
        '<button class="study-mode-btn" data-mode="timer">Timer</button>' +
      '</div>' +
      '<div id="study-template-rail" class="study-template-rail" style="display:' + (active ? 'none' : 'flex') + '">' +
        templates.map(function (t) {
          return '<button class="study-template-btn" data-template-id="' + t.templateId + '">' + t.name +
            (t.isPomodoroDefault ? '' : '<span class="study-template-del" role="button" tabindex="0" aria-label="Delete template" data-template-id="' + t.templateId + '">&times;</span>') +
          '</button>';
        }).join('') +
        '<button id="study-template-add">+ Template</button>' +
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

    container.querySelectorAll('.study-template-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (e.target.classList.contains('study-template-del')) return;
        if (isClockActive(getClock())) return;
        const tpl = StudyTemplatesData.getTemplate(btn.dataset.templateId);
        if (!tpl) return;
        setClock({ mode: 'timer', timerTotalMs: 0, elapsedMs: 0, awaitingDecision: false });
        startTimer(tpl.workMin);
      });
    });
    container.querySelectorAll('.study-template-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        StudyTemplatesData.deleteTemplate(btn.dataset.templateId);
        renderClockPanel();
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        btn.click();
      });
    });
    const templateAddBtn = document.getElementById('study-template-add');
    if (templateAddBtn) templateAddBtn.addEventListener('click', function () {
      const name = prompt('Template name:');
      if (!name || !name.trim()) return;
      const workMin = parseInt(prompt('Work minutes:', '25'), 10) || 25;
      const breakMin = parseInt(prompt('Break minutes (optional):', '5'), 10) || 0;
      const cycles = parseInt(prompt('Cycles (optional):', '1'), 10) || 1;
      StudyTemplatesData.createTemplate(name.trim(), workMin, breakMin, cycles);
      renderClockPanel();
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
      else if (rec && rec.state === 'skipped') status = 'Skipped';
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
    const listHtml = buildAlarmListHtml();
    Modal.open('<h3>Today\'s Alarms</h3><div id="study-alarm-list" class="study-alarm-list">' + listHtml + '</div>' +
      '<button type="button" id="study-open-alarm-clock" class="btn btn-secondary">Alarm clock</button>');
    const clockBtn = document.getElementById('study-open-alarm-clock');
    if (clockBtn) clockBtn.addEventListener('click', function () {
      alarmModalOpen = false;
      if (typeof GeneralAlarm !== 'undefined') GeneralAlarm.open();
    });
    const listEl = document.getElementById('study-alarm-list');
    if (listEl) listEl.setAttribute('data-h', listHtml);
    attachAlarmListListeners();
  }

  function refreshAlarmListModal() {
    if (!alarmModalOpen) return;
    const overlay = document.getElementById('modal-overlay');
    const list = document.getElementById('study-alarm-list');
    if (!overlay || overlay.style.display === 'none' || !list) { alarmModalOpen = false; return; }
    const html = buildAlarmListHtml();
    if (list.getAttribute('data-h') === html) return; // unchanged — don't rebuild the DOM under the user's cursor every second
    list.setAttribute('data-h', html);
    list.innerHTML = html;
    attachAlarmListListeners();
  }

  function startTaskSession(taskId) { TimeEngine.startTaskSession(taskId); }
  function isSessionActive() { return TimeEngine.isSessionActive(); }

  function renderAlarmPanel() {
    const container = document.getElementById('study-session-panel');
    if (!container) return;
    const active = TimeEngine.getActiveSession();
    const layout = document.getElementById('study-layout');
        if (layout) {
      const _cc = getClock();
            layout.classList.toggle('study-wallpaper-fullscreen', !!active);
      layout.dataset.studyState = active ? (active.state === 'paused' ? 'paused' : 'running') : (isClockActive(_cc) ? (_cc.running ? 'running' : 'paused') : 'idle');
    }

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
    return { init: init, render: render, startTaskSession: startTaskSession, isSessionActive: isSessionActive, syncCandleSlot: syncCandleSlot };
})();
