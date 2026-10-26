/* Light / dark appearance. 'auto' follows the visitor's system setting. -> window.MacTheme */
(function () {
  'use strict';

  const { readStore, writeStore } = window.MacDOM;
  const THEME_KEY = 'vos.theme';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  let mode = readStore('localStorage', THEME_KEY) || 'auto';

  function apply() {
    if (mode === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    document.dispatchEvent(new CustomEvent('mac:theme', { detail: { mode } }));
  }

  function set(next) {
    mode = next === 'light' || next === 'dark' ? next : 'auto';
    writeStore('localStorage', THEME_KEY, mode === 'auto' ? null : mode);
    apply();
  }

  const isDark = () => mode === 'dark' || (mode === 'auto' && systemDark.matches);

  systemDark.addEventListener('change', apply);
  apply();

  window.MacTheme = Object.freeze({ get: () => mode, set, isDark });
})();
