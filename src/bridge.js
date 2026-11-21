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
// - it only ever reveals the list of deleted (normalized) URLs, and accepts a short report back

const http = require('http');
const crypto = require('crypto');

const PORT = 47615;
const MAX_BODY = 1024 * 1024;

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

// getToken(): current pairing code; getDeletedNorms(): string[]; onReport(report, origin);
// appVersion: shown to the extension. Returns { status(), close() }.
function startBridge({ port = PORT, getToken, getDeletedNorms, getCategories = () => [], onReport, appVersion }) {
  const contacts = new Map(); // extension origin -> { browser, at }
  let listening = false, error = null;

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const send = (code, body) => {
      const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      if (isExtensionOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Bookmark-Syncer-Token';
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
    if (req.method === 'POST' && url.pathname === '/v1/report') {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { send(413, { error: 'too large' }); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let report;
        try { report = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'bad json' }); }
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
      return;
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

module.exports = { startBridge, newToken, PORT };
