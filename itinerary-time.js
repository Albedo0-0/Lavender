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

  return {
    pad: pad,
    todayStr: todayStr,
    timeStrToMs: timeStrToMs,
    timeStrToMinutes: timeStrToMinutes,
    minutesToTimeStr: minutesToTimeStr,
    formatDuration: formatDuration
  };
})();
