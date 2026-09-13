// notepad.js — General Notepad (relocated from Assistant per Cleanup Item 10). Global utility,
// icon lives outside the tab screens like #water-icon/#sleep-icon. Same underlying data store as
// before (State.get().assistantNotes) — no new Notepad system, just a richer UI on the same records.
//
// v1.1 upgrade:
//   - Opens straight into a composer (add button) instead of a flat list.
//   - Saved notes are grouped into folders and only shown via a "Saved Notes" corner button,
//     not laid out across the main view.
//   - Each note can be either plain text or a checklist (day-to-day checklist use case included).
const Notepad = (function () {
  let currentFolder = null;   // folder currently open in the Saved Notes panel (null = folder list)
  let composerType = 'text';  // 'text' | 'checklist' — format of the note currently being composed
  let draftChecklist = [];    // in-progress checklist items while composing
  let savedPanelOpen = false; // whether the Saved Notes panel is showing over the composer
  let editingNoteId = null;   // note currently being edited in the composer (null = new note)
  let hangingPanelOpen = false;      // whether the thin hanging-folder side panel is expanded
  let hangingPanelOpenFolder = null; // which folder is expanded inside the hanging panel (null = none)
  let draftFolderNames = [];  // multiple new-folder names queued from the folder-selection flow
  let draftEditText = '';     // preserves text-note content being edited across re-renders

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }); }

  function uid() { return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

  // ---- data helpers (direct State access — assistantNotes is Notepad-owned per state.js) ----

  function getNotes() {
    return State.get().assistantNotes || {};
  }

  function saveNotes(notes) {
    State.patch === undefined ? State.set({ assistantNotes: notes }) : State.set({ assistantNotes: notes });
  }

  function getNotesArray() {
    const notes = getNotes();
    return Object.keys(notes).map(function (id) { return notes[id]; });
  }

  function getStoredFolderList() {
    return (State.get().notepadFolders || []).slice();
  }

  function saveStoredFolderList(list) {
    const unique = [];
    list.forEach(function (f) { if (f && unique.indexOf(f) === -1) unique.push(f); });
    State.set({ notepadFolders: unique });
  }

  function addFolders(names) {
    const existing = getStoredFolderList();
    names.forEach(function (n) {
      const name = String(n || '').trim();
      if (name && existing.indexOf(name) === -1) existing.push(name);
    });
    saveStoredFolderList(existing);
  }

  function getFolders() {
    const arr = getNotesArray();
    const set = {};
    getStoredFolderList().forEach(function (f) { set[f] = true; });
    arr.forEach(function (n) { set[n.folder || 'General'] = true; });
    const folders = Object.keys(set);
    if (!folders.length) folders.push('General');
    folders.sort(function (a, b) { return a.localeCompare(b); });
    return folders;
  }

  function toggleFavorite(noteId) {
    const notes = Object.assign({}, getNotes());
    const note = notes[noteId];
    if (!note) return;
    notes[noteId] = Object.assign({}, note, { favorite: !note.favorite });
    saveNotes(notes);
  }

  function addNote(record) {
    const notes = Object.assign({}, getNotes());
    notes[record.id] = record;
    saveNotes(notes);
  }

  function removeNote(id) {
    const notes = Object.assign({}, getNotes());
    delete notes[id];
    saveNotes(notes);
  }

  function toggleChecklistItem(noteId, itemId) {
    const notes = Object.assign({}, getNotes());
    const note = notes[noteId];
    if (!note || !note.checklistItems) return;
    note.checklistItems = note.checklistItems.map(function (it) {
      return it.id === itemId ? Object.assign({}, it, { done: !it.done }) : it;
    });
    notes[noteId] = Object.assign({}, note);
    saveNotes(notes);
  }

  // ---- composer (default view on open) ----

  function composerHtml() {
    const draftTextValue = editingNoteId ? (draftEditText || '') : '';
    const checklistRows = draftChecklist.map(function (item, idx) {
      return '<div class="notepad-draft-item" data-idx="' + idx + '">' +
        '<input type="text" class="notepad-draft-item-input" data-idx="' + idx + '" placeholder="Checklist item" value="' + esc(item) + '">' +
        '<button class="notepad-draft-item-remove" data-idx="' + idx + '" title="Remove item">&#10006;</button>' +
      '</div>';
    }).join('');

    const folders = getFolders();
    const folderOptions = folders.map(function (f) {
      return '<option value="' + esc(f) + '">' + esc(f) + '</option>';
    }).join('');

    const queuedFolderRows = draftFolderNames.map(function (name, idx) {
      return '<span class="notepad-queued-folder" data-idx="' + idx + '">' + esc(name) +
        ' <button class="notepad-queued-folder-remove" data-idx="' + idx + '" title="Remove">&#10006;</button></span>';
    }).join(' ');

    return '<div id="notepad-modal">' +
            '<div id="notepad-hanging-panel" style="display:' + (hangingPanelOpen ? 'block' : 'none') + '">' + hangingPanelHtml() + '</div>' +
      '<div id="notepad-top-row">' +
        '<h3>' + (editingNoteId ? 'Edit Note' : 'Notepad') + '</h3>' +
        '<button id="notepad-saved-btn" title="Saved notes">&#128193; Saved Notes</button>' +
      '</div>' +

      '<div id="notepad-format-toggle">' +
        '<button class="notepad-format-btn' + (composerType === 'text' ? ' notepad-format-active' : '') + '" data-type="text">Text</button>' +
        '<button class="notepad-format-btn' + (composerType === 'checklist' ? ' notepad-format-active' : '') + '" data-type="checklist">Checklist</button>' +
      '</div>' +

         '<div id="notepad-composer-body">' +
        (composerType === 'text'
          ? '<textarea id="notepad-note-input" placeholder="Capture anything — a note, a to-do, a thought...">' + esc(draftTextValue) + '</textarea>'
          : '<div id="notepad-checklist-draft">' +
              checklistRows +
              '<button id="notepad-add-item-btn">+ Add item</button>' +
            '</div>') +
      '</div>' +

       '<div id="notepad-composer-footer">' +
        '<label for="notepad-folder-select">Folder:</label> ' +
        '<select id="notepad-folder-select">' + folderOptions + '</select> ' +
        '<input type="text" id="notepad-new-folder-input" placeholder="New folder name">' +
        '<button id="notepad-add-folder-btn" type="button">+ Add Folder</button>' +
        '<div id="notepad-queued-folders">' + queuedFolderRows + '</div>' +
        '<br>' +
        '<button id="notepad-note-add-btn">' + (editingNoteId ? 'Save' : 'Add') + '</button>' +
      '</div>' +
    '</div>';
  }

  function renderComposer() {
    savedPanelOpen = false;
    Modal.open(composerHtml());
    attachComposerListeners();
    attachHangingPanelListeners();
  }

  function attachComposerListeners() {
    document.querySelectorAll('.notepad-format-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const textInput = document.getElementById('notepad-note-input');
        if (textInput) draftEditText = textInput.value;
        composerType = btn.dataset.type;
        if (composerType === 'checklist' && draftChecklist.length === 0) draftChecklist = [''];
        renderComposer();
      });
    });

    const savedBtn = document.getElementById('notepad-saved-btn');
    if (savedBtn) savedBtn.addEventListener('click', function () { openSavedNotes(); });

    const addFolderBtn = document.getElementById('notepad-add-folder-btn');
    if (addFolderBtn) addFolderBtn.addEventListener('click', function () {
      const input = document.getElementById('notepad-new-folder-input');
      const name = input ? input.value.trim() : '';
      if (name && draftFolderNames.indexOf(name) === -1) draftFolderNames.push(name);
      renderComposer();
    });

    document.querySelectorAll('.notepad-queued-folder-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        draftFolderNames.splice(Number(btn.dataset.idx), 1);
        renderComposer();
      });
    });

    if (composerType === 'checklist') {
      const addItemBtn = document.getElementById('notepad-add-item-btn');
      if (addItemBtn) addItemBtn.addEventListener('click', function () {
        syncDraftFromInputs();
        draftChecklist.push('');
        renderComposer();
      });
      document.querySelectorAll('.notepad-draft-item-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          syncDraftFromInputs();
          draftChecklist.splice(Number(btn.dataset.idx), 1);
          if (!draftChecklist.length) draftChecklist = [''];
          renderComposer();
        });
      });
    }

    const addBtn = document.getElementById('notepad-note-add-btn');
    if (addBtn) addBtn.addEventListener('click', handleAddNote);
  }

  function syncDraftFromInputs() {
    document.querySelectorAll('.notepad-draft-item-input').forEach(function (input) {
      draftChecklist[Number(input.dataset.idx)] = input.value;
    });
  }

  function resolveFolder() {
    if (draftFolderNames.length) addFolders(draftFolderNames);

    const newFolderInput = document.getElementById('notepad-new-folder-input');
    const newFolderVal = newFolderInput ? newFolderInput.value.trim() : '';
    if (newFolderVal) {
      addFolders([newFolderVal]);
      draftFolderNames = [];
      return newFolderVal;
    }

    const chosen = draftFolderNames.length ? draftFolderNames[draftFolderNames.length - 1] : null;
    draftFolderNames = [];
    if (chosen) return chosen;

    const select = document.getElementById('notepad-folder-select');
    return (select && select.value) ? select.value : 'General';
  }

  function handleAddNote() {
    const folder = resolveFolder();
    const existing = editingNoteId ? getNotes()[editingNoteId] : null;

    if (composerType === 'text') {
      const input = document.getElementById('notepad-note-input');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      addNote({
        id: existing ? existing.id : uid(),
        text: text,
        createdAt: existing ? existing.createdAt : Date.now(),
        promotedToTaskId: existing ? existing.promotedToTaskId : null,
        favorite: existing ? !!existing.favorite : false,
        folder: folder,
        type: 'text',
        checklistItems: []
      });
    } else {
      syncDraftFromInputs();
      const items = draftChecklist
        .map(function (t) { return t.trim(); })
        .filter(function (t) { return t.length; })
        .map(function (t) { return { id: uid(), text: t, done: false }; });
      if (!items.length) return;
      addNote({
        id: existing ? existing.id : uid(),
        text: '',
        createdAt: existing ? existing.createdAt : Date.now(),
        promotedToTaskId: existing ? existing.promotedToTaskId : null,
        favorite: existing ? !!existing.favorite : false,
        folder: folder,
        type: 'checklist',
        checklistItems: items
      });
    }

    editingNoteId = null;
    draftEditText = '';
    draftChecklist = [];
    composerType = 'text';
    renderComposer();
  }

  function beginEditNote(noteId) {
    const note = getNotes()[noteId];
    if (!note) return;
    editingNoteId = noteId;
    composerType = note.type === 'checklist' ? 'checklist' : 'text';
    draftEditText = note.text || '';
    draftChecklist = note.type === 'checklist'
      ? (note.checklistItems || []).map(function (it) { return it.text; })
      : [];
    if (composerType === 'checklist' && !draftChecklist.length) draftChecklist = [''];
    hangingPanelOpen = false;
    renderComposer();
  }

   // ---- hanging-folder thin side panel (lives inside the composer modal) ----

  function hangingPanelHtml() {
    const folders = getFolders();
    const notes = getNotesArray();

    const folderBlocks = folders.map(function (f) {
      const isOpen = hangingPanelOpenFolder === f;
      const folderNotes = notes.filter(function (n) { return (n.folder || 'General') === f; });
      const noteRows = isOpen ? folderNotes.map(function (n) {
        const label = n.type === 'checklist' ? ('(checklist) ' + (n.checklistItems || []).length + ' items') : n.text;
        return '<div class="notepad-hanging-note-row" data-id="' + n.id + '">' +
          '<span class="notepad-hanging-note-label">' + esc(label) + '</span>' +
          '<button class="notepad-hanging-edit-btn" data-id="' + n.id + '" title="Edit">&#9999;&#65039;</button>' +
          '<button class="notepad-hanging-delete-btn" data-id="' + n.id + '" title="Delete">&#128465;&#65039;</button>' +
        '</div>';
      }).join('') : '';

      return '<div class="notepad-hanging-folder-block">' +
        '<button class="notepad-hanging-folder-btn" data-folder="' + esc(f) + '">' + esc(f) + '</button>' +
        (isOpen ? '<div class="notepad-hanging-folder-notes">' + (noteRows || '<span class="notepad-hanging-empty">No notes</span>') + '</div>' : '') +
      '</div>';
    }).join('');

    return '<div id="notepad-hanging-panel-inner">' + folderBlocks + '</div>';
  }

  function attachHangingPanelListeners() {
    const tabBtn = document.getElementById('notepad-hanging-tab-btn');
    if (tabBtn) tabBtn.addEventListener('click', function () {
      hangingPanelOpen = !hangingPanelOpen;
      renderComposer();
    });

    document.querySelectorAll('.notepad-hanging-folder-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const f = btn.dataset.folder;
        hangingPanelOpenFolder = (hangingPanelOpenFolder === f) ? null : f;
        renderComposer();
      });
    });

    document.querySelectorAll('.notepad-hanging-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        beginEditNote(btn.dataset.id);
      });
    });

    document.querySelectorAll('.notepad-hanging-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeNote(btn.dataset.id);
        renderComposer();
      });
    });
  }

  // ---- saved notes panel (folders -> notes list, reached only via the corner button) ----

  function savedFoldersHtml() {
    const folders = getFolders();
    const notes = getNotesArray();
    const rows = folders.map(function (f) {
      const count = notes.filter(function (n) { return (n.folder || 'General') === f; }).length;
      return '<button class="notepad-folder-row" data-folder="' + esc(f) + '">' +
        '<span class="notepad-folder-name">&#128193; ' + esc(f) + '</span>' +
        '<span class="notepad-folder-count">' + count + '</span>' +
      '</button>';
    }).join('');

    return '<div id="notepad-modal">' +
      '<div id="notepad-top-row">' +
        '<button id="notepad-back-btn" title="Back to composer">&#8592; Back</button>' +
        '<h3>Saved Notes</h3>' +
      '</div>' +
      '<div id="notepad-folder-list">' + (rows || '<p>No folders yet.</p>') + '</div>' +
    '</div>';
  }

  function savedFolderNotesHtml(folder) {
    const notes = getNotesArray().filter(function (n) { return (n.folder || 'General') === folder; });
    notes.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    const rows = notes.length ? notes.map(function (n) {
      if (n.type === 'checklist') {
        const items = (n.checklistItems || []).map(function (it) {
          return '<div class="notepad-checklist-view-item">' +
            '<label>' +
              '<input type="checkbox" class="notepad-checklist-toggle" data-note-id="' + n.id + '" data-item-id="' + it.id + '"' + (it.done ? ' checked' : '') + '>' +
              '<span class="' + (it.done ? 'notepad-checklist-done' : '') + '">' + esc(it.text) + '</span>' +
            '</label>' +
          '</div>';
        }).join('');
         return '<div class="assistant-note-row" data-id="' + n.id + '">' +
          '<div class="notepad-checklist-view">' + items + '</div>' +
          '<button class="notepad-favorite-btn' + (n.favorite ? ' notepad-favorite-active' : '') + '" data-id="' + n.id + '" title="Favourite">&#11088;</button>' +
          '<button class="assistant-note-delete-btn" data-id="' + n.id + '">Delete</button>' +
        '</div>';
      }
      return '<div class="assistant-note-row" data-id="' + n.id + '">' +
        '<span class="assistant-note-text">' + esc(n.text) + '</span> ' +
        '<button class="notepad-favorite-btn' + (n.favorite ? ' notepad-favorite-active' : '') + '" data-id="' + n.id + '" title="Favourite">&#11088;</button>' +
        '<button class="assistant-note-delete-btn" data-id="' + n.id + '">Delete</button>' +
      '</div>';
    }).join('') : '<p>No notes in this folder yet.</p>';

    return '<div id="notepad-modal">' +
      '<div id="notepad-top-row">' +
        '<button id="notepad-folders-back-btn" title="Back to folders">&#8592; Folders</button>' +
        '<h3>' + esc(folder) + '</h3>' +
      '</div>' +
      '<div id="notepad-folder-notes">' + rows + '</div>' +
    '</div>';
  }

  function openSavedNotes() {
    savedPanelOpen = true;
    currentFolder = null;
    Modal.open(savedFoldersHtml());
    attachSavedFoldersListeners();
  }

  function attachSavedFoldersListeners() {
    const backBtn = document.getElementById('notepad-back-btn');
    if (backBtn) backBtn.addEventListener('click', renderComposer);

    document.querySelectorAll('.notepad-folder-row').forEach(function (btn) {
      btn.addEventListener('click', function () { openFolder(btn.dataset.folder); });
    });
  }

  function openFolder(folder) {
    currentFolder = folder;
    Modal.open(savedFolderNotesHtml(folder));
    attachFolderNotesListeners(folder);
  }

  function attachFolderNotesListeners(folder) {
    const backBtn = document.getElementById('notepad-folders-back-btn');
    if (backBtn) backBtn.addEventListener('click', openSavedNotes);

    document.querySelectorAll('.assistant-note-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeNote(btn.dataset.id);
        openFolder(folder);
      });
    });

    document.querySelectorAll('.notepad-checklist-toggle').forEach(function (cb) {
      cb.addEventListener('change', function () {
        toggleChecklistItem(cb.dataset.noteId, cb.dataset.itemId);
        openFolder(folder);
      });
    });

    document.querySelectorAll('.notepad-favorite-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleFavorite(btn.dataset.id);
        openFolder(folder);
      });
    });
  }

  // ---- entry points ----

  function open() {
    draftChecklist = [];
    composerType = 'text';
    editingNoteId = null;
    draftEditText = '';
    draftFolderNames = [];
    hangingPanelOpenFolder = null;
    renderComposer();
  }

  function handleIconClick() { open(); }

  function init() {
    const btn = document.getElementById('notepad-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
  }

  return { init: init, open: open };
})();
