'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Solar, LunarUtil } = require('lunar-javascript');

const { buildAlmanac, configureAlmanacFocus } = require('../electron/calendar');
const {
  MAX_SCORE,
  loadAlmanacFocus,
  pickFocus
} = require('../electron/almanac-focus');

const DATA_FILE = path.join(__dirname, '..', 'electron', 'data', 'almanac-focus.json');
const STYLE_DIR = path.join(__dirname, '..', 'electron', 'data', 'almanac-styles');
const DATA_SHA256 =
  'a19a5ee3eeaf50a530a463fd727318578bc670956c9a5c7e0f355e2565f74509';
const STYLE_IDS = ['lunar', 'coder', 'worker', 'student', 'fitness'];
const STYLE_FILES = ['coder', 'worker', 'student', 'fitness'];
const ZHI_XING_ORDER = '建除满平定执破危成收开闭';

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function readStyle(id) {
  return JSON.parse(fs.readFileSync(path.join(STYLE_DIR, `${id}.json`), 'utf8'));
}

function almanacOn(year, month, day, styleId) {
  return buildAlmanac(new Date(year, month - 1, day), styleId);
}

function textWidth(value) {
  return Array.from(value).reduce(
    (width, character) => width + (character.charCodeAt(0) < 128 ? 1 : 2),
    0
  );
}

function scoreOf(data, list, term) {
  const value = data.rarity[list][term];
  return Number.isInteger(value) && value > 0 ? value : MAX_SCORE;
}

function picker(data, list) {
  return (term) => scoreOf(data, list, term);
}

function tempFile(t, content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-li-focus-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'almanac-focus.json');
  if (content !== undefined) {
    fs.writeFileSync(file, content, 'utf8');
  }
  return file;
}

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `CSS rule ${selector} should exist`);
  return match[1];
}

const QUOTES = {
  lunar: {
    建: '万物始生 宜开新局',
    除: '除旧布新 扫尘去垢',
    满: '月满则亏 留三分余',
    平: '平平是福 不争不抢',
    定: '心定事成 宜作长计',
    执: '执守一事 莫贪多',
    破: '宜破旧 不宜立新',
    危: '居安思危 行事三思',
    成: '水到渠成 所求可得',
    收: '春种秋收 宜收不宜放',
    开: '门开路通 宜迎新客',
    闭: '闭门养藏 宜守不宜攻'
  },
  coder: {
    建: '新建仓库 写下第一行',
    除: '删掉的代码最安全',
    满: '磁盘将满 先清日志',
    平: '无事发生 就是好事',
    定: '需求冻结 心也定了',
    执: '一个PR只做一件事',
    破: '推倒重写 慎之又慎',
    危: '周五下午 莫碰生产',
    成: '编译通过 测试全绿',
    收: '该合的PR今天合了',
    开: '开闸放量 灰度先行',
    闭: '关掉通知 专心写码'
  },
  worker: {
    建: '列好待办 先做一件',
    除: '推掉无效会议',
    满: '日程排满 留口喘气',
    平: '平稳摸鱼 不显山水',
    定: '方案敲定 不再返工',
    执: '认准一事 做完再说',
    破: '打破惯例 先问老板',
    危: '言多必失 群聊慎发',
    成: '今日事成 可早下班',
    收: '收尾归档 准点打卡',
    开: '主动汇报 机会自来',
    闭: '勿扰模式 深度干活'
  },
  student: {
    建: '新开一本错题本',
    除: '清空书桌 再开一章',
    满: '课表排满 记得喝水',
    平: '按部就班 稳扎稳打',
    定: '定好计划 照表执行',
    执: '一道难题 死磕到底',
    破: '跳出题海 回归课本',
    危: '临时抱佛脚 风险高',
    成: '功夫不负有心人',
    收: '整理笔记 收获满满',
    开: '举手提问 茅塞顿开',
    闭: '合上手机 进入状态'
  },
  fitness: {
    建: '新周期开练 先热身',
    除: '清掉零食柜',
    满: '吃到七分饱',
    平: '平板支撑一分钟',
    定: '定好训练日 不改期',
    执: '动作标准 胜过重量',
    破: '突破极限 量力而行',
    危: '大重量日 记得保护',
    成: '坚持打卡 肌肉在长',
    收: '拉伸放松 收操别省',
    开: '开合跳 唤醒身体',
    闭: '休息日 也是训练'
  }
};

