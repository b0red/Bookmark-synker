// Read later: queueing, opening, Undo, merging, deleting and restoring keep the queue right.
// Uses a throwaway library in a temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Library } = require('../src/db');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-later-'));
  try {
    const file = path.join(dir, 'library.sqlite');
    let lib = await Library.open(file);
    lib.importItems([
      { url: 'https://example.com/long-read', title: 'Long read' },
      { url: 'https://example.com/other', title: 'Other' },
      { url: 'https://www.youtube.com/watch?v=abc123', title: 'Video' },
      { url: 'https://youtu.be/abc123', title: 'Video (share link)' },
    ], 'Chrome · Default');
    const byTitle = (t) => lib.list().find(b => b.title === t);
    const a = byTitle('Long read'), b = byTitle('Other');
    assert.strictEqual(a.read_later, null);

    // Queue two; queueing again keeps the first time.
    lib.bulkUpdate([a.id, b.id], { readLater: true });
    const t1 = byTitle('Long read').read_later;
    assert.ok(t1 > 0);
    await new Promise(r => setTimeout(r, 5));
    lib.bulkUpdate([a.id], { readLater: true });
    assert.strictEqual(byTitle('Long read').read_later, t1, 'queue time stays');

    // Opening is remembered; it survives reopening the library file.
    lib.markOpened(a.id);
    lib = await Library.open(file);
    assert.ok(byTitle('Long read').opened_at >= t1);

    // Undo after a bulk change (setFields with the earlier values).
    lib.bulkUpdate([b.id], { readLater: false });
    assert.strictEqual(byTitle('Other').read_later, null);
    lib.setFields([{ id: b.id, category: null, favorite: 0, tags: [], read_later: t1 }]);
    assert.strictEqual(byTitle('Other').read_later, t1, 'undo puts it back in the queue');
    // Older Undo snapshots without the field leave it alone.
    lib.setFields([{ id: b.id, category: 'Work', favorite: 0, tags: [] }]);
    assert.strictEqual(byTitle('Other').read_later, t1);
    lib.update(b.id, { read_later: null });
    assert.strictEqual(byTitle('Other').read_later, null);

    // Merging duplicates keeps a queued bookmark queued.
    const x = lib.list().filter(i => i.dup);
    assert.strictEqual(x.length, 2);
    lib.bulkUpdate([x[1].id], { readLater: true });
    lib.mergeDuplicates(x[0].id, x.map(i => i.id));
    const kept = lib.list().find(i => i.id === x[0].id);
    assert.ok(kept.read_later, 'merged bookmark stays in Read later');

    // Delete and restore keeps it in the queue.
    lib.remove([a.id]);
    const rd = lib.listRemoved().find(r => r.url.includes('long-read'));
    assert.strictEqual(rd.read_later, t1);
    lib.restore([rd.id]);
    const back = byTitle('Long read');
    assert.strictEqual(back.read_later, t1);
    assert.ok(back.opened_at, 'opened time comes back too');

    // An old library (before 0.9) gets the new columns.
    const cols = lib.all('PRAGMA table_info(bookmarks)').map(c => c.name);
    assert.ok(cols.includes('read_later') && cols.includes('opened_at'));
    console.log('Read later: queue, open, undo, merge, delete and restore OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
