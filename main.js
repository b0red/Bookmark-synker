const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { Library } = require('./src/db');
const { detectSources, parseChromium, parseFirefox, parseHtml } = require('./src/importers');
const claude = require('./src/claude');
const ollama = require('./src/ollama');
const rules = require('./src/rules');
const { checkAll } = require('./src/linkcheck');
const browserSync = require('./src/browsersync');
const { startBridge, newToken } = require('./src/bridge');
const { buildFirefox } = require('./src/extbuild');
const { pickKeeper } = require('./src/duplicates');
const { createAutoImporter } = require('./src/autoimport');
const trayMod = require('./src/tray');
const safety = require('./src/safety');

let win, lib;
let tray = null, quitting = false, hotkeyStatus = { ok: true, active: false };
const ICON = path.join(__dirname, 'extension', 'icon48.png');
const startHidden = process.argv.includes('--hidden');
// Tests and screenshots never touch the tray, the global shortcut or Windows startup.
const DESKTOP_HOOKS = process.env.BMLIB_DESKTOP === '1' || (!process.env.BMLIB_SNAPSHOT && !process.env.BMLIB_NO_DESKTOP);
const dataDir = () => app.getPath('userData');
const keyFile = () => path.join(dataDir(), 'anthropic-key.bin');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#16181d',
    title: 'Bookmark syncer',
    icon: ICON,
    show: !(startHidden && DESKTOP_HOOKS),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links inside the app open in the user's default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  // The window only ever shows the app itself. Anything else (a link, or a file dropped on the window)
  // would get the app's functions, so it's blocked; web links open in the browser instead.
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); openExternal(url); });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  // If the page crashes, reload it (at most 3 times a minute) instead of leaving a blank window.
  const crashes = [];
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    safety.logError(dataDir(), 'window', `page ${details.reason} (exit code ${details.exitCode})`);
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && crashes[0] < now - 60000) crashes.shift();
    if (crashes.length <= 3 && !win.isDestroyed()) win.reload();
    else dialog.showErrorBox('Bookmark syncer', `The window keeps crashing. Your library is saved. Details are in ${path.join(dataDir(), 'crash.log')}.`);
  });
  // Windows is shutting down or signing out: really quit (hiding to the tray would hold up the shutdown).
  win.on('session-end', () => { quitting = true; });
  // Closing the window keeps the app in the tray (if that's on), so the shortcut keeps working.
  win.on('close', (e) => {
    if (quitting || !tray || !loadSettings().closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!loadSettings().trayHintShown) {
      saveSettings({ trayHintShown: true });
      tray.tray.displayBalloon({ iconType: 'info', title: 'Bookmark syncer is still running',
        content: `It's in the tray. ${hotkeyStatus.active ? `Press ${hotkeyStatus.accelerator} to search your bookmarks. ` : ''}Right-click the icon to quit.` });
    }
  });
}

function showWindow(focusSearch = false) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (focusSearch) send('focus-search');
}

function quitApp() {
  quitting = true;
  app.quit();
}

function applyDesktop(s) {
  if (!DESKTOP_HOOKS) return;
  hotkeyStatus = trayMod.applyHotkey({ enabled: s.hotkeyEnabled, accelerator: s.hotkey }, () => showWindow(true));
  if (tray) tray.setHotkeyLabel(hotkeyStatus.active ? hotkeyStatus.accelerator : null);
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// ---------- API key (encrypted with Windows' per-user protection) ----------

async function loadKey() {
  try {
    const buf = fs.readFileSync(keyFile());
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf);
    if (shouldReEncrypt) fs.writeFileSync(keyFile(), await safeStorage.encryptStringAsync(result));
    return result;
  } catch { return null; }
}

// ---------- settings ----------

