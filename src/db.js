// The library: one SQLite file (via sql.js, so there are no native modules to build).

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { normalizeUrl, domainOf } = require('./normalize');
const { findDuplicates } = require('./duplicates');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  norm TEXT NOT NULL UNIQUE,
  title TEXT DEFAULT '',
  domain TEXT DEFAULT '',
  folder TEXT DEFAULT '',
  category TEXT,
  notes TEXT DEFAULT '',
  favorite INTEGER DEFAULT 0,
  added_at INTEGER,
  last_used_at INTEGER,
  visit_count INTEGER,
  imported_at INTEGER,
  status TEXT,
  status_code INTEGER,
  checked_at INTEGER
);
CREATE TABLE IF NOT EXISTS sources (
  bookmark_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (bookmark_id, source, folder)
);
CREATE TABLE IF NOT EXISTS tags (
  bookmark_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (bookmark_id, tag)
);
-- URLs the user deleted; re-imports skip them so they don't come back.
CREATE TABLE IF NOT EXISTS removed (
  norm TEXT PRIMARY KEY,
  removed_at INTEGER
);
-- URLs merged into another bookmark (near-duplicates). Imports of these URLs add to that bookmark.
CREATE TABLE IF NOT EXISTS aliases (
  norm TEXT PRIMARY KEY,
  bookmark_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  merged_at INTEGER
);
-- Groups the user said are not duplicates (key: their URLs, sorted).
CREATE TABLE IF NOT EXISTS dup_dismissed (
  signature TEXT PRIMARY KEY
);
`;

class Library {
  static async open(file) {
    const SQL = await initSqlJs();
    const lib = new Library();
    lib.SQL = SQL;
    lib.file = file;
    lib.db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    lib.db.run(SCHEMA);
    // 0.3: deleted bookmarks keep a snapshot so they can be restored.
    if (!lib.all('PRAGMA table_info(removed)').some(c => c.name === 'data')) lib.run('ALTER TABLE removed ADD COLUMN data TEXT');
    return lib;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    // Windows: a virus scanner or the search indexer can hold the new file for a moment.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, this.file); return; } catch (e) {
        if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
      }
    }
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  get(sql, params = []) { return this.all(sql, params)[0]; }
  run(sql, params = []) { this.db.run(sql, params); }

  // Merge a batch of imported bookmarks. Returns { added, merged }.
  importItems(items, sourceLabel) {
    let added = 0, merged = 0, skipped = 0;
    const now = Date.now();
    this.run('BEGIN');
    try {
      for (const it of items) {
        if (!it.url) continue;
        const norm = normalizeUrl(it.url);
        if (this.get('SELECT 1 AS x FROM removed WHERE norm = ?', [norm])) { skipped++; continue; }
        // A URL merged into another bookmark (near-duplicate) adds to that bookmark.
        const alias = this.get('SELECT bookmark_id FROM aliases WHERE norm = ?', [norm]);
        const existing = alias
          ? this.get('SELECT id, title, added_at, last_used_at, visit_count FROM bookmarks WHERE id = ?', [alias.bookmark_id])
          : this.get('SELECT id, title, added_at, last_used_at, visit_count FROM bookmarks WHERE norm = ?', [norm]);
        let id;
        if (existing) {
          id = existing.id;
          merged++;
          const minAdded = [existing.added_at, it.addedAt].filter(Boolean);
          const maxUsed = [existing.last_used_at, it.lastUsedAt].filter(Boolean);
          const visits = [existing.visit_count, it.visitCount].filter(v => v != null);
          this.run(
            `UPDATE bookmarks SET title = CASE WHEN title = '' THEN ? ELSE title END,
               added_at = ?, last_used_at = ?, visit_count = ? WHERE id = ?`,
            [it.title || '', minAdded.length ? Math.min(...minAdded) : null,
             maxUsed.length ? Math.max(...maxUsed) : null,
             visits.length ? Math.max(...visits) : null, id]);
        } else {
          this.run(
            `INSERT INTO bookmarks (url, norm, title, domain, folder, added_at, last_used_at, visit_count, imported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [it.url, norm, it.title || '', domainOf(it.url), it.folder || '', it.addedAt || null,
             it.lastUsedAt || null, it.visitCount ?? null, now]);
          id = this.get('SELECT last_insert_rowid() AS id').id;
          added++;
        }
        this.run('INSERT OR IGNORE INTO sources (bookmark_id, source, folder) VALUES (?, ?, ?)', [id, sourceLabel, it.folder || '']);
        for (const t of it.tags || []) this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [id, t]);
      }
      this.run('COMMIT');
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
    this.save();
    return { added, merged, skipped };
  }

  list() {
    const rows = this.all('SELECT * FROM bookmarks ORDER BY COALESCE(added_at, imported_at) DESC');
    const tags = new Map(), sources = new Map();
    for (const t of this.all('SELECT bookmark_id, tag FROM tags ORDER BY tag')) {
      if (!tags.has(t.bookmark_id)) tags.set(t.bookmark_id, []);
      tags.get(t.bookmark_id).push(t.tag);
    }
    for (const s of this.all('SELECT bookmark_id, source, folder FROM sources')) {
      if (!sources.has(s.bookmark_id)) sources.set(s.bookmark_id, []);
      sources.get(s.bookmark_id).push({ source: s.source, folder: s.folder });
    }
    const aliases = new Map();
    for (const a of this.all('SELECT bookmark_id, url FROM aliases ORDER BY merged_at')) {
      if (!aliases.has(a.bookmark_id)) aliases.set(a.bookmark_id, []);
      aliases.get(a.bookmark_id).push(a.url);
    }
    const out = rows.map(r => ({ ...r, tags: tags.get(r.id) || [], sources: sources.get(r.id) || [], aliases: aliases.get(r.id) || [] }));
    const dismissed = new Set(this.all('SELECT signature FROM dup_dismissed').map(d => d.signature));
    const dups = findDuplicates(out, dismissed);
    for (const b of out) {
      const d = dups.get(b.id);
      if (d) { b.dup = d.group; b.dup_size = d.size; b.dup_signature = d.signature; }
    }
    return out;
  }

  // ---------- near-duplicates ----------

  // Full state of a bookmark, for undo.
  snapshot(id) {
    const row = this.get('SELECT * FROM bookmarks WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      tags: this.all('SELECT tag FROM tags WHERE bookmark_id = ?', [id]).map(t => t.tag),
      sources: this.all('SELECT source, folder FROM sources WHERE bookmark_id = ?', [id]),
      aliases: this.all('SELECT norm, url, merged_at FROM aliases WHERE bookmark_id = ?', [id]),
    };
  }

  // Merges otherIds into keepId: their browsers, folders, tags and notes move over, and their URLs
  // become aliases of the kept bookmark. Nothing is deleted in the browsers.
  // Returns an undo token for unmerge().
  mergeDuplicates(keepId, otherIds) {
    const keep = this.snapshot(keepId);
    const others = otherIds.filter(id => id !== keepId).map(id => this.snapshot(id)).filter(Boolean);
    if (!keep || !others.length) return null;
    const now = Date.now();
    this.run('BEGIN');
    try {
      const all = [keep, ...others];
      const pick = (f) => all.map(b => b[f]).filter(v => v != null && v !== '');
      const notes = [...new Set(pick('notes'))].join('\n\n');
      const added = pick('added_at'), used = pick('last_used_at'), visits = pick('visit_count');
      this.run('UPDATE bookmarks SET title = ?, category = ?, notes = ?, favorite = ?, added_at = ?, last_used_at = ?, visit_count = ? WHERE id = ?',
        [keep.title || pick('title')[0] || '', keep.category || pick('category')[0] || null, notes,
         all.some(b => b.favorite) ? 1 : 0, added.length ? Math.min(...added) : null,
         used.length ? Math.max(...used) : null, visits.length ? Math.max(...visits) : null, keepId]);
      for (const o of others) {
        for (const t of o.tags) this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [keepId, t]);
        for (const src of o.sources) this.run('INSERT OR IGNORE INTO sources (bookmark_id, source, folder) VALUES (?, ?, ?)', [keepId, src.source, src.folder]);
        this.run('INSERT OR REPLACE INTO aliases (norm, bookmark_id, url, merged_at) VALUES (?, ?, ?, ?)', [o.norm, keepId, o.url, now]);
        this.run('UPDATE aliases SET bookmark_id = ? WHERE bookmark_id = ?', [keepId, o.id]); // earlier merges come along
        this.run('DELETE FROM bookmarks WHERE id = ?', [o.id]);
        this.run('DELETE FROM tags WHERE bookmark_id = ?', [o.id]);
        this.run('DELETE FROM sources WHERE bookmark_id = ?', [o.id]);
      }
      this.run('COMMIT');
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
    this.save();
    return { keep, others };
  }

  // Undoes mergeDuplicates() with its token: the kept bookmark gets its old values back and the
  // merged ones return as separate bookmarks (with their old ids).
  unmerge(token) {
    if (!token || !token.keep) return;
    const put = (b) => {
      this.run('DELETE FROM bookmarks WHERE id = ?', [b.id]);
      this.run(
        'INSERT INTO bookmarks (id, url, norm, title, domain, folder, category, notes, favorite, added_at, last_used_at, ' +
        'visit_count, imported_at, status, status_code, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [b.id, b.url, b.norm, b.title, b.domain, b.folder, b.category, b.notes, b.favorite, b.added_at, b.last_used_at,
         b.visit_count, b.imported_at, b.status, b.status_code, b.checked_at]);
      this.run('DELETE FROM tags WHERE bookmark_id = ?', [b.id]);
      this.run('DELETE FROM sources WHERE bookmark_id = ?', [b.id]);
      for (const t of b.tags) this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [b.id, t]);
      for (const src of b.sources) this.run('INSERT OR IGNORE INTO sources (bookmark_id, source, folder) VALUES (?, ?, ?)', [b.id, src.source, src.folder]);
    };
    this.run('BEGIN');
    try {
      const all = [token.keep, ...token.others];
      for (const b of all) this.run('DELETE FROM aliases WHERE norm = ?', [b.norm]);
      this.run('DELETE FROM aliases WHERE bookmark_id = ?', [token.keep.id]);
      for (const b of all) {
        put(b);
        for (const a of b.aliases) this.run('INSERT OR REPLACE INTO aliases (norm, bookmark_id, url, merged_at) VALUES (?, ?, ?, ?)', [a.norm, b.id, a.url, a.merged_at]);
      }
      this.run('COMMIT');
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
    this.save();
  }

  // "Not duplicates": this exact group isn't shown again (undo = true takes that back).
  dismissDuplicates(signature, undo = false) {
    if (undo) this.run('DELETE FROM dup_dismissed WHERE signature = ?', [signature]);
    else this.run('INSERT OR IGNORE INTO dup_dismissed (signature) VALUES (?)', [signature]);
    this.save();
  }

  update(id, patch) {
    const fields = ['title', 'category', 'notes', 'favorite'];
    for (const f of fields) {
      if (patch[f] !== undefined) this.run(`UPDATE bookmarks SET ${f} = ? WHERE id = ?`, [patch[f], id]);
    }
    if (Array.isArray(patch.tags)) this.setTags(id, patch.tags);
    this.save();
  }

  // One change applied to many bookmarks in a single transaction.
  // patch: { category?: string|null, favorite?: 0|1, addTags?: string[], removeTags?: string[] }
  bulkUpdate(ids, patch) {
    const clean = (list) => [...new Set((list || []).map(t => String(t).trim().toLowerCase()).filter(Boolean))];
    const add = clean(patch.addTags), rem = clean(patch.removeTags);
    this.run('BEGIN');
    try {
      for (const id of ids) {
        if (patch.category !== undefined) this.run('UPDATE bookmarks SET category = ? WHERE id = ?', [patch.category || null, id]);
        if (patch.favorite !== undefined) this.run('UPDATE bookmarks SET favorite = ? WHERE id = ?', [patch.favorite ? 1 : 0, id]);
        for (const t of add) this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [id, t]);
        for (const t of rem) this.run('DELETE FROM tags WHERE bookmark_id = ? AND tag = ?', [id, t]);
      }
      this.run('COMMIT');
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
    this.save();
  }

  // Puts category, favorite and tags back to earlier values (used by Undo after a bulk change).
  setFields(list) {
    this.run('BEGIN');
    try {
      for (const f of list) {
        this.run('UPDATE bookmarks SET category = ?, favorite = ? WHERE id = ?', [f.category ?? null, f.favorite ? 1 : 0, f.id]);
        this.setTags(f.id, f.tags || []);
      }
      this.run('COMMIT');
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
    this.save();
  }

  setTags(id, tags) {
    this.run('DELETE FROM tags WHERE bookmark_id = ?', [id]);
    for (const t of [...new Set(tags.map(x => String(x).trim().toLowerCase()).filter(Boolean))]) {
      this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [id, t]);
    }
  }

  // Claude's suggestions: set the category, add tags (keeps any tags already there).
  applyCategories(results) {
    this.run('BEGIN');
    for (const r of results) {
      this.run('UPDATE bookmarks SET category = ? WHERE id = ?', [r.category, r.id]);
      for (const t of r.tags || []) this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [r.id, String(t).toLowerCase()]);
    }
    this.run('COMMIT');
    this.save();
  }

  setStatus(id, status, code) {
    this.run('UPDATE bookmarks SET status = ?, status_code = ?, checked_at = ? WHERE id = ?', [status, code ?? null, Date.now(), id]);
  }

  removedNorms() {
    return this.all('SELECT norm FROM removed').map(r => r.norm);
  }

  // Each categorized URL (merged URLs too) with its category, for sorting browser bookmarks into folders.
  categoryMap() {
    return this.all(`SELECT norm, category FROM bookmarks WHERE category IS NOT NULL AND category != ''
      UNION ALL
      SELECT a.norm, b.category FROM aliases a JOIN bookmarks b ON b.id = a.bookmark_id
      WHERE b.category IS NOT NULL AND b.category != ''`);
  }

  remove(ids) {
    this.run('BEGIN');
    const now = Date.now();
    for (const id of ids) {
      const row = this.get('SELECT * FROM bookmarks WHERE id = ?', [id]);
      if (row) {
        // Keep everything about the bookmark so "Recently deleted" can restore it fully.
        const snapshot = {
          ...row,
          tags: this.all('SELECT tag FROM tags WHERE bookmark_id = ?', [id]).map(t => t.tag),
          sources: this.all('SELECT source, folder FROM sources WHERE bookmark_id = ?', [id]),
        };
        this.run('INSERT OR REPLACE INTO removed (norm, removed_at, data) VALUES (?, ?, ?)', [row.norm, now, JSON.stringify(snapshot)]);
        // URLs merged into it go too (so Sync removes them from the browsers), hidden in "Recently deleted".
        for (const a of this.all('SELECT norm, url FROM aliases WHERE bookmark_id = ?', [id])) {
          this.run('INSERT OR REPLACE INTO removed (norm, removed_at, data) VALUES (?, ?, ?)',
            [a.norm, now, JSON.stringify({ url: a.url, alias_of: row.norm })]);
        }
        this.run('DELETE FROM aliases WHERE bookmark_id = ?', [id]);
      }
      this.run('DELETE FROM bookmarks WHERE id = ?', [id]);
      this.run('DELETE FROM tags WHERE bookmark_id = ?', [id]);
      this.run('DELETE FROM sources WHERE bookmark_id = ?', [id]);
    }
    this.run('COMMIT');
    this.save();
  }

  // Deleted bookmarks, newest first, shaped like list() rows. `id` is the negative rowid of the
  // removed entry, so it never collides with a real bookmark id.
  listRemoved() {
    return this.all('SELECT rowid AS rid, norm, removed_at, data FROM removed ORDER BY removed_at DESC').map(r => {
      let d = null;
      try { d = r.data ? JSON.parse(r.data) : null; } catch {}
      if (d && d.alias_of) return null; // a merged URL; it comes back with its bookmark
      // Entries deleted before 0.3 only stored the normalized URL (no scheme); rebuild a usable link.
      const url = d?.url || (/^[a-z][a-z0-9+.-]*:/i.test(r.norm) ? r.norm : 'https://' + r.norm);
      return {
        id: -r.rid, deleted: true, removed_at: r.removed_at, url, norm: r.norm,
        title: d?.title || '', domain: d?.domain ?? domainOf(url), folder: d?.folder || '',
        category: d?.category || null, notes: d?.notes || '', favorite: d?.favorite || 0,
        added_at: d?.added_at || null, imported_at: d?.imported_at || r.removed_at,
        last_used_at: d?.last_used_at || null, visit_count: d?.visit_count ?? null,
        status: d?.status || null, status_code: d?.status_code || null,
        tags: d?.tags || [], sources: d?.sources || [], hasSnapshot: !!d,
      };
    }).filter(Boolean);
  }

  // Puts deleted bookmarks back (ids from listRemoved) and stops skipping them on import.
  restore(removedIds) {
    const byId = new Map(this.listRemoved().map(r => [r.id, r]));
    let restored = 0;
    this.run('BEGIN');
    try {
      for (const id of removedIds) {
        const r = byId.get(id);
        if (!r) continue;
        this.run('DELETE FROM removed WHERE rowid = ?', [-id]);
        restored++;
        if (this.get('SELECT id FROM bookmarks WHERE norm = ?', [r.norm])) continue;
        this.run(
          `INSERT INTO bookmarks (url, norm, title, domain, folder, category, notes, favorite, added_at, last_used_at,
             visit_count, imported_at, status, status_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.url, r.norm, r.title, r.domain, r.folder, r.category, r.notes, r.favorite, r.added_at, r.last_used_at,
           r.visit_count, r.imported_at, r.status, r.status_code]);
        const newId = this.get('SELECT last_insert_rowid() AS id').id;
        // Its merged URLs come back as aliases again.
        for (const a of this.all('SELECT norm, data FROM removed WHERE data LIKE ?', ['%"alias_of"%'])) {
          let d = null;
          try { d = JSON.parse(a.data); } catch {}
          if (!d || d.alias_of !== r.norm) continue;
          this.run('DELETE FROM removed WHERE norm = ?', [a.norm]);
          this.run('INSERT OR REPLACE INTO aliases (norm, bookmark_id, url, merged_at) VALUES (?, ?, ?, ?)', [a.norm, newId, d.url, Date.now()]);
        }
        for (const t of r.tags) this.run('INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?, ?)', [newId, t]);
        for (const s of r.sources) this.run('INSERT OR IGNORE INTO sources (bookmark_id, source, folder) VALUES (?, ?, ?)', [newId, s.source, s.folder || '']);
      }
      this.run('COMMIT');
    } catch (e) {
      this.run('ROLLBACK');
      throw e;
    }
    this.save();
    return restored;
  }
}

module.exports = { Library };
