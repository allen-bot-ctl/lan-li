'use strict';
// Manual capture alone treats a whole HTTP(S) URL as a link. Keep the original
// trimmed spelling; do not apply this rule to clipboard or drag/drop payloads.
function manualCaptureItem(text) {
  const url = text.trim();
  if (/^https?:\/\/[^\s]+$/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) return { kind: 'link', url };
    } catch { /* explanatory text and invalid URLs remain text */ }
  }
  return { kind: 'text', text };
}
module.exports = { manualCaptureItem };
