// calendar.js — monthly grid, month navigation, and the day-entry modal. Loaded after planner.js, before nav.js.

const Calendar = (function () {
  let viewYear;
  let viewMonth; // 0-indexed

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function init() {
    const today = new Date();
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    render();
  }

  function render() {
    const root = document.getElementById('screen-calendar');
    if (!root) return;
    root.innerHTML = '';

    root.appendChild(buildHeader());
    root.appendChild(buildGrid());
  }

  function buildHeader() {
    const header = document.createElement('div');
    header.className = 'calendar-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', function () {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      render();
    });

    const label = document.createElement('span');
    label.className = 'calendar-month-label';
    label.textContent = MONTH_NAMES[viewMonth] + ' ' + viewYear;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '›';
    nextBtn.addEventListener('click', function () {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      render();
    });

    header.appendChild(prevBtn);
    header.appendChild(label);
    header.appendChild(nextBtn);
    return header;
  }

  function buildGrid() {
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    WEEKDAY_NAMES.forEach(function (wd) {
      const cell = document.createElement('div');
      cell.className = 'calendar-weekday';
      cell.textContent = wd;
      grid.appendChild(cell);
    });

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const summary = Planner.getMonthSummary(viewYear, viewMonth);
    const todayStr = Planner.formatDate(new Date());

    for (let i = 0; i < startOffset; i++) {
      const blank = document.createElement('div');
      blank.className = 'calendar-day empty';
      grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = Planner.formatDate(new Date(viewYear, viewMonth, day));
      const cell = document.createElement('div');
      cell.className = 'calendar-day' + (dateStr === todayStr ? ' today' : '');

      const num = document.createElement('span');
      num.className = 'calendar-day-num';
      num.textContent = day;
      cell.appendChild(num);

      const dayInfo = summary[dateStr];
      if (dayInfo) {
        const dots = document.createElement('div');
        dots.className = 'calendar-day-dots';
        dayInfo.colors.forEach(function (color) {
          const dot = document.createElement('span');
          dot.className = 'day-dot';
          dot.style.backgroundColor = color;
          dots.appendChild(dot);
        });
        if (dayInfo.hasTasks) {
          const taskDot = document.createElement('span');
          taskDot.className = 'day-dot task-dot';
          dots.appendChild(taskDot);
        }
        cell.appendChild(dots);
      }

      cell.addEventListener('click', function () {
        openDayModal(dateStr);
      });

      grid.appendChild(cell);
    }

    return grid;
  }

  // --- Day modal ---

  function openDayModal(dateStr) {
    closeModal();

    const overlay = document.createElement('div');
    overlay.id = 'day-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    const modal = document.createElement('div');
    modal.className = 'modal-box';
    modal.appendChild(buildModalContent(dateStr));

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function buildModalContent(dateStr) {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('h3');
    title.textContent = dateStr;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.className = 'modal-close-btn';
    closeBtn.addEventListener('click', closeModal);
    header.appendChild(title);
    header.appendChild(closeBtn);
    wrap.appendChild(header);

    const entries = Planner.getEntriesForDate(dateStr);

    const revSection = document.createElement('div');
    revSection.className = 'modal-section';
    const revHeading = document.createElement('h4');
    revHeading.textContent = 'Revisions';
    revSection.appendChild(revHeading);

    if (entries.revisions.length === 0) {
      const none = document.createElement('p');
      none.className = 'modal-empty';
      none.textContent = 'No revisions scheduled.';
      revSection.appendChild(none);
    } else {
      const list = document.createElement('ul');
      list.className = 'revision-list';
      entries.revisions.forEach(function (rev) {
        const li = document.createElement('li');
        li.className = 'revision-item' + (rev.completed ? ' completed' : '');

        const dot = document.createElement('span');
        dot.className = 'chapter-color-dot';
        dot.style.backgroundColor = rev.chapterColor;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rev.completed;
        checkbox.addEventListener('change', function () {
          Planner.toggleRevisionComplete(rev.id);
          refreshModal(dateStr);
          render();
        });

        const label = document.createElement('span');
        label.textContent = ' ' + rev.chapterName + ' — r' + rev.number;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '✕';
        delBtn.className = 'revision-delete-btn';
        delBtn.addEventListener('click', function () {
          Planner.deleteRevision(rev.id);
          refreshModal(dateStr);
          render();
        });

        li.appendChild(dot);
        li.appendChild(checkbox);
        li.appendChild(label);
        li.appendChild(delBtn);
        list.appendChild(li);
      });
      revSection.appendChild(list);
    }
    wrap.appendChild(revSection);

    const taskSection = document.createElement('div');
    taskSection.className = 'modal-section';
    const taskHeading = document.createElement('h4');
    taskHeading.textContent = 'Tasks';
    taskSection.appendChild(taskHeading);

    const taskList = document.createElement('ul');
    taskList.className = 'task-list';
    entries.tasks.forEach(function (task) {
      const li = document.createElement('li');
      li.className = 'task-item' + (task.completed ? ' completed' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.addEventListener('change', function () {
        Planner.toggleTaskComplete(task.id);
        refreshModal(dateStr);
        render();
      });

      const label = document.createElement('span');
      label.textContent = ' ' + task.text;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.className = 'task-delete-btn';
      delBtn.addEventListener('click', function () {
        Planner.deleteTask(task.id);
        refreshModal(dateStr);
        render();
      });

      li.appendChild(checkbox);
      li.appendChild(label);
      li.appendChild(delBtn);
      taskList.appendChild(li);
    });
    taskSection.appendChild(taskList);

    const addTaskForm = document.createElement('form');
    addTaskForm.className = 'add-task-form';
    const taskInput = document.createElement('input');
    taskInput.type = 'text';
    taskInput.placeholder = 'New task';
    taskInput.required = true;
    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.textContent = 'Add';
    addTaskForm.appendChild(taskInput);
    addTaskForm.appendChild(addBtn);
    addTaskForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!taskInput.value.trim()) return;
      Planner.addTask(dateStr, taskInput.value.trim());
      refreshModal(dateStr);
      render();
    });
    taskSection.appendChild(addTaskForm);

    wrap.appendChild(taskSection);

    return wrap;
  }

  function refreshModal(dateStr) {
    const overlay = document.getElementById('day-modal-overlay');
    if (!overlay) return;
    const modal = overlay.querySelector('.modal-box');
    modal.innerHTML = '';
    modal.appendChild(buildModalContent(dateStr));
  }

  function closeModal() {
    const overlay = document.getElementById('day-modal-overlay');
    if (overlay) overlay.remove();
  }

  return { init: init, render: render };
})();
