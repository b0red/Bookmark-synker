// The library: one SQLite file (via sql.js, so there are no native modules to build).

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { normalizeUrl, domainOf } = require('./normalize');

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
    fs.renameSync(tmp, this.file);
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
        const existing = this.get('SELECT id, title, added_at, last_used_at, visit_count FROM bookmarks WHERE norm = ?', [norm]);
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
    return rows.map(r => ({ ...r, tags: tags.get(r.id) || [], sources: sources.get(r.id) || [] }));
  }

  update(id, patch) {
    const fields = ['title', 'category', 'notes', 'favorite'];
    for (const f of fields) {
      if (patch[f] !== undefined) this.run(`UPDATE bookmarks SET ${f} = ? WHERE id = ?`, [patch[f], id]);
    }
    if (Array.isArray(patch.tags)) this.setTags(id, patch.tags);
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
    });
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
