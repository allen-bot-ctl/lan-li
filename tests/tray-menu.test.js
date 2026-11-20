'use strict';
// 0.1.40 C1：托盘右键菜单模板。
const test = require('node:test');
const assert = require('node:assert');
const { buildTrayMenuTemplate } = require('../electron/settings-menu');

test('C1 托盘右键菜单顺序、文案和快捷键', () => {
  const t = buildTrayMenuTemplate();
  assert.deepStrictEqual(t.map((i) => i.type === 'separator' ? '---' : i.label), ['检查更新…', '收纳剪贴板内容', '框选收纳', '设置中心…', '---', '退出栏历']);
  assert.strictEqual(t[1].accelerator, 'Control+Alt+V');
  assert.strictEqual(t[1].registerAccelerator, false);
  assert.strictEqual(t[2].accelerator, 'Control+Alt+S');
  assert.strictEqual(t[2].registerAccelerator, false);
  assert.strictEqual(t[5].accelerator, 'CommandOrControl+Q');
});

test('C1 菜单项调用对应动作', () => {
  const calls = [];
  const t = buildTrayMenuTemplate({ checkUpdate: () => calls.push('u'), openSettings: () => calls.push('s'), captureClipboard: () => calls.push('c'), regionCapture: () => calls.push('r'), quit: () => calls.push('q') });
  t[0].click(); t[1].click(); t[2].click(); t[3].click(); t[5].click();
  assert.deepStrictEqual(calls, ['u', 'c', 'r', 's', 'q']);
});

test('0.1.50 托盘菜单显示当前快捷键；清空后不显示', () => {
  const t = buildTrayMenuTemplate({}, { captureAccelerator: '', regionAccelerator: 'Control+Alt+B' });
  assert.strictEqual(t[1].accelerator, undefined);
  assert.strictEqual(t[2].accelerator, 'Control+Alt+B');
  assert.strictEqual(t[2].registerAccelerator, false);
});
