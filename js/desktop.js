/* Desktop: wallpaper, Finder-style icons down the right edge (two columns, aliases),
   rubber-band selection, right-click menus, widgets, and the phone home screen and
   status bar. -> window.MacDesktop */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;

  const MENUBAR_H = 28;
  const CELL_W = 96;
  const CELL_H = 100;
  const MARGIN_X = 18;
  const MARGIN_Y = 12;
  const DRAG_THRESHOLD = 4;
  const FEATURE_MS = 7000;

  const apps = () => window.MacApps;
  const reg = (id) => () => window.MacRegistry.open(id);
  // alias: an app shortcut, drawn with the little arrow badge like a macOS alias.
  const ICONS = [
    { id: 'projects', label: 'Projects', icon: 'folder', open: () => apps().projects() },
    { id: 'resume', label: 'Resume.pdf', icon: 'pdf', open: () => apps().resume() },
    { id: 'about', label: 'About Me', icon: 'about', open: () => apps().about(), alias: true },
    { id: 'contact', label: 'Contact', icon: 'contact', open: () => apps().contact(), alias: true },
    { id: 'blockcraft', label: 'Blockcraft', icon: 'blockcraft', open: reg('blockcraft'), alias: true },
    { id: 'notes', label: 'Notes', icon: 'notes', open: reg('notes'), alias: true },
  ];

  const nodes = new Map();
  let moved = {}; // id -> { x, y } for icons the visitor dragged; replaced, never mutated
  let selected = new Set();

  // ---- Wallpaper ---------------------------------------------------------------------

  function applyWallpaper() {
    document.getElementById('wallpaper').dataset.wall = window.MacPrefs.get('wallpaper');
  }

  // ---- Icons -------------------------------------------------------------------------

  function place(id, pos) {
    const node = nodes.get(id);
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
  }

  function clampToDesktop(x, y) {
    return { x: Math.min(Math.max(0, x), window.innerWidth - CELL_W), y: Math.min(Math.max(MENUBAR_H, y), window.innerHeight - CELL_H) };
  }

  // Finder's default arrangement: top-right, down each column, columns leftwards.
  function layout() {
    const top = MENUBAR_H + MARGIN_Y;
    const dock = window.MacDock ? window.MacDock.reserve() : 0;
    const perColumn = Math.max(1, Math.floor((window.innerHeight - top - dock) / CELL_H));
    ICONS.forEach((def, i) => {
      const col = Math.floor(i / perColumn);
      const home = { x: window.innerWidth - MARGIN_X - CELL_W * (col + 1), y: top + (i % perColumn) * CELL_H };
      const drag = moved[def.id];
      place(def.id, drag ? clampToDesktop(drag.x, drag.y) : home);
    });
  }

  function select(ids) {
    selected = new Set(ids);
    nodes.forEach((node, key) => node.classList.toggle('is-selected', selected.has(key)));
  }

  function iconContext(def) {
    return [
      { label: 'Open', action: def.open },
      { label: 'Get Info', action: () => apps().about() },
      '-',
      { label: 'Clean Up Selection', action: () => cleanUp() },
    ];
  }

  function wire(node, def) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (!selected.has(def.id)) select([def.id]);
      const start = { x: e.clientX, y: e.clientY, left: node.offsetLeft, top: node.offsetTop };
      let dragging = false;
      node.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        node.classList.add('is-dragging');
        place(def.id, clampToDesktop(start.left + dx, start.top + dy));
      };
      const end = (ev) => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', end);
        node.removeEventListener('pointercancel', end);
        node.classList.remove('is-dragging');
        if (dragging) moved = { ...moved, [def.id]: { x: node.offsetLeft, y: node.offsetTop } };
        else if (ev.type === 'pointerup' && ev.pointerType !== 'mouse') def.open(); // a tap opens on touch
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    });
    node.addEventListener('dblclick', () => def.open());
    node.addEventListener('focus', () => select([def.id]));
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      def.open();
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      select([def.id]);
      window.MacMenu.openContext(e.clientX, e.clientY, iconContext(def));
    });
  }

  function iconNode(def) {
    return h(
      'button',
      { class: 'd-icon', type: 'button', 'data-id': def.id, 'aria-label': `${def.label}, double-click to open` },
      h('span', { class: 'd-img' }, h('span', { class: 'ico', html: I.get(def.icon, 64, `d-${def.id}`) }),
        def.alias ? h('span', { class: 'd-alias', 'aria-hidden': 'true' }) : null),
      h('span', { class: 'd-label' }, def.label)
    );
  }

  // ---- Rubber-band selection and the desktop menu ------------------------------------

  function wireSelection(desk) {
    const band = h('div', { class: 'd-band', hidden: true });
    desk.appendChild(band);
    desk.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.d-icon, .win, .widget, #home')) return;
      select([]);
      const x0 = e.clientX;
      const y0 = e.clientY;
      desk.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = { left: Math.min(x0, ev.clientX), top: Math.min(y0, ev.clientY), right: Math.max(x0, ev.clientX), bottom: Math.max(y0, ev.clientY) };
        Object.assign(band.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
        band.hidden = false;
        const hit = [...nodes].filter(([, n]) => {
          const b = n.getBoundingClientRect();
          return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        });
        select(hit.map(([id]) => id));
      };
      const end = () => {
        band.hidden = true;
        desk.removeEventListener('pointermove', move);
        desk.removeEventListener('pointerup', end);
        desk.removeEventListener('pointercancel', end);
      };
      desk.addEventListener('pointermove', move);
      desk.addEventListener('pointerup', end);
      desk.addEventListener('pointercancel', end);
    });
    desk.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.d-icon, .win, .widget')) return;
      e.preventDefault();
      window.MacMenu.openContext(e.clientX, e.clientY, [
        { label: 'New Note', action: reg('notes') },
        { label: 'Get Info', action: () => apps().about() },
        '-',
        { label: 'Change Wallpaper…', action: () => window.MacSettings.open('wallpaper') },
        { label: 'Edit Widgets…', disabled: true },
        '-',
        { label: 'Clean Up', action: () => cleanUp() },
        { label: 'Open in Terminal', action: () => apps().terminal() },
      ]);
    });
  }

  // ---- Widgets -----------------------------------------------------------------------

  function calendarWidget() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cells = [
      ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('span', { class: 'cal-dow' }, d)),
      ...Array.from({ length: first }, () => h('span')),
      ...Array.from({ length: days }, (_, i) => {
        const day = i + 1;
        const weekend = (first + i) % 7 === 0 || (first + i) % 7 === 6;
        return h('span', { class: `cal-day${day === now.getDate() ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}` }, String(day));
      }),
    ];
    return h(
      'section',
      { class: 'widget widget-sm widget-cal', 'aria-label': `Calendar. Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}` },
      h('p', { class: 'cal-month' }, now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()),
      h('div', { class: 'cal-grid', 'aria-hidden': 'true' }, cells)
    );
  }

  function nowPlayingWidget() {
    const node = h('section', { class: 'widget widget-sm widget-music', 'aria-label': 'Now Playing' });
    let lastKey = null;
    const paint = () => {
      const M = window.MacMusic;
      const s = M && M.getState ? M.getState() : null;
      const track = s && s.track;
      // Music reports progress twice a second; only rebuild when what we show changes,
      // so the play button keeps its focus and never loses a click mid-repaint.
      const key = `${track ? track.id : ''}|${Boolean(s && s.playing)}`;
      if (key === lastKey) return;
      lastKey = key;
      node.replaceChildren(
        h('span', { class: 'wm-art', html: track && s.artSvg ? s.artSvg('widget') : I.get('music', 64, 'wm-icon') }),
        h('span', { class: 'wm-label' }, s && s.playing ? 'Now Playing' : 'Music'),
        h('span', { class: 'wm-title' }, track ? track.title : 'Nothing playing'),
        h('span', { class: 'wm-artist' }, track ? track.artist : 'Open Music to listen'),
        h('button', {
          class: 'wm-play', type: 'button', 'aria-label': s && s.playing ? 'Pause' : 'Play',
          html: I.glyph(s && s.playing ? 'pause' : 'play', 16),
          onclick: () => (M && M.toggle && track ? M.toggle() : window.MacRegistry.open('music')),
        })
      );
    };
    document.addEventListener('mac:music', paint);
    paint();
    return node;
  }

  // A large widget that cycles through project covers, like a Photos memory.
  function featuredWidget() {
    const projects = window.MacData.projects;
    let index = 0;
    const node = h('section', { class: 'widget widget-md widget-feature', 'aria-label': 'Featured project' });
    const paint = () => {
      const p = projects[index];
      node.replaceChildren(
        h('span', { class: 'wf-cover', html: p.thumb(`feature-${index}`) }),
        h('span', { class: 'wf-shade' }),
        h('span', { class: 'wf-text' }, h('span', { class: 'wf-title' }, p.title), h('span', { class: 'wf-meta' }, `${p.kind} · ${p.date.slice(0, 4)}`)),
        h('button', { class: 'wf-open', type: 'button', 'aria-label': `Open ${p.title}`, html: I.glyph('forward', 16), onclick: () => apps().openProject(p.id) })
      );
    };
    paint();
    setInterval(() => {
      if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (node.contains(document.activeElement) || node.matches(':hover')) return; // don't swap under the user
      index = (index + 1) % projects.length;
      paint();
    }, FEATURE_MS);
    node.addEventListener('dblclick', () => apps().openProject(projects[index].id));
    return node;
  }

  // ---- Phone home screen and status bar ----------------------------------------------

  function homeApp(label, iconNode, open) {
    return h('button', { class: 'home-app', type: 'button', onclick: open }, iconNode, h('span', { class: 'home-label' }, label));
  }

  function renderHome() {
    const list = window.MacRegistry.apps.filter((a) => a.launchpad || a.id === 'finder');
    document.getElementById('home').append(
      calendarWidget(),
      nowPlayingWidget(),
      ...list.map((app) => homeApp(app.name, h('span', { class: 'home-icon', html: I.get(app.icon, 64, `home-${app.id}`) }), app.open)),
      ...window.MacData.projects.map((p) =>
        homeApp(p.title, h('span', { class: 'home-icon home-thumb', html: p.thumb(`home-${p.id}`) }), () => apps().openProject(p.id))
      )
    );
  }

  function renderStatusBar() {
    const time = h('span', { class: 'sb-time' });
    const theme = h('button', { class: 'sb-btn', type: 'button', 'aria-label': 'Toggle dark mode', html: I.glyph('moon', 17),
      onclick: () => window.MacTheme.set(window.MacTheme.isDark() ? 'light' : 'dark') });
    const sound = h('button', { class: 'sb-btn', type: 'button', onclick: () => window.MacAudio.toggle() });
    const search = h('button', { class: 'sb-btn', type: 'button', 'aria-label': 'Search', html: I.glyph('search', 17), onclick: () => window.MacSpotlight.open() });
    document.getElementById('statusbar').append(time, h('span', { class: 'sb-right' }, search, theme, sound));
    const tick = () => {
      time.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
    };
    const paintSound = () => {
      const muted = window.MacAudio.isMuted();
      sound.innerHTML = I.glyph(muted ? 'mute' : 'sound', 17);
      sound.setAttribute('aria-label', muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    };
    tick();
    setInterval(tick, 10000);
    paintSound();
    document.addEventListener('mac:sound', paintSound);
  }

  // ---- Entry points ------------------------------------------------------------------

  function render() {
    applyWallpaper();
    document.addEventListener('mac:prefs', applyWallpaper);
    document.querySelector('.wall-name').textContent = window.MacData.profile.name.split(/\s+/)[0].toUpperCase();
    document.getElementById('widgets').append(
      h('div', { class: 'widget-row' }, calendarWidget(), nowPlayingWidget()),
      featuredWidget()
    );
    renderHome();
    renderStatusBar();
    const root = document.getElementById('icons');
    ICONS.forEach((def) => {
      const node = iconNode(def);
      wire(node, def);
      nodes.set(def.id, node);
      root.appendChild(node);
    });
    wireSelection(document.getElementById('desktop'));
    window.addEventListener('resize', layout);
    layout();
  }

  function openSelected() {
    ICONS.filter((d) => selected.has(d.id)).forEach((d) => d.open());
  }

  function cleanUp() {
    moved = {};
    layout();
  }

  window.MacDesktop = Object.freeze({ render, selected: () => (selected.size ? [...selected][0] : null), openSelected, cleanUp });
})();
