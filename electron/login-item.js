'use strict';

// Login-item fallback for unsigned builds. macOS rejects
// app.setLoginItemSettings on unsigned bundles (openAtLogin reads back false),
// so main.js can write a user LaunchAgent instead. This module has no Electron
// dependency; fs, path and the executable path are injectable for tests.

const fsDefault = require('node:fs');
const osDefault = require('node:os');
const pathDefault = require('node:path');

const LOGIN_ITEM_LABEL = 'app.lanli.LanLi';
const PLIST_FILE_NAME = `${LOGIN_ITEM_LABEL}.plist`;
const LAUNCH_AGENTS_DIR = 'Library/LaunchAgents';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildPlist(appPath) {
  const app = typeof appPath === 'string' ? appPath.trim() : '';
  if (!app) throw new TypeError('app path is required');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LOGIN_ITEM_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>${escapeXml(app)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

function defaultPlistPath(homeDir, pathMod = pathDefault) {
  if (typeof homeDir !== 'string' || homeDir.trim() === '') {
    throw new TypeError('home directory is required');
  }
  return pathMod.join(homeDir, LAUNCH_AGENTS_DIR, PLIST_FILE_NAME);
}

// Walk up from process.execPath until a *.app directory is found. A packaged
// executable lives at .../栏历.app/Contents/MacOS/栏历.
function findAppBundlePath(execPath, pathMod = pathDefault) {
  if (typeof execPath !== 'string' || execPath.trim() === '') return null;

  let current = pathMod.resolve(execPath);
  while (current) {
    if (pathMod.basename(current).endsWith('.app')) return current;
    const parent = pathMod.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function reasonOf(error) {
  return error && error.message ? error.message : String(error);
}

function createLoginItem(options = {}) {
  const fs = options.fs || fsDefault;
  const pathMod = options.path || pathDefault;
  const execPath = typeof options.execPath === 'string'
    ? options.execPath
    : process.execPath;
  const homeDir = typeof options.homeDir === 'string'
    ? options.homeDir
    : osDefault.homedir();
  const plistPath = typeof options.plistPath === 'string' && options.plistPath.trim()
    ? options.plistPath
    : defaultPlistPath(homeDir, pathMod);
  const isPackaged = options.isPackaged === true;
  const log = typeof options.logger === 'function' ? options.logger : () => {};

  function enable() {
    if (!isPackaged) {
      return { ok: false, reason: 'not-packaged' };
    }

    const appPath = findAppBundlePath(execPath, pathMod);
    if (!appPath) {
      const reason = '.app path not found';
      log(reason);
      return { ok: false, reason };
    }

    try {
      fs.mkdirSync(pathMod.dirname(plistPath), { recursive: true });
      fs.writeFileSync(plistPath, buildPlist(appPath), 'utf8');
      return { ok: true, path: plistPath };
    } catch (error) {
      const reason = reasonOf(error);
      log('写入 LaunchAgent 失败：' + reason);
      return { ok: false, reason };
    }
  }

  function disable() {
    try {
      if (typeof fs.rmSync === 'function') {
        fs.rmSync(plistPath, { force: true });
      } else if (fs.existsSync(plistPath)) {
        fs.unlinkSync(plistPath);
      }
      return { ok: true, path: plistPath };
    } catch (error) {
      const reason = reasonOf(error);
      log('删除 LaunchAgent 失败：' + reason);
      return { ok: false, reason };
    }
  }

  function isEnabled() {
    try {
      return Boolean(fs.existsSync(plistPath));
    } catch (error) {
      log('读取 LaunchAgent 失败：' + reasonOf(error));
      return false;
    }
  }

  return {
    enable,
    disable,
    isEnabled,
    get path() {
      return plistPath;
    },
    get bundlePath() {
      return findAppBundlePath(execPath, pathMod);
    }
  };
}

module.exports = {
  LOGIN_ITEM_LABEL,
  PLIST_FILE_NAME,
  LAUNCH_AGENTS_DIR,
  buildPlist,
  defaultPlistPath,
  findAppBundlePath,
  createLoginItem
};
