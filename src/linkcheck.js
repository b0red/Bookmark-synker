// Dead link checker: asks each site whether the page still exists.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BookmarkSyncer/0.4';
const TIMEOUT_MS = 12000;
const CONCURRENCY = 8;

async function probe(url, method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (method === 'GET') res.body?.cancel().catch(() => {});
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

// ok: page loads; dead: gone (404/410 or the domain no longer exists); warn: blocked, server error, or timed out.
async function checkOne(url) {
  if (!/^https?:/i.test(url)) return { status: 'skipped', code: null };
  try {
    let code = await probe(url, 'HEAD');
    if (code === 405 || code === 403 || code === 501 || code === 400) code = await probe(url, 'GET');
    if (code < 400) return { status: 'ok', code };
    if (code === 404 || code === 410) return { status: 'dead', code };
    return { status: 'warn', code };
  } catch (e) {
    const cause = (e && e.cause && (e.cause.code || e.cause.message)) || '';
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(String(cause))) return { status: 'dead', code: null };
    return { status: 'warn', code: null };
  }
}

async function checkAll(items, onResult) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      const r = await checkOne(item.url);
      onResult(item.id, r);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

module.exports = { checkAll };
