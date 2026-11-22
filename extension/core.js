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

  // After sorting: removes the folders the bookmarks came from if they are now empty, and then their parent folders
  // if those became empty too. Never the browser's own top folders (Bookmarks bar, Other bookmarks, …), folders that
  // still hold anything, or folders the browser doesn't allow changing. Returns what Undo needs to recreate them,
  // in the order they were removed (innermost first).
  async function removeEmptyFolders(bm, tree, folderIds) {
    const roots = new Set([...(tree[0] ? [tree[0].id] : []), ...((tree[0] && tree[0].children) || []).map(c => c.id)]);
    const removed = [];
    const queue = [...new Set(folderIds)];
    while (queue.length) {
      const id = queue.shift();
      if (roots.has(id)) continue;
      let node, kids;
      try { [node] = await bm.get(id); kids = await bm.getChildren(id); } catch { continue; }
      if (!node || node.url || node.unmodifiable || kids.length) continue;
      try {
        await bm.remove(id);
        removed.push({ id, parentId: node.parentId, index: node.index, title: node.title || '' });
        queue.push(node.parentId);
      } catch { /* the browser refused; leave it */ }
    }
    return removed;
  }

  // Moves the bookmarks. Returns undo data: { moves: [{ id, parentId, index }], createdFolders: [ids], removedFolders: [...] }.
  // options.removeEmpty: also remove the folders that end up empty (see removeEmptyFolders).
  async function applyOrganize(bm, tree, moves, options = {}) {
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
    const removedFolders = options.removeEmpty ? await removeEmptyFolders(bm, tree, done.map(m => m.parentId)) : [];
    return { moves: done, createdFolders, removedFolders, failed };
  }

  // Moves everything back (first recreating any folders that were removed because they were empty),
  // then removes the folders it created if they are empty.
  async function undoOrganize(bm, undo, fallbackParentId) {
    let moved = 0;
    // Recreated folders get new ids; map the old ones. Outermost first, so a parent exists before its children.
    const newId = new Map();
    const mapId = (id) => newId.get(id) || id;
    const folders = [...(undo.removedFolders || [])].reverse();
    for (const f of folders) {
      const parentId = mapId(f.parentId);
      let made;
      try { made = await bm.create({ parentId, index: f.index, title: f.title }); }
      catch { try { made = await bm.create({ parentId, title: f.title }); } catch { continue; } }
      newId.set(f.id, made.id);
    }
    // Lowest index first per folder, so each one lands at its original position.
    const order = undo.moves.map(m => ({ ...m, parentId: mapId(m.parentId) }))
      .sort((a, b) => (a.parentId === b.parentId ? a.index - b.index : String(a.parentId).localeCompare(String(b.parentId))));
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

  const api = { flatten, findMatches, removeMatches, restore, otherFolderId, planOrganize, summarizePlan, applyOrganize, removeEmptyFolders, undoOrganize, ROOT_FOLDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
