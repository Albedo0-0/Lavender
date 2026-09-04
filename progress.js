// progress.js — Progress tab UI. Depends on: State, ProgressData.
// Builds into #screen-progress (see index.html). PART 1: sidebar framework + Mood, Weather, Study Hours.
// PART 2 (separate patch) will add Questions, Productivity, Other Stats sections to this same file.

const Progress = (function () {
  const SECTIONS = [
    { key: 'mood', label: 'Mood' },
    { key: 'weather', label: 'Weather' },
    { key: 'studyHours', label: 'Study Hours' },
    { key: 'questions', label: 'Questions' },
    { key: 'productivity', label: 'Productivity' },
    { key: 'other', label: 'Other Stats' }
  ];

  let activeSection = 'mood';
  // Remembers the last chosen period per graph section so switching sections doesn't reset it.
  let activePeriod = { mood: 'weekly', weather: 'weekly', studyHours: 'weekly', questions: 'weekly', productivity: 'weekly' };

  // ---------- Layout shell ----------

  function renderShell() {
    const root = document.getElementById('screen-progress');
    if (!root) return;
    root.innerHTML =
      '<div id="progress-layout">' +
        '<div id="progress-sidebar"></div>' +
        '<div id="progress-main"></div>' +
      '</div>';

    const sidebar = document.getElementById('progress-sidebar');
    sidebar.innerHTML = SECTIONS.map(function (s) {
      return '<button class="progress-nav-btn" data-section="' + s.key + '">' + s.label + '</button>';
    }).join('');

    sidebar.querySelectorAll('.progress-nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeSection = btn.dataset.section;
        render();
      });
    });
  }

  // ---------- Generic graph section (Mood / Weather / Study Hours / Questions / Productivity) ----------

  function periodTabsHtml(sectionKey) {
    const period = activePeriod[sectionKey];
    return '<div class="progress-period-tabs">' +
      ['weekly', 'monthly', 'yearly'].map(function (p) {
        return '<button class="progress-period-btn' + (p === period ? ' active' : '') +
          '" data-period="' + p + '">' + p.charAt(0).toUpperCase() + p.slice(1) + '</button>';
      }).join('') +
      '</div>';
  }

  // Fixed axis maximums for bounded metrics; unbounded metrics (study hours, questions) get a
  // dynamic max based on the data itself so bars stay readable regardless of scale.
  function chartMax(metricKey, values) {
    if (metricKey === 'mood') return 5;
    if (metricKey === 'weather') return 4;
    if (metricKey === 'productivity') return 10;
    const nums = values.filter(function (v) { return v !== null && v !== undefined; });
    const max = nums.length ? Math.max.apply(null, nums) : 0;
    return Math.max(1, Math.ceil(max));
  }

  function renderBarChart(series, metricKey) {
    const max = chartMax(metricKey, series.values);
    const bars = series.values.map(function (v, i) {
      const pct = (v === null || v === undefined) ? 0 : Math.max(2, Math.round((v / max) * 100));
      const valLabel = (v === null || v === undefined) ? '\u2013' : v;
      return '<div class="progress-bar-col">' +
        '<div class="progress-bar-value">' + valLabel + '</div>' +
        '<div class="progress-bar-track"><div class="progress-bar-fill" style="height:' + pct + '%"></div></div>' +
        '<div class="progress-bar-label">' + series.labels[i] + '</div>' +
      '</div>';
    }).join('');
    return '<div class="progress-chart">' + bars + '</div>';
  }

  function renderGraphSection(container, title, metricKey) {
    const period = activePeriod[metricKey];
    const series = ProgressData.getSeries(metricKey, period);

    container.innerHTML =
      '<h2 class="progress-section-title">' + title + '</h2>' +
      periodTabsHtml(metricKey) +
      '<div id="progress-chart-holder">' + renderBarChart(series, metricKey) + '</div>';

    container.querySelectorAll('.progress-period-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activePeriod[metricKey] = btn.dataset.period;
        renderGraphSection(container, title, metricKey);
      });
    });
  }

  // ---------- Main render dispatch ----------

  function render() {
    document.querySelectorAll('.progress-nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.section === activeSection);
    });

    const main = document.getElementById('progress-main');
    if (!main) return;

    if (activeSection === 'mood') {
      renderGraphSection(main, 'Mood', 'mood');
    } else if (activeSection === 'weather') {
      renderGraphSection(main, 'Weather', 'weather');
    } else if (activeSection === 'studyHours') {
      renderGraphSection(main, 'Study Hours', 'studyHours');
    } else if (activeSection === 'questions') {
      main.innerHTML = '<h2 class="progress-section-title">Questions</h2><p class="progress-placeholder">Coming in Part 2.</p>';
    } else if (activeSection === 'productivity') {
      main.innerHTML = '<h2 class="progress-section-title">Productivity</h2><p class="progress-placeholder">Coming in Part 2.</p>';
    } else if (activeSection === 'other') {
      main.innerHTML = '<h2 class="progress-section-title">Other Stats</h2><p class="progress-placeholder">Coming in Part 2.</p>';
    }
  }

  function init() {
    renderShell();
    render();
  }

  return { init: init, render: function () { renderShell(); render(); } };
})();

