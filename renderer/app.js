'use strict';

const $ = (sel) => document.querySelector(sel);
const DAY = 86400000;

// Unexpected errors: logged to crash.log and shown briefly, instead of failing silently.
(function catchErrors() {
  let last = 0;
  const report = (where, err) => {
    const msg = (err && (err.message || err.reason?.message)) || String(err);
    window.api.logError(where, (err && err.stack) || msg);
    if (Date.now() - last < 5000) return; // don't flood
    last = Date.now();
    const el = document.getElementById('toast');
    if (el) { el.textContent = t('Something went wrong: {msg}. Details are in crash.log in the data folder.', { msg }); el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 8000); }
  };
  window.addEventListener('error', (e) => report('error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report('promise', e.reason));
})();

// Files dropped on the window are ignored (the window only shows the app).
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });

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
  { id: 'later', name: 'Read later', test: b => !!b.read_later },
  { id: 'uncategorized', name: 'Uncategorized', test: b => !b.category },
  { id: 'never', name: 'No visit history', test: b => !b.last_used_at && !b.visit_count },
  { id: 'stale', name: 'Not opened in a year', test: b => b.last_used_at && b.last_used_at < Date.now() - 365 * DAY },
  { id: 'multi', name: 'Saved in several browsers', test: b => new Set(b.sources.map(s => s.source)).size > 1 },
  { id: 'dups', name: 'Possible duplicates', test: b => !!b.dup },
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
  return ms ? new Date(ms).toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
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
  // Duplicates: keep each group together.
  if (state.view.type === 'smart' && state.view.value === 'dups') state.visible.sort((a, b) => a.dup.localeCompare(b.dup, undefined, { numeric: true }));
}

// ---------- rendering ----------

function navItem(type, value, name, n) {
  const active = state.view.type === type && state.view.value === value ? ' active' : '';
  const shown = type === 'smart' ? t(name) : name; // smart view names are translated; categories etc. are your own
  return `<div class="nav-item${active}" data-type="${type}" data-value="${esc(value)}"><span class="name">${esc(shown)}</span><span class="n">${n}</span></div>`;
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
    const caret = kids ? `<span class="caret" data-toggle="${esc(n.path)}" title="${open ? t('Collapse') : t('Expand')}">${open ? '▾' : '▸'}</span>` : '<span class="caret"></span>';
    html += `<div class="nav-item cat-node${active}" data-type="category" data-value="${esc(n.path)}" style="--depth:${depth}" title="${esc(n.path)}">${caret}<span class="name">${esc(n.name)}</span><span class="n">${n.total}</span></div>`;
    if (open) html += renderCatNodes(n.children, depth + 1);
  }
  return html;
}

function renderSidebar() {
  const items = state.items;
  let html = `<h3>${t('Library')}</h3>`;
  for (const s of SMART) {
    const n = s.id === 'deleted' ? state.deleted.length : items.filter(s.test).length;
    if (n || ['all', 'favorites', 'later', 'uncategorized'].includes(s.id)) html += navItem('smart', s.id, s.name, n);
  }
  const tree = categoryTree(items);
  if (tree.length) {
    html += `<h3>${t('Categories')}</h3>`;
    html += renderCatNodes(tree, 0);
  }
  const srcs = countBy(items, b => [...new Set(b.sources.map(s => s.source))]).sort((a, b) => b[1] - a[1]);
  if (srcs.length) {
    html += `<h3>${t('Sources')}</h3>`;
    for (const [s, n] of srcs) html += navItem('source', s, s, n);
  }
  const tags = countBy(items, b => b.tags).sort((a, b) => b[1] - a[1]).slice(0, 40);
  if (tags.length) {
    html += `<h3>${t('Top tags')}</h3><div class="tagcloud">`;
    for (const [tag, n] of tags.sort((a, b) => a[0].localeCompare(b[0]))) {
      const active = state.view.type === 'tag' && state.view.value === tag ? ' cat' : '';
      html += `<span class="chip${active}" data-type="tag" data-value="${esc(tag)}" title="${n}">${esc(tag)}</span>`;
    }
    html += '</div>';
  }
  $('#sidebar').innerHTML = html;
}

function viewName() {
  const v = state.view;
  if (v.type === 'smart') return t(SMART.find(s => s.id === v.value).name);
  if (v.type === 'tag') return t('Tag: {tag}', { tag: v.value });
  return v.value;
}

function favicon(b) {
  const letter = esc((b.domain || b.title || '?')[0].toUpperCase());
  const bg = `hsl(${hue(b.domain || '?')} 55% 45%)`;
  const img = b.domain ? `<img loading="lazy" src="https://${esc(b.domain)}/favicon.ico" alt="">` : '';
  return `<span class="fav" style="background:${bg}">${img || letter}</span>`;
}

// Translated once (used in every row).
const STATUS_TEXT = { ok: t('Working link'), dead: t('Dead link'), warn: t('Problem') };
const SELECT_TEXT = t('Select');
const LATER_CHIP = t('later');

