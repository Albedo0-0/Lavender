// calendar-day.js — Day Calendar. A pure VIEW over canonical data; it stores nothing and owns no timer.
// Left 1/3: time-based schedule built by Calendar.blocksFor (the same function the Week Calendar uses:
// PlannerData tasks + AlarmData alarms + ItineraryData items). Right 2/3: visual dashboard derived from
// PlannerData / TimeEngine / PTPE / DateHub. Depends on: Calendar, Modal, DateHub, PlannerData,
// TimeEngine, AlarmData, ItineraryData, PTPE (all optional-guarded). Loads after calendar.js.
// Live updates: one TimeEngine.subscribe(…, 'calendar-day') heartbeat subscriber, registered on open and
// removed as soon as the Day Calendar is closed or replaced — no polling, no interval of its own.
// Day tag: DateHub has no separate per-day tag field, so the icon-only corner mark is the day's existing
// DateHub "important date" marker (hub.important, hover text = hub.label). Nothing shows when it is unset.

const CalendarDay = (function () {
  const SUB_ID = 'calendar-day';
  const HOUR_PX = 60;          // 1 minute = 1px, so block height = duration
  const MIN_BLOCK_PX = 20;     // readability floor for very short items only
  const POINT_PX = 20;         // alarms / items with no end: small pill, no invented duration
  const PALETTE = ['var(--color-sage-600)', 'var(--color-kraft-500)', 'var(--color-accent-rust)', 'var(--color-brown-600)', 'var(--color-sage-400)', 'var(--color-kraft-300)'];
  const DAY_BESTS = ['bestStudyDay', 'bestQuestions', 'bestProductivity', 'bestExp'];
  const SOURCE_NAMES = { stopwatch: 'Stopwatch', timer: 'Timer', candle: 'Candle' };

  let current = null;          // { date, from, sig }
  let nowLineMin = -1;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeColor(c) { return typeof c === 'string' && /^[#\w(),.%\s-]+$/.test(c) ? c : null; }
  function hmToMin(s) {
    if (typeof s !== 'string') return null;
    const p = s.split(':');
    if (p.length < 2) return null;
    const h = Number(p[0]), m = Number(p[1]);
    return (isFinite(h) && isFinite(m)) ? h * 60 + m : null;
  }
  function nowMin() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function fmtMin(min) {
    min = Math.round(min || 0);
    if (min <= 0) return '0m';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm';
  }
  function safe(fn) { try { return fn() || ''; } catch (e) { console.warn('CalendarDay section skipped', e); return ''; } }

  // ---------- canonical reads (no storage of its own) ----------
  function dayTasks(d) {
        if (typeof PlanningAgent === 'undefined' || !PlanningAgent.getTasksForDateRange) return [];
    return PlanningAgent.getTasksForDateRange(d, d).filter(function (t) { return !t.archived || t.completed; });
  }
  function taskMin(t) {
    const a = hmToMin(t.startTime || t.savedStartTime), b = hmToMin(t.stopTime || t.savedStopTime);
    return (a === null || b === null || b <= a) ? 0 : b - a;
  }
  function taskName(t) {
    return t.taskType === 'custom' ? (t.title || 'Task')
      : (t.taskType === 'revision' ? (t.topicName + ' ' + t.revisionNumber) : (t.topicName || 'Task'));
  }
  function itineraryDay(d) {
    if (typeof ItineraryData === 'undefined') return null;
    const day = d === todayStr() ? ItineraryData.getToday() : ItineraryData.getSummaryForDate(d);
    return day && day.date === d && Array.isArray(day.items) ? day : null;
  }
  function itineraryCounts(d) {
    const day = itineraryDay(d);
    if (!day) return null;
    const items = day.items.filter(function (it) { return it.state !== 'skipped'; });
    if (!items.length) return null;
    return { done: items.filter(function (it) { return it.state === 'completed'; }).length, total: items.length };
  }
  function dayAlarms(d) {
        if (typeof PlanningAgent === 'undefined' || !PlanningAgent.getAlarmsForDate) return [];
    return PlanningAgent.getAlarmsForDate(d).filter(function (a) { return hmToMin(a.time) !== null; });
  }
  function dayStats(d) {
    const out = { studyMs: 0, breakMs: 0, recs: [] };
    if (typeof TimeEngine === 'undefined' || d > todayStr()) return out;
    const s = TimeEngine.getDayStats(d);
    out.studyMs = (s && s.studyMs) || 0;
    out.breakMs = (s && s.breakMs) || 0;
    out.recs = TimeEngine.getRecordsForDate(d);
    return out;
  }
  function subjectSplit(d) {
    const rows = [];
    if (typeof PTPE === 'undefined') return rows;
    PTPE.dimensionItems('subject').forEach(function (it, i) {
      const ms = PTPE.dimStudyHours(d, { type: 'subject', id: it.id }) * 3600000;
      if (ms >= 30000) rows.push({ label: it.label, ms: ms, color: PALETTE[i % PALETTE.length] });
    });
    rows.sort(function (a, b) { return b.ms - a.ms; });
    return rows;
  }
  function sessionLabel(r) {
        const t = r.taskId && typeof PlanningAgent !== 'undefined' && PlanningAgent.getTask ? PlanningAgent.getTask(r.taskId) : null;
    return t ? taskName(t) : (SOURCE_NAMES[r.source] || 'Study session');
  }

  // Everything the heartbeat compares to decide whether the view is stale (cheap, no DOM).
  function signature(d) {
    const parts = [];
    Calendar.blocksFor(d).forEach(function (it) {
      parts.push(it.kind + '|' + it.s + '|' + it.e + '|' + it.label + '|' + (it.done ? 1 : 0) + '|' + (it.color || ''));
    });
    const hub = DateHub.get(d);
    parts.push('h|' + (hub.events || []).join('\u0001') + '|' + (hub.important ? 1 : 0) + '|' + (hub.label || ''));
    dayTasks(d).forEach(function (t) { parts.push('t|' + t.taskId + '|' + (t.completed ? 1 : 0) + '|' + (t.subject || '')); });
    const st = dayStats(d);
    parts.push('s|' + Math.floor(st.studyMs / 60000) + '|' + Math.floor(st.breakMs / 60000) + '|' + st.recs.length);
    const ic = itineraryCounts(d);
    parts.push('i|' + (ic ? ic.done + '/' + ic.total : ''));
    parts.push('n|' + (d === todayStr() ? 1 : 0));
    return parts.join(';');
  }

  // ---------- SVG helpers ----------
  function ringSvg(segs, total) {
    let acc = 0;
    const gap = segs.length > 1 ? 0.8 : 0;
    const arcs = segs.map(function (s, i) {
      const len = Math.max(0, s.v / total * 100);
      const c = '<circle class="cal-day-seg" cx="50" cy="50" r="40" pathLength="100" style="--len:' + Math.max(0, len - gap).toFixed(2) +
        ';--off:' + (-acc).toFixed(2) + ';--i:' + i + ';stroke:' + s.color + '"/>';
      acc += len;
      return c;
    }).join('');
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="cal-day-track" cx="50" cy="50" r="40"/>' + arcs + '</svg>';
  }
  function barRow(name, ms, share, color, i, title) {
    return '<div class="cal-day-bar"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
      '<span class="cal-day-bar-name">' + esc(name) + '</span>' +
      '<span class="cal-day-bar-track"><span class="cal-day-bar-fill" style="--w:' + Math.max(1.5, Math.min(100, share)).toFixed(1) + '%;--c:' + color + ';--i:' + i + '"></span></span>' +
      '<span class="cal-day-bar-v">' + fmtMin(ms / 60000) + '</span></div>';
  }

  // ---------- timeline (left 1/3) ----------
  function timelineHtml(d, blocks, isToday) {
    const H = HOUR_PX, h24 = 24 * H;
    let axis = '';
    for (let h = 1; h < 24; h++) axis += '<span class="cal-wk-hour" style="top:' + (h * H) + 'px">' + pad(h) + ':00</span>';
    const blks = Calendar.layoutLanes(blocks).map(function (it) {
      const hPx = it.point ? POINT_PX : Math.max((it.e - it.s) * H / 60 - 2, MIN_BLOCK_PX);
      const top = Math.min(it.s * H / 60 + 1, h24 - hPx - 1);
      const col = safeColor(it.color);
      const cls = 'cal-wk-block' + (it.done ? ' cal-wk-done' : '') + (it.kind === 'alarm' ? ' cal-wk-alarm' : '') +
        (it.kind === 'itinerary' ? ' cal-wk-itin' : '') + (it.point ? ' cal-wk-point' : '') + (hPx < 34 ? ' cal-wk-block-short' : '');
      const style = 'top:' + top + 'px;height:' + hPx + 'px;left:' + (it.lane * 100 / it.lanes) + '%;width:calc(' + (100 / it.lanes) + '% - 2px)' +
        (col ? ';--wk-color:' + col : '');
      const name = (it.icon ? it.icon + ' ' : '') + it.label;
      return '<div class="' + cls + '" style="' + style + '" title="' + esc(name + ' \u00b7 ' + it.slot) + '">' +
        '<div class="cal-wk-block-title">' + esc(name) + (it.point ? '<span class="cal-day-blk-t"> \u00b7 ' + esc(it.slot) + '</span>' : '') + '</div>' +
        (!it.point && hPx >= 44 ? '<div class="cal-wk-block-time">' + esc(it.slot) + '</div>' : '') +
        '</div>';
    }).join('');
    const now = isToday ? '<div class="cal-wk-now cal-day-now" data-date="' + d + '" style="top:' + (nowMin() * H / 60) + 'px"></div>' : '';
    return '<div class="cal-day-tl" style="--wk-hour:' + H + 'px">' +
      '<div class="cal-day-axis" style="height:' + h24 + 'px">' + axis + '</div>' +
      '<div class="cal-wk-col' + (isToday ? ' cal-wk-today' : '') + '" style="height:' + h24 + 'px">' + blks + now + '</div>' +
      '</div>';
  }

  // ---------- dashboard (right 2/3) ----------
  function completionHtml(ctx) {
    if (!ctx.tasks.length || ctx.isFuture) return '';
    const done = ctx.tasks.filter(function (t) { return t.completed; }).length;
    const pct = Math.round(done / ctx.tasks.length * 100);
    const ic = ctx.itin;
    return '<section class="cal-day-stat"><h4 class="cal-day-h">Completion</h4>' +
      '<div class="cal-day-ringwrap">' + ringSvg([{ v: pct, color: 'var(--color-sage-600)' }], 100) +
      '<div class="cal-day-ringc"><b>' + done + '/' + ctx.tasks.length + '</b><span>tasks</span></div></div>' +
      (ic ? '<div class="cal-day-sub">Itinerary ' + ic.done + '/' + ic.total + '</div>' : '') + '</section>';
  }

  function distributionHtml(ctx) {
    const st = ctx.st;
    let segs = [], center = '', unit = '', legend = [];
    if (st.studyMs > 0 || st.breakMs > 0) {
      if (st.studyMs > 0) { segs.push({ v: st.studyMs, color: 'var(--color-sage-600)' }); legend.push(['Study', st.studyMs / 60000, 'var(--color-sage-600)']); }
      if (st.breakMs > 0) { segs.push({ v: st.breakMs, color: 'var(--color-kraft-400)' }); legend.push(['Break', st.breakMs / 60000, 'var(--color-kraft-400)']); }
      center = fmtMin(st.studyMs / 60000); unit = 'studied';
    } else {
      let tMin = 0, itinMin = 0;
      ctx.blocks.forEach(function (b) {
        if (b.point) return;
        if (b.kind === 'task') tMin += b.e - b.s;
        else if (b.kind === 'itinerary') itinMin += b.e - b.s;
      });
      if (tMin > 0) { segs.push({ v: tMin, color: 'var(--color-sage-600)' }); legend.push(['Planner', tMin, 'var(--color-sage-600)']); }
      if (itinMin > 0) { segs.push({ v: itinMin, color: 'var(--color-kraft-500)' }); legend.push(['Itinerary', itinMin, 'var(--color-kraft-500)']); }
      center = fmtMin(tMin + itinMin); unit = 'scheduled';
    }
    if (!segs.length) return '';
    const total = segs.reduce(function (a, s) { return a + s.v; }, 0);
    return '<section class="cal-day-stat"><h4 class="cal-day-h">Time</h4>' +
      '<div class="cal-day-ringwrap">' + ringSvg(segs, total) + '<div class="cal-day-ringc"><b>' + esc(center) + '</b><span>' + unit + '</span></div></div>' +
      '<ul class="cal-day-legend">' + legend.map(function (l) {
        return '<li><i style="background:' + l[2] + '"></i>' + l[0] + ' <span>' + fmtMin(l[1]) + '</span></li>';
      }).join('') + '</ul></section>';
  }

  function plannedActualHtml(ctx) {
    const planned = ctx.tasks.reduce(function (a, t) { return a + taskMin(t); }, 0);
    const actual = ctx.st.studyMs / 60000;
    if (planned <= 0 && actual <= 0) return '';
    const max = Math.max(planned, actual, 1);
    let rows = '', i = 0;
    if (planned > 0) rows += barRow('Planned', planned * 60000, planned / max * 100, 'var(--color-kraft-400)', i++);
    if (actual > 0) rows += barRow('Recorded', actual * 60000, actual / max * 100, 'var(--color-sage-600)', i++);
    let note = '';
    if (actual <= 0 && ctx.isPast) note = 'No study recorded';
    else if (planned <= 0) note = 'Nothing planned';
    else if (ctx.isPast) {
      const diff = Math.round(actual - planned);
      note = Math.abs(diff) < 5 ? 'On plan' : (diff > 0 ? fmtMin(diff) + ' over plan' : fmtMin(-diff) + ' under plan');
    }
    const heading = (planned > 0 && actual > 0) ? 'Planned vs recorded' : (actual > 0 ? 'Recorded' : 'Planned');
    return '<section class="cal-day-stat cal-day-stat-wide"><h4 class="cal-day-h">' + heading + '</h4><div class="cal-day-bars">' + rows + '</div>' +
      (note ? '<div class="cal-day-sub">' + esc(note) + '</div>' : '') + '</section>';
  }

  function subjectsHtml(ctx) {
    if (!ctx.subj.length) return '';
    const total = ctx.st.studyMs || ctx.subj.reduce(function (a, s) { return a + s.ms; }, 0);
    const assigned = ctx.subj.reduce(function (a, s) { return a + s.ms; }, 0);
    let rows = ctx.subj.slice(0, 6).map(function (s, i) { return barRow(s.label, s.ms, s.ms / total * 100, s.color, i); }).join('');
    if (total - assigned > 60000) rows += barRow('Unassigned', total - assigned, (total - assigned) / total * 100, 'var(--color-kraft-300)', Math.min(ctx.subj.length, 6));
    return '<section><h4 class="cal-day-h">Study by subject</h4><div class="cal-day-bars">' + rows + '</div></section>';
  }

  function remindersEventsHtml(ctx) {
    const rem = ctx.alarms.length ? '<section><h4 class="cal-day-h">Reminders</h4><ul class="cal-day-list cal-day-rem">' +
      ctx.alarms.map(function (a) {
        return '<li' + (a.lastFiredDate === ctx.date ? ' class="cal-day-fired"' : '') + '><span class="cal-day-rt">' + esc(a.time) + '</span>' + esc(a.text || 'Alarm') + '</li>';
      }).join('') + '</ul></section>' : '';
    const evt = ctx.events.length ? '<section><h4 class="cal-day-h">Events</h4><ul class="cal-day-list cal-day-evt">' +
      ctx.events.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></section>' : '';
    return (rem || evt) ? '<div class="cal-day-pair">' + rem + evt + '</div>' : '';
  }

  function highlightsHtml(ctx) {
    const out = [];
    if (typeof PTPE !== 'undefined' && typeof PTPE.personalBests === 'function' && !ctx.isFuture) {
      PTPE.personalBests().forEach(function (b) {
        if (b.date === ctx.date && DAY_BESTS.indexOf(b.key) !== -1) out.push(['\u2605', b.label + ' \u00b7 ' + b.value]);
      });
    }
    if (typeof TimeEngine !== 'undefined') {
      const sess = ctx.st.recs.map(function (r) { return { r: r, ms: TimeEngine.getLiveStudyMs(r) }; })
        .filter(function (x) { return x.ms >= 60000; });
      if (sess.length >= 2) {
        const best = sess.reduce(function (a, b) { return b.ms > a.ms ? b : a; });
        out.push(['\u2022', 'Longest session \u00b7 ' + fmtMin(best.ms / 60000) + ' \u00b7 ' + sessionLabel(best.r)]);
      }
      const q = ctx.isFuture ? 0 : TimeEngine.getQuestionsForDate(ctx.date);
      if (q > 0) out.push(['\u2022', q + (q === 1 ? ' question solved' : ' questions solved')]);
    }
    if (ctx.subj.length >= 2) out.push(['\u2022', 'Most studied \u00b7 ' + ctx.subj[0].label + ' ' + fmtMin(ctx.subj[0].ms / 60000)]);
    const rev = ctx.tasks.filter(function (t) { return t.taskType === 'revision' && t.completed; }).length;
    if (rev > 0) out.push(['\u21BB', rev + (rev === 1 ? ' revision completed' : ' revisions completed')]);
    if (!out.length) return '';
    return '<section><h4 class="cal-day-h">Highlights</h4><ul class="cal-day-hl">' +
      out.map(function (h) { return '<li><i>' + h[0] + '</i>' + esc(h[1]) + '</li>'; }).join('') + '</ul></section>';
  }

  function activityHtml(ctx) {
    const sched = [], rec = [];
    ctx.blocks.forEach(function (b) { if (!b.point && b.e > b.s) sched.push([b.s, b.e]); });
    if (typeof TimeEngine !== 'undefined') {
      const dayStart = new Date(ctx.date + 'T00:00:00').getTime(), dayEnd = dayStart + 86400000, now = Date.now();
      ctx.st.recs.forEach(function (r) {
        if (!r.actualStart || TimeEngine.getLiveStudyMs(r) <= 0) return;
        const a = Math.max(Number(r.actualStart), dayStart), b = Math.min(r.actualEnd ? Number(r.actualEnd) : now, dayEnd);
        if (isFinite(a) && isFinite(b) && b > a) rec.push([(a - dayStart) / 60000, (b - dayStart) / 60000]);
      });
    }
    if (!sched.length && !rec.length) return '';
    function row(label, spans, color) {
      if (!spans.length) return '';
      return '<div class="cal-day-map-row"><span class="cal-day-map-k">' + label + '</span><div class="cal-day-map-bar">' +
        spans.map(function (s) {
          return '<i style="left:' + (s[0] / 14.4).toFixed(2) + '%;width:' + Math.max(0.5, (s[1] - s[0]) / 14.4).toFixed(2) + '%;--c:' + color + '"></i>';
        }).join('') + '</div></div>';
    }
    const ticks = [0, 6, 12, 18, 24].map(function (h) { return '<span style="left:' + (h / 24 * 100) + '%">' + (h === 24 ? '24' : pad(h)) + '</span>'; }).join('');
    return '<section><h4 class="cal-day-h">Day shape</h4>' + row('planned', sched, 'var(--color-kraft-400)') + row('recorded', rec, 'var(--color-sage-600)') +
      '<div class="cal-day-map-ticks">' + ticks + '</div></section>';
  }

  function dashboardHtml(ctx) {
    const hero = [safe(function () { return completionHtml(ctx); }), safe(function () { return distributionHtml(ctx); }), safe(function () { return plannedActualHtml(ctx); })].join('');
    const parts = [
      hero ? '<div class="cal-day-hero">' + hero + '</div>' : '',
      safe(function () { return subjectsHtml(ctx); }),
      safe(function () { return remindersEventsHtml(ctx); }),
      safe(function () { return highlightsHtml(ctx); }),
      safe(function () { return activityHtml(ctx); })
    ].filter(Boolean);
    return parts.length ? parts.join('') : '<p class="cal-day-quiet">Nothing scheduled or recorded for this day.</p>';
  }

  // ---------- shell ----------
  function build(d) {
    const today = todayStr();
    const hub = DateHub.get(d);
    const blocks = Calendar.blocksFor(d);
    const ctx = {
      date: d, isToday: d === today, isPast: d < today, isFuture: d > today,
      tasks: dayTasks(d), st: dayStats(d), subj: safe(function () { return subjectSplit(d); }) || [],
      blocks: blocks, alarms: dayAlarms(d), events: (hub.events || []).slice(), itin: itineraryCounts(d)
    };
    const dt = new Date(d + 'T00:00:00');
    const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const monthYear = dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const back = current && current.from === 'datehub' ? 'Date Hub' : 'Week';
    const tag = hub.important
      ? '<span class="cal-day-tag" title="' + esc(hub.label || 'Important date') + '" aria-label="' + esc(hub.label || 'Important date') + '">\u2605</span>' : '';
    const allDay = ctx.events.length
      ? '<div class="cal-day-allday"><span class="cal-day-allday-k">all day</span><div class="cal-day-allday-chips">' +
        ctx.events.map(function (e) { return '<div class="cal-wk-chip" title="' + esc(e) + '">' + esc(e) + '</div>'; }).join('') + '</div></div>' : '';
    return '<div class="cal-day-head">' +
        '<div class="cal-day-headmain">' +
          '<button type="button" id="cal-day-back" class="cal-day-back">\u2039 ' + back + '</button>' +
          '<h3 class="datehub-date" title="' + esc(weekday + ', ' + monthYear) + '">' +
            '<span class="datehub-day">' + dt.getDate() + '</span>' +
            '<span class="datehub-dow"><span class="datehub-weekday">' + weekday + (ctx.isToday ? ' \u00b7 today' : '') + '</span><span class="datehub-monthyear">' + monthYear + '</span></span>' +
          '</h3>' +
        '</div>' +
        '<div class="cal-day-corner">' + tag + '<button type="button" id="cal-day-close" class="cal-day-close" aria-label="Close">&times;</button></div>' +
      '</div>' +
      '<div class="cal-day-body">' +
        '<div class="cal-day-left">' + allDay + '<div class="cal-day-scroll">' + timelineHtml(d, blocks, ctx.isToday) + '</div></div>' +
        '<div class="cal-day-right">' + dashboardHtml(ctx) + '</div>' +
      '</div>';
  }

  function render(animate) {
    const root = document.getElementById('cal-day-root');
    if (!root || !current) return;
    const prev = root.querySelector('.cal-day-scroll');
    const keep = prev ? prev.scrollTop : null;
    const prevRight = root.querySelector('.cal-day-right');
    const keepRight = prevRight ? prevRight.scrollTop : 0;
    const d = current.date;
    root.innerHTML = build(d);
    root.classList.toggle('cal-day-anim', !!animate);

    const scroller = root.querySelector('.cal-day-scroll');
    if (scroller) {
      if (keep !== null) scroller.scrollTop = keep;
      else {
        let earliest = null;
        Calendar.blocksFor(d).forEach(function (it) { if (earliest === null || it.s < earliest) earliest = it.s; });
        const startMin = d === todayStr() ? Math.max(0, nowMin() - 90) : (earliest !== null ? Math.max(0, earliest - 60) : 7 * 60);
        scroller.scrollTop = startMin * HOUR_PX / 60;
      }
    }
    const right = root.querySelector('.cal-day-right');
    if (right) right.scrollTop = keepRight;

    const backBtn = document.getElementById('cal-day-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      const from = current ? current.from : 'week';
      const date = current ? current.date : d;
      stop();
      if (from === 'datehub' && typeof Calendar.openDateHub === 'function') Calendar.openDateHub(date);
      else Modal.close();
    });
    const closeBtn = document.getElementById('cal-day-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { stop(); Modal.close(); });

    nowLineMin = -1;
    current.sig = signature(d);
  }

  function updateNow(root) {
    const line = root.querySelector('.cal-day-now');
    if (!line) return;
    if (line.dataset.date !== todayStr()) { render(false); return; }
    const m = nowMin();
    if (m === nowLineMin) return;
    nowLineMin = m;
    line.style.top = (m * HOUR_PX / 60) + 'px';
  }

  // TimeEngine heartbeat subscriber. Unsubscribes itself the moment the Day Calendar is closed or replaced.
  function tick() {
    const root = document.getElementById('cal-day-root');
    const ov = document.getElementById('modal-overlay');
    if (!current || !root || !root.isConnected || !ov || ov.style.display === 'none' || ov.classList.contains('modal-closing')) { stop(); return; }
    if (signature(current.date) !== current.sig) { render(false); return; }
    updateNow(root);
  }

  function stop() {
    if (typeof TimeEngine !== 'undefined') TimeEngine.unsubscribe(SUB_ID);
    current = null;
  }

  function open(dateStr, from) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    Modal.open('<div class="cal-day" id="cal-day-root"></div>');
    if (!document.getElementById('cal-day-root')) return;
    current = { date: dateStr, from: from === 'datehub' ? 'datehub' : 'week', sig: '' };
    render(true);
    if (typeof TimeEngine !== 'undefined') TimeEngine.subscribe(tick, SUB_ID);
  }

  return { open: open, close: function () { stop(); Modal.close(); } };
})();
