// Bookmark syncer helper: the logic, kept free of browser UI so it can be tested in Node.
// `bm` is an object with the chrome.bookmarks functions we need (getTree, remove, create, get).

(function (root) {
  const norm = (typeof module !== 'undefined' && module.exports)
    ? require('./normalize.js').normalizeUrl
    : root.BMNormalize.normalizeUrl;

  // Flattens the bookmark tree into URL bookmarks with their folder path.
  function flatten(tree) {
    const out = [];
    const walk = (node, trail) => {
      for (const c of node.children || []) {
        if (c.url) out.push({ id: c.id, parentId: c.parentId, index: c.index, url: c.url, title: c.title || '', folder: trail.join(' / '), unmodifiable: !!c.unmodifiable });
        else walk(c, c.title ? [...trail, c.title] : trail);
      }
    };
    for (const r of tree) walk(r, []);
    return out;
  }

  // Bookmarks in this browser whose URL was deleted in the app.
  function findMatches(tree, deletedNorms) {
    const set = deletedNorms instanceof Set ? deletedNorms : new Set(deletedNorms);
    return flatten(tree).filter(b => !b.unmodifiable && /^https?:/i.test(b.url) && set.has(norm(b.url)));
  }

  // Removes the matches. Returns { removed: [...backup entries], failed: [...] }.
  // The backup keeps enough to put each bookmark back where it was.
  async function removeMatches(bm, matches) {
    const removed = [], failed = [];
    // Highest index first, so earlier siblings keep their positions for Undo.
    const order = [...matches].sort((a, b) => (a.parentId === b.parentId ? b.index - a.index : String(a.parentId).localeCompare(String(b.parentId))));
    for (const m of order) {
      try {
        await bm.remove(m.id);
        removed.push({ parentId: m.parentId, index: m.index, title: m.title, url: m.url, folder: m.folder });
      } catch (e) {
        failed.push({ url: m.url, error: String((e && e.message) || e) });
      }
    }
    return { removed, failed };
  }

  // Puts removed bookmarks back. Missing folders fall back to `fallbackParentId` ("Other bookmarks").
  async function restore(bm, backup, fallbackParentId) {
    let restored = 0;
    // Lowest index first, so each one lands at its original position.
    const order = [...backup].sort((a, b) => (a.parentId === b.parentId ? a.index - b.index : String(a.parentId).localeCompare(String(b.parentId))));
    for (const b of order) {
      let parentId = b.parentId;
      try { await bm.get(parentId); } catch { parentId = fallbackParentId; }
      try {
        await bm.create({ parentId, index: parentId === b.parentId ? b.index : undefined, title: b.title, url: b.url });
        restored++;
      } catch {
        try { await bm.create({ parentId: fallbackParentId, title: b.title, url: b.url }); restored++; } catch {}
      }
    }
    return restored;
  }

  // "Other bookmarks" / "Other favorites": the second top-level folder in every Chromium browser.
  function otherFolderId(tree) {
    const top = (tree[0] && tree[0].children) || [];
    return (top[1] || top[0] || {}).id;
  }

  const api = { flatten, findMatches, removeMatches, restore, otherFolderId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
