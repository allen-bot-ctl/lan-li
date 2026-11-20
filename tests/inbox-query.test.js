'use strict';
// 0.1.44 收纳 B 段：检索/筛选/日期分组/标签规则/index 重建/撤销删除。全部用本地时间构造，不依赖时区。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Q = require('../electron/renderer/inbox-query');
const { createInboxStore } = require('../electron/inbox-store');

const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-inboxq-'));

const sample = () => [
  { id: '1', type: 'file', title: 'Annual-Report.pdf', sourcePath: '/Users/x/Desktop/Annual-Report.pdf', preview: '/Users/x/Desktop', tags: ['工作'], createdMs: at(2026, 11, 19, 10) },
  { id: '2', type: 'text', title: '周报', preview: 'Quarterly 本周完成', body: 'Quarterly 本周完成收纳功能 细节在正文里', tags: ['工作', '读书'], createdMs: at(2026, 11, 18, 9) },
  { id: '3', type: 'link', title: '仓库主页', sourceUrl: 'https://www.github.com/lanli', preview: 'github.com', tags: [], createdMs: at(2026, 11, 16, 8) },
  { id: '4', type: 'image', title: '设计稿.png', preview: '', tags: ['设计'], createdMs: at(2026, 10, 3, 8) }
];

test('B-C2 搜索命中标题/正文/文件名/域名/标签，大小写不敏感', () => {
  const s = sample();
  const ids = (q) => Q.filterEntries(s, { query: q }).map((m) => m.id);
  assert.deepStrictEqual(ids('annual-REPORT'), ['1']);
  assert.deepStrictEqual(ids('细节在正文'), ['2']);
  assert.deepStrictEqual(ids('github.com'), ['3']);
  assert.deepStrictEqual(ids('读书'), ['2']);
  assert.deepStrictEqual(ids('设计'), ['4']);
  assert.deepStrictEqual(ids('  '), ['1', '2', '3', '4']);
  assert.deepStrictEqual(ids('不存在的词'), []);
});

test('B-C2 200 条内检索 < 50ms', () => {
  const list = Array.from({ length: 200 }, (_, i) => ({ id: String(i), type: 'text', title: `条目 ${i}`, body: '正文'.repeat(2000) + i, tags: ['t' + (i % 5)], createdMs: at(2026, 11, 1) + i }));
  Q.filterEntries(list, { query: 'warm' });
  const t0 = process.hrtime.bigint();
  for (const q of ['条', '条目', '条目 1', '正文正文1', 't3']) Q.filterEntries(list, { query: q });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 5;
  assert.ok(ms < 50, `平均 ${ms}ms`);
});

test('B-C1 类型、标签（多选=同时带）、日期、搜索叠加', () => {
  const s = sample();
  const ids = (f) => Q.filterEntries(s, f).map((m) => m.id);
  assert.deepStrictEqual(ids({ type: 'text' }), ['2']);
  assert.deepStrictEqual(ids({ type: 'all', tags: ['工作'] }), ['1', '2']);
  assert.deepStrictEqual(ids({ tags: ['工作', '读书'] }), ['2']);
  assert.deepStrictEqual(ids({ type: 'file', tags: ['工作'] }), ['1']);
  assert.deepStrictEqual(ids({ type: 'link', tags: ['工作'] }), []);
  assert.deepStrictEqual(ids({ day: Q.dayKeyOf(new Date(2026, 10, 18)) }), ['2']);
  assert.deepStrictEqual(ids({ day: Q.dayKeyOf(new Date(2026, 10, 18)), query: 'quarterly', tags: ['读书'], type: 'text' }), ['2']);
  assert.deepStrictEqual(ids({ day: Q.dayKeyOf(new Date(2026, 10, 18)), type: 'file' }), []);
});

