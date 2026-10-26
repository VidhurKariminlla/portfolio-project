/* The menu bar: system menu, the focused app's name and menus, status items (Wi-Fi,
   battery, Spotlight, Control Center) and the clock, which opens Notification Center.
   -> window.MacMenuBar */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const CLOCK_MS = 10000;

  const titles = new Map();
  let registry = new Map();
  let order = [];
  let menu = null;
  let openId = null;

  const WM = () => window.MacWM;
  const appName = () => WM().activeApp() || 'Finder';

  // ---- Menu contents (built fresh each time a menu opens) ---------------------------

  function appItems() {
    const active = WM().active();
    const name = appName();
    return [
      { label: `About ${name === 'Finder' ? `${window.MacApps.firstName()} OS` : name}`, action: () => window.MacApps.about() },
      '-',
      { label: 'Settings…', shortcut: '⌘,', action: () => window.MacSettings.open() },
      '-',
      { label: `Hide ${name}`, disabled: !active, action: () => WM().minimize(active.id) },
      { label: 'Show All', action: () => WM().restoreAll() },
      '-',
      { label: `Quit ${name}`, disabled: !active, action: () => active.close() },
    ];
  }

  function fileItems() {
    const active = WM().active();
    return [
      { label: 'New Finder Window', action: () => window.MacApps.projects() },
      { label: 'New Note', action: () => window.MacRegistry.open('notes') },
      { label: 'Open Selected', disabled: !window.MacDesktop.selected(), action: () => window.MacDesktop.openSelected() },
      '-',
      { label: 'Close Window', disabled: !active, action: () => active.close() },
      '-',
      { label: 'Download Resume (.txt)', action: () => window.MacApps.saveResume() },
    ];
  }

  function editItems() {
    return [
      { label: 'Undo', shortcut: '⌘Z', disabled: true },
      { label: 'Redo', shortcut: '⇧⌘Z', disabled: true },
      '-',
      { label: 'Cut', shortcut: '⌘X', disabled: true },
      { label: 'Copy', shortcut: '⌘C', disabled: true },
      { label: 'Paste', shortcut: '⌘V', disabled: true },
      '-',
      { label: 'Copy Email Address', disabled: !window.MacApps.hasEmail(), action: () => window.MacApps.copyEmail(null) },
      '-',
      { label: 'Spotlight Search', shortcut: '⌘K', action: () => window.MacSpotlight.open() },
    ];
  }

  function viewItems() {
    const tools = WM().activeTools();
    const tool = (id) => tools.find((t) => t.id === id);
    const icons = tool('icons');
    const list = tool('list');
    const mode = window.MacTheme.get();
    return [
      { label: 'as Icons', checked: Boolean(icons && icons.pressed), disabled: !icons, action: () => WM().runTool('icons') },
      { label: 'as List', checked: Boolean(list && list.pressed), disabled: !list, action: () => WM().runTool('list') },
      '-',
      { heading: 'Appearance' },
      { label: 'Light', checked: mode === 'light', action: () => window.MacTheme.set('light') },
      { label: 'Dark', checked: mode === 'dark', action: () => window.MacTheme.set('dark') },
      { label: 'Auto', checked: mode === 'auto', action: () => window.MacTheme.set('auto') },
      '-',
      { label: 'Clean Up Desktop', action: () => window.MacDesktop.cleanUp() },
    ];
  }

  function goItems() {
    const F = window.MacFinder;
    return [
      { label: 'Applications', icon: 'folder', shortcut: '⇧⌘A', action: () => F.go('applications') },
      { label: 'Documents', icon: 'folder', shortcut: '⇧⌘O', action: () => F.go('documents') },
      { label: 'Projects', icon: 'folder', action: () => F.go('all') },
      '-',
      { label: 'Launchpad', icon: 'launchpad', action: () => window.MacLaunchpad.open() },
    ];
  }

  function windowItems() {
    const active = WM().active();
    const list = WM().list();
    return [
      { label: 'Minimize', shortcut: '⌘M', disabled: !active, action: () => WM().minimize(active.id) },
      { label: 'Zoom', disabled: !active, action: () => WM().maximize(active.id) },
      '-',
      { label: 'Bring All to Front', disabled: !list.length, action: () => WM().restoreAll() },
      list.length ? '-' : null,
      ...list.map((w) => ({ label: w.title, icon: w.icon, checked: w.active, action: () => WM().show(w.id) })),
    ];
  }

  function helpItems() {
    return [
      { label: 'Show Welcome Tips', action: () => window.MacApps.welcome() },
      { label: 'Terminal Commands', action: () => window.MacApps.terminal() },
      { label: 'About This Site', action: () => window.MacSettings.open('about') },
    ];
  }

  // ---- Control Center ------------------------------------------------------------------

  function ccTile(name, stateText, icon, on, onClick) {
    return h(
      'button',
      { class: `cc-tile${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick: onClick },
      h('span', { class: 'cc-tile-icon', html: I.glyph(icon, 16) }),
      h('span', {}, h('span', { class: 'cc-tile-name' }, name), h('span', { class: 'cc-tile-state' }, stateText))
    );
  }

  function nowPlayingTile(refresh) {
    const M = window.MacMusic;
    const s = M && M.getState ? M.getState() : null;
    const track = s && s.track;
    return h(
      'div',
      { class: 'cc-wide cc-music' },
      h('span', { class: 'cc-music-art', html: track && s.artSvg ? s.artSvg('cc') : I.get('music', 40, 'cc-music') }),
      h('span', { class: 'cc-music-text' }, h('span', { class: 'cc-tile-name' }, track ? track.title : 'Not Playing'),
        h('span', { class: 'cc-tile-state' }, track ? track.artist : 'Music')),
      h('button', {
        class: 'cc-music-btn', type: 'button', 'aria-label': s && s.playing ? 'Pause' : 'Play',
        html: I.glyph(s && s.playing ? 'pause' : 'play', 18),
        onclick: () => {
          if (M && M.toggle) M.toggle();
          else window.MacRegistry.open('music');
          setTimeout(refresh, 60);
        },
      })
    );
  }

  function controlCenter(refresh) {
    const muted = window.MacAudio.isMuted();
    const dark = window.MacTheme.isDark();
    const mode = window.MacTheme.get();
    const setMode = (m) => () => {
      window.MacTheme.set(m);
      refresh();
    };
    return h(
      'div',
      { class: 'cc' },
      ccTile('Sound', muted ? 'Off' : 'On', muted ? 'mute' : 'sound', !muted, () => {
        window.MacAudio.toggle();
        refresh();
      }),
      ccTile('Dark Mode', dark ? 'On' : 'Off', 'moon', dark, setMode(dark ? 'light' : 'dark')),
      nowPlayingTile(refresh),
      h(
        'div',
        { class: 'cc-wide' },
        h('p', { class: 'cc-wide-label' }, 'Appearance'),
        h('div', { class: 'cc-seg', role: 'group', 'aria-label': 'Appearance' },
          ['light', 'dark', 'auto'].map((m) =>
            h('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: setMode(m) }, m[0].toUpperCase() + m.slice(1))
          ))
      ),
      h('button', { class: 'cc-wide cc-link', type: 'button', onclick: () => { close(); window.MacSettings.open(); } }, 'System Settings…')
    );
  }

  // ---- Pull-down mechanics ------------------------------------------------------------

  function buildMenu(def) {
    if (def.panel) {
      const panel = h('div', { class: 'menu menu-panel', role: 'dialog', 'aria-label': def.aria });
      const controls = () => [...panel.querySelectorAll('button')];
      const refresh = () => {
        const index = controls().indexOf(document.activeElement); // keep keyboard focus in place
        panel.replaceChildren(def.panel(refresh));
        if (index >= 0 && controls()[index]) controls()[index].focus();
      };
      refresh();
      // Keep the Now Playing tile live, but only when the track or play state changes.
      let musicKey = null;
      const onMusic = (e) => {
        if (!panel.isConnected) {
          document.removeEventListener('mac:music', onMusic);
          return;
        }
        const s = e.detail || {};
        const key = `${s.track ? s.track.id : ''}|${Boolean(s.playing)}`;
        if (musicKey !== null && key !== musicKey) refresh();
        musicKey = key;
      };
      document.addEventListener('mac:music', onMusic);
      return panel;
    }
    return window.MacMenu.build(def.items(), (item) => {
      const title = titles.get(openId);
      close();
      item.action();
      // Windows take focus when they open; otherwise return it to the menu title.
      if (document.activeElement === document.body && title) title.focus();
    });
  }

  function open(id, viaKeyboard) {
    close();
    window.MacMenu.closeContext();
    const def = registry.get(id);
    const btn = titles.get(id);
    menu = buildMenu(def);
    menu.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (next && (menu.contains(next) || next.closest('.mb-title'))) return;
      if (next) close(); // Tab moved focus elsewhere; pointer clicks are handled separately
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const left = def.align === 'right' ? r.right - menu.offsetWidth : r.left;
    menu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - menu.offsetWidth - 4))}px`;
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    openId = id;
    window.MacAudio.play('menu');
    if (viaKeyboard) window.MacMenu.moveFocus(menu, 1);
  }

  function close() {
    if (!menu) return;
    const node = menu;
    menu = null;
    node.remove();
    const btn = titles.get(openId);
    if (btn) {
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }
    openId = null;
  }

  function titleButton(def) {
    const btn = h(
      'button',
      {
        class: `mb-title${def.cls ? ` ${def.cls}` : ''}`,
        type: 'button',
        'aria-haspopup': def.panel ? 'dialog' : 'menu',
        'aria-expanded': 'false',
        'aria-label': def.aria || null,
        // detail === 0 means the click came from the keyboard
        onclick: (e) => (openId === def.id ? close() : open(def.id, e.detail === 0)),
        // Mouse only: on touch, pointerenter fires on tap and the click would close it again.
        onpointerenter: (e) => {
          if (e.pointerType === 'mouse' && openId && openId !== def.id && !def.panel) open(def.id, false);
        },
      },
      def.label || ''
    );
    titles.set(def.id, btn);
    return btn;
  }

  function onOutsidePointer(e) {
    if (!menu || menu.contains(e.target) || e.target.closest('.mb-title')) return;
    close();
  }

  function onKey(e) {
    if (document.getElementById('desktop').inert) return; // the boot or lock screen is up
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      window.MacSpotlight.toggle();
      return;
    }
    if (mod && e.key === ',') {
      e.preventDefault();
      window.MacSettings.open();
      return;
    }
    if (!menu) return;
    if (e.key === 'Escape') {
      const btn = titles.get(openId);
      close();
      if (btn) btn.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      window.MacMenu.moveFocus(menu, e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && order.includes(openId)) {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      open(order[(order.indexOf(openId) + step + order.length) % order.length], true);
    }
  }

  // ---- Status items -------------------------------------------------------------------

  function statusButton(icon, label, onClick, cls) {
    return h('button', { class: `mb-title mb-icon${cls ? ` ${cls}` : ''}`, type: 'button', 'aria-label': label, title: label, html: I.glyph(icon, 16), onclick: onClick });
  }

  function renderClock(node) {
    const now = new Date();
    node.replaceChildren(
      h('span', { class: 'mb-date' }, `${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} `),
      now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    );
  }

  function renderSound(btn) {
    const muted = window.MacAudio.isMuted();
    btn.innerHTML = I.glyph(muted ? 'mute' : 'sound', 16);
    btn.setAttribute('aria-label', muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    btn.setAttribute('aria-pressed', String(!muted));
  }

  // Wi-Fi reflects the browser's real online state.
  function renderWifi(btn) {
    const online = navigator.onLine;
    btn.innerHTML = I.glyph(online ? 'wifi' : 'wifiOff', 16);
    btn.setAttribute('aria-label', online ? 'Online' : 'Offline');
    btn.title = online ? 'Connected' : 'Not connected';
  }

  // Battery uses the Battery Status API where the browser offers it; otherwise it hides.
  function wireBattery(node) {
    if (typeof navigator.getBattery !== 'function') return;
    navigator.getBattery().then((battery) => {
      const paint = () => {
        const pct = Math.round(battery.level * 100);
        node.hidden = false;
        node.title = `${pct}%${battery.charging ? ', charging' : ''}`;
        node.setAttribute('aria-label', `Battery ${node.title}`);
        node.querySelector('.mb-batt-fill').style.width = `${Math.max(6, pct)}%`;
        node.classList.toggle('is-charging', battery.charging);
        node.classList.toggle('is-low', pct <= 20 && !battery.charging);
      };
      battery.addEventListener('levelchange', paint);
      battery.addEventListener('chargingchange', paint);
      paint();
    }).catch(() => {});
  }

  function renderAppName() {
    const btn = titles.get('app');
    btn.textContent = appName();
    btn.setAttribute('aria-label', `${appName()} menu`);
  }

  function init() {
    const bar = document.getElementById('menubar');
    const menus = [
      { id: 'system', aria: 'System menu', label: h('span', { class: 'mb-logo', html: I.glyph('logo', 15) }), items: () => window.MacAppleMenu.items() },
      { id: 'app', cls: 'mb-app-name', items: appItems },
      { id: 'file', cls: 'mb-menu', label: 'File', items: fileItems },
      { id: 'edit', cls: 'mb-menu', label: 'Edit', items: editItems },
      { id: 'view', cls: 'mb-menu', label: 'View', items: viewItems },
      { id: 'go', cls: 'mb-menu', label: 'Go', items: goItems },
      { id: 'window', cls: 'mb-menu', label: 'Window', items: windowItems },
      { id: 'help', cls: 'mb-menu', label: 'Help', items: helpItems },
    ];
    const cc = { id: 'cc', cls: 'mb-icon', aria: 'Control Center', align: 'right', panel: controlCenter, label: h('span', { class: 'ico', html: I.glyph('control', 16) }) };
    registry = new Map([...menus, cc].map((d) => [d.id, d]));
    order = menus.map((d) => d.id);

    const sound = statusButton('sound', 'Sound', () => {
      close();
      window.MacAudio.toggle();
    });
    const wifi = statusButton('wifi', 'Wi-Fi', () => {}, 'mb-passive');
    const battery = h('span', { class: 'mb-battery', hidden: true, role: 'img' }, h('span', { class: 'mb-batt-body' }, h('span', { class: 'mb-batt-fill' })));
    const search = statusButton('search', 'Spotlight', () => window.MacSpotlight.toggle());
    const clock = h('button', { class: 'mb-title mb-clock', type: 'button', 'aria-label': 'Notification Center', onclick: () => { close(); window.MacNotifCenter.toggle(); } });
    bar.append(
      h('div', { class: 'mb-left' }, menus.map(titleButton)),
      h('div', { class: 'mb-right' }, sound, wifi, battery, search, titleButton(cc), clock)
    );

    renderClock(clock);
    setInterval(() => renderClock(clock), CLOCK_MS);
    renderSound(sound);
    renderWifi(wifi);
    wireBattery(battery);
    renderAppName();
    window.addEventListener('online', () => renderWifi(wifi));
    window.addEventListener('offline', () => renderWifi(wifi));
    document.addEventListener('mac:sound', () => renderSound(sound));
    document.addEventListener('mac:windows', renderAppName);
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
  }

  window.MacMenuBar = Object.freeze({ init, close });
})();
