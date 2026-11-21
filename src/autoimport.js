// Imports new bookmarks automatically: once when the app starts, and whenever a browser's bookmark
// file changes while the app is open. Only profiles you have imported before are watched, so a
// profile you chose to skip stays skipped.
//
// It checks file timestamps once a minute instead of using file watchers: Chrome replaces its
// "Bookmarks" file on every save (which breaks watchers), and Firefox's database changes on every
// page visit, so Firefox is imported at most every 10 minutes.

const fs = require('fs');

const FIREFOX_MIN_GAP = 10 * 60 * 1000;

function mtimeOf(source, stat = fs.statSync) {
  // Firefox writes to places.sqlite-wal first; whichever changed last counts.
  const files = source.type === 'firefox' ? [source.path, source.path + '-wal'] : [source.path];
  let t = 0;
  for (const f of files) { try { t = Math.max(t, stat(f).mtimeMs); } catch {} }
  return t;
}

// deps: getSources() -> detected sources; importedLabels() -> labels already in the library;
// importSource(source) -> { added, merged, skipped } (throws on error); onImported([{ label, added }]).
function createAutoImporter(deps) {
  const { getSources, importedLabels, importSource, onImported, now = Date.now, stat } = deps;
  const seen = new Map();     // label -> mtime last imported (or first seen)
  const lastRun = new Map();  // label -> time of last import
  let timer = null;
  let busy = false;

  const watched = () => {
    const labels = new Set(importedLabels());
    return getSources().filter(s => labels.has(s.label));
  };

  async function run(sources) {
    const results = [];
    for (const s of sources) {
      try {
        const r = await importSource(s);
        lastRun.set(s.label, now());
        if (r.added) results.push({ label: s.label, added: r.added });
      } catch { /* locked or mid-write: try again next time */ }
    }
    if (results.length) onImported(results);
    return results;
  }

  // Imports every watched profile once (the "when the app starts" part).
  async function importAll() {
    const sources = watched();
    for (const s of sources) seen.set(s.label, mtimeOf(s, stat));
    return run(sources);
  }

  // One check: imports the profiles whose file changed since last time.
  async function tick() {
    if (busy) return [];
    busy = true;
    try {
      const changed = [];
      for (const s of watched()) {
        const m = mtimeOf(s, stat);
        if (!seen.has(s.label)) { seen.set(s.label, m); continue; } // first look: just remember it
        if (m <= seen.get(s.label)) continue;
        if (s.type === 'firefox' && now() - (lastRun.get(s.label) || 0) < FIREFOX_MIN_GAP) continue;
        seen.set(s.label, m);
        changed.push(s);
      }
      return await run(changed);
    } finally {
      busy = false;
    }
  }

  return {
    importAll,
    tick,
    start(intervalMs = 60 * 1000) {
      if (timer) return;
      for (const s of watched()) if (!seen.has(s.label)) seen.set(s.label, mtimeOf(s, stat));
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    get running() { return !!timer; },
  };
}

module.exports = { createAutoImporter, mtimeOf, FIREFOX_MIN_GAP };
