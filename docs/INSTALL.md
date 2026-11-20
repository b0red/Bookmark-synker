# Installing and setting up Bookmark Library

## 1. Install Node.js

Download and install the **LTS** version from <https://nodejs.org> (version 20 or newer). Keep the default options.

Check that it works in a new PowerShell window:

```powershell
node --version
```

## 2. Get the app

**With Git:**

```powershell
git clone <repo URL>
cd bookmark-library
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

## Updating

```powershell
git pull
npm install
npm start
```

Your library is kept in `%APPDATA%\Bookmark Library\` and isn't touched by updates.

## Uninstalling

Delete the project folder and `%APPDATA%\Bookmark Library\`.
