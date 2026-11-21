# Changelog

## 0.9.1 (2026-11-21)

- **Fixed: the Firefox extension couldn't connect** ("Could not reach the app"). The app didn't allow one of the extension's headers, which Firefox checks and Chrome doesn't
- The extension says what went wrong when the app answers with an error, instead of always "Could not reach the app"
- Firefox setup: a **Copy** button for the full path to `manifest.json`, to paste into Firefox's file window

## 0.9.0 (2026-11-21)

- **Category tree**: categories like `Cooking / Baking` show as a tree you can fold open. Right-click a parent to keep only the sub-category names, or to merge the sub-categories into it. Renaming a parent moves its sub-categories along
- **Near-duplicates**: *Possible duplicates* finds the same page under different URLs (`m.` and AMP pages, `youtu.be`, `index.html`, same title on the same page). **Keep this one** merges the others into it: browsers, folders, tags and notes come along, and the merged URLs keep pointing at it on future imports. *Merge all* (right-click the view) and *Not duplicates*, all with Undo
- **Drag and drop** bookmarks or a selection onto a category, *Uncategorized*, *Favorites* or *Read later*
- **Import automatically** when the app starts and while it's open (only profiles you imported before; Firefox at most every 10 minutes). Settings to turn it off
- **Categories as folders**: the extension can sort the browser's bookmarks into *Other bookmarks → Bookmark syncer → <category>* folders, with a preview and an exact Undo. Bookmarks are only moved, never deleted
- **Read later**: a queue with its own view, a button in the details pane and the selection bar, and a weekly reminder about unread bookmarks (can be turned off). Opening a bookmark from the app is remembered
- **Search from anywhere** with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> (changeable), a **tray icon**, closing to the tray, and an optional *Start with Windows*. Only one copy of the app runs at a time
- README: a screenshot made from a made-up library (`node scripts/make-demo.js`)
- Library saves retry briefly when Windows (a virus scanner or the indexer) holds the file

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
