'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const HTML = source('electron/renderer/calendar.html');
const RENDERER = source('electron/renderer/calendar.js');
const CSS = source('electron/renderer/calendar.css');
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const README = source('README.md');
const PRODUCT = source('docs/product.md');
const SITE = source('site/index.html');

function rules() {
  return [...CSS_NO_COMMENTS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selectorText, body]) => ({
      selectors: selectorText
        .split(',')
        .map((selector) => selector.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
      body: body.trim()
    })
  );
}

const ALL_RULES = rules();

function ruleFor(selector) {
  const matches = ALL_RULES.filter((rule) => rule.selectors.includes(selector));
  assert.equal(matches.length, 1, `expected exactly one rule for ${selector}`);
  return matches[0];
}

function topbarHtml() {
  const match = HTML.match(/<header class="topbar">([\s\S]*?)<\/header>/);
  assert.ok(match, 'topbar should exist');
  return match[0];
}

function calendarPaneHtml() {
  const match = HTML.match(/<main class="calendar-pane">([\s\S]*?)<\/main>/);
  assert.ok(match, 'calendar pane should exist');
  return match[0];
}

test('C2 通栏顶栏：32px、左上是应用图标＋栏历、右上检查更新→钉住→设置，设置最后', () => {
  const topbar = topbarHtml();
  const left = topbar.match(/<div class="topbar-left">([\s\S]*?)<\/div>/);
  const right = topbar.match(/<div class="topbar-right">([\s\S]*?)<\/div>\s*<\/header>/);
  assert.ok(left, 'left group should exist');
  assert.ok(right, 'right group should exist');

  const iconIndex = left[1].indexOf('class="topbar-app-icon"');
  const titleIndex = left[1].indexOf('class="topbar-title"');
  assert.ok(iconIndex >= 0, 'the brand icon leads the left group');
  assert.ok(titleIndex > iconIndex, '栏历 text must follow the icon');
  assert.match(
    left[1],
    /<img class="topbar-app-icon" src="\.\.\/assets\/icon\.png" width="16" height="16" alt="">/
  );
  assert.match(left[1], /class="topbar-title">栏历<\/span>/);
  assert.equal(/<button/.test(left[1]), false, 'the left group holds no buttons');

  const checkIndex = right[1].indexOf('id="check-update"');
  const pinIndex = right[1].indexOf('id="pin-button"');
  const settingsIndex = right[1].indexOf('id="settings-button"');
  assert.ok(checkIndex >= 0, 'the check-update icon belongs to the right group');
  assert.ok(pinIndex > checkIndex, '钉住 sits 4px right of 检查更新');
  assert.ok(settingsIndex > pinIndex, '设置 sits 8px right of 钉住');
  assert.match(right[1], /class="topbar-icon check-update"/);
  assert.match(right[1], /aria-label="检查更新"/);
  assert.match(right[1], /class="topbar-icon pin-button"/);
  assert.equal(/topbar-actions/.test(right[1]), false, 'no empty actions slot');

  const settings = topbar.match(/<button[\s\S]*?id="settings-button"[\s\S]*?<\/button>/);
  assert.ok(settings, 'settings button should exist');
  assert.match(settings[0], /class="nav-pill settings-button"/);
  assert.match(settings[0], /aria-label="设置"/);
  assert.equal(/aria-haspopup/.test(settings[0]), false, '0.1.63 no dropdown');
  assert.match(settings[0], /<span>设置<\/span>/);
  assert.match(settings[0], /class="settings-gear" aria-hidden="true">⚙︎</);
  assert.equal(/title="设置"/.test(settings[0]), false, 'the pill has visible text, no title bubble');

  const bar = ruleFor('.topbar');
  assert.match(bar.body, /height:\s*32px/);
  assert.match(bar.body, /padding:\s*0 15px/);
  assert.match(bar.body, /border-bottom:\s*1px solid var\(--pane-line\)/);
  assert.match(bar.body, /justify-content:\s*space-between/);

  const body = ruleFor('.app-body');
  assert.match(body.body, /display:\s*flex/);
  assert.match(body.body, /flex:\s*1 1 auto/);

  assert.match(ruleFor('.topbar-left').body, /gap:\s*6px/);
  assert.match(ruleFor('.topbar-title').body, /font-size:\s*13px/);
  assert.match(ruleFor('.topbar-title').body, /font-weight:\s*600/);
  assert.match(ruleFor('.topbar-app-icon').body, /width:\s*16px/);
  assert.match(ruleFor('.topbar-app-icon').body, /height:\s*16px/);

  const pill = ruleFor('.nav-pill');
  assert.match(pill.body, /height:\s*26px/);
  assert.match(pill.body, /font-size:\s*12px/);

  // Functional icons: 24px circles, transparent at rest, chip on hover, and
  // the exact 4px / 8px rhythm in front of the settings pill.
  const icon = ruleFor('.topbar-icon');
  assert.match(icon.body, /width:\s*24px/);
  assert.match(icon.body, /height:\s*24px/);
  assert.match(icon.body, /border-radius:\s*50%/);
  assert.match(icon.body, /background:\s*transparent/);
  assert.match(ruleFor('.topbar-icon:hover').body, /background:\s*var\(--chip-hover\)/);
  assert.match(ruleFor('.check-update').body, /margin-right:\s*4px/);
  assert.match(ruleFor('.pin-button').body, /margin-right:\s*8px/);

  const pinned = ruleFor('.pin-button.is-pinned');
  assert.match(pinned.body, /color:\s*var\(--accent\)/);
  assert.match(pinned.body, /color-mix\(in srgb, var\(--accent\) 16%, transparent\)/);
});

