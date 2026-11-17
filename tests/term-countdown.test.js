'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { Solar } = require('lunar-javascript');

const { buildAlmanac } = require('../electron/calendar');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(
  path.join(ROOT, 'electron', 'renderer', 'calendar.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = fs.readFileSync(
  path.join(ROOT, 'electron', 'renderer', 'calendar.html'),
  'utf8'
);
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'));

// 交接基线 0.1.22（7764963）的 preload 与 IPC 通道；本轮不得增加接口。
const PRELOAD_SHA256 =
  '19132beeab527a69dc62a66c9443b7fb14ea27abcb44ae01c0eaa2e03ecfcf5b';
const BASELINE_CHANNELS = [
  'handle:app:version',
  'handle:weather:get',
  'handle:weather:searchCity',
  'handle:weather:quickCities',
  'handle:weather:setCity',
  'handle:calendar:getState',
  'handle:almanac:getStyles',
  'handle:almanac:setStyle',
  'handle:calendar:setView',
  'handle:calendar:goToday',
  'handle:clocks:add',
  'handle:clocks:remove',
  'handle:clocks:setMenuBar',
  'handle:clocks:search',
  'on:pointer:enter',
  'on:pointer:leave',
  'on:menu:openSettings',
  'on:update:check',
  'on:update:restart',
  'on:update:openLatest'
];
const STYLES = ['lunar', 'coder', 'worker', 'student', 'fitness'];
const TERM_NAMES = [
  '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降',
  '立冬', '小雪', '大雪', '冬至', '小寒', '大寒'
];

// 第 2.2 节期望表，18 行逐行断言。
const EXPECTED = [
  [2026, 11, 17, '小雪 5天后', '小雪', 5],
  [2026, 11, 21, '小雪 明天', '小雪', 1],
  [2026, 11, 22, '今日小雪', '小雪', 0],
  [2026, 11, 23, '大雪 14天后', '大雪', 14],
  [2026, 12, 31, '小寒 5天后', '小寒', 5],
  [2027, 1, 1, '小寒 4天后', '小寒', 4],
  [2027, 1, 2, '小寒 3天后', '小寒', 3],
  [2027, 1, 3, '小寒 2天后', '小寒', 2],
  [2027, 1, 4, '小寒 明天', '小寒', 1],
  [2027, 1, 5, '今日小寒', '小寒', 0],
  [2027, 1, 6, '大寒 14天后', '大寒', 14],
  [2026, 6, 4, '芒种 明天', '芒种', 1],
  [2026, 6, 5, '今日芒种', '芒种', 0],
  [2026, 6, 6, '夏至 15天后', '夏至', 15],
  [2026, 2, 17, '雨水 明天', '雨水', 1],
  [2026, 2, 18, '今日雨水', '雨水', 0],
  [2026, 2, 19, '惊蛰 14天后', '惊蛰', 14],
  [2100, 12, 31, '小寒 5天后', '小寒', 5]
];

function dateOf([year, month, day]) {
  return new Date(year, month - 1, day);
}

function termOf(date, styleId = 'lunar') {
  return buildAlmanac(date, styleId).termCountdown;
}

test('term countdown matches all 18 expected rows from the handoff table', () => {
  for (const row of EXPECTED) {
    const [year, month, day, text, name, days] = row;
    const term = termOf(dateOf(row));
    assert.deepEqual(
      term,
      { name, days, text },
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    );
  }
});

test('term countdown is identical at both ends of the day, on repeat calls, and across styles', () => {
  for (const day of [[2027, 1, 5], [2026, 6, 5], [2026, 6, 4]]) {
    const [year, month, date] = day;
    const early = termOf(new Date(year, month - 1, date, 0, 0, 1));
    const late = termOf(new Date(year, month - 1, date, 23, 59, 59));
    assert.deepEqual(early, late, `${year}-${month}-${date} 首尾时刻一致`);

    const first = termOf(new Date(year, month - 1, date, 12, 0, 0));
    assert.deepEqual(termOf(new Date(year, month - 1, date, 12, 0, 0)), first);
    assert.deepEqual(termOf(new Date(year, month - 1, date, 12, 0, 0)), first);

    for (const style of STYLES) {
      assert.deepEqual(
        termOf(new Date(year, month - 1, date, 12, 0, 0), style),
        first,
        `${style} 风格与农历一致`
      );
    }
  }
});

test('full 1900-2100 scan keeps text, days, names and UTC date differences valid', () => {
  const TEXT_PATTERN = /^(今日\S{2}|\S{2} 明天|\S{2} ([2-9]|1[0-5])天后)$/;
  const names = new Set();
  const start = Date.UTC(1900, 0, 1);
  const end = Date.UTC(2100, 11, 31);
  let previous = null;

  for (let stamp = start; stamp <= end; stamp += 86400000) {
    const date = new Date(stamp);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const term = termOf(new Date(year, month - 1, day));
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const jieQi = lunar.getJieQi();

    assert.match(term.text, TEXT_PATTERN, `${year}-${month}-${day} 文案`);
    assert.ok(Number.isInteger(term.days) && term.days >= 0 && term.days <= 15,
      `${year}-${month}-${day} days 范围`);
    assert.equal(term.days === 0, jieQi !== '', `${year}-${month}-${day} 今日判定`);

    if (term.days === 0) {
      assert.equal(term.name, jieQi);
    } else {
      const next = lunar.getNextJieQi(true);
      assert.ok(next, `${year}-${month}-${day} 应有下一个节气`);
      const nextSolar = next.getSolar();
      const expectedDays = Math.round(
        (Date.UTC(nextSolar.getYear(), nextSolar.getMonth() - 1, nextSolar.getDay()) -
          Date.UTC(year, month - 1, day)) / 86400000
      );
      assert.equal(term.days, expectedDays, `${year}-${month}-${day} Date.UTC 差值`);
      assert.equal(term.name, next.getName());
    }

    if (term.name) names.add(term.name);
    if (previous) {
      assert.ok(term.text.length > 0);
    }
    previous = term;
  }

  assert.equal(names.size, 24, '应覆盖全部 24 个节气');
  assert.deepEqual([...names].sort(), [...TERM_NAMES].sort());
});

test('both 节 and 气 participate in the next-term result', () => {
  const qiDay = Solar.fromYmd(2026, 11, 17).getLunar().getNextJieQi(true);
  const jieDay = Solar.fromYmd(2026, 11, 23).getLunar().getNextJieQi(true);

  assert.equal(qiDay.isQi(), true);
  assert.equal(jieDay.isJie(), true);
  assert.equal(termOf(new Date(2026, 10, 17)).name, '小雪');
  assert.equal(termOf(new Date(2026, 10, 23)).name, '大雪');
});

function rules() {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectorText, body]) => ({
    selectors: selectorText
      .split(',')
      .map((selector) => selector.trim().replace(/\s+/g, ' '))
      .filter(Boolean),
    body: body.trim()
  }));
}

