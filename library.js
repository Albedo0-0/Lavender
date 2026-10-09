// library.js — Library screen: single home for the topic collection (Cleanup Item 1).
// Depends on: State, PlanData, Modal, Planner, Nav. Topic-scoped Links live here (Cleanup Item 4).

const Library = (function () {
  let view = 'subjects'; // 'subjects' | 'chapters' | 'chapter'
  let activeSubject = null;
  let activeTopicId = null;
  const PANEL_TABS = ['subjects', 'today', 'pending', 'history', 'upcoming', 'targets', 'archived'];
  let panelTabIdx = 0;
  let sortMode = 'alpha'; // 'focus' | 'new' | 'alpha' (view state only; the subject list stays canonical in PlanData)
  let searchQuery = ''; // one search value shared by the subject view and the topic view
  let searchOpen = false;
  let panelCollapsed = false;
  let historyFilterTopicId = null; // set when History is opened from a chapter's action row
  let chapterBackView = 'chapters'; // where the chapter view's Back button should return to
  let selectedFilterTagIds = [];
  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }

  function toggleFavoriteTopic(topicId) {
    const favs = State.get().favoriteTopics || [];
    const idx = favs.indexOf(topicId);
    const updated = idx === -1 ? favs.concat([topicId]) : favs.filter(function (id) { return id !== topicId; });
    State.set({ favoriteTopics: updated });
  }

  function render() {
    const container = document.getElementById('library-body');
    if (!container) return;
    if (view === 'chapters') renderChapters(container);
    else if (view === 'chapter') renderChapter(container);
    else renderSubjects(container);
    if (PANEL_TABS[panelTabIdx] === 'subjects') renderRightPanel(); // keep the side-panel navigator in step with the main view
  }

  function showView(nextView) {
    if (nextView !== view) { searchQuery = ''; searchOpen = false; }
    view = nextView;
    render();
  }

  function openSubject(subject) {
    activeSubject = subject;
    activeTopicId = null;
    searchQuery = '';
    searchOpen = false;
    showView('chapters');
  }
  
  const TILE_ACCENTS = ['--color-sage-300', '--color-kraft-400', '--color-sage-600', '--color-kraft-500', '--color-accent-rust-soft'];
  const SORT_NAMES = { focus: 'Least focused subject', 'new': 'Newly added', alpha: 'Alphabetical' };
  const SORT_LABELS = { focus: 'Least focused', 'new': 'Newest', alpha: 'A\u2013Z' };

  function subjectAccent(subject) {
    let sum = 0;
    for (let i = 0; i < subject.length; i++) sum += subject.charCodeAt(i);
    return TILE_ACCENTS[sum % TILE_ACCENTS.length];
  }

  // Focus = actual study time (TimeEngine session records) grouped by the subject of the task each
  // session belonged to. Read-only derivation, nothing stored. TimeEngine keeps per-session detail
  // only for its retention window (older days are rolled into subject-less daily summaries), so this
  // reflects recent focus. Standalone stopwatch/timer records have no task and are not counted.
  function getSubjectFocusMs() {
    const recs = State.get().sessionRecords || {};
    const out = {};
    Object.keys(recs).forEach(function (id) {
      const r = recs[id];
      if (!r || !r.taskId || !r.studyMs) return;
            const task = PlanningAgent.getTask(r.taskId);
      if (!task || !task.subject) return;
      out[task.subject] = (out[task.subject] || 0) + r.studyMs;
    });
    return out;
  }

  // The ONE ordering of the canonical subject list (PlanData.getAllSubjects) used by both the
  // main collection and the side-panel navigator. getAllSubjects() is in the order subjects were added.
  function getSortedSubjects() {
    const base = PlanData.getAllSubjects();
    const order = {};
    base.forEach(function (s, i) { order[s] = i; });
    const list = base.slice();
    if (sortMode === 'alpha') {
      list.sort(function (a, b) { return a.localeCompare(b); });
    } else if (sortMode === 'new') {
      list.sort(function (a, b) { return order[b] - order[a]; });
    } else {
      const focus = getSubjectFocusMs();
      list.sort(function (a, b) { return ((focus[a] || 0) - (focus[b] || 0)) || a.localeCompare(b); });
    }
    return list;
  }

  function getSubjectStats() {
    const due = {};
        PlanningAgent.getTodayTasks().concat(PlanningAgent.getPendingTasks()).forEach(function (t) {
      if (t.subject) due[t.subject] = (due[t.subject] || 0) + 1;
    });
    return { grouped: PlanData.getTopicsBySubject(), due: due };
  }

  // Compact overflow / action sheet built on the shared Modal (no second popup system).
  function openMenu(title, items) {
    Modal.open(
      '<h3 class="section-heading">' + esc(title) + '</h3>' +
      '<div class="library-menu">' + items.map(function (it, i) {
        return '<button class="library-menu-item btn ' + (it.danger ? 'btn-danger' : 'btn-secondary') + '" data-idx="' + i + '">' + esc(it.label) + '</button>';
      }).join('') + '</div>',
      { size: 'sm' }
    );
    document.querySelectorAll('#modal-content .library-menu-item').forEach(function (b) {
      b.addEventListener('click', function () {
        const item = items[Number(b.dataset.idx)];
        Modal.close();
        if (item) item.run();
      });
    });
  }

  function afterSubjectChange(renamed, removed) {
    if (typeof Planner !== 'undefined' && Planner.refreshSubjectOptions) Planner.refreshSubjectOptions(renamed);
    if (renamed && activeSubject === renamed.from) activeSubject = renamed.to;
    if (removed && activeSubject === removed && view !== 'subjects') { view = 'subjects'; activeTopicId = null; }
    render();
    if (renamed) renderRightPanel(); // task rows in the side panel show the subject name
  }

  function openAddSubjectModal() {
    Modal.open(
      '<h3 class="section-heading">New subject</h3>' +
      '<input type="text" id="library-add-subject-input" class="input" placeholder="Subject name" maxlength="40">' +
      '<p id="library-add-subject-error" class="planner-empty" style="display:none;"></p>' +
      '<button id="library-add-subject-confirm" class="btn btn-primary">Add</button>' +
      '<button id="library-add-subject-cancel" class="btn btn-secondary">Cancel</button>',
      { size: 'sm' }
    );
    const input = document.getElementById('library-add-subject-input');
    const errEl = document.getElementById('library-add-subject-error');
    if (!input) return;
    function confirmAdd() {
      const result = PlanData.addSubject(input.value);
      if (!result.ok) { errEl.textContent = result.error; errEl.style.display = 'block'; return; }
      Modal.close();
      afterSubjectChange();
    }
    document.getElementById('library-add-subject-confirm').addEventListener('click', confirmAdd);
    document.getElementById('library-add-subject-cancel').addEventListener('click', function () { Modal.close(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmAdd(); });
    input.focus();
  }

  function openRenameSubject(subject) {
    Modal.open(
      '<h3 class="section-heading">Rename subject</h3>' +
      '<p>Current name: <strong>' + esc(subject) + '</strong>. Its chapters, tasks and history move to the new name.</p>' +
      '<input type="text" id="library-rename-subject-input" class="input" maxlength="40" value="' + esc(subject) + '">' +
      '<p id="library-rename-subject-error" class="planner-empty" style="display:none;"></p>' +
      '<button id="library-rename-subject-confirm" class="btn btn-primary">Rename</button>' +
      '<button id="library-rename-subject-cancel" class="btn btn-secondary">Cancel</button>'
    );
    const input = document.getElementById('library-rename-subject-input');
    const errEl = document.getElementById('library-rename-subject-error');
    if (!input) return;
    function confirmRename() {
      const result = PlanData.renameSubject(subject, input.value);
      if (!result.ok) { errEl.textContent = result.error; errEl.style.display = 'block'; return; }
      Modal.close();
      afterSubjectChange(result.unchanged ? null : { from: subject, to: result.subject });
    }
    document.getElementById('library-rename-subject-confirm').addEventListener('click', confirmRename);
    document.getElementById('library-rename-subject-cancel').addEventListener('click', function () { Modal.close(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmRename(); });
    input.focus();
    input.select();
  }

  function openDeleteSubject(subject) {
    const usage = PlanData.getSubjectUsage(subject);
    const kept = (usage.topics || usage.tasks)
      ? ' Its ' + usage.topics + ' chapter(s) and ' + usage.tasks + ' task(s) stay as history and remain visible under Removed subjects.'
      : '';
    Modal.open(
      '<h3 class="section-heading">Delete subject "' + esc(subject) + '"?</h3>' +
      '<p>It will no longer be offered for new tasks, sessions or itinerary items.' + kept + ' Add it again later to pick that history back up.</p>' +
      '<button id="library-delete-subject-confirm" class="btn btn-danger">Delete</button>' +
      '<button id="library-delete-subject-cancel" class="btn btn-secondary">Cancel</button>'
    );
    const confirmBtn = document.getElementById('library-delete-subject-confirm');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('click', function () {
      PlanData.removeSubject(subject);
      Modal.close();
      afterSubjectChange(null, subject);
    });
    document.getElementById('library-delete-subject-cancel').addEventListener('click', function () { Modal.close(); });
  }

  function openSubjectMenu(subject, includeOpen) {
    const items = [];
    if (includeOpen) items.push({ label: 'Open', run: function () { openSubject(subject); } });
    items.push({ label: 'Rename', run: function () { openRenameSubject(subject); } });
    items.push({ label: 'Delete', danger: true, run: function () { openDeleteSubject(subject); } });
    openMenu(subject, items);
  }

  // Planning new work always goes through the central Planning Agent UI.
  // chapterId === topicId, so the Library's topic is passed straight through as topicId.
  function openPlan(subject, topicId) {
    if (typeof Modal.isLocked === 'function' && Modal.isLocked()) return;
        if (typeof PlanningAgent === 'undefined' || !PlanningAgent.open) return;
    const ctx = { intent: 'topic' };
    if (subject) ctx.subjectId = subject;
    if (topicId) ctx.topicId = topicId;
    PlanningAgent.open(ctx);
  }

  function togglePanel() {
    if (panelCollapsed) expandRightPanel(); else collapseRightPanel();
  }

  function openChapterFrom(subject, topicId, backView) {
    activeSubject = subject;
    activeTopicId = topicId;
    chapterBackView = backView;
    showView('chapter');
  }

  // Side panel "Subjects" tab: a compact navigator over the same sorted canonical list.
  function renderSubjectNav(content) {
    const subjects = getSortedSubjects();
    const stats = getSubjectStats();
    const current = view === 'subjects' ? null : activeSubject;
    content.innerHTML = (subjects.length === 0
      ? '<p class="planner-empty empty-state">No subjects yet.</p>'
      : '<div class="library-nav-list">' + subjects.map(function (s) {
          const due = stats.due[s] || 0;
          const count = (stats.grouped[s] || []).length;
          return '<div class="library-nav-row' + (s === current ? ' is-selected' : '') + '">' +
            '<button class="library-nav-btn" data-subject="' + esc(s) + '">' +
              '<span class="library-nav-name">' + esc(s) + '</span>' +
              (due ? '<span class="library-nav-due" title="Tasks due">' + due + '</span>' : '<span class="library-nav-count">' + count + '</span>') +
            '</button>' +
            '<button class="library-more-btn library-nav-more" data-subject="' + esc(s) + '" title="Subject options" aria-label="Options for ' + esc(s) + '">&#8943;</button>' +
          '</div>';
        }).join('') + '</div>') +
      '<button class="library-nav-add btn btn-secondary">+ Subject</button>';

    content.querySelectorAll('.library-nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openSubject(btn.dataset.subject); });
    });
    content.querySelectorAll('.library-nav-more').forEach(function (btn) {
      btn.addEventListener('click', function () { openSubjectMenu(btn.dataset.subject, false); });
    });
    content.querySelector('.library-nav-add').addEventListener('click', openAddSubjectModal);
  }

  // Subject-level filtering reuses the same shared searchQuery as the topic view (DOM filter, no re-render).
  function applySubjectFilters(container) {
    const q = searchQuery.trim().toLowerCase();
    let tilesShown = 0;
    let resultsShown = 0;
    container.querySelectorAll('.library-tile').forEach(function (tile) {
      const match = !q || tile.dataset.name.indexOf(q) !== -1 || tile.dataset.topics.indexOf(q) !== -1;
      tile.style.display = match ? '' : 'none';
      if (match) tilesShown++;
    });
    container.querySelectorAll('.library-result-row').forEach(function (row) {
      const match = !!q && row.dataset.q.indexOf(q) !== -1;
      row.style.display = match ? '' : 'none';
      if (match) resultsShown++;
    });
    const favs = container.querySelector('.planner-history-favorites');
    if (favs) favs.style.display = q ? 'none' : '';
    const results = container.querySelector('#library-topic-results');
    if (results) results.style.display = resultsShown ? '' : 'none';
    const empty = container.querySelector('#library-search-empty');
    if (empty) empty.style.display = (q && !tilesShown && !resultsShown) ? '' : 'none';
  }

  function renderSubjects(container) {
    const favIds = State.get().favoriteTopics || [];
    const allTopics = PlanData.getAllTopics();
    const favTopics = favIds.map(function (id) { return allTopics[id]; }).filter(Boolean);
    const subjects = getSortedSubjects();
    const stats = getSubjectStats();
    const removed = PlanData.getHistoricalSubjects();
    const searchVisible = searchOpen || !!searchQuery;

    let html = '<div class="library-header">' +
        '<h4 class="library-header-title section-heading">All Subjects</h4>' +
        '<div class="library-header-actions">' +
          '<button id="library-search-toggle" class="library-icon-btn' + (searchVisible ? ' active' : '') + '" title="Search" aria-label="Search">&#128269;</button>' +
          '<button id="library-sort-btn" class="library-icon-btn" title="Sort: ' + esc(SORT_NAMES[sortMode]) + '" aria-label="Sort subjects"><span aria-hidden="true">&#8645;</span><span class="library-sort-caption">' + esc(SORT_LABELS[sortMode]) + '</span></button>' +
          '<button id="library-add-subject-btn" class="library-icon-btn" title="Add subject" aria-label="Add subject">+</button>' +
          '<button id="library-more-btn" class="library-icon-btn" title="More" aria-label="More options">&#8943;</button>' +
        '</div>' +
      '</div>' +
      '<div id="library-search-row" class="library-search-row"' + (searchVisible ? '' : ' style="display:none;"') + '>' +
        '<input type="text" id="library-search" class="input" placeholder="Search subjects and topics..." value="' + esc(searchQuery) + '">' +
      '</div>';

    if (favTopics.length > 0) {
      html += '<div class="planner-history-favorites">' + favTopics.map(function (t) {
        return '<button class="planner-history-fav-btn" data-subject="' + esc(t.subject) + '" data-topic-id="' + t.topicId + '" title="Favorite topic">\u2605 ' + esc(t.subject) + ' \u00B7 ' + esc(t.topicName) + '</button>';
      }).join('') + '</div>';
    }

    if (subjects.length === 0) {
      html += '<p class="planner-empty empty-state">No subjects yet. Tap + to add one.</p>';
    } else {
      html += '<div class="library-grid" id="library-subject-grid">' + subjects.map(function (s) {
        const topics = stats.grouped[s] || [];
        const due = stats.due[s] || 0;
        return '<div class="library-tile" style="--tile-accent: var(' + subjectAccent(s) + ');" data-name="' + esc(s.toLowerCase()) + '" data-topics="' + esc(topics.map(function (t) { return t.topicName.toLowerCase(); }).join('|')) + '">' +
          '<button class="library-tile-open" data-subject="' + esc(s) + '">' +
            '<span class="library-tile-name">' + esc(s) + '</span>' +
            '<span class="library-tile-meta">' + topics.length + (topics.length === 1 ? ' topic' : ' topics') + (due ? ' \u00B7 ' + due + ' due' : '') + '</span>' +
          '</button>' +
          '<button class="library-more-btn library-tile-more" data-subject="' + esc(s) + '" title="Subject options" aria-label="Options for ' + esc(s) + '">&#8943;</button>' +
        '</div>';
      }).join('') + '</div>';

      const resultRows = [];
      subjects.forEach(function (s) {
        (stats.grouped[s] || []).forEach(function (t) {
          resultRows.push('<button class="library-result-row list-row" style="display:none;" data-subject="' + esc(s) + '" data-topic-id="' + t.topicId + '" data-q="' + esc((s + ' ' + t.topicName).toLowerCase()) + '">' + esc(s) + ' \u00B7 ' + esc(t.topicName) + '</button>');
        });
      });
      html += '<div id="library-topic-results" style="display:none;">' +
        '<div class="planner-suggested-group-title section-heading">Topics</div>' +
        '<div class="list-row-group">' + resultRows.join('') + '</div>' +
      '</div>' +
      '<p id="library-search-empty" class="planner-empty empty-state" style="display:none;">No matching subjects or topics.</p>';
    }

    container.innerHTML = html;

    const searchRow = document.getElementById('library-search-row');
    const searchInput = document.getElementById('library-search');
    const searchToggle = document.getElementById('library-search-toggle');
    searchToggle.addEventListener('click', function () {
      const showing = searchRow.style.display !== 'none';
      if (showing) {
        searchOpen = false;
        searchQuery = '';
        searchInput.value = '';
        searchRow.style.display = 'none';
      } else {
        searchOpen = true;
        searchRow.style.display = '';
        searchInput.focus();
      }
      searchToggle.classList.toggle('active', !showing);
      applySubjectFilters(container);
    });
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value;
      applySubjectFilters(container);
    });

    document.getElementById('library-sort-btn').addEventListener('click', function () {
      openMenu('Sort subjects', ['focus', 'new', 'alpha'].map(function (m) {
        return { label: (m === sortMode ? '\u2713 ' : '') + SORT_NAMES[m], run: function () { sortMode = m; render(); } };
      }));
    });
    document.getElementById('library-add-subject-btn').addEventListener('click', openAddSubjectModal);
    document.getElementById('library-more-btn').addEventListener('click', function () {
      const items = [{ label: '\u2728 Plan', run: function () { openPlan(); } }];
      if (removed.length > 0) {
        items.push({
          label: 'Removed subjects (' + removed.length + ')',
          run: function () {
            openMenu('Removed subjects (history kept)', removed.map(function (s) {
              return { label: s, run: function () { openSubject(s); } };
            }));
          }
        });
      }
      items.push({ label: panelCollapsed ? 'Show side panel' : 'Hide side panel', run: togglePanel });
      openMenu('Library', items);
    });

    container.querySelectorAll('.library-tile-open').forEach(function (btn) {
      btn.addEventListener('click', function () { openSubject(btn.dataset.subject); });
    });
    container.querySelectorAll('.library-tile-more').forEach(function (btn) {
      btn.addEventListener('click', function () { openSubjectMenu(btn.dataset.subject, false); });
    });
    container.querySelectorAll('.planner-history-fav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openChapterFrom(btn.dataset.subject, btn.dataset.topicId, 'subjects'); });
    });
    container.querySelectorAll('.library-result-row').forEach(function (btn) {
      btn.addEventListener('click', function () { openChapterFrom(btn.dataset.subject, btn.dataset.topicId, 'subjects'); });
    });

    applySubjectFilters(container);
  }
    
    
      

  // Status line for a topic row, from the existing Planner tasks (no new data).
  function topicStatus(topicId) {
    const today = todayStr();
    const open = PlanData.getTasksForTopic(topicId).filter(function (t) { return !t.completed && !t.archived; });
    const overdue = open.filter(function (t) { return t.date < today; }).length;
    if (overdue) return { text: overdue + ' overdue', due: true };
    const next = open.filter(function (t) { return t.date >= today; }).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    })[0];
    if (next) {
      const when = next.date === today ? 'Today' : new Date(next.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return { text: PlanData.taskLabel(next) + ' \u00B7 ' + when, due: next.date === today };
    }
    return { text: 'Nothing scheduled', due: false };
  }

  // Today's task first, otherwise the oldest overdue, otherwise the earliest upcoming.
  function nextTaskForTopic(topicId) {
    const today = todayStr();
    const open = PlanData.getTasksForTopic(topicId).filter(function (t) { return !t.completed && !t.archived; });
    open.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return open.find(function (t) { return t.date === today; }) || open[0] || null;
  }

  // Study = start the topic's next task in Study (same calls as the side panel's "Start now").
  // With nothing scheduled there is nothing to start, so the Planning Agent opens for this topic instead.
  function studyTopic(subject, topicId) {
    const task = nextTaskForTopic(topicId);
    if (!task) { openPlan(subject, topicId); return; }
    if (typeof Study !== 'undefined' && Study.startTaskSession) Study.startTaskSession(task.taskId);
    if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('study');
  }

  function renderChapters(container) {
    const grouped = PlanData.getTopicsBySubject();
    const topics = grouped[activeSubject] || [];
    const favIds = State.get().favoriteTopics || [];
    const isActive = PlanData.isActiveSubject(activeSubject);
    const sessionActive = typeof Study !== 'undefined' && Study.isSessionActive && Study.isSessionActive();
    const searchVisible = searchOpen || !!searchQuery || selectedFilterTagIds.length > 0;

    const allFilterTags = TagsData.getAllTagsList();
    const tagChipsHtml = allFilterTags.length === 0 ? '' :
      '<div class="library-filter-chips chip-row" id="library-filter-chips">' +
        allFilterTags.map(function (tag) {
          return '<button class="library-filter-chip chip" data-tag-id="' + tag.tagId + '" style="border-color:' + tag.color + '">' + esc(tag.name) + '</button>';
        }).join('') +
      '</div>';

    let html = '<div class="library-header">' +
        '<button class="library-icon-btn library-back-btn" title="Back to subjects" aria-label="Back to subjects">&#8249;</button>' +
        '<h4 class="library-header-title section-heading">' + esc(activeSubject) + (isActive ? '' : ' (removed)') + '</h4>' +
        '<div class="library-header-actions">' +
          '<button id="library-search-toggle" class="library-icon-btn' + (searchVisible ? ' active' : '') + '" title="Search" aria-label="Search chapters">&#128269;</button>' +
          (isActive ? '<button id="library-add-topic-icon" class="library-icon-btn" title="Add topic" aria-label="Add topic">+</button>' : '') +
          (isActive ? '<button id="library-subject-more" class="library-icon-btn" title="Subject options" aria-label="Subject options">&#8943;</button>' : '') +
        '</div>' +
      '</div>' +
      '<div id="library-search-row" class="library-search-row"' + (searchVisible ? '' : ' style="display:none;"') + '>' +
        '<input type="text" id="library-search" class="input" placeholder="Search chapters..." value="' + esc(searchQuery) + '">' +
        tagChipsHtml +
      '</div>';

    if (topics.length === 0) {
      html += '<p class="planner-empty empty-state">No chapters yet for ' + esc(activeSubject) + '.' + (isActive ? ' Tap + to add one.' : '') + '</p>';
    } else {
      html += '<div class="planner-history-chapter-list list-row-group" id="library-chapter-list">' + topics.map(function (t) {
        const isFav = favIds.indexOf(t.topicId) !== -1;
        const dot = t.color ? '<span class="library-topic-color-dot" style="background:' + t.color + '"></span>' : '';
        const st = topicStatus(t.topicId);
        return '<div class="planner-history-chapter-item list-row library-topic-row" data-name="' + esc(t.topicName.toLowerCase()) + '" data-tags="' + (t.tags || []).join(',') + '">' +
          dot +
          '<button class="library-topic-open" data-topic-id="' + t.topicId + '">' +
            '<span class="library-topic-name">' + (isFav ? '\u2605 ' : '') + esc(t.topicName) + '</span>' +
            '<span class="library-topic-status' + (st.due ? ' is-due' : '') + '">' + esc(st.text) + '</span>' +
          '</button>' +
          '<div class="library-row-actions">' +
            '<button class="library-icon-btn library-topic-study" data-topic-id="' + t.topicId + '" title="Study" aria-label="Study ' + esc(t.topicName) + '"' + (sessionActive ? ' disabled' : '') + '>&#9654;</button>' +
            '<button class="library-icon-btn library-topic-planner" data-topic-id="' + t.topicId + '" title="Plan" aria-label="Plan ' + esc(t.topicName) + '">&#128197;</button>' +
            '<button class="library-icon-btn library-topic-more" data-topic-id="' + t.topicId + '" title="More" aria-label="More options for ' + esc(t.topicName) + '">&#8943;</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    container.innerHTML = html;

    container.querySelector('.library-back-btn').addEventListener('click', function () { showView('subjects'); });

    container.querySelectorAll('.library-topic-open').forEach(function (btn) {
      btn.addEventListener('click', function () { openChapterFrom(activeSubject, btn.dataset.topicId, 'chapters'); });
    });
    container.querySelectorAll('.library-topic-study').forEach(function (btn) {
      btn.addEventListener('click', function () { studyTopic(activeSubject, btn.dataset.topicId); });
    });
    container.querySelectorAll('.library-topic-planner').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPlan(activeSubject, btn.dataset.topicId);
      });
    });
    container.querySelectorAll('.library-topic-more').forEach(function (btn) {
      btn.addEventListener('click', function () { openTopicMenu(btn.dataset.topicId, false); });
    });

    const addTopicBtn = document.getElementById('library-add-topic-icon'); // absent for removed subjects
    if (addTopicBtn) addTopicBtn.addEventListener('click', function () {
      const name = prompt('New chapter name for ' + activeSubject + ':');
      if (name && name.trim()) {
        PlanData.getOrCreateTopic(activeSubject, name.trim());
        render();
      }
    });
    const subjectMoreBtn = document.getElementById('library-subject-more');
    if (subjectMoreBtn) subjectMoreBtn.addEventListener('click', function () { openSubjectMenu(activeSubject, false); });

    function applyLibraryFilters() {
      const searchEl = document.getElementById('library-search');
      const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
      document.querySelectorAll('#library-chapter-list .planner-history-chapter-item').forEach(function (item) {
        const nameMatch = item.dataset.name.indexOf(query) !== -1;
        const itemTags = (item.dataset.tags || '').split(',').filter(Boolean);
        const tagMatch = selectedFilterTagIds.length === 0 || selectedFilterTagIds.some(function (id) { return itemTags.indexOf(id) !== -1; });
        item.style.display = (nameMatch && tagMatch) ? 'flex' : 'none';
      });
    }
    const searchRow = document.getElementById('library-search-row');
    const searchInput = document.getElementById('library-search');
    const searchToggle = document.getElementById('library-search-toggle');
    searchToggle.addEventListener('click', function () {
      const showing = searchRow.style.display !== 'none';
      if (showing && selectedFilterTagIds.length === 0) {
        searchOpen = false;
        searchQuery = '';
        searchInput.value = '';
        searchRow.style.display = 'none';
      } else {
        searchOpen = true;
        searchRow.style.display = '';
        searchInput.focus();
      }
      searchToggle.classList.toggle('active', searchRow.style.display !== 'none');
      applyLibraryFilters();
    });
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value;
      applyLibraryFilters();
    });
    const filterChipsEl = document.getElementById('library-filter-chips');
    if (filterChipsEl) {
      filterChipsEl.querySelectorAll('.library-filter-chip').forEach(function (chip) {
        chip.classList.toggle('active', selectedFilterTagIds.indexOf(chip.dataset.tagId) !== -1);
        chip.addEventListener('click', function () {
          const id = chip.dataset.tagId;
          const idx = selectedFilterTagIds.indexOf(id);
          if (idx === -1) selectedFilterTagIds.push(id); else selectedFilterTagIds.splice(idx, 1);
          renderChapters(container);
        });
      });
    }
    applyLibraryFilters();
  }

  function showTopicHistory(topicId) {
    historyFilterTopicId = topicId;
    panelTabIdx = PANEL_TABS.indexOf('history');
    expandRightPanel();
  }

  function renameTopicFlow(topicId) {
    const meta = PlanData.getAllTopics()[topicId];
    if (!meta) return;
    const name = prompt('Rename chapter:', meta.topicName);
    if (name && name.trim()) {
      PlanData.renameTopic(topicId, name.trim());
      render();
    }
  }

  function colorTopicFlow(topicId) {
    const meta = PlanData.getAllTopics()[topicId] || {};
    const input = document.createElement('input');
    input.type = 'color';
    input.value = meta.color || '#b39ddb';
    input.addEventListener('change', function () {
      PlanData.updateTopicMeta(topicId, { color: input.value });
      render();
    });
    input.click();
  }

  function removeTopicFlow(topicId) {
    const ok = PlanData.deleteTopic(topicId);
    if (!ok) { alert('Cannot remove a chapter with active (non-archived) tasks. Archive its tasks first.'); return; }
    const favs = (State.get().favoriteTopics || []).filter(function (id) { return id !== topicId; });
    State.set({ favoriteTopics: favs });
    getLinksByTopic(topicId).forEach(function (l) { deleteLink(l.linkId); });
    if (typeof TargetsData !== 'undefined') {
      TargetsData.getAllTargetsList().filter(function (t) { return t.topicId === topicId; }).forEach(function (t) {
        TargetsData.deleteTarget(t.targetId);
      });
    }
    showView('chapters');
  }

  // One overflow menu for a topic. From a list row it also offers the info views; inside the topic
  // detail those are already one tap away, so only the management actions are listed.
  function openTopicMenu(topicId, inDetail) {
    const meta = PlanData.getAllTopics()[topicId];
    if (!meta) return;
    const items = [];
    if (!inDetail) {
      const isFav = (State.get().favoriteTopics || []).indexOf(topicId) !== -1;
      items.push({ label: 'Details', run: function () { openChapterFrom(meta.subject, topicId, 'chapters'); } });
      items.push({ label: isFav ? 'Remove from favorites' : 'Add to favorites', run: function () { toggleFavoriteTopic(topicId); render(); } });
      items.push({ label: 'Upcoming', run: function () { openUpcomingModal(topicId); } });
      items.push({ label: 'History', run: function () { showTopicHistory(topicId); } });
      items.push({ label: 'Links', run: function () { openLinksModal(topicId); } });
            items.push({ label: 'Target', run: function () { PlanningAgentUI.openTargets(); } });
    }
    items.push({ label: 'Rename', run: function () { renameTopicFlow(topicId); } });
    items.push({ label: 'Color', run: function () { colorTopicFlow(topicId); } });
    items.push({ label: 'Manage tags', run: function () { Tags.openManagerForTopic(topicId); } });
    items.push({ label: 'Remove', danger: true, run: function () { removeTopicFlow(topicId); } });
    openMenu(meta.topicName, items);
  }

  function renderChapter(container) {
    const topicMeta = PlanData.getAllTopics()[activeTopicId];
    if (!topicMeta) { view = 'chapters'; renderChapters(container); return; }
    activeSubject = topicMeta.subject;
    const subject = activeSubject;
    const topicId = activeTopicId;
    const chapterName = topicMeta.topicName;
    const isFav = (State.get().favoriteTopics || []).indexOf(topicId) !== -1;
    const sessionActive = typeof Study !== 'undefined' && Study.isSessionActive && Study.isSessionActive();

    const tagIds = topicMeta.tags || [];
    const tagsHtml = tagIds.length === 0 ? '' : '<div class="library-topic-tags chip-row">' +
      tagIds.map(function (tagId) {
        const tag = TagsData.getTag(tagId);
        if (!tag) return '';
        return '<span class="library-tag chip" style="border-color:' + tag.color + ';color:' + tag.color + '">' + esc(tag.name) + '</span>';
      }).join('') +
    '</div>';

    container.innerHTML =
      '<div class="library-header">' +
        '<button class="library-icon-btn library-back-btn" title="Back to ' + esc(chapterBackView === 'subjects' ? 'subjects' : subject) + '" aria-label="Back">&#8249;</button>' +
        '<div class="library-header-text">' +
          '<div class="library-header-sub">' + esc(subject) + '</div>' +
          '<h4 class="library-header-title section-heading">' + esc(chapterName) + '</h4>' +
        '</div>' +
        '<div class="library-header-actions">' +
          '<button id="library-action-fav" class="library-icon-btn" title="' + (isFav ? 'Remove from favorites' : 'Add to favorites') + '" aria-label="Toggle favorite">' + (isFav ? '\u2605' : '\u2606') + '</button>' +
          '<button id="library-action-more" class="library-icon-btn" title="More" aria-label="More options">&#8943;</button>' +
        '</div>' +
      '</div>' +
      tagsHtml +
      '<div class="library-primary-actions">' +
        '<button id="library-action-study" class="btn btn-primary"' + (sessionActive ? ' disabled' : '') + '>&#9654; Study</button>' +
        '<button id="library-action-planner" class="btn btn-secondary">&#128197; Plan</button>' +
      '</div>' +
      '<div class="library-info-row">' +
        '<button id="library-action-upcoming" class="library-info-chip">Upcoming</button>' +
        '<button id="library-action-history" class="library-info-chip">History</button>' +
        '<button id="library-action-links" class="library-info-chip">Links</button>' +
        '<button id="library-action-target" class="library-info-chip">Target</button>' +
      '</div>';

    container.querySelector('.library-back-btn').addEventListener('click', function () { showView(chapterBackView); });
    document.getElementById('library-action-fav').addEventListener('click', function () {
      toggleFavoriteTopic(topicId);
      render();
    });
    document.getElementById('library-action-more').addEventListener('click', function () { openTopicMenu(topicId, true); });
    document.getElementById('library-action-study').addEventListener('click', function () { studyTopic(subject, topicId); });
    document.getElementById('library-action-planner').addEventListener('click', function () {
      openPlan(subject, topicId);
    });
    document.getElementById('library-action-history').addEventListener('click', function () { showTopicHistory(topicId); });
    document.getElementById('library-action-upcoming').addEventListener('click', function () { openUpcomingModal(topicId); });
    document.getElementById('library-action-links').addEventListener('click', function () { openLinksModal(topicId); });
        document.getElementById('library-action-target').addEventListener('click', function () { PlanningAgentUI.openTargets(); });

    renderTopicTargetsChecklist(container, topicId);
  }
    

  function renderTopicTargetsChecklist(container, topicId) {
    const targets = TargetsData.getTargetsForTopic(topicId);
    if (targets.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'library-topic-targets-dropdown';
    wrap.innerHTML =
      '<button class="library-topic-targets-toggle btn btn-secondary" type="button">Subtargets \u25BE</button>' +
      '<div class="library-topic-targets-body" style="display:none">' +
        targets.map(function (tg) {
          const subs = TargetsData.getSubtargetsForTarget(tg.targetId);
          if (subs.length === 0) return '';
          return '<div class="library-topic-target-group"><strong>' + esc(tg.title) + '</strong>' +
            subs.map(function (s) {
              return '<label class="library-topic-subtarget-row list-row">' +
                '<input type="checkbox" class="library-topic-subtarget-check" data-subtarget-id="' + s.subtargetId + '" ' + (s.completed ? 'checked' : '') + '> ' +
                esc(s.title) + ' (' + s.currentValue + '/' + s.targetValue + ')' +
              '</label>';
            }).join('') +
           '</div>';
        }).join('') +
      '</div>';

    container.appendChild(wrap);
    wrap.querySelector('.library-topic-targets-toggle').addEventListener('click', function () {
      const body = wrap.querySelector('.library-topic-targets-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    wrap.querySelectorAll('.library-topic-subtarget-check').forEach(function (cb) {
      cb.addEventListener('click', function () {
        TargetsData.toggleSubtargetComplete(cb.dataset.subtargetId);
        render();
      });
    });
  }

  // Entry point used by Planner.openHistory (so browsing a topic always lands here now).
  function openTopic(subject, topicId) {
    activeSubject = subject || null;
    if (topicId) { activeTopicId = topicId; view = 'chapter'; }
    else if (subject) { view = 'chapters'; activeTopicId = null; }
    else { view = 'subjects'; activeTopicId = null; }
  }

  // ---------- Upcoming (per-topic, incomplete future/today tasks) ----------

  function openUpcomingModal(topicId) {
    const today = todayStr();
    const tasks = PlanData.getTasksForTopic(topicId).filter(function (t) { return !t.completed && t.date > today; });
    const html = tasks.length === 0
      ? '<p class="planner-empty empty-state">Nothing upcoming for this chapter.</p>'
      : tasks.map(function (t) {
          return '<div class="planner-task-row list-row"><div class="planner-task-meta">' + PlanData.taskLabel(t) + '</div>' +
            '<div class="planner-task-sub">Scheduled: ' + t.date + (PlanData.slotLabel(t) ? ' \u00B7 ' + PlanData.slotLabel(t) : '') + '</div></div>';
        }).join('');
    Modal.open('<h3 class="section-heading">Upcoming</h3>' + html);
  }

  // ---------- Links (Cleanup Item 4 — relocated from study.js, now topic-scoped) ----------

  function getLinks() { return State.get().studyLinks || {}; }

  function addLink(topicId, url, note) {
    const links = Object.assign({}, getLinks());
    const id = 'link_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    links[id] = { linkId: id, topicId: topicId, url: url.trim(), note: note || '' };
    State.set({ studyLinks: links });
  }

  function deleteLink(linkId) {
    const links = Object.assign({}, getLinks());
    delete links[linkId];
    State.set({ studyLinks: links });
  }

  function getLinksByTopic(topicId) {
    const links = getLinks();
    return Object.keys(links).map(function (id) { return links[id]; }).filter(function (l) { return l.topicId === topicId; });
  }

  function openLinksModal(topicId) {
    const list = getLinksByTopic(topicId);
    const listHtml = list.length === 0
      ? '<p class="planner-empty empty-state">No links yet for this chapter.</p>'
      : list.map(function (l) {
          return '<div class="study-link-row list-row">' +
            '<a href="' + l.url + '" target="_blank" rel="noopener">' + l.url + '</a>' +
            (l.note ? '<div class="study-link-note">' + l.note + '</div>' : '') +
            '<button class="study-link-delete btn btn-danger" data-link-id="' + l.linkId + '">Remove</button>' +
          '</div>';
        }).join('');

    Modal.open(
      '<h3 class="section-heading">Links</h3>' +
      '<div class="study-links-list">' + listHtml + '</div>' +
      '<div class="study-links-form">' +
        '<input type="url" id="study-link-url" class="input" placeholder="YouTube URL">' +
        '<textarea id="study-link-note" class="input" rows="2" placeholder="Note (optional)"></textarea>' +
        '<button id="study-link-save" class="btn btn-primary">Add Link</button>' +
      '</div>'
    );

    document.querySelectorAll('.study-link-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteLink(btn.dataset.linkId);
        openLinksModal(topicId);
      });
    });

    document.getElementById('study-link-save').addEventListener('click', function () {
      const url = document.getElementById('study-link-url').value.trim();
      if (!url) { alert('Enter a URL.'); return; }
      const note = document.getElementById('study-link-note').value;
      addLink(topicId, url, note);
      openLinksModal(topicId);
    });
  }

  function openEditTaskModal(taskId, focusDate) {
    const t = PlanData.getTask(taskId);
    if (!t) return;
    const isCustom = t.taskType === 'custom';
    Modal.open(
      '<h3 class="section-heading">Edit Task</h3>' +
      (isCustom
        ? '<label class="planner-field-label">Title</label><input type="text" id="library-edit-title" class="input" value="' + (t.title || '').replace(/"/g, '&quot;') + '">'
        : '<div class="planner-tasktype-row chip-row">' +
            '<label class="chip"><input type="radio" name="library-edit-tasktype" value="revision"' + (t.taskType === 'revision' ? ' checked' : '') + '> Revision</label>' +
            '<label class="chip"><input type="radio" name="library-edit-tasktype" value="theory"' + (t.taskType === 'theory' ? ' checked' : '') + '> Theory</label>' +
            '<label class="chip"><input type="radio" name="library-edit-tasktype" value="questions"' + (t.taskType === 'questions' ? ' checked' : '') + '> Qs</label>' +
          '</div>') +
      '<label class="planner-field-label">Date</label><input type="date" id="library-edit-date" class="input" value="' + (t.date || '') + '">' +
      '<label class="planner-field-label">Note</label><textarea id="library-edit-note" class="input" rows="3">' + (t.note || '') + '</textarea>' +
      '<button id="library-edit-save" class="btn btn-primary">Save</button>' +
      '<button id="library-edit-cancel" class="btn btn-secondary">Cancel</button>'
    );
    if (focusDate) { const dateEl = document.getElementById('library-edit-date'); if (dateEl) dateEl.focus(); }
    document.getElementById('library-edit-save').addEventListener('click', function () {
      const patch = {
        date: document.getElementById('library-edit-date').value || t.date,
        note: document.getElementById('library-edit-note').value
      };
      if (isCustom) {
        patch.title = document.getElementById('library-edit-title').value.trim() || t.title;
      } else {
        const selected = document.querySelector('input[name="library-edit-tasktype"]:checked');
        if (selected) patch.taskType = selected.value;
      }
      if (typeof PlanningAgent !== 'undefined') {
        PlanningAgent.updateTask(taskId, patch, 'user');
      } else {
        PlanData.updateTask(taskId, patch);
      }
      Modal.close();
      renderRightPanel();
    });
    document.getElementById('library-edit-cancel').addEventListener('click', function () { Modal.close(); });
  }

  function renderRightPanel() {
    const label = document.getElementById('library-panel-tab-label');
    const content = document.getElementById('library-panel-content');
    if (!label || !content) return;
    const tab = PANEL_TABS[panelTabIdx];
    label.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
    const deleteAllBtn = document.getElementById('library-delete-all-archived');
    if (deleteAllBtn) deleteAllBtn.style.display = (tab === 'archived') ? 'inline-block' : 'none';

    if (tab === 'subjects') {
      renderSubjectNav(content);
      return;
    }

    if (tab === 'archived') {
      const archivedTasks = PlanData.getArchivedTasks();
      const archivedTargets = TargetsData.getArchivedTargetsList();
      if (!archivedTasks.length && !archivedTargets.length) { content.innerHTML = '<p class="planner-empty empty-state">Nothing archived.</p>'; return; }

      const taskRows = archivedTasks.map(function (t) {
        const meta = t.taskType === 'custom' ? t.title : (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlanData.taskLabel(t));
        return '<div class="planner-task-row list-row" data-task-id="' + t.taskId + '">' +
          '<span class="planner-task-meta">' + meta + '</span>' +
          '<div class="planner-task-sub">Archived: ' + t.archivedAt + '</div>' +
          '<button class="library-unarchive-task-btn btn btn-secondary" data-task-id="' + t.taskId + '">Unarchive</button>' +
        '</div>';
      }).join('');

      const targetRows = archivedTargets.map(function (tg) {
        return '<div class="planner-task-row list-row" data-target-id="' + tg.targetId + '">' +
          '<span class="planner-task-meta">' + esc(tg.title) + '</span>' +
          '<div class="planner-task-sub">Archived: ' + tg.archivedAt + '</div>' +
          '<button class="library-unarchive-target-btn btn btn-secondary" data-target-id="' + tg.targetId + '">Unarchive</button>' +
        '</div>';
      }).join('');

      content.innerHTML = taskRows + targetRows;

      content.querySelectorAll('.library-unarchive-task-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          PlanData.unarchiveTask(btn.dataset.taskId);
          renderRightPanel();
        });
      });
      content.querySelectorAll('.library-unarchive-target-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          TargetsData.unarchiveTarget(btn.dataset.targetId);
          renderRightPanel();
        });
      });
      return;
    }

    if (tab === 'targets') {
      const targets = TargetsData.getAllTargetsList();
      if (!targets.length) { content.innerHTML = '<p class="planner-empty empty-state">No targets yet.</p>'; return; }

      content.innerHTML = targets.map(function (tg) {
        const subs = TargetsData.getSubtargetsForTarget(tg.targetId);
        const valueInput = (tg.type === 'hours' || tg.type === 'questions') && !tg.completed
          ? '<input type="number" class="library-target-value-input input" data-target-id="' + tg.targetId + '" min="0" max="' + tg.targetValue + '" value="' + tg.currentValue + '" style="width:52px;margin-left:4px">'
          : '';
        const subsHtml = subs.length === 0 ? '' :
          '<div class="library-target-subs" style="display:none">' +
            subs.map(function (s) {
              return '<label class="library-topic-subtarget-row list-row">' +
                '<input type="checkbox" class="library-target-sub-check" data-subtarget-id="' + s.subtargetId + '" data-parent-id="' + tg.targetId + '" ' + (s.completed ? 'checked' : '') + '> ' +
                esc(s.title) + ' (' + s.currentValue + '/' + s.targetValue + ')' +
              '</label>';
            }).join('') +
          '</div>';

        return '<div class="planner-task-row list-row' + (tg.completed ? ' planner-task-done' : '') + '" data-target-id="' + tg.targetId + '">' +
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
            '<input type="checkbox" class="library-target-check" data-target-id="' + tg.targetId + '" ' + (tg.completed ? 'checked' : '') + '>' +
            '<span class="planner-task-meta">' + esc(tg.title) + '</span>' +
            valueInput +
            (subs.length > 0 ? '<button class="library-target-subs-toggle btn btn-secondary" data-target-id="' + tg.targetId + '" style="font-size:11px;padding:1px 4px">&#9660;</button>' : '') +
            '<button class="library-archive-target-btn btn btn-secondary" data-target-id="' + tg.targetId + '" style="font-size:11px;padding:1px 4px">Archive</button>' +
          '</div>' +
          '<div class="planner-task-sub">' + tg.timeframe + ' \u00B7 ' + tg.currentValue + '/' + tg.targetValue + (tg.type !== 'custom' ? ' ' + tg.type : '') + '</div>' +
          subsHtml +
        '</div>';
      }).join('');

      content.querySelectorAll('.library-target-check').forEach(function (cb) {
        cb.addEventListener('click', function () {
          const tid = cb.dataset.targetId;
          const valInput = content.querySelector('.library-target-value-input[data-target-id="' + tid + '"]');
          const recorded = valInput ? Number(valInput.value) : undefined;
          TargetsData.toggleTargetComplete(tid, recorded);
          renderRightPanel();
        });
      });

      content.querySelectorAll('.library-target-subs-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const row = content.querySelector('.planner-task-row[data-target-id="' + btn.dataset.targetId + '"]');
          const subsDiv = row && row.querySelector('.library-target-subs');
          if (subsDiv) subsDiv.style.display = subsDiv.style.display === 'none' ? 'block' : 'none';
        });
      });

      content.querySelectorAll('.library-target-sub-check').forEach(function (cb) {
        cb.addEventListener('click', function () {
          TargetsData.toggleSubtargetComplete(cb.dataset.subtargetId);
          renderRightPanel();
        });
      });

      content.querySelectorAll('.library-archive-target-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          TargetsData.archiveTarget(btn.dataset.targetId);
          renderRightPanel();
        });
      });

      return;
    }

      let tasks;
        if (tab === 'today') tasks = PlanningAgent.getTodayTasks();
    else if (tab === 'pending') tasks = PlanningAgent.getPendingTasks();
    else if (tab === 'upcoming') tasks = PlanData.getUpcomingTasks();
    else tasks = historyFilterTopicId
      ? PlanData.getHistoryTasks().filter(function (t) { return t.topicId === historyFilterTopicId; })
      : PlanData.getHistoryTasks();
    if (!tasks.length) { content.innerHTML = '<p class="planner-empty empty-state">Nothing here.</p>'; return; }
    const sessionActive = typeof Study !== 'undefined' && Study.isSessionActive && Study.isSessionActive();
    content.innerHTML = tasks.map(function (t) {
      const meta = t.taskType === 'custom' ? t.title : (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlanData.taskLabel(t));
      const slot = PlanData.slotLabel(t);
      const startBtn = (tab !== 'history' && !t.completed)
        ? '<button class="library-panel-start-btn btn btn-primary" data-task-id="' + t.taskId + '"' + (sessionActive ? ' disabled' : '') + '>Start now</button>'
        : '';
      const reschedBtn = (tab === 'pending')
        ? '<button class="library-reschedule-task-btn btn btn-secondary" data-task-id="' + t.taskId + '">Reschedule</button>'
        : '';
      return '<div class="planner-task-row list-row' + (t.completed ? ' planner-task-done' : '') + '">' +
        '<label class="planner-task-check-label switch-label">' +
          '<input type="checkbox" class="library-panel-task-check switch-input" data-task-id="' + t.taskId + '"' + (t.completed ? ' checked' : '') + '>' +
          '<span class="planner-task-meta">' + meta + '</span>' +
        '</label>' +
        '<div class="planner-task-sub">' + t.date + (slot ? ' \u00B7 ' + slot : '') + '</div>' +
        startBtn +
        reschedBtn +
        '<button class="library-edit-task-btn btn btn-secondary" data-task-id="' + t.taskId + '">Edit</button>' +
        '<button class="library-delete-task-btn btn btn-danger" data-task-id="' + t.taskId + '">Delete</button>' +
        '<button class="library-archive-task-btn btn btn-secondary" data-task-id="' + t.taskId + '">Archive</button>' +
      '</div>';
    }).join('');

    content.querySelectorAll('.library-panel-task-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
                PlanningAgent.toggleTask(cb.dataset.taskId);
        renderRightPanel();
      });
    });
    content.querySelectorAll('.library-panel-start-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof Study !== 'undefined' && Study.startTaskSession) Study.startTaskSession(btn.dataset.taskId);
        if (typeof Nav !== 'undefined' && Nav.switchTo) Nav.switchTo('study');
      });
    });
    content.querySelectorAll('.library-edit-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditTaskModal(btn.dataset.taskId); });
    });
    content.querySelectorAll('.library-reschedule-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditTaskModal(btn.dataset.taskId, true); });
    });
    content.querySelectorAll('.library-delete-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Modal.open(
          '<h3 class="section-heading">Delete task?</h3><p>This cannot be undone.</p>' +
          '<button id="library-delete-task-confirm" class="btn btn-danger">Delete</button>' +
          '<button id="library-delete-task-cancel" class="btn btn-secondary">Cancel</button>'
        );
        document.getElementById('library-delete-task-confirm').addEventListener('click', function () {
          PlanData.deleteTask(btn.dataset.taskId);
          Modal.close();
          renderRightPanel();
        });
        document.getElementById('library-delete-task-cancel').addEventListener('click', function () { Modal.close(); });
      });
    });
    content.querySelectorAll('.library-archive-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        PlanData.archiveTask(btn.dataset.taskId);
        renderRightPanel();
      });
    });
  }
  function expandRightPanel() {
    panelCollapsed = false;
    const rightPanel = document.getElementById('library-right-panel');
    const expandBtn = document.getElementById('library-panel-expand');
    if (rightPanel) rightPanel.style.display = '';
    if (expandBtn) expandBtn.style.display = 'none';
    renderRightPanel();
  }

  function collapseRightPanel() {
    panelCollapsed = true;
    const rightPanel = document.getElementById('library-right-panel');
    const expandBtn = document.getElementById('library-panel-expand');
    if (rightPanel) rightPanel.style.display = 'none';
    if (expandBtn) expandBtn.style.display = 'block';
  }

  function init() {
    if (typeof TagsData !== 'undefined') TagsData.migrateLegacyStringTags();
    render();
    renderRightPanel();

    const prevBtn = document.getElementById('library-panel-prev');
    const nextBtn = document.getElementById('library-panel-next');
    const collapseBtn = document.getElementById('library-panel-collapse');
    const expandBtn = document.getElementById('library-panel-expand');
    const rightPanel = document.getElementById('library-right-panel');

    if (prevBtn) prevBtn.addEventListener('click', function () {
      panelTabIdx = (panelTabIdx - 1 + PANEL_TABS.length) % PANEL_TABS.length;
      renderRightPanel();
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      panelTabIdx = (panelTabIdx + 1) % PANEL_TABS.length;
      renderRightPanel();
    });
    const deleteAllBtn = document.getElementById('library-delete-all-archived');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', function () {
      Modal.open(
        '<h3 class="section-heading">Delete all archived items?</h3><p>This cannot be undone.</p>' +
        '<button id="library-delete-all-confirm" class="btn btn-danger">Delete All</button>' +
        '<button id="library-delete-all-cancel" class="btn btn-secondary">Cancel</button>'
      );
      document.getElementById('library-delete-all-confirm').addEventListener('click', function () {
        PlanData.getArchivedTasks().forEach(function (t) { PlanData.deleteTask(t.taskId); });
        TargetsData.getArchivedTargetsList().forEach(function (tg) { TargetsData.deleteTarget(tg.targetId); });
        Modal.close();
        renderRightPanel();
      });
      document.getElementById('library-delete-all-cancel').addEventListener('click', function () { Modal.close(); });
    });
    if (collapseBtn) collapseBtn.addEventListener('click', collapseRightPanel);
    if (expandBtn) expandBtn.addEventListener('click', expandRightPanel);
    if (prevBtn) prevBtn.addEventListener('click', function () { historyFilterTopicId = null; });
    if (nextBtn) nextBtn.addEventListener('click', function () { historyFilterTopicId = null; });
  }
  function renderPanel() { render(); renderRightPanel(); }
  return { init: init, render: render, renderPanel: renderPanel, openTopic: openTopic, openSubject: openSubject, openPlan: openPlan };
})();
