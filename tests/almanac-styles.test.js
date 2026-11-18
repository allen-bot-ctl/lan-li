'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LunarUtil } = require('lunar-javascript');

const { buildAlmanac } = require('../electron/calendar');
const {
  STYLE_DEFINITIONS,
  STYLE_IDS,
  VOCABULARY_COUNT,
  mapAlmanacTerms,
  readAlmanacStyle
} = require('../electron/almanac-styles');

const STYLE_DIR = path.join(__dirname, '..', 'electron', 'data', 'almanac-styles');
const STYLE_FILES = ['coder', 'worker', 'student', 'fitness'];
const FILE_FIELDS = [
  'schemaVersion',
  'id',
  'name',
  'tagline',
  'badge',
  'accent',
  'source',
  'map'
];

function readStyle(id) {
  return JSON.parse(fs.readFileSync(path.join(STYLE_DIR, `${id}.json`), 'utf8'));
}

function textWidth(value) {
  return Array.from(value).reduce(
    (width, character) => width + (character.charCodeAt(0) < 128 ? 1 : 2),
    0
  );
}

function vocabulary() {
  const terms = new Set();
  for (const month of LunarUtil.JIA_ZI) {
    for (const day of LunarUtil.JIA_ZI) {
      for (const term of LunarUtil.getDayYi(month, day)) terms.add(term);
      for (const term of LunarUtil.getDayJi(month, day)) terms.add(term);
    }
  }
  return terms;
}

function almanacOn(year, month, day, styleId) {
  return buildAlmanac(new Date(year, month - 1, day), styleId);
}

const EXPECTED_FOCUS = {
  '2026-11-17': { yi: '修坟', ji: '进人口' },
  '2026-11-16': { yi: '雕刻', ji: '出货财' },
  '2026-11-09': { yi: '沐浴', ji: '无' },
  '2026-12-09': { yi: '解除', ji: '诸事不宜' }
};

test('vocabulary enumeration is 114 terms and matches every style map exactly', () => {
  const terms = vocabulary();

  assert.equal(terms.size, VOCABULARY_COUNT);
  assert.equal(terms.size, 114);

  const expected = Array.from(terms).sort();
  for (const id of STYLE_FILES) {
    const style = readStyle(id);
    assert.deepEqual(Object.keys(style.map).sort(), expected, `${id} map keys`);
  }
});

test('style files satisfy the fixed schema and text rules', () => {
  const terms = vocabulary();

  for (const id of STYLE_FILES) {
    const style = readStyle(id);
    const file = `${id}.json`;

    assert.deepEqual(Object.keys(style), FILE_FIELDS, `${file} fields`);
    assert.equal(style.schemaVersion, 1);
    assert.equal(style.id, id);
    assert.match(style.name, /^[\u4e00-\u9fff]{2,5}$/);
    assert.ok(Array.from(style.tagline).length <= 12);
    assert.match(style.badge, /^[\u4e00-\u9fff]$/);
    assert.match(style.accent.light, /^#[0-9A-F]{6}$/);
    assert.match(style.accent.dark, /^#[0-9A-F]{6}$/);
    assert.deepEqual(style.source, {
      library: 'lunar-javascript',
      version: '1.7.8',
      vocabularyCount: 114
    });

    assert.equal(Object.keys(style.map).length, terms.size);
    const values = Object.values(style.map);
    assert.equal(values.length, new Set(values).size, `${file} duplicate values`);

    for (const value of values) {
      assert.equal(typeof value, 'string');
      assert.ok(value.length > 0);
      assert.equal(/\s/.test(value), false);
      assert.ok(textWidth(value) <= 12, `${file} too wide: ${value}`);
    }
  }
});

test('style file metadata matches the main-process constant table', () => {
  for (const id of STYLE_FILES) {
    const style = readStyle(id);
    const definition = STYLE_DEFINITIONS.find((entry) => entry.id === id);

    assert.ok(definition, `${id} has a constant definition`);
    assert.equal(style.id, definition.id);
    assert.equal(style.name, definition.name);
    assert.equal(style.badge, definition.badge);
    assert.deepEqual(style.accent, definition.accent);
  }
});

test('unknown almanacStyle reads as lunar without rewriting preferences', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-li-almanac-'));
  const file = path.join(directory, 'preferences.json');
  const original = '{\n  "loginItemInitialized": true,\n  "almanacStyle": "not-a-style"\n}\n';
  fs.writeFileSync(file, original, 'utf8');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const preferences = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(readAlmanacStyle(preferences), 'lunar');
  assert.equal(fs.readFileSync(file, 'utf8'), original);

  // The real startup path reads the preference and must not write it back.
  const main = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'main.js'),
    'utf8'
  );
  const initialize = main.match(/function initializeAlmanacStyle\(\) \{[\s\S]*?\n\}/);
  assert.ok(initialize, 'initializeAlmanacStyle should exist');
  assert.match(initialize[0], /almanacStyle = readAlmanacStyle\(readPreferences\(\)\);/);
  assert.equal(/writePreferences/.test(initialize[0]), false);
});

