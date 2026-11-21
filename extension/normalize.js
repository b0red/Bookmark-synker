// URL clean-up used to detect the same bookmark saved in different browsers.
// Shared by the desktop app (Node) and the browser extension, so both match URLs the same way.

(function (root) {
  const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|yclid|si)$/i;

  function normalizeUrl(raw) {
    const s = String(raw || '').trim();
    let u;
    try { u = new URL(s); } catch { return s.toLowerCase(); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return s;

    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const port = u.port && u.port !== '80' && u.port !== '443' ? ':' + u.port : '';
    const path = u.pathname.replace(/\/+$/, '');
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
    // Keep the fragment only when it looks like an app route (#/ or #!), otherwise it's just an anchor.
    const hash = /^#[!/]/.test(u.hash) ? u.hash : '';
    return host + port + path + query + hash;
  }

  function domainOf(raw) {
    try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  }

  const api = { normalizeUrl, domainOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BMNormalize = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
