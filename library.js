// library.js — Library screen: single home for the topic collection (Cleanup Item 1).
// Depends on: State, PlannerData, Modal, Planner, Nav. Topic-scoped Links live here (Cleanup Item 4).

const Library = (function () {
  let view = 'subjects'; // 'subjects' | 'chapters' | 'chapter'
  let activeSubject = null;
  let activeTopicId = null;
  const PANEL_TABS = ['today', 'pending', 'history', 'upcoming'];
  let panelTabIdx = 0;
  let panelCollapsed = false;
  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

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

  function renderSubjects(container) {
    const favIds = State.get().favoriteTopics || [];
    const allTopics = PlannerData.getAllTopics();
    const favTopics = favIds.map(function (id) { return allTopics[id]; }).filter(Boolean);

    let html = '';
    if (favTopics.length > 0) {
      html += '<div class="planner-history-favorites">' +
        '<div class="planner-suggested-group-title">Favorites</div>' +
        favTopics.map(function (t) {
          return '<button class="planner-history-fav-btn" data-subject="' + t.subject + '" data-topic-id="' + t.topicId + '">' + t.subject + ' \u00B7 ' + t.topicName + '</button>';
        }).join('') +
      '</div>';
    }

    html += '<div class="planner-history-subject-list">' + PlannerData.SUBJECTS.map(function (subject) {
      return '<button class="planner-history-subject-btn" data-subject="' + subject + '">' + subject + '</button>';
    }).join('') + '</div>';

    container.innerHTML = html;

    container.querySelectorAll('.planner-history-fav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeSubject = btn.dataset.subject;
        activeTopicId = btn.dataset.topicId;
        view = 'chapter';
        render();
      });
    });

    container.querySelectorAll('.planner-history-subject-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeSubject = btn.dataset.subject;
        view = 'chapters';
        render();
      });
    });
  }

  function renderChapters(container) {
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[activeSubject] || [];
    const favIds = State.get().favoriteTopics || [];

    let html = '<button class="planner-history-back">&lt; Subjects</button>' +
      '<h4 class="planner-history-heading">' + activeSubject + '</h4>' +
      '<input type="text" id="library-search" placeholder="Search chapters...">' +
      '<button id="library-add-topic-btn">Add Topic</button>';

    if (topics.length === 0) {
      html += '<p class="planner-empty">No chapters yet for ' + activeSubject + '.</p>';
    } else {
      html += '<div class="planner-history-chapter-list" id="library-chapter-list">' + topics.map(function (t) {
        const isFav = favIds.indexOf(t.topicId) !== -1;
        return '<div class="planner-history-chapter-item" data-name="' + t.topicName.toLowerCase() + '">' +
          '<button class="planner-history-chapter-btn" data-topic-id="' + t.topicId + '">' + t.topicName + '</button>' +
          '<button class="planner-history-fav-toggle' + (isFav ? ' active' : '') + '" data-topic-id="' + t.topicId + '">' + (isFav ? '\u2605' : '\u2606') + '</button>' +
        '</div>';
      }).join('') + '</div>';
    }

    container.innerHTML = html;

    container.querySelector('.planner-history-back').addEventListener('click', function () {
      view = 'subjects';
      render();
    });

    container.querySelectorAll('.planner-history-chapter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTopicId = btn.dataset.topicId;
        view = 'chapter';
        render();
      });
    });

    container.querySelectorAll('.planner-history-fav-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleFavoriteTopic(btn.dataset.topicId);
        render();
      });
    });

    document.getElementById('library-add-topic-btn').addEventListener('click', function () {
      const name = prompt('New chapter name for ' + activeSubject + ':');
      if (name && name.trim()) {
        PlannerData.getOrCreateTopic(activeSubject, name.trim());
        render();
      }
    });

    const searchInput = document.getElementById('library-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        const q = searchInput.value.trim().toLowerCase();
        document.querySelectorAll('#library-chapter-list .planner-history-chapter-item').forEach(function (item) {
          item.style.display = item.dataset.name.indexOf(q) === -1 ? 'none' : 'flex';
        });
      });
    }
  }

  function renderChapter(container) {
    const grouped = PlannerData.getTopicsBySubject();
    const topics = grouped[activeSubject] || [];
    const topic = topics.find(function (t) { return t.topicId === activeTopicId; });
    const chapterName = topic ? topic.topicName : '';

    const topicMeta = PlannerData.getAllTopics()[activeTopicId] || {};
    const tags = topicMeta.tags || [];
    const tagsHtml = '<div class="library-topic-tags">' +
      tags.map(function (tag, i) {
        return '<span class="library-tag">' + tag + ' <button class="library-tag-del" data-idx="' + i + '">&times;</button></span>';
      }).join('') +
      '<input type="text" id="library-tag-input" placeholder="Add tag..." style="width:80px">' +
      '<button id="library-tag-add">+</button>' +
    '</div>';

    container.innerHTML =
      '<button class="planner-history-back">&lt; ' + activeSubject + '</button>' +
      '<h4 class="planner-history-heading">' + chapterName + '</h4>' +
      tagsHtml +
      '<div class="library-topic-actions">' +
        '<button id="library-action-planner">Planner</button>' +
        '<button id="library-action-history">History</button>' +
        '<button id="library-action-upcoming">Upcoming</button>' +
        '<button id="library-action-links">Links</button>' +
        '<button id="library-action-target" disabled title="Coming with Cleanup 6 / Feature 5">Target</button>' +
        '<button id="library-action-edit">Edit</button>' +
        '<button id="library-action-remove">Remove</button>' +
      '</div>';

    container.querySelector('.planner-history-back').addEventListener('click', function () {
      view = 'chapters';
      render();
    });

    document.getElementById('library-action-planner').addEventListener('click', function () {
      Planner.openForTopic(activeSubject, activeTopicId);
    });
    document.getElementById('library-action-history').addEventListener('click', function () {
      Planner.openHistory(activeSubject, activeTopicId);
    });
    document.getElementById('library-action-upcoming').addEventListener('click', function () {
      openUpcomingModal(activeTopicId);
    });
    document.getElementById('library-action-links').addEventListener('click', function () {
      openLinksModal(activeTopicId);
    });
    document.getElementById('library-action-edit').addEventListener('click', function () {
      const name = prompt('Rename chapter:', chapterName);
      if (name && name.trim()) {
        PlannerData.renameTopic(activeTopicId, name.trim());
        render();
      }
    });
    document.getElementById('library-action-remove').addEventListener('click', function () {
      const ok = PlannerData.deleteTopic(activeTopicId);
      if (!ok) { alert('Cannot remove a chapter with scheduled or completed tasks. Archiving arrives in Feature 8.'); return; }
      view = 'chapters';
      render();
    });

    document.getElementById('library-tag-add').addEventListener('click', function () {
      const val = document.getElementById('library-tag-input').value.trim();
      if (!val) return;
      const meta = PlannerData.getAllTopics()[activeTopicId] || {};
      const newTags = (meta.tags || []).concat([val]);
      PlannerData.updateTopicMeta(activeTopicId, { tags: newTags });
      render();
    });
    container.querySelectorAll('.library-tag-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const meta = PlannerData.getAllTopics()[activeTopicId] || {};
        const newTags = (meta.tags || []).filter(function (_, i) { return i !== Number(btn.dataset.idx); });
        PlannerData.updateTopicMeta(activeTopicId, { tags: newTags });
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
    const tasks = PlannerData.getTasksForTopic(topicId).filter(function (t) { return !t.completed && t.date >= today; });
    const html = tasks.length === 0
      ? '<p class="planner-empty">Nothing upcoming for this chapter.</p>'
      : tasks.map(function (t) {
          return '<div class="planner-task-row"><div class="planner-task-meta">' + PlannerData.taskLabel(t) + '</div>' +
            '<div class="planner-task-sub">Scheduled: ' + t.date + (PlannerData.slotLabel(t) ? ' \u00B7 ' + PlannerData.slotLabel(t) : '') + '</div></div>';
        }).join('');
    Modal.open('<h3>Upcoming</h3>' + html);
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
      ? '<p class="planner-empty">No links yet for this chapter.</p>'
      : list.map(function (l) {
          return '<div class="study-link-row">' +
            '<a href="' + l.url + '" target="_blank" rel="noopener">' + l.url + '</a>' +
            (l.note ? '<div class="study-link-note">' + l.note + '</div>' : '') +
            '<button class="study-link-delete" data-link-id="' + l.linkId + '">Remove</button>' +
          '</div>';
        }).join('');

    Modal.open(
      '<h3>Links</h3>' +
      '<div class="study-links-list">' + listHtml + '</div>' +
      '<div class="study-links-form">' +
        '<input type="url" id="study-link-url" placeholder="YouTube URL">' +
        '<textarea id="study-link-note" rows="2" placeholder="Note (optional)"></textarea>' +
        '<button id="study-link-save">Add Link</button>' +
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

  function renderRightPanel() {
    const label = document.getElementById('library-panel-tab-label');
    const content = document.getElementById('library-panel-content');
    if (!label || !content) return;
    const tab = PANEL_TABS[panelTabIdx];
    label.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
    let tasks;
    if (tab === 'today') tasks = PlannerData.getTodayTasks();
    else if (tab === 'pending') tasks = PlannerData.getPendingTasks();
    else if (tab === 'upcoming') tasks = PlannerData.getUpcomingTasks();
    else tasks = PlannerData.getHistoryTasks();
    if (!tasks.length) { content.innerHTML = '<p class="planner-empty">Nothing here.</p>'; return; }
    content.innerHTML = tasks.map(function (t) {
      const meta = t.taskType === 'custom' ? t.title : (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t));
      const slot = PlannerData.slotLabel(t);
      return '<div class="planner-task-row' + (t.completed ? ' planner-task-done' : '') + '">' +
        '<div class="planner-task-meta">' + meta + '</div>' +
        '<div class="planner-task-sub">' + t.date + (slot ? ' \u00B7 ' + slot : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function init() {
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
    if (collapseBtn) collapseBtn.addEventListener('click', function () {
      panelCollapsed = true;
      if (rightPanel) rightPanel.style.display = 'none';
      if (expandBtn) expandBtn.style.display = 'block';
    });
    if (expandBtn) expandBtn.addEventListener('click', function () {
      panelCollapsed = false;
      if (rightPanel) rightPanel.style.display = '';
      if (expandBtn) expandBtn.style.display = 'none';
      renderRightPanel();
    });
  }
  return { init: init, render: render, openTopic: openTopic };
})();
