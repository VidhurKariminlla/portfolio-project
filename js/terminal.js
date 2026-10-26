/* Terminal: a small zsh-like shell over a virtual home folder (Desktop, Documents,
   Projects, Applications). History with the arrow keys, Tab completion, and commands
   that drive the rest of the desktop. -> window.MacTerminal */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const D = window.MacData;
  const P = D.profile;

  const USER = P.name.split(/\s+/)[0].toLowerCase();
  const HOST = `${USER}-os`;
  const HOME = `/Users/${USER}`;
  const PAD = 12;
  const MATRIX_MS = 6000;
  const BOOTED_AT = Date.now();

  let history = []; // commands typed this session; replaced, never mutated
  let cursor = 0;
  let cwd = HOME;

  // ---- Virtual filesystem ------------------------------------------------------------

  const readme = (p) => [`# ${p.title}`, '', p.tagline, '', ...p.summary.flatMap((t) => [t, '']), '## Highlights', ...p.features.map((f) => `- ${f}`), '', `Stack: ${p.stack.join(', ')}`].join('\n');

  function tree() {
    const projects = Object.fromEntries(D.projects.map((p) => [p.id, { 'README.md': () => readme(p), 'NOTES.md': () => `Worth knowing\n\n${p.notes}` }]));
    const appsDir = Object.fromEntries(window.MacRegistry.apps.filter((a) => a.launchpad).map((a) => [`${a.name}.app`, { run: a.open }]));
    return {
      Desktop: { 'Resume.pdf': { run: () => window.MacApps.resume() }, 'Projects': { link: `${HOME}/Projects` } },
      Documents: { 'Resume.txt': () => window.MacApps.resumeText(), 'About.txt': () => P.about.join('\n\n') },
      Projects: projects,
      Applications: appsDir,
    };
  }

  function resolve(path) {
    const raw = !path || path === '~' ? HOME : path.startsWith('~/') ? `${HOME}/${path.slice(2)}` : path.startsWith('/') ? path : `${cwd}/${path}`;
    const parts = [];
    raw.split('/').forEach((seg) => {
      if (!seg || seg === '.') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return `/${parts.join('/')}`;
  }

  // Returns the node at an absolute path: an object (folder), a function (file) or {run}.
  function lookup(abs) {
    if (abs === HOME) return tree();
    if (abs === '/') return { Users: { [USER]: {} } };
    if (abs === '/Users') return { [USER]: {} };
    if (!abs.startsWith(`${HOME}/`)) return null;
    let node = tree();
    for (const seg of abs.slice(HOME.length + 1).split('/')) {
      // Own keys only: 'constructor', '__proto__' etc. are not files.
      node = node && typeof node === 'object' && !node.run && Object.hasOwn(node, seg) ? node[seg] : null;
      if (node && node.link) node = lookup(node.link);
    }
    return node || null;
  }

  const isDir = (n) => n && typeof n === 'object' && !n.run;
  const pretty = (abs) => (abs.startsWith(HOME) ? `~${abs.slice(HOME.length)}` : abs);
  const findProject = (arg) => D.projects.find((p) => p.id === arg || p.title.toLowerCase() === arg.toLowerCase());

  // ---- Commands ----------------------------------------------------------------------

  function ls(arg) {
    const abs = resolve(arg || '.'); // plain `ls` lists the current folder, not home
    const node = lookup(abs);
    if (!node) return [{ err: `ls: ${arg}: No such file or directory` }];
    if (!isDir(node)) return [arg];
    const names = Object.keys(node).sort().map((k) => (isDir(node[k]) || node[k].link ? `${k}/` : k));
    return names.length ? [names.join('    ')] : [];
  }

  function cd(arg) {
    const abs = resolve(arg);
    if (!isDir(lookup(abs))) return [{ err: `cd: no such file or directory: ${arg}` }];
    cwd = abs;
    return [];
  }

  function cat(arg) {
    if (!arg) return [{ err: 'usage: cat <file>' }];
    const project = findProject(arg);
    if (project) return readme(project).split('\n');
    const node = lookup(resolve(arg));
    if (typeof node === 'function') return String(node()).split('\n');
    if (isDir(node)) return [{ err: `cat: ${arg}: Is a directory` }];
    return [{ err: `cat: ${arg}: No such file or directory` }];
  }

  function openCmd(arg) {
    if (!arg) return [{ err: 'usage: open <app | project | file>' }];
    const app = window.MacRegistry.apps.find((a) => a.id === arg.toLowerCase() || a.name.toLowerCase() === arg.toLowerCase().replace(/\.app$/, ''));
    if (app) {
      app.open();
      return [{ dim: `Opening ${app.name}…` }];
    }
    const project = findProject(arg);
    if (project) {
      window.MacApps.openProject(project.id);
      return [{ dim: `Opening ${project.title}…` }];
    }
    const node = lookup(resolve(arg));
    if (node && node.run) {
      node.run();
      return [{ dim: `Opening ${arg}…` }];
    }
    return [{ err: `The file ${pretty(resolve(arg))} does not exist.` }];
  }

  function treeCmd() {
    const out = [pretty(cwd)];
    const walk = (start, prefix, depth) => {
      const node = start && start.link ? lookup(start.link) : start; // follow the Desktop/Projects alias
      if (depth > 2 || !isDir(node)) return;
      const keys = Object.keys(node).sort();
      keys.forEach((k, i) => {
        const last = i === keys.length - 1;
        out.push(`${prefix}${last ? '└── ' : '├── '}${k}`);
        walk(node[k], `${prefix}${last ? '    ' : '│   '}`, depth + 1);
      });
    };
    walk(lookup(cwd), '', 0);
    return out;
  }

  function uptime() {
    const mins = Math.floor((Date.now() - BOOTED_AT) / 60000);
    return `${mins < 1 ? 'less than a minute' : `${mins} min`}`;
  }

  function neofetch() {
    const art = ['      /\\      ', '     /  \\     ', '    / /\\ \\    ', '   / /  \\ \\   ', '   \\ \\  / /   ', '    \\ \\/ /    ', '     \\  /     ', '      \\/      '];
    const info = [
      { accent: `${USER}@${HOST}` },
      '----------------',
      `OS: ${P.name.split(/\s+/)[0]} OS 26 (Portfolio edition)`,
      `Host: ${navigator.userAgent.includes('Mac') ? 'a Mac' : 'a browser'}, ${window.screen.width}×${window.screen.height}`,
      `Uptime: ${uptime()}`,
      `Shell: vsh (a tiny shell written for this site)`,
      `Theme: ${window.MacTheme.isDark() ? 'Dark' : 'Light'}`,
      `Projects: ${D.projects.length}`,
      `Currently: ${P.currently}`,
    ];
    return art.map((line, i) => {
      const right = info[i];
      if (!right) return line;
      return typeof right === 'string' ? `${line}  ${right}` : { accent: `${line}  ${right.accent}` };
    }).concat(info.slice(art.length));
  }

  function music(arg) {
    const M = window.MacMusic;
    if (!M) return [{ err: 'music: the Music app is not installed yet.' }];
    const actions = { play: M.toggle, pause: M.toggle, toggle: M.toggle, next: M.next, prev: M.prev, open: M.open };
    const run = actions[arg];
    if (!Object.hasOwn(actions, arg || '')) return [{ err: 'usage: music play | pause | next | prev | open' }];
    run();
    const s = M.getState ? M.getState() : null;
    return [{ dim: s && s.track ? `${s.playing ? '▶' : '❙❙'} ${s.track.title} — ${s.track.artist}` : 'OK' }];
  }

  function say(text) {
    if (!text) return [{ err: 'usage: say <text>' }];
    if (!('speechSynthesis' in window) || window.MacAudio.isMuted()) return [{ dim: '(sound is off)' }];
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    return [];
  }

  const COMMANDS = {
    help: { desc: 'list commands', run: () => Object.entries(COMMANDS).filter(([, c]) => !c.hidden).map(([n, c]) => `  ${n.padEnd(PAD)}${c.desc}`) },
    ls: { desc: 'list a folder: ls [path]', run: ls },
    cd: { desc: 'change folder: cd [path]', run: cd },
    pwd: { desc: 'print the current folder', run: () => [pretty(cwd)] },
    tree: { desc: 'show folders as a tree', run: treeCmd },
    cat: { desc: 'print a file or project: cat <name>', run: cat },
    open: { desc: 'open an app, project or file', run: openCmd },
    neofetch: { desc: 'system info', run: neofetch },
    whoami: { desc: 'who built this', run: () => [`${P.name}: ${P.role}`] },
    about: { desc: 'a short bio', run: () => P.about.flatMap((t) => [t, '']) },
    skills: { desc: 'what I work with', run: () => P.skills.map((s) => `  ${s.name.padEnd(24)}${s.where}`) },
    contact: {
      desc: 'how to reach me',
      run: () => [P.email && `  email     ${P.email}`, P.github && `  github    github.com/${P.github}`, P.linkedin && `  linkedin  ${P.linkedin}`, P.site && `  web       ${P.site}`].filter(Boolean),
    },
    music: { desc: 'music play | pause | next | prev', run: music },
    theme: {
      desc: 'theme light | dark | auto',
      run: (arg) => {
        if (!['light', 'dark', 'auto'].includes(arg)) return [{ err: 'usage: theme light | dark | auto' }];
        window.MacTheme.set(arg);
        return [{ dim: `Appearance set to ${arg}.` }];
      },
    },
    say: { desc: 'speak some text aloud', run: (arg, raw) => say(raw) },
    matrix: { desc: 'take the red pill', run: (arg, raw, ctx) => (ctx.matrix(), []) },
    history: { desc: 'commands you have typed', run: () => history.map((c, i) => `  ${String(i + 1).padStart(3)}  ${c}`) },
    man: {
      desc: 'manual for a command: man <cmd>',
      run: (arg) => (arg && Object.hasOwn(COMMANDS, arg) ? [{ accent: arg.toUpperCase() }, `    ${COMMANDS[arg].desc}`] : [{ err: `No manual entry for ${arg || ''}` }]),
    },
    uptime: { desc: 'time since this page loaded', run: () => [`up ${uptime()}`] },
    date: { desc: 'today’s date', run: () => [new Date().toString()] },
    echo: { desc: 'print some text', run: (arg, raw) => [raw] },
    clear: { desc: 'clear the screen', run: () => 'clear' },
    exit: { desc: 'close the Terminal', run: () => 'exit' },
    sudo: { desc: '', hidden: true, run: () => [{ err: `${USER} is not in the sudoers file. This incident will be reported.` }] },
  };

  // ---- Rendering ---------------------------------------------------------------------

  function line(entry) {
    if (typeof entry === 'string') return h('div', {}, entry || ' ');
    const cls = entry.err ? 'term-err' : entry.accent ? 'term-accent' : 'term-dim';
    return h('div', { class: cls }, entry.err || entry.accent || entry.dim);
  }

  function complete(value) {
    const parts = value.split(/\s+/);
    const prefix = parts[parts.length - 1];
    let pool;
    if (parts.length === 1) pool = Object.keys(COMMANDS).filter((c) => !COMMANDS[c].hidden);
    else {
      const slash = prefix.lastIndexOf('/');
      const dir = lookup(resolve(slash >= 0 ? prefix.slice(0, slash) || '/' : '.'));
      const base = slash >= 0 ? prefix.slice(0, slash + 1) : '';
      pool = [...(isDir(dir) ? Object.keys(dir).map((k) => base + k) : []), ...D.projects.map((p) => p.id)];
    }
    const hits = pool.filter((o) => o.startsWith(prefix));
    if (hits.length !== 1) return value;
    return [...parts.slice(0, -1), hits[0]].join(' ') + (parts.length > 1 ? '' : ' ');
  }

  // Green falling glyphs over the terminal for a few seconds, or until a key is pressed.
  function matrixRain(root) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = h('canvas', { class: 'term-matrix', 'aria-hidden': 'true' });
    root.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const size = 14;
    canvas.width = root.clientWidth;
    canvas.height = root.clientHeight;
    const drops = Array.from({ length: Math.ceil(canvas.width / size) }, () => Math.random() * -40);
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#32d74b';
      ctx.font = `${size}px monospace`;
      drops.forEach((y, i) => {
        ctx.fillText(String.fromCharCode(0x30a0 + Math.floor(Math.random() * 96)), i * size, y * size);
        drops[i] = y * size > canvas.height && Math.random() > 0.97 ? 0 : y + 1;
      });
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      canvas.remove();
      document.removeEventListener('keydown', stop, true);
    };
    document.addEventListener('keydown', stop, true);
    setTimeout(stop, MATRIX_MS);
    draw();
  }

  function render(root, api) {
    root.classList.add('term');
    const out = h('div', { class: 'term-out', role: 'log', 'aria-live': 'polite' });
    const prompt = h('span', { class: 'term-prompt' });
    const input = h('input', { class: 'term-input', type: 'text', 'aria-label': 'Terminal command', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-fkey': 'term-input' });
    const print = (entries) => entries.forEach((e) => out.appendChild(line(e)));
    const promptText = () => `${USER}@${HOST} ${pretty(cwd)} %`;
    const paintPrompt = () => { prompt.textContent = promptText(); };
    const ctx = { matrix: () => matrixRain(root) };

    print([
      { dim: `Last login: ${new Date().toDateString()} on ttys000` },
      `Welcome to ${HOST}. Type 'help' for commands, 'ls' to look around, or 'neofetch'.`,
      '',
    ]);

    function run(raw) {
      const trimmed = raw.trim();
      out.appendChild(h('div', {}, h('span', { class: 'term-prompt' }, `${promptText()} `), h('span', { class: 'term-cmd' }, raw)));
      if (!trimmed) return;
      history = [...history, trimmed];
      cursor = history.length;
      const [name, ...rest] = trimmed.split(/\s+/);
      const key = name.toLowerCase();
      const command = Object.hasOwn(COMMANDS, key) ? COMMANDS[key] : null; // not 'constructor' etc.
      if (!command) {
        print([{ err: `zsh: command not found: ${name}` }]);
        return;
      }
      const result = command.run(rest.join(' '), trimmed.slice(name.length).trim(), ctx);
      if (result === 'clear') out.replaceChildren();
      else if (result === 'exit') api.close();
      else print(result);
      paintPrompt();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        run(input.value);
        input.value = '';
        input.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        cursor = Math.min(history.length, Math.max(0, cursor + (e.key === 'ArrowUp' ? -1 : 1)));
        input.value = history[cursor] || '';
      } else if (e.key === 'Tab' && !e.shiftKey) {
        // Only swallow Tab when it completes something, so keyboard users can still leave.
        const next = complete(input.value);
        if (next === input.value) return;
        e.preventDefault();
        input.value = next;
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        out.replaceChildren();
      }
    });

    root.addEventListener('click', () => {
      if (!window.getSelection().toString()) input.focus();
    });
    paintPrompt();
    root.append(out, h('div', { class: 'term-line' }, prompt, input));
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  function open() {
    return window.MacWM.open({
      id: 'terminal', title: `${USER} — zsh — 80×24`, app: 'Terminal', icon: 'terminal', chrome: 'terminal',
      width: 680, height: 430, minWidth: 360, minHeight: 200, view: { title: `${USER} — zsh`, render },
    });
  }

  window.MacTerminal = Object.freeze({ open });
})();
