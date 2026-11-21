// Makes docs/screenshot.png for the README from a made-up library (never your real bookmarks).
// Usage: node scripts/make-demo.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Library } = require('../src/db');

const DAY = 86400000;
const now = Date.now();

// [title, url, category, browsers, extra]
const DATA = [
  ['GitHub', 'https://github.com/', 'Development', ['Chrome', 'Firefox']],
  ['MDN Web Docs', 'https://developer.mozilla.org/en-US/', 'Development / Web', ['Chrome', 'Edge'], { favorite: 1 }],
  ['Can I use… support tables', 'https://caniuse.com/', 'Development / Web', ['Firefox']],
  ['CSS-Tricks: A Complete Guide to Flexbox', 'https://css-tricks.com/snippets/css/a-guide-to-flexbox/', 'Development / Web', ['Chrome'], { tags: ['css'] }],
  ['Node.js documentation', 'https://nodejs.org/docs/latest/api/', 'Development / JavaScript', ['Chrome', 'Edge']],
  ['TypeScript Handbook', 'https://www.typescriptlang.org/docs/handbook/intro.html', 'Development / JavaScript', ['Edge'], { later: 3 }],
  ['Python 3 documentation', 'https://docs.python.org/3/', 'Development / Python', ['Firefox']],
  ['Real Python tutorials', 'https://realpython.com/', 'Development / Python', ['Firefox'], { later: 9 }],
  ['Stack Overflow', 'https://stackoverflow.com/', 'Development', ['Chrome', 'Firefox', 'Edge']],
  ['Hacker News', 'https://news.ycombinator.com/', 'News', ['Firefox', 'Opera']],
  ['BBC News', 'https://www.bbc.com/news', 'News', ['Chrome']],
  ['The Guardian – Technology', 'https://www.theguardian.com/technology', 'News', ['Opera']],
  ['Ars Technica', 'https://arstechnica.com/', 'News / Tech', ['Firefox'], { favorite: 1 }],
  ['The Verge', 'https://www.theverge.com/', 'News / Tech', ['Chrome']],
  ['Old tech blog (2009)', 'http://www.oldtechblog-archive.example/2009/03/review.html', 'News / Tech', ['Opera'], { status: 'dead', code: 404 }],
  ['Serious Eats – Recipes', 'https://www.seriouseats.com/recipes', 'Cooking', ['Edge'], { favorite: 1 }],
  ['Budget Bytes', 'https://www.budgetbytes.com/', 'Cooking', ['Edge', 'Chrome']],
  ['King Arthur Baking – Sourdough guide', 'https://www.kingarthurbaking.com/recipes/sourdough', 'Cooking / Baking', ['Edge'], { later: 1, tags: ['bread'] }],
  ['Sally’s Baking Addiction', 'https://sallysbakingaddiction.com/', 'Cooking / Baking', ['Chrome']],
  ['Grandma’s cookie recipe (forum post)', 'http://forum.bakers-corner.example/t/12345', 'Cooking / Baking', ['Opera'], { status: 'dead', code: 0 }],
  ['IKEA', 'https://www.ikea.com/', 'Home & Garden', ['Edge']],
  ['The Spruce – Houseplants', 'https://www.thespruce.com/houseplants-4127766', 'Home & Garden', ['Chrome'], { tags: ['plants'] }],
  ['RHS Gardening advice', 'https://www.rhs.org.uk/advice', 'Home & Garden', ['Firefox']],
  ['Wikipedia', 'https://en.wikipedia.org/wiki/Main_Page', 'Reference', ['Chrome', 'Firefox', 'Edge', 'Opera']],
  ['Wolfram|Alpha', 'https://www.wolframalpha.com/', 'Reference', ['Firefox']],
  ['Internet Archive', 'https://archive.org/', 'Reference', ['Chrome']],
  ['YouTube', 'https://www.youtube.com/', 'Entertainment', ['Chrome', 'Edge']],
  ['How a sourdough starter works (video)', 'https://www.youtube.com/watch?v=dQw4demo001', 'Entertainment', ['Chrome']],
  ['Same video, share link', 'https://youtu.be/dQw4demo001', 'Entertainment', ['Firefox']],
  ['Letterboxd', 'https://letterboxd.com/', 'Entertainment / Movies', ['Firefox']],
  ['IMDb', 'https://www.imdb.com/', 'Entertainment / Movies', ['Opera', 'Chrome']],
  ['Steam', 'https://store.steampowered.com/', 'Entertainment / Games', ['Edge']],
  ['Strava', 'https://www.strava.com/', 'Health & Fitness', ['Chrome']],
  ['Couch to 5K plan', 'https://www.nhs.uk/live-well/exercise/running-and-aerobic-exercises/get-running-with-couch-to-5k/', 'Health & Fitness', ['Edge'], { later: 20 }],
  ['Google Maps', 'https://www.google.com/maps', 'Travel', ['Chrome']],
  ['Lonely Planet – Japan', 'https://www.lonelyplanet.com/japan', 'Travel', ['Firefox'], { favorite: 1 }],
  ['Rome2rio', 'https://www.rome2rio.com/', 'Travel', ['Edge']],
  ['Seat61 – train travel', 'https://www.seat61.com/', 'Travel', ['Firefox'], { later: 5 }],
  ['Figma', 'https://www.figma.com/', 'Design', ['Chrome']],
  ['Coolors palette generator', 'https://coolors.co/', 'Design', ['Chrome', 'Opera']],
  ['Google Fonts', 'https://fonts.google.com/', 'Design', ['Edge']],
  ['Unsorted link from a chat', 'https://www.nngroup.com/articles/ten-usability-heuristics/', null, ['Opera']],
  ['Someone’s gist', 'https://gist.github.com/', null, ['Firefox']],
  ['Recipe site that moved', 'https://recipes.moved-site.example/pasta', null, ['Edge'], { status: 'warn', code: 403 }],
  ['Weather', 'https://www.yr.no/en', null, ['Chrome', 'Edge']],
];