function renderList() {
  computeVisible();
  $('#view-title').textContent = viewName();
  $('#sort').classList.toggle('hidden', isDeletedView()); // deleted view is always newest first
  $('#view-count').textContent = plural(state.visible.length);
  $('#empty').classList.toggle('hidden', state.items.length > 0);

  // Only what's visible can stay selected, so "Delete selected" never hits hidden rows.
  const visibleIds = new Set(state.visible.map(b => b.id));
  for (const id of state.checked) if (!visibleIds.has(id)) state.checked.delete(id);

  const dupView = state.view.type === 'smart' && state.view.value === 'dups';
  let lastGroup = null, alt = false;
  const html = state.visible.slice(0, 3000).map(b => {
    let grp = '';
    if (dupView) { if (b.dup !== lastGroup) { alt = !alt; grp = ' grp-start'; lastGroup = b.dup; } grp += alt ? ' grp-alt' : ''; }
    const status = b.status === 'dead' || b.status === 'warn' || b.status === 'ok'
      ? `<span class="dot ${b.status}" title="${STATUS_TEXT[b.status]}${b.status_code ? ' ' + b.status_code : ''}"></span>` : '';
    const on = state.checked.has(b.id);
    return `<li data-id="${b.id}"${b.deleted ? "" : " draggable=\"true\""} class="${b.id === state.selectedId ? 'selected' : ''}${on ? ' checked' : ''}${grp}">
      <input type="checkbox" class="pick" tabindex="-1" ${on ? 'checked' : ''} title="${SELECT_TEXT}">
      ${favicon(b)}
      <div class="main-col"><div class="t">${b.favorite ? '<span class="star">★</span> ' : ''}${esc(b.title || b.url)}</div>
      <div class="u">${dupView ? esc(b.url) : esc(b.domain) + (b.folder ? ' · ' + esc(b.folder) : '')}</div></div>
      <div class="meta">${b.deleted ? `<span class="muted small">${t('deleted {date}', { date: fmtDate(b.removed_at) })}</span>` : ""}${b.read_later && !b.deleted ? `<span class="chip later${openedSinceQueued(b) ? ' opened' : ''}" title="${t(openedSinceQueued(b) ? 'In Read later since {date} (opened)' : 'In Read later since {date}', { date: fmtDate(b.read_later) })}">${LATER_CHIP}</span>` : ''}${b.category ? `<span class="chip cat">${esc(b.category)}</span>` : ''}${b.deleted ? "" : status}</div>
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
    <button class="close icon" id="d-close" title="${t('Close')}">✕</button>
    <h3 class="d-title">${esc(b.title || b.url)}</h3>
    <div class="url"><a href="#" id="d-url">${esc(b.url)}</a></div>
    <div class="btns">
      <button class="primary" id="d-restore">${t('Restore')}</button>
      <button id="d-open">${t('Open')}</button>
    </div>
    <div class="facts">
      <span>${t('Deleted')}</span><b>${fmtDate(b.removed_at)}</b>
      <span>${t('Category')}</span><b>${esc(b.category || '—')}</b>
      <span>${t('Tags')}</span><b>${esc(b.tags.join(', ') || '—')}</b>
      <span>${t('Saved in')}</span><b>${[...new Set(b.sources.map(s => s.source))].map(esc).join('<br>') || '—'}</b>
    </div>
    ${b.hasSnapshot ? '' : `<p class="muted small">${t('Deleted before details were saved. Restoring brings back the link; import again to fill in the title and folders.')}</p>`}`;
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
  const statusText = t({ ok: 'Working', dead: 'Dead', warn: 'Problem', skipped: 'Not a web link' }[b.status] || 'Not checked');
  el.innerHTML = `
    <button class="close icon" id="d-close" title="${t('Close')}">✕</button>
    <label>${t('Title')}</label><input id="d-title" value="${esc(b.title)}">
    <div class="url"><a href="#" id="d-url">${esc(b.url)}</a></div>
    <div class="btns">
      <button class="primary" id="d-open">${t('Open')}</button>
      <button id="d-fav">${b.favorite ? t('★ Unfavorite') : t('☆ Favorite')}</button>
      <button id="d-later" title="${b.read_later ? t('Take it out of Read later') : t('Put it in Read later')}">${b.read_later ? t('✓ Done reading') : t('Read later')}</button>
      ${b.status === 'dead' || b.status === 'warn' ? '<button id="d-wayback">Wayback Machine</button>' : ''}
      <button class="danger" id="d-remove">${t('Remove')}</button>
    </div>
    <label>${t('Category')}</label><input id="d-cat" list="cat-list" value="${esc(b.category || '')}" placeholder="${t('Uncategorized')}">
    <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <label>${t('Tags (comma separated)')}</label><input id="d-tags" value="${esc(b.tags.join(', '))}">
    <label>${t('Notes')}</label><textarea id="d-notes" placeholder="${t('Why did you save this?')}">${esc(b.notes)}</textarea>
    <div class="facts">
      <span>${t('Added')}</span><b>${fmtDate(b.added_at)}</b>
      <span>${t('Last opened')}</span><b>${fmtDate(Math.max(b.last_used_at || 0, b.opened_at || 0) || null)}${b.visit_count ? ' · ' + tn(b.visit_count, '1 visit', '{n} visits') : ''}</b>
      ${b.read_later ? `<span>${t('Read later')}</span><b>${t(openedSinceQueued(b) ? 'since {date} · opened' : 'since {date} · not opened yet', { date: fmtDate(b.read_later) })}</b>` : ''}
      <span>${t('Link')}</span><b>${statusText}${b.status_code ? ` (${b.status_code})` : ''}${b.checked_at ? ` · ${fmtDate(b.checked_at)}` : ''}</b>
      <span>${t('Saved in')}</span><b>${browsers.map(esc).join('<br>')}</b>
      <span>${t('Folders')}</span><b>${[...new Set(b.sources.map(s => s.folder).filter(Boolean))].map(esc).join('<br>') || '—'}</b>
      ${b.aliases.length ? `<span>${t('Also saved as')}</span><b class="aliases">${b.aliases.map(esc).join('<br>')}</b>` : ''}
    </div>
    ${dupSection(b)}`;
  wireDupSection(b);

  const save = async (patch) => { await window.api.update(b.id, patch); await reload(); };
  $('#d-close').onclick = () => { state.selectedId = null; renderList(); renderDetail(); };
  $('#d-open').onclick = $('#d-url').onclick = (e) => { e.preventDefault(); openBookmark(b); };
  $('#d-fav').onclick = () => save({ favorite: b.favorite ? 0 : 1 });
  $('#d-later').onclick = () => toggleReadLater([b.id], !b.read_later);
  if ($('#d-wayback')) $('#d-wayback').onclick = () => window.api.open('https://web.archive.org/web/2/' + b.url);
  $('#d-remove').onclick = () => deleteBookmarks([b.id], `“${b.title || b.url}”`);
  $('#d-title').onchange = (e) => save({ title: e.target.value });
  $('#d-cat').onchange = (e) => save({ category: e.target.value.trim() || null });
  $('#d-tags').onchange = (e) => save({ tags: e.target.value.split(',') });
  $('#d-notes').onchange = (e) => save({ notes: e.target.value });
}

// ---------- near-duplicates ----------

const dupMembers = (b) => (b.dup ? state.items.filter(x => x.dup === b.dup) : []);

function dupSection(b) {
  const others = dupMembers(b).filter(x => x.id !== b.id);
  if (!others.length) return '';
  return `<div class="dup-box">
    <div class="dup-head">${t('Possibly the same page ({n}):', { n: others.length })}</div>
    ${others.map(o => `<div class="dup-other" data-id="${o.id}" title="${t('Show it')}">
      <div>${esc(o.title || o.url)}</div><div class="muted small">${esc(o.url)}</div></div>`).join('')}
    <div class="btns">
      <button class="primary" id="d-dup-keep" title="${t("The others' browsers, folders, tags and notes move to this one. Nothing is deleted in your browsers.")}">${t('Keep this one, merge the others')}</button>
      <button id="d-dup-no">${t('Not duplicates')}</button>
    </div>
  </div>`;
}

function wireDupSection(b) {
  if (!$('#d-dup-keep')) return;
  for (const el of document.querySelectorAll('.dup-other')) {
    el.onclick = () => { state.selectedId = +el.dataset.id; renderList(); renderDetail(); };
  }
  $('#d-dup-keep').onclick = async () => {
    const others = dupMembers(b).filter(x => x.id !== b.id);
    const tokens = await window.api.mergeDuplicates(b.id, others.map(o => o.id));
    await reload();
    toast(t('Merged {n} into one bookmark. The other URLs are kept as “Also saved as”.', { n: others.length + 1 }), 8000,
      { label: t('Undo'), fn: async () => { await window.api.unmergeDuplicates(tokens); await reload(); toast(t('Undone.')); } });
  };
  $('#d-dup-no').onclick = async () => {
    const sig = b.dup_signature;
    await window.api.dismissDuplicates(sig);
    await reload();
    toast(t('Marked as not duplicates.'), 6000,
      { label: t('Undo'), fn: async () => { await window.api.dismissDuplicates(sig, true); await reload(); } });
  };
}

async function mergeAllDuplicates() {
  const groups = new Set(state.items.filter(b => b.dup).map(b => b.dup)).size;
  if (!groups) return;
  if (!confirm(t("Merge all {n} groups of possible duplicates?\n\nIn each group the bookmark you use and organized most is kept; the others' browsers, folders, tags and notes move to it. Nothing is deleted in your browsers.\n\nTip: check the groups first; there's an Undo afterwards.", { n: groups }))) return;
  const tokens = await window.api.mergeAllDuplicates();
  await reload();
  toast(tn(tokens.length, 'Merged 1 group.', 'Merged {n} groups.'), 8000,
    { label: t('Undo'), fn: async () => { await window.api.unmergeDuplicates(tokens); await reload(); toast(t('Undone.')); } });
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
  if (kind && p.dataset.kind !== kind) { p.dataset.kind = kind; $('#progress-cancel').disabled = false; $('#progress-cancel').textContent = t('Cancel'); }
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
  showProgress(p.kind === 'categorize' ? t('Categorizing…') : t('Checking links…'), p.done, p.total, p.kind);
  await reload();
});

$('#progress-cancel').onclick = () => {
  const p = $('#progress');
  if (!p.dataset.kind) return;
  p.dataset.stopping = '1';
  $('#progress-cancel').disabled = true;
  p.querySelector('.label').textContent = t('Stopping…');
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
        <div><div>${esc(s.label)}${imported.has(s.label) ? ` <span class="muted small">${t('(imported before)')}</span>` : ''}</div><div class="p">${esc(s.path)}</div></div></label>`).join('')
    : `<p class="muted">${t('No browser profiles found. Use “Import a bookmarks.html file…” instead.')}</p>`;
  dlg.sources = sources;
  dlg.showModal();
}

function showImportResults(results) {
  $('#import-result').innerHTML = results.map(r => r.error
    ? `<div class="err">${esc(r.label)}: ${esc(r.error)}</div>`
    : `<div><b>${esc(r.label)}</b>: ${t('{found} found · <b>{added} new</b> · {merged} were already in the library (merged)', r)}` +
      (r.skipped ? ' · ' + t('{n} skipped because you deleted them earlier', { n: r.skipped }) : '') +
      (r.added + r.merged ? ` · <a href="#" data-source="${esc(r.label)}">${t('show them')}</a>` : '') + '</div>').join('') +
    (results.some(r => !r.error && r.found && !r.added)
      ? `<div class="muted small">${t('Nothing new usually means these bookmarks were already imported from another browser. They are merged, and this source is added to each one.')}</div>` : '');
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
  $('#sync-sources').innerHTML = `<p class="muted">${t('Looking through your browsers…')}</p>`;
  $('#sync-go').disabled = true;
  const plan = await window.api.browserSyncPlan();
  const dlg = $('#dlg-sync');
  dlg.plan = plan;
  const any = plan.some(p => p.matches.length);
  $('#sync-go').disabled = !any;
  if (!plan.length) { $('#sync-sources').innerHTML = `<p class="muted">${t('No browser profiles found.')}</p>`; return; }
  $('#sync-sources').innerHTML = (any ? '' : `<p class="muted">${t('Nothing to do: none of the bookmarks you deleted are left in your browsers.')}</p>`) +
    plan.filter(p => p.matches.length || p.error).map((p, i) => {
      const n = p.matches.length;
      const notes = [];
      // Synced Chromium profiles: deleting in the file can be undone by the sync server, so the extension is the way.
      const useExt = p.synced && p.type !== 'firefox'; // Firefox-based browsers (Zen, Floorp, Waterfox) pass deletions on through Firefox Sync
      if (useExt) notes.push(`<span class="warn-text">${t('This profile syncs with your {browser} account, so its sync server may put file deletions back. <b>Use the browser extension for this one</b> (works with {browser} open).', { browser: esc(p.browser) })}</span>`);
      else if (p.synced) notes.push(`<span class="muted">${t('Syncs with your Firefox account. Firefox Sync passes the deletions on to your other devices.')}</span>`);
      if (p.running && !useExt) notes.push(`<span class="warn-text">${t('{browser} is running. Close it completely first (also check the system tray).', { browser: esc(p.browser) })}</span>`);
      if (p.error) notes.push(`<span class="err">${esc(p.error)}</span>`);
      const preview = p.matches.slice(0, 8).map(m => `<div class="p">• ${esc(m.title || m.url)} <span class="muted">${esc(m.folder)}</span></div>`).join('') +
        (n > 8 ? `<div class="p">${t('… and {n} more', { n: n - 8 })}</div>` : '');
      const idx = plan.indexOf(p);
      return `<label class="sync-src"><input type="checkbox" data-i="${idx}" ${n && !p.running && !p.error && !useExt ? 'checked' : ''} ${n && !p.error ? '' : 'disabled'}>
        <div><div><b>${esc(p.label)}</b>: ${t('{n} to delete', { n })}</div>${notes.map(x => `<div class="p">${x}</div>`).join('')}${preview}</div></label>`;
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
  if (!confirm(t('Delete {total} bookmarks from:\n\n{list}\n\nA backup of each bookmark file is saved next to it first.', { total, list: chosen.map(p => `• ${p.label} (${p.matches.length})`).join('\n') }))) return;
  $('#sync-go').disabled = true;
  try {
    const results = await window.api.browserSyncApply(chosen.map(p => p.label));
    $('#sync-result').innerHTML = results.map(r => r.error
      ? `<div class="err">${esc(r.label)}: ${esc(r.error)}</div>`
      : `<div>${esc(r.label)}: <b>${t('{n} deleted', { n: r.removed })}</b>${r.backup ? ` · <a href="#" data-file="${esc(r.backup)}">${t('show backup')}</a>` : ''}</div>`).join('');
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

const fmtDateTime = (ms) => new Date(ms).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'medium' });

async function loadBackups() {
  const list = $('#backup-list');
  list.innerHTML = `<p class="muted">${t('Looking for backups…')}</p>`;
  const profiles = await window.api.browserBackups();
  if (!profiles.length) {
    list.innerHTML = `<p class="muted">${t('No backups yet. They are made each time <i>Sync to browsers</i> deletes something.')}</p>`;
    return;
  }
  list.innerHTML = profiles.map(p => `
    <div class="backup-profile">
      <div><b>${esc(p.label)}</b> <span class="muted">· ${t('now {n} bookmarks', { n: p.current ?? '?' })}</span></div>
      ${p.backups.map(b => {
        const diff = b.count != null && p.current != null ? b.count - p.current : null;
        const delta = diff ? ` <span class="muted">(${diff > 0 ? '+' : ''}${diff})</span>` : '';
        return `<div class="backup-row">
          <span>${esc(fmtDateTime(b.at))}</span>
          <span class="muted">${b.count == null ? t('unreadable') : plural(b.count) + delta}</span>
          <span class="spacer"></span>
          <button class="tiny" data-show="${esc(b.file)}">${t('Show file')}</button>
          <button class="tiny" data-label="${esc(p.label)}" data-file="${esc(b.file)}" data-when="${esc(fmtDateTime(b.at))}" data-count="${b.count ?? ''}" ${b.count == null ? 'disabled' : ''}>${t('Restore')}</button>
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
  if (!confirm(t("Restore the bookmarks of {label} from {when} ({count} bookmarks)?\n\nThe browser's current bookmark file is replaced. It's backed up first, so you can switch back.", { label, when, count }))) return;
  btn.disabled = true;
  const r = await window.api.browserRestore(label, file);
  $('#backup-result').innerHTML = r.error
    ? `<div class="err">${esc(label)}: ${esc(r.error)}</div>`
    : `<div>${esc(label)}: ${t('<b>restored {n} bookmarks</b> from {when}. Start the browser to see them.', { n: r.restored, when: esc(when) })}</div>`;
  await loadBackups();
});

// ---------- settings ----------

async function refreshKeyStatus() {
  const s = await window.api.keyStatus();
  $('#key-input').value = '';
  $('#key-status').textContent = s.saved ? t('A key is saved.') : s.env ? t('Using ANTHROPIC_API_KEY from your environment.') : t('No key saved yet.');
}

async function refreshOllamaStatus() {
  const model = $('#ollama-model').value.trim() || 'qwen2.5:3b';
  const el = $('#ollama-status');
  el.textContent = t('Checking Ollama…');
  const s = await window.api.ollamaStatus(model);
  if (!s.running) {
    el.innerHTML = t('Ollama is not running. Install it from <a href="https://ollama.com/download" target="_blank">ollama.com/download</a>, then run <code>ollama pull {model}</code> in a terminal.', { model: esc(model) });
  } else if (!s.hasModel) {
    el.innerHTML = t("Ollama is running, but the model isn't downloaded yet. In a terminal, run <code>ollama pull {model}</code>", { model: esc(model) }) +
      (s.models.length ? `<br>${t('Installed:')} ${s.models.map(esc).join(', ')}` : '');
  } else {
    el.textContent = t('Ready: Ollama is running and {model} is installed.', { model });
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
  $('#set-import-start').checked = !!s.importOnStart;
  $('#set-watch').checked = !!s.watchBrowsers;
  $('#set-nudge').checked = s.readLaterNudge !== false;
  refreshLibraryBackups();
  $('#set-autocheck').value = s.autoLinkCheck || 'off';
  $('#set-theme').value = s.theme || 'system';
  $('#set-lang').value = s.language || 'auto';
  showAutoCheckStatus(s);
  $('#set-hotkey-on').checked = !!s.hotkeyEnabled;
  $('#set-hotkey').value = s.hotkey || '';
  $('#set-tray').checked = !!s.closeToTray;
  $('#set-login').checked = !!s.startWithWindows;
  $('#login-row').hidden = !!s.storeApp; // the Store version uses a Windows startup task instead
  $('#login-store').hidden = !s.storeApp;
  showHotkeyStatus(s.hotkeyStatus);
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
$('#set-import-start').addEventListener('change', (e) => window.api.saveSettings({ importOnStart: e.target.checked }));
// ---------- global shortcut ----------

function showHotkeyStatus(st) {
  const el = $('#hotkey-status');
  if (!st) { el.textContent = ''; return; }
  el.classList.toggle('err', !st.ok);
  el.textContent = !st.ok ? st.error
    : st.active ? t('Opens the app with the search box ready. Click the keys above to change them.')
    : t('Off.');
}

// Turns a key press into an Electron shortcut like "Ctrl+Alt+B" (null while only modifiers are down).
function acceleratorFromEvent(e) {
  const code = e.code || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'", Home: 'Home', End: 'End', Insert: 'Insert',
    PageUp: 'PageUp', PageDown: 'PageDown' }[code] || null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  // A plain letter would fire while typing anywhere, so it needs Ctrl, Alt or the Windows key (F-keys are fine alone).
  if (!/^F\d+$/.test(key) && !mods.some(m => m !== 'Shift')) return null;
  return [...mods, key].join('+');
}

$('#set-hotkey').addEventListener('keydown', async (e) => {
  if (e.key === 'Tab') return;
  e.preventDefault();
  if (e.key === 'Escape') { e.target.blur(); return; }
  const acc = acceleratorFromEvent(e);
  if (!acc) return;
  e.target.value = acc;
  const s = await window.api.saveSettings({ hotkey: acc, hotkeyEnabled: true });
  $('#set-hotkey-on').checked = true;
  showHotkeyStatus(s.hotkeyStatus);
});
$('#set-hotkey-on').addEventListener('change', async (e) => showHotkeyStatus((await window.api.saveSettings({ hotkeyEnabled: e.target.checked })).hotkeyStatus));
$('#set-tray').addEventListener('change', (e) => window.api.saveSettings({ closeToTray: e.target.checked }));
$('#set-login').addEventListener('change', (e) => window.api.saveSettings({ startWithWindows: e.target.checked }));

window.api.onFocusSearch(() => {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('#search').focus();
  $('#search').select();
});

// ---------- library backups, export and import ----------

function backupName(b) {
  if (b.kind === 'daily') return `${fmtDate(Date.parse(b.date + 'T12:00:00'))} (${t('daily')})`;
  return `${fmtDateTime(b.at)} (${b.kind === 'before-import' ? t('before an import') : t('before a restore')})`;
}

async function refreshLibraryBackups() {
  const { backups } = await window.api.libraryBackups().catch(() => ({ backups: [] }));
  $('#backups-status').textContent = backups.length
    ? t('A copy of your library is saved every day (the last 14 are kept), and right before a restore or an import. Choose one to go back to:')
    : t('A copy of your library is saved every day; the first one is made shortly.');
  $('#backups-list').innerHTML = backups.map(b => `<option value="${esc(b.name)}">${esc(backupName(b))}</option>`).join('');
  $('#backups-list').classList.toggle('hidden', !backups.length);
  $('#backups-restore').classList.toggle('hidden', !backups.length);
}

$('#backups-open').onclick = () => window.api.openLibraryBackups();
$('#backups-restore').onclick = async () => {
  const name = $('#backups-list').value;
  if (!name) return;
  const r = await window.api.restoreLibraryBackup(name);
  if (r.cancelled) return;
  if (r.error) return toast(r.error, 8000);
  state.selectedId = null; state.checked.clear();
  $('#dlg-settings').close();
  await reload();
  toast(t('Restored your library from {from}: {count}. Your library from before is in the backups list, if you want it back.', { from: r.from, count: plural(r.count) }), 10000);
};
$('#lib-export').onclick = async () => {
  const r = await window.api.exportLibrary();
  if (r) toast(t('Exported {count} to {file}', { count: plural(r.count), file: r.file }), 8000);
};
$('#lib-import').onclick = async () => {
  const r = await window.api.importLibrary();
  if (!r || r.cancelled) return;
  if (r.error) return toast(r.error, 10000);
  $('#dlg-settings').close();
  await reload();
  toast(t('Imported the library file: {added} new, {merged} already here (merged)', r) +
    (r.skipped ? t(', {n} skipped because you deleted them here', { n: r.skipped }) : '') + '.', 10000);
};
$('#set-nudge').addEventListener('change', (e) => window.api.saveSettings({ readLaterNudge: e.target.checked }));

// ---------- automatic link checks ----------

function showAutoCheckStatus(s) {
  const on = s.autoLinkCheck && s.autoLinkCheck !== 'off';
  const last = s.lastAutoLinkCheck ? ' ' + t('Last automatic check: {date}.', { date: fmtDate(s.lastAutoLinkCheck) }) : '';
  $('#autocheck-status').textContent = on
    ? t('Every bookmark is checked in the background while the app is open (also in the tray), each site contacted once. New dead links are shown in the tray.') + last + (s.lastAutoLinkCheck ? '' : ' ' + t('The first check starts in about a minute.'))
    : t('Use Check links in the toolbar whenever you like.') + last;
}
$('#set-theme').addEventListener('change', (e) => window.api.saveSettings({ theme: e.target.value }));
// The window reloads in the new language (main does that after saving).
$('#set-lang').addEventListener('change', (e) => window.api.saveSettings({ language: e.target.value }));
$('#set-autocheck').addEventListener('change', async (e) => showAutoCheckStatus(await window.api.saveSettings({ autoLinkCheck: e.target.value })));

window.api.onAutoLinks(async (r) => {
  hideProgress();
  await reload();
  const show = () => { state.view = { type: 'smart', value: 'dead' }; state.checked.clear(); renderSidebar(); renderList(); };
  if (r.newDead) toast(tn(r.newDead, 'Automatic link check: 1 new dead link ({dead} in total).', 'Automatic link check: {n} new dead links ({dead} in total).', { dead: r.dead }), 10000, { label: t('Show'), fn: show });
});
// A page saved from the browser extension's popup.
window.api.onBridgePage(async (c) => {
  await reload();
  if (c.added) toast(t('Added a bookmark from {browser}.', { browser: c.browser }), 5000);
});

window.api.onShowView((value) => {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  if (!SMART.some(s => s.id === value)) return;
  state.view = { type: 'smart', value };
  state.checked.clear();
  renderSidebar(); renderList();
});
$('#set-watch').addEventListener('change', (e) => window.api.saveSettings({ watchBrowsers: e.target.checked }));

// New bookmarks found in a browser (automatic import).
window.api.onAutoImport(async (results) => {
  await reload();
  const n = results.reduce((a, r) => a + r.added, 0);
  const from = [...new Set(results.map(r => r.label.split(' · ')[0]))].join(', ');
  toast(t('Imported {count} you saved in {from}.', { count: plural(n), from }), 6000);
});
$('#key-save').onclick = async () => {
  const key = $('#key-input').value.trim();
  if (!key) return;
  try { await window.api.saveKey(key); toast(t('API key saved.')); refreshKeyStatus(); }
  catch (e) { toast(e.message); }
};
$('#key-clear').onclick = async () => { await window.api.saveKey(''); toast(t('API key removed.')); refreshKeyStatus(); };
$('#settings-close').onclick = () => $('#dlg-settings').close();

// ---------- toolbar ----------

$('#btn-import').onclick = openImport;
$('#btn-settings').onclick = openSettings;

$('#btn-categorize').onclick = async () => {
  const todo = state.visible.filter(b => !b.category);
  const ids = (todo.length ? todo : state.visible).map(b => b.id);
  if (!ids.length) return toast(t('Nothing to categorize in this view.'));
  const { categorizer } = await window.api.getSettings();
  const engine = t({ rules: 'the built-in rules', ollama: 'local AI (Ollama)', claude: 'Claude' }[categorizer]);
  const msg = t(todo.length ? 'Categorize {n} uncategorized bookmarks with {engine}?' : 'Categorize all {n} bookmarks in this view (they already have categories) with {engine}?', { n: ids.length, engine }) +
    '\n\n' + (categorizer === 'claude' ? t('Title, URL and folder name are sent to the Anthropic API.') : t('Everything stays on this PC.')) +
    '\n\n' + t('(Change this under ⚙ Settings.)');
  if (!confirm(msg)) return;
  $('#btn-categorize').disabled = true;
  showProgress(t('Categorizing with {engine}…', { engine }), 0, ids.length, 'categorize');
  try {
    const r = await window.api.categorize(ids);
    if (r.cancelled) toast(t('Stopped. {count} of {total} bookmarks were categorized and kept.', { count: r.count, total: ids.length }), 7000);
    else if (r.error) toast(r.error, 10000);
    else toast(tn(r.count, 'Categorized 1 bookmark.', 'Categorized {n} bookmarks.'));
    if (r.cpuFallback) setTimeout(() => toast(t('Ollama crashed on your graphics card, so it now runs on the CPU (slower). This is remembered; change it under ⚙ Settings.'), 10000), r.error || r.cancelled ? 10500 : 4000);
  } finally {
    $('#btn-categorize').disabled = false;
    hideProgress();
    await reload();
  }
};

$('#btn-check').onclick = async () => {
  const ids = state.visible.map(b => b.id);
  if (!ids.length) return;
  if (!confirm(tn(ids.length, 'Check 1 link? The site will be contacted once.', 'Check {n} links? Each site will be contacted once.'))) return;
  $('#btn-check').disabled = true;
  showProgress(t('Checking links…'), 0, ids.length, 'links');
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
        ? t('Stopped after {count} of {total} links. Results so far are kept: {dead} dead, {warn} with problems.', { count: r.count, total: ids.length, dead, warn })
        : t('Done: {dead} dead, {warn} with problems. See “Dead links” in the sidebar.', { dead, warn }), 7000);
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
  if (file) toast(t('Exported {count} to {file}', { count: plural(state.visible.length), file }), 6000);
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
  $('#sel-hint').textContent = t('Ctrl+click or Shift+click to select more') + (del ? '' : ' · ' + t('Del deletes'));
  $('#selbar').classList.toggle('hidden', n === 0);
  $('#list').classList.toggle('picking', n > 0);
  $('#sel-count').textContent = t('{n} selected', { n });
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
  if (!confirm(t('Delete {what} from the library?\n\nFuture imports will skip these links. To remove them from your browsers too, use “Sync to browsers”.', { what }))) return;
  const norms = new Set(state.items.filter(b => ids.includes(b.id)).map(b => b.norm));
  await window.api.remove(ids);
  if (ids.includes(state.selectedId)) state.selectedId = null;
  for (const id of ids) state.checked.delete(id);
  await reload();
  const undo = () => restoreBookmarks(state.deleted.filter(d => norms.has(d.norm)).map(d => d.id));
  toast(tn(ids.length, 'Deleted 1 bookmark.', 'Deleted {n} bookmarks.'), 8000, { label: t('Undo'), fn: undo });
}

async function restoreBookmarks(ids) {
  if (!ids.length) return;
  const n = await window.api.restore(ids);
  if (ids.includes(state.selectedId)) state.selectedId = null;
  for (const id of ids) state.checked.delete(id);
  await reload();
  toast(tn(n, 'Restored 1 bookmark. Future imports include it again.', 'Restored {n} bookmarks. Future imports include them again.'));
}

$('#pick-all').addEventListener('change', (e) => {
  if (e.target.checked) state.visible.forEach(b => state.checked.add(b.id)); else state.checked.clear();
  syncChecks();
});
$('#sel-clear').onclick = clearChecks;
$('#sel-delete').onclick = () => {
  const n = state.checked.size;
  deleteBookmarks([...state.checked], tn(n, '1 selected bookmark', '{n} selected bookmarks'));
};
$('#sel-restore').onclick = () => restoreBookmarks([...state.checked]);

// ---------- browser extension setup ----------

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) });
  return t('{n} h ago', { n: Math.round(s / 3600) });
}

async function refreshExtDialog() {
  const [info, ff] = await Promise.all([window.api.bridgeInfo(), window.api.bridgeFirefox()]);
  $('#ext-folder').textContent = info.folder;
  $('#ext-ff-file').textContent = ff.error ? t("Couldn't prepare the Firefox version: {error}", { error: ff.error }) : ff.folder + '\\manifest.json';
  $('#ext-ff-copy').disabled = !!ff.error;
  $('#ext-token').textContent = info.token;
  const seen = (info.contacts || []).map(c => `${esc(c.browser)} (${ago(c.at)})`).join(', ');
  $('#ext-status').innerHTML = info.error
    ? `<span class="err">${t("The connection for the extension isn't available: {error}", { error: esc(info.error) })}</span>`
    : info.listening
      ? `<span class="ok-text">● ${t('Ready for the extension')}</span> <span class="muted">${t('(only on this PC, while the app is open)')}</span>` +
        (seen ? `<br><span class="muted">${t('Last connected:')} ${seen}</span>` : '')
      : `<span class="muted">${t('Starting…')}</span>`;
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
  $('#ext-copy').textContent = t('Copied');
  setTimeout(() => { $('#ext-copy').textContent = t('Copy'); }, 1500);
};
$('#ext-new').onclick = async () => {
  if (!confirm(t('Make a new pairing code? Browsers using the old code will ask for the new one.'))) return;
  await window.api.bridgeNewToken();
  await refreshExtDialog();
};
$('#ext-ff-open').onclick = () => window.api.bridgeOpenFirefoxFolder();
$('#ext-ff-copy').onclick = async () => { await window.api.copyText($('#ext-ff-file').textContent); toast(t('Copied. Paste it into the File name box in Firefox.')); };
$('#ext-ff-howto').onclick = (e) => { e.preventDefault(); window.api.open(FIREFOX_SIGN_URL); };
for (const id of ['#ext-url-chrome', '#ext-url-edge', '#ext-url-firefox']) {
  $(id).title = t('Click to copy');
  $(id).style.cursor = 'pointer';
  $(id).onclick = async () => { await window.api.copyText($(id).textContent); toast(t("Copied {url}. Paste it in the browser's address bar.", { url: $(id).textContent })); };
}

// The extension reports back after it deletes (or undoes) in a browser.
window.api.onBridgeReport(async (r) => {
  if ($('#dlg-ext').open) refreshExtDialog();
  const browser = r.browser;
  if (r.unorganized) return toast(t('{browser}: the extension moved its bookmarks back out of the category folders.', { browser }), 7000);
  if (r.organized) return toast(t('{browser}: the extension sorted {count} into category folders.', { browser, count: plural(r.organized) }), 7000);
  if (r.undone) return toast(t('{browser}: the extension put its last deletions back.', { browser }), 7000);
  toast(t('{browser}: the extension deleted {count}', { browser, count: plural(r.removed) }) + (r.failed ? ' ' + t("({n} couldn't be deleted)", { n: r.failed }) : '') + '. ' + t('Browser sync takes it from here.'), 8000);
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
  $('#cat-title').textContent = t('Rename “{name}”', { name });
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
    ? t('“{target}” already exists ({count}). Both will be merged into it.', { target, count: plural(n) })
    : t("Type an existing category's name to merge into it.");
  $('#cat-ok').textContent = target ? t('Merge') : t('Rename');
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
  applyCategoryChanges(changes, t(merging ? 'Merged “{from}” into “{to}”.' : 'Renamed “{from}” to “{to}”.', { from, to }));
});

// ---------- info panel ----------

$('#btn-info').onclick = async () => {
  const info = await window.api.appInfo().catch(() => null);
  $('#info-version').textContent = info ? `v${info.version}` : '';
  $('#dlg-info').showModal();
  $('#dlg-info').scrollTop = 0; // focus lands on Close at the bottom; start at the top
};
$('#info-close').onclick = () => $('#dlg-info').close();
// The full guide lives in the GitHub README.
const README_URL = 'https://github.com/b0red/Bookmark-synker#readme';

// Donation links in the ? panel. The section stays hidden while this list is empty.
const SUPPORT_LINKS = [
  { label: '☕ Leave a tip on Ko-fi', url: 'https://ko-fi.com/patrickosterlund', primary: true },
];
(function supportLinks() {
  const box = $('#support .support-links');
  for (const l of SUPPORT_LINKS) {
    const b = document.createElement('button');
    b.className = 'support-link' + (l.primary ? ' primary' : '');
    b.textContent = t(l.label);
    b.title = l.url;
    b.onclick = () => window.api.open(l.url); // opens in your default browser
    box.append(b);
  }
  $('#support').classList.toggle('hidden', !SUPPORT_LINKS.length);
})();
const FIREFOX_SIGN_URL = 'https://github.com/b0red/Bookmark-synker/blob/main/docs/INSTALL.md#firefox-keep-it-installed';
$('#info-more').onclick = (e) => { e.preventDefault(); window.api.open(README_URL); };
const PRIVACY_URL = 'https://github.com/b0red/Bookmark-synker/blob/main/PRIVACY.md';
$('#info-privacy').onclick = (e) => { e.preventDefault(); window.api.open(PRIVACY_URL); };

// ---------- bulk actions on the selection ----------

const plural = (n) => tn(n, '1 bookmark', '{n} bookmarks');

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
  toast(message, 8000, { label: t('Undo'), fn: async () => { await window.api.setFields(before); await reload(); toast(t('Undone.')); } });
}

// ---------- Read later ----------
const openedSinceQueued = (b) => !!(b.read_later && b.opened_at && b.opened_at >= b.read_later);

// Opens a bookmark in the browser and remembers that (for Read later).
function openBookmark(b) {
  window.api.open(b.url);
  if (b.deleted) return;
  b.opened_at = Date.now();
  window.api.markOpened(b.id);
  if (b.read_later) { renderList(); if (state.selectedId === b.id) renderDetail(); }
}

function toggleReadLater(ids, on) {
  const n = plural(ids.length);
  return applyToIds(ids, { readLater: on }, t(on ? 'Added {count} to Read later.' : 'Took {count} out of Read later.', { count: n }));
}

// Once a week at most: a gentle reminder about the queue, or about recent bookmarks never opened.
async function readLaterNudge() {
  const s = await window.api.getSettings();
  if (s.readLaterNudge === false) return;
  const KEY = 'readLaterNudgeAt';
  let last = 0;
  try { last = +localStorage.getItem(KEY) || 0; } catch {}
  if (Date.now() - last < 7 * DAY) return;
  const show = (value) => () => { state.view = { type: 'smart', value }; state.checked.clear(); renderSidebar(); renderList(); };
  const waiting = state.items.filter(b => b.read_later && !openedSinceQueued(b));
  let shown = false;
  if (waiting.length) {
    const oldest = Math.min(...waiting.map(b => b.read_later));
    toast(t('Read later: {count} waiting, the oldest since {date}.', { count: plural(waiting.length), date: fmtDate(oldest) }), 10000, { label: t('Show'), fn: show('later') });
    shown = true;
  } else {
    // Saved in the last 3 months (but not this week) and never opened anywhere.
    const now = Date.now();
    const unopened = state.items.filter(b => {
      const at = b.added_at || b.imported_at;
      return at && at > now - 90 * DAY && at < now - 7 * DAY && !b.last_used_at && !b.visit_count && !b.opened_at && !b.read_later;
    });
    if (unopened.length >= 3) {
      toast(t('You saved {count} in the last 3 months and never opened them. Put some in Read later?', { count: plural(unopened.length) }), 10000, { label: t('Show'), fn: show('never') });
      shown = true;
    }
  }
  if (shown) try { localStorage.setItem(KEY, String(Date.now())); } catch {}
}

async function applyToIds(ids, patch, message) {
  if (!ids.length) return;
  const set = new Set(ids);
  const before = state.items.filter(b => set.has(b.id))
    .map(b => ({ id: b.id, category: b.category, favorite: b.favorite, tags: [...b.tags], read_later: b.read_later }));
  await window.api.bulkUpdate(ids, patch);
  await reload();
  toast(message, 8000, {
    label: t('Undo'),
    fn: async () => { await window.api.setFields(before); await reload(); toast(t('Undone.')); },
  });
}

function openBulk(mode) {
  const n = state.checked.size;
  if (!n) return;
  const sel = state.items.filter(b => state.checked.has(b.id));
  $('#bulk-cat-fields').classList.toggle('hidden', mode !== 'category');
  $('#bulk-tag-fields').classList.toggle('hidden', mode !== 'tags');
  $('#bulk-title').textContent = t(mode === 'category' ? 'Set category for {count}' : 'Tags for {count}', { count: plural(n) });
  const cats = [...new Set(state.items.map(b => b.category).filter(Boolean))].sort();
  $('#bulk-cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  // Suggest tags the selection already has first, then the rest.
  const selTags = [...new Set(sel.flatMap(b => b.tags))].sort();
  const allTags = [...new Set(state.items.flatMap(b => b.tags))].sort().filter(tag => !selTags.includes(tag));
  $('#bulk-tag-list').innerHTML = [...selTags, ...allTags].map(tag => `<option value="${esc(tag)}">`).join('');
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
$('#sel-fav').onclick = () => bulkApply({ favorite: 1 }, t('Marked {count} as favorites.', { count: plural(state.checked.size) }));
$('#sel-later').onclick = () => {
  const sel = state.items.filter(b => state.checked.has(b.id));
  toggleReadLater(sel.map(b => b.id), !sel.every(b => b.read_later));
};
$('#sel-unfav').onclick = () => bulkApply({ favorite: 0 }, t('Removed favorite from {count}.', { count: plural(state.checked.size) }));
$('#bulk-cancel').onclick = () => $('#dlg-bulk').close();
$('#bulk-form').addEventListener('submit', () => {
  const n = state.checked.size;
  if ($('#dlg-bulk').mode === 'category') {
    const cat = $('#bulk-cat').value.trim();
    bulkApply({ category: cat || null }, t(cat ? 'Moved {count} to “{cat}”.' : 'Made {count} uncategorized.', { count: plural(n), cat }));
  } else {
    const split = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
    const addTags = split($('#bulk-add').value), removeTags = split($('#bulk-remove').value);
    if (!addTags.length && !removeTags.length) return;
    const parts = [addTags.length && t('added {tags}', { tags: addTags.join(', ') }), removeTags.length && t('removed {tags}', { tags: removeTags.join(', ') })].filter(Boolean);
    bulkApply({ addTags, removeTags }, t('Tags on {count}: {changes}.', { count: plural(n), changes: parts.join('; ') }));
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
    const leaf = esc(catLeaf(name));
    menu.innerHTML = `<button data-act="rename">${t('Rename or merge…')}</button>
      ${hasSub ? `<button data-act="leaves" title="${t('For example “Speed Dials / Desktop / Recipes” becomes “Recipes”')}">${t('Keep only the sub-category names ({n})', { n: below.length })}</button>
      <button data-act="collapse">${t('Merge sub-categories into “{name}” ({n})', { name: leaf, n: below.length })}</button>` : ''}
      ${name.includes(CAT_SEP) ? `<button data-act="leaf-self" title="${t('Drops the parent part of the name')}">${t(hasSub ? 'Rename to just “{name}” (with its sub-categories)' : 'Rename to just “{name}”', { name: leaf })}</button>` : ''}
      <button data-act="uncat">${t('Remove category ({n} become uncategorized)', { n: members.length })}</button>
      <button class="danger" data-act="delete">${tn(members.length, 'Delete the 1 bookmark', 'Delete all {n} bookmarks')}</button>`;
    place();
    menu.querySelector('[data-act="rename"]').onclick = () => { hideMenu(); openCategoryRename(name); };
    const act = (sel, fn) => { const b = menu.querySelector(sel); if (b) b.onclick = () => { hideMenu(); fn(); }; };
    act('[data-act="leaves"]', () => {
      leaveCategoryView(name, null);
      applyCategoryChanges(below.map(b => ({ id: b.id, category: catLeaf(b.category) })),
        t('Kept only the sub-category names for {count}.', { count: plural(below.length) }));
    });
    act('[data-act="collapse"]', () => {
      applyCategoryChanges(below.map(b => ({ id: b.id, category: name })), t('Merged the sub-categories into “{name}”.', { name }));
    });
    act('[data-act="leaf-self"]', () => {
      const to = catLeaf(name);
      leaveCategoryView(name, to);
      applyCategoryChanges(members.map(b => ({ id: b.id, category: to + b.category.slice(name.length) })), t('Renamed “{from}” to “{to}”.', { from: name, to }));
    });
    menu.querySelector('[data-act="uncat"]').onclick = () => {
      hideMenu();
      leaveCategoryView(name, null);
      applyToIds(members.map(b => b.id), { category: null }, t('Removed category “{name}” from {count}.', { name, count: plural(members.length) }));
    };
    menu.querySelector('[data-act="delete"]').onclick = () => {
      hideMenu();
      deleteBookmarks(members.map(b => b.id), t('all {count} in category “{name}”', { count: plural(members.length), name }));
    };
    return;
  }
  const el = e.target.closest('.nav-item[data-type="smart"]');
  if (!el) return;
  if (el.dataset.value === 'dups') {
    e.preventDefault();
    const groups = new Set(state.items.filter(b => b.dup).map(b => b.dup)).size;
    menu.innerHTML = `<button data-act="merge-all">${t('Merge all {n} groups (keep the best of each)…', { n: groups })}</button>`;
    place();
    menu.querySelector('[data-act="merge-all"]').onclick = () => { hideMenu(); mergeAllDuplicates(); };
    return;
  }
  if (el.dataset.value === 'deleted') {
    e.preventDefault();
    const n = state.deleted.length;
    menu.innerHTML = `<button data-act="restore-all">${t('Restore all {n}', { n })}</button>`;
    place();
    menu.querySelector('[data-act="restore-all"]').onclick = () => {
      hideMenu();
      if (confirm(t('Restore all {n} deleted bookmarks to the library?', { n }))) restoreBookmarks(state.deleted.map(d => d.id));
    };
    return;
  }
  if (!DELETABLE_VIEWS.has(el.dataset.value)) return;
  e.preventDefault();
  const view = SMART.find(s => s.id === el.dataset.value);
  const targets = state.items.filter(view.test);
  const viewName = t(view.name);
  menu.innerHTML = `<button class="danger" data-act="delete-all">${t('Delete all {n} in “{view}”', { n: targets.length, view: esc(viewName) })}</button>`;
  place();
  menu.querySelector('[data-act="delete-all"]').onclick = () => {
    hideMenu();
    deleteBookmarks(targets.map(b => b.id), t('all {count} in “{view}”', { count: plural(targets.length), view: viewName }));
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
  if (b) openBookmark(b);
});

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.visible[0]) openBookmark(state.visible[0]);
  if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderList(); }
  // ↓ moves from the search box into the results.
  if (e.key === 'ArrowDown' && state.visible.length) { e.preventDefault(); e.stopPropagation(); $('#list').focus({ preventScroll: true }); moveCurrent(0, false); }
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
  } else if (e.key === 'Escape' && state.selectedId != null && !document.querySelector('#ctxmenu:not(.hidden)')) {
    state.selectedId = null; renderList(); renderDetail();
  } else {
    listKeys(e);
  }
});

// ---------- keyboard navigation in the list ----------
// ↑/↓ (or j/k), PgUp/PgDn, Home/End move through the list and show the details. Enter opens,
// Space ticks, Shift+↑/↓ ticks a range, Del deletes the current one when nothing is ticked.

const listRows = () => state.visible.slice(0, 3000); // what renderList shows

function moveCurrent(index, extend) {
  const rows = listRows();
  if (!rows.length) return;
  const from = rows.findIndex(b => b.id === state.selectedId);
  const j = Math.max(0, Math.min(rows.length - 1, index));
  const b = rows[j];
  if (extend) {
    if (state.anchor == null || !rows.some(r => r.id === state.anchor)) state.anchor = from === -1 ? b.id : rows[from].id;
    const a = rows.findIndex(r => r.id === state.anchor);
    for (let i = Math.min(a, j); i <= Math.max(a, j); i++) state.checked.add(rows[i].id);
    syncChecks();
  } else {
    state.anchor = b.id;
  }
  state.selectedId = b.id;
  for (const x of $('#list').querySelectorAll('li.selected')) x.classList.remove('selected');
  const li = $('#list').querySelector(`li[data-id="${b.id}"]`);
  if (li) { li.classList.add('selected'); li.scrollIntoView({ block: 'nearest' }); }
  renderDetail();
}

function listKeys(e) {
  const rows = listRows();
  if (!rows.length || e.ctrlKey || e.altKey || e.metaKey) return;
  const onButton = ['BUTTON', 'A'].includes(document.activeElement.tagName);
  const i = rows.findIndex(b => b.id === state.selectedId);
  const li = $('#list').querySelector('li');
  const page = Math.max(1, Math.floor($('#list').clientHeight / (li ? li.offsetHeight : 40)) - 1);
  const go = (to) => { e.preventDefault(); moveCurrent(to, e.shiftKey); };
  switch (e.key) {
    case 'ArrowDown': case 'j': return go(i === -1 ? 0 : i + 1);
    case 'ArrowUp': case 'k': return go(i === -1 ? 0 : i - 1);
    case 'PageDown': return go(i === -1 ? 0 : i + page);
    case 'PageUp': return go(i === -1 ? 0 : i - page);
    case 'Home': return go(0);
    case 'End': return go(rows.length - 1);
  }
  const cur = rows[i];
  if (!cur || onButton) return;
  if (e.key === 'Enter') { e.preventDefault(); openBookmark(cur); }
  else if (e.key === ' ') { e.preventDefault(); toggleCheck(cur.id, false); }
  else if (e.key === 'Delete' && !isDeletedView()) deleteBookmarks([cur.id], `“${cur.title || cur.url}”`);
}

reload().then(() => setTimeout(readLaterNudge, 4000));

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

// ---------- drag bookmarks onto a category ----------
// Drag a row (or the ticked rows) onto a category in the sidebar. "Uncategorized" clears the
// category and "Favorites" marks them as favorites.

(function dragToCategory() {
  const MIME = 'application/x-bookmark-ids';
  let dragIds = null, hoverTimer = null;

  $('#list').addEventListener('dragstart', (e) => {
    const li = e.target.closest('li[draggable]');
    if (!li) return;
    const id = +li.dataset.id;
    dragIds = state.checked.has(id) ? [...state.checked] : [id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(MIME, JSON.stringify(dragIds));
    // A small label instead of a picture of the whole row.
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = dragIds.length === 1 ? (state.items.find(b => b.id === id)?.title || plural(1)) : plural(dragIds.length);
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
    document.body.classList.add('dragging-bookmarks');
  });
  $('#list').addEventListener('dragend', () => {
    dragIds = null;
    document.body.classList.remove('dragging-bookmarks');
    clearTarget();
  });

  const targetOf = (e) => e.target.closest('.nav-item[data-type="category"], .nav-item[data-value="uncategorized"], .nav-item[data-value="favorites"], .nav-item[data-value="later"]');
  function clearTarget() {
    clearTimeout(hoverTimer);
    for (const el of document.querySelectorAll('.nav-item.drop-target')) el.classList.remove('drop-target');
  }

  $('#sidebar').addEventListener('dragover', (e) => {
    if (!dragIds) return;
    const el = targetOf(e);
    if (!el) { clearTarget(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (el.classList.contains('drop-target')) return;
    clearTarget();
    el.classList.add('drop-target');
    // Hovering over a closed parent opens it, so you can drop deeper.
    const caret = el.querySelector('[data-toggle]');
    if (caret && caret.textContent === '▸') {
      hoverTimer = setTimeout(() => { expanded.toggle(caret.dataset.toggle); renderSidebar(); }, 700);
    }
  });
  $('#sidebar').addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !$('#sidebar').contains(e.relatedTarget)) clearTarget();
  });
  $('#sidebar').addEventListener('drop', (e) => {
    const el = targetOf(e);
    clearTarget();
    if (!el || !dragIds) return;
    e.preventDefault();
    const ids = dragIds;
    const count = plural(ids.length);
    if (el.dataset.value === 'favorites') return applyToIds(ids, { favorite: 1 }, t('Marked {count} as favorites.', { count }));
    if (el.dataset.value === 'later') return toggleReadLater(ids, true);
    if (el.dataset.value === 'uncategorized') return applyToIds(ids, { category: null }, t('Made {count} uncategorized.', { count }));
    const cat = el.dataset.value;
    applyToIds(ids, { category: cat }, t('Moved {count} to “{cat}”.', { count, cat }));
  });
})();
