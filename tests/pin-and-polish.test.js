'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildViewSubtitle } = require('../electron/calendar');

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
  assert.match(MAIN, /tray\.on\('mouse-enter', onTrayMouseEnter\)/);
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

  assert.match(MAIN, /tray\.on\('mouse-enter', onTrayMouseEnter\)/);
  assert.match(functionBody('openCalendar'), /calendarWindow\.show\(\)/);
});

test('C5 钉住按钮有 500ms 页内气泡，文案与定位满足契约', () => {
  const pinButton = HTML.match(/<button[\s\S]*?id="pin-button"[\s\S]*?<\/button>/);
  assert.ok(pinButton, 'pin button should exist');
  assert.match(pinButton[0], /aria-label="钉住窗口"/);
  assert.match(pinButton[0], /aria-pressed="false"/);
  assert.match(pinButton[0], /class="pin-icon pin-icon-pin"/);
  assert.match(pinButton[0], /class="pin-icon pin-icon-close"/);

  // SVG 元素没有 .hidden 这个 IDL 属性，图形切换必须切内容属性。
  assert.match(RENDERER, /pinIconPin\.toggleAttribute\('hidden', pinned\)/);
  assert.match(RENDERER, /pinIconClose\.toggleAttribute\('hidden', !pinned\)/);
  assert.match(RENDERER, /pinButton\.classList\.toggle\('is-pinned', pinned\)/);
  assert.match(ruleFor('.pin-button.is-pinned').body, /color:\s*var\(--accent\)/);

  assert.match(HTML, /<div class="icon-tooltip" id="icon-tooltip" role="tooltip" hidden>钉住窗口，移开鼠标也不隐藏<\/div>/);
  assert.match(RENDERER, /const ICON_TOOLTIP_UNPINNED = '钉住窗口，移开鼠标也不隐藏';/);
  assert.match(RENDERER, /const ICON_TOOLTIP_PINNED = '取消钉住并关闭';/);
  assert.match(RENDERER, /iconTooltipTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 500\);/);
  // 0.1.27 把图钉移到右上，气泡改为按按钮右缘对齐并钳在窗口内。
  assert.match(RENDERER, /let left = rect\.right - width;/);
  assert.equal(/let left = rect\.left;/.test(RENDERER), false);
  assert.match(RENDERER, /Math\.min\(left, window\.innerWidth - width - 4\)/);
  assert.match(RENDERER, /button\.addEventListener\('mouseleave', hideIconTooltip\)/);

  const tip = ruleFor('.icon-tooltip');
  assert.match(tip.body, /position:\s*fixed/);
  assert.match(tip.body, /font-size:\s*11px/);
  assert.match(tip.body, /white-space:\s*nowrap/);
  assert.match(tip.body, /pointer-events:\s*none/);
});

test('C6 1900–2100 每一天的副标题最宽就是 10 字符，且能真实翻月显示', () => {
  // 字符宽度估算：CJK 记 2 列，其余记 1 列；精确宽度交给 e2e 实测。
  function textWidth(text) {
    return [...text].reduce(
      (width, ch) => width + (ch.codePointAt(0) > 0x2e7f ? 2 : 1),
      0
    );
  }

  const widestText = '乙巳蛇年 · 闰六月';
  const widestWidth = textWidth(widestText);
  let widest = 0;
  let todayCandidates = 0;

  // S4：1900-01-01 到 2100-12-31 的每一天都能成为「本月」，按当天生成副标题。
  for (let year = 1900; year <= 2100; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const last = new Date(year, month, 0).getDate();
      for (let day = 1; day <= last; day += 1) {
        const text = buildViewSubtitle(year, month, { year, month, day });
        assert.match(text, /^\S{4} · \S{1,3}$/, text);
        const width = textWidth(text);
        if (width > widest) widest = width;
        if (width === widestWidth) todayCandidates += 1;
      }
    }
  }

  assert.equal(widest, widestWidth);
  assert.ok(todayCandidates > 0, 'some day really renders the widest subtitle');

  // S4：显示其他月时副标题取该月 1 号。找真实可翻到的最宽月份：今天取一个
  // 与被扫月不同的固定日期即可（除 2000-01 本身外都走「该月 1 号」分支）。
  const realPath = { year: 2026, month: 11, day: 15 };
  let realCandidates = 0;
  let concreteSeen = false;
  for (let year = 1900; year <= 2100; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const text = buildViewSubtitle(year, month, realPath);
      if (textWidth(text) === widestWidth) {
        realCandidates += 1;
        if (year === 2025 && month === 8 && text === widestText) {
          concreteSeen = true;
        }
      }
    }
  }

  // 2025-08-01 仍在 2025 年的闰六月内，翻月即可显示最宽文案，无需注入。
  assert.ok(realCandidates > 0, 'a navigable month shows the widest subtitle');
  assert.equal(concreteSeen, true, '2025-08 must show 乙巳蛇年 · 闰六月 via day one');
});

