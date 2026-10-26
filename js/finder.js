/* Projects: a Finder-style gallery with a sidebar, search, a sortable list view, and a
   page for every project. -> window.MacFinder */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const D = window.MacData;

  const FILTER_ICONS = { all: 'grid', software: 'code', hardware: 'cpu' };
  const COLUMNS = [
    { key: 'name', label: 'Name', value: (p) => p.title.toLowerCase() },
    { key: 'kind', label: 'Kind', value: (p) => p.kind },
    { key: 'size', label: 'Size', value: (p) => p.size },
    { key: 'date', label: 'Date Modified', value: (p) => p.date },
  ];

  // One Projects window, so its browsing state lives here. Replaced, never mutated.
  let state = { mode: 'icons', filter: 'all', sort: 'name', dir: 1, query: '' };
  const setState = (patch) => {
    state = { ...state, ...patch };
  };

  // Finder locations that are not project filters.
  const LOCATIONS = { applications: 'Applications', documents: 'Documents' };
  const TAG_COLORS = { software: '#0a84ff', hardware: '#ff9f0a' };

  const plural = (n) => (n === 1 ? '1 item' : `${n} items`);
  const byId = (id) => D.projects.find((p) => p.id === id);
  const filterLabel = () => LOCATIONS[state.filter] || D.filters.find((f) => f.id === state.filter).label;
  const inFilter = (p, filter) => filter === 'all' || p.category === filter;
  const bare = (url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  function formatDate(iso, options) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', options || { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function matches(p, query) {
    if (!query) return true;
    const haystack = [p.title, p.tagline, p.meta, p.kind, ...p.stack].join(' ').toLowerCase();
    return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
  }

  // Search hides items in place instead of re-rendering, so typing never loses focus.
  function applySearch(root, api) {
    let shown = 0;
    root.querySelectorAll('[data-project]').forEach((node) => {
      const visible = matches(byId(node.dataset.project), state.query);
      node.hidden = !visible;
      if (visible) shown += 1;
    });
    const empty = root.querySelector('.f-empty');
    if (empty) empty.hidden = shown > 0;
    api.setStatus(plural(shown), state.query ? `Searching for “${state.query}”` : 'Click a project to open it');
  }

  function openOnEnter(e, run) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    run();
  }

  // ---- Gallery and list ----------------------------------------------------------------

  function badge(p) {
    return h('span', { class: `card-badge badge-${p.badge.toLowerCase()}` }, p.badge);
  }

  function card(p, open) {
    return h(
      'button',
      { class: 'card', type: 'button', 'data-project': p.id, 'aria-label': `${p.title}. ${p.tagline}`, onclick: () => open(p) },
      h('span', { class: 'card-cover', html: p.thumb(`grid-${p.id}`) }, badge(p)),
      h(
        'span',
        { class: 'card-body' },
        h('span', { class: 'card-title' }, p.title),
        h('span', { class: 'card-meta' }, `${p.kind} · ${formatDate(p.date, { month: 'short', year: 'numeric' })}`),
        h('span', { class: 'card-tagline' }, p.tagline)
      )
    );
  }

  function sortItems(items) {
    const value = COLUMNS.find((c) => c.key === state.sort).value;
    return [...items].sort((a, b) => (value(a) < value(b) ? -state.dir : value(a) > value(b) ? state.dir : 0));
  }

  function listTable(items, open, sortBy) {
    const sorted = (key) => key === state.sort;
    const head = h(
      'tr', {},
      COLUMNS.map((c) =>
        h(
          'th',
          { scope: 'col', class: sorted(c.key) ? 'is-sorted' : null, 'aria-sort': sorted(c.key) ? (state.dir > 0 ? 'ascending' : 'descending') : null },
          h('button', { type: 'button', 'data-fkey': `sort-${c.key}`, onclick: () => sortBy(c.key) }, c.label,
            sorted(c.key) ? h('span', { class: 'f-sort', 'aria-hidden': 'true' }, state.dir > 0 ? '▲' : '▼') : null)
        )
      )
    );
    const rows = sortItems(items).map((p) =>
      h(
        'tr',
        { tabindex: '0', 'data-project': p.id, 'aria-label': p.title, onclick: () => open(p), onkeydown: (e) => openOnEnter(e, () => open(p)) },
        h('td', {}, h('span', { class: 'f-name' }, h('span', { class: 'ico', html: I.get('folder', 18, `row-${p.id}`) }), p.title)),
        h('td', {}, p.kind),
        h('td', {}, p.size),
        h('td', {}, formatDate(p.date))
      )
    );
    return h('table', { class: 'f-list' }, h('thead', {}, head), h('tbody', {}, rows));
  }

  // Filters as pills, shown only when the window is too narrow for the sidebar.
  function filterPills(api) {
    return h(
      'div',
      { class: 'f-pills', role: 'group', 'aria-label': 'Filter projects' },
      D.filters.map((f) =>
        h('button', { class: 'f-pill', type: 'button', 'aria-pressed': String(state.filter === f.id), 'data-fkey': `pill-${f.id}`, onclick: () => selectFilter(f.id, api) }, f.label)
      )
    );
  }

  function searchField(api) {
    const input = h('input', {
      class: 'search-input',
      type: 'search',
      placeholder: 'Search',
      'aria-label': 'Search projects',
      'data-fkey': 'search',
      value: state.query,
      oninput: (e) => {
        setState({ query: e.target.value.trim() });
        applySearch(api.content(), api);
      },
    });
    return h('label', { class: 'search', 'data-nodrag': true }, h('span', { class: 'search-icon', html: I.glyph('search', 14) }), input);
  }

  function listingView() {
    return {
      isListing: true,
      get title() {
        return filterLabel();
      },
      get tools() {
        return [
          { id: 'icons', label: 'View as Gallery', icon: 'grid', group: 'view', groupLabel: 'View', pressed: state.mode === 'icons' },
          { id: 'list', label: 'View as List', icon: 'list', group: 'view', groupLabel: 'View', pressed: state.mode === 'list' },
        ];
      },
      onTool(id, api) {
        if (id !== 'icons' && id !== 'list') return;
        setState({ mode: id });
        api.refresh();
      },
      toolbar: (api) => (LOCATIONS[state.filter] ? [] : searchField(api)),
      render(root, api) {
        if (LOCATIONS[state.filter]) {
          renderLocation(root, api);
          return;
        }
        const items = D.projects.filter((p) => inFilter(p, state.filter));
        const open = (p) => api.navigate(projectView(p));
        const sortBy = (key) => {
          setState(key === state.sort ? { dir: -state.dir } : { sort: key, dir: key === 'date' ? -1 : 1 });
          api.refresh();
        };
        root.classList.add('finder');
        root.append(
          filterPills(api),
          state.mode === 'icons' ? h('div', { class: 'card-grid' }, items.map((p) => card(p, open))) : listTable(items, open, sortBy),
          h('p', { class: 'f-empty', hidden: true }, 'No projects match your search.')
        );
        applySearch(root, api);
      },
    };
  }

  // Applications and Documents: big icons that open on click, like a Finder icon view.
  function renderLocation(root, api) {
    const items = state.filter === 'applications'
      ? window.MacRegistry.apps.filter((a) => a.launchpad).map((a) => ({ name: a.name, icon: a.icon, open: a.open }))
      : [{ name: 'Resume.pdf', icon: 'pdf', open: () => window.MacApps.resume() }];
    root.classList.add('finder');
    root.append(h('div', { class: 'f-icons' }, items.map((it) =>
      h('button', { class: 'f-icon', type: 'button', 'data-fkey': `loc-${it.name}`, onclick: it.open },
        h('span', { class: 'ico', html: I.get(it.icon, 64, `loc-${it.name.replace(/\W/g, '')}`) }),
        h('span', { class: 'f-icon-label' }, it.name)))));
    api.setStatus(plural(items.length), '');
  }

  function selectFilter(id, api) {
    setState({ filter: id });
    const view = api.view();
    if (view && view.isListing) api.refresh();
    else api.navigate(listingView());
  }

  // ---- Project page ------------------------------------------------------------------

  function factBox(term, value) {
    return h('div', {}, h('dt', {}, term), h('dd', {}, value));
  }

  function section(title, body) {
    return h('section', { class: 'detail-section' }, h('h2', {}, title), body);
  }

  function projectLinks(p) {
    const links = [
      p.url && h('a', { class: 'btn btn-primary btn-lg', href: p.url, target: '_blank', rel: 'noopener' },
        `Visit ${bare(p.url)}`, h('span', { class: 'ico', html: I.glyph('external', 14) })),
      p.repo && h('a', { class: 'btn btn-lg', href: p.repo, target: '_blank', rel: 'noopener' }, 'View source'),
    ].filter(Boolean);
    return links.length ? h('div', { class: 'detail-actions' }, links) : null;
  }

  function projectView(p) {
    const next = D.projects[(D.projects.indexOf(p) + 1) % D.projects.length];
    return {
      title: p.title,
      projectId: p.id,
      render(root, api) {
        root.classList.add('detail');
        root.append(
          h(
            'article',
            { class: 'detail-inner' },
            h('div', { class: 'detail-cover', html: p.thumb(`doc-${p.id}`) }),
            h(
              'header',
              { class: 'detail-head' },
              h('div', { class: 'detail-titles' }, badge(p), h('h1', {}, p.title), h('p', { class: 'detail-tagline' }, p.tagline)),
              projectLinks(p)
            ),
            h('dl', { class: 'detail-facts' }, factBox('Kind', p.kind), factBox('Built with', p.meta), factBox('Updated', formatDate(p.date)), factBox('Size', p.size)),
            section('Overview', p.summary.map((t) => h('p', {}, t))),
            section('Highlights', h('ul', { class: 'detail-list' }, p.features.map((f) => h('li', {}, f)))),
            section('Stack', h('div', { class: 'chips' }, p.stack.map((s) => h('span', { class: 'chip' }, s)))),
            h('aside', { class: 'caveat' }, h('h2', {}, h('span', { class: 'ico', html: I.glyph('sparkle', 15) }), 'Worth knowing'), h('p', {}, p.notes)),
            h(
              'button',
              { class: 'next-project', type: 'button', 'data-fkey': 'next-project', onclick: () => api.navigate(projectView(next)) },
              h('span', { class: 'next-label' }, 'Next project'),
              h('span', { class: 'next-title' }, next.title),
              h('span', { class: 'next-arrow', html: I.glyph('forward', 18) })
            )
          )
        );
        api.setStatus(p.title, p.meta);
      },
    };
  }

  // ---- Sidebar -----------------------------------------------------------------------

  function sideItem(label, icon, active, onclick, count) {
    return h(
      'button',
      { class: `side-item${active ? ' is-active' : ''}`, type: 'button', 'aria-current': active ? 'page' : null, 'data-fkey': `side-${label}`, onclick },
      h('span', { class: 'side-icon', html: I.glyph(icon, 16) }),
      h('span', { class: 'side-label' }, label),
      count == null ? null : h('span', { class: 'side-count' }, String(count))
    );
  }

  function sidebar(root, api) {
    const view = api.view();
    const onListing = Boolean(view && view.isListing);
    const A = window.MacApps;
    const here = (id) => onListing && state.filter === id;
    window.MacDOM.append(root, [
      h('p', { class: 'side-heading' }, 'Favorites'),
      sideItem('Applications', 'apps', here('applications'), () => selectFilter('applications', api)),
      sideItem('Documents', 'doc', here('documents'), () => selectFilter('documents', api)),
      sideItem('Projects', FILTER_ICONS.all, here('all'), () => selectFilter('all', api), D.projects.length),
      h('p', { class: 'side-heading' }, 'Tags'),
      D.filters.filter((f) => f.id !== 'all').map((f) => {
        const item = sideItem(f.label, 'tag', here(f.id), () => selectFilter(f.id, api), D.projects.filter((p) => inFilter(p, f.id)).length);
        item.querySelector('.side-icon').style.color = TAG_COLORS[f.id] || 'var(--text-3)';
        return item;
      }),
      h('p', { class: 'side-heading' }, 'Projects'),
      D.projects.map((p) =>
        sideItem(p.title, 'folder', !onListing && view && view.projectId === p.id, () => api.navigate(projectView(p)))
      ),
      h('p', { class: 'side-heading' }, 'More'),
      sideItem('About Me', 'person', false, () => A.about()),
      sideItem('Resume', 'doc', false, () => A.resume()),
      sideItem('Contact', 'mail', false, () => A.contact()),
      sideItem('Terminal', 'terminal', false, () => A.terminal()),
    ]);
  }

  // ---- Entry points ------------------------------------------------------------------

  function projects(opts) {
    return window.MacWM.open({
      id: 'projects', title: 'Projects', app: 'Finder', icon: 'finder',
      width: 920, height: 580, minWidth: 420, nav: true, status: true,
      sidebar, view: listingView(), silent: Boolean(opts && opts.silent),
    });
  }

  /** Opens Finder at a location: 'applications', 'documents', or a project filter. */
  function go(location) {
    setState({ filter: LOCATIONS[location] || D.filters.some((f) => f.id === location) ? location : 'all' });
    const api = projects();
    const view = api.view();
    if (view && view.isListing) api.refresh();
    else api.navigate(listingView());
  }

  function openProject(id) {
    const p = byId(id);
    if (!p) return;
    const api = projects();
    const current = api.view();
    if (current && current.projectId === p.id) return;
    api.navigate(projectView(p));
  }

  window.MacFinder = Object.freeze({ projects, openProject, go, formatDate });
})();