// Raw lists come from the library on 2026 dates; the focus terms and scores
// were confirmed against the shipped rarity table.
const EXPECTED = [
  {
    date: '2026-11-17',
    rawYi: '祭祀 祈福 求嗣 开光 解除 伐木 拆卸 修造 栽种 纳畜 安葬 修坟 立碑',
    rawJi: '嫁娶 进人口 入宅 移徙 出火 出行',
    focusYi: ['修坟', 2012],
    focusJi: ['进人口', 712],
    zhiXing: '成',
    metaText: '乙未日 成日 冲牛煞西'
  },
  {
    date: '2026-11-16',
    rawYi: '纳采 订盟 嫁娶 祭祀 祈福 雕刻 移徙 开市 入宅 出行 动土 会亲友 入学 修造 起基 安门 安床 造庙 解除 纳财 开池 造畜稠 牧养',
    rawJi: '上梁 开仓 出货财 盖屋 造船',
    focusYi: ['雕刻', 512],
    focusJi: ['出货财', 721],
    zhiXing: '危',
    metaText: '甲午日 危日 冲鼠煞北'
  },
  {
    date: '2026-11-09',
    rawYi: '祭祀 沐浴 馀事勿取',
    rawJi: '无',
    focusYi: ['沐浴', 6042],
    focusJi: ['无', 2002],
    zhiXing: '建',
    metaText: '丁亥日 建日 冲蛇煞西'
  },
  {
    date: '2026-12-09',
    rawYi: '祭祀 解除 馀事勿取',
    rawJi: '诸事不宜',
    focusYi: ['解除', 9566],
    focusJi: ['诸事不宜', 3408],
    zhiXing: '执',
    metaText: '丁巳日 执日 冲猪煞东'
  },
  {
    date: '2026-03-30',
    rawYi: '祭祀 会亲友 出行 立券 交易 冠笄 纳财',
    rawJi: '嫁娶 动土 掘井 起基 定磉 破土',
    focusYi: ['纳财', 5320],
    focusJi: ['起基', 154],
    zhiXing: '建',
    metaText: '癸卯日 建日 冲鸡煞西'
  },
  {
    date: '2026-08-11',
    rawYi: '祭祀 开光 解除 进人口 交易 立券 纳财 纳畜',
    rawJi: '动土 破土 嫁娶 理发 出行 入宅 移徙 分居 安香 出火',
    focusYi: ['进人口', 5032],
    focusJi: ['分居', 198],
    zhiXing: '收',
    metaText: '丁巳日 收日 冲猪煞东'
  },
  {
    date: '2026-12-06',
    rawYi: '纳采 移徙 纳财 开市 交易 立券 入宅 修造 动土 竖柱 起基 定磉 造庙 安香 出火 修饰垣墙 平治道涂 会亲友 出行 开池 开厕',
    rawJi: '开仓 盖屋 造桥 祭祀',
    focusYi: ['造庙', 655],
    focusJi: ['开仓', 1240],
    zhiXing: '平',
    metaText: '甲寅日 平日 冲猴煞北'
  }
];

const CARD_TEXT = {
  '2026-11-17': {
    lunar: ['修坟', '进人口', '水到渠成 所求可得'],
    coder: ['维护老项目', '新人入职', '编译通过 测试全绿']
  },
  '2026-11-16': {
    lunar: ['雕刻', '出货财', '居安思危 行事三思'],
    coder: ['打磨UI细节', '交付版本', '周五下午 莫碰生产']
  },
  '2026-11-09': {
    lunar: ['沐浴', '无', '万物始生 宜开新局'],
    coder: ['清理缓存', 'null', '新建仓库 写下第一行']
  },
  '2026-12-09': {
    lunar: ['解除', '诸事不宜', '执守一事 莫贪多'],
    coder: ['解决冲突', '一切部署', '一个PR只做一件事']
  },
  '2026-03-30': {
    lunar: ['纳财', '起基', '万物始生 宜开新局'],
    coder: ['领年终奖', '搭脚手架', '新建仓库 写下第一行']
  },
  '2026-08-11': {
    lunar: ['进人口', '分居', '春种秋收 宜收不宜放'],
    coder: ['新人入职', '拆分模块', '该合的PR今天合了']
  },
  '2026-12-06': {
    lunar: ['造庙', '开仓', '平平是福 不争不抢'],
    coder: ['搭建内部Wiki', '开放API', '无事发生 就是好事']
  }
};

function dateParts(isoDate) {
  return isoDate.split('-').map(Number);
}

