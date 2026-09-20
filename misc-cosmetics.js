/*
 * Lavender — Miscellaneous cosmetics registry.
 *
 * FUTURE-STORE PREP ONLY. There is no Store, no currency, no purchases
 * and no badge system yet — this file exists purely so a future Store
 * can decide which cosmetic variant of a Miscellaneous element is
 * active, without every module needing a rewrite.
 *
 * Until a real Store exists, every registered cosmetic defaults to
 * "active" so all Miscellaneous features work exactly as shipped.
 * Any module can adopt this pattern later by calling register() once
* gating its render behind isActive().
 */
const MiscCosmetics = (function () {
  const registry = {}; // id -> { category, label, unlocked, active }

  function register(id, meta) {
    meta = meta || {};
    if (registry[id]) return registry[id];
    registry[id] = {
      id: id,
      category: meta.category || 'misc',
      label: meta.label || id,
      // No Store exists yet, so everything ships unlocked/active by default.
      unlocked: meta.unlocked !== undefined ? meta.unlocked : true,
      active: meta.active !== undefined ? meta.active : true
    };
    return registry[id];
  }

  // A cosmetic with no registration at all is treated as active — this
  // keeps every Miscellaneous element visible/working today, pre-Store.
  function isActive(id) {
    const entry = registry[id];
    if (!entry) return true;
    return entry.unlocked && entry.active;
  }

  // Reserved for the future Store to call once it exists.
  function setUnlocked(id, unlocked) {
    const entry = registry[id];
    if (!entry) return;
    entry.unlocked = !!unlocked;
  }

  function setActive(id, active) {
    const entry = registry[id];
    if (!entry) return;
    entry.active = !!active;
  }

  function list(category) {
    return Object.keys(registry)
      .map(function (id) { return registry[id]; })
      .filter(function (entry) { return !category || entry.category === category; });
  }

  // Placeholder-only collection view: opens a small panel listing whatever has
  // been register()ed so far. No Store, no currency, no purchasing here — see
  // file header. Safe to call once; ignores a second call on the same button.
  function renderWorldsTab() {
    if (typeof MyWorldContent === 'undefined') return '<p class="micro-label">Worlds unavailable.</p>';
    const worlds = MyWorldContent.list('world').filter(function (w) { return w.owned; });
    if (!worlds.length) return '<p class="micro-label">No worlds owned yet.</p>';
    return worlds.map(function (w) {
      return '<div class="misc-cosmetic-row misc-world-row' + (w.active ? ' misc-world-row-active' : '') + '" data-world-id="' + w.id + '">' +
        w.name + (w.active ? ' \u2014 Active' : '') +
        '</div>';
    }).join('');
  }

  function wireWorldsTab(container) {
    if (!container) return;
    container.querySelectorAll('.misc-world-row').forEach(function (row) {
      row.addEventListener('click', function () {
        const id = row.dataset.worldId;
        if (!id || typeof MyWorldContent === 'undefined') return;
        if (MyWorldContent.getActive('world').id === id) return;
        if (!MyWorldContent.setActive('world', id)) return;
        if (typeof MyWorld !== 'undefined' && MyWorld.setContent) MyWorld.setContent(id);
        container.innerHTML = renderWorldsTab();
        wireWorldsTab(container);
      });
    });
  }

  function mountPaintbrushButton(button) {
    if (!button || button.__paintbrushWired) return;
    button.__paintbrushWired = true;
    button.addEventListener('click', function () {
      const items = list();
      const rows = items.length
        ? items.map(function (i) {
            return '<div class="misc-cosmetic-row">' + i.label + (i.unlocked ? '' : ' (locked)') + '</div>';
          }).join('')
        : '<p class="micro-label">Nothing to show yet.</p>';
      if (typeof Modal !== 'undefined' && Modal.open) {
        Modal.open(
          '<div class="modal-header"><h3 class="modal-title">Cosmetics</h3></div>' +
          '<div class="misc-tabs"><button id="misc-tab-cosmetics" class="btn-secondary">Cosmetics</button>' +
          '<button id="misc-tab-worlds" class="btn-secondary">Worlds</button></div>' +
          '<div id="misc-tab-body">' + rows + '</div>'
        );
        const body = document.getElementById('misc-tab-body');
        const cosmeticsTab = document.getElementById('misc-tab-cosmetics');
        const worldsTab = document.getElementById('misc-tab-worlds');
        if (cosmeticsTab) cosmeticsTab.addEventListener('click', function () { body.innerHTML = rows; });
        if (worldsTab) worldsTab.addEventListener('click', function () {
          body.innerHTML = renderWorldsTab();
          wireWorldsTab(body);
        });
      }
    });
  }

  return {
    register: register,
    isActive: isActive,
    setUnlocked: setUnlocked,
    setActive: setActive,
    list: list,
    mountPaintbrushButton: mountPaintbrushButton
  };
})();
