'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_WORLD_CLOCK,
  CITY_CATALOG,
  MENU_TITLE_PATTERN,
  isValidTimeZone,
  sameTimeZone,
  formatClock,
  formatClockTime,
  formatClockOffset,
  describeClockRelative,
  formatMenuTitleInZone,
  formatTrayTooltipInZone,
  isValidMenuTitle: isValidMenuTitleInZone,
  resolveMenuBarTimeZone,
  normalizeMenuBarTimeZone,
  nextMenuBarTimeZoneAfterRemove,
  normalizeWorldClocks,
  addClock,
  removeClock,
  searchCatalog
} = require('../electron/world-clocks');

const { isValidMenuTitle } = require('../electron/calendar');

// Fixed fake "supported" list. Formatting validity still uses Node's Intl,
// but catalog fallback search never depends on the host ICU dataset.
const SUPPORTED = () => [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'UTC'
];

function instant(iso) {
  return new Date(iso);
}

test('formatClock shows padded time, unpadded date and Chinese weekday', () => {
  const clock = formatClock(
    instant('2026-11-16T01:02:03Z'),
    'Asia/Shanghai'
  );

  assert.ok(clock);
  assert.equal(clock.time, '09:02:03');
  assert.equal(clock.date, '11月16日');
  assert.equal(clock.weekday, '星期一');
  assert.deepEqual(Object.keys(clock).sort(), ['date', 'time', 'weekday']);
});

test('New York clock follows DST at the given instant, not the standard offset', () => {
  const winter = formatClock(
    instant('2026-01-15T12:00:00Z'),
    'America/New_York'
  );
  const summer = formatClock(
    instant('2026-07-15T12:00:00Z'),
    'America/New_York'
  );

  assert.equal(winter.time, '07:00:00');
  assert.equal(summer.time, '08:00:00');
});

test('half-hour zones render the correct wall clock', () => {
  const india = formatClock(
    instant('2026-11-16T01:02:03Z'),
    'Asia/Kolkata'
  );

  assert.equal(india.time, '06:32:03');
});

test('UTC is rendered without local-offset fields', () => {
  const utc = formatClock(instant('2026-11-16T01:02:03Z'), 'UTC');
  const etcUtc = formatClock(
    instant('2026-11-16T01:02:03Z'),
    'Etc/UTC'
  );

  assert.equal(utc.time, '01:02:03');
  assert.equal(etcUtc.time, utc.time);
  assert.equal(utc.offsetText, undefined);
  assert.equal(utc.dayRelation, undefined);
});

test('formatClock rejects invalid instants and zones', () => {
  assert.equal(formatClock(new Date('nope'), 'Asia/Shanghai'), null);
  assert.equal(
    formatClock(instant('2026-11-16T01:02:03Z'), 'Mars/Olympus'),
    null
  );
});

test('formatClockTime returns compact HH:mm wall-clock time', () => {
  assert.equal(formatClockTime(instant('2026-11-16T07:16:42Z'), 'Asia/Shanghai'), '15:16');
  assert.equal(formatClockTime(instant('2026-11-16T07:16:42Z'), 'America/New_York'), '02:16');
  assert.equal(formatClockTime(instant('2026-11-16T07:16:42Z'), 'UTC'), '07:16');
  assert.equal(formatClockTime(new Date('nope'), 'UTC'), '');
  assert.equal(formatClockTime(instant('2026-11-16T07:16:42Z'), 'Mars/Olympus'), '');
});

test('formatClockOffset renders 快/慢 hours and minutes against local time', () => {
  assert.equal(formatClockOffset(0), '');
  assert.equal(formatClockOffset(60), '快 1 小时');
  assert.equal(formatClockOffset(-780), '慢 13 小时');
  assert.equal(formatClockOffset(90), '快 1 小时 30 分');
  assert.equal(formatClockOffset(-150), '慢 2 小时 30 分');
  assert.equal(formatClockOffset(30), '快 30 分');
  assert.equal(formatClockOffset(Number.NaN), '');
});

