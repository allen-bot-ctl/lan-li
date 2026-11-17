'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('settings menu anchors to the button left edge four pixels below', () => {
  const main = source('electron/main.js');
  const renderer = source('electron/renderer/calendar.js');

  assert.equal(/SETTINGS_MENU_WIDTH/.test(main), false);
  assert.match(renderer, /x:\s*Math\.round\(rect\.left\)/);
  assert.match(renderer, /y:\s*Math\.round\(rect\.bottom \+ 4\)/);
  assert.match(main, /x:\s*Math\.max\(0,\s*Math\.round\(x\)\)/);
});

test('weather card stretches its header so 更换城市 sits on the right', () => {
  const css = source('electron/renderer/calendar.css');
  assert.match(css, /\.weather-card\s*\{[^}]*align-items:\s*stretch;/s);
});

test('clock candidates drop added zones and only report no match for a query', () => {
  const renderer = source('electron/renderer/calendar.js');

  assert.match(renderer, /rows\.filter\(\(row\)\s*=>\s*row && !row\.added\)/);
  assert.match(renderer, /clockSearch\.value\.trim\(\) === ''/);
  assert.equal(/meta\.textContent = '已添加'/.test(renderer), false);
});
