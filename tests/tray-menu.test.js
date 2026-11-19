'use strict';
// 0.1.40 C1：托盘右键菜单模板。
const test = require('node:test');
const assert = require('node:assert');
const { buildTrayMenuTemplate } = require('../electron/settings-menu');

test('C1 托盘右键菜单顺序、文案和快捷键', () => {
  const t = buildTrayMenuTemplate();
  assert.deepStrictEqual(t.map((i) => i.type === 'separator' ? '---' : i.label), ['检查更新…', '设置中心…', '---', '退出栏历']);
  assert.strictEqual(t[3].accelerator, 'CommandOrControl+Q');
});

test('C1 菜单项调用对应动作', () => {
  const calls = [];
  const t = buildTrayMenuTemplate({ checkUpdate: () => calls.push('u'), openSettings: () => calls.push('s'), quit: () => calls.push('q') });
  t[0].click(); t[1].click(); t[3].click();
  assert.deepStrictEqual(calls, ['u', 's', 'q']);
});