test('1. packaged focus data is byte-identical to the accepted source', () => {
  const bytes = fs.readFileSync(DATA_FILE);
  assert.equal(bytes.length, 7292);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), DATA_SHA256);

  const data = readData();
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.source, {
    library: 'lunar-javascript',
    version: '1.7.8',
    range: '2000-01-01..2099-12-31',
    days: 36525
  });
  assert.equal(Object.keys(data.rarity.yi).length, 110);
  assert.equal(Object.keys(data.rarity.ji).length, 86);
});

test('2. rarity table equals a fresh 2000-2099 library count', () => {
  const data = readData();
  const yi = new Map();
  const ji = new Map();
  let days = 0;
  let solar = Solar.fromYmd(2000, 1, 1);

  for (;;) {
    const lunar = solar.getLunar();
    for (const term of lunar.getDayYi().map(String)) {
      yi.set(term, (yi.get(term) || 0) + 1);
    }
    for (const term of lunar.getDayJi().map(String)) {
      ji.set(term, (ji.get(term) || 0) + 1);
    }
    days += 1;
    if (solar.getYear() === 2099 && solar.getMonth() === 12 && solar.getDay() === 31) {
      break;
    }
    solar = solar.next(1);
  }

  assert.equal(days, 36525);
  assert.equal(data.source.days, 36525);
  assert.deepEqual(
    Object.keys(data.rarity.yi).sort(),
    Array.from(yi.keys()).sort()
  );
  assert.deepEqual(
    Object.keys(data.rarity.ji).sort(),
    Array.from(ji.keys()).sort()
  );
  assert.equal(yi.size, 110);
  assert.equal(ji.size, 86);
  for (const [term, count] of yi) {
    assert.equal(data.rarity.yi[term], count, `yi ${term}`);
  }
  for (const [term, count] of ji) {
    assert.equal(data.rarity.ji[term], count, `ji ${term}`);
  }
});

test('3. quotes structure and wording match the fixed table', () => {
  const data = readData();
  assert.equal(data.zhiXingOrder.join(''), ZHI_XING_ORDER);
  assert.deepEqual(Object.keys(data.quotes), STYLE_IDS);

  for (const styleId of STYLE_IDS) {
    const entries = data.quotes[styleId];
    assert.deepEqual(Object.keys(entries), Array.from(ZHI_XING_ORDER), styleId);
    assert.equal(Object.keys(entries).length, 12);
    assert.equal(new Set(Object.values(entries)).size, 12, `${styleId} duplicates`);
    for (const [zhiXing, value] of Object.entries(entries)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.length > 0, `${styleId} ${zhiXing}`);
      assert.ok(textWidth(value) <= 20, `${styleId} ${zhiXing} too wide`);
    }
    assert.deepEqual(entries, QUOTES[styleId], styleId);
  }
});

test('4. seven dates produce the confirmed focus, quote and meta fields', () => {
  const data = readData();

  for (const expected of EXPECTED) {
    const [year, month, day] = dateParts(expected.date);
    const almanac = almanacOn(year, month, day, 'lunar');

    assert.deepEqual(almanac.rawYi, expected.rawYi.split(' '), `${expected.date} rawYi`);
    assert.deepEqual(almanac.rawJi, expected.rawJi.split(' '), `${expected.date} rawJi`);
    assert.equal(almanac.focusYi.term, expected.focusYi[0], `${expected.date} focusYi term`);
    assert.equal(
      scoreOf(data, 'yi', almanac.focusYi.term),
      expected.focusYi[1],
      `${expected.date} focusYi score`
    );
    assert.equal(almanac.focusJi.term, expected.focusJi[0], `${expected.date} focusJi term`);
    assert.equal(
      scoreOf(data, 'ji', almanac.focusJi.term),
      expected.focusJi[1],
      `${expected.date} focusJi score`
    );
    assert.equal(almanac.detail.zhiXing, expected.zhiXing, `${expected.date} zhiXing`);
    assert.equal(almanac.quote, QUOTES.lunar[expected.zhiXing], `${expected.date} quote`);
    assert.equal(almanac.metaText, expected.metaText, `${expected.date} metaText`);
  }

  // Single special-term rules inside the table: 11-09 uses raw[0] because the
  // only 忌 word is special; 12-09 is overridden by 诸事不宜.
  assert.equal(almanacOn(2026, 11, 9, 'lunar').rawJi[0], '无');
  assert.equal(almanacOn(2026, 12, 9, 'lunar').rawJi[0], '诸事不宜');

  for (const [date, styles] of Object.entries(CARD_TEXT)) {
    const [year, month, day] = dateParts(date);
    for (const [styleId, values] of Object.entries(styles)) {
      const almanac = almanacOn(year, month, day, styleId);
      assert.equal(almanac.focusYi.text, values[0], `${date} ${styleId} focusYi text`);
      assert.equal(almanac.focusJi.text, values[1], `${date} ${styleId} focusJi text`);
      assert.equal(almanac.quote, values[2], `${date} ${styleId} quote`);
    }
  }

  const coder = almanacOn(2026, 11, 17, 'coder');
  assert.equal(coder.focusYi.title, '维护老项目（修坟）');
  assert.equal(coder.focusJi.title, '新人入职（进人口）');
  assert.equal(almanacOn(2026, 11, 17, 'lunar').focusYi.title, '修坟');

  const hints = {
    '2026-11-17': ['年约20次', '年约7次'],
    '2026-11-16': ['年约5次', '年约7次'],
    '2026-11-09': ['年约60次', ''],
    '2026-12-09': ['年约96次', '']
  };
  for (const [date, [yiHint, jiHint]] of Object.entries(hints)) {
    const [year, month, day] = dateParts(date);
    const almanac = almanacOn(year, month, day, 'lunar');
    assert.equal(almanac.focusYi.hint, yiHint, `${date} yi hint`);
    assert.equal(almanac.focusJi.hint, jiHint, `${date} ji hint`);
  }

  const detail = almanacOn(2026, 11, 17, 'lunar').detail;
  assert.equal(detail.yiItems.length, 13);
  assert.equal(detail.jiItems.length, 6);
  assert.equal(detail.zhiXing, '成');
  assert.equal(detail.tianShen, '明堂');
  assert.equal(detail.tianShenLuck, '吉');
  assert.equal(detail.chongText, '冲牛（己丑）煞西');
  assert.deepEqual(detail.pengZu, ['乙不栽植千株不长', '未不服药毒气入肠']);
  assert.equal(coder.detail.yiItems[0], '拜一拜服务器（祭祀）');
});