test('C6 副标题由主进程 viewSubtitle 下发，renderAlmanac 不再写它', () => {
  const renderer = source('electron/renderer/calendar.js');

  const renderAlmanac = RENDERER.match(
    /function renderAlmanac\(almanac\) \{[\s\S]*?\n\}/
  );
  assert.ok(renderAlmanac, 'renderAlmanac should exist');
  assert.equal(
    /lunarSubtitle/.test(renderAlmanac[0]),
    false,
    'renderAlmanac must not touch the subtitle'
  );

  // 渲染层只写入主进程算好的 viewSubtitle，不自行计算农历。
  assert.match(RENDERER, /function renderViewSubtitle\(subtitle\) \{/);
  assert.match(RENDERER, /renderViewSubtitle\(next\.viewSubtitle\)/);
  assert.match(RENDERER, /renderViewSubtitle\(payload\.viewSubtitle\)/);

  // 主进程在 state 与每秒 tick 里都带 viewSubtitle；黄历卡仍按今天。
  assert.match(functionBody('buildState'), /viewSubtitle:\s*buildViewSubtitle\(view\.year,\s*view\.month,\s*now\)/);
  const tick = MAIN.match(/send\('calendar:onTick',\s*\{[\s\S]*?\}\);/);
  assert.ok(tick, 'tick payload should exist');
  assert.match(tick[0], /viewSubtitle:\s*buildViewSubtitle\(view\.year,\s*view\.month,\s*now\)/);
  assert.match(tick[0], /almanac:\s*buildAlmanac\(now,\s*almanacStyle\)/);
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
  assert.equal(/<button class="card-link"[^>]*>编辑<\/button>/.test(HTML), false);
});

test('C9 右栏底部只剩 10px 版本号，更新提示改成不占布局的浮层', () => {
  assert.match(ruleFor('.app-version').body, /font-size:\s*10px/);

  const footer = HTML.match(/<div class="pane-footer">[\s\S]*?<\/div>/);
  assert.ok(footer, 'pane footer should exist');
  assert.match(footer[0], /id="app-version"/);
  assert.equal(/check-update|pane-footer-sep/.test(footer[0]), false);

  assert.equal(/id="update-banner"/.test(HTML), false, 'the banner row is gone');
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

test('月历顶栏顺序为 ‹ 今天 ›；图钉与设置已移入通栏顶栏', () => {
  assert.deepEqual(navIds(), ['prev-month', 'today-button', 'next-month']);

  // Pin and settings live in the full-width top bar now; their structure and
  // styles are asserted in tests/topbar.test.js.
  const pane = HTML.match(/<main class="calendar-pane">[\s\S]*?<\/main>/);
  assert.ok(pane, 'calendar pane should exist');
  assert.equal(/id="settings-button"/.test(pane[0]), false);
  assert.equal(/id="pin-button"/.test(pane[0]), false);

  const circle = ruleFor('.nav-circle');
  assert.match(circle.body, /width:\s*24px/);
  assert.match(circle.body, /height:\s*24px/);
  assert.match(circle.body, /border-radius:\s*50%/);
});
