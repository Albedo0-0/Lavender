// backup-ui.js — Utility-drawer UI for Backup/Restore (Feature 14). Depends on: Backup, Modal,
// State. Load after backup.js and modal.js. Owns no data of its own — pure UI glue over Backup's
// inspectBackup()/restoreFromJson(). Stays inside the existing utility drawer; no new top-level
// navigation screen.
const BackupUI = (function () {
  let _pendingJsonText = null;
  let _confirmBusy = false;

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function changeLi(label, n) {
    return '<li>' + label + ': <strong>' + n + '</strong></li>';
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
      + '<button class="backup-modal-close" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p class="backup-modal-meta">Backup exported: ' + escapeHtml(insp.exportedAt) + '</p>'
      + '<div class="backup-summary-grid">'
      + '<div><span>' + s.counts.topics + '</span>Topics</div>'
      + '<div><span>' + s.counts.tasks + '</span>Tasks</div>'
      + '<div><span>' + s.counts.targets + '</span>Targets</div>'
      + '<div><span>' + s.counts.journalEntries + '</span>Journal</div>'
      + '<div><span>' + s.counts.alarms + '</span>Alarms</div>'
      + '<div><span>' + s.counts.sessions + '</span>Sessions</div>'
      + '</div>'
      + (s.sessionDateRange ? '<p class="backup-range">Sessions: ' + escapeHtml(s.sessionDateRange.from) + ' &rarr; ' + escapeHtml(s.sessionDateRange.to) + '</p>' : '')
      + (s.journalDateRange ? '<p class="backup-range">Journal: ' + escapeHtml(s.journalDateRange.from) + ' &rarr; ' + escapeHtml(s.journalDateRange.to) + '</p>' : '')
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
      + '<button id="backup-restore-cancel-btn">Cancel</button>'
      + '<button id="backup-restore-confirm-btn" class="backup-confirm-btn">Restore</button>'
      + '</div>'
      + '</div>';
  }

  function renderErrorHtml(message) {
    return '<div class="backup-modal">'
      + '<div class="backup-modal-header"><h3>Restore Failed</h3>'
      + '<button class="backup-modal-close" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p class="backup-error">' + escapeHtml(message) + '</p>'
      + '<div class="backup-modal-actions"><button id="backup-error-ok-btn" class="backup-confirm-btn">OK</button></div>'
      + '</div>';
  }

  function renderResultHtml(summary) {
    return '<div class="backup-modal">'
      + '<div class="backup-modal-header"><h3>Restore Complete</h3>'
      + '<button class="backup-modal-close" id="backup-modal-close-btn" aria-label="Close">&#10006;</button></div>'
      + '<p>Your backup has been merged in. Nothing already on this device was overwritten.</p>'
      + '<ul class="backup-change-list">'
      + changeLi('Topics added', summary.topicsAdded)
      + changeLi('Tasks added', summary.tasksAdded)
      + changeLi('Targets added', summary.targetsAdded)
      + changeLi('Subtargets added', summary.subtargetsAdded)
      + changeLi('Sessions added', summary.sessionRecordsAdded)
      + changeLi('Alarms added', summary.generalAlarmsAdded)
      + '</ul>'
      + '<div class="backup-modal-actions"><button id="backup-result-ok-btn" class="backup-confirm-btn">Done</button></div>'
      + '</div>';
  }

  function bindOnce(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  }

  function showError(message) {
    Modal.open(renderErrorHtml(message));
    bindOnce('backup-modal-close-btn', 'click', Modal.close);
    bindOnce('backup-error-ok-btn', 'click', Modal.close);
  }

  function openInspectModal(jsonText) {
    const insp = Backup.inspectBackup(jsonText);
    if (!insp.ok) {
      _pendingJsonText = null;
      showError(insp.error);
      return;
    }
    _pendingJsonText = jsonText;
    Modal.open(renderInspectHtml(insp));
    bindOnce('backup-modal-close-btn', 'click', function () { _pendingJsonText = null; Modal.close(); });
    bindOnce('backup-restore-cancel-btn', 'click', function () { _pendingJsonText = null; Modal.close(); });
    bindOnce('backup-restore-confirm-btn', 'click', onConfirmRestore);
  }

  function onConfirmRestore() {
    if (_confirmBusy || Backup.isRestoring() || !_pendingJsonText) return; // double-submit guard
    _confirmBusy = true;
    const btn = document.getElementById('backup-restore-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Restoring…'; }
    const cancelBtn = document.getElementById('backup-restore-cancel-btn');
    if (cancelBtn) cancelBtn.disabled = true;

    const jsonText = _pendingJsonText;
    _pendingJsonText = null;
    const result = Backup.restoreFromJson(jsonText);
    _confirmBusy = false;

    if (!result.ok) {
      showError(result.error);
      return;
    }
    Modal.open(renderResultHtml(result.summary));
    bindOnce('backup-modal-close-btn', 'click', Modal.close);
    bindOnce('backup-result-ok-btn', 'click', Modal.close);
  }

  function onFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // reset so selecting the same file again still fires 'change'
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () { openInspectModal(String(reader.result || '')); };
    reader.onerror = function () { showError("Couldn't read that file."); };
    reader.readAsText(file);
  }

  function init() {
    bindOnce('backup-export-btn', 'click', function () { Backup.downloadExport(); });
    bindOnce('backup-restore-btn', 'click', function () {
      const input = document.getElementById('backup-restore-file-input');
      if (input) input.click();
    });
    bindOnce('backup-restore-file-input', 'change', onFileSelected);
  }

  return { init: init };
})();
