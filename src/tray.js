// Tray icon, the global search shortcut, and "Start with Windows".
// The app can keep running in the tray after its window is closed, so the shortcut works any time.

const { Tray, Menu, globalShortcut, nativeImage, app } = require('electron');

const DEFAULT_HOTKEY = 'Ctrl+Alt+B';

// Turns the shortcut on or off. Returns { ok, error } (another app may already use the keys).
function applyHotkey({ enabled, accelerator }, onPress) {
  globalShortcut.unregisterAll();
  if (!enabled) return { ok: true, active: false };
  const keys = accelerator || DEFAULT_HOTKEY;
  try {
    if (globalShortcut.register(keys, onPress)) return { ok: true, active: true, accelerator: keys };
    return { ok: false, error: `${keys} is already used by another app. Pick other keys.` };
  } catch {
    return { ok: false, error: `${keys} isn't a valid shortcut.` };
  }
}

function createTray({ icon, onOpen, onSearch, onQuit, hotkeyLabel }) {
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
  tray.setToolTip('Bookmark syncer');
  const build = (label) => Menu.buildFromTemplate([
    { label: 'Open Bookmark syncer', click: onOpen },
    { label: label ? `Search bookmarks  (${label})` : 'Search bookmarks', click: onSearch },
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]);
  tray.setContextMenu(build(hotkeyLabel));
  tray.on('click', onOpen);
  return { tray, setHotkeyLabel: (label) => tray.setContextMenu(build(label)), destroy: () => tray.destroy() };
}

// Start with Windows, in the tray (the window stays hidden until you open it).
function setStartWithWindows(on, appDir) {
  // In development Electron needs the app folder as an argument; the installed app doesn't.
  const args = app.isPackaged ? ['--hidden'] : [appDir, '--hidden'];
  app.setLoginItemSettings({ openAtLogin: !!on, args });
}

module.exports = { applyHotkey, createTray, setStartWithWindows, DEFAULT_HOTKEY };
