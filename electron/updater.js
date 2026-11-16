'use strict';

const { buildFeedUrl } = require('./update-feed');

// The first check runs shortly after launch; later checks are deliberately
// infrequent so the app does not hammer GitHub.
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FEED_TIMEOUT_MS = 15 * 1000;

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' &&
      typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

// Wires Electron's built-in autoUpdater to the official update.electronjs.org
// feed. Squirrel.Mac is the thing that actually replaces the app; this module
// only decides what to tell the user when that cannot happen.
function setupAutoUpdate(options) {
  const {
    app,
    autoUpdater,
    net,
    onReady,
    onManual,
    isNotified,
    markNotified,
    logger
  } = options;

  const disabled = { feedUrl: null, checkNow: () => {}, stop: () => {} };

  // Development runs and non-macOS platforms must stay completely quiet.
  if (process.platform !== 'darwin' || app.isPackaged !== true) {
    return disabled;
  }

  const feedUrl = buildFeedUrl({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion()
  });
  const headers = {
    'User-Agent': `LanLi/${app.getVersion()} (${process.platform}: ${process.arch})`
  };
  const log = (message) => {
    if (typeof logger === 'function') logger(message);
  };

  let stopped = false;
  let updateSeen = false;
  let updateName = '';
  let probePromise = null;
  let probeAttempted = false;
  let firstCheckTimer = null;
  let checkTimer = null;

  log(`feed ${feedUrl}`);
  autoUpdater.setFeedURL({ url: feedUrl, headers, serverType: 'default' });

  autoUpdater.on('checking-for-update', () => {
    probeAttempted = false;
    log('checking for update');
  });

  autoUpdater.on('update-available', () => {
    updateSeen = true;
    log('update available; downloading');
  });

  autoUpdater.on('update-not-available', () => {
    updateSeen = false;
    updateName = '';
    log('update not available');
  });

  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
    updateSeen = true;
    updateName = String(releaseName || '').trim();
    const key = `ready:${updateName || 'latest'}`;
    if (isNotified(key)) {
      log(`already announced ${key}`);
      return;
    }
    markNotified(key);
    log(`update downloaded: ${updateName || 'unknown release'}`);
    onReady({ name: updateName });
  });

  autoUpdater.on('error', (error) => {
    log(`update error: ${errorMessage(error)}`);
    void handleUpdateError();
  });

  async function probeFeedJson() {
    if (!net || typeof net.fetch !== 'function') return '';
    try {
      const response = await net.fetch(feedUrl, {
        headers,
        cache: 'no-store',
        signal: timeoutSignal(FEED_TIMEOUT_MS)
      });
      if (response.status !== 200) {
        log(`feed probe status ${response.status}`);
        return '';
      }
      const payload = await response.json();
      const name = payload && typeof payload.name === 'string'
        ? payload.name.trim()
        : '';
      return name || 'latest';
    } catch (error) {
      log(`feed probe failed: ${errorMessage(error)}`);
      return '';
    }
  }

  function announceManual(name) {
    const key = `manual:${name || app.getVersion()}`;
    if (isNotified(key)) {
      log(`manual notice already shown for ${key}`);
      return;
    }
    markNotified(key);
    log(`manual update notice for ${name || app.getVersion()}`);
    onManual({ name });
  }

  async function handleUpdateError() {
    if (stopped) return;

    // A known update plus an updater error almost always means Squirrel.Mac
    // could not verify/replace this unsigned build. Offer the manual download
    // once per release instead of repeating an error.
    if (updateSeen && updateName) {
      announceManual(updateName);
      return;
    }

    // Some unsigned builds fail before 'update-available' is emitted. Probe
    // the same JSON feed once to confirm a newer release really exists.
    if (probeAttempted) return;
    probeAttempted = true;
    if (!probePromise) probePromise = probeFeedJson();
    const name = await probePromise;
    probePromise = null;
    if (!name) return;

    updateSeen = true;
    updateName = name;
    announceManual(name);
  }

  function checkNow() {
    if (stopped) return;
    probeAttempted = false;
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      log(`checkForUpdates threw: ${errorMessage(error)}`);
      void handleUpdateError();
    }
  }

  firstCheckTimer = setTimeout(checkNow, FIRST_CHECK_DELAY_MS);
  checkTimer = setInterval(checkNow, CHECK_INTERVAL_MS);

  return {
    feedUrl,
    checkNow,
    stop() {
      stopped = true;
      if (firstCheckTimer) clearTimeout(firstCheckTimer);
      if (checkTimer) clearInterval(checkTimer);
      firstCheckTimer = null;
      checkTimer = null;
    }
  };
}

module.exports = {
  FIRST_CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
  FEED_TIMEOUT_MS,
  setupAutoUpdate
};
