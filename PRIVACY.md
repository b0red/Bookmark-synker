# Privacy policy

**Bookmark syncer** (the Windows app and its *Bookmark syncer helper* browser extension)
Effective date: 22 November 2026 (updated for version 1.3.0: the new-version check, the start page and the DuckDuckGo export import)

## In short

- Bookmark syncer has **no account, no telemetry, no analytics and no ads**. The developer receives no data from it.
- Your bookmarks, notes, tags and settings stay **on your PC**.
- The app only connects to the internet when you use a feature that needs it. Those features are listed below.
- If you **choose** to have Claude (Anthropic) categorize your bookmarks, it sends their titles, URLs and folder names to Anthropic. This is off by default.

## What the app reads on your PC

- **Your browsers' bookmark files**:
  - Supported browsers are Chrome, Edge, Brave, Vivaldi, Opera, Chromium and Comet, and Firefox, Zen, Floorp and Waterfox.
  - The app only checks whether DuckDuckGo is installed (its app folder exists). It does not open DuckDuckGo's data: DuckDuckGo stores bookmarks encrypted, with the same key that protects its saved passwords. DuckDuckGo bookmarks only reach the app if you export them to a file yourself and import that file.
  - The app reads only from browser profiles you choose to import.
  - It reads each bookmark's title, address (URL), folder and date added. Where the browser records them, it also reads when the bookmark was last used and, for Firefox, how often a bookmarked page was visited.
  - It does not read the rest of your browsing history, your passwords, cookies or form data.
- **Bookmark files you pick yourself**, such as an exported `bookmarks.html` or a library file you import.
- **Your Downloads folder, only when you click *Find the export*** in the Import dialog (shown when DuckDuckGo is installed). The app lists the `.html` files saved there in the last 7 days and reads the first lines of each to see whether it's a bookmark export. It reads a whole file only when you click *Import it*.

## What the app stores, and where

All of it is in your Windows user folder: `%APPDATA%\Bookmark syncer`. It contains:

- `library.sqlite`: your library. This means the bookmarks above plus your categories, tags, notes, favorites, Read later list and the list of bookmarks you deleted.
- `settings.json`: your settings. These include the pairing code for the browser extension.
- `backups\`: copies of the library from the last 14 days, plus copies made right before a restore or an import.
- `start.html`: only if you turn on the start page. It's a page with your bookmarks for your browser to open, and it loads nothing from the internet.
- `crash.log`: technical error messages, if something goes wrong. It stays on your PC and is never sent anywhere.
- `anthropic-key.bin`: present only if you save an Anthropic API key. It is encrypted with Windows' own per-user protection.

Uninstalling the app keeps this folder, so your library survives a reinstall. To remove everything, delete the folder.

**Exports**: *Export* and *Export library…* write files only where you choose to save them.

**Changes to your browsers' bookmarks**: the app changes them only when you use *Sync to browsers* or the browser extension, and only after showing you what will change. *Sync to browsers* saves a backup of each browser file first, next to the original.

## When the app connects to the internet

| Feature | What is contacted | What is sent |
|---|---|---|
| **Site icons** in the bookmark list | Each bookmarked website, to load its icon (`/favicon.ico`) | A normal web request, so that site sees your IP address, as if you visited it |
| **Check links** (when you click it, or every week or month if you turn on *Check links automatically* in Settings; off by default) | Each bookmark's address, one request each | A normal web request with the user agent `BookmarkSyncer` |
| **Auto-categorize with Claude** (only if you choose Claude in Settings and add your own API key) | Anthropic's API (`api.anthropic.com`) | Each bookmark's title, URL and original folder name, for the bookmarks being categorized. [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) applies to that data |
| **New version check** (once a day; on by default in the installed app, turn it off in ⚙ Settings → *Updates*; not in the Microsoft Store version) | GitHub's API (`api.github.com`), to read the number of the newest release of Bookmark syncer | A normal web request with the user agent `BookmarkSyncer`. Nothing about you, your PC or your bookmarks is sent; GitHub sees your IP address, as with any visit. [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) applies. The app never downloads or installs anything by itself |
| **Opening links** (a bookmark, the Wayback Machine copy, help pages, the tip link) | Opens in your default web browser | Whatever your browser normally sends |

These features never connect to the internet:

- **Auto-categorize with built-in rules**, the default. It works offline.
- **Auto-categorize with local AI (Ollama)**. It talks only to Ollama running on your own PC (`127.0.0.1`).
- **The start page**. It is a file on your PC and loads nothing from the web, not even site icons.
- **The Microsoft Store version** doesn't run the new version check: the Store updates it, and [Microsoft's privacy statement](https://privacy.microsoft.com/privacystatement) covers the Store itself (downloads, purchases, updates). The app sends Microsoft nothing of its own.

## The browser extension

The *Bookmark syncer helper* extension:

- **Uses the browser's `bookmarks` permission** to find the bookmarks you deleted in the app and remove them, or to sort them into category folders when you ask it to.
- **Uses the `storage` permission** to remember the pairing code and how to undo its last change. Both stay in your browser.
- **Uses the `activeTab` permission** to read the address and title of the tab you are on, only at the moment you click the extension's icon. It sends them to the app on your PC to show that page's category, tags and notes, and, if you click *Save*, stores the page and what you typed in your library.
- **Talks only to the Bookmark syncer app on the same PC**, at `http://127.0.0.1:47615`.
  - The app accepts these connections only from your own computer and only with your pairing code.
  - Nothing is sent to the internet.
- **Does not read your browsing history, page contents, passwords or cookies.**

## Data shared with others

None by the developer. The only third party that can receive your data is Anthropic, and only if you turn on *Auto-categorize with Claude* and use your own API key (see above). Websites you check or whose icons are shown see an ordinary request from your PC.

## Children

The app is not directed at children and collects no personal information from anyone.

## Your choices

- **Turn off the new version check**: untick it in ⚙ Settings → *Updates*.
- **Turn off Claude**: choose *Built-in rules* or *Local AI* in ⚙ Settings, and click *Remove key* to delete a saved API key.
- **Delete bookmarks**: delete them in the app; *Recently deleted* keeps a copy you can restore. Deleting the data folder removes everything the app stored.
- **Remove the browser extension**: remove it from your browser's extensions page.

## Changes to this policy

If this policy changes, the new version will be published here with a new effective date. Earlier versions are kept in the history of this file.

## Contact

Questions about privacy: open an issue at [github.com/b0red/Bookmark-synker/issues](https://github.com/b0red/Bookmark-synker/issues) or contact [b0red on GitHub](https://github.com/b0red).
