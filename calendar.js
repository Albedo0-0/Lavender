// calendar.js — monthly grid + Date Hub modal (Feature 1). Depends on: State, Storage, DateHub, Modal, Nav.
// Cells show event names and task-count dots only (never task text). The Date Hub modal lists the day's events
// (title / note / tag, via DateHub.getEvents / setEvents) and a small To-do read from State.get().tasks.
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
  // ---------- Views bar: Month / Week / Year, Today, and the heatmap (lens) controls ----------
  // Lives in the existing #calendar-lens host. Heatmap values still come only from PTPE.lens().
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const VIEW_MODES = [{ key: 'month', label: 'Month' }, { key: 'week', label: 'Week' }, { key: 'year', label: 'Year' }];
  // End labels of each heatmap's colour scale (they mirror how PTPE.lens() normalises each metric).
  const LENS_SCALE = {
    productivity: ['0', '10'], mood: ['Rough', 'Great'], study: ['0h', '6h+'],
    habits: ['0%', '100%'], tests: ['0%', '100%'], tag: ['Low', 'High']
  };
  const LENS_EMPTY = {
    productivity: 'No productivity scores', mood: 'No moods logged', study: 'No study time logged',
    habits: 'No habit data', tests: 'No tests recorded', tag: 'No activity'
  };
  function lensAlpha(norm) { return Math.round((0.1 + norm * 0.4) * 100) + '%'; }
  // Short in-cell text: the full text can carry a tag name or a test count, which will not fit a small cell.
  function lensShortText(mode, lv) {
    if (mode === 'tests' || mode === 'tag') return Math.round(lv.norm * 100) + '%';
    return lv.text;
  }

  function currentWeekStart() {
    const n = new Date();
    return weekStartOf(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function isAtToday() {
    const n = new Date();
    if (viewMode === 'year') return viewYear === n.getFullYear();
    if (viewMode === 'week') return selectedWeekStart === currentWeekStart();
    return viewYear === n.getFullYear() && viewMonth === n.getMonth();
  }
  function goToday() {
    const n = new Date();
    viewYear = n.getFullYear();
    viewMonth = n.getMonth();
    if (viewMode === 'week') selectedWeekStart = currentWeekStart();
    render();
  }
  function setView(mode) {
    if (mode === viewMode || !VIEW_MODES.some(function (v) { return v.key === mode; })) return;
    if (mode === 'week') {
      const n = new Date();
      selectedWeekStart = (viewYear === n.getFullYear() && viewMonth === n.getMonth())
        ? currentWeekStart()
        : weekStartOf(viewYear, viewMonth, 1);
    }
    viewMode = mode;
    render();
  }

  // The dates a month / year view actually shows (used for the heatmap's coverage and empty states).
  function periodRange() {
    if (viewMode === 'year') return { from: toDateStr(viewYear, 0, 1), to: toDateStr(viewYear, 11, 31), label: String(viewYear) };
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    return { from: toDateStr(viewYear, viewMonth, 1), to: toDateStr(viewYear, viewMonth, dim), label: MONTH_NAMES[viewMonth] + ' ' + viewYear };
  }
  function lensCoverage(mode, tagId, range) {
    const t = todayStr(), opts = tagId ? { tagId: tagId } : null;
    let days = 0, withData = 0;
    for (let d = range.from; d <= range.to && d <= t; d = addDaysStr(d, 1)) {
      days++;
      if (PTPE.lens(mode, d, opts).norm !== null) withData++;
    }
    return { days: days, withData: withData };
  }

  function renderViewsBar() {
    const host = document.getElementById('calendar-lens');
    if (!host) return;
    const ae = document.activeElement;
    let focusSel = null;
    if (ae && host.contains(ae)) focusSel = ae.dataset && ae.dataset.view ? '[data-view="' + ae.dataset.view + '"]' : (ae.id ? '#' + ae.id : null);

    const hasPTPE = typeof PTPE !== 'undefined';
    const lens = hasPTPE ? getLens() : { mode: 'normal', tagId: null };
    const tags = hasPTPE && typeof TagsData !== 'undefined' ? TagsData.getAllTagsList() : [];
    const tagId = hasPTPE ? activeLensTag(lens) : null;
    const showLens = hasPTPE && viewMode !== 'week';

        let html = '<div class="cal-views">';

    if (showLens) {
      html += '<span class="cal-views-spacer"></span>' +
        '<label class="cal-lens-label" for="calendar-lens-select">Heatmap</label>' +
        '<select id="calendar-lens-select" class="cal-lens-select" title="Heatmap" aria-label="Heatmap">' +
          PTPE.LENSES.map(function (l) { return '<option value="' + l.key + '"' + (l.key === lens.mode ? ' selected' : '') + '>' + escHtml(l.label) + '</option>'; }).join('') +
        '</select>' +
        (lens.mode === 'tag' && tags.length
          ? '<select id="calendar-lens-tag" class="cal-lens-select" title="Tag" aria-label="Tag">' +
            tags.map(function (t) { return '<option value="' + escHtml(t.tagId) + '"' + (t.tagId === tagId ? ' selected' : '') + '>' + escHtml(t.name) + '</option>'; }).join('') + '</select>'
          : '');
    }
    html += '</div>';

    if (showLens && lens.mode !== 'normal') {
      const info = PTPE.LENSES.filter(function (l) { return l.key === lens.mode; })[0];
      const tagName = tagId && TagsData.getTag(tagId) ? TagsData.getTag(tagId).name : '';
      const range = periodRange();
      let msg = '', count = '', scale = '';
      if (lens.mode === 'tag' && !tagId) {
        msg = 'No tags yet. Create a tag to see its activity here.';
      } else {
        const color = PTPE.lensColor(lens.mode, tagId ? { tagId: tagId } : null);
        const ends = LENS_SCALE[lens.mode] || ['Low', 'High'];
        scale = '<span class="cal-lens-scale" aria-hidden="true"><span class="cal-lens-end">' + escHtml(ends[0]) + '</span>' +
          [0, 0.25, 0.5, 0.75, 1].map(function (n) { return '<i class="cal-lens-swatch" style="--cal-lens-color:' + escHtml(color) + ';--cal-lens-a:' + lensAlpha(n) + '"></i>'; }).join('') +
          '<span class="cal-lens-end">' + escHtml(ends[1]) + '</span></span>';
        if (range.from > todayStr()) {
          msg = range.label + ' is still ahead \u2014 nothing to show yet.';
        } else {
          const cov = lensCoverage(lens.mode, tagId, range);
          if (cov.withData === 0) msg = (LENS_EMPTY[lens.mode] || 'No data') + (lens.mode === 'tag' && tagName ? ' for \u201C' + tagName + '\u201D' : '') + ' in ' + range.label + ' yet.';
          else count = cov.withData + ' of ' + cov.days + (cov.days === 1 ? ' day' : ' days') + ' with data';
        }
      }
      html += '<div class="cal-lens-legend">' +
        '<span class="cal-lens-name">' + escHtml(info ? info.label : '') + (lens.mode === 'tag' && tagName ? ' \u00b7 ' + escHtml(tagName) : '') + '</span>' +
        scale + (count ? '<span class="cal-lens-count">' + escHtml(count) + '</span>' : '') +
      '</div>' +
      (msg ? '<div class="cal-lens-empty" role="status">' + escHtml(msg) + '</div>' : '');
    }

    host.innerHTML = html;

    host.querySelectorAll('.cal-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.dataset.view); });
    });
    const todayBtn = host.querySelector('[data-act="today"]');
    if (todayBtn) todayBtn.addEventListener('click', goToday);
    const lensSel = host.querySelector('#calendar-lens-select');
    if (lensSel) lensSel.addEventListener('change', function (e) {
      State.patch('settings', { calendarLens: e.target.value });
      render();
    });
    const tagSel = host.querySelector('#calendar-lens-tag');
    if (tagSel) tagSel.addEventListener('change', function (e) { State.patch('settings', { calendarLensTagId: e.target.value }); render(); });

    if (focusSel) {
      const f = host.querySelector(focusSel);
      if (f && !f.disabled) f.focus();
    }
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

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Tasks come straight from the canonical store, State.get().tasks (read only — the Planning Agent
  // owns every write). Archived tasks are hidden, like everywhere else in the planner.
  function tasksOnDate(dateStr) {
    const all = State.get().tasks || {};
    return Object.keys(all).map(function (id) { return all[id]; }).filter(function (t) {
      return t && t.date === dateStr && !t.archived;
    });
  }
  function indexTasksByDate() {
    const all = State.get().tasks || {};
    const byDate = Object.create(null);
    Object.keys(all).forEach(function (id) {
      const t = all[id];
      if (!t || !t.date || t.archived) return;
      (byDate[t.date] = byDate[t.date] || []).push(t);
    });
    return byDate;
  }
  function taskName(t) {
    if (t.taskType === 'custom') return t.title || 'Task';
    if (t.taskType === 'revision') return (t.topicName || 'Revision') + ' R' + (t.revisionNumber || '');
    return t.topicName || t.title || 'Task';
  }
  // Small stable pick from a fixed palette of felt tones, so the same tag/subject always gets the same colour.
  // Nothing is stored — event tags have no colour field.
  function toneFor(text) {
    const s = String(text || '').toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'dh-tone-' + (h % 5);
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
  // Pure view over canonical data: PlanData tasks (startTime/stopTime, with the
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
    function openDay(dateStr, from) {
    if (typeof CalendarDay !== 'undefined' && CalendarDay && typeof CalendarDay.open === 'function') {
      CalendarDay.open(dateStr, from || 'week');
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
    if (typeof PlanData !== 'undefined') {
      const topics = PlanData.getAllTopics();
            PlanningAgent.getTasksForDateRange(dateStr, dateStr).forEach(function (t) {
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
        if (typeof CanonicalTaskStore !== 'undefined') {
      CanonicalTaskStore.getTasks({ date: dateStr, scheduled: 'timed' }).forEach(function (t) {
                if (!t.alarm || !t.alarm.enabled || t.status === 'cancelled' || t.duration) return;
        const s = hmToMin(t.time);
        if (s === null || s < 0 || s >= 1440) return;
        items.push({
          kind: 'alarm',
          icon: '\u23F0',
          point: true,
          s: s,
          e: Math.min(s + WEEK_POINT_MIN, 1440),
          label: t.title || 'Reminder',
          color: null,
          done: t.status === 'completed' || !!t.alarm.notified,
          slot: t.time
        });
      });
    }
    if (typeof ItineraryData !== 'undefined') {
      const day = dateStr === todayStr() ? ItineraryData.getToday() : ItineraryData.getSummaryForDate(dateStr);
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

    const dayEvents = days.map(function (ds) { return DateHub.getEvents(ds); });
    const dayBlocks = days.map(function (ds) { return weekBlocksFor(ds); });
    const hasEvents = dayEvents.some(function (l) { return l.length; });
    if (hasEvents) {
      const ad = el('div', 'cal-wk-row cal-wk-allday');
      ad.appendChild(el('div', 'cal-wk-axis cal-wk-axis-label', 'all day'));
      dayEvents.forEach(function (list, i) {
        const c = el('div', 'cal-wk-adcell');
        list.forEach(function (ev, k) {
          const chip = el('div', 'cal-wk-chip cal-wk-chip-' + (k % 3), ev.title);
          chip.title = ev.title + (ev.tag ? ' \u00b7 ' + ev.tag : '') + (ev.note ? '\n' + ev.note : '');
          c.appendChild(chip);
        });
        c.addEventListener('click', function () { openDateHub(days[i]); });
        ad.appendChild(c);
      });
      top.appendChild(ad);
    }
    if (!hasEvents && !dayBlocks.some(function (b) { return b.length; })) {
      top.appendChild(el('div', 'cal-wk-empty', 'Nothing scheduled this week. Click a day to add an event or task.'));
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

      layoutLanes(dayBlocks[i]).forEach(function (it) {
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
    const now = new Date();
    const today = todayStr();
    label.textContent = String(viewYear);
    grid.innerHTML = '';

    const lens = typeof PTPE !== 'undefined' ? getLens() : { mode: 'normal', tagId: null };
    const lensTag = activeLensTag(lens);
    const lensOpts = lensTag ? { tagId: lensTag } : null;
    const useLens = lens.mode !== 'normal' && typeof PTPE !== 'undefined' && (lens.mode !== 'tag' || !!lensTag);
    const lensColor = useLens ? PTPE.lensColor(lens.mode, lensOpts) : null;
    const hubs = DateHub.getAll();

    MONTH_NAMES.forEach(function (name, m) {
      const box = document.createElement('div');
      box.className = 'cal-year-month';
      if (viewYear === now.getFullYear() && m === now.getMonth()) box.classList.add('cal-year-current');
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-label', name + ' ' + viewYear);
      box.title = 'Open ' + name + ' ' + viewYear;

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
        const ds = toDateStr(viewYear, m, d);
        const s = document.createElement('span');
        s.textContent = d;
        const tips = [];
        if (ds === today) s.classList.add('cal-year-today');
        if (useLens && ds <= today) {
          const lv = PTPE.lens(lens.mode, ds, lensOpts);
          if (lv.norm !== null) {
            s.classList.add('cal-year-lens');
            s.style.setProperty('--cal-lens-color', lensColor);
            s.style.setProperty('--cal-lens-a', lensAlpha(lv.norm));
            tips.push(lv.text);
          }
        }
        const evCount = hubs[ds] && Array.isArray(hubs[ds].events) ? hubs[ds].events.length : 0;
        if (evCount) {
          s.classList.add('cal-year-has-event');
          tips.push(evCount + (evCount === 1 ? ' event' : ' events'));
        }
        if (tips.length) s.title = formatLong(ds) + ' \u00b7 ' + tips.join(' \u00b7 ');
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
            label.innerHTML = monthNames[viewMonth] + ' <span class="cal-yr">' + viewYear + '</span>';
    label.title = viewMode === 'month' ? 'Year overview' : 'Back to month';
    const navUnit = viewMode === 'week' ? 'week' : (viewMode === 'year' ? 'year' : 'month');
    ['prev', 'next'].forEach(function (k) {
      const nb = document.getElementById('calendar-' + k);
      if (!nb) return;
      const t = (k === 'prev' ? 'Previous ' : 'Next ') + navUnit;
      nb.setAttribute('aria-label', t);
      nb.title = t;
    });
    grid.classList.toggle('cal-grid-year', viewMode === 'year');
    grid.classList.toggle('cal-grid-week', viewMode === 'week');
    if (viewMode !== 'week' && typeof TimeEngine !== 'undefined') TimeEngine.unsubscribe('calendar-week');
    renderViewsBar();
    if (lastRenderedMode !== viewMode) {
      lastRenderedMode = viewMode;
      grid.classList.remove('cal-enter');
      void grid.offsetWidth;
      grid.classList.add('cal-enter');
    }
    if (viewMode === 'year') { renderYear(grid, label); return; }
    if (viewMode === 'week') { renderWeek(grid, label); return; }

    grid.innerHTML = '';
    const lens = getLens(), lensTag = activeLensTag(lens);
    const lensOpts = lensTag ? { tagId: lensTag } : null;

        const firstDay = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayStr();
    const taskIndex = indexTasksByDate();

    function addWeekCell(dayOfMonth) {
      const ws = weekStartOf(viewYear, viewMonth, dayOfMonth);
      const wkNum = isoWeekOf(ws);
      const wk = document.createElement('button');
      wk.type = 'button';
      wk.className = 'cal-week';
            wk.innerHTML = '<span class="cal-week-word">Week</span><span class="cal-week-n">' + wkNum + '</span>';
      wk.dataset.weekStart = ws;
      if (ws === selectedWeekStart) wk.classList.add('is-selected');
      if (ws === currentWeekStart()) wk.classList.add('is-current');
      wk.title = 'Open week ' + wkNum;
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
      if (selectedWeekStart && weekStartOf(viewYear, viewMonth, day) === selectedWeekStart) cell.classList.add('cal-in-week');
      if (dateStr === today) { cell.classList.add('cal-today'); cell.setAttribute('aria-current', 'date'); }
      if (hub.color) {
        cell.classList.add('cal-colored');
        cell.style.setProperty('--cal-user-color', hub.color);
      }

            const dayNum = document.createElement('div');
      dayNum.className = 'cal-day-num';
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      let cellLensText = '';
      if (lens.mode !== 'normal' && typeof PTPE !== 'undefined' && dateStr <= today && (lens.mode !== 'tag' || lensTag)) {
        const lv = PTPE.lens(lens.mode, dateStr, lensOpts);
        if (lv.norm !== null) {
          cell.classList.add('cal-lens');
          cell.style.setProperty('--cal-lens-color', PTPE.lensColor(lens.mode, lensOpts));
          cell.style.setProperty('--cal-lens-a', lensAlpha(lv.norm));
          cell.title = formatLong(dateStr) + ' \u00b7 ' + lv.text;
          cellLensText = lv.text;
          const lensVal = document.createElement('span');
          lensVal.className = 'cal-lens-val';
          lensVal.textContent = lensShortText(lens.mode, lv);
          cell.appendChild(lensVal);
        }
      }

         let cellHasTask = false;
      let cellHasRevision = false;
      let cellHasTarget = false;
      if (typeof PlanData !== 'undefined') {
                cellHasTask = PlanningAgent.getIncompleteTasksForDate(dateStr).length > 0;
        cellHasRevision = PlanningAgent.getTasksByDate(dateStr).some(function (t) { return t.taskType === 'revision'; });
      }
      if (typeof TargetsData !== 'undefined') {
        const dayTargets = TargetsData.getTargetsForDate(dateStr) || [];
        cellHasTarget = dayTargets.some(function (t) { return !t.completed; });
      }
      const dayTasks = taskIndex[dateStr] || [];
      if ((!dayTasks.length && (cellHasTask || cellHasRevision)) || cellHasTarget) {
        const activityDot = document.createElement('span');
        activityDot.className = 'cal-activity-dot';
        activityDot.title = 'Something due today';
        cell.appendChild(activityDot);
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

      if (hub.events && hub.events.length) {
        const evtSnippet = document.createElement('div');
        evtSnippet.className = 'cal-event-snippet';
        const shownEvts = hub.events.slice(0, 2);
        shownEvts.forEach(function (ev) {
          const name = DateHub.eventTitle(ev);
          const evLine = document.createElement('div');
          evLine.className = 'cal-event-line';
          evLine.textContent = name;
          evLine.title = name;
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

      // Task count as dots only — never task text. Finished tasks are dimmed, revisions get their own tone.
      if (dayTasks.length) {
        const MAX_DOTS = 6;
        const open = dayTasks.filter(function (t) { return !t.completed; }).length;
        const dots = document.createElement('div');
        dots.className = 'cal-task-dots';
        dots.title = dayTasks.length + (dayTasks.length === 1 ? ' task' : ' tasks') + (open !== dayTasks.length ? ' \u00b7 ' + open + ' open' : '');
        dayTasks.slice().sort(function (a, b) { return (a.completed ? 1 : 0) - (b.completed ? 1 : 0); })
          .slice(0, MAX_DOTS).forEach(function (t) {
            const dot = document.createElement('span');
            dot.className = 'cal-task-dot' + (t.completed ? ' cal-task-dot-done' : '') + (t.taskType === 'revision' ? ' cal-task-dot-rev' : '');
            dots.appendChild(dot);
          });
        if (dayTasks.length > MAX_DOTS) {
          const more = document.createElement('span');
          more.className = 'cal-task-more';
          more.textContent = '+' + (dayTasks.length - MAX_DOTS);
          dots.appendChild(more);
        }
        cell.appendChild(dots);
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

      const evTotal = Array.isArray(hub.events) ? hub.events.length : 0;
      const ariaBits = [new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) + ', ' + formatLong(dateStr)];
      if (evTotal) ariaBits.push(evTotal + (evTotal === 1 ? ' event' : ' events'));
      if (dayTasks.length) ariaBits.push(dayTasks.length + (dayTasks.length === 1 ? ' task' : ' tasks'));
      if (cellLensText) ariaBits.push(cellLensText);
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', ariaBits.join(', '));
      cell.addEventListener('keydown', function (e) {
        if (e.target !== cell) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDateHub(dateStr); }
      });

      cell.addEventListener('click', function () {
        openDateHub(dateStr);
      });

      grid.appendChild(cell);
    }

    renderCountdown();
    renderStreak();
  }

  // Small, read-only To-do for one date: the first few useful tasks from State.get().tasks (open ones first, then by
  // start time). Ticking a box goes through PlanningAgent.toggleTask — the Planning Agent still owns completion.
  const TODO_SNIPPET_MAX = 4;
  function renderTodoSnippets(dateStr) {
    const tasks = tasksOnDate(dateStr).sort(function (a, b) {
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
      const sa = a.startTime || a.savedStartTime || '99:99';
      const sb = b.startTime || b.savedStartTime || '99:99';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return taskName(a).localeCompare(taskName(b));
    });
    if (!tasks.length) return '<p class="datehub-empty empty-state">Nothing planned for this day.</p>';
    const shown = tasks.slice(0, TODO_SNIPPET_MAX);
    const rows = shown.map(function (t) {
      const name = taskName(t);
      const subject = t.subject || '';
      return '<li class="datehub-task' + (t.completed ? ' datehub-task-done' : '') + '">' +
        '<label class="datehub-task-label">' +
          '<input type="checkbox" class="datehub-todo-check" data-task-id="' + escHtml(t.taskId) + '"' + (t.completed ? ' checked' : '') + ' aria-label="Mark done: ' + escHtml(name) + '">' +
          '<span class="datehub-task-name" title="' + escHtml(name) + '">' + escHtml(name) + '</span>' +
        '</label>' +
        (subject ? '<span class="datehub-tag ' + toneFor(subject) + '">' + escHtml(subject) + '</span>' : '') +
      '</li>';
    }).join('');
    const extra = tasks.length - shown.length;
    return '<ul class="datehub-task-list">' + rows + '</ul>' +
      (extra > 0 ? '<button type="button" id="datehub-task-more" class="datehub-task-more">+' + extra + ' more</button>' : '');
  }

  function renderTargetsSection(dateStr) {
    const targets = TargetsData.getTargetsForDate(dateStr);
    if (!targets || targets.length === 0) return '';
    return '<section class="datehub-panel datehub-targets-section">' +
      '<h4 class="datehub-panel-title">Targets</h4>' +
      '<ul class="datehub-targets-list">' +
        targets.map(function (tg) {
          if (tg.subtargets && tg.subtargets.length > 0) {
            return '<li class="list-row"><span>' + escHtml(tg.title) + ' \u2014 ' + tg.currentValue + '/' + tg.targetValue + '</span></li>';
          }
          return '<li class="list-row"><label class="switch-label"><input type="checkbox" class="datehub-target-check switch-input" data-target-id="' + escHtml(tg.targetId) + '" ' + (tg.completed ? 'checked' : '') + '> ' +
            escHtml(tg.title) + ' \u2014 ' + tg.currentValue + '/' + tg.targetValue + '</label></li>';
        }).join('') +
      '</ul>' +
    '</section>';
  }

  function openDateHub(dateStr) {
    const hub = DateHub.get(dateStr);
    const hubDate = new Date(dateStr + 'T00:00:00');
    const hubWeekday = hubDate.toLocaleDateString('en-US', { weekday: 'long' });
    const hubMonth = hubDate.toLocaleDateString('en-US', { month: 'long' });
        const fullDate = hubWeekday + ', ' + hubMonth + ' ' + hubDate.getDate() + ' ' + hubDate.getFullYear();
    const dayDiff = daysUntil(dateStr);
    const relText = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff === -1 ? 'Yesterday'
      : dayDiff > 0 ? 'In ' + dayDiff + ' days' : Math.abs(dayDiff) + ' days ago';
    const html =
      '<div class="datehub">' +
        '<div class="datehub-header">' +
          '<div class="datehub-masthead">DateHub <span aria-hidden="true">\u273F</span></div>' +
          '<div class="datehub-header-actions">' +
            '<button type="button" id="datehub-options-btn" class="datehub-options-btn btn btn-secondary" aria-label="Options" title="Background &amp; photo" aria-expanded="false" aria-controls="datehub-options">\u22EE</button>' +
            '<button id="datehub-close" class="datehub-close btn btn-secondary" aria-label="Close">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="datehub-hero">' +
          '<div class="datehub-daynum" aria-hidden="true">' + hubDate.getDate() + '</div>' +
          '<div class="datehub-heroinfo">' +
            '<h3 class="datehub-fulldate" title="' + escHtml(formatLong(dateStr)) + '" aria-label="' + escHtml(fullDate) + '"><span class="dh-wd">' + escHtml(hubWeekday) + '</span><span class="dh-my">' + escHtml(hubMonth) + ' ' + hubDate.getFullYear() + '</span></h3>' +
            '<div class="datehub-chips">' +
              '<span class="datehub-chip' + (dayDiff === 0 ? ' datehub-chip-today' : '') + '">' + relText + '</span>' +
              '<span class="datehub-chip">Week ' + isoWeekOf(dateStr) + '</span>' +
              (hub.itinerarySummary ? '<span class="datehub-chip datehub-itinerary-summary">' + escHtml(itinerarySummaryLabel(hub.itinerarySummary)) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="datehub-options" class="datehub-options" hidden>' +
          '<label class="datehub-field-label" for="datehub-color">Background</label>' +
          '<input type="color" id="datehub-color" class="input" value="' + escHtml(hub.color || '#ffffff') + '">' +
          (typeof CalendarPhotos !== 'undefined'
            ? '<label class="datehub-field-label" for="datehub-photo-input">Photo</label>' +
              '<div class="datehub-photo-row">' +
                '<input type="file" id="datehub-photo-input" accept="image/*">' +
                '<button type="button" id="datehub-photo-remove" class="btn btn-secondary"' + (CalendarPhotos.has(dateStr) ? '' : ' disabled') + '>Remove</button>' +
              '</div>'
            : '') +
        '</div>' +
                '<div class="datehub-addbar">' +
          '<input type="text" id="datehub-event-input" class="input" maxlength="120" placeholder="Add to ' + escHtml(hubMonth + ' ' + hubDate.getDate()) + '\u2026" aria-label="Add an event on ' + escHtml(formatLong(dateStr)) + '">' +
          '<button type="button" id="datehub-event-add-btn" class="datehub-addbtn datehub-addbtn-event">+ Event</button>' +
          '<button type="button" id="datehub-goto-plan" class="datehub-addbtn datehub-addbtn-task">+ Task</button>' +
        '</div>' +
        '<div class="datehub-grid">' +
          '<section class="datehub-panel datehub-panel-events">' +
            '<h4 class="datehub-panel-title">Events <span class="datehub-panel-hint">all day</span></h4>' +
            '<div id="datehub-events-list"></div>' +
          '</section>' +
          '<div class="datehub-col">' +
            '<section class="datehub-panel datehub-panel-tasks">' +
              '<h4 class="datehub-panel-title">Tasks</h4>' +
              '<div id="datehub-todo-list"></div>' +
            '</section>' +
            (typeof TargetsData !== 'undefined' ? renderTargetsSection(dateStr) : '') +
          '</div>' +
        '</div>' +
        '<section class="datehub-panel datehub-panel-note">' +
          '<h4 class="datehub-panel-title"><label for="datehub-note">Note</label></h4>' +
          '<textarea id="datehub-note" class="input" rows="2" placeholder="A line about this day...">' + escHtml(hub.note || '') + '</textarea>' +
        '</section>' +
        '<div class="datehub-footer">' +
          '<div class="datehub-quicknav">' +
            '<button id="datehub-goto-journal" class="btn btn-secondary">\uD83D\uDCD4 Journal</button>' +
            '<button id="datehub-goto-day" class="btn btn-secondary">\uD83D\uDDD3 Day</button>' +
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

    // ---------- Events: title + note + tag, saved through DateHub.setEvents ----------
    let editing = null;            // null | 'new' | index of the event being edited
    const PILL_TONES = 3;

    function eventRowHtml(ev, i) {
      return '<li class="datehub-event dh-pill-' + (i % PILL_TONES) + '">' +
        '<button type="button" class="datehub-event-main" data-idx="' + i + '" aria-label="Edit event: ' + escHtml(ev.title) + '">' +
          '<span class="datehub-event-line"><span class="datehub-event-time">All-Day</span><span class="datehub-event-sep" aria-hidden="true">|</span><span class="datehub-event-title">' + escHtml(ev.title) + '</span>' +
            (DateHub.normalizeReminder(ev.reminder) ? '<span class="datehub-event-bell" title="Reminder: ' + escHtml(DateHub.reminderLabel(ev.reminder)) + '" role="img" aria-label="Reminder set">\uD83D\uDD14</span>' : '') +
          '</span>' +
          (ev.note ? '<span class="datehub-event-note">' + escHtml(ev.note) + '</span>' : '') +
        '</button>' +
        (ev.tag ? '<span class="datehub-tag ' + toneFor(ev.tag) + '">' + escHtml(ev.tag) + '</span>' : '') +
      '</li>';
    }

    function editorHtml(ev) {
      const tags = DateHub.knownEventTags();
      const rem = DateHub.normalizeReminder(ev.reminder);
      return '<li class="datehub-event-editor" id="datehub-event-editor">' +
        '<label class="datehub-field-label" for="datehub-ev-title">Title</label>' +
        '<input type="text" id="datehub-ev-title" class="input" maxlength="120" value="' + escHtml(ev.title) + '">' +
        '<label class="datehub-field-label" for="datehub-ev-note">Note</label>' +
        '<textarea id="datehub-ev-note" class="input" rows="2" maxlength="500">' + escHtml(ev.note) + '</textarea>' +
        '<label class="datehub-field-label" for="datehub-ev-tag">Tag</label>' +
        '<input type="text" id="datehub-ev-tag" class="input" maxlength="30" list="datehub-tag-options" placeholder="e.g. Chemistry" value="' + escHtml(ev.tag) + '">' +
        '<datalist id="datehub-tag-options">' + tags.map(function (t) { return '<option value="' + escHtml(t) + '"></option>'; }).join('') + '</datalist>' +
        '<label class="datehub-field-label" for="datehub-ev-reminder">Reminder</label>' +
        '<div class="datehub-ev-reminder-row">' +
          '<select id="datehub-ev-reminder" class="input"><option value="none">No reminder</option>' +
            DateHub.reminderOffsets.map(function (o) { return '<option value="' + o.days + '"' + (rem && rem.daysBefore === o.days ? ' selected' : '') + '>' + escHtml(o.label) + '</option>'; }).join('') +
          '</select>' +
          '<input type="time" id="datehub-ev-reminder-time" class="input" aria-label="Reminder time" value="' + escHtml(rem ? rem.time : '09:00') + '"' + (rem ? '' : ' disabled') + '>' +
        '</div>' +
        '<p id="datehub-ev-reminder-hint" class="datehub-ev-hint" hidden>That time has already passed, so this reminder won\u2019t fire.</p>' +
        '<p id="datehub-ev-error" class="datehub-ev-error" role="alert" hidden>Give the event a title.</p>' +
        '<div class="datehub-editor-actions">' +
          (editing === 'new' ? '' : '<button type="button" id="datehub-ev-delete" class="btn btn-danger">Delete</button>') +
          '<span class="datehub-editor-spacer"></span>' +
          '<button type="button" id="datehub-ev-cancel" class="btn btn-secondary">Cancel</button>' +
          '<button type="button" id="datehub-ev-save" class="btn btn-primary">Save event</button>' +
        '</div>' +
      '</li>';
    }

    function renderEventsList() {
      const listEl = document.getElementById('datehub-events-list');
      if (!listEl) return;
      const evts = DateHub.getEvents(dateStr);
      let rows = evts.map(function (ev, i) {
        return editing === i ? editorHtml(ev) : eventRowHtml(ev, i);
      }).join('');
      if (editing === 'new') rows += editorHtml({ title: '', note: '', tag: '' });
      listEl.innerHTML = rows
        ? '<ul class="datehub-event-list">' + rows + '</ul>'
        : '<span class="datehub-empty empty-state">No events yet.</span>';

      listEl.querySelectorAll('.datehub-event-main').forEach(function (btn) {
        btn.addEventListener('click', function () {
          editing = Number(btn.dataset.idx);
          renderEventsList();
        });
      });
      const editor = document.getElementById('datehub-event-editor');
      if (!editor) return;
      const titleEl = document.getElementById('datehub-ev-title');
      const errEl = document.getElementById('datehub-ev-error');
      titleEl.focus();
      const remSel = document.getElementById('datehub-ev-reminder');
      const remTime = document.getElementById('datehub-ev-reminder-time');
      const remHint = document.getElementById('datehub-ev-reminder-hint');
      function readReminder() {
        return remSel.value === 'none' ? null : { daysBefore: Number(remSel.value), time: remTime.value };
      }
      function syncReminderUi() {
        const rem = readReminder();
        remTime.disabled = !rem;
        const saved = editing === 'new' ? null : DateHub.getEvents(dateStr)[editing];
        const norm = DateHub.normalizeReminder(rem), prevNorm = saved ? DateHub.normalizeReminder(saved.reminder) : null;
        const changed = !prevNorm || !norm || prevNorm.daysBefore !== norm.daysBefore || prevNorm.time !== norm.time;
        const due = rem ? DateHub.reminderDueMs(dateStr, rem) : null;
        remHint.hidden = !(changed && due !== null && due <= Date.now());
      }
      remSel.addEventListener('change', syncReminderUi);
      remTime.addEventListener('input', syncReminderUi);
      syncReminderUi();
      function save() {
        const title = titleEl.value.trim();
        if (!title) { errEl.hidden = false; titleEl.focus(); return; }
        const list = DateHub.getEvents(dateStr);
        const next = {
          title: title,
          note: document.getElementById('datehub-ev-note').value.trim(),
          tag: document.getElementById('datehub-ev-tag').value.trim()
        };
        const patch = DateHub.reminderPatch(dateStr, editing === 'new' ? null : list[editing], readReminder());
        next.reminder = patch.reminder;
        next.remindedAt = patch.remindedAt;
        if (patch.reminder && typeof Notify !== 'undefined' && Notify.requestPermission) Notify.requestPermission();
        if (editing === 'new') list.push(next);
        else list[editing] = Object.assign({}, list[editing], next);
        DateHub.setEvents(dateStr, list);
        DateHub.syncReminders();
        editing = null;
        renderEventsList();
        render();
      }
      titleEl.addEventListener('input', function () { errEl.hidden = true; });
      titleEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      document.getElementById('datehub-ev-save').addEventListener('click', save);
      document.getElementById('datehub-ev-cancel').addEventListener('click', function () { editing = null; renderEventsList(); });
      const delBtn = document.getElementById('datehub-ev-delete');
      if (delBtn) delBtn.addEventListener('click', function () {
        const list = DateHub.getEvents(dateStr);
        list.splice(editing, 1);
        DateHub.setEvents(dateStr, list);
        DateHub.syncReminders();
        editing = null;
        renderEventsList();
        render();
      });
    }
    renderEventsList();

    // "+ Event": a typed title is added straight away; with nothing typed it opens a blank event to fill in.
    function addEventFromBar() {
      const input = document.getElementById('datehub-event-input');
      const val = input.value.trim();
      if (!val) { editing = 'new'; renderEventsList(); return; }
      const list = DateHub.getEvents(dateStr);
      list.push({ title: val, note: '', tag: '' });
      DateHub.setEvents(dateStr, list);
      input.value = '';
      editing = null;
      renderEventsList();
      render();
    }
    document.getElementById('datehub-event-add-btn').addEventListener('click', addEventFromBar);
    document.getElementById('datehub-event-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addEventFromBar(); }
    });

    // ---------- Tasks: small snippet list, redrawn in place ----------
    function bindTodo() {
      const host = document.getElementById('datehub-todo-list');
      if (!host) return;
      host.innerHTML = renderTodoSnippets(dateStr);
      host.querySelectorAll('.datehub-todo-check').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (typeof PlanningAgent !== 'undefined' && PlanningAgent.toggleTask) PlanningAgent.toggleTask(cb.dataset.taskId);
          bindTodo();
          render();
        });
      });
      const more = document.getElementById('datehub-task-more');
      if (more) more.addEventListener('click', function () { openDay(dateStr, 'datehub'); });
    }
    bindTodo();

    document.getElementById('datehub-save').addEventListener('click', function () {
      const note = document.getElementById('datehub-note').value;
      const color = document.getElementById('datehub-color').value;
      DateHub.update(dateStr, { note: note, color: color });
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

    // "+ Task" hands off to the Planning Agent, which owns task creation and scheduling.
    const planBtn = document.getElementById('datehub-goto-plan');
    if (planBtn) {
      planBtn.addEventListener('click', function () {
        if (typeof PlanningAgent !== 'undefined' && PlanningAgent.open) {
          PlanningAgent.open({ date: dateStr, intent: 'day' });
        }
      });
    }

    // Placeholder hooks — Journal/Planner tabs don't read the selected date yet.
    // Once those tabs exist, they should read this date from DateHub/State instead
    // of these buttons growing their own logic.
    document.getElementById('datehub-goto-journal').addEventListener('click', function () {
      Modal.close();
      if (typeof Journal !== 'undefined' && Journal.openDate) Journal.openDate(dateStr);
      Nav.switchTo('journal');
    });

    document.getElementById('datehub-goto-day').addEventListener('click', function () {
      openDay(dateStr, 'datehub');
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

  // Countdown target: the nearest date from today on that has an event. Dates saved earlier with the old
  // "important date" marker are still honoured (read only), so nothing already saved goes quiet.
  function getNextImportantDate() {
    const hubs = DateHub.getAll();
    const today = todayStr();
    const upcoming = Object.keys(hubs)
      .filter(function (dateStr) {
        const h = hubs[dateStr];
        return dateStr >= today && ((h.events || []).length > 0 || h.important);
      })
      .sort();
    if (upcoming.length === 0) return null;
    const dateStr = upcoming[0];
    const evs = DateHub.getEvents(dateStr);
    const label = evs.length
      ? evs[0].title + (evs.length > 1 ? ' +' + (evs.length - 1) + ' more' : '')
      : (hubs[dateStr].label || '');
    return { dateStr: dateStr, label: label };
  }

  function renderCountdown() {
    const el = document.getElementById('calendar-countdown');
    if (!el) return;

    const next = getNextImportantDate();
    if (!next) {
      el.innerHTML = '<p class="countdown-empty empty-state">No upcoming events.</p>';
      return;
    }

    const days = daysUntil(next.dateStr);
    const daysText = days === 0 ? 'Today!' : (days === 1 ? '1 day left' : days + ' days left');

    el.innerHTML =
      '<div class="countdown-box">' +
        '<div class="countdown-label">' + escHtml(next.label || 'Upcoming event') + '</div>' +
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
        return DateHub.getEvents(d).map(function (ev) {
          return '<div class="datehub-event-row list-row"><strong>' + formatLong(d) + '</strong> \u2014 ' + escHtml(ev.title) +
            (ev.tag ? ' <span class="datehub-tag ' + toneFor(ev.tag) + '">' + escHtml(ev.tag) + '</span>' : '') +
            (ev.note ? '<div class="datehub-event-note-line">' + escHtml(ev.note) + '</div>' : '') + '</div>';
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
    if (typeof DateHub.startReminders === 'function') DateHub.startReminders();
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
    setView: setView,
        openDay: openDay,
    openDateHub: openDateHub,
        openPlan: function (opts) { if (typeof PlanningAgent !== 'undefined' && PlanningAgent.open) PlanningAgent.open(opts); },
    blocksFor: weekBlocksFor,
    layoutLanes: layoutLanes,
    getSelectedWeek: function () { return selectedWeekStart; }
  };
})();
