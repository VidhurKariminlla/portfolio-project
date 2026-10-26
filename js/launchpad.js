/* Launchpad: a full-screen grid of every app over a blurred desktop, with search.
   -> window.MacLaunchpad */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;

  let root = null;
  let grid = null;
  let input = null;
  let returnFocus = null;

  // While Launchpad is up, nothing behind it can take focus or clicks.
  function setBackgroundInert(inert) {
    ['desktop', 'menubar', 'statusbar', 'dock'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.inert = inert;
    });
  }

  function tiles(query) {
    const q = query.trim().toLowerCase();
    return window.MacRegistry.apps
      .filter((a) => a.launchpad)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .map((a) => h(
        'button',
        { class: 'lp-app', type: 'button', onclick: () => { close(); a.open(); } },
        h('span', { class: 'lp-icon', html: I.get(a.icon, 96, `lp-${a.id}`) }),
        h('span', { class: 'lp-label' }, a.name)
      ));
  }

  function render() {
    const items = tiles(input.value);
    grid.replaceChildren(...(items.length ? items : [h('p', { class: 'lp-empty' }, 'No Results')]));
  }

  function build() {
    input = h('input', { class: 'lp-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search apps', oninput: render,
      onkeydown: (e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'Enter') {
          const first = grid.querySelector('.lp-app');
          if (first) first.click();
        }
      } });
    grid = h('div', { class: 'lp-grid' });
    root = h('div', { class: 'lp-backdrop', role: 'dialog', 'aria-label': 'Launchpad', hidden: true,
      onclick: (e) => { if (e.target === root || e.target === grid) close(); } },
      h('div', { class: 'lp-top' }, h('label', { class: 'lp-search-wrap' }, h('span', { class: 'ico', html: I.glyph('search', 14) }), input)),
      grid);
    document.body.appendChild(root);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.hidden) close();
    });
  }

  function open() {
    if (!root) build();
    window.MacMenuBar.close();
    returnFocus = document.activeElement;
    input.value = '';
    render();
    root.hidden = false;
    setBackgroundInert(true);
    requestAnimationFrame(() => root.classList.add('is-open'));
    input.focus({ preventScroll: true });
  }

  function close() {
    if (!root || root.hidden) return;
    root.classList.remove('is-open');
    root.hidden = true;
    setBackgroundInert(false);
    if (returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }

  window.MacLaunchpad = Object.freeze({ open, close });
})();
