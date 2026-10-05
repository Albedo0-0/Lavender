// ptpe-ui.js — PTPE presentation: one flexible chart engine (PTPEChart) + the Progress screen (PTPEView:
// quiet overview + "Explore"). Draws ONLY what PTPE returns; no calculations of its own.
// Depends on: PTPE, ProgressData, Streak, State, TimeEngine.
const PTPEChart = (function () {
  const W = 640, H = 240, PAD = { l: 36, r: 12, t: 14, b: 28 };

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
    [0, 0.5, 1].forEach(function (f) {
      g += '<text class="ptpe-ax" x="' + (PAD.l - 8) + '" y="' + (Y(top * f) + 3.5) + '" text-anchor="end">' + tick(top * f) + '</text>';
    });
    g += '<line class="ptpe-base" x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>';
    const step = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += step) {
      if (!s.labels[i]) continue;
      g += '<text class="ptpe-ax" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(s.labels[i]) + '</text>';
    }

    if (type === 'bar') {
      const bw = Math.max(3, Math.min(band * 0.58, 30));
      vals.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        const y = Y(v), h = Math.max(v > 0 ? 2 : 0, Y(0) - y);
        g += '<rect class="ptpe-bar" data-i="' + i + '" style="--i:' + i + '" x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + (Y(0) - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>';
      });
    } else {
      let seg = [];
      const segs = [];
      vals.forEach(function (v, i) {
        if (v === null || v === undefined) { if (seg.length) segs.push(seg); seg = []; return; }
        seg.push({ x: X(i), y: Y(v) });
      });
      if (seg.length) segs.push(seg);
      segs.forEach(function (p) {
        if (p.length === 1) { g += '<circle class="ptpe-dot" cx="' + p[0].x.toFixed(1) + '" cy="' + p[0].y.toFixed(1) + '" r="2.6"/>'; return; }
        const d = smooth(p);
        g += '<path class="ptpe-area" d="' + d + 'L' + p[p.length - 1].x.toFixed(1) + ',' + Y(0) + 'L' + p[0].x.toFixed(1) + ',' + Y(0) + 'Z"/>';
        g += '<path class="ptpe-path" pathLength="1" d="' + d + '"/>';
      });
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
      const when = s.bucket > 1 ? 'Week of ' + (s.labels[i] || '') : (PTPEView.longDay(s.dates[i]));
      tip.innerHTML = '<span>' + esc(when) + '</span>' + esc(s.format ? s.format(v) : v);
      tip.hidden = false;
      const pct = x / W * 100;
      tip.style.left = Math.max(12, Math.min(88, pct)) + '%';
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
  const OVERVIEW_METRICS = [{ key: 'studyHours', label: 'Study' }, { key: 'productivity', label: 'Productivity' }, { key: 'questions', label: 'Questions' }];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TREND_WORDS = { improving: 'Improving \u2197', declining: 'Declining \u2198', stable: 'Stable', recovering: 'Recovering \u2197' };
  const SUBSCRIBER_ID = 'progress';

  let view = 'overview', pendingExplorer = false, lastRender = 0, lastRef = null;
  let ov = { metric: 'studyHours', range: 'week' };
  let ex = { dim: 'overall', id: null, metric: 'studyHours', range: 'month', type: 'line', from: '', to: '' };

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function root() { return document.getElementById('screen-progress'); }
  function longDay(d) { const x = new Date(d + 'T00:00:00'); return DAYS[x.getDay()] + ' ' + MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function shortDate(d) { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return MONTHS[x.getMonth()] + ' ' + x.getDate(); }
  function signed(p) { return (p > 0 ? '+' : p < 0 ? '\u2212' : '') + Math.abs(p) + '%'; }
  function dimObj() { return ex.dim === 'overall' ? { type: 'overall' } : { type: ex.dim, id: ex.id }; }

  // ---------- Overview ----------
  function overviewHtml() {
    const today = PTPE.today();
    const prod = PTPE.value('productivity', today);
    const week = PTPE.series('studyHours', null, 'week');
    const cons = PTPE.consistency();
    const trendRes = PTPE.trend('productivity') || PTPE.trend('studyHours');
    const why = prod === null ? [] : PTPE.whyProductivity(today);
    const prodSub = why.length ? why.map(function (w) { return w.label + (w.up ? ' up' : ' down'); }).join(' \u00b7 ') + ' vs yesterday' : (trendRes ? TREND_WORDS[trendRes.state] : '');
    const wk = PTPE.whatChanged();
    const studyChange = wk.filter(function (c) { return c.label === 'Study'; })[0];

    const stat = function (label, big, small, sub) {
      return '<div class="ptpe-stat"><div class="ptpe-k">' + label + '</div><div class="ptpe-v">' + big + (small ? '<small>' + small + '</small>' : '') + '</div><div class="ptpe-sub">' + (sub || '&nbsp;') + '</div></div>';
    };
    const head = '<div class="ptpe-stats">' +
      stat('Productivity today', prod === null ? '\u2013' : prod.toFixed(1), prod === null ? '' : ' / 10', esc(prodSub)) +
      stat('Study this week', PTPE.fmtHours(week.total || 0), '', studyChange ? signed(studyChange.pct) + ' vs last week' : '') +
      stat('Consistency', cons ? cons.score : '\u2013', '', cons ? cons.label : 'Needs a few more days') +
    '</div>';

    const metricTabs = OVERVIEW_METRICS.map(function (m) { return '<button type="button" class="ptpe-tab' + (m.key === ov.metric ? ' on' : '') + '" data-m="' + m.key + '">' + m.label + '</button>'; }).join('');
    const rangeTabs = [['week', '7d'], ['month', '30d']].map(function (r) { return '<button type="button" class="ptpe-tab' + (r[0] === ov.range ? ' on' : '') + '" data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('');
    const chart = '<section class="ptpe-sec"><div class="ptpe-row"><div class="ptpe-tabs">' + metricTabs + '</div><div class="ptpe-tabs">' + rangeTabs + '</div></div><div id="ptpe-ov-chart"></div></section>';

    const compare = wk.length ? '<section class="ptpe-sec"><div class="ptpe-h">This week vs last</div><div class="ptpe-cmp">' +
      wk.map(function (c) { return '<span class="ptpe-chg ' + (c.pct > 0 ? 'up' : c.pct < 0 ? 'down' : '') + '"><em>' + esc(c.label) + '</em> ' + signed(c.pct) + '</span>'; }).join('') + '</div></section>' : '';

    const o = ProgressData.getOtherStats();
    const rows = [['Best study streak', o.bestStudyStreak + (o.bestStudyStreak === 1 ? ' day' : ' days')], ['Total study', PTPE.fmtHours(o.totalStudyHours)], ['Questions solved', o.totalQuestionsSolved], ['Tasks completed', o.totalTasks]];
    const stats = '<section class="ptpe-sec"><div class="ptpe-h">Overall</div>' + rows.map(function (r) { return '<div class="ptpe-line"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</section>';

    const notes = [];
    PTPE.personalBests().slice(0, 2).forEach(function (b) { notes.push(esc(b.label) + ' \u00b7 ' + esc(b.value) + (b.date ? ' <span>' + shortDate(b.date) + '</span>' : '')); });
    PTPE.anomalies().slice(0, 1).forEach(function (a) { notes.push(esc(a.text)); });
    const hi = notes.length ? '<section class="ptpe-sec"><div class="ptpe-h">Highlights</div>' + notes.map(function (t) { return '<div class="ptpe-note">' + t + '</div>'; }).join('') + '</section>' : '';

    return '<div class="ptpe"><div class="ptpe-top"><h2 class="ptpe-title">Progress</h2><button type="button" class="ptpe-explore" id="ptpe-explore">Explore <span aria-hidden="true">\u203a</span></button></div>' + head + chart + compare + stats + hi + '</div>';
  }

  function drawOverviewChart(animate) {
    const host = document.getElementById('ptpe-ov-chart'); if (!host) return;
    const s = PTPE.series(ov.metric, null, ov.range);
    PTPEChart.render(host, s, { type: ov.range === 'week' ? 'bar' : 'line', animate: animate });
  }

  function renderOverview(animate) {
    const r = root(); r.innerHTML = overviewHtml();
    drawOverviewChart(animate);
    r.querySelector('#ptpe-explore').addEventListener('click', function () { view = 'explore'; render(); });
    r.querySelectorAll('.ptpe-tab[data-m]').forEach(function (b) { b.addEventListener('click', function () { ov.metric = b.dataset.m; markTabs(r); drawOverviewChart(true); }); });
    r.querySelectorAll('.ptpe-tab[data-r]').forEach(function (b) { b.addEventListener('click', function () { ov.range = b.dataset.r; markTabs(r); drawOverviewChart(true); }); });
  }
  function markTabs(r) {
    r.querySelectorAll('.ptpe-tab[data-m]').forEach(function (b) { b.classList.toggle('on', b.dataset.m === ov.metric); });
    r.querySelectorAll('.ptpe-tab[data-r]').forEach(function (b) { b.classList.toggle('on', b.dataset.r === ov.range); });
  }

  // ---------- Explorer ----------
  function sel(id, options, value) {
    return '<select id="' + id + '" class="ptpe-sel">' + options.map(function (o) { return '<option value="' + esc(o.id) + '"' + (String(o.id) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
  }
  function fixSelection() {
    if (ex.dim !== 'overall') {
      const items = PTPE.dimensionItems(ex.dim);
      if (!items.some(function (i) { return i.id === ex.id; })) ex.id = items.length ? items[0].id : null;
    } else ex.id = null;
    const ms = PTPE.metricsFor(dimObj());
    if (!ms.some(function (m) { return m.key === ex.metric; })) ex.metric = ms[0].key;
  }

  function explorerShell() {
    return '<div class="ptpe ptpe-ex"><div class="ptpe-top"><button type="button" class="ptpe-back" id="ptpe-back">\u2039 Progress</button><h2 class="ptpe-title">Explore</h2></div>' +
      '<div id="ptpe-ex-controls"></div><section class="ptpe-sec"><div id="ptpe-ex-chart"></div><div id="ptpe-ex-summary" class="ptpe-summary"></div></section>' +
      '<section class="ptpe-sec ptpe-more-list">' +
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
    return '<div class="ptpe-ctl"><label><span>Show</span>' + sel('ptpe-metric', metricOpts, ex.metric) + '</label>' +
      '<label><span>By</span>' + sel('ptpe-dim', dimOpts, ex.dim) + '</label>' + (itemSel ? '<label><span>&nbsp;</span>' + itemSel + '</label>' : '') + '</div>' +
      '<div class="ptpe-row"><div class="ptpe-tabs">' + ranges + '</div><div class="ptpe-tabs">' + types + '</div></div>' + custom;
  }

  function drawExplorer(animate) {
    fixSelection();
    const r = root();
    r.querySelector('#ptpe-ex-controls').innerHTML = controlsHtml();
    wireControls(r);
    const dim = dimObj(), chartHost = r.querySelector('#ptpe-ex-chart'), sum = r.querySelector('#ptpe-ex-summary');
    if (ex.dim !== 'overall' && !ex.id) { chartHost.innerHTML = '<div class="ptpe-chart-empty">Nothing to show yet.</div>'; sum.innerHTML = ''; return; }
    const s = PTPE.series(ex.metric, dim, ex.range, { from: ex.from, to: ex.to });
    const item = ex.dim === 'overall' ? null : PTPE.dimensionItems(ex.dim).filter(function (i) { return i.id === ex.id; })[0];
    PTPEChart.render(chartHost, s, { type: ex.type, animate: animate, color: item && item.color && ex.dim === 'tag' ? item.color : '' });
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
    lastRender = Date.now(); lastRef = State.get();
  }
  // Called by Nav every time Progress is entered: always lands on the quiet overview unless a deep link asked otherwise.
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
  function init() {
    render();
    if (typeof TimeEngine !== 'undefined' && TimeEngine.subscribe) TimeEngine.subscribe(tick, SUBSCRIBER_ID); // stable id: replaces, never stacks
  }
  return { init: init, render: enter, openExplorer: openExplorer, longDay: longDay };
})();
