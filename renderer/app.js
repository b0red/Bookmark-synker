'use strict';

const $ = (sel) => document.querySelector(sel);
const DAY = 86400000;

const state = {
  items: [],
  view: { type: 'smart', value: 'all' },
  query: '',
  sort: 'added',
  selectedId: null,
  visible: [],
  deleted: [],        // "Recently deleted" entries (negative ids)
  checked: new Set(), // multi-selection (checkboxes)
  anchor: null,       // last clicked row, for Shift+click ranges
};

const SMART = [
  { id: 'all', name: 'All bookmarks', test: () => true },
  { id: 'favorites', name: 'Favorites', test: b => b.favorite },
  { id: 'uncategorized', name: 'Uncategorized', test: b => !b.category },
  { id: 'never', name: 'No visit history', test: b => !b.last_used_at && !b.visit_count },
  { id: 'stale', name: 'Not opened in a year', test: b => b.last_used_at && b.last_used_at < Date.now() - 365 * DAY },
  { id: 'multi', name: 'Saved in several browsers', test: b => new Set(b.sources.map(s => s.source)).size > 1 },
  { id: 'dead', name: 'Dead links', test: b => b.status === 'dead' },
  { id: 'warn', name: 'Links with problems', test: b => b.status === 'warn' },
  { id: 'unchecked', name: 'Not checked yet', test: b => !b.status },
  { id: 'deleted', name: 'Recently deleted', test: () => false }, // lists state.deleted, see computeVisible
];

// ---------- helpers ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}
function hue(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function countBy(list, keyFn) {
  const m = new Map();
  for (const x of list) for (const k of [].concat(keyFn(x))) if (k) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()];
}
// Optional action shows a button in the toast, e.g. { label: 'Undo', fn }.
function toast(msg, ms = 4000, action = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { t.classList.add('hidden'); action.fn(); };
    t.append(' ', b);
  }
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- filtering ----------

function matchesView(b) {
  const v = state.view;
  if (v.type === 'smart') return SMART.find(s => s.id === v.value).test(b);
  if (v.type === 'category') return inCategory(b.category, v.value);
  if (v.type === 'source') return b.sources.some(s => s.source === v.value);
  if (v.type === 'tag') return b.tags.includes(v.value);
  return true;
}

