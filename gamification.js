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

    // Presentation layer only: every value shown is read from ProductivityData / GamificationData / PTPE.
  const FILL_MS = 700;
  const STAR_SVG = '<svg viewBox="0 0 7 7" width="10" height="10" shape-rendering="crispEdges" aria-hidden="true"><path fill="#c97b62" d="M3 0h1v2H3zM0 3h2v1H0zM5 3h2v1H5zM3 5h1v2H3zM2 2h3v3H2z"/><path fill="#fff6e0" d="M3 3h1v1H3z"/></svg>';
  const mState = {
    ready: false, bound: false, score: undefined, total: 0, level: 0, expPct: 0,
    timers: [], typeTimer: null, noteTimer: null, hovering: null, seenZero: 0, pbSeen: {}
  };

  function byId(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function later(fn, ms) { const id = window.setTimeout(fn, ms); mState.timers.push(id); return id; }
  function clearSeq() { mState.timers.forEach(function (id) { window.clearTimeout(id); }); mState.timers = []; }
  function signed(v, d) { return (v < 0 ? '\u2212' : '+') + Math.abs(v).toFixed(d); }
  function flash(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    window.setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function setInstant(fill, pct) {
    fill.classList.add('no-anim');
    fill.style.width = pct + '%';
    void fill.offsetWidth;
    fill.classList.remove('no-anim');
  }

  function setProdLabel(score) {
    const l = byId('productivity-bar-label');
    if (l) l.innerHTML = '<span class="meter-k">Productivity</span> <b>' + (score === null ? '\u2013' : score.toFixed(1)) + '</b>';
  }
  function setExpLabel(info, fresh) {
    const l = byId('exp-bar-label');
    if (l) l.innerHTML = 'Lv <b' + (fresh ? ' class="is-new"' : '') + '>' + info.level + '</b>';
    const w = byId('exp-bar-wrap');
    if (w) w.setAttribute('aria-label', 'Level ' + info.level + ', ' + info.expIntoLevel + ' of ' + info.expForNextLevel + ' EXP');
  }

  // Tiny pixel highlight travelling along the newly filled section.
  function spark(wrap, fromPct, toPct) {
    if (reducedMotion() || !wrap || typeof wrap.animate !== 'function' || toPct <= fromPct) return;
    const s = document.createElement('i');
    s.className = 'meter-spark';
    wrap.appendChild(s);
    const a = s.animate(
      [{ left: fromPct + '%', opacity: 1 }, { left: toPct + '%', opacity: 1, offset: 0.85 }, { left: toPct + '%', opacity: 0 }],
      { duration: FILL_MS, easing: 'cubic-bezier(.22,.8,.3,1)' }
    );
    a.onfinish = a.oncancel = function () { if (s.parentNode) s.parentNode.removeChild(s); };
  }
  function burst(wrap) {
    if (!wrap) return;
    const b = document.createElement('i');
    b.className = 'meter-burst';
    wrap.appendChild(b);
    window.setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 460);
  }

  function animateExp(info, expPct, first) {
    const fill = byId('exp-bar-fill'), wrap = byId('exp-bar-wrap');
    const prevPct = mState.expPct, prevLevel = mState.level, gained = info.totalExp > mState.total;
    mState.total = info.totalExp; mState.level = info.level; mState.expPct = expPct;
    clearSeq();
    if (!fill || !wrap) return;
    if (first || reducedMotion()) { setInstant(fill, expPct); setExpLabel(info); return; }
    if (gained && info.level > prevLevel) {
      // 1) run to the end  2) small pixel effect  3) level changes  4) settle at the new position
      fill.style.width = '100%';
      spark(wrap, prevPct, 100);
      later(function () {
        burst(wrap);
        setExpLabel(info, true);
        later(function () { setInstant(fill, 0); fill.style.width = expPct + '%'; }, 360);
      }, FILL_MS);
      return;
    }
    fill.style.width = expPct + '%';
    setExpLabel(info);
    if (gained) spark(wrap, prevPct, expPct);
  }

  // ---------- Personal bests (PTPE decides; shown only as a brief pixel star) ----------
  function hasHistory() {
    const t = todayStr();
    return PTPE.lastN(60).filter(function (d) { return d < t && PTPE.value('studyHours', d) > 0; }).length >= 3;
  }
  function bestsToday() {
    if (typeof PTPE === 'undefined' || typeof PTPE.personalBests !== 'function') return [];
    const t = todayStr(), keys = { bestProductivity: 1, bestStudyDay: 1, bestQuestions: 1, bestExp: 1 };
    try {
      if (!hasHistory()) return [];
      return PTPE.personalBests().filter(function (b) { return keys[b.key] && b.date === t; });
    } catch (err) { return []; }
  }
  function checkPersonalBest(silent) {
    let fresh = false;
    bestsToday().forEach(function (b) {
      const k = b.key + '|' + b.date;
      if (!mState.pbSeen[k]) { mState.pbSeen[k] = true; fresh = true; }
    });
    if (!fresh || silent) return;
    const l = byId('productivity-bar-label');
    if (!l) return;
    const s = document.createElement('i');
    s.className = 'meter-star';
    s.innerHTML = STAR_SVG;
    l.appendChild(s);
    window.setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 2700);
  }

  // ---------- Hover note (calculation log) ----------
  function yesterdayDelta() {
    if (typeof PTPE === 'undefined') return null;
    const t = todayStr();
    const now = ProductivityData.getScore(t).score, prev = ProductivityData.getScore(PTPE.shift(t, -1)).score;
    if (now === null || prev === null) return null;
    return Math.round((now - prev) * 10) / 10;
  }
  function calcLines() {
    const b = ProductivityData.getBreakdown(todayStr());
    if (!b || b.score === null) return [{ text: 'Nothing recorded yet today', cls: 'is-dim' }];
    const rows = [];
    (b.contributions || []).forEach(function (c) { rows.push({ v: c.value, label: c.label }); });
    if (b.capAdjust) rows.push({ v: b.capAdjust.value, label: b.capAdjust.label });
    (b.penalties || []).forEach(function (p) { rows.push({ v: -p.value, label: p.label }); });
    const shown = rows.filter(function (r) { return Math.abs(r.v) >= 0.05; });
    shown.sort(function (a, c) { return ((c.v > 0) - (a.v > 0)) || (Math.abs(c.v) - Math.abs(a.v)); });
    const out = shown.map(function (r) { return { text: signed(r.v, 1) + '  ' + r.label, cls: r.v > 0 ? 'is-up' : 'is-down' }; });
    out.push({ text: '= ' + b.score.toFixed(1) + ' / 10', cls: 'is-total' });
    const d = yesterdayDelta();
    if (d !== null && d !== 0) out.push({ text: signed(d, 1) + ' vs yesterday', cls: 'is-dim' });
    return out;
  }
  function recentLedger(n) {
    return GamificationData.getLedger().slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).slice(0, n);
  }
  function ledgerLines(n) {
    return recentLedger(n).map(function (e) { return { text: signed(e.exp, 0) + '  ' + e.label, cls: e.exp >= 0 ? 'is-up' : 'is-down' }; });
  }
  function expLines() {
    const info = GamificationData.getLevelInfo(GamificationData.getGamState().totalExp);
    return [{ text: info.expIntoLevel + ' / ' + info.expForNextLevel + ' EXP to Lv ' + (info.level + 1) }].concat(ledgerLines(3));
  }

  function stopTyping() { if (mState.typeTimer) { window.clearInterval(mState.typeTimer); mState.typeTimer = null; } }
  function showNote(lines) {
    const n = byId('meter-note');
    if (!n || !lines.length) return;
    stopTyping();
    n.textContent = '';
    const rows = lines.map(function (l) {
      const d = document.createElement('div');
      d.className = 'meter-note-line' + (l.cls ? ' ' + l.cls : '');
      n.appendChild(d);
      return { el: d, text: l.text };
    });
    n.classList.add('is-on');
    if (reducedMotion()) { rows.forEach(function (r) { r.el.textContent = r.text; }); return; }
    let ri = 0, ci = 0;
    mState.typeTimer = window.setInterval(function () {
      const r = rows[ri];
      ci += 3;
      r.el.textContent = r.text.slice(0, ci);
      if (ci >= r.text.length) { ri++; ci = 0; if (ri >= rows.length) stopTyping(); }
    }, 16);
  }
  function hideNote() {
    stopTyping();
    const n = byId('meter-note');
    if (n) n.classList.remove('is-on');
  }
  function bindHover(wrap, getLines) {
    if (!wrap) return;
    wrap.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      mState.hovering = wrap.id;
      window.clearTimeout(mState.noteTimer);
      showNote(getLines());
    });
    wrap.addEventListener('pointerleave', function () {
      if (mState.hovering === wrap.id) { mState.hovering = null; hideNote(); }
    });
  }
  // Zero-EXP transparency: only ever the rule recorded by GamificationData itself.
  function checkZero() {
    if (typeof GamificationData.getLastZeroExp !== 'function') return;
    const z = GamificationData.getLastZeroExp();
    if (!z || z.at <= mState.seenZero) return;
    mState.seenZero = z.at;
    if (mState.hovering) return;
    window.clearTimeout(mState.noteTimer);
    showNote([{ text: z.label + '  +0 EXP' }, { text: z.reason, cls: 'is-dim' }]);
    mState.noteTimer = window.setTimeout(function () { if (!mState.hovering) hideNote(); }, 3800);
  }

  function renderMeter() {
    const score = ProductivityData.getScore(todayStr()).score;
    const prodPct = score === null ? 0 : (score / 10) * 100;
    const info = GamificationData.getLevelInfo(GamificationData.getGamState().totalExp);
    const expPct = info.expForNextLevel > 0 ? Math.min(100, (info.expIntoLevel / info.expForNextLevel) * 100) : 100;
    const first = !mState.ready;
    const scoreChanged = score !== mState.score;
    const expChanged = info.totalExp !== mState.total;

    if (first || scoreChanged) {
      const pf = byId('productivity-bar-fill');
      if (pf) { if (first) setInstant(pf, prodPct); else pf.style.width = prodPct + '%'; }
      setProdLabel(score);
      if (!first) flash(byId('productivity-bar-wrap'), 'is-bump', 480);
    }
    if (first || expChanged) animateExp(info, expPct, first);
    mState.score = score;
    mState.ready = true;
    if (first || scoreChanged || expChanged) checkPersonalBest(first);
  }

  // ---------- §8.5 Gamification hub modal ----------

  // ---------- Expanded Productivity / EXP page ----------

  function openStore() {
    if (typeof Assistant !== 'undefined' && typeof Assistant.openStore === 'function') { Assistant.openStore(); return; }
    Modal.open('<p>Coming soon.</p>');
  }

  function trendWord() {
    if (typeof PTPE === 'undefined') return '';
    const tr = PTPE.trend('productivity');
    return tr ? ({ improving: 'Improving', stable: 'Stable', declining: 'Slipping', recovering: 'Recovering' }[tr.state] || '') : '';
  }
  function rowsHtml(lines) {
    return lines.map(function (l) { return '<div class="meter-row' + (l.cls ? ' ' + l.cls : '') + '">' + esc(l.text) + '</div>'; }).join('');
  }
  function secHtml(title, lines) {
    return '<div class="meter-sec"><div class="meter-sec-h">' + esc(title) + '</div>' + rowsHtml(lines) + '</div>';
  }
  function detailsHtml() {
    const t = todayStr(), parts = [];
    parts.push(secHtml('How today adds up', calcLines()));
    if (typeof PTPE !== 'undefined') {
      const why = ProductivityData.getScore(t).score === null ? [] : PTPE.whyProductivity(t);
      if (why.length) parts.push(secHtml('Since yesterday', why.map(function (w) { return { text: w.label + (w.up ? ' up' : ' down'), cls: w.up ? 'is-up' : 'is-down' }; })));
      const wk = PTPE.whatChanged();
      if (wk.length) parts.push(secHtml('This week vs last', wk.map(function (c) { return { text: c.label + '  ' + signed(c.pct, 0) + '%', cls: c.pct > 0 ? 'is-up' : (c.pct < 0 ? 'is-down' : '') }; })));
      const bests = bestsToday();
      if (bests.length) parts.push(secHtml('Personal best today', bests.map(function (b) { return { text: b.label + ' \u00b7 ' + b.value }; })));
    }
    const led = ledgerLines(5);
    if (led.length) parts.push(secHtml('Recent EXP', led));
    return parts.join('');
  }

  function openHub() {
    hideNote();
    const t = todayStr();
    const info = GamificationData.getLevelInfo(GamificationData.getGamState().totalExp);
    const pct = info.expForNextLevel > 0 ? Math.min(100, (info.expIntoLevel / info.expForNextLevel) * 100) : 100;
    const score = ProductivityData.getScore(t).score;
    const d = yesterdayDelta(), tw = trendWord();
    const sub = [d !== null && d !== 0 ? signed(d, 1) + ' vs yesterday' : '', tw].filter(Boolean).join(' \u00b7 ');
    const cartEl = byId('meter-store-btn');
    const cart = cartEl ? cartEl.innerHTML : '';

    Modal.open(
      '<div class="meter-page"><div class="meter-sheet">' +
        '<div class="meter-head"><span class="meter-lv">Lv ' + info.level + '</span><span class="meter-total">' + info.totalExp + ' EXP</span></div>' +
        '<div class="meter-track"><i style="--w:' + pct + '%"></i></div>' +
        '<div class="meter-foot">' + info.expIntoLevel + ' / ' + info.expForNextLevel + ' to Lv ' + (info.level + 1) + '</div>' +
        '<div class="meter-prod"><span>Productivity today</span><b>' + (score === null ? '\u2013' : score.toFixed(1)) + '</b>' + (score === null ? '' : '<small>/ 10</small>') + '</div>' +
        (sub ? '<div class="meter-sub">' + esc(sub) + '</div>' : '') +
        '<details class="meter-more"><summary>how it adds up</summary>' + detailsHtml() + '</details>' +
        '<div class="meter-actions">' +
          '<button type="button" class="meter-cart" id="meter-modal-store" title="Store" aria-label="Store">' + cart + '</button>' +
          '<button type="button" class="meter-link" id="meter-open-progress">Open Progress \u203a</button>' +
        '</div>' +
      '</div></div>',
      { size: 'md' }
    );
    const store = byId('meter-modal-store');
    if (store) store.addEventListener('click', openStore);
    const prog = byId('meter-open-progress');
    if (prog) prog.addEventListener('click', function () {
      Modal.close();
      const nb = document.querySelector('.nav-btn[data-screen="progress"]');
      if (nb) nb.click();
    });
  }

  function handleBarClick() { openHub(); }

    function poll() {
    GamificationData.maybeSettle();
    renderMeter();
    checkZero();
  }

  function init() {
    const prodWrap = document.getElementById('productivity-bar-wrap');
    const expWrap = document.getElementById('exp-bar-wrap');
        if (!mState.bound) {
      mState.bound = true;
      if (prodWrap) prodWrap.addEventListener('click', handleBarClick);
      if (expWrap) expWrap.addEventListener('click', handleBarClick);
      bindHover(prodWrap, calcLines);
      bindHover(expWrap, expLines);
      const cartBtn = byId('meter-store-btn');
      if (cartBtn) cartBtn.addEventListener('click', function (e) { e.stopPropagation(); openStore(); });
      const z = typeof GamificationData.getLastZeroExp === 'function' ? GamificationData.getLastZeroExp() : null;
      mState.seenZero = z ? z.at : 0;
    }
    // Single-heartbeat migration (Feature 11): ride TimeEngine's tick instead of our own
    // setInterval. Passing the stable id 'gamification' means calling init() again replaces this
    // callback in TimeEngine's registry rather than accumulating a second one.
    TimeEngine.subscribe(poll, SUBSCRIBER_ID);
    poll();
  }

    return { init: init, openHub: openHub, renderMeter: renderMeter, openStore: openStore };
})();
