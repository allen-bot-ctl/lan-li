'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createInboxStore, classifyClipboard } = require('../electron/inbox-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-wys-store-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  let n = 0;
  const open = (documentFormat, io = fs) => createInboxStore({ root, fs: io, documentFormat, rand: () => String(++n).padStart(4, '0') });
  return { root, open, store: open(true) };
}

test('新收纳只写 Tiptap 文档与相对图片引用，局部编辑保留其它节点及历史原件', (t) => {
  const { root, store, open } = fixture(t);
  const image = Buffer.from('genuine fixture bytes; importer only stores this separately');
  const src = 'file:///sample/diagram.png';
  const created = store.addText({
    html: '<p>第一段<strong>加粗</strong> <a href="https://example.org/ref">来源</a></p><img src="' + src + '" alt="图"><p>图片后原文</p><ul><li>列表</li></ul>',
    images:[{src,ext:'png',buffer:image}]
  });
  const dir = path.join(root, created.id);
  const raw = fs.readFileSync(path.join(dir, 'document.json'), 'utf8');
  assert.equal(created.documentFormat, 'tiptap-v1');
  assert(!fs.existsSync(path.join(dir, 'content.html')));
  assert(!raw.includes('file:///') && !raw.includes('base64') && !raw.includes(image.toString('base64')));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'assets/img-1.png')), image);
  const before = store.get(created.id);
  assert.deepEqual(before.document.content.map(n=>n.type), ['paragraph','image','paragraph','bulletList']);
  assert.equal(before.document.content[1].attrs.src,'assets/img-1.png');
  assert.equal(store.saveDocument(created.id, before).changed, false);
  const change = structuredClone(before.document);
  change.content[2].content[0].text='图片后新稿';
  assert(store.saveDocument(created.id,{document:change,revision:before.revision}).changed);
  assert.throws(() => store.saveDocument(created.id,{document:change,revision:before.revision}),/重新打开/);
  assert.equal(fs.readFileSync(path.join(dir, 'document.json'),'utf8'),raw);
  const restarted = open(true);
  const after = restarted.get(created.id);
  assert.match(after.html,/图片后新稿/);
  assert.match(after.html,/href="https:\/\/example.org\/ref"/);
  assert.match(after.html,/src="assets\/img-1.png"/);
  assert.match(restarted.list()[0].body,/图片后新稿/);
  assert.equal(restarted.list()[0].documentEdit,undefined);
  for(const i of [0,1,3]) assert.deepEqual(after.document.content[i],before.document.content[i]);
});

test('纯文字增加空行和首尾换行仍保持原样；旧正文与备注不被覆盖', (t) => {
  const { root, store, open } = fixture(t);
  const source = '\n 字首 <b>原样</b>\n\n字尾 \n';
  const [item] = classifyClipboard({ text: source, html: source });
  assert.deepEqual(item, {kind:'text', text:source});
  const created = store.save(item);
  assert.equal(store.get(created.id).text,source);
  assert.match(store.get(created.id).html, /&lt;b&gt;原样&lt;\/b&gt;/);
  const legacy = open(false);
  const old = legacy.addText('旧正文');
  legacy.saveEdit(old.id,{revision:legacy.readEdit(old.id).revision,note:'旧备注'});
  const oldPath = path.join(root,old.id,'meta.json');
  const oldMeta = fs.readFileSync(oldPath,'utf8');
  const oldHtml = fs.readFileSync(path.join(root,old.id,'content.html'),'utf8');
  assert.equal(store.get(old.id).html,oldHtml);
  assert.equal(store.get(old.id).document,undefined);
  assert.equal(store.readEdit(old.id).note,'');
  assert.throws(()=>store.saveDocument(old.id,{document:store.get(created.id).document}),/旧格式/);
  assert.throws(()=>store.saveEdit(old.id,{revision:store.readEdit(old.id).revision,text:'不覆盖'}),/旧格式/);
  assert.equal(fs.readFileSync(oldPath,'utf8'),oldMeta);
  store.saveEdit(old.id,{revision:store.readEdit(old.id).revision,displayTitle:'仍可改显示标题',note:'不会覆盖历史值'});
  assert.equal(JSON.parse(fs.readFileSync(oldPath,'utf8')).note,'旧备注');
  assert.equal(fs.readFileSync(path.join(root,old.id,'content.html'),'utf8'),oldHtml);
});

test('工作版保存失败不影响旧值；索引缺失重启后仍读当前工作版', (t) => {
  const { root, store, open } = fixture(t);
  const m = store.addText('原件');
  const before = store.get(m.id);
  const document = structuredClone(before.document);
  document.content[0].content[0].text = '工作版';
  const io = Object.assign({},fs,{renameSync(a,b){if(String(b).endsWith('meta.json'))throw new Error('模拟落盘失败');return fs.renameSync(a,b);}});
  assert.throws(()=>open(true,io).saveDocument(m.id,{revision:before.revision,document}),/模拟落盘失败/);
  assert.equal(open(true).get(m.id).text,'原件');
  const io2 = Object.assign({},fs,{writeFileSync(file,...args){if(String(file).endsWith('index.json'))throw new Error('模拟缓存故障');return fs.writeFileSync(file,...args);}});
  assert(open(true,io2).saveDocument(m.id,{revision:before.revision,document}).changed);
  assert(!fs.existsSync(path.join(root,'index.json')));
  assert.equal(open(true).list()[0].body,'工作版');
});
