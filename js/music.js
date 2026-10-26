/* Music: an Apple Music-style player for songs synthesised live by MacMusicEngine.
   Library views, album pages, a persistent now-playing bar, and a small public API for
   the desktop widget and Control Center. -> window.MacMusic */
(function () {
  'use strict';

  const { h, esc, readStore, writeStore } = window.MacDOM;
  const E = window.MacMusicEngine;

  const WIN_ID = 'music';
  const VOLUME_KEY = 'vos.music.volume';
  const DEFAULT_VOLUME = 0.8;
  const TICK_MS = 250; // UI progress; 'mac:music' progress goes out every 2nd tick
  const RESTART_AFTER = 3; // seconds in: Previous restarts the song instead of going back
  const SEEK_STEP = 5;
  const SEEK_PAGE = 15;
  const REPEAT_ORDER = ['off', 'all', 'one'];

  // ---- Library -------------------------------------------------------------------------

  const TITLES = {
    'rainy-window': 'Rainy Window Study', 'tea-steam': 'Tea Steam', 'late-trains': 'Slow Piano for Late Trains',
    'coin-rush': 'Coin Rush', 'neon-commute': 'Neon Commute', 'save-point': 'Save Point',
    aurora: 'Aurora Over Still Water', 'liquid-glass': 'Liquid Glass', 'last-light': 'Last Light',
  };

  const ALBUMS = [
    { id: 'lanterns', title: 'Paper Lanterns', artist: 'Vidhur OS Sessions', genre: 'Lo-Fi', year: 2026,
      blurb: 'Dusty electric piano, soft rain and lazy swing for long evenings at the desk.',
      tint: ['#2b2552', '#c4694f'], art: artLanterns, tracks: ['rainy-window', 'tea-steam', 'late-trains'] },
    { id: 'pixel', title: 'Pixel Sunrise', artist: 'Cartridge Club', genre: 'Electronic', year: 2026,
      blurb: 'Square waves, pulse leads and neon synth-pop, straight from the cartridge slot.',
      tint: ['#4b1462', '#ff6f61'], art: artPixel, tracks: ['coin-rush', 'neon-commute', 'save-point'] },
    { id: 'horizon', title: 'Glass Horizon', artist: 'Northlight Ensemble', genre: 'Ambient', year: 2026,
      blurb: 'Slow pads, glassy bells and quiet piano for still water and late light.',
      tint: ['#0b2a40', '#35b9a6'], art: artGlass, tracks: ['aurora', 'liquid-glass', 'last-light'] },
  ];

  const TRACKS = ALBUMS.flatMap((album) =>
    album.tracks.map((id, i) => Object.freeze({ id, title: TITLES[id], artist: album.artist, album, no: i + 1, duration: E.duration(id) })));
  const ALL_IDS = TRACKS.map((t) => t.id);

  const PLAYLISTS = [
    { id: 'focus', title: 'Deep Focus', desc: 'Unhurried keys and pads that keep you in the zone.', colors: ['#2f5fd0', '#36c3e8'],
      shape: 'rings', tracks: ['rainy-window', 'liquid-glass', 'tea-steam', 'aurora', 'late-trains'] },
    { id: 'morning', title: 'Morning Run', desc: 'Bright tempos and chiptune energy to get moving.', colors: ['#ff4f6d', '#ffb457'],
      shape: 'rays', tracks: ['neon-commute', 'coin-rush', 'save-point', 'rainy-window'] },
  ];

  const trackById = (id) => TRACKS.find((t) => t.id === id) || null;
  const featured = () => ALBUMS[new Date().getDate() % ALBUMS.length];
  const totalMinutes = (ids) => Math.max(1, Math.round(ids.reduce((s, id) => s + trackById(id).duration, 0) / 60));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function clock(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function shuffled(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ---- Glyphs and artwork --------------------------------------------------------------

  const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  const GLYPHS = {
    play: '<path fill="currentColor" d="M6.3 3.9v12.2c0 .8.9 1.3 1.6.8l9.3-6.1c.6-.4.6-1.2 0-1.6L7.9 3.1c-.7-.5-1.6 0-1.6.8z"/>',
    pause: '<g fill="currentColor"><rect x="4.8" y="3.6" width="3.7" height="12.8" rx="1.1"/><rect x="11.5" y="3.6" width="3.7" height="12.8" rx="1.1"/></g>',
    next: '<path fill="currentColor" d="M2.5 5.3v9.4c0 .7.8 1.1 1.4.7l6.1-4.6v3.9c0 .7.8 1.1 1.4.7l6.3-4.7c.5-.4.5-1.1 0-1.4l-6.3-4.7c-.6-.4-1.4 0-1.4.7v3.9L3.9 4.6c-.6-.4-1.4 0-1.4.7z"/>',
    prev: '<path fill="currentColor" transform="matrix(-1 0 0 1 20 0)" d="M2.5 5.3v9.4c0 .7.8 1.1 1.4.7l6.1-4.6v3.9c0 .7.8 1.1 1.4.7l6.3-4.7c.5-.4.5-1.1 0-1.4l-6.3-4.7c-.6-.4-1.4 0-1.4.7v3.9L3.9 4.6c-.6-.4-1.4 0-1.4.7z"/>',
    shuffle: `<path ${STROKE} d="M2.5 6h2.7c4.3 0 5.3 8 9.6 8h2.2M2.5 14h2.7c1.6 0 2.7-1.1 3.6-2.6M11.2 8.6C12.1 7.1 13.2 6 14.8 6h2.2M15.2 3.8 17.4 6l-2.2 2.2M15.2 11.8l2.2 2.2-2.2 2.2"/>`,
    repeat: `<path ${STROKE} d="M3.5 9.5V8.2A3.2 3.2 0 0 1 6.7 5h9.6M14 2.8 16.3 5 14 7.2M16.5 10.5v1.3a3.2 3.2 0 0 1-3.2 3.2H3.7M6 17.2 3.7 15 6 12.8"/>`,
    repeat1: `<path ${STROKE} d="M3.5 9.5V8.2A3.2 3.2 0 0 1 6.7 5h9.6M14 2.8 16.3 5 14 7.2M16.5 10.5v1.3a3.2 3.2 0 0 1-3.2 3.2H3.7M6 17.2 3.7 15 6 12.8"/><path fill="currentColor" d="M9.3 8.4h1.6v4.8H9.8V9.6l-.8.4-.3-.9z"/>`,
    volLow: `<path fill="currentColor" d="M3 7.6h2.4L9 4.7v10.6l-3.6-2.9H3a.8.8 0 0 1-.8-.8V8.4c0-.4.4-.8.8-.8z"/><path ${STROKE} d="M12 7.8a3 3 0 0 1 0 4.4"/>`,
    volHigh: `<path fill="currentColor" d="M2 7.6h2.4L8 4.7v10.6l-3.6-2.9H2a.8.8 0 0 1-.8-.8V8.4c0-.4.4-.8.8-.8z"/><path ${STROKE} d="M11 7.8a3 3 0 0 1 0 4.4M13.4 5.6a6 6 0 0 1 0 8.8M15.8 3.6a9 9 0 0 1 0 12.8"/>`,
    listen: `<circle ${STROKE} cx="10" cy="10" r="7.6"/><path fill="currentColor" d="M8.4 6.9v6.2c0 .4.4.6.7.4l4.7-3.1c.3-.2.3-.6 0-.8L9.1 6.5c-.3-.2-.7 0-.7.4z"/>`,
    songs: `<path ${STROKE} d="M8 15V4.6l8-1.6v10.2"/><circle ${STROKE} cx="6" cy="15" r="2"/><circle ${STROKE} cx="14" cy="13.2" r="2"/>`,
    albums: `<rect ${STROKE} x="2.8" y="5.2" width="11.8" height="11.8" rx="2.2"/><path ${STROKE} d="M5.6 2.8h9.2a2.4 2.4 0 0 1 2.4 2.4v9.2"/>`,
    playlist: `<path ${STROKE} d="M3 5h10M3 9h10M3 13h5.5M15.5 15.4V8.2l2.4-.6"/><circle ${STROKE} cx="13.8" cy="15.4" r="1.7"/>`,
  };

  const glyph = (name, size) =>
    `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" focusable="false">${GLYPHS[name]}</svg>`;

  let uidSeq = 0;
  const uid = () => `mu${(uidSeq += 1)}`;
  const SVG_OPEN = '<svg viewBox="0 0 300 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">';
  const FONT = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
  const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

  function label(x, y, title, sub, anchor, opts) {
    const o = { size: 15, family: FONT, spacing: 3, color: '#fff', subColor: '#fff', ...opts };
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${o.family}" font-size="${o.size}" font-weight="700" letter-spacing="${o.spacing}" fill="${o.color}">${esc(title)}</text>
      <text x="${x}" y="${y + 17}" text-anchor="${anchor}" font-family="${FONT}" font-size="8.5" font-weight="600" letter-spacing="2.4" fill="${o.subColor}" opacity=".72">${esc(sub)}</text>`;
  }

  function lantern(x, y, s, u) {
    return `<path d="M${x} 0V${y - 31 * s}" stroke="#f6c58a" stroke-opacity=".35"/>
      <g transform="translate(${x} ${y}) scale(${s})">
        <circle r="48" fill="url(#plh${u})"/>
        <rect x="-20" y="-26" width="40" height="52" rx="16" fill="url(#plg${u})"/>
        <path d="M-8-25c-5 16-5 34 0 50M8-25c5 16 5 34 0 50M0-26v52" stroke="#b5452f" stroke-opacity=".45" fill="none"/>
        <rect x="-11" y="-31" width="22" height="6" rx="2" fill="#3a1d2e"/><rect x="-11" y="25" width="22" height="6" rx="2" fill="#3a1d2e"/>
        <path d="M0 31v12" stroke="#b5452f" stroke-width="2"/>
      </g>`;
  }

  function artLanterns(u) {
    const rain = [18, 52, 96, 128, 170, 236, 262, 284].map((x, i) =>
      `<path d="M${x} ${20 + (i % 3) * 34}l-9 26" stroke="#dfe6ff" stroke-opacity=".2" stroke-linecap="round"/>`).join('');
    const lights = [[34, 252], [86, 244], [92, 260], [176, 250], [236, 256], [244, 268]].map(([x, y]) =>
      `<rect x="${x}" y="${y}" width="6" height="7" rx="1" fill="#ffcf7a" opacity=".75"/>`).join('');
    return `${SVG_OPEN}<defs>
        <linearGradient id="pls${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f4b"/><stop offset=".55" stop-color="#6b3f7a"/><stop offset="1" stop-color="#f08a5d"/></linearGradient>
        <radialGradient id="plg${u}" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#ffe2a0"/><stop offset=".55" stop-color="#ff9a4a"/><stop offset="1" stop-color="#d9493a"/></radialGradient>
        <radialGradient id="plh${u}"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".5"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="300" height="300" fill="url(#pls${u})"/>
      <circle cx="232" cy="66" r="30" fill="#fff3d6" opacity=".9"/><circle cx="244" cy="58" r="27" fill="#2d2858" opacity=".35"/>
      ${rain}${lantern(76, 118, 1, u)}${lantern(150, 92, 1.15, u)}${lantern(214, 150, 0.85, u)}
      <path d="M0 300V238l22-10 18 8v-20h26v14l20-12 24 14v-6h30l16-12 18 12v-22h12v-8h10v30l26-10 20 8v-16h34l14 10 10-6v58z" fill="#16142d"/>
      ${lights}<rect y="268" width="300" height="32" fill="#16142d"/>
      ${label(20, 280, 'PAPER LANTERNS', 'VIDHUR OS SESSIONS', 'start', { size: 14 })}</svg>`;
  }

  function artPixel(u) {
    const stars = [[40, 30], [92, 62], [210, 24], [256, 70], [150, 40], [18, 96], [282, 110]].map(([x, y]) =>
      `<rect x="${x}" y="${y}" width="3" height="3" fill="#ffd8f4" opacity=".8"/>`).join('');
    const rows = [196, 203, 213, 227, 247, 274].map((y) => `<path d="M0 ${y}H300"/>`).join('');
    const cols = [-210, -90, 30, 110, 190, 270, 390, 510].map((x) => `<path d="M150 190L${x} 300"/>`).join('');
    return `${SVG_OPEN}<defs>
        <linearGradient id="pxs${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d0638"/><stop offset=".55" stop-color="#7a1a6b"/><stop offset="1" stop-color="#ff7a59"/></linearGradient>
        <linearGradient id="pxu${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe66d"/><stop offset="1" stop-color="#ff4f8b"/></linearGradient>
        <mask id="pxm${u}"><rect width="300" height="300" fill="#fff"/><g fill="#000"><rect y="140" width="300" height="3"/><rect y="153" width="300" height="4"/><rect y="166" width="300" height="5"/><rect y="179" width="300" height="7"/></g></mask>
      </defs>
      <rect width="300" height="190" fill="url(#pxs${u})"/>${stars}
      <path d="M68 190a82 82 0 0 1 164 0z" fill="url(#pxu${u})" mask="url(#pxm${u})"/>
      <path d="M0 190V150h16v-8h16v-10h16v10h12v12h16v12h14v24z" fill="#2b0f4f"/>
      <path d="M300 190V138h-14v-10h-18v14h-16v10h-12v12h-16v26z" fill="#2b0f4f"/>
      <rect y="190" width="300" height="110" fill="#14052c"/>
      <g stroke="#ff4fd8" stroke-width="1.4" opacity=".65">${rows}${cols}</g>
      ${label(20, 36, 'PIXEL SUNRISE', 'CARTRIDGE CLUB', 'start', { size: 17, family: MONO, spacing: 2, subColor: '#ffd0f0' })}</svg>`;
  }

  function artGlass(u) {
    const stars = [[40, 40, 1], [88, 26, 0.8], [190, 34, 1.2], [250, 52, 0.8], [130, 60, 0.7], [276, 22, 1]].map(([x, y, r]) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".7"/>`).join('');
    return `${SVG_OPEN}<defs>
        <linearGradient id="gls${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050d1c"/><stop offset=".62" stop-color="#0b2440"/><stop offset="1" stop-color="#12395a"/></linearGradient>
        <linearGradient id="glw${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2f4d"/><stop offset="1" stop-color="#040a16"/></linearGradient>
        <radialGradient id="glo${u}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".5" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <filter id="glb${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
        <clipPath id="glc${u}"><rect y="200" width="300" height="100"/></clipPath>
        <g id="gla${u}">
          <path d="M-20 150C40 90 90 140 150 100S260 40 320 80v50c-60-30-110 30-170 20S40 170-20 190z" fill="#35e0b8" opacity=".75"/>
          <path d="M-20 120C60 70 110 110 170 70S280 30 320 40v40c-70-10-100 40-160 30S50 140-20 160z" fill="#7b61ff" opacity=".55"/>
          <ellipse cx="210" cy="118" rx="70" ry="24" fill="#3fb8ff" opacity=".5"/>
        </g>
      </defs>
      <rect width="300" height="300" fill="url(#gls${u})"/>${stars}
      <g filter="url(#glb${u})"><use href="#gla${u}"/></g>
      <rect y="200" width="300" height="100" fill="url(#glw${u})"/>
      <g clip-path="url(#glc${u})"><g filter="url(#glb${u})" opacity=".32" transform="matrix(1 0 0 -1 0 400)"><use href="#gla${u}"/></g></g>
      <rect y="199.5" width="300" height="1" fill="#fff" opacity=".35"/>
      <circle cx="150" cy="150" r="58" fill="url(#glo${u})" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>
      ${label(150, 258, 'GLASS HORIZON', 'NORTHLIGHT ENSEMBLE', 'middle', { size: 14, spacing: 5 })}</svg>`;
  }

  function artPlaylist(pl, u) {
    const shapes = pl.shape === 'rings'
      ? [150, 115, 80, 45].map((r) => `<circle cx="236" cy="70" r="${r}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="14"/>`).join('')
      : Array.from({ length: 9 }, (_, i) => `<path d="M300 0L${-40 + i * 44} 300" stroke="#fff" stroke-opacity=".13" stroke-width="10"/>`).join('');
    const words = pl.title.split(' ');
    return `${SVG_OPEN}<defs><linearGradient id="pg${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pl.colors[0]}"/><stop offset="1" stop-color="${pl.colors[1]}"/></linearGradient></defs>
      <rect width="300" height="300" fill="url(#pg${u})"/>${shapes}
      ${words.map((w, i) => `<text x="22" y="${262 - (words.length - 1 - i) * 34}" font-family="${FONT}" font-size="32" font-weight="800" letter-spacing="-.5" fill="#fff">${esc(w)}</text>`).join('')}
      <text x="22" y="40" font-family="${FONT}" font-size="11" font-weight="700" letter-spacing="1.6" fill="#fff" opacity=".85">PLAYLIST</text></svg>`;
  }

  function artPlaceholder(u) {
    return `${SVG_OPEN}<defs><linearGradient id="ph${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d9de"/><stop offset="1" stop-color="#b9b9c0"/></linearGradient></defs>
      <rect width="300" height="300" fill="url(#ph${u})"/>
      <g transform="translate(90 90) scale(6)" color="#fff">${GLYPHS.songs}</g></svg>`;
  }

  const artFor = (track, u) => (track ? track.album.art(u) : artPlaceholder(u));

  // ---- Playback state ------------------------------------------------------------------

  function initialVolume() {
    const v = parseFloat(readStore('localStorage', VOLUME_KEY));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  }

  // Replaced, never mutated. queue holds track ids in play order; source is the unshuffled list.
  let state = Object.freeze({ source: [], queue: [], index: -1, playing: false, shuffle: false, repeat: 'off', volume: initialVolume() });
  const setState = (patch) => {
    state = Object.freeze({ ...state, ...patch });
  };

  let started = false; // first play of the session never notifies
  let ticker = 0;
  let ticks = 0;
  let scrubbing = false;
  let win = null; // { api, visible } while the window is open
  let ui = null; // { root, bar } for the current render

  const currentTrack = () => trackById(state.queue[state.index]);

  function getState() {
    const t = currentTrack();
    return {
      playing: state.playing,
      track: t ? { id: t.id, title: t.title, artist: t.artist, album: t.album.title, duration: t.duration } : null,
      position: t ? E.position() : 0,
      artSvg: (u) => artFor(t, u || uid()),
    };
  }

  const emit = () => document.dispatchEvent(new CustomEvent('mac:music', { detail: getState() }));

  function onTick() {
    ticks += 1;
    if (win && win.visible) syncProgress();
    if (ticks % 2 === 0) emit();
  }

  function afterChange() {
    if (state.playing && !ticker) ticker = setInterval(onTick, TICK_MS);
    if (!state.playing && ticker) {
      clearInterval(ticker);
      ticker = 0;
    }
    syncUi();
    emit();
  }

  function musicFocused() {
    const active = window.MacWM.active();
    return Boolean(win && active && active.id === WIN_ID && !document.hidden);
  }

  function announce(t) {
    if (started && !musicFocused() && window.MacApps) {
      window.MacApps.notify({ title: t.title, body: `${t.artist} — ${t.album.title}`, icon: 'music' });
    }
    started = true;
  }

  // Load the queue entry at `index`; play it when asked. `quiet` skips the banner (repeat one).
  function go(index, autoplay, quiet) {
    const t = trackById(state.queue[index]);
    if (!t) return;
    setState({ index });
    E.load(t.id);
    const playing = Boolean(autoplay) && E.play(0);
    setState({ playing });
    if (playing && !quiet) announce(t);
    if (autoplay && !playing && !E.supported() && window.MacApps) {
      window.MacApps.notify({ title: 'Playback unavailable', body: 'This browser does not support Web Audio.', icon: 'music' });
    }
    afterChange();
  }

  function playList(ids, start, shuffle) {
    if (!ids.length) return;
    const mode = shuffle == null ? state.shuffle : shuffle;
    const first = ids[start == null ? (mode ? Math.floor(Math.random() * ids.length) : 0) : start];
    const queue = mode ? [first, ...shuffled(ids.filter((id) => id !== first))] : [...ids];
    setState({ source: [...ids], queue, shuffle: mode });
    go(queue.indexOf(first), true);
  }

  function toggle() {
    if (!currentTrack()) {
      playList(featured().tracks, 0, false);
      return;
    }
    if (state.playing) {
      E.pause();
      setState({ playing: false });
    } else {
      setState({ playing: E.play() });
      if (!started) started = true;
    }
    afterChange();
  }

  function next() {
    if (!currentTrack()) return;
    // A manual Next wraps around and keeps the current play/pause state.
    go(state.index < state.queue.length - 1 ? state.index + 1 : 0, state.playing);
  }

  function prev() {
    if (!currentTrack()) return;
    if (E.position() > RESTART_AFTER || (state.index === 0 && state.repeat !== 'all')) {
      seek(0);
      return;
    }
    go(state.index > 0 ? state.index - 1 : state.queue.length - 1, state.playing);
  }

  function handleEnd() {
    if (state.repeat === 'one') return go(state.index, true, true);
    if (state.index < state.queue.length - 1) return go(state.index + 1, true);
    if (state.repeat === 'all') return go(0, true);
    setState({ playing: false });
    return afterChange();
  }

  function seek(sec) {
    if (!currentTrack()) return;
    E.seek(sec);
    afterChange();
  }

  function toggleShuffle() {
    const shuffle = !state.shuffle;
    const current = state.queue[state.index];
    if (!current) {
      setState({ shuffle });
      return afterChange();
    }
    const queue = shuffle ? [current, ...shuffled(state.source.filter((id) => id !== current))] : [...state.source];
    setState({ shuffle, queue, index: queue.indexOf(current) });
    return afterChange();
  }

  function cycleRepeat() {
    setState({ repeat: REPEAT_ORDER[(REPEAT_ORDER.indexOf(state.repeat) + 1) % REPEAT_ORDER.length] });
    afterChange();
  }

  function setVolume(v) {
    setState({ volume: v });
    E.setVolume(v);
    writeStore('localStorage', VOLUME_KEY, v.toFixed(2));
    if (ui) paintRange(ui.bar.vol, v, 1);
  }

  function stop() {
    E.release();
    setState({ playing: false });
    afterChange();
  }

  // ---- Shared UI pieces ----------------------------------------------------------------

  function iconButton(name, labelText, onclick, extra) {
    return h('button', { class: `mu-icon-btn ${extra || ''}`, type: 'button', 'aria-label': labelText, title: labelText, 'data-fkey': `np-${name}`, onclick, html: glyph(name, 18) });
  }

  function actionButtons(ids, tag) {
    return h('div', { class: 'mu-actions' },
      h('button', { class: 'mu-pill mu-pill-primary', type: 'button', 'data-fkey': `${tag}-play`, onclick: () => playList(ids, 0, false) },
        h('span', { html: glyph('play', 14) }), 'Play'),
      h('button', { class: 'mu-pill', type: 'button', 'data-fkey': `${tag}-shuffle`, onclick: () => playList(ids, null, true) },
        h('span', { html: glyph('shuffle', 14) }), 'Shuffle'));
  }

  function section(title, body) {
    return h('section', { class: 'mu-section' }, h('h2', { class: 'mu-section-title' }, title), body);
  }

  function artTile(cls, svg, title, sub, open, play, key) {
    return h('div', { class: `mu-card ${cls}` },
      h('div', { class: 'mu-card-art' },
        h('button', { class: 'mu-card-open', type: 'button', 'aria-label': `${title}, ${sub}`, 'data-fkey': `open-${key}`, onclick: open, html: svg }),
        h('button', { class: 'mu-card-play', type: 'button', 'aria-label': `Play ${title}`, 'data-fkey': `play-${key}`, onclick: play, html: glyph('play', 15) })),
      h('button', { class: 'mu-card-title', type: 'button', tabindex: '-1', onclick: open }, title),
      h('div', { class: 'mu-card-sub' }, sub));
  }

  const albumTile = (album, api) =>
    artTile('', album.art(uid()), album.title, album.artist, () => api.navigate(albumView(album)), () => playList(album.tracks, 0, false), album.id);
  const playlistTile = (pl, api) =>
    artTile('', artPlaylist(pl, uid()), pl.title, 'Playlist', () => api.navigate(playlistView(pl)), () => playList(pl.tracks, 0, false), pl.id);

  // ---- Track lists ---------------------------------------------------------------------

  const COLUMNS = {
    no: { label: '#', cell: (t, i) => [h('span', { class: 'mu-no' }, String(i + 1)), h('span', { class: 'mu-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))] },
    title: { label: 'Title', cell: (t, i, thumb) => [thumb ? h('span', { class: 'mu-thumb', html: t.album.art(uid()) }) : null, h('span', { class: 'mu-ellip' }, t.title)] },
    artist: { label: 'Artist', cell: (t) => h('span', { class: 'mu-ellip' }, t.artist) },
    album: { label: 'Album', cell: (t) => h('span', { class: 'mu-ellip' }, t.album.title) },
    time: { label: 'Time', cell: (t) => clock(t.duration) },
  };

  let lastPointer = 'mouse';

  function moveRowFocus(row, dir) {
    const sibling = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
    if (sibling && sibling.classList.contains('mu-row')) sibling.focus();
  }

  function rowKeys(e, row, play) {
    if (e.key === 'Enter') {
      e.preventDefault();
      play();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveRowFocus(row, e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  function selectRow(row) {
    row.parentElement.querySelectorAll('.mu-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
    row.classList.add('is-selected');
  }

  function trackRow(ids, i, listKey, cols, thumb) {
    const t = trackById(ids[i]);
    const play = () => playList(ids, i);
    const row = h('div', {
      class: 'mu-row', role: 'row', tabindex: '0', 'data-track': t.id, 'data-fkey': `${listKey}-${t.id}`,
      'aria-label': `${t.title}, ${t.artist}, ${clock(t.duration)}`,
      onpointerdown: (e) => { lastPointer = e.pointerType; },
      onclick: () => (lastPointer === 'touch' ? play() : selectRow(row)),
      ondblclick: play,
      onkeydown: (e) => rowKeys(e, row, play),
    }, cols.map((c) => h('span', { class: `mu-cell mu-c-${c}`, role: 'cell' }, COLUMNS[c].cell(t, i, thumb))));
    row.querySelector('.mu-c-no, .mu-c-title').prepend(
      h('button', { class: 'mu-row-play', type: 'button', tabindex: '-1', 'aria-label': `Play ${t.title}`, html: glyph('play', 12), onclick: (e) => { e.stopPropagation(); play(); } }));
    return row;
  }

  function trackTable(ids, listKey, cols, thumb) {
    const head = h('div', { class: 'mu-row mu-head', role: 'row' },
      cols.map((c) => h('span', { class: `mu-cell mu-c-${c}`, role: 'columnheader' }, COLUMNS[c].label)));
    return h('div', { class: `mu-table mu-cols-${cols.length}`, role: 'table', 'aria-label': 'Songs' },
      head, ids.map((id, i) => trackRow(ids, i, listKey, cols, thumb)));
  }

  // ---- Views ---------------------------------------------------------------------------

  function shell(key, title, build) {
    return {
      key,
      title,
      render(root, api) {
        root.classList.add('music-app', 'music-main');
        const { bar, refs } = nowPlayingBar();
        root.append(h('div', { class: 'mu-scroll' }, narrowTabs(key, api), h('div', { class: 'mu-page' }, build(api))), bar);
        ui = { root, bar: refs };
        syncUi();
      },
    };
  }

  function hero(album) {
    return h('div', { class: 'mu-hero', style: `--mu-a:${album.tint[0]};--mu-b:${album.tint[1]}` },
      h('div', { class: 'mu-hero-art', html: album.art(uid()) }),
      h('div', { class: 'mu-hero-text' },
        h('p', { class: 'mu-eyebrow' }, 'Featured Album'),
        h('h2', { class: 'mu-hero-title' }, album.title),
        h('p', { class: 'mu-hero-sub' }, `${album.artist} · ${album.genre}`),
        h('p', { class: 'mu-hero-blurb' }, album.blurb),
        actionButtons(album.tracks, 'hero')));
  }

  const listenNowView = () => shell('listen', 'Listen Now', (api) => [
    h('h1', { class: 'mu-large-title' }, 'Listen Now'),
    hero(featured()),
    section('Recently Added', h('div', { class: 'mu-grid' }, ALBUMS.map((a) => albumTile(a, api)))),
    section('Made for You', h('div', { class: 'mu-grid' }, PLAYLISTS.map((p) => playlistTile(p, api)))),
    section('Top Songs', trackTable(ALL_IDS.slice(0, 6), 'top', ['title', 'artist', 'time'], true)),
  ]);

  const songsView = () => shell('songs', 'Songs', () => [
    h('h1', { class: 'mu-large-title' }, 'Songs'),
    h('p', { class: 'mu-subtitle' }, `${plural(ALL_IDS.length, 'song')}, ${plural(totalMinutes(ALL_IDS), 'minute')}`),
    trackTable(ALL_IDS, 'songs', ['no', 'title', 'artist', 'album', 'time'], true),
  ]);

  const albumsView = () => shell('albums', 'Albums', (api) => [
    h('h1', { class: 'mu-large-title' }, 'Albums'),
    h('div', { class: 'mu-grid' }, ALBUMS.map((a) => albumTile(a, api))),
  ]);

  function detailPage(svg, title, artistLine, info, blurb, ids, key, cols, foot) {
    return [
      h('header', { class: 'mu-detail-head' },
        h('div', { class: 'mu-detail-art', html: svg }),
        h('div', { class: 'mu-detail-meta' },
          h('h1', { class: 'mu-detail-title' }, title),
          h('p', { class: 'mu-detail-artist' }, artistLine),
          h('p', { class: 'mu-detail-info' }, info),
          h('p', { class: 'mu-detail-blurb' }, blurb),
          actionButtons(ids, key))),
      trackTable(ids, key, cols, cols.includes('album')),
      h('p', { class: 'mu-foot' }, `${plural(ids.length, 'song')}, ${plural(totalMinutes(ids), 'minute')}`),
      foot ? h('p', { class: 'mu-foot' }, foot) : null,
    ];
  }

  const albumView = (a) => shell(`album:${a.id}`, a.title, () =>
    detailPage(a.art(uid()), a.title, a.artist, `${a.genre.toUpperCase()} · ${a.year}`, a.blurb, a.tracks, `album-${a.id}`,
      ['no', 'title', 'time'], `℗ ${a.year} ${a.artist}`));

  const playlistView = (p) => shell(`playlist:${p.id}`, p.title, () =>
    detailPage(artPlaylist(p, uid()), p.title, 'Vidhur OS Sessions', 'PLAYLIST', p.desc, p.tracks, `pl-${p.id}`,
      ['no', 'title', 'artist', 'album', 'time']));

  const NAV = [
    { key: 'listen', label: 'Listen Now', icon: 'listen', view: listenNowView },
    { key: 'songs', label: 'Songs', icon: 'songs', view: songsView },
    { key: 'albums', label: 'Albums', icon: 'albums', view: albumsView },
  ];

  const isActive = (navKey, viewKey) => viewKey === navKey || (navKey === 'albums' && String(viewKey).startsWith('album:'));

  function goTo(api, key, make) {
    const view = api.view();
    if (view && view.key === key) return;
    api.navigate(make());
  }

  // Shown instead of the sidebar when the window is narrow.
  function narrowTabs(key, api) {
    return h('div', { class: 'mu-tabs', role: 'group', 'aria-label': 'Library' }, NAV.map((n) =>
      h('button', { class: 'mu-tab', type: 'button', 'aria-pressed': String(isActive(n.key, key)), 'data-fkey': `tab-${n.key}`, onclick: () => goTo(api, n.key, n.view) }, n.label)));
  }

  function sideItem(text, icon, active, onclick) {
    return h('button', { class: `side-item${active ? ' is-active' : ''}`, type: 'button', 'aria-current': active ? 'page' : null, 'data-fkey': `side-${text}`, onclick },
      h('span', { class: 'side-icon', html: glyph(icon, 16) }), h('span', { class: 'side-label' }, text));
  }

  function sidebar(root, api) {
    root.classList.add('music-app', 'music-side');
    const key = (api.view() || {}).key;
    const item = (n) => sideItem(n.label, n.icon, isActive(n.key, key), () => goTo(api, n.key, n.view));
    window.MacDOM.append(root, [
      item(NAV[0]),
      h('p', { class: 'side-heading' }, 'Library'),
      NAV.slice(1).map(item),
      h('p', { class: 'side-heading' }, 'Playlists'),
      PLAYLISTS.map((p) => sideItem(p.title, 'playlist', key === `playlist:${p.id}`, () => goTo(api, `playlist:${p.id}`, () => playlistView(p)))),
    ]);
  }

  // ---- Now-playing bar -----------------------------------------------------------------

  function paintRange(input, value, max) {
    input.style.setProperty('--pct', `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`);
  }

  function showTimes(refs, pos, dur) {
    refs.elapsed.textContent = clock(pos);
    refs.remain.textContent = `-${clock(dur - pos)}`;
    paintRange(refs.progress, pos, dur);
  }

  function progressKeys(e) {
    const t = currentTrack();
    if (!t) return;
    const deltas = { ArrowLeft: -SEEK_STEP, ArrowDown: -SEEK_STEP, ArrowRight: SEEK_STEP, ArrowUp: SEEK_STEP, PageDown: -SEEK_PAGE, PageUp: SEEK_PAGE };
    if (e.key === 'Home') {
      e.preventDefault();
      seek(0);
    } else if (deltas[e.key]) {
      e.preventDefault();
      seek(Math.min(t.duration - 0.5, Math.max(0, E.position() + deltas[e.key])));
    }
  }

  function progressSlider() {
    const input = h('input', {
      class: 'mu-range mu-progress', type: 'range', min: '0', max: '1', step: '0.1', value: '0',
      'aria-label': 'Playback position', 'data-fkey': 'np-progress',
      onpointerdown: () => { scrubbing = true; },
      onpointercancel: () => { scrubbing = false; },
      oninput: (e) => {
        scrubbing = true;
        const t = currentTrack();
        if (t && ui) showTimes(ui.bar, Number(e.target.value), t.duration);
      },
      onchange: (e) => {
        scrubbing = false;
        seek(Number(e.target.value));
      },
      onkeydown: progressKeys,
    });
    return input;
  }

  function nowPlayingBar() {
    const refs = {
      art: h('div', { class: 'mu-np-art' }),
      title: h('div', { class: 'mu-np-title' }),
      sub: h('div', { class: 'mu-np-sub' }),
      shuffle: iconButton('shuffle', 'Shuffle', toggleShuffle, 'mu-toggle mu-minor'),
      prev: iconButton('prev', 'Previous', prev),
      play: iconButton('play', 'Play', toggle, 'mu-play'),
      next: iconButton('next', 'Next', next),
      repeat: iconButton('repeat', 'Repeat', cycleRepeat, 'mu-toggle mu-minor'),
      elapsed: h('span', { class: 'mu-time' }, '0:00'),
      remain: h('span', { class: 'mu-time mu-time-r' }, '-0:00'),
      progress: progressSlider(),
      vol: h('input', { class: 'mu-range mu-vol', type: 'range', min: '0', max: '1', step: '0.01', value: String(state.volume),
        'aria-label': 'Volume', 'data-fkey': 'np-volume', oninput: (e) => setVolume(Number(e.target.value)) }),
    };
    paintRange(refs.vol, state.volume, 1);
    const bar = h('div', { class: 'mu-bar', role: 'region', 'aria-label': 'Now Playing' },
      h('div', { class: 'mu-np' }, refs.art, h('div', { class: 'mu-np-text' }, refs.title, refs.sub)),
      h('div', { class: 'mu-transport' },
        h('div', { class: 'mu-buttons' }, refs.shuffle, refs.prev, refs.play, refs.next, refs.repeat),
        h('div', { class: 'mu-progress-row' }, refs.elapsed, refs.progress, refs.remain)),
      h('div', { class: 'mu-volume' }, h('span', { class: 'mu-vol-icon', html: glyph('volLow', 16) }), refs.vol,
        h('span', { class: 'mu-vol-icon', html: glyph('volHigh', 16) })));
    return { bar, refs };
  }

  function syncProgress() {
    if (!ui || scrubbing) return;
    const t = currentTrack();
    const pos = t ? E.position() : 0;
    const dur = t ? t.duration : 0;
    ui.bar.progress.max = String(dur || 1);
    ui.bar.progress.value = String(pos);
    ui.bar.progress.setAttribute('aria-valuetext', `${clock(pos)} of ${clock(dur)}`);
    showTimes(ui.bar, pos, dur);
  }

  function syncBar(b, t) {
    if (b.art.dataset.track !== (t ? t.id : '')) {
      b.art.innerHTML = artFor(t, uid());
      b.art.dataset.track = t ? t.id : '';
    }
    b.title.textContent = t ? t.title : 'Not Playing';
    b.sub.textContent = t ? `${t.artist} — ${t.album.title}` : 'Choose a song to start listening';
    b.play.innerHTML = glyph(state.playing ? 'pause' : 'play', 22);
    b.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    b.play.title = state.playing ? 'Pause' : 'Play';
    [b.prev, b.next, b.progress].forEach((el) => { el.disabled = !t; });
    b.shuffle.setAttribute('aria-pressed', String(state.shuffle));
    b.repeat.setAttribute('aria-pressed', String(state.repeat !== 'off'));
    b.repeat.innerHTML = glyph(state.repeat === 'one' ? 'repeat1' : 'repeat', 18);
    b.repeat.setAttribute('aria-label', { off: 'Repeat: Off', all: 'Repeat: All', one: 'Repeat: One' }[state.repeat]);
  }

  function syncUi() {
    if (!ui) return;
    const t = currentTrack();
    syncBar(ui.bar, t);
    syncProgress();
    ui.root.classList.toggle('is-playing', state.playing);
    ui.root.querySelectorAll('.mu-row[data-track]').forEach((row) => {
      row.classList.toggle('is-current', Boolean(t) && row.dataset.track === t.id);
    });
  }

  // ---- Window --------------------------------------------------------------------------

  const isTextField = (el) =>
    Boolean(el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type))));

  function spaceKey(e) {
    if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!musicFocused() || isTextField(e.target)) return;
    e.preventDefault(); // also stops a focused button from clicking on keyup
    if (e.type === 'keydown' && !e.repeat) toggle();
  }

  function onClose() {
    document.removeEventListener('keydown', spaceKey);
    document.removeEventListener('keyup', spaceKey);
    win = null;
    ui = null;
  }

  function open() {
    const existing = window.MacWM.get(WIN_ID);
    if (existing && win) return window.MacWM.open({ id: WIN_ID });
    const api = window.MacWM.open({
      id: WIN_ID, title: 'Music', app: 'Music', icon: 'music', chrome: 'standard',
      width: 900, height: 580, minWidth: 420, minHeight: 320, nav: true,
      sidebar, onClose, view: listenNowView(),
    });
    win = { api, visible: true };
    api.el.addEventListener('win:minimized', () => { if (win) win.visible = false; });
    api.el.addEventListener('win:restored', () => {
      if (!win) return;
      win.visible = true;
      syncUi();
    });
    document.addEventListener('keydown', spaceKey);
    document.addEventListener('keyup', spaceKey);
    return api;
  }

  // ---- Engine wiring -------------------------------------------------------------------

  E.setVolume(state.volume);
  E.setMuted(window.MacAudio && window.MacAudio.isMuted());
  E.onEnd(handleEnd);
  document.addEventListener('mac:sound', (e) => E.setMuted(Boolean(e.detail && e.detail.muted)));

  window.MacMusic = Object.freeze({ open, toggle, next, prev, stop, getState, seek });
})();
