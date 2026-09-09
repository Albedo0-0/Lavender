// notepad.js — General Notepad (relocated from Assistant per Cleanup Item 10). Global utility,
// icon lives outside the tab screens like #water-icon/#sleep-icon. Same data store as before
// (AssistantData.getNotes/addNote/removeNote) — no new Notepad system, just a new home for the UI.
const Notepad = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }); }

  function notepadHtml() {
    const notes = AssistantData.getNotes();
    const rows = notes.length ? notes.map(function (n) {
      return '<div class="assistant-note-row" data-id="' + n.id + '">' +
        '<span class="assistant-note-text">' + esc(n.text) + '</span> ' +
        '<button class="assistant-note-delete-btn" data-id="' + n.id + '">Delete</button>' +
      '</div>';
    }).join('') : '<p>No notes yet.</p>';

    return '<h3>Notepad</h3>' +
      '<textarea id="assistant-note-input" placeholder="Capture anything — a note, a to-do, a thought..."></textarea><br>' +
      '<button id="assistant-note-add-btn">Add</button><br><br>' + rows;
  }

  function open() {
    Modal.open(notepadHtml());
    document.getElementById('assistant-note-add-btn').addEventListener('click', function () {
      const input = document.getElementById('assistant-note-input');
      AssistantData.addNote(input.value);
      open();
    });
    document.querySelectorAll('.assistant-note-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { AssistantData.removeNote(btn.dataset.id); open(); });
    });
  }

  function handleIconClick() { open(); }

  function init() {
    const btn = document.getElementById('notepad-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
  }

  return { init: init, open: open };
})();
