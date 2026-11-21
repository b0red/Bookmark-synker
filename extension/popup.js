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
  currentView = view;
  $('#page').classList.toggle('hidden', !page || (view !== 'main' && view !== 'done'));
}
let currentView = null;

const store = {
  get: (k) => ext.storage.local.get(k).then(r => r[k]),
  set: (k, v) => ext.storage.local.set({ [k]: v }),
};

async function call(path, token, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Bookmark-Syncer-Token': token, 'X-Bookmark-Syncer-Browser': browserName() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error(t('Could not reach the app. Is Bookmark syncer open?')), { code: 0, detail: String(e && e.message || e) });
  }
  if (res.status === 401) throw Object.assign(new Error('wrong pairing code'), { code: 401 });
  if (!res.ok) throw Object.assign(new Error(t('The app answered with error {status}.', { status: res.status })), { code: res.status });
  return res.json();
}

let state = { token: null, matches: [] };

async function load() {
  // Firefox may install it without access to the app (host permissions are optional there).
  if (ext.permissions && !(await ext.permissions.contains(APP_ACCESS).catch(() => true))) return show('perm');
  state.token = await store.get('token');
  if (!state.token) return show('pair');
  $('#status').textContent = t('Connecting…');
  let deleted;
  try {
    const hello = await call('/v1/hello', state.token);
    deleted = (await call('/v1/deleted', state.token)).norms;
    $('#status').textContent = t('Connected to {app} {version}', hello);
    loadPage(); // runs alongside; shows itself when ready
  } catch (e) {
    if (e.code === 401) {
      $('#pair-error').textContent = t('The pairing code changed in the app. Paste the new one.');
      $('#pair-error').classList.remove('hidden');
      return show('pair');
    }
    $('#status').textContent = t('Not connected');
    return show('offline');
  }

  const tree = await bm.getTree();
  state.matches = BMCore.findMatches(tree, deleted);
  state.otherId = BMCore.otherFolderId(tree);
  const n = state.matches.length;
  const last = await store.get('lastRun');

  if (!n) {
    $('#done-summary').innerHTML = t('<b>All clean.</b> None of the {n} bookmarks you deleted in the app are in {browser}.', { n: deleted.length, browser: esc(browserName()) });
    $('#done-undo').classList.toggle('hidden', !(last && last.items.length));
    if (last && last.items.length) $('#done-undo').textContent = t('Undo last run ({n})', { n: last.items.length });
    return show('done');
  }

  $('#main-summary').innerHTML = tn(n, '<b>1 bookmark</b> in {browser} was deleted in Bookmark syncer:', '<b>{n} bookmarks</b> in {browser} were deleted in Bookmark syncer:', { browser: esc(browserName()) });
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
  if (n > 200) $('#main-list').insertAdjacentHTML('beforeend', `<li class="muted">${t('… and {n} more', { n: n - 200 })}</li>`);
  $('#main-delete').disabled = false;
  show('main');
}

$('#pair-save').onclick = async () => {
  const code = $('#pair-code').value.trim().toLowerCase();
  if (!code) return;
  try {
    await call('/v1/hello', code);
  } catch (e) {
    $('#pair-error').textContent = e.code === 401 ? t("That code doesn't match. Copy it again from the app.") : e.message;
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
  $('#main-delete').textContent = t('Deleting…');
  const { removed, failed } = await BMCore.removeMatches(bm, state.matches);
  await store.set('lastRun', { at: Date.now(), items: removed });
  call('/v1/report', state.token, { removed: removed.length, failed: failed.length }).catch(() => {});
  $('#done-summary').innerHTML = tn(removed.length, '<b>Deleted 1 bookmark.</b>', '<b>Deleted {n} bookmarks.</b>') +
    (failed.length ? ' ' + t("{n} couldn't be deleted (managed by your organization or read-only).", { n: failed.length }) : '') +
    ' ' + t('Your browser sync will remove them on your other devices.');
  $('#done-undo').textContent = t('Undo');
  $('#done-undo').classList.toggle('hidden', !removed.length);
  $('#main-delete').textContent = t('Delete them in this browser');
  show('done');
};

$('#done-undo').onclick = async () => {
  const last = await store.get('lastRun');
  if (!last || !last.items.length) return;
  $('#done-undo').disabled = true;
  const n = await BMCore.restore(bm, last.items, state.otherId);
  await ext.storage.local.remove('lastRun');
  call('/v1/report', state.token, { removed: 0, undone: true }).catch(() => {});
  $('#done-summary').innerHTML = tn(n, '<b>Put back 1 bookmark.</b>', '<b>Put back {n} bookmarks.</b>') + ' ' + t('To keep them for good, also restore them under <i>Recently deleted</i> in the app.');
  $('#done-undo').classList.add('hidden');
  $('#done-undo').disabled = false;
};

// ---------- This page: its category, tags and notes in the library ----------
// The browser gives the popup the open tab's address and title (activeTab) only when you click the icon.
let page = null;

function fillDatalist(sel, values) {
  $(sel).innerHTML = '';
  for (const v of values) { const o = document.createElement('option'); o.value = v; $(sel).append(o); }
}

function showPage() {
  const b = page.bookmark;
  $('#page-title').textContent = page.title;
  $('#page-title').title = page.url;
  $('#page-state').textContent = t(b ? 'In your library' : 'Not in your library yet');
  $('#page-cat').value = b ? b.category : '';
  $('#page-tags').value = b ? b.tags.join(', ') : '';
  $('#page-notes').value = b ? b.notes : '';
  $('#page-later').checked = b ? b.readLater : false;
  $('#page-save').textContent = t(b ? 'Save changes' : 'Save to library');
}

async function loadPage() {
  let tab = null;
  try { [tab] = await ext.tabs.query({ active: true, currentWindow: true }); } catch {}
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) return;
  let info;
  try { info = await call('/v1/page?url=' + encodeURIComponent(tab.url), state.token); } catch { return; }
  page = { url: tab.url, title: (info.bookmark && info.bookmark.title) || tab.title || tab.url, bookmark: info.bookmark };
  fillDatalist('#page-cats', info.categories || []);
  fillDatalist('#page-tag-list', info.tags || []);
  showPage();
  if (currentView) show(currentView);
}

