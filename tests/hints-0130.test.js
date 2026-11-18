'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const html = read('electron', 'renderer', 'calendar.html');
const css = read('electron', 'renderer', 'calendar.css');
const renderer = read('electron', 'renderer', 'calendar.js');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `CSS rule ${selector} should exist`);
  return match[1];
}

test('0.1.33 签筒按钮用风格主色，取不到时用 --accent', () => {
  const rule = cssRule('.almanac-redraw');
  assert.match(rule, /color:\s*var\(--almanac-accent-light,\s*var\(--accent\)\)/);
  assert.match(css, /prefers-color-scheme: dark\)\s*\{\s*\.almanac-redraw\s*\{\s*color:\s*var\(--almanac-accent-dark,\s*var\(--accent\)\)/);
});

test('0.1.30 C2 黄历卡标题后常驻 ›，悬停变 --chip-hover 并带「查看黄历详情」气泡', () => {
  assert.match(cssRule('.almanac-style-name::after'), /content:\s*'›'/);
  assert.match(cssRule('.almanac-card:hover'), /background:\s*var\(--chip-hover\)/);
  assert.match(html, /id="almanac-card"[^>]*data-tooltip="查看黄历详情"[^>]*data-tooltip-place="above"/);
});

test('0.1.30 C3 年月标题带 ⌄，标题与翻月按钮都有气泡文字', () => {
  assert.match(html, /<span class="month-title-caret" aria-hidden="true">⌄<\/span>/);
  assert.match(cssRule('.month-title:hover'), /background:\s*var\(--chip-hover\)/);
  assert.match(html, /<label class="month-title" data-tooltip="选择年份">/);
  assert.match(html, /id="prev-month"[^>]*data-tooltip="上个月"/);
  assert.match(html, /id="next-month"[^>]*data-tooltip="下个月"/);
  assert.match(html, /id="today-button"[^>]*data-tooltip="回到今天"/);
  assert.match(renderer, /button\.dataset\.tooltip \|\|/);
  assert.match(renderer, /document\.querySelectorAll\('\[data-tooltip\]'\)/);
});

test('0.1.31 C10 选中非今天时卡片带 is-dated，悬停不显示「去定制 ›」也不让标题让位', () => {
  assert.match(renderer, /almanacCard\.classList\.toggle\('is-dated', !isTodayAlmanac\(almanac\)\)/);
  assert.match(css, /\.almanac-card\.is-dated:hover #almanac-customize,\s*\.almanac-card\.is-dated:focus-within #almanac-customize\s*\{\s*opacity:\s*0;\s*visibility:\s*hidden;/);
  assert.match(css, /\.almanac-card:not\(\.is-dated\):hover \.almanac-style-name,\s*\.almanac-card:not\(\.is-dated\):focus-within \.almanac-style-name\s*\{\s*max-width:\s*calc\(100% - 50px\);/);
});
