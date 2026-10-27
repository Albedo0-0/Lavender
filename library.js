// library.js — Library screen: single home for the topic collection (Cleanup Item 1).
// Depends on: State, PlanData, Modal, Planner, Nav. Topic-scoped Links live here (Cleanup Item 4).

const Library = (function () {
  let view = 'subjects'; // 'subjects' | 'chapters' | 'chapter'
  let activeSubject = null;
  let activeTopicId = null;
  let sortMode = 'alpha'; // 'focus' | 'new' | 'alpha' (view state only; the subject list stays canonical in PlanData)
  let searchQuery = ''; // one search value shared by the subject view and the topic view
  let searchOpen = false;
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
  
  const TINT_COUNT = 8;
  const SORT_NAMES = { focus: 'Least focused subject', 'new': 'Newly added', alpha: 'Alphabetical' };
  const SORT_LABELS = { focus: 'Least focused', 'new': 'Newest', alpha: 'A\u2013Z' };

  function subjectTint(subject) {
    let sum = 0;
    for (let i = 0; i < subject.length; i++) sum += subject.charCodeAt(i);
    return sum % TINT_COUNT;
  }

  // Read-only progress derived from the existing Planner tasks of a subject's / chapter's topics (nothing stored).
  function topicProgress(topicId) {
    let total = 0, done = 0;
    PlanData.getTasksForTopic(topicId).forEach(function (t) {
      if (t.archived) return;
      total++;
      if (t.completed) done++;
    });
    return { total: total, done: done, pct: total ? Math.round(done * 100 / total) : 0 };
  }

  function subjectProgress(topics) {
    let total = 0, done = 0;
    topics.forEach(function (t) {
      const p = topicProgress(t.topicId);
      total += p.total;
      done += p.done;
    });
    return { total: total, done: done, pct: total ? Math.round(done * 100 / total) : 0 };
  }

  // Flat, hand-drawn style illustrations (no gradients), chosen by subject name.
  const SPRIG = '<path d="M52 58c0-7 2-12 8-15" fill="none" stroke="#5f8a6a" stroke-width="1.6" stroke-linecap="round"/>' +
    '<ellipse cx="54" cy="50" rx="3.2" ry="1.7" transform="rotate(-40 54 50)" fill="#7fa98a"/>' +
    '<ellipse cx="58" cy="46" rx="3.2" ry="1.7" transform="rotate(30 58 46)" fill="#8fb597"/>' +
    '<circle cx="60" cy="42" r="2" fill="#f1cdd3"/>';
  function art(inner) {
    return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' + inner + SPRIG + '</svg>';
  }
  const ARTS = {
    physics: art('<g transform="rotate(-30 28 28)"><rect x="10" y="22" width="30" height="9" rx="2" fill="#b88a4a"/><rect x="36" y="20" width="9" height="13" rx="2" fill="#8a6a35"/><rect x="6" y="23.5" width="6" height="6" rx="1" fill="#6b8a7a"/></g><path d="M26 32l-8 18M28 32l6 18M27 32v18" stroke="#6b5a45" stroke-width="2" stroke-linecap="round"/><rect x="8" y="50" width="40" height="5" rx="1.5" fill="#7c8fb0"/><rect x="11" y="55" width="34" height="5" rx="1.5" fill="#a86f6f"/>'),
    chemistry: art('<rect x="25" y="6" width="14" height="5" rx="1.5" fill="#b88a4a"/><path d="M27 11h10v12l12 24a5 5 0 0 1-4.5 7.2h-25A5 5 0 0 1 15 47l12-24z" fill="#eef3f4" stroke="#4a5d6a" stroke-width="1.6" stroke-linejoin="round"/><path d="M20 40h24l5 9.5a3.4 3.4 0 0 1-3 5H18a3.4 3.4 0 0 1-3-5z" fill="#8b7fc0"/><circle cx="29" cy="46" r="2" fill="#d6cff0"/><circle cx="36" cy="49" r="1.5" fill="#d6cff0"/><circle cx="33" cy="34" r="1.5" fill="#c9c9d6"/>'),
    biology: art('<path d="M12 56V30a18 18 0 0 1 36 0v26z" fill="#e7f0e6" stroke="#5a7a68" stroke-width="1.6" stroke-linejoin="round"/><rect x="10" y="54" width="40" height="6" rx="1.5" fill="#8a6b45"/><path d="M30 54V32" stroke="#4f7a58" stroke-width="2" stroke-linecap="round"/><ellipse cx="24" cy="38" rx="7" ry="3.4" transform="rotate(-30 24 38)" fill="#6f9a6a"/><ellipse cx="36" cy="32" rx="7" ry="3.4" transform="rotate(30 36 32)" fill="#7fae78"/><ellipse cx="25" cy="46" rx="6" ry="3" transform="rotate(-20 25 46)" fill="#7fae78"/>'),
    mathematics: art('<circle cx="28" cy="28" r="18" fill="#7fa6a0"/><path d="M16 22c5-4 9-3 12 1s2 9-3 11-8-1-9-5z" fill="#9bbf8a"/><path d="M33 34c3-3 8-2 9 2s-3 8-7 6z" fill="#9bbf8a"/><path d="M10 28a18 18 0 0 0 36 0" fill="none" stroke="#5f8580" stroke-width="1.2"/><path d="M8 40q20 14 40 0" fill="none" stroke="#b88a4a" stroke-width="2.2" stroke-linecap="round"/><rect x="18" y="54" width="22" height="5" rx="1.5" fill="#8a6b45"/><path d="M28 47v7" stroke="#8a6b45" stroke-width="2"/>'),
    english: art('<path d="M8 38l22-6 22 6v16l-22-6-22 6z" fill="#8a9ab8"/><path d="M30 32v22" stroke="#5f6f8f" stroke-width="1.4"/><rect x="14" y="14" width="30" height="22" rx="2" fill="#f6efdc" stroke="#a9966a" stroke-width="1.4"/><path d="M14 16l15 11 15-11" fill="none" stroke="#a9966a" stroke-width="1.4" stroke-linejoin="round"/><circle cx="44" cy="14" r="4" fill="#d98b8b"/>'),
    computer: art('<rect x="8" y="8" width="40" height="30" rx="3" fill="#e4ebe7" stroke="#55695f" stroke-width="1.6"/><rect x="12" y="12" width="32" height="21" rx="1.5" fill="#9fb7ae"/><path d="M17 19l-3 3 3 3M39 19l3 3-3 3M25 27l6-10" fill="none" stroke="#f3f0e4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="22" y="38" width="12" height="5" fill="#cfd8d3"/><rect x="10" y="43" width="36" height="8" rx="2" fill="#d6ddd8" stroke="#55695f" stroke-width="1.4"/>'),
    books: art('<rect x="8" y="42" width="40" height="9" rx="1.5" fill="#6f9a85"/><rect x="11" y="32" width="34" height="9" rx="1.5" fill="#7c8fb0"/><rect x="9" y="22" width="36" height="9" rx="1.5" fill="#c9a96b"/><rect x="12" y="12" width="30" height="9" rx="1.5" fill="#a86f6f"/><path d="M14 46h8M16 36h8M14 26h8" stroke="#f3f0e4" stroke-width="1.4" stroke-linecap="round"/><rect x="8" y="51" width="40" height="4" fill="#8a6b45"/>'),
    notes: art('<rect x="12" y="8" width="32" height="46" rx="3" fill="#f3ead8" stroke="#8a6b45" stroke-width="1.6"/><rect x="12" y="8" width="7" height="46" rx="2" fill="#b36f78"/><path d="M24 20h16M24 27h16M24 34h12" stroke="#a9966a" stroke-width="1.4" stroke-linecap="round"/><rect x="32" y="40" width="14" height="9" rx="1.5" fill="#e7c0c4" transform="rotate(-6 39 44)"/>'),
    fallback: art('<rect x="8" y="40" width="40" height="10" rx="1.5" fill="#6f9a85"/><rect x="12" y="29" width="34" height="10" rx="1.5" fill="#c9a96b"/><rect x="10" y="18" width="36" height="10" rx="1.5" fill="#7c8fb0"/><path d="M14 45h9M16 34h9M14 23h9" stroke="#f3f0e4" stroke-width="1.4" stroke-linecap="round"/><rect x="8" y="50" width="40" height="4" fill="#8a6b45"/>')
  };
  function subjectArt(subject) {
    const n = String(subject || '').toLowerCase();
    if (/phys/.test(n)) return ARTS.physics;
    if (/chem/.test(n)) return ARTS.chemistry;
    if (/bio|life/.test(n)) return ARTS.biology;
    if (/math|algebra|calc|geom|stat/.test(n)) return ARTS.mathematics;
    if (/engl|lang|liter|hindi|writ|grammar/.test(n)) return ARTS.english;
    if (/comput|\bcs\b|code|program|inform|\bit\b/.test(n)) return ARTS.computer;
    if (/revis|note/.test(n)) return ARTS.notes;
    if (/ncert|book|text/.test(n)) return ARTS.books;
    return ARTS.fallback;
  }

  function bannerArt() {
    return '<svg class="library-banner-art" viewBox="0 0 700 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">' +
      '<rect width="700" height="200" fill="#d3e3da"/>' +
      '<rect x="330" y="0" width="370" height="200" fill="#dcebe5"/>' +
      '<path d="M330 122q90-34 170-10t200-14v40H330z" fill="#bcd3c3"/>' +
      '<rect x="330" y="124" width="370" height="60" fill="#a9c9c2"/>' +
      '<rect x="528" y="62" width="30" height="62" fill="#93ab9f"/><path d="M522 62l21-26 21 26z" fill="#6f8f84"/>' +
      '<rect x="572" y="78" width="22" height="46" fill="#a0b7ab"/><path d="M568 78l15-20 15 20z" fill="#7a998d"/>' +
      '<rect x="506" y="92" width="22" height="32" fill="#a0b7ab"/><path d="M502 92l15-18 15 18z" fill="#7a998d"/>' +
      '<rect x="536" y="80" width="5" height="9" fill="#e6efe9"/><rect x="580" y="92" width="4" height="8" fill="#e6efe9"/>' +
      '<rect x="333" y="4" width="364" height="192" fill="none" stroke="#7a9a8a" stroke-width="6"/>' +
      '<path d="M515 4v192M333 90h364" stroke="#7a9a8a" stroke-width="4"/>' +
      '<g transform="rotate(-4 372 52)"><rect x="344" y="26" width="58" height="52" fill="#f1e8d1"/><path d="M352 42h42M352 52h36M352 62h28" stroke="#b9a77a" stroke-width="2" stroke-linecap="round"/></g>' +
      '<rect x="330" y="176" width="370" height="24" fill="#c7b79a"/>' +
      '<rect x="400" y="164" width="52" height="12" rx="2" fill="#7c8fb0"/><rect x="404" y="152" width="46" height="12" rx="2" fill="#a86f6f"/><rect x="398" y="140" width="50" height="12" rx="2" fill="#6f9a85"/>' +
      '<ellipse cx="506" cy="164" rx="40" ry="14" fill="#fbf8f0"/><circle cx="478" cy="160" r="12" fill="#fbf8f0"/><path d="M468 152l3-9 6 6zM482 148l5-8 3 10z" fill="#fbf8f0"/><path d="M473 161q3 2 6 0" fill="none" stroke="#8a8a80" stroke-width="1.4" stroke-linecap="round"/>' +
      '<rect x="580" y="148" width="24" height="28" rx="4" fill="#fbf8f0" stroke="#b9a77a" stroke-width="1.6"/><circle cx="592" cy="162" r="4" fill="#e7c0c4"/>' +
      '<rect x="356" y="132" width="20" height="44" rx="6" fill="#e8f2f0" stroke="#7a9a8a" stroke-width="2"/>' +
      '<path d="M366 132c-4-30-2-60 4-90M366 132c8-24 16-44 26-60M366 132c-10-18-22-32-34-40" fill="none" stroke="#5f8a6a" stroke-width="2.4" stroke-linecap="round"/>' +
      '<ellipse cx="368" cy="60" rx="9" ry="4.5" transform="rotate(-60 368 60)" fill="#6f9a6a"/><ellipse cx="392" cy="76" rx="9" ry="4.5" transform="rotate(40 392 76)" fill="#7fae78"/><ellipse cx="344" cy="100" rx="9" ry="4.5" transform="rotate(30 344 100)" fill="#7fae78"/>' +
      '<circle cx="372" cy="44" r="4" fill="#f1cdd3"/><circle cx="396" cy="66" r="4" fill="#f4e0b8"/><circle cx="338" cy="90" r="4" fill="#f1cdd3"/>' +
      '</svg>';
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
    if (renamed && typeof UnrecordedStudy !== 'undefined' && UnrecordedStudy.renameTestSubject) UnrecordedStudy.renameTestSubject(renamed.from, renamed.to); // keep stored test subject names in step
    if (typeof Planner !== 'undefined' && Planner.refreshSubjectOptions) Planner.refreshSubjectOptions(renamed);
    if (renamed && activeSubject === renamed.from) activeSubject = renamed.to;
    if (removed && activeSubject === removed && view !== 'subjects') { view = 'subjects'; activeTopicId = null; }
    render();
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

  function openChapterFrom(subject, topicId, backView) {
    activeSubject = subject;
    activeTopicId = topicId;
    chapterBackView = backView;
    showView('chapter');
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
    const addTile = container.querySelector('.library-add-tile');
    if (addTile) addTile.style.display = q ? 'none' : '';
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

    let html = '<div class="library-banner">' +
        bannerArt() +
        '<div class="library-banner-text">' +
          '<h3 class="library-banner-title">Library</h3>' +
          '<p class="library-banner-tag">Your subjects, your world.<br>One chapter at a time.</p>' +
        '</div>' +
      '</div>' +
      '<div class="library-header">' +
        '<h4 class="library-header-title library-hand-title section-heading">My Subjects</h4>' +
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
        const prog = subjectProgress(topics);
        return '<div class="library-tile" data-tint="' + subjectTint(s) + '" data-name="' + esc(s.toLowerCase()) + '" data-topics="' + esc(topics.map(function (t) { return t.topicName.toLowerCase(); }).join('|')) + '">' +
          '<button class="library-tile-open" data-subject="' + esc(s) + '">' +
            '<span class="library-tile-art">' + subjectArt(s) + '</span>' +
            '<span class="library-tile-body">' +
              '<span class="library-tile-name">' + esc(s) + '</span>' +
              '<span class="library-tile-meta">' + topics.length + (topics.length === 1 ? ' chapter' : ' chapters') + (due ? ' \u00B7 ' + due + ' due' : '') + '</span>' +
            '</span>' +
            '<span class="library-tile-progress" title="' + prog.done + ' of ' + prog.total + ' tasks done">' +
              '<span class="library-tile-bar"><span class="library-tile-fill" style="--p:' + prog.pct + '%;"></span></span>' +
              '<span class="library-tile-pct">' + prog.pct + '%</span>' +
            '</span>' +
          '</button>' +
          '<button class="library-more-btn library-tile-more" data-subject="' + esc(s) + '" title="Subject options" aria-label="Options for ' + esc(s) + '">&#8943;</button>' +
        '</div>';
      }).join('') +
        '<button class="library-add-tile" type="button" aria-label="Add subject">' +
          '<span class="library-add-tile-plus" aria-hidden="true">+</span>' +
          '<span class="library-add-tile-title">Add Subject</span>' +
          '<span class="library-add-tile-sub">Start a new subject and build your library.</span>' +
        '</button>' +
      '</div>';

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
      openMenu('Library', items);
    });

    const addTile = container.querySelector('.library-add-tile');
    if (addTile) addTile.addEventListener('click', openAddSubjectModal);
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
    const prog = subjectProgress(topics);

    const allFilterTags = TagsData.getAllTagsList();
    const tagChipsHtml = allFilterTags.length === 0 ? '' :
      '<div class="library-filter-chips chip-row" id="library-filter-chips">' +
        allFilterTags.map(function (tag) {
          return '<button class="library-filter-chip chip" data-tag-id="' + tag.tagId + '" style="border-color:' + tag.color + '">' + esc(tag.name) + '</button>';
        }).join('') +
      '</div>';

    const cardHtml = '<div class="library-subject-card" data-tint="' + subjectTint(activeSubject) + '">' +
        '<span class="library-subject-card-art">' + subjectArt(activeSubject) + '</span>' +
        '<div class="library-subject-card-body">' +
          '<div class="library-subject-card-name">' + esc(activeSubject) + '</div>' +
          '<div class="library-subject-card-meta">' + topics.length + (topics.length === 1 ? ' chapter' : ' chapters') + ' \u2022 ' + prog.pct + '%</div>' +
          '<span class="library-tile-bar" title="' + prog.done + ' of ' + prog.total + ' tasks done"><span class="library-tile-fill" style="--p:' + prog.pct + '%;"></span></span>' +
        '</div>' +
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
      cardHtml +
      '<div id="library-search-row" class="library-search-row"' + (searchVisible ? '' : ' style="display:none;"') + '>' +
        '<input type="text" id="library-search" class="input" placeholder="Search chapters..." value="' + esc(searchQuery) + '">' +
        tagChipsHtml +
      '</div>';

    if (topics.length === 0) {
      html += '<p class="planner-empty empty-state">No chapters yet for ' + esc(activeSubject) + '.' + (isActive ? ' Tap + to add one.' : '') + '</p>';
    } else {
      html += '<div class="planner-history-chapter-list list-row-group" id="library-chapter-list">' + topics.map(function (t, idx) {
        const isFav = favIds.indexOf(t.topicId) !== -1;
        const tp = topicProgress(t.topicId);
        const dot = t.color ? '<span class="library-topic-color-dot" style="background:' + t.color + '"></span>' : '';
        const st = topicStatus(t.topicId);
        return '<div class="planner-history-chapter-item list-row library-topic-row" data-name="' + esc(t.topicName.toLowerCase()) + '" data-tags="' + (t.tags || []).join(',') + '">' +
          dot +
          '<button class="library-topic-open" data-topic-id="' + t.topicId + '">' +
            '<span class="library-topic-name">' + (idx + 1) + '. ' + (isFav ? '\u2605 ' : '') + esc(t.topicName) + '</span>' +
            '<span class="library-topic-status' + (st.due ? ' is-due' : '') + '">' + esc(st.text) + '</span>' +
          '</button>' +
          '<span class="library-topic-count" title="Tasks done / total">' + tp.done + ' / ' + tp.total + '</span>' +
          '<span class="library-topic-ring' + (tp.total && tp.done === tp.total ? ' is-done' : '') + '" aria-hidden="true"></span>' +
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

  function init() {
    if (typeof TagsData !== 'undefined') TagsData.migrateLegacyStringTags();
    render();
  }
  function renderPanel() { render(); }
  return { init: init, render: render, renderPanel: renderPanel, openTopic: openTopic, openSubject: openSubject, openPlan: openPlan };
})();