const ALL_RULES = rules();

function ruleFor(selector) {
  const matches = ALL_RULES.filter((rule) => rule.selectors.includes(selector));
  assert.equal(matches.length, 1, `expected exactly one rule for ${selector}`);
  return matches[0];
}

function opacityRule(selectors, opacity) {
  const rule = ALL_RULES.find(
    (candidate) =>
      candidate.selectors.length === selectors.length &&
      selectors.every((selector) => candidate.selectors.includes(selector))
  );
  assert.ok(rule, selectors.join(', '));
  assert.match(rule.body, new RegExp(`opacity:\\s*${opacity}(?:;|$)`));
  return rule;
}

test('card-swap CSS keeps the handoff widths, gaps, alignment and 120ms fades', () => {
  assert.match(ruleFor('.card-swap > *').body, /transition:\s*opacity\s+120ms\s+ease/);
  assert.match(ruleFor('.almanac-head-swap').body, /flex:\s*0 0 57px/);
  assert.match(ruleFor('.almanac-card .card-head').body, /gap:\s*4px/);
  assert.match(ruleFor('.term-countdown').body, /font-size:\s*10px/);
  assert.match(ruleFor('.weather-city').body, /text-align:\s*right/);
  assert.match(ruleFor('.weather-swap').body, /flex:\s*1 1 auto/);

  opacityRule(
    ['.almanac-card:hover .term-countdown', '.almanac-card:focus-within .term-countdown'],
    '0'
  );
  opacityRule(
    ['.weather-card:hover .weather-city', '.weather-card:focus-visible .weather-city'],
    '0'
  );
});

test('longest style title and longest countdown fit without truncation', () => {
  const gap = Number(
    /gap:\s*(\d+)px/.exec(ruleFor('.almanac-card .card-head').body)[1]
  );
  const slot = Number(
    /flex:\s*0 0 (\d+)px/.exec(ruleFor('.almanac-head-swap').body)[1]
  );

  const pane = ruleFor('.now-pane').body;
  const paneWidth = Number(/width:\s*(\d+)px/.exec(pane)[1]);
  const panePadding = Number(/padding:\s*[\d.]+px\s+([\d.]+)px/.exec(pane)[1]);
  const paneBorder = Number(/border-left:\s*([\d.]+)px/.exec(pane)[1]);
  const card = ruleFor('.card').body;
  const cardPadding = Number(/padding:\s*[\d.]+px\s+([\d.]+)px/.exec(card)[1]);
  const cardBorder = Number(/border:\s*([\d.]+)px/.exec(card)[1]);
  const headWidth =
    paneWidth - paneBorder - panePadding * 2 - cardBorder * 2 - cardPadding * 2;

  // 标题「程序猿黄历」与倒计时「夏至 15天后」在 Chromium 里的实测内容宽度
  // （metrics.json 同源：12px + 0.2px letter-spacing / 10px tabular-nums）。
  const titleWidth = 61.015625;
  const countdownWidth = 54.046875;
  const titleAvailable = headWidth - slot - gap;

  assert.equal(headWidth, 127);
  assert.equal(titleAvailable, 66);
  assert.ok(
    titleWidth <= titleAvailable,
    `标题 ${titleWidth}px 应放得下 ${titleAvailable}px`
  );
  assert.ok(
    countdownWidth <= slot,
    `倒计时 ${countdownWidth}px 应放得下 ${slot}px`
  );
});