test('5. the same date and style are deeply equal across repeated calls', () => {
  const date = new Date(2026, 10, 17, 22, 47, 13);

  for (const styleId of STYLE_IDS) {
    const first = buildAlmanac(date, styleId);
    const second = buildAlmanac(date, styleId);
    const third = buildAlmanac(date, styleId);
    assert.deepEqual(second, first, styleId);
    assert.deepEqual(third, first, styleId);
  }
});

test('6. no two adjacent 2026 days share the same focus pair', () => {
  const combos = new Set();
  let previous = null;
  let longestRun = 0;
  let run = 0;

  for (let day = 1; day <= 365; day += 1) {
    const almanac = buildAlmanac(new Date(2026, 0, day), 'lunar');
    const key = `${almanac.focusYi.term}|${almanac.focusJi.term}`;
    combos.add(key);
    run = key === previous ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
    assert.notEqual(key, previous, `2026-01-${String(day).padStart(2, '0')} repeats`);
    previous = key;
  }

  assert.equal(combos.size, 313);
  assert.equal(longestRun, 1);
});

test('7. special terms, ties and unknown words follow the focus rules', () => {
  const data = readData();
  const pickYi = (raw) => pickFocus(raw, 'yi', picker(data, 'yi'));
  const pickJi = (raw) => pickFocus(raw, 'ji', picker(data, 'ji'));

  assert.equal(pickJi(['嫁娶', '诸事不宜']), '诸事不宜');
  assert.equal(pickYi(['诸事不宜']), '诸事不宜');
  assert.equal(pickJi(['无']), '无');
  assert.equal(pickYi(['祭祀', '馀事勿取']), '祭祀');
  assert.equal(pickYi(['塞穴', '诸事不宜']), '塞穴');

  // 起基 / 定磉 and 分居 / 安香 tie; the earlier library term wins each time.
  assert.equal(scoreOf(data, 'ji', '起基'), scoreOf(data, 'ji', '定磉'));
  assert.equal(pickJi(['嫁娶', '起基', '定磉']), '起基');
  assert.equal(scoreOf(data, 'ji', '分居'), scoreOf(data, 'ji', '安香'));
  assert.equal(pickJi(['动土', '分居', '安香']), '分居');

  // Terms outside the table score as a full century, so a listed word wins.
  assert.equal(scoreOf(data, 'yi', '不在表中的词'), MAX_SCORE);
  assert.equal(pickYi(['不在表中的词', '祭祀']), '祭祀');
  assert.equal(pickYi(['不在表中的词', '另一个不在表中的词']), '不在表中的词');

  // An unavailable table makes every word score MAX_SCORE and keeps the first.
  assert.equal(pickFocus(['祭祀', '祈福'], 'yi', () => MAX_SCORE), '祭祀');
});

