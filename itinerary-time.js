const ItineraryTime = (function () {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function timeStrToMs(dateStr, hhmm) { return new Date(dateStr + 'T' + hhmm + ':00').getTime(); }

  // Returns total minutes for an HH:MM string, or null when the input is missing or malformed.
  // Used by itinerary-today.js's itemDurationMin (and any future layer that needs null-safe
  // minute arithmetic). Distinct from itinerary.js's local timeStrToMinutes, which falls back
  // to DEFAULT_DAY_START — that builder-specific fallback stays local (Phase 5 / Finding 6).
  function timeStrToMinutes(hhmm) {
    if (!hhmm || hhmm.indexOf(':') === -1) return null;
    const parts = hhmm.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }

  // Converts a total-minutes value back to an HH:MM string, wrapping past midnight (Phase 5 /
  // Finding 6 — shared time helper, previously private to itinerary.js's builder).
  function minutesToTimeStr(totalMin) {
    const m = ((totalMin % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function formatDuration(min) {
    min = Math.round(min || 0);
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  // Missed/late detection (Phase C-2) — single shared copy, previously duplicated verbatim in
  // itinerary-today.js (render-time) and itinerary-orchestrator.js (pill firing). Pure: no state.
  const LATE_THRESHOLD_MS = 5 * 60 * 1000;
  const BUILD_FINISH_GRACE_MS = 30 * 60 * 1000; // suppress late for startOnBuildFinish within 30 min

  function plannedStartMs(it) { return it.plannedStart ? timeStrToMs(todayStr(), it.plannedStart) : null; }
  function isMissed(it, nowMs) {
    if (it.state !== 'pending') return false;
    if (it.startOnBuildFinish) return false;
    const ms = plannedStartMs(it);
    return ms !== null && (nowMs === undefined ? Date.now() : nowMs) > ms;
  }
  function isLate(it) {
    if (it.state !== 'active' || !it.actualStart) return false;
    if (it.startOnBuildFinish) {
      const ms = plannedStartMs(it);
      if (ms !== null && (it.actualStart - ms) < BUILD_FINISH_GRACE_MS) return false;
    }
    const ms = plannedStartMs(it);
    return ms !== null && (it.actualStart - ms) > LATE_THRESHOLD_MS;
  }

  return {
    LATE_THRESHOLD_MS: LATE_THRESHOLD_MS,
    BUILD_FINISH_GRACE_MS: BUILD_FINISH_GRACE_MS,
    plannedStartMs: plannedStartMs,
    isMissed: isMissed,
    isLate: isLate,
    pad: pad,
    todayStr: todayStr,
    timeStrToMs: timeStrToMs,
    timeStrToMinutes: timeStrToMinutes,
    minutesToTimeStr: minutesToTimeStr,
    formatDuration: formatDuration
  };
})();
