// Readers for browser bookmark stores. Every importer returns an array of:
// { url, title, folder, addedAt, lastUsedAt, visitCount, tags: [] }
// Times are JS milliseconds (or null).

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const CHROMIUM_BROWSERS = [
  { name: 'Chrome', dir: path.join(LOCAL, 'Google', 'Chrome', 'User Data') },
  { name: 'Edge', dir: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data') },
  { name: 'Brave', dir: path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { name: 'Vivaldi', dir: path.join(LOCAL, 'Vivaldi', 'User Data') },
  { name: 'Chromium', dir: path.join(LOCAL, 'Chromium', 'User Data') },
  { name: 'Comet', dir: path.join(LOCAL, 'Perplexity', 'Comet', 'User Data') },
  { name: 'Opera', dir: path.join(ROAMING, 'Opera Software'), flat: true },
];

// Firefox and the browsers built on it keep the same places.sqlite in <dir>Profiles<profile>.
const FIREFOX_BROWSERS = [
  { name: 'Firefox', dir: path.join(ROAMING, 'Mozilla', 'Firefox') },
  { name: 'Zen', dir: path.join(ROAMING, 'zen') },
  { name: 'Floorp', dir: path.join(ROAMING, 'Floorp') },
  { name: 'Waterfox', dir: path.join(ROAMING, 'Waterfox') },
];

// ---------- detection ----------
// Only browsers that are installed (their profile folder exists) are listed, so the others never show up.

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
}

function detectSources() {
  const found = [];

  const addChromium = (browser, userData) => {
    const localState = readJson(path.join(userData, 'Local State'));
    const names = (localState && localState.profile && localState.profile.info_cache) || {};
    // Profiles are subfolders (Default, Profile 1, ...). Older Opera keeps Bookmarks in the user-data folder itself.
    const candidates = [['', path.join(userData, 'Bookmarks')], ...listDirs(userData).map(p => [p, path.join(userData, p, 'Bookmarks')])];
    for (const [prof, file] of candidates) {
      if (!fs.existsSync(file)) continue;
      const pretty = prof ? (names[prof] && names[prof].name ? `${names[prof].name} (${prof})` : prof) : 'Default';
      found.push({ type: 'chromium', browser, profile: pretty, path: file, label: `${browser} · ${pretty}` });
    }
  };

  for (const b of CHROMIUM_BROWSERS) {
    if (!fs.existsSync(b.dir)) continue;
    if (b.flat) {
      // Opera: "Opera Software\Opera Stable", "Opera Software\Opera GX Stable", ...
      for (const sub of listDirs(b.dir)) addChromium(sub.replace(/\s+Stable$/i, ''), path.join(b.dir, sub));
    } else {
      addChromium(b.name, b.dir);
    }
  }

  for (const b of FIREFOX_BROWSERS) {
    const ffRoot = path.join(b.dir, 'Profiles');
    for (const prof of listDirs(ffRoot)) {
      const file = path.join(ffRoot, prof, 'places.sqlite');
      let size = 0;
      try { size = fs.statSync(file).size; } catch { continue; }
      if (size === 0) continue; // empty/unused profile
      const pretty = prof.includes('.') ? prof.slice(prof.indexOf('.') + 1) : prof;
      found.push({ type: 'firefox', browser: b.name, profile: pretty, path: file, label: `${b.name} · ${pretty}` });
    }
  }

  return found;
}

// Browsers whose bookmarks can't be read directly, only exported to a bookmarks.html file.
// DuckDuckGo for Windows keeps them in an encrypted database, whose key also protects its password vault, so the app doesn't open it.
function detectExportOnly() {
  const found = [];
  const pkgs = listDirs(path.join(LOCAL, 'Packages'));
  if (pkgs.some(p => /^DuckDuckGo.DesktopBrowser_/i.test(p))) found.push({ browser: 'DuckDuckGo' });
  return found;
}

// Bookmark exports (Netscape bookmarks.html format) saved in a folder in the last few days, newest first.
// Used to pick up a DuckDuckGo export from the Downloads folder without a file dialog. Only the top of each file is read.
function findBookmarkExports(dir, maxAgeDays = 7) {
  const since = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (!/\.html?$/i.test(name)) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile() || st.mtimeMs < since || st.size > 50 * 1024 * 1024) continue;
    let head = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(2048);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      head = buf.slice(0, n).toString('utf8');
    } catch { continue; }
    if (/NETSCAPE-Bookmark-file-1/i.test(head)) out.push({ path: file, name, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- Chromium (Chrome, Edge, Brave, ...) ----------

// Chromium stores microseconds since 1601-01-01.
function chromeTime(v) {
  if (!v || v === '0') return null;
  try {
    const ms = Number(BigInt(v) / 1000n - 11644473600000n);
    return ms > 0 ? ms : null;
  } catch { return null; }
}

const CHROMIUM_ROOT_NAMES = { bookmark_bar: 'Bookmarks bar', other: 'Other bookmarks', synced: 'Mobile bookmarks' };

function parseChromium(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const walk = (node, trail) => {
    if (!node) return;
    if (node.type === 'url') {
      out.push({
        url: node.url,
        title: node.name || '',
        folder: trail.join(' / '),
        addedAt: chromeTime(node.date_added),
        lastUsedAt: chromeTime(node.date_last_used),
        visitCount: null,
        tags: [],
      });
    } else if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c, [...trail, c.type === 'folder' ? c.name : null].filter(Boolean));
    }
  };
  for (const [key, root] of Object.entries(data.roots || {})) {
    if (!root || typeof root !== 'object' || !root.children) continue;
    walk(root, [CHROMIUM_ROOT_NAMES[key] || root.name || key]);
  }
  return out;
}

