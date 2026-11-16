'use strict';

// Formats the application version for the compact footer label. This module
// is intentionally dependency-free so it can be required by `node --test`
// without Electron.
function formatVersionLabel(version) {
  if (typeof version !== 'string') return '';

  let text = version.trim();
  if (!text) return '';

  if (text[0] === 'v' || text[0] === 'V') {
    text = text.slice(1).trim();
  }
  if (!text) return '';

  // Reject obvious non-versions such as words without any digit. Keep the
  // accepted shape permissive enough for prerelease/build suffixes.
  if (!/^[0-9][0-9A-Za-z.+-]*$/.test(text)) return '';

  return 'v' + text;
}

module.exports = {
  formatVersionLabel
};
