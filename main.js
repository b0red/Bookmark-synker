const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { Library } = require('./src/db');
const { detectSources, detectExportOnly, findBookmarkExports, parseChromium, parseFirefox, parseHtml } = require('./src/importers');
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
// The Store version starts with Windows through a Windows startup task, which can't pass --hidden. So a Store launch in the
// first few minutes after Windows starts counts as that startup launch and goes to the tray too. (Opening the app again shows it.)
const STORE_AUTOSTART_SECONDS = 180;
const startHidden = process.argv.includes('--hidden') || (!!process.windowsStore && require('os').uptime() < STORE_AUTOSTART_SECONDS);
// Tests and screenshots never touch the tray, the global shortcut or Windows startup.
const DESKTOP_HOOKS = process.env.BMLIB_DESKTOP === '1' || (!process.env.BMLIB_SNAPSHOT && !process.env.BMLIB_NO_DESKTOP);
const dataDir = () => app.getPath('userData');
const keyFile = () => path.join(dataDir(), 'anthropic-key.bin');

// ---------- language ----------
// 'en' or 'sv': the setting, or Windows' language when it's "Same as Windows". The dictionary is shared
// with the window (renderer/lang/sv.js); main uses it for dialogs and the tray.
const SV = require('./renderer/lang/sv.js');
let LANG = 'en';
function resolveLanguage() {
  const set = loadSettings().language;
  if (set === 'en' || set === 'sv') return set;
  const sys = (app.getPreferredSystemLanguages?.()[0] || app.getLocale() || '').toLowerCase();
  return sys.startsWith('sv') ? 'sv' : 'en';
}
function t(s, v) {
  const text = LANG === 'sv' && Object.prototype.hasOwnProperty.call(SV, s) ? SV[s] : s;
  return v ? text.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : text;
}
const tn = (n, one, many, v) => t(n === 1 ? one : many, { n, ...v });
// Error messages from the helper modules (src/) are English; these are translated on their way to the window.
const ERROR_PATTERNS = [
  [/^(.+) did not shut down cleanly\. Open .+, close it again, then retry\.$/, 'browser', '{browser} did not shut down cleanly. Open {browser}, close it again, then retry.'],
  [/^(.+) is running\. Close it completely \(check the system tray\) and try again\.$/, 'browser', '{browser} is running. Close it completely (check the system tray) and try again.'],
  [/^Ollama doesn't have the model "(.+)" yet\. In a terminal, run: ollama pull .+$/, 'model', 'Ollama doesn\'t have the model "{model}" yet. In a terminal, run: ollama pull {model}'],
  [/^Ollama doesn't have the model "(.+)" yet\. Run: ollama pull .+$/, 'model', 'Ollama doesn\'t have the model "{model}" yet. In a terminal, run: ollama pull {model}'],
];
function tErr(msg) {
  if (typeof msg !== 'string' || LANG === 'en') return msg;
  for (const [re, name, key] of ERROR_PATTERNS) {
    const m = msg.match(re);
    if (m) return t(key, { [name]: m[1] });
  }
  return t(msg);
}
const tErrors = (list) => (Array.isArray(list) ? list.map(r => (r && r.error ? { ...r, error: tErr(r.error) } : r)) : list);
ipcMain.on('app:lang', (e) => { e.returnValue = LANG; });

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Light, dark, or follow Windows ('system'). The page's CSS follows this through prefers-color-scheme.
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9');
function applyTheme(theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: windowBackground(),
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
    else dialog.showErrorBox('Bookmark syncer', t('The window keeps crashing. Your library is saved. Details are in {file}.', { file: path.join(dataDir(), 'crash.log') }));
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
      tray.tray.displayBalloon({ iconType: 'info', title: t('Bookmark syncer is still running'),
        content: [t("It's in the tray."), hotkeyStatus.active ? t('Press {keys} to search your bookmarks.', { keys: hotkeyStatus.accelerator }) : '', t('Right-click the icon to quit.')].filter(Boolean).join(' ') });
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
  hotkeyStatus = trayMod.applyHotkey({ enabled: s.hotkeyEnabled, accelerator: s.hotkey }, () => showWindow(true), t);
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
  hotkeyEnabled: true, hotkey: trayMod.DEFAULT_HOTKEY, closeToTray: true, startWithWindows: false, autoLinkCheck: 'off', theme: 'system', language: 'auto', updateCheck: true, startPage: false };

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

