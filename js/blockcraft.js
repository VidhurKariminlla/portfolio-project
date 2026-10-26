/* Blockcraft: an original voxel sandbox. Window, game loop, input (mouse, keyboard,
   touch), HUD, sound and save/restore. Terrain, textures, meshing and physics live in
   MacBlockcraftWorld; the WebGL renderer in MacBlockcraftGL (both loaded first).
   -> window.MacBlockcraft */
(function () {
  'use strict';

  const { h, readStore, writeStore } = window.MacDOM;
  const W = window.MacBlockcraftWorld;
  const B = W.BLOCK;
  const SIZE = W.SIZE;
  const { perspective, viewMatrix, lookDir, createRenderer } = window.MacBlockcraftGL;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const STORE_KEY = 'vos.blockcraft';
  const SAVE_VERSION = 1;
  const DEFAULT_SEED = 42;
  const HOTBAR = Object.freeze([B.GRASS, B.DIRT, B.STONE, B.BRICKS, B.PLANKS, B.LOG, B.LEAVES, B.GLASS, B.SAND]);
  const ICON_PX = 64;
  const MAX_DPR = 2;
  const FOV = (70 * Math.PI) / 180;
  const MAX_FOVY = 1.75;
  const NEAR = 0.05;
  const FAR = 160;
  const REACH = 6;
  const MOUSE_SENS = 0.0024;
  const TOUCH_SENS = 0.0065;
  const PITCH_LIMIT = 1.55;
  const MAX_DT = 0.05;
  const REPEAT_FIRST = 0.3;
  const REPEAT_NEXT = 0.2;
  const SAVE_DELAY = 600;
  const TOAST_MS = 1300;
  const WHEEL_STEP = 50;
  const STICK_BASE = 56; // half the joystick base size in CSS px
  const STICK_RADIUS = 44;
  const LOOK_ZONE = 0.42; // touches right of this fraction of the width look around

  const SKY = Object.freeze({
    day: { zenith: [0.33, 0.58, 0.93], horizon: [0.74, 0.86, 0.97], sun: 1, line: [0, 0, 0, 0.6] },
    night: { zenith: [0.04, 0.05, 0.14], horizon: [0.3, 0.24, 0.44], sun: 0.6, line: [1, 1, 1, 0.55] },
  });

  const KEYMAP = Object.freeze({
    KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right', Space: 'jump', ShiftLeft: 'shift', ShiftRight: 'shift',
  });

  const KEY_HELP = [
    ['W A S D', 'Move'], ['Mouse', 'Look around'], ['Space', 'Jump'], ['Shift', 'Sprint'],
    ['F', 'Fly · Space up, Shift down'], ['Click', 'Break block'], ['Right-click', 'Place block'],
    ['1–9', 'Choose block, or scroll'], ['Esc', 'Pause'],
  ];

  const GLYPH = Object.freeze({
    jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
    break: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    place: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M12 9v6M9 12h6"/></svg>',
    fly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 13l5-5 5 5M7 18l5-5 5 5"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>',
    cube: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6l16 9v18l-16 9-16-9V15z"/><path d="M8 15l16 9 16-9M24 24v18"/></svg>',
  });

  // ---- Sound (synthesised; created only after a user gesture) -----------------------

  function createSfx() {
    let ctx = null;
    let noise = null;
    const quiet = (p) => p && typeof p.catch === 'function' && p.catch(() => {});

    function unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!ctx && AC) {
        try {
          ctx = new AC();
          noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
          noise.getChannelData(0).forEach((_, i, arr) => (arr[i] = Math.random() * 2 - 1));
        } catch (err) {
          ctx = null; // no audio on this device; the game stays silent
        }
      }
      if (ctx && ctx.state === 'suspended') quiet(ctx.resume());
    }

    function play(kind, id) {
      if (!ctx || (window.MacAudio && window.MacAudio.isMuted())) return;
      const t = ctx.currentTime;
      const breaking = kind === 'break';
      const dur = breaking ? 0.16 : 0.09;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = breaking ? 'bandpass' : 'lowpass';
      filter.frequency.value = W.blockTone(id) * (breaking ? 1 : 0.8);
      filter.Q.value = 1.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(breaking ? 0.22 : 0.15, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    function close() {
      if (ctx) quiet(ctx.close());
      ctx = null;
    }

    return { unlock, play, close };
  }

  // ---- Save data --------------------------------------------------------------------

  const finiteList = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);

  function parseSave(raw) {
    if (!raw) return null;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return null; // a corrupt save just starts a fresh world
    }
    if (!data || data.v !== SAVE_VERSION || !Number.isInteger(data.seed)) return null;
    const pos = finiteList(data.pos, 3) && data.pos[1] >= 0 ? data.pos : null;
    return {
      seed: data.seed,
      edits: W.decodeEdits(data.edits),
      pos,
      look: finiteList(data.look, 2) ? data.look : [0, 0],
      fly: data.fly === true,
      slot: Number.isInteger(data.slot) && data.slot >= 0 && data.slot < HOTBAR.length ? data.slot : 0,
    };
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  function capture(el, pointerId) {
    try {
      el.setPointerCapture(pointerId);
    } catch (err) {
      /* the pointer already ended; nothing to capture */
    }
  }

  // ---- DOM --------------------------------------------------------------------------

  const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

  function buildOverlay(atlas) {
    const icon = h('div', { class: 'bc-card-icon' }, W.iconCanvas(atlas, B.GRASS, ICON_PX * 2));
    const title = h('h2', { class: 'bc-title' }, 'Blockcraft');
    const sub = h('p', { class: 'bc-sub' }, '');
    const play = h('button', { class: 'bc-btn bc-primary', type: 'button' }, 'Click to Play');
    const keys = h('dl', { class: 'bc-keys' }, KEY_HELP.map(([k, label]) => [
      h('dt', {}, k.split(' ').map((t) => h('kbd', {}, t))), h('dd', {}, label),
    ]));
    const touchHelp = h('p', { class: 'bc-touch-help' }, 'Drag on the left to move and on the right to look around. Use the buttons to jump, break and place blocks.');
    const newWorld = h('button', { class: 'bc-btn bc-quiet', type: 'button' }, 'New World…');
    const main = h('div', { class: 'bc-card-main' }, icon, title, sub, play, keys, touchHelp, newWorld);
    const cancel = h('button', { class: 'bc-btn bc-secondary', type: 'button' }, 'Cancel');
    const confirm = h('button', { class: 'bc-btn bc-danger', type: 'button' }, 'Create New World');
    const ask = h('div', { class: 'bc-card-confirm', hidden: true },
      h('h2', { class: 'bc-title' }, 'Start a new world?'),
      h('p', { class: 'bc-sub' }, 'Your current world and everything you’ve built in it will be replaced. This can’t be undone.'),
      h('div', { class: 'bc-actions' }, cancel, confirm));
    const card = h('div', { class: 'bc-card', role: 'dialog', 'aria-label': 'Blockcraft' }, main, ask);
    return { el: h('div', { class: 'bc-overlay' }, card), title, sub, play, main, ask, newWorld, cancel, confirm };
  }

  function buildTouch() {
    const knob = h('div', { class: 'bc-knob' });
    const stick = h('div', { class: 'bc-stick', 'aria-hidden': 'true' }, knob);
    const btn = (act, label) => h('button', { class: `bc-tbtn bc-t-${act}`, type: 'button', 'aria-label': label, 'data-act': act, html: GLYPH[act] });
    const buttons = [btn('fly', 'Toggle flying'), btn('place', 'Place block'), btn('break', 'Break block'), btn('jump', 'Jump')];
    const pause = btn('pause', 'Pause');
    const el = h('div', { class: 'bc-touch' }, stick, h('div', { class: 'bc-tpad' }, buttons), pause);
    return { el, stick, knob, buttons: [...buttons, pause] };
  }

  function buildDom(root, atlas) {
    const canvas = h('canvas', { class: 'bc-canvas', tabindex: '-1', 'aria-label': 'Blockcraft world' });
    const fly = h('div', { class: 'bc-pill', hidden: true }, 'Flying');
    const toast = h('div', { class: 'bc-toast', role: 'status', 'aria-live': 'polite' });
    const slots = HOTBAR.map((id, i) => h('button', {
      class: 'bc-slot', type: 'button', 'aria-label': `${W.blockName(id)}, slot ${i + 1}`, 'aria-pressed': 'false', 'data-slot': String(i),
    }, W.iconCanvas(atlas, id, ICON_PX), h('span', { class: 'bc-slot-key', 'aria-hidden': 'true' }, String(i + 1))));
    const hotbar = h('div', { class: 'bc-hotbar', role: 'toolbar', 'aria-label': 'Hotbar' }, slots);
    const hud = h('div', { class: 'bc-hud' }, h('div', { class: 'bc-crosshair', 'aria-hidden': 'true' }), fly, toast, hotbar);
    const touch = buildTouch();
    const overlay = buildOverlay(atlas);
    root.append(canvas, hud, touch.el, overlay.el);
    return { canvas, fly, toast, slots, touch, overlay };
  }

  function showEmpty(root, title, body) {
    root.replaceChildren(h('div', { class: 'bc-empty', role: 'status' },
      h('div', { class: 'bc-empty-icon', html: GLYPH.cube }), h('h2', { class: 'bc-title' }, title), h('p', { class: 'bc-sub' }, body)));
  }

  function createContext(canvas) {
    const opts = { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: false };
    try {
      return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    } catch (err) {
      return null;
    }
  }

  // ---- Game -------------------------------------------------------------------------

  function createGame(root, api) {
    root.classList.add('bc-app');
    root.classList.toggle('is-coarse', coarsePointer());
    const atlas = W.buildAtlas();
    const ui = buildDom(root, atlas);
    const gl = createContext(ui.canvas);
    const noWebGL = 'Blockcraft needs WebGL, which is turned off or unsupported here. Try another browser, or turn on hardware acceleration.';
    if (!gl) {
      showEmpty(root, '3D graphics aren’t available', noWebGL);
      return { destroy() {} };
    }
    let renderer = null;
    try {
      renderer = createRenderer(gl, atlas);
    } catch (err) {
      showEmpty(root, '3D graphics aren’t available', noWebGL);
      return { destroy() {} };
    }

    const offs = [];
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      offs.push(() => target.removeEventListener(type, fn, opts));
    };
    const sfx = createSfx();
    const saved = parseSave(readStore('localStorage', STORE_KEY));
    let world = W.createWorld(saved ? saved.seed : DEFAULT_SEED, saved ? saved.edits : []);
    let falling = W.createFalling(world);
    let player = null;
    let slot = saved ? saved.slot : 0;
    let mode = 'title'; // title | play | paused | confirm
    let backMode = 'title'; // where Cancel returns from the New World question
    let touchMode = false;
    let pointerType = 'mouse';
    let held = {};
    let repeat = { break: 0, place: 0 };
    let stickVec = { x: 0, y: 0 };
    let stickTouch = null;
    let look = null;
    let target = null;
    let proj = perspective(FOV, 1, NEAR, FAR);
    let tanHalf = Math.tan(FOV / 2);
    let raf = 0;
    let still = 0;
    let last = 0;
    let minimized = false;
    let lost = false;
    let wheelAcc = 0;
    let lockFailures = 0;
    let lockPending = false;
    let saveTimer = 0;
    let toastTimer = 0;

    const lockSupported = typeof ui.canvas.requestPointerLock === 'function';
    const isLocked = () => document.pointerLockElement === ui.canvas;
    const eyePos = () => [player.pos[0], player.pos[1] + W.BODY.eye, player.pos[2]];
    const sky = () => (window.MacTheme && window.MacTheme.isDark() ? SKY.night : SKY.day);
    const canRun = () => mode === 'play' && !document.hidden && !minimized && !lost;

    // -- world + player

    function spawnState(pos, lookAt, fly) {
      const ok = pos && !W.boxBlocked(world, pos);
      return { pos: ok ? pos : W.spawnPoint(world), vel: [0, 0, 0], yaw: lookAt[0], pitch: lookAt[1], onGround: false, fly: Boolean(fly && ok) };
    }

    function rebuildAll() {
      for (let cz = 0; cz < SIZE.z / SIZE.chunk; cz++) {
        for (let cx = 0; cx < SIZE.x / SIZE.chunk; cx++) renderer.setChunk(cx, cz, W.buildChunk(world, cx, cz));
      }
    }

    // An edit can change faces and shading in neighbouring chunks too.
    function rebuildAround(cells) {
      const keys = new Set();
      const maxC = SIZE.x / SIZE.chunk - 1;
      cells.forEach(([x, , z]) => [-1, 0, 1].forEach((dz) => [-1, 0, 1].forEach((dx) => {
        keys.add(`${clamp(Math.floor((x + dx) / SIZE.chunk), 0, maxC)},${clamp(Math.floor((z + dz) / SIZE.chunk), 0, maxC)}`);
      })));
      keys.forEach((key) => {
        const [cx, cz] = key.split(',').map(Number);
        renderer.setChunk(cx, cz, W.buildChunk(world, cx, cz));
      });
    }

    function persist() {
      if (!player) return;
      // Anything still in the air lands first, so a save never loses falling sand.
      const landed = falling.finish();
      if (landed.length) {
        rebuildAround(landed);
        syncBodies();
      }
      writeStore('localStorage', STORE_KEY, JSON.stringify({
        v: SAVE_VERSION, seed: world.seed, edits: world.edits(), pos: player.pos.map(round2),
        look: [round2(player.yaw), round2(player.pitch)], fly: player.fly, slot,
      }));
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      // Wait for falling sand to land rather than snapping it mid-air.
      saveTimer = setTimeout(() => (falling.active() ? scheduleSave() : persist()), SAVE_DELAY);
    }

    function editBlocks(cells) {
      cells.forEach(([x, y, z, id]) => world.set(x, y, z, id));
      rebuildAround(cells);
      scheduleSave();
    }

    function overlapsPlayer(x, y, z) {
      const p = player.pos;
      const r = W.BODY.half;
      return x < p[0] + r && x + 1 > p[0] - r && z < p[2] + r && z + 1 > p[2] - r && y < p[1] + W.BODY.height && y + 1 > p[1];
    }

    function breakBlock() {
      if (!target || target.y === 0) return; // the bottom layer is the floor of the world
      const { x, y, z, id } = target;
      const plantAbove = W.isPlant(world.get(x, y + 1, z));
      editBlocks(plantAbove ? [[x, y, z, B.AIR], [x, y + 1, z, B.AIR]] : [[x, y, z, B.AIR]]);
      liftFalling(falling.wake(x, y + 1, z)); // sand resting on this block now has nothing under it
      sfx.play('break', id);
      target = W.raycast(world, eyePos(), lookDir(player.yaw, player.pitch), REACH);
    }

    function placeBlock() {
      if (!target) return;
      const id = HOTBAR[slot];
      const into = W.isPlant(target.id) ? [0, 0, 0] : target.normal;
      const [x, y, z] = [target.x + into[0], target.y + into[1], target.z + into[2]];
      if (!W.inBounds(x, y, z) || !W.isReplaceable(world.get(x, y, z))) return;
      if (W.collides(id) && overlapsPlayer(x, y, z)) return;
      editBlocks([[x, y, z, id]]);
      if (W.falls(id)) liftFalling(falling.wake(x, y, z));
      sfx.play('place', id);
    }

    function pickBlock() {
      const i = target ? HOTBAR.indexOf(target.id) : -1;
      if (i >= 0) selectSlot(i);
    }

    // -- HUD

    function showToast(text) {
      ui.toast.textContent = text;
      ui.toast.classList.add('is-shown');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => ui.toast.classList.remove('is-shown'), TOAST_MS);
    }

    function selectSlot(i, quiet) {
      slot = i;
      ui.slots.forEach((el, k) => {
        el.classList.toggle('is-selected', k === i);
        el.setAttribute('aria-pressed', String(k === i));
      });
      if (quiet) return;
      showToast(W.blockName(HOTBAR[i]));
      scheduleSave();
    }

    function toggleFly() {
      player = { ...player, fly: !player.fly, vel: [player.vel[0], 0, player.vel[2]] };
      ui.fly.hidden = !player.fly;
    }

    function renderOverlay() {
      const o = ui.overlay;
      const asking = mode === 'confirm';
      o.main.hidden = asking;
      o.ask.hidden = !asking;
      if (asking) return;
      const verb = coarsePointer() ? 'Tap' : 'Click';
      o.title.textContent = mode === 'paused' ? 'Paused' : 'Blockcraft';
      o.sub.textContent = mode === 'paused' ? 'Your world saves automatically as you build.' : 'Dig, build and explore a little world of your own.';
      o.play.textContent = mode === 'paused' ? `${verb} to Resume` : `${verb} to Play`;
    }

    function setMode(next) {
      const hadFocus = root.contains(document.activeElement);
      mode = next;
      const playing = next === 'play';
      root.classList.toggle('is-playing', playing);
      root.classList.toggle('is-touch', playing && touchMode);
      ui.overlay.el.hidden = playing;
      if (playing) {
        ui.canvas.focus({ preventScroll: true });
        startLoop();
        return;
      }
      stopLoop();
      renderOverlay();
      const focusEl = next === 'confirm' ? ui.overlay.cancel : ui.overlay.play;
      if (hadFocus) focusEl.focus({ preventScroll: true });
      drawSoon();
    }

    // -- play / pause

    // A refusal can be temporary (right after Esc), so ask once more before falling back
    // to on-screen controls, which also work with a mouse.
    function onLockError() {
      if (!lockPending) return; // the promise and the event can both report one refusal
      lockPending = false;
      lockFailures += 1;
      if (mode === 'play') return;
      if (lockFailures < 2) {
        ui.overlay.sub.textContent = 'Couldn’t capture the pointer. Click again to play.';
        return;
      }
      touchMode = true;
      setMode('play');
    }

    function requestLock() {
      lockPending = true;
      try {
        const result = ui.canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') result.catch(onLockError);
      } catch (err) {
        onLockError();
      }
    }

    function start() {
      if (lost || mode === 'play') return;
      sfx.unlock();
      touchMode = pointerType === 'touch' || pointerType === 'pen' || !lockSupported || lockFailures >= 2;
      if (touchMode) setMode('play');
      else requestLock(); // play starts on pointerlockchange
    }

    function releaseInput() {
      held = {};
      repeat = { break: 0, place: 0 };
      look = null;
      stickTouch = null;
      stickVec = { x: 0, y: 0 };
      resetStick();
    }

    function pause() {
      if (mode !== 'play') return;
      releaseInput();
      persist();
      if (isLocked()) document.exitPointerLock();
      setMode('paused');
    }

    // -- loop

    function update(dt) {
      const k = (a) => (held[a] ? 1 : 0);
      const input = {
        forward: clamp(k('forward') - k('back') - stickVec.y, -1, 1),
        strafe: clamp(k('right') - k('left') + stickVec.x, -1, 1),
        jump: Boolean(held.jump), down: Boolean(held.shift), sprint: Boolean(held.shift),
      };
      player = W.stepPlayer(world, player, input, dt);
      if (player.pos[1] < -2) player = spawnState(null, [player.yaw, 0], false);
      target = W.raycast(world, eyePos(), lookDir(player.yaw, player.pitch), REACH);
      tickRepeat('break', dt);
      tickRepeat('place', dt);
      tickFalling(dt);
    }

    // -- falling sand: smooth bodies that become blocks again when they land

    function syncBodies() {
      renderer.setBodies(W.buildBodies(falling.bodies()));
    }

    // Sand just lifted out of the grid: redraw the cells it left and draw it falling.
    function liftFalling(cells) {
      if (!cells.length) return;
      rebuildAround(cells);
      syncBodies();
    }

    // The top of the player's head if they stand in column (x, z), else null.
    function playerTopAt(x, z) {
      const p = player.pos;
      const r = W.BODY.half;
      const inColumn = x < p[0] + r && x + 1 > p[0] - r && z < p[2] + r && z + 1 > p[2] - r;
      return inColumn ? p[1] + W.BODY.height : null;
    }

    function tickFalling(dt) {
      if (!falling.active()) return;
      const landed = falling.step(dt, { topAt: playerTopAt, blocksCell: overlapsPlayer });
      syncBodies();
      if (!landed.length) return;
      rebuildAround(landed);
      scheduleSave();
    }

    function drawScene() {
      renderer.draw({
        proj, tanHalf, sky: sky(), eye: eyePos(), pitch: player.pitch,
        view: viewMatrix(eyePos(), player.yaw, player.pitch), target: mode === 'play' ? target : null,
      });
    }

    function frame(now) {
      raf = 0;
      if (!canRun()) return;
      const dt = Math.min(MAX_DT, (now - last) / 1000);
      last = now;
      update(dt);
      drawScene();
      raf = requestAnimationFrame(frame);
    }

    function startLoop() {
      if (raf || !canRun()) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function stopLoop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // One still frame while paused (after a resize, theme change or restore).
    function drawSoon() {
      if (raf || still || lost || minimized) return;
      still = requestAnimationFrame(() => {
        still = 0;
        drawScene();
      });
    }

    function resize() {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(root.clientWidth * dpr));
      const hgt = Math.max(1, Math.round(root.clientHeight * dpr));
      if (ui.canvas.width !== w) ui.canvas.width = w;
      if (ui.canvas.height !== hgt) ui.canvas.height = hgt;
      gl.viewport(0, 0, w, hgt);
      const aspect = w / hgt;
      // Portrait screens get a taller field of view so the sides aren't cramped.
      const fovy = aspect < 1 ? Math.min(MAX_FOVY, 2 * Math.atan((Math.tan(FOV / 2) / aspect) * 0.75)) : FOV;
      proj = perspective(fovy, aspect, NEAR, FAR);
      tanHalf = Math.tan(fovy / 2);
      drawSoon();
    }

    // -- actions held down repeat, like holding the mouse button

    function doAction(action) {
      if (action === 'break') breakBlock();
      else placeBlock();
    }

    function press(action) {
      doAction(action);
      held = { ...held, [action]: true };
      repeat = { ...repeat, [action]: REPEAT_FIRST };
    }

    function release(action) {
      held = { ...held, [action]: false };
    }

    function tickRepeat(action, dt) {
      if (!held[action]) return;
      const left = repeat[action] - dt;
      if (left > 0) {
        repeat = { ...repeat, [action]: left };
        return;
      }
      doAction(action);
      repeat = { ...repeat, [action]: REPEAT_NEXT };
    }

    function turn(dx, dy) {
      player = { ...player, yaw: player.yaw - dx, pitch: clamp(player.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT) };
    }

    // -- keyboard + mouse

    function onKeyDown(e) {
      if (mode === 'confirm' && e.key === 'Escape') {
        setMode(backMode);
        return;
      }
      if (mode !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
      const action = KEYMAP[e.code];
      if (action) {
        e.preventDefault();
        held = { ...held, [action]: true };
      } else if (e.code === 'KeyF' && !e.repeat) {
        toggleFly();
      } else if (/^Digit[1-9]$/.test(e.code)) {
        selectSlot(Number(e.code.slice(5)) - 1);
      } else if (e.key === 'Escape') {
        pause(); // touch / no-pointer-lock play; with a lock the browser handles Esc
      }
    }

    function onKeyUp(e) {
      const action = KEYMAP[e.code];
      if (action) held = { ...held, [action]: false };
    }

    function onMouseDown(e) {
      if (mode !== 'play' || touchMode) return;
      e.preventDefault();
      if (e.button === 0) press('break');
      else if (e.button === 2) press('place');
      else if (e.button === 1) pickBlock();
    }

    function onMouseUp(e) {
      if (e.button === 0) release('break');
      else if (e.button === 2) release('place');
    }

    function onMouseMove(e) {
      if (mode === 'play' && isLocked()) turn(e.movementX * MOUSE_SENS, e.movementY * MOUSE_SENS);
    }

    function onWheel(e) {
      if (mode !== 'play') return;
      e.preventDefault();
      wheelAcc += e.deltaMode ? e.deltaY * WHEEL_STEP : e.deltaY;
      if (Math.abs(wheelAcc) < WHEEL_STEP) return;
      const dir = Math.sign(wheelAcc);
      wheelAcc = 0;
      selectSlot((slot + dir + HOTBAR.length) % HOTBAR.length);
    }

    function onLockChange() {
      if (isLocked()) {
        lockFailures = 0;
        lockPending = false;
        if (mode !== 'play') setMode('play');
        return;
      }
      if (!touchMode) pause();
    }

    // -- touch: floating joystick on the left, drag to look on the right

    function resetStick() {
      ui.touch.stick.style.left = '';
      ui.touch.stick.style.top = '';
      ui.touch.stick.style.bottom = '';
      ui.touch.stick.classList.remove('is-active');
      ui.touch.knob.style.transform = '';
    }

    function onPointerDown(e) {
      if (mode !== 'play' || !touchMode) return;
      const rect = ui.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      capture(ui.canvas, e.pointerId);
      if (x > rect.width * LOOK_ZONE) {
        look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      if (stickTouch) return;
      stickTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      const s = ui.touch.stick.style;
      s.left = `${x - STICK_BASE}px`;
      s.top = `${e.clientY - rect.top - STICK_BASE}px`;
      s.bottom = 'auto';
      ui.touch.stick.classList.add('is-active');
    }

    function onPointerMove(e) {
      if (look && e.pointerId === look.id) {
        turn((e.clientX - look.x) * TOUCH_SENS, (e.clientY - look.y) * TOUCH_SENS);
        look = { ...look, x: e.clientX, y: e.clientY };
        return;
      }
      if (!stickTouch || e.pointerId !== stickTouch.id) return;
      const dx = e.clientX - stickTouch.x;
      const dy = e.clientY - stickTouch.y;
      const scale = Math.min(1, STICK_RADIUS / (Math.hypot(dx, dy) || 1));
      ui.touch.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
      stickVec = { x: (dx * scale) / STICK_RADIUS, y: (dy * scale) / STICK_RADIUS };
    }

    function onPointerUp(e) {
      if (look && e.pointerId === look.id) look = null;
      if (!stickTouch || e.pointerId !== stickTouch.id) return;
      stickTouch = null;
      stickVec = { x: 0, y: 0 };
      resetStick();
    }

    function wireTouchButton(el) {
      const act = el.dataset.act;
      const down = (e) => {
        e.preventDefault();
        capture(el, e.pointerId);
        if (act === 'jump') held = { ...held, jump: true };
        else if (act === 'break' || act === 'place') press(act);
        else if (act === 'fly') toggleFly();
        else if (act === 'pause') pause();
      };
      const up = () => (act === 'jump' ? (held = { ...held, jump: false }) : release(act));
      el.addEventListener('pointerdown', down);
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => el.addEventListener(type, up));
    }

    // -- window lifecycle

    function onWindows() {
      const active = window.MacWM.active();
      if (!active || active.id !== api.id) pause();
    }

    function onVisibility() {
      if (document.hidden) pause();
      else drawSoon();
    }

    function onMinimized() {
      pause();
      minimized = true;
      stopLoop();
    }

    function onRestored() {
      minimized = false;
      drawSoon();
    }

    function onContextLost(e) {
      e.preventDefault();
      lost = true;
      stopLoop();
      persist();
      if (isLocked()) document.exitPointerLock();
      showEmpty(root, 'Graphics were interrupted', 'Close and reopen Blockcraft to keep playing. Your world is saved.');
    }

    // -- new world (confirmed inside the overlay)

    function createNewWorld() {
      world = W.createWorld(Math.floor(Math.random() * 2147483647), []);
      falling = W.createFalling(world);
      syncBodies();
      rebuildAll();
      player = spawnState(null, [0, 0], false);
      ui.fly.hidden = true;
      persist();
      setMode('title');
      showToast('New world created');
    }

    function wireOverlay() {
      const o = ui.overlay;
      o.play.addEventListener('click', start);
      o.newWorld.addEventListener('click', () => {
        backMode = mode;
        setMode('confirm');
      });
      o.cancel.addEventListener('click', () => setMode(backMode));
      o.confirm.addEventListener('click', createNewWorld);
      o.el.addEventListener('click', (e) => {
        if (e.target === o.el && mode !== 'confirm') start(); // click anywhere outside the card
      });
    }

    function wire() {
      wireOverlay();
      ui.touch.buttons.forEach(wireTouchButton);
      ui.slots.forEach((el, i) => el.addEventListener('click', () => selectSlot(i)));
      listen(root, 'pointerdown', (e) => (pointerType = e.pointerType || 'mouse'), true);
      listen(root, 'contextmenu', (e) => e.preventDefault());
      listen(ui.canvas, 'mousedown', onMouseDown);
      listen(ui.canvas, 'wheel', onWheel, { passive: false });
      listen(ui.canvas, 'pointerdown', onPointerDown);
      listen(ui.canvas, 'pointermove', onPointerMove);
      ['pointerup', 'pointercancel'].forEach((type) => listen(ui.canvas, type, onPointerUp));
      listen(ui.canvas, 'webglcontextlost', onContextLost);
      listen(document, 'keydown', onKeyDown);
      listen(document, 'keyup', onKeyUp);
      listen(document, 'mouseup', onMouseUp);
      listen(document, 'mousemove', onMouseMove);
      listen(document, 'pointerlockchange', onLockChange);
      listen(document, 'pointerlockerror', onLockError);
      listen(document, 'visibilitychange', onVisibility);
      listen(document, 'mac:theme', drawSoon);
      listen(document, 'mac:windows', onWindows);
      listen(window, 'blur', pause);
      listen(api.el, 'win:minimized', onMinimized);
      listen(api.el, 'win:restored', onRestored);
    }

    // -- boot

    // Sand left floating in a save from before gravity existed settles before first draw.
    if (falling.settle().length) scheduleSave();
    rebuildAll();
    player = spawnState(saved && saved.pos, saved ? saved.look : [0, 0], saved && saved.fly);
    ui.fly.hidden = !player.fly;
    selectSlot(slot, true);
    wire();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    setMode('title');

    function destroy() {
      stopLoop();
      if (still) cancelAnimationFrame(still);
      clearTimeout(saveTimer);
      clearTimeout(toastTimer);
      if (!lost) persist();
      if (isLocked()) document.exitPointerLock();
      offs.forEach((off) => off());
      ro.disconnect();
      sfx.close();
      renderer.dispose();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }

    return { destroy };
  }

  // ---- Window -----------------------------------------------------------------------

  let game = null;

  function render(root, api) {
    if (game) game.destroy();
    game = createGame(root, api);
  }

  function open() {
    return window.MacWM.open({
      id: 'blockcraft',
      title: 'Blockcraft',
      app: 'Blockcraft',
      icon: 'blockcraft',
      chrome: 'standard',
      width: 960,
      height: 620,
      minWidth: 480,
      minHeight: 340,
      onClose: () => {
        if (game) game.destroy();
        game = null;
      },
      view: { title: 'Blockcraft', render },
    });
  }

  window.MacBlockcraft = Object.freeze({ open });
})();
