// progress-data.js — Progress tab data layer. No UI here. Depends on: State, JournalData, PlannerData, DateHub, Streak.
// Reads existing Journal / Planner / DateHub data as the source of truth. Does not store anything of its own.

const ProgressData = (function () {
  // Mood strings come from journal.js option labels, e.g. "\uD83D\uDE04 great", "\uD83D\uDE42 good",
  // "\uD83D\uDE10 okay", "\uD83D\uDE14 low", "\uD83D\uDE22 rough" — matched by keyword, case-insensitive.
  const MOOD_MAP = { great: 5, good: 4, okay: 3, low: 2, rough: 1 };
  // Weather strings come from journal.js option values exactly: 'Sunny' | 'Cloudy' | 'Rainy' | 'Cold'.
  const WEATHER_MAP = { Sunny: 1, Cloudy: 2, Cold: 3, Rainy: 4 };

  // Caps used to normalize the unbounded Study Hours / Questions Solved numbers onto a 0-10
  // scale before they're combined into the Productivity Score, so raw counts can't drown out mood.
  const STUDY_HOURS_CAP = 8;   // hoursStudied >= this counts as a "full" 10/10 study contribution
  const QUESTIONS_CAP = 40;    // questionsSolved >= this counts as a "full" 10/10 questions contribution

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function parseDateStr(dateStr) { return new Date(dateStr + 'T00:00:00'); }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function startOfWeek(date) { const d = new Date(date); d.setDate(d.getDate() - d.getDay()); return d; }
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function average(values) {
    const nums = values.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
    if (!nums.length) return null;
    const sum = nums.reduce(function (a, b) { return a + b; }, 0);
    return Math.round((sum / nums.length) * 10) / 10;
  }

  // ---------- Per-day metric extractors ----------

  function moodValue(entry) {
    if (!entry || !entry.mood) return null;
    const m = String(entry.mood).toLowerCase();
    const keys = Object.keys(MOOD_MAP);
    for (let i = 0; i < keys.length; i++) {
      if (m.indexOf(keys[i]) !== -1) return MOOD_MAP[keys[i]];
    }
    return null;
  }

  function weatherValue(entry) {
    if (!entry || !entry.weather) return null;
    return WEATHER_MAP.hasOwnProperty(entry.weather) ? WEATHER_MAP[entry.weather] : null;
  }

  function studyHoursValue(entry) {
    if (!entry) return null;
    const v = Number(entry.hoursStudied);
    return isNaN(v) ? null : v;
  }

  function questionsValue(entry) {
    if (!entry) return null;
    const v = Number(entry.questionsSolved);
    return isNaN(v) ? null : v;
  }

  // Productivity Score (0-10): normalized average of Mood, Study Hours, Questions Solved.
  // Weather is never included. Days with no journal activity at all return null (no data).
  function productivityValue(entry) {
    if (!entry) return null;
    const hasAny = entry.mood || (Number(entry.hoursStudied) > 0) || (Number(entry.questionsSolved) > 0);
    if (!hasAny) return null;

    const parts = [];
    const mv = moodValue(entry);
    if (mv !== null) parts.push((mv - 1) / 4 * 10); // 1..5 -> 0..10

    const sv = studyHoursValue(entry);
    if (sv !== null) parts.push(Math.min(10, (sv / STUDY_HOURS_CAP) * 10));

    const qv = questionsValue(entry);
    if (qv !== null) parts.push(Math.min(10, (qv / QUESTIONS_CAP) * 10));

    if (!parts.length) return null;
    const avg = parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
    return Math.max(0, Math.min(10, Math.round(avg * 10) / 10));
  }

  const METRICS = {
    mood: moodValue,
    weather: weatherValue,
    studyHours: studyHoursValue,
    questions: questionsValue,
    productivity: productivityValue
  };

  function getEntryFor(dateStr) {
    return JournalData.getEntry(dateStr);
  }

  // ---------- Weekly / Monthly / Yearly series builders ----------
  // metricKey is one of: 'mood' | 'weather' | 'studyHours' | 'questions' | 'productivity'

  // Weekly: Sun..Sat of the week containing refDate (default: today). One value per day.
  function getWeeklySeries(metricKey, refDateStr) {
    const metricFn = METRICS[metricKey];
    const ref = refDateStr ? parseDateStr(refDateStr) : new Date();
    const sunday = startOfWeek(ref);

    const labels = [];
    const values = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(sunday, i);
      const dateStr = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
      labels.push(DAY_NAMES[i] + ' ' + (d.getMonth() + 1) + '/' + d.getDate());
      values.push(metricFn(getEntryFor(dateStr)));
    }
    return { labels: labels, values: values };
  }

  // Monthly: the given month (default: current) chunked into 7-day weeks. One averaged value per week.
  function getMonthlySeries(metricKey, year, month) {
    const metricFn = METRICS[metricKey];
    const now = new Date();
    const y = (year !== undefined && year !== null) ? year : now.getFullYear();
    const m = (month !== undefined && month !== null) ? month : now.getMonth(); // 0-indexed
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const labels = [];
    const values = [];
    let weekIdx = 1;
    for (let startDay = 1; startDay <= daysInMonth; startDay += 7, weekIdx++) {
      const endDay = Math.min(startDay + 6, daysInMonth);
      const weekValues = [];
      for (let day = startDay; day <= endDay; day++) {
        weekValues.push(metricFn(getEntryFor(toDateStr(y, m, day))));
      }
      labels.push('Week ' + weekIdx);
      values.push(average(weekValues));
    }
    return { labels: labels, values: values };
  }

  // Yearly: the given year (default: current) split into 12 months. One averaged value per month.
  function getYearlySeries(metricKey, year) {
    const metricFn = METRICS[metricKey];
    const y = year || new Date().getFullYear();

    const labels = [];
    const values = [];
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const monthValues = [];
      for (let day = 1; day <= daysInMonth; day++) {
        monthValues.push(metricFn(getEntryFor(toDateStr(y, m, day))));
      }
      labels.push(MONTH_NAMES[m].slice(0, 3));
      values.push(average(monthValues));
    }
    return { labels: labels, values: values };
  }

  // period: 'weekly' | 'monthly' | 'yearly'
  function getSeries(metricKey, period) {
    if (period === 'monthly') return getMonthlySeries(metricKey);
    if (period === 'yearly') return getYearlySeries(metricKey);
    return getWeeklySeries(metricKey);
  }

  // ---------- Other Stats ----------

  function getAllEntriesList() {
    const all = JournalData.getAllEntries();
    return Object.keys(all).map(function (dateStr) {
      return { date: dateStr, entry: all[dateStr] };
    });
  }

  function getBestStudyStreak() {
    const result = Streak.recalc();
    return result.highScore || 0;
  }

  function getTotalStudyHours() {
    const list = getAllEntriesList();
    return Math.round(list.reduce(function (sum, item) {
      return sum + (studyHoursValue(item.entry) || 0);
    }, 0) * 10) / 10;
  }

  function getTotalQuestionsSolved() {
    const list = getAllEntriesList();
    return list.reduce(function (sum, item) {
      return sum + (questionsValue(item.entry) || 0);
    }, 0);
  }

  function getTotalTasks() {
    return PlannerData.getTasksList().length;
  }

  // A revision cycle only counts as completed once all 6 tasks (R1..R6) sharing its
  // cycleId are completed — individual finished revision tasks don't count on their own.
  function getTotalCompletedRevisionCycles() {
    const tasks = PlannerData.getTasksList().filter(function (t) { return t.taskType === 'revision'; });
    const byCycle = {};
    tasks.forEach(function (t) {
      if (!t.cycleId) return;
      if (!byCycle[t.cycleId]) byCycle[t.cycleId] = [];
      byCycle[t.cycleId].push(t);
    });

    let completedCycles = 0;
    Object.keys(byCycle).forEach(function (cycleId) {
      const revs = byCycle[cycleId];
      const labelsPresent = {};
      revs.forEach(function (t) { labelsPresent[t.revisionNumber] = t.completed; });
      const REVISION_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
      const allDone = REVISION_LABELS.every(function (label) {
        return labelsPresent.hasOwnProperty(label) && labelsPresent[label] === true;
      });
      if (allDone) completedCycles++;
    });
    return completedCycles;
  }

  function getHighestDailyStudyHours() {
    const list = getAllEntriesList();
    let best = null;
    list.forEach(function (item) {
      const v = studyHoursValue(item.entry);
      if (v !== null && (best === null || v > best.value)) best = { value: v, date: item.date };
    });
    return best;
  }

  function getHighestQuestionsInOneDay() {
    const list = getAllEntriesList();
    let best = null;
    list.forEach(function (item) {
      const v = questionsValue(item.entry);
      if (v !== null && (best === null || v > best.value)) best = { value: v, date: item.date };
    });
    return best;
  }

  // Most Productive Day considers only Mood, Study Hours, Questions Solved (never Weather).
  function getMostProductiveDay() {
    const list = getAllEntriesList();
    let best = null;
    list.forEach(function (item) {
      const v = productivityValue(item.entry);
      if (v !== null && (best === null || v > best.value)) best = { value: v, date: item.date };
    });
    return best;
  }

  function getOtherStats() {
    return {
      bestStudyStreak: getBestStudyStreak(),
      totalStudyHours: getTotalStudyHours(),
      totalQuestionsSolved: getTotalQuestionsSolved(),
      totalTasks: getTotalTasks(),
      totalCompletedRevisionCycles: getTotalCompletedRevisionCycles(),
      highestDailyStudyHours: getHighestDailyStudyHours(),
      highestQuestionsInOneDay: getHighestQuestionsInOneDay(),
      mostProductiveDay: getMostProductiveDay()
    };
  }

  return {
    moodValue: moodValue,
    weatherValue: weatherValue,
    studyHoursValue: studyHoursValue,
    questionsValue: questionsValue,
    productivityValue: productivityValue,

    getWeeklySeries: getWeeklySeries,
    getMonthlySeries: getMonthlySeries,
    getYearlySeries: getYearlySeries,
    getSeries: getSeries,

    getOtherStats: getOtherStats
  };
})();

