// entity-lvpack-ui.js — UI for Dashboard Entity LV Packs: the Settings import button, the Cosmetics
// "Dashboard Entity" section and the Store "Dashboard Entity" section. Pure view over
// EntityLVPackData (the dedicated manager); reuses existing shared classes only (.misc-cosmetic-row,
// .micro-label, .btn-secondary, .section-title) and adds no CSS.
// Depends on: EntityLVPackData (and GamificationData for the EXP balance display).
//
// STORE HOOK: the Store lives in Assistant (assistant.js). Once its container element is known, call
//   EntityLVPackUI.mountStoreSection(containerElement)
// from the Store's render code to show the "Dashboard Entity" section.
const EntityLVPackUI = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; });
  }
  function data() { return typeof EntityLVPackData !== 'undefined' ? EntityLVPackData : null; }

  function reasonList(errors) {
    return '<ul>' + errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
  }

  // ---------- Settings: dedicated import button ----------
  function wireSettingsImport(btn, input, statusEl) {
    const D = data();
    if (!btn || !input || !D) return;
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      input.value = '';
      if (!file) return;
      if (statusEl) statusEl.textContent = 'Checking…';
      D.importFile(file).then(function (r) {
        if (!statusEl) return;
        statusEl.innerHTML = r.ok
          ? 'Imported “' + esc(r.name) + '” v' + esc(r.version) + '. Activate it in Cosmetics › Dashboard Entity.'
          : 'Rejected — nothing was imported.' + reasonList(r.errors);
      }).catch(function () {
        if (statusEl) statusEl.textContent = 'Rejected — nothing was imported (unexpected error).';
      });
    });
  }

  // ---------- shared rendering ----------
  function msgHtml(msg) {
    return msg ? '<p class="micro-label" role="status">' + esc(msg) + '</p>' : '';
  }
  function meta(p) {
    return [p.source === 'official' ? 'Official' : 'Imported', p.version ? 'v' + p.version : '', p.author || ''].filter(Boolean).join(' · ');
  }

  function packRow(p) {
    return '<div class="misc-cosmetic-row misc-entity-pack-row' + (p.active ? ' misc-entity-pack-row-active' : '') + (p.valid ? '' : ' misc-entity-pack-row-locked') + '" data-entity-pack-id="' + esc(p.id) + '">' +
      '<div>' + esc(p.name) + (p.active ? ' — Active' : '') + '</div>' +
      '<div class="micro-label">' + esc(meta(p)) + '</div>' +
      (p.valid ? '' : '<div class="micro-label">Unavailable: ' + esc(p.reason) + '</div>') +
      (p.valid && !p.active ? '<button type="button" class="btn-secondary" data-entity-act="activate" data-id="' + esc(p.id) + '">Activate</button> ' : '') +
      (p.source === 'imported' ? '<button type="button" class="btn-secondary" data-entity-act="remove" data-id="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Remove</button>' : '') +
      '</div>';
  }

  function cosmeticsHtml(msg) {
    const D = data();
    if (!D) return '<p class="micro-label">Dashboard Entity packs unavailable.</p>';
    const packs = D.listAvailable(), act = D.getActive();
    let html = '<h4 class="section-title">Dashboard Entity</h4>' + msgHtml(msg);
    if (act.status === 'missing' || act.status === 'invalid') {
      html += '<p class="micro-label">Your active Dashboard Entity pack is unavailable (' + esc(act.reason) + '). The default is being used.</p>';
    }
    html += packs.length ? packs.map(packRow).join('')
      : '<p class="micro-label">No Dashboard Entity packs yet. Import one in Settings or buy one in the Store.</p>';
    if (act.status !== 'none') html += '<button type="button" class="btn-secondary" data-entity-act="deactivate">Use default</button>';
    return html;
  }

  function storeRow(o) {
    return '<div class="assistant-store-item misc-entity-store-row lvstore-card' + (o.owned ? ' is-owned' : ' is-locked') + '" data-entity-pack-id="' + esc(o.id) + '">' +
      '<div class="lvstore-preview lvstore-preview-entity" data-entity-preview-id="' + esc(o.id) + '">' +
        '<span class="lvstore-preview-note">Preview unavailable: no Dashboard Entity scene renderer is installed in this app.</span></div>' +
      '<span class="assistant-store-item-name lvstore-name">' + esc(o.name) + '</span>' +
      '<div class="micro-label lvstore-meta">' + esc(['v' + o.version, o.author].filter(Boolean).join(' · ')) + '</div>' +
      (o.description ? '<div class="micro-label lvstore-desc">' + esc(o.description) + '</div>' : '') +
      '<div class="lvstore-price">' + (o.price === 0 ? 'Free' : esc(o.price) + ' EXP') + '</div>' +
      '<div class="lvstore-states">' + (o.owned
        ? '<span class="tag lvstore-state lvstore-state-purchased">Purchased</span>'
        : '<span class="tag lvstore-state lvstore-state-locked">Not owned</span>') + '</div>' +
      (o.owned ? '<div class="micro-label lvstore-meta">Activate it in Cosmetics › Dashboard Entity.</div>'
        : '<div class="lvstore-actions"><button type="button" class="btn-secondary lvstore-buy" data-entity-act="buy" data-id="' + esc(o.id) + '">Buy for ' + esc(o.price) + ' EXP</button></div>') +
      '</div>';
  }

  function storeHtml(msg) {
    const D = data();
    if (!D) return '<p class="micro-label">Dashboard Entity packs unavailable.</p>';
    const list = D.listOfficial();
    return '<h4 class="section-title">Dashboard Entity</h4>' +
      '<p class="micro-label">Your EXP: ' + esc(D.getBalance()) + '</p>' + msgHtml(msg) +
      '<div class="assistant-store-card">' +
      (list.length ? '<div class="assistant-store-list">' + list.map(storeRow).join('') + '</div>' : '<div class="empty-state">No official Dashboard Entity packs are available yet.</div>') +
      '</div>';
  }

  function render(container, msg) {
    container.innerHTML = container.__entityMode === 'store' ? storeHtml(msg) : cosmeticsHtml(msg);
  }

  function onClick(e) {
    const container = e.currentTarget;
    const el = e.target && e.target.closest ? e.target.closest('[data-entity-act]') : null;
    if (!el || !container.contains(el)) return;
    const D = data();
    if (!D) return;
    const act = el.getAttribute('data-entity-act'), id = el.getAttribute('data-id');
    let msg = '';
    try {
      let r = null;
      if (act === 'activate') r = D.setActive(id);
      else if (act === 'deactivate') r = D.clearActive();
      else if (act === 'remove') {
        if (!confirm('Remove “' + (el.getAttribute('data-name') || id) + '” from this device?')) return;
        r = D.remove(id);
      } else if (act === 'buy') {
        r = D.purchase(id);
        if (r.ok && typeof Gamification !== 'undefined' && Gamification.renderMeter) Gamification.renderMeter();
        if (r.ok) msg = 'Bought “' + r.name + '”. Activate it in Cosmetics › Dashboard Entity.';
      }
      if (r && !r.ok) msg = r.error;
    } catch (err) {
      msg = 'Something went wrong. Nothing was changed.';
    }
    render(container, msg);
  }

  function mount(container, mode) {
    if (!container) return;
    container.__entityMode = mode;
    if (!container.__entityBound) { container.__entityBound = true; container.addEventListener('click', onClick); }
    render(container, '');
  }

  return {
    wireSettingsImport: wireSettingsImport,
    mountCosmeticsSection: function (container) { mount(container, 'cosmetics'); },
    mountStoreSection: function (container) { mount(container, 'store'); }
  };
})();
