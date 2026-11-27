'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeStatus } = require('../electron/update-status');

test('manual check states map to short labels and timing flags', () => {
  assert.deepEqual(describeStatus({ state: 'checking' }), {
    state: 'checking',
    label: '正在检查…',
    busy: true,
    timed: false
  });

  assert.deepEqual(describeStatus({ state: 'downloading' }), {
    state: 'downloading',
    label: '正在下载…',
    busy: true,
    timed: false
  });

  assert.deepEqual(describeStatus({ state: 'up-to-date' }), {
    state: 'up-to-date',
    label: '已是最新',
    busy: false,
    timed: true
  });

  assert.deepEqual(describeStatus({ state: 'disabled' }), {
    state: 'disabled',
    label: '开发态不检查更新',
    busy: false,
    timed: true
  });

  assert.deepEqual(describeStatus({ state: 'error' }), {
    state: 'error',
    label: '检查失败',
    busy: false,
    timed: true
  });
});

test('ready restores the entry and unknown states fail closed', () => {
  assert.deepEqual(describeStatus({ state: 'ready', name: 'v0.1.3' }), {
    state: 'ready',
    label: '',
    busy: false,
    timed: false
  });

  assert.deepEqual(describeStatus(null), {
    state: 'error',
    label: '检查失败',
    busy: false,
    timed: true
  });
});


test('download and preparation failures have distinct in-app retry labels', () => {
  for (const [state, label] of [['download-error', '下载失败'], ['prepare-error', '更新未完成']]) {
    assert.deepEqual(describeStatus({ state }), { state, label, busy: false, timed: true });
  }
});