test('describeClockRelative labels same-day cities with 快/慢 offsets', () => {
  const now = instant('2026-11-16T07:16:00Z');

  assert.equal(
    describeClockRelative(now, 'Asia/Shanghai', 'Asia/Shanghai').text,
    '本地'
  );
  assert.equal(
    describeClockRelative(now, 'Asia/Tokyo', 'Asia/Shanghai').text,
    '快 1 小时'
  );
  assert.equal(
    describeClockRelative(now, 'America/New_York', 'Asia/Shanghai').text,
    '慢 13 小时'
  );
  assert.equal(
    describeClockRelative(now, 'Asia/Kolkata', 'Asia/Shanghai').text,
    '慢 2 小时 30 分'
  );
});

test('不再显示昨天/明天，只显示时差', () => {
  const now = instant('2026-11-16T20:30:00Z');

  const text = describeClockRelative(now, 'America/New_York', 'Asia/Shanghai').text;
  assert.equal(text, '慢 13 小时');
  assert.ok(!text.includes('明天') && !text.includes('昨天'));
  assert.equal(
    describeClockRelative(now, 'Asia/Tokyo', 'Asia/Shanghai').text,
    '快 1 小时'
  );
});

test('describeClockRelative follows DST when computing the offset', () => {
  const summer = instant('2026-07-15T12:00:00Z');
  const relative = describeClockRelative(summer, 'America/New_York', 'Asia/Shanghai');

  assert.equal(relative.text, '慢 12 小时');
  assert.equal(relative.offsetMinutes, -720);
});

test('C3 纽约为本地：固定时刻 2026-11-18 02:22 与 23:00（冬令时）', () => {
  const local = 'America/New_York';
  const now1 = instant('2026-11-18T07:22:00Z');
  const check1 = (zone, expected) => {
    const text = describeClockRelative(now1, zone, local).text;
    assert.equal(text, expected);
    assert.ok(!text.includes('今天'));
  };

  check1('Asia/Shanghai', '快 13 小时');
  check1('America/New_York', '本地');
  check1('Asia/Tokyo', '快 14 小时');
  check1('Asia/Kolkata', '快 10 小时 30 分');
  check1('Europe/London', '快 5 小时');
  check1('America/Los_Angeles', '慢 3 小时');
  check1('America/Toronto', '时间相同');

  const now2 = instant('2026-11-19T04:00:00Z');
  const shanghai2 = describeClockRelative(now2, 'Asia/Shanghai', local).text;
  assert.equal(shanghai2, '快 13 小时');
  assert.ok(!shanghai2.includes('今天'));
  const la2 = describeClockRelative(now2, 'America/Los_Angeles', local).text;
  assert.equal(la2, '慢 3 小时');
  assert.ok(!la2.includes('今天'));

  const yesterday = describeClockRelative(
    instant('2026-11-18T02:00:00Z'),
    'America/New_York',
    'Asia/Shanghai'
  ).text;
  assert.equal(yesterday, '慢 13 小时');
  assert.ok(!yesterday.includes('今天'));
});

test('describeClockRelative rejects invalid instants and zones', () => {
  assert.equal(describeClockRelative(new Date('nope'), 'Asia/Tokyo', 'Asia/Shanghai'), null);
  assert.equal(
    describeClockRelative(instant('2026-11-16T07:16:00Z'), 'Mars/Olympus', 'Asia/Shanghai'),
    null
  );
  assert.equal(
    describeClockRelative(instant('2026-11-16T07:16:00Z'), 'Asia/Tokyo', 'Mars/Olympus'),
    null
  );
});

test('isValidTimeZone accepts real aliases and rejects unknown ids', () => {
  assert.equal(isValidTimeZone('Asia/Shanghai', SUPPORTED), true);
  assert.equal(isValidTimeZone('Asia/Kolkata', SUPPORTED), true);
  assert.equal(isValidTimeZone('UTC', SUPPORTED), true);
  assert.equal(isValidTimeZone('Mars/Olympus', SUPPORTED), false);
  assert.equal(isValidTimeZone('', SUPPORTED), false);
  assert.equal(isValidTimeZone(null, SUPPORTED), false);
});

test('normalizeWorldClocks seeds 北京 only when the key is missing', () => {
  assert.deepEqual(normalizeWorldClocks(undefined, SUPPORTED), {
    items: [{ id: DEFAULT_WORLD_CLOCK.id, label: DEFAULT_WORLD_CLOCK.label }],
    index: 0
  });

  assert.deepEqual(normalizeWorldClocks({ items: [], index: 3 }, SUPPORTED), {
    items: [],
    index: 0
  });
});

