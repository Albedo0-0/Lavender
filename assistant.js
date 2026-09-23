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
          '<button class="assistant-ribbon assistant-ribbon-today' + (todayNeedsChoice ? ' assistant-ribbon-highlight' : '') + '" data-go="today">Today</button>' +
          '<button class="assistant-ribbon assistant-ribbon-1" data-go="tomorrow">Tomorrow</button>' +
          '<button class="assistant-ribbon assistant-ribbon-2" data-go="store">Store</button>' +
          '<button class="assistant-ribbon assistant-ribbon-3" data-go="alarms">Alarms</button>' +
        '</div>' +
      '</div>'
    );
  }

  function openMain() {
    Modal.open(mainHtml(), { size: 'lg' });
    document.querySelectorAll('#assistant-menu button').forEach(function (btn) {
      btn.addEventListener('click', function () { routeTo(btn.dataset.go); });
    });
  }

  function routeTo(key) {
    try {
      if (key === 'store') return openStore();
      if (key === 'timeline') return openTimeline();
      if (key === 'tomorrow') return openTomorrow();
      if (key === 'leftoff') return openWhereLeftOff();
      if (key === 'search') return openSearch();
      if (key === 'summary') return openSummary(AssistantData.todayStr());
      if (key === 'alarms') return openAlarms();
      if (key === 'today') { if (typeof ItineraryToday !== 'undefined') ItineraryToday.open(); return; }
    } catch (err) {
      console.error('Assistant.routeTo failed for', key, err);
      Modal.open(backBtnHtml() + '<div class="assistant-page assistant-page-plain"><h3 class="section-title">' + key + '</h3><div class="empty-state">Couldn\'t load this right now.</div></div>');
      wireBack();
    }
  }

  function backBtnHtml() { return '<div class="modal-header"><button id="assistant-back-btn" class="btn-secondary">\u2190 Back</button></div>'; }
  function wireBack() { document.getElementById('assistant-back-btn').addEventListener('click', openMain); }

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

  function openStore() {
    Modal.open(backBtnHtml() +
      '<div class="assistant-page assistant-page-plain">' +
        '<h3 class="section-title">Store</h3>' +
        '<h4 class="section-title">Worlds</h4>' +
        '<div class="assistant-store-card">' + storeBodyHtml() + '</div>' +
        '<h4 class="section-title">Companion Packs</h4>' +
        '<div class="assistant-store-card">' + assistantPacksBodyHtml() + '</div>' +
      '</div>');
    wireBack();
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
    Modal.open(backBtnHtml() + '<div class="assistant-page assistant-page-timeline"><h3 class="section-title">History</h3>' + body + '</div>');
    wireBack();
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
    const rows = list.length ? list.map(taskRowHtml).join('') : '<div class="empty-state">Nothing scheduled for tomorrow yet.</div>';
    Modal.open(backBtnHtml() +
      '<div class="assistant-page assistant-page-envelope">' +
        '<h3 class="section-title">Tomorrow</h3>' +
        '<div class="assistant-envelope">' +
          '<div class="assistant-envelope-flap" aria-hidden="true"></div>' +
          '<div class="assistant-envelope-contents">' + rows + '</div>' +
        '</div>' +
      '</div>');
    wireBack();
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
    return '<div class="assistant-search-row assistant-search-result assistant-index-row list-row list-row-compact" data-kind="' + esc(ref.kind || '') + '" data-task-id="' + esc(ref.taskId || '') + '" data-subject="' + esc(ref.subject || '') + '" data-topic-id="' + esc(ref.topicId || '') + '" data-date="' + esc(ref.date || r.date || '') + '">' +
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
      if (Planner.openForTopic) Planner.openForTopic(ds.subject, ds.topicId);
      Nav.switchTo('library');
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

  function summaryHtml(dateStr) {
    const s = AssistantData.getDailySummary(dateStr);
    return backBtnHtml() + '<div class="assistant-page assistant-page-receipt"><h3 class="section-title">Daily Summary</h3>' +
      '<div class="assistant-receipt">' +
        '<span class="assistant-receipt-stamp" aria-hidden="true">' + dateStr + '</span>' +
        '<div class="form-row"><input type="date" id="assistant-summary-date" value="' + dateStr + '"></div>' +
        '<p>Study: ' + fmtMs(s.studyMs) + ' \u00b7 Break: ' + fmtMs(s.breakMs) + ' \u00b7 Questions: ' + s.questionsSolved + '</p>' +
        '<p>Hydration: ' + (s.hydrationScore === null ? '\u2013' : s.hydrationScore + '/10') + ' \u00b7 Sleep: ' + (s.sleepHours === null ? '\u2013' : s.sleepHours + 'h') + '</p>' +
        '<p>Tasks: ' + s.tasksCompleted + ' / ' + s.tasksTotal + ' completed</p>' +
      '</div>' +
    '</div>';
  }

  function openSummary(dateStr) {
    Modal.open(summaryHtml(dateStr));
    wireBack();
    document.getElementById('assistant-summary-date').addEventListener('change', function (e) { openSummary(e.target.value); });
  }

  // ---------- Alarms (§6.1 — General Alarm lives here, near Notepad, now that Assistant exists) ----------

  function openAlarms() {
    Alarm.openList();
  }

  function handleIconClick() { openMain(); }

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

  function defaultPixelEntityPosition() {
    const musicBtn = document.getElementById('player-music-btn');
    if (musicBtn) {
      const rect = musicBtn.getBoundingClientRect();
      return { x: Math.max(4, rect.left - PIXEL_CANVAS_SIZE - 10), y: Math.max(4, rect.top) };
    }
    return { x: 12, y: 12 };
  }

  function clampToViewport(pos) {
    const maxX = Math.max(0, window.innerWidth - PIXEL_CANVAS_SIZE - 8);
    const maxY = Math.max(0, window.innerHeight - PIXEL_CANVAS_SIZE - 8);
    return { x: Math.min(Math.max(0, pos.x), maxX), y: Math.min(Math.max(0, pos.y), maxY) };
  }

  function applyPixelEntityPosition(pos) {
    if (!pixelEntityEl) return;
    pixelEntityEl.style.left = pos.x + 'px';
    pixelEntityEl.style.top = pos.y + 'px';
  }

  function savePixelEntityPosition(pos) {
    if (typeof State === 'undefined' || typeof State.patch !== 'function') return;
    State.patch('settings', { assistantPosition: { x: Math.round(pos.x), y: Math.round(pos.y) } });
  }

  function wirePixelEntityDrag() {
    let dragging = false;
    let moved = false;
    let startPointer = { x: 0, y: 0 };
    let startPos = { x: 0, y: 0 };

    pixelEntityEl.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = false;
      startPointer = { x: e.clientX, y: e.clientY };
      const rect = pixelEntityEl.getBoundingClientRect();
      startPos = { x: rect.left, y: rect.top };
      pixelEntityEl.setPointerCapture(e.pointerId);
    });
    pixelEntityEl.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - startPointer.x, dy = e.clientY - startPointer.y;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) { moved = true; pixelEntityEl.classList.add('assistant-pixel-entity-dragging'); }
      if (moved) applyPixelEntityPosition(clampToViewport({ x: startPos.x + dx, y: startPos.y + dy }));
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      pixelEntityEl.classList.remove('assistant-pixel-entity-dragging');
      if (moved) {
        const rect = pixelEntityEl.getBoundingClientRect();
        savePixelEntityPosition({ x: rect.left, y: rect.top });
      } else {
        openMain(); // a genuine click (movement stayed under the threshold), not a drag
      }
    }
    pixelEntityEl.addEventListener('pointerup', endDrag);
    pixelEntityEl.addEventListener('pointercancel', endDrag);
  }

  function mountPixelEntity() {
    if (pixelEntityEl || typeof AssistantLVPackData === 'undefined') return;
    pixelEntityEl = document.createElement('div');
    pixelEntityEl.id = 'assistant-pixel-entity';
    pixelEntityEl.setAttribute('role', 'button');
    pixelEntityEl.setAttribute('tabindex', '0');
    pixelEntityEl.setAttribute('aria-label', Settings.assistantLabel() || 'Assistant');
    pixelEntityEl.title = Settings.assistantLabel() || 'Assistant';

    pixelCanvasEl = document.createElement('canvas');
    pixelCanvasEl.width = PIXEL_CANVAS_SIZE;
    pixelCanvasEl.height = PIXEL_CANVAS_SIZE;
    pixelCanvasEl.className = 'assistant-pixel-entity-canvas';
    pixelEntityEl.appendChild(pixelCanvasEl);
    document.body.appendChild(pixelEntityEl);

    const saved = (State.get().settings || {}).assistantPosition;
    applyPixelEntityPosition(clampToViewport(saved || defaultPixelEntityPosition()));

    pixelEntityEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMain(); }
    });
    wirePixelEntityDrag();

    refreshPixelEntitySkin();
    startIdleLoop();

    window.addEventListener('resize', function () {
      const rect = pixelEntityEl.getBoundingClientRect();
      applyPixelEntityPosition(clampToViewport({ x: rect.left, y: rect.top }));
    });
  }

  function init() {
    const btn = document.getElementById('assistant-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
    const searchBtn = document.getElementById('header-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', openSearch);
    mountPixelEntity();
  }

  return { init: init, openMain: openMain, openSearch: openSearch, refreshPixelEntitySkin: refreshPixelEntitySkin };
})();
