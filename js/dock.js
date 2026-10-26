/* The Dock: app launchers from the registry with magnification and running indicators,
   personal items, minimized windows and the Trash. Right-click for Open / Quit.
   -> window.MacDock */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;

  const MAGNIFY_EXTRA = 26; // px an icon grows under the pointer
  const RANGE = 150; // how far magnification spreads either side, in px
  const BOUNCE_MS = 720;
  const DOCK_GAP = 6; // space between the Dock and the bottom edge
  const WINDOW_GAP = 8; // space kept between windows and the top of the Dock
  const NARROW_W = 760;

  const R = () => window.MacRegistry;
  const TRASH = Object.freeze({ id: 'trash-can', name: 'Trash', icon: 'trash', open: () => window.MacApps.trash(), windows: ['trash'] });

  const nodes = new Map(); // app id -> button
  let root = null;
  let minRow = null;
  let minSep = null;
  let pointerX = null;
  let frame = 0;

  const isRunning = (app, list) => R().windowsOf(app).some((id) => list.some((w) => w.id === id));
  const canMagnify = () =>
    window.MacPrefs.get('dockMagnify') &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    window.innerWidth >= NARROW_W;

  function bounce(btn) {
    btn.classList.remove('is-launching');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('is-launching');
    setTimeout(() => btn.classList.remove('is-launching'), BOUNCE_MS);
  }

  function launch(app, btn) {
    const winId = R().windowsOf(app).find((id) => window.MacWM.get(id));
    if (winId) {
      window.MacWM.show(winId);
      return;
    }
    if (app.id !== 'launchpad') bounce(btn);
    app.open();
  }

  function quit(app) {
    R().windowsOf(app).forEach((id) => window.MacWM.close(id));
  }

  function contextItems(app) {
    const running = isRunning(app, window.MacWM.list());
    return [
      { label: running ? 'Show' : 'Open', action: () => launch(app, nodes.get(app.id)) },
      running ? { label: 'Hide', action: () => R().windowsOf(app).forEach((id) => window.MacWM.get(id) && window.MacWM.minimize(id)) } : null,
      '-',
      app.id === TRASH.id ? { label: 'Empty Trash', action: () => window.MacApps.emptyTrash() } : null,
      { label: 'Options…', action: () => window.MacSettings.open('dock') },
      running && app.id !== 'finder' ? '-' : null,
      running && app.id !== 'finder' ? { label: 'Quit', action: () => quit(app) } : null,
    ];
  }

  function appButton(app) {
    const btn = h(
      'button',
      { class: 'dock-item', type: 'button', 'aria-label': app.name, 'data-app': app.id },
      h('span', { class: 'dock-icon', html: I.get(app.icon, 64, `dock-${app.id}`) }),
      h('span', { class: 'dock-tip', 'aria-hidden': 'true' }, app.name),
      h('span', { class: 'dock-dot', 'aria-hidden': 'true' })
    );
    btn.addEventListener('click', () => launch(app, btn));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.MacMenu.openContext(e.clientX, e.clientY - 8, contextItems(app));
    });
    nodes.set(app.id, btn);
    return btn;
  }

  function minimizedTile(win) {
    return h(
      'button',
      { class: 'dock-item', type: 'button', 'aria-label': `Restore ${win.title}`, 'data-win': win.id, onclick: () => window.MacWM.show(win.id) },
      h('span', { class: 'dock-icon dock-thumb' }, h('span', { class: 'dock-thumb-bar' }), h('span', { class: 'dock-thumb-lines' }),
        h('span', { class: 'dock-thumb-app', html: I.get(win.icon, 64, `min-${win.id}`) })),
      h('span', { class: 'dock-tip', 'aria-hidden': 'true' }, win.title)
    );
  }

  function renderState() {
    const list = window.MacWM.list();
    const all = [...R().apps.filter((a) => a.dock), TRASH];
    all.forEach((app) => {
      const btn = nodes.get(app.id);
      if (!btn) return;
      const running = isRunning(app, list);
      btn.classList.toggle('is-running', running && app.id !== TRASH.id);
      btn.setAttribute('aria-label', `${app.name}${running ? ', open' : ''}`);
    });
    const minimized = list.filter((w) => w.minimized);
    minRow.replaceChildren(...minimized.map(minimizedTile));
    minRow.hidden = !minimized.length;
    minSep.hidden = !minimized.length;
    magnify();
  }

  // Each icon grows with a cosine falloff by its distance from the pointer.
  function magnify() {
    const items = root.querySelectorAll('.dock-item');
    if (pointerX == null || !canMagnify()) {
      items.forEach((item) => item.style.removeProperty('--size'));
      return;
    }
    const base = window.MacPrefs.get('dockSize');
    items.forEach((item) => {
      const r = item.getBoundingClientRect();
      const distance = Math.abs(pointerX - (r.left + r.width / 2));
      const t = distance < RANGE ? Math.cos((distance / RANGE) * (Math.PI / 2)) : 0;
      item.style.setProperty('--size', `${(base + MAGNIFY_EXTRA * t).toFixed(1)}px`);
    });
  }

  function onPointerMove(e) {
    if (e.pointerType !== 'mouse') return;
    pointerX = e.clientX;
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        magnify();
      });
    }
  }

  function applySize() {
    root.style.setProperty('--dock-size', `${window.MacPrefs.get('dockSize')}px`);
  }

  /** Space the Dock takes at the bottom of the screen, so windows can avoid it. */
  function reserve() {
    return root ? root.offsetHeight + DOCK_GAP + WINDOW_GAP : 0;
  }

  /** Where a window minimizes to: its thumbnail if it has one, otherwise its app icon. */
  function targetRect(windowId) {
    if (!root) return null;
    const app = R().forWindow(windowId);
    const node = root.querySelector(`[data-win="${windowId}"]`) || (app && nodes.get(app.id));
    return node ? node.getBoundingClientRect() : null;
  }

  const sep = () => h('span', { class: 'dock-sep', 'aria-hidden': 'true' });

  function init() {
    root = document.getElementById('dock');
    applySize();
    minRow = h('div', { class: 'dock-group dock-mins', role: 'group', 'aria-label': 'Minimized windows', hidden: true });
    minSep = sep();
    minSep.hidden = true;
    root.append(
      h('div', { class: 'dock-group', role: 'group', 'aria-label': 'Apps' }, R().apps.filter((a) => a.dock === true).map(appButton)),
      sep(),
      h('div', { class: 'dock-group dock-me', role: 'group', 'aria-label': 'About me' }, R().apps.filter((a) => a.dock === 'me').map(appButton)),
      sep(),
      minRow,
      minSep,
      appButton(TRASH)
    );
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', () => {
      pointerX = null;
      magnify();
    });
    document.addEventListener('mac:windows', renderState);
    document.addEventListener('mac:prefs', () => {
      applySize();
      magnify();
    });
    renderState();
  }

  window.MacDock = Object.freeze({ init, reserve, targetRect });
})();
