'use strict';

// Pure world-clock logic for the right-hand orange pane. This module has no
// Electron dependency and never touches the filesystem or network, so it can
// be required directly by `node --test`. Every external fact (supported IANA
// zones, the current instant, the local zone) is passed in by the caller.

const WEEKDAY_NAMES = {
  Sun: '星期日',
  Mon: '星期一',
  Tue: '星期二',
  Wed: '星期三',
  Thu: '星期四',
  Fri: '星期五',
  Sat: '星期六'
};

const DEFAULT_WORLD_CLOCK = Object.freeze({
  id: 'Asia/Shanghai',
  label: '北京'
});

const MAX_LABEL_LENGTH = 40;
const MAX_SEARCH_RESULTS = 40;

// Deliberately small and offline. Rows may share an IANA id (北京/上海,
// 洛杉矶/旧金山): duplicates are rejected by id, while the label the user
// picked is stored as-is.
const CITY_CATALOG = Object.freeze([
  { id: 'Asia/Shanghai', label: '北京', aliases: ['上海', '中国'] },
  { id: 'Asia/Shanghai', label: '上海', aliases: [] },
  { id: 'Asia/Tokyo', label: '东京', aliases: [] },
  { id: 'Asia/Seoul', label: '首尔', aliases: ['韩国'] },
  { id: 'Asia/Singapore', label: '新加坡', aliases: [] },
  { id: 'Asia/Hong_Kong', label: '香港', aliases: [] },
  { id: 'Asia/Taipei', label: '台北', aliases: [] },
  { id: 'Asia/Bangkok', label: '曼谷', aliases: [] },
  { id: 'Asia/Kolkata', label: '新德里', aliases: ['德里', '印度'] },
  { id: 'Asia/Dubai', label: '迪拜', aliases: [] },
  { id: 'Europe/Moscow', label: '莫斯科', aliases: [] },
  { id: 'Europe/London', label: '伦敦', aliases: [] },
  { id: 'Europe/Paris', label: '巴黎', aliases: [] },
  { id: 'Europe/Berlin', label: '柏林', aliases: [] },
  { id: 'America/New_York', label: '纽约', aliases: [] },
  { id: 'America/Los_Angeles', label: '洛杉矶', aliases: [] },
  { id: 'America/Los_Angeles', label: '旧金山', aliases: ['三藩市'] },
  { id: 'America/Chicago', label: '芝加哥', aliases: [] },
  { id: 'America/Vancouver', label: '温哥华', aliases: [] },
  { id: 'America/Toronto', label: '多伦多', aliases: [] },
  { id: 'Australia/Sydney', label: '悉尼', aliases: [] },
  { id: 'Pacific/Auckland', label: '奥克兰', aliases: [] },
  { id: 'America/Sao_Paulo', label: '圣保罗', aliases: [] },
  { id: 'UTC', label: 'UTC', aliases: ['协调世界时'] }
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function defaultSupportedValuesOf() {
  return supportedTimeZoneList();
}

function supportedTimeZoneList() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    // Older ICU builds may not expose supportedValuesOf.
  }
  return [];
}

function defaultLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function asSupportedList(supportedValuesOf) {
  if (typeof supportedValuesOf === 'function') {
    try {
      const value = supportedValuesOf('timeZone');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(supportedValuesOf) ? supportedValuesOf : [];
}

// Intl.DateTimeFormat is the ground truth, not supportedValuesOf: the list
// canonicalises aliases (Asia/Kolkata appears as Asia/Calcutta on some ICU
// builds) and omits UTC. The optional list is accepted for call-site symmetry
// but never lets an unknown id through.
function isValidTimeZone(id, supportedValuesOf) {
  void supportedValuesOf;
  if (typeof id !== 'string') return false;
  const zone = id.trim();
  if (!zone || zone.length > 80) return false;

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn'
    });
    return true;
  } catch {
    return false;
  }
}

function sanitizeLabel(label, fallbackId) {
  if (typeof label === 'string') {
    const trimmed = label.trim().slice(0, MAX_LABEL_LENGTH);
    if (trimmed) return trimmed;
  }
  return fallbackId;
}

function getFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  });
}

function zonedParts(date, timeZone) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: values.weekday
  };
}

// Offset of `timeZone` at this instant, in minutes east of UTC. Comparing the
// zone's wall clock (treated as UTC) with the real instant makes this DST
// correct; it is never based on a standard offset.
function zoneOffsetMinutes(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const instant = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - instant) / 60000);
}

function formatOffsetText(offsetMinutes) {
  if (offsetMinutes === 0) return '同本地';

  const ahead = offsetMinutes > 0;
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  let amount;
  if (minutes === 0) {
    amount = `${hours} 小时`;
  } else if (hours === 0) {
    amount = `${minutes} 分`;
  } else {
    amount = `${hours} 小时 ${minutes} 分`;
  }
  return `比本地${ahead ? '快' : '慢'} ${amount}`;
}

function dayRelationFor(zoneParts, localParts) {
  const zoneDay = Date.UTC(zoneParts.year, zoneParts.month - 1, zoneParts.day);
  const localDay = Date.UTC(localParts.year, localParts.month - 1, localParts.day);
  const difference = Math.round((zoneDay - localDay) / 86400000);
  if (difference > 0) return '明天';
  if (difference < 0) return '昨天';
  return '';
}

function formatClock(now, timeZone, localTimeZone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  if (!isValidTimeZone(timeZone)) return null;

  const localZone = isValidTimeZone(localTimeZone)
    ? localTimeZone.trim()
    : defaultLocalTimeZone();
  if (!isValidTimeZone(localZone)) return null;

  const zone = zonedParts(now, timeZone);
  const local = zonedParts(now, localZone);
  const offsetMinutes =
    zoneOffsetMinutes(now, timeZone) - zoneOffsetMinutes(now, localZone);

  return {
    time: `${pad2(zone.hour)}:${pad2(zone.minute)}:${pad2(zone.second)}`,
    date: `${zone.month}月${zone.day}日`,
    weekday: WEEKDAY_NAMES[zone.weekday] || '',
    dayRelation: dayRelationFor(zone, local),
    offsetText: formatOffsetText(offsetMinutes),
    offsetMinutes
  };
}

function cloneClock(clock) {
  return { id: clock.id, label: clock.label };
}

function normalizeWorldClocks(stored, supportedValuesOf) {
  // Missing key = first run (or an older install): seed 北京. An explicit
  // `items: []` is a user choice and stays empty.
  if (stored === undefined) {
    return { items: [cloneClock(DEFAULT_WORLD_CLOCK)], index: 0 };
  }

  const items = [];
  const seen = new Set();

  if (stored && typeof stored === 'object' && Array.isArray(stored.items)) {
    for (const raw of stored.items) {
      if (!raw || typeof raw !== 'object') continue;
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!isValidTimeZone(id, supportedValuesOf) || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, label: sanitizeLabel(raw.label, id) });
    }
  }

  let index = stored && typeof stored === 'object' &&
    Number.isInteger(stored.index)
    ? stored.index
    : 0;

  if (items.length === 0) {
    index = 0;
  } else if (index < 0) {
    index = 0;
  } else if (index >= items.length) {
    index = items.length - 1;
  }

  return { items, index };
}

function addClock(state, clock, supportedValuesOf) {
  if (!state || !Array.isArray(state.items)) return state;
  if (!clock || typeof clock !== 'object') return state;

  const id = typeof clock.id === 'string' ? clock.id.trim() : '';
  if (!isValidTimeZone(id, supportedValuesOf)) return state;
  if (state.items.some((item) => item.id === id)) return state;

  const items = state.items.map(cloneClock);
  items.push({ id, label: sanitizeLabel(clock.label, id) });
  // The newly added zone becomes the visible one.
  return { items, index: items.length - 1 };
}

