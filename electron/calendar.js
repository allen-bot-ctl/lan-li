'use strict';

const { Solar } = require('lunar-javascript');
const {
  createStyleCatalog,
  mapTerm,
  mapAlmanacTerms
} = require('./almanac-styles');
const { loadAlmanacFocus, pickFocus } = require('./almanac-focus');

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

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

// 黄历卡片：干支生肖纪年与农历月用于左侧顶栏，农历月日用于卡片标题行；
// 当日宜忌全部来自 lunar-javascript 离线计算，再按所选风格逐词映射。
// 卡片只显示 1 宜 + 1 忌（按百年稀有度选最罕见的原词）、一句建除签语与
// 一行干支冲煞；完整列表进「今日黄历」面板。只由「现在」与 styleId 决定。
let styleCatalog = null;
let focusData = null;

// The main process calls this once during startup so style-file warnings go to
// the file logger. Tests (and accidental early calls) lazily load the same
// packaged directory with console warnings instead.
function configureAlmanacStyles(options = {}) {
  styleCatalog = createStyleCatalog(options);
  return styleCatalog;
}

function getStyleCatalog() {
  if (!styleCatalog) {
    styleCatalog = createStyleCatalog({
      logger: { warn: (message) => console.warn(message) }
    });
  }
  return styleCatalog;
}

// Startup loads the packaged rarity table and quotes once beside the style
// files. Tests may point at a temporary file and reset with no options.
function configureAlmanacFocus(options = {}) {
  focusData = loadAlmanacFocus(options);
  return focusData;
}

function getFocusData() {
  if (!focusData) {
    focusData = loadAlmanacFocus({
      logger: { warn: (message) => console.warn(message) }
    });
  }
  return focusData;
}

// 干支生肖年与农历月：黄历卡片标题与月历顶栏副标题共用这一处计算。
function lunarHeader(lunar) {
  return {
    ganZhiText: `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年`,
    lunarMonthText: `${lunar.getMonthInChinese()}月`
  };
}

// 月历顶栏副标题按所显示的月份计算：显示月是本月时取今天（跨午夜随
// tick 更新），其他月取该月 1 号；闰月照旧由库里带出「闰六月」。
function buildViewSubtitle(viewYear, viewMonth, today) {
  const current = normalizeToday(today);
  const solar = viewYear === current.year && viewMonth === current.month
    ? Solar.fromYmd(current.year, current.month, current.day)
    : Solar.fromYmd(viewYear, viewMonth, 1);
  const header = lunarHeader(solar.getLunar());
  return `${header.ganZhiText} · ${header.lunarMonthText}`;
}

function focusEntry(term, list, style) {
  const isLunar = style.definition.id === 'lunar';
  const text = isLunar ? term : mapTerm(term, style.map);
  return {
    term,
    text,
    title: isLunar ? term : `${text}（${term}）`,
    hint: getFocusData().hint(list, term)
  };
}

// 0.1.30：渲染层按 YYYY-MM-DD 取某天黄历；格式或日期非法返回 null。
function parseDateKey(key) {
  if (typeof key !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return new Date(year, month - 1, day, 12);
}

// 下一个节气倒计时已按 0.1.24 契约移除；月历格子仍标出节气。
function buildAlmanac(date, styleId = 'lunar') {
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const lunar = solar.getLunar();
  const rawYi = lunar.getDayYi().map(String);
  const rawJi = lunar.getDayJi().map(String);
  const style = getStyleCatalog().get(styleId);
  const mappedYi = mapAlmanacTerms(rawYi, style.map);
  const mappedJi = mapAlmanacTerms(rawJi, style.map);
  const isLunar = style.definition.id === 'lunar';
  const yi = mappedYi.items;
  const ji = mappedJi.items;
  const { ganZhiText, lunarMonthText } = lunarHeader(lunar);

  const data = getFocusData();
  const focusYiTerm = pickFocus(rawYi, 'yi', (term) => data.score('yi', term));
  const focusJiTerm = pickFocus(rawJi, 'ji', (term) => data.score('ji', term));

  const zhiXing = lunar.getZhiXing();
  const chongShengXiao = lunar.getDayChongShengXiao();
  const sha = lunar.getDaySha();
  const jieQi = lunar.getJieQi();
  const metaText = `${lunar.getDayInGanZhi()}日 ` +
    `${jieQi || `${zhiXing}日`} 冲${chongShengXiao}煞${sha}`;
  const chongText = `冲${chongShengXiao}（${lunar.getDayChongGan()}${lunar.getDayChong()}）煞${sha}`;

  return {
    dateKey: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    solarText: `${date.getMonth() + 1}月${date.getDate()}日`,
    styleId: style.definition.id,
    styleName: style.definition.name,
    accentLight: style.definition.accent.light,
    accentDark: style.definition.accent.dark,
    rawYi,
    rawJi,
    ganZhiText,
    lunarMonthText,
    lunarDayText: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    yi,
    ji,
    focusYi: focusEntry(focusYiTerm, 'yi', style),
    focusJi: focusEntry(focusJiTerm, 'ji', style),
    quote: data.quote(style.definition.id, zhiXing),
    metaText,
    detail: {
      yiItems: isLunar ? rawYi.slice() : mappedYi.labels.slice(),
      jiItems: isLunar ? rawJi.slice() : mappedJi.labels.slice(),
      zhiXing,
      tianShen: lunar.getDayTianShen(),
      tianShenLuck: lunar.getDayTianShenLuck(),
      chongText,
      pengZu: [lunar.getPengZuGan(), lunar.getPengZuZhi()]
    }
  };
}

module.exports = {
  MIN_YEAR,
  MAX_YEAR,
  MENU_TITLE_PATTERN,
  pad2,
  formatMenuTitle,
  isValidMenuTitle,
  daysInMonth,
  buildCell,
  buildCells,
  configureAlmanacStyles,
  configureAlmanacFocus,
  mapAlmanacTerms,
  buildAlmanac,
  parseDateKey,
  buildViewSubtitle
};