// ---------- Firefox ----------

const FF_ROOT_NAMES = {
  'menu________': 'Bookmarks Menu',
  'toolbar_____': 'Bookmarks Toolbar',
  'unfiled_____': 'Other Bookmarks',
  'mobile______': 'Mobile Bookmarks',
};

function readLockedFile(file) {
  // Firefox may hold the file open; copying first is the most reliable way to read it.
  const tmp = path.join(os.tmpdir(), `bmlib-${process.pid}-${Date.now()}.sqlite`);
  try {
    fs.copyFileSync(file, tmp);
    return fs.readFileSync(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function parseFirefox(file, SQL) {
  const db = new SQL.Database(readLockedFile(file));
  try {
    const res = db.exec(`
      SELECT b.id, b.parent, b.type, b.title, b.guid, b.dateAdded, p.url, p.last_visit_date, p.visit_count
      FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk`);
    const rows = res.length ? res[0].values : [];
    const byId = new Map();
    for (const [id, parent, type, title, guid, dateAdded, url, lastVisit, visits] of rows) {
      byId.set(id, { id, parent, type, title, guid, dateAdded, url, lastVisit, visits });
    }
    const tagsRoot = [...byId.values()].find(n => n.guid === 'tags________');

    const trailOf = (node) => {
      const parts = [];
      let cur = byId.get(node.parent);
      let guard = 0;
      while (cur && cur.parent !== 0 && guard++ < 100) {
        parts.unshift(FF_ROOT_NAMES[cur.guid] || cur.title || '');
        cur = byId.get(cur.parent);
      }
      return parts.filter(Boolean);
    };

    // Firefox tags are stored as bookmarks inside folders under the tags root.
    const tagsByUrl = new Map();
    if (tagsRoot) {
      for (const n of byId.values()) {
        if (n.type !== 1 || !n.url) continue;
        const tagFolder = byId.get(n.parent);
        if (tagFolder && tagFolder.parent === tagsRoot.id && tagFolder.title) {
          if (!tagsByUrl.has(n.url)) tagsByUrl.set(n.url, []);
          tagsByUrl.get(n.url).push(tagFolder.title.toLowerCase());
        }
      }
    }

    const out = [];
    for (const n of byId.values()) {
      if (n.type !== 1 || !n.url || n.url.startsWith('place:')) continue;
      const trail = trailOf(n);
      const parentNode = byId.get(n.parent);
      if (tagsRoot && parentNode && parentNode.parent === tagsRoot.id) continue; // a tag entry, not a bookmark
      out.push({
        url: n.url,
        title: n.title || '',
        folder: trail.join(' / '),
        addedAt: n.dateAdded ? Math.round(n.dateAdded / 1000) : null,
        lastUsedAt: n.lastVisit ? Math.round(n.lastVisit / 1000) : null,
        visitCount: n.visits ?? null,
        tags: tagsByUrl.get(n.url) || [],
      });
    }
    return out;
  } finally {
    db.close();
  }
}

// ---------- Netscape bookmarks.html (every browser can export this) ----------

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

function parseHtml(text) {
  const out = [];
  const stack = [];
  let pendingFolder = null;
  const re = /<h3([^>]*)>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0].slice(0, 3).toLowerCase();
    if (m[2] !== undefined) {
      pendingFolder = decodeEntities(m[2].replace(/<[^>]+>/g, '').trim());
    } else if (m[3] !== undefined) {
      const href = attr(m[3], 'href');
      if (!href || href.startsWith('place:') || href.startsWith('javascript:')) continue;
      const added = attr(m[3], 'add_date');
      const visited = attr(m[3], 'last_visit');
      const tags = attr(m[3], 'tags');
      out.push({
        url: href,
        title: decodeEntities(m[4].replace(/<[^>]+>/g, '').trim()),
        folder: stack.filter(Boolean).join(' / '),
        addedAt: added ? +added * 1000 : null,
        lastUsedAt: visited ? +visited * 1000 : null,
        visitCount: null,
        tags: tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [],
      });
    } else if (tag === '</d') {
      stack.pop();
    } else {
      stack.push(pendingFolder);
      pendingFolder = null;
    }
  }
  return out;
}

module.exports = { detectExportOnly, findBookmarkExports, detectSources, parseChromium, parseFirefox, parseHtml };