function matchesQuery(b, terms) {
  for (const { key, val } of terms) {
    if (key === 'tag') { if (!b.tags.some(t => t.includes(val))) return false; }
    else if (key === 'cat') { if (!(b.category || '').toLowerCase().includes(val)) return false; }
    else if (key === 'site') { if (!b.domain.includes(val)) return false; }
    else if (key === 'in') { if (!b.sources.some(s => s.source.toLowerCase().includes(val))) return false; }
    else {
      const hay = `${b.title} ${b.url} ${b.category || ''} ${b.folder} ${b.notes} ${b.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(val)) return false;
    }
  }
  return true;
}

function parseQuery(q) {
  return q.toLowerCase().split(/\s+/).filter(Boolean).map(tok => {
    const m = tok.match(/^(tag|cat|site|in):(.+)$/);
    return m ? { key: m[1], val: m[2] } : { key: null, val: tok };
  });
}

const SORTS = {
  added: (a, b) => (b.added_at || b.imported_at) - (a.added_at || a.imported_at),
  'added-asc': (a, b) => (a.added_at || a.imported_at) - (b.added_at || b.imported_at),
  title: (a, b) => (a.title || a.url).localeCompare(b.title || b.url),
  domain: (a, b) => a.domain.localeCompare(b.domain) || (a.title || '').localeCompare(b.title || ''),
  used: (a, b) => (b.last_used_at || 0) - (a.last_used_at || 0),
};

function isDeletedView() { return state.view.type === 'smart' && state.view.value === 'deleted'; }

function computeVisible() {
  const terms = parseQuery(state.query);
  if (isDeletedView()) {
    state.visible = state.deleted.filter(b => matchesQuery(b, terms));
    return; // newest deletion first
  }
  state.visible = state.items.filter(b => matchesView(b) && matchesQuery(b, terms)).sort(SORTS[state.sort]);
}

// ---------- rendering ----------

function navItem(type, value, name, n) {
  const active = state.view.type === type && state.view.value === value ? ' active' : '';
  return `<div class="nav-item${active}" data-type="${type}" data-value="${esc(value)}"><span class="name">${esc(name)}</span><span class="n">${n}</span></div>`;
}

// ---------- category tree ----------
// Categories made from browser folders look like "Speed Dials / Desktop / Folder". The sidebar shows
// them as a tree; a parent's view includes everything below it.

const CAT_SEP = ' / ';
const inCategory = (cat, path) => !!cat && (cat === path || cat.startsWith(path + CAT_SEP));
const catLeaf = (cat) => cat.split(CAT_SEP).pop();

const expanded = (() => {
  let set;
  try { set = new Set(JSON.parse(localStorage.getItem('expandedCats') || '[]')); } catch { set = new Set(); }
  return {
    has: (p) => set.has(p),
    toggle(p) {
      if (set.has(p)) set.delete(p); else set.add(p);
      try { localStorage.setItem('expandedCats', JSON.stringify([...set])); } catch {}
    },
  };
})();

function categoryTree(items) {
  const root = { children: new Map() };
  for (const b of items) {
    if (!b.category) continue;
    let node = root, path = '';
    for (const part of b.category.split(CAT_SEP)) {
      path = path ? path + CAT_SEP + part : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, own: 0, total: 0, children: new Map() });
      node = node.children.get(part);
      node.total++;
    }
    node.own++;
  }
  const sorted = (n) => [...n.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ ...c, children: sorted(c) }));
  return sorted(root);
}

function renderCatNodes(nodes, depth) {
  let html = '';
  for (const n of nodes) {
    const kids = n.children.length > 0;
    const open = kids && (expanded.has(n.path) || (state.view.type === 'category' && state.view.value.startsWith(n.path + CAT_SEP)));
    const active = state.view.type === 'category' && state.view.value === n.path ? ' active' : '';
    const caret = kids ? `<span class="caret" data-toggle="${esc(n.path)}" title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</span>` : '<span class="caret"></span>';
    html += `<div class="nav-item cat-node${active}" data-type="category" data-value="${esc(n.path)}" style="--depth:${depth}" title="${esc(n.path)}">${caret}<span class="name">${esc(n.name)}</span><span class="n">${n.total}</span></div>`;
    if (open) html += renderCatNodes(n.children, depth + 1);
  }
  return html;
}

function renderSidebar() {
  const items = state.items;
  let html = '<h3>Library</h3>';
  for (const s of SMART) {
    const n = s.id === 'deleted' ? state.deleted.length : items.filter(s.test).length;
    if (n || ['all', 'favorites', 'uncategorized'].includes(s.id)) html += navItem('smart', s.id, s.name, n);
  }
  const tree = categoryTree(items);
  if (tree.length) {
    html += '<h3>Categories</h3>';
    html += renderCatNodes(tree, 0);
  }
  const srcs = countBy(items, b => [...new Set(b.sources.map(s => s.source))]).sort((a, b) => b[1] - a[1]);
  if (srcs.length) {
    html += '<h3>Sources</h3>';
    for (const [s, n] of srcs) html += navItem('source', s, s, n);
  }
  const tags = countBy(items, b => b.tags).sort((a, b) => b[1] - a[1]).slice(0, 40);
  if (tags.length) {
    html += '<h3>Top tags</h3><div class="tagcloud">';
    for (const [t, n] of tags.sort((a, b) => a[0].localeCompare(b[0]))) {
      const active = state.view.type === 'tag' && state.view.value === t ? ' cat' : '';
      html += `<span class="chip${active}" data-type="tag" data-value="${esc(t)}" title="${n}">${esc(t)}</span>`;
    }
    html += '</div>';
  }
  $('#sidebar').innerHTML = html;
}

function viewName() {
  const v = state.view;
  if (v.type === 'smart') return SMART.find(s => s.id === v.value).name;
  if (v.type === 'tag') return `Tag: ${v.value}`;
  return v.value;
}

function favicon(b) {
  const letter = esc((b.domain || b.title || '?')[0].toUpperCase());
  const bg = `hsl(${hue(b.domain || '?')} 55% 45%)`;
  const img = b.domain ? `<img loading="lazy" src="https://${esc(b.domain)}/favicon.ico" alt="">` : '';
  return `<span class="fav" style="background:${bg}">${img || letter}</span>`;
}

function renderList() {
  computeVisible();
  $('#view-title').textContent = viewName();
  $('#sort').classList.toggle('hidden', isDeletedView()); // deleted view is always newest first
  $('#view-count').textContent = `${state.visible.length} bookmark${state.visible.length === 1 ? '' : 's'}`;
  $('#empty').classList.toggle('hidden', state.items.length > 0);

  // Only what's visible can stay selected, so "Delete selected" never hits hidden rows.
  const visibleIds = new Set(state.visible.map(b => b.id));
  for (const id of state.checked) if (!visibleIds.has(id)) state.checked.delete(id);

  const html = state.visible.slice(0, 3000).map(b => {
    const status = b.status === 'dead' || b.status === 'warn' || b.status === 'ok'
      ? `<span class="dot ${b.status}" title="${b.status}${b.status_code ? ' ' + b.status_code : ''}"></span>` : '';
    const on = state.checked.has(b.id);
    return `<li data-id="${b.id}" class="${b.id === state.selectedId ? 'selected' : ''}${on ? ' checked' : ''}">
      <input type="checkbox" class="pick" tabindex="-1" ${on ? 'checked' : ''} title="Select">
      ${favicon(b)}
      <div class="main-col"><div class="t">${b.favorite ? '<span class="star">★</span> ' : ''}${esc(b.title || b.url)}</div>
      <div class="u">${esc(b.domain)}${b.folder ? ' · ' + esc(b.folder) : ''}</div></div>
      <div class="meta">${b.deleted ? `<span class="muted small">deleted ${fmtDate(b.removed_at)}</span>` : ""}${b.category ? `<span class="chip cat">${esc(b.category)}</span>` : ''}${b.deleted ? "" : status}</div>
    </li>`;
  }).join('');
  $('#list').innerHTML = html;
  syncChecks();

  // Broken favicons fall back to a coloured letter.
  for (const img of $('#list').querySelectorAll('img')) {
    img.addEventListener('error', () => {
      const span = img.parentElement;
      span.textContent = span.closest('li') ? (state.items.find(x => x.id == span.closest('li').dataset.id)?.domain || '?')[0].toUpperCase() : '?';
    }, { once: true });
  }
}

function renderDeletedDetail(el, b) {
  el.innerHTML = `
    <button class="close icon" id="d-close" title="Close">✕</button>
    <h3 class="d-title">${esc(b.title || b.url)}</h3>
    <div class="url"><a href="#" id="d-url">${esc(b.url)}</a></div>
    <div class="btns">
      <button class="primary" id="d-restore">Restore</button>
      <button id="d-open">Open</button>
    </div>
    <div class="facts">
      <span>Deleted</span><b>${fmtDate(b.removed_at)}</b>
      <span>Category</span><b>${esc(b.category || '—')}</b>
      <span>Tags</span><b>${esc(b.tags.join(', ') || '—')}</b>
      <span>Saved in</span><b>${[...new Set(b.sources.map(s => s.source))].map(esc).join('<br>') || '—'}</b>
    </div>
    ${b.hasSnapshot ? '' : '<p class="muted small">Deleted before details were saved. Restoring brings back the link; import again to fill in the title and folders.</p>'}`;
  $('#d-close').onclick = () => { state.selectedId = null; renderList(); renderDetail(); };
  $('#d-open').onclick = $('#d-url').onclick = (e) => { e.preventDefault(); window.api.open(b.url); };
  $('#d-restore').onclick = () => restoreBookmarks([b.id]);
}

function renderDetail() {
  const el = $('#detail');
  const b = state.items.find(x => x.id === state.selectedId) || state.deleted.find(x => x.id === state.selectedId);
  if (!b) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (b.deleted) return renderDeletedDetail(el, b);
  const cats = [...new Set(state.items.map(x => x.category).filter(Boolean))].sort();
  const browsers = [...new Set(b.sources.map(s => s.source))];
  const statusText = { ok: 'Working', dead: 'Dead', warn: 'Problem', skipped: 'Not a web link' }[b.status] || 'Not checked';
  el.innerHTML = `
    <button class="close icon" id="d-close" title="Close">✕</button>
    <label>Title</label><input id="d-title" value="${esc(b.title)}">
    <div class="url"><a href="#" id="d-url">${esc(b.url)}</a></div>
    <div class="btns">
      <button class="primary" id="d-open">Open</button>
      <button id="d-fav">${b.favorite ? '★ Unfavorite' : '☆ Favorite'}</button>
      ${b.status === 'dead' || b.status === 'warn' ? '<button id="d-wayback">Wayback Machine</button>' : ''}
      <button class="danger" id="d-remove">Remove</button>
    </div>
    <label>Category</label><input id="d-cat" list="cat-list" value="${esc(b.category || '')}" placeholder="Uncategorized">
    <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <label>Tags (comma separated)</label><input id="d-tags" value="${esc(b.tags.join(', '))}">
    <label>Notes</label><textarea id="d-notes" placeholder="Why did you save this?">${esc(b.notes)}</textarea>
    <div class="facts">
      <span>Added</span><b>${fmtDate(b.added_at)}</b>
      <span>Last opened</span><b>${fmtDate(b.last_used_at)}${b.visit_count ? ` · ${b.visit_count} visits` : ''}</b>
      <span>Link</span><b>${statusText}${b.status_code ? ` (${b.status_code})` : ''}${b.checked_at ? ` · ${fmtDate(b.checked_at)}` : ''}</b>
      <span>Saved in</span><b>${browsers.map(esc).join('<br>')}</b>
      <span>Folders</span><b>${[...new Set(b.sources.map(s => s.folder).filter(Boolean))].map(esc).join('<br>') || '—'}</b>
    </div>`;

  const save = async (patch) => { await window.api.update(b.id, patch); await reload(); };
  $('#d-close').onclick = () => { state.selectedId = null; renderList(); renderDetail(); };
  $('#d-open').onclick = $('#d-url').onclick = (e) => { e.preventDefault(); window.api.open(b.url); };
  $('#d-fav').onclick = () => save({ favorite: b.favorite ? 0 : 1 });
  if ($('#d-wayback')) $('#d-wayback').onclick = () => window.api.open('https://web.archive.org/web/2/' + b.url);
  $('#d-remove').onclick = () => deleteBookmarks([b.id], `“${b.title || b.url}”`);
  $('#d-title').onchange = (e) => save({ title: e.target.value });
  $('#d-cat').onchange = (e) => save({ category: e.target.value.trim() || null });
  $('#d-tags').onchange = (e) => save({ tags: e.target.value.split(',') });
  $('#d-notes').onchange = (e) => save({ notes: e.target.value });
}

function renderAll() { renderSidebar(); renderList(); renderDetail(); }

async function reload() {
  [state.items, state.deleted] = await Promise.all([window.api.list(), window.api.listDeleted()]);
  if (isDeletedView() && !state.deleted.length) state.view = { type: 'smart', value: 'all' };
  if (state.view.type === 'category' && !state.items.some(b => inCategory(b.category, state.view.value))) state.view = { type: 'smart', value: 'all' };
  renderAll();
}

// ---------- progress ----------

// `kind` ('categorize' | 'links') is the job the Cancel button stops.
function showProgress(label, done, total, kind) {
  const p = $('#progress');
  if (kind && p.dataset.kind !== kind) { p.dataset.kind = kind; $('#progress-cancel').disabled = false; $('#progress-cancel').textContent = 'Cancel'; }
  if (p.dataset.stopping) return;
  p.classList.remove('hidden');
  p.querySelector('.bar').style.width = total ? `${(100 * done) / total}%` : '0';
  p.querySelector('.label').textContent = `${label} ${done} / ${total}`;
}
function hideProgress() {
  const p = $('#progress');
  p.classList.add('hidden');
  delete p.dataset.kind;
  delete p.dataset.stopping;
}

window.api.onProgress(async (p) => {
  showProgress(p.kind === 'categorize' ? 'Categorizing…' : 'Checking links…', p.done, p.total, p.kind);
  await reload();
});

$('#progress-cancel').onclick = () => {
  const p = $('#progress');
  if (!p.dataset.kind) return;
  p.dataset.stopping = '1';
  $('#progress-cancel').disabled = true;
  p.querySelector('.label').textContent = 'Stopping…';
  window.api.cancelJob(p.dataset.kind);
};

// ---------- import dialog ----------

async function openImport() {
  const dlg = $('#dlg-import');
  $('#import-result').innerHTML = '';
  const sources = await window.api.detectSources();
  const imported = new Set(state.items.flatMap(b => b.sources.map(s => s.source)));
  $('#import-sources').innerHTML = sources.length
    ? sources.map((s, i) => `<label><input type="checkbox" data-i="${i}" ${imported.has(s.label) ? '' : 'checked'}>
        <div><div>${esc(s.label)}${imported.has(s.label) ? ' <span class="muted small">(imported before)</span>' : ''}</div><div class="p">${esc(s.path)}</div></div></label>`).join('')
    : '<p class="muted">No browser profiles found. Use “Import a bookmarks.html file…” instead.</p>';
  dlg.sources = sources;
  dlg.showModal();
}

function showImportResults(results) {
  $('#import-result').innerHTML = results.map(r => r.error
    ? `<div class="err">${esc(r.label)}: ${esc(r.error)}</div>`
    : `<div><b>${esc(r.label)}</b>: ${r.found} found · <b>${r.added} new</b> · ${r.merged} were already in the library (merged)` +
      (r.skipped ? ` · ${r.skipped} skipped because you deleted them earlier` : '') +
      (r.added + r.merged ? ` · <a href="#" data-source="${esc(r.label)}">show them</a>` : '') + '</div>').join('') +
    (results.some(r => !r.error && r.found && !r.added)
      ? '<div class="muted small">Nothing new usually means these bookmarks were already imported from another browser. They are merged, and this source is added to each one.</div>' : '');
}

$('#import-go').onclick = async () => {
  const dlg = $('#dlg-import');
  const chosen = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => dlg.sources[+c.dataset.i]);
  if (!chosen.length) return;
  $('#import-go').disabled = true;
  try {
    showImportResults(await window.api.importSources(chosen));
    await reload();
  } finally {
    $('#import-go').disabled = false;
  }
};
$('#import-html').onclick = async () => {
  const results = await window.api.importHtml();
  if (results.length) { showImportResults(results); await reload(); }
};
$('#import-close').onclick = () => $('#dlg-import').close();
// "show them" jumps to the source view for that import.
$('#import-result').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-source]');
  if (!a) return;
  e.preventDefault();
  $('#dlg-import').close();
  state.view = { type: 'source', value: a.dataset.source };
  state.checked.clear();
  state.query = ''; $('#search').value = '';
  renderSidebar(); renderList();
});

// ---------- sync deletions to browsers ----------

async function loadSyncPlan() {
  $('#sync-sources').innerHTML = '<p class="muted">Looking through your browsers…</p>';
  $('#sync-go').disabled = true;
  const plan = await window.api.browserSyncPlan();
  const dlg = $('#dlg-sync');
  dlg.plan = plan;
  const any = plan.some(p => p.matches.length);
  $('#sync-go').disabled = !any;
  if (!plan.length) { $('#sync-sources').innerHTML = '<p class="muted">No browser profiles found.</p>'; return; }
  $('#sync-sources').innerHTML = (any ? '' : '<p class="muted">Nothing to do: none of the bookmarks you deleted are left in your browsers.</p>') +
    plan.filter(p => p.matches.length || p.error).map((p, i) => {
      const n = p.matches.length;
      const notes = [];
      // Synced Chromium profiles: deleting in the file can be undone by the sync server, so the extension is the way.
      const useExt = p.synced && p.browser !== 'Firefox';
      if (useExt) notes.push(`<span class="warn-text">This profile syncs with your ${esc(p.browser)} account, so its sync server may put file deletions back. <b>Use the browser extension for this one</b> (works with ${esc(p.browser)} open).</span>`);
      else if (p.synced) notes.push('<span class="muted">Syncs with your Firefox account. Firefox Sync passes the deletions on to your other devices.</span>');
      if (p.running && !useExt) notes.push(`<span class="warn-text">${esc(p.browser)} is running. Close it completely first (also check the system tray).</span>`);
      if (p.error) notes.push(`<span class="err">${esc(p.error)}</span>`);
      const preview = p.matches.slice(0, 8).map(m => `<div class="p">• ${esc(m.title || m.url)} <span class="muted">${esc(m.folder)}</span></div>`).join('') +
        (n > 8 ? `<div class="p">… and ${n - 8} more</div>` : '');
      const idx = plan.indexOf(p);
      return `<label class="sync-src"><input type="checkbox" data-i="${idx}" ${n && !p.running && !p.error && !useExt ? 'checked' : ''} ${n && !p.error ? '' : 'disabled'}>
        <div><div><b>${esc(p.label)}</b>: ${n} to delete</div>${notes.map(x => `<div class="p">${x}</div>`).join('')}${preview}</div></label>`;
    }).join('');
}

$('#btn-sync').onclick = async () => {
  $('#sync-result').innerHTML = '';
  $('#dlg-sync').showModal();
  await loadSyncPlan();
};
$('#sync-refresh').onclick = () => { $('#sync-result').innerHTML = ''; loadSyncPlan(); };
$('#sync-close').onclick = () => $('#dlg-sync').close();
$('#sync-go').onclick = async () => {
  const dlg = $('#dlg-sync');
  const chosen = [...dlg.querySelectorAll('#sync-sources input:checked')].map(c => dlg.plan[+c.dataset.i]);
  if (!chosen.length) return;
  const total = chosen.reduce((n, p) => n + p.matches.length, 0);
  if (!confirm(`Delete ${total} bookmarks from:\n\n${chosen.map(p => `• ${p.label} (${p.matches.length})`).join('\n')}\n\nA backup of each bookmark file is saved next to it first.`)) return;
  $('#sync-go').disabled = true;
  try {
    const results = await window.api.browserSyncApply(chosen.map(p => p.label));
    $('#sync-result').innerHTML = results.map(r => r.error
      ? `<div class="err">${esc(r.label)}: ${esc(r.error)}</div>`
      : `<div>${esc(r.label)}: <b>${r.removed} deleted</b>${r.backup ? ` · <a href="#" data-file="${esc(r.backup)}">show backup</a>` : ''}</div>`).join('');
    await loadSyncPlan();
  } finally {
    $('#sync-go').disabled = !dlg.plan?.some(p => p.matches.length);
  }
};
$('#sync-result').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-file]');
  if (a) { e.preventDefault(); window.api.revealFile(a.dataset.file); }
});

// ---------- restore a browser's bookmark file from a backup ----------

const fmtDateTime = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

async function loadBackups() {
  const list = $('#backup-list');
  list.innerHTML = '<p class="muted">Looking for backups…</p>';
  const profiles = await window.api.browserBackups();
  if (!profiles.length) {
    list.innerHTML = '<p class="muted">No backups yet. They are made each time <i>Sync to browsers</i> deletes something.</p>';
    return;
  }
  list.innerHTML = profiles.map(p => `
    <div class="backup-profile">
      <div><b>${esc(p.label)}</b> <span class="muted">· now ${p.current ?? '?'} bookmarks</span></div>
      ${p.backups.map(b => {
        const diff = b.count != null && p.current != null ? b.count - p.current : null;
        const delta = diff ? ` <span class="muted">(${diff > 0 ? '+' : ''}${diff})</span>` : '';
        return `<div class="backup-row">
          <span>${esc(fmtDateTime(b.at))}</span>
          <span class="muted">${b.count == null ? 'unreadable' : `${b.count} bookmarks${delta}`}</span>
          <span class="spacer"></span>
          <button class="tiny" data-show="${esc(b.file)}">Show file</button>
          <button class="tiny" data-label="${esc(p.label)}" data-file="${esc(b.file)}" data-when="${esc(fmtDateTime(b.at))}" data-count="${b.count ?? ''}" ${b.count == null ? 'disabled' : ''}>Restore</button>
        </div>`;
      }).join('')}
    </div>`).join('');
}

$('#sync-backups').onclick = async () => {
  $('#backup-result').innerHTML = '';
  $('#dlg-backups').showModal();
  await loadBackups();
};
$('#backup-close').onclick = () => {
  $('#dlg-backups').close();
  if ($('#dlg-sync').open) loadSyncPlan();
};
$('#backup-list').addEventListener('click', async (e) => {
  const show = e.target.closest('button[data-show]');
  if (show) return window.api.revealFile(show.dataset.show);
  const btn = e.target.closest('button[data-file]');
  if (!btn) return;
  const { label, file, when, count } = btn.dataset;
  if (!confirm(`Restore the bookmarks of ${label} from ${when} (${count} bookmarks)?\n\nThe browser's current bookmark file is replaced. It's backed up first, so you can switch back.`)) return;
  btn.disabled = true;
  const r = await window.api.browserRestore(label, file);
  $('#backup-result').innerHTML = r.error
    ? `<div class="err">${esc(label)}: ${esc(r.error)}</div>`
    : `<div>${esc(label)}: <b>restored ${r.restored} bookmarks</b> from ${esc(when)}. Start the browser to see them.</div>`;
  await loadBackups();
});

// ---------- settings ----------

async function refreshKeyStatus() {
  const s = await window.api.keyStatus();
  $('#key-input').value = '';
  $('#key-status').textContent = s.saved ? 'A key is saved.' : s.env ? 'Using ANTHROPIC_API_KEY from your environment.' : 'No key saved yet.';
}

async function refreshOllamaStatus() {
  const model = $('#ollama-model').value.trim() || 'qwen2.5:3b';
  const el = $('#ollama-status');
  el.textContent = 'Checking Ollama…';
  const s = await window.api.ollamaStatus(model);
  if (!s.running) {
    el.innerHTML = 'Ollama is not running. Install it from <a href="https://ollama.com/download" target="_blank">ollama.com/download</a>, then run <code>ollama pull ' + esc(model) + '</code> in a terminal.';
  } else if (!s.hasModel) {
    el.innerHTML = `Ollama is running, but the model isn't downloaded yet. In a terminal, run <code>ollama pull ${esc(model)}</code>` +
      (s.models.length ? `<br>Installed: ${s.models.map(esc).join(', ')}` : '');
  } else {
    el.textContent = `Ready: Ollama is running and ${model} is installed.`;
  }
}

function showCategorizerOptions(value) {
  $('#opt-ollama').classList.toggle('hidden', value !== 'ollama');
  $('#opt-claude').classList.toggle('hidden', value !== 'claude');
  if (value === 'ollama') refreshOllamaStatus();
  if (value === 'claude') refreshKeyStatus();
}

async function openSettings() {
  const s = await window.api.getSettings();
  for (const r of document.querySelectorAll('input[name=categorizer]')) r.checked = r.value === s.categorizer;
  $('#ollama-model').value = s.ollamaModel;
  $('#ollama-cpu').checked = !!s.ollamaCpuOnly;
  showCategorizerOptions(s.categorizer);
  $('#dlg-settings').showModal();
}

for (const r of document.querySelectorAll('input[name=categorizer]')) {
  r.addEventListener('change', async () => {
    await window.api.saveSettings({ categorizer: r.value });
    showCategorizerOptions(r.value);
  });
}
$('#ollama-model').addEventListener('change', async (e) => {
  await window.api.saveSettings({ ollamaModel: e.target.value.trim() || 'qwen2.5:3b' });
  refreshOllamaStatus();
});
$('#ollama-cpu').addEventListener('change', (e) => window.api.saveSettings({ ollamaCpuOnly: e.target.checked }));
$('#key-save').onclick = async () => {
  const key = $('#key-input').value.trim();
  if (!key) return;
  try { await window.api.saveKey(key); toast('API key saved.'); refreshKeyStatus(); }
  catch (e) { toast(e.message); }
};
$('#key-clear').onclick = async () => { await window.api.saveKey(''); toast('API key removed.'); refreshKeyStatus(); };
$('#settings-close').onclick = () => $('#dlg-settings').close();

// ---------- toolbar ----------

$('#btn-import').onclick = openImport;
$('#btn-settings').onclick = openSettings;

$('#btn-categorize').onclick = async () => {
  const todo = state.visible.filter(b => !b.category);
  const ids = (todo.length ? todo : state.visible).map(b => b.id);
  if (!ids.length) return toast('Nothing to categorize in this view.');
  const { categorizer } = await window.api.getSettings();
  const engine = { rules: 'the built-in rules', ollama: 'local AI (Ollama)', claude: 'Claude' }[categorizer];
  const what = todo.length ? `${ids.length} uncategorized bookmarks` : `all ${ids.length} bookmarks in this view (they already have categories)`;
  const msg = `Categorize ${what} with ${engine}?` +
    (categorizer === 'claude' ? '\n\nTitle, URL and folder name are sent to the Anthropic API.' : '\n\nEverything stays on this PC.') +
    '\n\n(Change this under ⚙ Settings.)';
  if (!confirm(msg)) return;
  $('#btn-categorize').disabled = true;
  showProgress(`Categorizing with ${engine}…`, 0, ids.length, 'categorize');
  try {
    const r = await window.api.categorize(ids);
    if (r.cancelled) toast(`Stopped. ${r.count} of ${ids.length} bookmarks were categorized and kept.`, 7000);
    else if (r.error) toast(r.error, 10000);
    else toast(`Categorized ${r.count} bookmarks.`);
    if (r.cpuFallback) setTimeout(() => toast('Ollama crashed on your graphics card, so it now runs on the CPU (slower). This is remembered; change it under ⚙ Settings.', 10000), r.error || r.cancelled ? 10500 : 4000);
  } finally {
    $('#btn-categorize').disabled = false;
    hideProgress();
    await reload();
  }
};

$('#btn-check').onclick = async () => {
  const ids = state.visible.map(b => b.id);
  if (!ids.length) return;
  if (!confirm(`Check ${ids.length} links? Each site will be contacted once.`)) return;
  $('#btn-check').disabled = true;
  showProgress('Checking links…', 0, ids.length, 'links');
  const started = Date.now();
  try {
    const r = await window.api.checkLinks(ids);
    if (r.error) toast(r.error);
    else {
      await reload();
      // Count only links checked in this run, not results left from earlier checks.
      const wanted = new Set(ids);
      const checked = state.items.filter(b => wanted.has(b.id) && b.checked_at >= started);
      const dead = checked.filter(b => b.status === 'dead').length;
      const warn = checked.filter(b => b.status === 'warn').length;
      toast(r.cancelled
        ? `Stopped after ${r.count} of ${ids.length} links. Results so far are kept: ${dead} dead, ${warn} with problems.`
        : `Done: ${dead} dead, ${warn} with problems. See “Dead links” in the sidebar.`, 7000);
    }
  } finally {
    $('#btn-check').disabled = false;
    hideProgress();
  }
};

$('#btn-random').onclick = () => {
  if (!state.visible.length) return;
  const b = state.visible[Math.floor(Math.random() * state.visible.length)];
  state.selectedId = b.id;
  renderList(); renderDetail();
  document.querySelector(`#list li[data-id="${b.id}"]`)?.scrollIntoView({ block: 'center' });
};

$('#btn-export').onclick = async () => {
  if (!state.visible.length) return;
  const anyCats = state.visible.some(b => b.category);
  const file = await window.api.exportHtml(state.visible.map(b => b.id), anyCats ? 'category' : 'folder');
  if (file) toast(`Exported ${state.visible.length} bookmarks to ${file}`, 6000);
};

// ---------- list / sidebar / search events ----------

$('#sidebar').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) { expanded.toggle(toggle.dataset.toggle); renderSidebar(); return; }
  const el = e.target.closest('[data-type]');
  if (!el) return;
  state.view = { type: el.dataset.type, value: el.dataset.value };
  state.checked.clear(); state.anchor = null;
  renderSidebar(); renderList();
});

