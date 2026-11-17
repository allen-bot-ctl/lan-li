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

const EXPECTED = {
  '2026-11-17': {
    lunar: {
      yiText: '祭祀 祈福 求嗣 开光 解除 伐木',
      jiText: '嫁娶 进人口 入宅 移徙 出火 出行'
    },
    coder: {
      yiText: '拜一拜服务器 祈祷CI全绿 招个实习生 新电脑装环境 解决冲突 砍需求',
      jiText: '合并分支 新人入职 入住新工位 迁移上云 紧急热修复 出差驻场'
    },
    worker: {
      yiText: '向上汇报 许愿涨工资 发展接班人 领新工牌 化解误会 取消会议',
      jiText: '跨部门合作 迎新人入职 搬新办公室 换工位 紧急救火 出差跑客户'
    },
    student: {
      yiText: '拜拜学霸 许愿不挂科 找学习搭子 开新笔记本 解开心结 删游戏',
      jiText: '组队做项目 迎新生 入住宿舍 换座位 赶DDL 研学旅行'
    },
    fitness: {
      yiText: '向教练请安 许愿掉秤 找健身搭子 开新蛋白粉 放松筋膜 练伐木式',
      jiText: '双人训练 带朋友进门 办健身卡 练农夫行走 燃脂暴汗 户外徒步'
    }
  },
  '2026-11-16': {
    lunar: {
      yiText: '纳采 订盟 嫁娶 祭祀 祈福 雕刻',
      jiText: '上梁 开仓 出货财 盖屋 造船'
    },
    coder: {
      yiText: '提交PR 签API约定 合并分支 拜一拜服务器 祈祷CI全绿 打磨UI细节',
      jiText: '发布正式版 开放API 交付版本 搭新系统 搭微服务'
    },
    worker: {
      yiText: '给客户送礼 签劳动合同 跨部门合作 向上汇报 许愿涨工资 改到第八版',
      jiText: '冲刺晋升 报销发票 请客吃饭 拉新项目组 组建小组'
    },
    student: {
      yiText: '交作业 结对复习 组队做项目 拜拜学霸 许愿不挂科 抄写错题',
      jiText: '冲刺排名 拆零食 卖旧课本 搭乐高 折纸船'
    },
    fitness: {
      yiText: '买新跑鞋 约定打卡 双人训练 向教练请安 许愿掉秤 雕刻腹肌',
      jiText: '卧推冲重量 放开吃 续费年卡 搭家庭健身房 练划船'
    }
  },
  '2026-11-09': {
    lunar: {
      yiText: '祭祀 沐浴 馀事勿取',
      jiText: '无'
    },
    coder: {
      yiText: '拜一拜服务器 清理缓存 其余需求勿接',
      jiText: 'null'
    },
    worker: {
      yiText: '向上汇报 午休洗把脸 其余会议勿开',
      jiText: '无'
    },
    student: {
      yiText: '拜拜学霸 洗个头 其余作业勿碰',
      jiText: '无'
    },
    fitness: {
      yiText: '向教练请安 蒸桑拿 其余项目勿练',
      jiText: '无'
    }
  },
  '2026-12-09': {
    lunar: {
      yiText: '祭祀 解除 馀事勿取',
      jiText: '诸事不宜'
    },
    coder: {
      yiText: '拜一拜服务器 解决冲突 其余需求勿接',
      jiText: '一切部署'
    },
    worker: {
      yiText: '向上汇报 化解误会 其余会议勿开',
      jiText: '一切努力'
    },
    student: {
      yiText: '拜拜学霸 解开心结 其余作业勿碰',
      jiText: '一切考试'
    },
    fitness: {
      yiText: '向教练请安 放松筋膜 其余项目勿练',
      jiText: '一切大重量'
    }
  }
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
  assert.equal(mapped.title, '拜一拜服务器（祭祀） 祈福（祈福） 无（无）');
});

test('mapped duplicate text keeps only the first occurrence', () => {
  const mapped = mapAlmanacTerms(
    ['祭祀', '祈福', '求嗣'],
    { 祭祀: '同一文案', 祈福: '同一文案', 求嗣: '另一文案' }
  );

  assert.deepEqual(mapped.items, ['同一文案', '另一文案']);
  assert.equal(mapped.title, '同一文案（祭祀） 另一文案（求嗣）');
});

test('same date and style produce deeply equal results', () => {
  const date = new Date(2026, 10, 17, 22, 47, 13);
  assert.deepEqual(buildAlmanac(date, 'coder'), buildAlmanac(date, 'coder'));
  assert.deepEqual(buildAlmanac(date, 'worker'), buildAlmanac(date, 'worker'));
});

test('omitting the style is identical to lunar for every list and title', () => {
  const date = new Date(2026, 10, 16);
  const fallback = buildAlmanac(date);
  const lunar = buildAlmanac(date, 'lunar');

  for (const key of ['yi', 'ji', 'yiText', 'jiText', 'yiTitle', 'jiTitle']) {
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

test('four dates render the confirmed text for all five styles', () => {
  for (const [date, styles] of Object.entries(EXPECTED)) {
    const [year, month, day] = date.split('-').map(Number);
    for (const [styleId, expected] of Object.entries(styles)) {
      const almanac = almanacOn(year, month, day, styleId);
      assert.equal(almanac.yiText, expected.yiText, `${date} ${styleId} yiText`);
      assert.equal(almanac.jiText, expected.jiText, `${date} ${styleId} jiText`);
    }
  }
});

test('2026-11-17 coder keeps the complete lists and original terms in titles', () => {
  const almanac = almanacOn(2026, 11, 17, 'coder');

  assert.equal(almanac.yi.length, 13);
  assert.ok(almanac.yiTitle.startsWith('拜一拜服务器（祭祀） 祈祷CI全绿（祈福）'));
  assert.equal(almanac.styleName, '程序猿黄历');
  assert.equal(almanac.lunarDayText, '十月初九');
});
