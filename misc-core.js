/*
 * Lavender — Miscellaneous shared helpers.
 *
 * Small, dependency-free utilities reused by every Miscellaneous module
 * so nothing in this system reinvents rand/clamp/style-injection on its
 * own. Load this file before any other Miscellaneous file.
 */
const MiscCore = (function () {
  const injectedStyles = new Set();

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function createEl(tag, opts) {
    const el = document.createElement(tag);
    opts = opts || {};
    if (opts.className) el.className = opts.className;
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (key) {
        el.setAttribute(key, opts.attrs[key]);
      });
    }
    if (opts.html !== undefined) el.innerHTML = opts.html;
    if (opts.text !== undefined) el.textContent = opts.text;
    return el;
  }

  // Idempotent <style> injection — safe to call from every module's
  // mount()/init() without risking duplicate <style> blocks piling up
  // on repeated calls.
  function injectStyle(id, css) {
    if (injectedStyles.has(id) || document.getElementById(id)) {
      injectedStyles.add(id);
      return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
    injectedStyles.add(id);
  }

  // Shared non-wiping decor layer (lives in <main>, outside every screen
  // section, so screen re-renders can't delete decorations).
  function getDecorLayer() {
    let layer = document.getElementById('lav-decor-layer');
    if (layer) return layer;
    const host = document.querySelector('main') || document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    layer = createEl('div', { attrs: { id: 'lav-decor-layer', 'aria-hidden': 'true' } });
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;';
    host.appendChild(layer);
    return layer;
  }

  return {
    prefersReducedMotion: prefersReducedMotion,
    ready: ready,
    rand: rand,
    randInt: randInt,
    pick: pick,
    clamp: clamp,
    createEl: createEl,
    injectStyle: injectStyle,
    getDecorLayer: getDecorLayer
  };
})();

/*
 * Lavender — Weather Ambience Cycle.
 *
 * Automatically rotates between 'clear', 'rain' and 'sunlight' (never
 * repeating the same state twice in a row), each held for at least 30
 * minutes. Persists to State.get().miscWeather so a reload resumes the
 * same state instead of restarting the cycle. No sound is triggered by
 * the cycle itself — sounds here stay interaction-only, per design.
 */
const MiscWeather = (function () {
  const STATES = ['clear', 'rain', 'sunlight'];
  const MIN_DURATION_MS = 30 * 60 * 1000;
  let rainInstance = null;
  let sunInstance = null;
  let checkTimer = null;

  function getSaved() { return (typeof State !== 'undefined' && State.get().miscWeather) || null; }
  function save(state, since) {
    if (typeof State !== 'undefined') State.set({ miscWeather: { state: state, since: since } });
  }

  function pickNext(current) {
    const options = STATES.filter(function (s) { return s !== current; });
    return MiscCore.pick(options);
  }

  function applyState(state) {
    if (rainInstance) { if (state === 'rain') rainInstance.start(); else rainInstance.stop(); }
    if (sunInstance) { if (state === 'sunlight') sunInstance.start(); else sunInstance.stop(); }
  }

  function rollNext() {
    const saved = getSaved();
    const current = saved ? saved.state : 'clear';
    const next = pickNext(current);
    save(next, Date.now());
    applyState(next);
  }

  function checkDue() {
    const saved = getSaved();
    if (!saved || !saved.since) { rollNext(); return; }
    if (Date.now() - saved.since >= MIN_DURATION_MS) rollNext();
    else applyState(saved.state);
  }

  function mount(container, options) {
    if (!container || typeof RainAmbience === 'undefined' || typeof SunlightAmbience === 'undefined') return null;
    options = options || {};
    rainInstance = RainAmbience.mount(container, options.rain || {});
    sunInstance = SunlightAmbience.mount(container, options.sunlight || {});
    checkDue();
    checkTimer = setInterval(checkDue, 60 * 1000);
    return {
      destroy: function () {
        if (checkTimer) clearInterval(checkTimer);
        if (rainInstance) rainInstance.destroy();
        if (sunInstance) sunInstance.destroy();
      }
    };
  }

  return { mount: mount };
})();
