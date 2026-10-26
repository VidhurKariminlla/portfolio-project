/* Start-up: a boot screen with a progress bar, a lock screen with the clock, then a
   sign-in screen. Signing in is the gesture that unlocks sound; the desktop eases in
   with the startup chord. Repeat visits in the same tab go straight to the desktop.
   -> window.MacBoot */
(function () {
  'use strict';

  const { readStore, writeStore } = window.MacDOM;
  const I = window.MacIcons;

  const BOOTED_KEY = 'vos.booted';
  const BOOT_MS = 2200;
  const FADE_MS = 600;
  const WELCOME_DELAY_MS = 1500;
  const RESTART_PAUSE_MS = 900;
  const SHUTDOWN_PAUSE_MS = 600;
  const CLOCK_MS = 10000;
  const NARROW_W = 760;

  let root = null;
  let busy = false; // re-entrancy guard: ignore repeat clicks during a transition
  let timers = [];
  let sleptFrom = null; // the stage to return to on wake, or 'desktop'

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const $ = (sel) => root.querySelector(sel);
  const stageIs = (name) => !root.hidden && root.dataset.stage === name;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  // While a boot screen covers the desktop, nothing underneath may take focus or clicks.
  function setCovered(covered) {
    root.hidden = !covered;
    ['desktop', 'menubar', 'statusbar', 'dock'].forEach((id) => {
      document.getElementById(id).inert = covered;
    });
  }

  function stage(name) {
    setCovered(true);
    root.classList.remove('is-fading');
    root.dataset.stage = name;
  }

  function renderLockClock() {
    const now = new Date();
    $('.lock-date').textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    $('.lock-time').textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
  }

  function openStartupWindows() {
    if (window.innerWidth >= NARROW_W && !window.MacWM.list().length) window.MacApps.projects({ silent: true });
  }

  function reveal(withChime) {
    writeStore('sessionStorage', BOOTED_KEY, '1');
    document.body.classList.add('is-ready');
    if (!withChime) {
      setCovered(false);
      busy = false;
      openStartupWindows();
      return;
    }
    root.classList.add('is-fading'); // the desktop is already rendered underneath
    if (window.MacPrefs.get('startupSound')) window.MacAudio.play('startup');
    later(() => {
      setCovered(false);
      busy = false;
      openStartupWindows();
    }, FADE_MS);
    later(() => window.MacApps.welcome(), WELCOME_DELAY_MS);
  }

  function showLock() {
    clearTimers(); // e.g. a welcome banner still pending from the last sign-in
    stage('lock');
    document.body.classList.remove('is-ready');
    renderLockClock();
    busy = false;
  }

  function showSignIn() {
    window.MacAudio.unlock(); // the first click anywhere is enough to allow sound
    stage('signin');
    $('.lock-login').focus({ preventScroll: true });
  }

  function startUp() {
    stage('boot');
    const bar = $('.boot-bar > span');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth; // restart the transition
    bar.style.transition = `width ${BOOT_MS - 300}ms cubic-bezier(.4,.1,.3,1)`;
    bar.style.width = '100%';
    later(showLock, BOOT_MS);
  }

  function signIn() {
    if (busy || !stageIs('signin')) return;
    busy = true;
    window.MacAudio.unlock();
    reveal(!readStore('sessionStorage', BOOTED_KEY));
  }

  function lock() {
    if (busy) return;
    window.MacMenuBar.close();
    showLock();
  }

  function logOut() {
    if (busy) return;
    window.MacAudio.play('logoff');
    window.MacWM.closeAll(true);
    writeStore('sessionStorage', BOOTED_KEY, null);
    lock();
  }

  function shutDown() {
    if (busy) return;
    busy = true;
    clearTimers();
    window.MacAudio.play('logoff');
    writeStore('sessionStorage', BOOTED_KEY, null);
    later(() => {
      window.MacWM.closeAll(true);
      document.body.classList.remove('is-ready');
      stage('off');
      busy = false;
      $('.boot-power').focus();
    }, SHUTDOWN_PAUSE_MS);
  }

  function restart() {
    if (busy) return;
    busy = true;
    clearTimers();
    window.MacAudio.play('logoff');
    window.MacWM.closeAll(true);
    writeStore('sessionStorage', BOOTED_KEY, null);
    document.body.classList.remove('is-ready');
    stage('blank');
    later(startUp, RESTART_PAUSE_MS);
  }

  function sleep() {
    if (busy) return;
    clearTimers();
    sleptFrom = root.hidden ? 'desktop' : root.dataset.stage;
    stage('sleep');
  }

  function wake() {
    if (!stageIs('sleep')) return;
    if (sleptFrom === 'desktop') setCovered(false);
    else stage(sleptFrom || 'lock');
  }

  function onKey(e) {
    if (stageIs('sleep')) wake();
    else if (stageIs('lock')) showSignIn(); // any key raises the sign-in screen, as on a Mac
    else if (stageIs('signin') && e.key === 'Enter' && !e.target.closest('button')) signIn();
  }

  function init() {
    root = document.getElementById('boot');
    $('.boot-logo').innerHTML = I.glyph('logo', 76);
    $('.lock-avatar').textContent = I.initials();
    $('.lock-name').textContent = window.MacData.profile.name;
    $('.boot-lock').addEventListener('click', showSignIn);
    $('.lock-login').addEventListener('click', signIn);
    const power = { sleep, restart, shutdown: shutDown };
    root.querySelectorAll('[data-power]').forEach((btn) => btn.addEventListener('click', () => power[btn.dataset.power]()));
    $('.boot-power').addEventListener('click', startUp);
    $('.boot-sleep').addEventListener('click', wake);
    document.addEventListener('keydown', onKey);
    setInterval(() => stageIs('lock') && renderLockClock(), CLOCK_MS);

    if (readStore('sessionStorage', BOOTED_KEY) === '1') reveal(false);
    else startUp();
  }

  window.MacBoot = Object.freeze({ init, shutDown, restart, sleep, lock, logOut });
})();
