'use strict';

// GitHub release feed for Electron's built-in autoUpdater.
// update.electronjs.org reads the public GitHub Release assets directly; the
// release workflow keeps uploading LanLi-<version>-mac-<arch>.zip, which
// matches its "-mac" + "-x64"/"-arm64" asset naming heuristics.
const GITHUB_OWNER = 'allen-bot-ctl';
const GITHUB_REPO = 'lan-li';
const UPDATE_SERVER = 'https://update.electronjs.org';
const RELEASES_LATEST_URL =
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const HOMEPAGE_URL = 'https://allen-bot-ctl.github.io/lan-li/';

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function buildFeedUrl(options = {}) {
  const owner = requireText(options.owner ?? GITHUB_OWNER, 'owner');
  const repo = requireText(options.repo ?? GITHUB_REPO, 'repo');
  const platform = requireText(options.platform, 'platform');
  const arch = requireText(options.arch, 'arch');
  const version = requireText(options.version, 'version');
  const server = requireText(options.server ?? UPDATE_SERVER, 'server')
    .replace(/\/+$/, '');

  return `${server}/${owner}/${repo}/${platform}-${arch}/${version}`;
}

// Interprets a probe of the update feed without doing any network I/O.
// 204 means "no update" (up-to-date). 200 with a valid update payload means a
// newer release exists but this unsigned build cannot apply it automatically, so
// the caller should offer a manual download. Any other status or an invalid
// payload is treated as a real check failure.
function interpretFeedProbe(status, payload) {
  if (status === 204) return { state: 'up-to-date' };

  if (status === 200) {
    const name = payload && typeof payload.name === 'string'
      ? payload.name.trim()
      : '';
    const url = payload && typeof payload.url === 'string'
      ? payload.url.trim()
      : '';
    if (name || url) {
      const result = { state: 'manual', name: name || 'latest' };
      if (url) result.url = url;
      return result;
    }
  }

  return { state: 'error' };
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  UPDATE_SERVER,
  RELEASES_LATEST_URL,
  HOMEPAGE_URL,
  buildFeedUrl,
  interpretFeedProbe
};
