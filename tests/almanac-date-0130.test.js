'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseDateKey, buildAlmanac } = require('../electron/calendar');

const ROOT = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');

test('0.1.30 C4 parseDateKey 只接受合法的 YYYY-MM-DD', () => {
  const date = parseDateKey('2026-12-02');
  assert.ok(date instanceof Date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 11);
  assert.equal(date.getDate(), 2);
  for (const bad of ['2026-2-02', '2026-02-30', '2026-13-01', '1899-12-31', '2101-01-01', '', null, 20261202, '2026-12-02T00:00']) {
    assert.equal(parseDateKey(bad), null, String(bad));
  }
});

test('0.1.30 C4 黄历带出日期键与公历月日', () => {
  const almanac = buildAlmanac(new Date(2026, 11, 2), 'coder');
  assert.equal(almanac.dateKey, '2026-12-02');
  assert.equal(almanac.solarText, '12月2日');
  assert.equal(buildAlmanac(new Date(2026, 10, 18), 'lunar').dateKey, '2026-11-18');
});

test('0.1.30 C4 主进程按日期取黄历的接口与 preload 一一对应', () => {
  assert.match(
    main,
    /ipcMain\.handle\('almanac:getForDate',\s*\(_event,\s*key\)\s*=>\s*\{\s*const date = parseDateKey\(key\);\s*return date \? buildAlmanac\(date, almanacStyle\) : null;/
  );
  assert.match(preload, /getAlmanacForDate: \(key\) => ipcRenderer\.invoke\('almanac:getForDate', key\)/);
});

test('0.1.30 C5 窗口从隐藏到显示时 openSeq 递增并随状态下发', () => {
  assert.match(main, /if \(!wasVisible\) \{\s*openSeq \+= 1;/);
  assert.match(main, /openSeq,\s*pinned\s*\}/);
});
