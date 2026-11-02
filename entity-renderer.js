// entity-renderer.js — Dashboard Entity scene renderer (foundation).
// The ONLY thing that draws a Dashboard Entity pack. It mounts one canvas inside #dash-entity and shows
// whatever EntityLVPackData.resolve() returns: the active imported/official pack, or the built-in LV1.
// It adds no state store, no ownership/activation logic and no pack parsing — those stay in
// entity-lvpack-data.js. Depends on (call time only): EntityLVPackData.
//
// LIFECYCLE
//   mount(host)  called by Dashboard.render() (idempotent). refresh() is also run on every
//                'lavender-entity-pack-change' event, so activation/clearActive/remove/import re-resolve at once.
//   refresh()    resolve() -> compare signature -> if the resolved pack differs: endSession() FIRST, then startSession().
//   session      the single live pack instance. There is exactly one slot (`session`); only refresh() fills it,
//                and endSession() always runs before a new one is built.
//   endSession() tears the session down completely (see "REPLACEMENT GUARANTEE").
//
// REPLACEMENT GUARANTEE
//   1. One slot. A second session cannot exist: startSession() is only reachable after endSession().
//   2. Everything a pack session owns goes through its `ctx` (timers, intervals, animation frames, listeners,
//      disposers, scratch state, canvases). endSession() cancels/removes every one of them and nulls the state.
//   3. Every ctx callback is wrapped with an alive-check, so even a callback that was already queued cannot
//      act after teardown.
//   4. The session's canvas is removed from the DOM and zeroed, and the next pack gets a brand-new canvas, so
//      no pixels can survive. The scene is always one whole pack: resolve() never mixes pack elements.
//   RULE FOR FUTURE CODE: anything that belongs to a pack (entity runtime, behaviours, effects) must be created
//   through the ctx passed to a session hook. A raw window.setTimeout/addEventListener is not tracked.
//
// NOT IMPLEMENTED YET (spec gaps, deliberately not guessed): the v1 spec has no entity placement field and no
// runtime semantics for entity lifecycle/behaviours, so entities and behaviours are not drawn or run in this
// phase. Only environments are painted. registerSessionHook() is the extension point for that later work.
const EntityRenderer = (function () {
  'use strict';

  const LOG = '[EntityRenderer] ';
  let host = null;          // #dash-entity (renderer-owned mount)
  let layer = null;         // renderer-owned wrapper inside host
  let observer = null;      // renderer-owned ResizeObserver
  let session = null;       // the ONE live pack session, or null
  let changeBound = false;
  let resizeBound = false;
  let lastError = '';
  const hooks = [];

  function warn(msg, err) { try { console.warn(LOG + msg, err || ''); } catch (e) { /* no console */ } }
  function data() { return typeof EntityLVPackData !== 'undefined' ? EntityLVPackData : null; }
  function byId(list, id) { for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function signature(res) {
    let json = '';
    try { json = JSON.stringify(res.pack); } catch (e) { json = ''; }
    return res.id + ':' + json.length + ':' + hash(json);
  }

  function parseHex(h) {
    let s = h.slice(1);
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  // ---------- painting (pure view of the validated manifest) ----------
  function frameCanvas(s, id) {
    if (s.frameCache[id]) return s.frameCache[id];
    const f = s.pack.frames[id], pal = s.pack.palettes[f.palette];
    const w = f.size.w, h = f.size.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h), d = img.data, rgb = {};
    for (let y = 0; y < h; y++) {
      const row = f.rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row.charAt(x);
        if (ch === '.') continue;
        const col = rgb[ch] || (rgb[ch] = parseHex(pal[ch]));
        const j = (y * w + x) * 4;
        d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    s.frameCache[id] = c;
    return c;
  }

  function composeEnvironment(s) {
    const env = byId(s.pack.environments, s.pack.entry.environment);
    if (!env) throw new Error('entry environment "' + s.pack.entry.environment + '" not found');
    const c = document.createElement('canvas');
    c.width = env.size.w; c.height = env.size.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    env.layers.forEach(function (l) { g.drawImage(frameCanvas(s, l.frame), l.x, l.y); }); // painter's order: first = back
    s.envCanvas = c;
    s.scene = { w: env.size.w, h: env.size.h };
  }

  function redraw(s) {
    if (!s.alive || !s.g) return;
    s.g.clearRect(0, 0, s.scene.w, s.scene.h);
        s.g.drawImage(s.envCanvas, 0, 0);
    if (s.overlay) {
      try { s.g.save(); s.overlay(s.g, s.scene); }
      catch (e) { warn('overlay failed', e); s.overlay = null; s.g.restore(); s.g.clearRect(0, 0, s.scene.w, s.scene.h); s.g.drawImage(s.envCanvas, 0, 0); return; }
      s.g.restore();
    }
  }

    // COVER: the scene always fills the whole box; whatever overflows is cropped evenly around the centre (the layer
  // centres the canvas and clips it), so the scene's centre is the fixed focal point at every box shape.
  // Integer scale when the scene must be enlarged (rounded UP so the box is always fully covered); fractional only
  // when the box is smaller than the scene in both directions. Hidden/zero-size boxes are skipped; the
  // ResizeObserver re-fits when the Dashboard becomes visible.
  function fit() {
    if (!session || !session.canvas || !host) return;
    const hw = host.clientWidth, hh = host.clientHeight;
    if (!hw || !hh) return;
    let k = Math.max(hw / session.scene.w, hh / session.scene.h);
    if (k >= 1) k = Math.ceil(k - 1e-9);
    session.canvas.style.width = Math.max(1, Math.ceil(session.scene.w * k - 1e-9)) + 'px';
    session.canvas.style.height = Math.max(1, Math.ceil(session.scene.h * k - 1e-9)) + 'px';
  }

  // ---------- the per-session ctx: the only sanctioned way for pack-owned code to hold a resource ----------
  function makeApi(s) {
    return Object.freeze({
      packId: s.id, pack: s.pack, scene: s.scene, canvas: s.canvas, envCanvas: s.envCanvas, state: s.state,
      alive: function () { return s.alive; },
            redrawEnvironment: function () { redraw(s); },
      // Optional per-session paint step run after the environment is drawn (receives the 2D context and scene size).
      setOverlay: function (fn) { if (s.alive) s.overlay = (typeof fn === 'function') ? fn : null; },
      setTimeout: function (fn, ms) {
        if (!s.alive) return 0;
        const id = setTimeout(function () { s.timeouts.delete(id); if (s.alive) { try { fn(); } catch (e) { warn('timer callback failed', e); } } }, ms);
        s.timeouts.add(id); return id;
      },
      clearTimeout: function (id) { if (s.timeouts.delete(id)) clearTimeout(id); },
      setInterval: function (fn, ms) {
        if (!s.alive) return 0;
        const id = setInterval(function () { if (s.alive) { try { fn(); } catch (e) { warn('interval callback failed', e); } } }, ms);
        s.intervals.add(id); return id;
      },
      clearInterval: function (id) { if (s.intervals.delete(id)) clearInterval(id); },
      requestFrame: function (fn) {
        if (!s.alive) return 0;
        const id = requestAnimationFrame(function (t) { s.rafs.delete(id); if (s.alive) { try { fn(t); } catch (e) { warn('frame callback failed', e); } } });
        s.rafs.add(id); return id;
      },
      cancelFrame: function (id) { if (s.rafs.delete(id)) cancelAnimationFrame(id); },
      on: function (target, type, fn, opts) {
        if (!s.alive || !target) return function () {};
        const wrapped = function (e) { if (s.alive) fn(e); };
        target.addEventListener(type, wrapped, opts);
        const rec = { target: target, type: type, wrapped: wrapped, opts: opts };
        s.listeners.push(rec);
        return function () { const i = s.listeners.indexOf(rec); if (i >= 0) { s.listeners.splice(i, 1); target.removeEventListener(type, wrapped, opts); } };
      },
      addDisposer: function (fn) { if (s.alive && typeof fn === 'function') s.disposers.push(fn); }
    });
  }

  // ---------- session start / end ----------
  function startSession(res, sig) {
    const s = {
      id: res.id, sig: sig, builtin: !!res.builtin, fallback: !!res.fallback, pack: res.pack, alive: true,
      timeouts: new Set(), intervals: new Set(), rafs: new Set(), listeners: [], disposers: [],
      frameCache: {}, state: {}, canvas: null, g: null, envCanvas: null, scene: null, api: null, overlay: null
    };
    session = s; // registered BEFORE building so endSession() can always clean a half-built session
    composeEnvironment(s);
    const cv = document.createElement('canvas');
    cv.width = s.scene.w; cv.height = s.scene.h;
    cv.style.display = 'block';
        cv.style.imageRendering = 'pixelated';
    cv.style.flex = 'none'; // cover can make the canvas larger than the layer; never let flex shrink (and squash) it
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', String(res.pack.name || 'Dashboard Entity'));
    s.canvas = cv;
    s.g = cv.getContext('2d');
    s.g.imageSmoothingEnabled = false;
    layer.appendChild(cv);
    s.api = makeApi(s);
    redraw(s);
    fit();
    hooks.slice().forEach(function (h) { try { h(s.api, s.pack, { id: s.id, builtin: s.builtin, fallback: s.fallback }); } catch (e) { warn('session hook failed', e); } });
  }

  function endSession() {
    const s = session;
    if (!s) return;
    session = null;
    s.alive = false; // from here every wrapped callback is inert
    s.disposers.splice(0).reverse().forEach(function (fn) { try { fn(); } catch (e) { warn('disposer failed', e); } });
    s.listeners.splice(0).forEach(function (r) { try { r.target.removeEventListener(r.type, r.wrapped, r.opts); } catch (e) { /* target gone */ } });
    s.timeouts.forEach(function (id) { clearTimeout(id); }); s.timeouts.clear();
    s.intervals.forEach(function (id) { clearInterval(id); }); s.intervals.clear();
    s.rafs.forEach(function (id) { cancelAnimationFrame(id); }); s.rafs.clear();
    if (s.canvas) { if (s.canvas.parentNode) s.canvas.parentNode.removeChild(s.canvas); s.canvas.width = 0; s.canvas.height = 0; }
    if (s.envCanvas) { s.envCanvas.width = 0; s.envCanvas.height = 0; }
    Object.keys(s.frameCache).forEach(function (k) { s.frameCache[k].width = 0; s.frameCache[k].height = 0; });
    s.frameCache = {}; s.overlay = null; s.state = null;s.canvas = s.g = s.envCanvas = s.api = s.pack = s.scene = null;
  }

  // ---------- host wiring ----------
  function buildLayer() {
    layer = document.createElement('div');
    layer.setAttribute('data-entity-layer', '');
    const st = layer.style;
    st.position = 'absolute'; st.left = '0'; st.top = '0'; st.right = '0'; st.bottom = '0';
    st.display = 'flex'; st.alignItems = 'center'; st.justifyContent = 'center';
    st.overflow = 'hidden'; st.zIndex = '0'; st.pointerEvents = 'none';
    host.insertBefore(layer, host.firstChild);
    try { if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) { /* ignore */ }
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(function () { fit(); }); observer.observe(host); }
    else if (!resizeBound) { resizeBound = true; window.addEventListener('resize', function () { fit(); }); }
  }

  function detachInfra() {
    if (observer) { try { observer.disconnect(); } catch (e) { /* ignore */ } observer = null; }
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
  }

  function bindChange() {
    const D = data();
    if (changeBound || !D || !D.CHANGE_EVENT) return;
    changeBound = true;
    window.addEventListener(D.CHANGE_EVENT, function () { if (host) refresh(); });
  }

  function refresh() {
    const D = data();
    if (!host || !layer || !D || typeof D.resolve !== 'function') { endSession(); return; }
    if (host.isConnected === false) { teardown(); return; }
    let res = null;
    try { res = D.resolve(); } catch (e) { warn('resolve() failed', e); }
    if (!res || !res.pack) { endSession(); lastError = 'no pack available (the built-in LV1 is not loaded)'; return; }
    const sig = signature(res);
    if (session && session.sig === sig) { fit(); return; } // same pack: keep the running session
    endSession(); // 1. the previous pack is gone completely...
    try { startSession(res, sig); lastError = ''; return; } // 2. ...then the next one is built from scratch
    catch (e) { warn('pack "' + res.id + '" failed to start', e); lastError = String(e && e.message || e); endSession(); }
    if (!res.builtin && typeof D.getBuiltin === 'function') { // runtime failure of an imported pack -> whole built-in LV1
      const b = D.getBuiltin();
      if (b && b.pack) {
        const fb = { id: b.id, pack: b.pack, builtin: true, fallback: true };
        try { startSession(fb, signature(fb)); } catch (e2) { warn('built-in LV1 failed to start', e2); endSession(); }
      }
    }
  }

  function mount(el) {
    try {
      if (!el) return;
      if (host !== el || !layer || layer.parentNode !== host) { endSession(); detachInfra(); host = el; buildLayer(); }
      bindChange();
      refresh();
    } catch (e) { warn('mount failed', e); }
  }

  function teardown() { endSession(); detachInfra(); host = null; }

  function registerSessionHook(fn) { if (typeof fn !== 'function') return false; hooks.push(fn); return true; }

  function getState() {
    const s = session;
    return {
      mounted: !!host, packId: s ? s.id : null, builtin: s ? s.builtin : null, fallback: s ? s.fallback : null,
      canvases: layer ? layer.children.length : 0, lastError: lastError,
      resources: s ? { timeouts: s.timeouts.size, intervals: s.intervals.size, rafs: s.rafs.size, listeners: s.listeners.length, disposers: s.disposers.length } : null
    };
  }

  return { mount: mount, refresh: refresh, teardown: teardown, registerSessionHook: registerSessionHook, getState: getState };
})();
