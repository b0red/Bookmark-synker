# TODO

## Next up

- [ ] **Undo for deletes**: a "Recently deleted" view that can restore links, and clear them from the skip list
- [ ] **Multi-select in the list** (Ctrl/Shift+click) for bulk delete, bulk category change and bulk favorite
- [ ] **Cancel button** for Auto-categorize and Check links while they run
- [ ] **Remember the Ollama CPU fallback** between runs (it's re-detected each session now)
- [ ] **Installer**: a packaged `.exe` with electron-builder so Node.js isn't needed

## Ideas

- [ ] Right-click menu on categories: rename, merge into another, delete all
- [ ] Drag a bookmark onto a category in the sidebar
- [ ] Sync back: write a cleaned-up bookmark folder into a browser (opt-in, with backup)
- [ ] Watch browsers for new bookmarks and import automatically
- [ ] Page snapshots and full-text search of page content
- [ ] "Read later" queue and reminders for bookmarks you never opened
- [ ] Duplicate-ish detection (same article on different URLs, or http vs https mirrors)
- [ ] Global hotkey for quick search from anywhere
- [ ] Demo screenshot in the README (made from fake data, not a real library)
- [ ] Choose a license (currently none / all rights reserved)

## Known issues

- Favicons are fetched from each site directly, so some fail or trigger harmless SSL warnings in the terminal.
- Ollama on older NVIDIA cards (e.g. GTX 900 series) crashes on the GPU. The app falls back to CPU, which is slow.
- Safari and Chromium-based browsers in unusual install locations aren't auto-detected. Use the `bookmarks.html` import.
- Only tested on Windows 10.
