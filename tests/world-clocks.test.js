'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_WORLD_CLOCK,
  CITY_CATALOG,
  MENU_TITLE_PATTERN,
  isValidTimeZone,
  sameTimeZone,
  formatOffsetText,
  formatClock,
  formatMenuTitleInZone,
  isValidMenuTitle: isValidMenuTitleInZone,
  resolveMenuBarTimeZone,
  normalizeMenuBarTimeZone,
  nextMenuBarTimeZoneAfterRemove,
  normalizeWorldClocks,
  addClock,
  removeClock,
  nextClock,
  prevClock,
  selectClock,
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
    'Asia/Shanghai',
    'Asia/Shanghai'
  );

  assert.ok(clock);
  assert.equal(clock.time, '09:02:03');
  assert.equal(clock.date, '11月16日');
  assert.equal(clock.weekday, '星期一');
  assert.equal(clock.dayRelation, '');
  assert.equal(clock.offsetMinutes, 0);
  assert.equal(clock.offsetText, '同本地');
});

test('New York offset follows DST at the given instant, not the standard offset', () => {
  const winter = formatClock(
    instant('2026-01-15T12:00:00Z'),
    'America/New_York',
    'Asia/Shanghai'
  );
  const summer = formatClock(
    instant('2026-07-15T12:00:00Z'),
    'America/New_York',
    'Asia/Shanghai'
  );

  assert.equal(winter.time, '07:00:00');
  assert.equal(winter.offsetMinutes, -780);
  assert.equal(winter.offsetText, '比本地慢 13 小时');

  assert.equal(summer.time, '08:00:00');
  assert.equal(summer.offsetMinutes, -720);
  assert.equal(summer.offsetText, '比本地慢 12 小时');
});

test('half-hour zones render hours and minutes', () => {
  const india = formatClock(
    instant('2026-11-16T01:02:03Z'),
    'Asia/Kolkata',
    'Asia/Shanghai'
  );

  assert.equal(india.time, '06:32:03');
  assert.equal(india.offsetMinutes, -150);
  assert.equal(india.offsetText, '比本地慢 2 小时 30 分');
});

test('UTC is eight hours behind a +8 local zone', () => {
  const utc = formatClock(instant('2026-11-16T01:02:03Z'), 'UTC', 'Asia/Shanghai');
  const etcUtc = formatClock(
    instant('2026-11-16T01:02:03Z'),
    'Etc/UTC',
    'Asia/Shanghai'
  );

  assert.equal(utc.time, '01:02:03');
  assert.equal(utc.offsetMinutes, -480);
  assert.equal(utc.offsetText, '比本地慢 8 小时');
  assert.equal(etcUtc.offsetText, utc.offsetText);
});

test('day relation is relative to the local calendar date', () => {
  const yesterday = formatClock(
    instant('2026-11-15T17:30:00Z'),
    'America/New_York',
    'Asia/Shanghai'
  );
  const tomorrow = formatClock(
    instant('2026-11-15T15:30:00Z'),
    'Pacific/Auckland',
    'Asia/Shanghai'
  );

  assert.equal(yesterday.date, '11月15日');
  assert.equal(yesterday.dayRelation, '昨天');
  assert.equal(tomorrow.date, '11月16日');
  assert.equal(tomorrow.dayRelation, '明天');
});

test('offset text uses Chinese units and never shows 快 0 小时', () => {
  assert.equal(formatOffsetText(0), '同本地');
  assert.equal(formatOffsetText(780), '比本地快 13 小时');
  assert.equal(formatOffsetText(-300), '比本地慢 5 小时');
  assert.equal(formatOffsetText(330), '比本地快 5 小时 30 分');
  assert.equal(formatOffsetText(45), '比本地快 45 分');
  assert.equal(formatOffsetText(-45), '比本地慢 45 分');
});

test('formatClock rejects invalid instants and zones', () => {
  assert.equal(formatClock(new Date('nope'), 'Asia/Shanghai', 'Asia/Shanghai'), null);
  assert.equal(
    formatClock(instant('2026-11-16T01:02:03Z'), 'Mars/Olympus', 'Asia/Shanghai'),
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

test('nextClock / prevClock wrap and do nothing with fewer than two clocks', () => {
  const two = {
    items: [
      { id: 'Asia/Shanghai', label: '北京' },
      { id: 'Asia/Tokyo', label: '东京' }
    ],
    index: 1
  };

  assert.equal(nextClock(two).index, 0);
  assert.equal(prevClock(two).index, 0);
  assert.equal(prevClock(nextClock(two)).index, 1);

  const one = { items: [{ id: 'Asia/Shanghai', label: '北京' }], index: 0 };
  assert.equal(nextClock(one), one);
  assert.equal(prevClock(one), one);
  assert.equal(selectClock(one, { direction: 'next' }), one);
});

test('selectClock accepts an index or a direction and clamps indexes', () => {
  const three = {
    items: [
      { id: 'Asia/Shanghai', label: '北京' },
      { id: 'Asia/Tokyo', label: '东京' },
      { id: 'Europe/London', label: '伦敦' }
    ],
    index: 0
  };

  assert.equal(selectClock(three, { index: 2 }).index, 2);
  assert.equal(selectClock(three, { index: 99 }).index, 2);
  assert.equal(selectClock(three, { index: -1 }).index, 0);
  assert.equal(selectClock(three, { direction: 'next' }).index, 1);
  assert.equal(selectClock(three, { direction: 'prev' }).index, 2);
});

test('searchCatalog finds Chinese labels and aliases first', () => {
  const shanghai = searchCatalog('上海', { supportedValuesOf: SUPPORTED });
  assert.ok(shanghai.some((row) => row.label === '上海'));
  assert.ok(shanghai.every((row) => row.source === 'catalog'));

  const korea = searchCatalog('韩国', { supportedValuesOf: SUPPORTED });
  assert.deepEqual(korea.map((row) => row.label), ['首尔']);

  const all = searchCatalog('', {
    catalog: CITY_CATALOG,
    supportedValuesOf: SUPPORTED
  });
  assert.ok(all.length >= 24);
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

test('searchCatalog shows shared-zone rows but marks both as added', () => {
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
