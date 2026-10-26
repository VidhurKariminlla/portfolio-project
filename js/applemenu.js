/* Contents of the system menu at the far left of the menu bar. -> window.MacAppleMenu */
(function () {
  'use strict';

  function items() {
    const A = window.MacApps;
    const B = window.MacBoot;
    const name = A.firstName();
    return [
      { label: `About ${name} OS`, action: () => window.MacSettings.open('about') },
      '-',
      { label: 'System Settings…', icon: 'settings', action: () => window.MacSettings.open() },
      { label: 'Launchpad', icon: 'launchpad', action: () => window.MacLaunchpad.open() },
      '-',
      { label: 'About Me', icon: 'about', action: () => A.about() },
      { label: 'Resume', icon: 'resume', action: () => A.resume() },
      { label: 'Contact', icon: 'contact', action: () => A.contact() },
      '-',
      { heading: 'Recent Projects' },
      ...window.MacData.projects.map((p) => ({ label: p.title, icon: 'folder', action: () => A.openProject(p.id) })),
      '-',
      { label: 'Sleep', action: () => B.sleep() },
      { label: 'Restart…', action: () => B.restart() },
      { label: 'Shut Down…', action: () => B.shutDown() },
      '-',
      { label: 'Lock Screen', action: () => B.lock() },
      { label: `Log Out ${name}…`, action: () => B.logOut() },
    ];
  }

  window.MacAppleMenu = Object.freeze({ items });
})();
