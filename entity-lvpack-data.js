// entity-lvpack-data.js — Dashboard Entity LV Packs: the dedicated manager.
// Owns, in isolation from My World / Assistant LV Packs: the formal pack specification, the
// validation pipeline, storage of imported packs, ownership of official (purchasable) packs,
// activation state and EXP purchasing. Nothing here touches MyWorldContent, AssistantLVPackData or
// MiscCosmetics' registry.
// Depends on (call time only): State (get / patch), GamificationData (getGamState / spendExp).
//
// STORAGE: State.get().settings.entityPacks = { v, installed: [{id, installedAt, pack}],
//   owned: [{id, at, price}], activeId }. Arrays (not id-keyed objects) so State.patch can replace
//   them wholesale. Nothing outside the `entityPacks` key is ever written.
//
// ENTITY LV PACK SPECIFICATION v1 (manifestVersion 1, engineVersion 1)
// A pack is ONE JSON document, <= 256 KB. Purely declarative — every field is whitelisted, unknown
// fields reject the pack, and no field can carry code, URLs, images or app-state access.
//   format "lv-pack", category "dashboard-entity", manifestVersion 1, engineVersion 1
//   id       lowercase letters/digits/. _ -, 3-64 chars (unique; "official" ids are reserved)
//   name, author (1-60 chars), version "x.y.z", description (optional, <= 300)
//   palettes   { <id>: { "<one char>": "#rrggbb", ... } }          "." is always transparent
//   frames     { <id>: { size:{w,h}, palette:<paletteId>, rows:[ "ascii pixel row", ... ] } }
//   animations { <id>: { frames:[<frameId>...], frameMs:50-10000, loop?:bool } }
//   behaviors  { <id>: {type:"loop", animation} | {type:"on-click", animation}
//                      | {type:"random-interval", animations:[...], minMs, maxMs} }
//   entities   [ { id, type:"pixel-sprite", name?, animations:[<animId>...],
//                  lifecycle:{ onEnter:<behId>, onIdle?:<behId>, onExit?:<behId> } } ]
//   environments [ { id, type:"pixel-scene", name?, size:{w,h}, layers:[{frame, x, y}...] } ]
//   entry      { environment:<envId>, entity:<entityId> }
// EXTENDING: new entity / environment / behavior types are added with registerEntityType /
// registerEnvironmentType / registerBehaviorType; new engine or manifest versions by extending
// SUPPORTED_ENGINE_VERSIONS / SUPPORTED_MANIFEST_VERSIONS.
const EntityLVPackData = (function () {
  'use strict';

  const CATEGORY = 'dashboard-entity';
  const FORMAT = 'lv-pack';
  const SUPPORTED_MANIFEST_VERSIONS = [1];
  const SUPPORTED_ENGINE_VERSIONS = [1];
  const STORE_VERSION = 1;
  const CHANGE_EVENT = 'lavender-entity-pack-change';

  const LIMITS = {
    maxFileBytes: 256 * 1024, maxDepth: 8, maxErrors: 12,
    maxName: 60, maxAuthor: 60, maxDescription: 300,
    palettes: 16, paletteColors: 32,
    frames: 128, frameDim: 256, spriteDim: 64,
    animations: 64, animationFrames: 64, frameMsMin: 50, frameMsMax: 10000,
    behaviors: 64, intervalMin: 500, intervalMax: 600000, randomAnims: 16,
    entities: 16, entityAnimations: 16,
    environments: 8, layers: 64, sceneDim: 256, layerOffset: 256,
    maxPrice: 100000
  };

  const PACK_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
  const LOCAL_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
  const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?)(?![a-z0-9])/i;
  const PROTO_KEYS = ['__proto__', 'constructor', 'prototype'];
  const FORBIDDEN_FIELDS = ['script', 'scripts', 'eval', 'javascript', 'js', 'function', 'onclick', 'onload',
    'onerror', 'url', 'uri', 'href', 'src', 'import', 'require', 'fetch', 'xhr', 'xmlhttprequest', 'websocket',
    'localstorage', 'sessionstorage', 'indexeddb', 'filesystem', 'exec', 'handler', 'handlers', 'include',
    'external', 'network', 'window', 'document', 'state', 'appstate', 'code'];

  // ---------- small helpers ----------
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isInt(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }
  function show(v) {
    if (v === undefined) return 'missing';
    let s; try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    if (s === undefined) s = String(v);
    return s.length > 40 ? s.slice(0, 37) + '…' : s;
  }
  function fail(msg) { return { ok: false, error: msg }; }
  function rejected(errors) { return { ok: false, errors: errors }; }

  function checkKeys(o, required, optional, path, bad) {
    Object.keys(o).forEach(function (k) {
      if (required.indexOf(k) >= 0 || optional.indexOf(k) >= 0) return;
      if (FORBIDDEN_FIELDS.indexOf(k.toLowerCase()) >= 0) bad(path, 'field "' + k + '" is not allowed (packs are declarative: no code, network, storage or app-state access).');
      else bad(path, 'unknown field "' + k + '".');
    });
    required.forEach(function (k) { if (!has(o, k)) bad(path, 'missing required field "' + k + '".'); });
  }

  function badString(s) {
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s)) return 'contains control characters.';
    if (/:\/\//.test(s) || /\b(?:javascript|vbscript|blob|https?|ftps?|wss?)\s*:/i.test(s) || /\bdata\s*:\s*[a-z]+\/[a-z0-9.+-]+/i.test(s)) return 'contains a URL or URI (external references are not allowed).';
    if (/<\/?[a-z!]/i.test(s)) return 'contains markup (HTML/SVG is not allowed).';
    if (/\b(?:eval|Function|setTimeout|setInterval|importScripts|fetch|XMLHttpRequest|WebSocket|require)\(/.test(s) || /=>/.test(s) || /\bfunction\s*[\w$]*\s*\(/.test(s)) return 'looks like executable code (scripts are not allowed).';
    if (IMAGE_EXT_RE.test(s)) return 'refers to an image/vector file (only procedural pixel maps are allowed).';
    return '';
  }

  // Deep scan of every value: prototype-pollution keys, URLs, markup, code, image references.
  // Pixel `rows` are skipped here and checked strictly against their palette instead.
  function scan(v, path, depth, bad) {
    if (depth > LIMITS.maxDepth) { bad(path, 'is nested too deeply.'); return; }
    if (typeof v === 'string') { const r = badString(v); if (r) bad(path, r); return; }
    if (Array.isArray(v)) { v.forEach(function (x, i) { scan(x, path + '[' + i + ']', depth + 1, bad); }); return; }
    if (isObj(v)) {
      Object.keys(v).forEach(function (k) {
        if (PROTO_KEYS.indexOf(k) >= 0) { bad(path, 'field "' + k + '" is not allowed.'); return; }
        if (k === 'rows' && Array.isArray(v[k])) return;
        scan(v[k], path ? path + '.' + k : k, depth + 1, bad);
      });
    }
  }

  function sizeOf(v, maxDim, path, bad) {
    if (!isObj(v)) { bad(path, 'must be an object like {"w": 8, "h": 8}.'); return null; }
    checkKeys(v, ['w', 'h'], [], path, bad);
    if (!isInt(v.w, 1, maxDim) || !isInt(v.h, 1, maxDim)) { bad(path, '"w" and "h" must be whole numbers from 1 to ' + maxDim + '.'); return null; }
    return { w: v.w, h: v.h };
  }

  function idMap(v, path, max, bad, itemFn) {
    if (!isObj(v)) { bad(path, 'must be an object.'); return; }
    const keys = Object.keys(v);
    if (!keys.length) bad(path, 'must not be empty.');
    if (keys.length > max) bad(path, 'has too many entries (' + keys.length + ', max ' + max + ').');
    keys.slice(0, max).forEach(function (k) {
      if (!LOCAL_ID_RE.test(k)) { bad(path, 'invalid id "' + k.slice(0, 32) + '" (lowercase letters, digits, - and _, starting with a letter, max 32).'); return; }
      itemFn(v[k], path + '.' + k, k);
    });
  }

  function refList(arr, path, bad) {
    const out = [];
    arr.forEach(function (id) {
      if (typeof id !== 'string' || !LOCAL_ID_RE.test(id)) bad(path, 'must refer to animation ids.');
      else out.push(id);
    });
    return out;
  }

  // ---------- extensible type registries ----------
  const BEHAVIOR_TYPES = {
    'loop': function (b, p, bad) {
      checkKeys(b, ['type', 'animation'], [], p, bad);
      return refList([b.animation], p + '.animation', bad);
    },
    'on-click': function (b, p, bad) {
      checkKeys(b, ['type', 'animation'], [], p, bad);
      return refList([b.animation], p + '.animation', bad);
    },
    'random-interval': function (b, p, bad) {
      checkKeys(b, ['type', 'animations', 'minMs', 'maxMs'], [], p, bad);
      let refs = [];
      if (!Array.isArray(b.animations) || !b.animations.length || b.animations.length > LIMITS.randomAnims) bad(p + '.animations', 'must list 1 to ' + LIMITS.randomAnims + ' animation ids.');
      else refs = refList(b.animations, p + '.animations', bad);
      const minOk = isInt(b.minMs, LIMITS.intervalMin, LIMITS.intervalMax);
      const maxOk = isInt(b.maxMs, LIMITS.intervalMin, LIMITS.intervalMax);
      if (!minOk) bad(p + '.minMs', 'must be a whole number of ms from ' + LIMITS.intervalMin + ' to ' + LIMITS.intervalMax + '.');
      if (!maxOk) bad(p + '.maxMs', 'must be a whole number of ms from ' + LIMITS.intervalMin + ' to ' + LIMITS.intervalMax + '.');
      if (minOk && maxOk && b.minMs > b.maxMs) bad(p, '"minMs" must not exceed "maxMs".');
      return refs;
    }
  };

  const ENTITY_TYPES = {
    'pixel-sprite': function (e, p, ctx, bad) {
      checkKeys(e, ['id', 'type', 'animations', 'lifecycle'], ['name'], p, bad);
      if (has(e, 'name') && (typeof e.name !== 'string' || !e.name.length || e.name.length > LIMITS.maxName)) bad(p + '.name', 'must be text of 1 to ' + LIMITS.maxName + ' characters.');
      const anims = [];
      if (!Array.isArray(e.animations) || !e.animations.length || e.animations.length > LIMITS.entityAnimations) {
        bad(p + '.animations', 'must list 1 to ' + LIMITS.entityAnimations + ' animation ids.');
      } else {
        let size = null;
        e.animations.forEach(function (id, i) {
          const ap = p + '.animations[' + i + ']';
          if (typeof id !== 'string' || !has(ctx.animSizes, id)) { bad(ap, 'refers to unknown animation ' + show(id) + '.'); return; }
          if (anims.indexOf(id) >= 0) { bad(ap, 'duplicate animation "' + id + '".'); return; }
          anims.push(id);
          const s = ctx.animSizes[id];
          if (!s) return;
          if (s.w > LIMITS.spriteDim || s.h > LIMITS.spriteDim) bad(ap, 'frames are larger than ' + LIMITS.spriteDim + 'x' + LIMITS.spriteDim + ' (sprite limit).');
          if (!size) size = s;
          else if (size.w !== s.w || size.h !== s.h) bad(ap, 'frame size ' + s.w + 'x' + s.h + ' differs from the entity\'s other animations (' + size.w + 'x' + size.h + ').');
        });
      }
      if (!isObj(e.lifecycle)) { bad(p + '.lifecycle', 'must be an object with at least "onEnter".'); return; }
      checkKeys(e.lifecycle, ['onEnter'], ['onIdle', 'onExit'], p + '.lifecycle', bad);
      Object.keys(e.lifecycle).forEach(function (k) {
        const lp = p + '.lifecycle.' + k, bid = e.lifecycle[k];
        if (['onEnter', 'onIdle', 'onExit'].indexOf(k) < 0) return;
        if (typeof bid !== 'string' || !has(ctx.behRefs, bid)) { bad(lp, 'refers to unknown behavior ' + show(bid) + '.'); return; }
        ctx.behRefs[bid].forEach(function (aid) {
          if (anims.indexOf(aid) < 0) bad(lp, 'behavior "' + bid + '" plays animation "' + aid + '", which this entity does not list in "animations".');
        });
      });
    }
  };

  const ENVIRONMENT_TYPES = {
    'pixel-scene': function (s, p, ctx, bad) {
      checkKeys(s, ['id', 'type', 'size', 'layers'], ['name'], p, bad);
      if (has(s, 'name') && (typeof s.name !== 'string' || !s.name.length || s.name.length > LIMITS.maxName)) bad(p + '.name', 'must be text of 1 to ' + LIMITS.maxName + ' characters.');
      sizeOf(s.size, LIMITS.sceneDim, p + '.size', bad);
      if (!Array.isArray(s.layers) || !s.layers.length || s.layers.length > LIMITS.layers) { bad(p + '.layers', 'must list 1 to ' + LIMITS.layers + ' layers.'); return; }
      s.layers.forEach(function (l, i) {
        const lp = p + '.layers[' + i + ']';
        if (!isObj(l)) { bad(lp, 'must be an object.'); return; }
        checkKeys(l, ['frame', 'x', 'y'], [], lp, bad);
        if (typeof l.frame !== 'string' || !has(ctx.frameSizes, l.frame)) bad(lp + '.frame', 'refers to unknown frame ' + show(l.frame) + '.');
        ['x', 'y'].forEach(function (a) {
          if (!isInt(l[a], -LIMITS.layerOffset, LIMITS.layerOffset)) bad(lp + '.' + a, 'must be a whole number from -' + LIMITS.layerOffset + ' to ' + LIMITS.layerOffset + '.');
        });
      });
    }
  };

  function registerType(registry, name, fn) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(name) || typeof fn !== 'function' || has(registry, name)) return false;
    registry[name] = fn;
    return true;
  }

  function validateTyped(list, path, max, registry, label, ctx, bad) {
    const ids = [];
    if (!Array.isArray(list)) { bad(path, 'must be an array.'); return ids; }
    if (!list.length) bad(path, 'must contain at least one item.');
    if (list.length > max) bad(path, 'has too many items (' + list.length + ', max ' + max + ').');
    list.slice(0, max).forEach(function (item, i) {
      const p = path + '[' + i + ']';
      if (!isObj(item)) { bad(p, 'must be an object.'); return; }
      if (typeof item.id !== 'string' || !LOCAL_ID_RE.test(item.id)) bad(p + '.id', 'must be a valid id (lowercase letters, digits, - and _, starting with a letter, max 32).');
      else if (ids.indexOf(item.id) >= 0) bad(p + '.id', 'duplicate id "' + item.id + '".');
      else ids.push(item.id);
      const fn = typeof item.type === 'string' && has(registry, item.type) ? registry[item.type] : null;
      if (!fn) { bad(p + '.type', 'unsupported ' + label + ' ' + show(item.type) + ' (supported: ' + Object.keys(registry).join(', ') + ').'); return; }
      fn(item, p, ctx, bad);
    });
    return ids;
  }

  // ---------- the validation pipeline ----------
  function validate(pack) {
    const errors = [];
    let total = 0;
    function bad(path, msg) {
      total++;
      if (errors.length < LIMITS.maxErrors) errors.push(((path ? path + ': ' : '') + msg).slice(0, 220));
    }
    function done() {
      if (total > errors.length) errors.push('…and ' + (total - errors.length) + ' more problem(s).');
      return { ok: total === 0, errors: errors };
    }

    if (!isObj(pack)) { bad('', 'the pack must be a JSON object.'); return done(); }
    if (pack.format !== FORMAT || pack.category !== CATEGORY) {
      bad('', 'this is not a Dashboard Entity LV Pack (expected format "' + FORMAT + '" and category "' + CATEGORY + '").');
      return done();
    }
    if (SUPPORTED_MANIFEST_VERSIONS.indexOf(pack.manifestVersion) < 0) {
      bad('manifestVersion', 'unsupported manifest version ' + show(pack.manifestVersion) + ' (supported: ' + SUPPORTED_MANIFEST_VERSIONS.join(', ') + ').');
      return done();
    }
    if (SUPPORTED_ENGINE_VERSIONS.indexOf(pack.engineVersion) < 0) {
      bad('engineVersion', 'unsupported LV Engine version ' + show(pack.engineVersion) + ' (supported: ' + SUPPORTED_ENGINE_VERSIONS.join(', ') + ').');
      return done();
    }

    scan(pack, '', 0, bad);
    checkKeys(pack, ['format', 'category', 'manifestVersion', 'engineVersion', 'id', 'name', 'version', 'author',
      'palettes', 'frames', 'animations', 'behaviors', 'entities', 'environments', 'entry'], ['description'], 'pack', bad);

    if (typeof pack.id !== 'string' || !PACK_ID_RE.test(pack.id)) bad('id', 'must be 3-64 characters: lowercase letters, digits, "." "_" "-", starting with a letter or digit.');
    if (typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > LIMITS.maxName) bad('name', 'must be text of 1 to ' + LIMITS.maxName + ' characters.');
    if (typeof pack.author !== 'string' || !pack.author.trim() || pack.author.length > LIMITS.maxAuthor) bad('author', 'must be text of 1 to ' + LIMITS.maxAuthor + ' characters.');
    if (typeof pack.version !== 'string' || !SEMVER_RE.test(pack.version)) bad('version', 'must look like "1.0.0".');
    if (has(pack, 'description') && (typeof pack.description !== 'string' || pack.description.length > LIMITS.maxDescription)) bad('description', 'must be text of at most ' + LIMITS.maxDescription + ' characters.');

    // palettes
    const palettes = isObj(pack.palettes) ? pack.palettes : {};
    idMap(pack.palettes, 'palettes', LIMITS.palettes, bad, function (pal, p) {
      if (!isObj(pal)) { bad(p, 'must be an object of colour characters.'); return; }
      const ks = Object.keys(pal);
      if (!ks.length) bad(p, 'must define at least one colour.');
      if (ks.length > LIMITS.paletteColors) bad(p, 'has too many colours (' + ks.length + ', max ' + LIMITS.paletteColors + ').');
      ks.slice(0, LIMITS.paletteColors).forEach(function (ch) {
        if (ch.length !== 1 || ch === '.' || /[\s\u0000-\u001F\u007F]/.test(ch)) bad(p, 'colour key "' + ch.slice(0, 4) + '" must be one visible character other than "." ("." is transparent).');
        else if (typeof pal[ch] !== 'string' || !HEX_RE.test(pal[ch])) bad(p + '.' + ch, 'must be a hex colour like "#7f9a5c".');
      });
    });

    // frames
    const frameSizes = Object.create(null);
    idMap(pack.frames, 'frames', LIMITS.frames, bad, function (f, p, id) {
      if (!isObj(f)) { bad(p, 'must be an object.'); return; }
      checkKeys(f, ['size', 'palette', 'rows'], [], p, bad);
      const size = sizeOf(f.size, LIMITS.frameDim, p + '.size', bad);
      if (size) frameSizes[id] = size;
      const pal = typeof f.palette === 'string' && has(palettes, f.palette) && isObj(palettes[f.palette]) ? palettes[f.palette] : null;
      if (!pal) bad(p + '.palette', 'refers to unknown palette ' + show(f.palette) + '.');
      if (!Array.isArray(f.rows)) { bad(p + '.rows', 'must be an array of pixel-row strings.'); return; }
      if (size && f.rows.length !== size.h) bad(p + '.rows', 'has ' + f.rows.length + ' rows but size.h is ' + size.h + '.');
      let reported = 0;
      f.rows.slice(0, LIMITS.frameDim).forEach(function (row, y) {
        if (reported >= 3) return;
        if (typeof row !== 'string') { reported++; bad(p + '.rows[' + y + ']', 'must be a string.'); return; }
        if (size && row.length !== size.w) { reported++; bad(p + '.rows[' + y + ']', 'is ' + row.length + ' characters wide but size.w is ' + size.w + '.'); return; }
        if (!pal) return;
        for (let x = 0; x < row.length; x++) {
          const ch = row.charAt(x);
          if (ch !== '.' && !has(pal, ch)) { reported++; bad(p + '.rows[' + y + ']', 'character "' + ch + '" at column ' + (x + 1) + ' is not in palette "' + f.palette + '".'); return; }
        }
      });
    });

    // animations
    const animSizes = Object.create(null);
    idMap(pack.animations, 'animations', LIMITS.animations, bad, function (a, p, id) {
      if (!isObj(a)) { bad(p, 'must be an object.'); return; }
      checkKeys(a, ['frames', 'frameMs'], ['loop'], p, bad);
      if (!isInt(a.frameMs, LIMITS.frameMsMin, LIMITS.frameMsMax)) bad(p + '.frameMs', 'must be a whole number of ms from ' + LIMITS.frameMsMin + ' to ' + LIMITS.frameMsMax + '.');
      if (has(a, 'loop') && typeof a.loop !== 'boolean') bad(p + '.loop', 'must be true or false.');
      let size = null, consistent = true, ok = true;
      if (!Array.isArray(a.frames) || !a.frames.length || a.frames.length > LIMITS.animationFrames) {
        bad(p + '.frames', 'must list 1 to ' + LIMITS.animationFrames + ' frame ids.'); ok = false;
      } else {
        a.frames.forEach(function (fid, i) {
          if (typeof fid !== 'string' || !has(pack.frames || {}, fid)) { bad(p + '.frames[' + i + ']', 'refers to unknown frame ' + show(fid) + '.'); ok = false; return; }
          const s = frameSizes[fid];
          if (!s) { ok = false; return; }
          if (!size) size = s;
          else if (s.w !== size.w || s.h !== size.h) { if (consistent) bad(p + '.frames[' + i + ']', 'frame size ' + s.w + 'x' + s.h + ' differs from the animation\'s first frame (' + size.w + 'x' + size.h + ').'); consistent = false; }
        });
      }
      animSizes[id] = ok && consistent ? size : null;
    });

    // behaviors
    const behRefs = Object.create(null);
    idMap(pack.behaviors, 'behaviors', LIMITS.behaviors, bad, function (b, p, id) {
      if (!isObj(b)) { bad(p, 'must be an object.'); return; }
      const fn = typeof b.type === 'string' && has(BEHAVIOR_TYPES, b.type) ? BEHAVIOR_TYPES[b.type] : null;
      if (!fn) { bad(p + '.type', 'unsupported behavior type ' + show(b.type) + ' (supported: ' + Object.keys(BEHAVIOR_TYPES).join(', ') + ').'); return; }
      const refs = fn(b, p, bad) || [];
      refs.forEach(function (aid) { if (!has(animSizes, aid)) bad(p, 'plays unknown animation "' + aid + '".'); });
      behRefs[id] = refs;
    });

    // entities / environments / entry
    const ctx = { pack: pack, frameSizes: frameSizes, animSizes: animSizes, behRefs: behRefs };
    const entityIds = validateTyped(pack.entities, 'entities', LIMITS.entities, ENTITY_TYPES, 'entity type', ctx, bad);
    const envIds = validateTyped(pack.environments, 'environments', LIMITS.environments, ENVIRONMENT_TYPES, 'environment type', ctx, bad);
    if (!isObj(pack.entry)) bad('entry', 'must be an object with "environment" and "entity".');
    else {
      checkKeys(pack.entry, ['environment', 'entity'], [], 'entry', bad);
      if (typeof pack.entry.environment !== 'string' || envIds.indexOf(pack.entry.environment) < 0) bad('entry.environment', 'refers to unknown environment ' + show(pack.entry.environment) + '.');
      if (typeof pack.entry.entity !== 'string' || entityIds.indexOf(pack.entry.entity) < 0) bad('entry.entity', 'refers to unknown entity ' + show(pack.entry.entity) + '.');
    }
    return done();
  }

  function parseText(text) {
    if (typeof text !== 'string') return { ok: false, errors: ['Could not read the file.'] };
    if (text.length > LIMITS.maxFileBytes) return { ok: false, errors: ['The pack is too large (' + Math.ceil(text.length / 1024) + ' KB; limit ' + (LIMITS.maxFileBytes / 1024) + ' KB).'] };
    let obj;
    try { obj = JSON.parse(text.replace(/^﻿/, '')); }
    catch (e) { return { ok: false, errors: ['The file is not valid JSON (' + String(e && e.message || e).slice(0, 100) + ').'] }; }
    const r = validate(obj);
    return { ok: r.ok, errors: r.errors, pack: r.ok ? obj : null };
  }

  // ---------- storage (settings.entityPacks only) ----------
  function readStore() {
    const s = { v: STORE_VERSION, installed: [], owned: [], activeId: null };
    let raw = null;
    try { raw = (State.get().settings || {}).entityPacks; } catch (e) { raw = null; }
    if (!isObj(raw)) return s;
    if (Array.isArray(raw.installed)) raw.installed.forEach(function (e) { if (isObj(e) && typeof e.id === 'string') s.installed.push(e); });
    if (Array.isArray(raw.owned)) raw.owned.forEach(function (o) { if (isObj(o) && typeof o.id === 'string') s.owned.push(o); });
    if (typeof raw.activeId === 'string') s.activeId = raw.activeId;
    return s;
  }

  function notify() {
    try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch (e) { /* no window */ }
  }

  // Applies `mutator` to a copy and saves it. Returns true only if State.patch confirms the save.
  function commit(mutator) {
    const next = JSON.parse(JSON.stringify(readStore()));
    if (mutator(next) === false) return false;
    let ok = false;
    try { ok = !!State.patch('settings', { entityPacks: next }); } catch (e) { ok = false; }
    if (ok) notify();
    return ok;
  }

  function findInstalled(st, id) {
    for (let i = 0; i < st.installed.length; i++) if (st.installed[i].id === id) return st.installed[i];
    return null;
  }
  function isOwnedIn(st, id) { return st.owned.some(function (o) { return o.id === id; }); }

  // ---------- official (purchasable) catalog ----------
  const official = Object.create(null); // id -> { manifest, price }

  // ---------- built-in default (LV1) ----------
  // Hardcoded by entity-lv1.js. Validated by the same validate() as every other pack, but never written to
  // settings.entityPacks, so it cannot be imported over, bought, removed or deactivated-away. Its id is reserved.
  let builtin = null; // { id, manifest }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); }
    return o;
  }
  function isBuiltinId(id) { return !!builtin && builtin.id === id; }
  function registerBuiltin(manifest) {
    if (builtin) return rejected(['the built-in Dashboard Entity pack is already registered.']);
    const r = validate(manifest);
    if (!r.ok) { console.warn('[EntityLVPack] built-in pack rejected:', manifest && manifest.id, r.errors); return rejected(r.errors); }
    if (has(official, manifest.id)) return rejected(['id: "' + manifest.id + '" is already used by an official pack.']);
    builtin = { id: manifest.id, manifest: deepFreeze(JSON.parse(JSON.stringify(manifest))) };
    return { ok: true, id: manifest.id };
  }
  function getBuiltin() { return builtin ? { id: builtin.id, pack: builtin.manifest } : null; }

  function registerOfficial(manifest, price) {
    const r = validate(manifest);
    if (!r.ok) { console.warn('[EntityLVPack] official pack rejected:', manifest && manifest.id, r.errors); return rejected(r.errors); }
    if (!isInt(price, 0, LIMITS.maxPrice)) return rejected(['price must be a whole number of EXP from 0 to ' + LIMITS.maxPrice + '.']);
    if (has(official, manifest.id)) return rejected(['an official pack with id "' + manifest.id + '" is already registered.']);
    if (isBuiltinId(manifest.id)) return rejected(['id "' + manifest.id + '" is reserved for the built-in pack.']);
    official[manifest.id] = { manifest: JSON.parse(JSON.stringify(manifest)), price: price };
    return { ok: true };
  }

  function lookupPack(st, id) {
    const imp = findInstalled(st, id);
    if (imp) return imp.pack;
    if (isOwnedIn(st, id) && has(official, id)) return official[id].manifest;
    return null;
  }

  // ---------- public operations ----------
  function importText(text) {
    const parsed = parseText(text);
    if (!parsed.ok) return rejected(parsed.errors);
    const pack = parsed.pack;
    if (has(official, pack.id)) return rejected(['id: "' + pack.id + '" is reserved for an official pack.']);
    if (isBuiltinId(pack.id)) return rejected(['id: "' + pack.id + '" is reserved for the built-in pack.']);
    if (findInstalled(readStore(), pack.id)) return rejected(['id: a pack with id "' + pack.id + '" is already installed. Remove it first to import a different copy.']);
    const saved = commit(function (next) { next.installed.push({ id: pack.id, installedAt: Date.now(), pack: pack }); });
    if (!saved) return rejected(['Could not save the pack (device storage may be full). Nothing was imported.']);
    return { ok: true, id: pack.id, name: pack.name, version: pack.version };
  }

  function importFile(file) {
    return new Promise(function (resolve) {
      if (!file) { resolve(rejected(['No file was chosen.'])); return; }
      if (file.size > LIMITS.maxFileBytes) { resolve(rejected(['The file is too large (' + Math.ceil(file.size / 1024) + ' KB; limit ' + (LIMITS.maxFileBytes / 1024) + ' KB).'])); return; }
      const reader = new FileReader();
      reader.onload = function () {
        let r;
        try { r = importText(String(reader.result)); }
        catch (err) { r = rejected(['Unexpected error while checking the pack. Nothing was imported.']); }
        resolve(r);
      };
      reader.onerror = function () { resolve(rejected(['Could not read that file.'])); };
      reader.readAsText(file);
    });
  }

  function listAvailable() {
    const st = readStore(), out = [];
    st.installed.forEach(function (e) {
      const r = validate(e.pack);
      const p = isObj(e.pack) ? e.pack : {};
      out.push({ id: e.id, name: typeof p.name === 'string' ? p.name : e.id, version: p.version, author: p.author, description: p.description,
        source: 'imported', active: st.activeId === e.id, valid: r.ok, reason: r.ok ? '' : r.errors[0] });
    });
    st.owned.forEach(function (o) {
      const off = has(official, o.id) ? official[o.id] : null;
      const r = off ? validate(off.manifest) : null;
      out.push({ id: o.id, name: off ? off.manifest.name : o.id, version: off && off.manifest.version, author: off && off.manifest.author,
        description: off && off.manifest.description, source: 'official', active: st.activeId === o.id,
        valid: !!(r && r.ok), reason: off ? (r.ok ? '' : r.errors[0]) : 'This official pack is not included in this version of the app.' });
    });
    return out;
  }

  function listOfficial() {
    const st = readStore();
    return Object.keys(official).map(function (id) {
      const m = official[id].manifest;
      return { id: id, name: m.name, version: m.version, author: m.author, description: m.description,
        price: official[id].price, owned: isOwnedIn(st, id) };
    });
  }

  function getActive() {
    try {
      const st = readStore();
      if (!st.activeId) return { status: 'none' };
      const pack = lookupPack(st, st.activeId);
      if (!pack) return { status: 'missing', id: st.activeId, reason: 'the pack is no longer installed' };
      const r = validate(pack);
      if (!r.ok) return { status: 'invalid', id: st.activeId, reason: r.errors[0], errors: r.errors };
      return { status: 'ok', id: st.activeId, pack: pack };
    } catch (err) {
      return { status: 'invalid', id: null, reason: 'unexpected error while loading the pack' };
    }
  }

  // What the renderer must show. ALWAYS answers with one whole pack: the active imported/official pack when it is
  // present and passes validation, otherwise the built-in LV1 (none / missing / invalid / unexpected error).
  // getActive() is deliberately unchanged, so the Cosmetics UI keeps its status messages and "Use default" button.
  function resolve() {
    let act;
    try { act = getActive(); } catch (err) { act = { status: 'invalid', id: null, reason: 'unexpected error while loading the pack' }; }
    if (act.status === 'ok' && !isBuiltinId(act.id)) return { id: act.id, pack: act.pack, builtin: false, fallback: false, reason: '' };
    return { id: builtin ? builtin.id : null, pack: builtin ? builtin.manifest : null, builtin: true,
      fallback: act.status === 'missing' || act.status === 'invalid', reason: act.reason || (builtin ? '' : 'the built-in pack is not loaded') };
  }

  function setActive(id) {
    if (isBuiltinId(id)) return clearActive(); // activating LV1 == restoring the default
    const st = readStore();
    const pack = lookupPack(st, id);
    if (!pack) return fail('That pack is not installed or owned.');
    const r = validate(pack);
    if (!r.ok) return fail('That pack no longer passes validation: ' + r.errors[0]);
    if (st.activeId === id) return { ok: true };
    return commit(function (next) { next.activeId = id; }) ? { ok: true } : fail('Could not save your choice.');
  }

  function clearActive() {
    if (!readStore().activeId) return { ok: true };
    return commit(function (next) { next.activeId = null; }) ? { ok: true } : fail('Could not save your choice.');
  }

  function remove(id) {
    const st = readStore();
    if (!findInstalled(st, id)) return fail(isOwnedIn(st, id) ? 'Official packs you bought cannot be removed.' : 'That pack is not installed.');
    return commit(function (next) {
      next.installed = next.installed.filter(function (e) { return e.id !== id; });
      if (next.activeId === id) next.activeId = null;
    }) ? { ok: true } : fail('Could not save the change.');
  }

  // Read-only manifest lookup for display (previews): installed, official (owned or not) or the built-in. Callers must not mutate it.
  function getManifest(id) {
    if (isBuiltinId(id)) return builtin.manifest;
    const imp = findInstalled(readStore(), id);
    if (imp && isObj(imp.pack)) return imp.pack;
    return has(official, id) ? official[id].manifest : null;
  }

  function getBalance() {
    try { return GamificationData.getGamState().totalExp; } catch (e) { return 0; }
  }

  // Ownership is recorded first and rolled back if the existing EXP economy refuses the charge,
  // so a failed purchase never leaves a free pack, and a failed save never charges EXP.
  function purchase(id) {
    const off = has(official, id) ? official[id] : null;
    if (!off) return fail('That pack is not for sale.');
    const st = readStore();
    if (isOwnedIn(st, id)) return fail('You already own this pack.');
    if (findInstalled(st, id)) return fail('You already have an imported pack with this id. Remove it first.');
    if (typeof GamificationData === 'undefined' || typeof GamificationData.spendExp !== 'function') return fail('The Store is unavailable right now.');
    const have = getBalance();
    if (have < off.price) return fail('Not enough EXP (needs ' + off.price + ', you have ' + have + ').');
    const saved = commit(function (next) { next.owned.push({ id: id, at: Date.now(), price: off.price }); });
    if (!saved) return fail('Could not save your purchase. You were not charged.');
    let paid = false;
    try { paid = GamificationData.spendExp(off.price, 'Dashboard Entity pack: ' + off.manifest.name); } catch (e) { paid = false; }
    if (!paid) {
      commit(function (next) { next.owned = next.owned.filter(function (o) { return o.id !== id; }); });
      return fail('Not enough EXP (needs ' + off.price + ').');
    }
    return { ok: true, name: off.manifest.name };
  }

  return {
    CATEGORY: CATEGORY, CHANGE_EVENT: CHANGE_EVENT, LIMITS: LIMITS,
    spec: function () {
      return { format: FORMAT, category: CATEGORY, manifestVersions: SUPPORTED_MANIFEST_VERSIONS.slice(), engineVersions: SUPPORTED_ENGINE_VERSIONS.slice(),
        entityTypes: Object.keys(ENTITY_TYPES), environmentTypes: Object.keys(ENVIRONMENT_TYPES), behaviorTypes: Object.keys(BEHAVIOR_TYPES) };
    },
    registerEntityType: function (n, fn) { return registerType(ENTITY_TYPES, n, fn); },
    registerEnvironmentType: function (n, fn) { return registerType(ENVIRONMENT_TYPES, n, fn); },
    registerBehaviorType: function (n, fn) { return registerType(BEHAVIOR_TYPES, n, fn); },
    validate: validate, parseText: parseText,
    importText: importText, importFile: importFile,
    registerOfficial: registerOfficial, listOfficial: listOfficial, purchase: purchase,
    listAvailable: listAvailable, getActive: getActive, setActive: setActive, clearActive: clearActive,
    remove: remove, getBalance: getBalance, getManifest: getManifest,
    registerBuiltin: registerBuiltin, getBuiltin: getBuiltin, resolve: resolve
  };
})();
