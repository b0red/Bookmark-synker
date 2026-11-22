// Checks GitHub for a newer release of the app. It only tells you; it never downloads or installs anything.
// Not used in the Microsoft Store version: the Store updates that one itself.

const RELEASES_API = 'https://api.github.com/repos/b0red/Bookmark-synker/releases/latest';
const RELEASES_PAGE = 'https://github.com/b0red/Bookmark-synker/releases';

// "1.10.0" > "1.9.2". Ignores a leading "v" and anything after a "-" (pre-releases).
function parse(v) {
  return String(v || '').replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
}
function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Returns { version, url } of the newest release. The link always points at this project's releases on GitHub.
async function latestRelease(fetchFn = fetch) {
  const r = await fetchFn(RELEASES_API, {
    headers: { 'User-Agent': 'BookmarkSyncer', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  const version = String(j.tag_name || '').replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error('GitHub returned no version');
  const url = typeof j.html_url === 'string' && j.html_url.startsWith(RELEASES_PAGE + '/') ? j.html_url : RELEASES_PAGE;
  return { version, url };
}

module.exports = { isNewer, latestRelease, RELEASES_PAGE };
