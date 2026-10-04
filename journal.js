// journal.js — Journal tab UI. Depends on: State, Storage, DateHub, PlannerData, JournalData, Modal.
// Builds into #screen-journal. Lock button lives outside the screen at #journal-lock-toggle (see index.html).

const Journal = (function () {
  let initialized = false;
  let currentDate = null;
  let openedViaCalendar = false;
  let timerInterval = null;
  let journalHasRenderedOnce = false;

  // In-world book presentation state (presentation only — see openBook below).
  let bookLayer = null;
  let bookBackdropDown = false;
  let screenHome = null;
  let screenNext = null;
  let lockHome = null;
  let lockNext = null;
  const spriteCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  const FONT_STACKS = {
    pixel: "'Pixelify Sans', 'Courier New', monospace",
    write: "'VT323', 'Courier New', monospace",
    hand: "'Kalam', cursive",
    serif: "'Lora', serif",
    sans: "'DM Sans', sans-serif"
  };
  const COLOR_KEYS = ['paper', 'paperDark', 'ink', 'inkSoft', 'frame', 'frameDark', 'frameLight', 'accent', 'accentText', 'bubble', 'field'];
  const DEFAULT_COLORS = {
    paper: '#f6efe0', paperDark: '#e2d6bb', ink: '#3a3226', inkSoft: '#6b6252',
    frame: '#7b5e3f', frameDark: '#3f2f21', frameLight: '#a9865a',
    accent: '#a5603c', accentText: '#fffdf8', bubble: '#fffdf6', field: '#faf4e4'
  };
  const DEFAULT_WEATHER = {
    Sunny: {
      scale: 3, palette: { y: '#f2c94c', o: '#e8a63c' },
      rows: ['....oo....', '.o..yy..o.', '..yyyyyy..', '..yyyyyy..', 'oyyyyyyyyo', 'oyyyyyyyyo', '..yyyyyy..', '..yyyyyy..', '.o..yy..o.', '....oo....']
    },
    Cloudy: {
      scale: 3, palette: { w: '#e8ecf6', g: '#aeb8d0' },
      rows: ['..........', '...gggg...', '..gwwwwg..', '.gwwwwwwg.', 'gwwwwwwwwg', 'gwwwwwwwwg', '.gggggggg.', '..........']
    },
    Rainy: {
      scale: 3, palette: { w: '#e8ecf6', g: '#aeb8d0', b: '#5cc8f0' },
      rows: ['...gggg...', '..gwwwwg..', '.gwwwwwwg.', 'gwwwwwwwwg', '.gggggggg.', '..b..b..b.', '.b..b..b..', '..b..b..b.', '.b..b..b..']
    },
    Cold: {
      scale: 3, palette: { s: '#bfe3f5' },
      rows: ['....s....', '.s..s..s.', '..s.s.s..', '...sss...', 'sssssssss', '...sss...', '..s.s.s..', '.s..s..s.', '....s....']
    }
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function shiftDateStr(dateStr, delta) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function formatLong(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function formatClock(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + pad(s);
  }

  function openDate(dateStr) {
    currentDate = dateStr;
    openedViaCalendar = true;
    render();
  }

  function enterViaNav() {
    if (openedViaCalendar) {
      openedViaCalendar = false;
    } else {
      currentDate = todayStr();
    }
    render();
  }

  // ---------- Lock button (outside the journal page) ----------

  function updateLockButton() {
    const btn = document.getElementById('journal-lock-toggle');
    if (!btn) return;
    btn.textContent = JournalData.isLocked() ? '\uD83D\uDD12' : '\uD83D\uDD13';
    btn.title = JournalData.isLocked() ? 'Journal locked — tap to unlock' : 'Journal unlocked — tap to lock';
  }

  function handleLockToggle() {
    if (JournalData.isLocked()) {
      openUnlockModal();
      return;
    }
    if (!JournalData.hasPassword()) {
      openSetPasswordModal(function () {
        JournalData.lock();
        updateLockButton();
        render();
      });
      return;
    }
    JournalData.lock();
    updateLockButton();
    render();
  }

  function openUnlockModal() {
    const html =
      '<div class="journal-lock-modal">' +
        '<h3>Journal Locked</h3>' +
        '<input type="password" id="journal-unlock-pass" placeholder="Password">' +
        '<div id="journal-unlock-error" class="journal-lock-error"></div>' +
        '<button id="journal-unlock-btn">Unlock</button>' +
      '</div>';
    Modal.open(html);
    document.getElementById('journal-unlock-btn').addEventListener('click', async function () {
      const pass = document.getElementById('journal-unlock-pass').value;
      const ok = await JournalData.unlock(pass);
      if (ok) {
        Modal.close();
        updateLockButton();
        render();
      } else {
        document.getElementById('journal-unlock-error').textContent = 'Incorrect password.';
      }
    });
  }

  function openSetPasswordModal(onDone) {
    const html =
      '<div class="journal-lock-modal">' +
        '<h3>Create Journal Password</h3>' +
        '<input type="password" id="journal-newpass" placeholder="New password">' +
        '<input type="password" id="journal-newpass-confirm" placeholder="Confirm password">' +
        '<div id="journal-newpass-error" class="journal-lock-error"></div>' +
        '<button id="journal-newpass-save">Save Password</button>' +
      '</div>';
    Modal.open(html);
    document.getElementById('journal-newpass-save').addEventListener('click', async function () {
      const p1 = document.getElementById('journal-newpass').value;
      const p2 = document.getElementById('journal-newpass-confirm').value;
      if (!p1) { document.getElementById('journal-newpass-error').textContent = 'Password cannot be empty.'; return; }
      if (p1 !== p2) { document.getElementById('journal-newpass-error').textContent = 'Passwords do not match.'; return; }
      await JournalData.setPassword(p1);
      Modal.close();
      if (onDone) onDone();
    });
  }

  function openChangePasswordModal() {
    const html =
      '<div class="journal-lock-modal">' +
        '<h3>Change Journal Password</h3>' +
        '<input type="password" id="journal-oldpass" placeholder="Current password">' +
        '<input type="password" id="journal-newpass2" placeholder="New password">' +
        '<div id="journal-changepass-error" class="journal-lock-error"></div>' +
        '<button id="journal-changepass-save">Save</button>' +
      '</div>';
    Modal.open(html);
    document.getElementById('journal-changepass-save').addEventListener('click', async function () {
      const oldP = document.getElementById('journal-oldpass').value;
      const newP = document.getElementById('journal-newpass2').value;
      if (!newP) { document.getElementById('journal-changepass-error').textContent = 'New password cannot be empty.'; return; }
      const ok = await JournalData.changePassword(oldP, newP);
      if (ok) { Modal.close(); } else {
        document.getElementById('journal-changepass-error').textContent = 'Current password is incorrect.';
      }
    });
  }

  // ---------- Main render ----------

  function getPageContentEl(el) {
    let wrap = document.getElementById('journal-page-content');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'journal-page-content';
      wrap.className = 'journal-page-content';
      el.appendChild(wrap);
    }
    return wrap;
  }

  function renderContent() {
    const el = document.getElementById('screen-journal');
    if (!el) return;
    const content = getPageContentEl(el);

    updateLockButton();

    if (JournalData.isLocked()) {
      content.innerHTML = '<div class="journal-locked-placeholder">Journal is locked. Use the lock icon to unlock.</div>';
      return;
    }

    if (!currentDate) currentDate = todayStr();

    const entry = JournalData.getEntry(currentDate);
    const important = JournalData.isImportant(currentDate);
    const blueFire = JournalData.isBlueFire(currentDate);
    const readOnly = !!entry.saved;
    const dis = readOnly ? ' disabled' : '';

    content.innerHTML =
      '<div class="journal-topbar">' +
        (blueFire ? '<span class="journal-bluefire">\uD83D\uDD35</span>' : '') +
        '<button id="journal-prev-date">&lt;</button>' +
        '<span class="journal-date-label">' + formatLong(currentDate) + '</span>' +
        '<button id="journal-next-date">&gt;</button>' +
        (important ? '<span class="journal-important-tag">' + (DateHub.get(currentDate).label || 'Important date') + '</span>' : '') +
        (JournalData.hasPassword() ? '<button id="journal-change-pass" class="journal-change-pass-btn">change password</button>' : '') +
      '</div>' +

      '<div class="journal-morning">' +
        '<label class="journal-label">Morning quote</label>' +
        '<input type="text" id="journal-quote"' + dis + ' placeholder="(optional) today\'s motivational quote" value="' + escapeAttr(entry.morningQuote) + '">' +
      '</div>' +

      '<div class="journal-row">' +
        '<div class="journal-weather">' +
          '<label class="journal-label">Weather</label>' +
          '<select id="journal-weather"' + dis + '>' +
            '<option value="">--</option>' +
            weatherOption('Sunny', entry.weather) +
            weatherOption('Cloudy', entry.weather) +
            weatherOption('Rainy', entry.weather) +
            weatherOption('Cold', entry.weather) +
          '</select>' +
        '</div>' +
        '<div class="journal-mood">' +
          '<label class="journal-label">Mood</label>' +
          '<select id="journal-mood"' + dis + '>' +
            '<option value="">--</option>' +
            moodOption('\uD83D\uDE04 great', entry.mood) +
            moodOption('\uD83D\uDE42 good', entry.mood) +
            moodOption('\uD83D\uDE10 okay', entry.mood) +
            moodOption('\uD83D\uDE14 low', entry.mood) +
            moodOption('\uD83D\uDE22 rough', entry.mood) +
          '</select>' +
        '</div>' +
          '</div>' +

      '<div class="journal-diary">' +
        '<label class="journal-label">Diary</label>' +
        '<textarea id="journal-diary-text" rows="8"' + dis + ' placeholder="Write about your day...">' + escapeHtml(entry.diaryText) + '</textarea>' +
      '</div>' +

      '<div class="journal-photos">' +
        '<label class="journal-label">Photos</label>' +
        '<div id="journal-photo-list" class="journal-photo-list"></div>' +
        '<input type="file" id="journal-photo-input" accept="image/*" multiple' + dis + '>' +
      '</div>' +

      '<div class="journal-manifestation">' +
        '<label class="journal-label">Manifestation Book</label>' +
        '<textarea id="journal-manifestation-text" rows="4"' + dis + ' placeholder="What are you manifesting?">' + escapeHtml(entry.manifestationText) + '</textarea>' +
      '</div>' +

      '<div class="journal-save-row">' +
        (readOnly
          ? '<button id="journal-edit-btn">Edit</button>'
          : '<button id="journal-save-btn">Save</button>') +
      '</div>' +

       '<div class="journal-challenge" id="journal-challenge-section"></div>' +
      '<div class="journal-sleep-section" id="journal-sleep-section"></div>';

    wireMainEvents(entry);
    renderPhotos();
    renderChallengeSection();
    renderSleepSection();
    decorateBookContent();
  }

  function render() {
    const el = document.getElementById('screen-journal');
    if (!el) return;
    const content = getPageContentEl(el);
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!journalHasRenderedOnce || reduceMotion || !content.innerHTML) {
      journalHasRenderedOnce = true;
      renderContent();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'journal-page-overlay';
    overlay.innerHTML = content.innerHTML;
    el.appendChild(overlay);
    function dropOverlay() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('animationend', function (e) { if (e.target === overlay) dropOverlay(); });
    setTimeout(dropOverlay, 1300); // fallback: animationend never fires while the screen is display:none

    renderContent();
  }

  function weatherOption(label, current) {
    return '<option value="' + label + '"' + (current === label ? ' selected' : '') + '>' + label + '</option>';
  }
  function moodOption(label, current) {
    return '<option value="' + label + '"' + (current === label ? ' selected' : '') + '>' + label + '</option>';
  }
  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function wireMainEvents() {
    document.getElementById('journal-prev-date').addEventListener('click', function () {
      currentDate = shiftDateStr(currentDate, -1);
      render();
    });
    document.getElementById('journal-next-date').addEventListener('click', function () {
      currentDate = shiftDateStr(currentDate, 1);
      render();
    });

    const changePassBtn = document.getElementById('journal-change-pass');
    if (changePassBtn) changePassBtn.addEventListener('click', openChangePasswordModal);

    // Fields no longer autosave on change — values are only committed when Save is pressed
    // (see journal-save-btn below). Read-only (saved) entries render these fields disabled,
    // so there is nothing to wire here for them.
    const saveBtn = document.getElementById('journal-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (saveBtn.disabled) return; // duplicate-click guard
        saveBtn.disabled = true;
        JournalData.updateEntry(currentDate, {
          morningQuote: document.getElementById('journal-quote').value,
          weather: document.getElementById('journal-weather').value || null,
          mood: document.getElementById('journal-mood').value || null,
          diaryText: document.getElementById('journal-diary-text').value,
          manifestationText: document.getElementById('journal-manifestation-text').value,
          saved: true
        });
        if (typeof Calendar !== 'undefined' && Calendar.isReady && Calendar.isReady() && Calendar.render) Calendar.render();
        render();
      });
    }

    const editBtn = document.getElementById('journal-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        if (editBtn.disabled) return; // duplicate-click guard
        editBtn.disabled = true;
        JournalData.updateEntry(currentDate, { saved: false });
        render();
      });
    }

    document.getElementById('journal-photo-input').addEventListener('change', function (e) {
      const files = Array.prototype.slice.call(e.target.files || []);
      Promise.all(files.map(function (f) { return JournalData.addPhoto(currentDate, f); }))
        .then(renderPhotos);
      e.target.value = '';
    });
  }

  // ---------- Photos ----------

