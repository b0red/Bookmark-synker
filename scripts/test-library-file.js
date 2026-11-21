// Whole-library export and import (JSON). Throwaway folders only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Library } = require('../src/db');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-libfile-'));
  try {
    // Library A: organized, with notes, favorites, read later, a merged URL, a deleted one.
    const a = await Library.open(path.join(dir, 'a.sqlite'));
    a.importItems([
      { url: 'https://example.com/recipes', title: 'Recipes', folder: 'Food', addedAt: 1000 },
      { url: 'https://example.com/recipes?ref=old', title: 'Recipes (old link)' },
      { url: 'https://github.com/me', title: 'GitHub', addedAt: 2000 },
      { url: 'https://gone.example.org/', title: 'Gone' },
    ], 'Chrome · Default');
    const id = (title) => a.list().find(b => b.title === title).id;
    a.update(id('Recipes'), { category: 'Cooking / Baking', notes: 'Grandma likes these', favorite: 1, tags: ['food', 'weekend'] });
    a.bulkUpdate([id('GitHub')], { readLater: true });
    a.mergeDuplicates(id('Recipes'), [id('Recipes (old link)')]);
    a.remove([id('Gone')]);
    a.importItems([{ url: 'https://example.com/recipes', title: 'Recipes' }], 'Firefox · default');

    const data = JSON.parse(JSON.stringify(a.exportData('1.0.1')));
    assert.strictEqual(data.format, 'bookmark-syncer-library');
    assert.strictEqual(data.bookmarks.length, 2);
    assert.strictEqual(data.deleted.length, 1);

    // Into an empty library: everything comes over.
    const b = await Library.open(path.join(dir, 'b.sqlite'));
    let r = b.importData(data);
    assert.deepStrictEqual(r, { added: 2, merged: 0, skipped: 0, deleted: 1 });
    const rec = b.list().find(x => x.title === 'Recipes');
    assert.strictEqual(rec.category, 'Cooking / Baking');
    assert.strictEqual(rec.notes, 'Grandma likes these');
    assert.strictEqual(rec.favorite, 1);
    assert.deepStrictEqual(rec.tags, ['food', 'weekend']);
    assert.deepStrictEqual([...new Set(rec.sources.map(s => s.source))].sort(), ['Chrome · Default', 'Firefox · default']);
    assert.deepStrictEqual(rec.aliases, ['https://example.com/recipes?ref=old']);
    assert.ok(b.list().find(x => x.title === 'GitHub').read_later, 'read later comes along');
    assert.strictEqual(b.listRemoved().length, 1, 'the deleted list comes along');
    assert.strictEqual(b.importItems([{ url: 'https://gone.example.org/', title: 'Gone' }], 'Edge · Default').skipped, 1, 'deleted stays deleted');
    assert.strictEqual(b.importItems([{ url: 'https://example.com/recipes?ref=old' }], 'Edge · Default').merged, 1, 'merged URL still merges');

    // Importing again changes nothing.
    r = b.importData(data);
    assert.deepStrictEqual(r, { added: 0, merged: 2, skipped: 0, deleted: 0 });
    assert.strictEqual(b.list().length, 2);
    assert.strictEqual(b.list().find(x => x.title === 'Recipes').notes, 'Grandma likes these', 'notes not doubled');

    // Into a library that has its own values: those are kept, only what's missing is filled in.
    const c = await Library.open(path.join(dir, 'c.sqlite'));
    c.importItems([{ url: 'https://example.com/recipes', title: 'My recipes' }, { url: 'https://github.com/me', title: 'GitHub' }], 'Edge · Default');
    const cid = c.list().find(x => x.title === 'My recipes').id;
    c.update(cid, { category: 'Food', notes: 'My own note', tags: ['mine'] });
    c.remove([c.list().find(x => x.title === 'GitHub').id]);
    r = c.importData(data);
    assert.deepStrictEqual(r, { added: 0, merged: 1, skipped: 1, deleted: 1 }, 'GitHub was deleted here, so it is skipped');
    const mine = c.list().find(x => x.id === cid);
    assert.strictEqual(mine.title, 'My recipes');
    assert.strictEqual(mine.category, 'Food');
    assert.strictEqual(mine.notes, 'My own note\n\nGrandma likes these');
    assert.deepStrictEqual(mine.tags, ['food', 'mine', 'weekend']);
    assert.strictEqual(mine.favorite, 1);

    // The file survives a reopen; bad files are refused without changing anything.
    assert.strictEqual((await Library.open(path.join(dir, 'b.sqlite'))).list().length, 2);
    assert.throws(() => b.importData({ hello: 1 }), /not a Bookmark syncer library/);
    assert.throws(() => b.importData({ ...data, version: 2 }), /newer version/);
    r = b.importData({ format: 'bookmark-syncer-library', version: 1, bookmarks: [{ url: 'javascript-less' }, { url: 42 }, null, { url: 'https://ok.example/' , tags: 'notalist', sources: [{}] }] });
    assert.deepStrictEqual(r, { added: 1, merged: 0, skipped: 3, deleted: 0 }, 'odd entries are skipped, not crashing');
    console.log('Library file: export, import into empty and existing libraries, re-import, bad files OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
