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
function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- filtering ----------

function matchesView(b) {
  const v = state.view;
  if (v.type === 'smart') return SMART.find(s => s.id === v.value).test(b);
  if (v.type === 'category') return (b.category || '') === v.value;
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

function computeVisible() {
  const terms = parseQuery(state.query);
  state.visible = state.items.filter(b => matchesView(b) && matchesQuery(b, terms)).sort(SORTS[state.sort]);
}

// ---------- rendering ----------

function navItem(type, value, name, n) {
  const active = state.view.type === type && state.view.value === value ? ' active' : '';
  return `<div class="nav-item${active}" data-type="${type}" data-value="${esc(value)}"><span class="name">${esc(name)}</span><span class="n">${n}</span></div>`;
}

function renderSidebar() {
  const items = state.items;
  let html = '<h3>Library</h3>';
  for (const s of SMART) {
    const n = items.filter(s.test).length;
    if (n || ['all', 'favorites', 'uncategorized'].includes(s.id)) html += navItem('smart', s.id, s.name, n);
  }
  const cats = countBy(items, b => b.category).sort((a, b) => a[0].localeCompare(b[0]));
  if (cats.length) {
    html += '<h3>Categories</h3>';
    for (const [c, n] of cats) html += navItem('category', c, c, n);
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
      <div class="meta">${b.category ? `<span class="chip cat">${esc(b.category)}</span>` : ''}${status}</div>
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

function renderDetail() {
  const el = $('#detail');
  const b = state.items.find(x => x.id === state.selectedId);
  if (!b) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
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
  $('#d-remove').onclick = async () => {
    if (!confirm(`Remove "${b.title || b.url}" from the library?\n\nYour browsers' bookmarks are not touched.`)) return;
    await window.api.remove([b.id]);
    state.selectedId = null;
    await reload();
  };
  $('#d-title').onchange = (e) => save({ title: e.target.value });
  $('#d-cat').onchange = (e) => save({ category: e.target.value.trim() || null });
  $('#d-tags').onchange = (e) => save({ tags: e.target.value.split(',') });
  $('#d-notes').onchange = (e) => save({ notes: e.target.value });
}

function renderAll() { renderSidebar(); renderList(); renderDetail(); }

async function reload() {
  state.items = await window.api.list();
  renderAll();
}

// ---------- progress ----------

function showProgress(label, done, total) {
  const p = $('#progress');
  p.classList.remove('hidden');
  p.querySelector('.bar').style.width = total ? `${(100 * done) / total}%` : '0';
  p.querySelector('.label').textContent = `${label} ${done} / ${total}`;
}
function hideProgress() { $('#progress').classList.add('hidden'); }

window.api.onProgress(async (p) => {
  showProgress(p.kind === 'categorize' ? 'Categorizing…' : 'Checking links…', p.done, p.total);
  await reload();
});

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
      if (p.running) notes.push(`<span class="warn-text">${esc(p.browser)} is running. Close it completely first (also check the system tray).</span>`);
      if (p.synced) notes.push(`<span class="warn-text">This profile syncs with your ${p.browser === 'Firefox' ? 'Firefox' : esc(p.browser)} account. ${p.browser === 'Firefox'
        ? 'Firefox Sync should pass the deletions on to your other devices.'
        : 'The sync server may put deleted bookmarks back. Click “Check again” after reopening the browser to see if any returned.'}</span>`);
      if (p.error) notes.push(`<span class="err">${esc(p.error)}</span>`);
      const preview = p.matches.slice(0, 8).map(m => `<div class="p">• ${esc(m.title || m.url)} <span class="muted">${esc(m.folder)}</span></div>`).join('') +
        (n > 8 ? `<div class="p">… and ${n - 8} more</div>` : '');
      const idx = plan.indexOf(p);
      return `<label class="sync-src"><input type="checkbox" data-i="${idx}" ${n && !p.running && !p.error ? 'checked' : ''} ${n && !p.error ? '' : 'disabled'}>
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
  showProgress(`Categorizing with ${engine}…`, 0, ids.length);
  try {
    const r = await window.api.categorize(ids);
    if (r.error) toast(r.error, 10000); else toast(`Categorized ${r.count} bookmarks.`);
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
  showProgress('Checking links…', 0, ids.length);
  try {
    const r = await window.api.checkLinks(ids);
    if (r.error) toast(r.error);
    else {
      await reload();
      const checked = state.items.filter(b => ids.includes(b.id));
      const dead = checked.filter(b => b.status === 'dead').length;
      const warn = checked.filter(b => b.status === 'warn').length;
      toast(`Done: ${dead} dead, ${warn} with problems. See “Dead links” in the sidebar.`, 7000);
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
  await window.api.remove(ids);
  if (ids.includes(state.selectedId)) state.selectedId = null;
  for (const id of ids) state.checked.delete(id);
  await reload();
  toast(`Deleted ${ids.length} bookmark${ids.length === 1 ? '' : 's'}.`);
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

// Right-click on a cleanup view (e.g. "Dead links") offers to delete everything in it.
const DELETABLE_VIEWS = new Set(['stale', 'dead', 'warn']);

function hideMenu() { $('#ctxmenu').classList.add('hidden'); }

$('#sidebar').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.nav-item[data-type="smart"]');
  if (!el || !DELETABLE_VIEWS.has(el.dataset.value)) return;
  e.preventDefault();
  const view = SMART.find(s => s.id === el.dataset.value);
  const targets = state.items.filter(view.test);
  const menu = $('#ctxmenu');
  menu.innerHTML = `<button class="danger" data-act="delete-all">Delete all ${targets.length} in “${esc(view.name)}”</button>`;
  menu.style.left = Math.min(e.clientX, innerWidth - 240) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - 60) + 'px';
  menu.classList.remove('hidden');
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
  } else if (e.key === 'Delete' && state.checked.size) {
    $('#sel-delete').click();
  } else if (e.key === 'Escape' && state.checked.size) {
    clearChecks();
  }
});

reload();
