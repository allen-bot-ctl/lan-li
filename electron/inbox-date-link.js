'use strict';

const readInboxDateLinkEnabled = (preferences) => preferences?.inboxDateLinkEnabled !== false;

function writeInboxDateLinkEnabled(preferences, value, persist) {
  const previous = readInboxDateLinkEnabled(preferences);
  if (typeof value !== 'boolean') return { ok: false, inboxDateLinkEnabled: previous };
  if (value === previous) return { ok: true, inboxDateLinkEnabled: previous };
  if (!persist({ ...preferences, inboxDateLinkEnabled: value })) return { ok: false, inboxDateLinkEnabled: previous };
  return { ok: true, inboxDateLinkEnabled: value };
}

module.exports = { readInboxDateLinkEnabled, writeInboxDateLinkEnabled };
