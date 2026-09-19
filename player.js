// player.js — Radio + Music Player. Depends on: State, Modal, RadioData, MusicData.
// Owns exactly one <audio> element for Radio and one for local Music playback, plus one hidden
// YouTube IFrame Player instance, all created once at module scope (not per-render) so
// opening/closing/reopening the modal never creates duplicate audio/player instances.
// Radio and Music Player are mutually exclusive: starting one always stops the other.
// This module never touches TimeEngine/Study/Alarm audio — fully isolated.
const Player = (function () {
  console.log('[radio] player.js LOADED — build check v2');
  document.addEventListener('click', function (e) {
    console.log('[radio] ANY click, target =', e.target.tagName, e.target.className);
  }, true);
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
    radioAudioEl.addEventListener('stalled', function () { console.log('[radio] stalled'); });
    radioAudioEl.addEventListener('waiting', function () { console.log('[radio] waiting/buffering'); });
    radioAudioEl.addEventListener('playing', function () { console.log('[radio] playing event fired'); });
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
    console.log('[radio] playStation id =', id);
    const station = RadioData.getById(id);
    console.log('[radio] station lookup =', station);
    if (!station || !station.url) { console.log('[radio] abort: no station/url'); return; }
    stopMusic();
    ensureRadioAudio();
    currentStationId = id;
    if (loadedStationId !== id) {
      if (hls) { hls.destroy(); hls = null; }
      loadedStationId = id;
      const nativeSupport = radioAudioEl.canPlayType('application/vnd.apple.mpegurl');
      console.log('[radio] native canPlayType =', JSON.stringify(nativeSupport));
      if (nativeSupport) {
        radioAudioEl.src = station.url;
      } else {
        console.log('[radio] entering loadHlsScript');
        loadHlsScript(function () {
          console.log('[radio] entering loadHlsScript');
        loadHlsScript(function () {
          console.log('[radio] loadHlsScript callback fired, window.Hls =', typeof window.Hls);
          hls = new Hls();
          hls.on(Hls.Events.ERROR, function (event, data) { console.error('Radio HLS error:', data); });
          hls.loadSource(station.url);
          hls.attachMedia(radioAudioEl);
          radioAudioEl.play().then(function () {
            console.log('[radio] play() resolved');
          }).catch(function (err) { console.error('Radio play() rejected:', err); });
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
  // Toggles the .radio-playing class only — no state change, purely reflects
  // radioPlaying in the DOM so the lamp/ON AIR tag update without a full re-render.
  function updateRadioPlayingUi() {
    const body = document.querySelector('.radio-body');
    if (body) body.classList.toggle('radio-playing', radioPlaying);
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
      });
    }
    renderMusicModal();
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
    renderMusicModal();
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
  function startYtPoll() {
    if (ytPollTimer) return;
    ytPollTimer = setInterval(function () {
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

  function chooserHtml() {
    return '<div class="modal-header"><h3 class="modal-title">Radio &amp; Music</h3></div>' +
      '<div class="player-chooser">' +
      '<button id="player-open-radio-btn" class="btn-secondary player-chooser-btn">Radio</button>' +
      '<button id="player-open-music-btn" class="btn-secondary player-chooser-btn">Music Player</button>' +
      '</div>';
  }
  function openChooser() {
    Modal.open(chooserHtml());
    document.getElementById('player-open-radio-btn').addEventListener('click', openRadioModal);
    document.getElementById('player-open-music-btn').addEventListener('click', openMusicModal);
  }

  function radioHtml() {
    const stations = RadioData.getStations();
    const tunedStation = RadioData.getById(currentStationId);
    const rows = stations.map(function (s) {
      const active = s.id === currentStationId;
      return '<div class="radio-station-row radio-station-card' + (active ? ' radio-station-active' : '') + '" data-id="' + s.id + '">' +
        '<span class="radio-station-name">' + s.name + '</span>' +
        (active ? '<span class="radio-station-check" aria-hidden="true">&#10003;</span>' : '') +
        '</div>';
    }).join('');
    return (
      '<div class="radio-modal">' +
        '<div class="modal-header"><h3 class="modal-title">Radio</h3></div>' +
        '<div class="radio-body' + (radioPlaying ? ' radio-playing' : '') + '">' +
          '<div class="radio-grille" aria-hidden="true"></div>' +
          '<div class="radio-top-row">' +
            '<span class="radio-knob radio-knob-left" aria-hidden="true"></span>' +
            '<div class="radio-display">' +
              '<span class="radio-display-text">' + (tunedStation ? tunedStation.name : '\u2014 \u00b7 \u2014') + '</span>' +
              '<span class="radio-lamp" aria-hidden="true"></span>' +
            '</div>' +
            '<span class="radio-knob radio-knob-right" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="radio-on-air-tag" aria-hidden="true">On Air</div>' +
          '<div class="radio-stations">' + rows + '</div>' +
          '<div id="radio-controls" class="radio-controls">' +
            '<button id="radio-play-btn" class="radio-btn radio-btn-play">Play</button>' +
            '<button id="radio-pause-btn" class="radio-btn radio-btn-pause">Pause</button>' +
          '</div>' +
        '</div>' +
        '<button id="player-back-btn" class="btn-secondary radio-back-btn">Back</button>' +
      '</div>'
    );
  }
  function openRadioModal() {
    Modal.open(radioHtml());
    const _rows = document.querySelectorAll('.radio-station-row');
    console.log('[radio] rows found in DOM =', _rows.length);
    _rows.forEach(function (r) {
      r.addEventListener('click', function () {
        console.log('[radio] direct row click, id =', r.dataset.id);
        currentStationId = r.dataset.id;
        _rows.forEach(function (x) { x.classList.remove('radio-station-active'); });
        r.classList.add('radio-station-active');
      });
    });
    if (!window.__radioDelegationBound) {
      window.__radioDelegationBound = true;
      document.addEventListener('click', function (e) {
        const row = e.target.closest('.radio-station-row');
        if (!row) return;
        console.log('[radio] row click delegated, id =', row.dataset.id);
        currentStationId = row.dataset.id;
        openRadioModal();
      });
    }
    document.getElementById('radio-play-btn').addEventListener('click', function () {
      console.log('[radio] play clicked, currentStationId =', currentStationId);
      if (currentStationId) playStation(currentStationId);
    });
    document.getElementById('radio-pause-btn').addEventListener('click', pauseRadio);
    document.getElementById('player-back-btn').addEventListener('click', openChooser);
  }

  function musicHtml() {
    const track = MusicData.getById(currentTrackId);
    return (
      '<div class="cassette-player">' +
        '<div class="modal-header"><h3 class="modal-title">Music Player</h3></div>' +
        '<div class="cassette-body' + (musicPlaying ? ' music-playing' : '') + '">' +
          '<div class="cassette-window">' +
            '<span class="cassette-reel cassette-reel-left" aria-hidden="true"></span>' +
            '<span class="cassette-reel cassette-reel-right" aria-hidden="true"></span>' +
            '<div class="cassette-label" id="music-now-playing">' + (track ? track.name : 'Nothing playing') + '</div>' +
          '</div>' +
          '<div class="cassette-progress">' +
            '<input type="range" id="music-seek-bar" class="cassette-seek" min="0" value="0" step="1">' +
            '<div class="cassette-time-label" id="music-time-label">0:00 / 0:00</div>' +
          '</div>' +
          '<div class="cassette-controls" id="music-controls">' +
            '<button id="music-prev-btn" class="cassette-btn">Prev</button>' +
            '<button id="music-playpause-btn" class="cassette-btn cassette-btn-main">' + (musicPlaying ? 'Pause' : 'Play') + '</button>' +
            '<button id="music-next-btn" class="cassette-btn">Next</button>' +
          '</div>' +
          '<div class="cassette-toggles">' +
            '<button id="music-shuffle-btn" class="cassette-toggle-btn' + (shuffleOn ? ' cassette-toggle-active' : '') + '">' + (shuffleOn ? 'Shuffle: On' : 'Shuffle: Off') + '</button>' +
            '<button id="music-autoplay-btn" class="cassette-toggle-btn' + (autoplayOn ? ' cassette-toggle-active' : '') + '">' + (autoplayOn ? 'Autoplay: On' : 'Autoplay: Off') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="cassette-footer">' +
          '<button id="music-playlist-btn" class="btn-secondary">Playlist</button>' +
          '<button id="player-back-btn" class="btn-secondary">Back</button>' +
        '</div>' +
      '</div>'
    );
  }
  function renderMusicModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    if (!document.getElementById('music-controls')) return;
    openMusicModal();
  }
  function openMusicModal() {
    Modal.open(musicHtml());
    startYtPoll();
    document.getElementById('music-prev-btn').addEventListener('click', prev);
    document.getElementById('music-next-btn').addEventListener('click', next);
    document.getElementById('music-playpause-btn').addEventListener('click', togglePlayPause);
    document.getElementById('music-shuffle-btn').addEventListener('click', function () { toggleShuffle(); openMusicModal(); });
    document.getElementById('music-autoplay-btn').addEventListener('click', function () { autoplayOn = !autoplayOn; openMusicModal(); });
    document.getElementById('music-playlist-btn').addEventListener('click', openPlaylistModal);
    document.getElementById('player-back-btn').addEventListener('click', openChooser);
    document.getElementById('music-seek-bar').addEventListener('change', function (e) { seekMusic(Number(e.target.value)); });
    updateProgressUi();
  }

  function playlistHtml() {
    const list = MusicData.getPlaylist();
    const rows = list.length ? list.map(function (t) {
      return '<div class="playlist-row list-row cassette-media-row' + (t.id === currentTrackId ? ' playlist-row-active' : '') + '" data-id="' + t.id + '">' +
        '<span class="cassette-media-source" data-source="' + t.source + '" aria-hidden="true"></span>' +
        '<span class="playlist-row-name list-row-title">' + t.name + (t.available === false ? ' (unavailable)' : '') + '</span>' +
        '<button class="playlist-remove-btn cassette-media-remove" data-id="' + t.id + '">Remove</button>' +
        '</div>';
    }).join('') : '<div class="empty-state">No tracks yet.</div>';
    return '<div class="modal-header"><h3 class="modal-title">Playlist</h3></div>' +
      rows +
      '<div class="form-row"><label for="playlist-file-input">Add local file</label><input type="file" id="playlist-file-input" accept="audio/mpeg,audio/wav,.mp3,.wav"></div>' +
      '<div class="form-row"><label for="playlist-yt-input">Add YouTube URL</label><input type="text" id="playlist-yt-input" placeholder="https://youtube.com/watch?v=..."></div>' +
      '<button id="playlist-add-yt-btn" class="btn-secondary">Add</button>' +
      '<div class="modal-footer"><button id="player-back-to-music-btn" class="btn-secondary">Back</button></div>';
  }
  function openPlaylistModal() {
    Modal.open(playlistHtml());
    document.querySelectorAll('.playlist-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.classList.contains('playlist-remove-btn')) return;
        playTrackId(row.dataset.id);
        openPlaylistModal();
      });
    });
    document.querySelectorAll('.playlist-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        MusicData.remove(btn.dataset.id);
        openPlaylistModal();
      });
    });
    document.getElementById('playlist-file-input').addEventListener('change', function (e) {
      Array.prototype.slice.call(e.target.files).forEach(function (f) { MusicData.addLocal(f); });
      shuffleOrder = null;
      openPlaylistModal();
    });
    document.getElementById('playlist-add-yt-btn').addEventListener('click', function () {
      const input = document.getElementById('playlist-yt-input');
      if (!input.value.trim()) return;
      MusicData.addYouTube(input.value.trim());
      shuffleOrder = null;
      openPlaylistModal();
    });
    document.getElementById('player-back-to-music-btn').addEventListener('click', openMusicModal);
  }

  let _btnRef = null;
  function handleBtnClick() { openChooser(); }
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
