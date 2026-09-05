// nav.js — switches between empty screen placeholders. Loaded after state.js.

const Nav = (function () {
  const screens = ['calendar', 'journal', 'planner', 'study', 'progress'];

  function switchTo(screenName) {
    if (!screens.includes(screenName)) return;

    screens.forEach(function (name) {
      const el = document.getElementById('screen-' + name);
      if (el) el.style.display = (name === screenName) ? 'block' : 'none';
    });

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.screen === screenName);
    });

    State.set({ currentScreen: screenName });

    // Refresh the screen being switched into so it always reflects the latest
    // shared data (e.g. a task completed in Planner shows correctly in Calendar's Date Hub, and vice versa).
    if (screenName === 'calendar' && typeof Calendar !== 'undefined' && Calendar.isReady && Calendar.isReady() && Calendar.render) Calendar.render();
    if (screenName === 'planner' && typeof Planner !== 'undefined' && Planner.render) Planner.render();
    if (screenName === 'study' && typeof Study !== 'undefined' && Study.render) Study.render();
    if (screenName === 'journal' && typeof Journal !== 'undefined' && Journal.render) Journal.render();
    if (screenName === 'progress' && typeof Progress !== 'undefined' && Progress.render) Progress.render();
  }
  function init() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTo(btn.dataset.screen);
      });
    });

    const startScreen = State.get().currentScreen || 'calendar';
    switchTo(startScreen);
  }

  return { switchTo, init };
})();
