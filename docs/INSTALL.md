# Installing and setting up Bookmark syncer

## 1. Install Node.js

Download and install the **LTS** version from <https://nodejs.org> (version 20 or newer). Keep the default options.

Check that it works in a new PowerShell window:

```powershell
node --version
```

## 2. Get the app

**With Git:**

```powershell
git clone https://github.com/b0red/Bookmark-synker.git bookmark-syncer
cd bookmark-syncer
```

**Without Git:** on the GitHub page, click **Code → Download ZIP**, unzip it, and open PowerShell in the unzipped folder.

## 3. Install and start

```powershell
npm install
npm start
```

`npm install` downloads Electron (about 100 MB) the first time. After that, `npm start` is all you need.

> **Tip:** the project should live somewhere in your user folder (for example `C:\Users\<you>\Projects`). Electron can fail to start from some restricted system or temp folders.

## 4. Import your bookmarks

1. Click **Import**. The app lists every browser profile it found on this PC.
2. Tick the ones you want and click **Import selected**.
3. Have bookmarks from another PC or browser? Export them there as `bookmarks.html` and use **Import a bookmarks.html file…**

If Firefox says the file is locked, close Firefox and try again.

## 5. Choose how to categorize

Open **⚙** (top right) and pick an engine. Then select a view (for example **Uncategorized**) and click **Auto-categorize**.

### Built-in rules (default)

Works immediately and offline. It recognizes common sites, English, Swedish and German keywords, and the names of your own bookmark folders. Anything it can't place goes to **Other**.

### Local AI (Ollama): free and private

1. Install Ollama from <https://ollama.com/download>.
2. Download a model in PowerShell (about 2 GB):
   ```powershell
   ollama pull qwen2.5:3b
   ```
3. In ⚙ Settings, choose **Local AI (Ollama)**. The status line should say the model is ready.

On a CPU it takes roughly 15–30 minutes for ~750 bookmarks. With a working GPU it's much faster.

Other models work too: type the name in the *Ollama model* box (for example `llama3.2:3b`, or `qwen2.5:7b` for better results on a fast PC) and `ollama pull` it first.

### Claude: best results

1. Create an API key at <https://console.anthropic.com> (the account needs credit).
2. In ⚙ Settings, choose **Claude**, paste the key and click **Save key**. It's stored encrypted with your Windows account.

You can also set the `ANTHROPIC_API_KEY` environment variable instead of saving the key.

## 6. Delete bookmarks from your browsers too

Deleting in the app only removes bookmarks from the library. To remove them from the browsers as well:

1. Delete bookmarks in the app (select them and click **Delete selected**, or right-click a cleanup view → *Delete all*).
2. **Fully close** the browsers. Edge and Chrome often keep running in the system tray. Right-click their tray icon → *Close*, or turn off *Startup boost* / *Continue running background apps* in the browser's settings.
3. Click **Sync to browsers**. It lists, per browser profile, which bookmarks would be removed. Tick the profiles and click **Delete from selected browsers**.

A backup of each file is saved next to it, named `Bookmarks.bookmark-syncer-backup-<date>` (Chromium) or `places.sqlite.bookmark-syncer-backup-<date>` (Firefox). To undo, close the browser, open **Sync to browsers → Restore from backup…** and click **Restore** next to the backup you want. The file it replaces is backed up too, so you can switch back.

**About browser sync accounts**

- **Firefox Sync**: deletions are recorded the way Firefox itself does it, so they should reach your other devices.
- **Chrome / Edge / Brave / Vivaldi / Opera with sync turned on**: these browsers don't expect their file to change while they're closed, and the sync server puts the bookmarks back. Use the **browser extension** (next section) for these. The Sync dialog marks such profiles and leaves them unticked.

## 7. The browser extension

The **Bookmark syncer helper** extension deletes bookmarks through the browser itself, so the browser's own sync removes them on all your devices. It works while the browser is open, so you don't need to close anything. It isn't published in any extension store; you load it from your own copy.

In the app, click **Sync to browsers → Set up the browser extension…** and keep that window open. It has the folders and the pairing code.

### Chrome, Edge, Brave, Vivaldi, Opera

