'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readInboxDateLinkEnabled, writeInboxDateLinkEnabled } = require('../electron/inbox-date-link');

test('日历收纳链接默认开启，仅明确布尔 false 关闭', () => {
  for (const input of [undefined, {}, { inboxDateLinkEnabled: true }, { inboxDateLinkEnabled: 'false' }]) {
    assert.equal(readInboxDateLinkEnabled(input), true);
  }
  assert.equal(readInboxDateLinkEnabled({ inboxDateLinkEnabled: false }), false);
});

test('关闭、重新开启及读取新偏好均保留原有设置', () => {
  let saved = { menuBarShowDate: false, nested: { sample: true } };
  const persist = (next) => { saved = JSON.parse(JSON.stringify(next)); return true; };
  assert.deepEqual(writeInboxDateLinkEnabled(saved, false, persist), { ok: true, inboxDateLinkEnabled: false });
  assert.equal(readInboxDateLinkEnabled(saved), false);
  assert.deepEqual(writeInboxDateLinkEnabled(saved, true, persist), { ok: true, inboxDateLinkEnabled: true });
  assert.deepEqual(saved, { menuBarShowDate: false, nested: { sample: true }, inboxDateLinkEnabled: true });
});

test('重复值及非法类型不写；写入失败保留曾保存的状态', () => {
  const noWrite = () => { assert.fail('不应写磁盘'); };
  const saved = { inboxDateLinkEnabled: false };
  assert.deepEqual(writeInboxDateLinkEnabled(saved, false, noWrite), { ok: true, inboxDateLinkEnabled: false });
  assert.deepEqual(writeInboxDateLinkEnabled(saved, 'false', noWrite), { ok: false, inboxDateLinkEnabled: false });
  assert.deepEqual(writeInboxDateLinkEnabled(saved, true, () => false), { ok: false, inboxDateLinkEnabled: false });
  assert.equal(saved.inboxDateLinkEnabled, false);
});
