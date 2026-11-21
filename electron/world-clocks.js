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

const MENU_TITLE_PATTERN =
  /^(?:(?:[1-9]|1[0-2])月(?:[1-9]|[12]\d|3[01])日 )?(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

const DEFAULT_WORLD_CLOCK = Object.freeze({
  id: 'Asia/Shanghai',
  label: '北京'
});

const MAX_LABEL_LENGTH = 40;
const MAX_SEARCH_RESULTS = 40;

// Deliberately small and offline. Rows may share an IANA id (洛杉矶/旧金山):
// duplicates are rejected by id, while the label the user picked is stored
// as-is.
const CITY_CATALOG = Object.freeze([
  { id: 'Asia/Shanghai', label: '北京', aliases: ['上海', '中国'] },
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

// Format the current instant in a specific IANA zone. Local time is not part
// of this card, so the caller only supplies the clock's own zone.
function formatClock(now, timeZone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  if (!isValidTimeZone(timeZone)) return null;

  const zone = zonedParts(now, timeZone);

  return {
    time: `${pad2(zone.hour)}:${pad2(zone.minute)}:${pad2(zone.second)}`,
    date: `${zone.month}月${zone.day}日`,
    weekday: WEEKDAY_NAMES[zone.weekday] || ''
  };
}

// Compact wall-clock time for the right-hand clock list: HH:mm, no seconds.
function formatClockTime(now, timeZone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return '';
  if (!isValidTimeZone(timeZone)) return '';

  const zone = zonedParts(now, timeZone);
  return `${pad2(zone.hour)}:${pad2(zone.minute)}`;
}

function offsetMinutesAt(now, timeZone) {
  const zone = zonedParts(now, timeZone);
  const wallAsUtc = Date.UTC(
    zone.year,
    zone.month - 1,
    zone.day,
    zone.hour,
    zone.minute,
    zone.second
  );
  return Math.round((wallAsUtc - now.getTime()) / 60000);
}

function dayNumber(parts) {
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

// Human-readable offset against the host zone, e.g. 快 1 小时 / 慢 13 小时.
// Half-hour zones split into hours and minutes so 新德里 reads 快 5 小时 30 分.
// Returns an empty string when the two zones agree or the value is not finite.
function formatClockOffset(offsetMinutes) {
  if (!Number.isFinite(offsetMinutes) || offsetMinutes === 0) return '';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const word = offsetMinutes > 0 ? '快' : '慢';
  return m ? (h ? `${word} ${h} 小时 ${m} 分` : `${word} ${m} 分`) : `${word} ${h} 小时`;
}

// Relative label shown under each city: the 快/慢 offset against the local
// zone, or the city's own 月/日 when it is on a different calendar day. Same-zone cities only show 本地; a zero offset reads 时间相同.
// dayText/dayDelta still expose the calendar-day difference for callers.
function describeClockRelative(now, timeZone, localTimeZone) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  if (!isValidTimeZone(timeZone) || !isValidTimeZone(localTimeZone)) return null;

  const zone = zonedParts(now, timeZone);
  const local = zonedParts(now, localTimeZone);
  const dayDelta = dayNumber(zone) - dayNumber(local);
  const isLocal = timeZone.trim() === localTimeZone.trim();
  const dayText = dayDelta > 0 ? '明天' : dayDelta < 0 ? '昨天' : '';
  const offsetMinutes = offsetMinutesAt(now, timeZone) - offsetMinutesAt(now, localTimeZone);
  const offsetText = formatClockOffset(offsetMinutes);
  // 0.1.54: a city on a different calendar day shows its own date (月/日)
  // instead of the 快/慢 offset; same-day cities keep the offset text.
  const dateText = `${zone.month}/${zone.day}`;
  const text = isLocal ? '本地' : (dayDelta !== 0 ? dateText : (offsetText || '时间相同'));

  return {
    dayText,
    dayDelta,
    offsetMinutes,
    offsetText,
    dateText,
    isLocal,
    text
  };
}

// Menu bar title in a specific IANA zone. Same format as
// calendar.formatMenuTitle: month/day not zero-padded, HH:mm:ss zero-padded.
// `localTimeZone` is only used when `timeZone` is unset/invalid. Pass
// `{ showDate: false }` to drop the date part and keep only HH:mm:ss.
function formatMenuTitleInZone(date, timeZone, localTimeZone, options) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const localZone = isValidTimeZone(localTimeZone)
    ? localTimeZone.trim()
    : defaultLocalTimeZone();
  const zone = isValidTimeZone(timeZone) ? timeZone.trim() : localZone;
  if (!isValidTimeZone(zone)) return '';

  const parts = zonedParts(date, zone);
  const time = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  if (options && options.showDate === false) return time;
  return `${parts.month}月${parts.day}日 ` + time;
}

const TRAY_WEEKDAY_ZH = {
  Sun: '日',
  Mon: '一',
  Tue: '二',
  Wed: '三',
  Thu: '四',
  Fri: '五',
  Sat: '六'
};

// Tray tooltip in a specific IANA zone: `${year}年${month}月${day}日 周${X}`.
// Zone resolution matches formatMenuTitleInZone exactly. Illegal input → ''.
function formatTrayTooltipInZone(date, timeZone, localTimeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const localZone = isValidTimeZone(localTimeZone)
    ? localTimeZone.trim()
    : defaultLocalTimeZone();
  const zone = isValidTimeZone(timeZone) ? timeZone.trim() : localZone;
  if (!isValidTimeZone(zone)) return '';

  const parts = zonedParts(date, zone);
  const weekday = TRAY_WEEKDAY_ZH[parts.weekday];
  if (!weekday) return '';
  return `${parts.year}年${parts.month}月${parts.day}日 周${weekday}`;
}

function isValidMenuTitle(text) {
  return typeof text === 'string' && MENU_TITLE_PATTERN.test(text);
}

function canonicalTimeZone(id) {
  if (!isValidTimeZone(id)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: id.trim() }).resolvedOptions().timeZone;
  } catch {
    return id.trim();
  }
}

