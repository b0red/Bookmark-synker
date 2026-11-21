// Tray icon, the global search shortcut, and "Start with Windows".
// The app can keep running in the tray after its window is closed, so the shortcut works any time.

const { Tray, Menu, globalShortcut, nativeImage, app } = require('electron');

const DEFAULT_HOTKEY = 'Ctrl+Alt+B';

// Turns the shortcut on or off. Returns { ok, error } (another app may already use the keys).
function applyHotkey({ enabled, accelerator }, onPress, t = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k])) {
  globalShortcut.unregisterAll();
  if (!enabled) return { ok: true, active: false };
  const keys = accelerator || DEFAULT_HOTKEY;
  try {
    if (globalShortcut.register(keys, onPress)) return { ok: true, active: true, accelerator: keys };
    return { ok: false, error: t('{keys} is already used by another app. Pick other keys.', { keys }) };
  } catch {
    return { ok: false, error: t("{keys} isn't a valid shortcut.", { keys }) };
  }
}

// t(text, vars): translation (English if none is given).
function createTray({ icon, onOpen, onSearch, onQuit, onShowDead, hotkeyLabel, t = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]) }) {
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
  let label = hotkeyLabel, dead = 0;
  const build = () => {
    tray.setToolTip(dead ? `Bookmark syncer · ${t(dead === 1 ? '1 dead link' : '{n} dead links', { n: dead })}` : 'Bookmark syncer');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('Open Bookmark syncer'), click: onOpen },
      { label: label ? `${t('Search bookmarks')}  (${label})` : t('Search bookmarks'), click: onSearch },
      ...(dead && onShowDead ? [{ label: t(dead === 1 ? 'Show 1 dead link' : 'Show {n} dead links', { n: dead }), click: onShowDead }] : []),
      { type: 'separator' },
      { label: t('Quit'), click: onQuit },
    ]));
  };
  build();
  tray.on('click', onOpen);
  return {
    tray,
    setHotkeyLabel: (l) => { label = l; build(); },
    setDeadCount: (n) => { if (n !== dead) { dead = n; build(); } },
    refresh: build, // after the language changes
    destroy: () => tray.destroy(),
  };
}

// Start with Windows, in the tray (the window stays hidden until you open it).
function setStartWithWindows(on, appDir) {
  // In development Electron needs the app folder as an argument; the installed app doesn't.
  const args = app.isPackaged ? ['--hidden'] : [appDir, '--hidden'];
  app.setLoginItemSettings({ openAtLogin: !!on, args });
}

module.exports = { applyHotkey, createTray, setStartWithWindows, DEFAULT_HOTKEY };
