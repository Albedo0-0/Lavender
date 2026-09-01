// planner.js — chapters, spaced-repetition revisions, and tasks. Loaded after state.js, before calendar.js.

const Planner = (function () {
  const REVISION_OFFSETS = [1, 3, 7, 14, 30];

  const CHAPTER_COLORS = [
    '#F4A6C1', '#F7C59F', '#F9E29C', '#B5E8B0',
    '#A0D8D3', '#A6C8F0', '#C7B8EA', '#E8B4D8'
  ];

  function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function formatDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseDate(str) {
    const parts = str.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(dateStr, days) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatDate(d);
  }

  // --- Chapters ---

  function addChapter(name, color, baseDate) {
    const state = State.get();
    const chapter = {
      id: makeId('ch'),
      name: name,
      color: color,
      baseDate: baseDate,
      createdAt: Date.now()
    };
    const chapters = state.chapters.concat([chapter]);
    const newRevisions = REVISION_OFFSETS.map(function (offset, idx) {
      return {
        id: makeId('rev'),
        chapterId: chapter.id,
        number: idx + 1,
        date: addDays(baseDate, offset),
        completed: false
      };
    });
    const revisions = state.revisions.concat(newRevisions);
    State.set({ chapters: chapters, revisions: revisions });
    return chapter;
  }

  function deleteChapter(chapterId) {
    const state = State.get();
    State.set({
      chapters: state.chapters.filter(function (c) { return c.id !== chapterId; }),
      revisions: state.revisions.filter(function (r) { return r.chapterId !== chapterId; })
    });
  }

  function getChapter(chapterId) {
    return State.get().chapters.find(function (c) { return c.id === chapterId; });
  }

  // --- Revisions ---

  function toggleRevisionComplete(revisionId) {
    const state = State.get();
    const revisions = state.revisions.map(function (r) {
      if (r.id === revisionId) return Object.assign({}, r, { completed: !r.completed });
      return r;
    });
    State.set({ revisions: revisions });
  }

  function deleteRevision(revisionId) {
    const state = State.get();
    State.set({
      revisions: state.revisions.filter(function (r) { return r.id !== revisionId; })
    });
  }

  // --- Tasks ---

  function addTask(date, text) {
    const state = State.get();
    const task = {
      id: makeId('task'),
      date: date,
      text: text,
      completed: false
    };
    State.set({ tasks: state.tasks.concat([task]) });
    return task;
  }

  function toggleTaskComplete(taskId) {
    const state = State.get();
    const tasks = state.tasks.map(function (t) {
      if (t.id === taskId) return Object.assign({}, t, { completed: !t.completed });
      return t;
    });
    State.set({ tasks: tasks });
  }

  function deleteTask(taskId) {
    const state = State.get();
    State.set({
      tasks: state.tasks.filter(function (t) { return t.id !== taskId; })
    });
  }

  // --- Queries ---

  // Entries for one date (used by Calendar's day modal)
  function getEntriesForDate(dateStr) {
    const state = State.get();
    const revisions = state.revisions
      .filter(function (r) { return r.date === dateStr; })
      .map(function (r) {
        const chapter = getChapter(r.chapterId);
        return Object.assign({}, r, {
          chapterName: chapter ? chapter.name : '(deleted chapter)',
          chapterColor: chapter ? chapter.color : '#ccc'
        });
      });
    const tasks = state.tasks.filter(function (t) { return t.date === dateStr; });
    return { revisions: revisions, tasks: tasks };
  }

  // { 'YYYY-MM-DD': { colors: [...], hasTasks: bool } } for one month (used by Calendar dots)
  function getMonthSummary(year, month) {
    const state = State.get();
    const summary = {};
    state.revisions.forEach(function (r) {
      const d = parseDate(r.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        if (!summary[r.date]) summary[r.date] = { colors: [], hasTasks: false };
        const chapter = getChapter(r.chapterId);
        summary[r.date].colors.push(chapter ? chapter.color : '#ccc');
      }
    });
    state.tasks.forEach(function (t) {
      const d = parseDate(t.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        if (!summary[t.date]) summary[t.date] = { colors: [], hasTasks: false };
        summary[t.date].hasTasks = true;
      }
    });
    return summary;
  }

  // --- Rendering: Planner screen (timetable + chapter management) ---

  function render() {
    const root = document.getElementById('screen-planner');
    if (!root) return;
    const state = State.get();

    root.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Planner';
    root.appendChild(heading);

    root.appendChild(buildTimetable(state));

    const chapterHeading = document.createElement('h3');
    chapterHeading.textContent = 'Chapters';
    root.appendChild(chapterHeading);

    root.appendChild(buildChapterForm());
    root.appendChild(buildChapterList(state));
  }

  function buildTimetable(state) {
    const wrap = document.createElement('div');
    wrap.className = 'timetable';

    const heading = document.createElement('h3');
    heading.textContent = 'Timetable';
    wrap.appendChild(heading);

    const items = [];
    state.revisions.forEach(function (r) {
      const chapter = getChapter(r.chapterId);
      items.push({
        type: 'revision',
        date: r.date,
        id: r.id,
        completed: r.completed,
        label: (chapter ? chapter.name : '(deleted chapter)') + ' — r' + r.number,
        color: chapter ? chapter.color : '#ccc'
      });
    });
    state.tasks.forEach(function (t) {
      items.push({
        type: 'task',
        date: t.date,
        id: t.id,
        completed: t.completed,
        label: t.text,
        color: null
      });
    });

    items.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Nothing scheduled yet.';
      wrap.appendChild(empty);
      return wrap;
    }

    const list = document.createElement('ul');
    list.className = 'timetable-list';

    items.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'timetable-item' + (item.completed ? ' completed' : '');

      const dateLabel = document.createElement('span');
      dateLabel.className = 'timetable-date';
      dateLabel.textContent = item.date;

      const dot = document.createElement('span');
      if (item.color) {
        dot.className = 'chapter-color-dot';
        dot.style.backgroundColor = item.color;
      } else {
        dot.className = 'day-dot task-dot';
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.completed;
      checkbox.addEventListener('change', function () {
        if (item.type === 'revision') toggleRevisionComplete(item.id);
        else toggleTaskComplete(item.id);
        render();
        if (window.Calendar) Calendar.render();
      });

      const label = document.createElement('span');
      label.textContent = ' ' + item.label;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.className = item.type === 'revision' ? 'revision-delete-btn' : 'task-delete-btn';
      delBtn.addEventListener('click', function () {
        if (item.type === 'revision') deleteRevision(item.id);
        else deleteTask(item.id);
        render();
        if (window.Calendar) Calendar.render();
      });

      li.appendChild(dateLabel);
      li.appendChild(dot);
      li.appendChild(checkbox);
      li.appendChild(label);
      li.appendChild(delBtn);
      list.appendChild(li);
    });

    wrap.appendChild(list);
    return wrap;
  }

  function buildChapterForm() {
    const form = document.createElement('form');
    form.className = 'chapter-form';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Chapter name';
    nameInput.required = true;
    nameInput.className = 'chapter-name-input';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.required = true;
    dateInput.className = 'chapter-date-input';
    dateInput.value = formatDate(new Date());

    const colorWrap = document.createElement('div');
    colorWrap.className = 'color-swatch-picker';
    let selectedColor = CHAPTER_COLORS[0];
    CHAPTER_COLORS.forEach(function (color, idx) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch' + (idx === 0 ? ' selected' : '');
      swatch.style.backgroundColor = color;
      swatch.addEventListener('click', function () {
        selectedColor = color;
        colorWrap.querySelectorAll('.color-swatch').forEach(function (el) {
          el.classList.remove('selected');
        });
        swatch.classList.add('selected');
      });
      colorWrap.appendChild(swatch);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Add chapter';

    form.appendChild(nameInput);
    form.appendChild(dateInput);
    form.appendChild(colorWrap);
    form.appendChild(submitBtn);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!nameInput.value.trim() || !dateInput.value) return;
      addChapter(nameInput.value.trim(), selectedColor, dateInput.value);
      render();
      if (window.Calendar) Calendar.render();
    });

    return form;
  }

  function buildChapterList(state) {
    const wrap = document.createElement('div');
    wrap.className = 'chapter-list';

    if (state.chapters.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No chapters yet — add one above.';
      wrap.appendChild(empty);
      return wrap;
    }

    state.chapters.forEach(function (chapter) {
      const card = document.createElement('div');
      card.className = 'chapter-card';

      const header = document.createElement('div');
      header.className = 'chapter-card-header';

      const dot = document.createElement('span');
      dot.className = 'chapter-color-dot';
      dot.style.backgroundColor = chapter.color;

      const title = document.createElement('strong');
      title.textContent = chapter.name;

      const baseDateLabel = document.createElement('span');
      baseDateLabel.className = 'chapter-base-date';
      baseDateLabel.textContent = ' (base: ' + chapter.baseDate + ')';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete chapter';
      deleteBtn.className = 'chapter-delete-btn';
      deleteBtn.addEventListener('click', function () {
        deleteChapter(chapter.id);
        render();
        if (window.Calendar) Calendar.render();
      });

      header.appendChild(dot);
      header.appendChild(title);
      header.appendChild(baseDateLabel);
      header.appendChild(deleteBtn);
      card.appendChild(header);

      const revList = document.createElement('ul');
      revList.className = 'revision-list';

      const revisions = state.revisions
        .filter(function (r) { return r.chapterId === chapter.id; })
        .sort(function (a, b) { return a.number - b.number; });

      revisions.forEach(function (rev) {
        const li = document.createElement('li');
        li.className = 'revision-item' + (rev.completed ? ' completed' : '');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = rev.completed;
        checkbox.addEventListener('change', function () {
          toggleRevisionComplete(rev.id);
          render();
          if (window.Calendar) Calendar.render();
        });

        const label = document.createElement('span');
        label.textContent = ' r' + rev.number + ' — ' + rev.date;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '✕';
        delBtn.className = 'revision-delete-btn';
        delBtn.addEventListener('click', function () {
          deleteRevision(rev.id);
          render();
          if (window.Calendar) Calendar.render();
        });

        li.appendChild(checkbox);
        li.appendChild(label);
        li.appendChild(delBtn);
        revList.appendChild(li);
      });

      card.appendChild(revList);
      wrap.appendChild(card);
    });

    return wrap;
  }

  function init() {
    render();
  }

  return {
    init: init,
    render: render,
    addChapter: addChapter,
    deleteChapter: deleteChapter,
    getChapter: getChapter,
    toggleRevisionComplete: toggleRevisionComplete,
    deleteRevision: deleteRevision,
    addTask: addTask,
    toggleTaskComplete: toggleTaskComplete,
    deleteTask: deleteTask,
    getEntriesForDate: getEntriesForDate,
    getMonthSummary: getMonthSummary,
    formatDate: formatDate,
    parseDate: parseDate
  };
})();
