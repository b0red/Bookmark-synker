// Tests the update check with a fake GitHub (no network).
const assert = require('assert');
const { isNewer, latestRelease, RELEASES_PAGE } = require('../src/updates');

(async () => {
  assert.ok(isNewer('1.2.2', '1.2.1'));
  assert.ok(isNewer('v1.10.0', '1.9.9'), 'numbers, not text');
  assert.ok(isNewer('2.0', '1.9.9'));
  assert.ok(!isNewer('1.2.1', '1.2.1'));
  assert.ok(!isNewer('1.2.0', '1.2.1'));
  assert.ok(!isNewer('1.3.0-beta', '1.3.0'), 'a pre-release of the same version is not newer');

  const fake = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
  assert.deepStrictEqual(await latestRelease(fake({ tag_name: 'v1.3.0', html_url: `${RELEASES_PAGE}/tag/v1.3.0` })),
    { version: '1.3.0', url: `${RELEASES_PAGE}/tag/v1.3.0` });
  // A link anywhere else is replaced by the project's releases page.
  assert.strictEqual((await latestRelease(fake({ tag_name: 'v1.3.0', html_url: 'https://evil.example/download' }))).url, RELEASES_PAGE);
  await assert.rejects(latestRelease(fake({}, false, 403)), /403/);
  await assert.rejects(latestRelease(fake({ tag_name: 'nightly' })), /no version/);
  console.log('update check: ok');
})().catch((e) => { console.error(e); process.exit(1); });
