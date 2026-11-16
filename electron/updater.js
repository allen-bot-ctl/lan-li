'use strict';

const {
  buildFeedUrl,
  interpretFeedProbe,
  RELEASES_LATEST_URL
} = require('./update-feed');
const {
  deriveDmgUrl,
  extractVersion
} = require('./mac-self-update');

// The first check runs shortly after launch; later checks are deliberately
// infrequent so the app does not hammer GitHub.
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FEED_TIMEOUT_MS = 15 * 1000;

const FINAL_STATES = new Set(['up-to-date', 'manual', 'error']);

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

function noop() {}

// Wires Electron's built-in autoUpdater to the official update.electronjs.org
// feed. Squirrel.Mac is the thing that actually replaces the app; this module
// only decides what to tell the user when that cannot happen.
//
// Unsigned macOS builds cannot use Squirrel.Mac at all: setFeedURL itself
// throws "Could not get code signature for running application". In that case
// we enter probe-only mode and ask the same HTTP feed directly, which still
// answers "up-to-date" (204) or "a newer release exists" (200 JSON).
function setupAutoUpdate(options) {
  const {
    app,
    autoUpdater,
    net,
    onReady = noop,
    onManual = noop,
    onStatus,
    isNotified = () => false,
    markNotified = noop,
    selfUpdate = null,
    logger
  } = options;

  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const schedule = options.schedule !== false;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const probeTimeoutMs = Number.isFinite(options.probeTimeoutMs)
    ? options.probeTimeoutMs
    : FEED_TIMEOUT_MS;

  const log = (message) => {
    if (typeof logger === 'function') logger(message);
  };

  let stopped = false;

  function emitStatus(state, extra) {
    if (stopped) return;
    const manual = Boolean(extra && extra.manual === true);
    if (manual && FINAL_STATES.has(state)) {
      log(`manual check result: ${state}`);
    }
    if (typeof onStatus !== 'function') return;
    try {
      onStatus({ state, ...extra });
    } catch (error) {
      log(`status callback failed: ${errorMessage(error)}`);
    }
  }

  const disabled = {
    mode: 'disabled',
    setupError: null,
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
  if (platform !== 'darwin' || app.isPackaged !== true) {
    return disabled;
  }

  const version = app.getVersion();
  const feedUrl = buildFeedUrl({ platform, arch, version });
  const headers = {
    'User-Agent': `LanLi/${version} (${platform}: ${arch})`
  };

  let mode = 'squirrel';
  let setupError = null;
  let updateSeen = false;
  let updateName = '';
  let probePromise = null;
  let probeAttempted = false;
  let firstCheckTimer = null;
  let checkTimer = null;
  let checkSource = 'auto';

  const isManualCheck = () => checkSource === 'manual';

  function announceManual(name, url) {
    const key = `manual:${name || version}`;
    if (isNotified(key)) {
      log(`manual notice already shown for ${key}`);
      return;
    }
    markNotified(key);
    log(`manual update notice for ${name || version}`);
    try {
      onManual({ name, url });
    } catch (error) {
      log(`manual callback failed: ${errorMessage(error)}`);
    }
  }

  // The release page is only the last resort. When a version can be derived we
  // point "下载新版" directly at the DMG asset instead.
  function fallbackManualUrl(...candidates) {
    for (const candidate of candidates) {
      const parsed = extractVersion(candidate);
      if (parsed) {
        const dmgUrl = deriveDmgUrl(parsed);
        if (dmgUrl) return dmgUrl;
      }
    }
    return RELEASES_LATEST_URL;
  }

  async function runSelfUpdate(result, manual) {
    const name = result.name || updateName;
    emitStatus('downloading', { manual, name });

    let outcome;
    try {
      outcome = await selfUpdate.start({ name, url: result.url });
    } catch (error) {
      outcome = {
        ok: false,
        reason: errorMessage(error),
        version: extractVersion(name) || extractVersion(result.url)
      };
    }
    if (stopped) return;

    if (outcome && outcome.ok) {
      updateSeen = true;
      updateName = outcome.name || name;
      log(`self-update ready: ${updateName}`);
      // Keep the normal ready notice so the renderer's existing 「新版本已就绪
      // / 重启更新」 path is reused; the extra flag only switches the install
      // mechanism in the main process.
      try {
        onReady({ name: updateName, mode: 'ready-self' });
      } catch (error) {
        log(`ready callback failed: ${errorMessage(error)}`);
      }
      emitStatus('ready', {
        manual,
        name: updateName,
        selfUpdate: true
      });
      return;
    }

    const reason = outcome && outcome.reason ? outcome.reason : 'unknown';
    log(`self-update failed: ${reason}`);
    const url = fallbackManualUrl(
      outcome && outcome.version,
      name,
      result.url
    );
    announceManual(name, url);
    emitStatus('manual', { manual, name, url });
  }

  async function probeFeed() {
    if (!net || typeof net.fetch !== 'function') return { state: 'error' };
    try {
      const response = await net.fetch(feedUrl, {
        headers,
        cache: 'no-store',
        signal: timeoutSignal(probeTimeoutMs)
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

  // Concurrent manual clicks (and an automatic timer firing at the same time)
  // share one in-flight fetch. Each caller still emits its own final state.
  function startProbe() {
    if (!probePromise) {
      probePromise = probeFeed().then(
        (result) => {
          probePromise = null;
          return result;
        },
        (error) => {
          probePromise = null;
          log(`feed probe rejected: ${errorMessage(error)}`);
          return { state: 'error' };
        }
      );
    }
    return probePromise;
  }

  function applyProbeResult(result, manual) {
    if (stopped) return;

    if (result && result.state === 'up-to-date') {
      updateSeen = false;
      updateName = '';
      log('feed probe indicates up-to-date');
      emitStatus('up-to-date', { manual });
      return;
    }

    if (result && result.state === 'manual' && result.name) {
      updateSeen = true;
      updateName = result.name;

      // Probe-only mode on an unsigned macOS build can apply the release zip
      // itself. Preparation is async; 'downloading' gives the manual check
      // immediate feedback while automatic checks stay silent in main.js.
      if (result.url && selfUpdate && selfUpdate.available) {
        void runSelfUpdate(result, manual);
        return;
      }

      const url = fallbackManualUrl(result.name, result.url);
      announceManual(result.name, url);
      emitStatus('manual', { manual, name: result.name, url });
      return;
    }

    log('feed probe did not determine update status');
    emitStatus('error', { manual });
  }

  async function runProbeCheck(manual) {
    const result = await startProbe();
    applyProbeResult(result, manual);
  }

  function attachAutoUpdaterListeners() {
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
      try {
        onReady({ name: updateName });
      } catch (error) {
        log(`ready callback failed: ${errorMessage(error)}`);
      }
      emitStatus('ready', { manual: isManualCheck(), name: updateName });
    });

    autoUpdater.on('error', (error) => {
      log(`update error: ${errorMessage(error)}`);
      void handleUpdateError({ manual: isManualCheck() });
    });
  }

  log(`feed ${feedUrl}`);

  // An unsigned build makes setFeedURL throw before any 'error' event can
  // fire, so setup must survive it and fall back to probing the feed itself.
  try {
    autoUpdater.setFeedURL({ url: feedUrl, headers, serverType: 'default' });
    attachAutoUpdaterListeners();
  } catch (error) {
    setupError = error;
    mode = 'probe-only';
    log(
      `autoUpdater setup failed: ${errorMessage(error)}; ` +
      'entering probe-only mode'
    );
  }

  async function handleUpdateError(context) {
    if (stopped) return;

    const manual = Boolean(context && context.manual);

    // A known update plus an updater error almost always means Squirrel.Mac
    // could not verify/replace this build. Offer the manual download once per
    // release instead of repeating an error.
    if (updateSeen && updateName) {
      const url = fallbackManualUrl(updateName);
      announceManual(updateName, url);
      emitStatus('manual', { manual, name: updateName, url });
      return;
    }

    // Some unsigned builds fail before 'update-available' is emitted. Probe
    // the same JSON feed once to confirm what the feed actually reports.
    // Repeated errors while that probe is pending/done must not emit a second,
    // conflicting final state.
    if (probeAttempted) {
      log('ignoring repeated updater error; feed probe already attempted');
      return;
    }
    probeAttempted = true;

    const result = await startProbe();
    applyProbeResult(result, manual);
  }

  function checkNow(flags) {
    const manual = Boolean(flags && flags.manual === true);
    if (stopped) return { state: 'error', stopped: true };

    if (mode === 'probe-only') {
      log(`${manual ? 'manual' : 'automatic'} check start`);
      if (manual) emitStatus('checking', { manual: true });
      void runProbeCheck(manual);
      return { state: 'checking', mode };
    }

    checkSource = manual ? 'manual' : 'auto';
    probeAttempted = false;
    log(`${manual ? 'manual' : 'automatic'} check start`);
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

  if (schedule) {
    firstCheckTimer = setTimeoutFn(checkNow, FIRST_CHECK_DELAY_MS);
    checkTimer = setIntervalFn(checkNow, CHECK_INTERVAL_MS);
  }

  return {
    mode,
    setupError: setupError ? errorMessage(setupError) : null,
    feedUrl,
    checkNow,
    stop() {
      stopped = true;
      if (firstCheckTimer) clearTimeoutFn(firstCheckTimer);
      if (checkTimer) clearIntervalFn(checkTimer);
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
