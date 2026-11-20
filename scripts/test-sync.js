// Tests "Sync to browsers" on COPIES of this PC's browser bookmark files. The real files are never changed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const initSqlJs = require('sql.js');
const { detectSources, parseChromium, parseFirefox } = require('../src/importers');
const { normalizeUrl } = require('../src/normalize');
const bs = require('../src/browsersync');

(async () => {
  const SQL = await initSqlJs();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-sync-test-'));
  let tested = 0;
  try {
    for (const s of detectSources()) {
      const copy = path.join(dir, `${tested}-${path.basename(s.path)}`);
      fs.copyFileSync(s.path, copy);
      const parse = (f) => s.type === 'firefox' ? parseFirefox(f, SQL) : parseChromium(f);
      const before = parse(copy);
      if (before.length < 6) continue;

      // Delete every 50th URL (at least 3), as if the user had removed them in the library.
      const doomed = new Set(before.filter((_, i) => i % 50 === 0).slice(0, 25).map(b => normalizeUrl(b.url)));
      const plan = s.type === 'firefox' ? bs.firefoxPlan(copy, doomed, SQL) : bs.chromiumPlan(copy, doomed);
      const expected = before.filter(b => doomed.has(normalizeUrl(b.url))).length;
      assert.strictEqual(plan.matches.length, expected, `${s.label}: plan found ${plan.matches.length}, expected ${expected}`);

      const res = s.type === 'firefox' ? bs.firefoxApply(copy, doomed, SQL) : bs.chromiumApply(copy, doomed);
      assert.strictEqual(res.removed, expected);
      assert.ok(fs.existsSync(res.backup), 'backup written');

      const after = parse(copy);
      assert.strictEqual(after.length, before.length - expected, `${s.label}: wrong count after delete`);
      assert.ok(after.every(b => !doomed.has(normalizeUrl(b.url))), `${s.label}: a deleted URL is still there`);
      // Everything else is untouched (same URLs, titles and folders).
      const key = (b) => `${b.url}\t${b.title}\t${b.folder}`;
      assert.deepStrictEqual(after.map(key).sort(), before.filter(b => !doomed.has(normalizeUrl(b.url))).map(key).sort());

      if (s.type === 'firefox') {
        const db = new SQL.Database(fs.readFileSync(copy));
        const q = (sql) => (db.exec(sql)[0] || { values: [] }).values;
        assert.strictEqual(q('PRAGMA integrity_check')[0][0], 'ok');
        // Positions are contiguous in every folder.
        const gaps = q('SELECT parent FROM moz_bookmarks GROUP BY parent HAVING MAX(position) + 1 != COUNT(*)');
        assert.strictEqual(gaps.length, 0, `position gaps in ${gaps.length} folders`);
        // foreign_count matches the real number of bookmark rows pointing at each page (+ keywords).
        const bad = q(`SELECT p.id FROM moz_places p
                       WHERE p.foreign_count != (SELECT COUNT(*) FROM moz_bookmarks b WHERE b.fk = p.id)
                                                + (SELECT COUNT(*) FROM moz_keywords k WHERE k.place_id = p.id)`);
        assert.strictEqual(bad.length, 0, `${bad.length} pages with a wrong foreign_count`);
        const tombs = q('SELECT COUNT(*) FROM moz_bookmarks_deleted')[0][0];
        console.log(`  tombstones for Firefox Sync: ${tombs}`);
        db.close();
      } else {
        const data = JSON.parse(fs.readFileSync(copy, 'utf8'));
        assert.ok(!('checksum' in data), 'checksum removed');
        assert.ok(data.roots && data.version, 'structure intact');
      }
      console.log(`${s.label}: removed ${res.removed} of ${before.length}, ${after.length} left. OK`);
      tested++;
    }
    assert.ok(tested > 0, 'no browser profiles to test');
    console.log(`All sync checks passed on ${tested} profile copies.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