test('C3 月历顶栏只剩年月、副标题与 ‹ 今天 ›', () => {
  const nav = HTML.match(/<nav class="month-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'month nav should exist');
  const navIds = [...nav[0].matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(navIds, ['prev-month', 'today-button', 'next-month']);

  const pane = calendarPaneHtml();
  assert.equal(/id="pin-button"/.test(pane), false);
  assert.equal(/id="settings-button"/.test(pane), false);
  assert.equal(/settings-button|pin-button/.test(nav[0]), false);
  assert.match(pane, /id="month-title"/);
  assert.match(pane, /id="lunar-subtitle"/);
});

test('C4 功能图标气泡在按钮下方右对齐并钳在窗口内，交互与 0.1.24 一致', () => {
  assert.match(RENDERER, /const ICON_TOOLTIP_UNPINNED = '钉住窗口，移开鼠标也不隐藏';/);
  assert.match(RENDERER, /const ICON_TOOLTIP_PINNED = '取消钉住并关闭';/);
  assert.match(RENDERER, /const ICON_TOOLTIP_CHECK = '检查更新';/);
  assert.match(RENDERER, /iconTooltipTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 500\);/);
  assert.match(RENDERER, /let left = rect\.right - width;/);
  assert.equal(/let left = rect\.left;/.test(RENDERER), false);
  assert.match(RENDERER, /Math\.min\(left, window\.innerWidth - width - 4\)/);
  assert.match(RENDERER, /let top = rect\.bottom \+ 6;/);
  assert.match(RENDERER, /watchIconTooltip\(pinButton\);/);
  assert.match(RENDERER, /watchIconTooltip\(checkUpdate\);/);
  assert.match(RENDERER, /button\.addEventListener\('mouseleave', hideIconTooltip\)/);
  assert.match(RENDERER, /pinButton\.addEventListener\('click',/);
  assert.match(HTML, /id="icon-tooltip" role="tooltip" hidden>钉住窗口，移开鼠标也不隐藏<\/div>/);

  const tip = ruleFor('.icon-tooltip');
  assert.match(tip.body, /position:\s*fixed/);
  assert.match(tip.body, /font-size:\s*11px/);
  assert.match(tip.body, /white-space:\s*nowrap/);
  assert.match(tip.body, /pointer-events:\s*none/);
});

test('C5 设置胶囊直接进设置页，不再有原生下拉（0.1.63）', () => {
  assert.match(RENDERER, /settingsButton\.addEventListener\('click', \(\) => \{ hideIconTooltip\(\); openSettingsView\(\); \}\);/);
  assert.equal(/menu:openSettings|openSettingsMenu|buildSettingsMenuTemplate|settingsMenuOpen/.test(SOURCE_MAIN), false);
});

const SOURCE_MAIN = source('electron/main.js');

test('C9 README、产品文档与落地页不再描述旧顶栏元素', () => {
  for (const doc of [README, PRODUCT, SITE]) {
    assert.equal(/顶栏最右/.test(doc), false);
    assert.equal(/顶栏右侧的齿轮|顶栏右侧齿轮/.test(doc), false);
    assert.equal(/最右的图钉|最右是图钉/.test(doc), false);
    assert.equal(/右对齐按钮/.test(doc), false);
  }

  assert.match(README, /右上角的「⚙︎ 设置」/);
  assert.match(README, /580×432/);
  assert.equal(/580×400/.test(README), false);

  assert.match(PRODUCT, /通栏顶栏/);
  assert.match(PRODUCT, /右上角「⚙︎ 设置」/);
  assert.match(PRODUCT, /580×432/);
  assert.equal(/580×400/.test(PRODUCT), false);

  assert.match(SITE, /右上角的「⚙︎ 设置」/);
});
