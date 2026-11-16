'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LOGIN_ITEM_LABEL,
  PLIST_FILE_NAME,
  LAUNCH_AGENTS_DIR,
  buildPlist,
  defaultPlistPath,
  findAppBundlePath,
  createLoginItem
} = require('../electron/login-item');

const APP_PATH = '/Applications/栏历.app';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-login-item-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('buildPlist uses the fixed label and opens the current bundle', () => {
  const plist = buildPlist(APP_PATH);

  assert.match(plist, /<key>Label<\/key>\s*<string>app\.lanli\.LanLi<\/string>/);
  assert.match(plist, /<string>\/usr\/bin\/open<\/string>\s*<string>-a<\/string>/);
  assert.ok(plist.includes(`<string>${APP_PATH}</string>`));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.equal(LOGIN_ITEM_LABEL, 'app.lanli.LanLi');
  assert.equal(PLIST_FILE_NAME, 'app.lanli.LanLi.plist');
  assert.equal(LAUNCH_AGENTS_DIR, 'Library/LaunchAgents');
});

test('buildPlist escapes XML-special characters in the bundle path', () => {
  const plist = buildPlist('/Applications/A & B <"x">.app');

  assert.ok(plist.includes('/Applications/A &amp; B &lt;&quot;x&quot;&gt;.app'));
  assert.ok(!plist.includes('A & B'));
});

test('buildPlist rejects an empty path', () => {
  assert.throws(() => buildPlist(''), TypeError);
  assert.throws(() => buildPlist('   '), TypeError);
  assert.throws(() => buildPlist(null), TypeError);
});

test('defaultPlistPath points at the user LaunchAgents directory', () => {
  assert.equal(
    defaultPlistPath('/Users/example'),
    path.join('/Users/example', 'Library', 'LaunchAgents', 'app.lanli.LanLi.plist')
  );
  assert.throws(() => defaultPlistPath(''), TypeError);
});

test('findAppBundlePath walks up from the executable to the .app bundle', () => {
  assert.equal(
    findAppBundlePath(`${APP_PATH}/Contents/MacOS/栏历`),
    APP_PATH
  );
  assert.equal(findAppBundlePath(APP_PATH), APP_PATH);
  assert.equal(findAppBundlePath('/usr/local/bin/node'), null);
  assert.equal(findAppBundlePath(''), null);
});

test('createLoginItem enables, reports and disables its own plist', (t) => {
  const home = tempDir(t);
  const item = createLoginItem({
    isPackaged: true,
    execPath: `${APP_PATH}/Contents/MacOS/栏历`,
    homeDir: home,
    logger: () => {}
  });

  assert.equal(item.path, path.join(home, 'Library', 'LaunchAgents', PLIST_FILE_NAME));
  assert.equal(item.bundlePath, APP_PATH);
  assert.equal(item.isEnabled(), false);

  const enabled = item.enable();
  assert.equal(enabled.ok, true);
  assert.equal(enabled.path, item.path);
  assert.equal(item.isEnabled(), true);
  assert.ok(fs.existsSync(item.path));

  const plist = fs.readFileSync(item.path, 'utf8');
  assert.ok(plist.includes(APP_PATH));

  assert.equal(item.disable().ok, true);
  assert.equal(item.isEnabled(), false);
  assert.equal(fs.existsSync(item.path), false);
});

test('createLoginItem does not write a plist in unpackaged development mode', (t) => {
  const home = tempDir(t);
  const item = createLoginItem({
    isPackaged: false,
    execPath: '/workspace/lan-li/node_modules/electron/dist/electron',
    homeDir: home
  });

  const outcome = item.enable();
  assert.deepEqual(outcome, { ok: false, reason: 'not-packaged' });
  assert.equal(item.isEnabled(), false);
  assert.equal(fs.existsSync(item.path), false);
});

test('createLoginItem fails safely when no .app bundle is in the executable path', (t) => {
  const home = tempDir(t);
  const messages = [];
  const item = createLoginItem({
    isPackaged: true,
    execPath: '/usr/local/bin/lanli',
    homeDir: home,
    logger: (message) => messages.push(message)
  });

  const outcome = item.enable();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, '.app path not found');
  assert.equal(item.isEnabled(), false);
  assert.deepEqual(messages, ['.app path not found']);
});

test('createLoginItem logs write and delete failures instead of throwing', (t) => {
  const home = tempDir(t);
  const messages = [];
  const brokenFs = {
    mkdirSync() {
      throw new Error('read-only home');
    },
    writeFileSync() {},
    rmSync() {
      throw new Error('permission denied');
    },
    existsSync() {
      return false;
    }
  };
  const item = createLoginItem({
    fs: brokenFs,
    isPackaged: true,
    execPath: `${APP_PATH}/Contents/MacOS/栏历`,
    homeDir: home,
    logger: (message) => messages.push(message)
  });

  const enabled = item.enable();
  assert.equal(enabled.ok, false);
  assert.equal(enabled.reason, 'read-only home');

  const disabled = item.disable();
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, 'permission denied');

  assert.equal(messages.length, 2);
  assert.match(messages[0], /写入 LaunchAgent 失败/);
  assert.match(messages[1], /删除 LaunchAgent 失败/);
});

test('createLoginItem disable tolerates a missing plist', (t) => {
  const home = tempDir(t);
  const item = createLoginItem({
    isPackaged: true,
    execPath: `${APP_PATH}/Contents/MacOS/栏历`,
    homeDir: home
  });

  assert.equal(item.disable().ok, true);
  assert.equal(item.isEnabled(), false);
});
