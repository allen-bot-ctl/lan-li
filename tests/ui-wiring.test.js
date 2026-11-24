'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('0.1.63 settings button has no native menu; settings page has quit button with confirm', () => {
  const main = source('electron/main.js');
  const html = source('electron/renderer/calendar.html');
  assert.equal(/openSettingsMenu|settingsMenuAnchor/.test(main), false);
  assert.match(html, /id="settings-quit"[^>]*>退出栏历</);
  assert.match(html, /确定退出栏历吗？/);
  assert.match(main, /ipcMain\.on\('app:quit', \(\) => \{ quitApp\(\); \}\)/);
});

test('weather card is a single row ending with 更换 ›', () => {
  const css = source('electron/renderer/calendar.css');
  const html = source('electron/renderer/calendar.html');

  assert.match(css, /\.weather-card\s*\{[^}]*align-items:\s*center;/s);
  assert.match(css, /\.weather-card\s*\{[^}]*gap:\s*5px;/s);
  assert.equal(/\.weather-body|\.weather-info/.test(css), false);

  const card = html.match(/<button class="card weather-card"[\s\S]*?<\/button>/);
  assert.ok(card, 'weather card should exist');
  assert.equal(/card-head/.test(card[0]), false);
  assert.match(card[0], /id="weather-emoji"/);
  assert.match(card[0], /id="weather-temp"/);
  assert.match(card[0], /id="weather-city"/);
  assert.match(card[0], /<span class="[^"]*\bcard-link\b[^"]*\bweather-change\b[^"]*">更换 ›<\/span>/);
  assert.equal(/<button[^>]*>[^<]*<button/.test(card[0]), false);
});

test('almanac focus card replaces the six-item lists', () => {
  const html = source('electron/renderer/calendar.html');
  const renderer = source('electron/renderer/calendar.js');

  for (const id of [
    'almanac-focus-yi',
    'almanac-focus-ji',
    'almanac-quote'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /class="[^"]*\bweather-change\b[^"]*"/);
  assert.equal(/id="almanac-yi"/.test(html), false);
  assert.equal(/id="almanac-ji"/.test(html), false);
  assert.equal(/almanac-items/.test(html), false);
  assert.equal(/almanacYi|almanacJi/.test(renderer), false);
});

test('clock candidates drop added zones and only report no match for a query', () => {
  const renderer = source('electron/renderer/calendar.js');

  assert.match(renderer, /rows\.filter\(\(row\)\s*=>\s*row && !row\.added\)/);
  assert.match(renderer, /clockSearch\.value\.trim\(\) === ''/);
  assert.equal(/meta\.textContent = '已添加'/.test(renderer), false);
});

test('weather picker lists quick cities when the search box is empty', () => {
  const renderer = source('electron/renderer/calendar.js');
  const preload = source('electron/preload.js');
  const main = source('electron/main.js');

  assert.match(renderer, /weatherSearch\.value\.trim\(\) === ''/);
  assert.match(renderer, /section\.textContent = '常用城市'/);
  assert.match(renderer, /api\.getQuickCities\(\)/);
  // 0.1.36：选中行改为 is-selected + ✓，不再写「已选」。
  assert.ok(renderer.includes("button.classList.add('is-selected')"));
  assert.equal(renderer.includes("tag.textContent = '已选'"), false);
  assert.match(preload, /getQuickCities:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('weather:quickCities'\)/);
  assert.match(main, /ipcMain\.handle\('weather:quickCities'/);
});

test('检查更新图标在右上顶栏并调用同一个更新检查 IPC', () => {
  const html = source('electron/renderer/calendar.html');
  const renderer = source('electron/renderer/calendar.js');
  const preload = source('electron/preload.js');

  const topbar = html.match(/<header class="topbar">[\s\S]*?<\/header>/);
  assert.ok(topbar, 'topbar should exist');
  assert.match(topbar[0], /class="topbar-icon check-update"[\s\S]*?id="check-update"/);
  assert.match(topbar[0], /aria-label="检查更新"/);
  assert.match(html, /<div class="pane-footer">[\s\S]*?id="app-version"[\s\S]*?<\/div>/);
  assert.equal(/id="check-update"/.test(html.match(/<div class="pane-footer">[\s\S]*?<\/div>/)[0]), false);
  assert.match(
    renderer,
    /checkUpdate\.addEventListener\('click', \(\) => \{[\s\S]*?api\.checkUpdate\(\);[\s\S]*?\}\);/
  );
  assert.match(preload, /checkUpdate:\s*\(\)\s*=>\s*ipcRenderer\.send\('update:check'\)/);
});

test('main reuses requestUpdateCheck for the footer update entry', () => {
  const main = source('electron/main.js');

  const handler = main.match(/ipcMain\.on\('update:check',[\s\S]*?\n  \}\);/);
  assert.ok(handler, 'update:check handler should be registered');
  assert.match(handler[0], /requestUpdateCheck\(\)/);
  assert.equal(/autoUpdater|updater\.checkNow/.test(handler[0]), false);
  assert.ok((main.match(/requestUpdateCheck\(\)/g) || []).length >= 2);
});
