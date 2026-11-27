'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { createInboxController } = require('../electron/inbox-main');

test('narrow removeItemTag IPC changes only its target and retains shared library tags', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-item-tag-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  const controller = createInboxController({ root, E2E: true, ipcMain: { handle: (n, f) => handlers.set(n, f), on() {} } });
  controller.register();
  const a = controller.store.addText({ text: '目标 A' });
  const b = controller.store.addText({ text: '共享 B' });
  controller.store.addTag(a.id, '共享');
  controller.store.addTag(b.id, '共享');
  const remove = handlers.get('inbox:removeItemTag');
  assert.deepEqual(remove(null, a.id, '共享'), { ok: true, tags: [] });
  assert.deepEqual(controller.store.get(b.id).meta.tags, ['共享']);
  assert.ok(controller.store.listTags().some((tag) => tag.name === '共享'));
  assert.equal(remove(null, a.id, null).ok, false);
  assert.equal(remove(null, '../escape', '共享').ok, false);
});

test('actual list popup ignores late responses after close/retarget and retains its original item after filtering', async () => {
  const renderer = path.join(__dirname, '../electron/renderer');
  const { document } = parseHTML(fs.readFileSync(path.join(renderer, 'calendar.html'), 'utf8'));
  const el = (id) => document.getElementById(id);
  const writes = [];
  const pending = [];
  const ctx = vm.createContext({ document,
    IQ: require('../electron/renderer/inbox-query'),
    inboxTagPop: el('inbox-tagpop'), inboxTagInput: el('inbox-tag-input'),
    inboxTagSuggest: el('inbox-tag-suggest'), inboxTagErr: el('inbox-tagpop-err'),
    inboxView: { getBoundingClientRect: () => ({ top: 0, right: 580, width: 580, height: 400 }) },
    refreshInbox() {}, findInboxRow() { return null; }, inboxSearch: el('inbox-search'),
    api: { inboxTags: async () => [{ name: '共享' }, { name: '其它' }],
      addInboxTag: (id, name) => { writes.push([id, name]); return new Promise((resolve) => pending.push(resolve)); },
      removeInboxItemTag: (id, name) => { writes.push([id, name]); return Promise.resolve({ ok: true, tags: [] }); } }
  });
  const source = fs.readFileSync(path.join(renderer, 'calendar.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('let inboxTagLib = []'), source.indexOf("inboxSearch.addEventListener('input'")), ctx);
  const anchor = { getBoundingClientRect: () => ({ top: 120, bottom: 140, right: 500 }) };
  ctx.openTagPop({ id: 'A', tags: ['共享'] }, anchor);
  await Promise.resolve();
  await ctx.changeItemTag('共享', true);
  assert.deepEqual(Array.from(el('inbox-tag-suggest').children).filter((b) => b.dataset.tag === '共享').map((b) => b.getAttribute('aria-pressed')), ['false']);
  const first = ctx.changeItemTag('共享');
  await ctx.changeItemTag('共享'); // repeated clicks while busy cannot duplicate writes
  ctx.closeTagPop();
  ctx.openTagPop({ id: 'B', tags: ['其它'] }, anchor);
  el('inbox-tag-input').value = 'B 搜索';
  pending.shift()({ ok: true, tags: ['共享'] });
  await first;
  assert.equal(el('inbox-tag-input').value, 'B 搜索');
  assert.equal(vm.runInContext('inboxTagSession.id', ctx), 'B');
  assert.deepEqual(Array.from(vm.runInContext('inboxTagSession.tags', ctx)), ['其它']);
  assert.deepEqual(writes, [['A', '共享'], ['A', '共享']]);
  ctx.closeTagPop();
  await Promise.resolve();
  assert.equal(el('inbox-tagpop').hidden, true);
});