const settingsFile = () => path.join(dataDir(), 'settings.json');
const DEFAULT_SETTINGS = { categorizer: 'rules', ollamaModel: 'qwen2.5:3b', importOnStart: true, watchBrowsers: true, readLaterNudge: true,
  hotkeyEnabled: true, hotkey: trayMod.DEFAULT_HOTKEY, closeToTray: true, startWithWindows: false };

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

// ---------- IPC ----------

ipcMain.handle('sources:detect', () => detectSources());

function importSource(s) {
  const items = s.type === 'firefox' ? parseFirefox(s.path, lib.SQL) : parseChromium(s.path);
  return { found: items.length, ...lib.importItems(items, s.label) };
}

ipcMain.handle('import:sources', async (_e, sources) => {
  const results = [];
  for (const s of sources) {
    try {
      results.push({ label: s.label, ...importSource(s) });
    } catch (e) {
      results.push({ label: s.label, error: /EBUSY|locked/i.test(e.message) ? 'File is locked. Close the browser and try again.' : e.message });
    }
  }
  return results;
});

ipcMain.handle('import:html', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import exported bookmarks',
    filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return r.filePaths.map(file => {
    try {
      const items = parseHtml(fs.readFileSync(file, 'utf8'));
      const label = `File · ${path.basename(file)}`;
      return { label, found: items.length, ...lib.importItems(items, label) };
    } catch (e) {
      return { label: path.basename(file), error: e.message };
    }
  });
});

ipcMain.handle('library:list', () => lib.list());
ipcMain.handle('bookmark:update', (_e, id, patch) => lib.update(id, patch));
ipcMain.handle('bookmark:remove', (_e, ids) => lib.remove(ids));
ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));
ipcMain.handle('bookmark:bulk', (_e, ids, patch) => lib.bulkUpdate(ids, patch));
ipcMain.handle('bookmark:setFields', (_e, list) => lib.setFields(list));
ipcMain.handle('bookmark:opened', (_e, id) => lib.markOpened(id));

// Near-duplicates: merge (returns undo tokens), undo, or mark a group as "not duplicates".
ipcMain.handle('dups:merge', (_e, keepId, otherIds) => [lib.mergeDuplicates(keepId, otherIds)].filter(Boolean));
ipcMain.handle('dups:mergeAll', () => {
  const groups = new Map();
  for (const b of lib.list()) if (b.dup) (groups.get(b.dup) || groups.set(b.dup, []).get(b.dup)).push(b);
  const tokens = [];
  for (const members of groups.values()) {
    const keep = pickKeeper(members);
    const t = lib.mergeDuplicates(keep.id, members.map(m => m.id));
    if (t) tokens.push(t);
  }
  return tokens;
});
ipcMain.handle('dups:unmerge', (_e, tokens) => { for (const t of [...tokens].reverse()) lib.unmerge(t); });
ipcMain.handle('dups:dismiss', (_e, signature, undo) => lib.dismissDuplicates(signature, !!undo));
ipcMain.handle('deleted:list', () => lib.listRemoved());
ipcMain.handle('deleted:restore', (_e, ids) => lib.restore(ids));
ipcMain.handle('open:url', (_e, url) => openExternal(url));

// Sync deletions to browsers: preview what would be removed, then remove it from the chosen profiles.
ipcMain.handle('browsers:plan', () => browserSync.plan(lib.removedNorms(), lib.SQL));
ipcMain.handle('browsers:apply', (_e, labels) => browserSync.apply(labels, lib.removedNorms(), lib.SQL));
ipcMain.handle('browsers:backups', () => browserSync.listBackups(lib.SQL));
ipcMain.handle('browsers:restore', async (_e, label, file) => {
  try { return await browserSync.restoreBackup(label, file, lib.SQL); } catch (e) { return { label, error: e.message }; }
});
ipcMain.handle('browsers:reveal', (_e, file) => { if (typeof file === 'string' && fs.existsSync(file)) shell.showItemInFolder(file); });

