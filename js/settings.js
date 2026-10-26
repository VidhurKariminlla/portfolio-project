/* System Settings: Appearance, Wallpaper, Sound, Desktop & Dock, and About (with the
   wallpaper photo credits). -> window.MacSettings */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;

  const PANES = [
    { id: 'appearance', label: 'Appearance', glyph: 'sun', color: '#0a84ff' },
    { id: 'wallpaper', label: 'Wallpaper', glyph: 'desktop', color: '#32ade6' },
    { id: 'sound', label: 'Sound', glyph: 'sound', color: '#ff375f' },
    { id: 'dock', label: 'Desktop & Dock', glyph: 'apps', color: '#1c1c1e' },
    { id: 'about', label: 'About', glyph: 'cpu', color: '#8e8e93' },
  ];

  const WALLPAPERS = [
    { id: 'tahoe', label: 'Lake Tahoe Shore', thumb: 'assets/wallpapers/tahoe-shore-thumb.jpg' },
    { id: 'bay', label: 'Emerald Bay', thumb: 'assets/wallpapers/emerald-bay-thumb.jpg' },
    { id: 'hills', label: 'Dusk Hills', thumb: null },
  ];

  let pane = 'appearance';
  const P = () => window.MacPrefs;

  const group = (...rows) => h('div', { class: 'st-group' }, rows);
  const row = (label, control, sub) => h('div', { class: 'st-row' },
    h('span', { class: 'st-row-text' }, h('span', { class: 'st-label' }, label), sub ? h('span', { class: 'st-sub' }, sub) : null), control);

  function toggle(on, label, onChange) {
    return h('button', { class: `st-switch${on ? ' is-on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label,
      onclick: () => onChange(!on) }, h('span', { class: 'st-knob' }));
  }

  function appearancePane(api) {
    const mode = window.MacTheme.get();
    const card = (id, label) => h('button', { class: `st-mode${mode === id ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(mode === id), 'data-fkey': `mode-${id}`,
      onclick: () => { window.MacTheme.set(id); api.refresh(); } },
      h('span', { class: `st-mode-art st-mode-${id}` }, h('span'), h('span')), h('span', { class: 'st-mode-label' }, label));
    return [
      group(h('div', { class: 'st-modes' }, card('auto', 'Auto'), card('light', 'Light'), card('dark', 'Dark'))),
    ];
  }

  function wallpaperPane(api) {
    const current = P().get('wallpaper');
    return [
      h('div', { class: 'st-walls' }, WALLPAPERS.map((w) => h('button', {
        class: `st-wall${current === w.id ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(current === w.id), 'data-fkey': `wall-${w.id}`,
        onclick: () => { P().set('wallpaper', w.id); api.refresh(); },
      }, h('span', { class: `st-wall-img${w.thumb ? '' : ' st-wall-hills'}`, style: w.thumb ? `background-image:url('${w.thumb}')` : null }),
      h('span', { class: 'st-wall-label' }, w.label)))),
      h('p', { class: 'st-note' }, 'The photos are public-domain (CC0) images from Wikimedia Commons. Dusk Hills is drawn in code and turns to night in Dark mode.'),
    ];
  }

  function soundPane(api) {
    const muted = window.MacAudio.isMuted();
    return [
      group(
        row('Play sound effects', toggle(!muted, 'Play sound effects', () => { window.MacAudio.toggle(); api.refresh(); }), 'Window, menu and notification sounds, all synthesised live'),
        row('Play sound on startup', toggle(P().get('startupSound'), 'Play sound on startup', (v) => { P().set('startupSound', v); api.refresh(); }))
      ),
    ];
  }

  function dockPane(api) {
    const size = P().get('dockSize');
    const slider = h('input', { class: 'st-range', type: 'range', min: String(P().DOCK_MIN), max: String(P().DOCK_MAX), value: String(size), 'aria-label': 'Dock size',
      oninput: (e) => P().set('dockSize', Number(e.target.value)) });
    return [
      group(
        row('Size', slider),
        row('Magnification', toggle(P().get('dockMagnify'), 'Magnification', (v) => { P().set('dockMagnify', v); api.refresh(); }))
      ),
      group(row('Clean up desktop icons', h('button', { class: 'btn', type: 'button', onclick: () => window.MacDesktop.cleanUp() }, 'Clean Up'))),
    ];
  }

  function aboutPane() {
    const D = window.MacData;
    const rows = [
      ['Owner', D.profile.name],
      ['Projects', String(D.projects.length)],
      ['Built with', 'HTML, CSS and JavaScript. No frameworks, no build step'],
      ['Graphics', 'Every icon and cover drawn in SVG for this site'],
      ['Sound', 'Synthesised live with the Web Audio API'],
      ['Wallpapers', 'Lake Tahoe on the Nevada shore (Shankarnikhil88) and Emerald Bay, Lake Tahoe (Eric Philbin), both CC0 via Wikimedia Commons'],
    ];
    return [
      h('div', { class: 'st-about-hero' }, h('span', { class: 'ico', html: I.get('logo', 72, 'st-about') }),
        h('h1', {}, `${D.profile.name.split(/\s+/)[0]} OS`), h('p', { class: 'st-sub' }, 'Version 26 · Portfolio edition')),
      group(...rows.map(([k, v]) => row(k, h('span', { class: 'st-value' }, v)))),
      h('p', { class: 'st-note' }, 'Not affiliated with Apple. macOS is a trademark of Apple Inc.; this site recreates the look with original artwork.'),
    ];
  }

  const RENDERERS = { appearance: appearancePane, wallpaper: wallpaperPane, sound: soundPane, dock: dockPane, about: aboutPane };

  function sidebar(root, api) {
    window.MacDOM.append(root, [
      h('div', { class: 'st-me' }, h('span', { class: 'avatar st-avatar' }, I.initials()),
        h('span', {}, h('span', { class: 'st-me-name' }, window.MacData.profile.name), h('span', { class: 'st-sub' }, 'Portfolio'))),
      PANES.map((p) => h('button', { class: `side-item${pane === p.id ? ' is-active' : ''}`, type: 'button', 'data-fkey': `pane-${p.id}`,
        onclick: () => { pane = p.id; api.refresh(); } },
        h('span', { class: 'st-pane-icon', style: `background:${p.color}`, html: I.glyph(p.glyph, 13) }), h('span', { class: 'side-label' }, p.label))),
    ]);
  }

  function open(target) {
    if (target && RENDERERS[target]) pane = target;
    const api = window.MacWM.open({
      id: 'settings', title: 'System Settings', app: 'System Settings', icon: 'settings',
      width: 720, height: 540, minWidth: 460, minHeight: 360, sidebar,
      view: {
        get title() { return PANES.find((p) => p.id === pane).label; },
        render(root, a) {
          root.classList.add('st-pane');
          window.MacDOM.append(root, RENDERERS[pane](a));
        },
      },
    });
    api.refresh();
    return api;
  }

  // Theme and sound can change from the menu bar, Terminal or Spotlight; keep an open
  // Settings window in step. (Not on mac:prefs: the Dock slider fires it while dragging.)
  ['mac:theme', 'mac:sound'].forEach((type) => document.addEventListener(type, () => {
    const win = window.MacWM && window.MacWM.get('settings');
    if (win) win.refresh();
  }));

  window.MacSettings = Object.freeze({ open });
})();
