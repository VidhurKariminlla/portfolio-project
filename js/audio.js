/* Sound cues, synthesised at runtime with Web Audio. No audio files. -> window.MacAudio
   Browsers block audio until a gesture, so play() is a no-op until unlock() runs. */
(function () {
  'use strict';

  const { readStore, writeStore } = window.MacDOM;
  const MUTE_KEY = 'vos.muted';
  const MASTER_GAIN = 0.5;

  let ctx = null;
  let master = null;
  let unlocked = false; // true once a real user gesture has run unlock()
  let muted = readStore('localStorage', MUTE_KEY) === '1';

  function unlock() {
    unlocked = true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // One oscillator with an exponential bell envelope.
  function voice(freq, t0, { dur = 1, peak = 0.2, attack = 0.01, type = 'sine', detune = 0, dest = master } = {}) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return osc;
  }

  // Fundamental plus a detuned octave and a quiet fifth: stops it sounding like a test tone.
  function bell(freq, t0, opts) {
    voice(freq, t0, opts);
    voice(freq * 2, t0, { ...opts, peak: opts.peak * 0.35, detune: 6 });
    voice(freq * 1.5, t0, { ...opts, peak: opts.peak * 0.15, detune: -4 });
  }

  function warmBus(cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.connect(master);
    return filter;
  }

  const CUES = {
    // One lush major chord, struck once, over a low pad.
    startup(t) {
      const bus = warmBus(2600);
      const chord = [174.61, 220.0, 261.63, 349.23]; // F3 A3 C4 F4
      chord.forEach((f) => {
        const opts = { dur: 2.6, peak: 0.07, attack: 0.08, dest: bus };
        voice(f, t, { ...opts, detune: -7 });
        voice(f, t, { ...opts, detune: 7 });
        voice(f * 2, t, { ...opts, peak: 0.018 });
      });
      voice(87.31, t, { dur: 3, peak: 0.09, attack: 0.25, type: 'triangle', dest: bus });
    },
    logoff(t) {
      [349.23, 261.63, 174.61].forEach((f, i) => bell(f, t + i * 0.14, { dur: 0.9, peak: 0.06, attack: 0.02 }));
    },
    open(t) {
      bell(880, t, { dur: 0.12, peak: 0.035, attack: 0.005 });
    },
    close(t) {
      bell(660, t, { dur: 0.1, peak: 0.03, attack: 0.005 });
    },
    // A soft downward swoosh as a window flies into the Dock.
    minimize(t) {
      const osc = voice(760, t, { dur: 0.26, peak: 0.028, attack: 0.02, type: 'triangle' });
      osc.frequency.exponentialRampToValueAtTime(260, t + 0.26);
    },
    menu(t) {
      voice(1400, t, { dur: 0.03, peak: 0.015, attack: 0.002 });
    },
    // Two quick rising partials for a notification banner.
    pop(t) {
      bell(988, t, { dur: 0.18, peak: 0.04, attack: 0.004 });
      bell(1319, t + 0.07, { dur: 0.22, peak: 0.035, attack: 0.004 });
    },
    beep(t) {
      voice(620, t, { dur: 0.14, peak: 0.05, attack: 0.004, type: 'square' });
    },
  };

  function play(name) {
    if (muted || !ctx || !unlocked || !CUES[name]) return;
    if (ctx.state === 'running') {
      CUES[name](ctx.currentTime + 0.01);
      return;
    }
    // Right after unlock() the context may still be resuming; play once it is ready.
    ctx.resume().then(() => CUES[name](ctx.currentTime + 0.01)).catch(() => {});
  }

  function setMuted(value) {
    muted = Boolean(value);
    writeStore('localStorage', MUTE_KEY, muted ? '1' : '0');
    document.dispatchEvent(new CustomEvent('mac:sound', { detail: { muted } }));
  }

  // Repeat visits skip the boot click, so unlock on whatever the first gesture is.
  ['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, unlock, { once: true, capture: true }));

  window.MacAudio = Object.freeze({
    unlock,
    play,
    isMuted: () => muted,
    setMuted,
    toggle: () => setMuted(!muted),
  });
})();
