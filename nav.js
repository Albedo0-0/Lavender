// nav.js — switches between empty screen placeholders. Loaded after state.js.

const Nav = (function () {
  const screens = ['calendar', 'journal', 'library', 'study', 'progress'];
  function switchTo(screenName) {
    if (screenName === 'library' && typeof Library !== 'undefined' && Library.render) Library.render();
    screens.forEach(function (name) {
      const el = document.getElementById('screen-' + name);
      if (el) el.style.display = (name === screenName) ? 'block' : 'none';
    });

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.screen === screenName);
    });

    const lockBtn = document.getElementById('journal-lock-toggle');
    if (lockBtn) lockBtn.style.display = (screenName === 'journal') ? 'inline-block' : 'none';

    State.set({ currentScreen: screenName });

    // Refresh the screen being switched into so it always reflects the latest
    // shared data (e.g. a task completed in Planner shows correctly in Calendar's Date Hub, and vice versa).
    if (screenName === 'calendar' && typeof Calendar !== 'undefined' && Calendar.isReady && Calendar.isReady() && Calendar.render) Calendar.render();
  
    if (screenName === 'study' && typeof Study !== 'undefined' && Study.render) Study.render();
    if (screenName === 'journal' && typeof Journal !== 'undefined' && Journal.enterViaNav) Journal.enterViaNav();
    if (screenName === 'progress' && typeof Progress !== 'undefined' && Progress.render) Progress.render();
  }
  function init() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTo(btn.dataset.screen);
      });
    });

    const utilBtn = document.getElementById('utility-menu-btn');
const utilDrawer = document.getElementById('utility-drawer');
if (utilBtn && utilDrawer) {
  utilBtn.addEventListener('click', function () {
    utilDrawer.style.display = utilDrawer.style.display === 'none' ? 'flex' : 'none';
  });
}
const fullscreenBtn = document.getElementById('fullscreen-btn');
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', function () {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });
}
    
    const startScreen = State.get().currentScreen || 'calendar';
    switchTo(startScreen);
  }

  return { switchTo, init };
})();
