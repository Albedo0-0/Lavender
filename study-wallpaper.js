// study-wallpaper.js — Study screen wallpaper: multi-image, prev/next nav, optional slideshow,
// and auto light/dark clock contrast sampled from the current image. Purely presentational.
// Reads settings.studyWallpapers / studyWallpaperIndex / studyWallpaperSlideshow (state.js).
// Depends on: State. Must load after state.js, before study.js's init() runs (see index.html).
const StudyWallpaper = (function () {
  let slideshowTimer = null;
  let onChangeCb = null;
  let lastSampledUrl = null;
    let lastBrightness = 'light'; // 'light' | 'dark' text treatment for whatever's currently shown
  let lastPalette = null;       // { fg, accent, onAccent } derived from the current wallpaper, or null
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
    function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
      h *= 60;
    }
    return [h, s, l];
  }

  // Representative colour -> clock foreground + accent, tuned for the wallpaper's brightness.
  function buildPalette(r, g, b, lightBg) {
    const hsl = rgbToHsl(r, g, b);
    const s = Math.min(1, hsl[1]);
    const h = s < 0.1 ? 40 : Math.round(hsl[0]); // near-grey wallpapers get a warm neutral accent
    const pct = function (v) { return Math.round(v * 100); };
    return lightBg
      ? { fg: 'hsl(' + h + ',' + pct(Math.min(s, 0.45)) + '%,13%)', accent: 'hsl(' + h + ',' + pct(Math.max(0.35, Math.min(s, 0.7))) + '%,28%)', onAccent: '#f7f4ea' }
      : { fg: 'hsl(' + h + ',' + pct(Math.min(s, 0.5)) + '%,92%)', accent: 'hsl(' + h + ',' + pct(Math.max(0.35, Math.min(s, 0.75))) + '%,76%)', onAccent: '#18201b' };
  }

  // Works on an <img> or a playing <video>: tiny downsample -> average brightness + saturation-weighted mean colour.
  function analyseSource(src, cb) {
    try {
      const w = 32, h = 32;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let total = 0, n = 0, wr = 0, wg = 0, wb = 0, wsum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        total += 0.299 * r + 0.587 * g + 0.114 * b; n++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const wt = 0.05 + sat * sat; // favour colourful pixels so greys don't wash out the accent
        wr += r * wt; wg += g * wt; wb += b * wt; wsum += wt;
      }
      const avg = total / n;
      const lightBg = avg > 150;
      cb(lightBg ? 'dark' : 'light', buildPalette(wr / wsum, wg / wsum, wb / wsum, lightBg));
    } catch (e) {
      cb('light', null); // canvas read can fail cross-origin; safe fallback to the stylesheet defaults
    }
  }

  function sampleBrightness(url, cb) {
    if (!url) { cb('light', null); return; }
    const img = new Image();
    img.onload = function () { analyseSource(img, cb); };
    img.onerror = function () { cb('light', null); };
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
      lastPalette = null;
      applyToDom();
      const vid = document.getElementById('study-wallpaper-video');
      if (vid) {
        const grab = function () {
          if (lastSampledUrl !== url) return;
          analyseSource(vid, function (b, p) { lastBrightness = b; lastPalette = p; applyToDom(); });
        };
        if (vid.readyState >= 2) grab(); else vid.addEventListener('loadeddata', grab, { once: true });
      }
      return;
    }
        sampleBrightness(url, function (brightness, palette) {
      if (lastSampledUrl !== url) return; // wallpaper changed while this one was loading
      lastBrightness = brightness;
      lastPalette = palette || null;
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
        const studyEl = document.getElementById('screen-study');
        if (studyEl && studyEl.style.display === 'none') { video.pause(); } else {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(function () {});
        }
      } else {
        video.classList.remove('is-active');
        if (!video.paused) video.pause();
        if (video.getAttribute('src')) video.removeAttribute('src');
      }
    }
    const layout = document.getElementById('study-layout');
    if (layout) {
            // clock colour classes are owned by initClockAdaptiveColor() in study.js
      // (study-clock-on-light is set by initClockAdaptiveColor() in study.js)
      if (false && lastPalette) { // wallpaper-tinted palette disabled: clock stays neutral warm off-white / charcoal
        layout.style.setProperty('--study-fg', lastPalette.fg);
        layout.style.setProperty('--study-accent', lastPalette.accent);
        layout.style.setProperty('--study-on-accent', lastPalette.onAccent);
      } else {
        layout.style.removeProperty('--study-fg');
        layout.style.removeProperty('--study-accent');
        layout.style.removeProperty('--study-on-accent');
      }
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