test('0.1.22 entry-hiding rules remain byte-for-byte in effect', () => {
  const hidden = opacityRule(['#almanac-customize', '#clock-edit', '.weather-change'], '0');
  assert.match(hidden.body, /pointer-events:\s*none/);
  assert.match(hidden.body, /transition:\s*opacity\s+120ms/);
  assert.equal(/display:\s*none/.test(hidden.body), false);
  assert.equal(/visibility:\s*hidden/.test(hidden.body), false);

  const shown = ALL_RULES.find(
    (rule) =>
      /(?:^|;)\s*opacity:\s*1(?:;|$)/.test(rule.body) &&
      /(?:^|;)\s*pointer-events:\s*auto(?:;|$)/.test(rule.body)
  );
  assert.ok(shown);
  assert.deepEqual([...shown.selectors].sort(), [
    '.almanac-card:hover #almanac-customize',
    '.almanac-card:focus-within #almanac-customize',
    '.weather-card:hover .weather-change',
    '.weather-card:focus-visible .weather-change',
    '.world-clock-card:hover #clock-edit',
    '.world-clock-card:focus-within #clock-edit'
  ].sort());
});

test('DOM nests both swap pairs correctly and leaves the world clock untouched', () => {
  const almanacHead = HTML.match(/<div class="card-head">([\s\S]*?)<\/div>/);
  assert.ok(almanacHead, 'almanac card head should exist');
  assert.match(almanacHead[1], /class="card-swap almanac-head-swap"/);
  const countdownAt = almanacHead[1].indexOf('id="almanac-term-countdown"');
  const customizeAt = almanacHead[1].indexOf('id="almanac-customize"');
  assert.ok(countdownAt > 0 && customizeAt > countdownAt);

  const card = HTML.match(/<button class="card weather-card"[\s\S]*?<\/button>/);
  assert.ok(card, 'weather card should exist');
  const tempAt = card[0].indexOf('id="weather-temp"');
  const swapAt = card[0].indexOf('class="card-swap weather-swap"');
  const cityAt = card[0].indexOf('id="weather-city"');
  const changeAt = card[0].indexOf('weather-change');
  assert.ok(tempAt > 0 && swapAt > tempAt && cityAt > swapAt && changeAt > cityAt);
  assert.match(
    card[0],
    /<span class="[^"]*\bcard-link\b[^"]*\bweather-change\b[^"]*">更换 ›<\/span>/
  );
  assert.equal(/<button[^>]*>[^<]*<button/.test(card[0]), false);

  const clock = HTML.match(/<section class="card world-clock-card"[\s\S]*?<\/section>/);
  assert.ok(clock);
  assert.equal(
    clock[0],
    '<section class="card world-clock-card" aria-label="世界时钟">\n' +
      '        <div class="card-head">\n' +
      '          <span class="card-title">世界时钟</span>\n' +
      '          <button class="card-link" id="clock-edit" type="button">编辑</button>\n' +
      '        </div>\n' +
      '        <div class="clock-list" id="clock-list"></div>\n' +
      '        <div class="clock-empty" id="clock-empty" hidden>尚未添加城市</div>\n' +
      '      </section>'
  );
});

test('preload and IPC channels are exactly the 0.1.22 set', () => {
  assert.equal(
    crypto.createHash('sha256').update(PRELOAD).digest('hex'),
    PRELOAD_SHA256
  );

  const channels = [...MAIN.matchAll(/ipcMain\.(handle|on)\('([^']+)'/g)]
    .map((match) => `${match[1]}:${match[2]}`)
    .sort();
  assert.deepEqual(channels, [...BASELINE_CHANNELS].sort());
});

test('buildAlmanac never touches fetch, HTTP or net connections', () => {
  const counts = { fetch: 0, http: 0, https: 0, net: 0 };
  const original = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreateConnection: net.createConnection
  };

  globalThis.fetch = () => {
    counts.fetch += 1;
    throw new Error('unexpected fetch');
  };
  http.request = http.get = () => {
    counts.http += 1;
    throw new Error('unexpected http');
  };
  https.request = https.get = () => {
    counts.https += 1;
    throw new Error('unexpected https');
  };
  net.connect = net.createConnection = () => {
    counts.net += 1;
    throw new Error('unexpected net');
  };

  try {
    for (const row of EXPECTED) {
      const term = termOf(dateOf(row));
      assert.ok(term.text.length > 0);
    }
  } finally {
    globalThis.fetch = original.fetch;
    http.request = original.httpRequest;
    http.get = original.httpGet;
    https.request = original.httpsRequest;
    https.get = original.httpsGet;
    net.connect = original.netConnect;
    net.createConnection = original.netCreateConnection;
  }

  assert.deepEqual(counts, { fetch: 0, http: 0, https: 0, net: 0 });
});
