'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const LOG_FILE_NAME = 'main.log';
const OLD_LOG_FILE_NAME = 'main.old.log';

function defaultLogsPath() {
  // Required lazily so this module can be loaded before Electron's app is
  // ready (and so tests can inject a temporary directory instead).
  const { app } = require('electron');
  return app.getPath('logs');
}

// A deliberately small file logger. Electron's app.getPath('logs') points at
// ~/Library/Logs/栏历 on macOS, so updates can be diagnosed by asking the user
// to send main.log. Any filesystem failure is swallowed: logging must never be
// able to crash the app.
function createLogger(options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : DEFAULT_MAX_BYTES;
  const getLogsPath = typeof options.getPath === 'function'
    ? options.getPath
    : defaultLogsPath;

  let logFile = null;

  function resolveLogFile() {
    if (logFile) return logFile;
    try {
      const directory = getLogsPath();
      if (typeof directory !== 'string' || directory.trim() === '') {
        return null;
      }
      logFile = path.join(directory, LOG_FILE_NAME);
      return logFile;
    } catch {
      // app.getPath can fail before app ready. Keep retrying on later writes
      // instead of permanently disabling the file log.
      return null;
    }
  }

  function rotateIfNeeded(file) {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    if (size <= maxBytes) return;

    const oldFile = path.join(path.dirname(file), OLD_LOG_FILE_NAME);
    try {
      fs.renameSync(file, oldFile);
    } catch {
      // Some filesystems refuse to rename over an existing file. Remove the
      // old log and try once more; a failure here is still non-fatal.
      try {
        fs.unlinkSync(oldFile);
      } catch {
        // Already absent.
      }
      fs.renameSync(file, oldFile);
    }
  }

  function write(level, message) {
    const text = message === undefined || message === null
      ? ''
      : String(message);
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;

    const consoleMethod = level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
    consoleMethod(line.trimEnd());

    const file = resolveLogFile();
    if (!file) return;

    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      rotateIfNeeded(file);
      fs.appendFileSync(file, line, 'utf8');
    } catch {
      // The console already has the message; never throw from the logger.
    }
  }

  return {
    log(message) {
      write('info', message);
    },
    info(message) {
      write('info', message);
    },
    warn(message) {
      write('warn', message);
    },
    error(message) {
      write('error', message);
    },
    get path() {
      return resolveLogFile();
    }
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  LOG_FILE_NAME,
  OLD_LOG_FILE_NAME,
  createLogger
};