// ---------- IPC ----------

ipcMain.handle('sources:detect', () => detectSources());
ipcMain.handle('sources:exportOnly', () => detectExportOnly());

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
      results.push({ label: s.label, error: /EBUSY|locked/i.test(e.message) ? t('File is locked. Close the browser and try again.') : e.message });
    }
  }
  return results;
});

ipcMain.handle('import:html', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: t('Import exported bookmarks'),
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

// BMLIB_DOWNLOADS (dev hook): a different Downloads folder, for tests.
const downloadsDir = () => process.env.BMLIB_DOWNLOADS || app.getPath('downloads');
// DuckDuckGo: the newest bookmark export in Downloads, then importing exactly that file (only files from that folder).
ipcMain.handle('import:findExport', () => findBookmarkExports(downloadsDir())[0] || null);
ipcMain.handle('import:exportFile', (_e, file, browser) => {
  const found = findBookmarkExports(downloadsDir()).find(f => f.path === file);
  if (!found) return [{ label: path.basename(String(file)), error: t('That file is no longer in your Downloads folder.') }];
  const label = `${browser || 'File'} · export`;
  try {
    const items = parseHtml(fs.readFileSync(found.path, 'utf8'));
    return [{ label, found: items.length, ...lib.importItems(items, label) }];
  } catch (e) {
    return [{ label, error: e.message }];
  }
});

ipcMain.handle('library:list', () => { updateDeadCount(); return lib.list(); });
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
ipcMain.handle('browsers:plan', async () => tErrors(await browserSync.plan(lib.removedNorms(), lib.SQL)));
ipcMain.handle('browsers:apply', async (_e, labels) => tErrors(await browserSync.apply(labels, lib.removedNorms(), lib.SQL)));
ipcMain.handle('browsers:backups', () => browserSync.listBackups(lib.SQL));
ipcMain.handle('browsers:restore', async (_e, label, file) => {
  try { return await browserSync.restoreBackup(label, file, lib.SQL); } catch (e) { return { label, error: tErr(e.message) }; }
});
ipcMain.handle('browsers:reveal', (_e, file) => { if (typeof file === 'string' && fs.existsSync(file)) shell.showItemInFolder(file); });

ipcMain.handle('key:status', async () => ({ saved: !!(await loadKey()), env: !!process.env.ANTHROPIC_API_KEY }));
ipcMain.handle('key:save', async (_e, key) => {
  if (!key) { try { fs.unlinkSync(keyFile()); } catch {} return true; }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error(t('Windows encryption is unavailable; set ANTHROPIC_API_KEY instead.'));
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
  return { ...rest, hotkeyStatus, storeApp: !!process.windowsStore };
});
ipcMain.handle('settings:save', (_e, patch) => {
  const { bridgeToken, ...safe } = patch || {};
  const { bridgeToken: _t, ...rest } = saveSettings(safe);
  if ('watchBrowsers' in safe && autoImport) { if (rest.watchBrowsers) autoImport.start(); else autoImport.stop(); }
  if ('hotkey' in safe || 'hotkeyEnabled' in safe) applyDesktop(rest);
  // The Store version starts with Windows through its own startup task, which Windows turns on and off.
  if ('startWithWindows' in safe && DESKTOP_HOOKS && !process.windowsStore) trayMod.setStartWithWindows(rest.startWithWindows, __dirname);
  if ('theme' in safe) applyTheme(rest.theme);
  if ('language' in safe && resolveLanguage() !== LANG) {
    LANG = resolveLanguage();
    if (tray) tray.refresh();
    applyDesktop(rest); // hotkey messages
    if (win && !win.isDestroyed()) setTimeout(() => win.reload(), 50);
  }
  if ('updateCheck' in safe && rest.updateCheck) setTimeout(() => checkForUpdates(), 2000).unref();
  if (rest.startPage && ('startPage' in safe || 'language' in safe)) { try { writeStartPage(); } catch (e) { safety.logError(dataDir(), 'start page', e); } }
  if ('autoLinkCheck' in safe && AUTO_CHECK_EVERY[rest.autoLinkCheck]) setTimeout(maybeAutoLinkCheck, 60 * 1000).unref();
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
  if (jobs.categorize) return { error: t('Already running.') };
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
    return { error: tErr(claude.describeError(e)), cpuFallback };
  } finally {
    jobs.categorize = null;
  }
});

