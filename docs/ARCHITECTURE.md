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
| `src/db.js` | The `Library` class, a SQLite database via sql.js, saved atomically to disk |
| `src/rules.js` | Offline categorizer: known domains, keywords, folder names |
| `src/ollama.js` | Local AI categorizer (Ollama HTTP API, structured JSON output, automatic CPU fallback) |
| `src/claude.js` | Claude categorizer (Anthropic SDK, structured JSON output). Also holds the shared prompt and schema |
| `src/browsersync.js` | "Sync to browsers": finds deleted URLs in each profile, then removes them (refuses while the browser runs, backs up first, writes atomically). Chromium: edits the `Bookmarks` JSON and drops its checksum. Firefox: deletes rows, fixes `foreign_count` and positions, and writes `moz_bookmarks_deleted` tombstones for Firefox Sync |
| `src/linkcheck.js` | HEAD/GET link checker with timeouts and limited concurrency |
| `renderer/` | UI: sidebar views, list, detail panel, dialogs, right-click menu |
| `scripts/test-db.js` | Integration test against the browsers on this PC |
| `scripts/test-sync.js` | Runs browser sync on copies of this PC's browser files and checks the result |
| `scripts/smoke.js` | Prints counts per browser profile |

## Database

| Table | Purpose |
|---|---|
| `bookmarks` | One row per unique (normalized) URL: title, domain, original folder, category, notes, favorite, dates, visit count, link status |
| `sources` | Which browser profile and folder each bookmark came from (many per bookmark) |
| `tags` | Tags per bookmark |
| `removed` | URLs the user deleted (so re-imports skip them) plus a JSON snapshot of each bookmark for "Recently deleted" / Restore |

## Categorizers

All three share the same contract: `categorize({ bookmarks, onBatch, ... })` calls `onBatch(results, done, total)` with `[{ id, category, tags }]`. `main.js` writes each batch to the database right away, so progress survives a crash or a cancel.

## Dev hooks

Environment variables for automated checks:

- `BMLIB_DATA`: use a different data folder (for example a copy of the library)
- `BMLIB_SNAPSHOT`: save a PNG of the window and quit
- `BMLIB_SNAPSHOT_JS`: JavaScript to run in the page before the snapshot
