// Tests the browser extension path:
// 1. the local bridge only answers the extension (pairing code, host and origin checks)
// 2. the extension's matching / delete / undo logic, run against in-memory copies of this PC's
//    real Chromium and Firefox bookmark trees (the real files are only read)
//    and sorting bookmarks into category folders (and moving them back)
// 3. the Firefox build of the extension
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');
const initSqlJs = require('sql.js');
const { startBridge, newToken } = require('../src/bridge');
const { buildFirefox, GECKO_ID, SOURCE } = require('../src/extbuild');
const core = require('../extension/core');
const { detectSources, parseChromium, parseFirefox } = require('../src/importers');
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

// chrome.bookmarks-style tree from a Chromium "Bookmarks" file.
function chromiumTree(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let nextId = 1;
  const make = (n, parentId, index) => {
    const node = { id: String(nextId++), parentId, index, title: n.name || '' };
    if (n.type === 'url') node.url = n.url;
    else node.children = (n.children || []).map((c, i) => make(c, node.id, i));
    return node;
  };
  const root = { id: '0', title: '', children: [] };
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    if (data.roots[key]) root.children.push(make(data.roots[key], '0', root.children.length));
  }
  return root;
}

// browser.bookmarks-style tree from a COPY of Firefox's places.sqlite (ids are GUIDs, like in Firefox).
function firefoxTree(file, SQL) {
  const db = new SQL.Database(fs.readFileSync(file));
  const rows = db.exec(`SELECT b.id, b.parent, b.type, b.title, b.guid, p.url
                        FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`)[0].values;
  db.close();
  const byRow = new Map(rows.map(([id, parent, type, title, guid, url]) => [id, { id: guid, rowParent: parent, type, title: title || '', url }]));
  let root;
  for (const n of byRow.values()) {
    if (n.type === 2) n.children = [];
    if (n.id === 'root________') root = n;
  }
  for (const n of byRow.values()) {
    const p = byRow.get(n.rowParent);
    if (n === root || !p) continue;
    n.parentId = p.id;
    n.index = p.children.length;
    if (n.type !== 1) delete n.url; // folders and separators have no URL
    p.children.push(n);
  }
  const clean = (n) => { delete n.rowParent; delete n.type; (n.children || []).forEach(clean); };
  clean(root);
  return root;
}

// A fake chrome.bookmarks / browser.bookmarks API over a tree.
function fakeBookmarks(root) {
  let created = 0; // new ids must not collide with the tree's own ids
  const byId = new Map();
  (function index(n) { byId.set(n.id, n); (n.children || []).forEach(index); })(root);
  const reindex = (p) => p.children.forEach((c, i) => { c.index = i; });
  const clone = (n) => JSON.parse(JSON.stringify(n));
  return {
    getTree: async () => [clone(root)],
    get: async (id) => { if (!byId.has(id)) throw new Error('Can\'t find bookmark for id.'); return [clone(byId.get(id))]; },
    remove: async (id) => {
      const n = byId.get(id);
      if (!n || (n.children && n.children.length)) throw new Error('Can\'t remove non-empty folder');
      const p = byId.get(n.parentId);
      p.children.splice(p.children.indexOf(n), 1);
      byId.delete(id);
      reindex(p);
    },
    create: async ({ parentId, index, title, url }) => {
      const p = byId.get(parentId);
      if (!p || !p.children) throw new Error('Can\'t find parent bookmark for id.');
      const node = url ? { id: `new-${++created}`, parentId, title, url } : { id: `new-${++created}`, parentId, title, children: [] };
      const at = index === undefined ? p.children.length : Math.min(index, p.children.length);
      p.children.splice(at, 0, node);
      byId.set(node.id, node);
      reindex(p);
      return clone(node);
    },
    getChildren: async (id) => { const n = byId.get(id); if (!n || !n.children) throw new Error('Can\'t find bookmark for id.'); return clone(n.children); },
    move: async (id, { parentId, index }) => {
      const n = byId.get(id), to = byId.get(parentId);
      if (!n || !to || !to.children) throw new Error('Can\'t find bookmark for id.');
      const from = byId.get(n.parentId);
      from.children.splice(from.children.indexOf(n), 1);
      reindex(from);
      const at = index === undefined ? to.children.length : Math.min(index, to.children.length);
      to.children.splice(at, 0, n);
      n.parentId = parentId;
      reindex(to);
      return clone(n);
    },
  };
}

