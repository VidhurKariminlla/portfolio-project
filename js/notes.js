/* Notes: an Apple Notes-style app. Folders live in the window sidebar, the middle column
   lists notes grouped by date with in-place search, and the editor (MacNotesEditor)
   supports a title line, headings, bold, italic and tickable checklists. Data, samples
   and validation live in MacNotesStore. -> window.MacNotes
   Load order: notes-store.js, notes-editor.js, notes.js. */
(function () {
  'use strict';

  const { h } = window.MacDOM;
  const I = window.MacIcons;
  const S = window.MacNotesStore;
  const E = window.MacNotesEditor;
  const { ALL, TRASH, DEFAULT_FOLDER, BUILTIN, DAY_MS, RETENTION_DAYS, MAX_FOLDER_NAME } = S;

  const SAVE_DELAY_MS = 400;

  const svg = (body, size) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  const P_FOLDER = '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>';
  const P_TRASH = '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/>';
  const P_PIN = '<path d="M14.5 3.5l6 6-2.6.9-3.6 3.6-.6 4.5-7.6-7.6 4.5-.6 3.6-3.6z"/><path d="M8.2 15.8L3.5 20.5"/>';
  const ICONS = Object.freeze({
    compose: svg('<path d="M11.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><path d="M17.8 3.7a1.9 1.9 0 0 1 2.7 2.7l-8.1 8.1-3.6.9.9-3.6z"/>', 18),
    trash: svg(P_TRASH, 18),
    checklist: svg('<circle cx="6" cy="7.5" r="2.2"/><circle cx="6" cy="16.5" r="2.2"/><path d="M11 7.5h9M11 16.5h9"/>', 18),
    pin: svg(P_PIN, 17),
    recover: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>', 18),
    more: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12h.01M12 12h.01M15.8 12h.01" stroke-width="2.4"/>', 18),
    back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>', 20),
    plus: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/>', 16),
    folder: svg(P_FOLDER, 16),
    trashSmall: svg(P_TRASH, 16),
    folderTiny: svg(P_FOLDER, 12),
    pinTiny: svg(P_PIN, 11),
    heading: '<span class="nt-glyph nt-glyph-h">Aa</span>',
    bold: '<span class="nt-glyph nt-glyph-b">B</span>',
    italic: '<span class="nt-glyph nt-glyph-i">I</span>',
  });

  // ---- State -----------------------------------------------------------------------

  let db = null; // { folders: custom folders, notes } (loaded on first open)
  let state = { folder: ALL, noteId: null, query: '', pane: 'list', renaming: null };
  let ui = null; // DOM references for the open window, rebuilt on every render
  let apiRef = null;
  let saveTimer = 0;
  let listScroll = 0;

  const setState = (patch) => {
    state = { ...state, ...patch };
  };
  const allFolders = () => [...BUILTIN, ...db.folders];
  const isCustom = (id) => db.folders.some((f) => f.id === id);
  const byId = (id) => db.notes.find((n) => n.id === id) || null;
  const inFolder = (n, id) => (id === TRASH ? n.deleted : !n.deleted && (id === ALL || n.folderId === id));
  const notesIn = (id) => db.notes.filter((n) => inFolder(n, id)).sort((a, b) => S.pinRank(a) - S.pinRank(b) || b.updated - a.updated);
  const countLabel = (n) => (n === 1 ? '1 note' : `${n} notes`);
  const persist = () => S.save(db);

  function folderName(id) {
    if (id === ALL) return 'All Notes';
    if (id === TRASH) return 'Recently Deleted';
    const f = allFolders().find((x) => x.id === id);
    return f ? f.name : 'Notes';
  }

  function updateNote(id, patch) {
    db = { ...db, notes: db.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
  }

  const removeNote = (id) => {
    db = { ...db, notes: db.notes.filter((n) => n.id !== id) };
  };

  function uniqueName(base, exceptId) {
    const taken = new Set(allFolders().filter((f) => f.id !== exceptId).map((f) => f.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
    return `${base} ${n}`;
  }

  // ---- Saving ----------------------------------------------------------------------

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveEditor, SAVE_DELAY_MS);
  }

  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveEditor();
  }

  // Reads the editor back into the note. Only patches list text in place (never replaces
  // list rows), so a save can't swallow a click that is in progress on the list.
  function saveEditor() {
    saveTimer = 0;
    const note = ui && ui.editor ? byId(ui.noteId) : null;
    if (!note || note.deleted) return;
    const blocks = ui.editor.read();
    if (JSON.stringify(blocks) === JSON.stringify(note.blocks)) return;
    updateNote(note.id, { blocks, updated: Date.now() });
    persist();
    patchListItem(byId(note.id));
    if (ui.stamp) ui.stamp.textContent = S.longDate(Date.now());
  }

  // Every structural change goes through here: save the editor, apply, drop a blank note
  // the user just left (as Notes does), persist, and re-render the window.
  function commit(change) {
    flush();
    const prevId = state.noteId;
    change();
    const prev = prevId && prevId !== state.noteId ? byId(prevId) : null;
    if (prev && !prev.deleted && S.isBlank(prev)) removeNote(prevId);
    persist();
    if (apiRef) apiRef.refresh();
  }

  // ---- Actions ---------------------------------------------------------------------

  function selectFolder(id) {
    if (id === state.folder) {
      showPane('list');
      focusSelected();
      return;
    }
    listScroll = 0;
    commit(() => setState({ folder: id, noteId: (notesIn(id)[0] || {}).id || null, query: '', pane: 'list', renaming: null }));
    if (apiRef && apiRef.el.classList.contains('is-narrow')) focusSelected();
  }

  function selectNote(id) {
    commit(() => setState({ noteId: id }));
    focusSelected();
  }

  function openNote(id) {
    if (id !== state.noteId) commit(() => setState({ noteId: id, pane: 'editor' }));
    else showPane('editor');
    const item = ui.list.querySelector('.nt-item.is-selected');
    if (isShown(item)) item.focus();
    else if (isShown(ui.back)) ui.back.focus();
  }

  function newNote() {
    const folderId = state.folder === ALL || state.folder === TRASH ? DEFAULT_FOLDER : state.folder;
    const note = S.makeNote(folderId, [S.makeBlock('body', '')], 0, false);
    commit(() => {
      db = { ...db, notes: [note, ...db.notes] };
      setState({ noteId: note.id, folder: state.folder === TRASH ? ALL : state.folder, query: '', pane: 'editor' });
    });
    focusEditor();
  }

  function neighborOf(id) {
    const ids = ui ? [...ui.list.querySelectorAll('.nt-item:not([hidden])')].map((el) => el.dataset.note) : [];
    const i = ids.indexOf(id);
    return (i >= 0 && (ids[i + 1] || ids[i - 1])) || null;
  }

  function deleteNote(id, refocus) {
    const note = byId(id);
    if (!note) return;
    if (note.deleted) {
      confirmSheet({
        title: 'Delete this note?',
        message: 'It will be deleted immediately. You can’t undo this action.',
        action: 'Delete',
        onConfirm: () => removeForGood(id, refocus),
      });
      return;
    }
    const next = neighborOf(id);
    commit(() => {
      if (S.isBlank(byId(id))) removeNote(id);
      else updateNote(id, { deleted: true, deletedAt: Date.now() });
      setState({ noteId: next });
    });
    if (refocus) focusSelected();
  }

  function removeForGood(id, refocus) {
    const next = neighborOf(id);
    commit(() => {
      removeNote(id);
      setState({ noteId: next });
    });
    if (refocus) focusSelected();
  }

  function recoverNote(id) {
    commit(() => {
      const note = byId(id);
      const folderId = allFolders().some((f) => f.id === note.folderId) ? note.folderId : DEFAULT_FOLDER;
      updateNote(id, { deleted: false, deletedAt: 0, folderId });
      setState({ folder: folderId, noteId: id, query: '' });
    });
  }

  function togglePin(id) {
    commit(() => updateNote(id, { pinned: !byId(id).pinned }));
  }

  function moveNote(id, folderId) {
    const next = state.folder === ALL ? id : neighborOf(id);
    commit(() => {
      updateNote(id, { folderId });
      setState({ noteId: next });
    });
  }

  function newFolder() {
    const folder = { id: S.uid(), name: uniqueName('New Folder') };
    commit(() => {
      db = { ...db, folders: [...db.folders, folder] };
      setState({ folder: folder.id, noteId: null, renaming: folder.id, query: '', pane: 'folders' });
    });
    focusRename();
  }

  function startRename(id) {
    commit(() => setState({ renaming: id, pane: 'folders' }));
    focusRename();
  }

  function finishRename(id, value) {
    if (state.renaming !== id) return;
    const name = value.trim().slice(0, MAX_FOLDER_NAME);
    commit(() => {
      if (name) db = { ...db, folders: db.folders.map((f) => (f.id === id ? { ...f, name: uniqueName(name, id) } : f)) };
      setState({ renaming: null });
    });
    focusFolder(id);
  }

  function deleteFolder(id) {
    const count = notesIn(id).length;
    const run = () =>
      commit(() => {
        const now = Date.now();
        db = {
          folders: db.folders.filter((f) => f.id !== id),
          notes: db.notes.map((n) => (n.folderId === id && !n.deleted ? { ...n, deleted: true, deletedAt: now } : n)),
        };
        setState({ folder: ALL, noteId: null, pane: 'list' });
      });
    if (!count) {
      run();
      return;
    }
    confirmSheet({
      title: `Delete “${folderName(id)}”?`,
      message: `Its ${count === 1 ? 'note' : `${count} notes`} will move to Recently Deleted.`,
      action: 'Delete',
      onConfirm: run,
    });
  }

  function askReset() {
    confirmSheet({
      title: 'Reset to sample notes?',
      message: 'This replaces all of your notes and folders with the original samples. You can’t undo this action.',
      action: 'Reset',
      onConfirm: () => {
        listScroll = 0;
        commit(() => {
          db = S.fresh();
          state = { folder: ALL, noteId: null, query: '', pane: 'list', renaming: null };
        });
      },
    });
  }

  // ---- Panes and focus -------------------------------------------------------------

  const isShown = (el) => Boolean(el && el.isConnected && el.getClientRects().length);

  function showPane(pane) {
    setState({ pane });
    if (ui) ui.root.dataset.pane = pane;
  }

  function focusSelected() {
    if (!ui) return;
    const item = ui.list.querySelector('.nt-item[tabindex="0"]');
    if (isShown(item)) item.focus();
    else if (isShown(ui.search)) ui.search.focus();
  }

  function focusEditor() {
    if (ui && ui.editor && isShown(ui.editor.el)) ui.editor.el.focus();
  }

  function focusIn(selector, select) {
    requestAnimationFrame(() => {
      const el = apiRef && [...apiRef.el.querySelectorAll(selector)].find(isShown);
      if (!el) return;
      el.focus();
      if (select) el.select();
    });
  }

  const focusRename = () => focusIn('.nt-rename', true);
  const focusFolder = (id) => focusIn(`[data-fkey="nt-folder-${id}"]`, false);

  // ---- Folders (sidebar, and an in-window pane when the sidebar is hidden) ----------

  function folderItem(id, label, icon, count) {
    const active = state.folder === id;
    return h(
      'button',
      {
        class: `side-item nt-folder${active ? ' is-active' : ''}`,
        type: 'button',
        'aria-current': active ? 'true' : null,
        'data-fkey': `nt-folder-${id}`,
        onclick: () => selectFolder(id),
        ondblclick: isCustom(id) ? () => startRename(id) : null,
      },
      h('span', { class: 'side-icon', html: icon }),
      h('span', { class: 'side-label' }, label),
      h('span', { class: 'side-count' }, String(count))
    );
  }

  function renameField(f) {
    const input = h('input', {
      class: 'nt-rename',
      type: 'text',
      value: f.name,
      maxlength: String(MAX_FOLDER_NAME),
      'aria-label': 'Folder name',
      onkeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finishRename(f.id, e.key === 'Enter' ? input.value : f.name);
      },
      onblur: () => finishRename(f.id, input.value),
    });
    return h('div', { class: 'side-item nt-renaming' }, h('span', { class: 'side-icon', html: ICONS.folder }), input);
  }

  function folderNav() {
    const trashCount = notesIn(TRASH).length;
    return [
      h('p', { class: 'side-heading' }, 'iCloud'),
      folderItem(ALL, 'All Notes', ICONS.folder, notesIn(ALL).length),
      allFolders().map((f) => (state.renaming === f.id ? renameField(f) : folderItem(f.id, f.name, ICONS.folder, notesIn(f.id).length))),
      trashCount || state.folder === TRASH ? folderItem(TRASH, 'Recently Deleted', ICONS.trashSmall, trashCount) : null,
      h(
        'button',
        { class: 'nt-newfolder', type: 'button', 'data-fkey': 'nt-newfolder', onclick: newFolder },
        h('span', { class: 'nt-newfolder-icon', html: ICONS.plus }),
        'New Folder'
      ),
    ];
  }

  function sidebar(side) {
    window.MacDOM.append(side, [h('div', { class: 'notes-app nt-side' }, folderNav())]);
  }

  function foldersPane() {
    return h(
      'section',
      { class: 'nt-folders', 'aria-label': 'Folders' },
      h('h2', { class: 'nt-pane-title' }, 'Folders'),
      h('nav', { class: 'nt-folders-list' }, folderNav())
    );
  }

  // ---- Note list -------------------------------------------------------------------

  function searchInput() {
    const input = h('input', {
      class: 'nt-search-input',
      type: 'search',
      placeholder: 'Search',
      'aria-label': 'Search notes',
      'data-fkey': 'nt-search',
      value: state.query,
      oninput: () => {
        setState({ query: input.value });
        applySearch();
      },
      onkeydown: (e) => {
        if (e.key === 'Escape' && input.value) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          setState({ query: '' });
          applySearch();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusSelected();
        }
      },
    });
    return input;
  }

  function listPane() {
    const notes = notesIn(state.folder);
    ui.search = searchInput();
    ui.list = h('div', {
      class: 'nt-list',
      role: 'listbox',
      'aria-label': folderName(state.folder),
      onkeydown: onListKey,
      onscroll: (e) => {
        listScroll = e.target.scrollTop;
      },
    });
    ui.empty = h('p', { class: 'nt-list-empty', hidden: true });
    return h(
      'section',
      { class: 'nt-list-pane', 'aria-label': 'Notes' },
      h(
        'header',
        { class: 'nt-list-head' },
        h('button', { class: 'nt-back nt-back-folders', type: 'button', 'data-fkey': 'nt-back-folders', onclick: () => showPane('folders') },
          h('span', { class: 'nt-back-icon', html: ICONS.back }), 'Folders'),
        h('div', { class: 'nt-list-titles' },
          h('h2', { class: 'nt-pane-title' }, folderName(state.folder)),
          h('span', { class: 'nt-count' }, countLabel(notes.length))),
        h('label', { class: 'nt-search' }, h('span', { class: 'nt-search-icon', html: I.glyph('search', 13) }), ui.search)
      ),
      ui.list,
      ui.empty
    );
  }

  function noteItem(n, today) {
    const selected = n.id === state.noteId;
    const showFolder = state.folder === ALL || state.folder === TRASH;
    return h(
      'div',
      {
        class: `nt-item${selected ? ' is-selected' : ''}`,
        role: 'option',
        tabindex: '-1',
        'aria-selected': String(selected),
        'data-note': n.id,
        'data-fkey': `nt-note-${n.id}`,
        onclick: () => openNote(n.id),
      },
      h('span', { class: 'nt-item-title' },
        S.pinRank(n) === 0 ? h('span', { class: 'nt-item-pin', html: ICONS.pinTiny }) : null,
        h('span', { class: 'nt-item-text' }, S.noteTitle(n))),
      h('span', { class: 'nt-item-sub' },
        h('span', { class: 'nt-item-date' }, S.shortDate(n.updated, today)),
        h('span', { class: 'nt-item-preview' }, S.notePreview(n) || 'No additional text')),
      showFolder ? h('span', { class: 'nt-item-folder' }, h('span', { class: 'nt-item-folder-icon', html: ICONS.folderTiny }), folderName(n.folderId)) : null
    );
  }

  function groupNotes(notes, today) {
    return notes.reduce((groups, n) => {
      const label = S.groupLabel(n, today);
      const last = groups[groups.length - 1];
      if (last && last.label === label) return [...groups.slice(0, -1), { label, notes: [...last.notes, n] }];
      return [...groups, { label, notes: [n] }];
    }, []);
  }

  function renderList() {
    const today = S.startOfDay(Date.now());
    const groups = groupNotes(notesIn(state.folder), today);
    ui.list.replaceChildren(
      ...groups.map((g, gi) =>
        h('div', { class: 'nt-group', role: 'group', 'aria-labelledby': `nt-group-${gi}` },
          h('h3', { class: 'nt-group-title', id: `nt-group-${gi}` }, g.label),
          g.notes.map((n) => noteItem(n, today)))
      )
    );
    applySearch();
  }

  // Search hides rows in place, so typing never re-renders and never loses focus.
  function applySearch() {
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const items = [...ui.list.querySelectorAll('.nt-item')];
    items.forEach((el) => {
      const n = byId(el.dataset.note);
      el.hidden = terms.length > 0 && !(n && terms.every((t) => S.noteText(n).includes(t)));
    });
    ui.list.querySelectorAll('.nt-group').forEach((g) => {
      g.hidden = !g.querySelector('.nt-item:not([hidden])');
    });
    const shown = items.filter((el) => !el.hidden);
    const rover = shown.find((el) => el.classList.contains('is-selected')) || shown[0];
    items.forEach((el) => el.setAttribute('tabindex', el === rover ? '0' : '-1'));
    ui.empty.hidden = shown.length > 0;
    if (shown.length) return;
    if (terms.length) ui.empty.textContent = `No results for “${state.query.trim()}”`;
    else ui.empty.textContent = state.folder === TRASH ? 'No notes in Recently Deleted' : 'No Notes';
  }

  function patchListItem(n) {
    const el = n && ui && [...ui.list.querySelectorAll('.nt-item')].find((x) => x.dataset.note === n.id);
    if (!el) return;
    el.querySelector('.nt-item-text').textContent = S.noteTitle(n);
    el.querySelector('.nt-item-date').textContent = S.shortDate(n.updated, S.startOfDay(Date.now()));
    el.querySelector('.nt-item-preview').textContent = S.notePreview(n) || 'No additional text';
  }

  function onListKey(e) {
    const item = e.target.closest('.nt-item');
    if (!item) return;
    const items = [...ui.list.querySelectorAll('.nt-item:not([hidden])')];
    const i = items.indexOf(item);
    const go = (j) => {
      const target = items[Math.max(0, Math.min(items.length - 1, j))];
      if (target && target !== item) selectNote(target.dataset.note);
    };
    const keys = {
      ArrowDown: () => go(i + 1),
      ArrowUp: () => go(i - 1),
      Home: () => go(0),
      End: () => go(items.length - 1),
      Enter: () => {
        showPane('editor');
        focusEditor();
      },
      Delete: () => deleteNote(item.dataset.note, true),
      Backspace: () => deleteNote(item.dataset.note, true),
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
  }

  // ---- Editor pane -----------------------------------------------------------------

  function setPressed(key, on) {
    const btn = ui && ui.tools[key];
    if (btn) btn.setAttribute('aria-pressed', String(Boolean(on)));
  }

  function onSelection(s) {
    setPressed('bold', s.bold);
    setPressed('italic', s.italic);
    setPressed('heading', s.heading);
    setPressed('checklist', s.checklist);
  }

  function leaveEditor() {
    flush();
    showPane('list');
    focusSelected();
  }

  const runCommand = (cmd) => () => {
    if (ui && ui.editor) ui.editor.run(cmd);
  };

  function tool(key, label, icon, onPress, opts) {
    const o = opts || {};
    const btn = h('button', {
      class: 'nt-tool',
      type: 'button',
      title: label,
      'aria-label': label,
      'data-fkey': `nt-tool-${key}`,
      'aria-pressed': o.pressed == null ? null : String(o.pressed),
      'aria-haspopup': o.menu ? 'menu' : null,
      'aria-expanded': o.menu ? 'false' : null,
      disabled: Boolean(o.disabled),
      onmousedown: (e) => e.preventDefault(), // keep the editor's selection
      onclick: onPress,
      html: icon,
    });
    ui.tools[key] = btn;
    return btn;
  }

  function formatTools(readOnly) {
    return h('div', { class: 'nt-tool-group' },
      tool('heading', 'Heading', ICONS.heading, runCommand('heading'), { disabled: readOnly, pressed: false }),
      tool('bold', 'Bold', ICONS.bold, runCommand('bold'), { disabled: readOnly, pressed: false }),
      tool('italic', 'Italic', ICONS.italic, runCommand('italic'), { disabled: readOnly, pressed: false }),
      tool('checklist', 'Checklist', ICONS.checklist, runCommand('check'), { disabled: readOnly, pressed: false }));
  }

  function noteTools(note) {
    const deleted = Boolean(note && note.deleted);
    const pinned = Boolean(note && note.pinned);
    return h('div', { class: 'nt-tool-group' },
      deleted ? tool('recover', 'Recover Note', ICONS.recover, () => recoverNote(note.id)) : null,
      tool('pin', pinned ? 'Unpin Note' : 'Pin Note', ICONS.pin, () => togglePin(note.id), { disabled: !note || deleted, pressed: pinned }),
      tool('delete', deleted ? 'Delete Permanently' : 'Delete Note', ICONS.trash, () => deleteNote(note.id), { disabled: !note }),
      tool('new', 'New Note', ICONS.compose, newNote),
      tool('more', 'More', ICONS.more, (e) => toggleMenu(e.currentTarget), { menu: true }));
  }

  function toolbar(note) {
    ui.back = h('button', { class: 'nt-back nt-back-list', type: 'button', 'data-fkey': 'nt-back-list', 'aria-label': `Back to ${folderName(state.folder)}`, onclick: leaveEditor },
      h('span', { class: 'nt-back-icon', html: ICONS.back }), h('span', { class: 'nt-back-label' }, folderName(state.folder)));
    return h('div', { class: 'nt-toolbar', role: 'group', 'aria-label': 'Note tools' },
      ui.back, formatTools(!note || note.deleted), h('span', { class: 'nt-spacer' }), noteTools(note));
  }

  function deletedBanner(note) {
    const left = Math.max(1, RETENTION_DAYS - Math.floor((Date.now() - note.deletedAt) / DAY_MS));
    return h(
      'div',
      { class: 'nt-banner', role: 'note' },
      h('span', {}, `This note is in Recently Deleted and will be removed in ${left === 1 ? '1 day' : `${left} days`}.`),
      h('button', { class: 'nt-btn', type: 'button', onclick: () => recoverNote(note.id) }, 'Recover')
    );
  }

  function editorPane(note) {
    const pane = h('section', { class: 'nt-editor-pane', 'aria-label': 'Note' }, toolbar(note));
    if (!note) {
      pane.append(h('div', { class: 'nt-no-note' }, h('p', {}, 'No Note Selected'),
        state.folder === TRASH ? null : h('button', { class: 'nt-btn', type: 'button', onclick: newNote }, 'New Note')));
      return pane;
    }
    ui.noteId = note.id;
    ui.stamp = h('p', { class: 'nt-stamp' }, S.longDate(note.updated));
    ui.editor = E.create(note.blocks, {
      readOnly: note.deleted,
      onChange: scheduleSave,
      onBlur: flush,
      onEscape: leaveEditor,
      onSelection,
    });
    const scroller = h('div', {
      class: 'nt-scroll',
      onclick: (e) => {
        if (e.target === scroller && !note.deleted) focusEditor();
      },
    }, note.deleted ? deletedBanner(note) : null, ui.stamp, ui.editor.el);
    pane.append(scroller);
    return pane;
  }

  // ---- Menu and confirmation sheet ---------------------------------------------------

  function menuItems() {
    const note = byId(state.noteId);
    const moves = note && !note.deleted
      ? allFolders().filter((f) => f.id !== note.folderId).map((f) => ({ label: `Move to “${f.name}”`, run: () => moveNote(note.id, f.id) }))
      : [];
    const folder = isCustom(state.folder)
      ? [{ label: 'Rename Folder…', run: () => startRename(state.folder) }, { label: 'Delete Folder…', run: () => deleteFolder(state.folder) }]
      : [];
    const groups = [moves, folder, [{ label: 'Reset to Sample Notes…', run: askReset }]].filter((g) => g.length);
    return groups.flatMap((g, i) => (i ? [null, ...g] : g));
  }

  function menuEntry(it) {
    if (!it) return h('div', { class: 'nt-menu-sep', role: 'separator' });
    const onclick = () => {
      closeMenu(false);
      it.run();
    };
    return h('button', { class: 'nt-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', onclick }, it.label);
  }

  function toggleMenu(btn) {
    if (ui.menu) {
      closeMenu(false);
      return;
    }
    const menu = h('div', { class: 'nt-menu', role: 'menu', 'aria-label': 'More', onkeydown: onMenuKey }, menuItems().map(menuEntry));
    const box = ui.root.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom - box.top + 6)}px`;
    menu.style.right = `${Math.max(8, Math.round(box.right - r.right))}px`;
    ui.root.appendChild(menu);
    const onOutside = (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu(false);
    };
    ui.menu = { el: menu, btn, onOutside };
    document.addEventListener('pointerdown', onOutside, true);
    btn.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('.nt-menu-item');
    if (first) first.focus();
  }

  function closeMenu(refocus) {
    if (!ui || !ui.menu) return;
    const { el, btn, onOutside } = ui.menu;
    document.removeEventListener('pointerdown', onOutside, true);
    el.remove();
    btn.setAttribute('aria-expanded', 'false');
    ui.menu = null;
    if (refocus) btn.focus();
  }

  function onMenuKey(e) {
    const items = [...ui.menu.el.querySelectorAll('.nt-menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  }

  function confirmSheet({ title, message, action, onConfirm }) {
    const previous = document.activeElement;
    const cancel = h('button', { class: 'nt-btn', type: 'button', onclick: () => done(false) }, 'Cancel');
    const ok = h('button', { class: 'nt-btn is-destructive', type: 'button', onclick: () => done(true) }, action);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      }
    };
    const veil = h('div', { class: 'nt-veil', onkeydown: onKey },
      h('div', { class: 'nt-sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'nt-sheet-title', 'aria-describedby': 'nt-sheet-msg' },
        h('h2', { id: 'nt-sheet-title' }, title),
        h('p', { id: 'nt-sheet-msg' }, message),
        h('div', { class: 'nt-sheet-actions' }, cancel, ok)));
    function done(confirmed) {
      veil.remove();
      if (confirmed) onConfirm();
      else if (previous && previous.isConnected) previous.focus();
    }
    ui.root.appendChild(veil);
    cancel.focus();
  }

  // ---- Window ----------------------------------------------------------------------

  function onRootKey(e) {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.code !== 'KeyF') return;
    e.preventDefault();
    showPane('list');
    ui.search.focus();
  }

  function ensureSelection() {
    const list = notesIn(state.folder);
    if (state.noteId && list.some((n) => n.id === state.noteId)) return;
    setState({ noteId: list.length ? list[0].id : null });
  }

  function render(root, api) {
    if (ui) closeMenu(false);
    apiRef = api;
    if (!db) db = S.load();
    ensureSelection();
    const main = h('div', { class: 'notes-app nt-main', 'data-pane': state.pane, onkeydown: onRootKey });
    ui = { root: main, tools: {}, list: null, empty: null, search: null, editor: null, stamp: null, back: null, menu: null, noteId: null };
    main.append(foldersPane(), listPane(), editorPane(byId(state.noteId)));
    root.append(main);
    renderList();
    ui.list.scrollTop = listScroll;
    if (state.renaming) focusRename();
  }

  function onVisibility() {
    if (document.hidden) flush();
  }

  function onClose() {
    flush();
    closeMenu(false);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    setState({ renaming: null });
    ui = null;
    apiRef = null;
  }

  function open() {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return window.MacWM.open({
      id: 'notes',
      title: 'Notes',
      app: 'Notes',
      icon: 'notes',
      width: 900,
      height: 580,
      minWidth: 420,
      minHeight: 320,
      sidebar,
      onClose,
      view: { title: 'Notes', render },
    });
  }

  window.MacNotes = Object.freeze({ open });
})();
