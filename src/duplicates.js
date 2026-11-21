// Finds bookmarks that are probably the same page saved under different URLs.
// Exact duplicates (same URL after clean-up) are already merged on import; this looks further:
// mobile / AMP versions, index pages, upper/lower case paths, youtu.be links, and identical long
// titles on the same site.

const { normalizeUrl } = require('./normalize');

// Query parameters that never change which page you get.
const NOISE_PARAM = /^(amp|outputtype|output|ref|referrer|source|src|from|via|share|feature|cmpid|ito|smid|sr_share|_ga|_gl)$/i;

function dupUrlKey(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = u.hostname.toLowerCase().replace(/^(www\d*|m|mobile|amp)\./, '');
  let path = decodeURIComponentSafe(u.pathname).toLowerCase()
    .replace(/\/(index|default|home)\.(html?|php|aspx?|jsp)$/, '/')
    .replace(/\/amp(\.html)?\/?$/, '/')
    .replace(/\.amp(\.html)?$/, '')
    .replace(/\/+$/, '');
  const params = [...u.searchParams.entries()].filter(([k]) => !NOISE_PARAM.test(k));
  // youtu.be/ID and youtube.com/watch?v=ID are the same video.
  if (host === 'youtu.be' && path.length > 1) {
    params.push(['v', u.pathname.slice(1)]);
    host = 'youtube.com';
    path = '/watch';
  }
  // Keep the normal clean-up rules (tracking parameters etc.) for what's left.
  const rest = new URLSearchParams(params.map(([k, v]) => [k.toLowerCase(), v]));
  const port = u.port && u.port !== '80' && u.port !== '443' ? ':' + u.port : '';
  const route = /^#[!/]/.test(u.hash) ? u.hash : ''; // app routes like #/settings are different pages
  return normalizeUrl(`https://${host}${port}${path || '/'}?${rest.toString()}${route}`).replace(/\?$/, '');
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function siteOf(raw) {
  try { return new URL(raw).hostname.toLowerCase().replace(/^(www\d*|m|mobile|amp)\./, ''); } catch { return ''; }
}

// Same page path and same title, only the query differs (session ids, cache busters like ?zx=…).
// The path must match too: many sites give different pages one generic title.
function titleKey(b) {
  const t = String(b.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 8) return null;
  let u;
  try { u = new URL(b.url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const path = u.pathname.toLowerCase().replace(/\/+$/, '');
  const route = /^#[!/]/.test(u.hash) ? u.hash : "";
  return `${siteOf(b.url)}${u.port ? ":" + u.port : ""}${path}${route}|${t}`;
}

// Group key of the set of URLs, so a "not duplicates" decision sticks to exactly this group.
const groupSignature = (norms) => [...norms].sort().join('\n');

// items: [{ id, url, norm, title }]. Returns Map(id -> { group, size }) for bookmarks in a group of 2+.
// `dismissed`: Set of group signatures the user marked as "not duplicates".
function findDuplicates(items, dismissed = new Set()) {
  const parent = new Map(items.map(b => [b.id, b.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const first = new Map();
  const link = (prefix, key, id) => {
    if (!key) return; // no usable URL or title: never grouped
    key = prefix + key;
    if (first.has(key)) union(first.get(key), id); else first.set(key, id);
  };
  for (const b of items) {
    link('u:', dupUrlKey(b.url), b.id);
    link('t:', titleKey(b), b.id);
  }
  const groups = new Map();
  for (const b of items) {
    const r = find(b.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(b);
  }
  const out = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sig = groupSignature(members.map(m => m.norm));
    if (dismissed.has(sig)) continue;
    const group = `g${Math.min(...members.map(m => m.id))}`;
    for (const m of members) out.set(m.id, { group, size: members.length, signature: sig });
  }
  return out;
}

// Which bookmark of a group to keep when merging automatically: the one you use and organized most.
function keepScore(b) {
  return (b.favorite ? 100 : 0) + (b.notes ? 20 : 0) + (b.category ? 10 : 0) + (b.tags?.length || 0) * 2 +
    new Set((b.sources || []).map(s => s.source)).size * 5 + Math.min(b.visit_count || 0, 50) +
    (/^https:/i.test(b.url) ? 3 : 0) - b.url.length / 1000;
}
const pickKeeper = (members) => [...members].sort((a, b) => keepScore(b) - keepScore(a))[0];

module.exports = { dupUrlKey, titleKey, findDuplicates, groupSignature, keepScore, pickKeeper };
