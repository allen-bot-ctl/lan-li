'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Solar } = require('lunar-javascript');

const {
  buildCell,
  buildCells,
  buildNow,
  formatMenuTitle,
  isValidMenuTitle
} = require('../electron/calendar');

// Fixed local "today" for deterministic isToday checks.
const TODAY = new Date(2026, 10, 15);

function cellOn(year, month, day, viewYear = year, viewMonth = month) {
  return buildCell(Solar.fromYmd(year, month, day), viewYear, viewMonth, TODAY);
}

function lunarOn(year, month, day) {
  return Solar.fromYmd(year, month, day).getLunar();
}

test('2026-11-07 secondary text is 立冬', () => {
  assert.equal(cellOn(2026, 11, 7).secondaryText, '立冬');
  assert.equal(cellOn(2026, 11, 7).isJieQi, true);
});

test('2026-11-22 secondary text is 小雪', () => {
  assert.equal(cellOn(2026, 11, 22).secondaryText, '小雪');
  assert.equal(cellOn(2026, 11, 22).isJieQi, true);
});

test('2026-11-11 shows the lunar day and not 光棍节', () => {
  const lunar = lunarOn(2026, 11, 11);
  const cell = cellOn(2026, 11, 11);

  assert.equal(cell.secondaryText, lunar.getDayInChinese());
  assert.notEqual(cell.secondaryText, '光棍节');
  assert.equal(cell.isFestival, false);
  assert.equal(cell.isJieQi, false);
});

test('calendar module never references getOtherFestivals', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'calendar.js'),
    'utf8'
  );

  assert.equal(/\.getOtherFestivals\s*\(/.test(source), false);
});

test('2026-11-09 is lunar day one and shows 十月', () => {
  const lunar = lunarOn(2026, 11, 9);
  assert.equal(lunar.getDay(), 1);
  assert.equal(cellOn(2026, 11, 9).secondaryText, '十月');
  assert.equal(cellOn(2026, 11, 9).secondaryKind, 'lunar');
});

test('2026-11-15 shows 初七 and the right-hand side uses the same lunar data', () => {
  const cell = cellOn(2026, 11, 15);
  assert.equal(cell.secondaryText, '初七');

  const now = buildNow(new Date(2026, 10, 15, 22, 47, 13));
  assert.equal(now.hourMinute, '22:47');
  assert.equal(now.day, 15);
  assert.equal(now.lunarMonthDay, '十月初七');
  assert.equal(now.ganzhiYear, '丙午年【马年】');
  assert.equal(now.weekday, ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][Solar.fromYmd(2026, 11, 15).getWeek()]);
});

test('November 2026 grid has 42 cells, starts on Monday and follows lead', () => {
  const cells = buildCells(2026, 11, TODAY);
  const first = Solar.fromYmd(2026, 11, 1);
  const weekday = first.getWeek();
  const lead = weekday === 0 ? 6 : weekday - 1;
  const start = first.next(-lead);

  assert.equal(cells.length, 42);
  assert.equal(cells[0].year, start.getYear());
  assert.equal(cells[0].month, start.getMonth());
  assert.equal(cells[0].day, start.getDay());
  assert.equal(cells[0].week, 1);
  assert.equal(cells[41].week, 0);

  assert.equal(cells[lead].year, 2026);
  assert.equal(cells[lead].month, 11);
  assert.equal(cells[lead].day, 1);

  assert.equal(cells.filter((cell) => cell.inMonth).length, 30);
});

test('today, weekend, outside and festival flags are populated', () => {
  const cells = buildCells(2026, 11, TODAY);
  const todayCell = cells.find((cell) => cell.isToday);

  assert.ok(todayCell);
  assert.equal(todayCell.year, 2026);
  assert.equal(todayCell.month, 11);
  assert.equal(todayCell.day, 15);

  assert.equal(cellOn(2026, 11, 7).isWeekend, true);
  assert.equal(cellOn(2026, 11, 8).isWeekend, true);
  assert.equal(cellOn(2026, 11, 9).isWeekend, false);
  assert.equal(cellOn(2026, 11, 8).isToday, false);

  const outside = cellOn(2026, 11, 15, 2026, 12);
  assert.equal(outside.inMonth, false);
  assert.equal(outside.isToday, false);

  const festival = cellOn(2026, 1, 1);
  const solar = Solar.fromYmd(2026, 1, 1);
  const expectedFestival = solar.getFestivals()
    .concat(solar.getLunar().getFestivals())
    .find((value) => typeof value === 'string' && value.length > 0);

  assert.ok(expectedFestival);
  assert.equal(festival.secondaryText, expectedFestival);
  assert.equal(festival.isFestival, true);
  assert.equal(festival.secondaryKind, 'festival');

  const trailing = cells[cells.length - 1];
  assert.equal(typeof trailing.secondaryText, 'string');
  assert.ok(trailing.secondaryText.length > 0);
});

test('menu bar title uses unpadded month/day and padded time', () => {
  assert.equal(formatMenuTitle(new Date(2026, 0, 5, 9, 3, 7)), '1月5日 09:03:07');
  assert.equal(formatMenuTitle(new Date(2026, 10, 15, 22, 47, 13)), '11月15日 22:47:13');
  assert.equal(isValidMenuTitle('1月5日 09:03:07'), true);
  assert.equal(isValidMenuTitle('11月15日 22:47:13'), true);
  assert.equal(isValidMenuTitle('01月05日 09:03:07'), false);
  assert.equal(isValidMenuTitle('1月5日 9:03:07'), false);
});
