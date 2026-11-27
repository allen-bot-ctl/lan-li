'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInboxStore } = require('../electron/inbox-store');
const { createInboxController } = require('../electron/inbox-main');
const { manualCaptureItem } = require('../electron/manual-capture');
const Q = require('../electron/renderer/inbox-query');
function fixture(t, injected) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let id = 0;
  const open = () => createInboxStore({ root, fs: injected || fs, now: () => new Date('2020-02-03T12:00:00Z'), rand: () => String(++id) });
  return { root, open, store: open() };
}

test('manual whole HTTP(S) URL preserves spelling; prose, multiple URLs and protocol-less domains stay text', () => {
  for (const url of ['https://example.com/unique-path?q=1#part', 'HTTP://Example.COM:80/a', 'https://例子.测试/a']) {
    assert.deepEqual(manualCaptureItem(' \n' + url + '  '), { kind: 'link', url });
  }
  for (const text of ['说明 https://example.com/a', 'https://a.com https://b.com', 'https://a.com\nhttps://b.com', 'example.com', 'https://', 'ftp://example.com', 'https://example.com with spaces']) {
    assert.deepEqual(manualCaptureItem(text), { kind: 'text', text });
  }
});

test('archive is independent, atomic, idempotent and durable without changing old metadata, content or order', (t) => {
  let renames = 0;
  const custom = Object.assign({}, fs, { renameSync(a, b) { if (String(b).endsWith('meta.json')) renames += 1; fs.renameSync(a, b); } });
  const { root, store, open } = fixture(t, custom);
  const a = store.addText({ text: '历史正文' });
  const b = store.addLink('https://example.com/archived-unique-path');
  store.addTag(a.id, '共享');
  const metaFile = path.join(root, a.id, 'meta.json');
  const before = JSON.parse(fs.readFileSync(metaFile));
  const body = fs.readFileSync(path.join(root, a.id, 'content.html'));
  const order = store.list().map((m) => m.id);
  assert.equal('archived' in before, false);
  store.setArchived(a.id, true);
  store.setArchived(a.id, true);
  assert.equal(renames, 1);
  const { archived, ...rest } = JSON.parse(fs.readFileSync(metaFile));
  assert.equal(archived, true);
  assert.deepEqual(rest, before);
  assert.ok(fs.readFileSync(path.join(root, a.id, 'content.html')).equals(body));
  assert.deepEqual(open().list().map((m) => m.id), order);
  assert.deepEqual(Q.filterEntries(open().list(), {}).map((m) => m.id), [b.id]);
  assert.deepEqual(Q.filterEntries(open().list(), { type: 'archived', tags: ['共享'], day: '2020-2-3' }).map((m) => m.id), [a.id]);
  store.setArchived(a.id, false);
  assert.deepEqual(Q.filterEntries(open().list(), {}).map((m) => m.id), order);
});

test('failed archive commit does not succeed; cache-write failure cannot hide committed state on restart', (t) => {
  let failMeta = false, failIndex = false;
  const custom = Object.assign({}, fs, {
    renameSync(a, b) { if (failMeta && String(b).endsWith('meta.json')) throw new Error('write failed'); fs.renameSync(a, b); },
    writeFileSync(file, ...args) { if (failIndex && String(file).endsWith('index.json')) throw new Error('index failed'); fs.writeFileSync(file, ...args); }
  });
  const { root, store, open } = fixture(t, custom);
  const a = store.addText({ text: '原文' });
  store.list();
  failMeta = true;
  assert.throws(() => store.setArchived(a.id, true), /write failed/);
  assert.equal(open().list()[0].archived, undefined);
  assert.equal(fs.existsSync(path.join(root, a.id, 'meta.json.tmp')), false);
  failMeta = false;
  store.list();
  failIndex = true;
  store.setArchived(a.id, true);
  assert.equal(fs.existsSync(path.join(root, 'index.json')), false);
  assert.equal(open().list()[0].archived, true);
});

test('archive scopes preserve type/search/tag/date composition and full link URL path search', () => {
  const entries = [
    { id: 'old', type: 'text', tags: ['active'], createdMs: new Date(2020, 1, 3).getTime() },
    { id: 'a', type: 'link', archived: true, sourceUrl: 'https://example.com/unique-archive-path', tags: ['archive'], createdMs: new Date(2020, 1, 3).getTime() }
  ];
  assert.deepEqual(Q.filterEntries(entries, {}).map((m) => m.id), ['old']);
  assert.deepEqual(Q.filterEntries(entries, { type: 'link' }), []);
  assert.deepEqual(Q.filterEntries(entries, { type: 'archived', query: 'unique-archive-path', tags: ['archive'], range: { from: '2020-2-3', to: '2020-2-3' } }).map((m) => m.id), ['a']);
  assert.deepEqual(Q.tagCounts(Q.scopeEntries(entries)), [{ tag: 'active', count: 1 }]);
  assert.deepEqual(Q.tagCounts(Q.scopeEntries(entries, 'archived')), [{ tag: 'archive', count: 1 }]);
});

