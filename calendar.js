// calendar.js — monthly grid + Date Hub modal (Feature 1). Depends on: State, Storage, DateHub, Modal, Nav.
// Phase B / B-8: also reads hub.itinerarySummary (written by itinerary-data.js's
// writeItinerarySummary) to show a per-day itinerary outcome.

const Calendar = (function () {
    let viewYear, viewMonth; // viewMonth is 0-indexed
    let initialized = false;
  let viewMode = 'month';
  let lastRenderedMode = null;
  let selectedWeekStart = null;

  // PTPE lens: Calendar only ASKS PTPE.lens() for each date's value — it never calculates one itself.
  // The chosen lens is a small setting (State.settings.calendarLens / calendarLensTagId); 'normal' = unchanged look.
  function getLens() {
    const s = State.get().settings || {};
    const known = typeof PTPE !== 'undefined' && PTPE.LENSES.some(function (l) { return l.key === s.calendarLens; });
    return { mode: known ? s.calendarLens : 'normal', tagId: s.calendarLensTagId || null };
  }
  function activeLensTag(lens) {
    if (lens.mode !== 'tag' || typeof TagsData === 'undefined') return null;
    if (lens.tagId && TagsData.getTag(lens.tagId)) return lens.tagId;
    const all = TagsData.getAllTagsList();
    return all.length ? all[0].tagId : null;
  }
  function renderLensControl() {
    const host = document.getElementById('calendar-lens');
    if (!host || typeof PTPE === 'undefined') return;
    const lens = getLens(), tagId = activeLensTag(lens);
    host.innerHTML = '<select id="calendar-lens-select" class="cal-lens-select" title="Calendar view" aria-label="Calendar view">' +
      PTPE.LENSES.map(function (l) { return '<option value="' + l.key + '"' + (l.key === lens.mode ? ' selected' : '') + '>' + l.label + '</option>'; }).join('') + '</select>' +
      (lens.mode === 'tag' && typeof TagsData !== 'undefined' && TagsData.getAllTagsList().length
        ? '<select id="calendar-lens-tag" class="cal-lens-select" aria-label="Tag">' + TagsData.getAllTagsList().map(function (t) { return '<option value="' + t.tagId + '"' + (t.tagId === tagId ? ' selected' : '') + '>' + String(t.name).replace(/[<>&]/g, '') + '</option>'; }).join('') + '</select>' : '');
    host.querySelector('#calendar-lens-select').addEventListener('change', function (e) {
      State.patch('settings', { calendarLens: e.target.value });
      render();
    });
    const tagSel = host.querySelector('#calendar-lens-tag');
    if (tagSel) tagSel.addEventListener('change', function (e) { State.patch('settings', { calendarLensTagId: e.target.value }); render(); });
  }
  
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function formatLong(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // Phase B / B-8 — guarded for undefined/null so dates with no itinerary data (including any
  // day that finalized before Phase A's rollover subscriber-id fix) render nothing.
  function itinerarySummaryLabel(summary) {
    if (!summary) return '';
    if (summary.diyChosen) return 'Itinerary: did it myself';
    const c = summary.counts || {};
    return 'Itinerary: ' + (c.completed || 0) + '/' + (c.total || 0) + ' done';
  }

    function isoWeekOf(dateStr) {
    const p = dateStr.split('-');
    const t = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  }

  function weekStartOf(y, m, d) {
    const dt = new Date(y, m, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return toDateStr(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

    function selectWeek(weekStartStr) {
    selectedWeekStart = weekStartStr;
  }

  // ---------- Week Calendar (Phase 2) ----------
  // Pure view over canonical data: PlannerData tasks (startTime/stopTime, with the
  // savedStartTime/savedStopTime a completed task keeps) + DateHub events. Nothing is stored here.
  const WEEK_HOUR_PX = 56;       // vertical scale: 1 hour = 56px, so height = duration
  const WEEK_MIN_BLOCK_PX = 18;  // readability floor for very short items only
    const WEEK_POINT_MIN = 20;     // layout footprint only for no-duration items (alarms, itinerary items without an end)
  let weekNowMin = -1;
  let weekSig = '';

  function openWeek(weekStartStr) {
    selectedWeekStart = weekStartStr;
    viewMode = 'week';
    render();
  }

  // Navigation hook for the future Day Calendar. When a CalendarDay module exists it only needs
  // to expose open(dateStr). Until then the existing Date Hub opens, so nothing is a dead click.
  function openDay(dateStr) {
    if (typeof CalendarDay !== 'undefined' && CalendarDay && typeof CalendarDay.open === 'function') {
      CalendarDay.open(dateStr);
      return;
    }
    openDateHub(dateStr);
  }

  function addDaysStr(dateStr, n) {
    const p = dateStr.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function shiftWeek(delta) {
    if (!selectedWeekStart) selectedWeekStart = weekStartOf(viewYear, viewMonth, 1);
    selectedWeekStart = addDaysStr(selectedWeekStart, delta * 7);
    const thu = new Date(addDaysStr(selectedWeekStart, 3) + 'T00:00:00');
    viewYear = thu.getFullYear();
    viewMonth = thu.getMonth();
    render();
  }

  function hmToMin(s) {
    if (typeof s !== 'string') return null;
    const p = s.split(':');
    if (p.length < 2) return null;
    const h = Number(p[0]), m = Number(p[1]);
    if (!isFinite(h) || !isFinite(m)) return null;
    return h * 60 + m;
  }

    function weekBlocksFor(dateStr) {
    const items = [];
    const shownTaskIds = {};
    if (typeof PlannerData !== 'undefined') {
      const topics = PlannerData.getAllTopics();
      PlannerData.getTasksForDate(dateStr).forEach(function (t) {
        if (t.archived) return;
        const startStr = t.startTime || t.savedStartTime;
        const stopStr = t.stopTime || t.savedStopTime;
        const s = hmToMin(startStr);
        let e = hmToMin(stopStr);
        if (s === null || e === null || s < 0 || s >= 1440 || e <= s) return;
        e = Math.min(e, 1440);
        const label = t.taskType === 'custom' ? t.title
          : (t.taskType === 'revision' ? (t.topicName + ' ' + t.revisionNumber) : t.topicName);
        const meta = t.topicId ? topics[t.topicId] : null;
        shownTaskIds[t.taskId] = true;
        items.push({
          kind: 'task',
          s: s,
          e: e,
          label: label || 'Task',
          color: meta && meta.color ? meta.color : null,
          done: !!t.completed,
          slot: startStr + '\u2013' + stopStr
        });
      });
    }
    if (typeof AlarmData !== 'undefined') {
      AlarmData.getList().forEach(function (a) {
        if (!a || !a.enabled || !a.recurrence || !AlarmData.dateMatchesRecurrence(a.recurrence, dateStr)) return;
        const s = hmToMin(a.time);
        if (s === null || s < 0 || s >= 1440) return;
        items.push({
          kind: 'alarm',
          icon: '\u23F0',
          point: true,
          s: s,
          e: Math.min(s + WEEK_POINT_MIN, 1440),
          label: a.text || 'Alarm',
          color: null,
          done: a.lastFiredDate === dateStr,
          slot: a.time
        });
      });
    }
    if (typeof ItineraryData !== 'undefined') {
      const day = ItineraryData.getToday();
      if (day && day.date === dateStr) {
        (day.items || []).forEach(function (it) {
          if (it.state === 'skipped') return;
          if (it.refId && shownTaskIds[it.refId]) return;
          const s = hmToMin(it.plannedStart);
          if (s === null || s < 0 || s >= 1440) return;
          let e = hmToMin(it.plannedEnd);
          const point = e === null || e === s;
          if (!point && e < s) e = 1440;
          items.push({
            kind: 'itinerary',
            icon: '\u25C7',
            point: point,
            s: s,
            e: point ? Math.min(s + WEEK_POINT_MIN, 1440) : Math.min(e, 1440),
            label: it.label || 'Itinerary',
            color: null,
            done: it.state === 'completed',
            slot: point ? it.plannedStart : it.plannedStart + '\u2013' + it.plannedEnd
          });
        });
      }
    }
    return items;
  }

  function weekSignature() {
    if (!selectedWeekStart) return '';
    const parts = [];
    for (let i = 0; i < 7; i++) {
      weekBlocksFor(addDaysStr(selectedWeekStart, i)).forEach(function (it) {
        parts.push(i + '|' + it.kind + '|' + it.s + '|' + it.e + '|' + it.label + '|' + (it.done ? 1 : 0) + '|' + (it.color || ''));
      });
    }
    return parts.join(';');
  }
  // Simultaneous items: overlapping items form a cluster and share the column width in lanes.
  function layoutLanes(items) {
    items.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    let cluster = [], clusterEnd = -1;
    function flush() {
      const laneEnds = [];
      cluster.forEach(function (it) {
        let lane = laneEnds.findIndex(function (end) { return end <= it.s; });
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e); } else { laneEnds[lane] = it.e; }
        it.lane = lane;
      });
      cluster.forEach(function (it) { it.lanes = laneEnds.length; });
      cluster = [];
    }
    items.forEach(function (it) {
      if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.e);
    });
    if (cluster.length) flush();
    return items;
  }

  // Runs from the existing TimeEngine heartbeat (subscribed by id in renderWeek). It only moves one
  // line, and only when the minute changes, so there is no timer of its own.
    function updateWeekNow() {
    if (viewMode === 'week' && selectedWeekStart && weekSignature() !== weekSig) { render(); return; }
    const line = document.querySelector('#calendar-grid .cal-wk-now');
    if (!line) return;
    if (line.dataset.date !== todayStr()) { render(); return; }
    const n = new Date();
    const min = n.getHours() * 60 + n.getMinutes();
    if (min === weekNowMin) return;
    weekNowMin = min;
    line.style.top = (min * WEEK_HOUR_PX / 60) + 'px';
  }

  function renderWeek(grid, label) {
    const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dowNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = text;
      return n;
    }

    if (!selectedWeekStart) selectedWeekStart = weekStartOf(viewYear, viewMonth, 1);
    const prevScroller = grid.querySelector('.cal-wk');
    const keepScroll = prevScroller ? prevScroller.scrollTop : null;
    const today = todayStr();
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDaysStr(selectedWeekStart, i));

    const first = new Date(days[0] + 'T00:00:00'), last = new Date(days[6] + 'T00:00:00');
    label.textContent = 'Week ' + isoWeekOf(days[0]) + ' \u00b7 ' +
      monthShort[first.getMonth()] + ' ' + first.getDate() +
      (first.getFullYear() !== last.getFullYear() ? ', ' + first.getFullYear() : '') + ' \u2013 ' +
      (last.getMonth() !== first.getMonth() || first.getFullYear() !== last.getFullYear() ? monthShort[last.getMonth()] + ' ' : '') +
      last.getDate() + ', ' + last.getFullYear();

    const lensHost = document.getElementById('calendar-lens');
    if (lensHost) lensHost.innerHTML = '';
    grid.innerHTML = '';

    const wrap = el('div', 'cal-wk');
    const inner = el('div', 'cal-wk-inner');
    inner.style.setProperty('--wk-hour', WEEK_HOUR_PX + 'px');

    // sticky top: day headers + optional all-day row
    const top = el('div', 'cal-wk-top');
    const head = el('div', 'cal-wk-row cal-wk-headrow');
    head.appendChild(el('div', 'cal-wk-axis'));
    days.forEach(function (ds, i) {
      const d = new Date(ds + 'T00:00:00');
      const b = el('button', 'cal-wk-dayhead');
      b.type = 'button';
      if (ds === today) b.classList.add('cal-wk-today');
      if (i >= 5) b.classList.add('cal-wk-weekend');
      const showMon = i === 0 || d.getDate() === 1;
      b.appendChild(el('span', 'cal-wk-dow', dowNames[i] + (showMon ? ' \u00b7 ' + monthShort[d.getMonth()] : '')));
      b.appendChild(el('span', 'cal-wk-dnum', String(d.getDate())));
      b.title = formatLong(ds);
      b.setAttribute('aria-label', formatLong(ds));
      b.addEventListener('click', function () { openDay(ds); });
      head.appendChild(b);
    });
    top.appendChild(head);

    const hubs = days.map(function (ds) { return DateHub.get(ds); });
    if (hubs.some(function (h) { return h.events && h.events.length; })) {
      const ad = el('div', 'cal-wk-row cal-wk-allday');
      ad.appendChild(el('div', 'cal-wk-axis cal-wk-axis-label', 'all day'));
      hubs.forEach(function (h, i) {
        const c = el('div', 'cal-wk-adcell');
        (h.events || []).forEach(function (ev) {
          const chip = el('div', 'cal-wk-chip', ev);
          chip.title = ev;
          c.appendChild(chip);
        });
        c.addEventListener('click', function () { openDateHub(days[i]); });
        ad.appendChild(c);
      });
      top.appendChild(ad);
    }
    inner.appendChild(top);

    // time grid
    const body = el('div', 'cal-wk-row cal-wk-body');
    const axis = el('div', 'cal-wk-axis cal-wk-axis-hours');
    axis.style.height = (24 * WEEK_HOUR_PX) + 'px';
    for (let h = 1; h < 24; h++) {
      const tl = el('span', 'cal-wk-hour', pad(h) + ':00');
      tl.style.top = (h * WEEK_HOUR_PX) + 'px';
      axis.appendChild(tl);
    }
    body.appendChild(axis);

    let earliest = null;
    days.forEach(function (ds, i) {
      const col = el('div', 'cal-wk-col');
      col.style.height = (24 * WEEK_HOUR_PX) + 'px';
      if (i >= 5) col.classList.add('cal-wk-weekend');
      if (ds === today) col.classList.add('cal-wk-today');

      layoutLanes(weekBlocksFor(ds)).forEach(function (it) {
        if (earliest === null || it.s < earliest) earliest = it.s;
                const hPx = it.point ? WEEK_MIN_BLOCK_PX : Math.max((it.e - it.s) * WEEK_HOUR_PX / 60 - 2, WEEK_MIN_BLOCK_PX);
        const b = el('div', 'cal-wk-block');
        b.style.top = Math.min(it.s * WEEK_HOUR_PX / 60 + 1, 24 * WEEK_HOUR_PX - hPx - 1) + 'px';
        b.style.height = hPx + 'px';
        b.style.left = (it.lane * 100 / it.lanes) + '%';
        b.style.width = 'calc(' + (100 / it.lanes) + '% - 2px)';
        if (it.color) b.style.setProperty('--wk-color', it.color);
        if (it.done) b.classList.add('cal-wk-done');
        if (it.kind === 'alarm') b.classList.add('cal-wk-alarm');
        if (it.kind === 'itinerary') b.classList.add('cal-wk-itin');
        if (it.point) b.classList.add('cal-wk-point');
        if (hPx < 34) b.classList.add('cal-wk-block-short');
        b.title = (it.icon ? it.icon + ' ' : '') + it.label + ' \u00b7 ' + it.slot;
        b.appendChild(el('div', 'cal-wk-block-title', (it.icon ? it.icon + ' ' : '') + it.label));
        if (hPx >= 44) b.appendChild(el('div', 'cal-wk-block-time', it.slot));
        b.addEventListener('click', function () { openDay(ds); });
        col.appendChild(b);
      });

      if (ds === today) {
        const nowLine = el('div', 'cal-wk-now');
        nowLine.dataset.date = ds;
        col.appendChild(nowLine);
      }
      body.appendChild(col);
    });
    inner.appendChild(body);
    wrap.appendChild(inner);
    grid.appendChild(wrap);

    wrap.scrollTop = keepScroll !== null
      ? keepScroll
      : (earliest !== null ? Math.max(0, earliest - 60) : 7 * 60) * WEEK_HOUR_PX / 60;

        weekNowMin = -1;
    weekSig = weekSignature();
    updateWeekNow();
    if (typeof TimeEngine !== 'undefined') TimeEngine.subscribe(updateWeekNow, 'calendar-week');

    renderCountdown();
    renderStreak();
  }

  function renderYear(grid, label) {
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const now = new Date();
    const today = todayStr();
    label.textContent = String(viewYear);
    grid.innerHTML = '';
    const lensHost = document.getElementById('calendar-lens');
    if (lensHost) lensHost.innerHTML = '';

    monthNames.forEach(function (name, m) {
      const box = document.createElement('div');
      box.className = 'cal-year-month';
      if (viewYear === now.getFullYear() && m === now.getMonth()) box.classList.add('cal-year-current');
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-label', name + ' ' + viewYear);

      const title = document.createElement('div');
      title.className = 'cal-year-month-name';
      title.textContent = name;
      box.appendChild(title);

      const mini = document.createElement('div');
      mini.className = 'cal-year-mini';
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (w) {
        const s = document.createElement('span');
        s.className = 'cal-year-wd';
        s.textContent = w;
        mini.appendChild(s);
      });
      const offset = (new Date(viewYear, m, 1).getDay() + 6) % 7;
      for (let i = 0; i < offset; i++) mini.appendChild(document.createElement('span'));
      const dim = new Date(viewYear, m + 1, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const s = document.createElement('span');
        s.textContent = d;
        if (toDateStr(viewYear, m, d) === today) s.className = 'cal-year-today';
        mini.appendChild(s);
      }
      box.appendChild(mini);

      const openMonth = function () {
        viewMonth = m;
        viewMode = 'month';
        render();
      };
      box.addEventListener('click', openMonth);
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMonth(); }
      });
      grid.appendChild(box);
    });

    renderCountdown();
    renderStreak();
  }

  function render() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid || !label) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            label.textContent = monthNames[viewMonth] + ' ' + viewYear;
    label.title = viewMode === 'week' ? 'Back to month' : 'Year overview';
    grid.classList.toggle('cal-grid-year', viewMode === 'year');
    grid.classList.toggle('cal-grid-week', viewMode === 'week');
    if (viewMode !== 'week' && typeof TimeEngine !== 'undefined') TimeEngine.unsubscribe('calendar-week');
    if (lastRenderedMode !== viewMode) {
      lastRenderedMode = viewMode;
      grid.classList.remove('cal-enter');
      void grid.offsetWidth;
      grid.classList.add('cal-enter');
    }
    if (viewMode === 'year') { renderYear(grid, label); return; }
    if (viewMode === 'week') { renderWeek(grid, label); return; }

        grid.innerHTML = '';
    renderLensControl();
    const lens = getLens(), lensTag = activeLensTag(lens);
    const lensOpts = lensTag ? { tagId: lensTag } : null;

        const firstDay = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayStr();

    function addWeekCell(dayOfMonth) {
      const ws = weekStartOf(viewYear, viewMonth, dayOfMonth);
      const wkNum = isoWeekOf(ws);
      const wk = document.createElement('button');
      wk.type = 'button';
      wk.className = 'cal-week';
      wk.textContent = wkNum;
      wk.dataset.weekStart = ws;
      wk.title = 'Week ' + wkNum;
      wk.setAttribute('aria-label', 'Week ' + wkNum);
      wk.addEventListener('click', function (e) {
        e.stopPropagation();
                selectWeek(ws);
        openWeek(ws);
      });
      grid.appendChild(wk);
    }

    const weekHead = document.createElement('div');
    weekHead.className = 'cal-head cal-head-wk';
    grid.appendChild(weekHead);

    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) {
      const head = document.createElement('div');
      head.className = 'cal-head';
      head.textContent = d;
      grid.appendChild(head);
    });

    addWeekCell(1);
    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-cell cal-blank';
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      if (day > 1 && (firstDay + day - 1) % 7 === 0) addWeekCell(day);
      const dateStr = toDateStr(viewYear, viewMonth, day);
      const hub = DateHub.get(dateStr);

      const cell = document.createElement('div');
            cell.className = 'cal-cell';
      if ((firstDay + day - 1) % 7 >= 5) cell.classList.add('cal-weekend');
      if (dateStr === today) cell.classList.add('cal-today');
      if (hub.color) {
        cell.classList.add('cal-colored');
        cell.style.setProperty('--cal-user-color', hub.color);
      }

            const dayNum = document.createElement('div');
      dayNum.className = 'cal-day-num';
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      if (lens.mode !== 'normal' && typeof PTPE !== 'undefined' && dateStr <= today && (lens.mode !== 'tag' || lensTag)) {
        const lv = PTPE.lens(lens.mode, dateStr, lensOpts);
        if (lv.norm !== null) {
          cell.classList.add('cal-lens');
          cell.style.setProperty('--cal-lens-color', PTPE.lensColor(lens.mode, lensOpts));
          cell.style.setProperty('--cal-lens-a', String(Math.round((0.1 + lv.norm * 0.4) * 100)) + '%');
          cell.title = lv.text;
        }
      }

         let cellHasTask = false;
      let cellHasRevision = false;
      let cellHasTarget = false;
      if (typeof PlannerData !== 'undefined') {
        cellHasTask = PlannerData.getIncompleteTasksForDate(dateStr).length > 0;
        cellHasRevision = PlannerData.getTasksForDate(dateStr).some(function (t) { return t.taskType === 'revision'; });
      }
      if (typeof TargetsData !== 'undefined') {
        const dayTargets = TargetsData.getTargetsForDate(dateStr) || [];
        cellHasTarget = dayTargets.some(function (t) { return !t.completed; });
      }
      if (cellHasTask || cellHasRevision || cellHasTarget) {
        const activityDot = document.createElement('span');
        activityDot.className = 'cal-activity-dot';
        activityDot.title = 'Something due today';
        cell.appendChild(activityDot);
      }

      if (hub.important && hub.label) {
        const importantChip = document.createElement('div');
        importantChip.className = 'cal-important-chip';
        importantChip.textContent = hub.label;
        cell.appendChild(importantChip);
      }

      if (Streak.qualifiesForFire(dateStr)) {
        const fire = document.createElement('span');
        fire.className = 'cal-fire';
        fire.textContent = '\uD83D\uDD25';
        cell.appendChild(fire);
      }

      if (typeof JournalData !== 'undefined' && JournalData.isBlueFire(dateStr)) {
        const blueFire = document.createElement('span');
        blueFire.className = 'cal-bluefire';
        blueFire.textContent = '\uD83D\uDD35';
        cell.appendChild(blueFire);
      }

      if (typeof JournalData !== 'undefined') {
        const jEntry = JournalData.getEntry(dateStr);
        if (jEntry.mood) {
          const moodEl = document.createElement('span');
          moodEl.className = 'cal-mood';
          moodEl.textContent = jEntry.mood.split(' ')[0];
          cell.appendChild(moodEl);
        }
      }

      if (typeof PlannerData !== 'undefined') {
        const dueTasks = PlannerData.getIncompleteTasksForDate(dateStr);
        if (dueTasks.length > 0) {
          const snippet = document.createElement('div');
          snippet.className = 'cal-todo-snippet';
          const shownTasks = dueTasks.slice(0, 2);
          shownTasks.forEach(function (t) {
            const line = t.taskType === 'custom' ? t.title
              : (t.taskType === 'revision' ? (t.topicName + ' ' + t.revisionNumber) : t.topicName);
            const lineEl = document.createElement('div');
            lineEl.textContent = line;
            const topicMeta = t.topicId ? PlannerData.getAllTopics()[t.topicId] : null;
            if (topicMeta && topicMeta.color) lineEl.style.borderLeft = '3px solid ' + topicMeta.color;
            snippet.appendChild(lineEl);
          });
          if (dueTasks.length > shownTasks.length) {
            const moreEl = document.createElement('div');
            moreEl.textContent = '+' + (dueTasks.length - shownTasks.length) + ' more';
            snippet.appendChild(moreEl);
          }
          cell.appendChild(snippet);
        }

        const revisionCount = PlannerData.getTasksForDate(dateStr).filter(function (t) { return t.taskType === 'revision'; }).length;
        if (revisionCount > 0) {
          const dots = document.createElement('div');
          dots.className = 'cal-revision-dots';
          for (let i = 0; i < revisionCount; i++) {
            const dot = document.createElement('span');
            dot.className = 'cal-revision-dot';
            dots.appendChild(dot);
          }
          cell.appendChild(dots);
        }
      }

      if (hub.events && hub.events.length) {
        const evtSnippet = document.createElement('div');
        evtSnippet.className = 'cal-event-snippet';
        const shownEvts = hub.events.slice(0, 2);
        shownEvts.forEach(function (ev) {
          const evLine = document.createElement('div');
          evLine.className = 'cal-event-line';
          evLine.textContent = ev.length > 16 ? ev.slice(0, 16) + '\u2026' : ev;
          evtSnippet.appendChild(evLine);
        });
        if (hub.events.length > shownEvts.length) {
          const moreEl = document.createElement('div');
          moreEl.className = 'cal-event-line cal-event-more';
          moreEl.textContent = '+' + (hub.events.length - shownEvts.length) + ' more';
          evtSnippet.appendChild(moreEl);
        }
        cell.appendChild(evtSnippet);
      }

      if (hub.note) {
        const preview = document.createElement('div');
        preview.className = 'cal-note-preview';
        const noteIcon = document.createElement('span');
        noteIcon.className = 'cal-note-icon';
        noteIcon.textContent = '\uD83D\uDCDD';
        preview.appendChild(noteIcon);
        const noteText = document.createElement('span');
        noteText.className = 'cal-note-text';
        noteText.textContent = hub.note.length > 18 ? hub.note.slice(0, 18) + '…' : hub.note;
        preview.appendChild(noteText);
        cell.appendChild(preview);
      }

      if (hub.itinerarySummary) {
        const itPreview = document.createElement('div');
        itPreview.className = 'cal-itinerary-preview';
        itPreview.textContent = itinerarySummaryLabel(hub.itinerarySummary);
        cell.appendChild(itPreview);
      }

            if (typeof CalendarPhotos !== 'undefined') CalendarPhotos.apply(cell, dateStr);

      cell.addEventListener('click', function () {
        openDateHub(dateStr);
      });

      grid.appendChild(cell);
    }

    renderCountdown();
    renderStreak();
  }

  function renderTodoList(dateStr) {
    if (typeof PlannerData === 'undefined') return '<p class="datehub-todo-empty empty-state">No planner tasks.</p>';
    const tasks = PlannerData.getTasksForDate(dateStr);
    if (tasks.length === 0) return '<p class="datehub-todo-empty empty-state">Nothing due.</p>';

    // Groups come from the canonical subject list (active subjects first, in list order). A task
    // whose subject is no longer active (removed) still gets its own group under its recorded
    // subject name, so history stays labelled correctly. Only subject-less tasks go to Other.
    const groups = [];
    const groupFor = Object.create(null);
    PlannerData.getAllSubjects().forEach(function (s) {
      groupFor[s] = { name: s, tasks: [] };
      groups.push(groupFor[s]);
    });
    const otherGroup = { name: 'Other', tasks: [] };
    tasks.forEach(function (t) {
      if (!t.subject) { otherGroup.tasks.push(t); return; }
      if (!groupFor[t.subject]) {
        groupFor[t.subject] = { name: t.subject, tasks: [] };
        groups.push(groupFor[t.subject]);
      }
      groupFor[t.subject].tasks.push(t);
    });
    groups.push(otherGroup);

    return groups.map(function (group) {
      const subjectTasks = group.tasks;
      if (subjectTasks.length === 0) return '';
      return '<div class="datehub-todo-subject">' +
        '<div class="datehub-todo-subject-name section-heading">' + escTg(group.name) + '</div>' +
        '<ul class="datehub-todo-list">' +
          subjectTasks.map(function (t) {
            const label = t.taskType === 'custom' ? t.title
              : (t.taskType === 'revision'
                ? (t.topicName + ' \u2014 ' + t.revisionNumber)
                : (t.topicName + ' (' + PlannerData.taskLabel(t) + ')'));
            return '<li class="datehub-todo-item list-row' + (t.completed ? ' datehub-todo-item-done' : '') + '">' +
              '<label class="switch-label">' +
                '<input type="checkbox" class="datehub-todo-check switch-input" data-task-id="' + t.taskId + '"' + (t.completed ? ' checked' : '') + '>' +
                ' ' + label +
              '</label>' +
              '<button class="datehub-todo-delete btn btn-danger" data-task-id="' + t.taskId + '">Delete</button>' +
            '</li>';
          }).join('') +
        '</ul>' +
      '</div>';
    }).join('');
  }

  function confirmDeleteDateHubTask(taskId, dateStr) {
    Modal.open(
      '<h3 class="section-heading">Delete task?</h3>' +
      '<p>This removes it from your schedule. This cannot be undone.</p>' +
      '<div class="study-prompt-actions">' +
        '<button id="datehub-delete-confirm" class="btn btn-danger">Delete</button>' +
        '<button id="datehub-delete-cancel" class="btn btn-secondary">Cancel</button>' +
      '</div>'
    );
    document.getElementById('datehub-delete-confirm').addEventListener('click', function () {
      PlannerData.deleteTask(taskId);
      render();
      openDateHub(dateStr);
    });
    document.getElementById('datehub-delete-cancel').addEventListener('click', function () { openDateHub(dateStr); });
  }

  function renderTargetsSection(dateStr) {
  const targets = TargetsData.getTargetsForDate(dateStr);
  if (!targets || targets.length === 0) return '';
  function escTg(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }
  return '<div class="datehub-targets-section">' +
    '<label class="datehub-label datehub-todo-heading section-heading">Targets</label>' +
    '<ul class="datehub-targets-list">' +
      targets.map(function (tg) {
        if (tg.subtargets && tg.subtargets.length > 0) {
          return '<li class="list-row"><span>' + escTg(tg.title) + ' \u2014 ' + tg.currentValue + '/' + tg.targetValue + '</span></li>';
        }
        return '<li class="list-row"><label class="switch-label"><input type="checkbox" class="datehub-target-check switch-input" data-target-id="' + tg.targetId + '" ' + (tg.completed ? 'checked' : '') + '> ' +
          escTg(tg.title) + ' \u2014 ' + tg.currentValue + '/' + tg.targetValue + '</label></li>';
      }).join('') +
    '</ul>' +
  '</div>';
  }
  
  function openDateHub(dateStr) {
    const hub = DateHub.get(dateStr);
    const hubDate = new Date(dateStr + 'T00:00:00');
    const hubWeekday = hubDate.toLocaleDateString('en-US', { weekday: 'long' });
    const hubMonthYear = hubDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const html =
      '<div class="datehub">' +
        '<div class="datehub-header">' +
          '<h3 class="datehub-date" title="' + formatLong(dateStr) + '">' +
            '<span class="datehub-day">' + hubDate.getDate() + '</span>' +
            '<span class="datehub-dow">' +
              '<span class="datehub-weekday">' + hubWeekday + '</span>' +
              '<span class="datehub-monthyear">' + hubMonthYear + '</span>' +
            '</span>' +
          '</h3>' +
          '<div class="datehub-header-actions">' +
            '<button type="button" id="datehub-options-btn" class="datehub-options-btn btn btn-secondary" aria-label="Options" aria-expanded="false" aria-controls="datehub-options">\u22EE</button>' +
            '<button id="datehub-close" class="datehub-close btn btn-secondary" aria-label="Close">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div id="datehub-options" class="datehub-options" hidden>' +
          '<label class="datehub-label section-heading">important date</label>' +
          '<div class="datehub-important-row">' +
            '<input type="checkbox" id="datehub-important" class="switch-input"' + (hub.important ? ' checked' : '') + '>' +
            '<input type="text" id="datehub-important-label" class="input" placeholder="label (e.g. NEET, Birthday)" value="' + (hub.label || '') + '"' + (hub.important ? '' : ' disabled') + '>' +
          '</div>' +
          '<label class="datehub-label section-heading">background</label>' +
          '<input type="color" id="datehub-color" class="input" value="' + (hub.color || '#ffffff') + '">' +
          (typeof CalendarPhotos !== 'undefined'
            ? '<label class="datehub-label section-heading">photo</label>' +
              '<div style="display:flex;gap:8px;align-items:center;">' +
                '<input type="file" id="datehub-photo-input" accept="image/*">' +
                '<button type="button" id="datehub-photo-remove" class="btn btn-secondary"' + (CalendarPhotos.has(dateStr) ? '' : ' disabled') + '>Remove</button>' +
              '</div>'
            : '') +
        '</div>' +
        (hub.itinerarySummary ? '<div class="datehub-itinerary-summary">' + itinerarySummaryLabel(hub.itinerarySummary) + '</div>' : '') +
        '<div class="datehub-todo-section">' +
          '<label class="datehub-label datehub-todo-heading section-heading">To Do</label>' +
          renderTodoList(dateStr) +
        '</div>' +
        (typeof TargetsData !== 'undefined' ? renderTargetsSection(dateStr) : '') +
        '<label class="datehub-label section-heading">Events</label>' +
        '<div id="datehub-events-list"></div>' +
        '<div class="datehub-event-add-row">' +
          '<input type="text" id="datehub-event-input" class="input" placeholder="Add event...">' +
          '<button id="datehub-event-add-btn" class="btn btn-primary">Add</button>' +
        '</div>' +
        '<label class="datehub-label section-heading">note</label>' +
        '<textarea id="datehub-note" class="input" rows="3">' + (hub.note || '') + '</textarea>' +
        '<div class="datehub-footer">' +
          '<div class="datehub-quicknav">' +
            '<button id="datehub-goto-journal" class="btn btn-secondary">\uD83D\uDCD4 Journal</button>' +
            '<button id="datehub-goto-planner" class="btn btn-secondary">\uD83D\uDCDA Planner</button>' +
          '</div>' +
          '<button id="datehub-save" class="btn btn-primary">Save</button>' +
        '</div>' +
      '</div>';

    Modal.open(html, { size: 'md' });

    document.getElementById('datehub-close').addEventListener('click', Modal.close);

    document.getElementById('datehub-options-btn').addEventListener('click', function (e) {
      const panel = document.getElementById('datehub-options');
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      e.currentTarget.setAttribute('aria-expanded', String(willOpen));
    });

    document.querySelectorAll('.datehub-target-check').forEach(function (cb) {
      cb.addEventListener('click', function () {
        TargetsData.toggleTargetComplete(cb.dataset.targetId);
        openDateHub(dateStr);
      });
    });

    function renderEventsList() {
      const hub = DateHub.get(dateStr);
      const evts = hub.events || [];
      const listEl = document.getElementById('datehub-events-list');
      if (!listEl) return;
      listEl.innerHTML = evts.length ? evts.map(function (ev, i) {
        return '<div class="datehub-event-row list-row">' + escDatehub(ev) +
          ' <button class="datehub-event-del btn btn-danger" data-idx="' + i + '" aria-label="Delete event">&times;</button></div>';
      }).join('') : '<span class="datehub-empty empty-state">None</span>';
      listEl.querySelectorAll('.datehub-event-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const hub2 = DateHub.get(dateStr);
          const evts2 = (hub2.events || []).slice();
          evts2.splice(Number(btn.dataset.idx), 1);
          DateHub.update(dateStr, { events: evts2 });
          renderEventsList();
        });
      });
    }
    function escDatehub(s) { return String(s || '').replace(/[<>&]/g, function(c){ return c==='<'?'&lt;':c==='>'?'&gt;':'&amp;'; }); }
    renderEventsList();
    document.getElementById('datehub-event-add-btn').addEventListener('click', function () {
      const val = document.getElementById('datehub-event-input').value.trim();
      if (!val) return;
      const hub = DateHub.get(dateStr);
      const evts = (hub.events || []).concat([val]);
      DateHub.update(dateStr, { events: evts });
      document.getElementById('datehub-event-input').value = '';
      renderEventsList();
    });
    document.querySelectorAll('.datehub-todo-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        PlannerData.toggleComplete(cb.dataset.taskId);
        render();
        openDateHub(dateStr);
      });
    });

    document.querySelectorAll('.datehub-todo-delete').forEach(function (btn) {
      btn.addEventListener('click', function () { confirmDeleteDateHubTask(btn.dataset.taskId, dateStr); });
    });
    document.getElementById('datehub-save').addEventListener('click', function () {
      const note = document.getElementById('datehub-note').value;
      const color = document.getElementById('datehub-color').value;
      const important = document.getElementById('datehub-important').checked;
      const label = document.getElementById('datehub-important-label').value.trim();
      DateHub.update(dateStr, { note: note, color: color, important: important, label: important ? label : '' });
      render();
      Modal.close();
    });

        document.getElementById('datehub-color').addEventListener('change', function (e) {
      DateHub.update(dateStr, { color: e.target.value });
      render();
    });

    const photoInput = document.getElementById('datehub-photo-input');
    const photoRemove = document.getElementById('datehub-photo-remove');
    if (photoInput && typeof CalendarPhotos !== 'undefined') {
      photoInput.addEventListener('change', function () {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        CalendarPhotos.attach(dateStr, file).then(function (ok) {
          if (!ok) { alert('Please choose an image file.'); return; }
          render();
          if (photoRemove) photoRemove.disabled = false;
        }).catch(function () { alert("Couldn't save that photo."); });
      });
    }
    if (photoRemove && typeof CalendarPhotos !== 'undefined') {
      photoRemove.addEventListener('click', function () {
        CalendarPhotos.remove(dateStr).then(function () {
          render();
          photoRemove.disabled = true;
          if (photoInput) photoInput.value = '';
        });
      });
    }

    document.getElementById('datehub-important').addEventListener('change', function (e) {
      document.getElementById('datehub-important-label').disabled = !e.target.checked;
    });

    // Placeholder hooks — Journal/Planner tabs don't read the selected date yet.
    // Once those tabs exist, they should read this date from DateHub/State instead
    // of these buttons growing their own logic.
    document.getElementById('datehub-goto-journal').addEventListener('click', function () {
      Modal.close();
      if (typeof Journal !== 'undefined' && Journal.openDate) Journal.openDate(dateStr);
      Nav.switchTo('journal');
    });

    document.getElementById('datehub-goto-planner').addEventListener('click', function () {
      Modal.close();
      if (typeof Planner !== 'undefined' && Planner.openDate) Planner.openDate(dateStr);
      Nav.switchTo('library');
    });
  }

  function renderStreak() {
    const el = document.getElementById('calendar-streak');
    if (!el) return;

    const result = Streak.recalc();
    el.innerHTML =
      '<span class="streak-current">Current streak: ' + result.current + (result.current === 1 ? ' day' : ' days') + '</span>' +
      '<span class="streak-high">Best: ' + result.highScore + (result.highScore === 1 ? ' day' : ' days') + '</span>';
  }

  function daysUntil(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    const base = new Date(todayStr() + 'T00:00:00');
    return Math.round((target - base) / 86400000);
  }

  function getNextImportantDate() {
    const hubs = DateHub.getAll();
    const today = todayStr();
    const upcoming = Object.keys(hubs)
      .filter(function (dateStr) { return hubs[dateStr].important && dateStr >= today; })
      .sort();
    if (upcoming.length === 0) return null;
    const dateStr = upcoming[0];
    return { dateStr: dateStr, label: hubs[dateStr].label || '' };
  }

  function renderCountdown() {
    const el = document.getElementById('calendar-countdown');
    if (!el) return;

    const next = getNextImportantDate();
    if (!next) {
      el.innerHTML = '<p class="countdown-empty empty-state">No important dates coming up.</p>';
      return;
    }

    const days = daysUntil(next.dateStr);
    const daysText = days === 0 ? 'Today!' : (days === 1 ? '1 day left' : days + ' days left');

    el.innerHTML =
      '<div class="countdown-box">' +
        '<div class="countdown-label">' + (next.label || 'Important date') + '</div>' +
        '<div class="countdown-date">' + formatLong(next.dateStr) + '</div>' +
        '<div class="countdown-days">' + daysText + '</div>' +
      '</div>';
  }

  function openAllEventsModal() {
    const hubs = DateHub.getAll();
    const today = todayStr();
    const rows = Object.keys(hubs)
      .filter(function (d) { return d >= today && (hubs[d].events || []).length > 0; })
      .sort()
      .map(function (d) {
        return hubs[d].events.map(function (ev) {
          return '<div class="datehub-event-row list-row"><strong>' + formatLong(d) + '</strong> \u2014 ' + ev + '</div>';
        }).join('');
      }).join('');
    Modal.open('<h3 class="section-heading">Upcoming Events</h3>' + (rows || '<p class="empty-state">No events added yet.</p>'));
  }

    function next() {
        if (viewMode === 'week') { shiftWeek(1); return; }
    if (viewMode === 'year') { viewYear++; render(); return; }
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  }

  function prev() {
        if (viewMode === 'week') { shiftWeek(-1); return; }
    if (viewMode === 'year') { viewYear--; render(); return; }
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  }

  function init() {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();

const prevBtn = document.getElementById('calendar-prev');
    const nextBtn = document.getElementById('calendar-next');
    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (nextBtn) nextBtn.addEventListener('click', next);
        const evtBtn = document.getElementById('calendar-events-btn');
    if (evtBtn) evtBtn.addEventListener('click', openAllEventsModal);
    const monthLabel = document.getElementById('calendar-month-label');
    if (monthLabel) {
      const toggleYear = function () {
                viewMode = viewMode === 'month' ? 'year' : 'month';
        render();
      };
      monthLabel.setAttribute('role', 'button');
      monthLabel.tabIndex = 0;
      monthLabel.title = 'Year overview';
      monthLabel.addEventListener('click', toggleYear);
      monthLabel.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleYear(); }
      });
    }

    initialized = true;
    render();
  }

  function isReady() {
    return initialized;
  }

    return {
    init: init,
    render: render,
    isReady: isReady,
        selectWeek: selectWeek,
    openWeek: openWeek,
    openDay: openDay,
    getSelectedWeek: function () { return selectedWeekStart; }
  };
})();
