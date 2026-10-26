/* User preferences: wallpaper, Dock and sound. Saved per browser. -> window.MacPrefs */
(function () {
  'use strict';

  const { readStore, writeStore } = window.MacDOM;
  const PREFS_KEY = 'vos.prefs';
  const WALLPAPERS = ['tahoe', 'bay', 'hills'];
  const DOCK_MIN = 40;
  const DOCK_MAX = 64;

  const DEFAULTS = Object.freeze({ wallpaper: 'tahoe', dockMagnify: true, dockSize: 50, startupSound: true });

  // Stored values are untrusted: keep only known keys with valid values.
  function validate(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      wallpaper: WALLPAPERS.includes(p.wallpaper) ? p.wallpaper : DEFAULTS.wallpaper,
      dockMagnify: typeof p.dockMagnify === 'boolean' ? p.dockMagnify : DEFAULTS.dockMagnify,
      dockSize: Number.isFinite(p.dockSize) ? Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.round(p.dockSize))) : DEFAULTS.dockSize,
      startupSound: typeof p.startupSound === 'boolean' ? p.startupSound : DEFAULTS.startupSound,
    });
  }

  function load() {
    try {
      return validate(JSON.parse(readStore('localStorage', PREFS_KEY) || 'null'));
    } catch (err) {
      return DEFAULTS;
    }
  }

  let prefs = load();

  function set(key, value) {
    prefs = validate({ ...prefs, [key]: value });
    writeStore('localStorage', PREFS_KEY, JSON.stringify(prefs));
    document.dispatchEvent(new CustomEvent('mac:prefs', { detail: { key, prefs } }));
  }

  window.MacPrefs = Object.freeze({
    get: (key) => prefs[key],
    all: () => prefs,
    set,
    WALLPAPERS,
    DOCK_MIN,
    DOCK_MAX,
  });
})();
