// radio-data.js — centralized radio station list (name + HLS stream URL). Depends on: nothing.
// Add/remove stations here only; player.js reads via RadioData.getStations()/getById().
const RadioData = (function () {
  const stations = [
    { id: 'vividh-bharati', name: 'Vividh Bharati', url: 'https://radio.wavespb.com/live/146ed6ec6dea5a24/146ed6ec6dea5a24.m3u8' },
    { id: 'Akashvani pune', name: 'Pune', url: 'https://radio.wavespb.com/live/39d650ca0476a1fe/39d650ca0476a1fe.m3u8' },
    { id: 'Akashvani pune-fm', name: 'Pune FM', url: 'https://radio.wavespb.com/live/7b3a089ab67dcf3c/7b3a089ab67dcf3c.m3u8' },
  ];

  function getStations() { return stations; }
  function getById(id) { return stations.find(function (s) { return s.id === id; }) || null; }

  return { getStations: getStations, getById: getById };
})();