test('missing keys and invalid values fall back to the original term', () => {
  const mapped = mapAlmanacTerms(
    ['祭祀', '祈福', '无'],
    { 祭祀: '拜一拜服务器', 祈福: '' }
  );

  assert.deepEqual(mapped.items, ['拜一拜服务器', '祈福', '无']);
  assert.equal(mapped.title, '拜一拜服务器 祈福 无');
});

test('mapped duplicate text keeps only the first occurrence', () => {
  const mapped = mapAlmanacTerms(
    ['祭祀', '祈福', '求嗣'],
    { 祭祀: '同一文案', 祈福: '同一文案', 求嗣: '另一文案' }
  );

  assert.deepEqual(mapped.items, ['同一文案', '另一文案']);
  assert.equal(mapped.title, '同一文案 另一文案');
});

test('same date and style produce deeply equal results', () => {
  const date = new Date(2026, 10, 17, 22, 47, 13);
  assert.deepEqual(buildAlmanac(date, 'coder'), buildAlmanac(date, 'coder'));
  assert.deepEqual(buildAlmanac(date, 'worker'), buildAlmanac(date, 'worker'));
});

test('omitting the style is identical to lunar for every card field', () => {
  const date = new Date(2026, 10, 16);
  const fallback = buildAlmanac(date);
  const lunar = buildAlmanac(date, 'lunar');

  for (const key of ['yi', 'ji', 'focusYi', 'focusJi', 'quote', 'metaText', 'detail']) {
    assert.deepEqual(fallback[key], lunar[key], key);
  }
  assert.equal(lunar.yi[0], '纳采');
  assert.equal(lunar.ji[0], '上梁');
  assert.equal(lunar.styleName, '农历黄历');
});

test('almanacStyle preferences only accept the five known ids', () => {
  assert.equal(readAlmanacStyle({ almanacStyle: 'abc' }), 'lunar');
  assert.equal(readAlmanacStyle({ almanacStyle: 123 }), 'lunar');
  assert.equal(readAlmanacStyle({}), 'lunar');
  assert.equal(readAlmanacStyle(null), 'lunar');
  for (const id of STYLE_IDS) {
    assert.equal(readAlmanacStyle({ almanacStyle: id }), id);
  }
});

test('four dates pick the same rare original term in all five styles', () => {
  for (const [date, expected] of Object.entries(EXPECTED_FOCUS)) {
    const [year, month, day] = date.split('-').map(Number);
    for (const styleId of STYLE_IDS) {
      const almanac = almanacOn(year, month, day, styleId);
      const map = styleId === 'lunar' ? {} : readStyle(styleId).map;

      assert.equal(almanac.focusYi.term, expected.yi, `${date} ${styleId} focus Yi`);
      assert.equal(almanac.focusJi.term, expected.ji, `${date} ${styleId} focus Ji`);
      assert.equal(
        almanac.focusYi.text,
        map[expected.yi] || expected.yi,
        `${date} ${styleId} focus Yi text`
      );
      assert.equal(
        almanac.focusJi.text,
        map[expected.ji] || expected.ji,
        `${date} ${styleId} focus Ji text`
      );
    }
  }
});

test('2026-11-17 coder keeps the complete lists without original terms', () => {
  const almanac = almanacOn(2026, 11, 17, 'coder');

  assert.equal(almanac.yi.length, 13);
  assert.equal(almanac.detail.yiItems.length, 13);
  assert.equal(almanac.detail.yiItems[0], '拜一拜服务器');
  assert.equal(almanac.focusYi.title, '年约20次');
  assert.equal(almanac.styleName, '程序猿黄历');
  assert.equal(almanac.lunarDayText, '十月初九');
});
