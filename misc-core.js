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

  return {
    prefersReducedMotion: prefersReducedMotion,
    ready: ready,
    rand: rand,
    randInt: randInt,
    pick: pick,
    clamp: clamp,
    createEl: createEl,
    injectStyle: injectStyle
  };
})();
