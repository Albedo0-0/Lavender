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

  // ---------- LV Pack Cosmetics: the owned-only counterpart of the Store ----------
  // Same modal, classes, category pills and previews as the Store (previews are painted by the Store's own
  // Assistant.paintStorePreviews()). Ownership and activation use the existing data modules only
  // (MyWorldContent, AssistantLVPackData, and EntityLVPackData through EntityLVPackUI); nothing is stored here.
  let cosFilter = 'worlds';

  function cosEsc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; });
  }

  function cosStates(free, active) {
    return '<span class="tag lvstore-state ' + (free ? 'lvstore-state-owned">Owned' : 'lvstore-state-purchased">Purchased') + '</span>' +
      (active ? '<span class="tag lvstore-state lvstore-state-active">Active</span>' : '');
  }

  function cosAction(active) {
    return active ? '' : '<div class="lvstore-actions"><button type="button" class="btn-secondary lvstore-switch">Activate</button></div>';
  }

  function cosWorldCard(w) {
    return '<div class="assistant-store-item lvstore-card is-owned' + (w.active ? ' is-active' : '') + '" data-cos-kind="world" data-cos-id="' + cosEsc(w.id) + '">' +
      '<div class="lvstore-preview lvstore-preview-world" data-world-preview-id="' + cosEsc(w.id) + '" role="img" aria-label="' + cosEsc(w.name) + ' scene preview"></div>' +
      '<span class="assistant-store-item-name lvstore-name">' + cosEsc(w.name) + '</span>' +
      '<div class="micro-label lvstore-meta">World · v' + cosEsc(w.version) + '</div>' +
      '<div class="lvstore-states">' + cosStates(w.cost === 0, w.active) + '</div>' +
      cosAction(w.active) +
    '</div>';
  }

  function cosPackCard(p) {
    return '<div class="assistant-store-item lvstore-card is-owned' + (p.active ? ' is-active' : '') + '" data-cos-kind="pack" data-cos-id="' + cosEsc(p.id) + '">' +
      '<div class="lvstore-preview lvstore-preview-companion" role="img" aria-label="' + cosEsc(p.name) + ' preview">' +
        '<canvas width="160" height="160" data-pack-preview-id="' + cosEsc(p.id) + '"></canvas></div>' +
      '<span class="assistant-store-item-name lvstore-name">' + cosEsc(p.name) + '</span>' +
      '<div class="micro-label lvstore-meta">Companion</div>' +
      '<div class="lvstore-states">' + cosStates(p.cost === 0, p.active) + '</div>' +
      cosAction(p.active) +
    '</div>';
  }

  // Ownership rules are the Store's own: worlds are owned when `owned` or free; packs when `unlocked`.
  function cosWorldsHtml() {
    if (typeof MyWorldContent === 'undefined') return '<div class="empty-state">Worlds unavailable.</div>';
    const worlds = MyWorldContent.list('world').filter(function (w) { return w.owned || w.cost === 0; });
    if (!worlds.length) return '<div class="empty-state">No worlds owned yet.</div>';
    return '<div class="assistant-store-list">' + worlds.map(cosWorldCard).join('') + '</div>';
  }

  function cosPacksHtml() {
    if (typeof AssistantLVPackData === 'undefined') return '<div class="empty-state">Companion packs unavailable.</div>';
    const packs = AssistantLVPackData.list().filter(function (p) { return p.unlocked; });
    if (!packs.length) return '<div class="empty-state">No companion packs owned yet.</div>';
    return '<div class="assistant-store-list">' + packs.map(cosPackCard).join('') + '</div>';
  }

  // Existing activation mechanisms only. Returns true when something actually changed.
  function cosActivate(kind, id) {
    if (!id) return false;
    if (kind === 'world') {
      if (typeof MyWorldContent === 'undefined') return false;
      if (MyWorldContent.getActive('world').id === id) return false;
      if (!MyWorldContent.setActive('world', id)) return false;
      if (typeof MyWorld !== 'undefined' && MyWorld.setContent) MyWorld.setContent(id);
      return true;
    }
    if (kind === 'pack') {
      if (typeof AssistantLVPackData === 'undefined') return false;
      if (AssistantLVPackData.getActiveId() === id) return false;
      if (!AssistantLVPackData.setActive(id)) return false;
      if (typeof Assistant !== 'undefined' && Assistant.refreshPixelEntitySkin) Assistant.refreshPixelEntitySkin();
      return true;
    }
    return false;
  }

  // Dashboard Entity packs: handled entirely by EntityLVPackUI / EntityLVPackData (activate, use default, remove).
  // Never silently skipped: a load or init failure is shown with its reason.
  function cosMountEntities(host) {
    if (!host) return;
    try {
      const loadProblem = window.LavenderEntityLoad ? window.LavenderEntityLoad.problem() : 'Entity load check is missing from index.html.';
      if (loadProblem) throw new Error(loadProblem);
      EntityLVPackUI.mountCosmeticsSection(host);
    } catch (err) {
      console.error('Dashboard Entity section unavailable:', err);
      host.innerHTML = '<h4 class="section-title">Dashboard Entity</h4><div class="assistant-store-card"><div class="empty-state"></div></div>';
      host.querySelector('.empty-state').textContent = 'Dashboard Entity packs failed to load. ' + String(err && err.message || err);
    }
  }

  function cosApplyFilter(main) {
    main.querySelectorAll('[data-cos-cat]').forEach(function (el) {
      el.hidden = el.getAttribute('data-cos-cat') !== cosFilter;
    });
    document.querySelectorAll('[data-cos-filter]').forEach(function (b) {
      const on = b.getAttribute('data-cos-filter') === cosFilter;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Builds all three categories, paints the Store's previews while every section is still visible
  // (so each preview area has a size, exactly as in the Store), then applies the category filter.
  function cosBuild(main) {
    const shown = main.querySelector('[data-cos-cat]:not([hidden]) .assistant-store-list');
    const keepScroll = shown ? shown.scrollLeft : 0;
    main.innerHTML =
      '<section class="lvstore-section" data-cos-cat="worlds"><h4 class="section-title">Worlds</h4>' +
        '<div class="assistant-store-card">' + cosWorldsHtml() + '</div></section>' +
      '<section class="lvstore-section" data-cos-cat="companions"><h4 class="section-title">Companion Packs</h4>' +
        '<div class="assistant-store-card">' + cosPacksHtml() + '</div></section>' +
      '<div class="lvstore-section" data-cos-cat="entity"></div>';
    if (typeof Assistant !== 'undefined' && Assistant.paintStorePreviews) Assistant.paintStorePreviews();
    cosMountEntities(main.querySelector('[data-cos-cat="entity"]'));
    cosApplyFilter(main);
    const list = main.querySelector('[data-cos-cat]:not([hidden]) .assistant-store-list');
    if (list) list.scrollLeft = keepScroll;
  }

  function openCosmetics() {
    Modal.open(
      '<div class="assistant-page assistant-page-plain lvstore">' +
        '<div class="lvstore-top"><h3 class="section-title lvstore-brand">LV Pack Cosmetics</h3></div>' +
        '<div class="lvstore-layout">' +
          '<nav class="lvstore-rail" aria-label="Cosmetics categories">' +
            '<button type="button" class="lvstore-pill" data-cos-filter="worlds">Worlds</button>' +
            '<button type="button" class="lvstore-pill" data-cos-filter="companions">Companions</button>' +
            '<button type="button" class="lvstore-pill" data-cos-filter="entity">Entities</button>' +
          '</nav>' +
          '<div class="lvstore-main" id="cos-main"></div>' +
        '</div>' +
      '</div>'
    );
    const main = document.getElementById('cos-main');
    if (!main) return;
    cosBuild(main);
    document.querySelectorAll('[data-cos-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        cosFilter = b.getAttribute('data-cos-filter') || 'worlds';
        cosApplyFilter(main);
      });
    });
    // Select any owned world / companion pack from its card (or its Activate button).
    main.addEventListener('click', function (e) {
      const card = e.target && e.target.closest ? e.target.closest('[data-cos-kind]') : null;
      if (!card || card.classList.contains('is-active')) return;
      if (cosActivate(card.getAttribute('data-cos-kind'), card.getAttribute('data-cos-id'))) cosBuild(main);
    });
  }

  function mountPaintbrushButton(button) {
    if (!button || button.__paintbrushWired) return;
    button.__paintbrushWired = true;
    button.addEventListener('click', function () {
      if (typeof Modal !== 'undefined' && Modal.open) openCosmetics();
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
