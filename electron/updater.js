'use strict';

const { buildFeedUrl, interpretFeedProbe } = require('./update-feed');

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
    onStatus,
    isNotified,
    markNotified,
    logger
  } = options;

  const log = (message) => {
    if (typeof logger === 'function') logger(message);
  };

  function emitStatus(state, extra) {
    if (typeof onStatus !== 'function') return;
    try {
      onStatus({ state, ...extra });
    } catch (error) {
      log(`status callback failed: ${errorMessage(error)}`);
    }
  }

  const disabled = {
    feedUrl: null,
    checkNow(flags) {
      if (flags && flags.manual === true) {
        emitStatus('disabled', { manual: true });
      }
      return { state: 'disabled' };
    },
    stop: () => {}
  };

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

  let stopped = false;
  let updateSeen = false;
  let updateName = '';
  let probePromise = null;
  let probeAttempted = false;
  let firstCheckTimer = null;
  let checkTimer = null;
  let checkSource = 'auto';

  const isManualCheck = () => checkSource === 'manual';

  log(`feed ${feedUrl}`);
  autoUpdater.setFeedURL({ url: feedUrl, headers, serverType: 'default' });

  autoUpdater.on('checking-for-update', () => {
    probeAttempted = false;
    log('checking for update');
  });

  autoUpdater.on('update-available', () => {
    updateSeen = true;
    log('update available; downloading');
    emitStatus('downloading', { manual: isManualCheck() });
  });

  autoUpdater.on('update-not-available', () => {
    updateSeen = false;
    updateName = '';
    log('update not available');
    emitStatus('up-to-date', { manual: isManualCheck() });
  });

  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
    updateSeen = true;
    updateName = String(releaseName || '').trim();
    log(`update downloaded: ${updateName || 'unknown release'}`);
    // A downloaded update waits for the user to click 「重启更新」. Unlike the
    // one-time manual-download reminder, this notice must be shown again every
    // time the window opens until the app is actually replaced.
    onReady({ name: updateName });
    emitStatus('ready', { manual: isManualCheck(), name: updateName });
  });

  autoUpdater.on('error', (error) => {
    log(`update error: ${errorMessage(error)}`);
    void handleUpdateError({ manual: isManualCheck() });
  });

  async function probeFeed() {
    if (!net || typeof net.fetch !== 'function') return { state: 'error' };
    try {
      const response = await net.fetch(feedUrl, {
        headers,
        cache: 'no-store',
        signal: timeoutSignal(FEED_TIMEOUT_MS)
      });

      let payload = null;
      if (response.status === 200) {
        try {
          payload = await response.json();
        } catch (error) {
          log(`feed probe JSON parse failed: ${errorMessage(error)}`);
          return { state: 'error' };
        }
      } else if (response.status !== 204) {
        log(`feed probe status ${response.status}`);
      }

      return interpretFeedProbe(response.status, payload);
    } catch (error) {
      log(`feed probe failed: ${errorMessage(error)}`);
      return { state: 'error' };
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

  async function handleUpdateError(context) {
    if (stopped) return;

    const manual = Boolean(context && context.manual);

    // A known update plus an updater error almost always means Squirrel.Mac
    // could not verify/replace this unsigned build. Offer the manual download
    // once per release instead of repeating an error.
    if (updateSeen && updateName) {
      announceManual(updateName);
      emitStatus('manual', { manual, name: updateName });
      return;
    }

    // Some unsigned builds fail before 'update-available' is emitted. Probe
    // the same JSON feed once to confirm what the feed actually reports.
    if (probeAttempted) {
      emitStatus('error', { manual });
      return;
    }
    probeAttempted = true;
    if (!probePromise) probePromise = probeFeed();
    const result = await probePromise;
    probePromise = null;

    if (result && result.state === 'up-to-date') {
      updateSeen = false;
      updateName = '';
      log('feed probe indicates up-to-date after updater error');
      emitStatus('up-to-date', { manual });
      return;
    }

    if (!result || result.state !== 'manual' || !result.name) {
      emitStatus('error', { manual });
      return;
    }

    updateSeen = true;
    updateName = result.name;
    announceManual(result.name);
    emitStatus('manual', { manual, name: result.name });
  }

  function checkNow(flags) {
    const manual = Boolean(flags && flags.manual === true);
    if (stopped) return { state: 'error', stopped: true };

    checkSource = manual ? 'manual' : 'auto';
    probeAttempted = false;
    if (manual) emitStatus('checking', { manual: true });
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      log(`checkForUpdates threw: ${errorMessage(error)}`);
      void handleUpdateError({ manual });
      return { state: 'error' };
    }
    return { state: 'checking' };
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
