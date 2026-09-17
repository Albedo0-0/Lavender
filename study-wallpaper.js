// study-wallpaper.js — Study screen wallpaper: multi-image, prev/next nav, optional slideshow,
// and auto light/dark clock contrast sampled from the current image. Purely presentational.
// Reads settings.studyWallpapers / studyWallpaperIndex / studyWallpaperSlideshow (state.js).
// Depends on: State. Must load after state.js, before study.js's init() runs (see index.html).
const StudyWallpaper = (function () {
  let slideshowTimer = null;
  let onChangeCb = null;
  let lastSampledUrl = null;
  let lastBrightness = 'light'; // 'light' | 'dark' text treatment for whatever's currently shown

  function settings() { return State.get().settings || {}; }
  function wallpapers() { return settings().studyWallpapers || []; }
  function currentIndex() {
    const list = wallpapers();
    if (!list.length) return 0;
    const idx = settings().studyWallpaperIndex || 0;
    return Math.max(0, Math.min(idx, list.length - 1));
  }
  function currentItem() {
    const list = wallpapers();
    if (!list.length) return null;
    const raw = list[currentIndex()];
    return (raw && typeof raw === 'object') ? raw : { url: raw, type: 'image' };
  }
  function currentUrl() {
    const item = currentItem();
    return item ? item.url : null;
  }
  function isVideoItem(item) { return !!item && item.type === 'video'; }

  function setIndex(idx) {
    const list = wallpapers();
    if (!list.length) return;
    const clamped = ((idx % list.length) + list.length) % list.length;
    State.patch('settings', { studyWallpaperIndex: clamped });
    sampleAndNotify();
  }
  function next() { setIndex(currentIndex() + 1); }
  function prev() { setIndex(currentIndex() - 1); }

  // Average-brightness sample via an offscreen canvas — cheap, no external deps, good enough
  // to decide "light text" vs "dark text", not exact color science.
  function sampleBrightness(url, cb) {
    if (!url) { cb('light'); return; }
    const img = new Image();
    img.onload = function () {
      try {
        const w = 24, h = 24; // tiny downsample, plenty for an average
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const avg = total / (data.length / 4);
        cb(avg > 150 ? 'dark' : 'light'); // bright image -> dark text; dark image -> light text
      } catch (e) {
        cb('light'); // canvas read can fail cross-origin; safe fallback
      }
    };
    img.onerror = function () { cb('light'); };
    img.src = url;
  }

  function sampleAndNotify() {
    const item = currentItem();
    const url = item ? item.url : null;
    if (url === lastSampledUrl) { applyToDom(); return; }
    lastSampledUrl = url;
    if (isVideoItem(item)) {
      // Skip pixel sampling for video — cheap fallback brightness so text stays readable
      // without paying for canvas/videoframe sampling on every wallpaper switch.
      lastBrightness = 'dark';
      applyToDom();
      return;
    }
    sampleBrightness(url, function (brightness) {
      lastBrightness = brightness;
      applyToDom();
    });
  }

  function applyToDom() {
    const item = currentItem();
    const url = item ? item.url : null;
    const isVideo = isVideoItem(item);
    const layer = document.getElementById('study-wallpaper-layer');
    const video = document.getElementById('study-wallpaper-video');
    if (layer) layer.style.backgroundImage = (url && !isVideo) ? 'url(' + url + ')' : 'none';
    if (video) {
      if (isVideo) {
        if (video.getAttribute('src') !== url) video.setAttribute('src', url);
        video.classList.add('is-active');
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(function () {});
      } else {
        video.classList.remove('is-active');
        if (!video.paused) video.pause();
        if (video.getAttribute('src')) video.removeAttribute('src');
      }
    }
    const layout = document.getElementById('study-layout');
    if (layout) {
      layout.classList.toggle('study-clock-on-dark', lastBrightness === 'light');
      layout.classList.toggle('study-clock-on-light', lastBrightness === 'dark');
    }
    if (onChangeCb) onChangeCb(url, lastBrightness);
  }

  function stopSlideshow() {
    if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; }
  }
  function startSlideshow() {
    stopSlideshow();
    const cfg = settings().studyWallpaperSlideshow || {};
    if (!cfg.enabled || wallpapers().length < 2) return;
    const intervalMs = Math.max(1, cfg.intervalMin || 5) * 60000;
    slideshowTimer = setInterval(next, intervalMs);
  }
  // Called by Settings after the slideshow toggle/interval changes, so the timer is always
  // cleanly rebuilt rather than accumulating a second interval.
  function refreshSlideshow() { startSlideshow(); }

  function init(onChange) {
    onChangeCb = onChange || null;
    sampleAndNotify();
    startSlideshow();
  }

  function pauseVideo() {
    const video = document.getElementById('study-wallpaper-video');
    if (video && !video.paused) video.pause();
  }
  function resumeVideo() {
    const item = currentItem();
    if (!isVideoItem(item)) return;
    const video = document.getElementById('study-wallpaper-video');
    if (video) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(function () {});
    }
  }

  return {
    init: init,
    next: next,
    prev: prev,
    currentUrl: currentUrl,
    refreshSlideshow: refreshSlideshow,
    stopSlideshow: stopSlideshow,
    pauseVideo: pauseVideo,
    resumeVideo: resumeVideo
  };
})();
