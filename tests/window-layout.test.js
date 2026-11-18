'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { computePanelBounds } = require('../electron/window-layout');

const WIDTH = 580;
const HEIGHT = 432;
// 1280×800 display with a 25px macOS menu bar.
const AREA = { x: 0, y: 25, width: 1280, height: 800 };

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('C8 1280×800 下 580×432 面板完整落在菜单栏下方', () => {
  const bounds = computePanelBounds(
    { x: 1200, y: 0, width: 40, height: 25 },
    AREA,
    WIDTH,
    HEIGHT
  );

  assert.equal(bounds.width, 580);
  assert.equal(bounds.height, 432);
  assert.equal(bounds.y, 25, 'panel starts at the menu-bar bottom');
  assert.ok(bounds.y >= AREA.y);
  assert.ok(bounds.y + bounds.height <= AREA.y + AREA.height);
  assert.ok(bounds.x >= AREA.x);
  assert.ok(bounds.x + bounds.width <= AREA.x + AREA.width);
  // Right edge of the panel follows the right edge of the tray item.
  assert.equal(bounds.x + bounds.width, 1240);
});

test('C8 托盘靠左时面板也不越出左边界', () => {
  const bounds = computePanelBounds(
    { x: 0, y: 0, width: 40, height: 25 },
    AREA,
    WIDTH,
    HEIGHT
  );
  assert.equal(bounds.x, 0);
  assert.equal(bounds.x + bounds.width, 580);
});

test('C8 托盘贴近屏幕右缘时面板钳在 workArea 内', () => {
  const bounds = computePanelBounds(
    { x: 1240, y: 0, width: 40, height: 25 },
    AREA,
    WIDTH,
    HEIGHT
  );
  assert.equal(bounds.x + bounds.width, AREA.x + AREA.width);
});

test('窗口尺寸常量与 CSS 同步为 580×432，定位使用注入的纯函数', () => {
  const main = source('electron/main.js');
  const css = source('electron/renderer/calendar.css');

  assert.match(main, /const WINDOW_WIDTH = 580;/);
  assert.match(main, /const WINDOW_HEIGHT = 432;/);
  assert.match(main, /width: WINDOW_WIDTH,\s*\n\s*height: WINDOW_HEIGHT,/);
  assert.match(main, /computePanelBounds\(bounds, area, WINDOW_WIDTH, WINDOW_HEIGHT\)/);
  assert.match(main, /calendarWindow\.setBounds\(target\)/);

  assert.match(css, /html,\s*\nbody \{[^}]*width: 580px;[^}]*height: 432px;/s);
  assert.equal(/height:\s*400px/.test(css), false);
});