async function runLinkCheck(ids) {
  if (jobs.links) return { error: t('Already running.') };
  const ctrl = (jobs.links = new AbortController());
  try {
    const wanted = ids ? new Set(ids) : null;
    const items = lib.list().filter(b => !wanted || wanted.has(b.id));
    let done = 0;
    await checkAll(items, (id, r) => {
      lib.setStatus(id, r.status, r.code);
      done++;
      if (done % 10 === 0 || done === items.length) { lib.save(); send('progress', { kind: 'links', done, total: items.length }); }
    }, ctrl.signal);
    lib.save();
    return ctrl.signal.aborted ? { cancelled: true, count: done, total: items.length } : { ok: true, count: items.length };
  } finally {
    jobs.links = null;
    updateDeadCount();
  }
}
ipcMain.handle('links:check', (_e, { ids }) => runLinkCheck(ids));

// ---------- automatic link checks ----------
// Off unless turned on in Settings. Runs while the app is open (also in the tray) when the last
// automatic check is older than the chosen interval; new dead links are reported in the tray.

const AUTO_CHECK_EVERY = { weekly: 7 * 86400000, monthly: 30 * 86400000 };
const deadIds = () => new Set(lib.all("SELECT id FROM bookmarks WHERE status = 'dead'").map(r => r.id));

function updateDeadCount() {
  if (tray && lib) tray.setDeadCount(deadIds().size);
}

// ---------- update check (GitHub releases; not in the Store version, which the Store updates) ----------
const updates = require('./src/updates');
const UPDATE_EVERY = 24 * 60 * 60 * 1000;

// force: the "Check now" button (ignores the setting and the once-a-day limit, and doesn't announce in the tray).
async function checkForUpdates(force = false) {
  if (process.windowsStore) return { store: true };
  const s = loadSettings();
  if (!force && (!s.updateCheck || Date.now() - (s.lastUpdateCheck || 0) < UPDATE_EVERY)) return null;
  let latest;
  try { latest = await updates.latestRelease(); } catch (e) { return { error: e.message }; }
  saveSettings({ lastUpdateCheck: Date.now() });
  const current = app.getVersion();
  const result = { current, latest: latest.version, url: latest.url, available: updates.isNewer(latest.version, current) };
  if (result.available && !force && s.updateNotified !== latest.version) {
    saveSettings({ updateNotified: latest.version }); // each new version is announced once
    send('update', result);
    if (tray) tray.tray.displayBalloon({ iconType: 'info', title: 'Bookmark syncer', content: t('Version {version} is out. Open the app to download it.', { version: latest.version }) });
  }
  return result;
}
ipcMain.handle('updates:check', () => checkForUpdates(true));
ipcMain.handle('updates:open', (_e, url) => shell.openExternal(String(url).startsWith(updates.RELEASES_PAGE) ? url : updates.RELEASES_PAGE));

// ---------- start page (an HTML file with the bookmarks by category, for the browser's home page) ----------
const { buildStartPage } = require('./src/startpage');
const startPageFile = () => path.join(dataDir(), 'start.html');
const startPageUrl = () => require('url').pathToFileURL(startPageFile()).href;
let startPageTimer = null;