function sameTimeZone(a, b) {
  const ca = canonicalTimeZone(a);
  const cb = canonicalTimeZone(b);
  return ca !== null && cb !== null && ca === cb;
}

// Resolve the menu-bar display zone. Unset / null / invalid / unknown stored
// zone falls back to the injected local zone. The stored zone is only kept when
// it is a valid IANA id AND present in the clock list (by IANA id, aliases
// equal).
function resolveMenuBarTimeZone(storedZone, items, localTimeZone, supportedValuesOf) {
  void supportedValuesOf;
  const localZone = isValidTimeZone(localTimeZone)
    ? localTimeZone.trim()
    : defaultLocalTimeZone();
  if (!Array.isArray(items)) return localZone;

  const stored = typeof storedZone === 'string' ? storedZone.trim() : '';
  if (!stored || !isValidTimeZone(stored)) return localZone;

  const present = items.some((item) => item && sameTimeZone(item.id, stored));
  return present ? stored : localZone;
}

function normalizeMenuBarTimeZone(storedZone, items, localTimeZone, supportedValuesOf) {
  const resolved = resolveMenuBarTimeZone(storedZone, items, localTimeZone, supportedValuesOf);
  const localZone = isValidTimeZone(localTimeZone)
    ? localTimeZone.trim()
    : defaultLocalTimeZone();
  // Persist only an explicit non-local selection that is still present.
  if (sameTimeZone(resolved, localZone)) return null;
  return resolved;
}

// After removing a clock, return the next persisted menu-bar zone value:
// cleared (null) when the removed clock was the stored menu-bar zone or the
// stored zone is no longer present; otherwise unchanged.
function nextMenuBarTimeZoneAfterRemove(storedZone, removedId, itemsAfterRemove, localTimeZone) {
  const localZone = isValidTimeZone(localTimeZone)
    ? localTimeZone.trim()
    : defaultLocalTimeZone();
  const stored = typeof storedZone === 'string' ? storedZone.trim() : '';
  if (!stored || !isValidTimeZone(stored)) return null;
  if (removedId && sameTimeZone(stored, removedId)) return null;

  const present = Array.isArray(itemsAfterRemove) &&
    itemsAfterRemove.some((item) => item && sameTimeZone(item.id, stored));
  if (!present) return null;
  return sameTimeZone(stored, localZone) ? null : stored;
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
  MENU_TITLE_PATTERN,
  supportedTimeZoneList,
  defaultLocalTimeZone,
  isValidTimeZone,
  canonicalTimeZone,
  sameTimeZone,
  formatClock,
  formatClockTime,
  formatClockOffset,
  describeClockRelative,
  formatMenuTitleInZone,
  formatTrayTooltipInZone,
  isValidMenuTitle,
  resolveMenuBarTimeZone,
  normalizeMenuBarTimeZone,
  nextMenuBarTimeZoneAfterRemove,
  normalizeWorldClocks,
  addClock,
  removeClock,
  searchCatalog
};
