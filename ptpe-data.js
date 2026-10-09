// ptpe-data.js — PTPE (Progress + Tags + Productivity + EXP): the single interpretation layer.
// Reads canonical data (Journal, Planner, TimeEngine, HabitData, TagsData, Gamification ledger) and
// derives every Progress number once. Progress UI, Calendar lenses, charts, search summaries and EXP
// interpretation all call this module. It stores NOTHING of its own. Depends on: State, PlannerData,
// TagsData, HabitData, TimeEngine, JournalData, ProgressData, ProductivityData, DateHub.
const PTPE = (function () {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MOOD_WORDS = { 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' };
  const WEATHER_WORDS = { 1: 'Sunny', 2: 'Cloudy', 3: 'Cold', 4: 'Rainy' };

  // ---------- dates ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return fmt(new Date()); }
  function parse(s) { return new Date(s + 'T00:00:00'); }
  function shift(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function between(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function span(from, to) {
    const out = [];
    for (let c = from; c <= to && out.length < 800; c = shift(c, 1)) out.push(c);
    return out;
  }
  function lastN(n, end) { end = end || today(); return span(shift(end, -(n - 1)), end); }
  function weekStart(s) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); }
  function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function round1(v) { return Math.round(v * 10) / 10; }

  // ---------- memo (invalidated whenever State is written; today is never cached: it is live) ----------
  let memoRef = null, memoStore = Object.create(null);
  function memo(key, fn) {
    const st = State.get();
    if (st !== memoRef) { memoRef = st; memoStore = Object.create(null); }
    if (key in memoStore) return memoStore[key];
    return (memoStore[key] = fn());
  }
  function memoDay(key, d, fn) { return d >= today() ? fn() : memo(key, fn); }

  // ---------- small stats ----------
  function nums(a) { return a.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); }); }
  function mean(a) { const n = nums(a); return n.length ? n.reduce(function (x, y) { return x + y; }, 0) / n.length : null; }
  function sum(a) { return nums(a).reduce(function (x, y) { return x + y; }, 0); }
  function sd(a) {
    const n = nums(a); if (n.length < 2) return null;
    const m = mean(n);
    return Math.sqrt(n.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (n.length - 1));
  }
  function pearson(xs, ys) {
    const n = xs.length; if (n < 3) return null;
    const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
    return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : null;
  }

  // ---------- tags / dimensions ----------
  function tasksMap() { return PlannerData.getAllTasks(); }
  function topicsMap() { return PlannerData.getAllTopics(); }
  function topicSet(dim) {
    return memo('ts|' + dim.type + '|' + dim.id, function () {
      const set = Object.create(null), topics = topicsMap();
      if (dim.type === 'tag') {
        Object.keys(topics).forEach(function (id) { if ((topics[id].tags || []).indexOf(dim.id) !== -1) set[id] = true; });
      } else if (dim.type === 'subject') {
        Object.keys(topics).forEach(function (id) { if (topics[id].subject === dim.id) set[id] = true; });
      }
      return set;
    });
  }
  function isScoped(dim) { return !!dim && (dim.type === 'subject' || dim.type === 'tag'); }
  function taskInDim(t, dim) {
    if (!dim || dim.type === 'overall') return true;
    if (!isScoped(dim)) return false;
    if (t.topicId && topicSet(dim)[t.topicId]) return true;
    return dim.type === 'subject' && t.subject === dim.id;
  }
  function dimTasks(d, dim) {
    return PlannerData.getTasksForDate(d).filter(function (t) { return (!t.archived || t.completed) && taskInDim(t, dim); });
  }
  function tagsOfTask(t) {
    const topic = t && t.topicId ? topicsMap()[t.topicId] : null;
    return (topic && topic.tags) || [];
  }

  // ---------- study attribution (one pass over TimeEngine; falls back to rolled-up summaries) ----------
  function studyParts(d) {
    return memoDay('sp|' + d, d, function () {
      const out = { totalMs: 0, topics: {} };
      const recs = TimeEngine.getRecordsForDate(d);
      if (recs.length) {
        const tasks = tasksMap();
        recs.forEach(function (rec) {
          const ms = TimeEngine.getLiveStudyMs(rec), q = Number(rec.questionsSolved) || 0;
          out.totalMs += ms;
          const t = rec.taskId ? tasks[rec.taskId] : null;
          if (t && t.topicId) {
            const o = out.topics[t.topicId] || (out.topics[t.topicId] = { ms: 0, q: 0 });
            o.ms += ms; o.q += q;
          }
        });
      } else {
        const s = TimeEngine.getDailySummary(d);
        if (s) {
          out.totalMs = s.studyMs || 0;
          Object.keys(s.topicMs || {}).forEach(function (id) { out.topics[id] = { ms: s.topicMs[id], q: (s.topicQ || {})[id] || 0 }; });
        }
      }
      return out;
    });
  }
  function dimStudyMs(d, dim) {
    const p = studyParts(d);
    if (!dim || dim.type === 'overall') return p.totalMs;
    const set = topicSet(dim); let ms = 0;
    Object.keys(p.topics).forEach(function (id) { if (set[id]) ms += p.topics[id].ms; });
    return ms;
  }
  function dimStudyHours(d, dim) { return dimStudyMs(d, dim) / 3600000; }
  function dimQuestions(d, dim) {
    const p = studyParts(d), set = topicSet(dim); let q = 0;
    Object.keys(p.topics).forEach(function (id) { if (set[id]) q += p.topics[id].q; });
    return q;
  }
  function plannedMin(t) {
    const a = t.startTime || t.savedStartTime, b = t.stopTime || t.savedStopTime;
    if (!a || !b || b <= a) return 0;
    const ap = a.split(':'), bp = b.split(':');
    return (Number(bp[0]) * 60 + Number(bp[1])) - (Number(ap[0]) * 60 + Number(ap[1]));
  }

  // ---------- habits (HabitData records; PTPE interprets) ----------
  function habitEligible(h, d) {
    if (d > today()) return false;
    if (h.createdAt && d < fmt(new Date(h.createdAt))) return false;
    if (h.archived && h.archivedAt && d >= fmt(new Date(h.archivedAt))) return false;
    return true;
  }
  function habitPct(h, d) {
    const log = HabitData.getLog(h.habitId, d), c = log ? (log.count || 0) : 0;
    if (h.systemKey === 'sleep') return (log && log.completed) ? 100 : 0;
    if (h.type === 'binary') return c >= 1 ? 100 : 0;
    if (h.type === 'target') { const t = (log && log.target) || h.target || 1; return Math.min(100, Math.round(c / t * 100)); }
    return null; // counter: tracking only, no completion rule
  }
  function habitsForDim(dim) {
    const all = HabitData.getHabits({ includeArchived: true });
    if (!dim || dim.type === 'overall') return all.filter(function (h) { return !h.systemKey; });
    if (dim.type === 'habit') return all.filter(function (h) { return h.habitId === dim.id; });
    if (dim.type === 'tag') return all.filter(function (h) { return h.tagId === dim.id && !h.systemKey; });
    return [];
  }
  function habitCompletion(d, dim) {
    return mean(habitsForDim(dim).filter(function (h) { return habitEligible(h, d); }).map(function (h) { return habitPct(h, d); }));
  }
  function habitActivity(d, dim) {
    return sum(habitsForDim(dim).filter(function (h) { return habitEligible(h, d); }).map(function (h) {
      const l = HabitData.getLog(h.habitId, d); return l ? (l.count || 0) : 0;
    }));
  }
  // 0-10 factor for ProductivityData (null = no completable habits that day).
  function habitFactor(d) {
    const v = habitCompletion(d, { type: 'overall' });
    return v === null ? null : v / 10;
  }

  // ---------- EXP per date (ledger is the canonical record) ----------
  function ledgerByDate() {
    return memo('ledger', function () {
      const m = {};
      (State.get().expLedger || []).forEach(function (e) { (m[e.date] || (m[e.date] = [])).push(e); });
      return m;
    });
  }
  function expForDate(d, dim) {
    const list = ledgerByDate()[d] || [];
    if (!list.length) return 0;
    if (!isScoped(dim)) return Math.max(0, sum(list.map(function (e) { return e.exp; })));
    const tasks = tasksMap();
    return Math.max(0, sum(list.filter(function (e) { return e.taskId && tasks[e.taskId] && taskInDim(tasks[e.taskId], dim); }).map(function (e) { return e.exp; })));
  }

    // ---------- tests (canonical records live in State.testMarks; PTPE only reads + interprets them) ----------
  // One record per testId, never keyed or merged by date. Every test is normalised to a percentage so tests
  // with different totals compare fairly. A day's value is the mean of that day's tests (so a day counts once
  // in weekly / monthly averages); the per-test chart view keeps same-day tests as separate points.
  function cleanTest(rec, key) {
    if (!rec || typeof rec !== 'object' || !isDateStr(rec.date)) return null;
    const total = Number(rec.total), got = Number(rec.obtained);
    if (!isFinite(total) || total <= 0 || !isFinite(got) || got < 0 || got > total) return null;
    const subs = [];
    (Array.isArray(rec.subjects) ? rec.subjects : []).forEach(function (s) {
      if (!s || typeof s.subject !== 'string' || !s.subject) return;
      const st = Number(s.total), so = Number(s.obtained);
      if (!isFinite(st) || st <= 0 || !isFinite(so) || so < 0 || so > st) return;
      if (subs.some(function (x) { return x.subject === s.subject; })) return;
      subs.push({ subject: s.subject, total: st, obtained: so, pct: so / st * 100 });
    });
    return { id: String(key), date: rec.date, total: total, obtained: got, pct: got / total * 100, subjects: subs, at: Number(rec.createdAt) || 0 };
  }
  function testList() {
    return memo('tests', function () {
      const raw = State.get().testMarks, m = raw && typeof raw === 'object' ? raw : {}, out = [];
      Object.keys(m).forEach(function (k) { const t = cleanTest(m[k], k); if (t) out.push(t); });
      return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at - b.at) || (a.id < b.id ? -1 : 1); });
    });
  }
  function testsByDate() {
    return memo('tbd', function () {
      const m = {};
      testList().forEach(function (t) { (m[t.date] || (m[t.date] = [])).push(t); });
      return m;
    });
  }
  // Percentage a test contributes to a dimension (null = the test says nothing about it).
  function testPct(t, dim) {
    if (!dim || dim.type === 'overall') return t.pct;
    if (dim.type !== 'subject') return null;
    for (let i = 0; i < t.subjects.length; i++) if (t.subjects[i].subject === dim.id) return t.subjects[i].pct;
    return null;
  }
  function testsOn(d, dim) {
    return (testsByDate()[d] || []).filter(function (t) { return testPct(t, dim) !== null; });
  }
  function testEvents(from, to, dim) {
    const t0 = today(), out = [];
    testList().forEach(function (t) {
      if (t.date < from || t.date > to || t.date > t0) return;
      const p = testPct(t, dim);
      if (p !== null) out.push({ id: t.id, date: t.date, pct: p, t: t });
    });
    return out;
  }
  function markFmt(v) { return String(Math.round(v * 100) / 100); }
  function testDate(d) { const x = parse(d); return x.getDate() + ' ' + MON[x.getMonth()] + ' ' + x.getFullYear(); }
  // Hover snippet: exactly what was stored; only subject rows that were really entered.
  function testDetail(t, dim) {
    const same = testsByDate()[t.date] || [t];
    let idx = 0;
    for (let i = 0; i < same.length; i++) if (same[i].id === t.id) idx = i;
    return {
      title: same.length > 1 ? 'Test ' + (idx + 1) + ' of ' + same.length : 'Test',
      sub: testDate(t.date),
      main: markFmt(t.obtained) + ' / ' + markFmt(t.total),
      lines: t.subjects.map(function (s) { return { text: s.subject + ': ' + markFmt(s.obtained) + ' / ' + markFmt(s.total), on: !!dim && dim.type === 'subject' && dim.id === s.subject }; })
    };
  }
  // One chart point per test (same-day tests sit side by side in saved order); used for daily-resolution ranges.
  function testEventSeries(key, dim, r) {
    const m = METRICS[key], ev = testEvents(r.from, r.to, dim), labels = [], values = [], dates = [], ids = [], details = [];
    ev.forEach(function (e, i) {
      labels.push(i === 0 || ev[i - 1].date !== e.date ? dayLabel(e.date, r.days, r.from) : '');
      values.push(round1(e.pct)); dates.push(e.date); ids.push(e.id); details.push(testDetail(e.t, dim));
    });
    const avg = mean(ev.map(function (e) { return e.pct; }));
    return {
      metric: key, label: m.label, kind: 'mean', max: 100, labels: labels, values: values, dates: dates, ids: ids, details: details,
      bucket: 1, from: r.from, to: r.to, total: null, average: avg === null ? null : round1(avg), hasData: values.length > 0, format: m.fmt, events: true
    };
  }
  // Test trend: latest tests vs the tests before them (tests are sparse, so the daily rolling windows don't fit).
  function testTrend(dim) {
    const ev = testEvents('0000-01-01', today(), dim), n = ev.length;
    if (n < 4 || between(ev[n - 1].date, today()) > 120) return null;
    const p = ev.map(function (e) { return e.pct; }), k = Math.min(3, Math.floor(n / 2));
    const r = mean(p.slice(n - k)), pv = mean(p.slice(n - 2 * k, n - k)), b = n >= 3 * k ? mean(p.slice(n - 3 * k, n - 2 * k)) : null;
    const diff = r - pv; let state = 'stable';
    if (b !== null && pv < b - 3 && diff >= 3) state = 'recovering';
    else if (diff >= 3) state = 'improving';
    else if (diff <= -3) state = 'declining';
    return { state: state, pct: Math.round(diff), recent: r, previous: pv };
  }
  function testSummary() {
    return memo('tsm|' + today(), function () {
      const tl = testList().filter(function (t) { return t.date <= today(); });
      if (!tl.length) return null;
      return { count: tl.length, average: mean(tl.map(function (t) { return t.pct; })), latest: tl[tl.length - 1] };
    });
  }

  // ---------- metric catalogue ----------
  const ALL3 = ['overall', 'subject', 'tag'];
  const METRICS = {
    studyHours: { label: 'Study hours', kind: 'sum', dims: ALL3, floor: 0.3, fmt: function (v) { return fmtHours(v); } },
    questions: { label: 'Questions solved', kind: 'sum', dims: ALL3, floor: 3, fmt: function (v) { return Math.round(v) + ''; } },
    productivity: { label: 'Productivity', kind: 'mean', dims: ALL3, max: 10, floor: 0.3, fmt: function (v) { return round1(v) + ' / 10'; } },
        exp: { label: 'EXP earned', kind: 'sum', dims: ALL3, floor: 20, fmt: function (v) { return Math.round(v) + ' EXP'; } },
    testScore: { label: 'Test score', kind: 'mean', dims: ['overall', 'subject'], max: 100, floor: 3, events: true, fmt: pctFmt },
    testCount: { label: 'Tests taken', kind: 'sum', dims: ['overall', 'subject'], floor: 1, fmt: function (v) { return Math.round(v) + ''; } },
    plannerCompletion: { label: 'Planner completion', kind: 'mean', dims: ALL3, max: 100, floor: 5, fmt: pctFmt },
    revisionCompletion: { label: 'Revision completion', kind: 'mean', dims: ALL3, max: 100, floor: 5, fmt: pctFmt },
    studyVsPlan: { label: 'Actual vs planned study', kind: 'mean', dims: ALL3, max: 100, floor: 5, fmt: pctFmt },
    habitActivity: { label: 'Habit activity', kind: 'sum', dims: ['overall', 'tag', 'habit'], floor: 1, fmt: function (v) { return Math.round(v * 10) / 10 + ''; } },
    habitCompletion: { label: 'Habit completion', kind: 'mean', dims: ['overall', 'tag', 'habit'], max: 100, floor: 5, fmt: pctFmt },
    mood: { label: 'Mood', kind: 'mean', dims: ['overall'], max: 5, floor: 0.2, fmt: function (v) { return MOOD_WORDS[Math.round(v)] || round1(v) + ''; } },
    sleep: { label: 'Sleep', kind: 'mean', dims: ['overall'], max: 12, floor: 0.3, fmt: function (v) { return round1(v) + ' h'; } },
    water: { label: 'Water', kind: 'mean', dims: ['overall'], max: 10, floor: 0.3, fmt: function (v) { return round1(v) + ' / 10'; } },
    targets: { label: 'Targets', kind: 'mean', dims: ['overall'], max: 100, floor: 5, fmt: pctFmt },
    weather: { label: 'Weather', kind: 'mean', dims: ['overall'], max: 4, floor: 0.3, fmt: function (v) { return WEATHER_WORDS[Math.round(v)] || ''; } },
    checklist: { label: 'Checklist completion', kind: 'mean', dims: ['tag'], max: 100, floor: 5, fmt: pctFmt }
  };
  function pctFmt(v) { return Math.round(v) + '%'; }
  function fmtHours(h) {
    const m = Math.round((h || 0) * 60), hh = Math.floor(m / 60), mm = m % 60;
    return hh ? (mm ? hh + 'h ' + mm + 'm' : hh + 'h') : mm + 'm';
  }

  function compute(key, d, dim) {
    const entry = JournalData.getEntry(d), scoped = isScoped(dim);
    switch (key) {
      case 'studyHours': {
        if (!scoped) { const v = ProgressData.studyHoursValue(entry, d); return v === null ? 0 : v; }
        return round1(dimStudyHours(d, dim));
      }
      case 'questions': {
        if (!scoped) { const v = ProgressData.questionsValue(entry, d); return v === null ? 0 : v; }
        return dimQuestions(d, dim);
      }
      case 'productivity': { const r = ProductivityData.getScore(d, scoped ? dim : null); return r ? r.score : null; }
      case 'exp': return expForDate(d, dim);
      case 'plannerCompletion': {
        const t = dimTasks(d, dim); if (!t.length) return null;
        return Math.round(t.filter(function (x) { return x.completed; }).length / t.length * 100);
      }
      case 'revisionCompletion': {
        const t = dimTasks(d, dim).filter(function (x) { return x.taskType === 'revision'; }); if (!t.length) return null;
        return Math.round(t.filter(function (x) { return x.completed; }).length / t.length * 100);
      }
      case 'studyVsPlan': {
        const planned = sum(dimTasks(d, dim).map(plannedMin)); if (planned <= 0) return null;
        return Math.min(200, Math.round(dimStudyMs(d, dim) / 60000 / planned * 100));
      }
            case 'testScore': { const v = mean(testsOn(d, dim).map(function (t) { return testPct(t, dim); })); return v === null ? null : round1(v); }
      case 'testCount': return testsOn(d, dim).length;
      case 'habitActivity': return habitActivity(d, dim);
      case 'habitCompletion': { const v = habitCompletion(d, dim); return v === null ? null : Math.round(v); }
      case 'mood': return ProgressData.moodValue(entry);
      case 'sleep': return ProgressData.sleepValue(entry, d);
      case 'water': return ProgressData.hydrationValue(entry, d);
      case 'targets': return ProgressData.targets(entry, d);
      case 'weather': return ProgressData.weatherValue(entry);
      case 'checklist': {
        const hub = DateHub.get(d), r = hub && hub.itineraryTagRollup && hub.itineraryTagRollup[dim.id];
        return (r && r.totalCount > 0) ? Math.round(r.completedCount / r.totalCount * 100) : null;
      }
    }
    return null;
  }

  // THE canonical per-day value. Everything (charts, Calendar lenses, insights) comes through here.
  function value(key, d, dim) {
    dim = dim || { type: 'overall' };
    const m = METRICS[key];
    if (!m || m.dims.indexOf(dim.type) === -1 || !isDateStr(d) || d > today()) return null;
    return memoDay('v|' + key + '|' + dim.type + '|' + (dim.id || '') + '|' + d, d, function () { return compute(key, d, dim); });
  }

  function metricsFor(dim) {
    dim = dim || { type: 'overall' };
    const h = dim.type === 'habit' ? HabitData.getHabit(dim.id) : null;
    return Object.keys(METRICS).filter(function (k) {
      if (METRICS[k].dims.indexOf(dim.type) === -1) return false;
      if (h && k === 'habitCompletion' && h.type === 'counter') return false;
      return true;
    }).map(function (k) { return { key: k, label: METRICS[k].label }; });
  }
  function dimensionItems(type) {
    if (type === 'subject') {
      const names = PlannerData.getAllSubjects().slice(), topics = topicsMap();
            Object.keys(topics).forEach(function (id) { const s = topics[id].subject; if (s && names.indexOf(s) === -1) names.push(s); });
      testList().forEach(function (t) { t.subjects.forEach(function (x) { if (names.indexOf(x.subject) === -1) names.push(x.subject); }); });
      return names.map(function (s) { return { id: s, label: s }; });
    }
    if (type === 'tag') return TagsData.getAllTagsList().map(function (t) { return { id: t.tagId, label: t.name, color: t.color }; });
    if (type === 'habit') return HabitData.getHabits({ includeArchived: true }).map(function (h) { return { id: h.habitId, label: h.title + (h.archived ? ' (archived)' : ''), color: h.color }; });
    return [];
  }

  // ---------- ranges + series (one chart-ready builder for every metric/dimension) ----------
  const RANGES = { week: 'Week', month: 'Month', quarter: '3 months', custom: 'Custom' };
  function resolveRange(rangeKey, custom) {
    const t = today(); let from, to = t;
    if (rangeKey === 'custom' && custom && isDateStr(custom.from) && isDateStr(custom.to) && custom.from <= custom.to) {
      from = custom.from; to = custom.to > t ? t : custom.to;
      if (from > to) from = to;
      if (between(from, to) > 365) from = shift(to, -365);
    } else {
      const n = rangeKey === 'week' ? 7 : rangeKey === 'quarter' ? 90 : 30;
      from = shift(t, -(n - 1));
    }
    const days = between(from, to) + 1;
    return { from: from, to: to, days: days, bucket: days <= 45 ? 1 : days <= 200 ? 7 : 30 };
  }
  function dayLabel(d, days, first) {
    const x = parse(d);
    if (days <= 7) return DAY[x.getDay()];
    if (x.getDate() === 1 || d === first) return MON[x.getMonth()] + ' ' + x.getDate();
    return '' + x.getDate();
  }
    // opts.byDay forces one value per day (used when the UI regroups days into weeks / months).
  function series(metricKey, dim, rangeKey, custom, opts) {
    dim = dim || { type: 'overall' };
    const m = METRICS[metricKey], r = resolveRange(rangeKey, custom), dates = span(r.from, r.to);
    if (m.events && r.bucket === 1 && !(opts && opts.byDay)) return testEventSeries(metricKey, dim, r);
    const labels = [], values = [], starts = [];
    for (let i = 0; i < dates.length; i += r.bucket) {
      const chunk = dates.slice(i, i + r.bucket);
      const vals = chunk.map(function (d) { return value(metricKey, d, dim); });
      values.push(m.kind === 'sum' ? sum(vals) : (mean(vals) === null ? null : round1(mean(vals))));
      starts.push(chunk[0]);
      labels.push(r.bucket === 1 ? dayLabel(chunk[0], r.days, dates[0]) : MON[parse(chunk[0]).getMonth()] + ' ' + parse(chunk[0]).getDate());
    }
    const real = nums(values);
    const total = m.kind === 'sum' ? sum(real) : null;
    const avg = m.kind === 'sum' ? (dates.length ? total / dates.length : null) : mean(real);
    return {
      metric: metricKey, label: m.label, kind: m.kind, max: m.max || null, labels: labels, values: values, dates: starts,
      bucket: r.bucket, from: r.from, to: r.to, total: total, average: avg === null ? null : round1(avg),
      hasData: m.kind === 'sum' ? sum(real) > 0 : real.length > 0, format: m.fmt
    };
  }
  function lastValues(key, dim, n, end) { return lastN(n, end).map(function (d) { return value(key, d, dim); }); }
  function meanAll(key, dim, n, end) {
    const m = METRICS[key], v = lastValues(key, dim, n, end);
    return m.kind === 'sum' ? mean(v.map(function (x) { return x === null ? 0 : x; })) : mean(v);
  }

  // ---------- trend (rolling comparison, no AI) ----------
    function trend(key, dim) {
    dim = dim || { type: 'overall' };
    if (key === 'testScore') return testTrend(dim);
    const m = METRICS[key], t = today();
    const rv = lastValues(key, dim, 7, t), pv = lastValues(key, dim, 7, shift(t, -7)), bv = lastValues(key, dim, 14, shift(t, -14));
    const dataDays = function (a) { return nums(a).filter(function (v) { return m.kind === 'mean' || v > 0; }).length; };
    if (dataDays(rv) + dataDays(pv) < 4 || dataDays(pv) < 2) return null;
    const norm = function (a) { return m.kind === 'sum' ? mean(a.map(function (x) { return x === null ? 0 : x; })) : mean(a); };
    const r = norm(rv), p = norm(pv), b = dataDays(bv) >= 4 ? norm(bv) : null;
    if (r === null || p === null) return null;
    const base = Math.max(p, m.floor || 0.3), change = (r - p) / base;
    let state = 'stable';
    if (b !== null && p < b * 0.85 && r >= p * 1.1 && r - p >= (m.floor || 0.3) * 0.5) state = 'recovering';
    else if (change >= 0.1 && r - p >= (m.floor || 0.3) * 0.5) state = 'improving';
    else if (change <= -0.1 && p - r >= (m.floor || 0.3) * 0.5) state = 'declining';
    return { state: state, pct: Math.round(change * 100), recent: r, previous: p };
  }

  // ---------- consistency (reliability, not volume) ----------
  function consistency(endDate) {
    const t = today(), end0 = endDate || t;
    const endEff = (end0 === t && !(value('studyHours', end0) > 0)) ? shift(end0, -1) : end0;
    const days = lastN(14, endEff);
    const study = days.map(function (d) { return value('studyHours', d); });
    const frac = function (key, thr, min) {
      const v = days.map(function (d) { return value(key, d); }).filter(function (x) { return x !== null; });
      return v.length >= min ? v.filter(function (x) { return x >= thr; }).length / v.length : null;
    };
    const comps = [
      { w: 0.40, v: study.filter(function (h) { return h >= 1; }).length / days.length },
      { w: 0.25, v: frac('plannerCompletion', 60, 3) },
      { w: 0.20, v: frac('habitCompletion', 60, 3) },
      { w: 0.15, v: frac('revisionCompletion', 60, 2) }
    ].filter(function (c) { return c.v !== null; });
    const active = study.filter(function (h) { return h > 0; }).length;
    if (active < 3 && comps.length < 2) return null;
    if (days.filter(function (d, i) { return study[i] > 0 || value('plannerCompletion', d) !== null; }).length < 5) return null;
    const tw = comps.reduce(function (a, c) { return a + c.w; }, 0);
    let score = comps.reduce(function (a, c) { return a + c.w * c.v; }, 0) / tw * 100;
    let run = 0, longest = 0;
    study.forEach(function (h) { run = h < 1 ? run + 1 : 0; if (run > longest) longest = run; });
    score *= (1 - 0.2 * Math.min(1, Math.max(0, longest - 2) / 5));
    score = Math.round(score);
    return { score: score, label: score >= 75 ? 'Steady' : score >= 50 ? 'Building' : 'Irregular' };
  }

  // ---------- planned vs actual ----------
  function plannedVsActual(rangeKey, custom) {
    const r = resolveRange(rangeKey || 'month', custom);
    let planned = 0, actual = 0, doneMin = 0, over = 0, under = 0, n = 0;
    span(r.from, r.to).forEach(function (d) {
      const tasks = dimTasks(d, null), p = sum(tasks.map(plannedMin));
      if (p <= 0) return;
      const a = dimStudyMs(d, null) / 60000;
      n++; planned += p; actual += a;
      doneMin += sum(tasks.filter(function (t) { return t.completed; }).map(plannedMin));
      if (a > p * 1.25) over++; else if (a < p * 0.75) under++;
    });
    if (!n) return null;
    let bias = null;
    if (n >= 5 && over / n >= 0.6) bias = 'under';   // you routinely do more than you plan
    else if (n >= 5 && under / n >= 0.6) bias = 'over'; // you routinely plan more than you do
    return { days: n, plannedMin: Math.round(planned), actualMin: Math.round(actual), completionPct: Math.round(doneMin / planned * 100), avgDiffMin: Math.round((actual - planned) / n), bias: bias };
  }

  // ---------- history helpers ----------
  function allDates() {
    return memo('alld', function () {
      const set = {}, t = today();
      const add = function (d) { if (isDateStr(d) && d <= t) set[d] = true; };
      Object.keys(JournalData.getAllEntries()).forEach(add);
      TimeEngine.getAllTrackedDates().forEach(add);
      Object.keys(State.get().habitLogs || {}).forEach(function (k) { add((State.get().habitLogs[k] || {}).date); });
      Object.keys(ledgerByDate()).forEach(add);
            PlannerData.getTasksList().forEach(function (x) { add(x.date); });
      testList().forEach(function (x) { add(x.date); });
      return Object.keys(set).sort();
    });
  }

  // ---------- personal bests ----------
  function personalBests() {
    return memo('pb', function () {
      const dates = allDates(), out = [];
      let bestStudy = null, bestQ = null, bestProd = null, bestExp = null;
      const weeks = {}, habitWeeks = {}, tagHours = {};
      dates.forEach(function (d) {
        const h = value('studyHours', d), q = value('questions', d), p = value('productivity', d), e = value('exp', d);
        if (h > 0 && (!bestStudy || h > bestStudy.v)) bestStudy = { v: h, date: d };
        if (q > 0 && (!bestQ || q > bestQ.v)) bestQ = { v: q, date: d };
        if (p !== null && (!bestProd || p > bestProd.v)) bestProd = { v: p, date: d };
        if (e > 0 && (!bestExp || e > bestExp.v)) bestExp = { v: e, date: d };
        const w = weekStart(d); weeks[w] = (weeks[w] || 0) + (h || 0);
        const hc = value('habitCompletion', d);
        if (hc !== null) (habitWeeks[w] || (habitWeeks[w] = [])).push(hc);
        const parts = studyParts(d);
        Object.keys(parts.topics).forEach(function (id) {
          ((topicsMap()[id] || {}).tags || []).forEach(function (tg) { tagHours[tg] = (tagHours[tg] || 0) + parts.topics[id].ms / 3600000; });
        });
      });
      if (bestStudy && bestStudy.v >= 1) out.push({ key: 'bestStudyDay', label: 'Best study day', value: fmtHours(bestStudy.v), date: bestStudy.date });
      let bw = null; Object.keys(weeks).forEach(function (w) { if (!bw || weeks[w] > bw.v) bw = { v: weeks[w], date: w }; });
      if (bw && bw.v >= 5) out.push({ key: 'bestWeek', label: 'Best study week', value: fmtHours(bw.v), date: bw.date });
      let run = 0, runBest = 0, runEnd = null;
      span(dates[0] || today(), today()).forEach(function (d) {
        if (value('studyHours', d) >= 1) { run++; if (run > runBest) { runBest = run; runEnd = d; } } else run = 0;
      });
      if (runBest >= 3) out.push({ key: 'longestRun', label: 'Longest consistent run', value: runBest + ' days', date: runEnd });
      if (bestQ && bestQ.v >= 10) out.push({ key: 'bestQuestions', label: 'Most questions in a day', value: bestQ.v + '', date: bestQ.date });
      if (bestProd && bestProd.v >= 5) out.push({ key: 'bestProductivity', label: 'Highest productivity', value: round1(bestProd.v) + ' / 10', date: bestProd.date });
            if (bestExp && bestExp.v >= 100) out.push({ key: 'bestExp', label: 'Most EXP in a day', value: Math.round(bestExp.v) + '', date: bestExp.date });
      const tl = testList().filter(function (x) { return x.date <= today(); });
      if (tl.length >= 2) { // percentages, so different totals compare; ties keep the earliest test
        let bt = tl[0]; tl.forEach(function (x) { if (x.pct > bt.pct) bt = x; });
        out.push({ key: 'bestTest', label: 'Best test score', value: round1(bt.pct) + '% (' + markFmt(bt.obtained) + '/' + markFmt(bt.total) + ')', date: bt.date });
      }
      let hw = null; Object.keys(habitWeeks).forEach(function (w) { if (habitWeeks[w].length >= 5) { const mv = mean(habitWeeks[w]); if (mv >= 70 && (!hw || mv > hw.v)) hw = { v: mv, date: w }; } });
      if (hw) out.push({ key: 'bestHabitWeek', label: 'Best habit week', value: Math.round(hw.v) + '%', date: hw.date });
      let st = null; Object.keys(tagHours).forEach(function (tg) { if (TagsData.getTag(tg) && tagHours[tg] >= 2 && (!st || tagHours[tg] > st.v)) st = { v: tagHours[tg], id: tg }; });
      if (st) out.push({ key: 'strongestTag', label: 'Strongest tag', value: TagsData.getTag(st.id).name + ' · ' + fmtHours(st.v), date: null });
      return out;
    });
  }

  // ---------- what changed (this week vs previous week) ----------
  function whatChanged() {
    return memo('wc' + today(), function () {
      const t = today(), items = [];
      const pct = function (a, b) { return b > 0 ? Math.round((a - b) / b * 100) : null; };
      const wk = function (key, dim, endOffset) { return sum(lastValues(key, dim, 7, shift(t, -endOffset)).map(function (x) { return x === null ? 0 : x; })); };
      const add = function (label, a, b, min) { if (a + b < min) return; const p = pct(a, b); if (p !== null) items.push({ label: label, pct: p }); };
      add('Study', wk('studyHours', null, 0), wk('studyHours', null, 7), 1);
      add('Questions', wk('questions', null, 0), wk('questions', null, 7), 10);
      const pr = mean(lastValues('productivity', null, 7, t)), pp = mean(lastValues('productivity', null, 7, shift(t, -7)));
            if (pr !== null && pp !== null && pp > 0) items.push({ label: 'Productivity', pct: Math.round((pr - pp) / pp * 100) });
      { // test score: change in average percentage points, only when both weeks had a test
        const tw = testEvents(shift(t, -6), t).map(function (e) { return e.pct; }), tp = testEvents(shift(t, -13), shift(t, -7)).map(function (e) { return e.pct; });
        if (tw.length && tp.length) items.push({ label: 'Test score', pct: Math.round(mean(tw) - mean(tp)) });
      }
      let top = null;
      TagsData.getAllTagsList().forEach(function (tg) {
        const dim = { type: 'tag', id: tg.tagId }, a = wk('studyHours', dim, 0), b = wk('studyHours', dim, 7);
        if (a + b < 2 || b <= 0) return;
        const p = pct(a, b);
        if (p !== null && (!top || Math.abs(p) > Math.abs(top.pct))) top = { label: tg.name, pct: p };
      });
      if (top) items.push(top);
      return items;
    });
  }

  // ---------- anomalies (conservative; optional insights, never notifications) ----------
  function anomalies() {
    return memo('an' + today(), function () {
      const t = today(), y = shift(t, -1), out = [];
      const base = function (key) { return span(shift(y, -28), shift(y, -1)).map(function (d) { return value(key, d); }); };
      const z = function (key, kind) {
        const b = base(key).map(function (x) { return x === null && kind === 'sum' ? 0 : x; }), real = nums(b);
        const act = kind === 'sum' ? real.filter(function (v) { return v > 0; }).length : real.length;
        const v = value(key, y), s = sd(real);
        if (act < 8 || v === null || !s || s < 0.3) return null;
        return { z: (v - mean(real)) / s, diff: v - mean(real), v: v };
      };
      const sdz = z('studyHours', 'sum');
      if (sdz && sdz.z <= -2 && sdz.diff <= -1.5) out.push({ key: 'studyLow', sev: -sdz.z, text: 'Study yesterday was unusually low.' });
      else if (sdz && sdz.z >= 2 && sdz.diff >= 1.5) out.push({ key: 'studyHigh', sev: sdz.z, text: 'Study yesterday was unusually high.' });
      const pz = z('productivity', 'mean');
      if (pz && pz.z <= -2 && pz.diff <= -2) out.push({ key: 'prodDrop', sev: -pz.z, text: 'Productivity dropped sharply yesterday.' });
      const qz = z('questions', 'sum');
      if (qz && qz.z >= 2.2 && qz.diff >= 15) out.push({ key: 'qSpike', sev: qz.z, text: 'Questions solved yesterday were well above usual.' });
      HabitData.getHabits().filter(function (h) { return !h.systemKey && h.createdAt && between(fmt(new Date(h.createdAt)), t) > 14; }).forEach(function (h) {
        const hit = function (from, to) { return span(from, to).filter(function (d) { const l = HabitData.getLog(h.habitId, d); return l && l.count > 0; }).length; };
        if (hit(shift(t, -34), shift(t, -8)) >= 5 && hit(shift(t, -6), t) === 0) out.push({ key: 'habit' + h.habitId, sev: 2, text: h.title + ' hasn\u2019t been logged this week.' });
      });
      const s5 = nums(lastValues('sleep', null, 5, t)), s20 = nums(lastValues('sleep', null, 20, shift(t, -5)));
      if (s5.length >= 4 && s20.length >= 4 && Math.abs(mean(s5) - mean(s20)) >= 1.5) {
        const d = Math.round(Math.abs(mean(s5) - mean(s20)) * 2) / 2;
        out.push({ key: 'sleep', sev: 2, text: 'Sleep has been about ' + d + 'h ' + (mean(s5) < mean(s20) ? 'shorter' : 'longer') + ' lately.' });
      }
      const tagWeek = function (endOff, n) {
        const m = {}; let tot = 0;
        TagsData.getAllTagsList().forEach(function (tg) { const h = sum(lastValues('studyHours', { type: 'tag', id: tg.tagId }, n, shift(t, -endOff))); m[tg.tagId] = h; tot += h; });
        return { m: m, tot: tot };
      };
      const tw = tagWeek(0, 7), tp = tagWeek(7, 21), all7 = sum(lastValues('studyHours', null, 7, t)), all21 = sum(lastValues('studyHours', null, 21, shift(t, -7)));
      TagsData.getAllTagsList().forEach(function (tg) {
        if (all7 < 4 || all21 < 6) return;
        if (tw.m[tg.tagId] / all7 >= 0.6 && tp.m[tg.tagId] / all21 < 0.35) out.push({ key: 'tag' + tg.tagId, sev: 1.5, text: tg.name + ' took most of this week\u2019s study.' });
      });
            { // newest test (within the last week) against the tests before it
        const tl = testList().filter(function (x) { return x.date <= t; });
        if (tl.length >= 6 && between(tl[tl.length - 1].date, t) <= 6) {
          const last = tl[tl.length - 1], base = tl.slice(Math.max(0, tl.length - 13), tl.length - 1).map(function (x) { return x.pct; }), bs = sd(base);
          if (bs !== null && bs >= 1.5) {
            const diff = last.pct - mean(base), zz = diff / bs;
            if (zz >= 2 && diff >= 8) out.push({ key: 'testHigh', sev: zz, text: 'A recent test score was unusually high.' });
            else if (zz <= -2 && diff <= -8) out.push({ key: 'testLow', sev: -zz, text: 'A recent test score was unusually low.' });
          }
        }
      }
      return out.sort(function (a, b) { return b.sev - a.sev; }).slice(0, 3);
    });
  }

  // ---------- correlations (association only; needs real volume) ----------
  const PAIRS = [
    ['sleep', 'studyHours', 'sleep', 'study time'],
    ['sleep', 'productivity', 'sleep', 'productivity'],
    ['mood', 'productivity', 'mood', 'productivity'],
    ['habitCompletion', 'plannerCompletion', 'habit completion', 'planner completion'],
    ['water', 'productivity', 'water', 'productivity']
  ];
  function correlations() {
    return memo('co' + today(), function () {
      const days = lastN(60), out = [];
      PAIRS.forEach(function (p) {
        const xs = [], ys = [];
        days.forEach(function (d) {
          const a = value(p[0], d), b = value(p[1], d);
          if (a !== null && b !== null) { xs.push(a); ys.push(b); }
        });
        const n = xs.length, r = pearson(xs, ys);
        if (n < 14 || r === null || Math.abs(r) < Math.max(0.35, 2 / Math.sqrt(n))) return;
        out.push({ a: p[0], b: p[1], r: Math.round(r * 100) / 100, n: n, strength: Math.abs(r), text: 'Days with more ' + p[2] + ' tend to have ' + (r > 0 ? 'more ' : 'less ') + p[3] + '.' });
      });
            { // study in the 7 days before each test vs that test's score (tests are sparse, so pair per test, not per day)
        const xs = [], ys = [];
        testList().filter(function (x) { return x.date <= today() && x.date >= shift(today(), -365); }).forEach(function (x) {
          xs.push(mean(span(shift(x.date, -7), shift(x.date, -1)).map(function (d) { return value('studyHours', d) || 0; }))); ys.push(x.pct);
        });
        const n = xs.length, r = pearson(xs, ys);
        if (n >= 8 && r !== null && Math.abs(r) >= Math.max(0.4, 2 / Math.sqrt(n))) {
          out.push({ a: 'studyHours', b: 'testScore', r: Math.round(r * 100) / 100, n: n, unit: 'tests', strength: Math.abs(r), text: 'Tests tend to go ' + (r > 0 ? 'better' : 'worse') + ' after weeks with more study time.' });
        }
      }
      return out.sort(function (a, b) { return b.strength - a.strength; }).slice(0, 3);
    });
  }

  // ---------- productivity: broad "why it moved" (compares weighted contributions to previous day) ----------
  function whyProductivity(d) {
    const W = ProductivityData.WEIGHTS, labels = { study: 'Study time', questions: 'Questions', delivery: 'Planned work done', punctuality: 'Punctuality', habits: 'Habits', sleep: 'Sleep', water: 'Water', breakBalance: 'Break balance', mood: 'Mood', tests: 'Test score' };
    const a = ProductivityData.getBreakdown(d), b = ProductivityData.getBreakdown(shift(d, -1));
    if (!a || !b || a.score === null || b.score === null) return [];
    const parts = [];
    Object.keys(W).forEach(function (k) {
      const dv = W[k] * ((a.factors[k] || 0) - (b.factors[k] || 0));
      if (Math.abs(dv) >= 0.25) parts.push({ label: labels[k], delta: dv });
    });
    const pa = sum(a.penalties.map(function (p) { return p.value; })), pb = sum(b.penalties.map(function (p) { return p.value; }));
    if (Math.abs(pa - pb) >= 0.25) parts.push({ label: 'Missed / overdue work', delta: -(pa - pb) });
    return parts.sort(function (x, y) { return Math.abs(y.delta) - Math.abs(x.delta); }).slice(0, 2).map(function (p) { return { label: p.label, up: p.delta > 0 }; });
  }

  // ---------- Calendar lenses ----------
  const LENSES = [
    { key: 'normal', label: 'Normal' },
    { key: 'productivity', label: 'Productivity' },
    { key: 'tag', label: 'Tag activity' },
    { key: 'mood', label: 'Mood' },
    { key: 'study', label: 'Study time' },
        { key: 'habits', label: 'Habits' },
    { key: 'tests', label: 'Tests' }
  ];

    const LENS_COLORS = { productivity: '#b5566b', mood: '#c3a97e', study: '#6b8a4a', habits: '#7fb8d9', tag: '#b39ddb', tests: '#c98a4b' };
  function tagActivity(tagId, d) {
    const dim = { type: 'tag', id: tagId }, h = value('studyHours', d, dim), c = value('plannerCompletion', d, dim);
    let n = 0, w = 0;
    if (h > 0) { n += 0.6 * Math.min(1, h / 2); w += 0.6; }
    if (c !== null) { n += 0.4 * (c / 100); w += 0.4; }
    return w > 0 ? n / w : null;
  }
  function lens(mode, d, opts) {
    let v = null, norm = null, text = '';
    if (mode === 'productivity') { v = value('productivity', d); if (v !== null) { norm = v / 10; text = round1(v) + ' / 10'; } }
    else if (mode === 'mood') { v = value('mood', d); if (v !== null) { norm = (v - 1) / 4; text = MOOD_WORDS[Math.round(v)]; } }
    else if (mode === 'study') { v = value('studyHours', d); if (v > 0) { norm = Math.min(1, v / 6); text = fmtHours(v); } }
        else if (mode === 'habits') { v = value('habitCompletion', d); if (v !== null) { norm = v / 100; text = Math.round(v) + '%'; } }
    else if (mode === 'tests') { v = value('testScore', d); if (v !== null) { norm = v / 100; const c = value('testCount', d); text = (c > 1 ? c + ' tests \u00b7 ' : 'Test \u00b7 ') + Math.round(v) + '%'; } }
    else if (mode === 'tag' && opts && opts.tagId && TagsData.getTag(opts.tagId)) {
      v = tagActivity(opts.tagId, d); if (v !== null) { norm = v; text = TagsData.getTag(opts.tagId).name + ' ' + Math.round(v * 100) + '%'; }
    }
    return { norm: norm === null ? null : Math.max(0, Math.min(1, norm)), text: text };
  }
  function lensColor(mode, opts) {
    if (mode === 'tag' && opts && opts.tagId && TagsData.getTag(opts.tagId)) return TagsData.getTag(opts.tagId).color;
    return LENS_COLORS[mode] || '#6b8a4a';
  }

  // ---------- tag summaries (global search + headers) ----------
  function tagSummary(tagId) {
    return memo('tsum|' + tagId, function () {
      const dim = { type: 'tag', id: tagId }, set = topicSet(dim);
      const tasks = PlannerData.getTasksList().filter(function (t) { return taskInDim(t, dim); });
      let hours = 0;
      allDates().forEach(function (d) { hours += dimStudyHours(d, dim); });
      return {
        topics: Object.keys(set).length, tasks: tasks.length, tasksDone: tasks.filter(function (t) { return t.completed; }).length,
        hours: round1(hours), habits: HabitData.getHabits().filter(function (h) { return h.tagId === tagId; }).length
      };
    });
  }
  function tagSummaryText(tagId) {
    const s = tagSummary(tagId), bits = [];
    if (s.hours > 0) bits.push(fmtHours(s.hours) + ' studied');
    if (s.tasks) bits.push(s.tasksDone + '/' + s.tasks + ' tasks');
    if (s.topics) bits.push(s.topics + (s.topics === 1 ? ' topic' : ' topics'));
    if (s.habits) bits.push(s.habits + (s.habits === 1 ? ' habit' : ' habits'));
    return bits.join(' · ');
  }

  // ---------- EXP interpretation (Gamification asks; PTPE decides) ----------
  // Called once per settled date by GamificationData.settleDay (never live), so repeated taps,
  // reloads and retroactive habit edits cannot farm it.
  function dayExpEvents(d) {
    const out = [];
    const hs = habitsForDim(null).filter(function (h) { return habitEligible(h, d) && habitPct(h, d) !== null; });
    if (hs.length >= 2) {
      const ratio = mean(hs.map(function (h) { return habitPct(h, d); })) / 100;
      if (ratio >= 0.6) out.push({ label: 'Habits kept (' + Math.round(ratio * 100) + '%)', exp: Math.round(30 * ratio) });
    }
    if (parse(d).getDay() === 0) {
      const c = consistency(d);
      if (c && c.score >= 75 && value('studyHours', d) >= 1) out.push({ label: 'Steady week', exp: 100 });
    }
    return out;
  }

  return {
    today: today, shift: shift, span: span, lastN: lastN, fmtHours: fmtHours,
    METRICS: METRICS, RANGES: RANGES, LENSES: LENSES,
    value: value, series: series, metricsFor: metricsFor, dimensionItems: dimensionItems, resolveRange: resolveRange,
    trend: trend, consistency: consistency, plannedVsActual: plannedVsActual, personalBests: personalBests,
    whatChanged: whatChanged, anomalies: anomalies, correlations: correlations, whyProductivity: whyProductivity,
        lens: lens, lensColor: lensColor, tagSummary: tagSummary, tagSummaryText: tagSummaryText, dayExpEvents: dayExpEvents, testSummary: testSummary,
    // shared with ProductivityData / TagsData so nobody re-derives these
    taskInDim: taskInDim, dimTasks: dimTasks, dimStudyHours: dimStudyHours, dimQuestions: dimQuestions, habitFactor: habitFactor
  };
})();
