# TODO

## Next up

- [ ] **Bulk actions on the selection**: change category, add tags, favorite (delete is done)
- [ ] **Chrome/Edge sync**: find a way to delete that the sync server respects (e.g. a small browser extension using the bookmarks API)
- [ ] **Restore from backup** button in the Sync dialog
- [ ] **Cancel button** for Auto-categorize and Check links while they run
- [ ] **Remember the Ollama CPU fallback** between runs (it's re-detected each session now)
- [ ] **Installer**: a packaged `.exe` with electron-builder so Node.js isn't needed

## Ideas

- [ ] Right-click menu on categories: rename, merge into another, delete all
- [ ] Drag a bookmark onto a category in the sidebar
- [ ] Sync back categories: write the library's categories as folders into a browser (opt-in, with backup)
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
- Sync to browsers: with Chrome or Edge sync turned on, the sync server may restore deleted bookmarks.
- Sync to browsers deletes by URL, so a URL saved in several folders of the same browser is removed from all of them.
