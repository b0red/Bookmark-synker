// Tests the start page builder with made-up bookmarks.
const assert = require('assert');
const { buildStartPage } = require('../src/startpage');

const b = (id, url, title, extra = {}) => ({ id, url, title, domain: '', ...extra });
const list = [
  b(1, 'https://news.example.com/', 'News <script>alert(1)</script>', { category: 'News', visit_count: 2 }),
  b(2, 'https://daily.example.com/', 'Daily "quotes" & more', { category: 'News', visit_count: 9 }),
  b(3, 'javascript:alert(1)', 'Bad link', { category: 'News' }),
  b(4, 'https://gone.example.com/', 'Dead one', { category: 'News', status: 'dead' }),
  b(5, 'https://fav.example.com/', 'My favorite', { category: 'Tech', favorite: 1 }),
  b(6, 'https://later.example.com/', 'Read me', { read_later: 123 }),
  ...Array.from({ length: 12 }, (_, i) => b(10 + i, `https://many.example.com/${i}`, `Item ${i}`, { category: 'Àpple / Sub' })),
];

const html = buildStartPage(list, { updated: '22 Nov 2026' });
assert.ok(!html.includes('<script>alert(1)</script>'), 'titles are escaped');
assert.ok(html.includes('News &lt;script&gt;'), 'escaped title is shown');
assert.ok(html.includes('Daily &quot;quotes&quot; &amp; more'));
assert.ok(!html.includes('javascript:alert'), 'only http(s) links');
assert.ok(!html.includes('gone.example.com'), 'dead links are left out');
assert.ok(html.indexOf('daily.example.com') < html.indexOf('news.example.com'), 'most visited first');
const order = ['Favorites', 'Read later', 'Àpple / Sub', 'News', 'Tech', 'Uncategorized'].map(n => html.indexOf(`<h2>${n} `));
assert.ok(order.every(i => i > 0), 'all cards present');
assert.deepStrictEqual([...order].sort((x, y) => x - y), order, 'favorites, read later, categories A–Z, uncategorized last');
assert.ok(html.includes('Show all 12'), 'long cards fold the rest');
assert.ok(html.includes("default-src 'none'"), 'no network access from the page');
assert.ok(html.includes('Updated 22 Nov 2026.'));

const sv = { Favorites: 'Favoriter', 'Show all {n}': 'Visa alla {n}' };
const t = (s, v) => { const x = sv[s] || s; return v ? x.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : x; };
const svHtml = buildStartPage(list, { t, lang: 'sv' });
assert.ok(svHtml.includes('<html lang="sv">') && svHtml.includes('Favoriter') && svHtml.includes('Visa alla 12'), 'translated');
assert.ok(buildStartPage([]).includes('<main>'), 'an empty library still makes a page');
console.log('start page: ok');
