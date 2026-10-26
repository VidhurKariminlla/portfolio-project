/* Icon set drawn for this site on Apple's icon grid: a superellipse ("squircle") body
   inset in a 64-unit canvas, plus single-colour line glyphs (20-unit, currentColor).
   Original artwork; no Apple icons are reproduced. -> window.MacIcons */
(function () {
  'use strict';

  const CANVAS = 64;
  const BODY = 52; // icon body size inside the 64-unit canvas (Apple's ~81% grid)
  const INSET = (CANVAS - BODY) / 2;
  const SQUIRCLE_N = 5; // superellipse exponent: close to Apple's continuous corners
  const SQUIRCLE_STEPS = 96;

  function squirclePath(x, y, size) {
    const r = size / 2;
    const cx = x + r;
    const cy = y + r;
    const pts = [];
    for (let i = 0; i < SQUIRCLE_STEPS; i++) {
      const t = (i / SQUIRCLE_STEPS) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const px = cx + r * Math.sign(c) * Math.abs(c) ** (2 / SQUIRCLE_N);
      const py = cy + r * Math.sign(s) * Math.abs(s) ** (2 / SQUIRCLE_N);
      pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
    }
    return `M${pts.join('L')}Z`;
  }

  function gearPath(cx, cy, outer, inner, teeth) {
    const pts = [];
    const step = (Math.PI * 2) / (teeth * 4);
    for (let i = 0; i < teeth * 4; i++) {
      const r = i % 4 < 2 ? outer : inner;
      const a = i * step - Math.PI / 2;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    }
    return `M${pts.join('L')}Z`;
  }

  const SQ = squirclePath(INSET, INSET, BODY);
  const GEAR = gearPath(32, 32, 17, 13.5, 12);

  function initials() {
    const name = (window.MacData && window.MacData.profile.name) || '';
    return name.split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  }

  const grad = (id, top, bottom, x2 = 0, y2 = 1) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;

  // Shared body: gradient fill, a hairline edge and a soft top sheen.
  function body(u, key, top, bottom, edge = '#000') {
    return `<defs>${grad(`${key}-${u}`, top, bottom)}<clipPath id="clip-${key}-${u}"><path d="${SQ}"/></clipPath></defs>
      <path d="${SQ}" fill="url(#${key}-${u})"/>
      <path d="${SQ}" fill="none" stroke="${edge}" stroke-opacity=".12" stroke-width=".6"/>`;
  }

  const APP = {
    finder: (u) => `${body(u, 'fi', '#78c6ff', '#1d6ff2')}
      <g clip-path="url(#clip-fi-${u})"><path d="M6 6h26v52H6z" fill="#fff" fill-opacity=".14"/></g>
      <path d="M17 22.5a2.5 2.5 0 0 1 2.5-2.5h8l3 3h13a2.5 2.5 0 0 1 2.5 2.5v15a2.5 2.5 0 0 1-2.5 2.5h-24a2.5 2.5 0 0 1-2.5-2.5z" fill="#fff"/>
      <path d="M17 27h30" stroke="#1d6ff2" stroke-opacity=".25"/>
      <path d="M32 30l4 5-4 5-4-5z" fill="#1d6ff2" fill-opacity=".85"/>`,
    launchpad: (u) => `${body(u, 'lp', '#55555a', '#1c1c1e')}
      <g>${[0, 1, 2].map((r) => [0, 1, 2].map((c) => {
        const colors = ['#ff6b6b', '#ffb84d', '#ffe066', '#5ed36a', '#4fc3f7', '#5b8cff', '#b07cff', '#ff7ac6', '#c7c7cc'];
        return `<rect x="${16 + c * 11}" y="${16 + r * 11}" width="9" height="9" rx="2.6" fill="${colors[r * 3 + c]}"/>`;
      }).join('')).join('')}</g>`,
    notes: (u) => `${body(u, 'nt', '#fff6c8', '#ffd84a')}
      <path d="M17 18h30v30a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3z" fill="#fff" fill-opacity=".92"/>
      <path d="M17 18h30v6H17z" fill="#ffc21a"/>
      <g stroke="#d9cfa8" stroke-width="1.2"><path d="M21 30h22M21 35h22M21 40h22M21 45h14"/></g>`,
    music: (u) => `${body(u, 'mu', '#8a6bff', '#ff4f8b')}
      <path d="M27 21l16-4v19.5a4.5 4.5 0 1 1-2.6-4.1V23.3l-10.8 2.7v14.5a4.5 4.5 0 1 1-2.6-4.1z" fill="#fff"/>`,
    blockcraft: (u) => `${body(u, 'bc', '#9ddcff', '#4aa3ee')}
      <path d="M32 15l15 8.5v17L32 49 17 40.5v-17z" fill="#8a5a2c"/>
      <path d="M32 15l15 8.5L32 32 17 23.5z" fill="#6fca4c"/>
      <path d="M32 32l15-8.5v17L32 49z" fill="#6c4422"/>
      <path d="M17 23.5L32 32v4.5l-15-8.5zM32 32l15-8.5v4.5L32 36.5z" fill="#57ad38"/>
      <g fill="#000" fill-opacity=".12"><rect x="21" y="34" width="3" height="3"/><rect x="27" y="40" width="3" height="3"/><rect x="38" y="37" width="3" height="3"/><rect x="42" y="31" width="3" height="3"/></g>
      <g fill="#fff" fill-opacity=".25"><rect x="27" y="20" width="3" height="2"/><rect x="35" y="24" width="3" height="2"/></g>`,
    terminal: (u) => `${body(u, 'tm', '#48484a', '#161618', '#fff')}
      <path d="M18 24l8 6.5-8 6.5" fill="none" stroke="#e5e5ea" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="29" y="35" width="15" height="3.2" rx="1.6" fill="#e5e5ea"/>`,
    calculator: (u) => `${body(u, 'ca', '#5a5a5e', '#232325', '#fff')}
      <rect x="15" y="15" width="34" height="9" rx="2.5" fill="#1c1c1e"/>
      <g fill="#a5a5aa"><circle cx="20" cy="31" r="3.6"/><circle cx="29" cy="31" r="3.6"/><circle cx="20" cy="40" r="3.6"/><circle cx="29" cy="40" r="3.6"/></g>
      <g fill="#ff9f0a"><circle cx="38.5" cy="31" r="3.6"/><circle cx="38.5" cy="40" r="3.6"/></g>
      <rect x="16.4" y="45.4" width="16.2" height="7.2" rx="3.6" fill="#a5a5aa"/><circle cx="38.5" cy="49" r="3.6" fill="#ff9f0a"/>
      <text x="44" y="21.6" text-anchor="end" fill="#fff" font-size="7" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif">42</text>`,
    settings: (u) => `${body(u, 'st', '#d8d8dc', '#8e8e93')}
      <path d="${GEAR}" fill="#636366"/>
      <circle cx="32" cy="32" r="9.5" fill="#d1d1d6"/><circle cx="32" cy="32" r="5" fill="#636366"/>`,
    about: (u) => `${body(u, 'ab', '#a493ff', '#5b3fd6')}
      <text x="32" y="39.5" text-anchor="middle" fill="#fff" font-size="19" font-weight="700" letter-spacing="-.5"
        font-family="-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif">${initials()}</text>`,
    resume: (u) => `${body(u, 'rs', '#ffffff', '#e2e4ea')}
      <path d="M21 14h15l7 7v27a2 2 0 0 1-2 2H21a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z" fill="#fff" stroke="#c4c8d0"/>
      <path d="M36 14v5a2 2 0 0 0 2 2h5" fill="#eef0f4" stroke="#c4c8d0"/>
      <rect x="22.5" y="23" width="11" height="2.6" rx="1.3" fill="#ff7a45"/>
      <g fill="#c7cbd3"><rect x="22.5" y="29" width="17" height="1.8" rx=".9"/><rect x="22.5" y="33.5" width="15" height="1.8" rx=".9"/>
        <rect x="22.5" y="38" width="17" height="1.8" rx=".9"/><rect x="22.5" y="42.5" width="11" height="1.8" rx=".9"/></g>`,
    contact: (u) => `${body(u, 'ct', '#ffb340', '#ff3b6b')}
      <path d="M16 31.5l31-13-9 29-7-10.8z" fill="#fff"/>
      <path d="M31 36.7l16-18.2-21 15.4z" fill="#ffd2dc"/>`,
    // Non-squircle icons: documents, folders and the Trash.
    folder: (u) => `
      <defs>${grad(`fdb-${u}`, '#5fb1f5', '#3d95e6')}${grad(`fdf-${u}`, '#9fd8ff', '#62b6f7')}</defs>
      <path d="M5 17a4 4 0 0 1 4-4h14.5l4.5 4.5H55a4 4 0 0 1 4 4V49a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="url(#fdb-${u})"/>
      <path d="M5 24a4 4 0 0 1 4-4h46a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="url(#fdf-${u})"/>
      <path d="M6 24.5A3.5 3.5 0 0 1 9.5 21h45" fill="none" stroke="#fff" stroke-opacity=".6"/>`,
    pdf: () => `
      <path d="M14 4h26l12 12v42a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#fff" stroke="#c9ccd3"/>
      <path d="M40 4v9a3 3 0 0 0 3 3h9" fill="#eef0f4" stroke="#c9ccd3"/>
      <rect x="8" y="34" width="30" height="13" rx="2.5" fill="#e5352b"/>
      <text x="23" y="44" text-anchor="middle" fill="#fff" font-size="9" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif">PDF</text>
      <g fill="#d0d3da"><rect x="17" y="17" width="20" height="2" rx="1"/><rect x="17" y="22" width="24" height="2" rx="1"/><rect x="17" y="27" width="16" height="2" rx="1"/><rect x="17" y="51" width="22" height="2" rx="1"/></g>`,
    trash: (u) => `
      <defs><linearGradient id="tr-${u}" x1="0" x2="1"><stop offset="0" stop-color="#cfd4db"/><stop offset=".45" stop-color="#ffffff"/><stop offset="1" stop-color="#bfc5ce"/></linearGradient></defs>
      <path d="M15 15l3.4 38.6a4 4 0 0 0 4 3.6h19.2a4 4 0 0 0 4-3.6L49 15" fill="url(#tr-${u})" fill-opacity=".92" stroke="#98a0ab"/>
      <g fill="none" stroke="#a7aeb8" stroke-width="1.2"><path d="M24 21l1.7 31M32 21v31.5M40 21l-1.7 31"/></g>
      <ellipse cx="32" cy="15" rx="17" ry="4" fill="#e8ebef" stroke="#98a0ab"/>`,
    // The system mark: a faceted diamond (never anyone's logo).
    logo: (u) => `
      <defs><linearGradient id="lg-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd36e"/><stop offset=".5" stop-color="#ff6f91"/><stop offset="1" stop-color="#7b6cff"/></linearGradient></defs>
      <path d="M32 4l26 28-26 28L6 32z" fill="url(#lg-${u})"/>
      <path d="M32 4l10 28-10 28-10-28z" fill="#fff" fill-opacity=".22"/>`,
  };
  APP.projects = APP.folder;

  const GLYPH = {
    logo: '<path d="M10 1.5l7.5 8.5-7.5 8.5L2.5 10z" fill="currentColor" stroke="none"/><path d="M10 1.5l3 8.5-3 8.5-3-8.5z" fill="currentColor" stroke="none" opacity=".45"/>',
    back: '<path d="M12.5 4.5L7 10l5.5 5.5"/>',
    forward: '<path d="M7.5 4.5L13 10l-5.5 5.5"/>',
    grid: '<rect x="3" y="3" width="5.5" height="5.5" rx="1.3"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.3"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.3"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.3"/>',
    list: '<path d="M7 5h10M7 10h10M7 15h10"/><circle cx="3.5" cy="5" r=".9" fill="currentColor"/><circle cx="3.5" cy="10" r=".9" fill="currentColor"/><circle cx="3.5" cy="15" r=".9" fill="currentColor"/>',
    search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.3 12.3L17 17"/>',
    sound: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor" stroke="none"/><path d="M13 7a4 4 0 0 1 0 6M15.5 4.8a7.2 7.2 0 0 1 0 10.4"/>',
    mute: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor" stroke="none"/><path d="M13 7.5l4.5 5M17.5 7.5l-4.5 5"/>',
    control: '<rect x="2.5" y="3.5" width="15" height="5.5" rx="2.75"/><rect x="2.5" y="11" width="15" height="5.5" rx="2.75"/><circle cx="14.7" cy="6.25" r="1.5" fill="currentColor" stroke="none"/><circle cx="5.3" cy="13.75" r="1.5" fill="currentColor" stroke="none"/>',
    moon: '<path d="M16 12.2A6.6 6.6 0 0 1 7.8 4 6.6 6.6 0 1 0 16 12.2z"/>',
    sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/>',
    download: '<path d="M10 3v9.5M6 8.8l4 3.9 4-3.9M3.5 15.5h13"/>',
    external: '<path d="M11 3.5h5.5V9M16.2 3.8L9 11M14 12.5v3a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3"/>',
    copy: '<rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V4.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/>',
    mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M3 5.5l7 5.5 7-5.5"/>',
    globe: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z"/>',
    code: '<path d="M7 5.5L2.5 10 7 14.5M13 5.5l4.5 4.5-4.5 4.5"/>',
    cpu: '<rect x="5" y="5" width="10" height="10" rx="1.8"/><rect x="8" y="8" width="4" height="4" rx=".6"/><path d="M8 2.5V5M12 2.5V5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5"/>',
    folder: '<path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"/>',
    person: '<circle cx="10" cy="7" r="3.2"/><path d="M3.8 16.8c.9-3 3.3-4.6 6.2-4.6s5.3 1.6 6.2 4.6"/>',
    doc: '<path d="M5 2.5h6.5l3.5 3.5v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/><path d="M11.5 2.5V6H15M7 10h6M7 13h4.5"/>',
    terminal: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M6 8l2.5 2L6 12M10.5 12.5h3.5"/>',
    close: '<path d="M5 5l10 10M15 5L5 15"/>',
    star: '<path d="M10 2.8l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z"/>',
    sparkle: '<path d="M10 2.5l1.6 5.9 5.9 1.6-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6z"/>',
    apps: '<path d="M4 4h4v4H4zM12 4h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4z"/>',
    desktop: '<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7.5 16.5h5M10 13.5v3"/>',
    clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
    wifi: '<path d="M2.5 8a10.6 10.6 0 0 1 15 0M5 10.6a7 7 0 0 1 10 0M7.6 13.2a3.4 3.4 0 0 1 4.8 0" /><circle cx="10" cy="15.6" r="1" fill="currentColor" stroke="none"/>',
    wifiOff: '<path d="M2.5 8a10.6 10.6 0 0 1 15 0M5 10.6a7 7 0 0 1 10 0M7.6 13.2a3.4 3.4 0 0 1 4.8 0" opacity=".35"/><path d="M3.5 3.5l13 13"/>',
    play: '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="5.5" y="4.5" width="3" height="11" rx=".8" fill="currentColor" stroke="none"/><rect x="11.5" y="4.5" width="3" height="11" rx=".8" fill="currentColor" stroke="none"/>',
    next: '<path d="M4 5v10l7-5zM11 5v10l7-5z" fill="currentColor" stroke="none"/>',
    prev: '<path d="M16 5v10l-7-5zM9 5v10l-7-5z" fill="currentColor" stroke="none"/>',
    note: '<path d="M8 15.5V4.5l8-2v11"/><circle cx="6" cy="15.5" r="2"/><circle cx="14" cy="13.5" r="2"/>',
    tag: '<circle cx="10" cy="10" r="4.5" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4.5 6h11M8 6V4.2h4V6M6 6l.8 10.2a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9L14 6"/>',
    gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  };

  function wrapApp(inner, size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  /** A multicolour app or file icon. `uid` keeps gradient ids unique per instance. */
  function get(name, size = 64, uid = 'x') {
    const draw = APP[name] || APP.folder;
    return wrapApp(draw(uid), size);
  }

  /** A single-colour line glyph that inherits currentColor. */
  function glyph(name, size = 16) {
    const inner = GLYPH[name] || GLYPH.doc;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  /** The squircle outline, for masking project covers into app-shaped tiles. */
  const squircle = () => SQ;

  window.MacIcons = Object.freeze({ get, glyph, initials, squircle, has: (name) => Boolean(APP[name]) });
})();
