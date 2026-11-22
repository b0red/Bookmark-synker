// The start page: one HTML file with your bookmarks by category, to use as the browser's home page.
// Everything is inside the file (no scripts or images from the web), and only http(s) links are listed.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHOWN = 8; // links per card before "Show all"

function host(b) {
  if (b.domain) return b.domain;
  try { return new URL(b.url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function hue(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % 360;
}
// Most used first, then recently opened, then by title.
function byUse(a, b) {
  return (b.favorite || 0) - (a.favorite || 0) || (b.visit_count || 0) - (a.visit_count || 0) ||
    (b.opened_at || 0) - (a.opened_at || 0) || String(a.title || a.url).localeCompare(String(b.title || b.url));
}

function linkItem(b) {
  const d = host(b);
  const title = b.title || d || b.url;
  const letter = (d || title || '?').charAt(0).toUpperCase();
  return `<li><a href="${esc(b.url)}" title="${esc(b.url)}"><span class="ic" style="background:hsl(${hue(d)} 45% 42%)">${esc(letter)}</span>` +
    `<span class="tx"><span class="ti">${esc(title)}</span><span class="dm">${esc(d)}</span></span></a></li>`;
}

function card(name, items, { t, open = true, extra = '' } = {}) {
  const top = items.slice(0, SHOWN), rest = items.slice(SHOWN);
  const more = rest.length
    ? `<details class="more"><summary>${esc(t('Show all {n}', { n: items.length }))}</summary><ul>${rest.map(linkItem).join('')}</ul></details>` : '';
  const body = `<ul>${top.map(linkItem).join('')}</ul>${more}`;
  return open
    ? `<section class="card${extra}"><h2>${esc(name)} <span class="n">${items.length}</span></h2>${body}</section>`
    : `<section class="card${extra}"><details class="all"><summary><h2>${esc(name)} <span class="n">${items.length}</span></h2></summary>${body}</details></section>`;
}

// bookmarks: the library's list. t: translate. lang: 'en' or 'sv'. updated: a date text for the footer.
function buildStartPage(bookmarks, { t = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s), lang = 'en', updated = '' } = {}) {
  const live = bookmarks.filter(b => /^https?:\/\//i.test(b.url || '') && b.status !== 'dead');
  const favorites = live.filter(b => b.favorite).sort(byUse);
  const later = live.filter(b => b.read_later).sort((a, b) => (b.read_later || 0) - (a.read_later || 0));
  const groups = new Map();
  const none = [];
  for (const b of live) {
    if (!b.category) { none.push(b); continue; }
    if (!groups.has(b.category)) groups.set(b.category, []);
    groups.get(b.category).push(b);
  }
  const cards = [];
  if (favorites.length) cards.push(card(t('Favorites'), favorites, { t, extra: ' fav' }));
  if (later.length) cards.push(card(t('Read later'), later, { t }));
  for (const name of [...groups.keys()].sort((a, b) => a.localeCompare(b, lang))) cards.push(card(name, groups.get(name).sort(byUse), { t }));
  if (none.length) cards.push(card(t('Uncategorized'), none.sort(byUse), { t, open: false }));

  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${esc(t('Bookmarks'))}</title>
<style>
:root { --bg: #f6f4ef; --card: #fffdf8; --text: #23262b; --muted: #6b7078; --line: #e4dfd4; --accent: #00a3cc; --hover: #eef6f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #17191d; --card: #1f2227; --text: #e6e7ea; --muted: #9aa0a8; --line: #2e3238; --accent: #3cc3e6; --hover: #262b31; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 "Segoe UI", system-ui, sans-serif; }
header { max-width: 1400px; margin: 0 auto; padding: 28px 20px 12px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
h1 { margin: 0; font-size: 20px; font-weight: 600; }
h1 b { color: var(--accent); }
#q { flex: 1; min-width: 220px; max-width: 560px; padding: 10px 14px; font: inherit; font-size: 15px; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 10px; outline: none; }
#q:focus { border-color: var(--accent); }
main { max-width: 1400px; margin: 0 auto; padding: 8px 20px 24px; columns: 290px; column-gap: 16px; }
.card { break-inside: avoid; margin: 0 0 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 10px 8px; }
.card.fav h2 { color: var(--accent); }
h2 { margin: 0 6px 6px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; display: inline-block; }
h2 .n { color: var(--muted); font-weight: 400; margin-left: 4px; }
ul { list-style: none; margin: 0; padding: 0; }
a { display: flex; gap: 10px; align-items: center; padding: 5px 6px; border-radius: 8px; color: inherit; text-decoration: none; }
a:hover, a:focus { background: var(--hover); outline: none; }
.ic { flex: none; width: 24px; height: 24px; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 600; display: grid; place-items: center; }
.tx { min-width: 0; display: flex; flex-direction: column; }
.ti, .dm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm { color: var(--muted); font-size: 12px; }
summary { cursor: pointer; color: var(--muted); font-size: 12px; padding: 4px 6px; list-style: none; }
summary::-webkit-details-marker { display: none; }
details.all > summary { color: inherit; padding: 0; }
.hide { display: none !important; }
#empty { max-width: 1400px; margin: 0 auto; padding: 0 20px; color: var(--muted); }
footer { max-width: 1400px; margin: 0 auto; padding: 0 20px 28px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>${esc(t('Bookmarks'))}</h1>
  <input id="q" type="search" autofocus autocomplete="off" placeholder="${esc(t('Search your bookmarks'))}" aria-label="${esc(t('Search your bookmarks'))}">
</header>
<p id="empty" class="hide">${esc(t('No bookmarks match.'))}</p>
<main>
${cards.join('\n')}
</main>
<footer>${esc(t('Made by Bookmark syncer, which keeps it up to date.'))}${updated ? ' ' + esc(t('Updated {when}.', { when: updated })) : ''}</footer>
<script>
(() => {
  const q = document.getElementById('q');
  const cards = [...document.querySelectorAll('.card')];
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  for (const li of document.querySelectorAll('li')) li.dataset.k = fold(li.textContent + ' ' + li.querySelector('a').href);
  const opened = new Map([...document.querySelectorAll('details')].map(d => [d, d.open]));
  function filter() {
    const words = fold(q.value).split(/\\s+/).filter(Boolean);
    let any = false;
    for (const c of cards) {
      let hits = 0;
      for (const li of c.querySelectorAll('li')) {
        const ok = words.every(w => li.dataset.k.includes(w));
        li.classList.toggle('hide', !ok);
        if (ok) hits++;
      }
      c.classList.toggle('hide', !hits);
      for (const d of c.querySelectorAll('details')) d.open = words.length ? true : opened.get(d);
      for (const s of c.querySelectorAll('details.more > summary')) s.classList.toggle('hide', !!words.length);
      if (hits) any = true;
    }
    document.getElementById('empty').classList.toggle('hide', any || !words.length);
  }
  q.addEventListener('input', filter);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = document.querySelector('.card:not(.hide) li:not(.hide) a'); if (a) location.href = a.href; }
    if (e.key === 'Escape') { q.value = ''; filter(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
})();
</script>
</body>
</html>
`;
}

module.exports = { buildStartPage };
