// assistant-data.js — Assistant data layer (§B.7). Depends on: State, PlannerData, TimeEngine,
// JournalData, ProgressData, WaterData, SleepData.
// Assistant is a READ-ONLY overview over everything above — it stores nothing of its own except
// notes (State.get().assistantNotes). Note: per explicit instruction, "Notepad" and "Quick Capture"
// from the spec are the SAME feature here — one list of free-text notes, not two separate systems.
// assistantNotes[id] = { id, text, createdAt, promotedToTaskId } — promotedToTaskId is unused today,
// kept so a note can later be turned into a Planner task without a data migration.
const AssistantData = (function () {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function tomorrowStr() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Notepad / Quick Capture (merged) ----------

  function getNotes() {
    const notes = State.get().assistantNotes || {};
    return Object.keys(notes).map(function (id) { return notes[id]; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function addNote(text) {
    if (!text || !text.trim()) return null;
    const all = Object.assign({}, State.get().assistantNotes || {});
    const id = generateId('note');
    const note = { id: id, text: text.trim(), createdAt: Date.now(), promotedToTaskId: null };
    all[id] = note;
    State.set({ assistantNotes: all });
    return note;
  }

  function updateNote(id, text) {
    const all = Object.assign({}, State.get().assistantNotes || {});
    if (!all[id]) return null;
    all[id] = Object.assign({}, all[id], { text: text });
    State.set({ assistantNotes: all });
    return all[id];
  }

  function removeNote(id) {
    const all = Object.assign({}, State.get().assistantNotes || {});
    delete all[id];
    State.set({ assistantNotes: all });
  }

  // ---------- §7.1 Today overview ----------

  // Totals reuse ProgressData's exact merge logic (Journal manual entry + TimeEngine sessions)
  // so Assistant's numbers always match Progress's for the same day.
  function getTodayTotals() {
    const today = todayStr();
    const stats = TimeEngine.getDayStats(today);
    const entry = JournalData.getEntry(today);
    return {
      studyMs: stats.studyMs,
      breakMs: stats.breakMs,
      questionsSolved: ProgressData.questionsValue(entry, today) || 0
    };
  }

  function emptyBuckets() {
    const buckets = {};
    PlannerData.SUBJECTS.concat(['Other']).forEach(function (s) {
      buckets[s] = { studyMs: 0, questionsSolved: 0 };
    });
    return buckets;
  }

  function getTodaySubjectBreakdown() {
    const today = todayStr();
    const recs = TimeEngine.getRecordsForDate(today);
    const tasks = PlannerData.getAllTasks();
    const buckets = emptyBuckets();
    recs.forEach(function (rec) {
      const task = rec.taskId ? tasks[rec.taskId] : null;
      const subject = (task && task.subject) || 'Other';
      const bucket = buckets[subject] || buckets.Other;
      bucket.studyMs += TimeEngine.getLiveStudyMs(rec);
      bucket.questionsSolved += Number(rec.questionsSolved) || 0;
    });
    return buckets;
  }

  // ---------- §7.2 Subject drill-down ----------
  // Reuses Planner's topic IDs directly — no second topic table.

  function getSubjectTopicsToday(subject) {
    const today = todayStr();
    const recs = TimeEngine.getRecordsForDate(today);
    const tasks = PlannerData.getAllTasks();
    const byTopic = {};
    recs.forEach(function (rec) {
      const task = rec.taskId ? tasks[rec.taskId] : null;
      if (!task || task.subject !== subject || !task.topicId) return;
      const key = task.topicId;
      if (!byTopic[key]) byTopic[key] = { topicId: key, topicName: task.topicName, studyMs: 0, questionsSolved: 0, note: '' };
      byTopic[key].studyMs += TimeEngine.getLiveStudyMs(rec);
      byTopic[key].questionsSolved += Number(rec.questionsSolved) || 0;
      if (!byTopic[key].note && task.note) byTopic[key].note = task.note;
    });
    return Object.keys(byTopic).map(function (k) { return byTopic[k]; })
      .sort(function (a, b) { return a.topicName.localeCompare(b.topicName); });
  }

  // ---------- §7.3 Timeline — today's sessions + breaks, built only from Time Engine records ----------

  function getTodayTimeline() {
    const today = todayStr();
    const tasks = PlannerData.getAllTasks();
    const recs = TimeEngine.getRecordsForDate(today).filter(function (r) { return r.actualStart; });
    const breaks = (State.get().timeEngineBreaks || []).filter(function (b) { return b.date === today; });
    const items = [];
    recs.forEach(function (rec) {
      const task = rec.taskId ? tasks[rec.taskId] : null;
      items.push({
        type: 'session',
        label: task ? task.topicName : 'Standalone study',
        at: rec.actualStart,
        durationMs: TimeEngine.getLiveStudyMs(rec)
      });
    });
    breaks.forEach(function (b) {
      items.push({ type: 'break', label: b.type || 'Break', at: new Date(b.startedAt).toTimeString().slice(0, 5), durationMs: b.durationMs });
    });
    return items.sort(function (a, b) { return (a.at || '').localeCompare(b.at || ''); });
  }

  // ---------- §7.3 Pending / Tomorrow — direct reads, no duplicate storage ----------

  function getPending() { return PlannerData.getPendingTasks(); }
  function getTomorrow() { return PlannerData.getTasksForDate(tomorrowStr()); }

  // ---------- §7.3 Where I Left Off ----------

  // Bug fix: previously only looked at today's records and sorted with .localeCompare() on a
  // numeric timestamp (actualStart), which threw. Now scans backward across every tracked date
  // (most recent first) so it finds the most recent real study activity even from a previous day,
  // and sorts purely numerically. Also reports the date/isToday so the UI can show it correctly.
  function getWhereLeftOff() {
    const today = todayStr();
    const dates = TimeEngine.getAllTrackedDates().slice().sort(); // 'YYYY-MM-DD' sorts chronologically
    let rec = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      const recs = TimeEngine.getRecordsForDate(dates[i]).filter(function (r) { return r.actualStart; });
      if (!recs.length) continue;
      recs.sort(function (a, b) {
        return (Number(b.activeSince) || 0) - (Number(a.activeSince) || 0) || (Number(b.actualStart) || 0) - (Number(a.actualStart) || 0);
      });
      rec = recs[0];
      break;
    }
    if (!rec) return null;
    // Task may have been edited/deleted since the session ran — fall back to standalone display.
    const task = rec.taskId ? PlannerData.getAllTasks()[rec.taskId] : null;
    return {
      date: rec.date,
      isToday: rec.date === today,
      subject: task ? task.subject : null,
      topicName: task ? task.topicName : 'Standalone study',
      taskLabel: task ? PlannerData.taskLabel(task) : null,
      note: task ? task.note : '',
      state: rec.state,
      studyMs: TimeEngine.getLiveStudyMs(rec)
    };
  }

  // ---------- §7.4 Daily summary — degrades gracefully (§7.5) because TimeEngine's own
  // getDayStats/getQuestionsForDate already fall back to dailySummaries past the retention window;
  // Assistant doesn't need separate degrade logic. ----------

  function getDailySummary(dateStr) {
    const stats = TimeEngine.getDayStats(dateStr);
    const entry = JournalData.getEntry(dateStr);
    const questions = ProgressData.questionsValue(entry, dateStr) || 0;
    const water = (typeof WaterData !== 'undefined') ? WaterData.getScoreForDate(dateStr) : null;
    const sleepRec = (typeof SleepData !== 'undefined') ? SleepData.getRecord(dateStr) : null;
    const sleepHours = (sleepRec && sleepRec.completed) ? Math.round((sleepRec.durationMin / 60) * 10) / 10 : null;
    const tasksForDate = PlannerData.getTasksForDate(dateStr);
    return {
      date: dateStr,
      studyMs: stats.studyMs,
      breakMs: stats.breakMs,
      questionsSolved: questions,
      hydrationScore: water,
      sleepHours: sleepHours,
      tasksTotal: tasksForDate.length,
      tasksCompleted: tasksForDate.filter(function (t) { return t.completed; }).length
    };
  }

  // ---------- §7.3 Global Search — reuses existing data, no separate search index ----------

  function search(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const results = [];

    PlannerData.getTasksList().forEach(function (t) {
      const hay = [t.topicName, t.title, t.note].filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(q) !== -1) results.push({ type: t.completed ? 'Study history' : 'Planner task', text: t.topicName || t.title || 'Task', date: t.date, ref: { kind: 'task', taskId: t.taskId } });
    });

    PlannerData.getAllTopics && Object.keys(PlannerData.getAllTopics()).forEach(function (id) {
      const topic = PlannerData.getAllTopics()[id];
      const tags = Array.isArray(topic.tags) ? topic.tags.join(' ') : '';
      const hay = [topic.topicName, tags, topic.notes].filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(q) !== -1) results.push({ type: 'Library topic', text: topic.topicName, date: '', ref: { kind: 'topic', subject: topic.subject, topicId: topic.topicId } });
    });

    // Journal text — respects the lock; locked entries are never surfaced by search.
    if (!JournalData.isLocked()) {
      const entries = JournalData.getAllEntries();
      Object.keys(entries).forEach(function (dateStr) {
        const e = entries[dateStr];
        if (e.diaryText && e.diaryText.toLowerCase().indexOf(q) !== -1) {
          results.push({ type: 'Journal', text: e.diaryText.slice(0, 80), date: dateStr, ref: { kind: 'journal', date: dateStr } });
        }
      });
    }

    

    getNotes().forEach(function (n) {
      if (n.text.toLowerCase().indexOf(q) !== -1) {
        results.push({ type: 'Notepad', text: n.text.slice(0, 80), date: new Date(n.createdAt).toISOString().slice(0, 10), ref: { kind: 'note', id: n.id } });
      }
    });

    return results;
  }

  return {
    getNotes: getNotes,
    addNote: addNote,
    updateNote: updateNote,
    removeNote: removeNote,
    getTodayTotals: getTodayTotals,
    getTodaySubjectBreakdown: getTodaySubjectBreakdown,
    getSubjectTopicsToday: getSubjectTopicsToday,
    getTodayTimeline: getTodayTimeline,
    getPending: getPending,
    getTomorrow: getTomorrow,
    getWhereLeftOff: getWhereLeftOff,
    getDailySummary: getDailySummary,
    search: search,
    todayStr: todayStr,
    tomorrowStr: tomorrowStr
  };
})();
