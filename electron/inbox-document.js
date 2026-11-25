'use strict';
const { getSchema } = require('@tiptap/core');
const { DOMParser, DOMSerializer } = require('@tiptap/pm/model');
const { parseHTML } = require('linkedom');
const { extensions } = require('./inbox-document-schema');
const schema = getSchema(extensions());
const ASSET = /^assets\/img-\d+\.(?:png|jpg|jpeg|gif|webp|heic|bmp|tiff|tif)$/i;
const TYPES = new Set(['doc','paragraph','heading','text','bulletList','orderedList','listItem','blockquote','codeBlock','horizontalRule','hardBreak','image']);
const MARKS = new Set(['bold','italic','underline','strike','code','link']);
const limited = (x, n) => typeof x === 'string' ? x.slice(0, n) : null;
const http = x => {
  try { const u = new URL(x); return /^https?:$/i.test(u.protocol) && !u.username && !u.password; }
  catch { return false; }
};

function normalize(input, assets = []) {
  if (!input || input.type !== 'doc') throw new Error('富文档格式不正确');
  const allow = new Set(assets.filter((x) => typeof x === 'string' && ASSET.test(x)));
  let count = 0;
  function node(x, depth = 0) {
    if (!x || !TYPES.has(x.type) || depth > 80 || ++count > 25000) throw new Error('富文档结构无法保存');
    const o = { type: x.type };
    const a = x.attrs || {};
    if (x.type === 'image') {
      let src = a.src;
      if (typeof src !== 'string' || !allow.has(src)) throw new Error('图片不是这条收纳的附件');
      if (a.attachmentId != null && a.attachmentId !== src) throw new Error('图片附件引用不一致');
      o.attrs = { src, attachmentId: src, alt: limited(a.alt, 500), title: limited(a.title, 500) };
    } else if (x.type === 'heading') o.attrs = { level: Number.isInteger(a.level) && a.level >= 1 && a.level <= 6 ? a.level : 1 };
    else if (x.type === 'orderedList') o.attrs = { start: Number.isSafeInteger(a.start) && a.start >= 0 && a.start <= 999999 ? a.start : 1 };
    if (x.type === 'text') {
      if (typeof x.text !== 'string' || !x.text) throw new Error('文字节点无效');
      o.text = x.text;
    }
    if (x.marks != null) {
      if (!Array.isArray(x.marks)) throw new Error('文字格式无效');
      o.marks = x.marks.flatMap(m => {
        if (!m || !MARKS.has(m.type)) throw new Error('不支持这种文字格式');
        if (m.type !== 'link') return [{ type: m.type }];
        const href = m.attrs?.href;
        return typeof href === 'string' && href.length <= 4096 && http(href) ?
          [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: limited(m.attrs.title, 500) } }] : [];
      });
    }
    if (x.content != null) {
      if (!Array.isArray(x.content)) throw new Error('富文档内容无效');
      o.content = x.content.map(c => node(c, depth + 1));
    }
    return o;
  }
  const canonical = node(input);
  if (Buffer.byteLength(JSON.stringify(canonical)) > 2 * 1024 * 1024) throw new Error('正文过长');
  const pm = schema.nodeFromJSON(canonical);
  pm.check();
  return pm.toJSON();
}
function importPlain(text) {
  return normalize({ type: 'doc', content: String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map(value => ({ type: 'paragraph', ...(value ? { content: [{ type: 'text', text: value }] } : {}) })) });
}
function importHtml(html, assets = [], aliases = Object.create(null)) {
  const allow = new Set(assets.filter(x => ASSET.test(String(x))));
  // Only use the asset filenames staged by the collector. Preserve adjacency
  // and never store a resource URL or embedded image payload in the document.
  const clean = String(html).replace(/<img\b[^>]*>/gi, tag => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const raw = src && (src[1] ?? src[2]);
    const path = allow.has(raw) ? raw : (raw && Object.hasOwn(aliases, raw) ? aliases[raw] : null);
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const text = (alt?.[1] ?? alt?.[2] ?? '').slice(0, 500).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    if (!allow.has(path)) return `<span>〔图片未能收纳${text ? '：' + text : ''}〕</span>`;
    return `<img src="${path}" data-attachment-id="${path}" alt="${text}">`;
  });
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const host = document.createElement('div');
  host.innerHTML = clean;
  // The schema stores images as blocks. Unwrap an image-only paragraph
  // before parsing so it doesn't become an extra empty text block.
  for (const p of host.querySelectorAll('p')) {
    const nodes = Array.from(p.childNodes).filter(n => n.nodeType !== 3 || !/^[\t\r\n ]*$/.test(n.textContent));
    if (nodes.length === 1 && nodes[0].nodeName === 'IMG') p.replaceWith(nodes[0]);
  }
  const raw = DOMParser.fromSchema(schema).parse(host).toJSON();
  if (!raw.content?.length) return importPlain('');
  return normalize(raw, assets);
}
function renderHtml(doc, assets) {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const host = document.createElement('div');
  host.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(schema.nodeFromJSON(normalize(doc, assets)).content, { document }));
  return host.innerHTML;
}
function plainText(doc) {
  const lines = n => n.type === 'text' ? n.text :
    n.type === 'hardBreak' ? '\n' : n.type === 'image' ? '' : (n.content || []).map(lines)
      .join(['doc','bulletList','orderedList','listItem','blockquote'].includes(n.type) ? '\n' : '');
  return lines(doc);
}
module.exports = { importHtml, importPlain, normalize, renderHtml, plainText };
