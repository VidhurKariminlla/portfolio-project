/* Builds macOS-style menus (pull-downs and right-click menus) from item lists, and opens
   free-floating context menus. -> window.MacMenu

   An item is '-' (separator), { heading }, or
   { label, icon?, checked?, disabled?, shortcut?, action }. */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const EDGE = 6;

  let context = null; // the open context menu, if any

  function itemNode(item, onPick) {
    if (item === '-') return h('div', { class: 'menu-sep', role: 'separator' });
    if (item.heading) return h('div', { class: 'menu-heading', role: 'presentation' }, item.heading);
    return h(
      'button',
      {
        class: `menu-item${item.disabled ? ' is-disabled' : ''}`,
        type: 'button',
        tabindex: '-1',
        role: item.checked == null ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': item.checked == null ? null : String(Boolean(item.checked)),
        'aria-disabled': item.disabled ? 'true' : null,
        onclick: () => {
          if (!item.disabled) onPick(item);
        },
      },
      h('span', { class: 'menu-check', 'aria-hidden': 'true' }, item.checked ? '✓' : ''),
      item.icon ? h('span', { class: 'menu-icon', html: I.get(item.icon, 16, 'menu') }) : null,
      h('span', { class: 'menu-label' }, item.label),
      item.shortcut ? h('span', { class: 'menu-key', 'aria-hidden': 'true' }, item.shortcut) : null
    );
  }

  /** A .menu element. onPick(item) runs when an enabled item is chosen. */
  function build(items, onPick) {
    return h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((item) => itemNode(item, onPick)));
  }

  function moveFocus(menu, delta) {
    const items = [...menu.querySelectorAll('.menu-item:not(.is-disabled)')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = index < 0 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
    items[next].focus();
  }

  /** Keeps a menu on screen, opening at (x, y). */
  function place(menu, x, y) {
    const w = menu.offsetWidth;
    const hgt = menu.offsetHeight;
    menu.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE))}px`;
    menu.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - hgt - EDGE))}px`;
  }

  function closeContext() {
    if (!context) return;
    const { node, cleanup } = context;
    context = null;
    cleanup();
    node.remove();
  }

  /** Opens a right-click menu at the pointer. */
  function openContext(x, y, items) {
    closeContext();
    if (window.MacMenuBar) window.MacMenuBar.close();
    const node = build(items, (item) => {
      closeContext();
      item.action();
    });
    node.classList.add('menu-context');
    document.body.appendChild(node);
    place(node, x, y);
    const onDown = (e) => {
      if (!node.contains(e.target)) closeContext();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeContext();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(node, e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeContext);
    context = {
      node,
      cleanup: () => {
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('blur', closeContext);
      },
    };
    window.MacAudio.play('menu');
  }

  window.MacMenu = Object.freeze({ build, place, moveFocus, openContext, closeContext });
})();
