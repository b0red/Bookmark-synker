# Changelog

## 0.8.0 (2026-11-21)

- **Firefox** support for the browser extension. The app builds a Firefox version in `%APPDATA%\Bookmark syncer\firefox-extension\`, and the setup window explains how to load it (temporary) or sign it privately (permanent). The first time, the extension asks you to allow access to the app
- **Resizable library pane**: drag its edge (or focus it and use the arrow keys), double-click to reset. The width is remembered
- The extension's setup window now shows the pairing code at the top, with separate steps for Chromium browsers and Firefox
- TODO: the Ideas list is now in priority order

## 0.7.0 (2026-11-21)

- **Restore from backup** in the Sync dialog: lists the backups Sync to browsers made for each profile (date, bookmark count, difference from now) and puts one back with a click. The file it replaces is backed up first, so you can switch back
- Backups made in the same second no longer overwrite each other
- The **Ollama CPU fallback is remembered**: after a GPU crash the app shows a message and keeps using the CPU next time. Turn it off under ⚙ Settings → *Run on the CPU only*

## 0.6.0 (2026-11-21)

- **Bookmark syncer helper**, a browser extension for Chrome, Edge, Brave, Vivaldi and Opera. It deletes the bookmarks you deleted in the app through the browser itself, so Google / Microsoft account sync removes them everywhere instead of putting them back. It shows a preview first, works while the browser is open, and has **Undo** (back to the same folder and position)
- The app talks to the extension over `127.0.0.1` only, with a pairing code. Set it up under **Sync to browsers → Set up the browser extension…**
- The Sync dialog marks Chromium profiles that use browser sync and leaves them unticked, pointing to the extension instead

## 0.5.0 (2026-11-21)

- Right-click a category: **Rename or merge…** (typing an existing name merges, case-insensitive), **Remove category**, **Delete all**, each with Undo
- **Cancel** button on the progress bar for Auto-categorize and Check links. In-flight Ollama, Claude and link requests are aborted right away and finished work is kept
- **Read more on GitHub** link in the ? help panel
- Link check results count only the links checked in that run

## 0.4.0 (2026-11-21)

- Renamed to **Bookmark syncer**. Your library, settings and API key are copied automatically from the old `%APPDATA%\Bookmark Library` folder on first start (the old folder is kept as a backup)
- **Bulk actions** on ticked bookmarks: set category, add or remove tags, favorite or unfavorite, each with Undo
- **? help panel** explaining the link colors, site icons, the workflow and keyboard shortcuts

## 0.3.0 (2026-11-21)

- **Recently deleted** view: see everything you deleted, open it, and **Restore** one, a selection or all (right-click). Restored links are no longer skipped on import
- **Undo** button after every delete
- Deleting now saves a full snapshot (title, category, tags, notes, favorite, sources). Links deleted earlier restore as the URL only; importing again fills in the rest

## 0.2.1 (2026-11-21)

- Opera (and Opera GX) profiles are now found by Import and Sync to browsers (newer Opera keeps bookmarks in `Opera Stable\Default`)
- Import results say how many were merged into existing bookmarks or skipped because you deleted them, with a "show them" link

## 0.2.0 (2026-11-20)

- Multi-select in the list: checkboxes, Ctrl+click, Shift+click ranges, Ctrl+A, and **Delete selected** (or the Del key)
- **Sync to browsers**: removes bookmarks you deleted in the library from Chrome, Edge, Brave, Vivaldi, Opera and Firefox. It previews per profile, requires the browser to be closed, backs up every file, and writes Firefox Sync tombstones
- `npm test` also tests browser sync on copies of your browser files

## 0.1.0 (2026-11-20)

First version.

- Import from Chrome, Edge, Brave, Vivaldi, Chromium, Opera and Firefox profiles, plus `bookmarks.html` files
- Duplicate merging across browsers, keeping every source and folder
- Smart views, search with `tag:` `cat:` `site:` `in:` filters, detail panel with notes, tags and favorites
- Auto-categorize with built-in rules, Ollama (local AI, with automatic CPU fallback when the GPU crashes) or Claude
- Dead link checker with Wayback Machine links
- Right-click **Delete all** on *Not opened in a year*, *Dead links* and *Links with problems*. Deleted links are skipped on later imports
- Export to `bookmarks.html` grouped by category
- Light and dark theme following Windows
