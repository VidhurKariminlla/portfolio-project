/* Notes data layer: the note model, honest sample notes built from MacData, validation of
   everything read back from localStorage, and date labels. No DOM work here.
   -> window.MacNotesStore (load before notes-editor.js and notes.js) */
(function () {
  'use strict';

  const STORE_KEY = 'vos.notes';
  const SCHEMA = 1;
  const MIN_MS = 60000;
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  const RETENTION_DAYS = 30;
  const PREVIEW_CHARS = 160;
  const MAX_RUN_CHARS = 20000;
  const MAX_FOLDER_NAME = 60;
  const ID_PATTERN = /^[\w-]{1,64}$/;
  const BLOCK_TYPES = Object.freeze(['body', 'heading', 'check']);
  const ALL = 'all';
  const TRASH = 'trash';
  const DEFAULT_FOLDER = 'personal';
  const BUILTIN = Object.freeze([
    Object.freeze({ id: 'portfolio', name: 'Portfolio' }),
    Object.freeze({ id: 'personal', name: 'Personal' }),
  ]);
  const RESERVED = new Set([ALL, TRASH, ...BUILTIN.map((f) => f.id)]);
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

  // ---- Note model ------------------------------------------------------------------
  // note: { id, folderId, pinned, deleted, deletedAt, created, updated, blocks[] }
  // block: { type: 'body'|'heading'|'check', done, runs: [{ text, b, i }] }
  // The first block is the title line.

  const uid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const makeRun = (text, b, i) => ({ text, b: Boolean(b), i: Boolean(i) });
  const makeBlock = (type, text, done) => ({ type, done: type === 'check' && Boolean(done), runs: text ? [makeRun(text)] : [] });
  const blockText = (b) => b.runs.map((r) => r.text).join('');
  const noteTitle = (n) => blockText(n.blocks[0]).trim() || 'New Note';
  const notePreview = (n) => n.blocks.slice(1).map(blockText).join(' ').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
  const noteText = (n) => n.blocks.map(blockText).join('\n').toLowerCase();
  const isBlank = (n) => n.blocks.every((b) => !blockText(b).trim());
  const pinRank = (n) => (n.pinned && !n.deleted ? 0 : 1);

  function makeNote(folderId, blocks, ageMs, pinned) {
    const at = Date.now() - (ageMs || 0);
    return { id: uid(), folderId, pinned: Boolean(pinned), deleted: false, deletedAt: 0, created: at, updated: at, blocks };
  }

  // ---- Sample notes (only facts from MacData) ---------------------------------------

  const para = (t) => makeBlock('body', t);
  const head = (t) => makeBlock('heading', t);
  const check = (t, done) => makeBlock('check', t, done);

  function combo(keys) {
    const mods = keys.slice(0, -1);
    const key = keys[keys.length - 1];
    if (IS_MAC) return `${mods.map((m) => (m === 'shift' ? '⇧' : '⌥')).join('')}⌘${key}`;
    return ['Ctrl', ...mods.map((m) => (m === 'shift' ? 'Shift' : 'Alt')), key].join('+');
  }

  function welcomeNote() {
    return makeNote('personal', [
      para('Welcome to Notes'),
      para('This works like Notes on a Mac. The first line of a note becomes its title, and everything saves as you type.'),
      head('Finding your way'),
      para('Folders are in the sidebar. The middle column lists the notes in the selected folder, newest first, with pinned notes at the top. Type in Search to filter the list.'),
      head('Writing'),
      para('The buttons above a note add headings, bold, italic and checklists. Click the circle beside a checklist item to tick it.'),
      check('Tick this item', false),
      check('This one is already done', true),
      head('Where notes are kept'),
      para('Notes are saved in this browser, on this device only. Nothing is uploaded. Deleted notes stay in Recently Deleted for 30 days, where you can recover them.'),
      para('To start over, open the … menu and choose Reset to Sample Notes.'),
    ], 0, true);
  }

  function shortcutsNote() {
    const line = (keys, what) => para(`${combo(keys)} — ${what}`);
    return makeNote('personal', [
      para('Keyboard shortcuts'),
      head('While writing'),
      line(['B'], 'Bold'),
      line(['I'], 'Italic'),
      line(['shift', 'H'], 'Heading'),
      line(['shift', 'L'], 'Checklist'),
      line(['shift', 'U'], 'Tick or untick checklist items'),
      para('Return on an empty checklist item ends the checklist. Esc goes back to the note list.'),
      head('In the note list'),
      para('↑ and ↓ — Move between notes'),
      para('Return — Open the selected note'),
      para('Delete — Move the note to Recently Deleted'),
      head('Anywhere in Notes'),
      line(['alt', 'F'], 'Search notes'),
      para('Esc in Search — Clear the search'),
      para('Some browsers keep a few of these combinations for themselves.'),
    ], MIN_MS);
  }

  function projectNotes(projects) {
    const lead = projects[0];
    return [
      makeNote('portfolio', [
        para(`Now building: ${lead.title}`),
        ...lead.summary.map(para),
        head('Features'),
        ...lead.features.map((f) => check(f, true)),
        head('Worth knowing'),
        para(lead.notes),
      ], HOUR_MS),
      makeNote('portfolio', [para('Project index'), ...projects.map((p) => para(`${p.title} — ${p.tagline}`))], 3 * DAY_MS),
    ];
  }

  function seedNotes() {
    const D = window.MacData;
    const about = D && D.profile ? [makeNote('portfolio', [para('About me'), ...D.profile.about.map(para)], 2 * DAY_MS)] : [];
    const projects = D && D.projects && D.projects.length ? projectNotes(D.projects) : [];
    return [welcomeNote(), shortcutsNote(), ...projects, ...about];
  }

  // ---- Storage: validate everything read back ---------------------------------------

  const isStr = (v) => typeof v === 'string';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function cleanRun(r) {
    return r && isStr(r.text) ? makeRun(r.text.slice(0, MAX_RUN_CHARS), r.b === true, r.i === true) : null;
  }

  function cleanBlock(b) {
    if (!b || !BLOCK_TYPES.includes(b.type) || !Array.isArray(b.runs)) return null;
    return { type: b.type, done: b.type === 'check' && b.done === true, runs: b.runs.map(cleanRun).filter(Boolean) };
  }

  function cleanNote(n, folderIds) {
    if (!n || !isStr(n.id) || !ID_PATTERN.test(n.id) || !isStr(n.folderId)) return null;
    if (!Array.isArray(n.blocks) || !isNum(n.created) || !isNum(n.updated)) return null;
    const blocks = n.blocks.map(cleanBlock).filter(Boolean);
    return {
      id: n.id,
      folderId: folderIds.has(n.folderId) ? n.folderId : DEFAULT_FOLDER,
      pinned: n.pinned === true,
      deleted: n.deleted === true,
      deletedAt: isNum(n.deletedAt) ? n.deletedAt : 0,
      created: n.created,
      updated: n.updated,
      blocks: blocks.length ? blocks : [makeBlock('body', '')],
    };
  }

  function cleanFolders(list) {
    const seen = new Set();
    return list
      .filter((f) => f && isStr(f.id) && ID_PATTERN.test(f.id) && !RESERVED.has(f.id) && isStr(f.name) && f.name.trim())
      .filter((f) => !seen.has(f.id) && seen.add(f.id))
      .map((f) => ({ id: f.id, name: f.name.trim().slice(0, MAX_FOLDER_NAME) }));
  }

  function parseStore(raw) {
    if (!raw) return null;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return null; // corrupt JSON: the caller falls back to the sample notes
    }
    if (!data || data.v !== SCHEMA || !Array.isArray(data.folders) || !Array.isArray(data.notes)) return null;
    const folders = cleanFolders(data.folders);
    const ids = new Set([...BUILTIN, ...folders].map((f) => f.id));
    const seen = new Set();
    const notes = data.notes.map((n) => cleanNote(n, ids)).filter((n) => n && !seen.has(n.id) && seen.add(n.id));
    return { folders, notes };
  }

  // Returns { folders: custom folders, notes }, dropping notes deleted over 30 days ago.
  function load() {
    const base = parseStore(window.MacDOM.readStore('localStorage', STORE_KEY)) || { folders: [], notes: seedNotes() };
    const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
    return { ...base, notes: base.notes.filter((n) => !n.deleted || n.deletedAt > cutoff) };
  }

  function save(db) {
    window.MacDOM.writeStore('localStorage', STORE_KEY, JSON.stringify({ v: SCHEMA, folders: db.folders, notes: db.notes }));
  }

  const fresh = () => ({ folders: [], notes: seedNotes() });

  // ---- Dates -----------------------------------------------------------------------

  function startOfDay(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  const daysAgo = (ts, today) => Math.round((today - startOfDay(ts)) / DAY_MS);

  function groupLabel(n, today) {
    if (pinRank(n) === 0) return 'Pinned';
    const days = daysAgo(n.updated, today);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days <= 7) return 'Previous 7 Days';
    if (days <= 30) return 'Previous 30 Days';
    return new Date(n.updated).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function shortDate(ts, today) {
    const days = daysAgo(ts, today);
    const d = new Date(ts);
    if (days <= 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }

  const longDate = (ts) => new Date(ts).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  window.MacNotesStore = Object.freeze({
    ALL, TRASH, DEFAULT_FOLDER, BUILTIN, BLOCK_TYPES, DAY_MS, RETENTION_DAYS, MAX_FOLDER_NAME,
    uid, makeRun, makeBlock, makeNote, blockText, noteTitle, notePreview, noteText, isBlank, pinRank,
    load, save, fresh, startOfDay, groupLabel, shortDate, longDate,
  });
})();
