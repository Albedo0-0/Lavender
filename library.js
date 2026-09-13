// library.js — Library screen: single home for the topic collection (Cleanup Item 1).
// Depends on: State, PlannerData, Modal, Planner, Nav. Topic-scoped Links live here (Cleanup Item 4).

const Library = (function () {
  let view = 'subjects'; // 'subjects' | 'chapters' | 'chapter'
  let activeSubject = null;
  let activeTopicId = null;
  const PANEL_TABS = ['today', 'pending', 'history', 'upcoming', 'targets', 'archived'];
  let panelTabIdx = 0;
  let panelCollapsed = false;
  let historyFilterTopicId = null; // set when History is opened from a chapter's action row
  let chapterBackView = 'chapters'; // where the chapter view's Back button should return to
  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }

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

  function openSubject(subject) {
    activeSubject = subject;
    view = 'chapters';
    render();
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
        chapterBackView = 'subjects';
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
        chapterBackView = 'chapters';
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
        '<button id="library-action-target">Target</button>' +
        '<button id="library-action-edit">Edit</button>' +
        '<button id="library-action-remove">Remove</button>' +
      '</div>';

    container.querySelector('.planner-history-back').addEventListener('click', function () {
      view = chapterBackView;
      render();
    });

    document.getElementById('library-action-planner').addEventListener('click', function () {
      Planner.openForTopic(activeSubject, activeTopicId);
    });
    document.getElementById('library-action-history').addEventListener('click', function () {
      historyFilterTopicId = activeTopicId;
      panelTabIdx = PANEL_TABS.indexOf('history');
      expandRightPanel();
    });
    document.getElementById('library-action-upcoming').addEventListener('click', function () {
      openUpcomingModal(activeTopicId);
    });
    document.getElementById('library-action-links').addEventListener('click', function () {
      openLinksModal(activeTopicId);
    });
    document.getElementById('library-action-target').addEventListener('click', function () {
      Targets.open();
    });

    renderTopicTargetsChecklist(container, activeTopicId);
    document.getElementById('library-action-edit').addEventListener('click', function () {
      const name = prompt('Rename chapter:', chapterName);
      if (name && name.trim()) {
        PlannerData.renameTopic(activeTopicId, name.trim());
        render();
      }
    });
    document.getElementById('library-action-remove').addEventListener('click', function () {
      const ok = PlannerData.deleteTopic(activeTopicId);
      if (!ok) { alert('Cannot remove a chapter with active (non-archived) tasks. Archive its tasks first.'); return; }
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

  function renderTopicTargetsChecklist(container, topicId) {
    const targets = TargetsData.getTargetsForTopic(topicId);
    if (targets.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'library-topic-targets-dropdown';
    wrap.innerHTML =
      '<button class="library-topic-targets-toggle" type="button">Subtargets \u25BE</button>' +
      '<div class="library-topic-targets-body" style="display:none">' +
        targets.map(function (tg) {
          const subs = TargetsData.getSubtargetsForTarget(tg.targetId);
          if (subs.length === 0) return '';
          return '<div class="library-topic-target-group"><strong>' + esc(tg.title) + '</strong>' +
            subs.map(function (s) {
              return '<label class="library-topic-subtarget-row">' +
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
    const tasks = PlannerData.getTasksForTopic(topicId).filter(function (t) { return !t.completed && t.date > today; });
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

  function openEditTaskModal(taskId) {
    const t = PlannerData.getTask(taskId);
    if (!t) return;
    const isCustom = t.taskType === 'custom';
    Modal.open(
      '<h3>Edit Task</h3>' +
      (isCustom
        ? '<label class="planner-field-label">Title</label><input type="text" id="library-edit-title" value="' + (t.title || '').replace(/"/g, '&quot;') + '">'
        : '<div class="planner-tasktype-row">' +
            '<label><input type="radio" name="library-edit-tasktype" value="revision"' + (t.taskType === 'revision' ? ' checked' : '') + '> Revision</label>' +
            '<label><input type="radio" name="library-edit-tasktype" value="theory"' + (t.taskType === 'theory' ? ' checked' : '') + '> Theory</label>' +
            '<label><input type="radio" name="library-edit-tasktype" value="questions"' + (t.taskType === 'questions' ? ' checked' : '') + '> Qs</label>' +
          '</div>') +
      '<label class="planner-field-label">Date</label><input type="date" id="library-edit-date" value="' + (t.date || '') + '">' +
      '<label class="planner-field-label">Note</label><textarea id="library-edit-note" rows="3">' + (t.note || '') + '</textarea>' +
      '<button id="library-edit-save">Save</button>' +
      '<button id="library-edit-cancel">Cancel</button>'
    );
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
      PlannerData.updateTask(taskId, patch);
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

    if (tab === 'archived') {
      const archivedTasks = PlannerData.getArchivedTasks();
      const archivedTargets = TargetsData.getArchivedTargetsList();
      if (!archivedTasks.length && !archivedTargets.length) { content.innerHTML = '<p class="planner-empty">Nothing archived.</p>'; return; }

      const taskRows = archivedTasks.map(function (t) {
        const meta = t.taskType === 'custom' ? t.title : (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t));
        return '<div class="planner-task-row" data-task-id="' + t.taskId + '">' +
          '<span class="planner-task-meta">' + meta + '</span>' +
          '<div class="planner-task-sub">Archived: ' + t.archivedAt + '</div>' +
          '<button class="library-unarchive-task-btn" data-task-id="' + t.taskId + '">Unarchive</button>' +
        '</div>';
      }).join('');

      const targetRows = archivedTargets.map(function (tg) {
        return '<div class="planner-task-row" data-target-id="' + tg.targetId + '">' +
          '<span class="planner-task-meta">' + esc(tg.title) + '</span>' +
          '<div class="planner-task-sub">Archived: ' + tg.archivedAt + '</div>' +
          '<button class="library-unarchive-target-btn" data-target-id="' + tg.targetId + '">Unarchive</button>' +
        '</div>';
      }).join('');

      content.innerHTML = taskRows + targetRows;

      content.querySelectorAll('.library-unarchive-task-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          PlannerData.unarchiveTask(btn.dataset.taskId);
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
      if (!targets.length) { content.innerHTML = '<p class="planner-empty">No targets yet.</p>'; return; }

      content.innerHTML = targets.map(function (tg) {
        const subs = TargetsData.getSubtargetsForTarget(tg.targetId);
        const valueInput = (tg.type === 'hours' || tg.type === 'questions') && !tg.completed
          ? '<input type="number" class="library-target-value-input" data-target-id="' + tg.targetId + '" min="0" max="' + tg.targetValue + '" value="' + tg.currentValue + '" style="width:52px;margin-left:4px">'
          : '';
        const subsHtml = subs.length === 0 ? '' :
          '<div class="library-target-subs" style="display:none">' +
            subs.map(function (s) {
              return '<label class="library-topic-subtarget-row">' +
                '<input type="checkbox" class="library-target-sub-check" data-subtarget-id="' + s.subtargetId + '" data-parent-id="' + tg.targetId + '" ' + (s.completed ? 'checked' : '') + '> ' +
                esc(s.title) + ' (' + s.currentValue + '/' + s.targetValue + ')' +
              '</label>';
            }).join('') +
          '</div>';

        return '<div class="planner-task-row' + (tg.completed ? ' planner-task-done' : '') + '" data-target-id="' + tg.targetId + '">' +
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
            '<input type="checkbox" class="library-target-check" data-target-id="' + tg.targetId + '" ' + (tg.completed ? 'checked' : '') + '>' +
            '<span class="planner-task-meta">' + esc(tg.title) + '</span>' +
            valueInput +
            (subs.length > 0 ? '<button class="library-target-subs-toggle" data-target-id="' + tg.targetId + '" style="font-size:11px;padding:1px 4px">&#9660;</button>' : '') +
            '<button class="library-archive-target-btn" data-target-id="' + tg.targetId + '" style="font-size:11px;padding:1px 4px">Archive</button>' +
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
    if (tab === 'today') tasks = PlannerData.getTodayTasks();
    else if (tab === 'pending') tasks = PlannerData.getPendingTasks();
    else if (tab === 'upcoming') tasks = PlannerData.getUpcomingTasks();
    else tasks = historyFilterTopicId
      ? PlannerData.getHistoryTasks().filter(function (t) { return t.topicId === historyFilterTopicId; })
      : PlannerData.getHistoryTasks();
    if (!tasks.length) { content.innerHTML = '<p class="planner-empty">Nothing here.</p>'; return; }
    const sessionActive = typeof Study !== 'undefined' && Study.isSessionActive && Study.isSessionActive();
    content.innerHTML = tasks.map(function (t) {
      const meta = t.taskType === 'custom' ? t.title : (t.subject + ' \u00B7 ' + t.topicName + ' \u00B7 ' + PlannerData.taskLabel(t));
      const slot = PlannerData.slotLabel(t);
      const startBtn = (tab !== 'history' && !t.completed)
        ? '<button class="library-panel-start-btn" data-task-id="' + t.taskId + '"' + (sessionActive ? ' disabled' : '') + '>Start now</button>'
        : '';
      return '<div class="planner-task-row' + (t.completed ? ' planner-task-done' : '') + '">' +
        '<label class="planner-task-check-label">' +
          '<input type="checkbox" class="library-panel-task-check" data-task-id="' + t.taskId + '"' + (t.completed ? ' checked' : '') + '>' +
          '<span class="planner-task-meta">' + meta + '</span>' +
        '</label>' +
        '<div class="planner-task-sub">' + t.date + (slot ? ' \u00B7 ' + slot : '') + '</div>' +
        startBtn +
        '<button class="library-edit-task-btn" data-task-id="' + t.taskId + '">Edit</button>' +
        '<button class="library-delete-task-btn" data-task-id="' + t.taskId + '">Delete</button>' +
        '<button class="library-archive-task-btn" data-task-id="' + t.taskId + '">Archive</button>' +
      '</div>';
    }).join('');

    content.querySelectorAll('.library-panel-task-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        PlannerData.toggleComplete(cb.dataset.taskId);
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
    content.querySelectorAll('.library-delete-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Modal.open(
          '<h3>Delete task?</h3><p>This cannot be undone.</p>' +
          '<button id="library-delete-task-confirm">Delete</button>' +
          '<button id="library-delete-task-cancel">Cancel</button>'
        );
        document.getElementById('library-delete-task-confirm').addEventListener('click', function () {
          PlannerData.deleteTask(btn.dataset.taskId);
          Modal.close();
          renderRightPanel();
        });
        document.getElementById('library-delete-task-cancel').addEventListener('click', function () { Modal.close(); });
      });
    });
    content.querySelectorAll('.library-archive-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        PlannerData.archiveTask(btn.dataset.taskId);
        renderRightPanel();
      });
    });
  }
  function expandRightPanel() {
    panelCollapsed = false;
    const rightPanel = document.getElementById('library-right-panel');
    const expandBtn = document.getElementById('library-panel-expand');
    const plannerSide = document.getElementById('planner-side');
    const libraryLeft = document.getElementById('library-left');
    if (rightPanel) rightPanel.style.display = '';
    if (expandBtn) expandBtn.style.display = 'none';
    if (plannerSide && libraryLeft) { libraryLeft.appendChild(plannerSide); plannerSide.style.cssText = ''; }
    renderRightPanel();
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
    const deleteAllBtn = document.getElementById('library-delete-all-archived');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', function () {
      Modal.open(
        '<h3>Delete all archived items?</h3><p>This cannot be undone.</p>' +
        '<button id="library-delete-all-confirm">Delete All</button>' +
        '<button id="library-delete-all-cancel">Cancel</button>'
      );
      document.getElementById('library-delete-all-confirm').addEventListener('click', function () {
        PlannerData.getArchivedTasks().forEach(function (t) { PlannerData.deleteTask(t.taskId); });
        TargetsData.getArchivedTargetsList().forEach(function (tg) { TargetsData.deleteTarget(tg.targetId); });
        Modal.close();
        renderRightPanel();
      });
      document.getElementById('library-delete-all-cancel').addEventListener('click', function () { Modal.close(); });
    });
    const layout = document.getElementById('library-layout');
    const plannerSide = document.getElementById('planner-side');
    if (collapseBtn) collapseBtn.addEventListener('click', function () {
      panelCollapsed = true;
      if (rightPanel) rightPanel.style.display = 'none';
      if (expandBtn) expandBtn.style.display = 'block';
      if (plannerSide && layout) layout.appendChild(plannerSide);
      plannerSide.style.cssText = 'flex:0 0 50%;border-left:1px solid #eee;border-top:none;overflow-y:auto;padding:8px;box-sizing:border-box;';
    });
        if (expandBtn) expandBtn.addEventListener('click', expandRightPanel);
    if (prevBtn) prevBtn.addEventListener('click', function () { historyFilterTopicId = null; });
    if (nextBtn) nextBtn.addEventListener('click', function () { historyFilterTopicId = null; });
  }
  function renderPanel() { renderRightPanel(); }
  return { init: init, render: render, renderPanel: renderPanel, openTopic: openTopic, openSubject: openSubject };
})();
