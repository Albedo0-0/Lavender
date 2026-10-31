// dashboard-calendar.js — Dashboard Box 7: compact month calendar + upcoming events (Phase 3A).
// A VIEW over existing data: events come from DateHub (getAll / getEvents), the day modal is
// Calendar.openDateHub (the same one the Calendar tab's month cells open), and the month title hands
// off to Calendar.showMonth + Nav.switchTo('calendar'). It owns no event storage and no modal.
// Only local UI state: the month being shown and the date last opened from here (not persisted).
// Depends on: DateHub, Calendar, Nav (all calls guarded). Load after dashboard.js.

const DashboardCalendar = (function () {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let viewYear = null;
  let viewMonth = null; // 0-indexed
  let selected = null;  // 'YYYY-MM-DD' of the date last opened from this box

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function host() { return document.querySelector('#dash-calendar .dash-body'); }

  function longDate(ds) {
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function shortDate(ds, today) {
    if (ds === today) return 'Today';
    const t = new Date(today + 'T00:00:00');
    t.setDate(t.getDate() + 1);
    if (ds === toDateStr(t.getFullYear(), t.getMonth(), t.getDate())) return 'Tomorrow';
    const d = new Date(ds + 'T00:00:00');
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
  }

  function hasEvents(ds) {
    return typeof DateHub !== 'undefined' && DateHub.getEvents(ds).length > 0;
  }

  function shellHtml() {
    return '<div class="dcal">' +
        '<div class="dcal-head">' +
          '<button type="button" class="dcal-nav" data-dir="-1" aria-label="Previous month">&#8592;</button>' +
          '<button type="button" class="dcal-title"></button>' +
          '<button type="button" class="dcal-nav" data-dir="1" aria-label="Next month">&#8594;</button>' +
        '</div>' +
        '<div class="dcal-weekdays" aria-hidden="true">' +
          WEEKDAYS.map(function (w) { return '<span>' + w + '</span>'; }).join('') +
        '</div>' +
        '<div class="dcal-grid"></div>' +
      '</div>' +
      '<div class="dcal-events">' +
        '<span class="dash-label">Upcoming</span>' +
        '<div class="dcal-list"></div>' +
      '</div>';
  }

  function drawEvents(body) {
    const list = body.querySelector('.dcal-list');
    if (!list) return;
    if (typeof DateHub === 'undefined') { list.innerHTML = ''; return; }
    const today = todayStr();
    const monthStart = toDateStr(viewYear, viewMonth, 1);
    // Never earlier than today (past events are hidden); browsing a later month lists from that month on.
    const from = monthStart > today ? monthStart : today;
    const hubs = DateHub.getAll();
    const rows = [];
    Object.keys(hubs)
      .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from; })
      .sort()
      .forEach(function (d) {
        DateHub.getEvents(d).forEach(function (ev) { rows.push({ date: d, ev: ev }); });
      });
    list.innerHTML = rows.length
      ? rows.map(function (r) {
          return '<div class="dcal-event">' +
            '<span class="dcal-ev-date">' + esc(shortDate(r.date, today)) + '</span>' +
            '<span class="dcal-ev-title">' + esc(r.ev.title) + '</span>' +
            (r.ev.tag ? '<span class="dcal-ev-tag">' + esc(r.ev.tag) + '</span>' : '') +
          '</div>';
        }).join('')
      : '<p class="dcal-empty">No upcoming events</p>';
  }

  function draw() {
    const body = host();
    if (!body || !body.querySelector('.dcal') || viewYear === null) return;
    const title = body.querySelector('.dcal-title');
    title.textContent = MONTHS[viewMonth] + ' ' + viewYear;
    title.setAttribute('aria-label', 'Open ' + title.textContent + ' in Calendar');

    const today = todayStr();
    const first = new Date(viewYear, viewMonth, 1).getDay(); // Sunday-first
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = i - first + 1;
      if (d < 1 || d > dim) { cells += '<span class="dcal-day dcal-blank" aria-hidden="true"></span>'; continue; }
      const ds = toDateStr(viewYear, viewMonth, d);
      const has = hasEvents(ds);
      cells += '<button type="button" class="dcal-day' +
        (ds === today ? ' dcal-today' : '') + (ds === selected ? ' dcal-sel' : '') + (has ? ' dcal-has' : '') +
        '" data-date="' + ds + '"' + (ds === today ? ' aria-current="date"' : '') +
        ' aria-label="' + esc(longDate(ds)) + (has ? ', has events' : '') + '">' + d + '</button>';
    }
    body.querySelector('.dcal-grid').innerHTML = cells;
    drawEvents(body);
  }

  function shift(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    else if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    draw();
  }

  // Opens the existing DateHub (DayHub) modal — the same one the Calendar tab's month cells open.
  function openDay(ds) {
    if (typeof Modal !== 'undefined' && Modal.isLocked && Modal.isLocked()) return;
    selected = ds;
    draw();
    if (typeof Calendar !== 'undefined' && Calendar.openDateHub) Calendar.openDateHub(ds);
  }

  // Lands on the Calendar tab's month view at the month shown here.
  function openMonthInCalendar() {
    if (typeof Calendar !== 'undefined' && Calendar.showMonth) Calendar.showMonth(viewYear, viewMonth);
    if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('calendar');
  }

  // One delegated listener, attached only when the shell is built (never duplicated on re-render).
  function bind(body) {
    body.addEventListener('click', function (e) {
      const nav = e.target.closest('.dcal-nav');
      if (nav) { shift(Number(nav.getAttribute('data-dir'))); return; }
      if (e.target.closest('.dcal-title')) { openMonthInCalendar(); return; }
      const day = e.target.closest('.dcal-day[data-date]');
      if (day) openDay(day.getAttribute('data-date'));
    });
  }

  // Idempotent: builds the shell once, then redraws from current data.
  function render() {
    const body = host();
    if (!body) return;
    if (viewYear === null) {
      const n = new Date();
      viewYear = n.getFullYear();
      viewMonth = n.getMonth();
    }
    if (!body.querySelector('.dcal')) {
      body.innerHTML = shellHtml();
      bind(body);
    }
    draw();
  }

  // Called by Calendar.render() so edits made in the DayHub modal show up here at once.
  function refresh() { draw(); }

  return { render: render, refresh: refresh };
})();
