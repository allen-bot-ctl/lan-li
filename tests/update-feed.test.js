'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFeedUrl,
  GITHUB_OWNER,
  GITHUB_REPO,
  UPDATE_SERVER
} = require('../electron/update-feed');

test('feed URL uses the official service, repository, platform, arch and version', () => {
  assert.equal(GITHUB_OWNER, 'allen-bot-ctl');
  assert.equal(GITHUB_REPO, 'lan-li');
  assert.equal(UPDATE_SERVER, 'https://update.electronjs.org');

  assert.equal(
    buildFeedUrl({
      platform: 'darwin',
      arch: 'x64',
      version: '0.1.1'
    }),
    'https://update.electronjs.org/allen-bot-ctl/lan-li/darwin-x64/0.1.1'
  );
});

test('feed URL accepts an explicit owner, repo, server and trims trailing slashes', () => {
  assert.equal(
    buildFeedUrl({
      owner: 'example',
      repo: 'demo',
      server: 'https://updates.example.com/',
      platform: 'darwin',
      arch: 'arm64',
      version: '2.3.4'
    }),
    'https://updates.example.com/example/demo/darwin-arm64/2.3.4'
  );
});

test('feed URL rejects missing platform, arch or version', () => {
  assert.throws(
    () => buildFeedUrl({ platform: 'darwin', arch: 'x64' }),
    /version is required/
  );
  assert.throws(
    () => buildFeedUrl({ platform: 'darwin', version: '0.1.1' }),
    /arch is required/
  );
  assert.throws(
    () => buildFeedUrl({ arch: 'x64', version: '0.1.1' }),
    /platform is required/
  );
});