function writeStartPage() {
  if (!lib) return;
  const html = buildStartPage(lib.list(), { t, lang: LANG, updated: localTime(Date.now()) });
  safety.writeFileAtomic(startPageFile(), html);
}
// Rewritten a few seconds after the library changes (every change ends with a save).
function scheduleStartPage() {
  if (!loadSettings().startPage) return;
  clearTimeout(startPageTimer);
  startPageTimer = setTimeout(() => { try { writeStartPage(); } catch (e) { safety.logError(dataDir(), 'start page', e); } }, 3000);
  startPageTimer.unref?.();
}
const librarySave = Library.prototype.save;
Library.prototype.save = function save() { librarySave.call(this); scheduleStartPage(); };

ipcMain.handle('startpage:info', () => ({ file: startPageFile(), url: startPageUrl(), exists: fs.existsSync(startPageFile()) }));
ipcMain.handle('startpage:open', () => { writeStartPage(); return shell.openExternal(startPageUrl()); });

async function maybeAutoLinkCheck() {
  const s = loadSettings();
  const every = AUTO_CHECK_EVERY[s.autoLinkCheck];
  if (!every || !lib || jobs.links || jobs.categorize) return;
  if (Date.now() - (s.lastAutoLinkCheck || 0) < every) return;
  const before = deadIds();
  const r = await runLinkCheck(null);
  if (!r.ok) { if (r.cancelled) send('auto-links', { cancelled: true }); return; } // tried again later
  saveSettings({ lastAutoLinkCheck: Date.now() });
  const fresh = [...deadIds()].filter(id => !before.has(id)).length;
  send('auto-links', { checked: r.count, newDead: fresh, dead: deadIds().size });
  if (fresh && tray) {
    tray.tray.displayBalloon({ iconType: 'info', title: 'Bookmark syncer',
      content: tn(fresh, 'The automatic link check found 1 new dead link. Open the app to see it.', 'The automatic link check found {n} new dead links. Open the app to see them.') });
  }
}

