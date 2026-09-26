const ItineraryTime = (function () {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    const t = new Date();
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function timeStrToMs(dateStr, hhmm) { return new Date(dateStr + 'T' + hhmm + ':00').getTime(); }

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
    formatDuration: formatDuration
  };
})();
