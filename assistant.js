// assistant.js — Assistant UI (§B.7) + Assistant Makeover (Itinerary Phase 10). Depends on:
// State, Modal, Settings, AssistantData, PlannerData, Alarm (folded in here per §6.1 "near
// Notepad"), AssistantLVPackData, MiscCore. History (item 6) renders inline from PlannerData
// directly — no Nav/Planner dependency anymore, so opening Assistant never leaves the Assistant
// modal or switches tabs underneath the user.
// Not an AI chatbot — every screen here is a plain read-only render of existing data.
// Note: Assistant no longer has its own subject/topic browsing UI — Library is the single
// place to browse topics (Feature 10, resolving prior Assistant/Library overlap).
//
// Makeover (Section 9 of the workflow doc): the old static `#assistant-icon` (still present in
// the utility drawer, untouched, still opens the exact same modal) is joined by a persistent,
// draggable, pixel-art companion element mounted directly on <body>, positioned beside the
// music player button in the header by default. Its artwork/idle animation is supplied entirely
// by whichever AssistantLVPackData pack is active — this engine only ever asks that module "what
// does the active pack look like right now", never hardcodes a creature. Position persists via
// Settings (`settings.assistantPosition`); idle animation respects MiscCore.prefersReducedMotion.
// A small drag-distance threshold tells a click apart from a drag, so clicking still opens the
// same main modal as before.
//
// Styling Phase 3: hooked into the shared primitives only (.modal-header/.modal-title,
// .btn-secondary, .list-row/.list-row-title/.list-row-meta, .empty-state, .form-row,
// .divider, .section-title, .micro-label) — no new layout system, no screen-specific
// redesign (that's Phase 13).
const Assistant = (function () {
  function fmtMs(ms) {
    const totalMin = Math.round((ms || 0) / 60000);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h + 'h ' + (m < 10 ? '0' + m : m) + 'm';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }); }

  // ---------- §7.1 Main modal ----------

  function mainHtml() {
    const totals = AssistantData.getTodayTotals();
    // Itinerary Phase 6's "persistent affordance" (Section 13): highlight Today while the
    // morning gate is still awaiting a choice, so it's easy to find without being blocking.
    const todayNeedsChoice = (typeof ItineraryToday !== 'undefined') && ItineraryToday.isAwaitingChoice();

    return (
      '<div class="assistant-notebook" id="assistant-menu">' +
        '<div class="assistant-notebook-cover">' +
          '<h3 class="assistant-notebook-title">' + esc(Settings.assistantLabel()) + '</h3>' +
          '<div class="assistant-notebook-summary">' +
            '<span class="assistant-note-line">Studied today \u00b7 ' + fmtMs(totals.studyMs) + '</span>' +
            '<span class="assistant-note-line">Break \u00b7 ' + fmtMs(totals.breakMs) + ' \u00b7 ' + totals.questionsSolved + ' questions</span>' +
          '</div>' +
        '</div>' +
        '<div class="assistant-tabs-col">' +
          '<button class="assistant-tab assistant-tab-1" data-go="summary">Daily Summary</button>' +
          '<button class="assistant-tab assistant-tab-2" data-go="leftoff">Resume</button>' +
          '<button class="assistant-tab assistant-tab-3" data-go="timeline">History</button>' +
          '<button class="assistant-tab assistant-tab-4" data-go="search">Search</button>' +
        '</div>' +
        '<div class="assistant-ribbons-row">' +
          '<button class="assistant-ribbon assistant-ribbon-plan" data-go="plan">Plan</button>' +
          '<button class="assistant-ribbon assistant-ribbon-today' + (todayNeedsChoice ? ' assistant-ribbon-highlight' : '') + '" data-go="today">Today</button>' +
          '<button class="assistant-ribbon assistant-ribbon-1" data-go="tomorrow">Tomorrow</button>' +
          '<button class="assistant-ribbon assistant-ribbon-2" data-go="store">Store</button>' +
          '<button class="assistant-ribbon assistant-ribbon-3" data-go="alarms">Alarms</button>' +
        '</div>' +
      '</div>'
    );
  }

    // ---------- Quarter-circle fan menu (replaces the old modal-style main menu) ----------
  // Five options sit on a true 90-degree arc around the Assistant. Screen-space angles:
  // 90 = straight down, 180 = straight left (the lower-left quadrant from the header position).
  const FAN_PALETTE = { o: '#3f2f21', k: '#d9c4a3', c: '#fffdf8', g: '#566e3a', r: '#c8776a', y: '#e3c27a' };
  const FAN_OPTIONS = [
    { go: 'plan', label: 'Plan', rows: [
      '....oooo....', '..ooccccoo..', '.occcccccco.', '.ocgyyyycco.',
      '.ocyycyyyco.', '.ocyyyyyyco.', '.occcccccco.', '..ooccccoo..',
      '....oooo....', '....oyyo....', '....oooo....', '............'] },
    { go: 'today', label: 'Today', rows: [
      '............', '..o......o..', '..o......o..', 'oooooooooooo', 'orrrrrrrrrro', 'oooooooooooo',
      'occcccccccco', 'occcccggccco', 'occcccggccco', 'occcccccccco', 'oooooooooooo', '............'] },
    { go: 'tomorrow', label: 'Tomorrow', rows: [
      '............', 'oooooooooooo', 'okkkkkkkkkko', 'ookkkkkkkkoo', 'okokkkkkkoko', 'okkokkkkokko',
      'okkkoooookko', 'okkkkrrkkkko', 'okkkkkkkkkko', 'oooooooooooo', '............', '............'] },
    { go: 'alarms', label: 'Alarms', rows: [
      '....oooo....', '...oyyyyo...', '..oycyyyyo..', '..oycyyyyo..', '..oyyyyyyo..', '.oyyyyyyyyo.',
      '.oyyyyyyyyo.', 'oooooooooooo', '............', '....oyyo....', '....oooo....', '............'] },
    { go: 'history', label: 'History / Daily Summary', rows: [
      '............', '..oooooooo..', '..occcccco..', '..ocggggco..', '..occcccco..', '..ocgggcco..',
      '..occcccco..', '..ocggggco..', '..occcccco..', '..occcrrco..', '..oooooooo..', '............'] }
  ];
    const FAN_ARC_START_DEG = 60;
  const FAN_ARC_SPAN_DEG = 120;
  const FAN_RADIUS_MAX = 210;
  const FAN_RADIUS_MIN = 96;
  const FAN_EDGE_PAD = 8;
  const FAN_OPT_W = 80;
  const FAN_ICON = 48;
  const FAN_OPT_BELOW = 60;
  const FAN_LINE_GAP_ORIGIN = 26;
  const FAN_LINE_GAP_ICON = FAN_ICON / 2 + 6;
  const FAN_DUR_MS = 250;
  const FAN_STAGGER_MS = 30;
  const FAN_CLOSE_SPEED = 1.3;

  let fanEl = null;
  let fanItems = [];
  let fanGeo = null;
  let fanOpen = false;
  let fanT = 0;
  let fanLast = 0;
  let fanRaf = 0;
    let fanPollHandle = null;
  let fanLines = [];
  let fanOriginEl = null;

  function fanTotalMs() { return FAN_DUR_MS + FAN_STAGGER_MS * (FAN_OPTIONS.length - 1); }
  function fanReducedMotion() { return (typeof MiscCore !== 'undefined') && MiscCore.prefersReducedMotion(); }

    function fanIconSvg(rows, size) {
    var rects = '';
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < row.length) {
        var ch = row.charAt(x);
        if (ch === '.' || !FAN_PALETTE[ch]) { x++; continue; }
        var x2 = x;
        while (x2 < row.length && row.charAt(x2) === ch) x2++;
        rects += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x) + '" height="1" fill="' + FAN_PALETTE[ch] + '"/>';
        x = x2;
      }
    });
        return '<svg viewBox="0 0 12 12" width="' + (size || FAN_ICON) + '" height="' + (size || FAN_ICON) + '" shape-rendering="crispEdges" aria-hidden="true">' + rects + '</svg>';
  }

  // Origin = centre of the Assistant. All four options share one radius; angles are evenly spaced
  // along the 90-degree arc. The radius shrinks (never the geometry) when the viewport is tight.
  function fanGeometry() {
    var anchor = document.getElementById('assistant-pixel-entity') || document.getElementById('header-assistant-slot');
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var rect = anchor ? anchor.getBoundingClientRect() : null;
    var cx = rect ? rect.left + rect.width / 2 : vw - 40;
    var cy = rect ? rect.top + rect.height / 2 : 30;
    var step = FAN_ARC_SPAN_DEG / FAN_OPTIONS.length;
    var angles = FAN_OPTIONS.map(function (o, i) { return (FAN_ARC_START_DEG + step * (i + 0.5)) * Math.PI / 180; });
    var r = FAN_RADIUS_MAX;
    angles.forEach(function (a) {
      var c = Math.cos(a), s = Math.sin(a);
      if (c < -1e-6) r = Math.min(r, (cx - FAN_OPT_W / 2 - FAN_EDGE_PAD) / -c);
      if (c > 1e-6) r = Math.min(r, (vw - cx - FAN_OPT_W / 2 - FAN_EDGE_PAD) / c);
      if (s > 1e-6) r = Math.min(r, (vh - cy - FAN_OPT_BELOW - FAN_EDGE_PAD) / s);
    });
    return { cx: cx, cy: cy, r: Math.max(FAN_RADIUS_MIN, r), angles: angles };
  }

    function fanPlace() {
    if (!fanGeo) return;
    fanItems.forEach(function (el) {
      el.style.left = (fanGeo.cx - FAN_OPT_W / 2) + 'px';
      el.style.top = (fanGeo.cy - FAN_ICON / 2) + 'px';
    });
    if (fanOriginEl) {
      fanOriginEl.style.left = (fanGeo.cx - PIXEL_CANVAS_SIZE / 2) + 'px';
      fanOriginEl.style.top = (fanGeo.cy - PIXEL_CANVAS_SIZE / 2) + 'px';
    }
  }

  // Polar motion: radius eases out fast while the angle sweeps from the arc start to the option's
  // own angle, so each option visibly rides the circle's circumference. Running the same clock
  // backwards gives the exact reverse path on close.
    function fanRender() {
    if (!fanEl || !fanGeo) return;
    var startRad = FAN_ARC_START_DEG * Math.PI / 180;
        var bgP = Math.max(0, Math.min(1, fanT / fanTotalMs()));
    fanEl.style.background = 'rgba(32, 24, 17, ' + (bgP * 0.55).toFixed(3) + ')';
    fanEl.style.backdropFilter = 'blur(' + (bgP * 8).toFixed(2) + 'px)';
    fanEl.style.webkitBackdropFilter = 'blur(' + (bgP * 8).toFixed(2) + 'px)';
    fanItems.forEach(function (el, i) {
      var p = Math.max(0, Math.min(1, (fanT - i * FAN_STAGGER_MS) / FAN_DUR_MS));
      var rad = fanGeo.r * (1 - Math.pow(1 - p, 4));
      var ang = startRad + (fanGeo.angles[i] - startRad) * (1 - Math.pow(1 - p, 3));
      var cos = Math.cos(ang), sin = Math.sin(ang);
      var fade = Math.min(1, p * 2.5);
      el.style.transform = 'translate(' + (rad * cos).toFixed(2) + 'px,' + (rad * sin).toFixed(2) + 'px)';
      el.style.opacity = String(fade);
            el.style.setProperty('--fan-p', p.toFixed(3));
      var lab = el.lastChild;
      if (lab) lab.style.opacity = (p * 0.85).toFixed(3);
      el.style.pointerEvents = (fanOpen && p > 0.6) ? 'auto' : 'none';
      var ln = fanLines[i];
      if (ln) {
        var from = FAN_LINE_GAP_ORIGIN;
        var to = rad - FAN_LINE_GAP_ICON;
        if (to > from) {
          ln.setAttribute('x1', (fanGeo.cx + from * cos).toFixed(2));
          ln.setAttribute('y1', (fanGeo.cy + from * sin).toFixed(2));
          ln.setAttribute('x2', (fanGeo.cx + to * cos).toFixed(2));
          ln.setAttribute('y2', (fanGeo.cy + to * sin).toFixed(2));
          ln.style.opacity = String((0.7 * fade).toFixed(3));
        } else {
          ln.style.opacity = '0';
        }
      }
    });
  }

  function fanTick(now) {
    fanRaf = 0;
    var dt = Math.max(0, now - fanLast);
    fanLast = now;
    var total = fanTotalMs();
    fanT = Math.max(0, Math.min(total, fanT + (fanOpen ? dt : -dt * FAN_CLOSE_SPEED)));
    fanRender();
    if (fanOpen ? fanT < total : fanT > 0) fanRaf = window.requestAnimationFrame(fanTick);
    else if (!fanOpen) destroyFan();
  }

  function fanKick() {
    if (fanRaf) return;
    fanLast = performance.now();
    fanRaf = window.requestAnimationFrame(fanTick);
  }

    function fanSyncHighlight() {
    if (fanOriginEl && pixelCanvasEl) {
      var octx = fanOriginEl.getContext('2d');
      if (octx) {
        octx.imageSmoothingEnabled = false;
        octx.clearRect(0, 0, PIXEL_CANVAS_SIZE, PIXEL_CANVAS_SIZE);
        octx.drawImage(pixelCanvasEl, 0, 0);
      }
    }
    var el = fanEl && fanEl.querySelector('[data-go="today"]');
    if (!el) return;
    el.classList.toggle('assistant-fan-opt-highlight', (typeof ItineraryToday !== 'undefined') && !!ItineraryToday.isAwaitingChoice());
  }

  function fanOnKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeFan(); } }
  function fanOnResize() { if (!fanEl) return; fanGeo = fanGeometry(); fanPlace(); fanRender(); }

  function destroyFan() {
    if (fanRaf) { window.cancelAnimationFrame(fanRaf); fanRaf = 0; }
    if (fanPollHandle) { window.clearInterval(fanPollHandle); fanPollHandle = null; }
    document.removeEventListener('keydown', fanOnKey);
    window.removeEventListener('resize', fanOnResize);
    if (fanEl && fanEl.parentNode) fanEl.parentNode.removeChild(fanEl);
        fanEl = null; fanItems = []; fanGeo = null; fanOpen = false; fanT = 0;
    fanLines = []; fanOriginEl = null;
    if (pixelEntityEl) pixelEntityEl.style.visibility = '';
  }

  function closeFan() {
    if (!fanEl || !fanOpen) return;
    fanOpen = false;
        if (pixelEntityEl) {
      pixelEntityEl.style.visibility = '';
      pixelEntityEl.focus({ preventScroll: true });
    }
    if (fanReducedMotion()) { destroyFan(); return; }
    fanKick();
  }

  function openFan() {
    if (fanEl) { fanOpen = true; fanKick(); return; }
    fanGeo = fanGeometry();
    fanEl = document.createElement('div');
    fanEl.id = 'assistant-fan';
    fanEl.setAttribute('role', 'menu');
    fanEl.setAttribute('aria-label', Settings.assistantLabel() || 'Assistant');
    fanEl.addEventListener('click', function (e) { if (e.target === fanEl) closeFan(); });
    fanItems = FAN_OPTIONS.map(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'assistant-fan-opt';
      b.dataset.go = o.go;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-label', o.label);
      b.innerHTML = '<span class="assistant-fan-icon">' + fanIconSvg(o.rows) + '</span>' +
                '<span class="assistant-fan-label">' + esc(o.label).replace(' / ', ' /<br>') + '</span>';
      b.addEventListener('click', function () { closeFan(); routeTo(o.go); });
      fanEl.appendChild(b);
      return b;
    });
        var svgNS = 'http://www.w3.org/2000/svg';
    var linesSvg = document.createElementNS(svgNS, 'svg');
    linesSvg.setAttribute('class', 'assistant-fan-lines');
    linesSvg.setAttribute('aria-hidden', 'true');
    fanLines = fanItems.map(function () {
      var ln = document.createElementNS(svgNS, 'line');
      linesSvg.appendChild(ln);
      return ln;
    });
    fanEl.insertBefore(linesSvg, fanEl.firstChild);
    fanOriginEl = document.createElement('canvas');
    fanOriginEl.width = PIXEL_CANVAS_SIZE;
    fanOriginEl.height = PIXEL_CANVAS_SIZE;
    fanOriginEl.className = 'assistant-fan-origin';
    fanEl.appendChild(fanOriginEl);
    if (pixelEntityEl) pixelEntityEl.style.visibility = 'hidden';
    fanPlace();
    document.body.appendChild(fanEl);
    fanOpen = true;
    fanT = fanReducedMotion() ? fanTotalMs() : 0;
    fanRender();
    document.addEventListener('keydown', fanOnKey);
    window.addEventListener('resize', fanOnResize);
    fanSyncHighlight();
    fanPollHandle = window.setInterval(fanSyncHighlight, 1000);
    if (!fanReducedMotion()) fanKick();
    fanItems[0].focus({ preventScroll: true });
  }

  function openMain() {
    if (fanEl && fanOpen) closeFan();
    else openFan();
  }

  function routeTo(key) {
    try {
      if (key === 'plan') {
        if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open({ from: 'assistant' });
        return;
      }
      if (key === 'store') return openStore();
      if (key === 'timeline') return openTimeline();
      if (key === 'tomorrow') return openTomorrow();
      if (key === 'leftoff') return openWhereLeftOff();
      if (key === 'search') return openSearch();
            if (key === 'summary') return openSummary(AssistantData.todayStr());
      if (key === 'history') return openSummary(AssistantData.todayStr());
      if (key === 'alarms') return openAlarms();
      if (key === 'today') { if (typeof ItineraryToday !== 'undefined') ItineraryToday.open(); return; }
    } catch (err) {
      console.error('Assistant.routeTo failed for', key, err);
      Modal.open(backBtnHtml() + '<div class="assistant-page assistant-page-plain"><h3 class="section-title">' + key + '</h3><div class="empty-state">Couldn\'t load this right now.</div></div>');
      wireBack();
    }
  }

  function backBtnHtml() { return '<div class="modal-header"><button id="assistant-back-btn" class="btn-secondary">\u2190 Back</button></div>'; }
      function wireBack(fn) {
    document.getElementById('assistant-back-btn').addEventListener('click', fn || function () { Modal.close(); openMain(); });
  }

  function pageTitleHtml(go, text) {
    var opt = FAN_OPTIONS.filter(function (o) { return o.go === go; })[0];
    return '<h3 class="section-title assistant-page-title">' +
      (opt ? '<span class="assistant-page-pixel">' + fanIconSvg(opt.rows, 24) + '</span>' : '') + esc(text) + '</h3>';
  }

  function segHtml(active) {
    return '<div class="assistant-seg" role="tablist">' +
      '<button type="button" id="assistant-summary-link" class="assistant-seg-btn' + (active === 'summary' ? ' is-active' : '') + '">Summary</button>' +
      '<button type="button" id="assistant-history-link" class="assistant-seg-btn' + (active === 'history' ? ' is-active' : '') + '">History</button>' +
    '</div>';
  }

  // ---------- Store (§7.3) ----------

  const WORLD_COST = 1000;

  function storeRowHtml(w) {
    const owned = w.owned || w.cost === 0;
    return '<div class="assistant-store-item" data-world-id="' + esc(w.id) + '">' +
      '<span class="assistant-store-item-name">' + esc(w.name) + '</span>' +
      (owned
        ? '<span class="tag tag-neutral">Owned</span>'
        : '<button class="btn-secondary assistant-store-buy" data-world-id="' + esc(w.id) + '">Buy \u2014 ' + WORLD_COST + ' EXP</button>') +
      '<span class="assistant-store-msg" data-world-id="' + esc(w.id) + '"></span>' +
    '</div>';
  }

  function storeBodyHtml() {
    if (typeof MyWorldContent === 'undefined') return '<div class="empty-state">Store unavailable.</div>';
    const worlds = MyWorldContent.list('world');
    if (!worlds.length) return '<div class="empty-state">No worlds registered yet.</div>';
    return '<div class="assistant-store-list">' + worlds.map(storeRowHtml).join('') + '</div>';
  }

  // ---------- Assistant LV Packs, inside the same Store (Section 9/10 — "purchasable through
  // the existing Store", using the existing Cosmetics/ownership system for unlocked/active) ----------

  function packRowHtml(p) {
    return '<div class="assistant-store-item" data-pack-id="' + esc(p.id) + '">' +
      '<span class="assistant-store-item-name">' + esc(p.name) + '</span>' +
      (p.unlocked
        ? (p.active
            ? '<span class="tag tag-neutral">Active</span>'
            : '<button class="btn-secondary assistant-pack-switch" data-pack-id="' + esc(p.id) + '">Switch to this</button>')
        : '<button class="btn-secondary assistant-pack-buy" data-pack-id="' + esc(p.id) + '">Buy \u2014 ' + p.cost + ' EXP</button>') +
      '<span class="assistant-store-msg" data-pack-id="' + esc(p.id) + '"></span>' +
    '</div>';
  }

  function assistantPacksBodyHtml() {
    if (typeof AssistantLVPackData === 'undefined') return '<div class="empty-state">Packs unavailable.</div>';
    const packs = AssistantLVPackData.list();
    if (!packs.length) return '<div class="empty-state">No companion packs registered yet.</div>';
    return '<div class="assistant-store-list">' + packs.map(packRowHtml).join('') + '</div>';
  }

  function wireStore() {
    document.querySelectorAll('.assistant-store-buy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.worldId;
        const msg = document.querySelector('.assistant-store-msg[data-world-id="' + id + '"]');
        const gam = GamificationData.getGamState();
        if (gam.totalExp < WORLD_COST) {
          if (msg) msg.textContent = 'Not enough EXP';
          return;
        }
        GamificationData.spendExp(WORLD_COST, 'World unlocked: ' + id);
        MyWorldContent.grant(id);
        if (typeof Gamification !== 'undefined' && Gamification.renderMeter) Gamification.renderMeter();
        openStore();
      });
    });
    document.querySelectorAll('.assistant-pack-buy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.packId;
        const msg = document.querySelector('.assistant-store-msg[data-pack-id="' + id + '"]');
        const result = AssistantLVPackData.purchase(id);
        if (!result.ok) { if (msg) msg.textContent = result.error || 'Could not buy this.'; return; }
        AssistantLVPackData.setActive(id);
        if (typeof Gamification !== 'undefined' && Gamification.renderMeter) Gamification.renderMeter();
        refreshPixelEntitySkin();
        openStore();
      });
    });
    document.querySelectorAll('.assistant-pack-switch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        AssistantLVPackData.setActive(btn.dataset.packId);
        refreshPixelEntitySkin();
        openStore();
      });
    });
  }

    // Where Back returns to. Set only by an external opener (e.g. the Productivity/EXP page); the
  // Store's own refreshes after a purchase call openStore() directly and keep it.
  let storeBack = null;
  function openStoreFrom(fn) {
    storeBack = typeof fn === 'function' ? fn : null;
    openStore();
  }

  function openStore() {
    Modal.open(backBtnHtml() +
      '<div class="assistant-page assistant-page-plain">' +
        '<h3 class="section-title">Store</h3>' +
        '<h4 class="section-title">Worlds</h4>' +
        '<div class="assistant-store-card">' + storeBodyHtml() + '</div>' +
        '<h4 class="section-title">Companion Packs</h4>' +
        '<div class="assistant-store-card">' + assistantPacksBodyHtml() + '</div>' +
      '</div>');
    wireBack(storeBack ? function () { Modal.close(); storeBack(); } : undefined);
    wireStore();
  }


  // ---------- Timeline (§7.3) ----------

  function openTimeline() {
    const items = AssistantData.getTodayTimeline();
    const rows = items.length ? items.map(function (it, idx) {
      const offsetClass = idx % 2 === 0 ? 'assistant-timeline-marker-up' : 'assistant-timeline-marker-down';
      return '<div class="assistant-timeline-marker ' + offsetClass + '">' +
        '<span class="assistant-timeline-dot" aria-hidden="true"></span>' +
        '<span class="assistant-timeline-time">' + it.at + '</span>' +
        '<span class="assistant-timeline-label">' + esc(it.label) + (it.type === 'break' ? ' <span class="tag tag-neutral">break</span>' : '') + '</span>' +
        '<span class="assistant-timeline-dur">' + fmtMs(it.durationMs) + '</span>' +
      '</div>';
    }).join('') : '<div class="empty-state">Nothing recorded yet today.</div>';
    const body = items.length ? '<div class="assistant-timeline-wrap"><div class="assistant-timeline-track">' + rows + '</div></div>' : rows;
            Modal.open(backBtnHtml() + '<div class="assistant-page assistant-page-timeline">' + pageTitleHtml('history', 'History') + segHtml('history') + body + '</div>');
    wireBack();
    document.getElementById('assistant-summary-link').addEventListener('click', function () { openSummary(AssistantData.todayStr()); });
  }

  // ---------- Tomorrow (§7.3) ----------

  function taskRowHtml(t) {
    return '<div class="assistant-envelope-item">' +
      '<span class="assistant-envelope-item-title">' + esc(t.topicName || t.title || PlannerData.taskLabel(t)) + '</span>' +
      '<span class="assistant-envelope-item-date">' + esc(t.date) + '</span>' +
    '</div>';
  }

  function openTomorrow() {
    const list = AssistantData.getTomorrow();
    const tomStr = AssistantData.tomorrowStr();
    const proposals = (typeof PlanningAgentData !== 'undefined')
      ? PlanningAgentData.proposeScheduleForDate(tomStr)
      : [];

    let planActionHtml = '';
    if (proposals.length > 0) {
      planActionHtml = '<div style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.04);border-radius:8px;">' +
        '<div style="font-size:0.85rem;font-weight:600;margin-bottom:6px;">Planning Agent Suggestions (' + proposals.length + ')</div>' +
        proposals.map(function (p) {
          return '<div style="font-size:0.8rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span>' + esc(p.title) + ' <span class="chip">' + p.proposedStart + '\u2013' + p.proposedEnd + '</span></span>' +
            '<button type="button" class="btn btn-secondary assistant-apply-prop-btn" data-task-id="' + p.taskId + '" data-start="' + p.proposedStart + '" data-stop="' + p.proposedEnd + '" style="padding:2px 8px;font-size:0.75rem;">Plan</button>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    const rows = list.length ? list.map(taskRowHtml).join('') : '<div class="empty-state">Nothing scheduled for tomorrow yet.</div>';
    Modal.open(backBtnHtml() +
      '<div class="assistant-page assistant-page-envelope">' +
        pageTitleHtml('tomorrow', 'Tomorrow') +
        '<div class="assistant-envelope">' +
          '<div class="assistant-envelope-flap" aria-hidden="true"></div>' +
          '<div class="assistant-envelope-contents">' + rows + planActionHtml + '</div>' +
        '</div>' +
      '</div>');
    wireBack();

    document.querySelectorAll('.assistant-apply-prop-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof PlanningAgentUI !== 'undefined') {
          PlanningAgentUI.open({ date: tomStr, intent: 'day', from: 'assistant' });
        }
      });
    });
  }

  // ---------- Resume / Where I Left Off (§7.3) ----------

  function openWhereLeftOff() {
    const w = AssistantData.getWhereLeftOff();
    const body = w ?
      '<p><strong>' + esc(w.topicName) + '</strong>' + (w.subject ? ' (' + esc(w.subject) + ')' : '') + '</p>' +
      '<p>' + (w.taskLabel ? esc(w.taskLabel) + ' \u2014 ' : '') + esc(w.state) + ' \u00b7 ' + fmtMs(w.studyMs) + (w.isToday ? '' : ' \u00b7 ' + esc(w.date)) + '</p>' +
      (w.note ? '<p>' + esc(w.note) + '</p>' : '')
      : '<div class="empty-state">No study sessions found yet.</div>';
    Modal.open(backBtnHtml() + '<div class="assistant-page assistant-page-note"><h3 class="section-title">Resume</h3><div class="assistant-note-slip">' + body + '</div></div>');
    wireBack();
  }

  // ---------- Global Search (§7.3) ----------

  function resultRowHtml(r) {
    const ref = r.ref || {};
    return '<div class="assistant-search-row assistant-search-result assistant-index-row list-row list-row-compact" data-kind="' + esc(ref.kind || '') + '" data-task-id="' + esc(ref.taskId || '') + '" data-subject="' + esc(ref.subject || '') + '" data-topic-id="' + esc(ref.topicId || '') + '" data-tag-id="' + esc(ref.tagId || '') + '" data-habit-id="' + esc(ref.habitId || '') + '" data-date="' + esc(ref.date || r.date || '') + '">' +
      '<span class="list-row-title"><strong>' + esc(r.type) + '</strong> \u2014 ' + esc(r.text) + '</span>' +
      '<span class="list-row-meta">' + esc(r.date) + '</span>' +
    '</div>';
  }

  function navigateToResult(ds) {
    if (ds.kind === 'task') {
      const task = PlannerData.getAllTasks()[ds.taskId];
      if (!task) return;
      Modal.close();
      if (task.completed && Planner.openHistory) Planner.openHistory(task.subject, task.topicId);
      else if (Planner.openDate) Planner.openDate(task.date);
      Nav.switchTo('library');
    } else if (ds.kind === 'topic') {
      Modal.close();
      if (typeof Library !== 'undefined' && Library.openTopic) Library.openTopic(ds.subject, ds.topicId);
      Nav.switchTo('library');
        } else if (ds.kind === 'tag') {
      Modal.close();
      if (typeof PTPEView !== 'undefined') PTPEView.openExplorer({ dim: 'tag', id: ds.tagId, metric: 'studyHours' });
      Nav.switchTo('progress');
    } else if (ds.kind === 'habit') {
      Modal.close();
      if (typeof Habits !== 'undefined' && Habits.open) Habits.open();
    } else if (ds.kind === 'journal') {
      Modal.close();
      if (typeof Journal !== 'undefined' && Journal.openDate) Journal.openDate(ds.date);
      Nav.switchTo('journal');
    }
  }

  function openSearch() {
    Modal.open(backBtnHtml() + '<div class="assistant-page assistant-page-search"><h3 class="section-title">Global Search</h3>' +
      '<div class="assistant-search-index">' +
        '<span class="assistant-search-glass" aria-hidden="true"></span>' +
        '<div class="form-row"><input type="text" id="assistant-search-input" placeholder="Search everything..."></div>' +
      '</div>' +
      '<button id="assistant-search-btn" class="btn-secondary">Search</button>' +
      '<div id="assistant-search-results" style="margin-top: var(--space-3);"></div></div>');
    wireBack();
    function runSearch() {
      const results = AssistantData.search(document.getElementById('assistant-search-input').value);
      document.getElementById('assistant-search-results').innerHTML = results.length ? results.map(resultRowHtml).join('') : '<div class="empty-state">No matches.</div>';
      document.querySelectorAll('.assistant-search-result').forEach(function (el) {
        el.addEventListener('click', function () { navigateToResult(el.dataset); });
      });
    }
    document.getElementById('assistant-search-btn').addEventListener('click', runSearch);
    document.getElementById('assistant-search-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
  }

  // ---------- Daily Summary (§7.4/§7.5) ----------

  function itinerarySummaryLine(it) {
    if (!it) return '';
    let text;
    if (it.diyChosen) text = 'Itinerary: did it myself today';
    else if (it.status === 'abandoned') text = 'Itinerary: no itinerary followed today';
    else if (it.counts) text = 'Itinerary: ' + it.counts.completed + ' / ' + it.counts.total + ' items completed';
    else return '';
    return '<p>' + text + '</p>';
  }

  function summaryHtml(dateStr) {
    const s = AssistantData.getDailySummary(dateStr);
        return backBtnHtml() + '<div class="assistant-page assistant-page-receipt">' + pageTitleHtml('history', 'Daily Summary') + segHtml('summary') +
      '<div class="assistant-receipt">' +
        '<span class="assistant-receipt-stamp" aria-hidden="true">' + dateStr + '</span>' +
        '<div class="form-row"><input type="date" id="assistant-summary-date" value="' + dateStr + '"></div>' +
        '<p>Study: ' + fmtMs(s.studyMs) + ' \u00b7 Break: ' + fmtMs(s.breakMs) + ' \u00b7 Questions: ' + s.questionsSolved + '</p>' +
        '<p>Hydration: ' + (s.hydrationScore === null ? '\u2013' : s.hydrationScore + '/10') + ' \u00b7 Sleep: ' + (s.sleepHours === null ? '\u2013' : s.sleepHours + 'h') + '</p>' +
        '<p>Tasks: ' + s.tasksCompleted + ' / ' + s.tasksTotal + ' completed</p>' +
                itinerarySummaryLine(s.itinerary) +
            '</div>' +
    '</div>';
  }

  function openSummary(dateStr) {
    Modal.open(summaryHtml(dateStr));
    wireBack();
        document.getElementById('assistant-summary-date').addEventListener('change', function (e) { openSummary(e.target.value); });
    document.getElementById('assistant-history-link').addEventListener('click', function () { openTimeline(); });
  }

  // ---------- Alarms (§6.1 — General Alarm lives here, near Notepad, now that Assistant exists) ----------

  function openAlarms() {
    Alarm.openList();
  }

  

  // ---------- Pixel companion entity (Section 9/10 — "Assistant Makeover") ----------
  // A persistent, localized, draggable DOM element separate from the existing static
  // #assistant-icon (left completely alone, still works). Not tab-specific. Position stored in
  // settings.assistantPosition ({x,y}, top-left in px) via Settings/State.patch('settings', ...).
  // Idle animation is a small local state machine (breathe/blink), CSS/JS driven, never wandering
  // (Ladybug.mount's roaming pattern is explicitly NOT reused — Firefly's "restrained, fixed,
  // ambient" philosophy is the model instead), and respects MiscCore.prefersReducedMotion().
  // Cosmetic-swappable: the character shown is whatever AssistantLVPackData.getActive() returns
  // right now — this engine owns drag/position/interaction/state/navigation only, never the art.

  const PIXEL_GRID = 8;       // sprite is an 8x8 logical grid
  const PIXEL_SCALE = 5;      // each logical pixel is rendered PIXEL_SCALE screen px on a side
  const PIXEL_CANVAS_SIZE = PIXEL_GRID * PIXEL_SCALE;
  const DRAG_THRESHOLD_PX = 6; // movement beyond this during a pointer-down/up counts as a drag, not a click

  let pixelEntityEl = null;
  let pixelCanvasEl = null;
  let idleTimerHandle = null;
  let idleFrameIndex = 0;
  let idleIsBlinking = false;

  function drawPixelFrame(rows, palette) {
    if (!pixelCanvasEl) return;
    const ctx = pixelCanvasEl.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, PIXEL_CANVAS_SIZE, PIXEL_CANVAS_SIZE);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || !palette[ch]) continue;
        ctx.fillStyle = palette[ch];
        ctx.fillRect(c * PIXEL_SCALE, r * PIXEL_SCALE, PIXEL_SCALE, PIXEL_SCALE);
      }
    }
  }

  function renderActivePackFrame() {
    if (typeof AssistantLVPackData === 'undefined') return;
    const pack = AssistantLVPackData.getActive();
    if (!pack || !pack.pixel) return;
    const reduced = (typeof MiscCore !== 'undefined') && MiscCore.prefersReducedMotion();
    const frames = idleIsBlinking && pack.pixel.blink ? [pack.pixel.blink] : pack.pixel.idle;
    const frame = reduced ? frames[0] : frames[idleFrameIndex % frames.length];
    drawPixelFrame(frame, pack.pixel.palette);
  }

  // Called by anything that changes the active pack (Store buy/switch, future Cosmetics switch)
  // so the on-screen creature updates immediately, without a page reload.
  function refreshPixelEntitySkin() {
    idleFrameIndex = 0;
    idleIsBlinking = false;
    renderActivePackFrame();
  }

  // Small local idle loop: alternates breathing frames, with an occasional blink — no wandering,
  // no position change, purely a skin-level animation. Stopped/never started under reduced motion.
  function startIdleLoop() {
    if (idleTimerHandle) return;
    if (typeof MiscCore !== 'undefined' && MiscCore.prefersReducedMotion()) { renderActivePackFrame(); return; }
    let tick = 0;
    idleTimerHandle = window.setInterval(function () {
      tick++;
      idleIsBlinking = (tick % 6 === 0); // blink briefly every ~6 ticks
      if (!idleIsBlinking) idleFrameIndex++;
      renderActivePackFrame();
    }, 700);
  }

  // Docks beside the Search button: centered on the header's reserved slot (#header-assistant-slot).
  

  // Docks permanently inside the header's reserved slot (#header-assistant-slot), beside Search.
  // No drag, no saved/persisted position — it is a fixed member of the header, not a free-floating
  // element, so there is no stale-position state that can ever pull it elsewhere (e.g. Study).
  function mountPixelEntity() {
    if (pixelEntityEl || typeof AssistantLVPackData === 'undefined') return;
    const slot = document.getElementById('header-assistant-slot');
    if (!slot) return;

    pixelEntityEl = document.createElement('div');
    pixelEntityEl.id = 'assistant-pixel-entity';
    pixelEntityEl.setAttribute('role', 'button');
    pixelEntityEl.setAttribute('tabindex', '0');
    var _label = (typeof Settings !== 'undefined' && typeof Settings.assistantLabel === 'function') ? (Settings.assistantLabel() || 'Assistant') : 'Assistant';
    pixelEntityEl.setAttribute('aria-label', _label);
    pixelEntityEl.title = _label;

    pixelCanvasEl = document.createElement('canvas');
    pixelCanvasEl.width = PIXEL_CANVAS_SIZE;
    pixelCanvasEl.height = PIXEL_CANVAS_SIZE;
    pixelCanvasEl.className = 'assistant-pixel-entity-canvas';
    pixelEntityEl.appendChild(pixelCanvasEl);

    slot.removeAttribute('aria-hidden');
    slot.appendChild(pixelEntityEl);

    pixelEntityEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMain(); }
    });
    pixelEntityEl.addEventListener('click', openMain);

    refreshPixelEntitySkin();
    startIdleLoop();
  }

  function init() {
    
    const searchBtn = document.getElementById('header-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', openSearch);
    mountPixelEntity();
  }

    return {
      init: init,
      openMain: openMain,
      openPlan: function (opts) { if (typeof PlanningAgentUI !== 'undefined') PlanningAgentUI.open(opts); },
      openSearch: openSearch,
      openStore: openStoreFrom,
      refreshPixelEntitySkin: refreshPixelEntitySkin
    };
})();
