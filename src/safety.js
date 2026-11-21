// Keeping your library safe: daily backups, recovery from a damaged library file, and a crash log.

const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 14;   // daily copies
const KEEP_SNAPSHOTS = 10; // copies made right before a restore or an import
const MAX_LOG = 512 * 1024;

const backupDir = (dataDir) => path.join(dataDir, 'backups');
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// Daily: library-2026-01-20.sqlite. Snapshot: library-2026-01-20T13-05-22-before-restore.sqlite (UTC)
const BACKUP_NAME = /^library-(\d{4}-\d{2}-\d{2})(?:T(\d{2})-(\d{2})-(\d{2})-([a-z-]+))?\.sqlite$/;

// Newest first: [{ file, name, date, at, kind ('daily' | 'before-restore' | 'before-import'), size }]
function listLibraryBackups(dataDir) {
  let names = [];
  try { names = fs.readdirSync(backupDir(dataDir)); } catch { return []; }
  return names.filter(n => BACKUP_NAME.test(n)).sort().reverse().map(name => {
    const m = name.match(BACKUP_NAME);
    const file = path.join(backupDir(dataDir), name);
    let size = 0, mtime = null;
    try { const st = fs.statSync(file); size = st.size; mtime = st.mtimeMs; } catch {}
    const at = m[2] ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : mtime;
    return { file, name, date: m[1], at, kind: m[5] || 'daily', size };
  });
}

function prune(dataDir) {
  const all = listLibraryBackups(dataDir);
  const old = [...all.filter(b => b.kind === 'daily').slice(KEEP_BACKUPS), ...all.filter(b => b.kind !== 'daily').slice(KEEP_SNAPSHOTS)];
  for (const b of old) { try { fs.unlinkSync(b.file); } catch {} }
}

// A copy of the library right before a big change (reason: 'before-restore' | 'before-import').
function snapshotLibrary(dataDir, libraryFile, reason, now = Date.now()) {
  if (!fs.existsSync(libraryFile)) return null;
  fs.mkdirSync(backupDir(dataDir), { recursive: true });
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/:/g, '-');
  const dest = path.join(backupDir(dataDir), `library-${stamp}-${reason}.sqlite`);
  fs.copyFileSync(libraryFile, dest);
  prune(dataDir);
  return dest;
}

// Puts a backup in place of the library file. The caller saves a snapshot first and reopens the library.
function restoreLibraryFile(backupFile, libraryFile) {
  const tmp = libraryFile + '.restore.tmp';
  fs.copyFileSync(backupFile, tmp);
  fs.renameSync(tmp, libraryFile);
}

// Copies library.sqlite to backups/library-<date>.sqlite once a day, keeping the newest 14.
// Returns the backup's path, or null if there was nothing to do.
function backupLibrary(dataDir, libraryFile, now = Date.now()) {
  if (!fs.existsSync(libraryFile) || fs.statSync(libraryFile).size === 0) return null;
  fs.mkdirSync(backupDir(dataDir), { recursive: true });
  const dest = path.join(backupDir(dataDir), `library-${day(now)}.sqlite`);
  if (fs.existsSync(dest)) return null;
  fs.copyFileSync(libraryFile, dest);
  prune(dataDir);
  return dest;
}

// Opens the library. If the file is damaged, it is kept aside (library.damaged-<time>.sqlite) and the
// newest backup that opens is used instead (or an empty library if there is none).
// Returns { lib, recovered: null | { damaged, from } }.
async function openLibrarySafely(Library, dataDir, libraryFile) {
  try {
    return { lib: await Library.open(libraryFile), recovered: null };
  } catch (err) {
    const damaged = libraryFile.replace(/\.sqlite$/, `.damaged-${Date.now()}.sqlite`);
    try { fs.renameSync(libraryFile, damaged); } catch { try { fs.copyFileSync(libraryFile, damaged); fs.unlinkSync(libraryFile); } catch {} }
    for (const b of listLibraryBackups(dataDir)) {
      try {
        fs.copyFileSync(b.file, libraryFile);
        const lib = await Library.open(libraryFile);
        return { lib, recovered: { damaged, from: b.date, error: err.message } };
      } catch { try { fs.unlinkSync(libraryFile); } catch {} }
    }
    return { lib: await Library.open(libraryFile), recovered: { damaged, from: null, error: err.message } };
  }
}

// Appends to crash.log (kept small), so problems can be found afterwards.
function logError(dataDir, where, err) {
  try {
    const file = path.join(dataDir, 'crash.log');
    try { if (fs.statSync(file).size > MAX_LOG) fs.renameSync(file, file + '.old'); } catch {}
    const detail = err && err.stack ? err.stack : String(err);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${where}: ${detail}\n`);
  } catch { /* logging must never crash the app */ }
}

// Writes a file so a crash mid-write can't leave it half-written.
function writeFileAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

module.exports = { backupLibrary, snapshotLibrary, restoreLibraryFile, listLibraryBackups, openLibrarySafely, logError, writeFileAtomic, KEEP_BACKUPS, KEEP_SNAPSHOTS };
