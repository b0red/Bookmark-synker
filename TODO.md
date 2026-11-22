# TODO

## Ideas, in priority order

Done in 0.9.0: 1–6 and 8. Also done: categories with ` / ` show as a tree.

Ranked by how much each helps the main job (one clean library that stays in step with the browsers) against how much work it is.

1. [x] **Near-duplicate detection**: the same page under different URLs (`http`/`https`, `m.` sites, AMP, mirrors, very similar titles). Shown as a smart view with "keep this one, delete the others". Builds on the URL cleanup that already exists. *Medium effort, high value: the cleanup tools are the core of the app.*
2. [x] **Drag a bookmark onto a category** in the sidebar (also works with a selection). *Small effort, used daily.*
3. [x] **Import automatically**: watch the browsers' bookmark files and import new bookmarks while the app is open, plus an "Import on start" setting. *Medium effort. Keeps the library current without remembering to click Import.*
4. [x] **Sync categories back to a browser**: write the library's categories as folders in a browser, through the extension (so browser sync carries it) or into the file with a backup. Opt-in, with a preview. *Larger effort and must be very careful, but it closes the loop: sort once, tidy everywhere.*
5. [x] **Read later**: a queue for bookmarks you want to read, and an occasional nudge about ones you saved but never opened. Builds on the "No visit history" view. *Small to medium effort.*
6. [x] **Global hotkey** to search the library from anywhere (app stays in the tray). *Small effort, nice to have once the app runs all the time.*
7. [ ] *(paused)* **Page snapshots and full-text search** of page contents. *Large effort and storage use; most useful for dead links, where the Wayback Machine link already helps.*
8. [x] **Demo screenshot in the README**, made from fake data (not a real library). *Tiny, but it only matters if the repo becomes public.*

## Last

- [x] **Installer**: a packaged `.exe` with electron-builder so Node.js isn't needed (1.0.0).

## Not planned for now

- Publishing the extension in the Chrome Web Store / Edge Add-ons / addons.mozilla.org listing. Private Firefox signing is described in [docs/INSTALL.md](docs/INSTALL.md#firefox-keep-it-installed).

## Known issues

- The installer isn't code-signed, so Windows SmartScreen asks for confirmation (*More info → Run anyway*). A signing certificate costs money.
- Some error messages from the browsers, Ollama or the Claude API that include their own details are shown in English in the Swedish app.
- The privacy policy, ARCHITECTURE, TODO and CHANGELOG are in English only (README and INSTALL are also in Swedish).
- No automatic updates: the app tells you about a new version, and you run the new installer. (The Microsoft Store version is updated by the Store.)
- Microsoft Store version (*bookmarker*, submitted 22 Nov 2026, in review): *Start with Windows* is set in Windows Settings → Apps → Startup. Windows can't pass the app a "started at login" flag, so it starts in the tray when Windows started less than 3 minutes ago; after a very slow login it opens its window instead. Not testable on the build PC (an unsigned package can't be installed). Each new version needs `npm run dist:store` and a new submission in Partner Center.

- The global shortcut is unavailable while another program uses the same keys; Settings says so, and you can pick other keys.

- Favicons are fetched from each site directly, so some fail or trigger harmless SSL warnings in the terminal.
- Ollama on older NVIDIA cards (e.g. GTX 900 series) crashes on the GPU. The app switches to the CPU (slow) and remembers it; see ⚙ Settings.
- Browsers in unusual places (portable copies, custom profile folders) aren't auto-detected. Use the `bookmarks.html` import.
- Comet, Zen and Floorp are found in their usual folders but have been tested on made-up copies only. Waterfox is tested on a real installation (import, Sync to browsers on a copy, the extension's logic on its bookmarks), but the extension itself hasn't been loaded in it.
- The in-app help and the extension setup window still name only the main browsers (Chrome, Edge, Brave, Vivaldi, Opera, Firefox), so that browsers you don't have aren't mentioned.
- DuckDuckGo for Windows keeps its bookmarks in an encrypted database (the same key protects its saved passwords), so the app doesn't read it. You export them from DuckDuckGo to Downloads, and the Import dialog finds and imports the export. It isn't automatic, and Sync to browsers and the extension don't work with DuckDuckGo.
- The start page is a home/start page, not the new tab page (browsers only let extensions replace that). It only updates while the app runs.
- Only tested on Windows 10.
- Sync to browsers (file-based): with Chrome or Edge sync turned on, the sync server restores deleted bookmarks. Use the browser extension for those profiles.
- Sync to browsers and the extension delete by URL, so a URL saved in several folders of the same browser is removed from all of them.
- The extension is loaded in Developer mode, so Chrome may show a "Disable developer mode extensions" banner at startup.
- In Firefox, the extension is a temporary add-on (gone after a restart) unless you sign it privately.
