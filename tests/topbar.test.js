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

test('C2 通栏顶栏：32px、图钉在左上、栏历在其右、设置胶囊在右上最后', () => {
  const topbar = topbarHtml();
  const left = topbar.match(/<div class="topbar-left">([\s\S]*?)<\/div>/);
  const right = topbar.match(/<div class="topbar-right">([\s\S]*?)<\/div>\s*<\/header>/);
  assert.ok(left, 'left group should exist');
  assert.ok(right, 'right group should exist');

  const pinIndex = left[1].indexOf('id="pin-button"');
  const titleIndex = left[1].indexOf('class="topbar-title"');
  assert.ok(pinIndex >= 0, 'pin button belongs to the topbar left group');
  assert.ok(titleIndex > pinIndex, '栏历 text must follow the pin button');
  assert.match(left[1], /class="topbar-title">栏历<\/span>/);

  const actionsIndex = right[1].indexOf('class="topbar-actions"');
  const settingsIndex = right[1].indexOf('id="settings-button"');
  assert.ok(actionsIndex >= 0, 'reserved container for future entries should exist');
  assert.ok(settingsIndex > actionsIndex, 'settings must be the rightmost entry');
  assert.match(
    right[1],
    /<div class="topbar-actions" id="topbar-actions"><\/div>/
  );

  const settings = topbar.match(/<button[\s\S]*?id="settings-button"[\s\S]*?<\/button>/);
  assert.ok(settings, 'settings button should exist');
  assert.match(settings[0], /class="nav-pill settings-button"/);
  assert.match(settings[0], /aria-label="设置"/);
  assert.match(settings[0], /aria-haspopup="menu"/);
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

  const pill = ruleFor('.nav-pill');
  assert.match(pill.body, /height:\s*26px/);
  assert.match(pill.body, /font-size:\s*12px/);

  const actions = ruleFor('.topbar-actions');
  assert.match(actions.body, /flex-direction:\s*row-reverse/);
  assert.match(actions.body, /gap:\s*6px/);

  const action = ruleFor('.topbar-action');
  assert.match(action.body, /width:\s*24px/);
  assert.match(action.body, /height:\s*24px/);
  assert.match(action.body, /border-radius:\s*50%/);
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

test('C4 图钉气泡在按钮下方左对齐并钳在窗口内，交互与 0.1.24 一致', () => {
  assert.match(RENDERER, /const PIN_TOOLTIP_UNPINNED = '钉住窗口，移开鼠标也不隐藏';/);
  assert.match(RENDERER, /const PIN_TOOLTIP_PINNED = '取消钉住并关闭';/);
  assert.match(RENDERER, /pinTooltipTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 500\);/);
  assert.match(RENDERER, /let left = rect\.left;/);
  assert.equal(/let left = rect\.right - width;/.test(RENDERER), false);
  assert.match(RENDERER, /Math\.min\(left, window\.innerWidth - width - 4\)/);
  assert.match(RENDERER, /let top = rect\.bottom \+ 6;/);
  assert.match(RENDERER, /pinButton\.addEventListener\('mouseleave', hidePinTooltip\)/);
  assert.match(RENDERER, /pinButton\.addEventListener\('click',/);
  assert.match(HTML, /id="pin-tooltip" role="tooltip" hidden>钉住窗口，移开鼠标也不隐藏<\/div>/);

  const tip = ruleFor('.pin-tooltip');
  assert.match(tip.body, /position:\s*fixed/);
  assert.match(tip.body, /font-size:\s*11px/);
  assert.match(tip.body, /white-space:\s*nowrap/);
  assert.match(tip.body, /pointer-events:\s*none/);
});

test('C5 设置胶囊把左缘与下方 4px 交给原生菜单', () => {
  assert.match(RENDERER, /x:\s*Math\.round\(rect\.left\)/);
  assert.match(RENDERER, /y:\s*Math\.round\(rect\.bottom \+ 4\)/);
  assert.equal(/SETTINGS_MENU_WIDTH/.test(SOURCE_MAIN), false);
});

const SOURCE_MAIN = source('electron/main.js');

test('C9 README、产品文档与落地页统一为新顶栏位置', () => {
  for (const doc of [README, PRODUCT, SITE]) {
    assert.equal(/顶栏最右/.test(doc), false);
    assert.equal(/顶栏右侧的齿轮|顶栏右侧齿轮/.test(doc), false);
    assert.equal(/最右的图钉|最右是图钉/.test(doc), false);
    assert.equal(/右对齐按钮/.test(doc), false);
  }

  assert.match(README, /左上角的图钉/);
  assert.match(README, /右上角的「⚙︎ 设置」/);
  assert.match(README, /580×432/);
  assert.equal(/580×400/.test(README), false);

  assert.match(PRODUCT, /## 当前功能（0\.1\.25）/);
  assert.match(PRODUCT, /通栏顶栏/);
  assert.match(PRODUCT, /左上角是图钉圆钮/);
  assert.match(PRODUCT, /右上角「⚙︎ 设置」/);
  assert.match(PRODUCT, /580×432/);
  assert.equal(/580×400/.test(PRODUCT), false);

  assert.match(SITE, /右上角的「⚙︎ 设置」/);
  assert.match(SITE, /左上角的图钉/);
});
