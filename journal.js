// journal.js — Journal tab UI. Depends on: State, Storage, DateHub, PlannerData, JournalData, Modal.
// Builds into #screen-journal. Lock button lives outside the screen at #journal-lock-toggle (see index.html).

const Journal = (function () {
  let initialized = false;
  let currentDate = null;
  let timerInterval = null;

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

  function render() {
    const el = document.getElementById('screen-journal');
    if (!el) return;

    updateLockButton();

    if (JournalData.isLocked()) {
      el.innerHTML = '<div class="journal-locked-placeholder">Journal is locked. Use the lock icon to unlock.</div>';
      return;
    }

    if (!currentDate) currentDate = todayStr();

    const entry = JournalData.getEntry(currentDate);
    const important = JournalData.isImportant(currentDate);
    const blueFire = JournalData.isBlueFire(currentDate);

    el.innerHTML =
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
        '<input type="text" id="journal-quote" placeholder="(optional) today\'s motivational quote" value="' + escapeAttr(entry.morningQuote) + '">' +
      '</div>' +

      '<div class="journal-row">' +
        '<div class="journal-weather">' +
          '<label class="journal-label">Weather</label>' +
          '<select id="journal-weather">' +
            '<option value="">--</option>' +
            weatherOption('Sunny', entry.weather) +
            weatherOption('Cloudy', entry.weather) +
            weatherOption('Rainy', entry.weather) +
            weatherOption('Cold', entry.weather) +
          '</select>' +
        '</div>' +
        '<div class="journal-mood">' +
          '<label class="journal-label">Mood</label>' +
          '<select id="journal-mood">' +
            '<option value="">--</option>' +
            moodOption('\uD83D\uDE04 great', entry.mood) +
            moodOption('\uD83D\uDE42 good', entry.mood) +
            moodOption('\uD83D\uDE10 okay', entry.mood) +
            moodOption('\uD83D\uDE14 low', entry.mood) +
            moodOption('\uD83D\uDE22 rough', entry.mood) +
          '</select>' +
        '</div>' +
        '<div class="journal-hours">' +
          '<label class="journal-label">Hours studied</label>' +
          '<input type="number" id="journal-hours" min="0" step="0.5" value="' + entry.hoursStudied + '">' +
        '</div>' +
        '<div class="journal-questions">' +
          '<label class="journal-label">Questions solved</label>' +
          '<input type="number" id="journal-questions" min="0" step="1" value="' + entry.questionsSolved + '">' +
        '</div>' +
      '</div>' +

      '<div class="journal-diary">' +
        '<label class="journal-label">Diary</label>' +
        '<textarea id="journal-diary-text" rows="8" placeholder="Write about your day...">' + escapeHtml(entry.diaryText) + '</textarea>' +
      '</div>' +

      '<div class="journal-photos">' +
        '<label class="journal-label">Photos</label>' +
        '<div id="journal-photo-list" class="journal-photo-list"></div>' +
        '<input type="file" id="journal-photo-input" accept="image/*" multiple>' +
      '</div>' +

      '<div class="journal-manifestation">' +
        '<label class="journal-label">Manifestation Book</label>' +
        '<textarea id="journal-manifestation-text" rows="4" placeholder="What are you manifesting?">' + escapeHtml(entry.manifestationText) + '</textarea>' +
      '</div>' +

      '<div class="journal-challenge" id="journal-challenge-section"></div>';

    wireMainEvents(entry);
    renderPhotos();
    renderChallengeSection();
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

    document.getElementById('journal-quote').addEventListener('change', function (e) {
      JournalData.updateEntry(currentDate, { morningQuote: e.target.value });
    });
    document.getElementById('journal-weather').addEventListener('change', function (e) {
      JournalData.updateEntry(currentDate, { weather: e.target.value || null });
    });
    document.getElementById('journal-mood').addEventListener('change', function (e) {
      JournalData.updateEntry(currentDate, { mood: e.target.value || null });
    });
    document.getElementById('journal-hours').addEventListener('change', function (e) {
      JournalData.setHoursStudied(currentDate, e.target.value);
      if (typeof Calendar !== 'undefined' && Calendar.isReady && Calendar.isReady() && Calendar.render) Calendar.render();
    });
    document.getElementById('journal-questions').addEventListener('change', function (e) {
      const n = Math.max(0, Number(e.target.value) || 0);
      JournalData.updateEntry(currentDate, { questionsSolved: n });
    });
    document.getElementById('journal-diary-text').addEventListener('change', function (e) {
      JournalData.updateEntry(currentDate, { diaryText: e.target.value });
    });
    document.getElementById('journal-manifestation-text').addEventListener('change', function (e) {
      JournalData.updateEntry(currentDate, { manifestationText: e.target.value });
    });
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
    if (entry.photos.length === 0) {
      list.innerHTML = '<span class="journal-photo-empty">No photos yet.</span>';
      return;
    }
    list.innerHTML = entry.photos.map(function (id) {
      return '<div class="journal-photo-item" data-photo-id="' + id + '">' +
        '<img class="journal-photo-img" data-photo-id="' + id + '">' +
        '<button class="journal-photo-remove" data-photo-id="' + id + '">&times;</button>' +
      '</div>';
    }).join('');

    entry.photos.forEach(function (id) {
      JournalData.getPhotoURL(id).then(function (url) {
        const img = list.querySelector('img[data-photo-id="' + id + '"]');
        if (img && url) img.src = url;
      });
    });

    list.querySelectorAll('.journal-photo-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        JournalData.removePhoto(currentDate, btn.dataset.photoId).then(renderPhotos);
      });
    });
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

  function init() {
    const lockBtn = document.getElementById('journal-lock-toggle');
    if (lockBtn) lockBtn.addEventListener('click', handleLockToggle);
    initialized = true;
    updateLockButton();
    render();
  }

  function isReady() {
    return initialized;
  }

  return { init: init, render: render, openDate: openDate, isReady: isReady };
})();