const BROWSER = { Chrome: 'Chrome · Default', Firefox: 'Firefox · default-release', Edge: 'Edge · Default', Opera: 'Opera · Default' };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmlib-demo-'));
  const lib = await Library.open(path.join(dir, 'library.sqlite'));
  // Import per browser, so the "Saved in" and Sources views look real.
  for (const [name, label] of Object.entries(BROWSER)) {
    const items = DATA.map((d, i) => ({ d, i })).filter(({ d }) => d[3].includes(name)).map(({ d, i }) => ({
      url: d[1], title: d[0], folder: d[2] ? d[2].split(' / ')[0] : 'Other bookmarks',
      addedAt: now - (i * 37 + 3) * DAY, lastUsedAt: i % 3 ? now - (i * 5 + 1) * DAY : null, visitCount: i % 3 ? (i * 7) % 40 + 1 : null,
    }));
    lib.importItems(items, label);
  }
  const byUrl = new Map(lib.list().map(b => [b.url, b]));
  for (const [title, url, category, , extra = {}] of DATA) {
    const b = byUrl.get(url);
    if (!b) continue;
    lib.update(b.id, { title, category, favorite: extra.favorite || 0, tags: extra.tags || [] });
    lib.setStatus(b.id, extra.status || 'ok', extra.code ?? 200);
    if (extra.later) lib.update(b.id, { read_later: now - extra.later * DAY });
  }
  lib.update(byUrl.get('https://www.kingarthurbaking.com/recipes/sourdough').id, { notes: 'Try the overnight version this weekend.' });
  lib.save();

  const out = path.join(__dirname, '..', 'docs', 'screenshot.png');
  const select = `(() => {
    for (const p of ['Cooking', 'Development']) if (!expanded.has(p)) expanded.toggle(p);
    document.querySelector('.nav-item[data-value="Cooking"]')?.click();
    const b = state.items.find(x => x.url.includes('kingarthurbaking'));
    state.selectedId = b.id; renderList(); renderDetail();
    document.querySelector('#toast')?.classList.add('hidden');
  })()`;
  const electron = require('electron'); // path to electron.exe when required from Node
  const r = spawnSync(electron, [path.join(__dirname, '..')], {
    env: { ...process.env, BMLIB_DATA: dir, BMLIB_SNAPSHOT: out, BMLIB_SNAPSHOT_JS: select, BMLIB_NO_BRIDGE: '1', BMLIB_NO_AUTOIMPORT: '1' },
    stdio: 'inherit', timeout: 60000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0 || !fs.existsSync(out)) { console.error('Screenshot failed'); process.exit(1); }
  console.log(`Saved ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
