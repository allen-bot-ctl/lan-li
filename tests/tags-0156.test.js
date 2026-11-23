'use strict';
// 0.1.56 标签库与迁移（契约 docs/changes/0.1.56-tag-manager.md 验收 T1–T5 的存储层部分）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInboxStore } = require('../electron/inbox-store');
const { tagKey } = require('../electron/tag-library');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-tags-')); }
function store(root, extra) {
  let t = new Date(2026, 10, 22, 21, 0, 0).getTime(); let r = 0;
  return createInboxStore({ root, now: () => new Date((t += 1000)), rand: () => 'r' + String(r++).padStart(3, '0'), ...(extra || {}) });
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tagNames = (root) => readJson(path.join(root, 'tags.json')).tags.map((t) => t.name);

// 0.1.55 的数据形态：meta.tags 是名字数组
function seedOld(root) {
  const s = store(root);
  const a = s.addText({ text: '一' }); const b = s.addText({ text: '二' }); const c = s.addLink('https://a.cn/x', '链');
  const d = s.addText({ text: '无标签' });
  const put = (id, tags) => { const f = path.join(root, id, 'meta.json'); const m = readJson(f); m.tags = tags; fs.writeFileSync(f, JSON.stringify(m, null, 2)); };
  put(a.id, ['test', '重要']); put(b.id, ['test']); put(c.id, ['重要']);
  fs.rmSync(path.join(root, 'tags.json'), { force: true });
  return [a.id, b.id, c.id, d.id];
}

test('T1 全新数据目录：tags.json 只有 备忘/重要/临时；再跑一次不变', () => {
  const root = tmp();
  const s = store(root);
  const r = s.migrateTags();
  assert.strictEqual(r.seeded, true);
  assert.deepStrictEqual(tagNames(root), ['备忘', '重要', '临时']);
  assert.ok(readJson(path.join(root, 'tags.json')).tags.every((t) => /^t_[0-9a-f]{8}$/.test(t.id)));
  store(root).migrateTags();
  assert.deepStrictEqual(tagNames(root), ['备忘', '重要', '临时']);
});

test('T2 老数据升级：test 新建、重要复用默认、meta.tags 变 ID、有备份、条目数不变、重跑不变', () => {
  const root = tmp();
  const ids = seedOld(root);
  const s = store(root);
  const r = s.migrateTags();
  assert.strictEqual(r.migrated, 3);
  assert.strictEqual(r.failed, 0);
  assert.deepStrictEqual(tagNames(root), ['备忘', '重要', '临时', 'test']);
  const lib = readJson(path.join(root, 'tags.json')).tags;
  const idOf = (n) => lib.find((t) => t.name === n).id;
  assert.deepStrictEqual(readJson(path.join(root, ids[0], 'meta.json')).tags, [idOf('test'), idOf('重要')]);
  assert.deepStrictEqual(readJson(path.join(root, ids[2], 'meta.json')).tags, [idOf('重要')]);
  // 备份是原样的 0.1.55 meta
  const bak = path.join(root, '.backup-0.1.56');
  assert.deepStrictEqual(readJson(path.join(bak, ids[0], 'meta.json')).tags, ['test', '重要']);
  for (const id of ids) assert.ok(fs.existsSync(path.join(bak, id, 'meta.json')), '每条 meta.json 都备份');
  const list = s.list();
  assert.strictEqual(list.length, 4);
  assert.deepStrictEqual(list.find((m) => m.id === ids[0]).tags, ['test', '重要']);
  // 重跑：结果不变
  const before = fs.readFileSync(path.join(root, ids[0], 'meta.json'), 'utf8');
  const r2 = store(root).migrateTags();
  assert.strictEqual(r2.migrated, 0);
  assert.strictEqual(fs.readFileSync(path.join(root, ids[0], 'meta.json'), 'utf8'), before);
  assert.deepStrictEqual(tagNames(root), ['备忘', '重要', '临时', 'test']);
  assert.ok(!fs.readdirSync(root).some((n) => n.endsWith('.tmp')));
});

test('T3 查重：重要、 #重要 、ＴＥＳＴ 判重复，新增被拒', () => {
  assert.strictEqual(tagKey(' #重要 '), tagKey('重要'));
  assert.strictEqual(tagKey('ＴＥＳＴ'), tagKey('test'));
  const root = tmp(); seedOld(root);
  const s = store(root); s.migrateTags();
  for (const n of ['重要', ' #重要 ', 'ＴＥＳＴ', 'Test']) {
    assert.throws(() => s.createTag(n), (e) => e.code === 'tag-duplicate' && /^已有标签 #/.test(e.message));
  }
  const t = s.createTag(' #工作 ');
  assert.strictEqual(t.name, '工作');
  assert.throws(() => s.createTag(''), (e) => e.code === 'tag-empty');
  assert.throws(() => s.createTag('一二三四五六七八九'), (e) => e.code === 'tag-too-long');
});

test('T4 改名 test→测试：只改 tags.json，meta.json 内容和 mtime 不变；显示和检索用新名', () => {
  const root = tmp(); const ids = seedOld(root);
  const s = store(root); s.migrateTags();
  const snap = ids.map((id) => { const f = path.join(root, id, 'meta.json'); return [fs.readFileSync(f, 'utf8'), fs.statSync(f).mtimeMs]; });
  const test = s.listTags().find((t) => t.name === 'test');
  assert.throws(() => s.renameTag(test.id, '重要'), (e) => e.code === 'tag-duplicate');
  assert.strictEqual(s.renameTag(test.id, 'test').name, 'test', '和原名相同视为未改');
  s.renameTag(test.id, '测试');
  ids.forEach((id, i) => {
    const f = path.join(root, id, 'meta.json');
    assert.strictEqual(fs.readFileSync(f, 'utf8'), snap[i][0]);
    assert.strictEqual(fs.statSync(f).mtimeMs, snap[i][1]);
  });
  assert.deepStrictEqual(s.list().find((m) => m.id === ids[0]).tags, ['测试', '重要']);
  assert.deepStrictEqual(store(root).list().find((m) => m.id === ids[1]).tags, ['测试']);
});

test('T5 删除「重要」：条目数不变，引用的 ID 一并清掉，库里没有了', () => {
  const root = tmp(); const ids = seedOld(root);
  const s = store(root); s.migrateTags();
  const imp = s.listTags().find((t) => t.name === '重要');
  assert.strictEqual(imp.count, 2);
  assert.strictEqual(s.tagUsage(imp.id), 2);
  const n = s.deleteTag(imp.id);
  assert.strictEqual(n, 2);
  assert.strictEqual(s.list().length, 4);
  for (const id of ids) assert.ok(!readJson(path.join(root, id, 'meta.json')).tags.includes(imp.id));
  assert.ok(!tagNames(root).includes('重要'));
  // 删掉的默认标签不会被再补回来
  store(root).migrateTags();
  assert.ok(!tagNames(root).includes('重要'));
  // 按名字删（收纳页右键）同样生效
  assert.strictEqual(s.deleteTag('test'), 2);
  assert.deepStrictEqual(s.list().find((m) => m.id === ids[0]).tags, []);
});

test('T6 存储层：addTag 输入已存在的名字复用已有 ID，库里条数不变；上限 5 个', () => {
  const root = tmp(); const ids = seedOld(root);
  const s = store(root); s.migrateTags();
  const before = s.listTags().length;
  const m = s.addTag(ids[3], ' #ＴＥＳＴ ');
  assert.deepStrictEqual(m.tags, ['test']);
  assert.strictEqual(s.listTags().length, before);
  s.addTag(ids[3], 'test');
  assert.deepStrictEqual(s.get(ids[3]).meta.tags, ['test']);
  ['甲', '乙', '丙', '丁'].forEach((n) => s.addTag(ids[3], n));
  assert.throws(() => s.addTag(ids[3], '戊'), (e) => e.code === 'tag-limit');
  assert.deepStrictEqual(s.setTags(ids[3], ['备忘', '#临时']).tags, ['备忘', '临时']);
});

test('T0 真实形态升级：10 项含 #test，迁移后 #test 在原条目、条目数不变、备份齐全且与升级前一致、按 test 筛选相同、默认标签已补', () => {
  const Q = require('../electron/renderer/inbox-query');
  const root = tmp();
  const s0 = store(root);
  const ids = [];
  for (let i = 0; i < 10; i += 1) ids.push(s0.addText({ text: `条目${i}` }).id);
  const withTest = ids.filter((_, i) => i % 3 === 0);
  for (const id of ids) {
    const f = path.join(root, id, 'meta.json'); const m = readJson(f);
    m.tags = withTest.includes(id) ? ['test'] : (id === ids[1] ? ['工作'] : []);
    fs.writeFileSync(f, JSON.stringify(m, null, 2));
  }
  fs.rmSync(path.join(root, 'tags.json'), { force: true });
  s0.rebuildIndex();
  const before = Object.fromEntries(ids.map((id) => [id, fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8')]));
  const indexBefore = fs.readFileSync(path.join(root, 'index.json'), 'utf8');
  const s = store(root);
  const r = s.migrateTags();
  assert.strictEqual(r.failed, 0);
  const list = s.list();
  assert.strictEqual(list.length, 10);
  assert.deepStrictEqual(Q.filterEntries(list, { tags: ['test'] }).map((m) => m.id).sort(), withTest.slice().sort());
  const bak = path.join(root, '.backup-0.1.56');
  for (const id of ids) assert.strictEqual(fs.readFileSync(path.join(bak, id, 'meta.json'), 'utf8'), before[id]);
  assert.strictEqual(fs.readFileSync(path.join(bak, 'index.json'), 'utf8'), indexBefore);
  for (const n of ['备忘', '重要', '临时', 'test', '工作']) assert.ok(tagNames(root).includes(n), n);
});

test('T0b 迁移中途写入失败：原 meta.json 全部不变，条目和标签照常显示；下次启动重试成功', () => {
  const root = tmp();
  const ids = seedOld(root);
  const before = Object.fromEntries(ids.map((id) => [id, fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8')]));
  const s = store(root, { migrateFailAt: 2 });
  const r = s.migrateTags();
  assert.ok(r.failed > 0);
  assert.strictEqual(r.migrated, 0);
  for (const id of ids) assert.strictEqual(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8'), before[id]);
  assert.ok(!fs.readdirSync(path.join(root, ids[1])).some((n) => n.endsWith('.tmp')));
  const list = s.list();
  assert.strictEqual(list.length, 4);
  assert.deepStrictEqual(list.find((m) => m.id === ids[0]).tags, ['test', '重要']);
  const r2 = store(root).migrateTags();
  assert.strictEqual(r2.failed, 0);
  assert.strictEqual(r2.migrated, 3);
  assert.deepStrictEqual(store(root).list().find((m) => m.id === ids[0]).tags, ['test', '重要']);
});

test('T1b 删掉默认标签「临时」后重启：不会被补回', () => {
  const root = tmp();
  const s = store(root); s.migrateTags();
  s.deleteTag('临时');
  store(root).migrateTags();
  assert.deepStrictEqual(tagNames(root), ['备忘', '重要']);
});
