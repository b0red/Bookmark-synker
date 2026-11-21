// Removes bookmarks the user deleted in the library from the browsers' own bookmark files.
// Safety: only runs on a browser that is closed, and backs up every file before changing it.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { detectSources } = require('./importers');
const { normalizeUrl } = require('./normalize');

const EXE = { Chrome: 'chrome.exe', Chromium: 'chrome.exe', Edge: 'msedge.exe', Brave: 'brave.exe', Vivaldi: 'vivaldi.exe', Opera: 'opera.exe', Firefox: 'firefox.exe' };
// "Opera" and "Opera GX" both run as opera.exe.
const exeOf = (browser) => EXE[browser] || (/^opera/i.test(browser) ? 'opera.exe' : '');

function runningProcesses() {
  return new Promise(resolve => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
      if (err) return resolve(new Set());
      resolve(new Set(out.split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map(s => s.toLowerCase())));
    });
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup(file) {
  // Never overwrite an earlier backup (two in the same second get -2, -3, …).
  const base = `${file}.bookmark-syncer-backup-${stamp()}`;
  let dest = base;
  for (let i = 2; fs.existsSync(dest); i++) dest = `${base}-${i}`;
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  return dest;
}

function writeAtomic(file, data) {
  const tmp = `${file}.bookmark-syncer-tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// ---------- Chromium ----------

// Returns the matching bookmarks, and with `apply` also removes them from the tree.
function chromiumWalk(data, removed, apply) {
  const hits = [];
  const walk = (node, trail) => {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.filter(c => {
      if (c.type === 'url' && removed.has(normalizeUrl(c.url))) {
        hits.push({ url: c.url, title: c.name || '', folder: trail.join(' / ') });
        return !apply;
      }
      if (c.type === 'folder') walk(c, [...trail, c.name]);
      return true;
    });
  };
  for (const root of Object.values(data.roots || {})) if (root && typeof root === 'object') walk(root, [root.name || '']);
  return hits;
}

function chromiumPlan(file, removed) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { matches: chromiumWalk(data, removed, false), synced: !!data.sync_metadata };
}

function chromiumApply(file, removed) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hits = chromiumWalk(data, removed, true);
  if (!hits.length) return { removed: 0 };
  const bak = backup(file);
  // The checksum covers the old contents; without it the browser simply accepts the file.
  delete data.checksum;
  writeAtomic(file, JSON.stringify(data, null, 3));
  return { removed: hits.length, backup: bak };
}

// ---------- Firefox ----------

function openFirefox(file, SQL) {
  return new SQL.Database(fs.readFileSync(file));
}

function rows(db, sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

// Real bookmarks (type 1) whose URL was deleted, plus their tag entries (Firefox stores tags as bookmarks too).
function firefoxTargets(db, removed) {
  const tagsRoot = rows(db, "SELECT id FROM moz_bookmarks WHERE guid = 'tags________'")[0];
  const tagFolders = new Set(tagsRoot ? rows(db, 'SELECT id FROM moz_bookmarks WHERE parent = ?', [tagsRoot.id]).map(r => r.id) : []);
  const all = rows(db, `SELECT b.id, b.parent, b.guid, b.title, b.syncStatus, b.fk, p.url
                        FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1`);
  const hit = all.filter(r => r.url && !r.url.startsWith('place:') && removed.has(normalizeUrl(r.url)));
  return { bookmarks: hit.filter(r => !tagFolders.has(r.parent)), tagEntries: hit.filter(r => tagFolders.has(r.parent)) };
}

function folderTrail(db, id) {
  const names = { 'menu________': 'Bookmarks Menu', 'toolbar_____': 'Bookmarks Toolbar', 'unfiled_____': 'Other Bookmarks', 'mobile______': 'Mobile Bookmarks' };
  const parts = [];
  let cur = rows(db, 'SELECT parent FROM moz_bookmarks WHERE id = ?', [id])[0];
  for (let i = 0; cur && i < 50; i++) {
    const f = rows(db, 'SELECT id, parent, title, guid FROM moz_bookmarks WHERE id = ?', [cur.parent])[0];
    if (!f || f.parent === 0) break;
    parts.unshift(names[f.guid] || f.title || '');
    cur = f;
  }
  return parts.filter(Boolean).join(' / ');
}

function walState(file) {
  try { return fs.statSync(`${file}-wal`).size; } catch { return 0; }
}

function firefoxPlan(file, removed, SQL) {
  const db = openFirefox(file, SQL);
  try {
    const { bookmarks } = firefoxTargets(db, removed);
    const synced = bookmarks.some(b => b.syncStatus === 2);
    return { matches: bookmarks.map(b => ({ url: b.url, title: b.title || '', folder: folderTrail(db, b.id) })), synced };
  } finally { db.close(); }
}

function firefoxApply(file, removed, SQL) {
  // A non-empty -wal file holds changes not yet in places.sqlite; rewriting the main file would lose them.
  if (walState(file) > 0) throw new Error('Firefox did not shut down cleanly. Open Firefox, close it again, then retry.');
  const db = openFirefox(file, SQL);
  try {
    const { bookmarks, tagEntries } = firefoxTargets(db, removed);
    if (!bookmarks.length) return { removed: 0 };
    // Matching is by URL, so every real bookmark of these URLs goes, and their tag entries
    // go with them (otherwise Firefox would still show the page as bookmarked).
    const items = [...bookmarks, ...tagEntries.map(t => ({ ...t, isTag: true }))];

    const nowUs = Date.now() * 1000;
    const parents = new Set();
    db.run('BEGIN');
    try {
      for (const it of items) {
        db.run('DELETE FROM moz_bookmarks WHERE id = ?', [it.id]);
        db.run('DELETE FROM moz_items_annos WHERE item_id = ?', [it.id]);
        db.run('UPDATE moz_places SET foreign_count = MAX(foreign_count - 1, 0) WHERE id = ?', [it.fk]);
        // Tombstones tell Firefox Sync to delete the bookmark on your other devices too.
        if (!it.isTag && it.syncStatus === 2) db.run('INSERT OR REPLACE INTO moz_bookmarks_deleted (guid, dateRemoved) VALUES (?, ?)', [it.guid, nowUs]);
        parents.add(it.parent);
      }
      // Keep sibling positions contiguous and mark the folders as changed for Sync.
      for (const p of parents) {
        const kids = rows(db, 'SELECT id FROM moz_bookmarks WHERE parent = ? ORDER BY position, id', [p]);
        kids.forEach((k, i) => db.run('UPDATE moz_bookmarks SET position = ? WHERE id = ?', [i, k.id]));
        db.run('UPDATE moz_bookmarks SET lastModified = ?, syncChangeCounter = syncChangeCounter + 1 WHERE id = ?', [nowUs, p]);
      }
      // Tags that no longer have any page are removed, like Firefox does itself.
      db.run(`DELETE FROM moz_bookmarks WHERE type = 2
                AND parent = (SELECT id FROM moz_bookmarks WHERE guid = 'tags________')
                AND id NOT IN (SELECT parent FROM moz_bookmarks)`);
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
    const bak = backup(file);
    writeAtomic(file, Buffer.from(db.export()));
    // The (empty) WAL and its index belonged to the old file; Firefox recreates them.
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(file + ext); } catch {} }
    return { removed: bookmarks.length, backup: bak };
  } finally { db.close(); }
}

// ---------- public ----------

async function plan(removedNorms, SQL) {
  const removed = new Set(removedNorms);
  const running = await runningProcesses();
  const out = [];
  for (const s of detectSources()) {
    const entry = { label: s.label, browser: s.browser, path: s.path, running: running.has(exeOf(s.browser)), matches: [], synced: false };
    try {
      Object.assign(entry, s.type === 'firefox' ? firefoxPlan(s.path, removed, SQL) : chromiumPlan(s.path, removed));
    } catch (e) {
      entry.error = e.message;
    }
    out.push(entry);
  }
  return out;
}

async function apply(labels, removedNorms, SQL) {
  const removed = new Set(removedNorms);
  const running = await runningProcesses();
  const results = [];
  for (const s of detectSources().filter(x => labels.includes(x.label))) {
    if (running.has(exeOf(s.browser))) {
      results.push({ label: s.label, error: `${s.browser} is running. Close it completely (check the system tray) and try again.` });
      continue;
    }
    try {
      results.push({ label: s.label, ...(s.type === 'firefox' ? firefoxApply(s.path, removed, SQL) : chromiumApply(s.path, removed)) });
    } catch (e) {
      results.push({ label: s.label, error: e.message });
    }
  }
  return results;
}

// ---------- backups ----------

const BACKUP_TAG = '.bookmark-syncer-backup-';

function countBookmarks(type, file, SQL) {
  try {
    if (type === 'firefox') {
      const db = openFirefox(file, SQL);
      try { return rows(db, 'SELECT COUNT(*) AS n FROM moz_bookmarks WHERE type = 1')[0].n; } finally { db.close(); }
    }
    let n = 0;
    const walk = (node) => { for (const c of (node && node.children) || []) c.type === 'url' ? n++ : walk(c); };
    Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).roots || {}).forEach(walk);
    return n;
  } catch {
    return null; // unreadable: still listed, just without a count
  }
}

// "20261121-140312" (or "…-140312-2") -> time in ms, with the -N keeping same-second backups in order
function parseStamp(s) {
  const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)(?:-(\d+))?$/.exec(s);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() + (m[7] ? +m[7] - 1 : 0) : null;
}

// Backups the app made next to each profile's bookmark file, newest first.
function backupsFor(source, SQL) {
  const dir = path.dirname(source.path);
  const prefix = path.basename(source.path) + BACKUP_TAG;
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.startsWith(prefix)); } catch {}
  return names.map(n => {
    const file = path.join(dir, n);
    const at = parseStamp(n.slice(prefix.length));
    return at && { file, at, size: fs.statSync(file).size, count: countBookmarks(source.type, file, SQL) };
  }).filter(Boolean).sort((a, b) => b.at - a.at);
}

function listBackups(SQL, sources = detectSources()) {
  return sources.map(s => ({
    label: s.label, browser: s.browser, current: countBookmarks(s.type, s.path, SQL), backups: backupsFor(s, SQL),
  })).filter(p => p.backups.length);
}

// Puts a backup back. The current file is backed up first, so this can be undone the same way.
async function restoreBackup(label, backupFile, SQL, sources = detectSources()) {
  const s = sources.find(x => x.label === label);
  if (!s) throw new Error('That browser profile was not found.');
  if ((await runningProcesses()).has(exeOf(s.browser))) {
    throw new Error(`${s.browser} is running. Close it completely (check the system tray) and try again.`);
  }
  return { label, ...restoreFile(s, backupFile, SQL) };
}

// The file part of a restore (no check for a running browser), also used by the tests on copies.
function restoreFile(s, backupFile, SQL) {
  // Only a backup listed for this profile, never an arbitrary path.
  const known = backupsFor(s, SQL).find(b => path.resolve(b.file) === path.resolve(String(backupFile)));
  if (!known) throw new Error('That backup was not found.');
  if (s.type === 'firefox' && walState(s.path) > 0) {
    throw new Error('Firefox did not shut down cleanly. Open Firefox, close it again, then retry.');
  }
  if (countBookmarks(s.type, known.file, SQL) === null) throw new Error('That backup file is damaged and was not restored.');
  const saved = backup(s.path);
  const tmp = `${s.path}.bookmark-syncer-tmp`;
  fs.copyFileSync(known.file, tmp);
  fs.renameSync(tmp, s.path);
  if (s.type === 'firefox') for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(s.path + ext); } catch {} }
  return { restored: known.count, backup: saved };
}

module.exports = { plan, apply, chromiumApply, firefoxApply, chromiumPlan, firefoxPlan, listBackups, restoreBackup, restoreFile };
