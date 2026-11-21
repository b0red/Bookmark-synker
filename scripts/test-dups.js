// Near-duplicate detection, merge, undo, "not duplicates", and how merged URLs behave on
// import, delete and restore. Uses a throwaway library in a temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Library } = require('../src/db');
const { dupUrlKey, findDuplicates } = require('../src/duplicates');

// ---------- URL keys ----------
const same = (a, b) => assert.strictEqual(dupUrlKey(a), dupUrlKey(b), `${a}  vs  ${b}`);
const diff = (a, b) => assert.notStrictEqual(dupUrlKey(a), dupUrlKey(b), `${a}  vs  ${b}`);
same('https://m.youtube.com/', 'https://youtube.com');
same('https://youtu.be/abc123', 'https://www.youtube.com/watch?v=abc123&feature=share');
same('http://example.com/blog/index.html', 'https://example.com/blog/');
same('https://news.example.com/story/amp', 'https://news.example.com/story');
same('https://example.com/Path/Page', 'https://example.com/path/page');
same('https://mobile.example.org/a?ref=home', 'https://www.example.org/a');
diff('http://192.168.1.10:8080/', 'http://192.168.1.10:9090/');
diff('http://nas.local:9001/#/images', 'http://nas.local:9001/#/containers');
diff('https://www.youtube.com/watch?v=one', 'https://www.youtube.com/watch?v=two');
diff('https://example.com/a', 'https://example.com/b');
assert.strictEqual(dupUrlKey('javascript:void(0)'), null);
assert.strictEqual(dupUrlKey('not a url'), null);

