/* Calculator: a macOS-style basic calculator. Operator precedence (2 + 3 × 4 = 14),
   repeat-equals, percent, sign change, an auto-shrinking display and full keyboard input.
   No eval: arithmetic is explicit, and results are rounded to 15 significant digits so
   float artifacts never show (0.1 + 0.2 = 0.3). -> window.MacCalculator */
(function () {
  'use strict';

  const { h } = window.MacDOM;

  const MAX_DIGITS = 15; // digits a user can type into one number
  const SIG_DIGITS = 15; // precision kept for every result
  const EXP_THRESHOLD = 1e15; // larger results switch to exponent form
  const FLASH_MS = 130;
  const MIN_FONT_PX = 18;

  const OPS = Object.freeze({
    add: { sym: '+', label: 'Add', prec: 1 },
    sub: { sym: '−', label: 'Subtract', prec: 1 },
    mul: { sym: '×', label: 'Multiply', prec: 2 },
    div: { sym: '÷', label: 'Divide', prec: 2 },
  });

  // entry: the number on screen, as typed or computed.
  // tokens: pending expression [n, op, n, op, ...]; always ends with an operator.
  // operand: entry is the operand for the pending operator (false right after an operator).
  // fresh: the next digit replaces entry instead of appending.
  // repeat: { op, operand } replayed by pressing = again.
  const INITIAL = Object.freeze({ entry: '0', tokens: [], operand: true, fresh: true, error: false, repeat: null });

  // ---- Arithmetic ------------------------------------------------------------------

  const tidy = (n) => (Number.isFinite(n) ? Number(n.toPrecision(SIG_DIGITS)) : NaN);

  function apply(a, op, b) {
    if (op === 'add') return tidy(a + b);
    if (op === 'sub') return tidy(a - b);
    if (op === 'mul') return tidy(a * b);
    return b === 0 ? NaN : tidy(a / b);
  }

  // Evaluates [n, op, n, ...] with × and ÷ before + and −.
  function evaluate(list) {
    const terms = [list[0]];
    const addOps = [];
    for (let i = 1; i < list.length; i += 2) {
      const op = list[i];
      if (OPS[op].prec === 2) terms[terms.length - 1] = apply(terms[terms.length - 1], op, list[i + 1]);
      else {
        addOps.push(op);
        terms.push(list[i + 1]);
      }
    }
    return addOps.reduce((acc, op, i) => apply(acc, op, terms[i + 1]), terms[0]);
  }

  // What the display shows after an operator: everything computable so far.
  function partial(tokens) {
    const body = tokens.slice(0, -1);
    const op = tokens[tokens.length - 1];
    if (OPS[op].prec === 1) return evaluate(body);
    let start = body.length - 1;
    while (start > 1 && OPS[body[start - 1]].prec === 2) start -= 2;
    return evaluate(body.slice(start));
  }

  const toNum = (entry) => Number(entry) || 0;

  function toEntry(n) {
    const v = Object.is(n, -0) ? 0 : n;
    if (Math.abs(v) >= EXP_THRESHOLD) return v.toExponential().replace('+', '');
    return String(v);
  }

  const errorState = () => ({ ...INITIAL, entry: '0', error: true });

  // ---- Actions (each returns a new state) ------------------------------------------

  function digit(s, d) {
    const base = s.error ? INITIAL : s;
    if (base.fresh) return { ...base, entry: d, operand: true, fresh: false, error: false };
    if (base.entry.replace(/[-.]/g, '').length >= MAX_DIGITS) return base;
    if (base.entry === '0') return { ...base, entry: d };
    if (base.entry === '-0') return { ...base, entry: `-${d}` };
    return { ...base, entry: base.entry + d };
  }

  function decimal(s) {
    const base = s.error ? INITIAL : s;
    if (base.fresh) return { ...base, entry: '0.', operand: true, fresh: false, error: false };
    if (base.entry.includes('.')) return base;
    return { ...base, entry: `${base.entry}.` };
  }

  function operator(s, op) {
    if (s.error) return s;
    const replacing = s.tokens.length > 0 && !s.operand;
    const tokens = replacing ? [...s.tokens.slice(0, -1), op] : [...s.tokens, toNum(s.entry), op];
    const shown = partial(tokens);
    if (!Number.isFinite(shown)) return errorState();
    return { ...s, tokens, entry: toEntry(shown), operand: false, fresh: true };
  }

  function equals(s) {
    if (s.error) return s;
    const value = toNum(s.entry);
    if (!s.tokens.length) {
      if (!s.repeat) return { ...s, fresh: true };
      return finish(apply(value, s.repeat.op, s.repeat.operand), s.repeat);
    }
    const ops = s.tokens.filter((t, i) => i % 2 === 1);
    return finish(evaluate([...s.tokens, value]), { op: ops[ops.length - 1], operand: value });
  }

  function finish(result, repeat) {
    if (!Number.isFinite(result)) return errorState();
    return { ...INITIAL, entry: toEntry(result), repeat };
  }

  // With a pending + or −, x% means x percent of the left side (200 + 10% → 20).
  function percent(s) {
    if (s.error) return s;
    const x = toNum(s.entry);
    const last = s.tokens[s.tokens.length - 1];
    const base = last && OPS[last].prec === 1 ? evaluate(s.tokens.slice(0, -1)) : 1;
    const v = tidy((base * x) / 100);
    if (!Number.isFinite(v)) return errorState();
    return { ...s, entry: toEntry(v), operand: true, fresh: true };
  }

  function negate(s) {
    if (s.error) return s;
    if (!s.operand) return { ...s, entry: '-0', operand: true, fresh: false };
    const entry = s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}`;
    return { ...s, entry };
  }

  function backspace(s) {
    if (s.error || s.fresh || !s.operand) return s;
    const entry = s.entry.slice(0, -1);
    return { ...s, entry: entry === '' || entry === '-' ? '0' : entry };
  }

  // "C" clears the current number, "AC" clears everything.
  const showsC = (s) => s.error || (s.operand && !s.fresh && s.entry !== '0') || (s.operand && s.fresh && s.tokens.length > 0);

  function clear(s) {
    if (!showsC(s) || s.error) return INITIAL;
    return { ...s, entry: '0', operand: false, fresh: true };
  }

  const ACTIONS = {
    digit, decimal, operator, equals, percent, negate, backspace, clear,
  };

  // ---- Display ---------------------------------------------------------------------

  function format(s) {
    if (s.error) return 'Error';
    const e = s.entry;
    if (/e/i.test(e)) return e;
    const neg = e.startsWith('-');
    const [int, frac] = (neg ? e.slice(1) : e).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${neg ? '-' : ''}${grouped}${frac === undefined ? '' : `.${frac}`}`;
  }

  const spoken = (text) => text.replace(/,/g, '').replace(/^-/, 'minus ');

  // ---- Keypad ----------------------------------------------------------------------

  const KEYS = [
    { id: 'clear', kind: 'fn', action: ['clear'] },
    { id: 'negate', kind: 'fn', text: '±', label: 'Negate', action: ['negate'] },
    { id: 'percent', kind: 'fn', text: '%', label: 'Percent', action: ['percent'] },
    { id: 'op-div', kind: 'op', action: ['operator', 'div'] },
    ...['7', '8', '9'].map(digitKey), { id: 'op-mul', kind: 'op', action: ['operator', 'mul'] },
    ...['4', '5', '6'].map(digitKey), { id: 'op-sub', kind: 'op', action: ['operator', 'sub'] },
    ...['1', '2', '3'].map(digitKey), { id: 'op-add', kind: 'op', action: ['operator', 'add'] },
    { ...digitKey('0'), wide: true },
    { id: 'decimal', kind: 'num', text: '.', label: 'Decimal point', action: ['decimal'] },
    { id: 'equals', kind: 'op', text: '=', label: 'Equals', action: ['equals'] },
  ];

  function digitKey(d) {
    return { id: `digit-${d}`, kind: 'num', text: d, label: d, action: ['digit', d] };
  }

  const KEYMAP = {
    '+': 'op-add', '-': 'op-sub', '*': 'op-mul', x: 'op-mul', X: 'op-mul', '/': 'op-div',
    '=': 'equals', Enter: 'equals', '%': 'percent', '.': 'decimal', ',': 'decimal',
    Escape: 'clear', c: 'clear', C: 'clear', Clear: 'clear', Backspace: 'backspace', Delete: 'backspace',
  };

  // ---- Window state ----------------------------------------------------------------

  let state = INITIAL;
  let ui = null; // { root, display, readout, buttons: Map, win, observer, timers: Set }

  function press(action) {
    const [name, arg] = action;
    state = ACTIONS[name](state, arg);
    paint();
  }

  function flash(id) {
    const btn = ui && ui.buttons.get(id);
    if (!btn) return;
    btn.classList.add('is-pressed');
    const timer = setTimeout(() => {
      btn.classList.remove('is-pressed');
      ui && ui.timers.delete(timer);
    }, FLASH_MS);
    ui.timers.add(timer);
  }

  function paintKeys() {
    const clearBtn = ui.buttons.get('clear');
    const c = showsC(state);
    clearBtn.textContent = c ? 'C' : 'AC';
    clearBtn.setAttribute('aria-label', c ? 'Clear' : 'All Clear');
    const active = state.tokens.length > 0 && !state.operand ? state.tokens[state.tokens.length - 1] : null;
    Object.keys(OPS).forEach((op) => {
      const btn = ui.buttons.get(`op-${op}`);
      btn.classList.toggle('is-active', op === active);
      btn.setAttribute('aria-pressed', String(op === active));
    });
  }

  function paint() {
    if (!ui) return;
    const text = format(state);
    ui.display.textContent = text;
    ui.readout.setAttribute('aria-label', spoken(text));
    paintKeys();
    fit();
  }

  // Shrinks the display font until the number fits, like the real Calculator.
  function fit() {
    const el = ui.display;
    el.style.fontSize = '';
    const pad = getComputedStyle(ui.readout);
    const avail = ui.readout.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const need = el.scrollWidth;
    if (avail <= 0 || need <= avail) return;
    let size = Math.max(MIN_FONT_PX, Math.floor((parseFloat(getComputedStyle(el).fontSize) * avail) / need));
    el.style.fontSize = `${size}px`;
    // Letter spacing and glyph widths don't scale perfectly; nudge down until it fits.
    while (size > MIN_FONT_PX && el.scrollWidth > avail) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }

  function keyButton(key) {
    const isOp = key.kind === 'op' && OPS[key.action[1]];
    const text = isOp ? OPS[key.action[1]].sym : key.text || 'AC';
    const label = isOp ? OPS[key.action[1]].label : key.label || 'All Clear';
    const btn = h('button', {
      class: `calc-key calc-${key.kind}${key.wide ? ' calc-wide' : ''}`,
      type: 'button',
      'aria-label': label,
      'aria-pressed': isOp ? 'false' : null,
      'data-key': key.id,
      onclick: () => press(key.action),
    }, text);
    ui.buttons.set(key.id, btn);
    return btn;
  }

  function copyDisplay() {
    const text = state.error ? 'Error' : format(state).replace(/,/g, '');
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).catch(() => {
      /* Clipboard permission denied: copying is a convenience, nothing else depends on it. */
    });
  }

  function isTypingElsewhere(target) {
    if (!target || !target.closest || ui.win.contains(target)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  // Keys reach the calculator whenever its window is the active one.
  function onKey(e) {
    if (!ui || !ui.win.classList.contains('is-active') || e.defaultPrevented || e.altKey) return;
    const desktop = document.getElementById('desktop');
    if ((desktop && desktop.inert) || isTypingElsewhere(e.target)) return;
    if (e.metaKey || e.ctrlKey) {
      if ((e.key === 'c' || e.key === 'C') && !String(window.getSelection())) copyDisplay();
      return;
    }
    if (e.key === 'Enter' && e.target.closest && e.target.closest('.calc-key')) return; // let Enter press a focused key
    const id = /^[0-9]$/.test(e.key) ? `digit-${e.key}` : KEYMAP[e.key];
    if (!id) return;
    e.preventDefault();
    if (id === 'backspace') press(['backspace']);
    else press(KEYS.find((k) => k.id === id).action);
    flash(id);
  }

  function render(root, api) {
    teardownObserver();
    const display = h('span', { class: 'calc-value' });
    const readout = h('div', { class: 'calc-display', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, display);
    ui = { root: null, display, readout, buttons: new Map(), win: api.el, observer: null, timers: ui ? ui.timers : new Set() };
    const pad = h('div', { class: 'calc-pad', role: 'group', 'aria-label': 'Keypad' }, KEYS.map(keyButton));
    ui.root = h('div', { class: 'calc-app' }, readout, pad);
    root.append(ui.root);
    if (window.ResizeObserver) {
      ui.observer = new ResizeObserver(() => ui && fit());
      ui.observer.observe(readout);
    }
    paint();
    requestAnimationFrame(() => ui && fit());
  }

  function teardownObserver() {
    if (ui && ui.observer) ui.observer.disconnect();
  }

  function onClose() {
    document.removeEventListener('keydown', onKey);
    teardownObserver();
    if (ui) ui.timers.forEach(clearTimeout);
    ui = null;
    state = INITIAL;
  }

  function open() {
    document.addEventListener('keydown', onKey);
    return window.MacWM.open({
      id: 'calculator',
      title: 'Calculator',
      app: 'Calculator',
      icon: 'calculator',
      chrome: 'dialog',
      width: 248,
      height: 'auto',
      onClose,
      view: { title: 'Calculator', render },
    });
  }

  window.MacCalculator = Object.freeze({ open });
})();
