// dashboard.js — Dashboard screen shell (Phase 1+2: structure only, no functionality).
// Depends on: Nav (guarded). Load after nav.js. Owns the markup of #screen-dashboard.
// Holds no state and starts no timers. Nav.switchTo('dashboard') calls Dashboard.render();
// Dashboard.init() wires the existing Lavender sidebar plaque (.nav-brand) to open this screen
// without touching its markup or styling. Box bodies are empty containers for later phases.

const Dashboard = (function () {
  let bound = false;

  function box(cls, id, label, aria, hasBody) {
    return '<section class="dash-box ' + cls + '" id="' + id + '" aria-label="' + aria + '">' +
      (label ? '<span class="dash-label" aria-hidden="true">' + label + '</span>' : '') +
      (hasBody ? '<div class="dash-body"></div>' : '') +
      '</section>';
  }

  function markup() {
    return '<div class="dash">' +
      '<div class="dash-left">' +
        box('dash-entity', 'dash-entity', 'Entity', 'Entity area', false) +
        '<div class="dash-row dash-row-1">' +
          box('dash-b1', 'dash-reflection', 'Daily Reflection', 'Daily Reflection', true) +
          box('dash-b2', 'dash-custom', 'Custom Content', 'Custom Content', true) +
        '</div>' +
        '<div class="dash-row dash-row-2">' +
          box('dash-b3', 'dash-habits', 'Habits', 'Habits', true) +
          box('dash-b4', 'dash-personal', 'Personal Space', 'Personal Space', true) +
        '</div>' +
        '<div class="dash-row dash-row-3">' +
          box('dash-b5', 'dash-overview', 'Study Overview', 'Study Overview', true) +
          box('dash-b6', 'dash-analytics', 'Study Analytics', 'Study Analytics', true) +
        '</div>' +
      '</div>' +
      '<div class="dash-right">' +
        box('dash-b7', 'dash-calendar', '', 'Calendar and Upcoming', true) +
        box('dash-b8', 'dash-tasks', 'Tasks', 'Unified Task Workspace', true) +
      '</div>' +
    '</div>';
  }

  // Idempotent: builds the shell once, safe to call on every visit and after a backup restore.
  function render() {
    const root = document.getElementById('screen-dashboard');
    if (!root) return;
    if (!root.querySelector('.dash')) root.innerHTML = markup();
    const ctx = document.getElementById('nav-context-label');
    if (ctx) ctx.textContent = 'Dashboard';
    if (typeof DashboardCalendar !== 'undefined' && DashboardCalendar.render) DashboardCalendar.render();
  }

  // Binds the existing Lavender plaque once. Adds no attributes, classes or styles to it.
  function init() {
    if (bound) return;
    const brand = document.querySelector('#main-nav .nav-brand');
    if (!brand) return;
    bound = true;
    brand.addEventListener('click', function () {
      if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('dashboard');
    });
  }

  return { init, render };
})();
