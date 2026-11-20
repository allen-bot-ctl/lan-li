'use strict';
// 0.1.42 收纳：落盘模块（A-C3–A-C9 的单测部分）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInboxStore, classifyDrop, describeItems, sanitizeHtml, MAX_ITEMS } = require('../electron/inbox-store');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-inbox-')); }
function store(root, extra) {
  let t = new Date(2026, 10, 19, 21, 0, 0).getTime(); let r = 0;
  return createInboxStore(Object.assign({ root, now: () => new Date((t += 1000)), rand: () => 'r' + String(r++).padStart(3, '0') }, extra));
}
const noTmp = (root) => fs.readdirSync(root).filter((n) => n.endsWith('.tmp'));

test('classifyDrop：文件/图片/链接/文字/富文本/浏览器图片/空', () => {
  assert.deepStrictEqual(classifyDrop({ files: ['/a/b.PNG', '/a/c.mp4', '/a/d'] }).map((x) => x.kind), ['image', 'file', 'file']);
  assert.deepStrictEqual(classifyDrop({ text: 'https://x.com/a' }), [{ kind: 'link', url: 'https://x.com/a', title: '' }]);
  assert.strictEqual(classifyDrop({ uriList: ['https://a.b/c'], text: '文章标题' })[0].title, '文章标题');
  assert.strictEqual(classifyDrop({ text: '你好 https://a.b 世界' })[0].kind, 'text');
  assert.strictEqual(classifyDrop({ html: '<p>你好<b>粗</b></p>', text: '你好粗' })[0].kind, 'text');
  assert.deepStrictEqual(classifyDrop({ html: '<a href="https://q.cn/x">标题</a>' })[0], { kind: 'link', url: 'https://q.cn/x', title: '标题' });
  assert.deepStrictEqual(classifyDrop({ html: '<img src="https://p.cn/a.jpg">', uriList: ['https://p.cn/a.jpg'] })[0], { kind: 'image', url: 'https://p.cn/a.jpg' });
  assert.deepStrictEqual(classifyDrop({}), []);
  assert.deepStrictEqual(classifyDrop({ text: '   ' }), []);
});

test('describeItems 文案', () => {
  assert.strictEqual(describeItems(classifyDrop({ files: ['/a.pdf', '/b.mp4', '/c.zip'] })), '3 个文件');
  assert.strictEqual(describeItems(classifyDrop({ files: ['/a.pdf', '/b.png'] })), '2 项');
  assert.strictEqual(describeItems([]), '');
});

test('A-C3/A-C4 文件：软链接指向原文件，meta 字段齐全，原文件移走后 missing', () => {
  const dir = tmp(); const src = path.join(dir, '季度报告.pdf'); fs.writeFileSync(src, '12345');
  const s = store(path.join(dir, 'inbox'));
  const [m] = s.saveAll(classifyDrop({ files: [src] }));
  for (const k of ['id', 'type', 'title', 'createdAt', 'tags', 'sourcePath', 'sourceUrl', 'size', 'ref', 'missing', 'preview', 'schema']) assert.ok(k in m, k);
  assert.match(m.id, /^20261119-2100\d\d-r000$/);
  assert.match(m.createdAt, /^2026-11-19T21:00:01[+-]\d\d:\d\d$|^2026-11-20T/);
  assert.strictEqual(m.ref, 'symlink'); assert.strictEqual(m.sourcePath, src); assert.strictEqual(m.size, 5);
  assert.strictEqual(fs.readlinkSync(path.join(s.root, m.id, '季度报告.pdf.symlink')), src);
  assert.strictEqual(s.list()[0].missing, false);
  fs.renameSync(src, path.join(dir, 'moved.pdf'));
  assert.strictEqual(s.list()[0].missing, true);
  assert.deepStrictEqual(noTmp(s.root), []);
});

test('A-C5 图片：存副本和缩略图；浏览器 data: 图片也能存', () => {
  const dir = tmp(); const img = path.join(dir, 'p.png'); fs.writeFileSync(img, 'PNG');
  const s = store(path.join(dir, 'inbox'), { makeThumb: (src, dest) => fs.writeFileSync(dest, 'JPG') });
  const a = s.addImage(img);
  fs.unlinkSync(img);
  assert.strictEqual(fs.readFileSync(path.join(s.root, a.id, 'original.png'), 'utf8'), 'PNG');
  assert.strictEqual(a.thumb, 'thumb.jpg'); assert.strictEqual(a.ref, 'copy');
  const b = s.addImage({ buffer: Buffer.from('GIF'), ext: 'gif', url: 'data:image/gif;base64,R0lG' });
  assert.strictEqual(b.sourceUrl, null);
  const c = s.addImage({ buffer: Buffer.from('J'), ext: 'jpeg', url: 'https://www.p.cn/a.jpg' });
  assert.strictEqual(c.file, 'original.jpg'); assert.strictEqual(c.sourceUrl, 'https://www.p.cn/a.jpg'); assert.strictEqual(c.title, 'p.cn 的图片');
});

