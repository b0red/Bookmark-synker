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
git clone https://github.com/b0red/bookmark-synker.git bookmark-syncer
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

A backup of each file is saved next to it, named `Bookmarks.bookmark-syncer-backup-<date>` (Chromium) or `places.sqlite.bookmark-syncer-backup-<date>` (Firefox). To undo, close the browser and copy the backup back over the original file.

**About browser sync accounts**

- **Firefox Sync**: deletions are recorded the way Firefox itself does it, so they should reach your other devices.
- **Chrome / Edge sync**: these browsers don't expect their file to change while they're closed, and the sync server may put the bookmarks back when the browser starts. After reopening the browser, close it again and click **Check again**. If bookmarks came back, either delete them once in the browser itself, or turn off bookmark sync, run the sync, and turn it on again.

## Troubleshooting

| Problem | Fix |
|---|---|
| A setting or button you expect isn't there | You're running an older copy. Close **all** app windows and run `npm start` again. |
| `Ollama is not running` | Start the Ollama app (it lives in the system tray), or install it. |
| `Ollama doesn't have the model …` | Run `ollama pull <model name>`. |
| Ollama error 500 / `llama-server process has terminated` / `CUDA error` | Your graphics card or driver doesn't work with this Ollama version. The app switches to CPU automatically and retries. Updating your GPU driver may make the GPU usable again. |
| `ollama` isn't recognized in PowerShell | Open a new PowerShell window after installing, or run `"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"`. |
| Claude: `credit balance is too low` | Add credit in the Anthropic Console, or use Built-in rules or Ollama. |
| `handshake failed … SSL error` in the terminal | Harmless. A site's certificate failed during a favicon or link check. |
| Electron exits with `FATAL` right away | Move the project to a folder in your user profile and run `npm start` there. |
| Firefox: "File is locked" | Close Firefox and import again. |
| Sync: "… is running" although the window is closed | The browser is still running in the background. Close it from the system tray, or end it in Task Manager. |
| Sync: "Firefox did not shut down cleanly" | Open Firefox, close it normally, then try again. |
| Bookmarks came back after syncing (Chrome/Edge) | See *About browser sync accounts* above. |

## Updating

```powershell
git pull
npm install
npm start
```

Your library is kept in `%APPDATA%\Bookmark syncer\` and isn't touched by updates.

## Uninstalling

Delete the project folder and `%APPDATA%\Bookmark syncer\`.
