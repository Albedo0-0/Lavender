// backup-ui.js — Utility-drawer UI for Backup/Restore (Feature 14). Depends on: Backup, Modal,
// State. Load after backup.js and modal.js. Owns no data of its own — pure UI glue over Backup's
// inspectBackup()/restoreFromJson(). Stays inside the existing utility drawer; no new top-level
// navigation screen.
//
// Styling Phase 3: Backup already has meaningfully more CSS than most modules (24 matches) —
// that's refinement territory for Phase 12, not this pass. Only the genuinely shared primitives
// are hooked here: the modal close button now uses .modal-close-btn instead of its own one-off
// style, and the Cancel action uses .btn-secondary. The summary grid, change list, and compare
// table stay bespoke.
const BackupUI = (function () {
  let _pendingPkg = null;
  let _confirmBusy = false;
  let _exportBusy = false;

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function changeLi(label, n) {
    return '<li>' + label + ': <strong>' + n + '</strong></li>';
  }

  function warningsHtml(list) {
    if (!list || !list.length) return '';
    return '<div class="backup-warning"><strong>Please note</strong><ul class="backup-change-list">'
      + list.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('')
      + '</ul></div>';
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function renderExportHtml(res) {
    const st = res.stats;
    return '<div class="backup-modal">'
      + '<div class="backup-modal-header"><h3>Backup Created</h3>'
      + '<button class="modal-close-btn" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p>' + escapeHtml(res.filename) + ' (' + formatBytes(res.size) + ') was sent to your downloads. Keep the ZIP file as it is &mdash; your photos are stored inside it.</p>'
      + '<ul class="backup-change-list">'
      + changeLi('Photos', st.photos)
      + changeLi('Media files', st.mediaFiles + ' (' + formatBytes(st.mediaBytes) + ')')
      + changeLi('Tasks', st.tasks)
      + changeLi('Planner tasks', st.plannerTasks)
      + changeLi('Journal entries', st.journalEntries)
      + '</ul>'
      + warningsHtml(res.warnings)
      + '<div class="backup-modal-actions"><button id="backup-result-ok-btn" class="backup-confirm-btn">Done</button></div>'
      + '</div>';
  }

  function compareRow(label, cmp) {
    return '<tr><td>' + label + '</td><td>' + cmp.onlyInBackup + '</td><td>' + cmp.onlyInLive
      + '</td><td>' + cmp.inBoth + '</td><td>' + cmp.conflicts + '</td></tr>';
  }

  function renderInspectHtml(insp) {
    const s = insp.summary;
    const c = insp.compare;
    return ''
      + '<div class="backup-modal">'
      + '<div class="backup-modal-header"><h3>Restore Backup</h3>'
      + '<button class="modal-close-btn" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p class="backup-modal-meta">Backup exported: ' + escapeHtml(insp.exportedAt) + '</p>'
      + '<div class="backup-summary-grid">'
      + '<div><span>' + s.counts.topics + '</span>Topics</div>'
      + '<div><span>' + s.counts.tasks + '</span>Tasks</div>'
      + '<div><span>' + s.counts.targets + '</span>Targets</div>'
      + '<div><span>' + s.counts.journalEntries + '</span>Journal</div>'
      + '<div><span>' + s.counts.alarms + '</span>Alarms</div>'
      + '<div><span>' + s.counts.sessions + '</span>Sessions</div>'
      + '<div><span>' + s.counts.photos + '</span>Photos</div>'
      + '<div><span>' + s.counts.plannerTasks + '</span>Planner tasks</div>'
      + '</div>'
      + (s.sessionDateRange ? '<p class="backup-range">Sessions: ' + escapeHtml(s.sessionDateRange.from) + ' &rarr; ' + escapeHtml(s.sessionDateRange.to) + '</p>' : '')
      + (s.journalDateRange ? '<p class="backup-range">Journal: ' + escapeHtml(s.journalDateRange.from) + ' &rarr; ' + escapeHtml(s.journalDateRange.to) + '</p>' : '')
      + warningsHtml(insp.warnings)
      + '<h4>What will change</h4>'
      + '<ul class="backup-change-list">'
      + changeLi('New topics', s.willChange.topicsAdded)
      + changeLi('New tasks', s.willChange.tasksAdded)
      + changeLi('New targets', s.willChange.targetsAdded)
      + changeLi('New subtargets', s.willChange.subtargetsAdded)
      + changeLi('New date-hub entries', s.willChange.dateHubsAdded)
      + changeLi('New journal entries', s.willChange.journalEntriesAdded)
      + changeLi('New sessions', s.willChange.sessionRecordsAdded)
      + changeLi('New breaks', s.willChange.timeEngineBreaksAdded)
      + changeLi('New daily summaries', s.willChange.dailySummariesAdded)
      + changeLi('New sleep records', s.willChange.sleepRecordsAdded)
      + changeLi('New alarms', s.willChange.generalAlarmsAdded)
      + changeLi('New notes', s.willChange.assistantNotesAdded)
      + changeLi('New EXP ledger entries', s.willChange.expLedgerAdded)
      + changeLi('New photos', s.willChange.photosAdded)
      + changeLi('New planner tasks', s.willChange.plannerTasksAdded)
      + '</ul>'
      + '<details class="backup-compare-details"><summary>Compare backup vs. current (advanced)</summary>'
      + '<table class="backup-compare-table"><thead><tr><th></th><th>Backup only</th><th>Current only</th><th>In both</th><th>Conflicts*</th></tr></thead><tbody>'
      + compareRow('Topics', c.topics) + compareRow('Tasks', c.tasks) + compareRow('Targets', c.targets)
      + compareRow('Subtargets', c.subtargets) + compareRow('Sessions', c.sessionRecords)
      + compareRow('Breaks', c.timeEngineBreaks) + compareRow('Date hub', c.dateHubs)
      + compareRow('Journal', c.journalEntries) + compareRow('Sleep', c.sleepRecords)
      + compareRow('Daily summaries', c.dailySummaries) + compareRow('Water events', c.waterEvents)
      + compareRow('Study log', c.studyLog) + compareRow('Alarms', c.generalAlarms)
      + compareRow('Notes', c.assistantNotes) + compareRow('EXP ledger', c.expLedger)
      + '</tbody></table>'
      + '<p class="backup-compare-note">*Your current data always wins on a conflict — nothing you already have will be overwritten.</p>'
      + '</details>'
      + '<p class="backup-warning">Restoring cannot be undone. Your active study session will be reset to idle.</p>'
      + '<div class="backup-modal-actions">'
      + '<button id="backup-restore-cancel-btn" class="btn-secondary">Cancel</button>'
      + '<button id="backup-restore-confirm-btn" class="backup-confirm-btn">Restore</button>'
      + '</div>'
      + '</div>';
  }

  function renderErrorHtml(message, title) {
    return '<div class="backup-modal">'
      + '<div class="backup-modal-header"><h3>' + escapeHtml(title || 'Restore Failed') + '</h3>'
      + '<button class="modal-close-btn" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p class="backup-error">' + escapeHtml(message) + '</p>'
      + '<div class="backup-modal-actions"><button id="backup-error-ok-btn" class="backup-confirm-btn">OK</button></div>'
      + '</div>';
  }

  function renderResultHtml(summary, warnings) {
    return '<div class="backup-modal">'
      + '<div class="backup-modal-header"><h3>Restore Complete</h3>'
      + '<button class="modal-close-btn" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p>Your backup has been merged in. Nothing already on this device was overwritten.</p>'
      + '<ul class="backup-change-list">'
      + changeLi('Topics added', summary.topicsAdded)
      + changeLi('Tasks added', summary.tasksAdded)
      + changeLi('Targets added', summary.targetsAdded)
      + changeLi('Subtargets added', summary.subtargetsAdded)
      + changeLi('Sessions added', summary.sessionRecordsAdded)
      + changeLi('Alarms added', summary.generalAlarmsAdded)
      + changeLi('Photos added', summary.photosAdded || 0)
      + changeLi('Planner tasks added', summary.plannerTasksAdded || 0)
      + '</ul>'
      + warningsHtml(warnings)
      + '<div class="backup-modal-actions"><button id="backup-result-ok-btn" class="backup-confirm-btn">Done</button></div>'
      + '</div>';
  }

  function bindOnce(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  }

  function showError(message, title) {
    if (typeof MiscSound !== 'undefined') MiscSound.play('uiError');
    Modal.open(renderErrorHtml(message, title));
    bindOnce('backup-modal-close-btn', 'click', Modal.close);
    bindOnce('backup-error-ok-btn', 'click', Modal.close);
  }

  function openInspectModal(insp) {
    _pendingPkg = insp.pkg;
    Modal.open(renderInspectHtml(insp));
    bindOnce('backup-modal-close-btn', 'click', function () { _pendingPkg = null; Modal.close(); });
    bindOnce('backup-restore-cancel-btn', 'click', function () { _pendingPkg = null; Modal.close(); });
    bindOnce('backup-restore-confirm-btn', 'click', onConfirmRestore);
  }

  function onConfirmRestore() {
    if (_confirmBusy || Backup.isRestoring() || !_pendingPkg) return; // double-submit guard
    _confirmBusy = true;
    const btn = document.getElementById('backup-restore-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Restoring…'; }
    const cancelBtn = document.getElementById('backup-restore-cancel-btn');
    if (cancelBtn) cancelBtn.disabled = true;

    const pkg = _pendingPkg;
    _pendingPkg = null;
    Backup.restorePackage(pkg).then(function (result) {
      _confirmBusy = false;
      if (!result.ok) { showError(result.error); return; }
      Modal.open(renderResultHtml(result.summary, result.warnings));
      bindOnce('backup-modal-close-btn', 'click', Modal.close);
      bindOnce('backup-result-ok-btn', 'click', Modal.close);
    }).catch(function () {
      _confirmBusy = false;
      showError('Restore failed unexpectedly.');
    });
  }

  function onFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // reset so selecting the same file again still fires 'change'
    if (!file) return;
    _confirmBusy = false; // a new file always starts clean
    _pendingPkg = null;
    Modal.open('<div class="backup-modal"><p>Checking backup&hellip;</p></div>');
    Backup.inspectFile(file).then(function (insp) {
      if (!insp.ok) { _pendingPkg = null; showError(insp.error); return; }
      openInspectModal(insp);
    }).catch(function () { showError("Couldn't read that file."); });
  }

  function onExportClicked() {
    if (_exportBusy) return;
    _exportBusy = true;
    Modal.open('<div class="backup-modal"><p>Creating backup&hellip;</p></div>');
    Backup.downloadExport().then(function (res) {
      if (!res.ok) { showError(res.error, 'Backup Failed'); return; }
      Modal.open(renderExportHtml(res));
      bindOnce('backup-modal-close-btn', 'click', Modal.close);
      bindOnce('backup-result-ok-btn', 'click', Modal.close);
    }).catch(function () {
      showError("The backup couldn't be created.", 'Backup Failed');
    }).then(function () { _exportBusy = false; });
  }

  let _bound = false;

  // Delegated listeners on document: they keep working even if the page re-renders the drawer buttons
  // or the hidden file input after a restore.
  function init() {
    if (_bound) return;
    _bound = true;
    document.addEventListener('click', function (e) {
      const t = e.target && e.target.closest ? e.target.closest('#backup-export-btn, #backup-restore-btn') : null;
      if (!t) return;
      if (t.id === 'backup-export-btn') { onExportClicked(); return; }
      const input = document.getElementById('backup-restore-file-input');
      if (input) input.click();
    });
    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'backup-restore-file-input') onFileSelected(e);
    });
  }

  return { init: init };
})();
