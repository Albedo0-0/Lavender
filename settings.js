// settings.js — Settings scaffold (§B.9). Not a full settings screen — only the entry points a
// shipped feature already needs: default break duration + notification/sound/vibration toggles
// (§B.3, already read by notify.js and study.js), break wallpaper upload (item 8 — §B.17's
// "postponed" note is now superseded by that explicit request), Assistant's cosmetic name label,
// and Backup/Restore/Export/Clear-data (§B.10). Icon lives outside the tab screens, same pattern
// as #assistant-icon.
// Depends on: State, Modal, Backup.
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
      '<h3>Settings</h3>' +
      '<label>Default break duration (minutes)<br>' +
      '<input type="number" min="1" id="settings-break-duration" value="' + (cur.defaultBreakDuration != null ? cur.defaultBreakDuration : '') + '"></label><br><br>' +
      '<label>Break wallpaper<br>' +
      '<input type="file" id="settings-wallpaper-input" accept="image/*"></label><br>' +
      (cur.breakWallpaper
        ? '<img id="settings-wallpaper-preview" src="' + cur.breakWallpaper + '" style="max-width:160px;max-height:100px;display:block;margin:6px 0;">' +
          '<button id="settings-wallpaper-remove">Remove wallpaper</button>'
        : '<span id="settings-wallpaper-status"></span>') +
      '<br><br>' +
      '<label><input type="checkbox" id="settings-notifications"' + (cur.notificationsEnabled !== false ? ' checked' : '') + '> Notifications</label><br>' +
      '<label><input type="checkbox" id="settings-sound"' + (cur.soundEnabled !== false ? ' checked' : '') + '> Sound</label><br>' +
      '<label><input type="checkbox" id="settings-vibration"' + (cur.vibrationEnabled !== false ? ' checked' : '') + '> Vibration</label><br><br>' +
      '<label>Assistant name<br>' +
      '<input type="text" id="settings-assistant-name" value="' + esc(cur.assistantName || '') + '" placeholder="Assistant"></label><br><br>' +
      '<button id="settings-save-btn">Save</button>' +
      '<hr>' +
      '<button id="settings-export-btn">Export backup</button><br><br>' +
      '<label>Restore from backup<br>' +
      '<input type="file" id="settings-import-input" accept="application/json"></label>' +
      '<div id="settings-import-status"></div><br>' +
      '<button id="settings-clear-btn">Clear all data</button>' +
      '<hr>' +
      '<p>Lavender v' + APP_VERSION + '</p>'
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
          if (w > maxDim || h > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = function () { reject(new Error('Could not read that image.')); };
        img.src = reader.result;
      };
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
      wallpaperInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        resizeImageFile(file, 1280, 0.72).then(saveWallpaper).catch(function (err) {
          alert(err.message || "Couldn't use that image.");
        });
      });
    }
    const wallpaperRemove = document.getElementById('settings-wallpaper-remove');
    if (wallpaperRemove) {
      wallpaperRemove.addEventListener('click', function () { saveWallpaper(null); });
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
