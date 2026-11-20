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

  const multi = first.filter(b => new Set(b.sources.map(s => s.source)).size > 1).length;
  const never = first.filter(b => !b.last_used_at && !b.visit_count).length;
  console.log(`In several browsers: ${multi}, never opened: ${never}`);
  fs.unlinkSync(file);
  console.log('All checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
