// music-data.js — single canonical playlist (local + YouTube entries mixed). Depends on: State.
// Local File objects cannot be persisted to localStorage; only name/type metadata is persisted.
// A local entry whose File object is gone after reload is marked unavailable and skipped on playback.
const MusicData = (function () {
  function uid() { return 'trk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function getPlaylist() {
    return State.get().musicPlaylist || [];
  }

  function addLocal(file) {
    const list = getPlaylist().slice();
    const track = { id: uid(), source: 'local', name: file.name, fileObj: file, available: true };
    list.push(track);
    State.set({ musicPlaylist: list });
    return track;
  }

  function addYouTube(url, name) {
    const list = getPlaylist().slice();
    const track = { id: uid(), source: 'youtube', name: name || url, url: url, available: true };
    list.push(track);
    State.set({ musicPlaylist: list });
    return track;
  }

  function remove(id) {
    const list = getPlaylist().filter(function (t) { return t.id !== id; });
    State.set({ musicPlaylist: list });
  }

  function getById(id) {
    return getPlaylist().find(function (t) { return t.id === id; }) || null;
  }

  function markUnavailable(id) {
    const list = getPlaylist().map(function (t) {
      return t.id === id ? Object.assign({}, t, { available: false, fileObj: null }) : t;
    });
    State.set({ musicPlaylist: list });
  }

  return {
    getPlaylist: getPlaylist,
    addLocal: addLocal,
    addYouTube: addYouTube,
    remove: remove,
    getById: getById,
    markUnavailable: markUnavailable,
  };
})();
