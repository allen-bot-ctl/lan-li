'use strict';

const TOOL = 'deepseek_web_search';
function isDeepSeekWebSearchSupported(baseURL, model) {
  // String allowlist also rejects credentials, query, fragments, ports, and path normalization traps.
  return model === 'deepseek-flash' && typeof baseURL === 'string' &&
    /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/i.test(baseURL) && !baseURL.includes('/V1');
}

function safeSources(entries, secret) {
  const list = [];
  const seen = new Set();
  if (!Array.isArray(entries)) return list;
  for (const item of entries.slice(0, 50)) {
    if (list.length >= 8) break;
    if (typeof item?.url !== 'string' || item.url.length > 2048 ||
        !/^https?:\/\//i.test(item.url) || /[\u0000-\u0020\u007f]/.test(item.url)) continue;
    let parsed;
    try { parsed = new URL(item.url); } catch { continue; }
    const url = parsed.href;
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2048 || seen.has(url) ||
        (secret && (url.includes(secret) || url.includes(encodeURIComponent(secret))))) continue;
    let title = (typeof item.title === 'string' ? item.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,180) : '') || parsed.hostname;
    if (secret && title.includes(secret)) title = parsed.hostname;
    seen.add(url);
    list.push({url,title});
  }
  return list;
}

const STATES = new Set(['used','failed','not-used','unknown']);
function normalizeStoredSearch(value) {
  if (!STATES.has(value?.status)) return undefined;
  return {status:value.status,sources:value.status === 'used' ? safeSources(value.sources) : []};
}

function searchMetadata(message, secret) {
  const steps = message?.server_tool_calls;
  let used = false;
  let failed = false;
  let unresolved = false;
  if (Array.isArray(steps)) for (const step of steps.slice(0,50)) {
    if (!Array.isArray(step?.calls)) { unresolved = true; continue; }
    if (step.calls.length > 50) unresolved = true;
    for (const call of step.calls.slice(0,50)) {
      if (call?.type !== TOOL) continue;
      if (call.status === 'completed') used = true;
      else if (call.status === 'failed') failed = true;
      else unresolved = true;
    }
  }
  const status = used ? 'used' : failed ? 'failed' :
    Array.isArray(steps) && !unresolved && steps.length <= 50 ? 'not-used' : 'unknown';
  const annotations = Array.isArray(message?.annotations) ? message.annotations.slice(0,50) : [];
  return {
    status,
    sources: used ? safeSources(annotations.filter(x=>x?.type==='url_citation').map(x=>x.url_citation),secret) : []
  };
}
module.exports = { TOOL, isDeepSeekWebSearchSupported, searchMetadata, normalizeStoredSearch };
