/* The smaller apps (About, Resume, Contact, Trash), alerts and notification banners,
   plus one front door to every app for the Dock and menus. -> window.MacApps */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const D = window.MacData;
  const P = D.profile;

  const RESUME_WIDTH = 64;
  const COPIED_MS = 1600;
  const NOTICE_MS = 8000;
  const NOTICE_LEAVE_MS = 240;

  const fact = (term, value) => [h('dt', {}, term), h('dd', {}, value)];
  const bare = (url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const firstName = () => P.name.split(/\s+/)[0];
  let noticeCount = 0;

  function contactLinks() {
    return [
      P.email && { label: 'Email', text: P.email, href: `mailto:${P.email}`, icon: 'mail' },
      P.github && { label: 'GitHub', text: `github.com/${P.github}`, href: `https://github.com/${P.github}`, icon: 'code' },
      P.linkedin && { label: 'LinkedIn', text: bare(P.linkedin), href: P.linkedin, icon: 'person' },
      P.site && { label: 'Website', text: bare(P.site), href: P.site, icon: 'globe' },
    ].filter(Boolean);
  }

  function link(href, text, cls) {
    const isMail = href.startsWith('mailto:');
    return h('a', { class: cls || null, href, target: isMail ? null : '_blank', rel: isMail ? null : 'noopener' }, text);
  }

  const avatar = (cls) => h('span', { class: `avatar ${cls}`, 'aria-hidden': 'true' }, I.initials());

  // ---- About ---------------------------------------------------------------------------

  function renderAbout(root) {
    root.classList.add('about');
    root.append(
      h(
        'div',
        { class: 'about-card' },
        avatar('avatar-lg'),
        h('h1', {}, P.name),
        h('p', { class: 'about-role' }, P.role),
        h(
          'dl',
          { class: 'about-specs' },
          fact('Currently', P.currently),
          fact('Projects', String(D.projects.length)),
          fact('Focus', 'Web apps, lab hardware'),
          P.site ? fact('Site', link(P.site, bare(P.site))) : null
        ),
        h(
          'div',
          { class: 'about-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.MacFinder.projects() }, 'View Projects'),
          h('button', { class: 'btn', type: 'button', onclick: () => resume() }, 'Resume')
        )
      ),
      h(
        'div',
        { class: 'about-main' },
        h('h2', {}, 'About'),
        P.about.map((t) => h('p', {}, t)),
        h('h2', {}, 'Skills'),
        h('div', { class: 'chips' }, P.skills.map((s) => h('span', { class: 'chip', title: `Used in ${s.where}` }, s.name))),
        h('h2', {}, 'Activities'),
        h('ul', { class: 'about-list' }, P.activities.map((a) => h('li', {}, a)))
      )
    );
  }

  function about() {
    return window.MacWM.open({
      id: 'about', title: `About ${firstName()}`, app: 'About Me', icon: 'about', chrome: 'dialog',
      width: 740, height: 'auto', center: true, view: { title: `About ${firstName()}`, render: renderAbout },
    });
  }

  // ---- Resume --------------------------------------------------------------------------

  function wrap(text, width, indent = '', first = indent) {
    const out = [];
    let line = first;
    let hasWord = false;
    text.split(/\s+/).forEach((word) => {
      if (hasWord && line.length + word.length > width) {
        out.push(line.trimEnd());
        line = indent;
      }
      line += `${word} `;
      hasWord = true;
    });
    if (hasWord) out.push(line.trimEnd());
    return out;
  }

  function spread(left, right) {
    return left + ' '.repeat(Math.max(1, RESUME_WIDTH - left.length - right.length)) + right;
  }

  // Plain-text version for the download.
  function resumeText() {
    const rule = '-'.repeat(RESUME_WIDTH);
    const section = (title) => ['', rule, title, rule];
    const bullet = (text) => wrap(text, RESUME_WIDTH, '    ', '  - ');
    return [
      P.name.toUpperCase(),
      P.role,
      ...contactLinks().map((l) => `${l.label}: ${l.text}`),
      ...section('PROFILE'),
      ...wrap(P.about[0], RESUME_WIDTH),
      ...section('PROJECTS'),
      ...D.projects.flatMap((p) => [
        spread(p.title, p.date.slice(0, 4)),
        `  ${p.meta}`,
        ...wrap(p.tagline, RESUME_WIDTH, '  '),
        ...p.features.slice(0, 3).flatMap(bullet),
        '',
      ]),
      ...section('ACTIVITIES').slice(1),
      ...P.activities.flatMap(bullet),
      ...section('SKILLS'),
      ...wrap(P.skills.map((s) => s.name).join(', '), RESUME_WIDTH),
    ].join('\n');
  }

  function saveResume() {
    const blob = new Blob([`${resumeText()}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = h('a', { href: url, download: `${P.name.replace(/\s+/g, '-')}-Resume.txt` });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderResume(root, api) {
    root.classList.add('paper-wrap');
    root.append(
      h(
        'article',
        { class: 'paper' },
        h('h1', {}, P.name),
        h('p', { class: 'paper-role' }, P.role),
        h('p', { class: 'paper-contact' }, contactLinks().map((l) => link(l.href, l.text))),
        h('h2', {}, 'Profile'),
        h('p', {}, P.about[0]),
        h('h2', {}, 'Projects'),
        D.projects.map((p) =>
          h(
            'div',
            { class: 'r-item' },
            h('div', { class: 'r-head' }, p.title, h('span', {}, p.date.slice(0, 4))),
            h('div', { class: 'r-meta' }, p.meta),
            h('p', {}, p.tagline),
            h('ul', {}, p.features.slice(0, 3).map((f) => h('li', {}, f)))
          )
        ),
        h('h2', {}, 'Activities'),
        h('ul', {}, P.activities.map((a) => h('li', {}, a))),
        h('h2', {}, 'Skills'),
        h('p', {}, P.skills.map((s) => s.name).join(' · '))
      )
    );
    api.setTitle('Resume');
  }

  function resume() {
    return window.MacWM.open({
      id: 'resume', title: 'Resume', app: 'Resume', icon: 'resume', chrome: 'doc', width: 760, height: 720,
      tools: [{ id: 'save', label: 'Download resume as a text file', icon: 'download', text: 'Download' }],
      onTool: (id) => id === 'save' && saveResume(),
      view: { title: 'Resume', render: renderResume },
    });
  }

  // ---- Contact -------------------------------------------------------------------------

  const flashTimers = new WeakMap();

  function flash(btn, label) {
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent; // remember the real label once
    clearTimeout(flashTimers.get(btn));
    btn.textContent = label;
    flashTimers.set(btn, setTimeout(() => {
      btn.textContent = btn.dataset.label;
    }, COPIED_MS));
  }

  async function copyEmail(btn) {
    if (!P.email) return;
    try {
      await navigator.clipboard.writeText(P.email);
      if (btn) flash(btn, 'Copied');
      else notify({ title: 'Email address copied', body: P.email, icon: 'contact' });
    } catch (err) {
      showAlert({ message: 'The email address could not be copied automatically.', detail: P.email, icon: 'contact' });
    }
  }

  function contactRow(l) {
    const isMail = l.href.startsWith('mailto:');
    return h(
      'a',
      { class: 'contact-row', href: l.href, target: isMail ? null : '_blank', rel: isMail ? null : 'noopener' },
      h('span', { class: 'contact-row-icon', html: I.glyph(l.icon, 16) }),
      h('span', {}, h('span', { class: 'contact-row-label' }, l.label), h('span', { class: 'contact-row-value' }, l.text)),
      h('span', { class: 'contact-row-go', html: I.glyph('forward', 14) })
    );
  }

  function renderContact(root, api) {
    root.classList.add('contact');
    root.append(
      avatar('avatar-md'),
      h('h1', {}, P.name),
      h('p', { class: 'contact-role' }, P.role),
      h('div', { class: 'contact-list' }, contactLinks().map(contactRow)),
      P.email ? null : h('p', { class: 'contact-note' }, 'The best place to see what I am working on right now is the InsightLoop site.'),
      h(
        'div',
        { class: 'contact-actions' },
        P.email ? h('button', { class: 'btn', type: 'button', onclick: (e) => copyEmail(e.currentTarget) }, 'Copy Email') : null,
        P.email ? link(`mailto:${P.email}`, 'Email Me', 'btn btn-primary') : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => api.close() }, 'Done')
      )
    );
  }

  function contact() {
    return window.MacWM.open({
      id: 'contact', title: 'Contact', app: 'Contact', icon: 'contact', chrome: 'dialog',
      width: 400, height: 'auto', center: true, view: { title: 'Contact', render: renderContact },
    });
  }

  // ---- Trash ---------------------------------------------------------------------------

  function trash() {
    return window.MacWM.open({
      id: 'trash', title: 'Trash', app: 'Trash', icon: 'trash', width: 520, height: 360, status: true,
      view: {
        title: 'Trash',
        render(root, api) {
          root.classList.add('empty-state');
          root.append(
            h('span', { class: 'ico', html: I.get('trash', 72, 'trash-empty') }),
            h('p', { class: 'empty-title' }, 'Trash is empty'),
            h('p', {}, 'Nothing has been thrown away. Every project is still in Projects.')
          );
          api.setStatus('0 items', '');
        },
      },
    });
  }

  // ---- Alerts and notifications --------------------------------------------------------

  function showAlert({ message, detail, icon = 'about' }) {
    window.MacAudio.play('beep');
    const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'OK');
    const box = h(
      'div',
      { class: 'alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': message },
      h('span', { class: 'ico', html: I.get(icon, 56, `alert-${noticeCount++}`) }),
      h('p', { class: 'alert-msg' }, message),
      detail ? h('p', { class: 'alert-detail' }, detail) : null,
      ok
    );
    const backdrop = h('div', { class: 'alert-backdrop' }, box);
    const previous = document.activeElement;

    return new Promise((resolve) => {
      const onKey = (e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        done();
      };
      function done() {
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
        if (previous && previous.focus) previous.focus();
        resolve();
      }
      ok.addEventListener('click', done);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      ok.focus();
    });
  }

  function emptyTrash() {
    return showAlert({
      message: 'The Trash is already empty.',
      detail: 'Nothing has been thrown away. Every project is still in Projects.',
      icon: 'trash',
    });
  }

  /** A banner in the top-right corner that dismisses itself. */
  function notify({ title, body, icon = 'about', onClick }) {
    if (window.MacNotifCenter) {
      window.MacNotifCenter.record({ title, body, icon });
      if (window.MacNotifCenter.isOpen()) return; // it is already listed there; no banner on top
    }
    const stack = document.getElementById('notifications');
    const node = h(
      'div',
      { class: 'notice', role: 'status' },
      h('span', { class: 'notice-icon', html: I.get(icon, 38, `notice-${noticeCount++}`) }),
      h('div', {}, h('p', { class: 'notice-title' }, title), h('p', { class: 'notice-body' }, body)),
      h('button', { class: 'notice-close', type: 'button', 'aria-label': 'Dismiss notification', html: I.glyph('close', 10) })
    );
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), NOTICE_LEAVE_MS);
    };
    node.querySelector('.notice-close').addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    node.addEventListener('click', () => {
      if (onClick) onClick();
      dismiss();
    });
    stack.appendChild(node);
    timer = setTimeout(dismiss, NOTICE_MS);
    window.MacAudio.play('pop');
  }

  function welcome() {
    notify({
      title: `Welcome to ${firstName()} OS`,
      body: 'My portfolio as a desktop. Click a project to open it, use the Dock to switch apps, or try the Terminal.',
      icon: 'about',
      onClick: () => window.MacFinder.projects(),
    });
  }

  window.MacApps = Object.freeze({
    projects: (opts) => window.MacFinder.projects(opts),
    openProject: (id) => window.MacFinder.openProject(id),
    terminal: () => window.MacTerminal.open(),
    about,
    resume,
    contact,
    trash,
    emptyTrash,
    saveResume,
    resumeText,
    copyEmail,
    notify,
    welcome,
    alert: showAlert,
    hasEmail: () => Boolean(P.email),
    firstName,
  });
})();
