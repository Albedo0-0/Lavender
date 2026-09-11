// targets.js — Targets UI. Opens via Modal.

const Targets = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'; }); }

  function pct(target) {
    if (!target.targetValue) return 0;
    return Math.round((target.currentValue / target.targetValue) * 100);
  }

  function targetRowHtml(t) {
    const subs = TargetsData.getSubtargetsForTarget(t.targetId);
    const subsHtml = subs.length === 0 ? '' :
      '<ul class="targets-subtarget-list">' +
        subs.map(function (s) {
          return '<li class="targets-subtarget-row">' +
            '<label><input type="checkbox" class="targets-subtarget-check" data-subtarget-id="' + s.subtargetId + '" ' + (s.completed ? 'checked' : '') + '> ' +
            esc(s.title) + ' (' + s.currentValue + '/' + s.targetValue + ')</label> ' +
            '<button class="targets-subtarget-delete" data-subtarget-id="' + s.subtargetId + '">&times;</button>' +
          '</li>';
        }).join('') +
      '</ul>';

    return '<div class="targets-row" data-target-id="' + t.targetId + '">' +
      '<div class="targets-row-header">' +
        '<label>' +
          (subs.length === 0 ? '<input type="checkbox" class="targets-complete-check" data-target-id="' + t.targetId + '" ' + (t.completed ? 'checked' : '') + '> ' : '') +
          '<strong>' + esc(t.title) + '</strong>' +
        '</label>' +
        '<span class="targets-row-meta">' + t.timeframe + ' \u00B7 ' + t.currentValue + '/' + t.targetValue + ' (' + pct(t) + '%)</span>' +
        '<button class="targets-delete-btn" data-target-id="' + t.targetId + '">Delete</button>' +
      '</div>' +
      subsHtml +
      '<div class="targets-subtarget-add-row">' +
        '<input type="text" class="targets-subtarget-input" data-target-id="' + t.targetId + '" placeholder="Add subtarget...">' +
        '<button class="targets-subtarget-add-btn" data-target-id="' + t.targetId + '">+</button>' +
      '</div>' +
    '</div>';
  }

  function listHtml(timeframe) {
    const list = TargetsData.getTargetsByTimeframe(timeframe);
    if (list.length === 0) return '<p class="planner-empty">No ' + timeframe + ' targets yet.</p>';
    return list.map(targetRowHtml).join('');
  }

  function formHtml() {
    return '<div class="targets-add-form">' +
      '<input type="text" id="targets-new-title" placeholder="Target title...">' +
      '<select id="targets-new-timeframe">' +
        '<option value="daily">Daily</option>' +
        '<option value="weekly">Weekly</option>' +
        '<option value="monthly">Monthly</option>' +
      '</select>' +
      '<select id="targets-new-type">' +
        '<option value="checkoff">Checkoff</option>' +
        '<option value="studyHours">Study Hours</option>' +
        '<option value="questions">Questions</option>' +
      '</select>' +
      '<input type="number" id="targets-new-value" placeholder="Target value" min="1" value="1">' +
      '<button id="targets-new-add-btn">Add Target</button>' +
    '</div>';
  }

  function html() {
    return '<h3>Targets</h3>' +
      formHtml() +
      '<div class="targets-section"><h4>Daily</h4>' + listHtml('daily') + '</div>' +
      '<div class="targets-section"><h4>Weekly</h4>' + listHtml('weekly') + '</div>' +
      '<div class="targets-section"><h4>Monthly</h4>' + listHtml('monthly') + '</div>';
  }

  function wire() {
    document.getElementById('targets-new-add-btn').addEventListener('click', function () {
      const title = document.getElementById('targets-new-title').value.trim();
      if (!title) return;
      const timeframe = document.getElementById('targets-new-timeframe').value;
      const type = document.getElementById('targets-new-type').value;
      const targetValue = Number(document.getElementById('targets-new-value').value) || 1;
      TargetsData.createTarget({ title: title, timeframe: timeframe, type: type, targetValue: targetValue });
      open();
    });

    document.querySelectorAll('.targets-complete-check').forEach(function (cb) {
      cb.addEventListener('click', function () {
        TargetsData.toggleTargetComplete(cb.dataset.targetId);
        open();
      });
    });

    document.querySelectorAll('.targets-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        TargetsData.deleteTarget(btn.dataset.targetId);
        open();
      });
    });

    document.querySelectorAll('.targets-subtarget-check').forEach(function (cb) {
      cb.addEventListener('click', function () {
        TargetsData.toggleSubtargetComplete(cb.dataset.subtargetId);
        open();
      });
    });

    document.querySelectorAll('.targets-subtarget-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        TargetsData.deleteSubtarget(btn.dataset.subtargetId);
        open();
      });
    });

    document.querySelectorAll('.targets-subtarget-add-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const targetId = btn.dataset.targetId;
        const input = document.querySelector('.targets-subtarget-input[data-target-id="' + targetId + '"]');
        const title = input.value.trim();
        if (!title) return;
        TargetsData.createSubtarget(targetId, { title: title, targetValue: 1 });
        open();
      });
    });
  }

  function open() {
    Modal.open(html());
    wire();
  }

  function init() {}

  return { open: open, init: init };
})();
