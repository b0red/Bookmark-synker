// Builds the Microsoft Store package: dist\Bookmark-syncer-<version>-Store.appx (upload it in Partner Center).
//
// electron-builder downloads the Windows packaging tools (makeappx.exe) into its cache, but on some PCs makeappx won't start
// from there ("side-by-side configuration is incorrect": Windows can't find the DLL manifests next to it in that folder).
// Copied to a plain temp folder it works, so this script copies it and tells electron-builder to use the copy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache');

const build = (env) => spawnSync(process.execPath, [cli, '--win', 'appx'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }).status;

function findKit(dir, depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'makeappx.exe' && /[\\/]x64$/i.test(dir)) return dir;
    if (e.isDirectory()) { const k = findKit(p, depth + 1); if (k) return k; }
  }
  return null;
}

if (process.env.ELECTRON_BUILDER_WINDOWS_KITS_PATH) process.exit(build({}));

let kit = findKit(cache);
if (!kit) {
  // First run: let electron-builder download the tools. If it builds, we're done; if makeappx fails, retry below.
  if (build({}) === 0) process.exit(0);
  kit = findKit(cache);
  if (!kit) { console.error('Could not find makeappx.exe in ' + cache); process.exit(1); }
}

const copy = path.join(os.tmpdir(), 'bookmark-syncer-windows-kit');
fs.rmSync(copy, { recursive: true, force: true });
fs.cpSync(kit, copy, { recursive: true });
console.log('Using the Windows packaging tools from ' + copy);
process.exit(build({ ELECTRON_BUILDER_WINDOWS_KITS_PATH: copy }));
