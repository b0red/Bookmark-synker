// Popup for the Bookmark syncer helper extension.
// Talks to the desktop app on 127.0.0.1 (only while the app is open), then deletes matching
// bookmarks with chrome.bookmarks, so the browser's own sync keeps them deleted.

const BASE = 'http://127.0.0.1:47615';
const $ = (s) => document.querySelector(s);
// Firefox has `browser.*`; Chromium browsers have `chrome.*`. Both are promise-based in Manifest V3.
const ext = globalThis.browser || globalThis.chrome;
const bm = ext.bookmarks;
const APP_ACCESS = { origins: [`${BASE}/*`] };

function browserName() {
  if (/Firefox\//.test(navigator.userAgent)) return 'Firefox';
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const known = brands.map(b => b.brand).find(b => /Edge|Chrome|Brave|Opera|Vivaldi/i.test(b) && !/Chromium/i.test(b));
  return known ? known.replace('Microsoft ', '').replace('Google ', '') : 'Chromium browser';
}

function show(view) {
  for (const v of ['perm', 'pair', 'offline', 'main', 'done', 'organize']) $(`#v-${v}`).classList.toggle('hidden', v !== view);
  $('#unpair').classList.toggle('hidden', view === 'pair' || view === 'perm');
  $('#org-entry').classList.toggle('hidden', view !== 'main' && view !== 'done');
}

const store = {
  get: (k) => ext.storage.local.get(k).then(r => r[k]),
  set: (k, v) => ext.storage.local.set({ [k]: v }),
};

async function call(path, token, body) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Bookmark-Syncer-Token': token, 'X-Bookmark-Syncer-Browser': browserName() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw Object.assign(new Error('wrong pairing code'), { code: 401 });
  if (!res.ok) throw new Error(`The app answered ${res.status}`);
  return res.json();
}

let state = { token: null, matches: [] };

async function load() {
  // Firefox may install it without access to the app (host permissions are optional there).
  if (ext.permissions && !(await ext.permissions.contains(APP_ACCESS).catch(() => true))) return show('perm');
  state.token = await store.get('token');
  if (!state.token) return show('pair');
  $('#status').textContent = 'Connecting…';
  let deleted;
  try {
    const hello = await call('/v1/hello', state.token);
    deleted = (await call('/v1/deleted', state.token)).norms;
    $('#status').textContent = `Connected to ${hello.app} ${hello.version}`;
  } catch (e) {
    if (e.code === 401) {
      $('#pair-error').textContent = 'The pairing code changed in the app. Paste the new one.';
      $('#pair-error').classList.remove('hidden');
      return show('pair');
    }
    $('#status').textContent = 'Not connected';
    return show('offline');
  }

  const tree = await bm.getTree();
  state.matches = BMCore.findMatches(tree, deleted);
  state.otherId = BMCore.otherFolderId(tree);
  const n = state.matches.length;
  const last = await store.get('lastRun');

  if (!n) {
    $('#done-summary').innerHTML = `<b>All clean.</b> None of the ${deleted.length} bookmarks you deleted in the app are in ${browserName()}.`;
    $('#done-undo').classList.toggle('hidden', !(last && last.items.length));
    if (last && last.items.length) $('#done-undo').textContent = `Undo last run (${last.items.length})`;
    return show('done');
  }

  $('#main-summary').innerHTML = `<b>${n} bookmark${n === 1 ? '' : 's'}</b> in ${browserName()} ${n === 1 ? 'was' : 'were'} deleted in Bookmark syncer:`;
  $('#main-list').innerHTML = '';
  for (const m of state.matches.slice(0, 200)) {
    const li = document.createElement('li');
    li.title = m.url;
    li.textContent = (m.title || m.url) + ' ';
    const f = document.createElement('span');
    f.className = 'muted';
    f.textContent = m.folder;
    li.append(f);
    $('#main-list').append(li);
  }
  if (n > 200) $('#main-list').insertAdjacentHTML('beforeend', `<li class="muted">… and ${n - 200} more</li>`);
  $('#main-delete').disabled = false;
  show('main');
}

$('#pair-save').onclick = async () => {
  const code = $('#pair-code').value.trim().toLowerCase();
  if (!code) return;
  try {
    await call('/v1/hello', code);
  } catch (e) {
    $('#pair-error').textContent = e.code === 401 ? "That code doesn't match. Copy it again from the app." : 'Could not reach the app. Is Bookmark syncer open?';
    $('#pair-error').classList.remove('hidden');
    return;
  }
  $('#pair-error').classList.add('hidden');
  await store.set('token', code);
  load();
};

$('#offline-retry').onclick = load;

$('#unpair').onclick = async (e) => {
  e.preventDefault();
  await ext.storage.local.remove('token');
  $('#pair-code').value = '';
  show('pair');
};

