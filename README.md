# Bookmark syncer

*A small vibecoded app for syncing bookmarks between multiple browsers.*

A Windows desktop app that reads the bookmarks from every browser on your PC (Chrome, Edge, Brave, Vivaldi, Opera, Firefox), merges the duplicates, and gives you one searchable, categorized library. You can sort it with built-in rules, a local AI (Ollama), or Claude, check which links are dead, clean out what you no longer need, and export the result back to any browser.

Your browsers' own bookmarks are only **read**, except when you click **Sync to browsers** (or use the browser extension), which removes the ones you deleted after showing a preview.

## Features

| | |
|---|---|
| **Import** | Finds every browser profile on the PC automatically. You can also import any exported `bookmarks.html`. Re-importing only adds what's new. |
| **Merge duplicates** | URLs are cleaned up (tracking parameters, `www.`, trailing slashes), so the same page saved in three browsers becomes one entry that remembers every place it came from. |
| **Auto-categorize** | Assigns a category and tags. Choose the engine in ⚙ Settings: **Built-in rules** (offline, instant), **Local AI** with Ollama (free, private), or **Claude** (best results, needs an API key). |
| **Smart views** | Favorites, uncategorized, no visit history, not opened in a year, saved in several browsers, dead links, links with problems. |
| **Select & change many** | Tick bookmarks (or Ctrl+click / Shift+click, Ctrl+A for all), then **Set category…**, **Tags…** (add or remove), **★ Favorite / ☆ Unfavorite** or **Delete selected** (<kbd>Del</kbd>). Every change has an **Undo** button. |
| **Help panel** | The **?** button explains the colors, the workflow and the shortcuts, with a link to this README. |
| **Recently deleted** | Lists everything you deleted, newest first. **Restore** one, a selection, or right-click → *Restore all*. Restored links are imported again in the future. |
| **Clean up** | Right-click **Not opened in a year**, **Dead links** or **Links with problems** → *Delete all*. Deleted links stay deleted on future imports. |
| **Tidy categories** | Right-click a category → *Rename or merge…* (type an existing name to merge), *Remove category* or *Delete all*. All with Undo. |
| **Sync to browsers** | Removes what you deleted here from the browsers' own bookmarks too. It shows a preview first, needs the browser closed, and backs up every file. |
| **Browser extension** | For Chrome, Edge and other Chromium browsers with sync turned on: the *Bookmark syncer helper* deletes through the browser itself, so the deletions reach all your devices. Preview, one click, Undo. See [docs/INSTALL.md](docs/INSTALL.md#7-the-browser-extension-chrome-edge-and-other-chromium-browsers). |
| **Search** | Free text, or filters: `tag:python`, `cat:cooking`, `site:github.com`, `in:firefox`. <kbd>Ctrl</kbd>+<kbd>K</kbd> focuses search, and <kbd>Enter</kbd> opens the top hit. |
| **Check links** | Finds dead pages (404, domain gone) and offers the Wayback Machine copy. |
| **Cancel** | Auto-categorize and Check links can be stopped from the progress bar; everything finished so far is kept. |
| **Rediscover** | Opens a random bookmark from the current view. |
| **Export** | Saves the current view as `bookmarks.html`, grouped by category, which any browser can import. |

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```powershell
git clone https://github.com/b0red/Bookmark-synker.git bookmark-syncer
cd bookmark-syncer
npm install
npm start
```

Click **Import**, tick the browsers, then **Import selected**. Full instructions, including the Ollama and Claude setup and troubleshooting, are in **[docs/INSTALL.md](docs/INSTALL.md)**.

## Where your data lives

Everything is stored locally in `%APPDATA%\Bookmark syncer\`. Versions before 0.4 were called Bookmark Library and used `%APPDATA%\Bookmark Library\`; that data is copied over automatically on first start.

| File | Contents |
|---|---|
| `library.sqlite` | Your library (bookmarks, categories, tags, notes, deleted-link list) |
| `settings.json` | Which categorizer to use, Ollama model, the extension pairing code |
| `anthropic-key.bin` | Your Claude API key, encrypted with your Windows account (only if you saved one) |

To back up your library, copy `library.sqlite`. To start over, delete it.

## Privacy

- **Built-in rules** and **Ollama**: nothing leaves your PC.
- **Claude**: the title, URL and folder name of the bookmarks being categorized are sent to Anthropic's API.
- **Check links**: the app requests each URL, the same as visiting it. Favicons are loaded from the sites themselves.
- **Browser extension**: talks only to the app on `127.0.0.1` (this PC), using a pairing code. Web pages can't reach it, and your bookmarks aren't sent anywhere.

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md): installation, setup and troubleshooting
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organized
- [TODO.md](TODO.md): planned features and known issues
- [CHANGELOG.md](CHANGELOG.md): what changed

## Development

```powershell
npm test       # library tests, "sync to browsers" on COPIES of your browser files (the real ones aren't touched),
               # and the extension bridge + logic on in-memory copies of your bookmark trees
npm run smoke  # prints bookmark counts per browser profile
```

Built with Electron and sql.js (SQLite compiled to WebAssembly, so no native build tools are needed).

## License

[GPL-3.0](LICENSE)