test('normalizeWorldClocks drops invalid and duplicate ids and clamps the index', () => {
  const normalized = normalizeWorldClocks({
    items: [
      { id: 'Asia/Shanghai', label: '上海' },
      { id: 'Asia/Shanghai', label: '重复' },
      { id: 'Mars/Olympus', label: '火星' },
      { id: 'Asia/Tokyo', label: '  ' },
      'bad row'
    ],
    index: 99
  }, SUPPORTED);

  assert.deepEqual(normalized, {
    items: [
      { id: 'Asia/Shanghai', label: '上海' },
      { id: 'Asia/Tokyo', label: 'Asia/Tokyo' }
    ],
    index: 1
  });

  assert.deepEqual(
    normalizeWorldClocks({ items: [{ id: 'Asia/Tokyo', label: '东京' }], index: -5 }, SUPPORTED),
    { items: [{ id: 'Asia/Tokyo', label: '东京' }], index: 0 }
  );

  assert.deepEqual(normalizeWorldClocks({ nope: true }, SUPPORTED), {
    items: [],
    index: 0
  });
});

test('addClock rejects duplicates by IANA id and selects the newly added zone', () => {
  const base = { items: [{ id: 'Asia/Shanghai', label: '北京' }], index: 0 };
  const added = addClock(base, { id: 'Asia/Tokyo', label: '东京' }, SUPPORTED);

  assert.equal(added.index, 1);
  assert.deepEqual(added.items, [
    { id: 'Asia/Shanghai', label: '北京' },
    { id: 'Asia/Tokyo', label: '东京' }
  ]);

  const sameZoneDifferentLabel = addClock(
    added,
    { id: 'Asia/Shanghai', label: '上海' },
    SUPPORTED
  );
  assert.equal(sameZoneDifferentLabel, added);

  const invalid = addClock(added, { id: 'Mars/Olympus', label: '火星' }, SUPPORTED);
  assert.equal(invalid, added);
});

test('addClock stores the label the user picked for a shared zone', () => {
  const base = { items: [], index: 0 };
  const added = addClock(base, { id: 'America/Los_Angeles', label: '旧金山' }, SUPPORTED);

  assert.deepEqual(added.items, [
    { id: 'America/Los_Angeles', label: '旧金山' }
  ]);
});

test('removeClock adjusts the index when the current or an earlier clock goes', () => {
  const three = {
    items: [
      { id: 'Asia/Shanghai', label: '北京' },
      { id: 'Asia/Tokyo', label: '东京' },
      { id: 'Europe/London', label: '伦敦' }
    ],
    index: 2
  };

  const removeCurrent = removeClock(three);
  assert.equal(removeCurrent.index, 1);
  assert.deepEqual(removeCurrent.items.map((item) => item.id), [
    'Asia/Shanghai',
    'Asia/Tokyo'
  ]);

  const removeEarlier = removeClock(three, { id: 'Asia/Shanghai' });
  assert.equal(removeEarlier.index, 1);
  assert.deepEqual(removeEarlier.items.map((item) => item.id), [
    'Asia/Tokyo',
    'Europe/London'
  ]);

  const removeAfter = removeClock({ ...three, index: 0 }, { index: 2 });
  assert.equal(removeAfter.index, 0);
});

test('removing the last remaining clock leaves an explicit empty list', () => {
  const one = { items: [{ id: 'Asia/Shanghai', label: '北京' }], index: 0 };
  assert.deepEqual(removeClock(one), { items: [], index: 0 });
  assert.deepEqual(removeClock({ items: [], index: 0 }), { items: [], index: 0 });
});

test('searchCatalog finds Chinese labels and aliases first', () => {
  const shanghai = searchCatalog('上海', { supportedValuesOf: SUPPORTED });
  assert.deepEqual(shanghai.map((row) => row.label), ['北京']);
  assert.ok(shanghai.every((row) => row.source === 'catalog'));

  const korea = searchCatalog('韩国', { supportedValuesOf: SUPPORTED });
  assert.deepEqual(korea.map((row) => row.label), ['首尔']);

  const all = searchCatalog('', {
    catalog: CITY_CATALOG,
    supportedValuesOf: SUPPORTED
  });
  assert.ok(all.length >= 23);
});

