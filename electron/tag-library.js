'use strict';
// 0.1.56 标签库（契约 docs/changes/0.1.56-tag-manager.md B 段）。
// <inbox root>/tags.json：{ version:1, tags:[{ id:'t_xxxxxxxx', name, createdMs }] }
// 条目 meta.tags 只存 ID；显示、筛选一律通过 ID 查名字。纯 Node，fs/时间/随机可注入。
const path = require('node:path');
const nodeFs = require('node:fs');
const crypto = require('node:crypto');

const FILE = 'tags.json';
const VERSION = 1;
const DEFAULT_TAGS = ['备忘', '重要', '临时'];
const MAX_TAG_LEN = 8;

class TagError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); }
}

// 显示用名字：去首尾空格、去开头的 #。
function cleanName(name) { return String(name == null ? '' : name).trim().replace(/^#+/, '').trim(); }
// 查重键：cleanName + NFKC（全角转半角）+ 英文不分大小写。
function tagKey(name) { return cleanName(name).normalize('NFKC').trim().replace(/^#+/, '').trim().toLowerCase(); }

function validName(name) {
  const n = cleanName(name);
  if (!n) throw new TagError('tag-empty', '标签不能为空');
  if ([...n].length > MAX_TAG_LEN) throw new TagError('tag-too-long', `标签最多 ${MAX_TAG_LEN} 个字`);
  return n;
}

function createTagLibrary(opts) {
  const o = opts || {};
  const root = o.root;
  const fs = o.fs || nodeFs;
  const now = o.now || (() => Date.now());
  const randomId = o.randomId || (() => 't_' + crypto.randomBytes(4).toString('hex'));
  const file = path.join(root, FILE);
  let data = null;

  function exists() { return fs.existsSync(file); }

  function load() {
    if (data) return data;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      data = { version: VERSION, tags: Array.isArray(j.tags) ? j.tags.filter((t) => t && t.id && t.name) : [] };
    } catch {
      data = { version: VERSION, tags: [] };
    }
    return data;
  }

  function persist() {
    fs.mkdirSync(root, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
    fs.renameSync(tmp, file);
  }

  function list() { return load().tags.map((t) => ({ ...t })); }
  function byId(id) { return load().tags.find((t) => t.id === id) || null; }
  function byName(name) { const k = tagKey(name); return k ? (load().tags.find((t) => tagKey(t.name) === k) || null) : null; }
  function nameOf(id) { const t = byId(id); return t ? t.name : null; }

  function newId() {
    let id = randomId();
    while (byId(id)) id = randomId();
    return id;
  }

  function insert(name) {
    const tag = { id: newId(), name, createdMs: now() };
    load().tags.push(tag);
    return tag;
  }

  // 新增：重复则抛 tag-duplicate（带 existing 名字）。
  function create(name) {
    const n = validName(name);
    const dup = byName(n);
    if (dup) throw new TagError('tag-duplicate', `已有标签 #${dup.name}`, { existing: dup.name });
    const tag = insert(n);
    persist();
    return { ...tag };
  }

  // 弹层输入：已存在则复用，不存在才新建。
  function ensure(name) {
    const n = validName(name);
    const dup = byName(n);
    if (dup) return { ...dup };
    const tag = insert(n);
    persist();
    return { ...tag };
  }

  // 改名：只改 tags.json；和自己原名相同视为未改。
  function rename(id, name) {
    const tag = byId(id);
    if (!tag) throw new TagError('tag-missing', '标签不存在');
    const n = validName(name);
    const dup = byName(n);
    if (dup && dup.id !== id) throw new TagError('tag-duplicate', `已有标签 #${dup.name}`, { existing: dup.name });
    if (tag.name === n) return { ...tag };
    tag.name = n;
    persist();
    return { ...tag };
  }

  function remove(id) {
    const d = load();
    const before = d.tags.length;
    d.tags = d.tags.filter((t) => t.id !== id);
    if (d.tags.length === before) return false;
    persist();
    return true;
  }

  // 首次建库（没有 tags.json）时放入默认三个；重名复用。删掉后不再补回（tags.json 已存在）。
  function seedIfNew() {
    if (exists()) { load(); return false; }
    load();
    for (const n of DEFAULT_TAGS) if (!byName(n)) insert(n);
    persist();
    return true;
  }

  function reload() { data = null; return load(); }

  return { file, exists, list, byId, byName, nameOf, create, ensure, rename, remove, seedIfNew, reload };
}

module.exports = { createTagLibrary, tagKey, cleanName, TagError, DEFAULT_TAGS, TAGS_FILE: FILE };
