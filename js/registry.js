/* Every app in one list, so the Dock, Launchpad, Spotlight, Finder and the phone home
   screen all agree. -> window.MacRegistry */
(function () {
  'use strict';

  // Apps written as separate modules may load after this file; resolve them at call time.
  const via = (globalName) => () => {
    const mod = window[globalName];
    return mod && typeof mod.open === 'function' ? mod.open() : null;
  };
  const apps = () => window.MacApps;

  // windows: the window ids that count as this app running (defaults to [id]).
  const APPS = Object.freeze([
    { id: 'finder', name: 'Finder', icon: 'finder', open: () => apps().projects(), windows: ['projects', 'trash'], dock: true, launchpad: false },
    { id: 'launchpad', name: 'Launchpad', icon: 'launchpad', open: () => window.MacLaunchpad.open(), dock: true, launchpad: false },
    { id: 'notes', name: 'Notes', icon: 'notes', open: via('MacNotes'), dock: true, launchpad: true },
    { id: 'music', name: 'Music', icon: 'music', open: via('MacMusic'), dock: true, launchpad: true },
    { id: 'blockcraft', name: 'Blockcraft', icon: 'blockcraft', open: via('MacBlockcraft'), dock: true, launchpad: true },
    { id: 'terminal', name: 'Terminal', icon: 'terminal', open: () => apps().terminal(), dock: true, launchpad: true },
    { id: 'calculator', name: 'Calculator', icon: 'calculator', open: via('MacCalculator'), dock: true, launchpad: true },
    { id: 'settings', name: 'System Settings', icon: 'settings', open: () => window.MacSettings.open(), dock: true, launchpad: true },
    { id: 'about', name: 'About Me', icon: 'about', open: () => apps().about(), dock: 'me', launchpad: true },
    { id: 'resume', name: 'Resume', icon: 'resume', open: () => apps().resume(), dock: 'me', launchpad: true },
    { id: 'contact', name: 'Contact', icon: 'contact', open: () => apps().contact(), dock: 'me', launchpad: true },
    { id: 'projects', name: 'Projects', icon: 'folder', open: () => apps().projects(), dock: false, launchpad: true },
  ].map(Object.freeze));

  const get = (id) => APPS.find((a) => a.id === id) || null;
  const windowsOf = (app) => app.windows || [app.id];
  const forWindow = (windowId) => APPS.find((a) => a.dock && windowsOf(a).includes(windowId)) || null;

  function open(id) {
    const app = get(id);
    if (app) app.open();
  }

  window.MacRegistry = Object.freeze({ apps: APPS, get, forWindow, windowsOf, open });
})();