test('B-C3 日期分组：今天/昨天/本周（周一起）/本月/更早按月', () => {
  const now = new Date(2026, 10, 19, 21, 40); // 周四
  const L = (ms) => Q.dateGroupLabel(ms, now);
  assert.strictEqual(L(at(2026, 11, 19, 0, 0)), '今天');
  assert.strictEqual(L(at(2026, 11, 18, 23, 59)), '昨天');
  assert.strictEqual(L(at(2026, 11, 18, 0, 0)), '昨天');
  assert.strictEqual(L(at(2026, 11, 17, 8)), '本周');
  assert.strictEqual(L(at(2026, 11, 16, 0, 0)), '本周');      // 周一 0 点
  assert.strictEqual(L(at(2026, 11, 15, 23, 59)), '本月');    // 周日 23:59 属上周
  assert.strictEqual(L(at(2026, 11, 1, 0, 0)), '本月');
  assert.strictEqual(L(at(2026, 10, 31, 23, 59)), '10月');
  assert.strictEqual(L(at(2025, 12, 31, 12)), '2025年12月');
  const groups = Q.groupByDate(sample(), now).map((g) => [g.label, g.entries.map((m) => m.id)]);
  assert.deepStrictEqual(groups, [['今天', ['1']], ['昨天', ['2']], ['本周', ['3']], ['10月', ['4']]]);
});

test('B-C3 跨周一边界：周一时「昨天」是周日，周日不算本周', () => {
  const mon = new Date(2026, 10, 16, 9, 0);
  assert.strictEqual(Q.dateGroupLabel(at(2026, 11, 15, 10), mon), '昨天');
  assert.strictEqual(Q.dateGroupLabel(at(2026, 11, 14, 10), mon), '本月');
  const tue = new Date(2026, 10, 17, 9, 0);
  assert.strictEqual(Q.dateGroupLabel(at(2026, 11, 16, 0, 0), tue), '昨天');
  assert.strictEqual(Q.dateGroupLabel(at(2026, 11, 15, 23, 0), tue), '本月');
  // 月初在周中：本周优先于跨月
  const wed = new Date(2026, 11, 2, 9, 0); // 12 月 2 日周三
  assert.strictEqual(Q.dateGroupLabel(at(2026, 11, 30, 9), wed), '本周');
  assert.strictEqual(Q.dateGroupLabel(at(2026, 11, 29, 9), wed), '11月');
  assert.strictEqual(Q.startOfWeek(new Date(2026, 10, 22, 12)).getDate(), 16); // 周日 → 本周一 16 日
});

test('B-C6 标签：每条≤5、单个≤8 字，去重去 #', () => {
  let t = [];
  for (const x of ['工作', '#读书', '工作', 'a', 'b', 'c']) t = Q.addTag(t, x);
  assert.deepStrictEqual(t, ['工作', '读书', 'a', 'b', 'c']);
  assert.throws(() => Q.addTag(t, 'd'), (e) => e.code === 'tag-limit');
  assert.throws(() => Q.addTag([], '一二三四五六七八九'), (e) => e.code === 'tag-too-long');
  assert.deepStrictEqual(Q.addTag([], '一二三四五六七八'), ['一二三四五六七八']);
  assert.throws(() => Q.addTag([], '  '), (e) => e.code === 'tag-empty');
  assert.throws(() => Q.cleanTags(['1', '2', '3', '4', '5', '6']), (e) => e.code === 'tag-limit');
  assert.deepStrictEqual(Q.tagCounts(sample()).map((c) => c.tag), ['工作', ...['读书', '设计'].sort()]);
});

test('高亮切段与日期胶囊文案', () => {
  assert.deepStrictEqual(Q.highlightParts('Quarterly 周报 quarterly', 'QUARTERLY'), [
    { text: 'Quarterly', hit: true }, { text: ' 周报 ', hit: false }, { text: 'quarterly', hit: true }]);
  assert.deepStrictEqual(Q.highlightParts('abc', ''), [{ text: 'abc', hit: false }]);
  assert.strictEqual(Q.dayChipLabel(Q.dayKeyOf(new Date(2026, 10, 19))), '11月19日');
});

function store(root) {
  let n = 0;
  return createInboxStore({ root, now: () => new Date(2026, 10, 19, 21, 0, n++), rand: () => 'r' + String(n).padStart(3, '0') });
}

test('B-C6 index.json：写入后存在；删除后由 meta.json 重建；外部删条目也会刷新', () => {
  const root = path.join(tmp(), 'inbox');
  const s = store(root);
  const a = s.addText('第一条 正文 needle');
  const b = s.addLink('https://a.example/x', '链接');
  s.addTag(a.id, '工作');
  assert.ok(fs.existsSync(path.join(root, 'index.json')));
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.entries.map((m) => m.id).sort(), [a.id, b.id].sort());
  assert.ok(idx.entries.find((m) => m.id === a.id).body.includes('needle'));
  fs.rmSync(path.join(root, 'index.json'));
  const s2 = store(root);   // 模拟重启
  const list = s2.list();
  assert.deepStrictEqual(list.map((m) => m.id), [b.id, a.id]);
  assert.deepStrictEqual(list.find((m) => m.id === a.id).tags, ['工作']);
  assert.ok(fs.existsSync(path.join(root, 'index.json')));
  fs.rmSync(path.join(root, b.id), { recursive: true });
  assert.deepStrictEqual(s2.list().map((m) => m.id), [a.id]);
  // 坏的 index.json 也会重建
  fs.writeFileSync(path.join(root, 'index.json'), '{坏');
  assert.strictEqual(store(root).list().length, 1);
  // meta.json 里不写 body
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, a.id, 'meta.json'), 'utf8')).body, undefined);
});

