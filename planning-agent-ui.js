// planning-agent-ui.js — Centralized Planning Agent: User-Facing Interface
// Universal Planning Entry: ONE Planning Agent UI for all of Lavender.
// "PLAN = TALK TO MY AGENT"
// Deterministic reasoning without AI/LLM network dependencies.
// Depends on: State, Modal, PlannerData, TargetsData, PlanningAgentData, PlanningAgent, MiscSound, Nav.

const PlanningAgentUI = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }

  function todayStr() {
    return (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.todayStr === 'function')
      ? PlanningAgentData.todayStr()
      : (typeof PlannerData !== 'undefined' ? PlannerData.todayStr() : '');
  }

  function shiftDateStr(dateStr, delta) {
    if (typeof PlanningAgentData !== 'undefined' && typeof PlanningAgentData.shiftDateStr === 'function') {
      return PlanningAgentData.shiftDateStr(dateStr, delta);
    }
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatDateFriendly(dateStr) {
    if (!dateStr) return '';
    const today = todayStr();
    const tomorrow = shiftDateStr(today, 1);
    if (dateStr === today) return 'Today (' + dateStr + ')';
    if (dateStr === tomorrow) return 'Tomorrow (' + dateStr + ')';
    return dateStr;
  }

  // Active state within the modal
  let state = {
    prompt: '',
    intent: 'topic', // 'topic' | 'day' | 'pending' | 'catchup' | 'target'
    subject: '',
    topicId: '',
    taskMode: 'revision-cycle', // 'revision-cycle' | 'theory' | 'questions' | 'revision'
    date: '',
    targetId: '',
    proposals: null, // array of generated proposal objects
    lastResult: null // result message after committing
  };

  // Pixel Brain Avatar for Planning Agent
  const AGENT_PIXEL = {
    o: '#3f2f21', k: '#d9c4a3', c: '#fffdf8', g: '#566e3a', r: '#c8776a', y: '#e3c27a'
  };
  const AGENT_ROWS = [
    '....oooo....',
    '..ooccccoo..',
    '.occcccccco.',
    '.ocgyyyycco.',
    '.ocyycyyyco.',
    '.ocyyyyyyco.',
    '.occcccccco.',
    '..ooccccoo..',
    '....oooo....',
    '....oyyo....',
    '....oooo....',
    '............'
  ];

  function agentIconSvg(size) {
    let rects = '';
    const sz = size || 24;
    AGENT_ROWS.forEach(function (row, y) {
      let x = 0;
      while (x < row.length) {
        const ch = row.charAt(x);
        if (ch === '.' || !AGENT_PIXEL[ch]) { x++; continue; }
        let x2 = x;
        while (x2 < row.length && row.charAt(x2) === ch) x2++;
        rects += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x) + '" height="1" fill="' + AGENT_PIXEL[ch] + '"/>';
        x = x2;
      }
    });
    return '<svg viewBox="0 0 12 12" width="' + sz + '" height="' + sz + '" shape-rendering="crispEdges" aria-hidden="true">' + rects + '</svg>';
  }

  // ---------- Deterministic Intent & Text Parser ----------

  function parseNaturalInput(raw) {
    if (!raw || typeof raw !== 'string') return {};
    const text = raw.trim().toLowerCase();
    const result = {};

    const today = todayStr();
    const tomorrow = shiftDateStr(today, 1);

    // 1. Detect date
    if (text.includes('tomorrow')) {
      result.date = tomorrow;
    } else if (text.includes('today')) {
      result.date = today;
    } else {
      const dateMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (dateMatch) result.date = dateMatch[0];
    }

    // 2. Detect intent keywords
    if (text.includes('catch up') || text.includes('catchup') || text.includes('behind') || text.includes('delay')) {
      result.intent = 'catchup';
      return result;
    }
    if (text.includes('pending') || text.includes('overdue') || text.includes('remaining') || text.includes('carry over') || text.includes('carryover')) {
      result.intent = 'pending';
    } else if (text.includes('goal') || text.includes('target')) {
      result.intent = 'target';
    } else if (text.includes('day') || text.includes('tomorrow') || text.includes('fit') || text.includes('schedule')) {
      result.intent = result.intent || 'day';
    }

    // 3. Match known subjects
    if (typeof PlannerData !== 'undefined') {
      const subjects = PlannerData.getAllSubjects();
      for (let i = 0; i < subjects.length; i++) {
        const s = subjects[i];
        if (text.includes(s.toLowerCase())) {
          result.subject = s;
          break;
        }
      }

      // 4. Match known topics
      const allTopics = PlannerData.getAllTopics();
      const topicKeys = Object.keys(allTopics);
      let bestTopic = null;
      let bestMatchLen = 0;

      topicKeys.forEach(function (tid) {
        const t = allTopics[tid];
        const tName = (t.topicName || '').toLowerCase();
        if (tName && text.includes(tName) && tName.length > bestMatchLen) {
          bestTopic = t;
          bestMatchLen = tName.length;
        }
      });

      if (bestTopic) {
        result.topicId = bestTopic.topicId;
        result.subject = bestTopic.subject;
        result.intent = 'topic';
      }
    }

    // 5. Match active targets
    if (typeof TargetsData !== 'undefined' && (!result.intent || result.intent === 'target')) {
      const targets = TargetsData.getAllTargets();
      const targetKeys = Object.keys(targets);
      for (let i = 0; i < targetKeys.length; i++) {
        const tgt = targets[targetKeys[i]];
        if (!tgt.completed && !tgt.archived && text.includes((tgt.title || '').toLowerCase())) {
          result.targetId = tgt.targetId;
          result.intent = 'target';
          break;
        }
      }
    }

    // 6. Mode / Type detection for topic
    if (text.includes('cycle') || text.includes('spaced') || text.includes('r1')) {
      result.taskMode = 'revision-cycle';
    } else if (text.includes('theory')) {
      result.taskMode = 'theory';
    } else if (text.includes('question') || text.includes('qs')) {
      result.taskMode = 'questions';
    } else if (text.includes('revision') || text.includes('revise')) {
      result.taskMode = 'revision-cycle';
    }

    return result;
  }

  // ---------- Proposal Generation ----------

  function generateProposals() {
    const today = todayStr();
    const targetDate = state.date || today;
    const proposals = [];

    if (state.intent === 'topic') {
      // Must have subject & topic
      const subject = state.subject;
      const topicId = state.topicId;
      let topicName = '';
      if (topicId && typeof PlannerData !== 'undefined') {
        const t = PlannerData.getAllTopics()[topicId];
        if (t) topicName = t.topicName;
      }
      if (!topicName && topicId) topicName = topicId;
      if (!subject || !topicName) {
        return { ok: false, error: 'Please choose a subject and topic to plan.' };
      }

      if (state.taskMode === 'revision-cycle') {
        // Revision Cycle: Spaced repetition (R1-R6)
        const dur = 45;
        const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, '08:00');
        if (!slot) {
          return { ok: false, error: 'No free time slot available on ' + targetDate + '. Please pick another date or clear a slot.' };
        }

        const futureDates = PlanningAgentData.computeRevisionDates(targetDate);
        const offsets = PlanningAgentData.getRevisionOffsets();
        const labels = PlanningAgentData.getRevisionLabels();

        proposals.push({
          proposalId: 'prop_rev_cycle_' + Date.now(),
          kind: 'revision-cycle',
          subject: subject,
          topicName: topicName,
          title: subject + ' \u00b7 ' + topicName + ' (Spaced Revision Cycle)',
          baseDate: targetDate,
          startTime: slot.start,
          stopTime: slot.end,
          durationMin: dur,
          note: 'Full 6-stage spaced repetition cycle',
          futureSchedule: futureDates.map(function (d, i) {
            return { label: labels[i] || ('R' + (i + 1)), date: d, offset: offsets[i] };
          }),
          reason: 'Spaced repetition schedule (R1 base session + R2\u2013R6 spaced reviews)',
          confidence: 0.98
        });
      } else {
        // Single session: Theory, Questions, or Single Revision
        const taskType = state.taskMode;
        let dur = 50;
        if (taskType === 'questions') dur = 60;
        else if (taskType === 'revision') dur = 45;

        // Adaptive duration multiplier
        if (typeof PlanningAgentData.getDurationMultiplier === 'function') {
          const mult = PlanningAgentData.getDurationMultiplier(taskType);
          dur = Math.round(dur * mult.multiplier);
        }

        const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, '08:00');
        if (!slot) {
          return { ok: false, error: 'No free time slot found for ' + dur + 'm on ' + targetDate + '.' };
        }

        const typeLabel = taskType === 'theory' ? 'Theory Session' : (taskType === 'questions' ? 'Questions Practice' : 'Revision');
        proposals.push({
          proposalId: 'prop_single_' + Date.now(),
          kind: 'single-task',
          subject: subject,
          topicName: topicName,
          taskType: taskType,
          title: subject + ' \u00b7 ' + topicName + ' (' + typeLabel + ')',
          date: targetDate,
          startTime: slot.start,
          stopTime: slot.end,
          durationMin: dur,
          note: '',
          reason: 'Optimally placed in next free ' + (slot.start < '12:00' ? 'morning' : 'afternoon') + ' window',
          confidence: 0.92
        });
      }

    } else if (state.intent === 'day') {
      // Plan entire day (due revisions + carried over overdue tasks + unslotted)
      const dayProps = PlanningAgentData.proposeScheduleForDate(targetDate);
      if (!dayProps || !dayProps.length) {
        return { ok: false, error: 'No unscheduled tasks, due revisions, or overdue carry-overs found for ' + targetDate + '.' };
      }
      dayProps.forEach(function (p) {
        proposals.push({
          proposalId: p.proposalId,
          kind: 'day-proposal',
          rawProposal: p,
          taskId: p.taskId,
          subject: p.subject || '',
          topicName: p.topicName || '',
          title: p.title,
          date: p.date,
          startTime: p.proposedStart,
          stopTime: p.proposedEnd,
          durationMin: p.durationMin,
          reason: p.reason,
          confidence: p.confidence || 0.9
        });
      });

    } else if (state.intent === 'pending') {
      // Overdue & pending work carry-forward
      const snap = PlanningAgentData.getSnapshot();
      let pending = snap.pendingTasks || [];
      if (state.subject) {
        pending = pending.filter(function (t) { return (t.subject || '').toLowerCase() === state.subject.toLowerCase(); });
      }

      if (!pending.length) {
        return { ok: false, error: 'No pending incomplete tasks found' + (state.subject ? ' for ' + state.subject : '') + '.' };
      }

      // Sort with postponement risk first
      pending.sort(function (a, b) {
        const aRisk = PlanningAgentData.isPostponementRisk(a) ? 1 : 0;
        const bRisk = PlanningAgentData.isPostponementRisk(b) ? 1 : 0;
        if (aRisk !== bRisk) return bRisk - aRisk;
        return (a.date || '').localeCompare(b.date || '');
      });

      let cursorTime = targetDate === today ? PlanningAgentData.minutesToTimeStr(Math.max(480, (new Date()).getHours() * 60 + (new Date()).getMinutes())) : '08:00';

      pending.slice(0, 4).forEach(function (t) {
        const isRisk = PlanningAgentData.isPostponementRisk(t);
        const dur = isRisk ? 35 : 45;
        const slot = PlanningAgentData.findNextFreeSlot(targetDate, dur, cursorTime);
        if (slot) {
          proposals.push({
            proposalId: 'prop_pend_' + t.taskId,
            kind: 'reschedule-task',
            taskId: t.taskId,
            subject: t.subject || '',
            topicName: t.topicName || '',
            title: (t.topicName || t.title || 'Task') + ' (Overdue)',
            date: targetDate,
            startTime: slot.start,
            stopTime: slot.end,
            durationMin: dur,
            reason: isRisk
              ? 'Overdue from ' + t.date + ' (' + (t.rescheduleCount || 1) + 'x delayed \u2014 bite-sized duration)'
              : 'Overdue from ' + t.date + ' \u2014 placed in next free slot',
            confidence: 0.88
          });
          cursorTime = PlanningAgentData.minutesToTimeStr(slot.endMin + 15);
        }
      });

      if (!proposals.length) {
        return { ok: false, error: 'Could not find free slots on ' + targetDate + ' to schedule pending tasks.' };
      }

    } else if (state.intent === 'catchup') {
      // Catch-up plan for today's itinerary
      if (typeof ItineraryData === 'undefined') {
        return { ok: false, error: 'Itinerary is not loaded.' };
      }
      const day = ItineraryData.getToday();
      const plan = PlanningAgentData.computeCatchUpPlan(day);
      if (!plan.needed || !plan.changes.length) {
        return { ok: false, error: 'No schedule delays detected today \u2014 everything is on track!' };
      }

      plan.changes.forEach(function (c) {
        proposals.push({
          proposalId: 'prop_catchup_' + c.itemId,
          kind: 'catchup-change',
          rawChange: c,
          taskId: c.refId,
          itemId: c.itemId,
          title: c.label || 'Itinerary Task',
          date: today,
          startTime: c.newStart,
          stopTime: c.newEnd,
          durationMin: null,
          reason: 'Pushed back to ' + c.newStart + ' (was scheduled for ' + c.originalStart + ')',
          confidence: 0.95
        });
      });

    } else if (state.intent === 'target') {
      // Allocate sessions for a target
      const targetId = state.targetId;
      if (!targetId) {
        return { ok: false, error: 'Please choose a goal to plan.' };
      }
      const targetProps = PlanningAgentData.proposeTargetAllocation(targetId, targetDate);
      if (!targetProps || !targetProps.length) {
        return { ok: false, error: 'No sessions needed or no free slots found for this goal.' };
      }

      targetProps.forEach(function (tp) {
        proposals.push({
          proposalId: tp.proposalId,
          kind: 'target-allocation',
          targetId: tp.targetId,
          subtargetId: tp.subtargetId,
          title: tp.title,
          date: tp.date,
          startTime: tp.proposedStart,
          stopTime: tp.proposedEnd,
          durationMin: tp.durationMin,
          reason: tp.reason,
          confidence: tp.confidence || 0.9
        });
      });
    }

    if (!proposals.length) {
      return { ok: false, error: 'Agent could not generate any proposals for this request.' };
    }

    return { ok: true, proposals: proposals };
  }

  // ---------- Commit Proposals ----------

  function acceptProposals() {
    if (!state.proposals || !state.proposals.length) return;

    let committedCount = 0;
    const errors = [];

    state.proposals.forEach(function (p) {
      if (p.kind === 'revision-cycle') {
        const res = PlanningAgent.createRevisionCycle(
          p.subject,
          p.topicName,
          p.baseDate,
          p.note || '',
          p.startTime,
          p.stopTime,
          'agent'
        );
        if (res.ok) committedCount += 6; // base + 5 revisions
        else errors.push(res.error);

      } else if (p.kind === 'single-task') {
        const res = PlanningAgent.createTask({
          subject: p.subject,
          topicName: p.topicName,
          taskType: p.taskType,
          date: p.date,
          startTime: p.startTime,
          stopTime: p.stopTime,
          note: p.note || '',
          planReason: p.reason
        }, 'agent');
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'day-proposal') {
        const res = PlanningAgent.applyProposal(p.rawProposal);
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'reschedule-task') {
        const res = PlanningAgent.rescheduleTask(
          p.taskId,
          p.date,
          p.startTime,
          p.stopTime,
          'agent',
          p.reason
        );
        if (res.ok) committedCount++;
        else errors.push(res.error);

      } else if (p.kind === 'catchup-change') {
        if (p.taskId) {
          PlanningAgent.rescheduleTask(p.taskId, p.date, p.startTime, p.stopTime, 'agent', 'catch-up');
        }
        if (typeof ItineraryData !== 'undefined' && typeof ItineraryData.updateItemState === 'function') {
          const fields = { plannedStart: p.startTime };
          if (p.stopTime) fields.plannedEnd = p.stopTime;
          ItineraryData.updateItemState(p.itemId, fields);
        }
        committedCount++;

      } else if (p.kind === 'target-allocation') {
        const res = PlanningAgent.createTask({
          title: p.title,
          taskType: 'custom',
          date: p.date,
          startTime: p.startTime,
          stopTime: p.stopTime,
          targetId: p.targetId,
          subtargetId: p.subtargetId,
          planReason: p.reason
        }, 'agent');
        if (res.ok) committedCount++;
        else errors.push(res.error);
      }
    });

    if (typeof MiscSound !== 'undefined') {
      MiscSound.play('uiSuccess');
    }

    // Refresh views across Lavender
    if (typeof Planner !== 'undefined' && Planner.render) Planner.render();
    if (typeof Planner !== 'undefined' && Planner.renderSidePanel) Planner.renderSidePanel();
    if (typeof Library !== 'undefined' && Library.render) Library.render();
    if (typeof Library !== 'undefined' && Library.renderPanel) Library.renderPanel();
    if (typeof Calendar !== 'undefined' && Calendar.render) Calendar.render();
    if (typeof Itinerary !== 'undefined' && Itinerary.render) Itinerary.render();

    state.lastResult = {
      committedCount: committedCount,
      errors: errors
    };
    state.proposals = null;
    render();
  }

  // ---------- HTML Rendering ----------

  function renderHtml() {
    const today = todayStr();
    const tomorrow = shiftDateStr(today, 1);
    const currentDate = state.date || today;

    // Subjects and topics
    const subjects = (typeof PlannerData !== 'undefined' ? PlannerData.getAllSubjects() : []);
    const activeSubject = state.subject || subjects[0] || '';
    const topicsMap = (typeof PlannerData !== 'undefined' ? PlannerData.getTopicsBySubject() : {});
    const topicsForSubject = topicsMap[activeSubject] || [];

    // Active targets
    const allTargets = (typeof TargetsData !== 'undefined' ? TargetsData.getAllTargets() : {});
    const activeTargets = Object.keys(allTargets).map(function (k) { return allTargets[k]; }).filter(function (t) {
      return !t.completed && !t.archived;
    });

    let contextControlsHtml = '';

    if (state.intent === 'topic') {
      contextControlsHtml =
        '<div class="planning-ctx-card">' +
          '<div class="planning-ctx-row">' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Subject</label>' +
              '<select id="plan-ctrl-subject" class="input">' +
                subjects.map(function (s) {
                  return '<option value="' + esc(s) + '"' + (s === activeSubject ? ' selected' : '') + '>' + esc(s) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Topic / Chapter</label>' +
              '<select id="plan-ctrl-topic" class="input">' +
                (topicsForSubject.length
                  ? topicsForSubject.map(function (t) {
                      return '<option value="' + esc(t.topicId) + '"' + (t.topicId === state.topicId ? ' selected' : '') + '>' + esc(t.topicName) + '</option>';
                    }).join('')
                  : '<option value="">(No chapters yet)</option>') +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="planning-ctx-row">' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Planning Strategy</label>' +
              '<select id="plan-ctrl-mode" class="input">' +
                '<option value="revision-cycle"' + (state.taskMode === 'revision-cycle' ? ' selected' : '') + '>Spaced Revision Cycle (R1 \u2192 R6)</option>' +
                '<option value="theory"' + (state.taskMode === 'theory' ? ' selected' : '') + '>Single Theory Session (50m)</option>' +
                '<option value="questions"' + (state.taskMode === 'questions' ? ' selected' : '') + '>Questions Practice (60m)</option>' +
                '<option value="revision"' + (state.taskMode === 'revision' ? ' selected' : '') + '>Single Revision Review (45m)</option>' +
              '</select>' +
            '</div>' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Start Date</label>' +
              '<input type="date" id="plan-ctrl-date" class="input" value="' + esc(currentDate) + '">' +
            '</div>' +
          '</div>' +
        '</div>';

    } else if (state.intent === 'day') {
      contextControlsHtml =
        '<div class="planning-ctx-card">' +
          '<div class="planning-ctx-row">' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Day to Plan</label>' +
              '<input type="date" id="plan-ctrl-date" class="input" value="' + esc(currentDate) + '">' +
            '</div>' +
            '<div class="form-row" style="display:flex;align-items:flex-end;">' +
              '<div class="planning-quick-dates">' +
                '<button type="button" class="btn-secondary planning-quick-date' + (currentDate === today ? ' is-active' : '') + '" data-set-date="' + today + '">Today</button>' +
                '<button type="button" class="btn-secondary planning-quick-date' + (currentDate === tomorrow ? ' is-active' : '') + '" data-set-date="' + tomorrow + '">Tomorrow</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<p class="planning-ctx-hint">The Agent will inspect due spaced revisions, carried-over tasks, and unslotted sessions to build an optimal day schedule.</p>' +
        '</div>';

    } else if (state.intent === 'pending') {
      const snap = (typeof PlanningAgentData !== 'undefined' ? PlanningAgentData.getSnapshot() : { pendingTasks: [] });
      const pendingCount = (snap.pendingTasks || []).length;
      contextControlsHtml =
        '<div class="planning-ctx-card">' +
          '<div class="planning-ctx-row">' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Target Date</label>' +
              '<input type="date" id="plan-ctrl-date" class="input" value="' + esc(currentDate) + '">' +
            '</div>' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Subject Filter</label>' +
              '<select id="plan-ctrl-subject" class="input">' +
                '<option value="">\u2014 All Subjects \u2014</option>' +
                subjects.map(function (s) {
                  return '<option value="' + esc(s) + '"' + (s === state.subject ? ' selected' : '') + '>' + esc(s) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +
          '<p class="planning-ctx-hint"><strong>' + pendingCount + ' pending task' + (pendingCount === 1 ? '' : 's') + '</strong> overdue. Postponed tasks will automatically receive bite-sized focus windows to minimize friction.</p>' +
        '</div>';

    } else if (state.intent === 'catchup') {
      contextControlsHtml =
        '<div class="planning-ctx-card">' +
          '<p class="planning-ctx-hint">Running late today? The Agent evaluates today\'s itinerary timeline and shifts delayed sessions forward into the next free gaps without altering completed work.</p>' +
        '</div>';

    } else if (state.intent === 'target') {
      contextControlsHtml =
        '<div class="planning-ctx-card">' +
          '<div class="planning-ctx-row">' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Goal / Target</label>' +
              '<select id="plan-ctrl-target" class="input">' +
                (activeTargets.length
                  ? activeTargets.map(function (t) {
                      return '<option value="' + esc(t.targetId) + '"' + (t.targetId === state.targetId ? ' selected' : '') + '>' + esc(t.title) + ' (' + t.timeframe + ')' + '</option>';
                    }).join('')
                  : '<option value="">(No active goals)</option>') +
              '</select>' +
            '</div>' +
            '<div class="form-row">' +
              '<label class="planner-field-label">Scheduled Date</label>' +
              '<input type="date" id="plan-ctrl-date" class="input" value="' + esc(currentDate) + '">' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    // Proposals box
    let proposalsHtml = '';
    if (state.proposals && state.proposals.length) {
      proposalsHtml =
        '<div class="planning-proposals-box">' +
          '<div class="planning-proposals-header">' +
            '<h4 class="planning-proposals-title">Proposed Plan (' + state.proposals.length + ' session' + (state.proposals.length > 1 ? 's' : '') + ')</h4>' +
            '<span class="planning-status-badge">Awaiting Confirmation</span>' +
          '</div>' +
          '<div class="planning-proposals-list">' +
            state.proposals.map(function (p, idx) {
              let futureListHtml = '';
              if (p.futureSchedule && p.futureSchedule.length) {
                futureListHtml =
                  '<div class="planning-future-schedule">' +
                    '<span class="planning-future-label">Follow-up intervals:</span> ' +
                    p.futureSchedule.map(function (fs) {
                      return '<span class="planning-future-pill">' + fs.label + ' \u00b7 ' + fs.date + '</span>';
                    }).join(' ') +
                  '</div>';
              }

              return (
                '<div class="planning-proposal-card" data-idx="' + idx + '">' +
                  '<div class="planning-proposal-top">' +
                    '<div class="planning-proposal-info">' +
                      '<strong class="planning-proposal-title">' + esc(p.title) + '</strong>' +
                      '<div class="planning-proposal-timing">' +
                        '<span class="planning-time-chip">\uD83D\uDCC5 ' + formatDateFriendly(p.date || p.baseDate) + '</span>' +
                        (p.startTime ? '<span class="planning-time-chip">\u23F0 ' + p.startTime + ' \u2013 ' + (p.stopTime || '') + ' (' + (p.durationMin || 45) + 'm)</span>' : '') +
                      '</div>' +
                      '<div class="planning-proposal-reason">' + esc(p.reason) + '</div>' +
                      futureListHtml +
                    '</div>' +
                    '<button type="button" class="planning-proposal-del" data-idx="' + idx + '" title="Remove from plan">&times;</button>' +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
          '<div class="planning-proposals-actions">' +
            '<button type="button" id="planning-accept-btn" class="btn btn-primary">\u2713 Accept & Schedule in Lavender</button>' +
            '<button type="button" id="planning-cancel-proposals-btn" class="btn btn-secondary">Cancel</button>' +
          '</div>' +
        '</div>';
    }

    // Success / Result banner
    let resultBannerHtml = '';
    if (state.lastResult) {
      resultBannerHtml =
        '<div class="planning-success-banner">' +
          '<div class="planning-success-icon">\u2713</div>' +
          '<div class="planning-success-content">' +
            '<strong>Plan Confirmed & Scheduled!</strong>' +
            '<p>Committed ' + state.lastResult.committedCount + ' canonical task(s) into your Planner, Itinerary, and Calendar.</p>' +
            '<div class="planning-success-actions">' +
              '<button type="button" id="planning-goto-planner-btn" class="btn-secondary">\uD83D\uDCDA View in Planner</button>' +
              '<button type="button" id="planning-new-plan-btn" class="btn-secondary">Plan Something Else</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    return (
      '<div class="modal-header"><button id="assistant-back-btn" class="btn-secondary">\u2190 Back</button></div>' +
      '<div class="assistant-page assistant-page-plan">' +
        '<h3 class="section-title assistant-page-title">' +
          '<span class="assistant-page-pixel">' + agentIconSvg(24) + '</span>' +
          'Planning Agent' +
        '</h3>' +

        '<div class="planning-agent-greeting">' +
          '<span class="planning-quote">\u201cWhat do you want to plan?\u201d</span>' +
        '</div>' +

        // Natural Input form
        '<div class="planning-input-box">' +
          '<div class="form-row" style="margin-bottom:0;">' +
            '<input type="text" id="planning-agent-prompt" class="input" placeholder="e.g. Plan Physics revision tomorrow, Schedule pending work..." value="' + esc(state.prompt) + '">' +
          '</div>' +
          '<button type="button" id="planning-agent-plan-btn" class="btn btn-primary">\u2728 Plan</button>' +
        '</div>' +

        // Intent Chips
        '<div class="planning-intent-chips">' +
          '<button type="button" class="planning-chip' + (state.intent === 'topic' ? ' is-active' : '') + '" data-intent="topic">\uD83D\uDCDA Plan Topic</button>' +
          '<button type="button" class="planning-chip' + (state.intent === 'day' ? ' is-active' : '') + '" data-intent="day">\uD83D\uDCC5 Plan Day</button>' +
          '<button type="button" class="planning-chip' + (state.intent === 'pending' ? ' is-active' : '') + '" data-intent="pending">\u23F3 Schedule Overdue</button>' +
          '<button type="button" class="planning-chip' + (state.intent === 'catchup' ? ' is-active' : '') + '" data-intent="catchup">\uD83D\uDD04 Catch Up Today</button>' +
          '<button type="button" class="planning-chip' + (state.intent === 'target' ? ' is-active' : '') + '" data-intent="target">\uD83C\uDFAF Plan Goal</button>' +
        '</div>' +

        // Dynamic context controls
        contextControlsHtml +

        // Result banner (if just committed)
        resultBannerHtml +

        // Proposals box (if proposals generated)
        proposalsHtml +

      '</div>'
    );
  }

  // ---------- Event Wiring ----------

  function bindEvents() {
    // Back button
    const backBtn = document.getElementById('assistant-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        Modal.close();
        if (typeof Assistant !== 'undefined' && Assistant.openMain) {
          Assistant.openMain();
        }
      });
    }

    // Natural text input
    const promptInput = document.getElementById('planning-agent-prompt');
    const planBtn = document.getElementById('planning-agent-plan-btn');

    function executePlan() {
      const val = promptInput ? promptInput.value.trim() : '';
      if (val) {
        state.prompt = val;
        const parsed = parseNaturalInput(val);
        if (parsed.intent) state.intent = parsed.intent;
        if (parsed.date) state.date = parsed.date;
        if (parsed.subject) state.subject = parsed.subject;
        if (parsed.topicId) state.topicId = parsed.topicId;
        if (parsed.taskMode) state.taskMode = parsed.taskMode;
        if (parsed.targetId) state.targetId = parsed.targetId;
      }

      state.lastResult = null;
      const res = generateProposals();
      if (!res.ok) {
        alert(res.error || 'Could not generate a plan.');
        return;
      }
      state.proposals = res.proposals;
      render();
    }

    if (planBtn) planBtn.addEventListener('click', executePlan);
    if (promptInput) {
      promptInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          executePlan();
        }
      });
    }

    // Intent chips
    document.querySelectorAll('.planning-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.intent = btn.dataset.intent;
        state.proposals = null;
        state.lastResult = null;
        render();
      });
    });

    // Subject dropdown
    const subjSel = document.getElementById('plan-ctrl-subject');
    if (subjSel) {
      subjSel.addEventListener('change', function () {
        state.subject = subjSel.value;
        const topicsMap = (typeof PlannerData !== 'undefined' ? PlannerData.getTopicsBySubject() : {});
        const tList = topicsMap[state.subject] || [];
        state.topicId = tList.length ? tList[0].topicId : '';
        state.proposals = null;
        render();
      });
    }

    // Topic dropdown
    const topSel = document.getElementById('plan-ctrl-topic');
    if (topSel) {
      topSel.addEventListener('change', function () {
        state.topicId = topSel.value;
        state.proposals = null;
      });
    }

    // Mode dropdown
    const modeSel = document.getElementById('plan-ctrl-mode');
    if (modeSel) {
      modeSel.addEventListener('change', function () {
        state.taskMode = modeSel.value;
        state.proposals = null;
      });
    }

    // Date picker
    const dateInput = document.getElementById('plan-ctrl-date');
    if (dateInput) {
      dateInput.addEventListener('change', function () {
        state.date = dateInput.value;
        state.proposals = null;
      });
    }

    // Quick date buttons
    document.querySelectorAll('.planning-quick-date').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.date = btn.dataset.setDate;
        state.proposals = null;
        render();
      });
    });

    // Target dropdown
    const tgtSel = document.getElementById('plan-ctrl-target');
    if (tgtSel) {
      tgtSel.addEventListener('change', function () {
        state.targetId = tgtSel.value;
        state.proposals = null;
      });
    }

    // Proposal item removal
    document.querySelectorAll('.planning-proposal-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        if (state.proposals && state.proposals[idx]) {
          state.proposals.splice(idx, 1);
          render();
        }
      });
    });

    // Accept proposals button
    const acceptBtn = document.getElementById('planning-accept-btn');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function () {
        acceptProposals();
      });
    }

    // Cancel proposals
    const cancelPropsBtn = document.getElementById('planning-cancel-proposals-btn');
    if (cancelPropsBtn) {
      cancelPropsBtn.addEventListener('click', function () {
        state.proposals = null;
        render();
      });
    }

    // Go to Planner button
    const gotoPlannerBtn = document.getElementById('planning-goto-planner-btn');
    if (gotoPlannerBtn) {
      gotoPlannerBtn.addEventListener('click', function () {
        Modal.close();
        if (typeof Nav !== 'undefined') {
          Nav.switchTo('library');
        }
      });
    }

    // New Plan button
    const newPlanBtn = document.getElementById('planning-new-plan-btn');
    if (newPlanBtn) {
      newPlanBtn.addEventListener('click', function () {
        state.lastResult = null;
        state.proposals = null;
        state.prompt = '';
        render();
      });
    }
  }

  function render() {
    Modal.open(renderHtml(), { size: 'lg' });
    bindEvents();
  }

  // ---------- Public Universal API ----------

  function open(options) {
    const opts = options || {};
    state.proposals = null;
    state.lastResult = null;
    state.prompt = opts.prompt || '';
    state.intent = opts.intent || 'topic';
    state.date = opts.date || todayStr();

    if (opts.subject) {
      state.subject = opts.subject;
      state.intent = 'topic';
    } else if (typeof PlannerData !== 'undefined') {
      const allSub = PlannerData.getAllSubjects();
      state.subject = allSub[0] || '';
    }

    if (opts.topicId) {
      state.topicId = opts.topicId;
      state.intent = 'topic';
    } else if (state.subject && typeof PlannerData !== 'undefined') {
      const tMap = PlannerData.getTopicsBySubject();
      const tList = tMap[state.subject] || [];
      state.topicId = tList.length ? tList[0].topicId : '';
    }

    if (opts.targetId) {
      state.targetId = opts.targetId;
      state.intent = 'target';
    }

    if (opts.prompt) {
      const parsed = parseNaturalInput(opts.prompt);
      if (parsed.intent) state.intent = parsed.intent;
      if (parsed.date) state.date = parsed.date;
      if (parsed.subject) state.subject = parsed.subject;
      if (parsed.topicId) state.topicId = parsed.topicId;
      if (parsed.targetId) state.targetId = parsed.targetId;
    }

    // If preselected with an explicit topic or target, generate proposal right away
    if (opts.topicId || opts.targetId) {
      const res = generateProposals();
      if (res.ok) state.proposals = res.proposals;
    }

    render();
  }

  return {
    open: open,
    parseNaturalInput: parseNaturalInput
  };
})();

if (typeof window !== 'undefined') {
  window.PlanningAgentUI = PlanningAgentUI;
  if (typeof PlanningAgent !== 'undefined') {
    PlanningAgent.openUI = function (opts) {
      PlanningAgentUI.open(opts);
    };
  }
}
