// player.js — Radio + Music Player. Depends on: State, Modal, RadioData, MusicData.
// Owns exactly one <audio> element for Radio and one for local Music playback, plus one hidden
// YouTube IFrame Player instance, all created once at module scope (not per-render) so
// opening/closing/reopening the modal never creates duplicate audio/player instances.
// Radio and Music Player are mutually exclusive: starting one always stops the other.
// This module never touches TimeEngine/Study/Alarm audio — fully isolated.
const Player = (function () {
  let radioAudioEl = null;
  let musicAudioEl = null;
  let hls = null;
  let currentStationId = null;
  let loadedStationId = null;
  let radioPlaying = false;

  let ytPlayer = null;
  let ytApiLoading = false;
  let ytApiReady = false;

  let currentObjectUrl = null;
  let shuffleOrder = null;
  let shuffleOn = false;
  let autoplayOn = true;
  let currentTrackId = null;
  let musicPlaying = false;
  let skipGuard = 0;

  function ensureRadioAudio() {
    if (radioAudioEl) return radioAudioEl;
    radioAudioEl = document.createElement('audio');
    radioAudioEl.id = 'radio-audio-el';
    radioAudioEl.style.display = 'none';
    radioAudioEl.addEventListener('error', function () {
      console.error('[radio] audio element error:', radioAudioEl.error);
    });
    document.body.appendChild(radioAudioEl);
    return radioAudioEl;
  }

  function ensureMusicAudio() {
    if (musicAudioEl) return musicAudioEl;
    musicAudioEl = document.createElement('audio');
    musicAudioEl.id = 'music-audio-el';
    musicAudioEl.style.display = 'none';
    document.body.appendChild(musicAudioEl);
    musicAudioEl.addEventListener('ended', function () { if (autoplayOn) next(); });
    musicAudioEl.addEventListener('timeupdate', updateProgressUi);
    return musicAudioEl;
  }

  function loadHlsScript(cb) {
    if (window.Hls) { cb(); return; }
    if (window.__hlsLoading) { window.__hlsLoadQueue.push(cb); return; }
    window.__hlsLoading = true;
    window.__hlsLoadQueue = [cb];
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
    s.onload = function () {
      window.__hlsLoading = false;
      window.__hlsLoadQueue.forEach(function (fn) { fn(); });
      window.__hlsLoadQueue = [];
    };
    s.onerror = function () {
      window.__hlsLoading = false;
      window.__hlsLoadQueue = [];
      console.error('Radio: hls.js failed to load from CDN — script blocked or unreachable');
    };
    document.body.appendChild(s);
  }

  function loadYouTubeApi(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    if (!ytApiLoading) {
      ytApiLoading = true;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(s);
      window.onYouTubeIframeAPIReady = function () { ytApiReady = true; drainYtCallbacks(); };
    }
    ytCallbacks.push(cb);
    if (ytApiReady) drainYtCallbacks();
  }
  let ytCallbacks = [];
  function drainYtCallbacks() {
    const cbs = ytCallbacks; ytCallbacks = [];
    cbs.forEach(function (fn) { fn(); });
  }

  function ensureYtPlayer(cb) {
    loadYouTubeApi(function () {
      if (ytPlayer) { cb(); return; }
      let holder = document.getElementById('yt-player-holder');
      if (!holder) {
        holder = document.createElement('div');
        holder.id = 'yt-player-holder';
        holder.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
        document.body.appendChild(holder);
      }
      const target = document.createElement('div');
      target.id = 'yt-player-target';
      holder.appendChild(target);
      ytPlayer = new YT.Player('yt-player-target', {
        height: '1', width: '1',
        events: {
          onReady: function () { cb(); },
          onStateChange: function (e) { if (e.data === YT.PlayerState.ENDED) next(); }
        }
      });
    });
  }

  function extractYouTubeId(url) {
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function stopMusic() {
    if (musicAudioEl) musicAudioEl.pause();
    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo();
    musicPlaying = false;
  }
  function stopRadio() {
    if (radioAudioEl) radioAudioEl.pause();
    radioPlaying = false;
    updateRadioPlayingUi();
  }

  function playStation(id) {
    const station = RadioData.getById(id);
    if (!station || !station.url) return;
    stopMusic();
    ensureRadioAudio();
    currentStationId = id;
    if (loadedStationId !== id) {
      if (hls) { hls.destroy(); hls = null; }
      loadedStationId = id;
      const nativeSupport = radioAudioEl.canPlayType('application/vnd.apple.mpegurl');
      if (nativeSupport) {
        radioAudioEl.src = station.url;
      } else {
        loadHlsScript(function () {
          hls = new Hls();
          hls.on(Hls.Events.ERROR, function (event, data) { console.error('Radio HLS error:', data); });
          hls.loadSource(station.url);
          hls.attachMedia(radioAudioEl);
          radioAudioEl.play().catch(function (err) { console.error('Radio play() rejected:', err); });
          radioPlaying = true;
          updateRadioPlayingUi();
        });
        return;
      }
    }
    radioAudioEl.play().catch(function (err) { console.error('Radio play() rejected:', err); });
    radioPlaying = true;
    updateRadioPlayingUi();
  }
  function pauseRadio() { stopRadio(); }
  // The unified player is synced in place (no Modal.open()), so play/pause/track-change
  // never replays the cassette insertion or the screen transition.
  function updateRadioPlayingUi() { syncControls(); }

  function updateMusicPlayingUi() {
    const track = MusicData.getById(currentTrackId);
    const label = document.getElementById('music-now-playing');
    if (label) label.textContent = track ? track.name : 'Nothing playing';
    document.querySelectorAll('.dcp-row').forEach(function (row) {
      row.classList.toggle('dcp-row-active', row.dataset.id === currentTrackId);
    });
    syncControls();
  }

  function updateMusicToggleUi() {
    const shuffleBtn = document.getElementById('music-shuffle-btn');
    if (shuffleBtn) {
      shuffleBtn.classList.toggle('is-on', shuffleOn);
      shuffleBtn.setAttribute('aria-pressed', shuffleOn ? 'true' : 'false');
    }
    const autoplayBtn = document.getElementById('music-autoplay-btn');
    if (autoplayBtn) {
      autoplayBtn.classList.toggle('is-on', autoplayOn);
      autoplayBtn.setAttribute('aria-pressed', autoplayOn ? 'true' : 'false');
    }
  }

  function playableOrder() {
    const list = MusicData.getPlaylist();
    if (shuffleOn && shuffleOrder) return shuffleOrder.filter(function (id) { return list.some(function (t) { return t.id === id; }); });
    return list.map(function (t) { return t.id; });
  }
  function buildShuffle() {
    const ids = MusicData.getPlaylist().map(function (t) { return t.id; });
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }
    shuffleOrder = ids;
  }
  function toggleShuffle() {
    shuffleOn = !shuffleOn;
    if (shuffleOn) buildShuffle();
  }

  function playTrackId(id) {
    const track = MusicData.getById(id);
    if (!track) return;
    if (track.source === 'local' && (!track.fileObj || !(track.fileObj instanceof Blob))) {
      MusicData.markUnavailable(id);
      skipToAdjacent(1);
      return;
    }
    stopRadio();
    currentTrackId = id;
    skipGuard = 0;

    if (track.source === 'local') {
      ensureMusicAudio();
      if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
      stopYtPoll();
      if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
      currentObjectUrl = URL.createObjectURL(track.fileObj);
      musicAudioEl.src = currentObjectUrl;
      musicAudioEl.play().catch(function () {});
      musicPlaying = true;
    } else {
      const vid = extractYouTubeId(track.url);
      if (!vid) { skipToAdjacent(1); return; }
      if (musicAudioEl) musicAudioEl.pause();
      ensureYtPlayer(function () {
        ytPlayer.loadVideoById(vid);
        musicPlaying = true;
        if (musicUiVisible()) startYtPoll();
      });
    }
    updateMusicPlayingUi();
  }

  function skipToAdjacent(dir) {
    const order = playableOrder();
    if (!order.length) return;
    if (skipGuard++ > order.length) return;
    let idx = order.indexOf(currentTrackId);
    idx = (idx === -1 ? 0 : idx + dir + order.length) % order.length;
    playTrackId(order[idx]);
  }
  function next() { skipToAdjacent(1); }
  function prev() { skipToAdjacent(-1); }

  function togglePlayPause() {
    const track = MusicData.getById(currentTrackId);
    if (!track) { const order = playableOrder(); if (order.length) playTrackId(order[0]); return; }
    if (musicPlaying) { stopMusic(); }
    else {
      stopRadio();
      if (track.source === 'local' && musicAudioEl) { musicAudioEl.play().catch(function () {}); musicPlaying = true; }
      else if (track.source === 'youtube' && ytPlayer) { ytPlayer.playVideo(); musicPlaying = true; }
    }
    updateMusicPlayingUi();
  }

  function seekMusic(seconds) {
    const track = MusicData.getById(currentTrackId);
    if (!track) return;
    if (track.source === 'local' && musicAudioEl) musicAudioEl.currentTime = seconds;
    else if (track.source === 'youtube' && ytPlayer && typeof ytPlayer.seekTo === 'function') ytPlayer.seekTo(seconds, true);
  }

  function updateProgressUi() {
    const bar = document.getElementById('music-seek-bar');
    const label = document.getElementById('music-time-label');
    if (!bar || !musicAudioEl || !musicAudioEl.duration) return;
    bar.max = musicAudioEl.duration;
    bar.value = musicAudioEl.currentTime;
    if (label) label.textContent = fmtTime(musicAudioEl.currentTime) + ' / ' + fmtTime(musicAudioEl.duration);
  }
  function fmtTime(s) {
    s = Math.floor(s || 0);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  let ytPollTimer = null;
  function stopYtPoll() {
    if (ytPollTimer) { clearInterval(ytPollTimer); ytPollTimer = null; }
  }
  // The poll only drives the Music Player's seek bar/time label, so it is only needed while
  // that view is actually on screen (Modal.close() hides the overlay but leaves its markup).
  function musicUiVisible() {
    const overlay = document.getElementById('modal-overlay');
    return !!document.getElementById('music-seek-bar') && !!overlay && overlay.style.display !== 'none';
  }
  function startYtPoll() {
    if (ytPollTimer) return;
    ytPollTimer = setInterval(function () {
      if (!musicUiVisible()) { stopYtPoll(); return; }
      const track = MusicData.getById(currentTrackId);
      if (!track || track.source !== 'youtube' || !ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
      const bar = document.getElementById('music-seek-bar');
      const label = document.getElementById('music-time-label');
      const dur = ytPlayer.getDuration ? ytPlayer.getDuration() : 0;
      const cur = ytPlayer.getCurrentTime();
      if (bar && dur) { bar.max = dur; bar.value = cur; }
      if (label && dur) label.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
    }, 1000);
  }

  // ---- Unified digital cassette player ----
  // One device, one screen, one control row. The inserted cassette only decides which
  // content/controls the shared interface shows; nothing here creates audio or timers.
  let playerMode = null;   // null = idle | 'music' | 'radio'
  let musicView = 'now';   // 'now' | 'list' (music cassette only)

  const ICON_PREV = '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 2h2v8H2zM10 2v8L4.5 6z"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M8 2h2v8H8zM2 2v8l5.5-4z"/></svg>';
  const ICON_PLAY = '<svg class="dcp-ico-play" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M3 1.5v9L10.5 6z"/></svg>';
  const ICON_PAUSE = '<svg class="dcp-ico-pause" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2.5 2H5v8H2.5zM7 2h2.5v8H7z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function motionOk() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function slotHtml(mode, label) {
    return '<div class="dcp-slot">' +
      '<button type="button" class="dcp-tape dcp-tape-' + mode + '" data-mode="' + mode + '" aria-pressed="' + (playerMode === mode ? 'true' : 'false') + '" aria-label="' + label + ' cassette">' +
        '<span class="dcp-tape-reels" aria-hidden="true"></span>' +
        '<span class="dcp-tape-strip"><span class="dcp-tape-name">' + (mode === 'music' ? 'Music' : 'Radio') + '</span></span>' +
      '</button>' +
    '</div>';
  }

  function playerHtml() {
    return '<div class="dcp" data-mode="' + (playerMode || 'idle') + '" data-playing="0">' +
      '<div class="dcp-tapes">' + slotHtml('music', 'Music Player') + slotHtml('radio', 'Radio') + '</div>' +
      '<div class="dcp-body">' +
        '<div class="dcp-top">' +
          '<span class="dcp-plate">Lavender</span>' +
          '<span class="dcp-led" aria-hidden="true"></span>' +
          '<button type="button" id="player-close-btn" class="dcp-x" aria-label="Close player">&times;</button>' +
        '</div>' +
        '<div class="dcp-screen"><div class="dcp-lcd">' +
          '<div class="dcp-scr-head"><span id="dcp-mode-label">Standby</span><span class="dcp-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>' +
          '<div class="dcp-scr-main" id="dcp-scr-main" aria-live="polite"></div>' +
        '</div></div>' +
        '<div class="dcp-controls">' +
          '<button type="button" id="music-prev-btn" class="dcp-key" aria-label="Previous track">' + ICON_PREV + '</button>' +
          '<button type="button" id="player-play-btn" class="dcp-key dcp-key-main" aria-label="Play">' + ICON_PLAY + ICON_PAUSE + '</button>' +
          '<button type="button" id="music-next-btn" class="dcp-key" aria-label="Next track">' + ICON_NEXT + '</button>' +
        '</div>' +
        '<div class="dcp-aux">' +
          '<button type="button" id="music-shuffle-btn" class="dcp-chip" aria-pressed="false">Shuffle</button>' +
          '<button type="button" id="music-autoplay-btn" class="dcp-chip" aria-pressed="false">Autoplay</button>' +
          '<button type="button" id="music-playlist-btn" class="dcp-chip">Playlist</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function idleViewHtml() {
    return '<div class="dcp-idle"><span class="dcp-idle-title">No cassette</span>' +
      '<span class="dcp-idle-hint">Slide one in <i class="dcp-arrow" aria-hidden="true"></i></span></div>';
  }
  function musicViewHtml() {
    const track = MusicData.getById(currentTrackId);
    const empty = MusicData.getPlaylist().length ? '' : '<div class="dcp-hint">Add tracks in Playlist.</div>';
    return '<div class="dcp-view">' +
      '<div class="dcp-np-label">Now playing</div>' +
      '<div class="dcp-np-title" id="music-now-playing">' + (track ? esc(track.name) : 'Nothing playing') + '</div>' +
      empty +
      '<div class="dcp-seek">' +
        '<input type="range" id="music-seek-bar" class="dcp-range" min="0" value="0" step="1" aria-label="Seek">' +
        '<div class="dcp-time" id="music-time-label">0:00 / 0:00</div>' +
      '</div>' +
    '</div>';
  }
  function radioViewHtml() {
    const tuned = RadioData.getById(currentStationId);
    const rows = RadioData.getStations().map(function (s) {
      return '<button type="button" class="dcp-station' + (s.id === currentStationId ? ' dcp-station-active' : '') + '" data-id="' + esc(s.id) + '">' +
        '<span class="dcp-st-dot" aria-hidden="true"></span><span class="dcp-st-name">' + esc(s.name) + '</span></button>';
    }).join('');
    return '<div class="dcp-view">' +
      '<div class="dcp-np-label"><span>Tuned to</span><span class="dcp-onair">on air</span></div>' +
      '<div class="dcp-np-title" id="radio-now-playing">' + (tuned ? esc(tuned.name) : 'Choose a station') + '</div>' +
      '<div class="dcp-stations">' + rows + '</div>' +
    '</div>';
  }
  function listViewHtml() {
    const list = MusicData.getPlaylist();
    const rows = list.length ? list.map(function (t) {
      return '<div class="dcp-row' + (t.id === currentTrackId ? ' dcp-row-active' : '') + '" data-id="' + esc(t.id) + '">' +
        '<button type="button" class="dcp-row-main" data-id="' + esc(t.id) + '">' +
          '<span class="dcp-row-src">' + (t.source === 'youtube' ? 'yt' : 'file') + '</span>' +
          '<span class="dcp-row-name">' + esc(t.name) + (t.available === false ? ' (unavailable)' : '') + '</span>' +
        '</button>' +
        '<button type="button" class="dcp-row-x" data-id="' + esc(t.id) + '" aria-label="Remove ' + esc(t.name) + '">&times;</button>' +
      '</div>';
    }).join('') : '<div class="dcp-hint">No tracks yet.</div>';
    return '<div class="dcp-view dcp-view-list">' +
      '<div class="dcp-rows">' + rows + '</div>' +
      '<div class="dcp-add">' +
        '<input type="file" id="playlist-file-input" class="dcp-sr" accept="audio/mpeg,audio/wav,.mp3,.wav">' +
        '<label for="playlist-file-input" class="dcp-lcd-btn">Add file</label>' +
        '<input type="text" id="playlist-yt-input" class="dcp-field" placeholder="YouTube URL" aria-label="YouTube URL">' +
        '<button type="button" id="playlist-add-yt-btn" class="dcp-lcd-btn">Add</button>' +
      '</div>' +
    '</div>';
  }

  // Fills the shared screen for the current mode. The screen container itself persists.
  function renderScreen() {
    const main = document.getElementById('dcp-scr-main');
    if (!main) return;
    let tag = 'Standby';
    let html;
    if (playerMode === 'music') {
      tag = musicView === 'list' ? 'Music \u00b7 Playlist' : 'Music';
      html = musicView === 'list' ? listViewHtml() : musicViewHtml();
    } else if (playerMode === 'radio') {
      tag = 'Radio';
      html = radioViewHtml();
    } else {
      html = idleViewHtml();
    }
    main.innerHTML = html;
    const label = document.getElementById('dcp-mode-label');
    if (label) label.textContent = tag;
    if (playerMode === 'music' && musicView !== 'list') { updateProgressUi(); startYtPoll(); }
    syncControls();
  }

  // Updates button states, play/pause icon and toggles in place (never re-renders the device).
  function syncControls() {
    const dcp = document.querySelector('.dcp');
    if (!dcp) return;
    const playing = playerMode === 'music' ? musicPlaying : (playerMode === 'radio' ? radioPlaying : false);
    dcp.setAttribute('data-playing', playing ? '1' : '0');
    const play = document.getElementById('player-play-btn');
    if (play) { play.disabled = !playerMode; play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
    ['music-prev-btn', 'music-next-btn'].forEach(function (id) {
      const b = document.getElementById(id);
      if (b) b.disabled = playerMode !== 'music';
    });
    const listBtn = document.getElementById('music-playlist-btn');
    if (listBtn) listBtn.textContent = musicView === 'list' ? 'Now playing' : 'Playlist';
    updateMusicToggleUi();
  }

  // Applies playerMode: cassette positions (via aria-pressed), LED, and a soft screen crossfade.
  function applyMode(animate) {
    const dcp = document.querySelector('.dcp');
    if (!dcp) return;
    dcp.setAttribute('data-mode', playerMode || 'idle');
    dcp.querySelectorAll('.dcp-tape').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === playerMode ? 'true' : 'false');
    });
    const main = document.getElementById('dcp-scr-main');
    if (animate && main && motionOk()) {
      main.classList.add('dcp-out');
      setTimeout(function () {
        if (document.getElementById('dcp-scr-main') !== main) return;
        renderScreen();
        main.classList.remove('dcp-out');
      }, 150);
    } else {
      renderScreen();
    }
    syncControls();
  }

  // Tap an ejected cassette to insert it; tap the inserted one to eject; tap the other to swap.
  // Ejecting or swapping stops the outgoing mode (existing stopMusic/stopRadio).
  function selectTape(mode) {
    const prevMode = playerMode;
    if (prevMode === 'music') { stopMusic(); updateMusicPlayingUi(); }
    else if (prevMode === 'radio') { stopRadio(); }
    playerMode = prevMode === mode ? null : mode;
    musicView = 'now';
    applyMode(true);
  }

  function updateRadioSelectionUi() {
    document.querySelectorAll('.dcp-station').forEach(function (r) {
      r.classList.toggle('dcp-station-active', r.dataset.id === currentStationId);
    });
    const title = document.getElementById('radio-now-playing');
    if (title) {
      const s = RadioData.getById(currentStationId);
      title.textContent = s ? s.name : 'Choose a station';
    }
  }

  function onPlayPress() {
    if (playerMode === 'music') {
      togglePlayPause();
    } else if (playerMode === 'radio') {
      if (radioPlaying) pauseRadio();
      else if (currentStationId) playStation(currentStationId);
    }
  }

  function addYouTubeFromInput() {
    const input = document.getElementById('playlist-yt-input');
    if (!input || !input.value.trim()) return;
    MusicData.addYouTube(input.value.trim());
    shuffleOrder = null;
    renderScreen();
  }

  function bindPlayer() {
    document.querySelectorAll('.dcp-tape').forEach(function (b) {
      b.addEventListener('click', function () { selectTape(b.getAttribute('data-mode')); });
    });
    document.getElementById('music-prev-btn').addEventListener('click', prev);
    document.getElementById('music-next-btn').addEventListener('click', next);
    document.getElementById('player-play-btn').addEventListener('click', onPlayPress);
    document.getElementById('music-shuffle-btn').addEventListener('click', function () { toggleShuffle(); updateMusicToggleUi(); });
    document.getElementById('music-autoplay-btn').addEventListener('click', function () { autoplayOn = !autoplayOn; updateMusicToggleUi(); });
    document.getElementById('music-playlist-btn').addEventListener('click', function () {
      musicView = musicView === 'list' ? 'now' : 'list';
      applyMode(true);
    });
    document.getElementById('player-close-btn').addEventListener('click', function () { Modal.close(); });

    const main = document.getElementById('dcp-scr-main');
    main.addEventListener('click', function (e) {
      const st = e.target.closest('.dcp-station');
      if (st) { currentStationId = st.dataset.id; updateRadioSelectionUi(); return; }
      const rm = e.target.closest('.dcp-row-x');
      if (rm) { MusicData.remove(rm.dataset.id); renderScreen(); return; }
      const row = e.target.closest('.dcp-row-main');
      if (row) { playTrackId(row.dataset.id); renderScreen(); return; }
      if (e.target.closest('#playlist-add-yt-btn')) addYouTubeFromInput();
    });
    main.addEventListener('change', function (e) {
      if (e.target.id === 'music-seek-bar') {
        seekMusic(Number(e.target.value));
      } else if (e.target.id === 'playlist-file-input') {
        Array.prototype.slice.call(e.target.files).forEach(function (f) { MusicData.addLocal(f); });
        shuffleOrder = null;
        renderScreen();
      }
    });
    main.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.id === 'playlist-yt-input') addYouTubeFromInput();
    });
  }

  function openPlayer() {
    if (radioPlaying) playerMode = 'radio';
    else if (musicPlaying) playerMode = 'music';
    musicView = 'now';
    Modal.open(playerHtml());
    bindPlayer();
    renderScreen();
  }

  let _btnRef = null;
  function handleBtnClick() { openPlayer(); }
  function init() {
    loadHlsScript(function () {});
    const list = MusicData.getPlaylist();
    let changed = false;
    const cleaned = list.map(function (t) {
      if (t.source === 'local' && !(t.fileObj instanceof Blob)) { changed = true; return Object.assign({}, t, { available: false, fileObj: null }); }
      return t;
    });
    if (changed) State.set({ musicPlaylist: cleaned });

    const btn = document.getElementById('player-music-btn');
    if (btn) {
      if (_btnRef) _btnRef.removeEventListener('click', handleBtnClick);
      btn.addEventListener('click', handleBtnClick);
      _btnRef = btn;
    }
  }

  return { init: init };
})();