test('real IPC supports missing-file archive/recovery and home calendar counts exclude archived records', (t) => {
  const { root } = fixture(t);
  const handlers = new Map();
  const controller = createInboxController({ root, E2E: true, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} } });
  controller.register();
  const file = path.join(root, '..', path.basename(root) + '-file.txt');
  t.after(() => fs.rmSync(file, { force: true }));
  fs.writeFileSync(file, '附件');
  const m = controller.store.addFile(file);
  const attachment = path.join(root, m.id, m.file);
  const target = fs.readlinkSync(attachment);
  fs.unlinkSync(file);
  const counts = handlers.get('inbox:dayCounts');
  const days = handlers.get('inbox:days');
  assert.equal(Object.values(counts()).reduce((a, b) => a + b, 0), 1);
  const set = handlers.get('inbox:setArchived');
  assert.deepEqual(set(null, m.id, true), { ok: true, archived: true });
  assert.deepEqual(days(), []);
  assert.deepEqual(counts(), {});
  assert.equal(controller.store.list()[0].missing, true);
  assert.equal(fs.readlinkSync(attachment), target);
  assert.equal(set(null, m.id, 'toggle').ok, false);
  assert.equal(set(null, m.id, false).ok, true);
  assert.equal(Object.values(counts()).reduce((a, b) => a + b, 0), 1);
  const manual = handlers.get('inbox:addManual')(null, ' https://example.com/full-url-path ');
  assert.equal(manual.ok, true);
  const link = controller.store.list().find((e) => e.id === manual.ids[0]);
  assert.equal(link.type, 'link');
  assert.equal(link.sourceUrl, 'https://example.com/full-url-path');
  assert.equal(link.via, 'manual');
});

test('actual renderer keeps scope filters, removable selected tags and scope dates fresh after list refresh', () => {
  const vm = require('node:vm');
  const { parseHTML } = require('linkedom');
  const renderer = path.join(__dirname, '../electron/renderer');
  const { document } = parseHTML(fs.readFileSync(path.join(renderer, 'calendar.html'), 'utf8'));
  const el = (id) => document.getElementById(id);
  const current = { id: 'current', type: 'text', title: '当前', tags: ['当前'], createdMs: new Date(2020, 1, 4).getTime() };
  const archived = { id: 'archive', type: 'link', title: '归档', tags: ['历史'], archived: true, createdMs: new Date(2020, 1, 3).getTime() };
  const filter = { query: '', type: 'all', tags: ['当前'], range: null, day: null };
  const ctx = vm.createContext({ document, IQ: Q, INBOX_TAG_SHOW: 6,
    inboxEntries: [current, archived], inboxFilter: filter,
    inboxTagsEl: el('inbox-tags'), inboxMoreMenu: el('inbox-more-menu'), inboxMore: el('inbox-more'), inboxTagCounts: [],
    inboxTypes: el('inbox-types'), inboxCount: el('inbox-count'), inboxSearch: el('inbox-search'),
    inboxView: { hidden: false }, inboxDetail: { hidden: true }, inboxListNeedsRender: false,
    inboxList: el('inbox-list'), inboxEmpty: el('inbox-empty'), inboxNoResult: el('inbox-noresult'),
    inboxMiniCal: el('inbox-minical'), inboxMiniTitle: el('inbox-minical-title'), inboxMiniGrid: el('inbox-minical-grid'),
    inboxDaySet: new Set(['2020-2-4']), miniMonth: { y: 2020, m: 1 }, inboxPickStart: null,
    api: { inboxTagMenu() {} }, closeTagPop() {}, syncInboxPresets() {}, updateInboxRangeChip() {},
    setInboxDay(day) { filter.day = day; filter.range = null; },
    buildInboxRow(m) { const row = document.createElement('div'); row.dataset.id = m.id; return row; },
    inboxFilterActive: () => Boolean(filter.query || !['all', 'archived'].includes(filter.type) || filter.tags.length || filter.range)
  });
  const source = fs.readFileSync(path.join(renderer, 'calendar.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function renderInboxTags()'), source.indexOf('function updateInboxRangeChip()')), ctx);
  vm.runInContext(source.slice(source.indexOf('function clearInboxFilters()'), source.indexOf('function rowAction(')), ctx);
  vm.runInContext(source.slice(source.indexOf('function renderInbox(entries)'), source.indexOf('const inboxArchivePending')), ctx);
  vm.runInContext(source.slice(source.indexOf('function renderMiniCal()'), source.indexOf("document.getElementById('inbox-cal-toggle').addEventListener")), ctx);
  ctx.inboxMiniCal.hidden = false;
  ctx.setInboxType('archived');
  assert.deepEqual(Array.from(filter.tags), ['当前']);
  assert.equal(el('inbox-noresult').hidden, false);
  assert.equal(el('inbox-empty').hidden, true);
  assert.ok(el('inbox-tags').querySelector('[data-tag="当前"].is-active'));
  assert.equal(el('inbox-minical-grid').querySelector('[data-day="2020-2-3"] .inbox-dot') !== null, true);
  assert.equal(el('inbox-minical-grid').querySelector('[data-day="2020-2-4"] .inbox-dot'), null);
  ctx.toggleInboxTag('当前');
  assert.equal(el('inbox-list').querySelector('[data-id="archive"]') !== null, true);
  const added = { ...archived, id: 'new', createdMs: new Date(2020, 1, 5).getTime() };
  ctx.renderInbox([current, archived, added]);
  assert.ok(el('inbox-minical-grid').querySelector('[data-day="2020-2-5"] .inbox-dot'));
  filter.query = 'no match'; filter.tags = ['历史'];
  ctx.clearInboxFilters();
  assert.equal(filter.type, 'archived');
  assert.equal(filter.query, '');
  assert.deepEqual(Array.from(filter.tags), []);
  ctx.renderInbox([current]);
  assert.match(el('inbox-empty').textContent, /还没有归档/);
  assert.equal(el('inbox-noresult').hidden, true);
  assert.deepEqual([...ctx.inboxDaySet], ['2020-2-4']);
});
