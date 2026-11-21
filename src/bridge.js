// Local bridge for the "Bookmark syncer helper" browser extension.
//
// While the app is open it listens on 127.0.0.1 only, and tells the extension which URLs were
// deleted in the library. The extension deletes them through the browser's own bookmarks API, so
// Chrome/Edge sync treats it like a normal delete and keeps it deleted.
//
// Safety:
// - bound to 127.0.0.1, so other computers can't reach it
// - every request needs the pairing code shown in the app
// - the Host header must be 127.0.0.1/localhost (blocks DNS-rebinding tricks from web pages)
// - only extension origins are accepted; web pages get no CORS access
// - it reveals the list of deleted (normalized) URLs and the categories, accepts a short report back,
//   and, for the page open in the browser, shows and saves its library entry (category, tags, notes)

const http = require('http');
const crypto = require('crypto');

const PORT = 47615;
const MAX_BODY = 1024 * 1024;

// Every header the extension sends must be listed here: Firefox checks this (CORS), Chrome doesn't.
const ALLOWED_HEADERS = 'Content-Type, X-Bookmark-Syncer-Token, X-Bookmark-Syncer-Browser';

function isExtensionOrigin(origin) {
  return /^(chrome|moz|edge)-extension:\/\/[a-z0-9-]+$/i.test(origin || '');
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function newToken() {
  // Grouped so it is easy to read and paste: xxxx-xxxx-xxxx-xxxx
  return crypto.randomBytes(8).toString('hex').match(/.{4}/g).join('-');
}

// A web page address from the extension (http/https only, sensible length), or null.
function cleanPageUrl(u) {
  if (typeof u !== 'string' || u.length > 4096) return null;
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? u : null; } catch { return null; }
}

// A "This page" save from the extension, limited to plain values of sensible size, or null.
function cleanPage(b) {
  if (!b || typeof b !== 'object') return null;
  const url = cleanPageUrl(b.url);
  if (!url) return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  return {
    url,
    title: str(b.title, 1000),
    category: str(b.category, 200),
    notes: str(b.notes, 20000),
    tags: Array.isArray(b.tags) ? b.tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 60)).filter(Boolean).slice(0, 50) : undefined,
    readLater: typeof b.readLater === 'boolean' ? b.readLater : undefined,
  };
}

// getToken(): current pairing code; getDeletedNorms(): string[]; onReport(report, origin);
// getPage(url) / savePage(page, browser) / getVocabulary(): the popup's "This page"; onChange(): after a save.
// appVersion: shown to the extension. Returns { status(), close() }.
function startBridge({ port = PORT, getToken, getDeletedNorms, getCategories = () => [], onReport, appVersion,
  getPage = () => null, savePage = () => { throw new Error('not available'); }, getVocabulary = () => ({ categories: [], tags: [] }), onChange }) {
  const contacts = new Map(); // extension origin -> { browser, at }
  let listening = false, error = null;

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const send = (code, body) => {
      const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      if (isExtensionOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = ALLOWED_HEADERS;
        headers['Access-Control-Max-Age'] = '600';
        headers['Access-Control-Allow-Methods'] = 'GET, POST';
      }
      res.writeHead(code, headers);
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(403, { error: 'bad host' });
    if (origin && !isExtensionOrigin(origin)) return send(403, { error: 'not allowed' });
    if (req.method === 'OPTIONS') return send(204);
    if (!sameToken(req.headers['x-bookmark-syncer-token'], getToken())) return send(401, { error: 'wrong pairing code' });

    const browser = String(req.headers['x-bookmark-syncer-browser'] || 'Browser').slice(0, 60);
    contacts.set(origin || 'local', { browser, at: Date.now() });

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/v1/hello') {
      return send(200, { app: 'Bookmark syncer', version: appVersion, deleted: getDeletedNorms().length });
    }
    if (req.method === 'GET' && url.pathname === '/v1/deleted') {
      return send(200, { norms: getDeletedNorms() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/categories') {
      return send(200, { items: getCategories() });
    }
    // Reads a JSON body (at most MAX_BODY), then calls fn(body).
    const readJson = (fn) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { send(413, { error: 'too large' }); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'bad json' }); }
        fn(body);
      });
    };

    // "This page" in the extension popup: what the library knows about the open tab, and saving it.
    if (req.method === 'GET' && url.pathname === '/v1/page') {
      const pageUrl = cleanPageUrl(url.searchParams.get('url'));
      if (!pageUrl) return send(400, { error: 'bad url' });
      try { return send(200, { bookmark: getPage(pageUrl), ...getVocabulary() }); } catch (e) { return send(500, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/v1/page') {
      return readJson((b) => {
        const page = cleanPage(b);
        if (!page) return send(400, { error: 'bad page' });
        try {
          const r = savePage(page, browser);
          try { onChange && onChange({ browser, added: r.added }); } catch {}
          send(200, { ok: true, added: r.added, bookmark: getPage(page.url) });
        } catch (e) { send(500, { error: e.message }); }
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/report') {
      return readJson((report) => {
        const clean = {
          browser,
          removed: Math.max(0, Number(report.removed) || 0),
          failed: Math.max(0, Number(report.failed) || 0),
          undone: !!report.undone,
          organized: Math.max(0, Number(report.organized) || 0),
          unorganized: !!report.unorganized,
        };
        try { onReport && onReport(clean); } catch {}
        send(200, { ok: true });
      });
    }
    send(404, { error: 'not found' });
  });

  server.on('error', (e) => { error = e.code === 'EADDRINUSE' ? `Port ${port} is already in use (is the app open twice?)` : e.message; });
  server.listen(port, '127.0.0.1', () => { listening = true; });

  return {
    port,
    status: () => ({
      listening, error, port,
      contacts: [...contacts.values()].sort((a, b) => b.at - a.at),
    }),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

module.exports = { startBridge, newToken, PORT, ALLOWED_HEADERS };
