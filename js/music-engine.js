/* Music synth engine: Web Audio instruments, a tiny song compiler and a look-ahead
   scheduler. Songs are original compositions written as data (see music-songs below)
   and rendered live; there are no audio files. -> window.MacMusicEngine
   The compositions themselves live at the bottom of this file (SONGS).

   A song is { id, bpm, bars, swing?, human?, prog: [chord per bar], parts: [...] }.
   Parts are compiled once into a sorted list of { i: instrument, t, d, m: midi, v, k: kit }. */
(function () {
  'use strict';

  const TICK_MS = 25;
  const LOOKAHEAD = 0.12; // seconds scheduled ahead of the AudioContext clock
  const LOOKAHEAD_HIDDEN = 1.5; // background tabs throttle timers, so reach further
  const START_DELAY = 0.06;
  const FADE = 0.04;
  const KILL_MS = 140;
  const END_TAIL = 0.6; // let the last note ring before reporting the end
  const CARRY_MIN = 0.8; // long notes a seek lands inside are re-struck from there
  const STEPS = 16; // sixteenth notes per bar
  const MASTER_GAIN = 0.9;
  const IR_SECONDS = 2.8;

  // ---- Pitch and harmony ---------------------------------------------------------------

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const QUALITY = {
    '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
    '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14],
    '6': [0, 4, 7, 9], sus2: [0, 2, 7], sus4: [0, 5, 7],
  };
  const BASS_STEP = { x: () => 0, o: () => 12, f: () => 7, t: (c) => c.ivals[1] };
  const HIT_VEL = { X: 1, x: 0.8, g: 0.35 };
  const LANES = ['kick', 'snare', 'clap', 'hat', 'ohat', 'shaker'];

  const pcOf = (name) => (PC[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12) % 12;
  const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const lowest = (pc, low) => low + ((((pc - low) % 12) + 12) % 12);

  function midiOf(note) {
    const m = /^([A-G][#b]?)(\d)$/.exec(note);
    return m ? 12 * (Number(m[2]) + 1) + pcOf(m[1]) - (m[1] === 'Cb' ? 12 : 0) : null;
  }

  function chordOf(symbol) {
    const m = /^([A-G][#b]?)(.*)$/.exec(symbol);
    return { root: pcOf(m[1]), ivals: QUALITY[m[2]] || QUALITY[''] };
  }

  // Close voicing around a centre note, so successive chords move smoothly.
  function voicing(chord, center) {
    const floor = center - 6;
    const tones = chord.ivals.map((iv) => lowest((chord.root + iv) % 12, floor));
    return [...new Set(tones)].sort((a, b) => a - b);
  }

  function arpTones(chord, low) {
    const base = lowest(chord.root, low);
    const tones = [];
    for (let o = 0; o < 3; o += 1) chord.ivals.slice(0, 4).forEach((iv) => tones.push(base + iv + 12 * o));
    return tones.sort((a, b) => a - b);
  }

  // ---- Compiler ------------------------------------------------------------------------

  // Deterministic randomness so humanised songs play the same every time.
  function seeded(text) {
    let a = [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const spans = (part) => (Array.isArray(part.at[0]) ? part.at : [part.at]);
  const clean = (s) => s.replace(/[\s|]/g, '');

  // 'x---..x-' -> [{ i: 0, len: 4, c: 'x' }, { i: 6, len: 2, c: 'x' }]
  function hits(rhythm) {
    const r = clean(rhythm);
    const out = [];
    for (let i = 0; i < r.length; i += 1) {
      if (r[i] === '.' || r[i] === '-') continue;
      let len = 1;
      while (r[i + len] === '-') len += 1;
      out.push({ i, len, c: r[i] });
    }
    return { list: out, bars: Math.max(1, Math.ceil(r.length / STEPS)) };
  }

  function eachHit(part, from, to, fn) {
    const { list, bars } = hits(part.rhythm);
    for (let start = from; start < to; start += bars) {
      list.forEach((hit) => {
        const step = start * STEPS + hit.i;
        const bar = Math.floor(step / STEPS);
        if (bar < to) fn(step, Math.min(hit.len, to * STEPS - step), bar, hit.c);
      });
    }
  }

  function parseMelody(text) {
    return text.trim().split(/[\s|]+/).filter(Boolean).map((token) => {
      const [note, len] = token.split(':');
      return { m: note === '.' ? null : midiOf(note), len: Number(len) || 2 };
    });
  }

  const GEN = {
    chords(part, from, to, env) {
      eachHit(part, from, to, (step, len, bar) =>
        voicing(env.chordAt(bar), part.center || 60).forEach((m) => env.push(part.inst, step, len, m, part.vel)));
    },
    bass(part, from, to, env) {
      eachHit(part, from, to, (step, len, bar, c) => {
        const chord = env.chordAt(bar);
        const shift = (BASS_STEP[c] || BASS_STEP.x)(chord);
        env.push(part.inst, step, len, lowest(chord.root, part.low || 33) + shift, part.vel);
      });
    },
    arp(part, from, to, env) {
      const rate = part.rate || 2;
      for (let bar = from; bar < to; bar += 1) {
        const tones = arpTones(env.chordAt(bar), part.low || 60);
        for (let s = 0; s < STEPS; s += rate) {
          const k = ((bar - from) * STEPS + s) / rate;
          env.push(part.inst, bar * STEPS + s, part.len || rate, tones[part.seq[k % part.seq.length] % tones.length], part.vel);
        }
      }
    },
    melody(part, from, to, env) {
      const notes = parseMelody(part.notes);
      const end = to * STEPS;
      for (let step = from * STEPS, k = 0; step < end; k += 1) {
        const n = notes[k % notes.length];
        if (n.m != null) env.push(part.inst, step, Math.min(n.len, end - step), n.m, part.vel);
        step += n.len;
      }
    },
    drums(part, from, to, env) {
      LANES.filter((lane) => part[lane]).forEach((lane) => {
        const pat = clean(part[lane]);
        for (let s = from * STEPS; s < to * STEPS; s += 1) {
          const vel = HIT_VEL[pat[(s - from * STEPS) % pat.length]];
          if (vel) env.push(lane, s, 1, 0, vel * (part.vel || 1), part.kit);
        }
      });
    },
    tex(part, from, to, env) {
      env.push(part.inst, from * STEPS, (to - from) * STEPS, 60, part.vel);
    },
  };

  function compile(def) {
    const stepSec = 60 / def.bpm / 4;
    const rnd = seeded(def.id);
    const human = def.human || 0;
    const timeOf = (s) => (s + (s % 2 ? def.swing || 0 : 0)) * stepSec;
    const events = [];
    const env = {
      chordAt: (bar) => chordOf(def.prog[bar % def.prog.length]),
      push(inst, step, len, midi, vel, kit) {
        const t = Math.max(0, timeOf(step) + (rnd() - 0.5) * human * 0.02);
        const d = Math.max(0.03, timeOf(step + len) - timeOf(step) - 0.01);
        events.push({ i: inst, t, d, m: midi, v: (vel || 0.6) * (1 - human * rnd() * 0.3), k: kit });
      },
    };
    def.parts.forEach((part) => spans(part).forEach(([from, to]) => GEN[part.type](part, from, Math.min(to, def.bars), env)));
    events.sort((a, b) => a.t - b.t);
    return { id: def.id, events, duration: def.bars * STEPS * stepSec };
  }

  // ---- Audio graph ---------------------------------------------------------------------

  let ctx = null;
  let nodes = null; // master chain, shared buffers and waves
  let session = null; // one playback run: its gains, channels, sources and clock origin
  let song = null; // compiled current song
  let offset = 0; // paused position in seconds
  let volume = 0.8;
  let muted = false;
  let endHandler = null;
  const compiled = new Map();

  function buffer(seconds, channels, fill) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(channels, len, ctx.sampleRate);
    for (let c = 0; c < channels; c += 1) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i += 1) data[i] = fill(i, len);
    }
    return buf;
  }

  // A short repeating noise pattern: the metallic hiss of an 8-bit console.
  function metalNoise() {
    const pattern = Array.from({ length: 93 }, () => (Math.random() < 0.5 ? -1 : 1));
    return buffer(1, 1, (i) => pattern[Math.floor(i / 6) % pattern.length] * 0.8);
  }

  function pulseWave(duty) {
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k += 1) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ctx.createPeriodicWave(real, imag);
  }

  function makeGain(value, dest) {
    const g = ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  function build() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    ctx = new AudioCtx();
    const mute = makeGain(muted ? 0 : 1, ctx.destination);
    const vol = makeGain(volume * volume * MASTER_GAIN, mute);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    comp.connect(vol);
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 10500;
    warmth.Q.value = 0.5;
    warmth.connect(comp);
    const dry = makeGain(1, warmth);
    const reverb = ctx.createConvolver();
    reverb.buffer = buffer(IR_SECONDS, 2, (i, len) => (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2));
    reverb.connect(makeGain(0.55, warmth));
    nodes = {
      mute, vol, dry, reverb,
      white: buffer(1, 1, () => Math.random() * 2 - 1),
      metal: metalNoise(),
      crackle: buffer(3, 1, () => (Math.random() < 0.0007 ? Math.random() * 2 - 1 : (Math.random() * 2 - 1) * 0.012)),
      p125: pulseWave(0.125),
      p25: pulseWave(0.25),
    };
    return true;
  }

  function ensure() {
    if (!ctx && !build()) return false;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return true;
  }

  // ---- Voices --------------------------------------------------------------------------

  function keep(src, t, end, skip) {
    const live = session.sources;
    src.start(t, skip || 0);
    src.stop(end);
    live.add(src);
    src.onended = () => {
      live.delete(src);
      src.disconnect();
    };
    return src;
  }

  function osc(wave, f, t, end, dest, detune) {
    const o = ctx.createOscillator();
    if (typeof wave === 'string') o.type = wave;
    else o.setPeriodicWave(wave);
    o.frequency.value = f;
    if (detune) o.detune.value = detune;
    o.connect(dest);
    return keep(o, t, end);
  }

  function lowpass(cutoff, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  // Linear attack, exponential decay to sustain, exponential release after the note.
  function adsr(t, dur, e, peak, dest) {
    const g = makeGain(0, dest);
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + e.a);
    p.setTargetAtTime(peak * e.s, t + e.a, e.d / 3);
    const off = t + Math.max(dur, e.a);
    p.setTargetAtTime(0, off, e.r / 3);
    return { g, end: off + e.r * 1.5 };
  }

  function vibrato(o, t, end, rate, cents) {
    const depth = makeGain(0, o.detune);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(cents, t + 0.3);
    osc('sine', rate, t, end, depth);
  }

  // Frequency modulation: a decaying modulator gives electric-piano tines and bells.
  function fm(car, ratio, f, t, end, from, to, tau) {
    const index = makeGain(f * from, car.frequency);
    index.gain.setTargetAtTime(f * to, t, tau);
    osc('sine', f * ratio, t, end, index);
  }

  const INST = {
    ep(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.006, d: 1.2, s: 0.3, r: 0.4 }, 0.2 * v, out);
      fm(osc('sine', f, t, e.end, e.g), 1, f, t, e.end, 1.4, 0.12, 0.25);
    },
    piano(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.004, d: 1.8, s: 0.12, r: 0.6 }, 0.16 * v, out);
      const tone = lowpass(f * 7, 0.3, e.g);
      tone.frequency.setTargetAtTime(f * 2.5, t, 0.5);
      osc('triangle', f, t, e.end, tone);
      osc('triangle', f, t, e.end, tone, 5);
      osc('sine', f * 2, t, e.end, makeGain(0.25, tone));
    },
    pad(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.7, d: 1.2, s: 0.8, r: 1.4 }, 0.05 * v, out);
      const tone = lowpass(1100, 0.6, e.g);
      osc('sawtooth', f, t, e.end, tone, -9);
      osc('sawtooth', f, t, e.end, tone, 9);
    },
    glass(t, f, d, v, out) {
      const e = adsr(t, d, { a: 1.8, d: 2, s: 0.85, r: 2.8 }, 0.07 * v, out);
      osc('sine', f, t, e.end, e.g, -4);
      osc('sine', f, t, e.end, e.g, 5);
      osc('triangle', f * 2, t, e.end, makeGain(0.18, e.g));
    },
    sub(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.012, d: 0.4, s: 0.75, r: 0.15 }, 0.34 * v, out);
      osc('sine', f, t, e.end, e.g);
      osc('triangle', f, t, e.end, makeGain(0.25, e.g));
    },
    synbass(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.004, d: 0.22, s: 0.55, r: 0.08 }, 0.2 * v, out);
      const tone = lowpass(f * 9, 2, e.g);
      tone.frequency.setTargetAtTime(f * 2, t, 0.07);
      osc('sawtooth', f, t, e.end, tone);
      osc('square', f / 2, t, e.end, makeGain(0.4, tone));
    },
    chipbass(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.002, d: 0.1, s: 0.9, r: 0.02 }, 0.3 * v, out);
      osc('triangle', f, t, e.end, e.g);
    },
    pulse(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.002, d: 0.12, s: 0.7, r: 0.04 }, 0.085 * v, out);
      vibrato(osc(nodes.p25, f, t, e.end, e.g), t + 0.18, e.end, 5.5, 14);
    },
    chiparp(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.001, d: 0.07, s: 0.35, r: 0.02 }, 0.06 * v, out);
      osc(nodes.p125, f, t, e.end, e.g);
    },
    lead(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.012, d: 0.3, s: 0.65, r: 0.18 }, 0.065 * v, out);
      const tone = lowpass(2600, 1.4, e.g);
      vibrato(osc('sawtooth', f, t, e.end, tone, -7), t + 0.25, e.end, 5, 8);
      osc('sawtooth', f, t, e.end, tone, 7);
      osc('square', f / 2, t, e.end, makeGain(0.3, tone));
    },
    pluck(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.002, d: 0.3, s: 0, r: 0.12 }, 0.11 * v, out);
      const tone = lowpass(f * 10, 1.5, e.g);
      tone.frequency.setTargetAtTime(f * 1.3, t, 0.06);
      osc('sawtooth', f, t, e.end, tone);
      osc('square', f, t, e.end, makeGain(0.25, tone), 6);
    },
    bell(t, f, d, v, out) {
      const e = adsr(t, d, { a: 0.003, d: 2.2, s: 0, r: 1.2 }, 0.065 * v, out);
      fm(osc('sine', f, t, e.end, e.g), 3.5, f, t, e.end, 2, 0, 0.5);
    },
    vinyl(t, f, d, v, out) {
      loopNoise(nodes.crackle, t, d, 0.5 * v, 'highpass', 900, out);
    },
    rain(t, f, d, v, out) {
      loopNoise(nodes.white, t, d, 0.03 * v, 'bandpass', 2400, out);
    },
  };

  function noiseHit(t, buf, type, cutoff, q, decay, peak, out) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    filter.Q.value = q;
    const g = makeGain(0, out);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter).connect(g);
    keep(src, t, t + decay + 0.03, Math.random() * 0.5);
  }

  function loopNoise(buf, t, d, peak, type, cutoff, out) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const g = makeGain(0, out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 1.5);
    g.gain.setValueAtTime(peak, t + Math.max(1.5, d - 1.5));
    g.gain.linearRampToValueAtTime(0, t + d);
    src.connect(filter).connect(g);
    keep(src, t, t + d + 0.05);
  }

  // Pitched drop: kick drums and tom-like snare bodies.
  function drop(t, type, f0, f1, sweep, decay, peak, out) {
    const g = makeGain(0, out);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const o = osc(type, f0, t, t + decay + 0.02, g);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  }

  const DRUMS = {
    kick(t, v, kit, out) {
      if (kit === 'chip') return drop(t, 'square', 260, 50, 0.05, 0.12, 0.22 * v, out);
      drop(t, 'sine', kit === 'lofi' ? 115 : 150, 42, 0.1, 0.38, 0.9 * v, out);
      if (kit === 'pop') noiseHit(t, nodes.white, 'highpass', 3000, 0.7, 0.015, 0.2 * v, out);
    },
    snare(t, v, kit, out) {
      if (kit === 'chip') return noiseHit(t, nodes.metal, 'highpass', 1200, 0.5, 0.12, 0.22 * v, out);
      const lofi = kit === 'lofi';
      noiseHit(t, nodes.white, lofi ? 'lowpass' : 'bandpass', lofi ? 3500 : 1900, lofi ? 0.5 : 0.8, lofi ? 0.2 : 0.17, 0.4 * v, out);
      drop(t, 'triangle', 200, 160, 0.05, 0.09, 0.3 * v, out);
    },
    clap(t, v, kit, out) {
      [0, 0.012, 0.024].forEach((dt, i) => noiseHit(t + dt, nodes.white, 'bandpass', 1500, 1.2, i === 2 ? 0.16 : 0.02, 0.3 * v, out));
    },
    hat(t, v, kit, out) {
      noiseHit(t, kit === 'chip' ? nodes.metal : nodes.white, 'highpass', kit === 'lofi' ? 6500 : 8000, 0.6, 0.04, 0.13 * v, out);
    },
    ohat(t, v, kit, out) {
      noiseHit(t, kit === 'chip' ? nodes.metal : nodes.white, 'highpass', 7500, 0.6, 0.26, 0.09 * v, out);
    },
    shaker(t, v, kit, out) {
      noiseHit(t, nodes.white, 'bandpass', 6000, 1.5, 0.06, 0.08 * v, out);
    },
  };

  // Per-instrument channel: level, stereo position and reverb send.
  const MIX = {
    ep: { pan: -0.15, send: 0.25 }, piano: { send: 0.32 }, pad: { send: 0.45 }, glass: { send: 0.6 },
    sub: {}, synbass: { send: 0.05 }, chipbass: { send: 0.05 }, pulse: { pan: 0.1, send: 0.15 },
    chiparp: { pan: -0.25, send: 0.2 }, lead: { pan: 0.12, send: 0.3 }, pluck: { pan: -0.2, send: 0.35 },
    bell: { pan: 0.25, send: 0.6 }, kick: {}, snare: { send: 0.12 }, clap: { send: 0.15 },
    hat: { pan: 0.18, send: 0.05 }, ohat: { pan: 0.18, send: 0.08 }, shaker: { pan: -0.3, send: 0.1 },
    vinyl: {}, rain: { send: 0.1 },
  };

  function channel(name) {
    if (session.channels[name]) return session.channels[name];
    const mix = MIX[name] || {};
    const input = makeGain(1);
    let tail = input;
    if (mix.pan && ctx.createStereoPanner) {
      tail = ctx.createStereoPanner();
      tail.pan.value = mix.pan;
      input.connect(tail);
    }
    tail.connect(session.out);
    if (mix.send) tail.connect(makeGain(mix.send, session.send));
    session.channels[name] = input;
    return input;
  }

  function strike(ev, t, dur) {
    const out = channel(ev.i);
    if (DRUMS[ev.i]) DRUMS[ev.i](t, ev.v, ev.k, out);
    else if (INST[ev.i]) INST[ev.i](t, freq(ev.m), dur, ev.v, out);
  }

  // ---- Transport -----------------------------------------------------------------------

  function firstIndexAt(sec) {
    const ev = song.events;
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].t < sec) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function tick() {
    if (!session) return;
    const now = ctx.currentTime;
    const horizon = now + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    const ev = song.events;
    while (session.idx < ev.length && session.start + ev[session.idx].t < horizon) {
      const e = ev[session.idx];
      strike(e, Math.max(now, session.start + e.t), e.d);
      session.idx += 1;
    }
    if (now - session.start >= song.duration + END_TAIL) finish();
  }

  function fadeGain(param, to, at) {
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
    param.linearRampToValueAtTime(to, at + FADE);
  }

  function startSession(from) {
    const now = ctx.currentTime + START_DELAY;
    const out = makeGain(0, nodes.dry);
    const send = makeGain(0, nodes.reverb);
    fadeGain(out.gain, 1, now - START_DELAY);
    fadeGain(send.gain, 1, now - START_DELAY);
    session = { out, send, sources: new Set(), channels: {}, start: now - from, idx: firstIndexAt(from), timer: 0 };
    // Re-strike pads and textures that a seek landed in the middle of.
    song.events.slice(0, session.idx).forEach((e) => {
      if (e.d >= CARRY_MIN && e.t + e.d > from + 0.25) strike(e, now, e.t + e.d - from);
    });
    session.timer = setInterval(tick, TICK_MS);
    tick();
  }

  function endSession() {
    if (!session) return;
    const old = session;
    session = null;
    clearInterval(old.timer);
    const now = ctx.currentTime;
    fadeGain(old.out.gain, 0, now);
    fadeGain(old.send.gain, 0, now);
    setTimeout(() => {
      old.sources.forEach((src) => {
        try {
          src.stop();
        } catch (err) {
          /* already stopped */
        }
      });
      old.out.disconnect();
      old.send.disconnect();
    }, KILL_MS);
  }

  function finish() {
    endSession();
    offset = 0;
    if (endHandler) endHandler();
  }

  function position() {
    if (!song) return 0;
    if (!session) return offset;
    return Math.min(song.duration, Math.max(0, ctx.currentTime - session.start));
  }

  function load(id) {
    const def = SONGS.find((s) => s.id === id);
    if (!def) return null;
    endSession();
    if (!compiled.has(id)) compiled.set(id, compile(def));
    song = compiled.get(id);
    offset = 0;
    return { id, duration: song.duration };
  }

  function play(from) {
    if (!song || !ensure()) return false;
    endSession();
    offset = Math.min(Math.max(0, from == null ? offset : from), song.duration);
    startSession(offset);
    return true;
  }

  function pause() {
    offset = position();
    endSession();
  }

  function seek(sec) {
    if (!song) return;
    offset = Math.min(Math.max(0, sec), song.duration);
    if (session) {
      endSession();
      startSession(offset);
    }
  }

  function applyLevels() {
    if (!ctx) return;
    nodes.vol.gain.setTargetAtTime(volume * volume * MASTER_GAIN, ctx.currentTime, 0.03);
    nodes.mute.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
  }

  function release() {
    endSession();
    offset = 0;
    if (!ctx) return;
    const old = ctx;
    ctx = null;
    nodes = null;
    setTimeout(() => old.close().catch(() => {}), KILL_MS * 2);
  }

  function duration(id) {
    const def = SONGS.find((s) => s.id === id);
    return def ? (def.bars * STEPS * 60) / def.bpm / 4 : 0;
  }

  // ---- Songs (original compositions) ---------------------------------------------------
  // Rhythm strings are sixteenth-note grids: x hit, - hold, . rest. Bass: x root, o octave,
  // f fifth, t third. Drums: X accent, x hit, g ghost. Melody tokens are NOTE:sixteenths.

  const SONGS = [
    {
      id: 'rainy-window', bpm: 78, bars: 32, swing: 0.18, human: 0.6,
      prog: ['Ebmaj7', 'Dm7', 'Cm9', 'F9'],
      parts: [
        { type: 'tex', inst: 'rain', at: [0, 32], vel: 0.9 },
        { type: 'tex', inst: 'vinyl', at: [0, 32], vel: 0.8 },
        { type: 'chords', inst: 'ep', at: [0, 32], center: 62, vel: 0.55, rhythm: 'x---------.x----' },
        { type: 'bass', inst: 'sub', at: [4, 31], vel: 0.8, rhythm: 'x-----x---x--f--' },
        { type: 'drums', kit: 'lofi', at: [[4, 16], [17, 30]], vel: 0.8,
          kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.g.x.g.x.g.x.gx' },
        { type: 'melody', inst: 'ep', at: [[8, 16], [20, 28]], vel: 0.75,
          notes: 'G5:3 F5:1 D5:4 Bb4:2 C5:2 D5:4 | C5:2 D5:2 F5:4 A4:6 .:2 | G5:2 Bb5:2 A5:2 G5:2 Eb5:4 D5:4 | C5:3 D5:1 Eb5:2 F5:2 .:8' },
        { type: 'arp', inst: 'pluck', at: [16, 24], low: 62, rate: 2, seq: [0, 1, 2, 3, 2, 1, 3, 4], vel: 0.35 },
      ],
    },
    {
      id: 'tea-steam', bpm: 84, bars: 24, swing: 0.2, human: 0.5,
      prog: ['Cmaj9', 'Bm7', 'Am9', 'D9'],
      parts: [
        { type: 'tex', inst: 'vinyl', at: [0, 24], vel: 1 },
        { type: 'chords', inst: 'ep', at: [0, 24], center: 64, vel: 0.5, rhythm: '..x-..x-...x-...' },
        { type: 'bass', inst: 'sub', at: [2, 23], vel: 0.8, rhythm: 'x---..x-..x-f-..' },
        { type: 'drums', kit: 'lofi', at: [[2, 12], [13, 22]], vel: 0.75,
          kick: 'x.......x.x.....', snare: '....x..g....x...', hat: 'x.x.x.x.x.x.x.x.', shaker: '..x...x...x...x.' },
        { type: 'melody', inst: 'bell', at: [[4, 12], [16, 22]], vel: 0.8,
          notes: 'B5:2 .:2 G5:2 E5:2 D5:4 E5:4 | F#5:6 D5:2 .:4 A4:4 | B4:2 C5:2 E5:4 G5:4 E5:4 | F#5:8 E5:2 D5:2 .:4' },
      ],
    },
    {
      id: 'late-trains', bpm: 66, bars: 24,
      prog: ['Am', 'F', 'C', 'G', 'Am', 'Dm', 'Esus4', 'E', 'F', 'G', 'Am', 'Am'],
      parts: [
        { type: 'arp', inst: 'piano', at: [0, 23], low: 40, rate: 2, len: 4, seq: [0, 2, 3, 4, 5, 4, 3, 2], vel: 0.42 },
        { type: 'chords', inst: 'piano', at: [23, 24], center: 57, vel: 0.45, rhythm: 'x---------------' },
        { type: 'melody', inst: 'piano', at: [[4, 12], [16, 24]], vel: 0.8,
          notes: 'E5:6 D5:2 C5:4 B4:4 | A4:6 D5:2 F5:4 E5:4 | D5:4 B4:4 A4:8 | G#4:8 B4:4 E5:4 | A5:6 G5:2 F5:4 C5:4 | D5:6 E5:2 F5:4 D5:4 | E5:16 | C5:4 B4:4 A4:8' },
        { type: 'melody', inst: 'piano', at: [12, 16], vel: 0.6, notes: 'A5:8 G5:8 | F5:8 E5:8 | G5:8 E5:8 | D5:16' },
        { type: 'chords', inst: 'glass', at: [16, 24], center: 60, vel: 0.35, rhythm: 'x---------------' },
      ],
    },
    {
      id: 'coin-rush', bpm: 150, bars: 41,
      prog: ['C', 'Em', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
      parts: [
        { type: 'bass', inst: 'chipbass', at: [0, 41], low: 36, vel: 0.9, rhythm: 'x.o.f.o.x.o.f.o.' },
        { type: 'drums', kit: 'chip', at: [4, 40], kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
        { type: 'arp', inst: 'chiparp', at: [8, 40], low: 60, rate: 1, seq: [0, 1, 2, 3], vel: 0.55 },
        { type: 'melody', inst: 'pulse', at: [[8, 24], [32, 40]], vel: 0.8,
          notes: 'E5:2 G5:2 C6:2 G5:2 E5:2 G5:2 C6:4 | B5:2 G5:2 E5:2 G5:2 B5:4 .:4 | A5:2 C6:2 A5:2 F5:2 A5:4 G5:4 | D6:4 B5:2 G5:2 D5:4 .:4 | E5:2 G5:2 C6:2 E6:2 D6:2 C6:2 G5:4 | A5:4 E5:2 A5:2 C6:4 B5:4 | A5:2 F5:2 D5:2 F5:2 A5:2 D6:2 C6:4 | B5:4 G5:4 D6:8' },
        { type: 'melody', inst: 'pulse', at: [24, 32], vel: 0.75,
          notes: 'C5:1 .:1 C5:1 .:1 E5:2 G5:2 .:2 G5:2 E5:4 | D5:2 E5:2 G5:4 B4:4 .:4 | F5:1 .:1 F5:1 .:1 A5:2 C6:2 .:2 C6:2 A5:4 | G5:2 F5:2 D5:4 B4:8 | C5:1 .:1 C5:1 .:1 E5:2 G5:2 .:2 G5:2 E5:4 | E5:2 C5:2 A4:4 C5:4 E5:4 | F5:2 E5:2 D5:2 C5:2 D5:4 F5:4 | B5:2 A5:2 G5:4 .:8' },
        { type: 'chords', inst: 'pulse', at: [40, 41], center: 70, vel: 0.7, rhythm: 'x-------........' },
      ],
    },
    {
      id: 'neon-commute', bpm: 118, bars: 49,
      prog: ['Dm', 'Bbmaj7', 'F', 'C', 'Dm', 'Bbmaj7', 'Gm7', 'A'],
      parts: [
        { type: 'chords', inst: 'pad', at: [0, 49], center: 62, vel: 0.6, rhythm: 'x---------------' },
        { type: 'bass', inst: 'synbass', at: [4, 49], low: 38, vel: 0.85, rhythm: 'x.x.o.x.x.x.o.x.' },
        { type: 'drums', kit: 'pop', at: [[8, 24], [25, 40], [41, 48]],
          kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x...x...x...x.' },
        { type: 'arp', inst: 'pluck', at: [8, 48], low: 57, rate: 2, seq: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.45 },
        { type: 'melody', inst: 'lead', at: [[16, 32], [40, 48]], vel: 0.85,
          notes: 'A4:2 D5:2 F5:2 A5:4 G5:2 F5:4 | D5:6 F5:2 A5:4 F5:4 | C6:4 A5:2 F5:2 C5:4 F5:4 | E5:6 G5:2 E5:4 C5:4 | D5:2 F5:2 A5:2 D6:4 C6:2 A5:4 | Bb5:4 A5:4 F5:4 D5:4 | G5:2 Bb5:2 D6:4 C6:2 Bb5:2 A5:4 | C#6:8 E5:4 A5:4' },
        { type: 'chords', inst: 'lead', at: [48, 49], center: 69, vel: 0.6, rhythm: 'x-----------....' },
      ],
    },
    {
      id: 'save-point', bpm: 112, bars: 33,
      prog: ['Eb', 'Cm', 'Ab', 'Bb'],
      parts: [
        { type: 'bass', inst: 'chipbass', at: [0, 33], low: 39, vel: 0.9, rhythm: 'x---o---x---f---' },
        { type: 'arp', inst: 'chiparp', at: [0, 32], low: 63, rate: 1, seq: [0, 2, 1, 2], vel: 0.5 },
        { type: 'drums', kit: 'chip', at: [8, 30], kick: 'x.......x.......', snare: '........x.......', hat: '..x...x...x...x.' },
        { type: 'melody', inst: 'pulse', at: [[4, 12], [20, 28]], vel: 0.8,
          notes: 'G5:4 Bb5:4 Eb6:6 D6:2 | C6:4 G5:4 Eb5:8 | F5:2 G5:2 Ab5:4 C6:4 Ab5:4 | Bb5:12 .:4 | G5:4 Bb5:4 Eb6:4 F6:4 | G6:6 F6:2 Eb6:4 C6:4 | Eb6:4 C6:4 Ab5:4 C6:4 | D6:8 Bb5:4 F5:4' },
        { type: 'melody', inst: 'pulse', at: [12, 20], vel: 0.7,
          notes: '.:2 Eb5:2 .:2 G5:2 Bb5:4 G5:4 | .:2 C5:2 .:2 Eb5:2 G5:4 Eb5:4 | .:2 Ab4:2 .:2 C5:2 Eb5:4 F5:4 | D5:4 F5:4 Bb5:8' },
        { type: 'chords', inst: 'pulse', at: [32, 33], center: 70, vel: 0.7, rhythm: 'x-----------....' },
      ],
    },
    {
      id: 'aurora', bpm: 60, bars: 24,
      prog: ['Dmaj9', 'Dmaj9', 'Bm9', 'Bm9', 'Gmaj9', 'Gmaj9', 'Asus2', 'Asus2'],
      parts: [
        { type: 'chords', inst: 'glass', at: [0, 24], center: 62, vel: 0.8, rhythm: 'x-------------------------------' },
        { type: 'bass', inst: 'sub', at: [8, 24], low: 38, vel: 0.45, rhythm: 'x-------------------------------' },
        { type: 'melody', inst: 'bell', at: [4, 24], vel: 0.75,
          notes: 'B5:4 .:4 D6:4 F#6:4 | .:4 A5:12 | E6:8 B5:8 | .:16 | F#6:4 .:4 A5:4 .:4 | .:8 E6:4 C#6:4 | D6:6 .:2 F#5:8 | .:16' },
        { type: 'arp', inst: 'bell', at: [12, 20], low: 62, rate: 4, seq: [0, 2, 4, 3, 1, 4, 2, 5], vel: 0.3 },
      ],
    },
    {
      id: 'liquid-glass', bpm: 90, bars: 32,
      prog: ['C#m9', 'C#m9', 'Amaj9', 'Amaj9', 'Emaj9', 'Emaj9', 'Bsus4', 'B'],
      parts: [
        { type: 'chords', inst: 'glass', at: [0, 32], center: 64, vel: 0.65, rhythm: 'x-------------------------------' },
        { type: 'bass', inst: 'sub', at: [4, 32], low: 37, vel: 0.55, rhythm: 'x-------------------------------' },
        { type: 'arp', inst: 'pluck', at: [4, 32], low: 61, rate: 1, seq: [0, 2, 4, 1, 3, 5, 2, 4], vel: 0.3 },
        { type: 'drums', kit: 'lofi', at: [12, 28], vel: 0.55, kick: 'x.......x.......', shaker: '..x...x...x...xx' },
        { type: 'melody', inst: 'bell', at: [12, 28], vel: 0.85,
          notes: 'F#5:4 G#5:4 B5:8 | D#6:12 .:4 | E6:8 F#6:8 | D#6:16 | G#5:6 B5:2 D#6:8 | C#6:4 B5:4 G#5:8 | E6:6 C#6:2 B5:8 | A5:4 G#5:4 E5:8' },
      ],
    },
    {
      id: 'last-light', bpm: 70, bars: 25,
      prog: ['Fmaj7', 'C', 'Dm7', 'Bb', 'Fmaj7', 'C', 'Bbmaj7', 'Csus4'],
      parts: [
        { type: 'chords', inst: 'piano', at: [0, 25], center: 57, vel: 0.3, rhythm: 'x---x---x---x---' },
        { type: 'bass', inst: 'piano', at: [0, 25], low: 41, vel: 0.5, rhythm: 'x-------f-------' },
        { type: 'chords', inst: 'pad', at: [8, 25], center: 62, vel: 0.4, rhythm: 'x---------------' },
        { type: 'melody', inst: 'piano', at: [8, 24], vel: 0.8,
          notes: 'C5:4 A4:4 E5:6 F5:2 | G5:8 E5:4 C5:4 | F5:6 E5:2 D5:4 A4:4 | Bb4:8 D5:4 F5:4 | A5:6 G5:2 F5:4 E5:4 | G5:4 E5:4 C5:8 | D5:4 F5:4 A5:6 G5:2 | F5:8 G5:8' },
        { type: 'melody', inst: 'piano', at: [24, 25], vel: 0.7, notes: 'A5:16' },
      ],
    },
  ];

  window.MacMusicEngine = Object.freeze({
    load,
    play,
    pause,
    seek,
    release,
    position,
    duration,
    isPlaying: () => Boolean(session),
    supported: () => Boolean(window.AudioContext || window.webkitAudioContext),
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      applyLevels();
    },
    setMuted(value) {
      muted = Boolean(value);
      applyLevels();
    },
    onEnd(fn) {
      endHandler = fn;
    },
  });
})();