test('city catalog has no duplicate labels and keeps 上海 as a 北京 alias', () => {
  const labels = CITY_CATALOG.map((row) => row.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(labels.includes('上海'), false);

  const beijing = CITY_CATALOG.find((row) => row.label === '北京');
  assert.ok(beijing.aliases.includes('上海'));
  assert.deepEqual(
    searchCatalog('上海', {
      catalog: CITY_CATALOG,
      supportedValuesOf: SUPPORTED
    }).map((row) => row.label),
    ['北京']
  );
});

test('searchCatalog falls back to IANA ids and marks added zones', () => {
  const results = searchCatalog('reykjavik', {
    supportedValuesOf: () => ['Atlantic/Reykjavik', 'Asia/Tokyo'],
    addedIds: ['Atlantic/Reykjavik']
  });

  assert.deepEqual(results, [{
    id: 'Atlantic/Reykjavik',
    label: 'Atlantic/Reykjavik',
    source: 'iana',
    added: true
  }]);
});

test('searchCatalog marks shared-zone rows added by IANA id', () => {
  const results = searchCatalog('洛杉矶', {
    supportedValuesOf: SUPPORTED,
    addedIds: ['America/Los_Angeles']
  });
  assert.deepEqual(results.map((row) => row.label), ['洛杉矶']);
  assert.equal(results[0].added, true);

  const shanghai = searchCatalog('上海', {
    supportedValuesOf: SUPPORTED,
    addedIds: ['Asia/Shanghai']
  });
  assert.deepEqual(shanghai.map((row) => row.label), ['北京']);
  assert.equal(shanghai[0].added, true);
});

test('resolveMenuBarTimeZone falls back to local for unset/null/invalid/unknown stored zone', () => {
  const items = [
    { id: 'Asia/Shanghai', label: '北京' },
    { id: 'America/New_York', label: '纽约' }
  ];
  const local = 'Asia/Shanghai';

  assert.equal(resolveMenuBarTimeZone(undefined, items, local, SUPPORTED), local);
  assert.equal(resolveMenuBarTimeZone(null, items, local, SUPPORTED), local);
  assert.equal(resolveMenuBarTimeZone('', items, local, SUPPORTED), local);
  assert.equal(resolveMenuBarTimeZone('Mars/Olympus', items, local, SUPPORTED), local);
  assert.equal(resolveMenuBarTimeZone('Europe/London', items, local, SUPPORTED), local);
  assert.equal(resolveMenuBarTimeZone('America/New_York', [], local, SUPPORTED), local);
});

test('resolveMenuBarTimeZone keeps a stored zone that is still present in the clock list', () => {
  const items = [
    { id: 'Asia/Shanghai', label: '北京' },
    { id: 'America/New_York', label: '纽约' }
  ];

  assert.equal(
    resolveMenuBarTimeZone('America/New_York', items, 'Asia/Shanghai', SUPPORTED),
    'America/New_York'
  );
  assert.equal(
    normalizeMenuBarTimeZone('America/New_York', items, 'Asia/Shanghai', SUPPORTED),
    'America/New_York'
  );
  // Same as local resolves to local and normalizes to null (follow system).
  assert.equal(
    normalizeMenuBarTimeZone('Asia/Shanghai', items, 'Asia/Shanghai', SUPPORTED),
    null
  );
});

test('resolveMenuBarTimeZone treats ICU aliases as equal', () => {
  const items = [{ id: 'Asia/Kolkata', label: '新德里' }];
  assert.equal(sameTimeZone('Asia/Kolkata', 'Asia/Calcutta'), true);
  assert.equal(
    resolveMenuBarTimeZone('Asia/Calcutta', items, 'Asia/Shanghai', SUPPORTED),
    'Asia/Calcutta'
  );
});

test('nextMenuBarTimeZoneAfterRemove clears selection when stored zone is deleted', () => {
  const after = [{ id: 'Asia/Shanghai', label: '北京' }];
  assert.equal(
    nextMenuBarTimeZoneAfterRemove('America/New_York', 'America/New_York', after, 'Asia/Shanghai'),
    null
  );
  // Stored zone missing from remaining list is also cleared.
  assert.equal(
    nextMenuBarTimeZoneAfterRemove('America/New_York', 'Asia/Tokyo', after, 'Asia/Shanghai'),
    null
  );
});

test('removing another clock does not clear a still-valid menu-bar selection', () => {
  const after = [
    { id: 'Asia/Shanghai', label: '北京' },
    { id: 'America/New_York', label: '纽约' }
  ];
  assert.equal(
    nextMenuBarTimeZoneAfterRemove('America/New_York', 'Asia/Shanghai', after, 'Asia/Tokyo'),
    'America/New_York'
  );
  assert.equal(
    nextMenuBarTimeZoneAfterRemove('America/New_York', 'Asia/Shanghai', after, 'America/New_York'),
    null
  );
});

test('formatMenuTitleInZone matches menu title format and handles date rollover across zones', () => {
  const instant = new Date('2026-11-16T04:30:00.000Z');
  const shanghai = formatMenuTitleInZone(instant, 'Asia/Shanghai', 'Asia/Shanghai');
  const newYork = formatMenuTitleInZone(instant, 'America/New_York', 'Asia/Shanghai');

  assert.equal(shanghai, '11月16日 12:30:00');
  assert.equal(newYork, '11月15日 23:30:00');
  assert.equal(isValidMenuTitle(shanghai), true);
  assert.equal(isValidMenuTitle(newYork), true);
  assert.equal(isValidMenuTitleInZone(shanghai), true);
  assert.equal(MENU_TITLE_PATTERN.test(shanghai), true);
});

test('formatMenuTitleInZone formats the same instant in UTC and a +8 zone', () => {
  const instant = new Date('2026-11-16T01:02:03.000Z');
  assert.equal(formatMenuTitleInZone(instant, 'UTC', 'Asia/Shanghai'), '11月16日 01:02:03');
  assert.equal(formatMenuTitleInZone(instant, 'Asia/Shanghai', 'Asia/Shanghai'), '11月16日 09:02:03');
});

test('formatMenuTitleInZone falls back to local zone for unset/invalid zone', () => {
  const instant = new Date('2026-01-05T01:03:07.000Z');
  assert.equal(formatMenuTitleInZone(instant, undefined, 'Asia/Shanghai'), '1月5日 09:03:07');
  assert.equal(formatMenuTitleInZone(instant, null, 'Asia/Shanghai'), '1月5日 09:03:07');
  assert.equal(formatMenuTitleInZone(instant, 'Mars/Olympus', 'Asia/Shanghai'), '1月5日 09:03:07');
});

test('formatMenuTitleInZone drops the date part when showDate is false', () => {
  const instant = new Date('2026-11-16T01:02:03.000Z');
  assert.equal(formatMenuTitleInZone(instant, 'UTC', 'Asia/Shanghai', { showDate: false }), '01:02:03');
  assert.equal(formatMenuTitleInZone(instant, 'Asia/Shanghai', 'Asia/Shanghai', { showDate: false }), '09:02:03');
  assert.equal(formatMenuTitleInZone(instant, 'UTC', 'Asia/Shanghai'), '11月16日 01:02:03');
  assert.equal(formatMenuTitleInZone(instant, 'Asia/Shanghai', 'Asia/Shanghai'), '11月16日 09:02:03');
});

test('menu title patterns accept date-less time and reject malformed forms', () => {
  for (const valid of ['11月16日 01:02:03', '01:02:03']) {
    assert.equal(MENU_TITLE_PATTERN.test(valid), true, valid);
    assert.equal(isValidMenuTitle(valid), true, valid);
    assert.equal(isValidMenuTitleInZone(valid), true, valid);
  }
  for (const invalid of ['1:02:03', '01月05日 09:03:07']) {
    assert.equal(MENU_TITLE_PATTERN.test(invalid), false, invalid);
    assert.equal(isValidMenuTitle(invalid), false, invalid);
    assert.equal(isValidMenuTitleInZone(invalid), false, invalid);
  }
});

test('formatTrayTooltipInZone renders year/month/day and Chinese weekday', () => {
  const instant = new Date('2026-11-18T23:30:00.000Z');
  assert.equal(formatTrayTooltipInZone(instant, 'America/New_York', 'Asia/Shanghai'), '2026年11月18日 周三');
  assert.equal(formatTrayTooltipInZone(instant, 'Asia/Shanghai', 'Asia/Shanghai'), '2026年11月19日 周四');
  assert.equal(formatTrayTooltipInZone(instant, undefined, 'Asia/Shanghai'), '2026年11月19日 周四');
  assert.equal(formatTrayTooltipInZone(new Date('nope'), 'UTC', 'Asia/Shanghai'), '');
  assert.equal(formatTrayTooltipInZone(undefined, 'UTC', 'Asia/Shanghai'), '');
});
