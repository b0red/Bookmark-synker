# Architecture

An Electron app with three layers: the **main process** (Node.js: files, database, network), a **preload** bridge, and the **renderer** (the UI, plain HTML/CSS/JS with no framework).

```
renderer/app.js  ──window.api.*──▶  preload.js  ──ipcRenderer.invoke──▶  main.js  ──▶  src/*
     (UI)                          (contextBridge)                       (IPC handlers)
```

The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. It can only call the functions that `preload.js` exposes. Links always open in the user's default browser, and only `http(s)` URLs are allowed.

## Files

| File | Role |
|---|---|
| `main.js` | Window creation and IPC handlers: import, list, update, remove, categorize, link check, export, settings, API key storage |
| `preload.js` | Exposes `window.api` to the renderer |
| `src/importers.js` | Finds browser profiles and parses Chromium `Bookmarks` JSON, Firefox `places.sqlite` (copied first, since Firefox locks it) and Netscape `bookmarks.html` |
| `src/normalize.js` | URL normalization used to merge duplicates |
| `src/duplicates.js` | Near-duplicates: a looser URL key (`m.`/AMP/`youtu.be`/index pages, case) plus same path + title, grouped with union-find. Picks which bookmark to keep |
| `src/autoimport.js` | Imports on start and when a browser's bookmark file changes (checks timestamps once a minute; Firefox at most every 10 minutes) |
| `src/tray.js` | Tray icon, the global search shortcut (`globalShortcut`) and *Start with Windows* |
| `src/db.js` | The `Library` class, a SQLite database via sql.js, saved atomically to disk |
| `src/rules.js` | Offline categorizer: known domains, keywords, folder names |
| `src/ollama.js` | Local AI categorizer (Ollama HTTP API, structured JSON output, automatic CPU fallback) |
| `src/claude.js` | Claude categorizer (Anthropic SDK, structured JSON output). Also holds the shared prompt and schema |
| `src/browsersync.js` | "Sync to browsers": finds deleted URLs in each profile, then removes them (refuses while the browser runs, backs up first, writes atomically). Chromium: edits the `Bookmarks` JSON and drops its checksum. Firefox: deletes rows, fixes `foreign_count` and positions, and writes `moz_bookmarks_deleted` tombstones for Firefox Sync |
| `src/bridge.js` | Local HTTP server for the browser extension, on `127.0.0.1:47615` while the app runs. Accepts only `chrome-extension://` (and `moz-`/`edge-`) origins, a matching `Host` (against DNS rebinding) and the pairing code (`X-Bookmark-Syncer-Token`). Routes: `GET /v1/hello`, `GET /v1/deleted` (normalized URLs), `GET /v1/categories` (normalized URL → category, merged URLs included), `POST /v1/report` |
| `extension/` | The **Bookmark syncer helper** (Manifest V3). `core.js` finds, removes and restores bookmarks, and sorts them into category folders (and back), with `chrome.bookmarks`; `popup.*` is the UI; `normalize.js` is shared with the app (`src/normalize.js` re-exports it) so both match URLs the same way |
| `src/extbuild.js` | Builds the Firefox version of the extension: copies `extension/` and adds `browser_specific_settings` (add-on ID, data collection: none) to the manifest. The app writes it to `%APPDATA%\Bookmark syncer\firefox-extension\` |
| `src/linkcheck.js` | HEAD/GET link checker with timeouts and limited concurrency |
| `renderer/` | UI: sidebar views, list, detail panel, dialogs, right-click menu |
| `scripts/test-db.js` | Integration test against the browsers on this PC |
| `scripts/test-sync.js` | Runs browser sync on copies of this PC's browser files and checks the result |
| `scripts/test-extension.js` | Checks the bridge's security rules, then runs the extension's find / delete / undo and sort-into-folders / undo logic on in-memory copies of this PC's Chromium and Firefox bookmark trees, and checks the Firefox build |
| `scripts/test-dups.js`, `test-autoimport.js`, `test-later.js`, `test-ollama.js` | Near-duplicates and merging, automatic import, Read later, and the Ollama CPU fallback, on throwaway libraries and fakes |
| `scripts/make-demo.js` | Builds a made-up library and saves `docs/screenshot.png` |
| `scripts/make-icons.js` | Draws the extension icons and `build/icon.ico` (pure Node, no dependencies) |
| `package.json` → `build` | electron-builder settings for the NSIS installer (`npm run dist`): per-user install, keeps the library on uninstall, `extension/` unpacked from `app.asar` so browsers can load it as a folder, English and Swedish Electron locales only |
| `scripts/smoke.js` | Prints counts per browser profile |

## Database

| Table | Purpose |
|---|---|
| `bookmarks` | One row per unique (normalized) URL: title, domain, original folder, category, notes, favorite, dates, visit count, link status |
| `sources` | Which browser profile and folder each bookmark came from (many per bookmark) |
| `tags` | Tags per bookmark |
| `removed` | URLs the user deleted (so re-imports skip them) plus a JSON snapshot of each bookmark for "Recently deleted" / Restore |
| `aliases` | URLs merged into another bookmark (near-duplicates); imports of these URLs add to that bookmark |
| `dup_dismissed` | Groups marked *Not duplicates* |

`bookmarks` also has `read_later` (when it was queued) and `opened_at` (last opened from the app), added automatically to older libraries.

## Categorizers

All three share the same contract: `categorize({ bookmarks, onBatch, ... })` calls `onBatch(results, done, total)` with `[{ id, category, tags }]`. `main.js` writes each batch to the database right away, so progress survives a crash or a cancel.

## Dev hooks

Environment variables for automated checks:

- `BMLIB_DATA`: use a different data folder (for example a copy of the library)
- `BMLIB_SNAPSHOT`: save a PNG of the window and quit
- `BMLIB_SNAPSHOT_JS`: JavaScript to run in the page before the snapshot
- `BMLIB_NO_BRIDGE`: don't start the extension bridge (when another copy of the app already uses the port)
- `BMLIB_NO_AUTOIMPORT`: don't import automatically
- `BMLIB_NO_DESKTOP`: no tray, global shortcut or Windows startup (off automatically with `BMLIB_SNAPSHOT`; `BMLIB_DESKTOP=1` turns them back on)
