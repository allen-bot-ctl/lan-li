'use strict';

const MarkdownIt = require('markdown-it');
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

// This is only a receipt: it never mutates the stored title or body. Decode the
// leftover entities from formatted clipboard text once, then read tokens rather
// than render markup into the dialog.
function readableRichPreview(value) {
  const raw = String(value || '').slice(0, 512);
  const decoded = markdown.utils.unescapeAll(raw);
  const inline = markdown.parseInline(decoded, {})[0]?.children || [];
  return inline.map((token) => {
    if (token.type === 'text') return token.content.replace(/\*{2,}|_{2,}|~{2,}/g, '');
    if (token.type === 'code_inline') return token.content;
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
    return '';
  }).join('').replace(/&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, ' ');
}

function capturePreview(item) {
  const source = item.type === 'text' ? (item.preview || (!item.rich && item.title) || '') : (item.displayTitle || item.title || '');
  const value = (item.type === 'text' && item.rich ? readableRichPreview(source) : String(source))
    .replace(/[\s\u200B\uFEFF]+/gu, ' ').trim();
  if (item.type === 'text' && item.rich && !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(value)) return '';
  const chars = Array.from(value);
  return chars.length > 100 ? chars.slice(0, 100).join('').trimEnd() + '…' : value;
}

module.exports = { capturePreview };