1. Open `chrome://extensions` (Chrome, Brave, Vivaldi), `edge://extensions` (Edge) or `opera://extensions` (Opera).
2. Turn on **Developer mode** (top right in Chrome, in the left side panel in Edge).
3. Click **Load unpacked** and choose the `extension` folder inside the project (the app's **Open folder** button shows it).
4. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to *Bookmark syncer helper*.
5. Click the extension's icon, paste the **pairing code** from the app and click **Connect**.

### Firefox

This is optional: *Sync to browsers* already works with Firefox Sync. The extension only saves you closing Firefox.

The app prepares a Firefox version of the extension in `%APPDATA%\Bookmark syncer\firefox-extension\` (rebuilt each time you open the setup window, so it always matches the app).

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in that folder.
3. Pin it: click the puzzle-piece icon, then the gear next to *Bookmark syncer helper* → *Pin to Toolbar*.
4. Click its icon. The first time, click **Allow** so it may talk to the app on this PC, then paste the pairing code.

### Firefox: keep it installed

Firefox removes a temporary add-on when it closes, and normal Firefox only installs add-ons that Mozilla has signed. You can have it signed **privately** for free. It is not published or listed anywhere:

1. Sign in to (or create) a free account at [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. Make a zip: open the `firefox-extension` folder, select **all files inside it**, right-click → *Send to* → *Compressed (zipped) folder*. Zip the files, not the folder.
3. In the Developer Hub, click **Submit a New Add-on**, choose **On your own** (self-distribution), and upload the zip.
4. The automatic check usually takes a few minutes. Then download the signed `.xpi` file.
5. Drag the `.xpi` into a Firefox window, or open `about:addons` → gear icon → *Install Add-on From File…*.

After an update that changes the extension, its version number goes up; sign the new version the same way. If you use the command line, `npx web-ext sign --channel=unlisted --source-dir "%APPDATA%\Bookmark syncer\firefox-extension" --api-key <key> --api-secret <secret>` does steps 2–4 (keys from the Developer Hub under *Manage API Keys*).

Firefox Developer Edition and Nightly can also install unsigned add-ons: set `xpinstall.signatures.required` to `false` in `about:config`, then install the zip from step 2 (renamed to `.xpi`).

**Using it**

1. Delete bookmarks in the app as usual.
2. With the app open, click the extension's icon in the browser. It lists the bookmarks in this browser that you deleted in the app.
3. Click **Delete them in this browser**. The app shows a message when it's done.
4. Changed your mind? Click **Undo** in the extension to put the last run back in the same folders and positions. To keep them for good, also restore them under *Recently deleted* in the app.

**Sorting into folders by category**

1. Categorize your bookmarks in the app.
2. With the app open, click the extension's icon, then **Sort into folders by category…**. It shows how many bookmarks go into which folder.
3. Click **Sort them**. They move to *Other bookmarks* (*Other favorites* in Edge) **→ Bookmark syncer → category → sub-category**. Your browser sync moves them on your other devices too.
4. **Undo sorting** moves each one back to its old folder and position, and removes the folders it made (if they're empty).

Bookmarks are only moved, never deleted. Run it again after categorizing more; bookmarks already in the right folder are left alone.

**How it stays private and safe**

- The app listens only on `127.0.0.1` (port 47615, this PC only) and only while it's open.
- It answers only the extension, and only with the right pairing code. Web pages can't read your deleted-bookmarks list. Click **New code** in the app to disconnect every paired browser.
- The extension never sends your bookmarks anywhere. It only reads the list of deleted URLs from the app and reports how many it removed.
- Chrome may show a "Disable developer mode extensions" banner at startup. Click the × to keep it.

- Firefox: the extension talks to the app only after you click **Allow** in it.

**Updating the extension**: after `git pull`, open the extensions page and click the reload icon on *Bookmark syncer helper*. In Firefox, open the app's setup window (to rebuild the Firefox version), then click **Reload** in `about:debugging`, or sign and install the new version.

## 8. Search from anywhere and the tray

Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> in any program to bring up the app with the search box ready. Type, then <kbd>Enter</kbd> opens the top result.

- Closing the window keeps the app running in the tray (the icon near the clock), so the shortcut keeps working. Right-click the tray icon → **Quit** to close it for real.
- In ⚙ Settings → *Shortcut and tray* you can change the keys (click the field, press the new keys), turn the shortcut off, keep or stop closing to the tray, and **Start with Windows**.
- If another program already uses the keys, Settings says so. Pick other keys.

## Troubleshooting

| Problem | Fix |
|---|---|
| A setting or button you expect isn't there | You're running an older copy. Close **all** app windows and run `npm start` again. |
| `Ollama is not running` | Start the Ollama app (it lives in the system tray), or install it. |
| `Ollama doesn't have the model …` | Run `ollama pull <model name>`. |
| Ollama error 500 / `llama-server process has terminated` / `CUDA error` | Your graphics card or driver doesn't work with this Ollama version. The app switches to the CPU automatically, retries, and remembers it (⚙ Settings → *Run on the CPU only*). After a GPU driver update, untick it to try the graphics card again. |
| `ollama` isn't recognized in PowerShell | Open a new PowerShell window after installing, or run `"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"`. |
| Claude: `credit balance is too low` | Add credit in the Anthropic Console, or use Built-in rules or Ollama. |
| `handshake failed … SSL error` in the terminal | Harmless. A site's certificate failed during a favicon or link check. |
| Electron exits with `FATAL` right away | Move the project to a folder in your user profile and run `npm start` there. |
| Firefox: "File is locked" | Close Firefox and import again. |
| Sync: "… is running" although the window is closed | The browser is still running in the background. Close it from the system tray, or end it in Task Manager. |
| Sync: "Firefox did not shut down cleanly" | Open Firefox, close it normally, then try again. |
| Bookmarks came back after syncing (Chrome/Edge) | Browser sync restores file edits. Use the browser extension (section 7). |
| Extension: "Bookmark syncer isn't running" | Open the app, then click **Try again**. If the app's extension window says the port is in use, the app is probably open twice. |
| The shortcut does nothing | Another program has the same keys. ⚙ Settings shows this; pick other keys. |
| The app seems gone after closing it | It's in the tray (near the clock, maybe under the ^ arrow). Turn off *Closing the window keeps the app running in the tray* if you prefer. |
| Extension: "That code doesn't match" | Copy the code again from the app (it changes if you click **New code**). |

## Updating

```powershell
git pull
npm install
npm start
```

Your library is kept in `%APPDATA%\Bookmark syncer\` and isn't touched by updates.

## Uninstalling

If you turned on *Start with Windows*, turn it off in ⚙ Settings first. Then quit the app (tray icon → Quit) and delete the project folder and `%APPDATA%\Bookmark syncer\`.
