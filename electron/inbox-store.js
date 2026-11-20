'use strict';
// 0.1.42 收纳：落盘模块（契约 docs/changes/0.1.42-inbox.md 第三～五节）。
// 纯 Node，fs/时间/缩略图可注入，便于单测。
//   <root>/<id>/meta.json
//     file : <原名>.symlink 软链接，meta.sourcePath 记原路径
//     image: original.<ext> + thumb.jpg（≤320px，由 makeThumb 生成，可无）
//     text : content.html（纯文本转义包 <p>；富文本清洗），内嵌图片 assets/img-N.<ext>
//     link : 只有 meta.json
// 写盘先写 <id>.tmp/ 再 rename；单次最多 50 项，单张图片 ≤ 50MB。
const path = require('node:path');
const nodeFs = require('node:fs');

const SCHEMA = 1;
const MAX_ITEMS = 50;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tiff', 'tif'];
const URL_RE = /^https?:\/\/\S+$/i;

class InboxError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function extOf(p) { return path.extname(String(p || '')).slice(1).toLowerCase(); }
function isImagePath(p) { return IMAGE_EXTS.includes(extOf(p)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function textToHtml(text) {
  return String(text).split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

// 去掉脚本、样式、内嵌框架、事件属性和 javascript: 链接。
function sanitizeHtml(html) {
  let h = String(html || '');
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  h = h.replace(/<(script|style|iframe|object|embed|noscript|template|meta|link|base|form)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  h = h.replace(/<\/?(script|style|iframe|object|embed|meta|link|base|form|input|button)\b[^>]*>/gi, '');
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  h = h.replace(/\s+(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '');
  h = h.replace(/\s+srcset\s*=\s*("[^"]*"|'[^']*')/gi, '');
  return h.trim();
}

function htmlToPlain(html) {
  return String(html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function imgSources(html) {
  const out = [];
  const re = /<img\b[^>]*\bsrc\s*=\s*("([^"]+)"|'([^']+)')/gi;
  let m;
  while ((m = re.exec(String(html || '')))) out.push(m[2] || m[3]);
  return out;
}

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

// 一次拖放的原始数据 → 要保存的条目列表（契约第三节）。
// drop: { files: [path], html, text, uriList: [url] }
function classifyDrop(drop) {
  const d = drop || {};
  const files = (d.files || []).filter(Boolean);
  if (files.length) return files.map((p) => ({ kind: isImagePath(p) ? 'image' : 'file', path: p }));
  const html = typeof d.html === 'string' ? d.html.trim() : '';
  const text = typeof d.text === 'string' ? d.text.trim() : '';
  const uris = (d.uriList || []).map((u) => String(u).trim()).filter((u) => u && !u.startsWith('#'));
  if (html) {
    const imgs = imgSources(html);
    const plain = htmlToPlain(html);
    // 浏览器里拖一张图：html 只有一个 img、没有文字
    if (imgs.length === 1 && !plain) return [{ kind: 'image', url: imgs[0] }];
    const onlyLink = /^<a\b[^>]*href\s*=\s*"(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>$/i.exec(html);
    if (onlyLink && !/<img\b/i.test(onlyLink[2])) return [{ kind: 'link', url: onlyLink[1], title: htmlToPlain(onlyLink[2]) || text }];
    if (plain || imgs.length) return [{ kind: 'text', html, text }];
  }
  const httpUris = uris.filter((u) => URL_RE.test(u));
  if (httpUris.length && (!text || httpUris.includes(text) || URL_RE.test(text) || (text.length <= 200 && !text.includes('\n')))) {
    return httpUris.map((u) => ({ kind: 'link', url: u, title: (text && text !== u && !URL_RE.test(text)) ? text : '' }));
  }
  if (text && URL_RE.test(text)) return [{ kind: 'link', url: text, title: '' }];
  if (text) return [{ kind: 'text', text }];
  return [];
}

function pad(n) { return String(n).padStart(2, '0'); }
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function createInboxStore(opts) {
  const o = opts || {};
  const fs = o.fs || nodeFs;
  const root = o.root;
  if (!root) throw new Error('inbox root required');
  const now = o.now || (() => new Date());
  const rand = o.rand || (() => Math.random().toString(36).slice(2, 6).padEnd(4, '0'));
  const makeThumb = o.makeThumb || null;   // (srcFile, destJpg) => void
  let lastMs = 0;

  function ensureRoot() { fs.mkdirSync(root, { recursive: true }); }

  function begin(type, fields) {
    ensureRoot();
    const d = now();
    const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand()}`;
    const tmp = path.join(root, id + '.tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const ms = Math.max(d.getTime(), lastMs + 1);
    lastMs = ms;
    const meta = Object.assign({
      id, type, title: '', createdAt: isoLocal(d), createdMs: ms, tags: [],
      sourcePath: null, sourceUrl: null, size: 0, ref: 'copy', missing: false, preview: '', schema: SCHEMA
    }, fields || {});
    return { id, tmp, meta };
  }

  function commit(entry) {
    fs.writeFileSync(path.join(entry.tmp, 'meta.json'), JSON.stringify(entry.meta, null, 2));
    fs.renameSync(entry.tmp, path.join(root, entry.id));
    return entry.meta;
  }

  function abort(entry) { try { fs.rmSync(entry.tmp, { recursive: true, force: true }); } catch { /* ignore */ } }

  function run(type, fields, fill) {
    const e = begin(type, fields);
    try { fill(e); return commit(e); } catch (error) { abort(e); throw error; }
  }

  function addFile(srcPath) {
    const st = fs.statSync(srcPath);
    const name = path.basename(srcPath);
    return run('file', { title: name, sourcePath: srcPath, size: st.isFile() ? st.size : 0, ref: 'symlink', file: name + '.symlink', isDir: st.isDirectory(), preview: path.dirname(srcPath) }, (e) => {
      fs.symlinkSync(srcPath, path.join(e.tmp, e.meta.file));
    });
  }

  // { path } 或 { buffer, ext, name, url }
  function addImage(input) {
    const i = typeof input === 'string' ? { path: input } : (input || {});
    const ext = (i.ext || extOf(i.path) || 'png').toLowerCase().replace('jpeg', 'jpg');
    const size = i.path ? fs.statSync(i.path).size : (i.buffer ? i.buffer.length : 0);
    if (size > MAX_IMAGE_BYTES) throw new InboxError('too-large', '图片超过 50MB');
    const title = i.name || (i.path ? path.basename(i.path) : (hostOf(i.url) ? `${hostOf(i.url)} 的图片` : '图片'));
    return run('image', { title, sourcePath: i.path || null, sourceUrl: i.url && !String(i.url).startsWith('data:') ? i.url : null, size, file: `original.${ext}`, preview: i.url ? hostOf(i.url) : '' }, (e) => {
      const dest = path.join(e.tmp, e.meta.file);
      if (i.path) fs.copyFileSync(i.path, dest); else fs.writeFileSync(dest, i.buffer);
      if (makeThumb) {
        try { makeThumb(dest, path.join(e.tmp, 'thumb.jpg')); if (fs.existsSync(path.join(e.tmp, 'thumb.jpg'))) e.meta.thumb = 'thumb.jpg'; } catch { /* 没缩略图也能用 */ }
      }
    });
  }

  // { text } 纯文本；{ html, images:[{ src, buffer, ext }] } 富文本
  function addText(input) {
    const i = typeof input === 'string' ? { text: input } : (input || {});
    let html = i.html ? sanitizeHtml(i.html) : textToHtml(i.text || '');
    const plain = i.html ? htmlToPlain(html) : String(i.text || '').trim();
    return run('text', { title: plain.split('\n')[0].slice(0, 60) || '图文', file: 'content.html', assets: [], rich: Boolean(i.html), preview: plain.replace(/\s+/g, ' ').slice(0, 120) }, (e) => {
      const imgs = i.images || [];
      if (imgs.length) fs.mkdirSync(path.join(e.tmp, 'assets'), { recursive: true });
      imgs.forEach((img, n) => {
        const file = `assets/img-${n + 1}.${(img.ext || 'png').toLowerCase()}`;
        fs.writeFileSync(path.join(e.tmp, file), img.buffer);
        e.meta.assets.push(file);
        if (img.src) html = html.split(img.src).join(file);
      });
      e.meta.size = Buffer.byteLength(html);
      fs.writeFileSync(path.join(e.tmp, 'content.html'), html);
    });
  }

  function addLink(url, title) {
    return run('link', { title: title || hostOf(url) || url, sourceUrl: url, preview: hostOf(url) }, () => {});
  }

  function save(item) {
    switch (item.kind) {
      case 'file': return addFile(item.path);
      case 'image': return addImage(item);
      case 'text': return addText(item);
      case 'link': return addLink(item.url, item.title);
      default: throw new InboxError('unsupported', 'unknown kind ' + item.kind);
    }
  }

  // 一次拖放全部保存；任一项失败则删掉本次已存的，整体报错。
  function saveAll(items) {
    if (!items || !items.length) throw new InboxError('empty', '没有可识别的内容');
    if (items.length > MAX_ITEMS) throw new InboxError('too-many', '一次最多 50 项');
    const saved = [];
    try {
      for (const it of items) saved.push(save(it));
    } catch (error) {
      for (const m of saved) remove(m.id);
      throw error;
    }
    return saved;
  }

  function checkMissing(meta) {
    if (meta.type !== 'file') return false;
    try { fs.realpathSync(path.join(root, meta.id, meta.file)); return false; } catch { return true; }
  }

  function list() {
    if (!fs.existsSync(root)) return [];
    const out = [];
    for (const id of fs.readdirSync(root)) {
      if (id.endsWith('.tmp')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8'));
        meta.missing = checkMissing(meta);
        out.push(meta);
      } catch { /* 跳过坏条目 */ }
    }
    return out.sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0) || (a.id < b.id ? 1 : -1));
  }

  function safeId(id) {
    if (!/^[\w-]+$/.test(String(id))) throw new InboxError('bad-id', 'bad id');
    return String(id);
  }

  function get(id) {
    const dir = path.join(root, safeId(id));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    meta.missing = checkMissing(meta);
    const res = { meta, dir };
    if (meta.file) res.filePath = path.join(dir, meta.file);
    if (meta.type === 'text') res.html = fs.readFileSync(path.join(dir, 'content.html'), 'utf8');
    return res;
  }

  function remove(id) { fs.rmSync(path.join(root, safeId(id)), { recursive: true, force: true }); }

  function setTags(id, tags) {
    const dir = path.join(root, safeId(id));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    meta.tags = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  // 启动时清掉上次崩溃留下的 .tmp
  function cleanup() {
    if (!fs.existsSync(root)) return;
    for (const id of fs.readdirSync(root)) if (id.endsWith('.tmp')) fs.rmSync(path.join(root, id), { recursive: true, force: true });
  }

  return { root, save, saveAll, addFile, addImage, addText, addLink, list, get, remove, setTags, cleanup };
}

// 渲染进程「松开即保存 · 3 个文件」里的类型描述
function describeItems(items) {
  const names = { file: '文件', image: '图片', text: '文字', link: '链接' };
  const counts = {};
  for (const it of items || []) counts[it.kind] = (counts[it.kind] || 0) + 1;
  const kinds = Object.keys(counts);
  if (!kinds.length) return '';
  if (kinds.length === 1) return `${counts[kinds[0]]} 个${names[kinds[0]] || '项目'}`;
  return `${(items || []).length} 项`;
}

module.exports = {
  createInboxStore, classifyDrop, describeItems, sanitizeHtml, htmlToPlain, textToHtml, imgSources, isImagePath,
  InboxError, MAX_ITEMS, MAX_IMAGE_BYTES, IMAGE_EXTS
};
