// ptpe-ui.js — PTPE presentation: one flexible chart engine (PTPEChart) + the Progress screen (PTPEView:
// quiet overview + "Explore"). Draws ONLY what PTPE returns; no calculations of its own.
// Depends on: PTPE, ProgressData, Streak, State, TimeEngine.
const PTPEChart = (function () {
  const PAD = { l: 40, r: 14, t: 16, b: 30 };

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const steps = [1, 2, 3, 4, 5, 6, 8, 10];
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (let i = 0; i < steps.length; i++) if (steps[i] * pow >= v) return steps[i] * pow;
    return 10 * pow;
  }
  function tick(v) { return Math.abs(v) >= 10 || v % 1 === 0 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); }

  // Fritsch–Carlson monotone cubic: smooth without overshooting the data.
  function smooth(pts) {
    const n = pts.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; m[i] = (pts[i + 1].y - pts[i].y) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += 'C' + (pts[i].x + h).toFixed(1) + ',' + (pts[i].y + t[i] * h).toFixed(1) + ' ' +
        (pts[i + 1].x - h).toFixed(1) + ',' + (pts[i + 1].y - t[i + 1] * h).toFixed(1) + ' ' +
        pts[i + 1].x.toFixed(1) + ',' + pts[i + 1].y.toFixed(1);
    }
    return d;
  }

  // series: PTPE.series(...) result. opts: { type: 'line'|'bar', color, animate }
  function render(host, s, opts) {
    opts = opts || {};
    const type = opts.type === 'bar' ? 'bar' : 'line', color = opts.color || '';
    // Size the drawing to the real container so text stays a constant readable size and the chart grows with the screen.
    const hw = host.clientWidth || 0;
    const W = hw >= 280 ? Math.round(hw) : 640;
    const H = hw >= 280 ? Math.round(Math.max(230, Math.min(W * 0.36, 360))) : 240;
    const vals = s.values, n = vals.length, real = vals.filter(function (v) { return v !== null && v !== undefined; });
    if (!s.hasData || !n) {
      host.innerHTML = '<div class="ptpe-chart-empty">Nothing recorded for this range yet.</div>';
      return;
    }
    const top = s.max || niceMax(Math.max.apply(null, real));
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, band = iw / n;
    const X = function (i) { return PAD.l + band * (i + 0.5); };
    const Y = function (v) { return PAD.t + ih - Math.max(0, Math.min(1, v / top)) * ih; };

    let g = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      if (f > 0) g += '<line class="ptpe-grid" x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + Y(top * f) + '" y2="' + Y(top * f) + '"/>';
      g += '<text class="ptpe-ax" x="' + (PAD.l - 8) + '" y="' + (Y(top * f) + 4) + '" text-anchor="end">' + tick(top * f) + '</text>';
    });
    g += '<line class="ptpe-base" x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>';
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
    for (let i = 0; i < n; i += step) {
      if (!s.labels[i]) continue;
      g += '<text class="ptpe-ax" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(s.labels[i]) + '</text>';
    }

    if (type === 'bar') {
      const bw = Math.max(3, Math.min(band * 0.6, 44));
      vals.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        const y = Y(v), h = Math.max(v > 0 ? 2 : 0, Y(0) - y);
        g += '<rect class="ptpe-bar" data-i="' + i + '" style="--i:' + i + '" x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + (Y(0) - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>';
      });
    } else {
      let seg = [], pts = '';
      const segs = [];
      vals.forEach(function (v, i) {
        if (v === null || v === undefined) { if (seg.length) segs.push(seg); seg = []; return; }
        seg.push({ x: X(i), y: Y(v) });
      });
      if (seg.length) segs.push(seg);
      segs.forEach(function (p) {
        if (n <= 40) p.forEach(function (q) { pts += '<circle class="ptpe-pt" cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="2.4"/>'; });
        if (p.length === 1) { g += '<circle class="ptpe-dot" cx="' + p[0].x.toFixed(1) + '" cy="' + p[0].y.toFixed(1) + '" r="2.6"/>'; return; }
        const d = smooth(p);
        g += '<path class="ptpe-area" d="' + d + 'L' + p[p.length - 1].x.toFixed(1) + ',' + Y(0) + 'L' + p[0].x.toFixed(1) + ',' + Y(0) + 'Z"/>';
        g += '<path class="ptpe-path" pathLength="1" d="' + d + '"/>';
      });
      g += pts;
      const lastI = (function () { for (let i = n - 1; i >= 0; i--) if (vals[i] !== null && vals[i] !== undefined) return i; return -1; })();
      if (lastI >= 0) g += '<circle class="ptpe-dot ptpe-dot-end" cx="' + X(lastI).toFixed(1) + '" cy="' + Y(vals[lastI]).toFixed(1) + '" r="3"/>';
    }
    g += '<g class="ptpe-focus" style="display:none"><line class="ptpe-cross" y1="' + PAD.t + '" y2="' + Y(0) + '"/><circle class="ptpe-dot" r="3.4"/></g>';

    host.innerHTML = '<div class="ptpe-chart ptpe-' + type + (opts.animate === false ? ' ptpe-still' : '') + '"' + (color ? ' style="--ptpe-c:' + esc(color) + '"' : '') + '>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(s.label) + ' chart" preserveAspectRatio="xMidYMid meet">' + g + '</svg>' +
      '<div class="ptpe-tip" hidden></div></div>';

    const wrap = host.firstChild, svg = wrap.querySelector('svg'), tip = wrap.querySelector('.ptpe-tip'), focus = wrap.querySelector('.ptpe-focus');
    function show(i) {
      const v = vals[i];
      if (v === null || v === undefined) { hide(); return; }
      const x = X(i), y = Y(v);
      if (type === 'line') {
        focus.style.display = '';
        focus.querySelector('.ptpe-cross').setAttribute('x1', x); focus.querySelector('.ptpe-cross').setAttribute('x2', x);
        const c = focus.querySelector('circle'); c.setAttribute('cx', x); c.setAttribute('cy', y);
      }
      wrap.querySelectorAll('.ptpe-bar').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.i) === i); });
      const when = s.tips && s.tips[i] ? s.tips[i] : (s.bucket > 1 ? 'Week of ' + (s.labels[i] || '') : (PTPEView.longDay(s.dates[i])));
      tip.innerHTML = '<span>' + esc(when) + '</span>' + esc(s.format ? s.format(v) : v);
      tip.hidden = false;
      const pct = x / W * 100;
      tip.style.left = Math.max(14, Math.min(86, pct)) + '%';
      tip.style.top = Math.max(0, (y / H * 100) - 14) + '%';
    }
    function hide() {
      tip.hidden = true; focus.style.display = 'none';
      wrap.querySelectorAll('.ptpe-bar.on').forEach(function (b) { b.classList.remove('on'); });
    }
    function at(e) {
      const r = svg.getBoundingClientRect(); if (!r.width) return;
      const x = (e.clientX - r.left) / r.width * W;
      show(Math.max(0, Math.min(n - 1, Math.floor((x - PAD.l) / band))));
    }
    svg.addEventListener('pointermove', at);
    svg.addEventListener('pointerdown', at);
    svg.addEventListener('pointerleave', hide);
  }
  return { render: render };
})();