// ---------- multi-select ----------

// Updates checkboxes, row highlight and the selection bar without re-rendering the list (keeps scroll position).
function syncChecks() {
  for (const li of $('#list').children) {
    const on = state.checked.has(+li.dataset.id);
    li.classList.toggle('checked', on);
    li.querySelector('.pick').checked = on;
  }
  const n = state.checked.size;
  const del = isDeletedView();
  $('#sel-delete').classList.toggle('hidden', del);
  $('#sel-bulk').classList.toggle('hidden', del);
  $('#sel-restore').classList.toggle('hidden', !del);
  $('#sel-hint').textContent = 'Ctrl+click or Shift+click to select more' + (del ? '' : ' · Del deletes');
  $('#selbar').classList.toggle('hidden', n === 0);
  $('#list').classList.toggle('picking', n > 0);
  $('#sel-count').textContent = `${n} selected`;
  const all = $('#pick-all');
  all.checked = n > 0 && n === state.visible.length;
  all.indeterminate = n > 0 && n < state.visible.length;
}

function toggleCheck(id, shift) {
  if (shift && state.anchor != null) {
    const ids = state.visible.map(b => b.id);
    const a = ids.indexOf(state.anchor), b = ids.indexOf(id);
    if (a !== -1 && b !== -1) {
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) state.checked.add(ids[i]);
      state.anchor = id;
      syncChecks();
      return;
    }
  }
  if (state.checked.has(id)) state.checked.delete(id); else state.checked.add(id);
  state.anchor = id;
  syncChecks();
}

