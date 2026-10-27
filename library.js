// library.js — Library screen: single home for the topic collection (Cleanup Item 1).
// Depends on: State, PlanData, Modal, Planner, Nav. Topic-scoped Links live here (Cleanup Item 4).

const Library = (function () {
  let view = 'subjects'; // 'subjects' | 'chapters' | 'chapter'
  let activeSubject = null;
  let activeTopicId = null;
  let sortMode = 'alpha'; // 'focus' | 'new' | 'alpha' (view state only; the subject list stays canonical in PlanData)
  let searchQuery = ''; // one search value shared by the subject view and the topic view
  let searchOpen = false;
  let chapterBackView = 'chapters'; // where the chapter view's Back button should return to
  let selectedFilterTagIds = [];
  function todayStr() {
    const t = new Date();
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }

  function toggleFavoriteTopic(topicId) {
    const favs = State.get().favoriteTopics || [];
    const idx = favs.indexOf(topicId);
    const updated = idx === -1 ? favs.concat([topicId]) : favs.filter(function (id) { return id !== topicId; });
    State.set({ favoriteTopics: updated });
  }

  function render() {
    const container = document.getElementById('library-body');
    if (!container) return;
    if (view === 'chapters') renderChapters(container);
    else if (view === 'chapter') renderChapter(container);
    else renderSubjects(container);
  }

  function showView(nextView) {
    if (nextView !== view) { searchQuery = ''; searchOpen = false; }
    view = nextView;
    render();
  }

  function openSubject(subject) {
    activeSubject = subject;
    activeTopicId = null;
    searchQuery = '';
    searchOpen = false;
    showView('chapters');
  }
  
  const SORT_NAMES = { focus: 'Least focused subject', 'new': 'Newly added', alpha: 'Alphabetical' };
  const SORT_LABELS = { focus: 'Least focused', 'new': 'Newest', alpha: 'A\u2013Z' };

  // Read-only task counts for a chapter, derived from the existing Planner tasks (nothing stored).
  function topicCounts(topicId) {
    let total = 0, done = 0;
    PlanData.getTasksForTopic(topicId).forEach(function (t) {
      if (t.archived) return;
      total++;
      if (t.completed) done++;
    });
    return { total: total, done: done };
  }

  // ---------- Subject pixel-art icons ----------
  // Eight hand-built 24x24 sprites. Each row is "frameA|frameB": one palette letter per pixel, '.' is
  // transparent. Frame B differs from frame A only where the sprite idles (a leaf sways, a bubble
  // rises, a cursor blinks...). Pixels that never change are drawn once; the two changing sets are
  // toggled with a stepped visibility animation, so edges stay crisp and nothing is ever scaled.
  const ICON_PALETTE = {
    o: '#3f2f21', w: '#fffdf8',
    c: '#f3eedf', C: '#d9c4a3', k: '#a9865a', K: '#7a5c3e',
    G: '#cfe8b0', H: '#8fb86a', I: '#5f8a4a', J: '#3f6a3a',
    B: '#e1eef6', N: '#9cc0dc', M: '#5f8fbd', L: '#3f6a96', D: '#243f5c',
    P: '#e6dff2', Q: '#b5a4d1', R: '#8a74b4', S: '#655388',
    T: '#f4c2b4', U: '#d9735d', V: '#a84f44',
    Y: '#fbe9a8', Z: '#e8c35e', X: '#c4963a'
  };
  const ICON_SIZE = 24;
  const ICONS = [
    { id: 'biology', label: 'Biology' },
    { id: 'physics', label: 'Physics' },
    { id: 'chemistry', label: 'Chemistry' },
    { id: 'math', label: 'Mathematics' },
    { id: 'book', label: 'Reading' },
    { id: 'computer', label: 'Computing' },
    { id: 'globe', label: 'World' },
    { id: 'notebook', label: 'Notes' }
  ];
  const ICON_DEFAULT = 'book';
  const ICON_ROWS = {
    biology: [
      '........................|........................',
      '........................|...........oooooo.......',
      '...........oooooo.......|..........oGoGGGGoo.....',
      '..........oGoGGGGoo.....|........oooGGoGGHHHo....',
      '........oooGGoGGHHHo....|......ooGoGGHoJJHHHHo...',
      '......ooGoGGHoJJHHHHo...|.....oGGGoGHHoHHJJIIIo..',
      '.....oGGGoGHHoHHJJIIIo..|....oGGHHHoHHoHHHJJIIo..',
      '....oGGHHHoHHoHHHJJIIo..|...oGGHHJJoHo.oHIIIJJo..',
      '...oGGHHJJoHoooHIIIJJo..|..oGGHJJIIooIo.ooIIIIo..',
      '..oGGHJJIIooIo.ooIIIIo..|..oHHJIIIooHIo...oooo...',
      '..oHHJIIIooHIo...oooo...|...oJIIoo.oHIo..........',
      '...oJIIoo.oHIo..........|....ooo...oHIo..........',
      '....ooo...oHIo..........|..........oHIo..........',
      '.......ooooHIoooo.......|.......ooooHIoooo.......',
      '.....ooKkkoHIokKKoo.....|.....ooKkkoHIokKKoo.....',
      '....oTTTTTTooTTTTVVo....|....oTTTTTTooTTTTVVo....',
      '....oUUUUUUUUUUUUVVo....|....oUUUUUUUUUUUUVVo....',
      '.....oUTVVVVVVVVVVo.....|.....oUTVVVVVVVVVVo.....',
      '.....oTTUUUUUUUUVVo.....|.....oTTUUUUUUUUVVo.....',
      '......oTTUUUUUUVVo......|......oTTUUUUUUVVo......',
      '......oTUUUUUUUVVo......|......oTUUUUUUUVVo......',
      '.......oTUUUUUVVo.......|.......oTUUUUUVVo.......',
      '........oooooooo........|........oooooooo........',
      '........................|........................'
    ],
    physics: [
      '........................|........................',
      '..........NNNN..........|..........NNNN..........',
      '..........NNNN..........|..........NNNN..........',
      '.........NNNNNN.........|.........NNNNNN.........',
      '.........N....N.........|.........N....N.........',
      '...NNNNNNN....NNNNMMM...|...NNNNNNN....NNNNMMM...',
      '...NNN..NNN..NNN..MMM...|...NNN..NNN..NNN..MMM...',
      '...NN...N..NN..oo..MM...|...NN...N..NN..N...MM...',
      '...NN...NNoooooYZo.MM...|...NN...NNooooNM...MM...',
      '...NN...NoTTTUoZXo.MM...|...NN...NoTTTUoM...MM...',
      '....NN.NoTwTUUVoo.MM....|....NN.NoTwTUUVoM.MM....',
      '.....NN.oTTUUVVo.MM.....|.....NN.oTTUUVVooMM.....',
      '.....NN.oTUUVVVo.MM.....|.....NN.oTUUVVoYZoM.....',
      '....NN.NoUUVVVVoM.MM....|....NN.NoUUVVVoZXoMM....',
      '...NN...NoVVVVoM...MM...|...NN...NoVVVVooo..MM...',
      '...NN...MMooooMM...MM...|...NN...MMooooMM...MM...',
      '...NN.ooM..MM..M..ooM...|...Noo..M..MM..oo..MM...',
      '...NNoYZoMM..MMM.oYZo...|...oYZo.MMM..MoYZoMMM...',
      '...NNoZXoM....MMMoZXo...|...oZXoMMM....oZXoMMM...',
      '......oo.M....M...oo....|....oo...M....Moo.......',
      '.........MMMMMM.........|.........MMMMMM.........',
      '..........MMMM..........|..........MMMM..........',
      '..........MMMM..........|..........MMMM..........',
      '........................|........................'
    ],
    chemistry: [
      '..........oooo..........|..........oooo..........',
      '.........oCCCCo.........|.........oCCCCo.........',
      '.........okkKKo.........|.........okkKKo.........',
      '........oBooooBo........|........oBooooBo........',
      '.........oBBBBo.........|.........oBBBBo.........',
      '.........oBwBBo.........|.........oBwBBo.........',
      '.........oBwBBo.........|.........oBwBBo.........',
      '.........oBwBBo.........|.........oBwBBo.........',
      '.........oBwBBo.........|.........oBwBBo.........',
      '.........oBwBBo.........|.........oBwBBo.........',
      '........oBwBBBBo........|........oBwBBBBo........',
      '.......oBBwBBBBBo.......|.......oBBwBwBBBo.......',
      '.......oBBwBBBBBo.......|.......oBBwBBBBBo.......',
      '......oBBwBBwBBBBo......|......oBBwBBBBBBBo......',
      '......oBBwBBBBBBBo......|......oBBwBBBBBBBo......',
      '.....oPPPPPPPPPPPPo.....|.....oPPPPPPPPPPPPo.....',
      '.....oQQRRRRRRRSSSo.....|.....oQQRRRRRRPSSSo.....',
      '....oQQRRRRRRRPRSSSo....|....oQQRRRPRRRRRSSSo....',
      '...oQQRRRRPRRRRRRSSSo...|...oQQRRRRRRRRRRRSSSo...',
      '...oQQRRRRRRRRRRRSSSo...|...oQQRRRRRRRRRRRSSSo...',
      '..oQQRRRRRRRRRRRRRSSSo..|..oQQRRRRRRRRRRRRRSSSo..',
      '...oooooooooooooooooo...|...oooooooooooooooooo...',
      '........................|........................',
      '........................|........................'
    ],
    math: [
      '........................|........................',
      '........................|........................',
      '...oo...................|...oo...................',
      '..oBBo..................|..oBBo..................',
      '..oBMMo.................|..oBMMo.................',
      '..oBBLMoo...............|..oBBLMoo...............',
      '..oBBNNMMo..............|..oBwNNMMo..............',
      '..oBBLNNMMo.............|..oBwLNNMMo.............',
      '..oBBNNNNMMoo...........|..oBBNNNNMMoo...........',
      '..oBBLNooNNMMo..........|..oBBLNooNNMMo..........',
      '..oBBNNo.oNNMMo.........|..oBBNNo.oNNMMo.........',
      '..oBBLNo..ooNMMo........|..oBBLNo..ooNMMo........',
      '..oBBNNo....oNMMo.......|..oBBNNo....oNMMo.......',
      '..oBBLNooooooooMMoo.....|..oBBLNooooooooMMoo.....',
      '..oBBNNNNNNNNNNNNMMo....|..oBBNNNNNNNNNNNNMMo....',
      '..oooooooooooooooooooo..|..oooooooooooooooooooo..',
      '.oYYYYYYYYYYYYYYYYYYYYo.|.oYYYYYYYYYYYYYYYYYYYYo.',
      '.oZZKZKZKZKZKZKZKZKZKZo.|.oZZKZKZKZKZKZKZKwKZKZo.',
      '.oZZKZZZKZZZKZZZKZZZKZo.|.oZZKZZZKZZZKZZZKZZZKZo.',
      '.oZZKZZZKZZZKZZZKZZZKZo.|.oZZKZZZKZZZKZZZKZZZKZo.',
      '.oXXXXXXXXXXXXXXXXXXXXo.|.oXXXXXXXXXXXXXXXXXXXXo.',
      '..oooooooooooooooooooo..|..oooooooooooooooooooo..',
      '........................|........................',
      '........................|........................'
    ],
    book: [
      '........................|........................',
      '........................|........................',
      '........................|........................',
      '........................|........................',
      '..oooooooooooooooooooo..|..oooooooooooooooooooo..',
      '.occccccccCkkCcccccccco.|.occccccccCkkCcccoooooo.',
      '.occccccccCkkCcccccccco.|.occccccccCkkCcccccccco.',
      '.occCCCCCcCkkCcBBBBBcco.|.occCCCCCcCkkCcBBBBBcco.',
      '.occccccccCkkCcNNNNNcco.|.occccccccCkkCcNNNNNcco.',
      '.occCCCCCcCkkCcMMMMMcco.|.occCCCCCcCkkCcMMMMMcco.',
      '.occccccccCkkCcccccccco.|.occccccccCkkCcccccccco.',
      '.occCCCCCcCkkCcCCCCCcco.|.occCCCCCcCkkCcCCCCCcco.',
      '.occccccccCkkCcccccccco.|.occccccccCkkCcccccccco.',
      '.occCCCCCcCkkCcCCCCCcco.|.occCCCCCcCkkCcCCCCCcco.',
      '.occccccccCkkCcccccccco.|.occccccccCkkCcccccccco.',
      '.occccccccCkkCcccccccco.|.occccccccCkkCcccccccco.',
      '.oCCCCCCCCCooCCCCCCCCCo.|.oCCCCCCCCCooCCCCCCCCCo.',
      'oHoooooooooUUoooooooooHo|oHoooooooooUUoooooooooHo',
      'oIIIIIIIIIoUUoIIIIIIIIIo|oIIIIIIIIIoUUoIIIIIIIIIo',
      'oIIIIIIIIIoUUoIIIIIIIIIo|oIIIIIIIIIoUUoIIIIIIIIIo',
      'oJJJJJJJJJoUUoJJJJJJJJJo|oJJJJJJJJJoUUoJJJJJJJJJo',
      '.ooooooooooUUoooooooooo.|.ooooooooooUUoooooooooo.',
      '...........oVo..........|...........oVo..........',
      '............o...........|............o...........'
    ],
    computer: [
      '........................|........................',
      '........................|........................',
      '...oooooooooooooooooo...|...oooooooooooooooooo...',
      '..okkkkkkkkkkkkkkkkkko..|..okkkkkkkkkkkkkkkkkko..',
      '..oKKKKKKKKKKKKKKKKKKo..|..oKKKKKKKKKKKKKKKKKKo..',
      '..oKKDDDDDDDDDDDDDDKKo..|..oKKDDDDDDDDDDDDDDKKo..',
      '..oKKDDDDDDDDDDDDMDKKo..|..oKKDDDDDDDDDDDDMDKKo..',
      '..oKKDZZHHDNNDDDDMDKKo..|..oKKDZZHHDNNDDDDMDKKo..',
      '..oKKDDDDDDDDDDDDDDKKo..|..oKKDDDDDDDDDDDDDDKKo..',
      '..oKKDGDNNNNNDUUDDDKKo..|..oKKDGDNNNNNDUUDDDKKo..',
      '..oKKDDDDDDDDDDDDDDKKo..|..oKKDDDDDDDDDDDDDDKKo..',
      '..oKKDGGDDDDDDDDDDDKKo..|..oKKDDDDDDDDDDDDDDKKo..',
      '..oKKDDDDDDDDDDDDDDKKo..|..oKKDDDDDDDDDDDDDDKKo..',
      '..oKKKKKKKKKKKKKKKKKKo..|..oKKKKKKKKKKKKKKKKKKo..',
      '.oooooooooooooooooooooo.|.oooooooooooooooooooooo.',
      'occcccccckkkkkkcccccccco|occcccccckkkkkkcccccccco',
      'oCCKCKCKCKCKCKCKCKCKCCCo|oCCKCKCKCKCKCKCKCKCKCCCo',
      'oCCCCCCCCkkkkkkCCCCCCCCo|oCCCCCCCCkkkkkkCCCCCCCCo',
      'oCCKCKCKCKCKCKCKCKCKCCCo|oCCKCKCKCKCKCKCKCKCKCCCo',
      'okkkkkkkkkkkkkkkkkkkkkko|okkkkkkkkkkkkkkkkkkkkkko',
      '.oooooooooooooooooooooo.|.oooooooooooooooooooooo.',
      '........................|........................',
      '........................|........................',
      '........................|........................'
    ],
    globe: [
      '........................|........................',
      '.........ooooo..........|.........ooooo..........',
      '.......ooNNNNNoo........|.......ooNNNNNoo........',
      '......oNNNNGGHNMo.......|......oNNGGGNNNMo.......',
      '.....oNNNNGGHHHMMo......|.....oNNGGGGHNMMMo......',
      '....oGGwNGGHHHHHMMo.....|....oNNwGGGHHHMMMHo.....',
      '...oGGGGNNHHHHHHHHHo....|...oGGNNGGHHHHHHHHHo....',
      '...oGGGGHNNHHHHHHHMo....|...oGGGNNHHHHHHHMHHo....',
      '..oGGGGHHMMMHHHHHHHMo...|..oGGGGNNMHHHHHHHMMMo...',
      '..oNGGHHHMMMMHHHHHILo...|..oGGGHNMMMHHHHHHMLLo...',
      '..oNNHHHHHMMMHHHIIIIo...|..oGGHHHMMMHHHHHIILIo...',
      '..oNNNHHHHMMMMMMIIIIo...|..oNHHHHMMMMMMHIIIIIo...',
      '..oNNMHHHHHMHHILIIIIo...|..oNHHHHHMHHHMIIIIIIo...',
      '...oMMMHHHMMHIILIIIo....|...oMHHHMMHHHMIIIIIo....',
      '...oMMMHHHMMIIILLIIo....|...oMHHHMMHHILLIIILo....',
      '....oMMMMMMLLLLLLLo.....|....oMMMMMMLLLLLILo.....',
      '.....oMMMMLLLLLLLo......|.....oMMMMLLLLLLLo......',
      '......oMMLLLLLLLo.......|......oMMLLLLLLLo.......',
      '.......ooLLLLLoo........|.......ooLLLLLoo........',
      '.......oCoooooCCo.......|.......oCoooooCCo.......',
      '.......okkkkkkkko.......|.......okkkkkkkko.......',
      '.......okkkkkkkko.......|.......okkkkkkkko.......',
      '........oooooooo........|........oooooooo........',
      '........................|........................'
    ],
    notebook: [
      '........................|........................',
      '........................|........................',
      '....oooooooooooooo......|....oooooooooooooo......',
      '...oQQQQQQQQQQQQSSo.....|...oQQQQQQQQQQQQSSo.....',
      '..oNBooRRRRRRRRRSSo.....|..oNBooRRRRRRRRRSSo.....',
      '...oQQRRRRRRRRRRSSo.....|...oQQRRRRRRRRRRSSo.....',
      '...oQQRRRRRRRRRRSSo.....|...oQQRRRRRRRRRRSSo.....',
      '..oNBooRRRRRRRRRSSooo...|..oNBooRRRRRRRRRSSo.....',
      '...oQQRRwwwwwwwwSSoTTo..|...oQQRRwwwwwwwwSSoo....',
      '...oQQRRccccccccSSoTUo..|...oQQRRccccccccSoTTo...',
      '..oNBooRcCCCCCccSoNNXo..|..oNBooRcCCCCCccSoTUo...',
      '...oQQRRccccccccoYZXo...|...oQQRRccccccccoNNXo...',
      '...oQQRRcCCCCCcoYZXo....|...oQQRRcCCCCCcoYZXo....',
      '..oNBooRccccccoYZXo.....|..oNBooRccccccoYZXo.....',
      '...oQQRRCCCCCoYZXoo.....|...oQQRRCCCCCoYZXoo.....',
      '...oQQRRRRRRoYZXoSo.....|...oQQRRRRRRoYZXoSo.....',
      '..oNBooRRRRoYZXoSSo.....|..oNBooRRRRoYZXoSSo.....',
      '...oQQRRRRoYZXoRSSo.....|...oQQRRRRoYZXoRSSo.....',
      '...oQQRRRoYZXoRRSSo.....|...oQQRRRoYZXoRRSSo.....',
      '..oNBooRoYZXoRRRSSo.....|..oNBooRoYZXoRRRSSo.....',
      '...oSSSoCCooSSSSSSo.....|...oSSSoYZXoSSSSSSo.....',
      '....ooooKCoooooooo......|....oooCCooooooooo......',
      '........oo..............|......oKCo..............',
      '........................|.......oo...............'
    ]
  };

  const iconSvgCache = {};

  // Merge horizontal runs of one colour into a single path (small markup, hard edges).
  function runsPath(pixels) {
    // pixels: { colourLetter: [[x, y], ...] } already sorted by y then x
    return Object.keys(pixels).map(function (c) {
      const pts = pixels[c];
      let d = '';
      let i = 0;
      while (i < pts.length) {
        const x = pts[i][0], y = pts[i][1];
        let w = 1;
        while (i + w < pts.length && pts[i + w][1] === y && pts[i + w][0] === x + w) w++;
        d += 'M' + x + ' ' + y + 'h' + w + 'v1h-' + w + 'z';
        i += w;
      }
      return '<path fill="' + ICON_PALETTE[c] + '" d="' + d + '"/>';
    }).join('');
  }

  function iconSvg(id) {
    if (iconSvgCache[id]) return iconSvgCache[id];
    const rows = ICON_ROWS[id] || ICON_ROWS[ICON_DEFAULT];
    const fixed = {}, onlyA = {}, onlyB = {};
    function add(map, c, x, y) { (map[c] || (map[c] = [])).push([x, y]); }
    let animated = false;
    rows.forEach(function (row, y) {
      const parts = row.split('|');
      for (let x = 0; x < ICON_SIZE; x++) {
        const a = parts[0].charAt(x), b = parts[1].charAt(x);
        if (a === b) { if (a !== '.') add(fixed, a, x, y); continue; }
        animated = true;
        if (a !== '.') add(onlyA, a, x, y);
        if (b !== '.') add(onlyB, b, x, y);
      }
    });
    const svg = '<svg class="px-icon" viewBox="0 0 ' + ICON_SIZE + ' ' + ICON_SIZE + '" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
      runsPath(fixed) +
      (animated ? '<g class="px-f1">' + runsPath(onlyA) + '</g><g class="px-f2">' + runsPath(onlyB) + '</g>' : '') +
      '</svg>';
    iconSvgCache[id] = svg;
    return svg;
  }

  // ---------- Control icons ----------
  // Twenty-four-pixel sprites for the Library's own tools and the topic menu, built in the same palette and
  // hard-edged, bevel-shaded style as the subject icons. Single frame, one palette letter per pixel, shown at
  // whole multiples of the grid (24 / 48) so no pixel is ever scaled unevenly.
  const TOOL_SIZE = 24;
  const TOOL_ROWS = {
    // magnifier
    search: [
      '........................',
      '......oooooooo..........',
      '.....oQQQQQQQSo.........',
      '....oQRRRRRRRRSo........',
      '...oQRRooooooRRSo.......',
      '..oQRRoNwNNNNoRRSo......',
      '.oQRRoNwNNNNNNoRRSo.....',
      '.oQRoNwNNNNNNNNoRSo.....',
      '.oQRoNwNNNNNNNNoRSo.....',
      '.oQRoNNNNNNNNNNoRSo.....',
      '.oQRoNNNNNNNNNNoRSo.....',
      '.oQRoNNNNNNNNNNoRSo.....',
      '.oQRoNNNNNNNNNNoRSo.....',
      '.oSRRoNNNNNNNNoRRSo.....',
      '..oSRRoNNNNNNoRRoo......',
      '...oSRRooooooRRokKo.....',
      '....oSRRRRRRRRokkkKo....',
      '.....oSSSSSSSSoKkkkKo...',
      '......oooooooo.oKkkkKo..',
      '................oKkkkKo.',
      '.................oKkkKo.',
      '..................oKKo..',
      '...................oo...',
      '........................'
    ],
    // sort arrows
    sort: [
      '........................',
      '.......o................',
      '......oSo......ooo......',
      '.....oQRSo....oBBMo.....',
      '.....oQRSo....oBNMo.....',
      '....oQRRRSo...oBNMo.....',
      '...oQRRRRRSo..oBNMo.....',
      '..oQRRRRRRRSo.oBNMo.....',
      '..oSSSRRRSSSo.oBNMo.....',
      '...oooQRSooo..oBNMo.....',
      '.....oQRSo....oBNMo.....',
      '.....oQRSo....oBNMo.....',
      '.....oQRSo....oBNMo.....',
      '.....oQRSo.ooooBNMoooo..',
      '.....oQRSooMBBBNNNBBBMo.',
      '.....oQRSo.oBNNNNNNNMo..',
      '.....oQRSo.oMNNNNNNNMo..',
      '.....oQRSo..oMNNNNNMo...',
      '.....oQRSo...oMNNNMo....',
      '.....oQRSo....oBNMo.....',
      '.....oSSSo....oMNMo.....',
      '......ooo......oMo......',
      '................o.......',
      '........................'
    ],
    // add
    plus: [
      '........................',
      '.........oooooo.........',
      '........oQQQQQSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '..oooooooQRRRRSooooooo..',
      '.oQQQQQQQRRRRRRQQQQQQSo.',
      '.oQRRRRRRRRRRRRRRRRRRSo.',
      '.oQRRRRRRRRRRRRRRRRRRSo.',
      '.oQRRRRRRRRRRRRRRRRRRSo.',
      '.oQRRRRRRRRRRRRRRRRRRSo.',
      '.oSSSSSSSRRRRRRSSSSSSSo.',
      '..oooooooQRRRRSooooooo..',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oQRRRRSo........',
      '........oSSSSSSo........',
      '.........oooooo.........',
      '........................'
    ],
    // more
    more: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '...oo......oo......oo...',
      '..oQSo....oQSo....oQSo..',
      '.oQRRSo..oQRRSo..oQRRSo.',
      'oQRRRRSooQRRRRSooQRRRRSo',
      'oSRRRRSooSRRRRSooSRRRRSo',
      '.oSRRSo..oSRRSo..oSRRSo.',
      '..oSSo....oSSo....oSSo..',
      '...oo......oo......oo...',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................'
    ],
    // back
    back: [
      '........................',
      '...............o........',
      '..............oSo.......',
      '.............oQRSo......',
      '............oQRRRSo.....',
      '...........oQRRRRRSo....',
      '..........oQRRRRRRSo....',
      '.........oQRRRRRRSo.....',
      '........oQRRRRRRSo......',
      '.......oQRRRRRRSo.......',
      '......oQRRRRRRSo........',
      '.....oQRRRRRRSo.........',
      '.....oSRRRRRRSo.........',
      '......oSRRRRRRSo........',
      '.......oSRRRRRRSo.......',
      '........oSRRRRRRSo......',
      '.........oSRRRRRRSo.....',
      '..........oSRRRRRRSo....',
      '...........oSRRRRRSo....',
      '............oSRRRSo.....',
      '.............oSRSo......',
      '..............oSo.......',
      '...............o........',
      '........................'
    ],
    // favourite on
    starOn: [
      '........................',
      '........................',
      '...........oo...........',
      '..........oYXo..........',
      '..........oYXo..........',
      '..........oYXo..........',
      '.........oYZZXo.........',
      '.........oYZZXo.........',
      '..oooooooYZZZZXooooooo..',
      '.oXYYYYYYZZZZZZYYYYYYXo.',
      '..oXZZZZZZZZZZZZZZZZXo..',
      '...oXZZZZZZZZZZZZZZXo...',
      '....oXXZZZZZZZZZZXXo....',
      '.....ooYZZZZZZZZXoo.....',
      '......oYZZZZZZZZXo......',
      '......oYZZZZZZZZXo......',
      '......oYZZZZZZZZXo......',
      '......oYZZZXXZZZXo......',
      '.....oYZZXXooXXZZXo.....',
      '.....oYXXoo..ooXXXo.....',
      '.....oXoo......ooXo.....',
      '......o..........o......',
      '........................',
      '........................'
    ],
    // favourite off
    starOff: [
      '........................',
      '........................',
      '...........oo...........',
      '..........owCo..........',
      '..........owCo..........',
      '..........owCo..........',
      '.........owccCo.........',
      '.........owccCo.........',
      '..ooooooowccccCooooooo..',
      '.oCwwwwwwccccccwwwwwwCo.',
      '..oCccccccccccccccccCo..',
      '...oCccccccccccccccCo...',
      '....oCCccccccccccCCo....',
      '.....oowccccccccCoo.....',
      '......owccccccccCo......',
      '......owccccccccCo......',
      '......owccccccccCo......',
      '......owcccCCcccCo......',
      '.....owccCCooCCccCo.....',
      '.....owCCoo..ooCCCo.....',
      '.....oCoo......ooCo.....',
      '......o..........o......',
      '........................',
      '........................'
    ],
    // plan
    calendar: [
      '......oo........oo......',
      '.....okKo......okKo.....',
      '.....okKo......okKo.....',
      '..ooookKooooooookKoooo..',
      '.oQQQQooQQQQQQQQooQQQSo.',
      '.oQRRRooRRRRRRRRooRRRSo.',
      '.oQRRRRRRRRRRRRRRRRRRSo.',
      '.oQRRRRRRRRRRRRRRRRRRSo.',
      '.oooooooooooooooooooooo.',
      '.owccccccccccccccccccCo.',
      '.owccccccccccccccccccCo.',
      '.owcccckcccckcccckcccCo.',
      '.owcccCkcccCkcccCkcccCo.',
      '.owcckkkcckkkcckkkcccCo.',
      '.owccccccccccccccccccCo.',
      '.owccccccccccccccccccCo.',
      '.owcccckcccckccTTVcccCo.',
      '.owcccCkcccCkccTUVcccCo.',
      '.owcckkkcckkkccVVVcccCo.',
      '.owccccccccccccccccccCo.',
      '.owccccccccccccccccccCo.',
      '.oCCCCCCCCCCCCCCCCCCCCo.',
      '..oooooooooooooooooooo..',
      '........................'
    ],
    // details
    page: [
      '........................',
      '....oooooooooo..........',
      '...owwwwwwwwwCo.........',
      '...owcccccccccoo........',
      '...owcccccccccoko.......',
      '...owcccccccccoCko......',
      '...owcccccccccooooo.....',
      '...owcccccccccccccCo....',
      '...owcccccccccccccCo....',
      '...owcccccccccccccCo....',
      '...owccRRRRRRRRRScCo....',
      '...owccSSSSSSSSSScCo....',
      '...owcccccccccccccCo....',
      '...owcccccccccccccCo....',
      '...owccRRRRRRRRRScCo....',
      '...owccSSSSSSSSSScCo....',
      '...owcccccccccccccCo....',
      '...owcccccccccccccCo....',
      '...owccRRRRRRSccccCo....',
      '...owccSSSSSSSccccCo....',
      '...owcccccccccccccCo....',
      '...oCCCCCCCCCCCCCCCo....',
      '....ooooooooooooooo.....',
      '........................'
    ],
    // links
    link: [
      '........................',
      '....ooooo...............',
      '...oQQQQSo..............',
      '..oQRRSRRSo.............',
      '.oQRRSoSRRSo............',
      '.oQRSo.oSRRSo...........',
      '.oQSo...oSRRSo..........',
      '.oQRSo...oSRRSo.........',
      '.oSRRSo...oSRSo.........',
      '..oSRRSo...oQSooo.......',
      '...oSRRSo.oQRoBBMo......',
      '....oSRRSoQRRoMNNMo.....',
      '.....oSRRQRRoMoMNNMo....',
      '......oSSSooMo.oMNNMo...',
      '.......oooBMo...oMNNMo..',
      '.........oBNMo...oMNNMo.',
      '.........oMNNMo...oMNMo.',
      '..........oMNNMo...oBMo.',
      '...........oMNNMo.oBNMo.',
      '............oMNNMoBNNMo.',
      '.............oMNNBNNMo..',
      '..............oMMMMMo...',
      '...............ooooo....',
      '........................'
    ],
    // rename
    pencil: [
      '........................',
      '.................oo.....',
      '................oTVo....',
      '...............oTUUVo...',
      '..............ooUUUUVo..',
      '.............owMoUUUUVo.',
      '............oXoNMoUUUVo.',
      '...........oYZXoNMoUVo..',
      '..........oYZZZXoNMoo...',
      '.........oYZZZZZXoMo....',
      '........oYZZZZZZZXo.....',
      '.......oYZZZZZZZXo......',
      '......oYZZZZZZZXo.......',
      '.....oYZZZZZZZXo........',
      '....ooZZZZZZZXo.........',
      '....oKoZZZZZXo..........',
      '...oCkKoZZZXo...........',
      '...oCkkKoZXo............',
      '...oCkkkKoo.............',
      '...oKKKKoo..............',
      '..oKoooo................',
      '...o....................',
      '........................',
      '........................'
    ],
    // colour
    palette: [
      '........................',
      '........................',
      '........................',
      '........oooooooo........',
      '......ooCCCCCCCKoo......',
      '....ooCCooookkooGIoo....',
      '...oCCkkoZZZokoHHoCKo...',
      '..oCkkkkoZZZokoHHokkKo..',
      '..oCkkkkooookkooookkKo..',
      '.oCkkoookkkkkkkkkkoooKo.',
      '.oCkoUUUokkkkkkkkoNNNoo.',
      '.oCkoUUUokkkkkkkkoNNNoo.',
      '.oCkoUUUokkkkkkkkoNNoKo.',
      '.oCkkoookkkkkkkKKKoooKo.',
      '.oCkkkkkkkkkkkKoooKkkKo.',
      '.oKkkkkkkkkkkKo...oCkKo.',
      '..oCkkkkkkkkkKo...oCKo..',
      '..oKkkkkkkkkkkKoooCkKo..',
      '...oKKkkkkkkkkkCCCKKo...',
      '....ooKKkkkkkkkkKKoo....',
      '......ooKKKKKKKKoo......',
      '........oooooooo........',
      '........................',
      '........................'
    ],
    // tags
    tag: [
      '........................',
      '..ooooooooo.............',
      '.oGGGGGGGGIo............',
      '.oGHHHHHHHHIo...........',
      '.oGHHIIIHHHHIo..........',
      '.oGHIoooGHHHHIo.........',
      '.oGHIo.oGHHHHHIo........',
      '.oGHIoooGHHHHHHIo.......',
      '.oGHHGGGHHHHHHHHIo......',
      '.oGHHHHHHHHHHHHHHIo.....',
      '.oGHHHHHHHHHHHHHHHIo....',
      '.oIHHHHHHHHHHHHHHHHIo...',
      '..oIHHHHHHHHHHHHHHHHIo..',
      '...oIHHHHHHHHHHHHHHHIo..',
      '....oIHHHHHHHHHHHHHIo...',
      '.....oIHHHHHHHHHHHIo....',
      '......oIHHHHHHHHHIo.....',
      '.......oIHHHHHHHIo......',
      '........oIHHHHHIo.......',
      '.........oIHHHIo........',
      '..........oIHIo.........',
      '...........oIo..........',
      '............o...........',
      '........................'
    ],
    // remove
    trash: [
      '........................',
      '.........oooooo.........',
      '........occcccko........',
      '........ocCCCCko........',
      '...ooooookkkkkkoooooo...',
      '..occccccoooooocccccko..',
      '..ocCCCCCCCCCCCCCCCCko..',
      '..okkoooooooooooookkko..',
      '...ooTTTTTTTTTTTTVooo...',
      '....oTUUUUUUUUUUUVo.....',
      '....oTUUUUUUUUUUUVo.....',
      '....oTUUUVUUUUVUUVo.....',
      '....oTUUUVUUUUVUUVo.....',
      '....oTUUUVUUUUVUUVo.....',
      '....oVUUUVUUUUVUUVo.....',
      '.....oTUUVUUUUVUVo......',
      '.....oTUUVUUUUVUVo......',
      '.....oTUUVUUUUVUVo......',
      '.....oTUUVUUUUVUVo......',
      '.....oTUUVUUUUVUVo......',
      '.....oTUUUUUUUUUVo......',
      '.....oVVVVVVVVVVVo......',
      '......ooooooooooo.......',
      '........................'
    ]
  };
  const toolSvgCache = {};

  // Soft pastel of a topic colour (hex mixed toward white) for the whole topic strip; null when unusable.
  function topicTint(color) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    function mix(k, amount) {
      const v = parseInt(h.substr(k * 2, 2), 16);
      return Math.round(v * (1 - amount) + 255 * amount);
    }
    function hex(amount) {
      return '#' + [0, 1, 2].map(function (k) { return ('0' + mix(k, amount).toString(16)).slice(-2); }).join('');
    }
    return { fill: hex(0.8), edge: hex(0.55) };
  }

  function toolIcon(id) {
    if (toolSvgCache[id]) return toolSvgCache[id];
    const rows = TOOL_ROWS[id];
    if (!rows) return '';
    const px = {};
    rows.forEach(function (row, y) {
      for (let x = 0; x < TOOL_SIZE; x++) {
        const c = row.charAt(x);
        if (c !== '.') (px[c] || (px[c] = [])).push([x, y]);
      }
    });
    const svg = '<svg class="px-tool" viewBox="0 0 ' + TOOL_SIZE + ' ' + TOOL_SIZE + '" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' + runsPath(px) + '</svg>';
    toolSvgCache[id] = svg;
    return svg;
  }

  // Search field shared by the subject view and the topic view (same input id, same shared searchQuery).
  function searchFieldHtml(placeholder) {
    return '<div class="library-search-field">' +
      '<span class="library-search-glyph" aria-hidden="true">' + toolIcon('search') + '</span>' +
      '<input type="text" id="library-search" class="input" placeholder="' + esc(placeholder) + '" value="' + esc(searchQuery) + '">' +
    '</div>';
  }

  function isIconId(id) {
    return ICONS.some(function (ic) { return ic.id === id; });
  }

  // The chosen icon lives in State next to the other subject-keyed Library data, keyed by subject name,
  // so it needs no new store and survives sorting, search and reloads. Renames move it (see afterSubjectChange).
  function getSavedIcon(subject) {
    const id = (State.get().subjectIcons || {})[subject];
    return isIconId(id) ? id : null;
  }

  function saveSubjectIcon(subject, id) {
    const map = Object.assign({}, State.get().subjectIcons || {});
    if (id && isIconId(id)) map[subject] = id; else delete map[subject];
    State.set({ subjectIcons: map });
  }

  // Subjects created before icons existed keep a sensible picture, inferred from the name.
  function inferIcon(subject) {
    const n = String(subject || '').toLowerCase();
    if (/phys/.test(n)) return 'physics';
    if (/chem/.test(n)) return 'chemistry';
    if (/bio|life/.test(n)) return 'biology';
    if (/math|algebra|calc|geom|stat/.test(n)) return 'math';
    if (/comput|\bcs\b|code|program|inform|\bit\b/.test(n)) return 'computer';
    if (/hist|geog|social|civic|polit|econ/.test(n)) return 'globe';
    if (/revis|note/.test(n)) return 'notebook';
    return ICON_DEFAULT;
  }

  function resolveIcon(subject) {
    return getSavedIcon(subject) || inferIcon(subject);
  }

  function subjectArt(subject) {
    return iconSvg(resolveIcon(subject));
  }

  // Selectable icon grid shared by "New subject" and "Change icon". Tapping the chosen icon again clears it.
  function iconPickerHtml(selectedId) {
    return '<div class="library-field-label" id="library-icon-label">Icon</div>' +
      '<div class="library-icon-picker" role="radiogroup" aria-labelledby="library-icon-label">' +
      ICONS.map(function (ic) {
        const on = ic.id === selectedId;
        return '<button type="button" class="library-icon-opt' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" data-icon="' + ic.id + '" title="' + esc(ic.label) + '" aria-label="' + esc(ic.label) + '">' + iconSvg(ic.id) + '</button>';
      }).join('') +
      '</div>';
  }

  function bindIconPicker(selectedId) {
    let current = selectedId || null;
    const opts = document.querySelectorAll('#modal-content .library-icon-opt');
    function paint() {
      opts.forEach(function (b) {
        const on = b.dataset.icon === current;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    opts.forEach(function (b) {
      b.addEventListener('click', function () {
        current = current === b.dataset.icon ? null : b.dataset.icon;
        paint();
      });
    });
    return { get: function () { return current; } };
  }

  // Focus = actual study time (TimeEngine session records) grouped by the subject of the task each
  // session belonged to. Read-only derivation, nothing stored. TimeEngine keeps per-session detail
  // only for its retention window (older days are rolled into subject-less daily summaries), so this
  // reflects recent focus. Standalone stopwatch/timer records have no task and are not counted.
  function getSubjectFocusMs() {
    const recs = State.get().sessionRecords || {};
    const out = {};
    Object.keys(recs).forEach(function (id) {
      const r = recs[id];
      if (!r || !r.taskId || !r.studyMs) return;
            const task = PlanningAgent.getTask(r.taskId);
      if (!task || !task.subject) return;
      out[task.subject] = (out[task.subject] || 0) + r.studyMs;
    });
    return out;
  }

  // The ONE ordering of the canonical subject list (PlanData.getAllSubjects) used by the subject
  // collection. getAllSubjects() is in the order subjects were added.
  function getSortedSubjects() {
    const base = PlanData.getAllSubjects();
    const order = {};
    base.forEach(function (s, i) { order[s] = i; });
    const list = base.slice();
    if (sortMode === 'alpha') {
      list.sort(function (a, b) { return a.localeCompare(b); });
    } else if (sortMode === 'new') {
      list.sort(function (a, b) { return order[b] - order[a]; });
    } else {
      const focus = getSubjectFocusMs();
      list.sort(function (a, b) { return ((focus[a] || 0) - (focus[b] || 0)) || a.localeCompare(b); });
    }
    return list;
  }

  function getSubjectStats() {
    const due = {};
        PlanningAgent.getTodayTasks().concat(PlanningAgent.getPendingTasks()).forEach(function (t) {
      if (t.subject) due[t.subject] = (due[t.subject] || 0) + 1;
    });
    return { grouped: PlanData.getTopicsBySubject(), due: due };
  }

  // Compact overflow / action sheet built on the shared Modal (no second popup system).
  function openMenu(title, items) {
    Modal.open(
      '<h3 class="section-heading">' + esc(title) + '</h3>' +
      '<div class="library-menu">' + items.map(function (it, i) {
        return '<button class="library-menu-item btn ' + (it.danger ? 'btn-danger' : 'btn-secondary') + '" data-idx="' + i + '">' +
          (it.icon ? '<span class="library-menu-glyph">' + toolIcon(it.icon) + '</span>' : '') +
          '<span class="library-menu-label">' + esc(it.label) + '</span></button>';
      }).join('') + '</div>',
      { size: 'sm' }
    );
    document.querySelectorAll('#modal-content .library-menu-item').forEach(function (b) {
      b.addEventListener('click', function () {
        const item = items[Number(b.dataset.idx)];
        Modal.close();
        if (item) item.run();
      });
    });
  }

  function afterSubjectChange(renamed, removed) {
    if (renamed) {
      const saved = getSavedIcon(renamed.from);
      if (saved) { saveSubjectIcon(renamed.from, null); saveSubjectIcon(renamed.to, saved); }
    }
    if (renamed && typeof UnrecordedStudy !== 'undefined' && UnrecordedStudy.renameTestSubject) UnrecordedStudy.renameTestSubject(renamed.from, renamed.to); // keep stored test subject names in step
    if (typeof Planner !== 'undefined' && Planner.refreshSubjectOptions) Planner.refreshSubjectOptions(renamed);
    if (renamed && activeSubject === renamed.from) activeSubject = renamed.to;
    if (removed && activeSubject === removed && view !== 'subjects') { view = 'subjects'; activeTopicId = null; }
    render();
  }

  function openAddSubjectModal() {
    Modal.open(
      '<h3 class="section-heading">New subject</h3>' +
      '<input type="text" id="library-add-subject-input" class="input" placeholder="Subject name" maxlength="40">' +
      iconPickerHtml(null) +
      '<p id="library-add-subject-error" class="planner-empty" style="display:none;"></p>' +
      '<button id="library-add-subject-confirm" class="btn btn-primary">Add</button>' +
      '<button id="library-add-subject-cancel" class="btn btn-secondary">Cancel</button>',
      { size: 'sm' }
    );
    const input = document.getElementById('library-add-subject-input');
    const errEl = document.getElementById('library-add-subject-error');
    if (!input) return;
    const picker = bindIconPicker(null);
    function confirmAdd() {
      const result = PlanData.addSubject(input.value);
      if (!result.ok) { errEl.textContent = result.error; errEl.style.display = 'block'; return; }
      const chosen = picker.get();
      if (chosen) saveSubjectIcon(result.subject || input.value.trim(), chosen);
      Modal.close();
      afterSubjectChange();
    }
    document.getElementById('library-add-subject-confirm').addEventListener('click', confirmAdd);
    document.getElementById('library-add-subject-cancel').addEventListener('click', function () { Modal.close(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmAdd(); });
    input.focus();
  }

  function openRenameSubject(subject) {
    Modal.open(
      '<h3 class="section-heading">Rename subject</h3>' +
      '<p>Current name: <strong>' + esc(subject) + '</strong>. Its chapters, tasks and history move to the new name.</p>' +
      '<input type="text" id="library-rename-subject-input" class="input" maxlength="40" value="' + esc(subject) + '">' +
      '<p id="library-rename-subject-error" class="planner-empty" style="display:none;"></p>' +
      '<button id="library-rename-subject-confirm" class="btn btn-primary">Rename</button>' +
      '<button id="library-rename-subject-cancel" class="btn btn-secondary">Cancel</button>'
    );
    const input = document.getElementById('library-rename-subject-input');
    const errEl = document.getElementById('library-rename-subject-error');
    if (!input) return;
    function confirmRename() {
      const result = PlanData.renameSubject(subject, input.value);
      if (!result.ok) { errEl.textContent = result.error; errEl.style.display = 'block'; return; }
      Modal.close();
      afterSubjectChange(result.unchanged ? null : { from: subject, to: result.subject });
    }
    document.getElementById('library-rename-subject-confirm').addEventListener('click', confirmRename);
    document.getElementById('library-rename-subject-cancel').addEventListener('click', function () { Modal.close(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') confirmRename(); });
    input.focus();
    input.select();
  }

  function openIconModal(subject) {
    Modal.open(
      '<h3 class="section-heading">Icon for ' + esc(subject) + '</h3>' +
      iconPickerHtml(resolveIcon(subject)) +
      '<button id="library-icon-save" class="btn btn-primary">Save</button>' +
      '<button id="library-icon-cancel" class="btn btn-secondary">Cancel</button>',
      { size: 'sm' }
    );
    const saveBtn = document.getElementById('library-icon-save');
    if (!saveBtn) return;
    const picker = bindIconPicker(resolveIcon(subject));
    saveBtn.addEventListener('click', function () {
      saveSubjectIcon(subject, picker.get());
      Modal.close();
      render();
    });
    document.getElementById('library-icon-cancel').addEventListener('click', function () { Modal.close(); });
  }

  function openDeleteSubject(subject) {
    const usage = PlanData.getSubjectUsage(subject);
    const kept = (usage.topics || usage.tasks)
      ? ' Its ' + usage.topics + ' chapter(s) and ' + usage.tasks + ' task(s) stay as history and remain visible under Removed subjects.'
      : '';
    Modal.open(
      '<h3 class="section-heading">Delete subject "' + esc(subject) + '"?</h3>' +
      '<p>It will no longer be offered for new tasks, sessions or itinerary items.' + kept + ' Add it again later to pick that history back up.</p>' +
      '<button id="library-delete-subject-confirm" class="btn btn-danger">Delete</button>' +
      '<button id="library-delete-subject-cancel" class="btn btn-secondary">Cancel</button>'
    );
    const confirmBtn = document.getElementById('library-delete-subject-confirm');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('click', function () {
      PlanData.removeSubject(subject);
      Modal.close();
      afterSubjectChange(null, subject);
    });
    document.getElementById('library-delete-subject-cancel').addEventListener('click', function () { Modal.close(); });
  }

  function openSubjectMenu(subject, includeOpen) {
    const items = [];
    if (includeOpen) items.push({ icon: 'page', label: 'Open', run: function () { openSubject(subject); } });
    items.push({ icon: 'palette', label: 'Change icon', run: function () { openIconModal(subject); } });
    items.push({ icon: 'pencil', label: 'Rename', run: function () { openRenameSubject(subject); } });
    items.push({ icon: 'trash', label: 'Delete', danger: true, run: function () { openDeleteSubject(subject); } });
    openMenu(subject, items);
  }

  // Planning new work always goes through the central Planning Agent UI.
  // chapterId === topicId, so the Library's topic is passed straight through as topicId.
  function openPlan(subject, topicId) {
    if (typeof Modal.isLocked === 'function' && Modal.isLocked()) return;
        if (typeof PlanningAgent === 'undefined' || !PlanningAgent.open) return;
    const ctx = { intent: 'topic' };
    if (subject) ctx.subjectId = subject;
    if (topicId) ctx.topicId = topicId;
    PlanningAgent.open(ctx);
  }

  function openChapterFrom(subject, topicId, backView) {
    activeSubject = subject;
    activeTopicId = topicId;
    chapterBackView = backView;
    showView('chapter');
  }

  // Subject-level filtering reuses the same shared searchQuery as the topic view (DOM filter, no re-render).
  function applySubjectFilters(container) {
    const q = searchQuery.trim().toLowerCase();
    let tilesShown = 0;
    let resultsShown = 0;
    container.querySelectorAll('.library-tile').forEach(function (tile) {
      const match = !q || tile.dataset.name.indexOf(q) !== -1 || tile.dataset.topics.indexOf(q) !== -1;
      tile.style.display = match ? '' : 'none';
      if (match) tilesShown++;
    });
    container.querySelectorAll('.library-result-row').forEach(function (row) {
      const match = !!q && row.dataset.q.indexOf(q) !== -1;
      row.style.display = match ? '' : 'none';
      if (match) resultsShown++;
    });
    const favs = container.querySelector('.planner-history-favorites');
    if (favs) favs.style.display = q ? 'none' : '';
    const addTile = container.querySelector('.library-add-tile');
    if (addTile) addTile.style.display = q ? 'none' : '';
    const results = container.querySelector('#library-topic-results');
    if (results) results.style.display = resultsShown ? '' : 'none';
    const empty = container.querySelector('#library-search-empty');
    if (empty) empty.style.display = (q && !tilesShown && !resultsShown) ? '' : 'none';
  }

  function renderSubjects(container) {
    const favIds = State.get().favoriteTopics || [];
    const allTopics = PlanData.getAllTopics();
    const favTopics = favIds.map(function (id) { return allTopics[id]; }).filter(Boolean);
    const subjects = getSortedSubjects();
    const stats = getSubjectStats();
    const removed = PlanData.getHistoricalSubjects();
    const searchVisible = searchOpen || !!searchQuery;

    let html = '<div class="library-header">' +
        '<h4 class="library-header-title section-heading">My Subjects</h4>' +
        '<div class="library-header-actions">' +
          '<button id="library-search-toggle" class="library-icon-btn' + (searchVisible ? ' active' : '') + '" title="Search" aria-label="Search">' + toolIcon('search') + '</button>' +
          '<button id="library-sort-btn" class="library-icon-btn" title="Sort: ' + esc(SORT_NAMES[sortMode]) + '" aria-label="Sort subjects">' + toolIcon('sort') + '<span class="library-sort-caption">' + esc(SORT_LABELS[sortMode]) + '</span></button>' +
          '<button id="library-add-subject-btn" class="library-icon-btn" title="Add subject" aria-label="Add subject">' + toolIcon('plus') + '</button>' +
          '<button id="library-more-btn" class="library-icon-btn" title="More" aria-label="More options">' + toolIcon('more') + '</button>' +
        '</div>' +
      '</div>' +
      '<div id="library-search-row" class="library-search-row"' + (searchVisible ? '' : ' style="display:none;"') + '>' +
        searchFieldHtml('Search subjects and topics...') +
      '</div>';

    if (favTopics.length > 0) {
      html += '<div class="planner-history-favorites">' + favTopics.map(function (t) {
        return '<button class="planner-history-fav-btn" data-subject="' + esc(t.subject) + '" data-topic-id="' + t.topicId + '" title="Favorite topic"><span class="library-fav-glyph">' + toolIcon('starOn') + '</span>' + esc(t.subject) + ' \u00B7 ' + esc(t.topicName) + '</button>';
      }).join('') + '</div>';
    }

    if (subjects.length === 0) {
      html += '<p class="planner-empty empty-state">No subjects yet. Tap + to add one.</p>';
    } else {
      html += '<div class="library-grid" id="library-subject-grid">' + subjects.map(function (s, i) {
        const topics = stats.grouped[s] || [];
        const due = stats.due[s] || 0;
        return '<div class="library-tile" data-name="' + esc(s.toLowerCase()) + '" data-topics="' + esc(topics.map(function (t) { return t.topicName.toLowerCase(); }).join('|')) + '">' +
          '<button class="library-tile-open" data-subject="' + esc(s) + '">' +
            '<span class="library-tile-art px-play" style="--px-i:' + (i % 8) + ';">' + subjectArt(s) + '</span>' +
            '<span class="library-tile-name">' + esc(s) + '</span>' +
            '<span class="library-tile-meta">' +
              '<span>' + topics.length + (topics.length === 1 ? ' chapter' : ' chapters') + '</span>' +
              (due ? '<span class="library-tile-due">' + due + ' due</span>' : '') +
            '</span>' +
          '</button>' +
          '<button class="library-more-btn library-tile-more" data-subject="' + esc(s) + '" title="Subject options" aria-label="Options for ' + esc(s) + '">' + toolIcon('more') + '</button>' +
        '</div>';
      }).join('') +
        '<button class="library-add-tile" type="button" aria-label="Add subject">' +
          '<span class="library-add-tile-plus" aria-hidden="true">' + toolIcon('plus') + '</span>' +
          '<span class="library-add-tile-title">Add subject</span>' +
        '</button>' +
      '</div>';

      const resultRows = [];
      subjects.forEach(function (s) {
        (stats.grouped[s] || []).forEach(function (t) {
          resultRows.push('<button class="library-result-row list-row" style="display:none;" data-subject="' + esc(s) + '" data-topic-id="' + t.topicId + '" data-q="' + esc((s + ' ' + t.topicName).toLowerCase()) + '">' + esc(s) + ' \u00B7 ' + esc(t.topicName) + '</button>');
        });
      });
      html += '<div id="library-topic-results" style="display:none;">' +
        '<div class="planner-suggested-group-title section-heading">Topics</div>' +
        '<div class="list-row-group">' + resultRows.join('') + '</div>' +
      '</div>' +
      '<p id="library-search-empty" class="planner-empty empty-state" style="display:none;">No matching subjects or topics.</p>';
    }

    container.innerHTML = html;

    const searchRow = document.getElementById('library-search-row');
    const searchInput = document.getElementById('library-search');
    const searchToggle = document.getElementById('library-search-toggle');
    searchToggle.addEventListener('click', function () {
      const showing = searchRow.style.display !== 'none';
      if (showing) {
        searchOpen = false;
        searchQuery = '';
        searchInput.value = '';
        searchRow.style.display = 'none';
      } else {
        searchOpen = true;
        searchRow.style.display = '';
        searchInput.focus();
      }
      searchToggle.classList.toggle('active', !showing);
      applySubjectFilters(container);
    });
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value;
      applySubjectFilters(container);
    });

    document.getElementById('library-sort-btn').addEventListener('click', function () {
      openMenu('Sort subjects', ['focus', 'new', 'alpha'].map(function (m) {
        return { label: (m === sortMode ? '\u2713 ' : '') + SORT_NAMES[m], run: function () { sortMode = m; render(); } };
      }));
    });
    document.getElementById('library-add-subject-btn').addEventListener('click', openAddSubjectModal);
    document.getElementById('library-more-btn').addEventListener('click', function () {
      const items = [{ icon: 'calendar', label: 'Plan', run: function () { openPlan(); } }];
      if (removed.length > 0) {
        items.push({
          label: 'Removed subjects (' + removed.length + ')',
          run: function () {
            openMenu('Removed subjects (history kept)', removed.map(function (s) {
              return { label: s, run: function () { openSubject(s); } };
            }));
          }
        });
      }
      openMenu('Library', items);
    });

    const addTile = container.querySelector('.library-add-tile');
    if (addTile) addTile.addEventListener('click', openAddSubjectModal);
    container.querySelectorAll('.library-tile-open').forEach(function (btn) {
      btn.addEventListener('click', function () { openSubject(btn.dataset.subject); });
    });
    container.querySelectorAll('.library-tile-more').forEach(function (btn) {
      btn.addEventListener('click', function () { openSubjectMenu(btn.dataset.subject, false); });
    });
    container.querySelectorAll('.planner-history-fav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { openChapterFrom(btn.dataset.subject, btn.dataset.topicId, 'subjects'); });
    });
    container.querySelectorAll('.library-result-row').forEach(function (btn) {
      btn.addEventListener('click', function () { openChapterFrom(btn.dataset.subject, btn.dataset.topicId, 'subjects'); });
    });

    applySubjectFilters(container);
  }

  // Status line for a topic row, from the existing Planner tasks (no new data).
  function topicStatus(topicId) {
    const today = todayStr();
    const open = PlanData.getTasksForTopic(topicId).filter(function (t) { return !t.completed && !t.archived; });
    const overdue = open.filter(function (t) { return t.date < today; }).length;
    if (overdue) return { text: overdue + ' overdue', due: true };
    const next = open.filter(function (t) { return t.date >= today; }).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    })[0];
    if (next) {
      const when = next.date === today ? 'Today' : new Date(next.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return { text: PlanData.taskLabel(next) + ' \u00B7 ' + when, due: next.date === today };
    }
    return { text: 'Nothing scheduled', due: false };
  }

  function renderChapters(container) {
    const grouped = PlanData.getTopicsBySubject();
    const topics = grouped[activeSubject] || [];
    const favIds = State.get().favoriteTopics || [];
    const isActive = PlanData.isActiveSubject(activeSubject);
    const searchVisible = searchOpen || !!searchQuery || selectedFilterTagIds.length > 0;

    const allFilterTags = TagsData.getAllTagsList();
    const tagChipsHtml = allFilterTags.length === 0 ? '' :
      '<div class="library-filter-chips chip-row" id="library-filter-chips">' +
        allFilterTags.map(function (tag) {
          return '<button class="library-filter-chip chip" data-tag-id="' + tag.tagId + '" style="border-color:' + tag.color + '">' + esc(tag.name) + '</button>';
        }).join('') +
      '</div>';

    const cardHtml = '<div class="library-subject-card">' +
        '<span class="library-subject-card-art px-play">' + subjectArt(activeSubject) + '</span>' +
        '<div class="library-subject-card-body">' +
          '<div class="library-subject-card-name">' + esc(activeSubject) + (isActive ? '' : ' (removed)') + '</div>' +
          '<div class="library-subject-card-meta">' + topics.length + (topics.length === 1 ? ' chapter' : ' chapters') + '</div>' +
        '</div>' +
      '</div>';

    let html = '<div class="library-chapters-view">' +
      '<div class="library-header">' +
        '<button class="library-icon-btn library-back-btn" title="Back to subjects" aria-label="Back to subjects">' + toolIcon('back') + '</button>' +
        '<div class="library-header-actions">' +
          '<button id="library-search-toggle" class="library-icon-btn' + (searchVisible ? ' active' : '') + '" title="Search" aria-label="Search chapters">' + toolIcon('search') + '</button>' +
          (isActive ? '<button id="library-add-topic-icon" class="library-icon-btn" title="Add topic" aria-label="Add topic">' + toolIcon('plus') + '</button>' : '') +
          (isActive ? '<button id="library-subject-more" class="library-icon-btn" title="Subject options" aria-label="Subject options">' + toolIcon('more') + '</button>' : '') +
        '</div>' +
      '</div>' +
      cardHtml +
      '<div id="library-search-row" class="library-search-row"' + (searchVisible ? '' : ' style="display:none;"') + '>' +
        searchFieldHtml('Search chapters...') +
        tagChipsHtml +
      '</div>';

    if (topics.length === 0) {
      html += '<p class="planner-empty empty-state">No chapters yet for ' + esc(activeSubject) + '.' + (isActive ? ' Tap + to add one.' : '') + '</p>';
    } else {
      html += '<div class="planner-history-chapter-list list-row-group" id="library-chapter-list">' + topics.map(function (t, idx) {
        const isFav = favIds.indexOf(t.topicId) !== -1;
        const tp = topicCounts(t.topicId);
        const tint = topicTint(t.color);
        const st = topicStatus(t.topicId);
        return '<div class="planner-history-chapter-item list-row library-topic-row' + (tint ? ' has-tint' : '') + '"' + (tint ? ' style="--topic-tint:' + tint.fill + ';--topic-edge:' + tint.edge + '"' : '') + ' data-name="' + esc(t.topicName.toLowerCase()) + '" data-tags="' + (t.tags || []).join(',') + '">' +
          '<button class="library-topic-open" data-topic-id="' + t.topicId + '">' +
            '<span class="library-topic-index">' + (idx + 1) + '</span>' +
            '<span class="library-topic-title">' +
              (isFav ? '<span class="library-topic-fav" title="Favorite" role="img" aria-label="Favorite">' + toolIcon('starOn') + '</span>' : '') +
              '<span class="library-topic-name">' + esc(t.topicName) + '</span>' +
            '</span>' +
            '<span class="library-topic-status' + (st.due ? ' is-due' : '') + '">' + esc(st.text) + '</span>' +
          '</button>' +
          '<span class="library-topic-count" title="Tasks done / total">' + tp.done + ' / ' + tp.total + '</span>' +
          '<div class="library-row-actions">' +
            '<button class="library-icon-btn library-topic-planner" data-topic-id="' + t.topicId + '" title="Plan" aria-label="Plan ' + esc(t.topicName) + '">' + toolIcon('calendar') + '</button>' +
            '<button class="library-icon-btn library-topic-more" data-topic-id="' + t.topicId + '" title="More" aria-label="More options for ' + esc(t.topicName) + '">' + toolIcon('more') + '</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }
    html += '</div>';

    container.innerHTML = html;

    container.querySelector('.library-back-btn').addEventListener('click', function () { showView('subjects'); });

    container.querySelectorAll('.library-topic-open').forEach(function (btn) {
      btn.addEventListener('click', function () { openChapterFrom(activeSubject, btn.dataset.topicId, 'chapters'); });
    });
    container.querySelectorAll('.library-topic-planner').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPlan(activeSubject, btn.dataset.topicId);
      });
    });
    container.querySelectorAll('.library-topic-more').forEach(function (btn) {
      btn.addEventListener('click', function () { openTopicMenu(btn.dataset.topicId, false); });
    });

    const addTopicBtn = document.getElementById('library-add-topic-icon'); // absent for removed subjects
    if (addTopicBtn) addTopicBtn.addEventListener('click', function () {
      const name = prompt('New chapter name for ' + activeSubject + ':');
      if (name && name.trim()) {
        PlanData.getOrCreateTopic(activeSubject, name.trim());
        render();
      }
    });
    const subjectMoreBtn = document.getElementById('library-subject-more');
    if (subjectMoreBtn) subjectMoreBtn.addEventListener('click', function () { openSubjectMenu(activeSubject, false); });

    function applyLibraryFilters() {
      const searchEl = document.getElementById('library-search');
      const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
      document.querySelectorAll('#library-chapter-list .planner-history-chapter-item').forEach(function (item) {
        const nameMatch = item.dataset.name.indexOf(query) !== -1;
        const itemTags = (item.dataset.tags || '').split(',').filter(Boolean);
        const tagMatch = selectedFilterTagIds.length === 0 || selectedFilterTagIds.some(function (id) { return itemTags.indexOf(id) !== -1; });
        item.style.display = (nameMatch && tagMatch) ? 'flex' : 'none';
      });
    }
    const searchRow = document.getElementById('library-search-row');
    const searchInput = document.getElementById('library-search');
    const searchToggle = document.getElementById('library-search-toggle');
    searchToggle.addEventListener('click', function () {
      const showing = searchRow.style.display !== 'none';
      if (showing && selectedFilterTagIds.length === 0) {
        searchOpen = false;
        searchQuery = '';
        searchInput.value = '';
        searchRow.style.display = 'none';
      } else {
        searchOpen = true;
        searchRow.style.display = '';
        searchInput.focus();
      }
      searchToggle.classList.toggle('active', searchRow.style.display !== 'none');
      applyLibraryFilters();
    });
    searchInput.addEventListener('input', function () {
      searchQuery = searchInput.value;
      applyLibraryFilters();
    });
    const filterChipsEl = document.getElementById('library-filter-chips');
    if (filterChipsEl) {
      filterChipsEl.querySelectorAll('.library-filter-chip').forEach(function (chip) {
        chip.classList.toggle('active', selectedFilterTagIds.indexOf(chip.dataset.tagId) !== -1);
        chip.addEventListener('click', function () {
          const id = chip.dataset.tagId;
          const idx = selectedFilterTagIds.indexOf(id);
          if (idx === -1) selectedFilterTagIds.push(id); else selectedFilterTagIds.splice(idx, 1);
          renderChapters(container);
        });
      });
    }
    applyLibraryFilters();
  }

  function renameTopicFlow(topicId) {
    const meta = PlanData.getAllTopics()[topicId];
    if (!meta) return;
    const name = prompt('Rename chapter:', meta.topicName);
    if (name && name.trim()) {
      PlanData.renameTopic(topicId, name.trim());
      render();
    }
  }

  function colorTopicFlow(topicId) {
    const meta = PlanData.getAllTopics()[topicId] || {};
    const input = document.createElement('input');
    input.type = 'color';
    input.value = meta.color || '#b39ddb';
    input.addEventListener('change', function () {
      PlanData.updateTopicMeta(topicId, { color: input.value });
      render();
    });
    input.click();
  }

  function removeTopicFlow(topicId) {
    const ok = PlanData.deleteTopic(topicId);
    if (!ok) { alert('Cannot remove a chapter with active (non-archived) tasks. Archive its tasks first.'); return; }
    const favs = (State.get().favoriteTopics || []).filter(function (id) { return id !== topicId; });
    State.set({ favoriteTopics: favs });
    getLinksByTopic(topicId).forEach(function (l) { deleteLink(l.linkId); });
    if (typeof TargetsData !== 'undefined') {
      TargetsData.getAllTargetsList().filter(function (t) { return t.topicId === topicId; }).forEach(function (t) {
        TargetsData.deleteTarget(t.targetId);
      });
    }
    showView('chapters');
  }

  // One overflow menu for a topic. From a list row it also offers the info views; inside the topic
  // detail those are already one tap away, so only the management actions are listed.
  function openTopicMenu(topicId, inDetail) {
    const meta = PlanData.getAllTopics()[topicId];
    if (!meta) return;
    const items = [];
    if (!inDetail) {
      const isFav = (State.get().favoriteTopics || []).indexOf(topicId) !== -1;
      items.push({ icon: 'page', label: 'Details', run: function () { openChapterFrom(meta.subject, topicId, 'chapters'); } });
      items.push({ icon: isFav ? 'starOff' : 'starOn', label: isFav ? 'Remove from favorites' : 'Add to favorites', run: function () { toggleFavoriteTopic(topicId); render(); } });
      items.push({ icon: 'link', label: 'Links', run: function () { openLinksModal(topicId); } });
    }
    items.push({ icon: 'pencil', label: 'Rename', run: function () { renameTopicFlow(topicId); } });
    items.push({ icon: 'palette', label: 'Color', run: function () { colorTopicFlow(topicId); } });
    items.push({ icon: 'tag', label: 'Manage tags', run: function () { Tags.openManagerForTopic(topicId); } });
    items.push({ icon: 'trash', label: 'Remove', danger: true, run: function () { removeTopicFlow(topicId); } });
    openMenu(meta.topicName, items);
  }

  function renderChapter(container) {
    const topicMeta = PlanData.getAllTopics()[activeTopicId];
    if (!topicMeta) { view = 'chapters'; renderChapters(container); return; }
    activeSubject = topicMeta.subject;
    const subject = activeSubject;
    const topicId = activeTopicId;
    const chapterName = topicMeta.topicName;
    const isFav = (State.get().favoriteTopics || []).indexOf(topicId) !== -1;

    const tagIds = topicMeta.tags || [];
    const tagsHtml = tagIds.length === 0 ? '' : '<div class="library-topic-tags chip-row">' +
      tagIds.map(function (tagId) {
        const tag = TagsData.getTag(tagId);
        if (!tag) return '';
        return '<span class="library-tag chip" style="border-color:' + tag.color + ';color:' + tag.color + '">' + esc(tag.name) + '</span>';
      }).join('') +
    '</div>';

    container.innerHTML =
      '<div class="library-header">' +
        '<button class="library-icon-btn library-back-btn" title="Back to ' + esc(chapterBackView === 'subjects' ? 'subjects' : subject) + '" aria-label="Back">' + toolIcon('back') + '</button>' +
        '<div class="library-header-text">' +
          '<div class="library-header-sub">' + esc(subject) + '</div>' +
          '<h4 class="library-header-title section-heading">' + esc(chapterName) + '</h4>' +
        '</div>' +
        '<div class="library-header-actions">' +
          '<button id="library-action-fav" class="library-icon-btn" title="' + (isFav ? 'Remove from favorites' : 'Add to favorites') + '" aria-label="Toggle favorite">' + toolIcon(isFav ? 'starOn' : 'starOff') + '</button>' +
          '<button id="library-action-more" class="library-icon-btn" title="More" aria-label="More options">' + toolIcon('more') + '</button>' +
        '</div>' +
      '</div>' +
      tagsHtml +
      '<div class="library-topic-actions">' +
        '<button id="library-action-planner" class="btn btn-primary"><span class="library-btn-glyph">' + toolIcon('calendar') + '</span><span>Plan</span></button>' +
        '<button id="library-action-links" class="library-info-chip">Links</button>' +
        '<button id="library-action-progress" class="library-info-chip">Progress</button>' +
      '</div>';

    container.querySelector('.library-back-btn').addEventListener('click', function () { showView(chapterBackView); });
    document.getElementById('library-action-fav').addEventListener('click', function () {
      toggleFavoriteTopic(topicId);
      render();
    });
    document.getElementById('library-action-more').addEventListener('click', function () { openTopicMenu(topicId, true); });
    document.getElementById('library-action-planner').addEventListener('click', function () {
      openPlan(subject, topicId);
    });
    document.getElementById('library-action-links').addEventListener('click', function () { openLinksModal(topicId); });
    document.getElementById('library-action-progress').addEventListener('click', function () {
      if (typeof PTPEView === 'undefined' || !PTPEView.openExplorer) return;
      PTPEView.openExplorer({ dim: 'topic', id: topicId, metric: 'studyHours', range: 'quarter' });
      const tab = document.querySelector('.nav-btn[data-screen="progress"]');
      if (tab) tab.click();
    });

    renderTopicTargetsChecklist(container, topicId);
    renderTopicHistory(container, topicId);
  }
    

  // Completed work for this exact topic. Read-only view of the Planning Agent's canonical history
  // (PlanningAgent.getHistory); nothing is stored here. Re-rendered with the Library on every task change.
  function renderTopicHistory(container, topicId) {
    const list = (typeof PlanningAgent !== 'undefined' && PlanningAgent.getHistory) ? PlanningAgent.getHistory({ topicId: topicId }) : [];
    const days = [], map = {};
    list.forEach(function (e) {
      const d = e.at ? new Date(e.at) : null;
      const key = d ? d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() : '';
      if (!map[key]) {
        const sameYear = d && d.getFullYear() === new Date().getFullYear();
        map[key] = {
          label: d ? d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) : 'Earlier',
          items: []
        };
        days.push(key);
      }
      map[key].items.push(e);
    });
    const entryHtml = function (e) {
      if (e.kind === 'group') {
        return '<li class="lth-item lth-group"><div class="lth-line"><span class="lth-name">' + esc(e.title) + '</span>' +
          '<span class="lth-count" title="' + e.subs.length + ' of ' + e.subs.length + ' done">' + e.subs.length + '/' + e.subs.length + '</span></div>' +
          '<ul class="lth-subs">' + e.subs.map(function (s) { return '<li class="lth-sub">' + esc(s.title) + '</li>'; }).join('') + '</ul></li>';
      }
      return '<li class="lth-item"><div class="lth-line"><span class="lth-name">' + esc(e.task.title) + '</span></div>' +
        (e.parent ? '<span class="lth-ctx">' + esc(e.parent) + '</span>' : '') + '</li>';
    };
    const wrap = document.createElement('section');
    wrap.className = 'library-topic-history';
    wrap.setAttribute('aria-label', 'Completed work for this topic');
    wrap.innerHTML = days.length
      ? '<ol class="lth">' + days.map(function (k) {
          return '<li class="lth-day"><span class="lth-date">' + esc(map[k].label) + '</span><ul class="lth-items">' + map[k].items.map(entryHtml).join('') + '</ul></li>';
        }).join('') + '</ol>'
      : '<p class="lth-empty">Completed tasks for this topic will appear here.</p>';
    container.appendChild(wrap);
  }

  function renderTopicTargetsChecklist(container, topicId) {
    const targets = TargetsData.getTargetsForTopic(topicId);
    if (targets.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'library-topic-targets-dropdown';
    wrap.innerHTML =
      '<button class="library-topic-targets-toggle btn btn-secondary" type="button">Subtargets \u25BE</button>' +
      '<div class="library-topic-targets-body" style="display:none">' +
        targets.map(function (tg) {
          const subs = TargetsData.getSubtargetsForTarget(tg.targetId);
          if (subs.length === 0) return '';
          return '<div class="library-topic-target-group"><strong>' + esc(tg.title) + '</strong>' +
            subs.map(function (s) {
              return '<label class="library-topic-subtarget-row list-row">' +
                '<input type="checkbox" class="library-topic-subtarget-check" data-subtarget-id="' + s.subtargetId + '" ' + (s.completed ? 'checked' : '') + '> ' +
                esc(s.title) + ' (' + s.currentValue + '/' + s.targetValue + ')' +
              '</label>';
            }).join('') +
           '</div>';
        }).join('') +
      '</div>';

    container.appendChild(wrap);
    wrap.querySelector('.library-topic-targets-toggle').addEventListener('click', function () {
      const body = wrap.querySelector('.library-topic-targets-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    wrap.querySelectorAll('.library-topic-subtarget-check').forEach(function (cb) {
      cb.addEventListener('click', function () {
        TargetsData.toggleSubtargetComplete(cb.dataset.subtargetId);
        render();
      });
    });
  }

  // Entry point used by Planner.openHistory (so browsing a topic always lands here now).
  function openTopic(subject, topicId) {
    activeSubject = subject || null;
    if (topicId) { activeTopicId = topicId; view = 'chapter'; }
    else if (subject) { view = 'chapters'; activeTopicId = null; }
    else { view = 'subjects'; activeTopicId = null; }
  }

  // ---------- Links (Cleanup Item 4 — relocated from study.js, now topic-scoped) ----------

  function getLinks() { return State.get().studyLinks || {}; }

  function addLink(topicId, url, note) {
    const links = Object.assign({}, getLinks());
    const id = 'link_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    links[id] = { linkId: id, topicId: topicId, url: url.trim(), note: note || '' };
    State.set({ studyLinks: links });
  }

  function deleteLink(linkId) {
    const links = Object.assign({}, getLinks());
    delete links[linkId];
    State.set({ studyLinks: links });
  }

  function getLinksByTopic(topicId) {
    const links = getLinks();
    return Object.keys(links).map(function (id) { return links[id]; }).filter(function (l) { return l.topicId === topicId; });
  }

  function openLinksModal(topicId) {
    const list = getLinksByTopic(topicId);
    const listHtml = list.length === 0
      ? '<p class="planner-empty empty-state">No links yet for this chapter.</p>'
      : list.map(function (l) {
          return '<div class="study-link-row list-row">' +
            '<a href="' + l.url + '" target="_blank" rel="noopener">' + l.url + '</a>' +
            (l.note ? '<div class="study-link-note">' + l.note + '</div>' : '') +
            '<button class="study-link-delete btn btn-danger" data-link-id="' + l.linkId + '">Remove</button>' +
          '</div>';
        }).join('');

    Modal.open(
      '<h3 class="section-heading">Links</h3>' +
      '<div class="study-links-list">' + listHtml + '</div>' +
      '<div class="study-links-form">' +
        '<input type="url" id="study-link-url" class="input" placeholder="YouTube URL">' +
        '<textarea id="study-link-note" class="input" rows="2" placeholder="Note (optional)"></textarea>' +
        '<button id="study-link-save" class="btn btn-primary">Add Link</button>' +
      '</div>'
    );

    document.querySelectorAll('.study-link-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteLink(btn.dataset.linkId);
        openLinksModal(topicId);
      });
    });

    document.getElementById('study-link-save').addEventListener('click', function () {
      const url = document.getElementById('study-link-url').value.trim();
      if (!url) { alert('Enter a URL.'); return; }
      const note = document.getElementById('study-link-note').value;
      addLink(topicId, url, note);
      openLinksModal(topicId);
    });
  }

  function init() {
    if (typeof TagsData !== 'undefined') TagsData.migrateLegacyStringTags();
    render();
  }
  // Kept only so existing callers of Library.renderPanel() keep working; the Library has no side panel any more.
  function renderPanel() { render(); }
  return { init: init, render: render, renderPanel: renderPanel, openTopic: openTopic, openSubject: openSubject, openPlan: openPlan };
})();