// Titles: same path + title groups query variants; a generic title on different paths does not.
const groups = findDuplicates([
  { id: 1, url: 'http://blog.example.com/?zx=1', norm: 'a', title: 'My long blog title' },
  { id: 2, url: 'http://blog.example.com/?zx=2', norm: 'b', title: 'My long blog title' },
  { id: 3, url: 'https://www.reddit.com/r/x/wiki/one', norm: 'c', title: 'reddit: the front page of the internet' },
  { id: 4, url: 'https://www.reddit.com/r/x/wiki/two', norm: 'd', title: 'reddit: the front page of the internet' },
  { id: 5, url: 'javascript:alert(1)', norm: 'e', title: '' },
  { id: 6, url: 'javascript:alert(2)', norm: 'f', title: '' },
]);
assert.deepStrictEqual([...groups.keys()].sort(), [1, 2], 'only the blog pair');
console.log('URL and title keys OK');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-dups-'));
  try {
    const lib = await Library.open(path.join(dir, 'library.sqlite'));
    lib.importItems([
      { url: 'https://www.youtube.com/watch?v=abc123', title: 'A video', folder: 'Videos', tags: ['music'] },
      { url: 'https://example.com/other', title: 'Other' },
    ], 'Chrome · Default');
    lib.importItems([{ url: 'https://youtu.be/abc123', title: 'A video (share link)', folder: 'Mobile' }], 'Firefox · default');
    lib.importItems([{ url: 'https://m.youtube.com/watch?v=abc123', title: '' }], 'Opera · Default');

    let list = lib.list();
    const vids = list.filter(b => b.dup);
    assert.strictEqual(vids.length, 3, 'three versions of the video');
    assert.ok(!list.find(b => b.url === 'https://example.com/other').dup);
    const keep = vids.find(b => b.url.includes('www.youtube.com'));
    lib.update(keep.id, { category: 'Music', notes: 'keep me' });
    const otherVid = vids.find(b => b.url.includes('youtu.be'));
    lib.update(otherVid.id, { notes: 'from my phone', favorite: 1 });
    const before = JSON.stringify(lib.list().map(b => ({ ...b, dup: undefined, dup_signature: undefined })));

    // Merge
    const token = lib.mergeDuplicates(keep.id, vids.map(v => v.id));
    list = lib.list();
    assert.strictEqual(list.length, 2, 'one video left');
    const merged = list.find(b => b.id === keep.id);
    assert.deepStrictEqual(merged.aliases.sort(), ['https://m.youtube.com/watch?v=abc123', 'https://youtu.be/abc123']);
    assert.deepStrictEqual([...new Set(merged.sources.map(s => s.source))].sort(), ['Chrome · Default', 'Firefox · default', 'Opera · Default']);
    assert.strictEqual(merged.category, 'Music');
    assert.strictEqual(merged.favorite, 1);
    assert.ok(merged.notes.includes('keep me') && merged.notes.includes('from my phone'));
    assert.ok(merged.tags.includes('music'));
    assert.ok(!merged.dup, 'no longer a duplicate');
    assert.deepStrictEqual(lib.removedNorms(), [], 'merging deletes nothing in the browsers');

    // Importing a merged URL again lands on the kept bookmark.
    const r = lib.importItems([{ url: 'https://youtu.be/abc123', title: 'x', folder: 'Again' }], 'Edge · Default');
    assert.deepStrictEqual(r, { added: 0, merged: 1, skipped: 0 });
    assert.strictEqual(lib.list().length, 2);
    assert.ok(lib.list().find(b => b.id === keep.id).sources.some(s => s.source === 'Edge · Default'));

    // Undo the merge (the Edge source added after the merge stays with the kept one; that's fine)
    lib.unmerge(token);
    list = lib.list();
    assert.strictEqual(list.length, 4);
    assert.strictEqual(list.filter(b => b.dup).length, 3, 'group is back');
    assert.strictEqual(list.find(b => b.id === otherVid.id).notes, 'from my phone');
    assert.strictEqual(list.find(b => b.id === keep.id).notes, 'keep me');
    assert.deepStrictEqual(list.find(b => b.id === keep.id).aliases, []);
    const after = JSON.parse(JSON.stringify(list.map(b => ({ ...b, dup: undefined, dup_signature: undefined }))));
    const strip = (arr) => arr.map(b => ({ ...b, sources: b.sources.filter(s => s.source !== 'Edge · Default') }));
    assert.deepStrictEqual(strip(after), strip(JSON.parse(before)), 'undo restores every field');

    // Not duplicates
    const sig = list.find(b => b.dup).dup_signature;
    lib.dismissDuplicates(sig);
    assert.strictEqual(lib.list().filter(b => b.dup).length, 0);
    lib.dismissDuplicates(sig, true);
    assert.strictEqual(lib.list().filter(b => b.dup).length, 3);

    // Delete a merged bookmark: its alias URLs are deleted too (for Sync), but hidden in Recently deleted.
    lib.mergeDuplicates(keep.id, lib.list().filter(b => b.dup).map(b => b.id));
    lib.remove([keep.id]);
    assert.strictEqual(lib.removedNorms().length, 3);
    const rd = lib.listRemoved();
    assert.strictEqual(rd.length, 1, 'one entry in Recently deleted');
    assert.strictEqual(lib.importItems([{ url: 'https://youtu.be/abc123' }], 'Chrome · Default').skipped, 1, 'alias URL stays deleted');
    // Restore brings the aliases back.
    lib.restore([rd[0].id]);
    const back = lib.list().find(b => b.url.includes('www.youtube.com'));
    assert.strictEqual(back.aliases.length, 2);
    assert.deepStrictEqual(lib.removedNorms(), []);
    console.log('Merge, import of merged URLs, undo, not-duplicates, delete and restore OK');

    // The copy of your library: groups must be small and plausible.
    const copy = process.env.BMLIB_TEST_LIBRARY;
    if (copy && fs.existsSync(copy)) {
      const real = await Library.open(copy);
      const items = real.list();
      const g = new Map();
      for (const b of items) if (b.dup) g.set(b.dup, (g.get(b.dup) || 0) + 1);
      assert.ok([...g.values()].every(n => n <= 10), 'no giant groups');
      console.log(`Your library copy: ${g.size} duplicate groups among ${items.length} bookmarks`);
    }
    console.log('All duplicate checks passed.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