function clearChecks() { state.checked.clear(); state.anchor = null; syncChecks(); }

async function deleteBookmarks(ids, what) {
  if (!ids.length) return;
  if (!confirm(`Delete ${what} from the library?\n\nFuture imports will skip these links. To remove them from your browsers too, use “Sync to browsers”.`)) return;
  const norms = new Set(state.items.filter(b => ids.includes(b.id)).map(b => b.norm));
  await window.api.remove(ids);
  if (ids.includes(state.selectedId)) state.selectedId = null;
  for (const id of ids) state.checked.delete(id);
  await reload();
  const undo = () => restoreBookmarks(state.deleted.filter(d => norms.has(d.norm)).map(d => d.id));
  toast(`Deleted ${ids.length} bookmark${ids.length === 1 ? '' : 's'}.`, 8000, { label: 'Undo', fn: undo });
}

async function restoreBookmarks(ids) {
  if (!ids.length) return;
  const n = await window.api.restore(ids);
  if (ids.includes(state.selectedId)) state.selectedId = null;
  for (const id of ids) state.checked.delete(id);
  await reload();
  toast(`Restored ${n} bookmark${n === 1 ? '' : 's'}. Future imports include ${n === 1 ? 'it' : 'them'} again.`);
}

$('#pick-all').addEventListener('change', (e) => {
  if (e.target.checked) state.visible.forEach(b => state.checked.add(b.id)); else state.checked.clear();
  syncChecks();
});
$('#sel-clear').onclick = clearChecks;
$('#sel-delete').onclick = () => {
  const n = state.checked.size;
  deleteBookmarks([...state.checked], `${n} selected bookmark${n === 1 ? '' : 's'}`);
};
$('#sel-restore').onclick = () => restoreBookmarks([...state.checked]);