$('#main-delete').onclick = async () => {
  $('#main-delete').disabled = true;
  $('#main-delete').textContent = 'Deleting…';
  const { removed, failed } = await BMCore.removeMatches(bm, state.matches);
  await store.set('lastRun', { at: Date.now(), items: removed });
  call('/v1/report', state.token, { removed: removed.length, failed: failed.length }).catch(() => {});
  $('#done-summary').innerHTML = `<b>Deleted ${removed.length} bookmark${removed.length === 1 ? '' : 's'}.</b>` +
    (failed.length ? ` ${failed.length} couldn't be deleted (managed by your organization or read-only).` : '') +
    ' Your browser sync will remove them on your other devices.';
  $('#done-undo').textContent = 'Undo';
  $('#done-undo').classList.toggle('hidden', !removed.length);
  $('#main-delete').textContent = 'Delete them in this browser';
  show('done');
};

$('#done-undo').onclick = async () => {
  const last = await store.get('lastRun');
  if (!last || !last.items.length) return;
  $('#done-undo').disabled = true;
  const n = await BMCore.restore(bm, last.items, state.otherId);
  await ext.storage.local.remove('lastRun');
  call('/v1/report', state.token, { removed: 0, undone: true }).catch(() => {});
  $('#done-summary').innerHTML = `<b>Put back ${n} bookmark${n === 1 ? '' : 's'}.</b> To keep them for good, also restore them under <i>Recently deleted</i> in the app.`;
  $('#done-undo').classList.add('hidden');
  $('#done-undo').disabled = false;
};

// ---------- Sort into folders by category ----------
let orgMoves = [];
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const otherTitle = (tree) => ((tree[0].children || []).find(c => c.id === BMCore.otherFolderId(tree)) || {}).title || 'Other bookmarks';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function openOrganize() {
  show('organize');
  $('#org-summary').textContent = 'Looking at your categories…';
  $('#org-list').innerHTML = '';
  $('#org-go').classList.add('hidden');
  const last = await store.get('lastOrganize');
  $('#org-undo').classList.toggle('hidden', !(last && last.moves.length));
  let items;
  try { items = (await call('/v1/categories', state.token)).items; } catch { $('#org-summary').textContent = 'Could not reach the app.'; return; }
  const cats = new Map(items.map(i => [i.norm, i.category]));
  const tree = await bm.getTree();
  orgMoves = BMCore.planOrganize(tree, cats);
  if (!cats.size) { $('#org-summary').innerHTML = '<b>No categories yet.</b> Categorize bookmarks in the app first.'; return; }
  if (!orgMoves.length) { $('#org-summary').innerHTML = `<b>All sorted.</b> Every categorized bookmark in ${browserName()} is in its category folder.`; return; }
  const groups = BMCore.summarizePlan(orgMoves);
  $('#org-summary').innerHTML = `Move <b>${plural(orgMoves.length, 'bookmark')}</b> into ${plural(groups.length, 'folder')}:`;
  for (const g of groups.slice(0, 200)) {
    const li = document.createElement('li');
    li.textContent = g.folder.replace(BMCore.ROOT_FOLDER + ' / ', '');
    const c = document.createElement('span');
    c.className = 'muted count';
    c.textContent = g.count;
    li.append(c);
    $('#org-list').append(li);
  }
  $('#org-go').classList.remove('hidden');
  $('#org-go').disabled = false;
}

$('#org-open').onclick = openOrganize;
$('#org-back').onclick = load;

$('#org-go').onclick = async () => {
  $('#org-go').disabled = true;
  $('#org-go').textContent = 'Sorting…';
  const tree = await bm.getTree();
  const undo = await BMCore.applyOrganize(bm, tree, orgMoves);
  await store.set('lastOrganize', { at: Date.now(), moves: undo.moves, createdFolders: undo.createdFolders });
  call('/v1/report', state.token, { organized: undo.moves.length }).catch(() => {});
  $('#org-summary').innerHTML = `<b>Sorted ${plural(undo.moves.length, 'bookmark')}.</b>` +
    (undo.failed.length ? ` ${undo.failed.length} couldn't be moved (managed or read-only).` : '') +
    ` Find them under <i>${esc(otherTitle(tree))} → ${BMCore.ROOT_FOLDER}</i>.`;
  $('#org-list').innerHTML = '';
  $('#org-go').textContent = 'Sort them';
  $('#org-go').classList.add('hidden');
  $('#org-undo').classList.toggle('hidden', !undo.moves.length);
};

$('#org-undo').onclick = async () => {
  const last = await store.get('lastOrganize');
  if (!last) return;
  $('#org-undo').disabled = true;
  const tree = await bm.getTree();
  const n = await BMCore.undoOrganize(bm, last, BMCore.otherFolderId(tree));
  await ext.storage.local.remove('lastOrganize');
  call('/v1/report', state.token, { unorganized: true }).catch(() => {});
  $('#org-summary').innerHTML = `<b>Moved ${plural(n, 'bookmark')} back</b> to where they were.`;
  $('#org-list').innerHTML = '';
  $('#org-go').classList.add('hidden');
  $('#org-undo').classList.add('hidden');
  $('#org-undo').disabled = false;
};

load();

// Firefox: ask for access to the app on this PC (needs a click, so it's a button).
$('#perm-allow').onclick = async () => {
  const ok = await ext.permissions.request(APP_ACCESS).catch(() => false);
  if (ok) load();
  else $('#perm-error').classList.remove('hidden');
};
