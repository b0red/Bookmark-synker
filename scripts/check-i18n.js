// Lists English texts that have no Swedish translation:
//  - every t()/tn() text in the app's code (scripts/i18n-keys.js), against renderer/lang/sv.js
//    (the popup's against the dictionary in extension/i18n.js), and
//  - the text of renderer/index.html and extension/popup.html, matched the way i18n.js matches it.
// Also flags translations whose {placeholders} differ from the English.
// Run: npm run check-i18n   (exits with 1 when something is missing)
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');

// Texts that are the same in every language.
const SAME = new Set(['Bookmark syncer', '?', '⚙', 'A', '★', ':', 'Enter', 'Firefox', 'English', 'Svenska', 'qwen2.5:3b',
  'sk-ant-…', 'xxxx-xxxx-xxxx-xxxx', 'Claude', 'Problem', 'Chrome, Edge, Brave, Vivaldi, Opera', 'Claude (Anthropic API)',
  'Bookmark syncer <span id="info-version" class="muted small"></span>', '<b>Bookmark syncer</b> <span class="muted">helper</span>',
  'helper', 'crash.log']);

// Runs in a page: the texts i18n.js would look up for this HTML.
const DOM_KEYS = `(html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const INLINE = new Set(['B','I','EM','STRONG','CODE','KBD','A','SPAN','BR','SMALL']);
  const keys = new Set();
  const attrs = (el) => { for (const a of ['title','placeholder','aria-label']) { const v = el.getAttribute(a); if (v && norm(v)) keys.add(norm(v)); } };
  const visit = (el) => {
    attrs(el);
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.hasAttribute('data-no-i18n')) return;
    const kids = [...el.children];
    if (kids.length && kids.every(k => INLINE.has(k.tagName)) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
      keys.add(norm(el.innerHTML)); for (const k of el.querySelectorAll('*')) attrs(k); return;
    }
    for (const n of [...el.childNodes]) { if (n.nodeType === 3) { const k = norm(n.textContent); if (k) keys.add(k); } else if (n.nodeType === 1) visit(n); }
  };
  visit(doc.body);
  if (doc.title) keys.add(doc.title);
  return [...keys];
}`;

function report(htmlKeys) {
  const { keysByFile } = require('./i18n-keys.js');
  const SV = require('../renderer/lang/sv.js');
  const popupSrc = fs.readFileSync(path.join(root, 'extension/i18n.js'), 'utf8');
  const SV_POPUP = Function(popupSrc.slice(0, popupSrc.indexOf('(function')) + '; return SV_POPUP;')();
  const byFile = keysByFile(root);
  const groups = [
    ['code (app, main, tray, start page)', SV, [...byFile['renderer/app.js'], ...byFile['main.js'], ...byFile['src/tray.js'], ...byFile['src/startpage.js']]],
    ['renderer/index.html', SV, htmlKeys.app],
    ['extension popup code', SV_POPUP, [...byFile['extension/popup.js']]],
    ['extension/popup.html', SV_POPUP, htmlKeys.popup],
  ];
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  let bad = 0;
  for (const [name, dict, keys] of groups) {
    const missing = [...new Set(keys)].filter(k => !SAME.has(k) && !Object.prototype.hasOwnProperty.call(dict, k));
    const wrongVars = [...new Set(keys)].filter(k => Object.prototype.hasOwnProperty.call(dict, k) && holes(k) !== holes(dict[k]));
    console.log(`${name}: ${keys.length} texts, ${missing.length} missing${wrongVars.length ? `, ${wrongVars.length} with other {placeholders}` : ''}`);
    for (const k of missing) console.log('  missing: ' + JSON.stringify(k));
    for (const k of wrongVars) console.log('  placeholders differ: ' + JSON.stringify(k));
    bad += missing.length + wrongVars.length;
  }
  return bad;
}

if (process.versions.electron) {
  // Inside Electron: parse the HTML in a hidden window, then report.
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await w.loadURL('about:blank');
    const keysOf = (file) => w.webContents.executeJavaScript(`(${DOM_KEYS})(${JSON.stringify(fs.readFileSync(path.join(root, file), 'utf8'))})`);
    const htmlKeys = { app: await keysOf('renderer/index.html'), popup: await keysOf('extension/popup.html') };
    const bad = report(htmlKeys);
    app.exit(bad ? 1 : 0);
  });
} else {
  // Plain Node: start Electron with this file.
  const electron = require('electron'); // the path to electron.exe when required from Node
  const r = require('child_process').spawnSync(electron, [__filename], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
