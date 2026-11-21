# Changelog

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