ipcMain.handle('export:html', async (_e, { ids, groupBy }) => {
  const r = await dialog.showSaveDialog(win, {
    title: t('Export bookmarks'),
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
const busy = () => (jobs.categorize || jobs.links ? t('Wait until auto-categorize or the link check is finished (or cancel it) first.') : null);
const localTime = (ms) => new Date(ms).toLocaleString(LANG === 'sv' ? 'sv-SE' : undefined);
const backupLabel = (b) => b.kind === 'daily' ? t('the daily backup from {date}', { date: b.date })
  : t(b.kind === 'before-import' ? 'the copy made {when} (before an import)' : 'the copy made {when} (before a restore)', { when: localTime(b.at) });

// Puts a backup back as the library. The current library is saved as a backup first, so it can be undone.
ipcMain.handle('library:restoreBackup', async (_e, name) => {
  const b = safety.listLibraryBackups(dataDir()).find(x => x.name === name);
  if (!b) return { error: t('That backup no longer exists.') };
  if (busy()) return { error: busy() };
  let count;
  try { count = countBookmarks(await Library.open(b.file)); } catch (e) { return { error: t("This backup can't be read ({error}). Try an older one.", { error: e.message }) }; }
  const now = countBookmarks(lib);
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: [t('Restore'), t('Cancel')], defaultId: 1, cancelId: 1, title: t('Restore library'),
    message: t('Restore your library from {from}?', { from: backupLabel(b) }),
    detail: t('The backup has {count} bookmarks; your library has {now} now. Changes made since then are replaced.', { count, now }) + '\n\n' +
      t('Your current library is saved as a backup first, so you can switch back the same way. Bookmarks saved in your browsers since then come back with the next import.'),
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
    title: t('Export the whole library'),
    defaultPath: `bookmark-syncer-library-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: t('Bookmark syncer library'), extensions: ['json'] }],
  });
  if (r.canceled) return null;
  const data = lib.exportData(app.getVersion());
  safety.writeFileAtomic(r.filePath, JSON.stringify(data, null, 1));
  return { file: r.filePath, count: data.bookmarks.length };
});

ipcMain.handle('library:importJson', async () => {
  if (busy()) return { error: busy() };
  const r = await dialog.showOpenDialog(win, {
    title: t('Import a library file'),
    filters: [{ name: t('Bookmark syncer library'), extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  const name = path.basename(file);
  let data;
  try {
    if (fs.statSync(file).size > 300 * 1024 * 1024) throw new Error(t('The file is too large.'));
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return { error: t("Couldn't read {name}: {error}", { name, error: e.message }) }; }
  if (!data || data.format !== 'bookmark-syncer-library' || !Array.isArray(data.bookmarks)) {
    return { error: t("{name} isn't a Bookmark syncer library file. To import a browser's bookmarks.html, use Import → “Import a bookmarks.html file…”.", { name }) };
  }
  const when = data.exportedAt ? localTime(data.exportedAt) : t('an unknown date');
  const ok = await dialog.showMessageBox(win, {
    type: 'question', buttons: [t('Import'), t('Cancel')], defaultId: 0, cancelId: 1, title: t('Import library'),
    message: t('Import {n} bookmarks from {name}?', { n: data.bookmarks.length, name }),
    detail: t('Exported {when}. Nothing in your library is removed: bookmarks you already have keep their values and get the missing categories, tags, notes and browsers. Bookmarks you deleted here stay deleted.', { when }) + '\n\n' +
      t('Your library is saved as a backup first (⚙ Settings → Library backups).'),
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
  applyTheme(loadSettings().theme);
  LANG = resolveLanguage();
  dailyBackup();
  setInterval(dailyBackup, 60 * 60 * 1000).unref();
  scheduleStartPage(); // refresh it on start (when turned on)
  createWindow();
  if (opened.recovered) {
    const r = opened.recovered;
    safety.logError(dataDir(), 'library', `damaged library moved to ${r.damaged}: ${r.error}`);
    win.webContents.once('did-finish-load', () => dialog.showMessageBox(win, {
      type: 'warning', title: 'Bookmark syncer',
      message: t('Your library file was damaged.'),
      detail: (r.from ? t('It was replaced with the backup from {from}. Changes after that day are missing; importing from your browsers brings back new bookmarks.', { from: r.from })
        : t('There was no backup, so the app started with an empty library. Import from your browsers to fill it again.')) +
        '\n\n' + t('The damaged file is kept as {name} in the data folder.', { name: path.basename(r.damaged) }),
    }));
  }
  if (DESKTOP_HOOKS) {
    const s = loadSettings();
    tray = trayMod.createTray({ icon: ICON, onOpen: () => showWindow(), onSearch: () => showWindow(true), onQuit: quitApp, t,
      onShowDead: () => { showWindow(); send('show-view', 'dead'); } });
    applyDesktop(s);
    updateDeadCount();
  }
  if (!process.env.BMLIB_SNAPSHOT) {
    setTimeout(maybeAutoLinkCheck, 2 * 60 * 1000).unref();
    setInterval(maybeAutoLinkCheck, 60 * 60 * 1000).unref();
    setTimeout(() => checkForUpdates(), 30 * 1000).unref();
    setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000).unref();
  }
  win.webContents.once('did-finish-load', () => setTimeout(setupAutoImport, 1500));
  if (!process.env.BMLIB_NO_BRIDGE) {
    bridge = startBridge({
      getToken: bridgeToken,
      getDeletedNorms: () => lib.removedNorms(),
      getCategories: () => lib.categoryMap(),
      appVersion: app.getVersion(),
      onReport: (r) => send('bridge-report', r),
      getPage: (url) => lib.findByUrl(url),
      getVocabulary: () => lib.vocabulary(),
      savePage: (page, browser) => lib.savePage(page, `Added from ${browser}`),
      onChange: (c) => send('bridge-page', c),
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
