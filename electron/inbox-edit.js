'use strict';

const crypto = require('node:crypto');
const MAX = 20000;
const revision = (meta, raw) => crypto.createHash('sha256').update(JSON.stringify([meta.title, meta.displayTitle, meta.note, meta.sourceUrl, meta.targetUrl, meta.previousUrl, meta.edit, raw])).digest('hex');
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_all, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' }[e]));
const textHtml = (s) => '<p>' + escape(s).replace(/\n/g, '<br>') + '</p>';
function plainSource(html) {
  return /^(?:<p>(?:[^<]|<br>)*<\/p>)(?:\n<p>(?:[^<]|<br>)*<\/p>)*$/.test(html) ?
    decode(html.slice(3, -4).replace(/<\/p>\n<p>/g, '\n\n').replace(/<br>/g, '\n')) : null;
}

const TAGS = /^(?:div|p|b|strong|i|em|u|s|span|font|code|blockquote|ul|ol|li|h[1-6]|a|br)$/;
const STYLE = /^(?:font(?:-family|-size|-weight|-style|-variant)?|color|background-color|text-align|text-indent|text-decoration(?:-line|-color|-style)?|white-space|line-height|letter-spacing|vertical-align|margin(?:-top|-right|-bottom|-left)?|padding(?:-top|-right|-bottom|-left)?)$/;
function safeStyle(value) {
  return value.split(';').filter((part) => part.trim()).every((part) => {
    const colon = part.indexOf(':');
    const name = part.slice(0, colon).trim().toLowerCase();
    const v = part.slice(colon + 1).trim();
    return colon > 0 && STYLE.test(name) && /^(?:[\w#.,% +"'!-]+|(?:rgba?|hsla?)\([0-9.,% +\/-]+\))$/i.test(v);
  });
}
function safeAttrs(tag, input) {
  let remaining = input.trim();
  const seen = new Set();
  while (remaining) {
    const m = /^([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')(?:\s+|$)/i.exec(remaining);
    if (!m) return false;
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3];
    if (seen.has(name)) return false;
    seen.add(name);
    if (!(name === 'class' && /^[a-z0-9_ -]*$/i.test(value) ||
          name === 'style' && safeStyle(value) ||
          name === 'dir' && /^(?:ltr|rtl|auto)$/.test(value) ||
          name === 'lang' && /^[a-z0-9-]+$/i.test(value) ||
          tag === 'a' && name === 'href' && /^https?:\/\/[^<>"'\s]+$/i.test(value) ||
          tag === 'font' && /^(?:face|color|size)$/.test(name) && /^[\w#.,% +-]+$/.test(value))) return false;
    remaining = remaining.slice(m[0].length);
  }
  return tag !== 'a' || seen.has('href');
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
      const m = /^<(\/?)([a-z][a-z0-9]*)([^>]*)>$/i.exec(chunk);
      if (!m) return null;
      const tag = m[2].toLowerCase();
      const attrs = m[3];
      if (!TAGS.test(tag)) return null;
      if (m[1]) {
        if (attrs.trim() || stack.pop() !== tag) return null;
      } else if (tag === 'br') {
        if (!safeAttrs(tag, attrs.replace(/\/$/, ''))) return null;
      } else {
        if (!safeAttrs(tag, attrs)) return null;
        stack.push(tag);
      }
    } else if (chunk.trim()) {
      if (!stack.length) return null;
      if (/&(?!amp;|lt;|gt;|quot;|#39;|nbsp;)/.test(chunk)) return null;
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
  if (values.some((s, i) => s !== parts[i].text && !s.trim())) throw new Error('可改其它片段，但不能清空单个格式片段');
  let out = html;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (values[i] !== p.text) out = out.slice(0, p.start) + escape(values[i]) + out.slice(p.end);
  }
  return out;
}
module.exports = { MAX, revision, editState, applyParts, textHtml };
