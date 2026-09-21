/*
 * Lavender — Miscellaneous sound-effect layer.
 *
 * Tiny, synthesized (no external audio files) interaction sounds for
 * the Miscellaneous system: paper press, washi movement, pin click,
 * stamp, butterfly chime, firefly sparkle, candle ignite/ambience,
 * rain/sunlight ambience, ladybug tap.
 *
 * Reuses the existing Settings sound flag (State.get().settings.soundEnabled)
 * instead of creating a second global settings system — see isEnabled()
 * below. Ambience sounds are strictly opt-in (never auto-played by this
 * file) and kept short/quiet so they never compete with Radio/Music
 * Player audio.
 */
const MiscSound = (function () {
  let ctx = null;
  let masterGain = null;
  let manualOverride = null; // null = defer to Settings; true/false = explicit override

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.18; // deliberately quiet — these are accents, not music
    masterGain.connect(ctx.destination);
    return ctx;
  }

  function isEnabled() {
    if (manualOverride !== null) return manualOverride;
    try {
      if (typeof State !== 'undefined' && State.get) {
        const settings = State.get().settings;
        if (settings && typeof settings.soundEnabled === 'boolean') {
          return settings.soundEnabled;
        }
      }
    } catch (e) { /* State not ready yet — fall through to default */ }
    return true;
  }

  function setEnabled(enabled) {
    manualOverride = !!enabled;
  }

  function clearOverride() {
    manualOverride = null;
  }

  function tone(spec) {
    const audioCtx = ensureContext();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    const duration = spec.duration || 0.18;

    osc.type = spec.type || 'sine';
    osc.frequency.setValueAtTime(spec.freq, now);
    if (spec.freqTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqTo), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.gain || 0.6, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function noiseBurst(spec) {
    const audioCtx = ensureContext();
    if (!audioCtx) return;
    const duration = spec.duration || 0.08;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * decay * (spec.intensity || 0.3);
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.cutoff || 2500;
    source.connect(filter);
    filter.connect(masterGain);
    source.start();
  }

  const RECIPES = {
    paperPress: function () { noiseBurst({ duration: 0.05, intensity: 0.25, cutoff: 1800 }); },
    paperMove: function () { noiseBurst({ duration: 0.12, intensity: 0.18, cutoff: 2200 }); },
    washiMove: function () { noiseBurst({ duration: 0.1, intensity: 0.15, cutoff: 3000 }); },
    pinClick: function () { tone({ freq: 900, freqTo: 700, duration: 0.06, type: 'triangle', gain: 0.4 }); },
    stamp: function () { noiseBurst({ duration: 0.06, intensity: 0.35, cutoff: 900 }); },
    pageMove: function () { noiseBurst({ duration: 0.15, intensity: 0.15, cutoff: 2600 }); },
    butterflyChime: function () { tone({ freq: 1046, freqTo: 1568, duration: 0.4, type: 'sine', gain: 0.35 }); },
    fireflySparkle: function () { tone({ freq: 1400, freqTo: 2000, duration: 0.15, type: 'sine', gain: 0.25 }); },
    candleIgnite: function () { noiseBurst({ duration: 0.2, intensity: 0.2, cutoff: 1600 }); },
    candleAmbience: function () { tone({ freq: 220, duration: 0.6, type: 'sine', gain: 0.08 }); },
    rainAmbience: function () { noiseBurst({ duration: 0.5, intensity: 0.06, cutoff: 3500 }); },
    sunlightAmbience: function () { tone({ freq: 660, duration: 0.8, type: 'sine', gain: 0.06 }); },
    ladybugTap: function () { tone({ freq: 500, freqTo: 650, duration: 0.05, type: 'triangle', gain: 0.3 }); },

    // --- General UI layer (buttons, nav, modals, save/error, small wins) ---
    // Kept deliberately quieter/shorter than the Miscellaneous decor sounds above,
    // since these fire far more often across the whole app.
    uiClick: function () { tone({ freq: 720, freqTo: 560, duration: 0.045, type: 'sine', gain: 0.22 }); },
    uiNav: function () { tone({ freq: 520, freqTo: 640, duration: 0.09, type: 'sine', gain: 0.16 }); },
    uiOpen: function () { tone({ freq: 480, freqTo: 600, duration: 0.11, type: 'sine', gain: 0.18 }); },
    uiClose: function () { tone({ freq: 600, freqTo: 460, duration: 0.09, type: 'sine', gain: 0.16 }); },
    uiSave: function () { tone({ freq: 660, freqTo: 880, duration: 0.16, type: 'sine', gain: 0.24 }); },
    uiSuccess: function () { tone({ freq: 900, freqTo: 1100, duration: 0.08, type: 'sine', gain: 0.16 }); },
    uiError: function () { tone({ freq: 340, freqTo: 260, duration: 0.16, type: 'triangle', gain: 0.2 }); }
  };

  function play(name) {
    if (!isEnabled()) return;
    const recipe = RECIPES[name];
    if (!recipe) return;
    // Audio needs a user gesture in most browsers; play() is only ever
    // called from click/keyboard handlers by the modules that use it,
    // so resuming a suspended context on first gesture happens naturally.
    if (ctx && ctx.state === 'suspended') ctx.resume();
    try { recipe(); } catch (e) { /* never let a decorative sound break the UI */ }
  }

  // --- Global UI click layer ---------------------------------------------
  // Single delegated listener for every plain <button> click app-wide, so
  // individual screens/modules don't each need their own click-sound wiring.
  // Deliberately scoped to real buttons only (never checkboxes, text inputs,
  // links, or generic divs) to avoid noisy/unexpected firing. Nav buttons,
  // modal-driven flows, and a few specific "success"/"error" moments call
  // MiscSound.play() directly elsewhere for a more distinct sound, and are
  // excluded here via data-nosound so a click never plays twice.
  let globalUIBound = false;
  function bindGlobalUI() {
    if (globalUIBound) return;
    globalUIBound = true;
    document.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn || btn.disabled) return;
      // These already get a more distinct sound from their own module
      // (nav.js / modal.js) — skip here so a click never plays twice.
      if (btn.hasAttribute('data-nosound') || btn.classList.contains('nav-btn') || btn.classList.contains('modal-close-btn')) return;
      play('uiClick');
    }, true);
  }

  return {
    play: play,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    clearOverride: clearOverride,
    bindGlobalUI: bindGlobalUI,
    SOUND_NAMES: Object.keys(RECIPES)
  };
})();
