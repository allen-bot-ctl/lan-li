'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createInboxStore } = require('../electron/inbox-store');
const { matchesQuery } = require('../electron/renderer/inbox-query');

function fixture(t, custom) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-inbox-edit-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  let n = 0;
  const open = () => createInboxStore({ root, fs: custom || fs, rand: () => String(++n).padStart(4, '0') });
  return { root, open, store: open() };
}
const update = (s, id, patch) => s.saveEdit(id, { revision: s.readEdit(id).revision, ...patch });

test('纯文字逐行往返、保留原件和收纳信息，搜索跟随当前版本并可恢复', (t) => {
  const { root, store } = fixture(t);
  const old = store.addText('首行\n 同一段  \n\n下一段 &<');
  store.addTag(old.id, '备忘');
  const original = fs.readFileSync(path.join(root, old.id, 'content.html'));
  const before = store.readEdit(old.id);
  assert.equal(before.text, '首行\n 同一段  \n\n下一段 &<');
  assert.deepEqual(update(store, old.id, { text: before.text }), { changed: false });
  const text = '新稿\n \n\n含<>和  空白\n';
  update(store, old.id, { displayTitle: '自定义标题', note: '备注检索词', text });
  assert.equal(store.readEdit(old.id).text, text);
  const fresh = store.list().find(m => m.id === old.id);
  assert.equal(fresh.createdMs, old.createdMs);
  assert.deepEqual(fresh.tags, ['备忘']);
  assert(matchesQuery(fresh, '备注检索词') && matchesQuery(fresh, '新稿'));
  assert(fs.readFileSync(path.join(root, old.id, 'content.html')).equals(original));
  assert.throws(() => store.saveEdit(old.id, { revision: before.revision, text: '过期' }), /重新打开/);
  update(store, old.id, { restoreText: true });
  assert.equal(store.readEdit(old.id).text, before.text);
  assert.equal(store.readEdit(old.id).displayTitle, '自定义标题');
  assert(!matchesQuery(store.list()[0], '新稿'));
});

test('安全富文本保存无改动、只改一个节点、拒绝空白并恢复；图文附件受保护', (t) => {
  const { root, store } = fixture(t);
  const html = '<p>甲<strong>加粗</strong><a href="https://example.org/abc">链接</a></p>\n<p>乙</p>';
  const rich = store.addText({ html });
  const d = store.readEdit(rich.id);
  assert.equal(d.mode, 'rich');
  assert.deepEqual(update(store, rich.id, { richParts: d.richParts }), { changed: false });
  assert.throws(() => update(store, rich.id, { richParts: d.richParts.map(() => '') }), /不能为空/);
  assert.equal(store.get(rich.id).html, html);
  const parts = [...d.richParts]; parts[0] = '替换<甲>';
  update(store, rich.id, { richParts: parts });
  assert.equal(store.get(rich.id).html, html.replace('甲', '替换&lt;甲&gt;'));
  update(store, rich.id, { restoreText: true });
  assert.equal(store.get(rich.id).html, html);
  const attached = store.addText({ html: '<p>图文</p><img src="old.png">', images: [{ src: 'old.png', ext: 'png', buffer: Buffer.from('asset') }] });
  const attachedAsset = path.join(root, attached.id, 'assets', 'img-1.png');
  assert.equal(store.readEdit(attached.id).mode, 'protected');
  assert.equal(store.readEdit(attached.id).extracted, '图文');
  assert.throws(() => update(store, attached.id, { text: '不要覆盖' }), /保护原格式/);
  update(store, attached.id, { note: '可编辑备注' });
  assert.equal(fs.readFileSync(attachedAsset, 'utf8'), 'asset');
  assert(store.get(attached.id).html.includes('assets/img-1.png'));
});

test('独立书签更新打开目标且可撤销，不覆盖初始来源；其他类型不能改网址', (t) => {
  const { store } = fixture(t);
  const link = store.addLink('https://example.org/old', '书签');
  update(store, link.id, { url: 'https://example.org/new' });
  assert.equal(store.get(link.id).meta.sourceUrl, 'https://example.org/old');
  assert.equal(store.get(link.id).meta.targetUrl, 'https://example.org/new');
  assert.equal(store.readEdit(link.id).canUndoUrl, true);
  update(store, link.id, { undoUrl: true });
  assert.equal(store.readEdit(link.id).url, 'https://example.org/old');
  assert.throws(() => update(store, link.id, { url: 'file:///local' }), /有效/);
  const text = store.addText('文字');
  assert.throws(() => update(store, text.id, { url: 'https://example.org/new' }), /只有独立链接/);
});

test('事务失败不动原件；提交后索引写失败，重启仍读取更新后的版本', (t) => {
  let failMeta = false, failIndex = false;
  const custom = Object.assign({}, fs, {
    renameSync(a, b) { if (failMeta && String(b).endsWith('meta.json')) throw new Error('模拟保存失败'); return fs.renameSync(a,b); },
    writeFileSync(file, ...args) { if (failIndex && String(file).endsWith('index.json')) throw new Error('模拟索引缓存失败'); return fs.writeFileSync(file,...args); }
  });
  const { root, store, open } = fixture(t, custom);
  const m = store.addText('原文');
  store.list();
  assert(fs.existsSync(path.join(root, 'index.json')));
  failMeta = true;
  assert.throws(() => update(store, m.id, { text: '不应保存' }), /保存失败/);
  assert.equal(open().readEdit(m.id).text, '原文');
  assert(!fs.existsSync(path.join(root, m.id, 'meta.json.tmp')));
  failMeta = false;
  store.list();
  failIndex = true;
  assert.equal(update(store, m.id, { text: '提交成功' }).changed, true);
  assert(!fs.existsSync(path.join(root, 'index.json')));
  assert.equal(open().list()[0].body, '提交成功');
});
