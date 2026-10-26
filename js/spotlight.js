/* Spotlight: one search field over apps, projects, documents and quick actions.
   Open from the menu bar or with Cmd/Ctrl+K. -> window.MacSpotlight */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const MAX_RESULTS = 9;

  let root = null;
  let input = null;
  let list = null;
  let results = [];
  let cursor = 0;
  let returnFocus = null;

  function catalog() {
    const R = window.MacRegistry;
    const A = window.MacApps;
    const apps = R.apps.map((a) => ({ group: 'Applications', title: a.name, sub: 'Application', icon: a.icon, run: a.open, words: a.name }));
    const projects = window.MacData.projects.map((p) => ({
      group: 'Projects', title: p.title, sub: p.tagline, icon: 'folder', run: () => A.openProject(p.id),
      words: [p.title, p.tagline, p.kind, ...p.stack].join(' '),
    }));
    const docs = [
      { group: 'Documents', title: 'Resume.pdf', sub: 'Document', icon: 'pdf', run: () => A.resume(), words: 'resume cv pdf document' },
      { group: 'Documents', title: 'Download Resume (.txt)', sub: 'Action', icon: 'resume', run: () => A.saveResume(), words: 'download resume text' },
    ];
    const actions = [
      { group: 'Actions', title: 'Toggle Dark Mode', sub: 'Appearance', icon: 'settings', run: () => window.MacTheme.set(window.MacTheme.isDark() ? 'light' : 'dark'), words: 'dark light mode appearance theme' },
      { group: 'Actions', title: 'Change Wallpaper', sub: 'System Settings', icon: 'settings', run: () => window.MacSettings.open('wallpaper'), words: 'wallpaper background desktop picture' },
      { group: 'Actions', title: 'Lock Screen', sub: 'System', icon: 'settings', run: () => window.MacBoot.lock(), words: 'lock screen sleep' },
    ];
    return [...apps, ...projects, ...docs, ...actions];
  }

  // Ranks prefix matches on the title above loose matches elsewhere.
  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return catalog().filter((r) => r.group === 'Applications').slice(0, MAX_RESULTS);
    const scored = catalog().map((r) => {
      const title = r.title.toLowerCase();
      const words = r.words.toLowerCase();
      const score = title.startsWith(q) ? 3 : title.includes(q) ? 2 : q.split(/\s+/).every((t) => words.includes(t)) ? 1 : 0;
      return { r, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS).map((s) => s.r);
  }

  function render() {
    results = search(input.value);
    cursor = Math.min(cursor, Math.max(0, results.length - 1));
    let lastGroup = null;
    const rows = [];
    results.forEach((r, i) => {
      if (r.group !== lastGroup) rows.push(h('div', { class: 'sp-group', role: 'presentation' }, r.group));
      lastGroup = r.group;
      rows.push(h(
        'button',
        { class: `sp-row${i === cursor ? ' is-active' : ''}`, type: 'button', role: 'option', 'aria-selected': String(i === cursor), onclick: () => choose(i), onpointermove: () => setCursor(i) },
        h('span', { class: 'sp-icon', html: I.get(r.icon, 28, `sp-${i}`) }),
        h('span', { class: 'sp-text' }, h('span', { class: 'sp-title' }, r.title), h('span', { class: 'sp-sub' }, r.sub))
      ));
    });
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'sp-empty' }, 'No Results')]));
    list.hidden = false;
  }

  function setCursor(i) {
    if (i === cursor) return;
    cursor = i;
    list.querySelectorAll('.sp-row').forEach((row, n) => {
      row.classList.toggle('is-active', n === i);
      row.setAttribute('aria-selected', String(n === i));
    });
  }

  function choose(i) {
    const r = results[i];
    close();
    if (r) r.run();
  }

  // Keep Tab inside the dialog: the field and the result rows.
  function trapTab(e) {
    const stops = [input, ...list.querySelectorAll('.sp-row')];
    const index = stops.indexOf(document.activeElement);
    const next = e.shiftKey ? (index <= 0 ? stops.length - 1 : index - 1) : (index + 1) % stops.length;
    e.preventDefault();
    stops[next].focus();
  }

  function onKey(e) {
    if (e.key === 'Tab') {
      trapTab(e);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      setCursor((cursor + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
      const row = list.querySelectorAll('.sp-row')[cursor];
      if (row) row.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(cursor);
    }
  }

  function build() {
    input = h('input', { class: 'sp-input', type: 'text', placeholder: 'Spotlight Search', 'aria-label': 'Spotlight Search', autocomplete: 'off', spellcheck: 'false',
      oninput: () => { cursor = 0; render(); } });
    list = h('div', { class: 'sp-results', role: 'listbox', 'aria-label': 'Results' });
    const panel = h('div', { class: 'sp-panel', role: 'dialog', 'aria-label': 'Spotlight' },
      h('div', { class: 'sp-bar' }, h('span', { class: 'sp-glass', html: I.glyph('search', 22) }), input), list);
    root = h('div', { class: 'sp-backdrop', hidden: true, onkeydown: onKey, onpointerdown: (e) => { if (e.target === root) close(); } }, panel);
    document.body.appendChild(root);
  }

  function open() {
    if (document.getElementById('desktop').inert) return;
    if (!root) build();
    if (!root.hidden) return;
    window.MacMenuBar.close();
    returnFocus = document.activeElement;
    root.hidden = false;
    input.value = '';
    cursor = 0;
    render();
    input.focus();
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    if (returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus();
  }

  window.MacSpotlight = Object.freeze({ open, close, toggle: () => (root && !root.hidden ? close() : open()) });
})();
