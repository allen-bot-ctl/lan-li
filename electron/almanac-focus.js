'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Almanac focus data is produced offline for 2000-01-01..2099-12-31 and shipped
// with the app. Nothing here recomputes rarity at startup or runtime.
const SCHEMA_VERSION = 1;
const MAX_SCORE = 36525;
const SPECIAL_TERMS = new Set(['无', '诸事不宜', '馀事勿取']);
const DEFAULT_FILE = path.join(__dirname, 'data', 'almanac-focus.json');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function warn(logger, message) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message);
  }
}

function reasonOf(error) {
  return error && error.message ? error.message : String(error);
}

function validScore(value) {
  return Number.isInteger(value) && value > 0 ? value : MAX_SCORE;
}

function createUnavailableData() {
  return {
    available: false,
    score() {
      return MAX_SCORE;
    },
    hint() {
      return '';
    },
    quote() {
      return '';
    }
  };
}

function createFocusData(parsed) {
  const yi = parsed.rarity.yi;
  const ji = parsed.rarity.ji;
  const quotes = parsed.quotes;

  function tableFor(list) {
    return list === 'ji' ? ji : yi;
  }

  function score(list, term) {
    const table = tableFor(list);
    return Object.prototype.hasOwnProperty.call(table, term)
      ? validScore(table[term])
      : MAX_SCORE;
  }

  return {
    available: true,
    source: parsed.source,
    zhiXingOrder: Array.isArray(parsed.zhiXingOrder)
      ? parsed.zhiXingOrder.slice()
      : [],
    score,
    hint(list, term) {
      if (SPECIAL_TERMS.has(term)) return '';
      const count = Math.floor(score(list, term) / 100 + 0.5);
      return count === 0 ? '不到一年一次' : `年约${count}次`;
    },
    // Missing style or value falls back to the lunar quote; a missing quote in
    // both places renders as an empty line.
    quote(styleId, zhiXing) {
      const styleQuotes = isPlainObject(quotes[styleId]) ? quotes[styleId] : null;
      const styleValue = styleQuotes ? styleQuotes[zhiXing] : undefined;
      if (typeof styleValue === 'string' && styleValue.length > 0) return styleValue;

      const lunarQuotes = isPlainObject(quotes.lunar) ? quotes.lunar : null;
      const lunarValue = lunarQuotes ? lunarQuotes[zhiXing] : undefined;
      return typeof lunarValue === 'string' && lunarValue.length > 0 ? lunarValue : '';
    }
  };
}

// Reads the packaged focus table once at startup. Any structural problem makes
// the whole table unavailable; the caller keeps working with MAX_SCORE.
function loadAlmanacFocus(options = {}) {
  const file = typeof options.file === 'string' && options.file
    ? options.file
    : DEFAULT_FILE;
  const logger = options.logger;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    warn(
      logger,
      `[栏历] 黄历焦点数据：读取失败（${reasonOf(error)}），焦点词与签语按降级处理。`
    );
    return createUnavailableData();
  }

  const usable = isPlainObject(parsed) &&
    parsed.schemaVersion === SCHEMA_VERSION &&
    isPlainObject(parsed.rarity) &&
    isPlainObject(parsed.rarity.yi) &&
    isPlainObject(parsed.rarity.ji) &&
    isPlainObject(parsed.quotes);

  if (!usable) {
    warn(
      logger,
      '[栏历] 黄历焦点数据：schemaVersion 或结构不符，焦点词与签语按降级处理。'
    );
    return createUnavailableData();
  }

  return createFocusData(parsed);
}

function defaultScore() {
  return MAX_SCORE;
}

// Picks the rarest original term. Only the three special terms are skipped;
// funeral-related terms are intentionally kept. Ties keep the library order.
function pickFocus(raw, list, scoreOf) {
  const terms = Array.isArray(raw) ? raw : [];
  const score = typeof scoreOf === 'function' ? scoreOf : defaultScore;

  if (list === 'ji' && terms.includes('诸事不宜')) return '诸事不宜';

  const candidates = terms.filter((term) => !SPECIAL_TERMS.has(term));
  if (candidates.length === 0) return terms[0];

  let best = candidates[0];
  let bestScore = score(best);
  for (let index = 1; index < candidates.length; index += 1) {
    const current = candidates[index];
    const currentScore = score(current);
    if (currentScore < bestScore) {
      best = current;
      bestScore = currentScore;
    }
  }
  return best;
}

module.exports = {
  SCHEMA_VERSION,
  MAX_SCORE,
  SPECIAL_TERMS,
  loadAlmanacFocus,
  pickFocus
};
