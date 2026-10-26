/* Notes editor: a contenteditable controller for one note. It renders blocks with DOM APIs
   (text nodes, <b>, <i> only), reads them back into the same small structure, keeps
   pasted and dropped content as plain text, and handles Return, checklists and the
   formatting shortcuts. -> window.MacNotesEditor (needs MacNotesStore) */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const S = window.MacNotesStore;

  const CHECK_HIT_PX = 26; // the checkbox circle sits in the block's left padding
  const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

  // ---- Blocks <-> DOM --------------------------------------------------------------

  const isBlockEl = (n) => Boolean(n) && n.nodeType === 1 && n.classList.contains('nt-b');

  function runNode(r) {
    let node = document.createTextNode(r.text);
    if (r.i) node = h('i', {}, node);
    if (r.b) node = h('b', {}, node);
    return node;
  }

  function blockNode(b) {
    const el = h('div', { class: 'nt-b', 'data-type': b.type, 'data-done': b.type === 'check' ? String(b.done) : null });
    if (!S.blockText(b)) el.appendChild(document.createElement('br'));
    else b.runs.forEach((r) => el.appendChild(runNode(r)));
    return el;
  }

  // Formatting comes only from <b>/<strong>/<i>/<em>; every other tag or style is dropped.
  function collectRuns(root) {
    const runs = [];
    const push = (text, b, i) => {
      const last = runs[runs.length - 1];
      if (last && last.b === b && last.i === i) runs[runs.length - 1] = S.makeRun(last.text + text, b, i);
      else runs.push(S.makeRun(text, b, i));
    };
    const walk = (node, b, i) => {
      if (node.nodeType === 3) {
        if (node.nodeValue) push(node.nodeValue.replace(/ /g, ' ').replace(/\n/g, ' '), b, i);
        return;
      }
      if (node.nodeType !== 1) return;
      const nb = b || node.tagName === 'B' || node.tagName === 'STRONG';
      const ni = i || node.tagName === 'I' || node.tagName === 'EM';
      node.childNodes.forEach((c) => walk(c, nb, ni));
    };
    root.childNodes.forEach((c) => walk(c, false, false));
    return runs;
  }

  function readBlocks(ed) {
    const blocks = [...ed.children].filter(isBlockEl).map((el) => {
      const type = S.BLOCK_TYPES.includes(el.dataset.type) ? el.dataset.type : 'body';
      return { type, done: type === 'check' && el.dataset.done === 'true', runs: collectRuns(el) };
    });
    return blocks.length ? blocks : [S.makeBlock('body', '')];
  }

  // Wraps a stray top-level node into a block after an edit; returns the open holder.
  function adopt(ed, node, holder) {
    if (isBlockEl(node)) return null;
    if (node.nodeType === 1 && (node.tagName === 'DIV' || node.tagName === 'P')) {
      node.removeAttribute('style');
      node.classList.add('nt-b');
      if (!S.BLOCK_TYPES.includes(node.dataset.type)) node.dataset.type = 'body';
      return null;
    }
    if (node.nodeType === 3 && !node.nodeValue) {
      node.remove();
      return holder;
    }
    const blk = holder || ed.insertBefore(h('div', { class: 'nt-b', 'data-type': 'body' }), node);
    blk.appendChild(node);
    return blk;
  }

  function normalize(ed) {
    const nodes = [...ed.childNodes];
    if (nodes.length && nodes.every(isBlockEl)) return;
    const sel = window.getSelection();
    const anchor = sel.rangeCount ? sel.anchorNode : null;
    const offset = sel.rangeCount ? sel.anchorOffset : 0;
    nodes.reduce((holder, n) => adopt(ed, n, holder), null);
    if (!ed.firstChild) ed.appendChild(blockNode(S.makeBlock('body', '')));
    if (anchor && anchor !== ed && ed.contains(anchor)) {
      const max = anchor.nodeType === 3 ? anchor.length : anchor.childNodes.length;
      sel.collapse(anchor, Math.min(offset, max));
    }
  }

  function setType(el, type, done) {
    el.classList.add('nt-b');
    el.dataset.type = type;
    if (type === 'check') el.dataset.done = String(Boolean(done));
    else delete el.dataset.done;
  }

  // ---- Selection -------------------------------------------------------------------

  function blockOf(ed, node) {
    let n = node;
    while (n && n !== ed) {
      if (n.parentNode === ed) return isBlockEl(n) ? n : null;
      n = n.parentNode;
    }
    return null;
  }

  function boundaryBlock(ed, container, offset) {
    if (container !== ed) return blockOf(ed, container);
    const kids = ed.childNodes;
    return blockOf(ed, kids[Math.min(offset, kids.length - 1)] || null);
  }

  function selectedBlocks(ed) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const r = sel.getRangeAt(0);
    if (!ed.contains(r.startContainer)) return [];
    const all = [...ed.children].filter(isBlockEl);
    const a = all.indexOf(boundaryBlock(ed, r.startContainer, r.startOffset));
    const b = all.indexOf(boundaryBlock(ed, r.endContainer, r.endOffset));
    return a < 0 ? [] : all.slice(a, Math.max(a, b) + 1);
  }

  const caretBlock = (ed) => selectedBlocks(ed)[0] || null;

  function caretAtStart(blk) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = document.createRange();
    r.selectNodeContents(blk);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    return r.toString().length === 0;
  }

  function selectRange(r) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function caretToPoint(ed, x, y) {
    let r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) {
        r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
      }
    }
    if (!r || !ed.contains(r.startContainer)) return;
    r.collapse(true);
    selectRange(r);
  }

  // ---- Commands --------------------------------------------------------------------

  function exec(cmd) {
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(cmd, false, null);
  }

  function toggleType(ed, type) {
    const blocks = selectedBlocks(ed);
    const on = blocks.length > 0 && blocks.every((b) => b.dataset.type === type);
    blocks.forEach((b) => setType(b, on ? 'body' : type, false));
  }

  function toggleDone(ed) {
    selectedBlocks(ed)
      .filter((b) => b.dataset.type === 'check')
      .forEach((b) => setType(b, 'check', b.dataset.done !== 'true'));
  }

  const COMMANDS = {
    bold: () => exec('bold'),
    italic: () => exec('italic'),
    heading: (ed) => toggleType(ed, 'heading'),
    check: (ed) => toggleType(ed, 'check'),
    done: (ed) => toggleDone(ed),
  };

  // Splits the block at the caret. A new line after a heading is body text, a new line
  // in a checklist is another unticked item, and Return at the start of a line opens an
  // empty line above it.
  function splitAtCaret(ed) {
    const blk = caretBlock(ed);
    const type = blk ? blk.dataset.type : 'body';
    const done = Boolean(blk) && blk.dataset.done === 'true';
    const atStart = Boolean(blk) && Boolean(blk.textContent) && caretAtStart(blk);
    if (!document.execCommand('insertParagraph')) return false;
    normalize(ed);
    const caret = caretBlock(ed);
    const nextType = type === 'check' ? 'check' : 'body';
    if (atStart && caret) {
      const upper = caret.previousElementSibling;
      if (isBlockEl(upper)) setType(upper, nextType, false);
      setType(caret, type, done);
    } else if (caret && caret !== blk) {
      setType(caret, nextType, false);
    }
    return true;
  }

  function insertText(text) {
    if (document.execCommand('insertText', false, text)) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const node = document.createTextNode(text);
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    selectRange(r);
  }

  // Pasted or dropped content always arrives as plain text, one block per line.
  function insertPlain(ctx, text) {
    const lines = String(text).replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').split('\n');
    lines.forEach((line, i) => {
      if (i > 0) splitAtCaret(ctx.ed);
      if (line) insertText(line);
    });
    normalize(ctx.ed);
    changed(ctx);
  }

  // ---- Events ----------------------------------------------------------------------

  function commandState(cmd) {
    try {
      return document.queryCommandState(cmd);
    } catch (err) {
      return false; // unsupported in this browser: report the style as off
    }
  }

  // Remembers the selection (toolbar clicks restore it) and reports formatting state.
  function sync(ctx) {
    const { ed } = ctx;
    const sel = window.getSelection();
    if (sel.rangeCount && ed.contains(sel.anchorNode)) ctx.range = sel.getRangeAt(0).cloneRange();
    const blocks = selectedBlocks(ed);
    const all = (type) => blocks.length > 0 && blocks.every((b) => b.dataset.type === type);
    const styled = blocks.some((b) => b === ed.firstElementChild || b.dataset.type === 'heading');
    ctx.opts.onSelection({
      bold: !styled && commandState('bold'),
      italic: commandState('italic'),
      heading: all('heading'),
      checklist: all('check'),
    });
  }

  function changed(ctx) {
    ctx.opts.onChange();
    sync(ctx);
  }

  function onEnter(ctx, e) {
    const blk = caretBlock(ctx.ed);
    if (!blk) return;
    if (blk.dataset.type === 'check' && !blk.textContent.trim()) {
      e.preventDefault();
      setType(blk, 'body');
      changed(ctx);
      return;
    }
    if (splitAtCaret(ctx.ed)) {
      e.preventDefault();
      changed(ctx);
    }
  }

  function onBackspace(ctx, e) {
    const blk = caretBlock(ctx.ed);
    if (!blk || blk.dataset.type !== 'check' || !caretAtStart(blk)) return;
    e.preventDefault();
    setType(blk, 'body');
    changed(ctx);
  }

  const PLAIN_KEYS = { KeyB: 'bold', KeyI: 'italic' };
  const SHIFT_KEYS = { KeyH: 'heading', KeyL: 'check', KeyU: 'done' };

  function onKey(ctx, e) {
    if (e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !mod) return onEnter(ctx, e);
    if (e.key === 'Backspace' && !mod) return onBackspace(ctx, e);
    if (e.key === 'Escape') {
      e.preventDefault();
      ctx.opts.onEscape();
      return;
    }
    if (!mod || e.altKey) return;
    const cmd = (e.shiftKey ? SHIFT_KEYS : PLAIN_KEYS)[e.code];
    if (!cmd) return;
    e.preventDefault();
    run(ctx, cmd);
  }

  function onCheckPointer(ctx, e) {
    if (e.button !== 0) return;
    const blk = blockOf(ctx.ed, e.target);
    if (!blk || blk.dataset.type !== 'check') return;
    if (e.clientX - blk.getBoundingClientRect().left > CHECK_HIT_PX) return;
    e.preventDefault();
    setType(blk, 'check', blk.dataset.done !== 'true');
    ctx.opts.onChange();
  }

  function onPaste(ctx, e) {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) insertPlain(ctx, text);
  }

  function onDrop(ctx, e) {
    e.preventDefault();
    const text = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (!text) return;
    caretToPoint(ctx.ed, e.clientX, e.clientY);
    insertPlain(ctx, text);
  }

  function run(ctx, cmd) {
    if (ctx.opts.readOnly || !COMMANDS[cmd]) return;
    const sel = window.getSelection();
    const live = sel.rangeCount > 0 && ctx.ed.contains(sel.anchorNode);
    ctx.ed.focus({ preventScroll: true });
    if (!live && ctx.range) selectRange(ctx.range); // focus moved away: restore the last caret
    COMMANDS[cmd](ctx.ed);
    changed(ctx);
  }

  function wire(ctx) {
    const { ed } = ctx;
    ed.addEventListener('input', () => {
      normalize(ed);
      changed(ctx);
    });
    ed.addEventListener('keydown', (e) => onKey(ctx, e));
    ed.addEventListener('paste', (e) => onPaste(ctx, e));
    ed.addEventListener('drop', (e) => onDrop(ctx, e));
    ed.addEventListener('mousedown', (e) => onCheckPointer(ctx, e));
    ['keyup', 'mouseup', 'focus'].forEach((type) => ed.addEventListener(type, () => sync(ctx)));
    ed.addEventListener('blur', () => ctx.opts.onBlur());
  }

  const noop = () => {};

  /**
   * @param {Array} blocks  the note's blocks (already validated by MacNotesStore)
   * @param {{readOnly?:boolean,label?:string,onChange?:Function,onBlur?:Function,onEscape?:Function,onSelection?:Function}} options
   * @returns {{el: HTMLElement, read: () => Array, run: (cmd: string) => void}}
   */
  function create(blocks, options) {
    const opts = { onChange: noop, onBlur: noop, onEscape: noop, onSelection: noop, ...options };
    const ed = h('div', {
      class: 'nt-editor',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': opts.label || 'Note text',
      'aria-readonly': opts.readOnly ? 'true' : null,
      contenteditable: opts.readOnly ? 'false' : 'true',
      spellcheck: 'true',
      'data-fkey': 'nt-editor',
    });
    blocks.forEach((b) => ed.appendChild(blockNode(b)));
    const ctx = { ed, opts, range: null };
    if (!opts.readOnly) {
      wire(ctx);
      document.execCommand('defaultParagraphSeparator', false, 'div');
    }
    return Object.freeze({ el: ed, read: () => readBlocks(ed), run: (cmd) => run(ctx, cmd) });
  }

  window.MacNotesEditor = Object.freeze({ create });
})();