ipcMain.handle('key:status', async () => ({ saved: !!(await loadKey()), env: !!process.env.ANTHROPIC_API_KEY }));
ipcMain.handle('key:save', async (_e, key) => {
  if (!key) { try { fs.unlinkSync(keyFile()); } catch {} return true; }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Windows encryption is unavailable; set ANTHROPIC_API_KEY instead.');
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(keyFile(), await safeStorage.encryptStringAsync(key.trim()));
  return true;
});

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(dataDir(), { recursive: true });
  safety.writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

ipcMain.handle('settings:get', () => {
  const { bridgeToken, ...rest } = loadSettings(); // the pairing code is only shown in the extension setup dialog
  return { ...rest, hotkeyStatus };
});
ipcMain.handle('settings:save', (_e, patch) => {
  const { bridgeToken, ...safe } = patch || {};
  const { bridgeToken: _t, ...rest } = saveSettings(safe);
  if ('watchBrowsers' in safe && autoImport) { if (rest.watchBrowsers) autoImport.start(); else autoImport.stop(); }
  if ('hotkey' in safe || 'hotkeyEnabled' in safe) applyDesktop(rest);
  if ('startWithWindows' in safe && DESKTOP_HOOKS) trayMod.setStartWithWindows(rest.startWithWindows, __dirname);
  return { ...rest, hotkeyStatus };
});

// ---------- automatic import ----------

let autoImport = null;
function setupAutoImport() {
  autoImport = createAutoImporter({
    getSources: detectSources,
    importedLabels: () => lib.all('SELECT DISTINCT source FROM sources').map(r => r.source),
    importSource,
    onImported: (results) => send('auto-import', results),
  });
  if (process.env.BMLIB_NO_AUTOIMPORT) return;
  const s = loadSettings();
  if (s.importOnStart) autoImport.importAll();
  if (s.watchBrowsers) autoImport.start();
}

// ---------- browser extension bridge ----------

let bridge = null;
const extensionDir = () => require('./src/extbuild').SOURCE;

function bridgeToken() {
  let t = loadSettings().bridgeToken;
  if (!t) t = saveSettings({ bridgeToken: newToken() }).bridgeToken;
  return t;
}

