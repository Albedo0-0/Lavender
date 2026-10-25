// tags.js — Tag manager UI (v1.1). Depends on: State, TagsData, PlannerData, Modal, Library.
// Reuses the shared Modal system — no new modal pattern.

const Tags = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }

  function openManagerForTopic(topicId) {
    render(topicId);
  }

  function render(topicId) {
    const topic = PlannerData.getAllTopics()[topicId] || {};
    const attachedIds = topic.tags || [];
    const allTags = TagsData.getAllTagsList();

    const chipsHtml = allTags.length === 0 ? '<p class="planner-empty empty-state">No tags yet.</p>' :
      allTags.map(function (tag) {
        const isOn = attachedIds.indexOf(tag.tagId) !== -1;
        return '<button class="tag-chip chip' + (isOn ? ' tag-chip-active' : '') + '" data-tag-id="' + tag.tagId + '" style="border-color:' + tag.color + ';background:' + (isOn ? tag.color : 'transparent') + '">' +
          esc(tag.name) +
          '<span class="tag-chip-del" role="button" tabindex="0" aria-label="Delete tag" data-tag-id="' + tag.tagId + '">&times;</span>' +
        '</button>';
      }).join('');

    Modal.open(
      '<h3 class="section-heading">Tags</h3>' +
      '<div class="tag-chip-list chip-row" id="tag-manager-list">' + chipsHtml + '</div>' +
      '<div class="tag-create-row">' +
        '<input type="text" id="tag-new-name" class="input" placeholder="New tag name">' +
        '<input type="color" id="tag-new-color" class="input" value="#b39ddb">' +
        '<button id="tag-new-save" class="btn btn-primary">Create</button>' +
      '</div>' +
      '<button id="tag-manager-close" class="btn btn-secondary">Done</button>'
    );

    document.querySelectorAll('#tag-manager-list .tag-chip').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (e.target.classList.contains('tag-chip-del')) return;
        const tagId = btn.dataset.tagId;
        const meta = PlannerData.getAllTopics()[topicId] || {};
        const isOn = (meta.tags || []).indexOf(tagId) !== -1;
        if (isOn) TagsData.detachTagFromTopic(topicId, tagId);
        else TagsData.attachTagToTopic(topicId, tagId);
        render(topicId);
      });
    });

    document.querySelectorAll('#tag-manager-list .tag-chip-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('Delete this tag everywhere?')) return;
        TagsData.deleteTag(btn.dataset.tagId);
        render(topicId);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        btn.click();
      });
    });

    document.getElementById('tag-new-save').addEventListener('click', function () {
      const name = document.getElementById('tag-new-name').value.trim();
      if (!name) return;
      const color = document.getElementById('tag-new-color').value;
      const tag = TagsData.createTag(name, color);
      TagsData.attachTagToTopic(topicId, tag.tagId);
      render(topicId);
    });

    document.getElementById('tag-manager-close').addEventListener('click', function () {
      Modal.close();
      if (typeof Library !== 'undefined' && Library.render) Library.render();
    });
  }

  // ---------- Global Tag Manager (standalone utility) ----------
  // Reads relationships and mutates only through TagsData / State — no second registry or index.

  let mgrBack = null;
  let mgrQuery = '';
  let mgrDirty = false;

  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

  function pickLabel(obj, keys, fallback) {
    for (let i = 0; obj && i < keys.length; i++) {
      if (obj[keys[i]]) return String(obj[keys[i]]);
    }
    return fallback;
  }

  function mgrTaskLabel(t) {
    if (!t) return 'Untitled task';
    let planLabel = '';
    try { planLabel = PlanData.taskLabel(t) || ''; } catch (err) { planLabel = ''; }
    return t.title || t.topicName || planLabel || 'Untitled task';
  }

  function mgrBackHtml() {
    return '<div class="modal-header"><button type="button" id="tagmgr-back" class="btn-secondary">' + (mgrBack ? '\u2190 Back' : 'Close') + '</button></div>';
  }

  // Library shows tag names/chips, so refresh it once when the manager is left after any change.
  function mgrFlush() {
    if (!mgrDirty) return;
    mgrDirty = false;
    if (typeof Library !== 'undefined' && Library.render) Library.render();
  }

  function openManager(opts) {
    mgrBack = (opts && typeof opts.onBack === 'function') ? opts.onBack : null;
    mgrQuery = '';
    mgrDirty = false;
    renderManagerList();
  }

  function renderManagerList() {
    Modal.open(
      mgrBackHtml() +
      '<div class="tagmgr-page">' +
        '<h3 class="section-title">Tags</h3>' +
        '<div class="form-row"><input type="text" id="tagmgr-search" class="input" placeholder="Search tags..." autocomplete="off" value="' + escAttr(mgrQuery) + '"></div>' +
        '<div id="tagmgr-list"></div>' +
      '</div>'
    );
    document.getElementById('tagmgr-back').addEventListener('click', function () {
      Modal.close();
      mgrFlush();
      if (mgrBack) mgrBack();
    });
    document.getElementById('tagmgr-search').addEventListener('input', function (e) {
      mgrQuery = e.target.value;
      renderManagerRows();
    });
    renderManagerRows();
  }

  function renderManagerRows() {
    const host = document.getElementById('tagmgr-list');
    if (!host) return;
    const all = TagsData.getAllTagsList();
    const q = mgrQuery.trim().toLowerCase();
    const rows = q ? all.filter(function (t) { return (t.name || '').toLowerCase().indexOf(q) !== -1; }) : all;
    host.innerHTML = rows.length ? rows.map(function (t) {
      return '<div class="list-row list-row-compact tagmgr-row" role="button" tabindex="0" data-tag-id="' + escAttr(t.tagId) + '">' +
        '<span class="tagmgr-dot" style="background:' + escAttr(t.color) + '"></span>' +
        '<span class="list-row-title">' + esc(t.name) + '</span>' +
        '<span class="list-row-meta" aria-hidden="true">\u203a</span>' +
      '</div>';
    }).join('') : '<div class="empty-state">' + (all.length ? 'No matching tags.' : 'No tags yet.') + '</div>';
    host.querySelectorAll('.tagmgr-row').forEach(function (row) {
      row.addEventListener('click', function () { openManagerDetail(row.dataset.tagId); });
      row.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openManagerDetail(row.dataset.tagId);
      });
    });
  }

  function mgrGroups(links) {
    const state = State.get();
    const topics = PlannerData.getAllTopics() || {};
    const habits = state.habits || {};
    const tasks = state.tasks || {};
    const targets = state.targets || {};
    return [
      { title: 'Habits', kind: 'habit', items: links.habitIds.map(function (id) { return { id: id, label: pickLabel(habits[id], ['title'], 'Untitled habit') + (habits[id] && habits[id].archived ? ' (archived)' : '') }; }) },
      { title: 'Topics', kind: 'topic', items: links.topicIds.map(function (id) { return { id: id, label: pickLabel(topics[id], ['topicName'], 'Untitled topic') }; }) },
      { title: 'Plans \u00b7 Targets', kind: 'target', items: links.targetIds.map(function (id) { return { id: id, label: pickLabel(targets[id], ['title'], 'Untitled plan') }; }) },
      { title: 'Plans \u00b7 Tasks', kind: 'task', items: links.taskIds.map(function (id) { return { id: id, label: mgrTaskLabel(tasks[id]) }; }) }
    ].filter(function (g) { return g.items.length; });
  }

  function mgrGroupHtml(g) {
    return '<div class="tagmgr-group">' +
      '<h4 class="section-title">' + esc(g.title) + ' <span class="micro-label">(' + g.items.length + ')</span></h4>' +
      g.items.map(function (it) {
        return '<div class="list-row list-row-compact tagmgr-item">' +
          '<span class="list-row-title">' + esc(it.label) + '</span>' +
          '<span class="list-row-actions">' +
            '<button type="button" class="btn-secondary tagmgr-detach" data-kind="' + g.kind + '" data-id="' + escAttr(it.id) + '" aria-label="Remove tag from ' + escAttr(it.label) + '">Remove</button>' +
          '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  // Detaches from ONE item only; the tag record and all other relationships are untouched.
  function mgrDetach(kind, id, tagId) {
    if (kind === 'topic') TagsData.detachTagFromTopic(id, tagId);
    else if (kind === 'habit') TagsData.detachTagFromHabit(id, tagId);
    else if (kind === 'task') TagsData.detachTagFromRecord('tasks', id, tagId);
    else if (kind === 'target') TagsData.detachTagFromRecord('targets', id, tagId);
  }

  function openManagerDetail(tagId) {
    const tag = TagsData.getTag(tagId);
    if (!tag) { renderManagerList(); return; }
    const links = TagsData.getLinksForTag(tagId);
    const groups = mgrGroups(links);
    const canPtpe = (typeof PTPEView !== 'undefined' && PTPEView.openExplorer) && (typeof Nav !== 'undefined' && Nav.switchTo);

    let body = groups.map(mgrGroupHtml).join('');
    if (!groups.length) body = '<div class="empty-state">This tag isn\'t attached to anything yet.</div>';
    if (links.inheritedTaskCount > 0) {
      body += '<p class="micro-label">' + links.inheritedTaskCount + ' task' + (links.inheritedTaskCount === 1 ? '' : 's') +
        ' also carry this tag through their topics. Remove it from the topic to detach them.</p>';
    }

    Modal.open(
      '<div class="modal-header"><button type="button" id="tagmgr-back" class="btn-secondary">\u2190 Back</button></div>' +
      '<div class="tagmgr-page">' +
        '<h3 class="section-title tagmgr-title"><span class="tagmgr-dot" style="background:' + escAttr(tag.color) + '"></span>' + esc(tag.name) + '</h3>' +
        '<div class="tagmgr-rename">' +
          '<input type="text" id="tagmgr-rename-input" class="input" value="' + escAttr(tag.name) + '" aria-label="Tag name">' +
          '<button type="button" id="tagmgr-rename-save" class="btn btn-primary">Rename</button>' +
        '</div>' +
        '<div class="micro-label" id="tagmgr-msg" role="status"></div>' +
        '<hr class="divider">' +
        body +
        '<hr class="divider">' +
        '<div class="tagmgr-actions">' +
          (canPtpe ? '<button type="button" id="tagmgr-ptpe" class="btn btn-secondary">Open in PTPE graph</button>' : '') +
          '<button type="button" id="tagmgr-delete" class="btn btn-danger">Delete tag everywhere</button>' +
        '</div>' +
      '</div>'
    );

    document.getElementById('tagmgr-back').addEventListener('click', renderManagerList);

    const input = document.getElementById('tagmgr-rename-input');
    const msg = document.getElementById('tagmgr-msg');
    function doRename() {
      const val = input.value.trim();
      if (!val) { msg.textContent = 'Enter a name.'; return; }
      if (val === tag.name) { msg.textContent = 'That is already the name.'; return; }
      const clash = TagsData.findTagByName(val);
      if (clash && clash.tagId !== tagId) { msg.textContent = 'A tag with that name already exists.'; return; }
      if (TagsData.renameTag(tagId, val)) {
        mgrDirty = true;
        openManagerDetail(tagId);
      }
    }
    document.getElementById('tagmgr-rename-save').addEventListener('click', doRename);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doRename(); } });

    document.querySelectorAll('.tagmgr-detach').forEach(function (btn) {
      btn.addEventListener('click', function () {
        mgrDetach(btn.dataset.kind, btn.dataset.id, tagId);
        mgrDirty = true;
        openManagerDetail(tagId);
      });
    });

    const ptpeBtn = document.getElementById('tagmgr-ptpe');
    if (ptpeBtn) {
      ptpeBtn.addEventListener('click', function () {
        Modal.close();
        mgrFlush();
        PTPEView.openExplorer({ dim: 'tag', id: tagId, metric: 'studyHours' });
        Nav.switchTo('progress');
      });
    }

    document.getElementById('tagmgr-delete').addEventListener('click', function () {
      if (!confirm('Delete "' + tag.name + '" everywhere? It will be removed from every linked item.')) return;
      TagsData.deleteTag(tagId);
      mgrDirty = true;
      renderManagerList();
    });
  }

  return { openManagerForTopic: openManagerForTopic, openManager: openManager };
})();