function renderPhotos() {
    const list = document.getElementById('journal-photo-list');
    if (!list) return;
    const entry = JournalData.getEntry(currentDate);
    const readOnly = !!entry.saved;
    if (entry.photos.length === 0) {
      list.innerHTML = '<span class="journal-photo-empty">No photos yet.</span>';
      return;
    }
    list.innerHTML = entry.photos.map(function (id) {
      return '<div class="journal-photo-item" data-photo-id="' + id + '">' +
        '<img class="journal-photo-img" data-photo-id="' + id + '" alt="Journal photo">' +
        (readOnly ? '' : '<button class="journal-photo-remove" data-photo-id="' + id + '" aria-label="Remove photo">&times;</button>') +
      '</div>';
    }).join('');

    entry.photos.forEach(function (id) {
      JournalData.getPhotoURL(id).then(function (url) {
        const img = list.querySelector('img[data-photo-id="' + id + '"]');
        if (img && url) {
          img.src = url;
          img.addEventListener('click', function () {
            Modal.open('<div class="journal-polaroid-preview"><img src="' + url + '" class="journal-polaroid-preview-img" alt="Journal photo preview"></div>');
          });
        }
      });
    });

    if (!readOnly) {
      list.querySelectorAll('.journal-photo-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          JournalData.removePhoto(currentDate, btn.dataset.photoId).then(renderPhotos);
        });
      });
    }
  }

  // ---------- Daily Challenge ----------

  function renderChallengeSection() {
    const section = document.getElementById('journal-challenge-section');
    if (!section) return;
    const entry = JournalData.getEntry(currentDate);
    const challenge = entry.challenge;

    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    if (!challenge.startedAt) {
      section.innerHTML =
        '<label class="journal-label">Daily Challenge</label>' +
        '<button id="journal-start-challenge">Generate Today\'s Challenge</button>';
      const btn = document.getElementById('journal-start-challenge');
      if (btn) btn.addEventListener('click', function () {
        JournalData.generateChallenge(currentDate);
        renderChallengeSection();
      });
      return;
    }

    const topicName = JournalData.getChallengeTopicName(currentDate) || '(no planner topics yet)';
    const remaining = JournalData.getChallengeRemainingMs(currentDate);

    if (challenge.completed !== null) {
      section.innerHTML =
        '<label class="journal-label">Daily Challenge</label>' +
        '<div class="journal-challenge-line">Study: ' + topicName + '</div>' +
        '<div class="journal-challenge-line">Physical: ' + challenge.physicalChallenge + '</div>' +
        '<div class="journal-challenge-result">' + (challenge.completed ? 'Completed \u2705' : 'Not completed') + '</div>';
      return;
    }

    if (remaining > 0) {
      section.innerHTML =
        '<label class="journal-label">Daily Challenge</label>' +
        '<div class="journal-challenge-line">Study: ' + topicName + '</div>' +
        '<div class="journal-challenge-line">Physical: ' + challenge.physicalChallenge + '</div>' +
        '<div class="journal-challenge-timer" id="journal-challenge-timer">' + formatClock(remaining) + '</div>';

      timerInterval = setInterval(function () {
        const left = JournalData.getChallengeRemainingMs(currentDate);
        const timerEl = document.getElementById('journal-challenge-timer');
        if (!timerEl) { clearInterval(timerInterval); return; }
        if (left <= 0) {
          clearInterval(timerInterval);
          renderChallengeSection();
          return;
        }
        timerEl.textContent = formatClock(left);
      }, 1000);
      return;
    }

    // Timer elapsed, awaiting yes/no
    section.innerHTML =
      '<label class="journal-label">Daily Challenge</label>' +
      '<div class="journal-challenge-line">Study: ' + topicName + '</div>' +
      '<div class="journal-challenge-line">Physical: ' + challenge.physicalChallenge + '</div>' +
      '<div class="journal-challenge-question">Did you complete today\'s challenge?</div>' +
      '<button id="journal-challenge-yes">Yes</button>' +
      '<button id="journal-challenge-no">No</button>';

    document.getElementById('journal-challenge-yes').addEventListener('click', function () {
      JournalData.completeChallenge(currentDate, true);
      renderChallengeSection();
      if (typeof Calendar !== 'undefined' && Calendar.isReady && Calendar.isReady() && Calendar.render) Calendar.render();
    });
    document.getElementById('journal-challenge-no').addEventListener('click', function () {
      JournalData.completeChallenge(currentDate, false);
      renderChallengeSection();
    });
  }

  function renderSleepSection() {
    const section = document.getElementById('journal-sleep-section');
    if (!section) return;
    const dateStr = currentDate;
    const rec = SleepData.getRecord(dateStr);
    function fmtDur(min) {
      if (min === null || min === undefined) return '\u2013';
      const h = Math.floor(min / 60), m = min % 60;
      return h + 'h ' + (m < 10 ? '0' + m : m) + 'm';
    }
    section.innerHTML =
      '<label class="journal-label">Sleep</label>' +
      '<div class="journal-sleep-row">' +
        '<label>Bedtime&nbsp;<input type="time" id="journal-sleep-bed" value="' + (rec.sleepTime || '') + '"></label>' +
        '&nbsp;&nbsp;' +
        '<label>Wake&nbsp;<input type="time" id="journal-sleep-wake" value="' + (rec.wakeTime || '') + '"></label>' +
        '&nbsp;&nbsp;' +
        (rec.completed ? '<span class="journal-sleep-dur">' + fmtDur(rec.durationMin) + '</span>' : '') +
        '<button id="journal-sleep-save">Save</button>' +
      '</div>';
    document.getElementById('journal-sleep-save').addEventListener('click', function () {
      const bed = document.getElementById('journal-sleep-bed').value;
      const wake = document.getElementById('journal-sleep-wake').value;
      if (bed && wake) { SleepData.saveRecord(dateStr, { sleepTime: bed, wakeTime: wake }); }
      renderSleepSection();
    });
  }

  function init() {
    const lockBtn = document.getElementById('journal-lock-toggle');
    if (lockBtn) lockBtn.addEventListener('click', handleLockToggle);
    initialized = true;
    updateLockButton();
    render();
  }

  function isHexColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

  function getWorldSkin() {
    let def = null;
    try {
      if (typeof MyWorldContent !== 'undefined' && MyWorldContent && MyWorldContent.getActive) def = MyWorldContent.getActive('world');
    } catch (e) { def = null; }
    const skin = (def && def.journalSkin && typeof def.journalSkin === 'object') ? def.journalSkin : {};
    return { name: (def && typeof def.name === 'string') ? def.name : '', skin: skin };
  }

  function spriteUrl(sprite) {
    if (spriteCache && spriteCache.has(sprite)) return spriteCache.get(sprite);
    const rows = sprite.rows;
    const h = rows.length;
    const w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y].charAt(x);
        const col = sprite.palette[ch];
        if (ch !== '.' && col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    const url = 'url(' + c.toDataURL('image/png') + ')';
    if (spriteCache) spriteCache.set(sprite, url);
    return url;
  }

  function validSprite(sprite) {
    return !!(sprite && sprite.palette && Array.isArray(sprite.rows) && sprite.rows.length && typeof sprite.rows[0] === 'string' && sprite.rows[0].length);
  }

  function paintSprite(el, sprite) {
    if (!el) return;
    if (!validSprite(sprite)) { el.style.display = 'none'; return; }
    const sc = sprite.scale || 3;
    el.style.display = '';
    el.style.width = (sprite.rows[0].length * sc) + 'px';
    el.style.height = (sprite.rows.length * sc) + 'px';
    el.style.backgroundImage = spriteUrl(sprite);
    el.style.backgroundSize = '100% 100%';
  }

  function paintTile(el, sprite) {
    if (!el) return;
    if (!validSprite(sprite)) { el.style.display = 'none'; return; }
    const sc = sprite.scale || 3;
    el.style.display = '';
    el.style.height = (sprite.rows.length * sc) + 'px';
    el.style.backgroundImage = spriteUrl(sprite);
    el.style.backgroundSize = (sprite.rows[0].length * sc) + 'px ' + (sprite.rows.length * sc) + 'px';
  }

  // The Journal book is presentation only: the one canonical #screen-journal element (and its one
  // lock button) are re-parented into a book shell inside the My World host while it is open, and
  // put back exactly where they were on close. No second renderer, state, save path or storage.
  function openBook(host) {
    if (bookLayer || !host) return;
    const screen = document.getElementById('screen-journal');
    if (!screen || !screen.parentNode) return;

    if (openedViaCalendar) { openedViaCalendar = false; } else { currentDate = todayStr(); }

    const ws = getWorldSkin();
    const skin = ws.skin;
    const fonts = skin.fonts || {};
    const amb = skin.ambient || {};

    const layer = document.createElement('div');
    layer.className = 'journal-book-layer';
    const skinColors = skin.colors || {};
    COLOR_KEYS.forEach(function (k) {
      layer.style.setProperty('--jb-' + k, isHexColor(skinColors[k]) ? skinColors[k] : DEFAULT_COLORS[k]);
    });
    layer.style.setProperty('--jb-font-title', FONT_STACKS[fonts.title] || FONT_STACKS.pixel);
    layer.style.setProperty('--jb-font-body', FONT_STACKS[fonts.body] || FONT_STACKS.pixel);
    layer.style.setProperty('--jb-font-write', FONT_STACKS[fonts.write] || FONT_STACKS.write);
    if (isHexColor(amb.color)) layer.style.setProperty('--jb-firefly', amb.color);

    layer.innerHTML =
      '<div class="journal-book" role="dialog" aria-modal="true" aria-label="Journal" tabindex="-1">' +
        '<div class="jb-cover">' +
          '<div class="jb-paper">' +
            '<div class="jb-header">' +
              '<div class="jb-scene" aria-hidden="true">' +
                '<div class="jb-scenery"></div>' +
                '<div class="jb-signature"></div>' +
                (amb.firefly ? '<div class="jb-firefly"></div>' : '') +
              '</div>' +
              '<div class="jb-lock-slot"></div>' +
              '<button type="button" class="jb-close" aria-label="Close journal">\u2715</button>' +
              '<h2 class="jb-title"></h2>' +
            '</div>' +
            '<div class="jb-page"></div>' +
            '<div class="jb-footer" aria-hidden="true">' +
              '<div class="jb-vines"></div>' +
              '<div class="jb-snail"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const title = (typeof skin.title === 'string' && skin.title.trim())
      ? skin.title.trim()
      : (ws.name ? ws.name + ' Journal' : 'Journal');
    layer.querySelector('.jb-title').textContent = title;

    const scenery = layer.querySelector('.jb-scenery');
    const signature = layer.querySelector('.jb-signature');
    paintTile(scenery, skin.header);
    paintSprite(signature, skin.signature);
    paintTile(layer.querySelector('.jb-vines'), skin.bottom);
    paintSprite(layer.querySelector('.jb-snail'), skin.accent);
    if (!validSprite(skin.header)) {
      const scene = layer.querySelector('.jb-scene');
      if (!validSprite(skin.signature)) scene.style.display = 'none';
      else scene.style.minHeight = (skin.signature.rows.length * (skin.signature.scale || 3) + 4) + 'px';
    }

    screenHome = screen.parentNode;
    screenNext = screen.nextSibling;
    layer.querySelector('.jb-page').appendChild(screen);
    screen.style.display = 'block';

    const lockBtn = document.getElementById('journal-lock-toggle');
    if (lockBtn && lockBtn.parentNode) {
      lockHome = lockBtn.parentNode;
      lockNext = lockBtn.nextSibling;
      layer.querySelector('.jb-lock-slot').appendChild(lockBtn);
      lockBtn.style.display = 'inline-block';
    }

    layer.addEventListener('pointerdown', function (e) { bookBackdropDown = (e.target === layer); });
    layer.addEventListener('click', function (e) {
      if (e.target === layer && bookBackdropDown) closeBook();
      bookBackdropDown = false;
    });
    layer.querySelector('.jb-close').addEventListener('click', function () { closeBook(); });

    host.appendChild(layer);
    bookLayer = layer;
    if (typeof Modal !== 'undefined' && Modal.setHost) Modal.setHost(host);
    document.addEventListener('keydown', onBookKey);
    if (typeof MiscSound !== 'undefined') MiscSound.play('uiOpen');

    renderContent();
    const bookEl = layer.querySelector('.journal-book');
    if (bookEl && bookEl.focus) bookEl.focus({ preventScroll: true });
  }

  function closeBook() {
    if (!bookLayer) return;
    const layer = bookLayer;
    bookLayer = null;
    document.removeEventListener('keydown', onBookKey);

    const overlay = document.getElementById('modal-overlay');
    if (typeof Modal !== 'undefined' && overlay && window.getComputedStyle(overlay).display !== 'none') Modal.close();

    const screen = document.getElementById('screen-journal');
    if (screen && screenHome) {
      screenHome.insertBefore(screen, (screenNext && screenNext.parentNode === screenHome) ? screenNext : null);
      screen.style.display = 'none';
    }
    const lockBtn = document.getElementById('journal-lock-toggle');
    if (lockBtn && lockHome) {
      lockHome.insertBefore(lockBtn, (lockNext && lockNext.parentNode === lockHome) ? lockNext : null);
      lockBtn.style.display = 'none';
    }
    screenHome = screenNext = lockHome = lockNext = null;

    if (typeof Modal !== 'undefined' && Modal.setHost) Modal.setHost(null);
    if (layer.parentNode) layer.parentNode.removeChild(layer);
    if (typeof MiscSound !== 'undefined') MiscSound.play('uiClose');
  }

  function isBookOpen() { return !!bookLayer; }

  function onBookKey(e) {
    if (e.key !== 'Escape' || !bookLayer) return;
    const overlay = document.getElementById('modal-overlay');
    if (overlay && window.getComputedStyle(overlay).display !== 'none') return;
    closeBook();
  }

  // Adds the pixel weather icon beside the (unchanged) weather select while the book is open.
  function decorateBookContent() {
    if (!bookLayer) return;
    const sel = document.getElementById('journal-weather');
    if (!sel || !sel.parentNode) return;
    const skinWeather = getWorldSkin().skin.weather || {};
    const icon = document.createElement('span');
    icon.className = 'journal-weather-icon';
    icon.setAttribute('aria-hidden', 'true');
    sel.parentNode.insertBefore(icon, sel);
    function paint() { paintSprite(icon, skinWeather[sel.value] || DEFAULT_WEATHER[sel.value] || null); }
    paint();
    sel.addEventListener('change', paint);
  }

  function isReady() {
    return initialized;
  }

  return { init: init, render: render, openDate: openDate, enterViaNav: enterViaNav, isReady: isReady, openBook: openBook, closeBook: closeBook, isBookOpen: isBookOpen };
})();