// ---------- browser extension setup ----------

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

async function refreshExtDialog() {
  const [info, ff] = await Promise.all([window.api.bridgeInfo(), window.api.bridgeFirefox()]);
  $('#ext-folder').textContent = info.folder;
  $('#ext-ff-folder').textContent = ff.error ? `Couldn't prepare the Firefox version: ${ff.error}` : ff.folder;
  $('#ext-token').textContent = info.token;
  const seen = (info.contacts || []).map(c => `${esc(c.browser)} (${ago(c.at)})`).join(', ');
  $('#ext-status').innerHTML = info.error
    ? `<span class="err">The connection for the extension isn't available: ${esc(info.error)}</span>`
    : info.listening
      ? `<span class="ok-text">● Ready for the extension</span> <span class="muted">(only on this PC, while the app is open)</span>` +
        (seen ? `<br><span class="muted">Last connected: ${seen}</span>` : '')
      : '<span class="muted">Starting…</span>';
}

async function openExtDialog() {
  await refreshExtDialog();
  $('#dlg-ext').showModal();
}

$('#sync-ext').onclick = openExtDialog;
$('#ext-close').onclick = () => $('#dlg-ext').close();
$('#ext-open').onclick = () => window.api.bridgeOpenFolder();
$('#ext-copy').onclick = async () => {
  await window.api.copyText($('#ext-token').textContent);
  $('#ext-copy').textContent = 'Copied';
  setTimeout(() => { $('#ext-copy').textContent = 'Copy'; }, 1500);
};
$('#ext-new').onclick = async () => {
  if (!confirm('Make a new pairing code? Browsers using the old code will ask for the new one.')) return;
  await window.api.bridgeNewToken();
  await refreshExtDialog();
};
$('#ext-ff-open').onclick = () => window.api.bridgeOpenFirefoxFolder();
$('#ext-ff-howto').onclick = (e) => { e.preventDefault(); window.api.open(FIREFOX_SIGN_URL); };
for (const id of ['#ext-url-chrome', '#ext-url-edge', '#ext-url-firefox']) {
  $(id).title = 'Click to copy';
  $(id).style.cursor = 'pointer';
  $(id).onclick = async () => { await window.api.copyText($(id).textContent); toast(`Copied ${$(id).textContent}. Paste it in the browser's address bar.`); };
}