test('A-C6 富文本：清洗脚本与事件属性，内嵌图片在 assets/ 且相对引用', () => {
  const s = store(path.join(tmp(), 'inbox'));
  const m = s.addText({ html: '<p onclick="x()">标题</p><script>alert(1)</script><img src="https://x/1.png" onerror="y"><a href="javascript:alert(1)">坏</a><a href="https://y">链接</a>', images: [{ src: 'https://x/1.png', buffer: Buffer.from('IMG'), ext: 'png' }] });
  const g = s.get(m.id);
  assert.match(g.html, /<img src="assets\/img-1\.png">/);
  assert.doesNotMatch(g.html, /script|onclick|onerror|javascript:/i);
  assert.strictEqual(fs.readFileSync(path.join(g.dir, 'assets/img-1.png'), 'utf8'), 'IMG');
  assert.strictEqual(m.title, '标题'); assert.strictEqual(m.rich, true);
  const p = s.addText('第一行 <b>\n第二行');
  assert.strictEqual(s.get(p.id).html, '<p>第一行 &lt;b&gt;<br>第二行</p>');
  assert.strictEqual(p.title, '第一行 <b>');
});

test('A-C7 链接：存 URL 与标题，没标题用域名', () => {
  const s = store(path.join(tmp(), 'inbox'));
  const [a] = s.saveAll(classifyDrop({ text: 'https://www.zhihu.com/q/1' }));
  assert.strictEqual(a.type, 'link'); assert.strictEqual(a.sourceUrl, 'https://www.zhihu.com/q/1'); assert.strictEqual(a.title, 'zhihu.com');
  assert.deepStrictEqual(fs.readdirSync(path.join(s.root, a.id)), ['meta.json']);
});

test('A-C8 空数据、超过 50 项、写盘失败都报错且不留 .tmp 和半截条目', () => {
  const dir = tmp(); const s = store(path.join(dir, 'inbox'));
  assert.throws(() => s.saveAll(classifyDrop({})), (e) => e.code === 'empty');
  assert.throws(() => s.saveAll(Array.from({ length: MAX_ITEMS + 1 }, () => ({ kind: 'text', text: 'x' }))), (e) => e.code === 'too-many');
  const src = path.join(dir, 'ok.txt'); fs.writeFileSync(src, 'x');
  assert.throws(() => s.saveAll([{ kind: 'file', path: src }, { kind: 'file', path: path.join(dir, 'nope') }]));
  assert.deepStrictEqual(s.list(), []);
  assert.deepStrictEqual(noTmp(s.root), []);
  fs.mkdirSync(path.join(s.root, 'x.tmp')); s.cleanup(); assert.deepStrictEqual(noTmp(s.root), []);
});

test('A-C9 列表时间倒序；标签去重；删除不动原文件', () => {
  const dir = tmp(); const src = path.join(dir, 'a.mp4'); fs.writeFileSync(src, 'v');
  const s = store(path.join(dir, 'inbox'));
  const a = s.addText('第一条'); const b = s.addLink('https://a.b'); const c = s.addFile(src);
  assert.deepStrictEqual(s.list().map((x) => x.id), [c.id, b.id, a.id]);
  assert.deepStrictEqual(s.setTags(a.id, ['工作', ' 工作 ', '', '读书']).tags, ['工作', '读书']);
  s.remove(c.id);
  assert.ok(fs.existsSync(src));
  assert.strictEqual(s.list().length, 2);
  assert.throws(() => s.remove('../x'));
});

test('sanitizeHtml 去掉 style/iframe', () => {
  assert.strictEqual(sanitizeHtml('<style>p{}</style><iframe src="x"></iframe><p>好</p>'), '<p>好</p>');
});

test('0.1.48 classifyDrop：路径为空时用 uri-list 里的 file:// 兜底（含中文、空格、文件夹结尾斜杠）', () => {
  const r = classifyDrop({ files: [], uriList: ['file:///Users/a/%E4%B8%8B%E8%BD%BD/a%20b.md', 'file:///Users/a/dir/', 'https://x.com'] });
  assert.deepStrictEqual(r, [{ kind: 'file', path: '/Users/a/下载/a b.md' }, { kind: 'file', path: '/Users/a/dir' }]);
  assert.deepStrictEqual(classifyDrop({ files: ['/x/y.png'], uriList: ['file:///z'] }).map((x) => x.path), ['/x/y.png']);
});