test('B-C6 撤销删除：trash 后列表里没有，restore 回来；purge 后彻底删除；原文件不动', () => {
  const dir = tmp(); const root = path.join(dir, 'inbox');
  const src = path.join(dir, 'a.pdf'); fs.writeFileSync(src, 'x');
  const s = store(root);
  const f = s.addFile(src);
  const t = s.addText('文字');
  s.trash(f.id);
  assert.deepStrictEqual(s.list().map((m) => m.id), [t.id]);
  assert.strictEqual(s.restore(f.id), true);
  assert.deepStrictEqual(s.list().map((m) => m.id), [t.id, f.id]);
  s.trash(f.id); s.purge(f.id);
  assert.strictEqual(s.restore(f.id), false);
  assert.ok(!fs.existsSync(path.join(root, f.id)));
  assert.ok(!fs.existsSync(path.join(root, '.trash', f.id)));
  assert.ok(fs.existsSync(src));
  // 启动清理会清掉 .trash
  s.trash(t.id); s.cleanup();
  assert.ok(!fs.existsSync(path.join(root, '.trash')));
});

test('B-C6 标签存 meta.tags；removeTagEverywhere 从所有条目移除', () => {
  const s = store(path.join(tmp(), 'inbox'));
  const a = s.addText('a'); const b = s.addText('b');
  s.addTag(a.id, '工作'); s.addTag(b.id, '工作'); s.addTag(b.id, '读书');
  assert.throws(() => s.setTags(a.id, ['1', '2', '3', '4', '5', '6']), (e) => e.code === 'tag-limit');
  assert.strictEqual(s.removeTagEverywhere('工作'), 2);
  assert.deepStrictEqual(s.list().map((m) => m.tags), [['读书'], []]);
});

test('B-C7 重新指定原文件：重建软链接，清 missing', () => {
  const dir = tmp(); const src = path.join(dir, 'a.pdf'); fs.writeFileSync(src, 'x');
  const s = store(path.join(dir, 'inbox'));
  const f = s.addFile(src);
  const moved = path.join(dir, 'b.pdf'); fs.renameSync(src, moved);
  assert.strictEqual(s.list()[0].missing, true);
  const m = s.relink(f.id, moved);
  assert.strictEqual(m.sourcePath, moved);
  assert.strictEqual(s.list()[0].missing, false);
  assert.strictEqual(fs.readlinkSync(path.join(s.root, f.id, f.file)), moved);
  assert.throws(() => s.relink(f.id, path.join(dir, 'nope')));
});

test('0.1.46 时间范围：快捷项、区间两端都含、跨月、胶囊文案', () => {
  const now = new Date(2026, 10, 19, 21, 0, 0);
  const r7 = Q.presetRange('d7', now);
  assert.deepStrictEqual([r7.from, r7.to], ['2026-11-13', '2026-11-19']);
  assert.strictEqual(Q.rangeChipLabel(r7, 3), '近 7 天 · 3 项');
  const r = Q.makeRange('2026-11-28', '2026-10-30');
  assert.deepStrictEqual([r.from, r.to], ['2026-10-30', '2026-11-28']);
  assert.strictEqual(Q.rangeChipLabel(r, 2), '10/30–11/28 · 2 项');
  assert.strictEqual(Q.rangeChipLabel({ from: '2026-11-19', to: '2026-11-19' }, 1), '11/19 · 1 项');
  assert.ok(Q.inRange({ createdMs: new Date(2026, 10, 28, 23, 59).getTime() }, r));
  assert.ok(!Q.inRange({ createdMs: new Date(2026, 10, 29, 0, 0).getTime() }, r));
  assert.ok(Q.inRange({ createdMs: new Date(2026, 9, 30, 0, 0).getTime() }, r));
});
