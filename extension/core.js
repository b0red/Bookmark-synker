// Bookmark syncer helper: the logic, kept free of browser UI so it can be tested in Node.
// `bm` is an object with the chrome.bookmarks functions we need (getTree, get, getChildren, remove, create, move).

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

  // Where Undo puts a bookmark whose folder is gone: "Other Bookmarks" in Firefox ("unfiled_____"),
  // otherwise "Other bookmarks" / "Other favorites", the second top-level folder in Chromium browsers.
  function otherFolderId(tree) {
    const top = (tree[0] && tree[0].children) || [];
    const ff = top.find(c => c.id === 'unfiled_____');
    return (ff || top[1] || top[0] || {}).id;
  }

  // ---------- Sort into folders by category ----------
  // Bookmarks go into "Other bookmarks / Bookmark syncer / <category> / <sub-category>".
  // Only bookmarks are moved; nothing is deleted, and Undo moves each one back to where it was.
  const ROOT_FOLDER = 'Bookmark syncer';
  const CAT_SEP = ' / ';
  const folderPath = (category) => [ROOT_FOLDER, ...String(category).split(CAT_SEP).map(s => s.trim()).filter(Boolean)];

  // Finds an existing folder by path under `parent` (a tree node), or null.
  function findFolder(parent, names) {
    let node = parent;
    for (const name of names) {
      node = node && (node.children || []).find(c => !c.url && c.title === name);
      if (!node) return null;
    }
    return node;
  }

  const findNode = (tree, id) => {
    const stack = [...tree];
    while (stack.length) {
      const n = stack.pop();
      if (n.id === id) return n;
      if (n.children) stack.push(...n.children);
    }
    return null;
  };

  // catByNorm: Map (or object) normalized URL -> category. Returns the moves, grouped by folder.
  function planOrganize(tree, catByNorm) {
    const cats = catByNorm instanceof Map ? catByNorm : new Map(Object.entries(catByNorm || {}));
    const other = findNode(tree, otherFolderId(tree));
    const moves = [];
    for (const b of flatten(tree)) {
      if (b.unmodifiable || !/^https?:/i.test(b.url)) continue;
      const category = cats.get(norm(b.url));
      if (!category) continue;
      const names = folderPath(category);
      const existing = other && findFolder(other, names);
      if (existing && existing.id === b.parentId) continue; // already there
      moves.push({ id: b.id, title: b.title, url: b.url, parentId: b.parentId, index: b.index, from: b.folder, category, folder: names.join(CAT_SEP) });
    }
    // Alphabetical inside each folder makes the result tidy.
    moves.sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title));
    return moves;
  }

  // Per folder: how many bookmarks go there (for the preview).
  function summarizePlan(moves) {
    const by = new Map();
    for (const m of moves) by.set(m.folder, (by.get(m.folder) || 0) + 1);
    return [...by.entries()].map(([folder, count]) => ({ folder, count }));
  }

  // Moves the bookmarks. Returns undo data: { moves: [{ id, parentId, index }], createdFolders: [ids] }.
  async function applyOrganize(bm, tree, moves) {
    const otherId = otherFolderId(tree);
    const other = findNode(tree, otherId);
    const folders = new Map(); // path -> id
    const createdFolders = [];
    async function ensure(names) {
      const key = names.join(CAT_SEP);
      if (folders.has(key)) return folders.get(key);
      const existing = other && findFolder(other, names);
      let id;
      if (existing) id = existing.id;
      else {
        const parentId = names.length === 1 ? otherId : await ensure(names.slice(0, -1));
        const made = await bm.create({ parentId, title: names[names.length - 1] });
        id = made.id;
        createdFolders.push(id);
      }
      folders.set(key, id);
      return id;
    }
    const done = [], failed = [];
    for (const m of moves) {
      try {
        const parentId = await ensure(m.folder.split(CAT_SEP));
        await bm.move(m.id, { parentId });
        done.push({ id: m.id, parentId: m.parentId, index: m.index });
      } catch (e) {
        failed.push({ url: m.url, error: String((e && e.message) || e) });
      }
    }
    return { moves: done, createdFolders, failed };
  }

  // Moves everything back, then removes the folders it created if they are empty.
  async function undoOrganize(bm, undo, fallbackParentId) {
    let moved = 0;
    // Lowest index first per folder, so each one lands at its original position.
    const order = [...undo.moves].sort((a, b) => (a.parentId === b.parentId ? a.index - b.index : String(a.parentId).localeCompare(String(b.parentId))));
    for (const m of order) {
      let parentId = m.parentId;
      try { await bm.get(parentId); } catch { parentId = fallbackParentId; }
      try {
        await bm.move(m.id, parentId === m.parentId ? { parentId, index: m.index } : { parentId });
        moved++;
      } catch { /* deleted in the meantime */ }
    }
    for (const id of [...(undo.createdFolders || [])].reverse()) {
      try {
        const kids = await bm.getChildren(id);
        if (!kids.length) await bm.remove(id);
      } catch {}
    }
    return moved;
  }

  const api = { flatten, findMatches, removeMatches, restore, otherFolderId, planOrganize, summarizePlan, applyOrganize, undoOrganize, ROOT_FOLDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
