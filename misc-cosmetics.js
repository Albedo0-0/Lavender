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
 * and gating its render behind isActive() — see wish-butterfly.js for
 * a working example.
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

  return {
    register: register,
    isActive: isActive,
    setUnlocked: setUnlocked,
    setActive: setActive,
    list: list
  };
})();
