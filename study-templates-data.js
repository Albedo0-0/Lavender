// study-templates-data.js — Pomodoro/custom study template registry (v1.1). No UI here.
// State shape: State.get().studyTemplates = { templateId: { templateId, name, workMin, breakMin, cycles, isPomodoroDefault } }
// Selecting a template only pre-fills the existing Timer flow in study.js — no separate engine.

const StudyTemplatesData = (function () {
  function generateId() { return 'tpl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function getAll() { return State.get().studyTemplates || {}; }

  function getAllTemplates() {
    const templates = getAll();
    return Object.keys(templates).map(function (id) { return templates[id]; })
      .sort(function (a, b) { return (b.isPomodoroDefault ? 1 : 0) - (a.isPomodoroDefault ? 1 : 0) || a.name.localeCompare(b.name); });
  }

  function getTemplate(templateId) { return getAll()[templateId] || null; }

  function createTemplate(name, workMin, breakMin, cycles) {
    const templates = Object.assign({}, getAll());
    const tpl = {
      templateId: generateId(),
      name: name.trim(),
      workMin: Math.max(1, workMin || 25),
      breakMin: Math.max(0, breakMin || 0),
      cycles: Math.max(1, cycles || 1),
      isPomodoroDefault: false
    };
    templates[tpl.templateId] = tpl;
    State.set({ studyTemplates: templates });
    return tpl;
  }

  function updateTemplate(templateId, patch) {
    const templates = Object.assign({}, getAll());
    const tpl = templates[templateId];
    if (!tpl) return null;
    templates[templateId] = Object.assign({}, tpl, patch);
    State.set({ studyTemplates: templates });
    return templates[templateId];
  }

  function deleteTemplate(templateId) {
    const templates = Object.assign({}, getAll());
    const tpl = templates[templateId];
    if (!tpl || tpl.isPomodoroDefault) return false;
    delete templates[templateId];
    State.set({ studyTemplates: templates });
    return true;
  }

  // Idempotent — checks for an existing isPomodoroDefault record rather than a separate flag.
  function seedDefaultIfMissing() {
    const templates = getAll();
    const hasDefault = Object.keys(templates).some(function (id) { return templates[id].isPomodoroDefault; });
    if (hasDefault) return;
    const updated = Object.assign({}, templates);
    const tpl = { templateId: generateId(), name: 'Pomodoro', workMin: 25, breakMin: 5, cycles: 4, isPomodoroDefault: true };
    updated[tpl.templateId] = tpl;
    State.set({ studyTemplates: updated });
  }

  return {
    getAllTemplates: getAllTemplates,
    getTemplate: getTemplate,
    createTemplate: createTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    seedDefaultIfMissing: seedDefaultIfMissing
  };
})();