const PTPEView = (function () {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TREND_WORDS = { improving: 'Improving \u2197', declining: 'Declining \u2198', stable: 'Stable', recovering: 'Recovering \u2197' };
  const SUBSCRIBER_ID = 'progress';
  const VIEWS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
  const UNIT = { daily: 'day', weekly: 'week', monthly: 'month' };
  const AUTO_TYPE = { daily: 'line', weekly: 'bar', monthly: 'bar' };
  const DAILY_SPAN = 30, WEEKLY_SPAN = 12, MONTHLY_SPAN = 12, CHUNK = 28;

  let view = 'overview', pendingExplorer = false, lastRender = 0, lastRef = null, lastWidth = 0;
  // Main graph: Daily / Weekly / Monthly + metric + dimension. type:null = automatic (line for daily, bars for weekly/monthly).
  let ov = { view: 'daily', metric: 'studyHours', dim: 'overall', id: null, type: null };
  let ex = { dim: 'overall', id: null, metric: 'studyHours', range: 'month', type: 'line', from: '', to: '' };

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function root() { return document.getElementById('screen-progress'); }
  function longDay(d) { const x = new Date(d + 'T00:00:00'); return DAYS[x.getDay()] + ' ' + MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function shortDate(d) { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function signed(p) { return (p > 0 ? '+' : p < 0 ? '\u2212' : '') + Math.abs(p) + '%'; }
  function dimObj(o) { o = o || ex; return o.dim === 'overall' ? { type: 'overall' } : { type: o.dim, id: o.id }; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- Week / month grouping (Monday is day 1; reuses PTPE.shift / PTPE.today) ----------
  function weekdayIdx(d) { return (new Date(d + 'T00:00:00').getDay() + 6) % 7; } // Mon=0 \u2026 Sun=6
  function mondayOf(d) { return PTPE.shift(d, -weekdayIdx(d)); }
  function monthStart(d, back) { const x = new Date(d + 'T00:00:00'); const m = new Date(x.getFullYear(), x.getMonth() - (back || 0), 1); return m.getFullYear() + '-' + pad2(m.getMonth() + 1) + '-01'; }
  function span(from, to) {
    const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00'), y = a.getFullYear() !== b.getFullYear();
    return shortDate(from) + (y ? ' ' + a.getFullYear() : '') + ' \u2013 ' + shortDate(to) + ' ' + b.getFullYear();
  }

  // Pull PTPE's own daily values in <=28-day windows (always daily resolution) \u2192 { map: date\u2192value, ref: a series for metadata }.
  function dailyValues(metric, dim, from, to) {
    const map = {}; let ref = null, a = from;
    while (a <= to) {
      const b = PTPE.shift(a, CHUNK - 1) < to ? PTPE.shift(a, CHUNK - 1) : to;
      const s = PTPE.series(metric, dim, 'custom', { from: a, to: b });
      if (!ref || (s.hasData && !ref.hasData)) ref = s;
      (s.dates || []).forEach(function (d, i) { const v = s.values[i]; if (v !== null && v !== undefined) map[d] = v; });
      a = PTPE.shift(b, 1);
    }
    return { map: map, ref: ref || {} };
  }

  // Group PTPE's daily values into Monday\u2192Sunday weeks or calendar months. Sum metrics add up; others average the days that have data.
  function grouped(metric, dim, from, to, mode) {
    const dv = dailyValues(metric, dim, from, to), ref = dv.ref, isSum = ref.kind === 'sum', today = PTPE.today();
    const order = [], acc = {};
    for (let d = from; d <= to; d = PTPE.shift(d, 1)) {
      const k = mode === 'weekly' ? mondayOf(d) : d.slice(0, 7) + '-01';
      if (!acc[k]) { acc[k] = { sum: 0, cnt: 0 }; order.push(k); }
      if (dv.map[d] !== undefined) { acc[k].sum += dv.map[d]; acc[k].cnt++; }
    }
    const values = order.map(function (k) { const a = acc[k]; return a.cnt ? (isSum ? a.sum : a.sum / a.cnt) : null; });
    const labels = order.map(function (k) { return mode === 'weekly' ? shortDate(k) : MONTHS[Number(k.slice(5, 7)) - 1]; });
    const tips = order.map(function (k) {
      if (mode === 'weekly') return 'Week of ' + shortDate(k) + ' (Mon\u2013Sun)' + (PTPE.shift(k, 6) > today ? ' \u00b7 so far' : '');
      return MONTHS[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4) + (k.slice(0, 7) === today.slice(0, 7) ? ' \u00b7 so far' : '');
    });
    const real = values.filter(function (v) { return v !== null; });
    const total = real.reduce(function (a, b) { return a + b; }, 0);
    return {
      label: ref.label, kind: ref.kind, max: ref.max, format: ref.format || String, bucket: mode === 'weekly' ? 7 : 30,
      values: values, labels: labels, dates: order, tips: tips, hasData: real.length > 0,
      total: total, average: real.length ? total / real.length : 0
    };
  }

  // The series behind the main graph for the chosen Daily / Weekly / Monthly view.
  function mainSeries() {
    const today = PTPE.today(), dim = dimObj(ov);
    if (ov.view === 'weekly') { const from = PTPE.shift(mondayOf(today), -7 * (WEEKLY_SPAN - 1)); return { s: grouped(ov.metric, dim, from, today, 'weekly'), from: from, to: today }; }
    if (ov.view === 'monthly') { const from = monthStart(today, MONTHLY_SPAN - 1); return { s: grouped(ov.metric, dim, from, today, 'monthly'), from: from, to: today }; }
    const from = PTPE.shift(today, -(DAILY_SPAN - 1));
    return { s: PTPE.series(ov.metric, dim, 'custom', { from: from, to: today }), from: from, to: today };
  }

  // Monday-based week-to-date total vs the same days of last week.
  function weekToDate(metric) {
    const today = PTPE.today(), mon = mondayOf(today), el = weekdayIdx(today), prevMon = PTPE.shift(mon, -7);
    const cur = PTPE.series(metric, null, 'custom', { from: mon, to: today });
    const prev = PTPE.series(metric, null, 'custom', { from: prevMon, to: PTPE.shift(prevMon, el) });
    return { cur: cur.total || 0, prev: prev.total || 0, series: cur };
  }

  function dimItem(o) { return o.dim === 'overall' ? null : PTPE.dimensionItems(o.dim).filter(function (i) { return i.id === o.id; })[0]; }

  // ---------- Overview ----------
  function sel(id, options, value) {
    return '<select id="' + id + '" class="ptpe-sel">' + options.map(function (o) { return '<option value="' + esc(o.id) + '"' + (String(o.id) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
  }
  function fixSelection(o) {
    o = o || ex;
    if (o.dim !== 'overall') {
      const items = PTPE.dimensionItems(o.dim);
      if (!items.some(function (i) { return i.id === o.id; })) o.id = items.length ? items[0].id : null;
    } else o.id = null;
    const ms = PTPE.metricsFor(dimObj(o));
    if (!ms.some(function (m) { return m.key === o.metric; })) o.metric = ms[0].key;
  }

  function statsHtml() {
    const today = PTPE.today();
    const prod = PTPE.value('productivity', today);
    const cons = PTPE.consistency();
    const trendRes = PTPE.trend('productivity') || PTPE.trend('studyHours');
    const why = prod === null ? [] : PTPE.whyProductivity(today);
    const prodSub = why.length ? why.map(function (w) { return w.label + (w.up ? ' up' : ' down'); }).join(' \u00b7 ') + ' vs yesterday' : (trendRes ? TREND_WORDS[trendRes.state] : '');
    const st = weekToDate('studyHours'), qs = weekToDate('questions');
    const vs = function (w) { return w.prev > 0 ? signed(Math.round((w.cur - w.prev) / w.prev * 100)) + ' vs last week so far' : 'Mon \u2192 Sun week'; };
    const stat = function (label, big, small, sub) {
      return '<div class="ptpe-stat"><div class="ptpe-k">' + label + '</div><div class="ptpe-v">' + big + (small ? '<small>' + small + '</small>' : '') + '</div><div class="ptpe-sub">' + (sub || '&nbsp;') + '</div></div>';
    };
    return '<div class="ptpe-stats ptpe-panel">' +
      stat('Productivity today', prod === null ? '\u2013' : prod.toFixed(1), prod === null ? '' : ' / 10', esc(prodSub)) +
      stat('Study this week', PTPE.fmtHours(st.cur), '', vs(st)) +
      stat('Questions this week', qs.series.format ? esc(qs.series.format(qs.cur)) : qs.cur, '', vs(qs)) +
      stat('Consistency', cons ? cons.score : '\u2013', '', cons ? esc(cons.label) : 'Needs a few more days') +
    '</div>';
  }

  function overviewHtml() {
    const wk = PTPE.whatChanged();
    const compare = wk.length ? '<div class="ptpe-cmp">' + wk.map(function (c) { return '<span class="ptpe-chg ' + (c.pct > 0 ? 'up' : c.pct < 0 ? 'down' : '') + '"><em>' + esc(c.label) + '</em> ' + signed(c.pct) + '</span>'; }).join('') + '</div>' : '<p class="ptpe-hint">Not enough recent data to compare yet.</p>';

    const o = ProgressData.getOtherStats();
    const rows = [['Best study streak', o.bestStudyStreak + (o.bestStudyStreak === 1 ? ' day' : ' days')], ['Total study', PTPE.fmtHours(o.totalStudyHours)], ['Questions solved', o.totalQuestionsSolved], ['Tasks completed', o.totalTasks], ['Revision cycles', o.totalCompletedRevisionCycles]];
    const allTime = rows.map(function (r) { return '<div class="ptpe-line"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');

    const notes = [];
    PTPE.personalBests().slice(0, 3).forEach(function (b) { notes.push(esc(b.label) + ' \u00b7 <b>' + esc(b.value) + '</b>' + (b.date ? ' <span>' + shortDate(b.date) + '</span>' : '')); });
    PTPE.anomalies().slice(0, 2).forEach(function (a) { notes.push(esc(a.text)); });
    const hi = notes.length ? notes.map(function (t) { return '<div class="ptpe-note">' + t + '</div>'; }).join('') : '<p class="ptpe-hint">Highlights show up as you log more days.</p>';

    return '<div class="ptpe ptpe-wide">' +
      '<header class="ptpe-top ptpe-panel"><div><h2 class="ptpe-title">Progress</h2><div class="ptpe-period" id="ptpe-period"></div></div>' +
      '<button type="button" class="ptpe-explore" id="ptpe-explore">Explore <span aria-hidden="true">\u203a</span></button></header>' +
      statsHtml() +
      '<section class="ptpe-graph ptpe-panel" id="ptpe-graph"></section>' +
      '<div class="ptpe-cols">' +
        '<section class="ptpe-panel ptpe-sec"><div class="ptpe-h" id="ptpe-glance-h">At a glance</div><div class="ptpe-glance" id="ptpe-glance"></div></section>' +
        '<section class="ptpe-panel ptpe-sec"><div class="ptpe-h">All time</div>' + allTime + '</section>' +
      '</div>' +
      '<section class="ptpe-panel ptpe-sec"><div class="ptpe-h">Insights</div><div class="ptpe-cols ptpe-cols-in">' +
        '<div><div class="ptpe-h2">This week vs last</div>' + compare + '</div><div><div class="ptpe-h2">Highlights</div>' + hi + '</div></div></section>' +
      '<button type="button" class="ptpe-more-link ptpe-panel" id="ptpe-explore-2"><span><b>Explore</b> custom ranges, subjects, tags, habits and planned vs actual</span><i aria-hidden="true">\u203a</i></button>' +
    '</div>';
  }

  function graphControlsHtml() {
    fixSelection(ov);
    const dimOpts = [{ id: 'overall', label: 'Overall' }, { id: 'subject', label: 'Subject' }, { id: 'tag', label: 'Tag' }, { id: 'habit', label: 'Habit' }];
    const items = ov.dim === 'overall' ? [] : PTPE.dimensionItems(ov.dim);
    const metricOpts = PTPE.metricsFor(dimObj(ov)).map(function (m) { return { id: m.key, label: m.label }; });
    const type = ov.type || AUTO_TYPE[ov.view];
    const seg = function (list, attr, cur) { return '<div class="ptpe-seg">' + list.map(function (v) { return '<button type="button" class="ptpe-tab' + (v[0] === cur ? ' on' : '') + '" data-' + attr + '="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>'; };
    const itemSel = ov.dim === 'overall' ? '' : (items.length ? '<label><span>' + (ov.dim === 'tag' ? 'Tag' : ov.dim === 'habit' ? 'Habit' : 'Subject') + '</span>' + sel('ptpe-ov-item', items, ov.id) + '</label>' : '<span class="ptpe-hint">' + (ov.dim === 'tag' ? 'No tags yet \u2014 add some in Library.' : ov.dim === 'habit' ? 'No habits yet.' : 'No subjects yet.') + '</span>');
    return '<div class="ptpe-row ptpe-gc">' + seg(VIEWS, 'v', ov.view) + seg([['line', 'Line'], ['bar', 'Bar']], 't', type) + '</div>' +
      '<div class="ptpe-ctl"><label><span>Show</span>' + sel('ptpe-ov-metric', metricOpts, ov.metric) + '</label><label><span>By</span>' + sel('ptpe-ov-dim', dimOpts, ov.dim) + '</label>' + itemSel + '</div>';
  }

  function summaryItems(s, unit) {
    const out = [];
    if (!s.hasData) return out;
    const real = []; s.values.forEach(function (v, i) { if (v !== null && v !== undefined) real.push([v, i]); });
    const best = real.reduce(function (a, b) { return b[0] > a[0] ? b : a; }, real[0]);
    if (s.kind === 'sum') { out.push(['Total', s.format(s.total)]); out.push(['Average / ' + unit, s.format(s.average)]); }
    else out.push(['Average', s.format(s.average)]);
    out.push(['Best ' + unit, s.format(best[0]) + ' <em>' + esc(s.labels[best[1]] || '') + '</em>']);
    return out;
  }

  function drawGraph(animate) {
    const r = root(), host = r && r.querySelector('#ptpe-graph'); if (!host) return;
    host.innerHTML = '<div class="ptpe-gh"><div><div class="ptpe-gt" id="ptpe-gt"></div><div class="ptpe-gs" id="ptpe-gs"></div></div></div>' + graphControlsHtml() +
      '<div id="ptpe-ov-chart" class="ptpe-chart-host"></div><div class="ptpe-gsum" id="ptpe-gsum"></div>';
    const on = function (id, fn) { const el = host.querySelector('#' + id); if (el) el.addEventListener('change', fn); };
    on('ptpe-ov-metric', function (e) { ov.metric = e.target.value; refreshGraph(true); });
    on('ptpe-ov-dim', function (e) { ov.dim = e.target.value; ov.id = null; refreshGraph(true); });
    on('ptpe-ov-item', function (e) { ov.id = e.target.value; refreshGraph(true); });
    host.querySelectorAll('.ptpe-tab[data-v]').forEach(function (b) { b.addEventListener('click', function () { ov.view = b.dataset.v; refreshGraph(true); }); });
    host.querySelectorAll('.ptpe-tab[data-t]').forEach(function (b) { b.addEventListener('click', function () { ov.type = b.dataset.t; refreshGraph(true); }); });

    const chartHost = host.querySelector('#ptpe-ov-chart');
    if (ov.dim !== 'overall' && !ov.id) { chartHost.innerHTML = '<div class="ptpe-chart-empty">Nothing to show yet.</div>'; return; }
    const m = mainSeries(), s = m.s, item = dimItem(ov);
    const metricLabel = (PTPE.metricsFor(dimObj(ov)).filter(function (x) { return x.key === ov.metric; })[0] || {}).label || '';
    host.querySelector('#ptpe-gt').textContent = metricLabel + (item ? ' \u00b7 ' + item.label : '');
    const per = span(m.from, m.to);
    host.querySelector('#ptpe-gs').textContent = VIEWS.filter(function (v) { return v[0] === ov.view; })[0][1] + ' \u00b7 ' + per + (ov.view === 'weekly' ? ' \u00b7 weeks run Mon\u2013Sun' : '');
    const pe = r.querySelector('#ptpe-period'); if (pe) pe.textContent = per;
    PTPEChart.render(chartHost, s, { type: ov.type || AUTO_TYPE[ov.view], animate: animate, color: item && item.color && ov.dim === 'tag' ? item.color : '' });
    const items = summaryItems(s, UNIT[ov.view]);
    const t = s.hasData ? PTPE.trend(ov.metric, dimObj(ov)) : null;
    if (t) items.push(['Trend', TREND_WORDS[t.state]]);
    host.querySelector('#ptpe-gsum').innerHTML = items.map(function (i) { return '<div><span>' + esc(i[0]) + '</span><b>' + i[1] + '</b></div>'; }).join('');
  }

  // Compact list of every metric for the chosen dimension over the last 30 days (PTPE's own totals / averages).
  function drawGlance() {
    const r = root(), host = r && r.querySelector('#ptpe-glance'); if (!host) return;
    const dim = dimObj(ov), item = dimItem(ov);
    if (ov.dim !== 'overall' && !ov.id) { host.innerHTML = ''; return; }
    const h = r.querySelector('#ptpe-glance-h'); if (h) h.textContent = 'At a glance \u00b7 last 30 days' + (item ? ' \u00b7 ' + item.label : '');
    host.innerHTML = PTPE.metricsFor(dim).map(function (m) {
      const s = PTPE.series(m.key, dim, 'month');
      const v = !s.hasData ? '\u2013' : (s.kind === 'sum' ? s.format(s.total) : s.format(s.average) + ' <em>avg</em>');
      return '<div class="ptpe-line"><span>' + esc(m.label) + '</span><b>' + v + '</b></div>';
    }).join('');
  }

  function refreshGraph(animate) { drawGraph(animate); drawGlance(); }

  function renderOverview(animate) {
    const r = root(); r.innerHTML = overviewHtml();
    refreshGraph(animate);
    const go = function () { view = 'explore'; render(); };
    r.querySelector('#ptpe-explore').addEventListener('click', go);
    r.querySelector('#ptpe-explore-2').addEventListener('click', go);
  }

  // ---------- Explorer ----------
  function explorerShell() {
    return '<div class="ptpe ptpe-wide ptpe-ex"><div class="ptpe-top ptpe-panel"><button type="button" class="ptpe-back" id="ptpe-back">\u2039 Progress</button><h2 class="ptpe-title">Explore</h2></div>' +
      '<section class="ptpe-panel ptpe-sec"><div id="ptpe-ex-controls"></div><div id="ptpe-ex-chart" class="ptpe-chart-host"></div><div id="ptpe-ex-summary" class="ptpe-summary"></div></section>' +
      '<section class="ptpe-panel ptpe-sec ptpe-more-list">' +
        [['pva', 'Planned vs actual'], ['records', 'Records & totals'], ['patterns', 'Patterns'], ['notable', 'Notable']].map(function (p) {
          return '<details class="ptpe-more" data-sec="' + p[0] + '"><summary>' + p[1] + '</summary><div class="ptpe-more-body"></div></details>';
        }).join('') + '</section></div>';
  }

  function controlsHtml() {
    const dimOpts = [{ id: 'overall', label: 'Overall' }, { id: 'subject', label: 'Subject' }, { id: 'tag', label: 'Tag' }, { id: 'habit', label: 'Habit' }];
    const items = ex.dim === 'overall' ? [] : PTPE.dimensionItems(ex.dim);
    const metricOpts = PTPE.metricsFor(dimObj()).map(function (m) { return { id: m.key, label: m.label }; });
    const ranges = Object.keys(PTPE.RANGES).map(function (k) { return '<button type="button" class="ptpe-tab' + (k === ex.range ? ' on' : '') + '" data-r="' + k + '">' + PTPE.RANGES[k] + '</button>'; }).join('');
    const types = [['line', 'Line'], ['bar', 'Bar']].map(function (t) { return '<button type="button" class="ptpe-tab' + (t[0] === ex.type ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('');
    const itemSel = ex.dim === 'overall' ? '' : (items.length ? sel('ptpe-item', items, ex.id) : '<span class="ptpe-hint">' + (ex.dim === 'tag' ? 'No tags yet \u2014 add some in Library.' : ex.dim === 'habit' ? 'No habits yet.' : 'No subjects yet.') + '</span>');
    const custom = ex.range === 'custom' ? '<div class="ptpe-custom"><input type="date" id="ptpe-from" value="' + esc(ex.from) + '"><span>to</span><input type="date" id="ptpe-to" value="' + esc(ex.to) + '"></div>' : '';
    return '<div class="ptpe-row ptpe-gc"><div class="ptpe-seg">' + ranges + '</div><div class="ptpe-seg">' + types + '</div></div>' + custom +
      '<div class="ptpe-ctl"><label><span>Show</span>' + sel('ptpe-metric', metricOpts, ex.metric) + '</label>' +
      '<label><span>By</span>' + sel('ptpe-dim', dimOpts, ex.dim) + '</label>' + (itemSel ? '<label><span>&nbsp;</span>' + itemSel + '</label>' : '') + '</div>';
  }

  // Long Explorer ranges are bucketed by PTPE; regroup those into Monday\u2192Sunday weeks so every weekly graph agrees.
  function mondayWeeks(s, dim) {
    if (!(s.bucket > 1) || !s.dates || !s.dates.length) return s;
    const today = PTPE.today(), from = mondayOf(s.dates[0]), to = ex.range === 'custom' && ex.to ? ex.to : today;
    if (to < from || (new Date(to) - new Date(from)) / 864e5 > 800) return s;
    const g = grouped(ex.metric, dim, from, to, 'weekly');
    return g.hasData ? g : s;
  }

  function drawExplorer(animate) {
    fixSelection(ex);
    const r = root();
    r.querySelector('#ptpe-ex-controls').innerHTML = controlsHtml();
    wireControls(r);
    const dim = dimObj(), chartHost = r.querySelector('#ptpe-ex-chart'), sum = r.querySelector('#ptpe-ex-summary');
    if (ex.dim !== 'overall' && !ex.id) { chartHost.innerHTML = '<div class="ptpe-chart-empty">Nothing to show yet.</div>'; sum.innerHTML = ''; return; }
    const s = PTPE.series(ex.metric, dim, ex.range, { from: ex.from, to: ex.to });
    const item = dimItem(ex);
    PTPEChart.render(chartHost, mondayWeeks(s, dim), { type: ex.type, animate: animate, color: item && item.color && ex.dim === 'tag' ? item.color : '' });
    const bits = [];
    if (s.hasData) {
      if (s.kind === 'sum') { bits.push('Total ' + s.format(s.total)); bits.push('Avg ' + s.format(s.average) + ' / day'); }
      else bits.push('Average ' + s.format(s.average));
      const t = PTPE.trend(ex.metric, dim); if (t) bits.push(TREND_WORDS[t.state]);
    }
    sum.innerHTML = bits.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('');
    r.querySelectorAll('.ptpe-more[open]').forEach(function (d) { fillMore(d, true); });
  }

  function wireControls(r) {
    const on = function (id, fn) { const el = r.querySelector('#' + id); if (el) el.addEventListener('change', fn); };
    on('ptpe-metric', function (e) { ex.metric = e.target.value; drawExplorer(true); });
    on('ptpe-dim', function (e) { ex.dim = e.target.value; ex.id = null; drawExplorer(true); });
    on('ptpe-item', function (e) { ex.id = e.target.value; drawExplorer(true); });
    on('ptpe-from', function (e) { ex.from = e.target.value; drawExplorer(true); });
    on('ptpe-to', function (e) { ex.to = e.target.value; drawExplorer(true); });
    r.querySelectorAll('#ptpe-ex-controls .ptpe-tab[data-r]').forEach(function (b) {
      b.addEventListener('click', function () {
        ex.range = b.dataset.r;
        if (ex.range === 'custom' && (!ex.from || !ex.to)) { ex.to = PTPE.today(); ex.from = PTPE.shift(ex.to, -29); }
        drawExplorer(true);
      });
    });
    r.querySelectorAll('#ptpe-ex-controls .ptpe-tab[data-t]').forEach(function (b) { b.addEventListener('click', function () { ex.type = b.dataset.t; drawExplorer(true); }); });
  }

  function fillMore(d, force) {
    const body = d.querySelector('.ptpe-more-body');
    if (body.dataset.filled && !force) return;
    body.dataset.filled = '1';
    const key = d.dataset.sec, line = function (a, b) { return '<div class="ptpe-line"><span>' + a + '</span><b>' + b + '</b></div>'; };
    let html = '';
    if (key === 'pva') {
      const p = PTPE.plannedVsActual(ex.range, { from: ex.from, to: ex.to });
      if (!p) html = '<p class="ptpe-hint">Add start and stop times to planner tasks to compare planned and actual study.</p>';
      else {
        const diff = p.avgDiffMin;
        html = line('Planned', PTPE.fmtHours(p.plannedMin / 60)) + line('Actual', PTPE.fmtHours(p.actualMin / 60)) + line('Planned work completed', p.completionPct + '%') +
          line('Average per planned day', (diff === 0 ? 'on plan' : PTPE.fmtHours(Math.abs(diff) / 60) + (diff < 0 ? ' under' : ' over'))) +
          (p.bias === 'under' ? '<p class="ptpe-hint">You regularly study more than you plan.</p>' : p.bias === 'over' ? '<p class="ptpe-hint">You regularly plan more than you get to.</p>' : '');
      }
    } else if (key === 'records') {
      const o = ProgressData.getOtherStats(), pb = PTPE.personalBests();
      html = pb.map(function (b) { return line(esc(b.label) + (b.date ? ' <em>' + shortDate(b.date) + '</em>' : ''), esc(b.value)); }).join('') +
        line('Total study', PTPE.fmtHours(o.totalStudyHours)) + line('Total questions', o.totalQuestionsSolved) + line('Tasks completed', o.totalTasks) + line('Revision cycles completed', o.totalCompletedRevisionCycles);
    } else if (key === 'patterns') {
      const c = PTPE.correlations();
      html = c.length ? c.map(function (x) { return '<div class="ptpe-note">' + esc(x.text) + ' <span>' + x.n + ' days</span></div>'; }).join('') + '<p class="ptpe-hint">Patterns, not causes.</p>' : '<p class="ptpe-hint">Not enough history yet for reliable patterns.</p>';
    } else if (key === 'notable') {
      const a = PTPE.anomalies();
      html = a.length ? a.map(function (x) { return '<div class="ptpe-note">' + esc(x.text) + '</div>'; }).join('') : '<p class="ptpe-hint">Nothing unusual lately.</p>';
    }
    body.innerHTML = html;
  }

  function renderExplorer(animate) {
    const r = root(); r.innerHTML = explorerShell();
    r.querySelector('#ptpe-back').addEventListener('click', function () { view = 'overview'; render(); });
    r.querySelectorAll('.ptpe-more').forEach(function (d) { d.addEventListener('toggle', function () { if (d.open) fillMore(d, false); }); });
    drawExplorer(animate);
  }

  // ---------- public ----------
  function render(opts) {
    const r = root(); if (!r) return;
    const animate = !(opts && opts.animate === false);
    if (view === 'explore') renderExplorer(animate); else renderOverview(animate);
    lastRender = Date.now(); lastRef = State.get(); lastWidth = r.offsetWidth;
  }
  // Called by Nav every time Progress is entered: always lands on the overview unless a deep link asked otherwise.
  function enter() { if (pendingExplorer) pendingExplorer = false; else view = 'overview'; render(); }
  function openExplorer(sel) {
    sel = sel || {};
    if (sel.dim) { ex.dim = sel.dim; ex.id = sel.id || null; }
    if (sel.metric) ex.metric = sel.metric;
    view = 'explore'; pendingExplorer = true; render();
  }
  // Quiet live refresh of the overview only (no animation replay, throttled, never while the Explorer is open).
  function tick() {
    if (view !== 'overview') return;
    const r = root(); if (!r || r.style.display === 'none' || !r.firstChild) return;
    if (State.get() === lastRef || Date.now() - lastRender < 15000) return;
    render({ animate: false });
  }
  // Charts are sized to their container, so redraw (without animation) when the width really changes.
  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      const r = root(); if (!r || !r.firstChild || !r.offsetWidth || Math.abs(r.offsetWidth - lastWidth) < 24) return;
      lastWidth = r.offsetWidth;
      if (view === 'explore') drawExplorer(false); else drawGraph(false);
    }, 160);
  }
  function init() {
    render();
    window.addEventListener('resize', onResize);
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) TimeEngine.subscribe(tick, SUBSCRIBER_ID); // stable id: replaces, never stacks
  }
  return { init: init, render: enter, openExplorer: openExplorer, longDay: longDay };
})();
