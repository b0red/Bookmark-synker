// Library backups, recovery from a damaged library file, and the crash log. Throwaway folders only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Library } = require('../src/db');
const safety = require('../src/safety');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-safety-'));
  try {
    const file = path.join(dir, 'library.sqlite');
    let lib = await Library.open(file);
    lib.importItems([{ url: 'https://example.com/a', title: 'A' }, { url: 'https://example.com/b', title: 'B' }], 'Chrome · Default');

    // One backup per day; the 14 newest are kept.
    const DAY = 86400000, start = Date.UTC(2026, 0, 1);
    assert.ok(safety.backupLibrary(dir, file, start));
    assert.strictEqual(safety.backupLibrary(dir, file, start + 1000), null, 'only once a day');
    for (let d = 1; d < 20; d++) safety.backupLibrary(dir, file, start + d * DAY);
    const backups = safety.listLibraryBackups(dir);
    assert.strictEqual(backups.length, safety.KEEP_BACKUPS);
    assert.strictEqual(backups[0].date, '2026-01-20', 'newest first');
    assert.strictEqual(backups.at(-1).date, '2026-01-07');

    // A damaged library: moved aside, newest backup used.
    lib.importItems([{ url: 'https://example.com/c', title: 'C (after the backup)' }], 'Chrome · Default');
    fs.writeFileSync(file, 'this is not a database');
    let r = await safety.openLibrarySafely(Library, dir, file);
    assert.ok(r.recovered && r.recovered.from === '2026-01-20');
    assert.strictEqual(r.lib.list().length, 2, 'the backup\'s bookmarks');
    assert.ok(fs.existsSync(r.recovered.damaged) && fs.readFileSync(r.recovered.damaged, 'utf8') === 'this is not a database', 'damaged file kept');

    // The newest backup is damaged too: the next one is used.
    fs.writeFileSync(file, 'broken again');
    fs.writeFileSync(backups[0].file, 'broken backup');
    r = await safety.openLibrarySafely(Library, dir, file);
    assert.strictEqual(r.recovered.from, '2026-01-19');
    assert.strictEqual(r.lib.list().length, 2);

    // No usable backup: an empty library, the damaged file still kept.
    for (const b of safety.listLibraryBackups(dir)) fs.unlinkSync(b.file);
    fs.writeFileSync(file, 'broken');
    r = await safety.openLibrarySafely(Library, dir, file);
    assert.strictEqual(r.recovered.from, null);
    assert.strictEqual(r.lib.list().length, 0);
    r.lib.importItems([{ url: 'https://example.com/new', title: 'New' }], 'Chrome · Default');
    assert.strictEqual((await Library.open(file)).list().length, 1, 'the new library saves normally');

    // A healthy library opens without any recovery.
    r = await safety.openLibrarySafely(Library, dir, file);
    assert.strictEqual(r.recovered, null);

    // Crash log
    safety.logError(dir, 'test', new Error('boom'));
    safety.logError(dir, 'test', 'plain message');
    const log = fs.readFileSync(path.join(dir, 'crash.log'), 'utf8');
    assert.ok(log.includes('test: Error: boom') && log.includes('plain message'));

    // Atomic write
    const sf = path.join(dir, 'settings.json');
    safety.writeFileAtomic(sf, '{"a":1}');
    assert.strictEqual(fs.readFileSync(sf, 'utf8'), '{"a":1}');
    assert.ok(!fs.existsSync(sf + '.tmp'));
    console.log('Safety: daily backups, damaged-library recovery, crash log and atomic writes OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
