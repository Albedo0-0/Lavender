// nav.js — switches between empty screen placeholders. Loaded after state.js.

const Nav = (function () {
  const screens = ['calendar', 'journal', 'planner', 'progress'];

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

