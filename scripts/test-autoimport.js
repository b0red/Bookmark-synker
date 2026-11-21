// Automatic import: imports on start, notices changed bookmark files, skips profiles you never
// imported, waits 10 minutes between Firefox imports, and keeps going after errors.
const assert = require('assert');
const { createAutoImporter, FIREFOX_MIN_GAP } = require('../src/autoimport');

(async () => {
  const mtimes = { '/chrome/Bookmarks': 100, '/edge/Bookmarks': 100, '/ff/places.sqlite': 100, '/ff/places.sqlite-wal': 100, '/skipped/Bookmarks': 100 };
  const stat = (f) => { if (!(f in mtimes)) throw new Error('ENOENT'); return { mtimeMs: mtimes[f] }; };
  const sources = [
    { label: 'Chrome · A', type: 'chromium', path: '/chrome/Bookmarks' },
    { label: 'Edge · B', type: 'chromium', path: '/edge/Bookmarks' },
    { label: 'Firefox · C', type: 'firefox', path: '/ff/places.sqlite' },
    { label: 'Brave · never imported', type: 'chromium', path: '/skipped/Bookmarks' },
  ];
  let clock = 1_000_000;
  const imported = [], notified = [];
  let failEdge = false;
  const auto = createAutoImporter({
    getSources: () => sources,
    importedLabels: () => ['Chrome · A', 'Edge · B', 'Firefox · C', 'File · old.html'],
    importSource: async (s) => {
      if (failEdge && s.label === 'Edge · B') throw new Error('EBUSY: locked');
      imported.push(s.label);
      return { added: s.label === 'Chrome · A' ? 2 : 0, merged: 5, skipped: 0 };
    },
    onImported: (r) => notified.push(r),
    now: () => clock,
    stat,
  });

  // On start: all profiles imported before, not the skipped one. Only additions are reported.
  await auto.importAll();
  assert.deepStrictEqual(imported, ['Chrome · A', 'Edge · B', 'Firefox · C']);
  assert.deepStrictEqual(notified, [[{ label: 'Chrome · A', added: 2 }]]);

  // Nothing changed: nothing imported.
  imported.length = 0; notified.length = 0;
  await auto.tick();
  assert.deepStrictEqual(imported, []);

  // Chrome saved a bookmark; the never-imported profile changed too (ignored).
  mtimes['/chrome/Bookmarks'] = 200; mtimes['/skipped/Bookmarks'] = 200;
  await auto.tick();
  assert.deepStrictEqual(imported, ['Chrome · A']);
  assert.strictEqual(notified.length, 1);

  // Firefox changed right after its last import: waits for the 10-minute gap.
  imported.length = 0;
  mtimes['/ff/places.sqlite-wal'] = 300;
  await auto.tick();
  assert.deepStrictEqual(imported, [], 'Firefox too soon');
  clock += FIREFOX_MIN_GAP + 1;
  await auto.tick();
  assert.deepStrictEqual(imported, ['Firefox · C'], 'Firefox after the gap');

  // A locked file doesn't stop the others; no message when nothing new was added.
  imported.length = 0; notified.length = 0;
  failEdge = true;
  mtimes['/edge/Bookmarks'] = 400; mtimes['/chrome/Bookmarks'] = 400;
  await auto.tick();
  assert.deepStrictEqual(imported, ['Chrome · A']);
  assert.strictEqual(notified.length, 1);

  // start/stop
  auto.start(10_000);
  assert.ok(auto.running);
  auto.stop();
  assert.ok(!auto.running);
  console.log('Automatic import: start, changes, skipped profiles, Firefox gap and errors OK');
})().catch(e => { console.error(e); process.exit(1); });