// The extension reports back after it deletes (or undoes) in a browser.
window.api.onBridgeReport(async (r) => {
  if ($('#dlg-ext').open) refreshExtDialog();
  if (r.undone) return toast(`${r.browser}: the extension put its last deletions back.`, 7000);
  toast(`${r.browser}: the extension deleted ${plural(r.removed)}${r.failed ? ` (${r.failed} couldn't be deleted)` : ''}. Browser sync takes it from here.`, 8000);
  if ($('#dlg-sync').open) loadSyncPlan();
});

// ---------- rename / merge a category ----------

// When the open view is the category being renamed, follow it to the new name (or to All).
function leaveCategoryView(oldName, newName) {
  if (state.view.type === 'category' && state.view.value === oldName) {
    state.view = newName ? { type: 'category', value: newName } : { type: 'smart', value: 'all' };
  }
}

function openCategoryRename(name) {
  const dlg = $('#dlg-cat');
  const others = [...new Set(state.items.map(b => b.category).filter(c => c && c !== name))].sort();
  dlg.oldName = name;
  $('#cat-title').textContent = `Rename “${name}”`;
  $('#cat-names').innerHTML = others.map(c => `<option value="${esc(c)}">`).join('');
  $('#cat-name').value = name;
  updateCategoryHint();
  dlg.showModal();
  $('#cat-name').select();
}

function updateCategoryHint() {
  const dlg = $('#dlg-cat');
  const v = $('#cat-name').value.trim();
  // Case-insensitive match, so "work" merges into an existing "Work".
  const target = state.items.map(b => b.category).find(c => c && c !== dlg.oldName && c.toLowerCase() === v.toLowerCase());
  const n = target ? state.items.filter(b => b.category === target).length : 0;
  $('#cat-hint').textContent = target
    ? `“${target}” already exists (${plural(n)}). Both will be merged into it.`
    : 'Type an existing category\'s name to merge into it.';
  $('#cat-ok').textContent = target ? 'Merge' : 'Rename';
  dlg.target = target || v;
}

$('#cat-name').addEventListener('input', updateCategoryHint);
$('#cat-cancel').onclick = () => $('#dlg-cat').close();
$('#cat-form').addEventListener('submit', () => {
  const dlg = $('#dlg-cat');
  const from = dlg.oldName, to = dlg.target;
  if (!to || to === from) return;
  // Sub-categories move along: "A / B" renamed to "X" turns "A / B / C" into "X / C".
  const changes = state.items.filter(b => inCategory(b.category, from)).map(b => ({ id: b.id, category: to + b.category.slice(from.length) }));
  const merging = state.items.some(b => b.category === to);
  leaveCategoryView(from, to);
  applyCategoryChanges(changes, merging ? `Merged “${from}” into “${to}”.` : `Renamed “${from}” to “${to}”.`);
});

// ---------- info panel ----------

$('#btn-info').onclick = async () => {
  const info = await window.api.appInfo().catch(() => null);
  $('#info-version').textContent = info ? `v${info.version}` : '';
  $('#dlg-info').showModal();
  $('#dlg-info').scrollTop = 0; // focus lands on Close at the bottom; start at the top
};
$('#info-close').onclick = () => $('#dlg-info').close();
// The full guide lives in the GitHub README (the repo is private, so it needs your GitHub sign-in).
const README_URL = 'https://github.com/b0red/Bookmark-synker#readme';
const FIREFOX_SIGN_URL = 'https://github.com/b0red/Bookmark-synker/blob/main/docs/INSTALL.md#firefox-keep-it-installed';
$('#info-more').onclick = (e) => { e.preventDefault(); window.api.open(README_URL); };

// ---------- bulk actions on the selection ----------

const plural = (n) => `${n} bookmark${n === 1 ? '' : 's'}`;

// Applies one change to every selected bookmark, with Undo that puts each one's old values back.
async function bulkApply(patch, message) {
  return applyToIds([...state.checked], patch, message);
}

// Gives each bookmark its own new category (changes: [{ id, category }]), with Undo.
async function applyCategoryChanges(changes, message) {
  if (!changes.length) return;
  const byId = new Map(state.items.map(b => [b.id, b]));
  const snap = (b, category) => ({ id: b.id, category, favorite: b.favorite, tags: [...b.tags] });
  const before = changes.map(c => byId.get(c.id)).filter(Boolean).map(b => snap(b, b.category));
  const after = changes.filter(c => byId.has(c.id)).map(c => snap(byId.get(c.id), c.category || null));
  await window.api.setFields(after);
  await reload();
  toast(message, 8000, { label: 'Undo', fn: async () => { await window.api.setFields(before); await reload(); toast('Undone.'); } });
}

async function applyToIds(ids, patch, message) {
  if (!ids.length) return;
  const set = new Set(ids);
  const before = state.items.filter(b => set.has(b.id))
    .map(b => ({ id: b.id, category: b.category, favorite: b.favorite, tags: [...b.tags] }));
  await window.api.bulkUpdate(ids, patch);
  await reload();
  toast(message, 8000, {
    label: 'Undo',
    fn: async () => { await window.api.setFields(before); await reload(); toast('Undone.'); },
  });
}

function openBulk(mode) {
  const n = state.checked.size;
  if (!n) return;
  const sel = state.items.filter(b => state.checked.has(b.id));
  $('#bulk-cat-fields').classList.toggle('hidden', mode !== 'category');
  $('#bulk-tag-fields').classList.toggle('hidden', mode !== 'tags');
  $('#bulk-title').textContent = mode === 'category' ? `Set category for ${plural(n)}` : `Tags for ${plural(n)}`;
  const cats = [...new Set(state.items.map(b => b.category).filter(Boolean))].sort();
  $('#bulk-cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  // Suggest tags the selection already has first, then the rest.
  const selTags = [...new Set(sel.flatMap(b => b.tags))].sort();
  const allTags = [...new Set(state.items.flatMap(b => b.tags))].sort().filter(t => !selTags.includes(t));
  $('#bulk-tag-list').innerHTML = [...selTags, ...allTags].map(t => `<option value="${esc(t)}">`).join('');
  const shared = [...new Set(sel.map(b => b.category || ''))];
  $('#bulk-cat').value = shared.length === 1 ? shared[0] : '';
  $('#bulk-add').value = '';
  $('#bulk-remove').value = '';
  $('#dlg-bulk').mode = mode;
  $('#dlg-bulk').showModal();
  (mode === 'category' ? $('#bulk-cat') : $('#bulk-add')).focus();
}

$('#sel-cat').onclick = () => openBulk('category');
$('#sel-tags').onclick = () => openBulk('tags');
$('#sel-fav').onclick = () => bulkApply({ favorite: 1 }, `Marked ${plural(state.checked.size)} as favorites.`);
$('#sel-unfav').onclick = () => bulkApply({ favorite: 0 }, `Removed favorite from ${plural(state.checked.size)}.`);
$('#bulk-cancel').onclick = () => $('#dlg-bulk').close();
$('#bulk-form').addEventListener('submit', () => {
  const n = state.checked.size;
  if ($('#dlg-bulk').mode === 'category') {
    const cat = $('#bulk-cat').value.trim();
    bulkApply({ category: cat || null }, cat ? `Moved ${plural(n)} to “${cat}”.` : `Made ${plural(n)} uncategorized.`);
  } else {
    const split = (s) => s.split(',').map(t => t.trim()).filter(Boolean);
    const addTags = split($('#bulk-add').value), removeTags = split($('#bulk-remove').value);
    if (!addTags.length && !removeTags.length) return;
    const parts = [addTags.length && `added ${addTags.join(', ')}`, removeTags.length && `removed ${removeTags.join(', ')}`].filter(Boolean);
    bulkApply({ addTags, removeTags }, `Tags on ${plural(n)}: ${parts.join('; ')}.`);
  }
});

// Right-click on a cleanup view (e.g. "Dead links") offers to delete everything in it.
const DELETABLE_VIEWS = new Set(['stale', 'dead', 'warn']);

function hideMenu() { $('#ctxmenu').classList.add('hidden'); }

$('#sidebar').addEventListener('contextmenu', (e) => {
  const menu = $('#ctxmenu');
  const place = () => {
    menu.classList.remove('hidden');
    menu.style.left = Math.min(e.clientX, innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = Math.min(e.clientY, innerHeight - menu.offsetHeight - 8) + 'px';
  };
  const catEl = e.target.closest('.nav-item[data-type="category"]');
  if (catEl) {
    e.preventDefault();
    const name = catEl.dataset.value;
    const members = state.items.filter(b => inCategory(b.category, name));
    const below = members.filter(b => b.category !== name);
    const hasSub = below.length > 0;
    menu.innerHTML = `<button data-act="rename">Rename or merge…</button>
      ${hasSub ? `<button data-act="leaves" title="For example “Speed Dials / Desktop / Recipes” becomes “Recipes”">Keep only the sub-category names (${below.length})</button>
      <button data-act="collapse">Merge sub-categories into “${esc(catLeaf(name))}” (${below.length})</button>` : ''}
      ${name.includes(CAT_SEP) ? `<button data-act="leaf-self" title="Drops the parent part of the name">Rename to just “${esc(catLeaf(name))}”${hasSub ? ' (with its sub-categories)' : ''}</button>` : ''}
      <button data-act="uncat">Remove category (${members.length} become uncategorized)</button>
      <button class="danger" data-act="delete">Delete ${members.length === 1 ? "the 1 bookmark" : `all ${members.length} bookmarks`}</button>`;
    place();
    menu.querySelector('[data-act="rename"]').onclick = () => { hideMenu(); openCategoryRename(name); };
    const act = (sel, fn) => { const b = menu.querySelector(sel); if (b) b.onclick = () => { hideMenu(); fn(); }; };
    act('[data-act="leaves"]', () => {
      leaveCategoryView(name, null);
      applyCategoryChanges(below.map(b => ({ id: b.id, category: catLeaf(b.category) })),
        `Kept only the sub-category names for ${plural(below.length)}.`);
    });
    act('[data-act="collapse"]', () => {
      applyCategoryChanges(below.map(b => ({ id: b.id, category: name })), `Merged the sub-categories into “${name}”.`);
    });
    act('[data-act="leaf-self"]', () => {
      const to = catLeaf(name);
      leaveCategoryView(name, to);
      applyCategoryChanges(members.map(b => ({ id: b.id, category: to + b.category.slice(name.length) })), `Renamed “${name}” to “${to}”.`);
    });
    menu.querySelector('[data-act="uncat"]').onclick = () => {
      hideMenu();
      leaveCategoryView(name, null);
      applyToIds(members.map(b => b.id), { category: null }, `Removed category “${name}” from ${plural(members.length)}.`);
    };
    menu.querySelector('[data-act="delete"]').onclick = () => {
      hideMenu();
      deleteBookmarks(members.map(b => b.id), `all ${plural(members.length)} in category “${name}”`);
    };
    return;
  }
  const el = e.target.closest('.nav-item[data-type="smart"]');
  if (!el) return;
  if (el.dataset.value === 'deleted') {
    e.preventDefault();
    const n = state.deleted.length;
    menu.innerHTML = `<button data-act="restore-all">Restore all ${n}</button>`;
    place();
    menu.querySelector('[data-act="restore-all"]').onclick = () => {
      hideMenu();
      if (confirm(`Restore all ${n} deleted bookmarks to the library?`)) restoreBookmarks(state.deleted.map(d => d.id));
    };
    return;
  }
  if (!DELETABLE_VIEWS.has(el.dataset.value)) return;
  e.preventDefault();
  const view = SMART.find(s => s.id === el.dataset.value);
  const targets = state.items.filter(view.test);
  menu.innerHTML = `<button class="danger" data-act="delete-all">Delete all ${targets.length} in “${esc(view.name)}”</button>`;
  place();
  menu.querySelector('[data-act="delete-all"]').onclick = () => {
    hideMenu();
    deleteBookmarks(targets.map(b => b.id), `all ${targets.length} bookmarks in “${view.name}”`);
  };
});
document.addEventListener('click', (e) => { if (!e.target.closest('#ctxmenu')) hideMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
window.addEventListener('blur', hideMenu);

$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const id = +li.dataset.id;
  // Checkbox, Ctrl+click or Shift+click change the multi-selection; a plain click opens the details.
  if (e.target.classList.contains('pick') || e.ctrlKey || e.metaKey || e.shiftKey) {
    if (e.shiftKey) e.preventDefault();
    toggleCheck(id, e.shiftKey);
    getSelection()?.removeAllRanges();
    return;
  }
  state.anchor = id;
  state.selectedId = id;
  for (const x of $('#list').querySelectorAll('li.selected')) x.classList.remove('selected');
  li.classList.add('selected');
  renderDetail();
});
$('#list').addEventListener('dblclick', (e) => {
  const li = e.target.closest('li');
  if (e.target.classList.contains('pick') || e.ctrlKey || e.shiftKey) return;
  const b = li && state.items.find(x => x.id === +li.dataset.id);
  if (b) window.api.open(b.url);
});

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.visible[0]) window.api.open(state.visible[0].url);
  if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderList(); }
});
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey && (e.key === 'k' || e.key === 'f')) || (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
    return;
  }
  // Selection shortcuts, only when not typing in a field or using a dialog.
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.classList.contains('pick-all');
  if (typing || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey && e.key === 'a') {
    e.preventDefault();
    state.visible.forEach(b => state.checked.add(b.id));
    syncChecks();
  } else if (e.key === 'Delete' && state.checked.size && !isDeletedView()) {
    $('#sel-delete').click();
  } else if (e.key === 'Escape' && state.checked.size) {
    clearChecks();
  }
});

