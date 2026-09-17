// settings.js — Settings scaffold (§B.9). Not a full settings screen — only the entry points a
// shipped feature already needs: default break duration + notification/sound/vibration toggles
// (§B.3, already read by notify.js and study.js), break wallpaper upload (item 8 — §B.17's
// "postponed" note is now superseded by that explicit request), Assistant's cosmetic name label,
// and Backup/Restore/Export/Clear-data (§B.10). Icon lives outside the tab screens, same pattern
// as #assistant-icon.
// Depends on: State, Modal, Backup.
//
// Styling Phase 3: hooked into the shared primitives only (.modal-header/.modal-title,
// .form-row, .divider, .btn-secondary/.btn-danger, .micro-label) — no new Settings-screen
// layout system, that's Phase 12 refinement territory.
const Settings = (function () {
  const APP_VERSION = '0.5';

  function settings() { return State.get().settings || {}; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }

  function formHtml() {
    const cur = settings();
    return (
      '<div class="modal-header"><h3 class="modal-title">Settings</h3></div>' +

      '<div class="form-row"><label for="settings-wallpaper-input">Break wallpaper</label>' +
      '<input type="file" id="settings-wallpaper-input" accept="image/*">' +
      (cur.breakWallpaper
        ? '<img id="settings-wallpaper-preview" src="' + cur.breakWallpaper + '">' +
          '<button id="settings-wallpaper-remove" class="btn-secondary">Remove wallpaper</button>'
        : '<span id="settings-wallpaper-status" class="micro-label"></span>') +
      '</div>' +

      '<hr class="divider">' +

      '<div class="form-row"><label for="settings-study-wallpaper-input">Study wallpapers</label>' +
      '<input type="file" id="settings-study-wallpaper-input" accept="image/*,video/mp4,video/webm" multiple>' +
      '<div id="settings-study-wallpaper-grid" class="settings-wallpaper-grid">' +
      (cur.studyWallpapers || []).map(function (item, i) {
        const isVideo = item && typeof item === 'object' && item.type === 'video';
        const url = (item && typeof item === 'object') ? item.url : item;
        return '<div class="settings-wallpaper-thumb">' +
          (isVideo
                  ? '<video src="' + url + '" muted loop playsinline autoplay></video>'
            : '<img src="' + url + '">') +
          '<button class="settings-study-wallpaper-remove" data-index="' + i + '" title="Remove">&times;</button>' +
        '</div>';
      }).join('') +
      '</div></div>' +

      '<div class="form-row"><label><input type="checkbox" id="settings-study-slideshow-enabled"' +
      (((cur.studyWallpaperSlideshow || {}).enabled) ? ' checked' : '') + '> Auto slideshow</label>' +
      ' <input type="number" min="1" id="settings-study-slideshow-interval" value="' +
      (((cur.studyWallpaperSlideshow || {}).intervalMin) || 5) + '" style="width:60px;"> min</div>' +

      '<hr class="divider">' +

      '<div class="form-row"><label><input type="checkbox" id="settings-notifications"' + (cur.notificationsEnabled !== false ? ' checked' : '') + '> Notifications</label></div>' +
      '<div class="form-row"><label><input type="checkbox" id="settings-sound"' + (cur.soundEnabled !== false ? ' checked' : '') + '> Sound</label></div>' +
      '<div class="form-row"><label><input type="checkbox" id="settings-vibration"' + (cur.vibrationEnabled !== false ? ' checked' : '') + '> Vibration</label></div>' +

      '<div class="form-row"><label for="settings-assistant-name">Assistant name</label>' +
      '<input type="text" id="settings-assistant-name" value="' + esc(cur.assistantName || '') + '" placeholder="Assistant"></div>' +

      '<button id="settings-save-btn">Save</button>' +

      '<hr class="divider">' +

      '<div class="form-row"><button id="settings-export-btn" class="btn-secondary">Export backup</button></div>' +
      '<div class="form-row"><label for="settings-import-input">Restore from backup</label>' +
      '<input type="file" id="settings-import-input" accept="application/json">' +
      '<div id="settings-import-status" class="micro-label"></div></div>' +
      '<button id="settings-clear-btn" class="btn-danger">Clear all data</button>' +

      '<hr class="divider">' +
      '<p class="micro-label">Lavender v' + APP_VERSION + '</p>'
    );
  }

  // Item 8 — resizes/compresses to a JPEG data URL before storing, so a phone photo (often several
  // MB) can't blow past localStorage's ~5-10MB quota and break every other saved feature.
  function resizeImageFile(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          let w = img.width, h = img.height;
          // Never upscale — only downscale when the source exceeds maxDim, so
          // already-high-quality images aren't degraded.
          if (w > maxDim || h > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = function () { reject(new Error('Could not read that image.')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsDataURL(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsDataURL(file);
    });
  }

  function saveWallpaper(dataUrl) {
    State.patch('settings', { breakWallpaper: dataUrl });
    open(); // re-render so the preview/remove button reflect the new state
  }

  function save() {
    const durationRaw = parseInt(document.getElementById('settings-break-duration').value, 10);
    State.patch('settings', {
      defaultBreakDuration: isNaN(durationRaw) ? null : durationRaw,
      notificationsEnabled: document.getElementById('settings-notifications').checked,
      soundEnabled: document.getElementById('settings-sound').checked,
      vibrationEnabled: document.getElementById('settings-vibration').checked,
      assistantName: document.getElementById('settings-assistant-name').value.trim()
    });
    Modal.close();
  }

  function open() {
    Modal.open(formHtml());

    document.getElementById('settings-save-btn').addEventListener('click', save);

    const wallpaperInput = document.getElementById('settings-wallpaper-input');
    if (wallpaperInput) {
      let _fsWasActive = false;
function _isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
      wallpaperInput.addEventListener('click', function () { _fsWasActive = _isFs(); });
      wallpaperInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        if (_fsWasActive && !_isFs()) {
          const el = document.documentElement;
          const req = el.requestFullscreen || el.webkitRequestFullscreen;
          if (req) req.call(el).catch(function () {});
        }
        resizeImageFile(file, 1280, 0.72).then(saveWallpaper).catch(function (err) {
          alert(err.message || "Couldn't use that image.");
        });
      });
    }
    const wallpaperRemove = document.getElementById('settings-wallpaper-remove');
    if (wallpaperRemove) {
      wallpaperRemove.addEventListener('click', function () { saveWallpaper(null); });
    }

    const studyWallpaperInput = document.getElementById('settings-study-wallpaper-input');
    if (studyWallpaperInput) {
      studyWallpaperInput.addEventListener('click', function () { _fsWasActive = _isFs(); });
      studyWallpaperInput.addEventListener('change', function (e) {
        const files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;
        Promise.all(files.map(function (f) {
          const name = (f.name || '').toLowerCase();
          const isVideo = /^video\//.test(f.type) || /\.(mp4|webm|mov)$/.test(name);
          const isAnimated = f.type === 'image/gif' || f.type === 'image/webp' || /\.(gif|webp)$/.test(name);
          const task = isVideo ? readFileAsDataUrl(f).then(function (url) { return { url: url, type: 'video' }; })
            : isAnimated ? readFileAsDataUrl(f).then(function (url) { return { url: url, type: 'gif' }; })
            : resizeImageFile(f, 2560, 0.95).then(function (url) { return { url: url, type: 'image' }; });
          return task.catch(function () { return null; });
         })).then(function (items) {
          const valid = items.filter(Boolean);
          if (!valid.length) { alert("Couldn't use those files."); return; }
          const cur = settings().studyWallpapers || [];
          State.patch('settings', { studyWallpapers: cur.concat(valid), studyWallpaperIndex: cur.length });
          window.location.reload();
        }).catch(function (err) {
          alert(err.message || "Couldn't use those files.");
        });
      });
    }
    document.querySelectorAll('.settings-study-wallpaper-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.dataset.index, 10);
        const cur = (settings().studyWallpapers || []).slice();
        cur.splice(idx, 1);
        const curIndex = settings().studyWallpaperIndex || 0;
        State.patch('settings', { studyWallpapers: cur, studyWallpaperIndex: Math.min(curIndex, Math.max(0, cur.length - 1)) });
        open();
      });
    });
    const slideshowEnabled = document.getElementById('settings-study-slideshow-enabled');
    const slideshowInterval = document.getElementById('settings-study-slideshow-interval');
    if (slideshowEnabled && slideshowInterval) {
      function saveSlideshowSettings() {
        const minutes = parseInt(slideshowInterval.value, 10);
        State.patch('settings', {
          studyWallpaperSlideshow: {
            enabled: slideshowEnabled.checked,
            intervalMin: (!minutes || minutes <= 0) ? 5 : minutes
          }
        });
        if (typeof StudyWallpaper !== 'undefined') StudyWallpaper.refreshSlideshow();
      }
      slideshowEnabled.addEventListener('change', saveSlideshowSettings);
      slideshowInterval.addEventListener('change', saveSlideshowSettings);
    }

    document.getElementById('settings-export-btn').addEventListener('click', function () {
      Backup.downloadExport();
    });

    document.getElementById('settings-import-input').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const result = Backup.restoreFromJson(reader.result);
        if (!result.ok) {
          document.getElementById('settings-import-status').textContent = result.error;
          return;
        }
        Modal.close();
        location.reload();
      };
      reader.readAsText(file);
    });

    document.getElementById('settings-clear-btn').addEventListener('click', function () {
      if (!confirm("This deletes everything stored in Lavender on this device. This can't be undone. Continue?")) return;
      Backup.clearAllData();
      Modal.close();
      location.reload();
    });
  }

  // Read by Assistant (§B.7) for its modal header — cosmetic label only, falls back to "Assistant".
  function assistantLabel() {
    return settings().assistantName || 'Assistant';
  }

  function handleIconClick() { open(); }

  function init() {
    const btn = document.getElementById('settings-icon');
    if (btn) btn.addEventListener('click', handleIconClick);
  }

  return { init: init, open: open, assistantLabel: assistantLabel };
})();
