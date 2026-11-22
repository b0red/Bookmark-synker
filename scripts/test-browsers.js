// Tests detection of the extra browsers (Comet, Zen, Floorp, Waterfox) in a made-up AppData folder.
// Bookmark files are COPIES of this PC's Firefox and Chrome/Edge files; the real ones are only read.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const REAL_LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const REAL_ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

// A real places.sqlite and a real Chromium Bookmarks file to copy, if this PC has them.
function firstFile(candidates) { return candidates.find(f => { try { return fs.statSync(f).size > 0; } catch { return false; } }); }
const ffProfiles = path.join(REAL_ROAMING, 'Mozilla', 'Firefox', 'Profiles');
const realPlaces = firstFile((fs.existsSync(ffProfiles) ? fs.readdirSync(ffProfiles) : []).map(p => path.join(ffProfiles, p, 'places.sqlite')));
const realBookmarks = firstFile([
  path.join(REAL_LOCAL, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'),
  path.join(REAL_LOCAL, 'Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks'),
]);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-browsers-test-'));
const LOCAL = path.join(root, 'Local'), ROAMING = path.join(root, 'Roaming');
const put = (file, from) => { fs.mkdirSync(path.dirname(file), { recursive: true }); from ? fs.copyFileSync(from, file) : fs.writeFileSync(file, ''); };

// Fake Chromium bookmarks if this PC has none to copy.
const fakeBookmarks = path.join(root, 'Bookmarks');
fs.writeFileSync(fakeBookmarks, JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Example', url: 'https://example.com/' }], name: 'Bookmarks bar', type: 'folder' }, other: { children: [], type: 'folder' }, synced: { children: [], type: 'folder' } }, version: 1 }));

put(path.join(LOCAL, 'Perplexity', 'Comet', 'User Data', 'Default', 'Bookmarks'), realBookmarks || fakeBookmarks);
fs.writeFileSync(path.join(LOCAL, 'Perplexity', 'Comet', 'User Data', 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Me' } } } }));
if (realPlaces) {
  put(path.join(ROAMING, 'zen', 'Profiles', 'ab12.Default (release)', 'places.sqlite'), realPlaces);
  put(path.join(ROAMING, 'Floorp', 'Profiles', 'cd34.default-release', 'places.sqlite'), realPlaces);
}
put(path.join(ROAMING, 'Waterfox', 'Profiles', 'ef56.unused', 'places.sqlite')); // empty: an unused profile, must be skipped

process.env.LOCALAPPDATA = LOCAL;
process.env.APPDATA = ROAMING;
const { detectSources, parseChromium, parseFirefox } = require('../src/importers');

(async () => {
  const SQL = await require('sql.js')();
  try {
    const found = detectSources();
    const labels = found.map(s => s.label).sort();
    const expected = ['Comet · Me (Default)', ...(realPlaces ? ['Floorp · default-release', 'Zen · Default (release)'] : [])].sort();
    assert.deepStrictEqual(labels, expected, 'only the installed browsers are listed');
    for (const s of found) {
      const items = s.type === 'firefox' ? parseFirefox(s.path, SQL) : parseChromium(s.path);
      assert.ok(items.length > 0, `${s.label}: bookmarks read`);
      console.log(`  ${s.label}: ${items.length} bookmarks`);
    }
    assert.ok(!labels.some(l => l.startsWith('Waterfox')), 'an empty Waterfox profile is not listed');
    assert.ok(!labels.some(l => /^(Chrome|Edge|Firefox|Brave|Vivaldi|Opera)/.test(l)), 'browsers that are not in this AppData are not listed');
    // DuckDuckGo: only the export hint, and only when it's installed.
    const { detectExportOnly } = require('../src/importers');
    assert.deepStrictEqual(detectExportOnly(), [], 'no DuckDuckGo hint when it is not installed');
    fs.mkdirSync(path.join(LOCAL, 'Packages', 'DuckDuckGo.DesktopBrowser_ya2fgkz3nks94'), { recursive: true });
    assert.deepStrictEqual(detectExportOnly(), [{ browser: 'DuckDuckGo' }], 'DuckDuckGo hint when it is installed');
    if (!realPlaces) console.log('  (no Firefox profile on this PC to copy: Zen and Floorp skipped)');
    console.log('extra browsers: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); fs.rmSync(root, { recursive: true, force: true }); process.exit(1); });
