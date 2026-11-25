'use strict';

const LIMIT_IMAGE = 8 * 1024 * 1024;
const LIMIT_DRAFT = 24 * 1024 * 1024;
const LIMIT_COUNT = 12;
const MIME = /^image\/(png|jpeg)$/i;
const DATA = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/i;

function embeddedImage(raw) {
  if (typeof raw !== 'string' || raw.length > Math.ceil(LIMIT_IMAGE / 3) * 4 + 128) return null;
  const match = DATA.exec(raw);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  return bytes > 0 && bytes <= LIMIT_IMAGE ? { bytes, url: `data:${match[1].toLowerCase()};base64,${match[2]}` } : null;
}

function standaloneHttpLink(text) {
  if (typeof text !== 'string' || text.length > 4096 || !/^https?:\/\/[^\s]+$/i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname && !url.username && !url.password ? text : null;
  } catch { return null; }
}
module.exports = { LIMIT_IMAGE, LIMIT_DRAFT, LIMIT_COUNT, MIME, embeddedImage, standaloneHttpLink };