test('8. degraded loading keeps the card usable and logs exactly one warning', (t) => {
  const valid = readData();
  const invalidSchema = JSON.parse(JSON.stringify(valid));
  invalidSchema.schemaVersion = 2;

  const cases = [
    { name: 'missing file', file: tempFile(t) },
    { name: 'invalid JSON', file: tempFile(t, '{not json') },
    { name: 'schemaVersion 2', file: tempFile(t, JSON.stringify(invalidSchema)) }
  ];

  t.after(() => configureAlmanacFocus());

  for (const entry of cases) {
    const warnings = [];
    const data = configureAlmanacFocus({
      file: entry.file,
      logger: { warn: (message) => warnings.push(message) }
    });

    assert.equal(data.available, false, entry.name);
    assert.equal(warnings.length, 1, entry.name);

    const almanac = almanacOn(2026, 11, 17, 'lunar');
    assert.equal(almanac.focusYi.term, '祭祀', entry.name);
    assert.equal(almanac.focusJi.term, '嫁娶', entry.name);
    assert.equal(almanac.quote, '', entry.name);
    assert.equal(almanac.focusYi.hint, '', entry.name);
    assert.equal(almanac.focusJi.hint, '', entry.name);
    assert.equal(almanac.metaText, '乙未日 成日 冲牛煞西', entry.name);
  }

  // A missing style quote falls back to the lunar quote, not to an empty line.
  const noCoder = JSON.parse(JSON.stringify(valid));
  delete noCoder.quotes.coder;
  const data = configureAlmanacFocus({ file: tempFile(t, JSON.stringify(noCoder)) });
  assert.equal(data.available, true);

  const coder = almanacOn(2026, 11, 17, 'coder');
  const lunar = almanacOn(2026, 11, 17, 'lunar');
  assert.equal(coder.quote, lunar.quote);
  assert.equal(coder.quote, '水到渠成 所求可得');
});

test('9. loading and building never touch the network', (t) => {
  let calls = 0;
  const blocked = () => {
    calls += 1;
    throw new Error('network access is forbidden');
  };

  const saved = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreateConnection: net.createConnection
  };

  globalThis.fetch = blocked;
  http.request = blocked;
  http.get = blocked;
  https.request = blocked;
  https.get = blocked;
  net.connect = blocked;
  net.createConnection = blocked;

  t.after(() => {
    globalThis.fetch = saved.fetch;
    http.request = saved.httpRequest;
    http.get = saved.httpGet;
    https.request = saved.httpsRequest;
    https.get = saved.httpsGet;
    net.connect = saved.netConnect;
    net.createConnection = saved.netCreateConnection;
  });

  const data = loadAlmanacFocus();
  assert.equal(data.available, true);
  configureAlmanacFocus();
  for (const expected of EXPECTED) {
    const [year, month, day] = dateParts(expected.date);
    for (const styleId of STYLE_IDS) {
      almanacOn(year, month, day, styleId);
    }
  }

  assert.equal(calls, 0);

  for (const relative of ['electron/calendar.js', 'electron/almanac-focus.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    assert.equal(/require\(['"](?:node:)?(?:http|https|net)['"]\)/.test(source), false, relative);
    assert.equal(/fetch\(/.test(source), false, relative);
  }
});

test('10. focus text never needs truncation and old list markup is gone', () => {
  for (const id of STYLE_FILES) {
    for (const value of Object.values(readStyle(id).map)) {
      assert.ok(textWidth(value) <= 12, `${id} too wide: ${value}`);
    }
  }

  const vocabulary = new Set();
  for (const month of LunarUtil.JIA_ZI) {
    for (const day of LunarUtil.JIA_ZI) {
      for (const term of LunarUtil.getDayYi(month, day)) vocabulary.add(term);
      for (const term of LunarUtil.getDayJi(month, day)) vocabulary.add(term);
    }
  }
  assert.equal(vocabulary.size, 114);
  for (const term of vocabulary) {
    assert.ok(textWidth(term) <= 8, `term too wide: ${term}`);
  }

  const css = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'renderer', 'calendar.css'),
    'utf8'
  );
  const focus = cssRule(css, '.almanac-focus-text');
  assert.match(focus, /font-size:\s*14px/);
  assert.match(focus, /white-space:\s*nowrap/);
  assert.equal(/text-overflow/.test(focus), false);

  for (const selector of ['.almanac-quote', '.almanac-meta']) {
    assert.equal(/text-overflow/.test(cssRule(css, selector)), false, selector);
  }
});