ipcMain.handle('bridge:info', () => ({ token: bridgeToken(), folder: extensionDir(), ...(bridge ? bridge.status() : { listening: false }) }));
ipcMain.handle('bridge:newToken', () => saveSettings({ bridgeToken: newToken() }).bridgeToken);
ipcMain.handle('bridge:openFolder', () => shell.openPath(extensionDir()));
// Firefox build: rebuilt from extension/ each time, so it always matches this version of the app.
const firefoxDir = () => path.join(dataDir(), 'firefox-extension');
ipcMain.handle('bridge:firefox', () => {
  try { return { folder: firefoxDir(), manifest: buildFirefox(firefoxDir()) }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('bridge:openFirefoxFolder', () => { buildFirefox(firefoxDir()); return shell.openPath(firefoxDir()); });
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('ollama:status', (_e, model) => ollama.status(model || loadSettings().ollamaModel));

// Long-running jobs (categorize, link check) can be cancelled from the progress bar.
// Each running job has an AbortController; work finished before the cancel is kept.
const jobs = { categorize: null, links: null };
ipcMain.handle('job:cancel', (_e, kind) => { jobs[kind]?.abort(); return !!jobs[kind]; });

ipcMain.handle('claude:categorize', async (_e, { ids }) => {
  if (jobs.categorize) return { error: 'Already running.' };
  const ctrl = (jobs.categorize = new AbortController());
  let doneSoFar = 0;
  let cpuFallback = false;
  try {
    const wanted = new Set(ids);
    const all = lib.list();
    const bookmarks = all.filter(b => wanted.has(b.id)).map(b => ({ id: b.id, title: b.title, url: b.url, folder: b.folder, domain: b.domain }));
    const knownCategories = [...new Set(all.map(b => b.category).filter(Boolean))];
    const settings = loadSettings();
    const onBatch = (results, done, total) => {
      if (ctrl.signal.aborted) return;
      lib.applyCategories(results);
      doneSoFar = done;
      send('progress', { kind: 'categorize', done, total });
    };
    const signal = ctrl.signal;
    if (settings.categorizer === 'claude') {
      await claude.categorize({ apiKey: await loadKey(), bookmarks, knownCategories, onBatch, signal });
    } else if (settings.categorizer === 'ollama') {
      await ollama.categorize({
        model: settings.ollamaModel, bookmarks, knownCategories, onBatch, signal,
        cpu: !!settings.ollamaCpuOnly,
        // Remember it, so the next run doesn't crash the GPU first. Can be turned off in Settings.
        onFallback: () => { cpuFallback = true; saveSettings({ ollamaCpuOnly: true }); },
      });
    } else {
      await rules.categorize({ bookmarks, onBatch });
    }
    if (signal.aborted) return { cancelled: true, count: doneSoFar, total: bookmarks.length, cpuFallback };
    return { ok: true, count: bookmarks.length, cpuFallback };
  } catch (e) {
    if (ctrl.signal.aborted) return { cancelled: true, count: doneSoFar, cpuFallback };
    return { error: claude.describeError(e), cpuFallback };
  } finally {
    jobs.categorize = null;
  }
});

ipcMain.handle('links:check', async (_e, { ids }) => {
  if (jobs.links) return { error: 'Already running.' };
  const ctrl = (jobs.links = new AbortController());
  try {
    const wanted = new Set(ids);
    const items = lib.list().filter(b => wanted.has(b.id));
    let done = 0;
    await checkAll(items, (id, r) => {
      lib.setStatus(id, r.status, r.code);
      done++;
      if (done % 10 === 0 || done === items.length) { lib.save(); send('progress', { kind: 'links', done, total: items.length }); }
    }, ctrl.signal);
    lib.save();
    return ctrl.signal.aborted ? { cancelled: true, count: done, total: items.length } : { ok: true };
  } finally {
    jobs.links = null;
  }
});

ipcMain.handle('export:html', async (_e, { ids, groupBy }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export bookmarks',
    defaultPath: 'bookmarks-library.html',
    filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }],
  });
  if (r.canceled) return null;
  const wanted = new Set(ids);
  const items = lib.list().filter(b => wanted.has(b.id));
  fs.writeFileSync(r.filePath, toNetscapeHtml(items, groupBy), 'utf8');
  return r.filePath;
});

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toNetscapeHtml(items, groupBy) {
  const groups = new Map();
  for (const b of items) {
    const key = groupBy === 'folder' ? (b.folder || 'Unsorted') : (b.category || 'Uncategorized');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  for (const [name, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  <DT><H3>${esc(name)}</H3>`, '  <DL><p>');
    for (const b of list) {
      const added = b.added_at ? ` ADD_DATE="${Math.floor(b.added_at / 1000)}"` : '';
      const tags = b.tags.length ? ` TAGS="${esc(b.tags.join(','))}"` : '';
      lines.push(`    <DT><A HREF="${esc(b.url)}"${added}${tags}>${esc(b.title || b.url)}</A>`);
    }
    lines.push('  </DL><p>');
  }
  lines.push('</DL><p>');
  return lines.join('\n');
}

// ---------- startup ----------

// Dev hooks: BMLIB_DATA points the app at a separate data folder; BMLIB_SNAPSHOT saves a screenshot and quits.
if (process.env.BMLIB_DATA) app.setPath('userData', process.env.BMLIB_DATA);

// One copy of the app at a time: opening it again shows the running one. A second copy must never
// open the library, or the two would overwrite each other's changes.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
else app.on('second-instance', () => showWindow());

// Unexpected errors are logged (crash.log in the data folder) instead of stopping the app.
process.on('uncaughtException', (e) => { safety.logError(dataDir(), 'main', e); console.error(e); });
process.on('unhandledRejection', (e) => { safety.logError(dataDir(), 'main (promise)', e); console.error(e); });
ipcMain.handle('app:logError', (_e, where, message) => safety.logError(dataDir(), `window: ${String(where).slice(0, 100)}`, String(message).slice(0, 4000)));

// Library backups: daily copies in the data folder's "backups" folder.
const libraryFile = () => path.join(dataDir(), 'library.sqlite');
function dailyBackup() {
  try { safety.backupLibrary(dataDir(), libraryFile()); } catch (e) { safety.logError(dataDir(), 'backup', e); }
}
ipcMain.handle('library:backups', () => ({ folder: path.join(dataDir(), 'backups'), backups: safety.listLibraryBackups(dataDir()) }));
ipcMain.handle('library:openBackups', () => { fs.mkdirSync(path.join(dataDir(), 'backups'), { recursive: true }); return shell.openPath(path.join(dataDir(), 'backups')); });

const countBookmarks = (l) => l.get('SELECT COUNT(*) AS n FROM bookmarks').n;
const busy = () => (jobs.categorize || jobs.links ? 'Wait until auto-categorize or the link check is finished (or cancel it) first.' : null);
const backupLabel = (b) => b.kind === 'daily' ? `the daily backup from ${b.date}`
  : `the copy made ${new Date(b.at).toLocaleString()} (${b.kind === 'before-import' ? 'before an import' : 'before a restore'})`;

// Puts a backup back as the library. The current library is saved as a backup first, so it can be undone.
ipcMain.handle('library:restoreBackup', async (_e, name) => {
  const b = safety.listLibraryBackups(dataDir()).find(x => x.name === name);
  if (!b) return { error: 'That backup no longer exists.' };
  if (busy()) return { error: busy() };
  let count;
  try { count = countBookmarks(await Library.open(b.file)); } catch (e) { return { error: `This backup can't be read (${e.message}). Try an older one.` }; }
  const now = countBookmarks(lib);
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Restore library',
    message: `Restore your library from ${backupLabel(b)}?`,
    detail: `The backup has ${count} bookmarks; your library has ${now} now. Changes made since then are replaced.\n\n` +
      'Your current library is saved as a backup first, so you can switch back the same way. Bookmarks saved in your browsers since then come back with the next import.',
  });
  if (r.response !== 0) return { cancelled: true };
  lib.save();
  safety.snapshotLibrary(dataDir(), libraryFile(), 'before-restore');
  safety.restoreLibraryFile(b.file, libraryFile());
  lib = await Library.open(libraryFile());
  return { ok: true, count: countBookmarks(lib), from: backupLabel(b) };
});

