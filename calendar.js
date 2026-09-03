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
        '<button id="datehub-save">Save</button>' +
        '<div class="datehub-quicknav">' +
          '<button id="datehub-goto-journal">\uD83D\uDCD4 Journal</button>' +
          '<button id="datehub-goto-planner">\uD83D\uDCDA Planner</button>' +
        '</div>' +
      '</div>';

    Modal.open(html);

    document.getElementById('datehub-close').addEventListener('click', Modal.close);

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

