/* Blockcraft world: seeded terrain, procedural 16×16 pixel textures, chunk meshing with
   ambient occlusion, voxel raycasting and player collision. Pure data and math (the only
   DOM use is offscreen canvases for textures). Loaded before blockcraft.js.
   -> window.MacBlockcraftWorld */
(function () {
  'use strict';

  const SX = 64; // world width (x)
  const SZ = 64; // world depth (z)
  const SY = 32; // world height (y)
  const CHUNK = 16;
  const WATER_LEVEL = 11;
  const TILE = 16;
  const ATLAS_COLS = 4;
  const TEX_SEED = 4242; // textures look the same in every world
  const TREE_CHANCE = 0.022;
  const FLOWER_CHANCE = 0.035;
  const WATER_DROP = 0.12; // water surface sits a little below the block top
  const UV_INSET = 1 / 512; // keeps nearest sampling from bleeding into neighbour tiles
  const MAX_RAY_STEPS = 64;
  const SKIN = 1e-3;

  const BLOCK = Object.freeze({
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7,
    GLASS: 8, BRICKS: 9, WATER: 10, ROSE: 11, DAISY: 12,
  });
  const T = Object.freeze({
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
    PLANKS: 8, GLASS: 9, BRICKS: 10, WATER: 11, ROSE: 12, DAISY: 13,
  });

  // kind: solid (opaque), leaves (cutout, collides), glass (cutout, collides),
  // water (blended, no collision), cross (plant sprite, no collision). tone = sound pitch.
  function def(name, tiles, kind, tone) {
    const [top, side, bottom] = Array.isArray(tiles) ? tiles : [tiles, tiles, tiles];
    return Object.freeze({ name, top, side, bottom, kind, tone });
  }
  const BLOCKS = Object.freeze([
    null,
    def('Grass', [T.GRASS_TOP, T.GRASS_SIDE, T.DIRT], 'solid', 520),
    def('Dirt', T.DIRT, 'solid', 440),
    def('Stone', T.STONE, 'solid', 1500),
    def('Sand', T.SAND, 'solid', 360),
    def('Log', [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], 'solid', 760),
    def('Leaves', T.LEAVES, 'leaves', 980),
    def('Planks', T.PLANKS, 'solid', 820),
    def('Glass', T.GLASS, 'glass', 2600),
    def('Stone Bricks', T.BRICKS, 'solid', 1300),
    def('Water', T.WATER, 'water', 300),
    def('Rose', T.ROSE, 'cross', 900),
    def('Daisy', T.DAISY, 'cross', 900),
  ]);

  const kindOf = (id) => (id ? BLOCKS[id].kind : 'air');
  const isPlant = (id) => kindOf(id) === 'cross';
  const isReplaceable = (id) => id === BLOCK.AIR || id === BLOCK.WATER || isPlant(id);
  const collides = (id) => { const k = kindOf(id); return k === 'solid' || k === 'leaves' || k === 'glass'; };
  const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ;
  const idx = (x, y, z) => (y * SZ + z) * SX + x;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- Noise ------------------------------------------------------------------------

  function hash3(x, y, s) {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 0x27d4eb2d)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  function valueNoise(x, z, seed) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const a = hash3(ix, iz, seed) + (hash3(ix + 1, iz, seed) - hash3(ix, iz, seed)) * u;
    const b = hash3(ix, iz + 1, seed) + (hash3(ix + 1, iz + 1, seed) - hash3(ix, iz + 1, seed)) * u;
    return a + (b - a) * v;
  }

  function fbm(x, z, seed, octaves) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += valueNoise(x * 2 ** o, z * 2 ** o, seed + o * 131) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }

  // ---- Terrain ----------------------------------------------------------------------

  function heightAt(x, z, seed) {
    const broad = clamp((fbm(x / 34, z / 34, seed, 4) - 0.5) * 1.7 + 0.5, 0, 1);
    const detail = fbm(x / 9, z / 9, seed + 11, 2) - 0.5;
    return clamp(Math.round(5 + broad * 19 + detail * 4), 2, SY - 10);
  }

  function fillColumn(data, x, z, h) {
    const beach = h <= WATER_LEVEL + 1;
    for (let y = 0; y <= h; y++) {
      const sub = beach ? BLOCK.SAND : BLOCK.DIRT;
      data[idx(x, y, z)] = y === h ? (beach ? BLOCK.SAND : BLOCK.GRASS) : y > h - 4 ? sub : BLOCK.STONE;
    }
    for (let y = h + 1; y <= WATER_LEVEL; y++) data[idx(x, y, z)] = BLOCK.WATER;
  }

  function setIfAir(data, x, y, z, id) {
    if (inBounds(x, y, z) && data[idx(x, y, z)] === BLOCK.AIR) data[idx(x, y, z)] = id;
  }

  function nearLog(data, x, y, z) {
    for (let dy = 0; dy < 4; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (inBounds(x + dx, y + dy, z + dz) && data[idx(x + dx, y + dy, z + dz)] === BLOCK.LOG) return true;
        }
      }
    }
    return false;
  }

  function growTree(data, x, ground, z, seed) {
    const top = ground + 4 + Math.floor(hash3(x, z, seed + 7) * 2);
    data[idx(x, ground, z)] = BLOCK.DIRT;
    for (let y = top - 2; y <= top + 1; y++) {
      const r = y >= top ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (y === top + 1 || hash3(x + dx * 7 + y, z + dz * 13, seed) < 0.5)) continue;
          setIfAir(data, x + dx, y, z + dz, BLOCK.LEAVES);
        }
      }
    }
    for (let y = ground + 1; y <= top; y++) data[idx(x, y, z)] = BLOCK.LOG;
  }

  function decorate(data, heights, seed) {
    for (let z = 2; z < SZ - 2; z++) {
      for (let x = 2; x < SX - 2; x++) {
        const h = heights[z * SX + x];
        if (data[idx(x, h, z)] !== BLOCK.GRASS) continue;
        const roll = hash3(x, z, seed + 101);
        if (roll < TREE_CHANCE && !nearLog(data, x, h + 1, z)) growTree(data, x, h, z, seed);
        else if (roll > 1 - FLOWER_CHANCE) setIfAir(data, x, h + 1, z, hash3(z, x, seed) < 0.5 ? BLOCK.ROSE : BLOCK.DAISY);
      }
    }
  }

  function generate(seed) {
    const data = new Uint8Array(SX * SY * SZ);
    const heights = new Int16Array(SX * SZ);
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        heights[z * SX + x] = heightAt(x, z, seed);
        fillColumn(data, x, z, heights[z * SX + x]);
      }
    }
    decorate(data, heights, seed);
    return data;
  }

  // ---- World object (edits are tracked as a diff against the generated terrain) -----

  function encodeEdits(changes) {
    return [...changes.entries()].sort((a, b) => a[0] - b[0]).flat();
  }

  /** Validates a saved [index, id, index, id, …] list; drops anything malformed. */
  function decodeEdits(list) {
    if (!Array.isArray(list) || list.length % 2) return [];
    const pairs = [];
    for (let i = 0; i < list.length; i += 2) {
      const at = list[i];
      const id = list[i + 1];
      const ok = Number.isInteger(at) && at >= 0 && at < SX * SY * SZ && Number.isInteger(id) && id >= 0 && id < BLOCKS.length;
      if (ok) pairs.push([at, id]);
    }
    return pairs;
  }

  function createWorld(seed, edits) {
    const base = generate(seed);
    const data = base.slice();
    const changes = new Map();
    (edits || []).forEach(([at, id]) => {
      if (base[at] === id) return;
      data[at] = id;
      changes.set(at, id);
    });
    const get = (x, y, z) => (inBounds(x, y, z) ? data[idx(x, y, z)] : BLOCK.AIR);
    function set(x, y, z, id) {
      if (!inBounds(x, y, z)) return false;
      const at = idx(x, y, z);
      data[at] = id;
      if (base[at] === id) changes.delete(at);
      else changes.set(at, id);
      return true;
    }
    return Object.freeze({ seed, get, set, edits: () => encodeEdits(changes), editCount: () => changes.size });
  }

  // ---- Falling blocks ---------------------------------------------------------------
  // Sand obeys gravity. When it loses its support it leaves the block grid and becomes a
  // falling body with a fractional height that accelerates smoothly, then turns back into
  // a block where it lands. Stacks ride down together, plants underneath are crushed,
  // water closes in behind, and a body never drops into the player: it rests on their head.

  const falls = (id) => id === BLOCK.SAND;
  const FALL_GRAVITY = 30; // blocks per second²
  const FALL_MAX = 30; // terminal speed, blocks per second
  const SETTLE_DT = 0.05; // fixed step used when dropping everything instantly
  const SETTLE_LIMIT = 4000;
  const REST_EPS = 1e-3;
  const WATER_SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
  const NO_PLAYER = Object.freeze({ topAt: () => null, blocksCell: () => false });

  function createFalling(world) {
    let bodies = []; // [{ x, y, z, vy, id }]; y is the body's bottom, fractional

    const canDropInto = (x, y, z) => y >= 0 && isReplaceable(world.get(x, y, z));
    const fillFor = (x, y, z) =>
      (WATER_SIDES.some(([dx, dy, dz]) => world.get(x + dx, y + dy, z + dz) === BLOCK.WATER) ? BLOCK.WATER : BLOCK.AIR);

    // The height a body falling from y would come to rest on: the top of the first
    // block under it that is not replaceable (air, water and plants are).
    function floorUnder(x, y, z) {
      for (let c = Math.ceil(y - REST_EPS) - 1; c >= 0; c--) {
        if (!isReplaceable(world.get(x, c, z))) return c + 1;
      }
      return 0;
    }

    /** Lifts the unsupported stack at (x, y, z) out of the grid. Returns changed cells. */
    function wake(x, y, z) {
      if (!falls(world.get(x, y, z)) || !canDropInto(x, y - 1, z)) return [];
      const changed = [];
      const lifted = [];
      let yy = y;
      for (; yy < SY && falls(world.get(x, yy, z)); yy++) {
        lifted.push({ x, y: yy, z, vy: 0, id: world.get(x, yy, z) });
        world.set(x, yy, z, fillFor(x, yy, z));
        changed.push([x, yy, z]);
      }
      if (isPlant(world.get(x, yy, z))) {
        world.set(x, yy, z, fillFor(x, yy, z)); // a flower on top loses its footing
        changed.push([x, yy, z]);
      }
      bodies = [...bodies, ...lifted];
      return changed;
    }

    // Turns a body back into a block. A plant in the way is crushed.
    function land(b, cellY) {
      world.set(b.x, cellY, b.z, b.id);
      return [b.x, cellY, b.z];
    }

    // Advances one body; `below` is the body under it in the same column (already moved).
    function advance(b, dt, player, below) {
      let vy = Math.min(FALL_MAX, b.vy + FALL_GRAVITY * dt);
      let y = b.y - vy * dt;
      const floor = floorUnder(b.x, b.y, b.z);
      if (below && y < below.y + 1) {
        y = below.y + 1; // ride on the body underneath
        vy = Math.min(vy, below.vy);
      }
      const head = player.topAt(b.x, b.z);
      if (head !== null && b.y >= head - REST_EPS && y < head) {
        y = head; // rest on the player's head until they move
        vy = 0;
      }
      if (y > floor + REST_EPS) return { body: { ...b, y, vy } };
      if (player.blocksCell(b.x, floor, b.z)) return { body: { ...b, y: floor, vy: 0 } }; // wait, resting
      return { landed: land(b, floor) };
    }

    /** Moves every body by dt seconds. Returns the grid cells that changed (landings). */
    function step(dt, player = NO_PLAYER) {
      const changed = [];
      const kept = [];
      const lastInColumn = new Map(); // "x,z" -> the most recent body kept in that column
      [...bodies].sort((a, b) => a.y - b.y).forEach((b) => {
        const key = `${b.x},${b.z}`;
        const result = advance(b, dt, player, lastInColumn.get(key));
        if (result.landed) {
          changed.push(result.landed);
          lastInColumn.delete(key);
          return;
        }
        kept.push(result.body);
        lastInColumn.set(key, result.body);
      });
      bodies = kept;
      return changed;
    }

    /** Lands everything immediately, ignoring the player (used on load and before saving). */
    function finish() {
      const changed = [];
      for (let i = 0; i < SETTLE_LIMIT && bodies.length; i++) changed.push(...step(SETTLE_DT));
      return changed;
    }

    /** Drops sand left floating in an old save straight to rest. */
    function settle() {
      const changed = [];
      for (let y = 1; y < SY; y++) {
        for (let z = 0; z < SZ; z++) {
          for (let x = 0; x < SX; x++) changed.push(...wake(x, y, z));
        }
      }
      return [...changed, ...finish()];
    }

    return Object.freeze({
      wake, step, finish, settle,
      active: () => bodies.length,
      bodies: () => bodies.map(({ x, y, z, id }) => ({ x, y, z, id })),
    });
  }

  /** A textured cube for each falling body, in the chunk vertex format. */
  function buildBodies(list) {
    const out = [];
    list.forEach((b) => FACES.forEach((face) => {
      const verts = CORNERS.map(([cu, cv]) => ({
        pos: [b.x, b.y, b.z].map((c, a) => c + face.o[a] + cu * face.u[a] + cv * face.v[a]),
        uv: tileUV(BLOCKS[b.id][face.tex], cu, cv),
        light: face.shade,
      }));
      pushQuad(out, verts, [0, 1, 2, 0, 2, 3]);
    }));
    return new Float32Array(out);
  }

  // ---- Textures ---------------------------------------------------------------------

  const RGB = Object.freeze({
    dirt: [134, 96, 67], pebble: [150, 128, 104], grass: [98, 158, 56], stone: [128, 128, 132],
    sand: [218, 205, 158], bark: [104, 80, 50], wood: [182, 144, 92], leaf: [60, 124, 42],
    plank: [176, 136, 84], brick: [138, 138, 142], water: [54, 110, 206], stem: [64, 140, 48],
    rose: [208, 46, 52], daisy: [246, 246, 238], pollen: [250, 204, 60],
  });
  const CLEAR = Object.freeze([0, 0, 0, 0]);
  const WATER_ALPHA = 185;

  const tint = (rgb, k, a = 255) => [clamp(Math.round(rgb[0] * k), 0, 255), clamp(Math.round(rgb[1] * k), 0, 255), clamp(Math.round(rgb[2] * k), 0, 255), a];

  function dirtPx(x, y, r, r2) {
    if (r2 < 0.08) return tint(RGB.dirt, 0.68);
    if (r2 > 0.95) return tint(RGB.pebble, 0.95 + r * 0.1);
    return tint(RGB.dirt, 0.84 + r * 0.26);
  }
  const grassTopPx = (x, y, r, r2) => tint(RGB.grass, r2 > 0.9 ? 1.15 : 0.8 + r * 0.3);
  function grassSidePx(x, y, r, r2) {
    const edge = 3 + Math.floor(hash3(x, 0, 77) * 3);
    if (y < edge) return grassTopPx(x, y, r, r2);
    if (y === edge && r < 0.5) return tint(RGB.grass, 0.7);
    return dirtPx(x, y, r, r2);
  }
  function stonePx(x, y, r, r2) {
    const blot = hash3(x >> 1, y >> 1, 9);
    return tint(RGB.stone, (r2 < 0.07 ? 0.66 : 0.82 + r * 0.16) * (0.92 + blot * 0.14));
  }
  const sandPx = (x, y, r, r2) => tint(RGB.sand, r2 < 0.06 ? 0.86 : 0.93 + r * 0.1);
  function logSidePx(x, y, r) {
    const groove = x % 4 === 1 ? 0.72 : 1;
    return tint(RGB.bark, groove * (0.86 + hash3(x, 0, 5) * 0.2) * (0.92 + r * 0.12));
  }
  function logTopPx(x, y, r) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return tint(RGB.bark, 0.9 + r * 0.1);
    return tint(RGB.wood, (Math.floor(d) % 2 ? 0.86 : 1) * (0.94 + r * 0.08));
  }
  const leavesPx = (x, y, r, r2) => (r2 < 0.16 ? CLEAR : tint(RGB.leaf, 0.72 + r * 0.42));
  function planksPx(x, y, r) {
    const board = y >> 2;
    if (y % 4 === 3 || x === (board * 7 + 3) % TILE) return tint(RGB.plank, 0.64);
    return tint(RGB.plank, 0.86 + r * 0.08 + hash3(board, x >> 3, 3) * 0.1);
  }
  function glassPx(x, y) {
    const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
    if (edge) return [208, 228, 236, 255];
    const streak = (x + y === 9 || x + y === 11) && x > 2 && x < 8;
    return streak ? [236, 246, 250, 255] : CLEAR;
  }
  function bricksPx(x, y, r) {
    const row = y >> 3;
    const bx = x + (row % 2) * 4;
    if (y % 8 === 7 || bx % 8 === 7) return tint(RGB.brick, 0.62);
    const bevel = y % 8 === 0 || bx % 8 === 0 ? 1.1 : 1;
    return tint(RGB.brick, bevel * (0.84 + hash3(bx >> 3, row, 21) * 0.14 + r * 0.08));
  }
  function waterPx(x, y, r) {
    const wave = Math.sin((x + y * 0.5) * 0.8) + Math.sin((y - x * 0.3) * 1.3);
    return tint(RGB.water, 0.86 + wave * 0.05 + r * 0.06, WATER_ALPHA);
  }
  function flowerPainter(petal) {
    return (x, y, r) => {
      if ((x === 7 || x === 8) && y >= 8) return tint(RGB.stem, 0.85 + r * 0.2);
      if ((y === 11 && (x === 9 || x === 10)) || (y === 12 && (x === 5 || x === 6))) return tint(RGB.stem, 1.05);
      const d = Math.hypot(x - 7.5, y - 5);
      if (d < 1.2) return tint(RGB.pollen, 1);
      return d < 3.2 && r > 0.08 ? tint(petal, 0.85 + r * 0.2) : CLEAR;
    };
  }

  const PAINTERS = [grassTopPx, grassSidePx, dirtPx, stonePx, sandPx, logSidePx, logTopPx, leavesPx,
    planksPx, glassPx, bricksPx, waterPx, flowerPainter(RGB.rose), flowerPainter(RGB.daisy)];

  /** Paints every tile into one atlas. Returns the canvas plus raw RGBA (straight alpha). */
  function buildAtlas() {
    const size = TILE * ATLAS_COLS;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    PAINTERS.forEach((paint, tile) => {
      const ox = (tile % ATLAS_COLS) * TILE;
      const oy = Math.floor(tile / ATLAS_COLS) * TILE;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const px = paint(x, y, hash3(x + tile * 31, y + 17, TEX_SEED), hash3(x + tile * 31, y + 34, TEX_SEED));
          img.data.set(px, ((oy + y) * size + ox + x) * 4);
        }
      }
    });
    ctx.putImageData(img, 0, 0);
    return { canvas, pixels: new Uint8Array(img.data.slice().buffer), size };
  }

  /** Draws a small isometric block icon (for the hotbar) from the atlas. */
  function iconCanvas(atlas, id, px) {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const w = px * 0.45;
    const cx = px / 2;
    const y0 = (px - 2 * w) / 2;
    const s = w / TILE;
    const faces = [
      { tile: BLOCKS[id].top, m: [s, -s / 2, s, s / 2, cx - w, y0 + w / 2], dark: 0 },
      { tile: BLOCKS[id].side, m: [s, s / 2, 0, s, cx - w, y0 + w / 2], dark: 0.18 },
      { tile: BLOCKS[id].side, m: [s, -s / 2, 0, s, cx, y0 + w], dark: 0.34 },
    ];
    faces.forEach(({ tile, m, dark }) => {
      ctx.setTransform(...m);
      ctx.drawImage(atlas.canvas, (tile % ATLAS_COLS) * TILE, Math.floor(tile / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
      if (!dark) return;
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.fillRect(0, 0, TILE, TILE);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  // ---- Meshing (6 floats per vertex: x y z u v light; 6 vertices per face) ----------

  // u × v = normal, so origin, +u, +u+v, +v winds counter-clockwise seen from outside.
  const FACES = Object.freeze([
    { n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.86, tex: 'side' },
    { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.72, tex: 'side' },
    { n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1, tex: 'top' },
    { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.5, tex: 'bottom' },
    { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.8, tex: 'side' },
    { n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.66, tex: 'side' },
  ]);
  const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const AO_LEVELS = [0.5, 0.66, 0.82, 1];
  const PLANT_LIGHT = 0.92;
  const PLANT_PLANES = [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]];
  const TILE_UV = 1 / ATLAS_COLS;

  function tileUV(tile, cu, cv) {
    const u0 = (tile % ATLAS_COLS) * TILE_UV;
    const v0 = Math.floor(tile / ATLAS_COLS) * TILE_UV;
    const span = TILE_UV - 2 * UV_INSET;
    return [u0 + UV_INSET + cu * span, v0 + UV_INSET + (1 - cv) * span];
  }

  function faceVisible(id, nid) {
    if (nid === BLOCK.AIR) return true;
    const self = kindOf(id);
    const other = kindOf(nid);
    if (other === 'solid') return false;
    if (self === 'water') return other === 'cross';
    if (id === nid) return self === 'leaves';
    return true;
  }

  function occludes(world, x, y, z) {
    const k = kindOf(world.get(x, y, z));
    return k === 'solid' || k === 'leaves' ? 1 : 0;
  }

  function cornerAO(world, p, face, cu, cv) {
    const du = face.u.map((a) => a * (cu ? 1 : -1));
    const dv = face.v.map((a) => a * (cv ? 1 : -1));
    const s1 = occludes(world, p[0] + du[0], p[1] + du[1], p[2] + du[2]);
    const s2 = occludes(world, p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]);
    if (s1 && s2) return 0;
    return 3 - s1 - s2 - occludes(world, p[0] + du[0] + dv[0], p[1] + du[1] + dv[1], p[2] + du[2] + dv[2]);
  }

  function pushQuad(out, verts, order) {
    order.forEach((k) => {
      const v = verts[k];
      out.push(v.pos[0], v.pos[1], v.pos[2], v.uv[0], v.uv[1], v.light);
    });
  }

  function emitFace(out, world, x, y, z, id, face) {
    const water = id === BLOCK.WATER;
    const drop = water && world.get(x, y + 1, z) !== BLOCK.WATER ? WATER_DROP : 0;
    const outside = [x + face.n[0], y + face.n[1], z + face.n[2]];
    const verts = CORNERS.map(([cu, cv]) => {
      const pos = [x, y, z].map((c, a) => c + face.o[a] + cu * face.u[a] + cv * face.v[a]);
      if (pos[1] === y + 1) pos[1] -= drop;
      const ao = water ? 3 : cornerAO(world, outside, face, cu, cv);
      return { pos, uv: tileUV(BLOCKS[id][face.tex], cu, cv), light: face.shade * AO_LEVELS[ao], ao };
    });
    // Flip the diagonal so ambient occlusion interpolates without a visible crease.
    const flip = verts[0].ao + verts[2].ao < verts[1].ao + verts[3].ao;
    pushQuad(out, verts, flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3]);
  }

  function emitPlant(out, x, y, z, id) {
    PLANT_PLANES.forEach(([a, b]) => {
      const verts = CORNERS.map(([cu, cv]) => ({
        pos: [x + a[0] + (b[0] - a[0]) * cu, y + cv, z + a[1] + (b[1] - a[1]) * cu],
        uv: tileUV(BLOCKS[id].side, cu, cv),
        light: PLANT_LIGHT,
      }));
      pushQuad(out, verts, [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]); // both sides
    });
  }

  function emitBlock(out, world, x, y, z, id) {
    if (isPlant(id)) {
      emitPlant(out, x, y, z, id);
      return;
    }
    FACES.forEach((f) => {
      if (y + f.n[1] < 0) return;
      if (faceVisible(id, world.get(x + f.n[0], y + f.n[1], z + f.n[2]))) emitFace(out, world, x, y, z, id, f);
    });
  }

  /** Builds the visible faces of one 16×16 column chunk: opaque/cutout and water layers. */
  function buildChunk(world, cx, cz) {
    const solid = [];
    const water = [];
    for (let y = 0; y < SY; y++) {
      for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) {
        for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
          const id = world.get(x, y, z);
          if (id) emitBlock(id === BLOCK.WATER ? water : solid, world, x, y, z, id);
        }
      }
    }
    return { opaque: new Float32Array(solid), water: new Float32Array(water) };
  }

  // ---- Raycast (Amanatides & Woo voxel traversal) ----------------------------------

  function raycast(world, origin, dir, maxDist) {
    const cell = origin.map(Math.floor);
    const step = dir.map(Math.sign);
    const delta = dir.map((d) => (d === 0 ? Infinity : Math.abs(1 / d)));
    const tMax = dir.map((d, a) => {
      if (d === 0) return Infinity;
      return (d > 0 ? cell[a] + 1 - origin[a] : origin[a] - cell[a]) * delta[a];
    });
    let normal = [0, 0, 0];
    let t = 0;
    for (let i = 0; i < MAX_RAY_STEPS && t <= maxDist; i++) {
      const id = world.get(cell[0], cell[1], cell[2]);
      if (id && id !== BLOCK.WATER) return { x: cell[0], y: cell[1], z: cell[2], normal, id };
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      t = tMax[a];
      tMax[a] += delta[a];
      cell[a] += step[a];
      normal = [0, 0, 0].map((_, k) => (k === a ? -step[a] : 0));
    }
    return null;
  }

  // ---- Player physics (feet-centred AABB; the world edge and y < 0 are solid) -------

  const BODY = Object.freeze({ half: 0.3, height: 1.8, eye: 1.62 });
  const PHYS = Object.freeze({
    gravity: 28, jump: 8.6, maxFall: 40, walk: 4.3, sprint: 6.4, fly: 10, swim: 2.4,
    swimUp: 3.4, swimFall: 3, groundAccel: 14, airAccel: 3.5, flyAccel: 8, maxStep: 0.4,
  });

  function solidAt(world, x, y, z) {
    if (y < 0) return true;
    if (y >= SY) return false;
    if (x < 0 || z < 0 || x >= SX || z >= SZ) return true;
    return collides(world.get(x, y, z));
  }

  function boxBlocked(world, p) {
    const x1 = Math.floor(p[0] + BODY.half);
    const y1 = Math.floor(p[1] + BODY.height);
    const z1 = Math.floor(p[2] + BODY.half);
    for (let y = Math.floor(p[1]); y <= y1; y++) {
      for (let z = Math.floor(p[2] - BODY.half); z <= z1; z++) {
        for (let x = Math.floor(p[0] - BODY.half); x <= x1; x++) {
          if (solidAt(world, x, y, z)) return true;
        }
      }
    }
    return false;
  }

  function moveAxis(world, pos, axis, d) {
    const next = pos.map((v, a) => (a === axis ? v + d : v));
    if (d === 0 || !boxBlocked(world, next)) return { pos: next, hit: false };
    const lo = axis === 1 ? 0 : BODY.half;
    const hi = axis === 1 ? BODY.height : BODY.half;
    const edge = d > 0 ? Math.floor(next[axis] + hi) - hi - SKIN : Math.floor(next[axis] - lo) + 1 + lo + SKIN;
    const snapped = next.map((v, a) => (a === axis ? edge : v));
    return { pos: boxBlocked(world, snapped) ? pos : snapped, hit: true };
  }

  const inWater = (world, p) => world.get(Math.floor(p[0]), Math.floor(p[1] + 0.4), Math.floor(p[2])) === BLOCK.WATER;

  function verticalVelocity(pl, input, dt, wet) {
    const vy = pl.vel[1];
    if (pl.fly) {
      const target = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * PHYS.fly;
      return vy + (target - vy) * (1 - Math.exp(-PHYS.flyAccel * dt));
    }
    if (wet) {
      const sunk = Math.max(vy - PHYS.gravity * 0.3 * dt, -PHYS.swimFall);
      return input.jump ? Math.max(sunk, pl.onGround ? PHYS.jump * 0.7 : PHYS.swimUp) : sunk;
    }
    if (input.jump && pl.onGround) return PHYS.jump;
    return Math.max(vy - PHYS.gravity * dt, -PHYS.maxFall);
  }

  function nextVelocity(pl, input, dt, wet) {
    const sin = Math.sin(pl.yaw);
    const cos = Math.cos(pl.yaw);
    const wx = -sin * input.forward + cos * input.strafe;
    const wz = -cos * input.forward - sin * input.strafe;
    const len = Math.max(1, Math.hypot(wx, wz));
    const speed = pl.fly ? PHYS.fly : wet ? PHYS.swim : input.sprint ? PHYS.sprint : PHYS.walk;
    const accel = pl.fly ? PHYS.flyAccel : pl.onGround || wet ? PHYS.groundAccel : PHYS.airAccel;
    const k = 1 - Math.exp(-accel * dt);
    return [
      pl.vel[0] + ((wx / len) * speed - pl.vel[0]) * k,
      verticalVelocity(pl, input, dt, wet),
      pl.vel[2] + ((wz / len) * speed - pl.vel[2]) * k,
    ];
  }

  function integrate(world, pl, dt) {
    const longest = Math.max(...pl.vel.map((v) => Math.abs(v * dt)));
    const steps = Math.max(1, Math.ceil(longest / PHYS.maxStep));
    let pos = pl.pos;
    let vel = pl.vel;
    let onGround = false;
    for (let i = 0; i < steps; i++) {
      for (const axis of [0, 2, 1]) {
        const r = moveAxis(world, pos, axis, (vel[axis] * dt) / steps);
        pos = r.pos;
        if (!r.hit) continue;
        if (axis === 1 && vel[1] < 0) onGround = true;
        vel = vel.map((v, a) => (a === axis ? 0 : v));
      }
    }
    return { ...pl, pos, vel, onGround };
  }

  /**
   * Advances the player by dt seconds. pl: {pos, vel, yaw, pitch, onGround, fly};
   * input: {forward, strafe (-1..1), jump, down, sprint}. Returns a new player.
   */
  function stepPlayer(world, pl, input, dt) {
    const wet = !pl.fly && inWater(world, pl.pos);
    return integrate(world, { ...pl, vel: nextVelocity(pl, input, dt, wet) }, dt);
  }

  function topBlock(world, x, z) {
    for (let y = SY - 1; y >= 0; y--) {
      const id = world.get(x, y, z);
      if (id && !isPlant(id)) return { y, id };
    }
    return { y: 0, id: BLOCK.STONE };
  }

  /** Nearest dry, tree-free column to the centre, as a feet position. */
  function spawnPoint(world) {
    const c = SX >> 1;
    for (let r = 0; r < c; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const t = Math.max(Math.abs(dx), Math.abs(dz)) === r ? topBlock(world, c + dx, c + dz) : null;
          if (t && (t.id === BLOCK.GRASS || t.id === BLOCK.SAND)) return [c + dx + 0.5, t.y + 1, c + dz + 0.5];
        }
      }
    }
    return [c + 0.5, SY - 1, c + 0.5];
  }

  window.MacBlockcraftWorld = Object.freeze({
    SIZE: Object.freeze({ x: SX, y: SY, z: SZ, chunk: CHUNK }),
    BLOCK,
    BODY,
    blockName: (id) => (id ? BLOCKS[id].name : 'Air'),
    blockTone: (id) => (id ? BLOCKS[id].tone : 600),
    isPlant,
    isReplaceable,
    collides,
    inBounds,
    createWorld,
    createFalling,
    buildBodies,
    falls,
    decodeEdits,
    buildAtlas,
    iconCanvas,
    buildChunk,
    raycast,
    stepPlayer,
    boxBlocked,
    spawnPoint,
  });
})();