// The whole library as one JSON file (for moving it to another PC, or keeping a copy elsewhere).
ipcMain.handle('library:exportJson', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export the whole library',
    defaultPath: `bookmark-syncer-library-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Bookmark syncer library', extensions: ['json'] }],
  });
  if (r.canceled) return null;
  const data = lib.exportData(app.getVersion());
  safety.writeFileAtomic(r.filePath, JSON.stringify(data, null, 1));
  return { file: r.filePath, count: data.bookmarks.length };
});

ipcMain.handle('library:importJson', async () => {
  if (busy()) return { error: busy() };
  const r = await dialog.showOpenDialog(win, {
    title: 'Import a library file',
    filters: [{ name: 'Bookmark syncer library', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  let data;
  try {
    if (fs.statSync(file).size > 300 * 1024 * 1024) throw new Error('The file is too large.');
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return { error: `Couldn't read ${path.basename(file)}: ${e.message}` }; }
  if (!data || data.format !== 'bookmark-syncer-library' || !Array.isArray(data.bookmarks)) {
    return { error: `${path.basename(file)} isn't a Bookmark syncer library file. To import a browser's bookmarks.html, use Import → “Import a bookmarks.html file…”.` };
  }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date';
  const ok = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Import', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Import library',
    message: `Import ${data.bookmarks.length} bookmarks from ${path.basename(file)}?`,
    detail: `Exported ${when}. Nothing in your library is removed: bookmarks you already have keep their values and get the missing categories, tags, notes and browsers. Bookmarks you deleted here stay deleted.\n\nYour library is saved as a backup first (⚙ Settings → Library backups).`,
  });
  if (ok.response !== 0) return { cancelled: true };
  lib.save();
  safety.snapshotLibrary(dataDir(), libraryFile(), 'before-import');
  try { return { ok: true, ...lib.importData(data) }; } catch (e) { return { error: e.message }; }
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { if (DESKTOP_HOOKS) require('electron').globalShortcut.unregisterAll(); });

