# TODO

## Ideas, in priority order

Ranked by how much each helps the main job (one clean library that stays in step with the browsers) against how much work it is.

1. [ ] **Near-duplicate detection**: the same page under different URLs (`http`/`https`, `m.` sites, AMP, mirrors, very similar titles). Shown as a smart view with "keep this one, delete the others". Builds on the URL cleanup that already exists. *Medium effort, high value: the cleanup tools are the core of the app.*
2. [ ] **Drag a bookmark onto a category** in the sidebar (also works with a selection). *Small effort, used daily.*
3. [ ] **Import automatically**: watch the browsers' bookmark files and import new bookmarks while the app is open, plus an "Import on start" setting. *Medium effort. Keeps the library current without remembering to click Import.*
4. [ ] **Sync categories back to a browser**: write the library's categories as folders in a browser, through the extension (so browser sync carries it) or into the file with a backup. Opt-in, with a preview. *Larger effort and must be very careful, but it closes the loop: sort once, tidy everywhere.*
5. [ ] **Read later**: a queue for bookmarks you want to read, and an occasional nudge about ones you saved but never opened. Builds on the "No visit history" view. *Small to medium effort.*
6. [ ] **Global hotkey** to search the library from anywhere (app stays in the tray). *Small effort, nice to have once the app runs all the time.*
7. [ ] **Page snapshots and full-text search** of page contents. *Large effort and storage use; most useful for dead links, where the Wayback Machine link already helps.*
8. [ ] **Demo screenshot in the README**, made from fake data (not a real library). *Tiny, but it only matters if the repo becomes public.*

## Last

- [ ] **Installer**: a packaged `.exe` with electron-builder so Node.js isn't needed. Saved for the end, once the features have settled.

## Not planned for now

- Publishing the extension in the Chrome Web Store / Edge Add-ons / addons.mozilla.org listing (private project). Private Firefox signing is described in [docs/INSTALL.md](docs/INSTALL.md#firefox-keep-it-installed).

## Known issues

- Favicons are fetched from each site directly, so some fail or trigger harmless SSL warnings in the terminal.
- Ollama on older NVIDIA cards (e.g. GTX 900 series) crashes on the GPU. The app switches to the CPU (slow) and remembers it; see ⚙ Settings.
- Safari and Chromium-based browsers in unusual install locations aren't auto-detected. Use the `bookmarks.html` import.
- Only tested on Windows 10.
- Sync to browsers (file-based): with Chrome or Edge sync turned on, the sync server restores deleted bookmarks. Use the browser extension for those profiles.
- Sync to browsers and the extension delete by URL, so a URL saved in several folders of the same browser is removed from all of them.
- The extension is loaded in Developer mode, so Chrome may show a "Disable developer mode extensions" banner at startup.
- In Firefox, the extension is a temporary add-on (gone after a restart) unless you sign it privately.
