// Keeping your library safe: daily backups, recovery from a damaged library file, and a crash log.

const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 14;
const MAX_LOG = 512 * 1024;

const backupDir = (dataDir) => path.join(dataDir, 'backups');
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// Newest first: [{ file, name, date, size }]
function listLibraryBackups(dataDir) {
  let names = [];
  try { names = fs.readdirSync(backupDir(dataDir)); } catch { return []; }
  return names.filter(n => /^library-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort().reverse().map(name => {
    const file = path.join(backupDir(dataDir), name);
    let size = 0;
    try { size = fs.statSync(file).size; } catch {}
    return { file, name, date: name.slice(8, 18), size };
  });
}

// Copies library.sqlite to backups/library-<date>.sqlite once a day, keeping the newest 14.
// Returns the backup's path, or null if there was nothing to do.
function backupLibrary(dataDir, libraryFile, now = Date.now()) {
  if (!fs.existsSync(libraryFile) || fs.statSync(libraryFile).size === 0) return null;
  fs.mkdirSync(backupDir(dataDir), { recursive: true });
  const dest = path.join(backupDir(dataDir), `library-${day(now)}.sqlite`);
  if (fs.existsSync(dest)) return null;
  fs.copyFileSync(libraryFile, dest);
  for (const old of listLibraryBackups(dataDir).slice(KEEP_BACKUPS)) { try { fs.unlinkSync(old.file); } catch {} }
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

module.exports = { backupLibrary, listLibraryBackups, openLibrarySafely, logError, writeFileAtomic, KEEP_BACKUPS };