// The app was called "Bookmark Library" before 0.4. Copy its data once to the new data folder,
// so the library, settings and saved API key carry over. The old folder is left as a backup.
function migrateOldData() {
  if (process.env.BMLIB_DATA) return;
  const oldDir = path.join(app.getPath('appData'), 'Bookmark Library');
  const newDir = dataDir();
  if (fs.existsSync(path.join(newDir, 'library.sqlite')) || !fs.existsSync(path.join(oldDir, 'library.sqlite'))) return;
  fs.mkdirSync(newDir, { recursive: true });
  for (const f of ['library.sqlite', 'settings.json', 'anthropic-key.bin']) {
    try { fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f)); } catch {}
  }
  console.log(`Copied your library from ${oldDir} to ${newDir}`);
}

app.whenReady().then(async () => {
  if (!firstInstance) return;
  migrateOldData();
  const opened = await safety.openLibrarySafely(Library, dataDir(), libraryFile());
  lib = opened.lib;
  dailyBackup();
  setInterval(dailyBackup, 60 * 60 * 1000).unref();
  createWindow();
  if (opened.recovered) {
    const r = opened.recovered;
    safety.logError(dataDir(), 'library', `damaged library moved to ${r.damaged}: ${r.error}`);
    win.webContents.once('did-finish-load', () => dialog.showMessageBox(win, {
      type: 'warning', title: 'Bookmark syncer',
      message: 'Your library file was damaged.',
      detail: (r.from ? `It was replaced with the backup from ${r.from}. Changes after that day are missing; importing from your browsers brings back new bookmarks.`
        : 'There was no backup, so the app started with an empty library. Import from your browsers to fill it again.') +
        `\n\nThe damaged file is kept as ${path.basename(r.damaged)} in the data folder.`,
    }));
  }
  if (DESKTOP_HOOKS) {
    const s = loadSettings();
    tray = trayMod.createTray({ icon: ICON, onOpen: () => showWindow(), onSearch: () => showWindow(true), onQuit: quitApp });
    applyDesktop(s);
  }
  win.webContents.once('did-finish-load', () => setTimeout(setupAutoImport, 1500));
  if (!process.env.BMLIB_NO_BRIDGE) {
    bridge = startBridge({
      getToken: bridgeToken,
      getDeletedNorms: () => lib.removedNorms(),
      getCategories: () => lib.categoryMap(),
      appVersion: app.getVersion(),
      onReport: (r) => send('bridge-report', r),
    });
  }
  if (process.env.BMLIB_SNAPSHOT) {
    win.webContents.on('console-message', (e) => { if (e.level === 'warning' || e.level === 'error') console.log('[renderer]', e.message); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.BMLIB_SNAPSHOT_JS) await win.webContents.executeJavaScript(process.env.BMLIB_SNAPSHOT_JS).catch(e => console.log('[js]', e.message));
      await new Promise(r => setTimeout(r, 800));
      fs.writeFileSync(process.env.BMLIB_SNAPSHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    }, 2500));
  }
});

app.on('window-all-closed', () => app.quit());
