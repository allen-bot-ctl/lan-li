'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAlmanac } = require('../electron/calendar');

const ROOT = path.join(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const HTML = source('electron/renderer/calendar.html');
const RENDERER = source('electron/renderer/calendar.js');
const MAIN = source('electron/main.js');
const PRELOAD = source('electron/preload.js');
const CSS = source('electron/renderer/calendar.css');
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function rules() {
  return [...CSS_NO_COMMENTS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selectorText, body]) => ({
      selectors: selectorText
        .split(',')
        .map((selector) => selector.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
      body: body.trim(),
      index: selectorText.length
    })
  );
}

const ALL_RULES = rules();

function ruleFor(selector) {
  const matches = ALL_RULES.filter((rule) => rule.selectors.includes(selector));
  assert.equal(matches.length, 1, `expected exactly one rule for ${selector}`);
  return matches[0];
}

function functionBody(name) {
  const match = MAIN.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} should exist`);
  return match[0];
}

function navIds() {
  const nav = HTML.match(/<nav class="month-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'month nav should exist');
  return [...nav[0].matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
}

test('C1 未钉住时托盘离开与窗口 pointer-leave 仍走 200ms 隐藏', () => {
  assert.match(MAIN, /tray\.on\('mouse-enter', openCalendar\)/);
  assert.match(MAIN, /tray\.on\('mouse-leave', scheduleClose\)/);
  assert.match(MAIN, /ipcMain\.on\('pointer:leave', \(\) => \{\s*scheduleClose\(\);/);

  const close = functionBody('scheduleClose');
  const guard = close.indexOf('if (pinned) return;');
  const timer = close.indexOf('setTimeout(hideCalendar, 200)');
  assert.ok(guard > 0, 'scheduleClose must ignore leave while pinned');
  assert.ok(timer > guard, 'the 200ms timer must come after the pin guard');
});

test('C2 钉住状态只在主进程内存中，blur 不隐藏窗口', () => {
  assert.match(MAIN, /let pinned = false;/);
  assert.match(MAIN, /pinned\s*\n\s*\};/, 'buildState must expose pinned');

  const toggle = MAIN.match(/ipcMain\.handle\('pin:toggle',[\s\S]*?\n  \}\);/);
  assert.ok(toggle, 'pin:toggle handler should exist');
  assert.match(toggle[0], /pinned = true;/);
  assert.match(toggle[0], /cancelClose\(\);/);
  assert.match(toggle[0], /sendPinState\(\);/);

  assert.equal(/preferences\.pinned|pinned:\s*pinned/.test(MAIN), false);
  assert.equal(/calendarWindow\.on\('blur'/.test(MAIN), false);
  assert.match(PRELOAD, /togglePin:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('pin:toggle'\)/);
  assert.match(PRELOAD, /onPinState:/);
  assert.match(RENDERER, /api\.onPinState\(\(payload\)\s*=>\s*renderPin\(payload && payload\.pinned\)\)/);
});

test('C3/C4 ×、Esc 与任何隐藏都清掉钉住，重新悬停即回到未钉住', () => {
  const hide = functionBody('hideCalendar');
  assert.match(hide, /pinned = false;/);
  assert.match(hide, /calendarWindow\.hide\(\)/);
  assert.match(hide, /sendPinState\(\)/);

  const toggle = MAIN.match(/ipcMain\.handle\('pin:toggle',[\s\S]*?\n  \}\);/);
  assert.ok(toggle);
  assert.match(toggle[0], /if \(pinned\) \{\s*hideCalendar\(\);/);

  const esc = MAIN.match(/before-input-event',[\s\S]*?\n  \}\);/);
  assert.ok(esc, 'Esc handler should exist');
  assert.match(esc[0], /input\.key === 'Escape' \|\| input\.key === 'Esc'/);
  assert.match(esc[0], /hideCalendar\(\)/);

  assert.match(MAIN, /tray\.on\('mouse-enter', openCalendar\)/);
  assert.match(functionBody('openCalendar'), /calendarWindow\.show\(\)/);
});

test('C5 钉住按钮有 500ms 页内气泡，文案与定位满足契约', () => {
  const pinButton = HTML.match(/<button[\s\S]*?id="pin-button"[\s\S]*?<\/button>/);
  assert.ok(pinButton, 'pin button should exist');
  assert.match(pinButton[0], /aria-label="钉住窗口"/);
  assert.match(pinButton[0], /aria-pressed="false"/);
  assert.match(pinButton[0], /class="pin-icon pin-icon-pin"/);
  assert.match(pinButton[0], /class="pin-icon pin-icon-close"/);

  assert.match(HTML, /<div class="pin-tooltip" id="pin-tooltip" role="tooltip" hidden>钉住窗口，移开鼠标也不隐藏<\/div>/);
  assert.match(RENDERER, /const PIN_TOOLTIP_UNPINNED = '钉住窗口，移开鼠标也不隐藏';/);
  assert.match(RENDERER, /const PIN_TOOLTIP_PINNED = '取消钉住并关闭';/);
  assert.match(RENDERER, /pinTooltipTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 500\);/);
  assert.match(RENDERER, /let left = rect\.right - width;/);
  assert.match(RENDERER, /Math\.min\(left, window\.innerWidth - width - 4\)/);
  assert.match(RENDERER, /pinButton\.addEventListener\('mouseleave', hidePinTooltip\)/);

  const tip = ruleFor('.pin-tooltip');
  assert.match(tip.body, /position:\s*fixed/);
  assert.match(tip.body, /font-size:\s*11px/);
  assert.match(tip.body, /white-space:\s*nowrap/);
  assert.match(tip.body, /pointer-events:\s*none/);
});

test('C6 1900–2100 副标题的最长宽度就是测试写死的 2025 年 7 月文案', () => {
  const concrete = { year: 2025, month: 7, text: '乙巳蛇年 · 闰六月' };
  let widest = 0;
  let matches = 0;
  let concreteSeen = false;

  // Same string the renderer builds: ganZhiText + ' · ' + lunarMonthText.
  for (let year = 1900; year <= 2100; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const last = new Date(year, month, 0).getDate();
      for (const day of [1, 15, last]) {
        const almanac = buildAlmanac(new Date(year, month - 1, day), 'lunar');
        const text = `${almanac.ganZhiText} · ${almanac.lunarMonthText}`;
        assert.match(text, /^\S{4} · \S{1,3}$/, text);
        widest = Math.max(widest, [...text].length);
        if ([...text].length === [...concrete.text].length) matches += 1;
        if (year === concrete.year && month === concrete.month && text === concrete.text) {
          concreteSeen = true;
        }
      }
    }
  }

  assert.equal(widest, [...concrete.text].length);
  assert.ok(matches > 0);
  assert.equal(concreteSeen, true, '2025-07 must really produce the hardcoded subtitle');
});

test('C7 节气倒计时的 DOM、代码、样式与测试全部删除', () => {
  for (const text of [HTML, RENDERER, MAIN, CSS, source('electron/calendar.js')]) {
    assert.equal(/almanac-term-countdown|term-countdown|termCountdown|buildTermCountdown/.test(text), false);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'tests', 'term-countdown.test.js')), false);
  assert.equal(/天后|今日小雪/.test(RENDERER + HTML), false);
});

test('C8 三个卡片入口统一以 › 结尾', () => {
  assert.match(HTML, /<button class="card-link" id="almanac-customize" type="button">去定制 ›<\/button>/);
  assert.match(HTML, /<button class="card-link" id="clock-edit" type="button">编辑 ›<\/button>/);
  assert.match(HTML, /<span class="card-link weather-change">更换 ›<\/span>/);
  assert.equal(/>编辑<\/button>/.test(HTML), false);
});

test('C9 检查更新与版本号同为 10px，颜色 --muted、悬停 --link', () => {
  assert.match(ruleFor('.app-version').body, /font-size:\s*10px/);

  const update = ruleFor('.pane-check-update');
  assert.match(update.body, /font-size:\s*10px/);
  assert.match(update.body, /color:\s*var\(--muted\)/);

  const hover = ruleFor('.pane-check-update:hover');
  assert.match(hover.body, /color:\s*var\(--link\)/);

  // The new rule must win over the generic .card-link size/link colour.
  const linkIndex = ALL_RULES.findIndex((rule) => rule.selectors.includes('.card-link'));
  const updateIndex = ALL_RULES.findIndex((rule) => rule.selectors.includes('.pane-check-update'));
  assert.ok(linkIndex >= 0 && updateIndex > linkIndex);
});

test('C10 product.md 与 README 去掉节气倒计时并补上钉住说明', () => {
  const product = source('docs/product.md');
  const readme = source('README.md');

  for (const doc of [product, readme]) {
    assert.equal(/节气倒计时|termCountdown|term-countdown/.test(doc), false);
    assert.match(doc, /钉住/);
  }
  assert.match(product, /钉住窗口/);
});

test('顶栏顺序为 ‹ 今天 › ⚙ 钉住，齿轮改为 24px 圆钮', () => {
  assert.deepEqual(navIds(), [
    'prev-month',
    'today-button',
    'next-month',
    'settings-button',
    'pin-button'
  ]);

  const settings = HTML.match(/<button[\s\S]*?id="settings-button"[\s\S]*?<\/button>/);
  assert.ok(settings, 'settings button should exist');
  assert.match(settings[0], /class="nav-circle settings-button"/);
  assert.match(settings[0], /aria-label="设置"/);
  assert.match(settings[0], /title="设置"/);
  assert.match(settings[0], /class="settings-gear" aria-hidden="true">⚙︎</);
  assert.equal(/<span>设置<\/span>/.test(settings[0]), false);
  assert.equal(/nav-pill settings-button/.test(HTML), false);

  const circle = ruleFor('.nav-circle');
  assert.match(circle.body, /width:\s*24px/);
  assert.match(circle.body, /height:\s*24px/);
  assert.match(circle.body, /border-radius:\s*50%/);
});