function removeClock(state, target) {
  if (!state || !Array.isArray(state.items) || state.items.length === 0) {
    return state;
  }

  let removeIndex = state.index;
  if (typeof target === 'string') {
    removeIndex = state.items.findIndex((item) => item.id === target);
  } else if (target && typeof target === 'object') {
    if (typeof target.id === 'string') {
      removeIndex = state.items.findIndex((item) => item.id === target.id);
    } else if (Number.isInteger(target.index)) {
      removeIndex = target.index;
    }
  }

  if (!Number.isInteger(removeIndex) ||
      removeIndex < 0 || removeIndex >= state.items.length) {
    return state;
  }

  const items = state.items.filter((_item, position) => position !== removeIndex);
  const oldIndex = Number.isInteger(state.index) ? state.index : 0;

  let index;
  if (items.length === 0) {
    index = 0;
  } else if (removeIndex < oldIndex) {
    index = oldIndex - 1;
  } else if (removeIndex === oldIndex) {
    index = Math.min(oldIndex, items.length - 1);
  } else {
    index = oldIndex;
  }
  index = Math.max(0, Math.min(index, items.length - 1));

  return { items, index };
}

function nextClock(state) {
  if (!state || !Array.isArray(state.items) || state.items.length < 2) return state;
  const index = (state.index + 1) % state.items.length;
  return { items: state.items.map(cloneClock), index };
}

function prevClock(state) {
  if (!state || !Array.isArray(state.items) || state.items.length < 2) return state;
  const index = (state.index - 1 + state.items.length) % state.items.length;
  return { items: state.items.map(cloneClock), index };
}

function selectClock(state, payload) {
  if (!state || !Array.isArray(state.items) || state.items.length === 0) {
    return state;
  }
  if (payload && payload.direction === 'next') return nextClock(state);
  if (payload && payload.direction === 'prev') return prevClock(state);
  if (payload && Number.isInteger(payload.index)) {
    const index = Math.max(0, Math.min(payload.index, state.items.length - 1));
    if (index === state.index) return state;
    return { items: state.items.map(cloneClock), index };
  }
  return state;
}

function searchCatalog(query, options) {
  const settings = options && typeof options === 'object' ? options : {};
  const catalog = Array.isArray(settings.catalog) ? settings.catalog : CITY_CATALOG;
  const supportedValuesOf = settings.supportedValuesOf || defaultSupportedValuesOf;
  const addedIds = settings.addedIds instanceof Set
    ? settings.addedIds
    : new Set(Array.isArray(settings.addedIds) ? settings.addedIds : []);
  const raw = typeof query === 'string'
    ? query.trim().toLowerCase().replace(/_/g, ' ')
    : '';

  const matches = [];
  for (const entry of catalog) {
    const terms = [entry.label, entry.id]
      .concat(Array.isArray(entry.aliases) ? entry.aliases : [])
      .map((value) => String(value).toLowerCase().replace(/_/g, ' '));
    if (raw === '' || terms.some((value) => value.includes(raw))) {
      matches.push({
        id: entry.id,
        label: entry.label,
        source: 'catalog',
        added: addedIds.has(entry.id)
      });
    }
  }

  if (matches.length > 0 || raw === '') return matches.slice(0, MAX_SEARCH_RESULTS);

  // Catalog had no match: fall back to the host's IANA dataset by id or by
  // the last path segment (underscores treated as spaces for typing).
  for (const zone of asSupportedList(supportedValuesOf)) {
    const lower = zone.toLowerCase().replace(/_/g, ' ');
    const lastSegment = zone.split('/').pop().toLowerCase().replace(/_/g, ' ');
    if (lower.includes(raw) || lastSegment.includes(raw)) {
      matches.push({
        id: zone,
        label: zone,
        source: 'iana',
        added: addedIds.has(zone)
      });
      if (matches.length >= MAX_SEARCH_RESULTS) break;
    }
  }

  return matches;
}

module.exports = {
  WEEKDAY_NAMES,
  DEFAULT_WORLD_CLOCK,
  CITY_CATALOG,
  MAX_LABEL_LENGTH,
  MAX_SEARCH_RESULTS,
  supportedTimeZoneList,
  defaultLocalTimeZone,
  isValidTimeZone,
  formatOffsetText,
  formatClock,
  normalizeWorldClocks,
  addClock,
  removeClock,
  nextClock,
  prevClock,
  selectClock,
  searchCatalog
};
