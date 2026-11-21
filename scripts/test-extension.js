// Tests the browser extension path:
// 1. the local bridge only answers the extension (pairing code, host and origin checks)
// 2. the extension's matching / delete / undo logic, run against an in-memory copy of this PC's
//    real Chromium bookmark trees (the real files are only read).
const fs = require('fs');
const assert = require('assert');
const http = require('http');
const { startBridge, newToken } = require('../src/bridge');
const core = require('../extension/core');
const { detectSources, parseChromium } = require('../src/importers');
const { normalizeUrl } = require('../src/normalize');
const bs = require('../src/browsersync');

const PORT = 47699; // test port, so a running app on 47615 doesn't interfere

function request({ method = 'GET', path = '/v1/hello', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// A fake chrome.bookmarks API over a tree built from a Chromium "Bookmarks" file.
function fakeBookmarks(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let nextId = 1;
  const byId = new Map();
  const make = (n, parentId, index) => {
    const node = { id: String(nextId++), parentId, index, title: n.name || '' };
    if (n.type === 'url') node.url = n.url;
    else node.children = (n.children || []).map((c, i) => make(c, node.id, i));
    byId.set(node.id, node);
    return node;
  };
  const root = { id: '0', title: '', children: [] };
  byId.set('0', root);
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    if (data.roots[key]) root.children.push(make(data.roots[key], '0', root.children.length));
  }
  const reindex = (p) => p.children.forEach((c, i) => { c.index = i; });
  const clone = (n) => JSON.parse(JSON.stringify(n));
  return {
    getTree: async () => [clone(root)],
    get: async (id) => { if (!byId.has(id)) throw new Error('Can\'t find bookmark for id.'); return [clone(byId.get(id))]; },
    remove: async (id) => {
      const n = byId.get(id);
      if (!n || n.children) throw new Error('Can\'t find bookmark for id.');
      const p = byId.get(n.parentId);
      p.children.splice(p.children.indexOf(n), 1);
      byId.delete(id);
      reindex(p);
    },
    create: async ({ parentId, index, title, url }) => {
      const p = byId.get(parentId);
      if (!p || !p.children) throw new Error('Can\'t find parent bookmark for id.');
      const node = { id: String(nextId++), parentId, title, url };
      const at = index === undefined ? p.children.length : Math.min(index, p.children.length);
      p.children.splice(at, 0, node);
      byId.set(node.id, node);
      reindex(p);
      return clone(node);
    },
  };
}

const layout = (tree) => core.flatten(tree).map(b => `${b.folder}\t${b.index}\t${b.url}\t${b.title}`);

(async () => {
  // ---------- 1. bridge ----------
  const token = newToken();
  assert.match(token, /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  const reports = [];
  const bridge = startBridge({ port: PORT, getToken: () => token, getDeletedNorms: () => ['example.com/a', 'example.org'], onReport: (r) => reports.push(r), appVersion: '9.9.9' });
  await new Promise(r => setTimeout(r, 200));
  const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const ok = { host: `127.0.0.1:${PORT}`, origin: EXT, 'x-bookmark-syncer-token': token, 'x-bookmark-syncer-browser': 'Edge' };

  assert.strictEqual((await request({ headers: { ...ok, 'x-bookmark-syncer-token': '' } })).status, 401, 'no code is refused');
  assert.strictEqual((await request({ headers: { ...ok, 'x-bookmark-syncer-token': newToken() } })).status, 401, 'wrong code is refused');
  assert.strictEqual((await request({ headers: { ...ok, origin: 'https://evil.example' } })).status, 403, 'web pages are refused');
  assert.strictEqual((await request({ headers: { ...ok, host: `evil.example:${PORT}` } })).status, 403, 'DNS-rebinding host is refused');
  assert.strictEqual((await request({ method: 'OPTIONS', headers: { host: ok.host, origin: 'https://evil.example' } })).status, 403);
  const pre = await request({ method: 'OPTIONS', headers: { host: ok.host, origin: EXT } });
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers['access-control-allow-origin'], EXT);
  const hello = await request({ headers: ok });
  assert.strictEqual(hello.status, 200);
  assert.deepStrictEqual(hello.body, { app: 'Bookmark syncer', version: '9.9.9', deleted: 2 });
  assert.strictEqual(hello.headers['access-control-allow-origin'], EXT);
  assert.deepStrictEqual((await request({ path: '/v1/deleted', headers: ok })).body, { norms: ['example.com/a', 'example.org'] });
  const rep = await request({ method: 'POST', path: '/v1/report', headers: { ...ok, 'content-type': 'application/json' }, body: JSON.stringify({ removed: 3, failed: -1, junk: 'x' }) });
  assert.strictEqual(rep.status, 200);
  assert.deepStrictEqual(reports[0], { browser: 'Edge', removed: 3, failed: 0, undone: false });
  assert.strictEqual(bridge.status().contacts[0].browser, 'Edge');
  await bridge.close();
  console.log('Bridge: pairing code, host and origin checks OK');

  // ---------- 2. extension logic on real bookmark trees ----------
  let tested = 0;
  for (const s of detectSources().filter(x => x.type === 'chromium')) {
    const items = parseChromium(s.path);
    if (items.length < 6) continue;
    const deleted = new Set(items.filter((_, i) => i % 40 === 0).slice(0, 30).map(b => normalizeUrl(b.url)));
    deleted.add('not-in-this-browser.example/x');

    const bm = fakeBookmarks(s.path);
    const before = layout(await bm.getTree());
    const matches = core.findMatches(await bm.getTree(), deleted);
    // Same answer as the file-based "Sync to browsers" preview (the extension leaves chrome:// etc. alone).
    const appMatches = bs.chromiumPlan(s.path, deleted).matches.filter(m => /^https?:/i.test(m.url));
    assert.strictEqual(matches.length, appMatches.length, `${s.label}: extension and app disagree`);

    const { removed, failed } = await core.removeMatches(bm, matches);
    assert.strictEqual(failed.length, 0);
    assert.strictEqual(removed.length, matches.length);
    const afterTree = await bm.getTree();
    assert.strictEqual(core.findMatches(afterTree, deleted).length, 0, 'nothing left to delete');
    assert.strictEqual(core.flatten(afterTree).length, before.length - removed.length);

    const back = await core.restore(bm, removed, core.otherFolderId(afterTree));
    assert.strictEqual(back, removed.length);
    assert.deepStrictEqual(layout(await bm.getTree()), before, `${s.label}: undo didn't restore the exact layout`);
    console.log(`${s.label}: found ${matches.length}, deleted ${removed.length}, undo restored all in place. OK`);
    tested++;
  }
  assert.ok(tested > 0, 'no Chromium profiles to test');
  console.log(`All extension checks passed on ${tested} profiles.`);
})().catch(e => { console.error(e); process.exit(1); });
