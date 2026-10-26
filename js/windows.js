/* Window manager: open, focus, drag, resize from any edge, zoom, minimize into the Dock,
   close, and a per-window view stack with Back and Forward. -> window.MacWM

   A view is { title, render(rootEl, api), tools?, onTool?(id, api), toolbar?(api) }.
   api.navigate(view) pushes onto that window's own history. */
(function () {
  'use strict';

  const { h, esc } = window.MacDOM;
  const I = window.MacIcons;

  const MENUBAR_H = 28;
  const NARROW_W = 760; // below this every window fills the screen
  const MIN_W = 340;
  const MIN_H = 220;
  const KEEP_VISIBLE = 90; // px of a dragged window that must stay on screen
  const EDGE_GAP = 12;
  const CASCADE_STEP = 28;
  const CASCADE_SLOTS = 6;
  const OPEN_MS = 220;
  const CLOSE_MS = 160;
  const MINIMIZE_MS = 420;
  const ZOOM_MS = 280;
  const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const INTERACTIVE = 'button, a, input, select, textarea, [data-nodrag]';

  const wins = new Map();
  let layer = null;
  let topZ = 10;
  let cascade = 0;
  let opened = 0;
  let activeId = null;

  const isNarrow = () => window.innerWidth < NARROW_W;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const emit = () => document.dispatchEvent(new CustomEvent('mac:windows'));
  const currentView = (s) => s.history[s.index] || null;
  const resizable = (opts) => opts.resizable !== false && opts.chrome !== 'dialog';

  // The usable screen: between the menu bar (or a phone's status bar) and the Dock.
  function area() {
    const bar = document.getElementById(isNarrow() ? 'statusbar' : 'menubar');
    const top = (bar && bar.offsetHeight) || MENUBAR_H;
    const dock = window.MacDock ? window.MacDock.reserve() : 0;
    return { top, bottom: window.innerHeight - dock, width: window.innerWidth };
  }

  /** Runs a Web Animation and resolves with it (or null when motion is reduced). */
  function play(el, frames, ms, easing) {
    if (reducedMotion() || typeof el.animate !== 'function') return Promise.resolve(null);
    const anim = el.animate(frames, { duration: ms, easing: easing || 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    return anim.finished.then(() => anim, () => anim);
  }

  // Transform that shrinks a window rect onto a Dock target rect.
  function flyTo(from, to) {
    const scale = Math.max(0.05, Math.min(to.width / from.width, to.height / from.height));
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  // ---- Chrome ------------------------------------------------------------------------

  function lightsMarkup(opts) {
    return `<div class="lights" data-nodrag>
      <button class="light light-close" type="button" aria-label="Close window" data-act="close">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/></svg></button>
      <button class="light light-min" type="button" aria-label="Minimize window" data-act="minimize">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.8 6h6.4"/></svg></button>
      <button class="light light-max" type="button" aria-label="Zoom window" data-act="maximize" ${resizable(opts) ? '' : 'disabled'}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 3.4h4L3.4 7.4zM8.6 8.6h-4l4-4z"/></svg></button>
    </div>`;
  }

  function chromeMarkup(opts) {
    const side = Boolean(opts.sidebar);
    const handles = resizable(opts)
      ? RESIZE_DIRS.map((d) => `<span class="rz rz-${d}" data-dir="${d}" aria-hidden="true"></span>`).join('')
      : '';
    return `
      ${side ? `<aside class="win-side"><div class="win-side-head" data-drag>${lightsMarkup(opts)}</div>
        <nav class="win-side-body" aria-label="${esc(opts.title)} sidebar"></nav></aside>` : ''}
      <div class="win-col">
        <header class="win-bar" data-drag>
          ${lightsMarkup(opts)}
          <div class="win-nav" hidden></div>
          <div class="win-title"></div>
          <div class="win-tools"></div>
        </header>
        <div class="win-body" tabindex="-1"><div class="win-content"></div></div>
        ${opts.status ? '<footer class="win-status"><span class="win-status-l"></span><span class="win-status-r"></span></footer>' : ''}
      </div>
      ${handles}`;
  }

  function toolButton(tool, onClick) {
    return h('button', {
      class: `tool${tool.text ? ' has-text' : ''}`,
      type: 'button',
      title: tool.label,
      'aria-label': tool.label,
      'aria-pressed': tool.pressed == null ? null : String(tool.pressed),
      disabled: Boolean(tool.disabled),
      onclick: onClick,
      html: I.glyph(tool.icon, 16) + (tool.text ? `<span>${esc(tool.text)}</span>` : ''),
    });
  }

  function toolsFor(s) {
    const view = currentView(s);
    return [...(s.opts.tools || []), ...((view && view.tools) || [])];
  }

  function renderHeader(s) {
    const view = currentView(s);
    if (s.opts.nav) {
      s.nav.hidden = false;
      s.nav.replaceChildren(
        toolButton({ label: 'Back', icon: 'back', disabled: s.index <= 0 }, () => s.api.back()),
        toolButton({ label: 'Forward', icon: 'forward', disabled: s.index >= s.history.length - 1 }, () => s.api.forward())
      );
    }
    s.tools.replaceChildren();
    const groups = new Map();
    toolsFor(s).forEach((tool) => {
      const btn = toolButton(tool, () => runToolOn(s, tool.id));
      if (!tool.group) {
        s.tools.append(btn);
        return;
      }
      if (!groups.has(tool.group)) {
        const seg = h('div', { class: 'seg', role: 'group', 'aria-label': tool.groupLabel || tool.group });
        groups.set(tool.group, seg);
        s.tools.append(seg);
      }
      groups.get(tool.group).append(btn);
    });
    if (view && view.toolbar) s.tools.append(...[].concat(view.toolbar(s.api)));
  }

  // ---- Geometry ----------------------------------------------------------------------

  function initialRect(opts) {
    const a = area();
    const w = Math.min(opts.width || 720, a.width - EDGE_GAP * 2);
    const availH = a.bottom - a.top - EDGE_GAP * 2;
    const h = opts.height === 'auto' ? 0 : Math.min(opts.height || 480, availH);
    const guessH = h || Math.min(560, availH);
    if (opts.center) {
      return { x: Math.round((a.width - w) / 2), y: a.top + Math.max(EDGE_GAP, Math.round((a.bottom - a.top - guessH) / 3)), w, h };
    }
    const slot = cascade++ % CASCADE_SLOTS;
    return {
      x: Math.round((a.width - w) / 2) - 70 + slot * CASCADE_STEP,
      y: a.top + Math.max(EDGE_GAP, Math.round((a.bottom - a.top - guessH) / 4)) + slot * CASCADE_STEP,
      w,
      h,
    };
  }

  // Shrinks and shifts a rect so the whole window sits inside the usable area.
  function fitRect(r) {
    const a = area();
    const w = Math.min(r.w, a.width - EDGE_GAP * 2);
    const h = r.h ? Math.min(r.h, a.bottom - a.top - EDGE_GAP * 2) : 0;
    const x = Math.min(Math.max(r.x, EDGE_GAP), Math.max(EDGE_GAP, a.width - w - EDGE_GAP));
    const y = Math.min(Math.max(r.y, a.top + EDGE_GAP), Math.max(a.top + EDGE_GAP, a.bottom - (h || 300) - EDGE_GAP));
    return { x, y, w, h };
  }

  function dragClamp(r) {
    const a = area();
    return {
      ...r,
      x: Math.min(Math.max(r.x, KEEP_VISIBLE - r.w), a.width - KEEP_VISIBLE),
      y: Math.min(Math.max(r.y, a.top), a.bottom - 44),
    };
  }

  function applyRect(s) {
    const narrow = isNarrow();
    const full = narrow || s.maximized;
    s.el.classList.toggle('is-narrow', narrow);
    s.el.classList.toggle('is-maximized', !narrow && s.maximized);
    const st = s.el.style;
    if (full) {
      const a = area();
      Object.assign(st, {
        left: '0px', top: `${a.top}px`, width: `${a.width}px`, height: `${a.bottom - a.top}px`, maxHeight: '',
      });
      return;
    }
    const auto = s.opts.height === 'auto';
    Object.assign(st, {
      left: `${s.rect.x}px`,
      top: `${s.rect.y}px`,
      width: `${s.rect.w}px`,
      height: auto ? '' : `${s.rect.h}px`,
      maxHeight: auto ? `${area().bottom - s.rect.y - EDGE_GAP}px` : '',
    });
  }

  function animateGeometry(s) {
    if (reducedMotion()) {
      applyRect(s);
      return;
    }
    s.el.classList.add('is-animating');
    applyRect(s);
    clearTimeout(s.zoomTimer);
    s.zoomTimer = setTimeout(() => s.el.classList.remove('is-animating'), ZOOM_MS + 40);
  }

  // ---- Pointer interaction -----------------------------------------------------------

  function trackPointer(target, e, onMove) {
    target.setPointerCapture(e.pointerId);
    const end = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  function wireDrag(s) {
    s.el.querySelectorAll('[data-drag]').forEach((region) => {
      region.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest(INTERACTIVE) || s.maximized || isNarrow()) return;
        const start = { x: e.clientX, y: e.clientY, left: s.rect.x, top: s.rect.y };
        trackPointer(region, e, (ev) => {
          s.rect = dragClamp({ ...s.rect, x: start.left + ev.clientX - start.x, y: start.top + ev.clientY - start.y });
          applyRect(s);
        });
      });
      // Double-clicking the title bar zooms, as macOS does by default.
      region.addEventListener('dblclick', (e) => {
        if (!e.target.closest(INTERACTIVE)) maximize(s.id);
      });
    });
  }

  function wireResize(s) {
    s.el.querySelectorAll('.rz').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || s.maximized || isNarrow()) return;
        e.preventDefault();
        const dir = handle.dataset.dir;
        const start = { ...s.rect, h: s.rect.h || s.el.offsetHeight, px: e.clientX, py: e.clientY };
        const minW = s.opts.minWidth || MIN_W;
        const minH = s.opts.minHeight || MIN_H;
        trackPointer(handle, e, (ev) => {
          const dx = ev.clientX - start.px;
          const dy = ev.clientY - start.py;
          let { x, y, w } = start;
          let height = start.h;
          if (dir.includes('e')) w = start.w + dx;
          if (dir.includes('s')) height = start.h + dy;
          if (dir.includes('w')) {
            w = start.w - dx;
            x = start.x + dx;
          }
          if (dir.includes('n')) {
            height = start.h - dy;
            y = start.y + dy;
          }
          if (w < minW) {
            if (dir.includes('w')) x -= minW - w;
            w = minW;
          }
          if (height < minH) {
            if (dir.includes('n')) y -= minH - height;
            height = minH;
          }
          if (y < MENUBAR_H) {
            height -= MENUBAR_H - y;
            y = MENUBAR_H;
          }
          s.rect = { x, y, w, h: height };
          applyRect(s);
        });
      });
    });
  }

  function wireChrome(s) {
    s.el.addEventListener('pointerdown', () => focus(s.id), true);
    s.el.addEventListener('focusin', () => focus(s.id)); // keyboard focus raises the window too
    s.el.querySelectorAll('[data-act]').forEach((btn) => {
      const act = btn.dataset.act;
      btn.addEventListener('click', () => (act === 'close' ? close(s.id) : act === 'minimize' ? minimize(s.id) : maximize(s.id)));
    });
    wireDrag(s);
    wireResize(s);
  }

  // ---- View stack --------------------------------------------------------------------

  function setTitle(s, title) {
    s.title = title;
    s.titleEl.textContent = title;
    s.el.setAttribute('aria-label', title);
  }

  // Identifies a control across re-renders, so keyboard focus survives replaceChildren().
  function focusKey(node) {
    return node.dataset.fkey || node.getAttribute('aria-label') || null;
  }

  function restoreFocus(s, key) {
    const match = key && [...s.el.querySelectorAll('[data-fkey], [aria-label]')].find((n) => focusKey(n) === key);
    if (match && !match.disabled) match.focus({ preventScroll: true });
    else s.body.focus({ preventScroll: true });
  }

  function renderView(s, scrollTop) {
    const view = currentView(s);
    const hadFocus = s.el.contains(document.activeElement);
    const key = hadFocus ? focusKey(document.activeElement) : null;
    s.content.replaceChildren();
    s.content.className = 'win-content';
    setTitle(s, view.title || s.opts.title);
    view.render(s.content, s.api);
    if (s.side) {
      s.side.replaceChildren();
      s.opts.sidebar(s.side, s.api);
    }
    renderHeader(s);
    s.body.scrollTop = scrollTop;
    if (hadFocus) restoreFocus(s, key);
    emit();
  }

  function makeApi(s) {
    return Object.freeze({
      id: s.id,
      el: s.el,
      navigate(view) {
        s.history = [...s.history.slice(0, s.index + 1), view];
        s.index = s.history.length - 1;
        renderView(s, 0);
      },
      back() {
        if (s.index <= 0) return;
        s.index -= 1;
        renderView(s, 0);
      },
      forward() {
        if (s.index >= s.history.length - 1) return;
        s.index += 1;
        renderView(s, 0);
      },
      refresh: () => renderView(s, s.body.scrollTop),
      view: () => currentView(s),
      content: () => s.content,
      setTitle: (title) => setTitle(s, title),
      setStatus(left, right) {
        const l = s.el.querySelector('.win-status-l');
        const r = s.el.querySelector('.win-status-r');
        if (l) l.textContent = left || '';
        if (r) r.textContent = right || '';
      },
      close: () => close(s.id),
    });
  }

  function runToolOn(s, id) {
    const view = currentView(s);
    if (view && view.tools && view.tools.some((t) => t.id === id)) view.onTool(id, s.api);
    else if (s.opts.onTool) s.opts.onTool(id, s.api);
  }

  // ---- Lifecycle ---------------------------------------------------------------------

  function topmost() {
    return [...wins.values()].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0] || null;
  }

  function focus(id) {
    const s = wins.get(id);
    if (!s || s.minimized) return;
    if (s.z !== topZ) {
      s.z = ++topZ;
      s.el.style.zIndex = String(s.z);
    }
    if (activeId === id) return;
    activeId = id;
    wins.forEach((w) => w.el.classList.toggle('is-active', w === s));
    emit();
  }

  function blurActive(id) {
    if (activeId !== id) return;
    activeId = null;
    wins.forEach((w) => w.el.classList.remove('is-active'));
    const next = topmost();
    if (next) focus(next.id);
  }

  function open(opts) {
    const existing = wins.get(opts.id);
    if (existing) {
      show(opts.id);
      return existing.api;
    }
    const el = h('section', {
      class: `win${opts.sidebar ? ' has-sidebar' : ''}`,
      role: 'region',
      'data-id': opts.id,
      'data-chrome': opts.chrome || 'standard',
    });
    el.innerHTML = chromeMarkup(opts);
    const s = {
      id: opts.id,
      opts,
      el,
      body: el.querySelector('.win-body'),
      content: el.querySelector('.win-content'),
      side: el.querySelector('.win-side-body'),
      nav: el.querySelector('.win-nav'),
      tools: el.querySelector('.win-tools'),
      titleEl: el.querySelector('.win-title'),
      rect: fitRect(initialRect(opts)),
      maximized: false,
      minimized: false,
      history: [],
      index: -1,
      title: opts.title,
      z: 0,
      order: opened++,
      zoomTimer: null,
    };
    s.api = makeApi(s);
    wins.set(s.id, s);
    layer.appendChild(el);
    wireChrome(s);
    setTitle(s, opts.title);
    applyRect(s);
    if (opts.view) s.api.navigate(opts.view);
    focus(s.id);
    s.body.focus({ preventScroll: true }); // keyboard users land inside the new window
    play(el, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], OPEN_MS).then((anim) => anim && anim.cancel());
    if (!opts.silent) window.MacAudio.play('open');
    return s.api;
  }

  function close(id, silent) {
    const s = wins.get(id);
    if (!s) return;
    const hadFocus = s.el.contains(document.activeElement);
    if (typeof s.opts.onClose === 'function') {
      try {
        s.opts.onClose(s.api); // apps stop loops, audio and pointer lock here
      } catch (err) {
        /* a failing app teardown must never block closing its window */
      }
    }
    wins.delete(id);
    s.el.style.pointerEvents = 'none';
    if (!silent) window.MacAudio.play('close');
    blurActive(id);
    emit();
    if (hadFocus) {
      // Keep keyboard users somewhere sensible: the next window, else this app's Dock icon.
      const next = topmost();
      const app = window.MacRegistry && window.MacRegistry.forWindow(id);
      const dockId = id === 'trash' ? 'trash-can' : app ? app.id : id;
      const dockIcon = document.querySelector(`#dock [data-app="${dockId}"]`);
      if (next) next.body.focus({ preventScroll: true });
      else if (dockIcon) dockIcon.focus({ preventScroll: true });
    }
    play(s.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.95)' }], CLOSE_MS).then(() => s.el.remove());
  }

  function minimize(id) {
    const s = wins.get(id);
    if (!s || s.minimized) return;
    const from = s.el.getBoundingClientRect();
    s.minimized = true;
    s.el.dispatchEvent(new CustomEvent('win:minimized'));
    blurActive(id);
    emit(); // the Dock adds a thumbnail for this window, which is where it flies to
    window.MacAudio.play('minimize');
    const to = window.MacDock && window.MacDock.targetRect(id);
    const frames = to ? [{ transform: 'none', opacity: 1 }, { transform: flyTo(from, to), opacity: 0.15 }] : [{ opacity: 1 }, { opacity: 0 }];
    play(s.el, frames, MINIMIZE_MS, 'cubic-bezier(.55,0,.7,.4)').then((anim) => {
      if (!s.minimized) return; // restored mid-flight
      s.el.hidden = true;
      if (anim) anim.cancel();
    });
  }

  function restore(id) {
    const s = wins.get(id);
    if (!s || !s.minimized) return;
    const from = window.MacDock && window.MacDock.targetRect(id);
    s.minimized = false;
    s.el.hidden = false;
    s.el.dispatchEvent(new CustomEvent('win:restored'));
    s.el.getAnimations().forEach((a) => a.cancel());
    applyRect(s);
    focus(id);
    s.body.focus({ preventScroll: true }); // the Dock tile that had focus is about to go away
    if (from) {
      const to = s.el.getBoundingClientRect();
      play(s.el, [{ transform: flyTo(to, from), opacity: 0.15 }, { transform: 'none', opacity: 1 }], MINIMIZE_MS - 60)
        .then((anim) => anim && anim.cancel());
    }
    emit();
  }

  function maximize(id) {
    const s = wins.get(id);
    if (!s || isNarrow() || !resizable(s.opts)) return;
    s.maximized = !s.maximized;
    animateGeometry(s);
  }

  function show(id) {
    const s = wins.get(id);
    if (!s) return;
    if (s.minimized) restore(id);
    else focus(id);
  }

  function onViewportResize() {
    wins.forEach((s) => {
      if (!isNarrow()) s.rect = fitRect(s.rect);
      applyRect(s);
    });
  }

  function init() {
    layer = document.getElementById('windows');
    window.addEventListener('resize', onViewportResize);
  }

  window.MacWM = Object.freeze({
    init,
    open,
    close,
    minimize,
    restore,
    maximize,
    focus,
    show,
    get: (id) => (wins.has(id) ? wins.get(id).api : null),
    active: () => (activeId && wins.has(activeId) ? wins.get(activeId).api : null),
    activeApp: () => (activeId && wins.has(activeId) ? wins.get(activeId).opts.app || wins.get(activeId).opts.title : null),
    list: () =>
      [...wins.values()]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ id: s.id, title: s.title, app: s.opts.app || s.opts.title, icon: s.opts.icon, active: s.id === activeId, minimized: s.minimized })),
    activeTools: () => (activeId && wins.has(activeId) ? toolsFor(wins.get(activeId)) : []),
    runTool: (id) => activeId && wins.has(activeId) && runToolOn(wins.get(activeId), id),
    restoreAll: () => wins.forEach((s) => s.minimized && restore(s.id)),
    closeAll: (silent) => [...wins.keys()].forEach((id) => close(id, silent)),
  });
})();
