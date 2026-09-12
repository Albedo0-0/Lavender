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
      '<div id="gamification-store-body" style="display:none"><p>Coming soon.</p></div>'
    );
    const storeBtn = document.getElementById('gamification-store-btn');
    if (storeBtn) storeBtn.addEventListener('click', function () {
      document.getElementById('gamification-store-body').style.display = 'block';
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
