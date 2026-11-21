// Popup for the Bookmark syncer helper extension.
// Talks to the desktop app on 127.0.0.1 (only while the app is open), then deletes matching
// bookmarks with chrome.bookmarks, so the browser's own sync keeps them deleted.

const BASE = 'http://127.0.0.1:47615';
const $ = (s) => document.querySelector(s);
const bm = chrome.bookmarks; // promise-based in Manifest V3

function browserName() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const known = brands.map(b => b.brand).find(b => /Edge|Chrome|Brave|Opera|Vivaldi/i.test(b) && !/Chromium/i.test(b));
  return known ? known.replace('Microsoft ', '').replace('Google ', '') : 'Chromium browser';
}

function show(view) {
  for (const v of ['pair', 'offline', 'main', 'done']) $(`#v-${v}`).classList.toggle('hidden', v !== view);
  $('#unpair').classList.toggle('hidden', view === 'pair');
}

const store = {
  get: (k) => chrome.storage.local.get(k).then(r => r[k]),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
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
  await chrome.storage.local.remove('token');
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
  await chrome.storage.local.remove('lastRun');
  call('/v1/report', state.token, { removed: 0, undone: true }).catch(() => {});
  $('#done-summary').innerHTML = `<b>Put back ${n} bookmark${n === 1 ? '' : 's'}.</b> To keep them for good, also restore them under <i>Recently deleted</i> in the app.`;
  $('#done-undo').classList.add('hidden');
  $('#done-undo').disabled = false;
};

load();
