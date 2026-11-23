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
const Q = require('./renderer/inbox-query');
const { createTagLibrary, TAGS_FILE } = require('./tag-library');

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

// 行内标签（<b> 等）直接去掉，不换成空格，免得「本周完成<b>收纳</b>功能」变成「本周完成 收纳 功能」
function stripInline(html) {
  return String(html || '').replace(/<\/?(b|i|u|s|em|strong|span|a|code|mark|small|sub|sup|font)\b[^>]*>/gi, '');
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
function fileUrlToPath(u) {
  const s = String(u || '').trim();
  if (!/^file:\/\//i.test(s)) return '';
  try { return decodeURIComponent(new URL(s).pathname).replace(/\/$/, '') || ''; } catch { return ''; }
}

function classifyDrop(drop) {
  const d = drop || {};
  let files = (d.files || []).filter(Boolean);
  // 0.1.48 兜底：路径没取到时，从 uri-list 里的 file:// 还原本地路径
  if (!files.length) files = (d.uriList || []).map(fileUrlToPath).filter(Boolean);
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

// 0.1.49 剪贴板判型：文件 → 图片 → 图文 → 链接 → 文字。
// c = { files:[path], image:{ buffer, ext }|null, html, text }
function classifyClipboard(c) {
  const d = c || {};
  const files = (d.files || []).filter(Boolean);
  if (files.length) return files.map((p) => ({ kind: isImagePath(p) ? 'image' : 'file', path: p }));
  const html = typeof d.html === 'string' ? d.html.trim() : '';
  const text = typeof d.text === 'string' ? d.text.trim() : '';
  const htmlPlain = html ? htmlToPlain(html) : '';
  // 只复制了一张图：剪贴板里有位图，html 为空或只是一个 <img>，没有文字
  if (d.image && d.image.buffer && d.image.buffer.length && !htmlPlain && !text) {
    return [{ kind: 'image', buffer: d.image.buffer, ext: d.image.ext || 'png', name: '剪贴板图片' }];
  }
  if (html) {
    const r = classifyDrop({ html, text });
    if (r.length) return r;
  }
  if (text) return classifyDrop({ text });
  return [];
}

// 0.1.49 收纳成功提示里的类型名
function captureLabel(items) {
  const list = items || [];
  if (list.some((i) => i.kind === 'file' || (i.kind === 'image' && i.path))) return `${list.length} 个文件`;
  if (list.length > 1) return `${list.length} 项`;
  const it = list[0] || {};
  if (it.kind === 'image') return '图片';
  if (it.kind === 'link') return '链接';
  if (it.kind === 'text') return it.html ? '图文' : '文字';
  return '内容';
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
  let extraFields = null;   // 0.1.49：本次保存统一附加的 meta（via / sourceApp）

  function ensureRoot() { fs.mkdirSync(root, { recursive: true }); }
  // 0.1.56：标签库，条目 meta.tags 只存 ID。
  const tags = createTagLibrary({ root, fs, now: () => now().getTime(), randomId: o.randomTagId });

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
    }, extraFields || {}, fields || {});
    return { id, tmp, meta };
  }

  function commit(entry) {
    fs.writeFileSync(path.join(entry.tmp, 'meta.json'), JSON.stringify(entry.meta, null, 2));
    fs.renameSync(entry.tmp, path.join(root, entry.id));
    stale = true;
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
    const plain = i.html ? htmlToPlain(stripInline(html)) : String(i.text || '').trim();
    const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean);
    const rich = Boolean(i.html);
    const fields = { title: (lines[0] || '').slice(0, rich ? 40 : 60) || (rich ? '图文' : '文字'), file: 'content.html', assets: [], rich, preview: plain.replace(/\s+/g, ' ').slice(0, 120), rest: lines.slice(1).join(' ').replace(/\s+/g, ' ').slice(0, 60) };
    return run('text', fields, (e) => {
      const imgs = i.images || [];
      if (imgs.length) fs.mkdirSync(path.join(e.tmp, 'assets'), { recursive: true });
      imgs.forEach((img, n) => {
        const file = `assets/img-${n + 1}.${(img.ext || 'png').toLowerCase()}`;
        fs.writeFileSync(path.join(e.tmp, file), img.buffer);
        e.meta.assets.push(file);
        if (img.src) html = html.split(img.src).join(file);
      });
      if (e.meta.assets.length && makeThumb) {
        try { makeThumb(path.join(e.tmp, e.meta.assets[0]), path.join(e.tmp, 'thumb.jpg')); if (fs.existsSync(path.join(e.tmp, 'thumb.jpg'))) e.meta.thumb = 'thumb.jpg'; } catch { /* 没缩略图也能用 */ }
      }
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
  function saveAll(items, extra) {
    if (!items || !items.length) throw new InboxError('empty', '没有可识别的内容');
    if (items.length > MAX_ITEMS) throw new InboxError('too-many', '一次最多 50 项');
    const saved = [];
    extraFields = extra || null;
    try {
      for (const it of items) saved.push(save(it));
    } catch (error) {
      for (const m of saved) remove(m.id);
      throw error;
    } finally {
      extraFields = null;
    }
    return saved;
  }

  function checkMissing(meta) {
    if (meta.type !== 'file') return false;
    try { fs.realpathSync(path.join(root, meta.id, meta.file)); return false; } catch { return true; }
  }

  // B 段：index.json 缓存（随时可由各条 meta.json 重建）。文字条目额外存正文纯文本 body 供检索。
  const INDEX = 'index.json';
  const TRASH = '.trash';
  let cache = null;
  let stale = false;

  function scanMetas() {
    if (!fs.existsSync(root)) return [];
    const out = [];
    for (const id of fs.readdirSync(root)) {
      if (id.endsWith('.tmp') || id.startsWith('.') || id === INDEX || id === TAGS_FILE) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8'));
        if (meta.type === 'text') {
          try { meta.body = htmlToPlain(stripInline(fs.readFileSync(path.join(root, id, 'content.html'), 'utf8'))).slice(0, 5000); } catch { /* 没正文 */ }
        }
        out.push(meta);
      } catch { /* 跳过坏条目 */ }
    }
    return out;
  }

  function writeIndex(entries) {
    cache = entries;
    try { ensureRoot(); fs.writeFileSync(path.join(root, INDEX), JSON.stringify({ schema: SCHEMA, entries })); } catch { /* 只是缓存 */ }
  }

  function rebuildIndex() { const e = scanMetas(); writeIndex(e); return e; }

  function dirIds() {
    return fs.readdirSync(root).filter((id) => !id.endsWith('.tmp') && !id.startsWith('.') && id !== INDEX && id !== TAGS_FILE).sort().join('|');
  }
  const idsOf = (entries) => entries.map((m) => m.id).sort().join('|');

  // 内存缓存 → index.json → 由 meta.json 重建；条目目录有增删（含外部改动）时自动重建。
  function readIndex() {
    const ids = fs.existsSync(root) ? dirIds() : '';
    if (cache && !stale && idsOf(cache) === ids) return cache;
    if (cache || stale) { stale = false; return rebuildIndex(); }
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, INDEX), 'utf8'));
      if (j && Array.isArray(j.entries) && idsOf(j.entries) === ids) { cache = j.entries; return cache; }
    } catch { /* 丢了或坏了就重建 */ }
    return rebuildIndex();
  }

  function invalidate() { cache = null; rebuildIndex(); }

  function list() {
    if (!fs.existsSync(root)) return [];
    const out = readIndex().map((m) => resolveTags({ ...m, missing: checkMissing(m) }));
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
    resolveTags(meta);
    const res = { meta, dir };
    if (meta.file) res.filePath = path.join(dir, meta.file);
    if (meta.type === 'text') res.html = fs.readFileSync(path.join(dir, 'content.html'), 'utf8');
    return res;
  }

  function remove(id) { fs.rmSync(path.join(root, safeId(id)), { recursive: true, force: true }); invalidate(); }

  function readMeta(id) {
    const dir = path.join(root, safeId(id));
    return { dir, meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) };
  }
  function writeMeta(dir, meta) {
    const m = { ...meta }; delete m.body;
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m, null, 2));
    invalidate();
    return m;
  }

  // 0.1.56：对外 meta.tags 是名字（渲染层显示、检索、筛选照旧），meta.tagIds 是 ID；
  // 磁盘上 meta.tags 只存 ID。库里已删除的 ID 不显示。
  function resolveTags(meta) {
    const ids = (meta.tags || []).filter((id) => tags.byId(id));
    meta.tagIds = ids;
    meta.tags = ids.map((id) => tags.nameOf(id));
    return meta;
  }

  function writeMetaAtomic(dir, meta) {
    const file = path.join(dir, 'meta.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, file);
  }

  function idsForNames(names) {
    const clean = Q.cleanTags(names);   // 长度、条数校验（超限抛 tag-limit / tag-too-long）
    const out = [];
    for (const n of clean) { const id = tags.ensure(n).id; if (!out.includes(id)) out.push(id); }
    return out;
  }

  // 每条最多 5 个标签，单个最长 8 字（超限抛 tag-limit / tag-too-long）。
  function setTags(id, names) {
    const { dir, meta } = readMeta(id);
    meta.tags = idsForNames(names);
    return resolveTags(writeMeta(dir, meta));
  }

  // 弹层输入：按查重规则复用已有标签，没有才新建。
  function addTag(id, name) {
    const { dir, meta } = readMeta(id);
    const ids = (meta.tags || []).filter((t) => tags.byId(t));
    Q.addTag([], name);   // 空、超长校验
    const existing = tags.byName(name);
    if (existing && ids.includes(existing.id)) return resolveTags(writeMeta(dir, { ...meta, tags: ids }));
    if (ids.length >= Q.MAX_TAGS) { const e = new Error(`每条最多 ${Q.MAX_TAGS} 个标签`); e.code = 'tag-limit'; throw e; }
    const tagId = existing ? existing.id : tags.ensure(name).id;
    meta.tags = [...ids, tagId];
    return resolveTags(writeMeta(dir, meta));
  }

  function removeTagFromItem(id, tagIdOrName) {
    const { dir, meta } = readMeta(id);
    const t = tags.byId(tagIdOrName) || tags.byName(tagIdOrName);
    if (!t) return resolveTags(meta);
    meta.tags = (meta.tags || []).filter((x) => x !== t.id);
    return resolveTags(writeMeta(dir, meta));
  }

  function tagUsage(tagId) {
    let n = 0;
    for (const m of scanMetas()) if ((m.tags || []).includes(tagId)) n += 1;
    return n;
  }

  // 标签管理列表：按创建顺序，带使用条数。
  function listTags() {
    const counts = new Map();
    for (const m of readIndex()) for (const id of m.tags || []) counts.set(id, (counts.get(id) || 0) + 1);
    return tags.list().map((t) => ({ ...t, count: counts.get(t.id) || 0 }));
  }

  function createTag(name) { const t = tags.create(name); invalidate(); return t; }
  // 改名只改 tags.json，不碰任何 meta.json。
  function renameTag(tagId, name) { const t = tags.rename(tagId, name); cache = null; return t; }

  // 删除标签 = 从库里删掉 + 从所有条目的 meta.tags 去掉这个 ID；条目本身保留。
  // 参数可以是 ID，也可以是名字（收纳页右键传名字）。返回受影响条数。
  function deleteTag(tagIdOrName) {
    const t = tags.byId(tagIdOrName) || tags.byName(tagIdOrName);
    if (!t) return 0;
    let n = 0;
    for (const m of scanMetas()) {
      if (!(m.tags || []).includes(t.id)) continue;
      const dir = path.join(root, m.id);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      meta.tags = (meta.tags || []).filter((x) => x !== t.id);
      writeMetaAtomic(dir, meta);
      n += 1;
    }
    tags.remove(t.id);
    invalidate();
    return n;
  }
  const removeTagEverywhere = deleteTag;

  // 0.1.56 迁移（启动时调用，幂等）：
  //  1. 没有 tags.json → 建库并放入 备忘、重要、临时（老用户也补，重名复用）；
  //  2. 条目里的字符串标签查库（没有就新建）后换成 ID；改写前先把原 meta.json 备份成 meta.json.bak-0156（只备份一次）；
  //  3. 单条失败不影响其它条，原文件保持不动（先写 tmp 再 rename）。
  function migrateTags() {
    const report = { seeded: false, migrated: 0, failed: 0 };
    if (!fs.existsSync(root)) ensureRoot();
    report.seeded = tags.seedIfNew();
    for (const id of fs.readdirSync(root)) {
      if (id.endsWith('.tmp') || id.startsWith('.') || id === INDEX || id === TAGS_FILE) continue;
      const dir = path.join(root, id);
      const file = path.join(dir, 'meta.json');
      let meta;
      try { meta = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      const raw = Array.isArray(meta.tags) ? meta.tags : [];
      if (raw.every((t) => tags.byId(t))) continue;
      try {
        const ids = [];
        for (const t of raw) {
          const tid = tags.byId(t) ? t : (String(t).trim() ? tags.ensure(String(t).slice(0, 64)).id : null);
          if (tid && !ids.includes(tid)) ids.push(tid);
        }
        const bak = path.join(dir, 'meta.json.bak-0156');
        if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
        writeMetaAtomic(dir, { ...meta, tags: ids.slice(0, Q.MAX_TAGS) });
        report.migrated += 1;
      } catch {
        report.failed += 1;
      }
    }
    if (report.migrated) invalidate();
    return report;
  }

  // 删除可撤销：先挪进 .trash/<id>，5 秒后由调用方 purge；撤销则 restore。
  function trash(id) {
    const sid = safeId(id);
    fs.mkdirSync(path.join(root, TRASH), { recursive: true });
    const dest = path.join(root, TRASH, sid);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(path.join(root, sid), dest);
    invalidate();
    return true;
  }
  function restore(id) {
    const sid = safeId(id);
    const src = path.join(root, TRASH, sid);
    if (!fs.existsSync(src)) return false;
    fs.renameSync(src, path.join(root, sid));
    invalidate();
    return true;
  }
  function purge(id) {
    if (id) { fs.rmSync(path.join(root, TRASH, safeId(id)), { recursive: true, force: true }); return; }
    fs.rmSync(path.join(root, TRASH), { recursive: true, force: true });
  }

  // 失联条目「重新指定原文件…」：重建软链接，更新 sourcePath，清 missing。
  function relink(id, newPath) {
    const { dir, meta } = readMeta(id);
    if (meta.type !== 'file') throw new InboxError('unsupported', 'not a file entry');
    const st = fs.statSync(newPath);
    const link = path.join(dir, meta.file);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(newPath, link);
    meta.sourcePath = newPath;
    meta.size = st.isFile() ? st.size : 0;
    meta.isDir = st.isDirectory();
    meta.preview = path.dirname(newPath);
    meta.missing = false;
    return writeMeta(dir, meta);
  }

  // 启动时清掉上次崩溃留下的 .tmp 和没来得及清的 .trash
  function cleanup() {
    if (!fs.existsSync(root)) return;
    for (const id of fs.readdirSync(root)) if (id.endsWith('.tmp')) fs.rmSync(path.join(root, id), { recursive: true, force: true });
    purge();
  }

  return { root, tags, save, saveAll, addFile, addImage, addText, addLink, list, get, remove, setTags, addTag, removeTagFromItem, removeTagEverywhere,
    listTags, createTag, renameTag, deleteTag, tagUsage, migrateTags, trash, restore, purge, relink, cleanup, rebuildIndex, readIndex };
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
  createInboxStore, classifyDrop, classifyClipboard, captureLabel, describeItems, sanitizeHtml, htmlToPlain, textToHtml, imgSources, isImagePath,
  InboxError, MAX_ITEMS, MAX_IMAGE_BYTES, IMAGE_EXTS
};
