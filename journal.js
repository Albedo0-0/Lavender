// journal.js — date-based diary: text, mood, energy. Only today's entry is editable. Loaded after planner.js, before nav.js.

const Journal = (function () {
  const MOODS = ['😢', '😕', '😐', '🙂', '😄'];
  let viewDate; // 'YYYY-MM-DD' string, currently viewed day

  function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getEntry(dateStr) {
    return State.get().journalEntries.find(function (e) { return e.date === dateStr; });
  }

  function ensureEntry(dateStr) {
    let entry = getEntry(dateStr);
    if (entry) return entry;
    entry = { id: makeId('jrnl'), date: dateStr, text: '', mood: null, energy: 3, photoIds: [], updatedAt: Date.now() };
    State.set({ journalEntries: State.get().journalEntries.concat([entry]) });
    return entry;
  }

  function updateEntry(dateStr, partial) {
    const entry = ensureEntry(dateStr);
    const entries = State.get().journalEntries.map(function (e) {
      if (e.id === entry.id) return Object.assign({}, e, partial, { updatedAt: Date.now() });
      return e;
    });
    State.set({ journalEntries: entries });
  }

  function addPhoto(dateStr, dataUrl) {
    const entry = ensureEntry(dateStr);
    const photoId = makeId('photo');
    return Storage.saveMedia(photoId, dataUrl).then(function () {
      updateEntry(dateStr, { photoIds: entry.photoIds.concat([photoId]) });
      return photoId;
    });
  }

  function removePhoto(dateStr, photoId) {
    const entry = getEntry(dateStr);
    if (!entry) return Promise.resolve();
    return Storage.deleteMedia(photoId).then(function () {
      updateEntry(dateStr, { photoIds: entry.photoIds.filter(function (id) { return id !== photoId; }) });
    });
  }

  // --- Rendering ---

  function render() {
    const root = document.getElementById('screen-journal');
    if (!root) return;
    if (!viewDate) viewDate = Planner.formatDate(new Date());
    root.innerHTML = '';

    root.appendChild(buildHeader());
    root.appendChild(buildEntryForm());
    root.appendChild(buildPhotoSection());
  }

  function buildHeader() {
    const header = document.createElement('div');
    header.className = 'journal-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', function () {
      viewDate = Planner.formatDate(new Date(Planner.parseDate(viewDate).setDate(Planner.parseDate(viewDate).getDate() - 1)));
      render();
    });

    const label = document.createElement('span');
    label.className = 'journal-date-label';
    label.textContent = viewDate;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '›';
    nextBtn.addEventListener('click', function () {
      viewDate = Planner.formatDate(new Date(Planner.parseDate(viewDate).setDate(Planner.parseDate(viewDate).getDate() + 1)));
      render();
    });

    header.appendChild(prevBtn);
    header.appendChild(label);
    header.appendChild(nextBtn);
    return header;
  }

  function buildEntryForm() {
    const entry = getEntry(viewDate) || { text: '', mood: null, energy: 3 };
    const wrap = document.createElement('div');
    wrap.className = 'journal-entry-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'journal-textarea';
    textarea.placeholder = 'How was today?';
    textarea.value = entry.text || '';
    let saveTimer = null;
    textarea.addEventListener('input', function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        updateEntry(viewDate, { text: textarea.value });
      }, 400);
    });
    wrap.appendChild(textarea);

    const moodRow = document.createElement('div');
    moodRow.className = 'journal-mood-row';
    MOODS.forEach(function (mood) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = mood;
      btn.className = 'mood-btn' + (entry.mood === mood ? ' selected' : '');
      btn.addEventListener('click', function () {
        updateEntry(viewDate, { mood: mood });
        render();
      });
      moodRow.appendChild(btn);
    });
    wrap.appendChild(moodRow);

    const energyRow = document.createElement('div');
    energyRow.className = 'journal-energy-row';
    const energyLabel = document.createElement('label');
    energyLabel.textContent = 'Energy: ';
    const energyInput = document.createElement('input');
    energyInput.type = 'range';
    energyInput.min = '1';
    energyInput.max = '5';
    energyInput.value = entry.energy || 3;
    const energyValue = document.createElement('span');
    energyValue.textContent = energyInput.value;
    energyInput.addEventListener('input', function () {
      energyValue.textContent = energyInput.value;
    });
    energyInput.addEventListener('change', function () {
      updateEntry(viewDate, { energy: Number(energyInput.value) });
    });
    energyLabel.appendChild(energyInput);
    energyRow.appendChild(energyLabel);
    energyRow.appendChild(energyValue);
    wrap.appendChild(energyRow);

    return wrap;
  }

  function buildPhotoSection() {
    const entry = getEntry(viewDate);
    const wrap = document.createElement('div');
    wrap.className = 'journal-photo-section';

    const heading = document.createElement('h4');
    heading.textContent = 'Photos';
    wrap.appendChild(heading);

    const gallery = document.createElement('div');
    gallery.className = 'journal-photo-gallery';
    wrap.appendChild(gallery);

    if (entry && entry.photoIds.length > 0) {
      entry.photoIds.forEach(function (photoId) {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'journal-photo-thumb';
        Storage.loadMedia(photoId).then(function (dataUrl) {
          if (!dataUrl) return;
          const img = document.createElement('img');
          img.src = dataUrl;
          thumbWrap.appendChild(img);
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '✕';
        delBtn.className = 'photo-delete-btn';
        delBtn.addEventListener('click', function () {
          removePhoto(viewDate, photoId).then(render);
        });
        thumbWrap.appendChild(delBtn);
        gallery.appendChild(thumbWrap);
      });
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.addEventListener('change', function () {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        addPhoto(viewDate, reader.result).then(render);
      };
      reader.readAsDataURL(file);
    });
    wrap.appendChild(fileInput);

    return wrap;
  }

  function init() {
    render();
  }

  return { init: init, render: render, getEntry: getEntry };
})();

