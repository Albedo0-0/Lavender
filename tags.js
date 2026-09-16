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
          '<span class="tag-chip-del" data-tag-id="' + tag.tagId + '">&times;</span>' +
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

  return { openManagerForTopic: openManagerForTopic };
})();
