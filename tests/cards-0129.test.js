'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(
  path.join(ROOT, 'electron', 'renderer', 'calendar.html'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(ROOT, 'electron', 'renderer', 'calendar.css'),
  'utf8'
);
const renderer = fs.readFileSync(
  path.join(ROOT, 'electron', 'renderer', 'calendar.js'),
  'utf8'
);

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `CSS rule ${selector} should exist`);
  return match[1];
}

test('检查更新图标是圆环加下箭头，且只在加载时转弧线', () => {
  const checkButton = html.match(
    /<button[^>]*id="check-update"[\s\S]*?<\/button>/
  );
  assert.ok(checkButton, '#check-update button should exist');
  assert.match(checkButton[0], /<circle class="update-ring"[\s\S]*\/>/);
  assert.match(checkButton[0], /<path class="update-arc"[\s\S]*\/>/);
  assert.match(checkButton[0], /<path class="update-arrow"[\s\S]*\/>/);
  assert.equal(checkButton[0].includes('M17.65'), false);

  const spinningArc = cssRule('.check-update.is-spinning .update-arc');
  assert.match(spinningArc, /animation:\s*topbar-spin 1s linear infinite/);
  assert.match(cssRule('.update-arc'), /display:\s*none/);

  for (const match of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const selectors = match[1];
    const body = match[2];
    assert.equal(
      /\.update-arrow/.test(selectors) && /animation:/.test(body),
      false,
      `update-arrow should not animate: ${selectors.trim()}`
    );
    assert.equal(
      /\.is-spinning\s+\.update-icon/.test(selectors) && /animation:/.test(body),
      false,
      `spinning update-icon should not animate: ${selectors.trim()}`
    );
  }
});

test('黄历签语带「签」标签且去掉第二行', () => {
  const row = html.match(/<div class="almanac-quote-row">[\s\S]*?<\/div>/);
  assert.ok(row, '.almanac-quote-row should exist');
  assert.match(row[0], /class="almanac-tag almanac-tag-qian">签</);
  assert.match(row[0], /id="almanac-quote"/);
  assert.equal(html.includes('id="almanac-meta"'), false);

  assert.match(cssRule('.almanac-quote'), /text-overflow:\s*ellipsis/);
  assert.match(cssRule('.almanac-tag-qian'), /var\(--almanac-accent-light,\s*var\(--accent\)\)/);

  assert.equal(renderer.includes('almanacMeta'), false);
  assert.ok(renderer.includes('建除 · 值神 · 冲煞'));
});

test('天气卡片在气温后渲染气温区间小字', () => {
  assert.match(
    html,
    /id="weather-temp"[^>]*>—<\/span>\s*<span class="weather-range" id="weather-range" hidden><\/span>/
  );

  const range = cssRule('.weather-range');
  assert.match(range, /font-size:\s*11px/);
  assert.match(range, /var\(--muted-strong\)/);
  assert.match(cssRule('.weather-range[hidden]'), /display:\s*none/);

  assert.ok(renderer.includes('rangeText'));
});
