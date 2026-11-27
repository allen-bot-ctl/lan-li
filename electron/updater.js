'use strict';

const { buildFeedUrl, interpretFeedProbe } = require('./update-feed');

// The first check runs shortly after launch; later checks are deliberately
// infrequent so the app does not hammer GitHub.
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FEED_TIMEOUT_MS = 15 * 1000;

const FINAL_STATES = new Set(['up-to-date', 'error', 'download-error', 'prepare-error']);

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

function selfUpdateFailureState(reason) {
  return /^(zip-download|sha256-download|sha256-read)/.test(reason || '') ? 'download-error' : 'prepare-error';
}

function noop() {}

// Probes the official update.electronjs.org feed directly and, when a newer
// release exists, hands the release zip to the in-app self-updater. Squirrel.Mac
// is not used: the ad-hoc signed macOS builds cannot pass Squirrel.Mac's code
// signature check, so macOS always runs in probe-only mode instead of ever
// calling autoUpdater.setFeedURL.
function setupAutoUpdate(options) {
  const {
    app,
    net,
    onReady = noop,
    onStatus,
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

  let activeCheck = null;
  let readyNotice = null;
  let firstCheckTimer = null;
  let checkTimer = null;

  function finishCheck(job, state, extra = {}) {
    if (stopped || activeCheck !== job) return;
    // Clear before notifying: a retry from a result callback starts a fresh job.
    activeCheck = null;
    emitStatus(state, { manual: job.manual, ...extra });
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

  // One job owns both the feed probe and download. A manual click can join an
  // automatic check, but cannot start a second preparation or replay an error.
  async function runCheck(job) {
    try {
      const result = await probeFeed();
      if (stopped || activeCheck !== job) return;
      if (result?.state === 'up-to-date') {
        finishCheck(job, 'up-to-date');
        return;
      }
      if (result?.state !== 'manual' || !result.name) {
        finishCheck(job, 'error');
        return;
      }
      if (!result.url || !selfUpdate?.available) {
        log('in-app update unavailable or release URL missing');
        finishCheck(job, 'prepare-error');
        return;
      }
      job.state = 'downloading';
      emitStatus('downloading', { manual: job.manual, name: result.name });
      const outcome = await selfUpdate.start({ name: result.name, url: result.url });
      if (stopped || activeCheck !== job) return;
      if (!outcome?.ok) {
        log(`self-update failed: ${outcome?.reason || 'unknown'}`);
        finishCheck(job, selfUpdateFailureState(outcome?.reason));
        return;
      }
      readyNotice = { name: outcome.name || result.name, mode: 'ready-self' };
      log(`self-update ready: ${readyNotice.name}`);
      try { onReady(readyNotice); }
      catch (error) { log(`ready callback failed: ${errorMessage(error)}`); }
      finishCheck(job, 'ready', { name: readyNotice.name, selfUpdate: true });
    } catch (error) {
      log(`update check failed: ${errorMessage(error)}`);
      finishCheck(job, job.state === 'downloading' ? selfUpdateFailureState(errorMessage(error)) : 'error');
    }
  }

  log(`feed ${feedUrl}`);
  log('macOS 未正式签名，使用 probe-only');

  function checkNow(flags) {
    const manual = Boolean(flags && flags.manual === true);
    if (stopped) return { state: 'error', stopped: true };
    if (readyNotice) {
      emitStatus('ready', { manual, name: readyNotice.name, selfUpdate: true });
      return { state: 'ready', mode: 'probe-only' };
    }
    if (activeCheck) {
      activeCheck.manual ||= manual;
      if (manual) emitStatus(activeCheck.state, { manual: true });
      return { state: activeCheck.state, mode: 'probe-only' };
    }
    log(`${manual ? 'manual' : 'automatic'} check start`);
    const job = { manual, state: 'checking' };
    activeCheck = job;
    if (manual) emitStatus('checking', { manual: true });
    void runCheck(job);
    return { state: 'checking', mode: 'probe-only' };
  }

  if (schedule) {
    firstCheckTimer = setTimeoutFn(checkNow, FIRST_CHECK_DELAY_MS);
    checkTimer = setIntervalFn(checkNow, CHECK_INTERVAL_MS);
  }

  return {
    mode: 'probe-only',
    setupError: null,
    feedUrl,
    checkNow,
    // A failed installer must allow fresh preparation instead of replaying ready.
    invalidateReady() { readyNotice = null; },
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
