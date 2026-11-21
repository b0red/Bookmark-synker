// The URL normalizer lives in extension/normalize.js so the app and the browser extension
// always agree on which URLs are "the same".
module.exports = require('../extension/normalize.js');
