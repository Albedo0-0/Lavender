// calendar.js — monthly grid + Date Hub modal (Feature 1). Depends on: State, Storage, DateHub, Modal, Nav.

const Calendar = (function () {
  let viewYear, viewMonth; // viewMonth is 0-indexed

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

  function render() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid || !label) return;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    label.textContent = monthNames[viewMonth] + ' ' + viewYear;

    grid.innerHTML = '';

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayStr();

    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) {
      const head = document.createElement('div');
      head.className = 'cal-head';
      head.textContent = d;
      grid.appendChild(head);
    });

    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-cell cal-blank';
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = toDateStr(viewYear, viewMonth, day);
      const hub = DateHub.get(dateStr);

      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (dateStr === today) cell.classList.add('cal-today');
      if (hub.color) cell.style.backgroundColor = hub.color;

      const dayNum = document.createElement('div');
      dayNum.className = 'cal-day-num';
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      if (Streak.qualifiesForFire(dateStr)) {
        const fire = document.createElement('span');
        fire.className = 'cal-fire';
        fire.textContent = '\uD83D\uDD25';
        cell.appendChild(fire);
      }

      if (hub.note) {
        const preview = document.createElement('div');
        preview.className = 'cal-note-preview';
        preview.textContent = hub.note.length > 20 ? hub.note.slice(0, 20) + '…' : hub.note;
        cell.appendChild(preview);
      }

      cell.addEventListener('click', function () {
        openDateHub(dateStr);
      });

      grid.appendChild(cell);
    }

    renderCountdown();
    renderStreak();
  }

  function renderTodoList(dateStr) {
    if (typeof PlannerData === 'undefined') return '<p class="datehub-todo-empty">No planner tasks.</p>';
    const tasks = PlannerData.getIncompleteTasksForDate(dateStr);
    if (tasks.length === 0) return '<p class="datehub-todo-empty">Nothing due.</p>';
    return '<ul class="datehub-todo-list">' +
      tasks.map(function (t) {
        return '<li class="datehub-todo-item">' +
          '<label>' +
            '<input type="checkbox" class="datehub-todo-check" data-task-id="' + t.taskId + '">' +
            ' ' + t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t) +
          '</label>' +
        '</li>';
      }).join('') +
    '</ul>';
  }

  function openDateHub(dateStr) {
    const hub = DateHub.get(dateStr);
    const html =
      '<div class="datehub">' +
        '<div class="datehub-header">' +
          '<h3>' + formatLong(dateStr) + '</h3>' +
          '<button id="datehub-close" class="datehub-close">&times;</button>' +
        '</div>' +
        '<label class="datehub-label">background</label>' +
        '<input type="color" id="datehub-color" value="' + (hub.color || '#ffffff') + '">' +
        '<label class="datehub-label">note</label>' +
        '<textarea id="datehub-note" rows="4">' + (hub.note || '') + '</textarea>' +
        '<label class="datehub-label">important date</label>' +
        '<div class="datehub-important-row">' +
          '<input type="checkbox" id="datehub-important"' + (hub.important ? ' checked' : '') + '>' +
          '<input type="text" id="datehub-important-label" placeholder="label (e.g. NEET, Birthday)" value="' + (hub.label || '') + '"' + (hub.important ? '' : ' disabled') + '>' +
        '</div>' +
        '<button id="datehub-save">Save</button>' +
        '<div class="datehub-todo-section">' +
          '<label class="datehub-label datehub-todo-heading">To Do</label>' +
          renderTodoList(dateStr) +
        '</div>' +
        '<div class="datehub-quicknav">' +
          '<button id="datehub-goto-journal">\uD83D\uDCD4 Journal</button>' +
          '<button id="datehub-goto-planner">\uD83D\uDCDA Planner</button>' +
        '</div>' +
      '</div>';

    Modal.open(html);

    document.getElementById('datehub-close').addEventListener('click', Modal.close);

    document.querySelectorAll('.datehub-todo-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        PlannerData.toggleComplete(cb.dataset.taskId);
        openDateHub(dateStr);
      });
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

    document.getElementById('datehub-important').addEventListener('change', function (e) {
      document.getElementById('datehub-important-label').disabled = !e.target.checked;
    });

    // Placeholder hooks — Journal/Planner tabs don't read the selected date yet.
    // Once those tabs exist, they should read this date from DateHub/State instead
    // of these buttons growing their own logic.
    document.getElementById('datehub-goto-journal').addEventListener('click', function () {
      Modal.close();
      Nav.switchTo('journal');
    });

    document.getElementById('datehub-goto-planner').addEventListener('click', function () {
      Modal.close();
      Nav.switchTo('planner');
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
      el.innerHTML = '<p class="countdown-empty">No important dates coming up.</p>';
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

  function next() {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  }

  function prev() {
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

    render();
  }

  return { init: init, render: render };
})();

