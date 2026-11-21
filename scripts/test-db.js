// Imports every detected browser into a throwaway library file and checks merge + re-import behaviour.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Library } = require('../src/db');
const { detectSources, parseChromium, parseFirefox } = require('../src/importers');

(async () => {
  const file = path.join(os.tmpdir(), `bmlib-test-${Date.now()}.sqlite`);
  const lib = await Library.open(file);
  const sources = detectSources();
  for (const s of sources) {
    const items = s.type === 'firefox' ? parseFirefox(s.path, lib.SQL) : parseChromium(s.path);
    const r = lib.importItems(items, s.label);
    console.log(`${s.label}: ${items.length} found, ${r.added} new, ${r.merged} merged`);
  }
  const first = lib.list();
  console.log(`Library: ${first.length} bookmarks`);

  // Re-importing must not add anything.
  const again = await Library.open(file);
  let added = 0;
  for (const s of sources) {
    const items = s.type === 'firefox' ? parseFirefox(s.path, again.SQL) : parseChromium(s.path);
    added += again.importItems(items, s.label).added;
  }
  assert.strictEqual(added, 0, 're-import added duplicates');
  assert.strictEqual(again.list().length, first.length);

  // Edits persist across reopen.
  const id = first[0].id;
  again.update(id, { category: 'Test', tags: ['A', 'b', 'a'], favorite: 1, notes: 'n' });
  const reopened = (await Library.open(file)).list().find(b => b.id === id);
  assert.strictEqual(reopened.category, 'Test');
  assert.deepStrictEqual(reopened.tags, ['a', 'b']);
  assert.strictEqual(reopened.favorite, 1);

  // Deleted bookmarks stay deleted when the same browsers are imported again.
  const lib3 = await Library.open(file);
  const doomed = lib3.list().slice(0, 5).map(b => b.id);
  lib3.remove(doomed);
  let readded = 0, skipped = 0;
  for (const s of sources) {
    const items = s.type === 'firefox' ? parseFirefox(s.path, lib3.SQL) : parseChromium(s.path);
    const r = lib3.importItems(items, s.label);
    readded += r.added; skipped += r.skipped;
  }
  assert.strictEqual(readded, 0, 'deleted bookmarks came back on re-import');
  assert.ok(skipped >= 5);
  assert.strictEqual((await Library.open(file)).list().length, first.length - 5);

  // Recently deleted: full snapshot, restore puts it back with its edits, and imports include it again.
  const lib4 = await Library.open(file);
  const victim = lib4.list()[0];
  lib4.update(victim.id, { category: 'Keep', tags: ['x', 'y'], notes: 'important', favorite: 1 });
  lib4.remove([victim.id]);
  const entry = lib4.listRemoved().find(r => r.norm === victim.norm);
  assert.ok(entry && entry.hasSnapshot && entry.id < 0, 'deleted entry listed with snapshot');
  assert.strictEqual(entry.category, 'Keep');
  assert.strictEqual(lib4.restore([entry.id]), 1);
  const back = (await Library.open(file)).list().find(b => b.norm === victim.norm);
  assert.ok(back, 'restored bookmark is back');
  assert.strictEqual(back.category, 'Keep');
  assert.deepStrictEqual(back.tags, ['x', 'y']);
  assert.strictEqual(back.notes, 'important');
  assert.strictEqual(back.favorite, 1);
  assert.deepStrictEqual(back.sources.map(s => s.source).sort(), victim.sources.map(s => s.source).sort());
  assert.ok(!lib4.removedNorms().includes(victim.norm), 'no longer skipped on import');
  // Old-style entries (URL only, from before 0.3) still restore.
  lib4.run('INSERT INTO removed (norm, removed_at) VALUES (?, ?)', ['example.org/old', Date.now()]);
  const old = lib4.listRemoved().find(r => r.norm === 'example.org/old');
  assert.strictEqual(old.url, 'https://example.org/old');
  assert.strictEqual(old.hasSnapshot, false);
  lib4.restore([old.id]);
  assert.ok(lib4.list().some(b => b.norm === 'example.org/old'));
  console.log('Recently deleted / restore: OK');

  // Bulk actions and their undo.
  const pickIds = lib4.list().slice(0, 4).map(b => b.id);
  const saved = lib4.list().filter(b => pickIds.includes(b.id)).map(b => ({ id: b.id, category: b.category, favorite: b.favorite, tags: b.tags }));
  lib4.bulkUpdate(pickIds, { category: 'Bulk', favorite: 1, addTags: ['New', 'two'] });
  let now = (await Library.open(file)).list().filter(b => pickIds.includes(b.id));
  assert.ok(now.every(b => b.category === 'Bulk' && b.favorite === 1 && b.tags.includes('new') && b.tags.includes('two')));
  lib4.bulkUpdate(pickIds, { removeTags: ['two'], category: null });
  now = lib4.list().filter(b => pickIds.includes(b.id));
  assert.ok(now.every(b => b.category === null && !b.tags.includes('two') && b.tags.includes('new')));
  lib4.setFields(saved);
  now = (await Library.open(file)).list().filter(b => pickIds.includes(b.id));
  assert.deepStrictEqual(now.map(b => ({ id: b.id, category: b.category, favorite: b.favorite, tags: b.tags })).sort((a, b) => a.id - b.id),
    saved.sort((a, b) => a.id - b.id));
  console.log('Bulk actions / undo: OK');

  const multi = first.filter(b => new Set(b.sources.map(s => s.source)).size > 1).length;
  const never = first.filter(b => !b.last_used_at && !b.visit_count).length;
  console.log(`In several browsers: ${multi}, never opened: ${never}`);
  fs.unlinkSync(file);
  console.log('All checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
