'use strict';

const RESUME_DELAY_MS = 5000;
const RETRY_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

function createWeatherRefresher(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const refresh = typeof opts.refresh === 'function' ? opts.refresh : () => Promise.resolve(null);
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const setTimeoutFn = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const clearTimeoutFn = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
  const setIntervalFn = typeof opts.setInterval === 'function' ? opts.setInterval : setInterval;
  const clearIntervalFn = typeof opts.clearInterval === 'function' ? opts.clearInterval : clearInterval;

  let lastResult = null;
  let lastAt = 0;
  let resumeTimer = null;
  let retryTimer = null;

  function handleResult(result) {
    lastResult = result;
    lastAt = now();
    if (result && result.ok === false) {
      if (!retryTimer) {
        retryTimer = setIntervalFn(() => { run(true); }, RETRY_MS);
      }
    } else if (result && result.ok === true) {
      if (retryTimer) {
        clearIntervalFn(retryTimer);
        retryTimer = null;
      }
    }
  }

  function run(force) {
    return Promise.resolve(refresh(Boolean(force))).then((result) => {
      handleResult(result);
      return result;
    });
  }

  function onResume() {
    if (resumeTimer) clearTimeoutFn(resumeTimer);
    resumeTimer = setTimeoutFn(() => {
      resumeTimer = null;
      run(true);
    }, RESUME_DELAY_MS);
  }

  function onWindowShow() {
    if (!lastResult || lastResult.ok === false || now() - lastAt >= STALE_MS) {
      run(true);
      return true;
    }
    return false;
  }

  function isRetrying() {
    return Boolean(retryTimer);
  }

  function dispose() {
    if (resumeTimer) {
      clearTimeoutFn(resumeTimer);
      resumeTimer = null;
    }
    if (retryTimer) {
      clearIntervalFn(retryTimer);
      retryTimer = null;
    }
  }

  return { run, handleResult, onResume, onWindowShow, isRetrying, dispose };
}

module.exports = { createWeatherRefresher, RESUME_DELAY_MS, RETRY_MS, STALE_MS };
