// Lists every text passed to t()/tn() in the app's code (string literals only), for the
// translation check (scripts/check-i18n.js).
const fs = require('fs');
const path = require('path');

const FILES = ['renderer/app.js', 'main.js', 'src/tray.js', 'extension/popup.js'];
// Literals inside t(...) that are compared values, not text.
const NOT_TEXT = new Set(['category', 'before-import', 'folder', 'bookmark']);
const LIT = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.)*`/g;
const unquote = (q) => Function('"use strict"; return (' + q + ')')();

function keysIn(src) {
  const keys = new Set();
  const call = /\btn?\(/g;
  let m;
  while ((m = call.exec(src))) {
    if (/[\w.$]/.test(src[m.index - 1] || '')) continue; // e.g. "split(", "x.t("
    // The argument text, up to the matching parenthesis.
    let depth = 1, i = call.lastIndex, inStr = null;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
      if (c === "'" || c === '"' || c === '`') inStr = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const args = src.slice(call.lastIndex, i - 1);
    for (const q of args.match(LIT) || []) {
      const s = unquote(q);
      if (/[A-Za-z]/.test(s) && !NOT_TEXT.has(s)) keys.add(s);
    }
  }
  return keys;
}

// { file: Set(keys) }
function keysByFile(root = path.join(__dirname, '..')) {
  const out = {};
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const keys = keysIn(src);
    // The sidebar's smart views are translated where they're shown.
    if (f === 'renderer/app.js') for (const v of src.matchAll(/\{ id: '\w+', name: '([^']+)'/g)) keys.add(v[1]);
    out[f] = keys;
  }
  return out;
}

module.exports = { keysByFile, keysIn };
if (require.main === module) {
  for (const [f, keys] of Object.entries(keysByFile())) { console.log(`# ${f} (${keys.size})`); for (const k of keys) console.log(JSON.stringify(k)); }
}
