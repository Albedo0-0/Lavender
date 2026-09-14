// tags-data.js — Global tag registry (v1.1). No UI here.
// State shape: State.get().tags = { tagId: { tagId, name, color, createdAt } }
// Topics carry tags as State.get().topics[topicId].tags = [tagId, ...] (see planner-data.js).

const TagsData = (function () {
  function generateId() { return 'tag_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function getAllTags() { return State.get().tags || {}; }

  function getAllTagsList() {
    const tags = getAllTags();
    return Object.keys(tags).map(function (id) { return tags[id]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function getTag(tagId) { return getAllTags()[tagId] || null; }

  function findTagByName(name) {
    const n = name.trim().toLowerCase();
    return getAllTagsList().find(function (t) { return t.name.toLowerCase() === n; }) || null;
  }

  function createTag(name, color) {
    const existing = findTagByName(name);
    if (existing) return existing;
    const tags = Object.assign({}, getAllTags());
    const tag = { tagId: generateId(), name: name.trim(), color: color || '#b39ddb', createdAt: Date.now() };
    tags[tag.tagId] = tag;
    State.set({ tags: tags });
    return tag;
  }

  function getOrCreateTagByName(name, color) {
    return findTagByName(name) || createTag(name, color);
  }

  function renameTag(tagId, newName) {
    const tags = Object.assign({}, getAllTags());
    if (!tags[tagId]) return false;
    tags[tagId] = Object.assign({}, tags[tagId], { name: newName.trim() });
    State.set({ tags: tags });
    return true;
  }

  function setTagColor(tagId, color) {
    const tags = Object.assign({}, getAllTags());
    if (!tags[tagId]) return false;
    tags[tagId] = Object.assign({}, tags[tagId], { color: color });
    State.set({ tags: tags });
    return true;
  }

  function deleteTag(tagId) {
    const tags = Object.assign({}, getAllTags());
    if (!tags[tagId]) return false;
    delete tags[tagId];
    State.set({ tags: tags });
    const topics = Object.assign({}, PlannerData.getAllTopics());
    Object.keys(topics).forEach(function (id) {
      const t = topics[id];
      if (t.tags && t.tags.indexOf(tagId) !== -1) {
        topics[id] = Object.assign({}, t, { tags: t.tags.filter(function (id2) { return id2 !== tagId; }) });
      }
    });
    State.set({ topics: topics });
    return true;
  }

  function attachTagToTopic(topicId, tagId) {
    const topics = Object.assign({}, PlannerData.getAllTopics());
    const t = topics[topicId];
    if (!t) return;
    const current = t.tags || [];
    if (current.indexOf(tagId) !== -1) return;
    topics[topicId] = Object.assign({}, t, { tags: current.concat([tagId]) });
    State.set({ topics: topics });
  }

  function detachTagFromTopic(topicId, tagId) {
    const topics = Object.assign({}, PlannerData.getAllTopics());
    const t = topics[topicId];
    if (!t) return;
    const current = t.tags || [];
    topics[topicId] = Object.assign({}, t, { tags: current.filter(function (id) { return id !== tagId; }) });
    State.set({ topics: topics });
  }

  function getTopicsByTag(tagId) {
    const topics = PlannerData.getAllTopics();
    return Object.keys(topics).map(function (id) { return topics[id]; })
      .filter(function (t) { return (t.tags || []).indexOf(tagId) !== -1; });
  }

  // Idempotent: converts legacy topics.tags (raw string arrays) into real Tag records +
  // tagId arrays, exactly once, guarded by State.get().tagsMigrated.
  function migrateLegacyStringTags() {
    if (State.get().tagsMigrated) return;
    const topics = Object.assign({}, PlannerData.getAllTopics());
    let changed = false;
    Object.keys(topics).forEach(function (id) {
      const t = topics[id];
      const raw = t.tags || [];
      const isLegacyStrings = raw.length > 0 && typeof raw[0] === 'string' && raw[0].indexOf('tag_') !== 0;
      if (!isLegacyStrings) return;
      const tagIds = raw.map(function (name) { return getOrCreateTagByName(name).tagId; });
      topics[id] = Object.assign({}, t, { tags: tagIds });
      changed = true;
    });
    if (changed) State.set({ topics: topics });
    State.set({ tagsMigrated: true });
  }

  return {
    getAllTags: getAllTags,
    getAllTagsList: getAllTagsList,
    getTag: getTag,
    findTagByName: findTagByName,
    createTag: createTag,
    getOrCreateTagByName: getOrCreateTagByName,
    renameTag: renameTag,
    setTagColor: setTagColor,
    deleteTag: deleteTag,
    attachTagToTopic: attachTagToTopic,
    detachTagFromTopic: detachTagFromTopic,
    getTopicsByTag: getTopicsByTag,
    migrateLegacyStringTags: migrateLegacyStringTags
  };
})();
