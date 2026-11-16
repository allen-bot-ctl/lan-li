'use strict';

const { Solar } = require('lunar-javascript');

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const WEEKDAY_NAMES = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六'
];

// Menu bar title: month and day are not zero padded; hours, minutes and
// seconds always are. Example: 1月5日 09:03:07 / 11月15日 22:47:13.
const MENU_TITLE_PATTERN =
  /^(?:[1-9]|1[0-2])月(?:[1-9]|[12]\d|3[01])日 (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatMenuTitle(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function isValidMenuTitle(text) {
  return typeof text === 'string' && MENU_TITLE_PATTERN.test(text);
}

function formatHourMinute(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function normalizeToday(today) {
  if (today instanceof Date) {
    return {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      day: today.getDate()
    };
  }
  if (today && Number.isInteger(today.year) &&
      Number.isInteger(today.month) && Number.isInteger(today.day)) {
    return { year: today.year, month: today.month, day: today.day };
  }
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  };
}

// Secondary text order is fixed by the handoff:
// 1. solar term, 2. solar/lunar festival (first non-empty), 3. lunar month
// name on day one, 4. lunar day name. The library's Other-festival table is
// never consulted.
function secondaryTextFor(solar, lunar) {
  const jieQi = lunar.getJieQi();
  if (jieQi) {
    return { text: jieQi, kind: 'jieqi', isJieQi: true, isFestival: false };
  }

  const festivals = solar.getFestivals().concat(lunar.getFestivals());
  const festival = festivals.find(
    (value) => typeof value === 'string' && value.length > 0
  );
  if (festival) {
    return { text: festival, kind: 'festival', isJieQi: false, isFestival: true };
  }

  if (lunar.getDay() === 1) {
    return {
      text: lunar.getMonthInChinese() + '月',
      kind: 'lunar',
      isJieQi: false,
      isFestival: false
    };
  }

  return {
    text: lunar.getDayInChinese(),
    kind: 'lunar',
    isJieQi: false,
    isFestival: false
  };
}

function buildCell(solar, viewYear, viewMonth, today) {
  const current = normalizeToday(today);
  const year = solar.getYear();
  const month = solar.getMonth();
  const day = solar.getDay();
  const lunar = solar.getLunar();
  const inMonth = year === viewYear && month === viewMonth;
  const secondary = secondaryTextFor(solar, lunar);
  const week = solar.getWeek();

  return {
    year,
    month,
    day,
    week,
    inMonth,
    isToday: inMonth &&
      year === current.year && month === current.month && day === current.day,
    isWeekend: week === 0 || week === 6,
    secondaryText: secondary.text,
    secondaryKind: secondary.kind,
    isJieQi: secondary.isJieQi,
    isFestival: secondary.isFestival
  };
}

// Always six rows by seven columns, Monday first. The lead/next(i) shape is
// deliberately kept identical to the handoff.
function buildCells(year, month, today) {
  const first = Solar.fromYmd(year, month, 1);
  const weekday = first.getWeek(); // 0 = Sunday, 6 = Saturday
  const lead = weekday === 0 ? 6 : weekday - 1;
  const start = first.next(-lead);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    cells.push(buildCell(start.next(i), year, month, today));
  }
  return cells;
}

function buildNow(date) {
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const lunar = solar.getLunar();
  return {
    hourMinute: formatHourMinute(date),
    weekday: WEEKDAY_NAMES[solar.getWeek()],
    day: solar.getDay(),
    ganzhiYear: `${lunar.getYearInGanZhi()}年【${lunar.getYearShengXiao()}年】`,
    lunarMonthDay: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
  };
}

module.exports = {
  MIN_YEAR,
  MAX_YEAR,
  WEEKDAY_NAMES,
  MENU_TITLE_PATTERN,
  pad2,
  formatMenuTitle,
  isValidMenuTitle,
  formatHourMinute,
  daysInMonth,
  buildCell,
  buildCells,
  buildNow
};
