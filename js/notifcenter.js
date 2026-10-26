/* Notification Center: slides in from the right when the clock is clicked, with recent
   notifications and widgets. -> window.MacNotifCenter */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const MAX_HISTORY = 20;

  let root = null;
  let history = []; // [{ title, body, icon, at }]; replaced, never mutated

  function record(notice) {
    history = [{ ...notice, at: Date.now() }, ...history].slice(0, MAX_HISTORY);
    if (root && !root.hidden) render();
  }

  function ago(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    return mins < 1 ? 'now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  }

  function noticeCard(n, i) {
    return h('div', { class: 'nc-card' },
      h('span', { class: 'nc-icon', html: I.get(n.icon || 'about', 32, `nc-${i}`) }),
      h('span', { class: 'nc-text' }, h('span', { class: 'nc-row' }, h('span', { class: 'nc-title' }, n.title), h('span', { class: 'nc-time' }, ago(n.at))),
        h('span', { class: 'nc-body' }, n.body)));
  }

  function upNext() {
    const now = new Date();
    return h('div', { class: 'nc-widget nc-date' },
      h('span', { class: 'nc-day' }, now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()),
      h('span', { class: 'nc-num' }, String(now.getDate())),
      h('span', { class: 'nc-sub' }, window.MacData.profile.currently));
  }

  function projectsWidget() {
    return h('div', { class: 'nc-widget' },
      h('p', { class: 'nc-wtitle' }, 'Projects'),
      window.MacData.projects.map((p) => h('button', { class: 'nc-proj', type: 'button', onclick: () => { close(); window.MacApps.openProject(p.id); } },
        h('span', { class: 'nc-proj-dot', 'aria-hidden': 'true' }), h('span', {}, p.title), h('span', { class: 'nc-proj-kind' }, p.kind))));
  }

  function render() {
    const notices = history.length
      ? [h('div', { class: 'nc-head' }, h('span', {}, 'Notifications'), h('button', { class: 'nc-clear', type: 'button', onclick: () => { history = []; render(); } }, 'Clear')),
        ...history.map(noticeCard)]
      : [h('p', { class: 'nc-none' }, 'No Notifications')];
    root.querySelector('.nc-scroll').replaceChildren(...notices, upNext(), projectsWidget());
  }

  function build() {
    root = h('aside', { class: 'nc-panel', 'aria-label': 'Notification Center', hidden: true }, h('div', { class: 'nc-scroll' }));
    document.body.appendChild(root);
    document.addEventListener('pointerdown', (e) => {
      if (root.hidden || root.contains(e.target) || e.target.closest('.mb-clock')) return;
      close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function open() {
    if (!root) build();
    render();
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('is-open'));
  }

  function close() {
    if (!root || root.hidden) return;
    root.classList.remove('is-open');
    root.hidden = true;
  }

  const isOpen = () => Boolean(root && !root.hidden);

  window.MacNotifCenter = Object.freeze({ toggle: () => (isOpen() ? close() : open()), open, close, record, isOpen });
})();