$('#page-save').onclick = async () => {
  if (!page) return;
  $('#page-save').disabled = true;
  const msg = $('#page-msg');
  try {
    const r = await call('/v1/page', state.token, {
      url: page.url,
      title: page.title,
      category: $('#page-cat').value.trim(),
      tags: $('#page-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: $('#page-notes').value,
      readLater: $('#page-later').checked,
    });
    page.bookmark = r.bookmark;
    showPage();
    msg.textContent = t(r.added ? 'Added to your library.' : 'Saved.');
    msg.className = 'small ok';
  } catch (e) {
    msg.textContent = e.code === 0 ? t('Could not reach the app. Is Bookmark syncer open?') : t('Not saved: {error}', { error: e.message });
    msg.className = 'small err';
  } finally {
    $('#page-save').disabled = false;
  }
};

// ---------- Sort into folders by category ----------
let orgMoves = [];
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const otherTitle = (tree) => ((tree[0].children || []).find(c => c.id === BMCore.otherFolderId(tree)) || {}).title || t('Other bookmarks');
const plural = (n, w) => (w === 'folder' ? tn(n, '1 folder', '{n} folders') : tn(n, '1 bookmark', '{n} bookmarks'));

async function openOrganize() {
  show('organize');
  $('#org-summary').textContent = t('Looking at your categories…');
  $('#org-list').innerHTML = '';
  $('#org-go').classList.add('hidden');
  const last = await store.get('lastOrganize');
  $('#org-undo').classList.toggle('hidden', !(last && last.moves.length));
  let items;
  try { items = (await call('/v1/categories', state.token)).items; } catch { $('#org-summary').textContent = t('Could not reach the app.'); return; }
  const cats = new Map(items.map(i => [i.norm, i.category]));
  const tree = await bm.getTree();
  orgMoves = BMCore.planOrganize(tree, cats);
  if (!cats.size) { $('#org-summary').innerHTML = t('<b>No categories yet.</b> Categorize bookmarks in the app first.'); return; }
  if (!orgMoves.length) { $('#org-summary').innerHTML = t('<b>All sorted.</b> Every categorized bookmark in {browser} is in its category folder.', { browser: esc(browserName()) }); return; }
  const groups = BMCore.summarizePlan(orgMoves);
  $('#org-summary').innerHTML = t('Move <b>{bookmarks}</b> into {folders}:', { bookmarks: plural(orgMoves.length, 'bookmark'), folders: plural(groups.length, 'folder') });
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
  $('#org-go').textContent = t('Sorting…');
  const tree = await bm.getTree();
  const undo = await BMCore.applyOrganize(bm, tree, orgMoves);
  await store.set('lastOrganize', { at: Date.now(), moves: undo.moves, createdFolders: undo.createdFolders });
  call('/v1/report', state.token, { organized: undo.moves.length }).catch(() => {});
  $('#org-summary').innerHTML = t('<b>Sorted {bookmarks}.</b>', { bookmarks: plural(undo.moves.length, 'bookmark') }) +
    (undo.failed.length ? ' ' + t("{n} couldn't be moved (managed or read-only).", { n: undo.failed.length }) : '') +
    ' ' + t('Find them under <i>{path}</i>.', { path: `${esc(otherTitle(tree))} → ${BMCore.ROOT_FOLDER}` });
  $('#org-list').innerHTML = '';
  $('#org-go').textContent = t('Sort them');
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
  $('#org-summary').innerHTML = t('<b>Moved {bookmarks} back</b> to where they were.', { bookmarks: plural(n, 'bookmark') });
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
