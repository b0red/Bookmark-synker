// Prints counts only: how many bookmarks each detected browser profile has,
// and how many unique ones remain after merging duplicates.
const initSqlJs = require('sql.js');
const { detectSources, parseChromium, parseFirefox, parseHtml } = require('../src/importers');
const { normalizeUrl } = require('../src/normalize');

(async () => {
  const SQL = await initSqlJs();
  const all = [];
  for (const s of detectSources()) {
    try {
      const items = s.type === 'firefox' ? parseFirefox(s.path, SQL) : parseChromium(s.path);
      const folders = new Set(items.map(i => i.folder)).size;
      const tagged = items.filter(i => i.tags.length).length;
      console.log(`${s.label.padEnd(45)} ${String(items.length).padStart(6)} bookmarks, ${folders} folders, ${tagged} tagged`);
      all.push(...items);
    } catch (e) {
      console.log(`${s.label.padEnd(45)} ERROR ${e.message}`);
    }
  }
  const unique = new Set(all.map(i => normalizeUrl(i.url))).size;
  console.log(`\nTotal ${all.length}, unique after merge ${unique}`);

  const html = `<DL><p><DT><H3>Dev &amp; Tools</H3><DL><p><DT><A HREF="https://example.com/?utm_source=x" ADD_DATE="1600000000" TAGS="a,B">Ex</A></DL><p><DT><A HREF="https://top.example">Top</A></DL>`;
  console.log('HTML parser test:', JSON.stringify(parseHtml(html).map(b => [b.folder, b.title, b.tags, normalizeUrl(b.url)])));
})();
