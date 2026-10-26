# Vidhur OS

A portfolio presented as a macOS 26-style desktop: lock screen, menu bar, Dock, widgets,
Spotlight, Launchpad, Notification Center, Control Center and System Settings, with a
Finder-style project gallery and working apps (Blockcraft, Music, Notes, Calculator,
Terminal). On phones it becomes an iPhone-style home screen. Plain HTML, CSS and classic
`<script>` tags: no framework, no build step, no dependencies. It also works opened
straight from the filesystem (`file://`).

## Editing content

Almost everything you'd change lives in [`js/data.js`](js/data.js):

- `profile`: name, role, bio paragraphs, skills, activities and links.
  `email`, `github` and `linkedin` are empty for now. Fill them in and they appear in
  Contact, About, the resume and the Terminal automatically. `linkedin` takes a full URL.
- `projects`: one entry per project. Each has a `summary`, `features`, `stack` and
  `notes`. `notes` is the "Worth knowing" box: what the project does not do well yet.
- `thumb(uid)` returns the cover art as an SVG string. Always suffix ids with `uid` so
  gradients don't collide when the same cover appears twice.

Apps are listed once in [`js/registry.js`](js/registry.js); the Dock, Launchpad,
Spotlight, Finder's Applications folder and the phone home screen all read that list.

## Previewing

```bash
python3 scripts/serve.py
```

Then open http://127.0.0.1:8000. The server sends `Cache-Control: no-store`, so a reload
always shows your latest edit. Opening `index.html` directly also works.

The boot and lock screens only show once per tab. To see them again, use the system menu
(the diamond, top left) → Restart, or open a new tab. Keyboard: Cmd/Ctrl+K opens
Spotlight, Cmd/Ctrl+, opens System Settings.

## Deploying (GitHub Pages)

1. Bump every `?v=N` in `index.html` so visitors don't get stale CSS or JS.
2. Push to `main`.
3. Repository Settings → Pages → Deploy from a branch → `main`, `/ (root)`.

There is nothing to build.

## Layout

```
index.html              wallpaper, desktop, menu bar, status bar, Dock, boot screens
assets/wallpapers/      two CC0 photos and their picker thumbnails
css/                    tokens + themes, desktop, windows, menu bar, Dock, apps,
                        overlays (Spotlight, Launchpad, Notification Center), settings,
                        and one file per app (music, blockcraft, notes, calculator), boot
js/dom.js               DOM and storage helpers                 -> MacDOM
js/theme.js             light / dark / auto                     -> MacTheme
js/prefs.js             wallpaper, Dock and sound settings      -> MacPrefs
js/data.js              profile and project content             -> MacData
js/icons.js             squircle app icons and line glyphs      -> MacIcons
js/audio.js             synthesised sound effects               -> MacAudio
js/menu.js              menus and right-click menus             -> MacMenu
js/windows.js           window manager + view stack             -> MacWM
js/registry.js          the list of apps                        -> MacRegistry
js/dock.js              the Dock                                -> MacDock
js/finder.js            Finder: projects, Applications, Documents -> MacFinder
js/apps.js              About, Resume, Contact, Trash, alerts, notifications -> MacApps
js/terminal.js          Terminal with a virtual file system     -> MacTerminal
js/settings.js          System Settings                         -> MacSettings
js/spotlight.js         Spotlight                               -> MacSpotlight
js/launchpad.js         Launchpad                               -> MacLaunchpad
js/notifcenter.js       Notification Center                     -> MacNotifCenter
js/music-engine.js      Web Audio sequencer and the songs       -> MacMusicEngine
js/music.js             Music app                               -> MacMusic
js/blockcraft-world.js  voxel terrain, textures, meshing        -> MacBlockcraftWorld
js/blockcraft-gl.js     WebGL renderer                          -> MacBlockcraftGL
js/blockcraft.js        Blockcraft app                          -> MacBlockcraft
js/notes-store.js       Notes model, samples, storage           -> MacNotesStore
js/notes-editor.js      Notes editing surface                   -> MacNotesEditor
js/notes.js             Notes app                               -> MacNotes
js/calculator.js        Calculator                              -> MacCalculator
js/desktop.js           icons, widgets, phone home screen       -> MacDesktop
js/applemenu.js         system menu contents                    -> MacAppleMenu
js/menubar.js           menu bar, Control Center, status items  -> MacMenuBar
js/boot.js              boot, lock, sign-in, sleep, restart     -> MacBoot
js/main.js              start-up order
scripts/serve.py        no-cache local server
```

## Assets and credits

- Wallpapers (both CC0, public domain, via Wikimedia Commons):
  "Lake Tahoe on the Nevada shore" by Shankarnikhil88 (cropped to remove a date stamp)
  and "Emerald Bay, Lake Tahoe, California. 2015" by Eric Philbin.
- Every icon, cover, texture and the drawn "Dusk Hills" wallpaper is made in SVG, CSS
  or canvas for this site; every sound and song is synthesised at runtime.
- No Apple system assets (icons, wallpapers, the Apple logo, SF fonts, the startup
  chime) are included. Blockcraft is an original game, not Minecraft, and uses none of
  Mojang's names, textures or sounds. Not affiliated with Apple; macOS is a trademark of
  Apple Inc.