const layout = (tree) => core.flatten(tree).map(b => `${b.folder}\t${b.index}\t${b.url}\t${b.title}`);
// Every folder with its path and position.
const folderLayout = (tree) => {
  const out = [];
  const walk = (n, trail) => { for (const c of n.children || []) if (!c.url) { const p = [...trail, c.title]; out.push(`${p.join(' / ')}\t${c.index}`); walk(c, p); } };
  tree.forEach(r => walk(r, []));
  return out;
};
const findIn = (tree, id) => { const st = [...tree]; while (st.length) { const n = st.pop(); if (n.id === id) return n; if (n.children) st.push(...n.children); } return null; };

(async () => {
  // ---------- 1. bridge ----------
  const token = newToken();
  assert.match(token, /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  const reports = [];
  const bridge = startBridge({ port: PORT, getToken: () => token, getDeletedNorms: () => ['example.com/a', 'example.org'], getCategories: () => [{ norm: 'example.com/b', category: 'Work / Tools' }], onReport: (r) => reports.push(r), appVersion: '9.9.9' });
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
  // Firefox enforces CORS on the extension: the preflight must allow every header popup.js sends.
  const popupSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'popup.js'), 'utf8');
  const sent = [...popupSrc.matchAll(/'(X-Bookmark-Syncer-[A-Za-z-]+|Content-Type)':/g)].map(m => m[1].toLowerCase());
  assert.ok(sent.length >= 3, 'found the popup headers');
  const ffPre = await request({ method: 'OPTIONS', headers: { host: ok.host, origin: 'moz-extension://0a1b2c3d-1111-2222-3333-444455556666',
    'access-control-request-method': 'POST', 'access-control-request-headers': sent.join(',') } });
  assert.strictEqual(ffPre.status, 204);
  const allowed = ffPre.headers['access-control-allow-headers'].toLowerCase().split(/,\s*/);
  for (const h of sent) assert.ok(allowed.includes(h), `preflight allows ${h}`);
  const hello = await request({ headers: ok });
  assert.strictEqual(hello.status, 200);
  assert.deepStrictEqual(hello.body, { app: 'Bookmark syncer', version: '9.9.9', deleted: 2 });
  assert.strictEqual(hello.headers['access-control-allow-origin'], EXT);
  assert.deepStrictEqual((await request({ path: '/v1/deleted', headers: ok })).body, { norms: ['example.com/a', 'example.org'] });
  assert.deepStrictEqual((await request({ path: '/v1/categories', headers: ok })).body, { items: [{ norm: 'example.com/b', category: 'Work / Tools' }] });
  assert.strictEqual((await request({ path: '/v1/categories', headers: { ...ok, 'x-bookmark-syncer-token': '' } })).status, 401, 'categories need the code too');
  const rep = await request({ method: 'POST', path: '/v1/report', headers: { ...ok, 'content-type': 'application/json' }, body: JSON.stringify({ removed: 3, failed: -1, junk: 'x' }) });
  assert.strictEqual(rep.status, 200);
  assert.deepStrictEqual(reports[0], { browser: 'Edge', removed: 3, failed: 0, undone: false, organized: 0, unorganized: false });
  assert.strictEqual(bridge.status().contacts[0].browser, 'Edge');
  await bridge.close();
  console.log('Bridge: pairing code, host and origin checks OK');

  // ---------- 1b. "This page" (the popup's notes, tags and category) with a real library ----------
  {
    const { Library } = require('../src/db');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-page-test-'));
    const lib = await Library.open(path.join(dir, 'library.sqlite'));
    lib.importItems([{ url: 'https://example.com/known', title: 'Known page' }, { url: 'https://example.com/gone', title: 'Gone' }], 'Chrome · Default');
    lib.update(lib.findByUrl('https://example.com/known').id, { category: 'Work', tags: ['a', 'b'], notes: 'hi' });
    lib.remove([lib.findByUrl('https://example.com/gone').id]);
    const changes = [];
    const br = startBridge({ port: PORT, getToken: () => token, getDeletedNorms: () => lib.removedNorms(), appVersion: '9.9.9',
      getPage: (u) => lib.findByUrl(u), getVocabulary: () => lib.vocabulary(),
      savePage: (p, browser) => lib.savePage(p, `Added from ${browser}`), onChange: (c) => changes.push(c) });
    await new Promise(r => setTimeout(r, 200));
    const json = { ...ok, 'content-type': 'application/json' };
    const get = (u) => request({ path: '/v1/page?url=' + encodeURIComponent(u), headers: ok });
    const post = (b) => request({ method: 'POST', path: '/v1/page', headers: json, body: JSON.stringify(b) });

    let r = await get('https://example.com/known/');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.bookmark.category, r.body.bookmark.tags, r.body.bookmark.notes], ['Work', ['a', 'b'], 'hi']);
    assert.deepStrictEqual(r.body.categories, ['Work']);
    assert.strictEqual((await get('https://example.com/new')).body.bookmark, null, 'unknown page');
    assert.strictEqual((await get('javascript:alert(1)')).status, 400, 'only web pages');
    assert.strictEqual((await request({ path: '/v1/page?url=https://example.com/known', headers: { ...ok, 'x-bookmark-syncer-token': '' } })).status, 401, 'needs the code');
    assert.strictEqual((await request({ method: 'POST', path: '/v1/page', headers: { ...json, origin: 'https://evil.example' }, body: '{}' })).status, 403, 'web pages cannot save');

    // Edit an existing one
    r = await post({ url: 'https://example.com/known', title: 'Known page', category: 'Work / Docs', tags: ['B', 'c', 7], notes: 'updated', readLater: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.added, false);
    const known = lib.list().find(b => b.title === 'Known page');
    assert.deepStrictEqual([known.category, known.tags, known.notes, !!known.read_later], ['Work / Docs', ['b', 'c'], 'updated', true]);

    // Add a new one, and one that was deleted before (asked for explicitly, so it comes back)
    r = await post({ url: 'https://example.com/new', title: 'New page', category: '', tags: ['x'], notes: '', readLater: false });
    assert.strictEqual(r.body.added, true);
    assert.strictEqual(r.body.bookmark.title, 'New page');
    const added = lib.list().find(b => b.title === 'New page');
    assert.deepStrictEqual([added.category, added.tags, added.sources[0].source], [null, ['x'], 'Added from Edge']);
    r = await post({ url: 'https://example.com/gone', title: 'Gone', tags: [] });
    assert.strictEqual(r.body.added, true);
    assert.ok(!lib.removedNorms().includes('example.com/gone'), 'no longer on the deleted list');
    assert.deepStrictEqual(changes.map(c => c.added), [false, true, true]);

    // Bad input
    assert.strictEqual((await post({ url: 'file:///C:/x' })).status, 400);
    assert.strictEqual((await request({ method: 'POST', path: '/v1/page', headers: json, body: 'not json' })).status, 400);
    r = await post({ url: 'https://example.com/long', title: 'x'.repeat(5000), tags: Array.from({ length: 80 }, (_, i) => 't' + i) });
    const long = lib.findByUrl('https://example.com/long');
    assert.strictEqual(long.title.length, 1000);
    assert.strictEqual(long.tags.length, 50);
    await br.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('Bridge: "This page" view, edit, add, re-add after delete and input limits OK');
  }

  // ---------- 2. extension logic on real bookmark trees ----------
  const SQL = await initSqlJs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-ext-test-'));
  let tested = 0;
  for (const s of detectSources()) {
    const ff = s.type === 'firefox';
    const file = ff ? path.join(tmp, `${tested}-places.sqlite`) : s.path;
    if (ff) fs.copyFileSync(s.path, file); // Firefox locks its file; work on a copy
    const items = ff ? parseFirefox(file, SQL) : parseChromium(file);
    if (items.length < 6) continue;
    const deleted = new Set(items.filter((_, i) => i % 40 === 0).slice(0, 30).map(b => normalizeUrl(b.url)));
    deleted.add('not-in-this-browser.example/x');

    const bm = fakeBookmarks(ff ? firefoxTree(file, SQL) : chromiumTree(file));
    const before = layout(await bm.getTree());
    const matches = core.findMatches(await bm.getTree(), deleted);
    if (ff) assert.strictEqual(core.otherFolderId(await bm.getTree()), 'unfiled_____', 'Firefox Undo falls back to Other Bookmarks');
    // Same answer as the file-based "Sync to browsers" preview (the extension leaves chrome://, place: etc. alone).
    const appMatches = (ff ? bs.firefoxPlan(file, deleted, SQL) : bs.chromiumPlan(file, deleted)).matches.filter(m => /^https?:/i.test(m.url));
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
    // Sort into category folders: about half the bookmarks get a (sometimes nested) category.
    const cats = new Map();
    core.flatten(await bm.getTree()).forEach((b, i) => {
      if (i % 2 || !/^https?:/i.test(b.url)) return;
      let host;
      try { host = new URL(b.url).hostname.replace(/^www\./, '') || 'x'; } catch { return; }
      cats.set(normalizeUrl(b.url), i % 3 ? `Test ${host[0].toUpperCase()}` : `Test ${host[0].toUpperCase()} / ${host}`);
    });
    const plan = core.planOrganize(await bm.getTree(), cats);
    const undo = await core.applyOrganize(bm, await bm.getTree(), plan);
    assert.strictEqual(undo.failed.length, 0);
    assert.strictEqual(undo.moves.length, plan.length);
    const sorted = await bm.getTree();
    assert.strictEqual(core.planOrganize(sorted, cats).length, 0, `${s.label}: everything is in its folder`);
    assert.strictEqual(core.flatten(sorted).length, before.length, 'sorting deletes nothing');
    const otherTitle = (sorted[0].children.find(c => c.id === core.otherFolderId(sorted)) || {}).title;
    for (const b of core.flatten(sorted)) {
      const c = cats.get(normalizeUrl(b.url));
      if (c && !b.unmodifiable && /^https?:/i.test(b.url)) assert.strictEqual(b.folder, `${otherTitle} / ${core.ROOT_FOLDER} / ${c}`, b.url);
    }
    const movedBack = await core.undoOrganize(bm, undo, core.otherFolderId(sorted));
    assert.strictEqual(movedBack, plan.length);
    assert.deepStrictEqual(layout(await bm.getTree()), before, `${s.label}: undo sorting didn't restore the exact layout`);
    const otherAfter = (await bm.getTree())[0].children.find(c => c.id === core.otherFolderId(sorted));
    assert.ok(!otherAfter.children.some(c => c.title === core.ROOT_FOLDER && !c.url && !c.children.length), 'empty folders are cleaned up');
    // Again with "Remove folders that end up empty": no empty source folder is left, and Undo recreates them in place.
    const foldersBefore = folderLayout(await bm.getTree());
    const plan2 = core.planOrganize(await bm.getTree(), cats);
    const undo2 = await core.applyOrganize(bm, await bm.getTree(), plan2, { removeEmpty: true });
    const sorted2 = await bm.getTree();
    assert.strictEqual(core.flatten(sorted2).length, before.length, 'removing empty folders deletes no bookmark');
    const topIds = new Set([sorted2[0].id, ...sorted2[0].children.map(c => c.id)]);
    for (const id of new Set(undo2.moves.map(m => m.parentId))) {
      const n = findIn(sorted2, id);
      assert.ok(!n || n.children.length || topIds.has(id), `${s.label}: source folder ${id} left empty`);
    }
    for (const f of undo2.removedFolders) assert.ok(!topIds.has(f.id), 'top folders are never removed');
    await core.undoOrganize(bm, undo2, core.otherFolderId(sorted2));
    assert.deepStrictEqual(layout(await bm.getTree()), before, `${s.label}: undo after removing empty folders didn't restore the bookmarks`);
    assert.deepStrictEqual(folderLayout(await bm.getTree()), foldersBefore, `${s.label}: undo didn't recreate the removed folders in place`);
    console.log(`${s.label}: found ${matches.length}, deleted ${removed.length}, undo restored all in place; sorted ${plan.length} into folders and back; ${undo2.removedFolders.length} empty folders removed and recreated. OK`);
    tested++;
  }
  assert.ok(tested > 0, 'no browser profiles to test');

  // ---------- 3. Firefox build ----------
  const ffDir = path.join(tmp, 'firefox-extension');
  const manifestFile = buildFirefox(ffDir);
  const ffm = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const base = JSON.parse(fs.readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8'));
  assert.strictEqual(ffm.browser_specific_settings.gecko.id, GECKO_ID);
  assert.deepStrictEqual(ffm.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.ok(!('browser_specific_settings' in base), 'the Chrome manifest stays free of Firefox keys');
  assert.strictEqual(ffm.version, base.version);
  for (const f of fs.readdirSync(SOURCE)) assert.ok(fs.existsSync(path.join(ffDir, f)), `${f} copied`);
  // Everything the manifest and popup refer to exists in the build.
  for (const f of [ffm.action.default_popup, ...Object.values(ffm.icons)]) assert.ok(fs.existsSync(path.join(ffDir, f)), f);
  const html = fs.readFileSync(path.join(ffDir, 'popup.html'), 'utf8');
  for (const [, f] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) assert.ok(fs.existsSync(path.join(ffDir, f)), f);
  console.log('Firefox build: manifest, add-on ID and files OK');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`All extension checks passed on ${tested} profiles.`);
})().catch(e => { console.error(e); process.exit(1); });
