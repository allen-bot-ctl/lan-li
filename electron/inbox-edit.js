'use strict';

const crypto = require('node:crypto');
const MAX = 20000;
const revision = (meta, raw) => crypto.createHash('sha256').update(JSON.stringify([meta.title, meta.displayTitle, meta.note, meta.sourceUrl, meta.targetUrl, meta.previousUrl, meta.edit, raw])).digest('hex');
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_all, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
const textHtml = (s) => '<p>' + escape(s).replace(/\n/g, '<br>') + '</p>';
function plainSource(html) {
  return /^(?:<p>(?:[^<]|<br>)*<\/p>)(?:\n<p>(?:[^<]|<br>)*<\/p>)*$/.test(html) ?
    decode(html.slice(3, -4).replace(/<\/p>\n<p>/g, '\n\n').replace(/<br>/g, '\n')) : null;
}

function richParts(html, assets) {
  // Recognize only a small, structurally balanced subset. Never parse/serialize
  // unsupported source or allow attributes through edited fragments.
  if (assets.length || /<img\b/i.test(html)) return null;
  const chunks = html.match(/<[^>]*>|[^<]+/g) || [];
  if (chunks.join('') !== html) return null;
  const stack = [];
  const parts = [];
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk.startsWith('<')) {
      if (chunk !== '<br>' && chunk !== '<br/>') {
        const m = /^<(\/?)(p|b|strong|i|em|u|s|span|code|blockquote|ul|ol|li|h[1-6])>$/.exec(chunk) ||
          /^<(\/?)(a)(?: href="https?:\/\/[^"<>&\s]+")?>$/.exec(chunk);
        if (!m || (m[2] === 'a' && (m[1] ? chunk !== '</a>' : chunk === '<a>'))) return null;
        if (m[1]) { if (stack.pop() !== m[2]) return null; }
        else stack.push(m[2]);
      }
    } else if (chunk.trim()) {
      if (!stack.length) return null;
      if (/&(?!amp;|lt;|gt;|quot;|#39;)/.test(chunk)) return null;
      parts.push({ start: offset, end: offset + chunk.length, text: decode(chunk) });
    }
    offset += chunk.length;
  }
  return stack.length || !parts.length ? null : parts;
}

function editState(meta, original) {
  const html = meta.edit?.html ?? original;
  const assets = meta.assets || [];
  const text = meta.type === 'text' && !meta.rich && !assets.length ? (meta.edit?.text ?? plainSource(original)) : null;
  const parts = meta.type === 'text' && meta.rich ? richParts(html, assets) : null;
  return { html, text: text ?? null, parts, mode: text != null ? 'plain' : parts ? 'rich' : 'protected' };
}

function applyParts(html, parts, values) {
  if (!Array.isArray(values) || values.length !== parts.length ||
      values.some((s) => typeof s !== 'string' || /[\r\n]/.test(s)) ||
      values.reduce((n, s) => n + s.length, 0) > MAX) throw new Error('格式片段无效或内容过长');
  if (!values.some((s) => s.trim())) throw new Error('正文不能为空');
  let out = html;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (values[i] !== p.text) out = out.slice(0, p.start) + escape(values[i]) + out.slice(p.end);
  }
  return out;
}
module.exports = { MAX, revision, editState, applyParts, textHtml };