reload();

// ---------- resizable library pane ----------

(function sidebarResizer() {
  const KEY = 'sidebarWidth', DEFAULT = 240, MIN = 170;
  const handle = $('#sidebar-resizer');
  const max = () => Math.max(MIN, Math.min(560, Math.round(window.innerWidth * 0.5)));
  const clamp = (w) => Math.max(MIN, Math.min(max(), Math.round(w)));
  const current = () => $('#sidebar').getBoundingClientRect().width;
  const apply = (w) => {
    const v = clamp(w);
    document.documentElement.style.setProperty('--sidebar-w', `${v}px`);
    handle.setAttribute('aria-valuenow', v);
    return v;
  };
  const save = (w) => { try { localStorage.setItem(KEY, String(w)); } catch {} };
  let saved = null;
  try { saved = Number(localStorage.getItem(KEY)) || null; } catch {}
  if (saved) apply(saved);

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startW = current();
    try { handle.setPointerCapture(e.pointerId); } catch {}
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const move = (ev) => apply(startW + ev.clientX - startX);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      save(Math.round(current()));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
  handle.addEventListener('dblclick', () => { save(apply(DEFAULT)); });
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === 'ArrowLeft') save(apply(current() - step));
    else if (e.key === 'ArrowRight') save(apply(current() + step));
    else return;
    e.preventDefault();
  });
  // Keep it within bounds when the window gets smaller.
  window.addEventListener('resize', () => { if (current() > max()) apply(max()); });
})();
