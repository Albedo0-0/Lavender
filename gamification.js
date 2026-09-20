// gamification.js — Gamification UI (§B.8.2 replaced by user's unified bar spec, §8.5 hub).
// Depends on: State, Modal, ProductivityData, GamificationData, TimeEngine.
// The Productivity bar and EXP bar are always-visible, top-level UI (#top-meter-bar in index.html,
// not tab-specific) — same visual tier as the nav bar. Both read live from their own canonical
// source every tick, never from a cached/duplicated value.
//
// Feature 11 (Single Heartbeat): this module no longer runs its own setInterval poll. It rides
// TimeEngine's single 1s heartbeat via TimeEngine.subscribe(fn, id) — a stable id
// ('gamification') means re-calling init() replaces the callback in place instead of stacking a
// second listener that would double-fire settlement/render logic on every tick.
const Gamification = (function () {
  const SUBSCRIBER_ID = 'gamification';

  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  // ---------- Persistent bars (§ unified spec) ----------

  function renderMeter() {
    const result = ProductivityData.getScore(todayStr());
    const score = result.score;
    const prodPct = score === null ? 0 : (score / 10) * 100;
    const prodFill = document.getElementById('productivity-bar-fill');
    const prodLabel = document.getElementById('productivity-bar-label');
    if (prodFill) prodFill.style.width = prodPct + '%';
    if (prodLabel) prodLabel.textContent = 'Productivity \u2014 ' + (score === null ? '\u2013' : score.toFixed(1)) + ' / 10';

    const gam = GamificationData.getGamState();
    const info = GamificationData.getLevelInfo(gam.totalExp);
    const expPct = info.expForNextLevel > 0 ? Math.min(100, (info.expIntoLevel / info.expForNextLevel) * 100) : 100;
    const expFill = document.getElementById('exp-bar-fill');
    const expLabel = document.getElementById('exp-bar-label');
    if (expFill) expFill.style.width = expPct + '%';
    if (expLabel) expLabel.textContent = 'Lv ' + info.level + ' \u00b7 ' + info.expIntoLevel + ' / ' + info.expForNextLevel + ' EXP';
  }

  // ---------- §8.5 Gamification hub modal ----------

  const WORLD_COST = 1000;

  function renderStoreBody() {
    if (typeof MyWorldContent === 'undefined') return '<p class="micro-label">Store unavailable.</p>';
    const worlds = MyWorldContent.list('world');
    if (!worlds.length) return '<p class="micro-label">No worlds registered.</p>';
    return worlds.map(function (w) {
      const owned = w.owned || w.cost === 0;
      return '<div class="gamification-store-row" data-world-id="' + w.id + '">' +
        '<span>' + w.name + '</span>' +
        (owned
          ? '<span class="micro-label">Owned</span>'
          : '<button class="btn-secondary gamification-store-buy" data-world-id="' + w.id + '">Buy \u2014 ' + WORLD_COST + ' EXP</button>') +
        '<span class="micro-label gamification-store-msg" data-world-id="' + w.id + '"></span>' +
        '</div>';
    }).join('');
  }

  function wireStoreBody(container) {
    if (!container) return;
    container.querySelectorAll('.gamification-store-buy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.worldId;
        const gam = GamificationData.getGamState();
        const msg = container.querySelector('.gamification-store-msg[data-world-id="' + id + '"]');
        if (gam.totalExp < WORLD_COST) {
          if (msg) msg.textContent = 'Not enough EXP';
          return;
        }
        GamificationData.spendExp(WORLD_COST, 'World unlocked: ' + id);
        MyWorldContent.grant(id);
        container.innerHTML = renderStoreBody();
        wireStoreBody(container);
        renderMeter();
      });
    });
  }

  function openHub() {
    const gam = GamificationData.getGamState();
    const info = GamificationData.getLevelInfo(gam.totalExp);
    const pct = info.expForNextLevel > 0 ? Math.min(100, (info.expIntoLevel / info.expForNextLevel) * 100) : 100;

    Modal.open(
      '<h3>Gamification Hub</h3>' +
      '<p>Level ' + info.level + ' \u00b7 Total EXP: ' + info.totalExp + '</p>' +
      '<div class="gamification-exp-track"><div class="gamification-exp-fill" style="width:' + pct + '%"></div></div>' +
      '<p>' + info.expIntoLevel + ' / ' + info.expForNextLevel + ' EXP to level ' + (info.level + 1) + '</p>' +
      '<button id="gamification-store-btn">Store</button>' +
      '<div id="gamification-store-body" style="display:none"></div>'
    );
    const storeBtn = document.getElementById('gamification-store-btn');
    const storeBody = document.getElementById('gamification-store-body');
    if (storeBtn) storeBtn.addEventListener('click', function () {
      if (storeBody.style.display === 'block') { storeBody.style.display = 'none'; return; }
      storeBody.innerHTML = renderStoreBody();
      wireStoreBody(storeBody);
      storeBody.style.display = 'block';
    });
  }

  function handleBarClick() { openHub(); }

  function poll() {
    GamificationData.maybeSettle();
    renderMeter();
  }

  function init() {
    const prodWrap = document.getElementById('productivity-bar-wrap');
    const expWrap = document.getElementById('exp-bar-wrap');
    if (prodWrap) prodWrap.addEventListener('click', handleBarClick);
    if (expWrap) expWrap.addEventListener('click', handleBarClick);
    // Single-heartbeat migration (Feature 11): ride TimeEngine's tick instead of our own
    // setInterval. Passing the stable id 'gamification' means calling init() again replaces this
    // callback in TimeEngine's registry rather than accumulating a second one.
    TimeEngine.subscribe(poll, SUBSCRIBER_ID);
    poll();
  }

  return { init: init, openHub: openHub, renderMeter: renderMeter };
})();
