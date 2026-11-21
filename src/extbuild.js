// Builds the Firefox version of the helper extension from the shared `extension/` folder.
// The code is the same; Firefox only needs a few extra manifest settings (an add-on ID etc.),
// which Chrome would flag as unknown keys, so they're added in a copy instead.

const fs = require('fs');
const path = require('path');

// In the installed app the extension is kept outside app.asar (see asarUnpack in package.json),
// so Chrome's "Load unpacked" can open it as a normal folder.
const SOURCE = path.join(__dirname, '..', 'extension').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const GECKO_ID = 'bookmark-syncer-helper@bookmark-syncer.local';

function firefoxManifest(base) {
  return {
    ...base,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '128.0',
        // Required by addons.mozilla.org for signing; the extension collects nothing.
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}

// Writes the Firefox build to `dest` (replacing what's there) and returns its manifest.json path.
function buildFirefox(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(SOURCE)) {
    if (name === 'manifest.json') continue;
    fs.copyFileSync(path.join(SOURCE, name), path.join(dest, name));
  }
  const manifest = firefoxManifest(JSON.parse(fs.readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8')));
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dest, 'README.txt'),
    'Firefox build of the Bookmark syncer helper, made by the app from its "extension" folder.\r\n' +
    'Load manifest.json from about:debugging, or sign it to install permanently (see docs/INSTALL.md).\r\n' +
    'Don\'t edit files here: the app rebuilds this folder.\r\n');
  return path.join(dest, 'manifest.json');
}

module.exports = { buildFirefox, firefoxManifest, GECKO_ID, SOURCE };
