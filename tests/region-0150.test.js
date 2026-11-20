'use strict';
// 0.1.50 框选收纳：纯函数。
const test = require('node:test');
const assert = require('node:assert');
const H = require('../electron/region-helpers');

test('R 矩形规范化：任意方向拖动都得到左上角 + 正宽高', () => {
  assert.deepStrictEqual(H.normalizeRect(300, 200, 100, 50), { x: 100, y: 50, width: 200, height: 150 });
  assert.deepStrictEqual(H.normalizeRect(10, 10, 490, 330), { x: 10, y: 10, width: 480, height: 320 });
});

test('R-C4 小于 8×8 视为误触', () => {
  assert.strictEqual(H.isTooSmall({ x: 0, y: 0, width: 7, height: 100 }), true);
  assert.strictEqual(H.isTooSmall({ x: 0, y: 0, width: 100, height: 7 }), true);
  assert.strictEqual(H.isTooSmall({ x: 0, y: 0, width: 8, height: 8 }), false);
});

test('R-C2 询问条在框下方，贴底时翻到上方，水平不出屏', () => {
  const view = { width: 1000, height: 800 }; const bar = { width: 200, height: 36 };
  assert.deepStrictEqual(H.barPlacement({ x: 100, y: 100, width: 300, height: 200 }, view, bar), { left: 100, top: 308, side: 'below' });
  assert.deepStrictEqual(H.barPlacement({ x: 100, y: 500, width: 300, height: 280 }, view, bar), { left: 100, top: 456, side: 'above' });
  assert.strictEqual(H.barPlacement({ x: 950, y: 100, width: 40, height: 40 }, view, bar).left, 800);
});

test('R-C3 截取区域按缩放比换算并夹到图像内', () => {
  assert.deepStrictEqual(H.cropRect({ x: 10, y: 20, width: 480, height: 320 }, 2), { x: 20, y: 40, width: 960, height: 640 });
  assert.deepStrictEqual(H.cropRect({ x: 10, y: 20, width: 480, height: 320 }, 1), { x: 10, y: 20, width: 480, height: 320 });
  assert.deepStrictEqual(H.cropRect({ x: 900, y: 0, width: 300, height: 10 }, 1, { width: 1000, height: 800 }), { x: 900, y: 0, width: 100, height: 10 });
});

test('R-C6 快捷键校验与规范化', () => {
  assert.strictEqual(H.normalizeAccelerator('Control+Alt+S'), 'Control+Alt+S');
  assert.strictEqual(H.normalizeAccelerator('alt+ctrl+s'), 'Control+Alt+S');
  assert.strictEqual(H.normalizeAccelerator('Cmd+Shift+2'), 'Command+Shift+2');
  assert.strictEqual(H.normalizeAccelerator('S'), '');
  assert.strictEqual(H.normalizeAccelerator('Shift+S'), '');
  assert.strictEqual(H.normalizeAccelerator('Hyper+S'), '');
  assert.strictEqual(H.normalizeAccelerator(''), '');
  assert.strictEqual(H.isValidAccelerator('Control+Alt+V'), true);
  assert.strictEqual(H.acceleratorLabel('Control+Alt+S'), '⌃⌥S');
  assert.strictEqual(H.acceleratorLabel('Command+Shift+2'), '⇧⌘2');
});

test('R-C6 录键：KeyboardEvent → accelerator，只按修饰键不算', () => {
  assert.strictEqual(H.eventToAccelerator({ code: 'KeyB', ctrlKey: true, altKey: true }), 'Control+Alt+B');
  assert.strictEqual(H.eventToAccelerator({ code: 'ControlLeft', ctrlKey: true }), '');
  assert.strictEqual(H.eventToAccelerator({ code: 'KeyB' }), '');
  assert.strictEqual(H.eventToAccelerator({ code: 'Digit4', metaKey: true, shiftKey: true }), 'Command+Shift+4');
});

test('浏览器版 helpers 与主进程版一致', () => {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/renderer/region-helpers-browser.js'), 'utf8'), ctx);
  assert.strictEqual(ctx.window.LanliRegionHelpers.acceleratorLabel('Control+Alt+V'), '⌃⌥V');
  assert.deepStrictEqual(Object.keys(ctx.window.LanliRegionHelpers).sort(), Object.keys(H).sort());
});
