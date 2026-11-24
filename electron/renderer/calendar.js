'use strict';

const api = window.lanli;

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const monthTitle = document.getElementById('month-title');
const yearSelect = document.getElementById('year-select');
const lunarSubtitle = document.getElementById('lunar-subtitle');
const prevMonth = document.getElementById('prev-month');
const nextMonth = document.getElementById('next-month');
const todayButton = document.getElementById('today-button');
const settingsButton = document.getElementById('settings-button');
const pinButton = document.getElementById('pin-button');
const iconTooltip = document.getElementById('icon-tooltip');
const pinIconPin = pinButton.querySelector('.pin-icon-pin');
const pinIconClose = pinButton.querySelector('.pin-icon-close');
const grid = document.getElementById('grid');
const almanacCard = document.getElementById('almanac-card');
const almanacStyleName = document.getElementById('almanac-style-name');
const almanacCustomize = document.getElementById('almanac-customize');
const almanacFocusYi = document.getElementById('almanac-focus-yi');
const almanacFocusJi = document.getElementById('almanac-focus-ji');
const almanacQuote = document.getElementById('almanac-quote');
const almanacRedraw = document.getElementById('almanac-redraw');
let drawnQuote = null;
let drawnFor = '';
const clockList = document.getElementById('clock-list');
const clockEmpty = document.getElementById('clock-empty');
const clockEdit = document.getElementById('clock-edit');
const clockPicker = document.getElementById('clock-picker');
const clockSearch = document.getElementById('clock-search');
const clockSearchResults = document.getElementById('clock-search-results');
const clockPickerClose = document.getElementById('clock-picker-close');
const clockAddedList = document.getElementById('clock-added-list');
const weatherCard = document.getElementById('weather-card');
const weatherEmoji = document.getElementById('weather-emoji');
const weatherTemp = document.getElementById('weather-temp');
const weatherRange = document.getElementById('weather-range');
const weatherCity = document.getElementById('weather-city');
const appVersion = document.getElementById('app-version');
const checkUpdate = document.getElementById('check-update');
const weatherPicker = document.getElementById('weather-picker');
const weatherSearch = document.getElementById('weather-search');
const weatherPickerClose = document.getElementById('weather-picker-close');
const weatherList = document.getElementById('weather-list');
const almanacPicker = document.getElementById('almanac-picker');
const almanacPickerClose = document.getElementById('almanac-picker-close');
const almanacStyleList = document.getElementById('almanac-style-list');

const appBody = document.querySelector('.app-body');
const settingsView = document.getElementById('settings-view');
const settingsBack = document.getElementById('settings-back');
const settingsTabs = document.querySelectorAll('.settings-tab');
const settingsPageUi = document.getElementById('settings-page-ui');
const settingsPageUpdate = document.getElementById('settings-page-update');
const settingsPageTags = document.getElementById('settings-page-tags');
const settingOpenAtLogin = document.getElementById('setting-open-at-login');
const settingShowDate = document.getElementById('setting-show-date');
const settingCaptureHint = document.getElementById('setting-capture-hint');
const settingsVersion = document.getElementById('settings-version');
const settingsPageTitle = document.getElementById('settings-page-title');
const weatherRetry = document.getElementById('weather-retry');
const settingsCheckUpdate = document.getElementById('settings-check-update');

let settingsTab = null;

let state = null;
let lastAlmanac = null;
let yearOptionsBuilt = false;
let clocks = null;
let searchToken = 0;
let searchTimer = null;
let weatherToken = 0;
let weatherSearchToken = 0;
let weatherSearchTimer = null;
let weatherQuickCities = null;
let weatherQuickToken = 0;
let almanacStylesToken = 0;
let pendingNotice = null;
let pinned = false;
let iconTooltipTimer = null;
// 指针是否已在窗口内：格子重建时 Chromium 会重复派发 mouseenter，只在真正进入时重取状态。
let pointerInside = false;
// 0.1.30：黄历跟随选中日期。selectedKey 为 null 表示跟随今天。
let selectedKey = null;
let selectedAlmanac = null;
let todayAlmanac = null;
let lastOpenSeq = null;
let selectToken = 0;

function cellKey(cell) {
  return `${cell.year}-${String(cell.month).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
}

function clearSelection() {
  selectedKey = null;
  selectedAlmanac = null;
  selectToken += 1;
}

function isTodayAlmanac(almanac) {
  return !todayAlmanac || !almanac.dateKey || almanac.dateKey === todayAlmanac.dateKey;
}

// 卡片与详情显示选中那天；没有选中（或选中的那天已成为今天）时显示今天。
function showAlmanac() {
  if (selectedKey && todayAlmanac && selectedKey === todayAlmanac.dateKey) clearSelection();
  renderAlmanac(selectedKey && selectedAlmanac ? selectedAlmanac : todayAlmanac);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function buildYearOptions() {
  if (yearOptionsBuilt) return;
  for (let year = MIN_YEAR; year <= MAX_YEAR; year += 1) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.append(option);
  }
  yearOptionsBuilt = true;
}

function renderAlmanac(almanac) {
  if (!almanac) return;
  lastAlmanac = almanac;
  almanacStyleName.textContent = isTodayAlmanac(almanac)
    ? almanac.styleName
    : `${almanac.styleName.replace('黄历', '')} · ${almanac.lunarDayText}`;
  almanacCard.classList.toggle('is-dated', !isTodayAlmanac(almanac));
  almanacStyleName.title = `公历${almanac.solarText}`;

  // CSSOM custom properties are the only per-style colours; inline style
  // attributes stay forbidden by the CSP.
  if (almanac.styleId === 'lunar') {
    almanacCard.style.removeProperty('--almanac-accent-light');
    almanacCard.style.removeProperty('--almanac-accent-dark');
  } else {
    almanacCard.style.setProperty('--almanac-accent-light', almanac.accentLight);
    almanacCard.style.setProperty('--almanac-accent-dark', almanac.accentDark);
  }

  almanacFocusYi.textContent = almanac.focusYi.text;
  almanacFocusYi.title = almanac.focusYi.title;
  almanacFocusJi.textContent = almanac.focusJi.text;
  almanacFocusJi.title = almanac.focusJi.title;
  const drawKey = `${almanac.dateKey}|${almanac.styleId}`;
  if (drawKey !== drawnFor) {
    drawnQuote = null;
    drawnFor = drawKey;
  }
  renderQuote(almanacQuote, drawnQuote || almanac.quote);
}

// 0.1.35：签语有空格就在空格处断成两行（两段各自不换行）；没有空格交给
// CSS text-wrap: balance。textContent 仍等于原签语。
function renderQuote(el, text) {
  const t = String(text || '');
  const i = t.indexOf(' ');
  if (i > 0 && i < t.length - 1) {
    const line = (value) => {
      const span = document.createElement('span');
      span.className = 'q-line';
      span.textContent = value;
      return span;
    };
    el.replaceChildren(line(t.slice(0, i)), document.createTextNode(' '), line(t.slice(i + 1)));
    return;
  }
  el.textContent = t;
}

function renderClockList(snapshot) {
  if (!snapshot) return;
  clocks = snapshot;

  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  clockEmpty.hidden = items.length > 0;
  clockList.replaceChildren();

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'clock-entry';

    const main = document.createElement('div');
    main.className = 'clock-entry-main';

    const name = document.createElement('div');
    name.className = 'clock-entry-name';

    const label = document.createElement('span');
    label.className = 'clock-entry-label';
    label.textContent = item.label;
    label.title = `${item.label}（${item.id}）`;
    name.append(label);

    if (item.isMenuBar) {
      const tag = document.createElement('span');
      tag.className = 'menu-bar-tag';
      tag.textContent = '菜单栏';
      name.append(tag);
    }

    const sub = document.createElement('span');
    sub.className = 'clock-entry-sub' + (item.isLocal ? ' is-current-zone' : '');
    sub.textContent = item.relativeText || '';

    const time = document.createElement('span');
    time.className = 'clock-entry-time';
    time.textContent = item.time || '--:--';

    main.append(name, sub);
    row.append(main, time);
    clockList.append(row);
  }
}

function renderClockEditor(snapshot) {
  const source = snapshot || clocks;
  const items = source && Array.isArray(source.items) ? source.items : [];
  clockAddedList.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = '还没有添加城市';
    clockAddedList.append(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'clock-edit-row';

    const main = document.createElement('div');
    main.className = 'clock-edit-main';

    const name = document.createElement('span');
    name.className = 'clock-edit-name';
    name.textContent = item.label;
    main.append(name);

    if (item.isMenuBar) {
      const tag = document.createElement('span');
      tag.className = 'menu-bar-tag';
      tag.textContent = '菜单栏';
      main.append(tag);
    }

    const actions = document.createElement('div');
    actions.className = 'clock-edit-actions';

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'clock-edit-action';
    pin.textContent = '设为菜单栏';
    pin.disabled = Boolean(item.isMenuBar);
    pin.addEventListener('click', () => {
      if (pin.disabled) return;
      api.setMenuBarClock({ id: item.id }).then(handleClockSnapshot).catch(() => {
        refreshState();
      });
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'clock-edit-action';
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      api.removeClock({ id: item.id }).then(handleClockSnapshot).catch(() => {
        refreshState();
      });
    });

    actions.append(pin, remove);
    row.append(main, actions);
    clockAddedList.append(row);
  }
}

function handleClockSnapshot(snapshot) {
  renderClockList(snapshot);
  if (!clockPicker.hidden) {
    renderClockEditor(snapshot);
    runClockSearchNow();
  }
}

function clearSearchTimer() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
}

function renderSearchResults(rows) {
  clockSearchResults.replaceChildren();

  const available = Array.isArray(rows)
    ? rows.filter((row) => row && !row.added)
    : [];

  if (available.length === 0) {
    if (clockSearch.value.trim() === '') return;
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = '没有匹配的时区';
    clockSearchResults.append(empty);
    return;
  }

  for (const row of available) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-item';
    button.setAttribute('role', 'option');

    const name = document.createElement('span');
    name.className = 'picker-name';
    name.textContent = row.label;

    const meta = document.createElement('span');
    meta.className = 'picker-zone';
    meta.textContent = row.id;

    button.append(name, meta);
    button.addEventListener('click', () => {
      api.addClock({ id: row.id, label: row.label }).then(handleClockSnapshot).catch(() => {
        refreshState();
      });
    });
    clockSearchResults.append(button);
  }
  fitEmbeddedClockResults();
}

// N3：设置页里结果列表占满剩余高度，但高度取整到整行，最后一行不被切掉一半。
function fitEmbeddedClockResults() {
  const el = clockSearchResults;
  el.style.removeProperty('height');
  el.style.removeProperty('flex');
  if (!clockPicker.classList.contains('is-embedded') || clockPicker.hidden) return;
  const first = el.querySelector('.picker-item');
  if (!first) return;
  const row = first.getBoundingClientRect().height;
  const cs = getComputedStyle(el);
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const avail = el.clientHeight - pad;
  if (!(row > 0) || !(avail > row)) return;
  el.style.flex = '0 0 auto';
  el.style.height = `${Math.floor(avail / row) * row + pad}px`;
}

function runClockSearchNow() {
  if (clockPicker.hidden) return;
  const token = searchToken + 1;
  searchToken = token;
  api.searchClocks({ query: clockSearch.value }).then((rows) => {
    if (token === searchToken) renderSearchResults(rows);
  }).catch(() => {
    if (token === searchToken) renderSearchResults([]);
  });
}

function runClockSearch() {
  clearSearchTimer();
  searchTimer = setTimeout(() => {
    searchTimer = null;
    runClockSearchNow();
  }, 60);
}

function openClockEditor() {
  closeWeatherPicker();
  closeAlmanacPicker();
  clearSettingsHighlight();
  clockPicker.hidden = false;
  clockSearch.value = '';
  clockSearchResults.replaceChildren();
  renderClockEditor(clocks);
  runClockSearchNow();
  clockSearch.focus();
}

function closeClockEditor() {
  clockPicker.hidden = true;
  clearSearchTimer();
  searchToken += 1;
  clockSearchResults.replaceChildren();
  clockAddedList.replaceChildren();
}

// 0.1.26：顶栏副标题不再来自「今天」的黄历，而是跟随所显示的月份。
// 主进程按「本月取今天、其他月取 1 号」算好 viewSubtitle 下发，渲染层只写入。
function renderViewSubtitle(subtitle) {
  if (typeof subtitle !== 'string' || subtitle === '') return;
  lunarSubtitle.textContent = subtitle;
}

function renderCells(next) {
  grid.replaceChildren();

  for (const cell of next.cells) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cell';
    button.setAttribute('role', 'gridcell');
    button.setAttribute(
      'aria-label',
      `${cell.year}年${cell.month}月${cell.day}日 ${cell.secondaryText}`
    );

    if (!cell.inMonth) button.classList.add('is-outside');
    if (cell.inMonth) button.classList.add('in-month');
    if (cell.isWeekend) button.classList.add('is-weekend');
    if (cell.isFestival || cell.isJieQi) button.classList.add('is-festive');
    if (cell.isToday) button.classList.add('is-today');
    if (selectedKey && selectedKey === cellKey(cell) && !cell.isToday) {
      button.classList.add('is-selected');
    }

    const dayText = document.createElement('span');
    dayText.className = 'cell-day';
    dayText.textContent = String(cell.day);

    const secondaryText = document.createElement('span');
    secondaryText.className = 'cell-secondary';
    secondaryText.textContent = cell.secondaryText;

    button.append(dayText, secondaryText);
    // 0.1.44：有收纳的日期在数字下方画灰色 4px 圆点
    button.dataset.day = `${cell.year}-${cell.month}-${cell.day}`;
    if (typeof inboxDaySet !== 'undefined' && inboxDaySet.has(button.dataset.day)) {
      button.classList.add('has-inbox');
      const dot = document.createElement('span');
      dot.className = 'cell-inbox-dot';
      button.appendChild(dot);
    }
    button.dataset.selected = isCellSelected(cell) ? '1' : '';
    decorateInboxCell(button);
    watchIconTooltip(button);
    // 0.1.55：有圆点且已选中（未选其它日期时今天算已选中）→ 再点打开收纳并按这天筛选
    button.addEventListener('click', () => {
      if (button.classList.contains('has-inbox') && isCellSelected(cell)) {
        hideIconTooltip();
        openInboxForDay(button.dataset.day);
        return;
      }
      selectCell(cell);
    });

    grid.append(button);
  }
}

function applyState(next) {
  if (!next || !Array.isArray(next.cells)) return;
  state = next;
  if (next.openSeq !== lastOpenSeq) {
    clearSelection();
    lastOpenSeq = next.openSeq;
  }
  if (next.almanac) todayAlmanac = next.almanac;

  buildYearOptions();
  yearSelect.value = String(next.view.year);
  monthTitle.textContent = `${next.view.year}年${next.view.month}月`;
  renderViewSubtitle(next.viewSubtitle);

  renderCells(next);
  showAlmanac();
  renderClockList(next.clocks);
  renderPin(next.pinned);
  if (!clockPicker.hidden) renderClockEditor(next.clocks);
}

function refreshState() {
  return api.getState().then(applyState);
}

function requestView(payload) {
  return api.setView(payload).then(applyState);
}

// 0.1.30：点格子选中那天，灰色格同时翻到那个月；点今天的格子等于回到今天。
function isCellSelected(cell) {
  return selectedKey ? selectedKey === cellKey(cell) : Boolean(cell.isToday);
}

// 0.1.55：有圆点的日期悬停气泡「收纳 N 项」（0.1.56 条→项），已选中加「 · 点击查看」并显示手型。
function decorateInboxCell(button) {
  const has = button.classList.contains('has-inbox');
  const n = (typeof inboxDayCounts !== 'undefined' && inboxDayCounts[button.dataset.day]) || 0;
  const selected = button.dataset.selected === '1';
  if (has && n > 0) {
    button.dataset.tooltip = selected ? `收纳 ${n} 项 · 点击查看` : `收纳 ${n} 项`;
    button.dataset.tooltipPlace = 'above';
  } else {
    delete button.dataset.tooltip;
  }
  button.classList.toggle('inbox-openable', has && selected);
}

function selectCell(cell) {
  if (cell.isToday) {
    clearSelection();
  } else {
    selectedKey = cellKey(cell);
    selectedAlmanac = null;
    selectToken += 1;
  }
  const token = selectToken;
  const key = selectedKey;
  return Promise.all([
    api.setView({ year: cell.year, month: cell.month, focusY: cell.year, focusM: cell.month, focusD: cell.day }),
    key ? api.getAlmanacForDate(key) : Promise.resolve(null)
  ]).then(([next, almanac]) => {
    if (token !== selectToken) return;
    if (key && !almanac) clearSelection();
    else selectedAlmanac = almanac;
    applyState(next);
  });
}

function shiftMonth(delta) {
  if (!state) return;

  let year = state.view.year;
  let month = state.view.month + delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }

  if (year < MIN_YEAR || year > MAX_YEAR) return;

  const day = Math.min(state.focus.day, daysInMonth(year, month));
  requestView({ year, month, focusY: year, focusM: month, focusD: day });
}

prevMonth.addEventListener('click', () => {
  shiftMonth(-1);
});

nextMonth.addEventListener('click', () => {
  shiftMonth(1);
});

todayButton.addEventListener('click', () => {
  clearSelection();
  api.goToday().then(applyState);
});

yearSelect.addEventListener('change', () => {
  if (!state) return;
  const year = Number(yearSelect.value);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return;

  const month = state.view.month;
  const day = Math.min(state.focus.day, daysInMonth(year, month));
  requestView({ year, month, focusY: year, focusM: month, focusD: day });
});

function clearSettingsHighlight() {
  settingsButton.classList.remove('is-open');
  settingsButton.setAttribute('aria-expanded', 'false');
}

const ICON_TOOLTIP_UNPINNED = '钉住窗口，移开鼠标也不隐藏';
const ICON_TOOLTIP_PINNED = '取消钉住并关闭';
const ICON_TOOLTIP_CHECK = '检查更新';

function renderPin(nextPinned) {
  pinned = Boolean(nextPinned);
  pinButton.setAttribute('aria-label', pinned ? ICON_TOOLTIP_PINNED : '钉住窗口');
  pinButton.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  // SVG elements do not implement the HTML `hidden` IDL attribute, so the
  // graphic swap has to toggle the content attribute itself.
  pinIconPin.toggleAttribute('hidden', pinned);
  pinIconClose.toggleAttribute('hidden', !pinned);
  pinButton.classList.toggle('is-pinned', pinned);
}

function hideIconTooltip() {
  if (iconTooltipTimer) {
    clearTimeout(iconTooltipTimer);
    iconTooltipTimer = null;
  }
  iconTooltip.hidden = true;
}

// In-page bubble instead of a native title: 500ms hover delay, below the
// hovered icon, right edges aligned, clamped so it never leaves the window.
function showIconTooltip(button) {
  iconTooltip.textContent = button.dataset.tooltip ||
    (button === checkUpdate
      ? ICON_TOOLTIP_CHECK
      : (pinned ? ICON_TOOLTIP_PINNED : ICON_TOOLTIP_UNPINNED));
  iconTooltip.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = iconTooltip.offsetWidth;
  const height = iconTooltip.offsetHeight;

  let left = rect.right - width;
  left = Math.max(4, Math.min(left, window.innerWidth - width - 4));
  let top = rect.bottom + 6;
  if (button.dataset.tooltipPlace === 'above' || top + height > window.innerHeight - 4) {
    top = Math.max(4, rect.top - height - 6);
  }

  iconTooltip.style.left = `${Math.round(left)}px`;
  iconTooltip.style.top = `${Math.round(top)}px`;
}

function watchIconTooltip(button) {
  button.addEventListener('mouseenter', () => {
    hideIconTooltip();
    // 0.1.55：日历格子没有 data-tooltip 时不出气泡
    if (button.classList.contains('cell') && !button.dataset.tooltip) return;
    iconTooltipTimer = setTimeout(() => {
      iconTooltipTimer = null;
      if (button.classList.contains('cell') && !button.dataset.tooltip) return;
      showIconTooltip(button);
    }, 500);
  });

  button.addEventListener('mouseleave', hideIconTooltip);
}

watchIconTooltip(pinButton);
watchIconTooltip(checkUpdate);

// 0.1.30：年月标题、翻月按钮、「今天」与黄历卡沿用同一个提示气泡，文字在 data-tooltip。
for (const el of document.querySelectorAll('[data-tooltip]')) watchIconTooltip(el);

pinButton.addEventListener('click', () => {
  hideIconTooltip();
  api.togglePin().then((result) => {
    if (result) renderPin(result.pinned);
  }).catch(() => {});
});

settingsButton.addEventListener('click', () => {
  const rect = settingsButton.getBoundingClientRect();
  settingsButton.classList.add('is-open');
  settingsButton.setAttribute('aria-expanded', 'true');
  api.openSettings({
    x: Math.round(rect.left),
    y: Math.round(rect.bottom + 4)
  });
});

function renderVersion(label) {
  const text = typeof label === 'string' ? label : '';
  appVersion.textContent = text;
  appVersion.setAttribute('aria-label', text ? `当前版本 ${text}` : '当前版本');
}

function loadVersion() {
  api.getVersion().then(renderVersion).catch(() => {
    renderVersion('');
  });
}

// The top-bar icon is a second entry to the same main-process check as the
// settings menu; feedback still arrives through update:status. When an update
// is already waiting, the icon re-opens its notice instead of re-checking.
checkUpdate.addEventListener('click', () => {
  hideIconTooltip();
  if (pendingNotice) {
    showUpdateNotice(pendingNotice);
    return;
  }
  api.checkUpdate();
});

function renderWeather(result) {
  const ok = result && result.ok === true &&
    Number.isFinite(result.temperature) &&
    typeof result.city === 'string' && typeof result.weather === 'string';

  if (ok) {
    weatherEmoji.textContent = result.emoji || '🌡️';
    weatherTemp.textContent = `${Math.round(result.temperature)}°`;
    const range = typeof result.rangeText === 'string' ? result.rangeText : '';
    weatherRange.textContent = range;
    weatherRange.hidden = !range;
    weatherCity.textContent = result.city;
    weatherCard.title = `${result.city} · ${result.weather}`;
    weatherCard.classList.remove('is-failed');
    weatherRetry.hidden = true;
    fitWeatherCity();
    return;
  }

  const text = result && typeof result.text === 'string' && result.text.trim()
    ? result.text.trim()
    : '天气暂不可用';
  weatherEmoji.textContent = result && result.emoji ? result.emoji : '🌡️';
  weatherTemp.textContent = '—';
  weatherRange.textContent = '';
  weatherRange.hidden = true;
  // 0.1.35：失败态常显「重试」，并隐藏悬停的「更换 ›」（CSS .is-failed）；
  // N1：失败时文案统一为「天气不可用」、不显示「—」占位温度。
  const failed = !(result && typeof result.text === 'string' && result.text.includes('加载中'));
  const shown = failed ? '天气不可用' : text;
  weatherCity.textContent = shown;
  weatherCard.title = shown;
  weatherCard.classList.remove('is-compact');
  weatherCard.classList.toggle('is-failed', failed);
  weatherRetry.hidden = !failed;
}

// 0.1.36：城市名放不下时先隐藏区间（.is-compact），每次渲染都重新判断。
function fitWeatherCity() {
  weatherCard.classList.remove('is-compact');
  if (weatherRange.hidden) return;
  if (weatherCity.scrollWidth > weatherCity.clientWidth) weatherCard.classList.add('is-compact');
}

function retryWeather(event) {
  event.stopPropagation();
  event.preventDefault();
  weatherCity.textContent = '正在刷新…';
  api.refreshWeather().then((result) => {
    if (result) renderWeather(result);
  }).catch(() => {});
}

weatherRetry.addEventListener('click', retryWeather);
weatherRetry.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') retryWeather(event);
});

function requestWeather() {
  const token = weatherToken + 1;
  weatherToken = token;
  api.getWeather().then((result) => {
    if (token === weatherToken) renderWeather(result);
  }).catch(() => {
    if (token === weatherToken) renderWeather(null);
  });
}

// The main process owns the weather location: a saved city or IP geolocation.
// The renderer only asks for the current result; all network access stays in
// the main process.
function refreshWeather() {
  requestWeather();
}

function weatherRowButton(row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'picker-item';
  button.setAttribute('role', 'option');

  const name = document.createElement('span');
  name.className = 'picker-name';
  name.textContent = row.label;

  const selected = row.auto
    ? Boolean(weatherQuickCities && weatherQuickCities.manual === false)
    : row.selected === true;
  if (selected) {
    // 0.1.36：选中行仍可点，用底色 + ✓ 表示，不再置灰、不写「已选」。
    button.classList.add('is-selected');
    button.setAttribute('aria-selected', 'true');
    const check = document.createElement('span');
    check.className = 'picker-check';
    check.setAttribute('aria-label', '已选');
    check.textContent = '✓';
    button.append(name, check);
  } else {
    button.append(name);
  }
  button.addEventListener('click', () => {
    const city = row.auto
      ? null
      : {
          name: row.name,
          latitude: row.latitude,
          longitude: row.longitude,
          country: row.country,
          admin1: row.admin1
        };
    const label = row.auto ? '当前位置' : row.name;
    // Close the panel and show progress immediately; the main process saves
    // the city and pushes the refreshed result via weather:update, so this
    // never waits on the network.
    closeWeatherPicker();
    afterPickerChoice('weather');
    renderWeather({ ok: false, text: `${label} · 加载中…` });
    api.setCity(city).catch(() => {
      refreshWeather();
    });
  });
  return button;
}

function renderWeatherPicker(rows) {
  weatherList.replaceChildren();
  weatherList.append(weatherRowButton({ auto: true, label: '自动（按 IP）' }));

  if (weatherSearch.value.trim() === '') {
    const cities = weatherQuickCities && Array.isArray(weatherQuickCities.cities)
      ? weatherQuickCities.cities
      : [];
    if (cities.length === 0) return;

    const section = document.createElement('div');
    section.className = 'picker-section-label';
    section.textContent = '常用城市';
    weatherList.append(section);
    for (const row of cities) {
      weatherList.append(weatherRowButton(row));
    }
    return;
  }

  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows) {
    weatherList.append(weatherRowButton(row));
  }
}

function loadQuickCities() {
  const token = weatherQuickToken + 1;
  weatherQuickToken = token;
  api.getQuickCities().then((result) => {
    if (token !== weatherQuickToken) return;
    if (weatherSearch.value.trim() !== '') return;
    weatherQuickCities = result && Array.isArray(result.cities) ? result : null;
    renderWeatherPicker([]);
  }).catch(() => {
    if (token !== weatherQuickToken) return;
    weatherQuickCities = null;
    if (weatherSearch.value.trim() === '') renderWeatherPicker([]);
  });
}

function runWeatherSearch() {
  if (weatherSearchTimer) {
    clearTimeout(weatherSearchTimer);
    weatherSearchTimer = null;
  }

  if (weatherSearch.value.trim() === '') {
    weatherSearchToken += 1;
    renderWeatherPicker([]);
    loadQuickCities();
    return;
  }

  weatherSearchTimer = setTimeout(() => {
    weatherSearchTimer = null;
    const token = weatherSearchToken + 1;
    weatherSearchToken = token;
    api.searchCity(weatherSearch.value).then((rows) => {
      if (token === weatherSearchToken) renderWeatherPicker(rows);
    }).catch(() => {
      if (token === weatherSearchToken) renderWeatherPicker([]);
    });
  }, 60);
}

function openWeatherPicker() {
  closeClockEditor();
  closeAlmanacPicker();
  clearSettingsHighlight();
  weatherPicker.hidden = false;
  weatherSearch.value = '';
  weatherQuickCities = null;
  weatherQuickToken += 1;
  runWeatherSearch();
  weatherSearch.focus();
}

function closeWeatherPicker() {
  weatherPicker.hidden = true;
  if (weatherSearchTimer) {
    clearTimeout(weatherSearchTimer);
    weatherSearchTimer = null;
  }
  weatherSearchToken += 1;
  weatherQuickToken += 1;
  weatherQuickCities = null;
  weatherList.replaceChildren();
}

function renderAlmanacStyleRows(rows) {
  almanacStyleList.replaceChildren();
  if (!Array.isArray(rows)) return;

  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-item almanac-style-item';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', row.selected ? 'true' : 'false');

    const badge = document.createElement('span');
    badge.className = 'almanac-badge';
    badge.textContent = row.badge;
    badge.style.setProperty('--almanac-badge-light', row.accentLight);
    badge.style.setProperty('--almanac-badge-dark', row.accentDark);

    const info = document.createElement('span');
    info.className = 'almanac-style-info';

    const name = document.createElement('span');
    name.className = 'picker-name';
    name.textContent = row.name;

    const tagline = document.createElement('span');
    tagline.className = 'picker-zone';
    tagline.textContent = row.tagline;

    info.append(name, tagline);
    button.append(badge, info);

    if (row.selected) {
      button.classList.add('is-selected');
      const selected = document.createElement('span');
      selected.className = 'almanac-style-check';
      selected.setAttribute('aria-label', '已选');
      selected.textContent = '✓';
      button.append(selected);
    }

    button.addEventListener('click', () => {
      selectAlmanacStyle(row);
    });
    almanacStyleList.append(button);
  }
}

function loadAlmanacStyles() {
  const token = almanacStylesToken + 1;
  almanacStylesToken = token;
  api.getAlmanacStyles().then((rows) => {
    if (token === almanacStylesToken) renderAlmanacStyleRows(rows);
  }).catch(() => {
    if (token === almanacStylesToken) renderAlmanacStyleRows([]);
  });
}

function selectAlmanacStyle(row) {
  if (!row) return;
  if (row.selected) {
    closeAlmanacPicker();
    return;
  }

  api.setAlmanacStyle(row.id).then((result) => {
    if (!result || result.ok !== true) return;
    todayAlmanac = result.almanac;
    if (selectedKey) {
      const token = selectToken;
      api.getAlmanacForDate(selectedKey).then((almanac) => {
        if (token !== selectToken || !almanac) return;
        selectedAlmanac = almanac;
        showAlmanac();
      }).catch(() => {});
    }
    showAlmanac();
    closeAlmanacPicker();
    afterPickerChoice('almanac');
  }).catch(() => {});
}

function openAlmanacPicker() {
  closeClockEditor();
  closeWeatherPicker();
  clearSettingsHighlight();
  almanacPicker.hidden = false;
  almanacStyleList.replaceChildren();
  loadAlmanacStyles();
}

function closeAlmanacPicker() {
  almanacPicker.hidden = true;
  almanacStylesToken += 1;
  almanacStyleList.replaceChildren();
}

function checkFailedToast() {
  return {
    type: 'error',
    title: '检查失败',
    detail: '网络不通或更新源暂不可用',
    action: { label: '重试', onClick: () => api.checkUpdate() }
  };
}

function showUpdateNotice(notice) {
  if (!notice) return;

  clearSettingsHighlight();
  pendingNotice = notice;
  const ready = notice.mode === 'ready';
  // An available update keeps its orange dot until it is installed.
  checkUpdate.classList.toggle('has-update', ready);
  showToast(ready
    ? {
        type: 'warning',
        title: '新版本已就绪',
        detail: '重启后完成更新',
        action: { label: '立即重启', onClick: () => api.restartToUpdate() },
        sticky: true
      }
    : {
        type: 'warning',
        title: '发现新版本',
        detail: '无法自动更新，请手动下载',
        action: { label: '下载新版', onClick: () => api.openLatestRelease() },
        sticky: true
      });
}

// Manual check statuses share the toast with update notices. Sticky notices win
// so a pending download/restart prompt is never replaced by a status line.
// N5：升级页「检查更新」下面一行显示上次检查结果；没检查过不显示。
const UPDATE_RESULT_TEXT = {
  'up-to-date': '已是最新',
  error: '检查失败，请稍后再试',
  manual: '需手动下载新版本',
  ready: '新版本已就绪，重启即可更新'
};

function recordUpdateResult(state, label) {
  const el = document.getElementById('settings-update-result');
  if (!el || !state || state === 'checking' || state === 'downloading') return;
  const text = UPDATE_RESULT_TEXT[state] || label;
  if (!text) return;
  el.textContent = `上次检查：${text}`;
  el.hidden = false;
}

function applyCheckStatus(status) {
  if (!status) return;
  const state = typeof status.state === 'string' ? status.state : '';
  const label = typeof status.label === 'string' ? status.label : '';
  recordUpdateResult(state, label);
  if (!state && !label) {
    if (toastState && toastState.type === 'progress') hideToast();
    return;
  }
  if (toastState && toastState.sticky) return;

  const version = appVersion.textContent.trim();
  if (state === 'checking') {
    showToast({ type: 'progress', title: '正在检查更新…' });
  } else if (state === 'downloading') {
    showToast({
      type: 'progress',
      title: Number.isFinite(status.percent)
        ? `正在下载新版本 ${Math.round(status.percent)}%`
        : '正在下载新版本'
    });
  } else if (state === 'up-to-date') {
    showToast({ type: 'success', title: version ? `已是最新版本 ${version}` : '已是最新版本' });
  } else if (state === 'error') {
    showToast(checkFailedToast());
  } else if (state === 'manual') {
    showToast({ type: 'warning', title: '需手动下载' });
  } else {
    showToast({ type: 'info', title: label || '开发态不检查更新' });
  }
}

// 进行中的提示目前只有更新检查/下载，顶栏图标的弧线随之旋转。
onToastChange((kind) => checkUpdate.classList.toggle('is-spinning', kind === 'progress'));
setToastProgressFallback(checkFailedToast);

api.onUpdateNotice(showUpdateNotice);
api.onUpdateStatus(applyCheckStatus);
api.onWeatherUpdate(renderWeather);
api.onPinState((payload) => renderPin(payload && payload.pinned));

clockEdit.addEventListener('click', () => {
  openClockEditor();
});

clockPickerClose.addEventListener('click', () => {
  closeClockEditor();
});

clockSearch.addEventListener('input', () => {
  runClockSearch();
});

weatherCard.addEventListener('click', () => {
  openWeatherPicker();
});

weatherPickerClose.addEventListener('click', () => {
  closeWeatherPicker();
});

weatherSearch.addEventListener('input', () => {
  runWeatherSearch();
});

let redrawShakeTimer = null;

almanacRedraw.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!lastAlmanac) return;
  const current = almanacQuote.textContent;
  const pool = (lastAlmanac.quotePool || []).filter((q) => q !== current);
  if (pool.length === 0) return;
  drawnQuote = pool[Math.floor(Math.random() * pool.length)];
  renderQuote(almanacQuote, drawnQuote);
  almanacRedraw.classList.remove('is-shaking');
  almanacQuote.classList.remove('is-fresh');
  void almanacRedraw.offsetWidth;
  almanacRedraw.classList.add('is-shaking');
  almanacQuote.classList.add('is-fresh');
  // 动画 400ms；reduced-motion 时没有 animationend，也按时移除。
  clearTimeout(redrawShakeTimer);
  redrawShakeTimer = setTimeout(() => almanacRedraw.classList.remove('is-shaking'), 450);
});

almanacRedraw.addEventListener('animationend', () => almanacRedraw.classList.remove('is-shaking'));
almanacQuote.addEventListener('animationend', () => almanacQuote.classList.remove('is-fresh'));

almanacCustomize.addEventListener('click', () => {
  openAlmanacPicker();
});

almanacPickerClose.addEventListener('click', () => {
  closeAlmanacPicker();
});

const EMBEDDED = { almanac: [almanacPicker, openAlmanacPicker], weather: [weatherPicker, openWeatherPicker], clocks: [clockPicker, openClockEditor] };

function closeAllPickers() {
  closeClockEditor();
  closeWeatherPicker();
  closeAlmanacPicker();
  almanacPicker.classList.remove('is-embedded');
  weatherPicker.classList.remove('is-embedded');
  clockPicker.classList.remove('is-embedded');
}

function selectSettingsTab(tab) {
  settingsTab = tab;
  settingsTabs.forEach((el) => {
    const on = el.dataset.tab === tab;
    if (on) settingsPageTitle.textContent = el.textContent;
    el.classList.toggle('is-selected', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  closeAllPickers();
  settingsPageUi.hidden = tab !== 'ui';
  settingsPageUpdate.hidden = tab !== 'update';
  settingsPageTags.hidden = tab !== 'tags';
  if (tab === 'tags') renderTagManager();
  const readerPage = document.getElementById('settings-page-reader');
  if (readerPage) readerPage.hidden = tab !== 'reader';
  if (tab === 'reader' && typeof renderReaderSettings === 'function') renderReaderSettings();
  const embedded = EMBEDDED[tab];
  if (embedded) {
    embedded[0].classList.add('is-embedded');
    embedded[1]();
  }
}

function openSettingsView(tab = 'ui') {
  if (typeof closeInboxView === 'function') closeInboxView();
  if (typeof closeReaderView === 'function') closeReaderView();
  closeAllPickers();
  clearSettingsHighlight();
  appBody.hidden = true;
  settingsView.hidden = false;
  api.setSettingsView(true);
  selectSettingsTab(tab);
  api.getSettings().then((s) => {
    settingOpenAtLogin.checked = s.openAtLogin === true;
    settingShowDate.checked = s.menuBarShowDate !== false;
    renderHotkeys(s.hotkeys);
    settingsVersion.textContent = s.version;
  }).catch(() => {});
}

function closeSettingsView() {
  if (settingsView.hidden) return;
  closeAllPickers();
  settingsTab = null;
  settingsView.hidden = true;
  appBody.hidden = false;
  api.setSettingsView(false);
}

function afterPickerChoice(tab) {
  if (!settingsView.hidden && settingsTab === tab) selectSettingsTab(tab);
}

settingsBack.addEventListener('click', () => {
  closeSettingsView();
});
settingsTabs.forEach((el) => {
  el.addEventListener('click', () => selectSettingsTab(el.dataset.tab));
});
settingOpenAtLogin.addEventListener('change', () => {
  const el = settingOpenAtLogin;
  api.setOpenAtLogin(el.checked).then((v) => { el.checked = v === true; }).catch(() => {});
});
// 0.1.50：两个快捷键可录入新组合、可清空，立即生效；注册失败显示「快捷键被占用」。
const RH = window.LanliRegionHelpers;
const hotkeyUi = {
  capture: { key: document.getElementById('setting-capture-key'), clear: document.getElementById('setting-capture-clear'), hint: settingCaptureHint },
  region: { key: document.getElementById('setting-region-key'), clear: document.getElementById('setting-region-clear'), hint: document.getElementById('setting-region-hint') }
};
let hotkeyRecording = null;
function renderHotkey(kind, st) {
  const u = hotkeyUi[kind]; const acc = st && st.accelerator;
  u.key.classList.remove('recording');
  u.key.classList.toggle('empty', !acc);
  u.key.textContent = acc ? RH.acceleratorLabel(acc) : '未设置';
  u.key.dataset.accelerator = acc || '';
  u.clear.hidden = !acc;
  u.hint.hidden = !(st && st.busy);
}
function renderHotkeys(h) { if (!h) return; renderHotkey('capture', h.capture); renderHotkey('region', h.region); }
function stopHotkeyRecording() {
  if (!hotkeyRecording) return;
  const kind = hotkeyRecording; hotkeyRecording = null;
  api.getSettings().then((s) => renderHotkey(kind, s.hotkeys && s.hotkeys[kind])).catch(() => {});
}
function applyHotkey(kind, accelerator) {
  return api.setHotkey(kind, accelerator).then((r) => { renderHotkey(kind, r); return r; }).catch(() => {});
}
Object.keys(hotkeyUi).forEach((kind) => {
  const u = hotkeyUi[kind];
  u.key.addEventListener('click', () => {
    if (hotkeyRecording && hotkeyRecording !== kind) stopHotkeyRecording();
    hotkeyRecording = kind;
    u.key.classList.add('recording');
    u.key.textContent = '按下新组合…';
    u.key.focus();
  });
  u.key.addEventListener('blur', () => { if (hotkeyRecording === kind) stopHotkeyRecording(); });
  u.key.addEventListener('keydown', (e) => {
    if (hotkeyRecording !== kind) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stopHotkeyRecording(); return; }
    const acc = RH.eventToAccelerator(e);
    if (!acc) return;   // 只按了修饰键，继续等
    hotkeyRecording = null;
    applyHotkey(kind, acc);
  });
  u.clear.addEventListener('click', () => { hotkeyRecording = null; applyHotkey(kind, ''); });
});
settingShowDate.addEventListener('change', () => {
  api.setMenuBarShowDate(settingShowDate.checked);
});
settingsCheckUpdate.addEventListener('click', () => {
  if (pendingNotice) {
    showUpdateNotice(pendingNotice);
    return;
  }
  api.checkUpdate();
});

// ---- 0.1.42 收纳：最简列表 ----
const inboxView = document.getElementById('inbox-view');
const inboxList = document.getElementById('inbox-list');
const inboxEmpty = document.getElementById('inbox-empty');
const inboxCount = document.getElementById('inbox-count');
const inboxDetail = document.getElementById('inbox-detail');
const inboxDetailFrame = document.getElementById('inbox-detail-frame');
// 0.1.58：详情 iframe 继承页面 CSP（style-src 'self'），这段内联样式靠 calendar.html CSP 里的 sha256 放行；改这里要同步改哈希（单测 R5 会校验）
const DETAIL_FRAME_CSS = ":root{color-scheme:light dark}body{background:transparent;font:13px -apple-system,\"PingFang SC\",sans-serif;margin:12px 16px;color:#1d1d1f;word-break:break-word}img{max-width:100%;height:auto}@media (prefers-color-scheme:dark){body{color:#f5f5f7}a{color:#6ab0ff}}";
const inboxBack = document.getElementById('inbox-back');
const inboxTitle = document.getElementById('inbox-title');
const inboxButton = document.getElementById('inbox-button');
const INBOX_TYPE_ICON = { file: '📄', image: '🖼', text: '📝', link: '🔗' };

function formatInboxTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 1) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// 0.1.46：文件副标题只显示上一级文件夹名（常见目录用中文名），完整路径放悬停提示
const INBOX_DIR_NAMES = { Downloads: '下载', Desktop: '桌面', Documents: '文稿', Pictures: '图片', Movies: '影片', Music: '音乐' };
function inboxParentName(p) {
  if (!p) return '';
  const parts = String(p).split('/').filter(Boolean);
  if (parts.length < 2) return '';
  const dir = parts[parts.length - 2];
  return INBOX_DIR_NAMES[dir] || dir;
}

function inboxSubtitle(m) {
  if (m.type === 'file') return m.missing ? '原文件已移动或删除' : [m.isDir ? '文件夹' : formatSize(m.size), inboxParentName(m.sourcePath)].filter(Boolean).join(' · ');
  if (m.type === 'image' && m.via === 'region') return ['框选', m.sourceApp ? `来自 ${m.sourceApp}` : ''].filter(Boolean).join(' · ');
  if (m.type === 'image') return [formatSize(m.size), m.preview].filter(Boolean).join(' · ');
  if (m.type === 'link') return m.preview || m.sourceUrl || '';
  if (m.type === 'text' && m.rich) {
    const n = (m.assets || []).length;
    return ['图文', n ? `含 ${n} 张图` : '', m.sourceApp ? `来自 ${m.sourceApp}` : ''].filter(Boolean).join(' · ');
  }
  if (m.type === 'text' && m.rest != null) return [m.rest, m.sourceApp ? `来自 ${m.sourceApp}` : ''].filter(Boolean).join(' · ');
  return m.preview || '';
}

// ---- 0.1.44 收纳 B 段：检索、类型/标签/日期筛选、日期分组、行操作 ----
const IQ = window.LanliInboxQuery;
const inboxSearch = document.getElementById('inbox-search');
const inboxTypes = document.getElementById('inbox-types');
const inboxTagsEl = document.getElementById('inbox-tags');
const inboxMore = document.getElementById('inbox-more');
const inboxMoreMenu = document.getElementById('inbox-more-menu');
const inboxDayChip = document.getElementById('inbox-day-chip');
const inboxDayChipText = document.getElementById('inbox-day-chip-text');
const inboxNoResult = document.getElementById('inbox-noresult');
const inboxUndo = document.getElementById('inbox-undo');
const inboxTagPop = document.getElementById('inbox-tagpop');
const inboxTagInput = document.getElementById('inbox-tag-input');
const inboxTagSuggest = document.getElementById('inbox-tag-suggest');
const inboxTagErr = document.getElementById('inbox-tagpop-err');
const inboxMiniCal = document.getElementById('inbox-minical');
const inboxMiniGrid = document.getElementById('inbox-minical-grid');
const inboxMiniTitle = document.getElementById('inbox-minical-title');
const INBOX_TAG_SHOW = 6;
let inboxEntries = [];
const inboxFilter = { query: '', type: 'all', tags: [], day: null, range: null };
let inboxPickStart = null; // 0.1.46 区间选择：已点的起点
const inboxCustom = document.getElementById('inbox-custom');
let inboxTagTarget = null;
let inboxTagCounts = [];
let inboxUndoId = null;
let inboxUndoTimer = null;
var inboxDaySet = new Set(); // var：月历 renderCells 可能先于这里执行
var inboxDayCounts = {}; // 0.1.55：每天收纳条数
var inboxOpenedFromDay = false; // 0.1.55：由日历日期打开收纳，返回时清掉日期筛选
let miniMonth = null; // { y, m(0-11) }

function appendHighlighted(el, text, query) {
  el.textContent = '';
  for (const part of IQ.highlightParts(text, query)) {
    if (part.hit) { const mark = document.createElement('mark'); mark.className = 'inbox-hit'; mark.textContent = part.text; el.appendChild(mark); }
    else el.appendChild(document.createTextNode(part.text));
  }
}

function inboxFilterActive() {
  return Boolean(inboxFilter.query.trim() || inboxFilter.type !== 'all' || inboxFilter.tags.length || inboxFilter.day || inboxFilter.range);
}

function renderInboxTags() {
  const counts = IQ.tagCounts(inboxEntries);
  inboxTagsEl.textContent = '';
  inboxMoreMenu.textContent = '';
  // 选中的标签即使排在 6 名以后也显示出来
  const shown = counts.slice(0, INBOX_TAG_SHOW);
  const rest = counts.slice(INBOX_TAG_SHOW);
  const makePill = (c, inMenu) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (inMenu ? 'inbox-more-item' : 'inbox-pill inbox-tag') + (inboxFilter.tags.includes(c.tag) ? ' is-active' : '');
    b.dataset.tag = c.tag;
    b.title = `#${c.tag}（${c.count}）`;
    b.textContent = `#${c.tag}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleInboxTag(c.tag); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); api.inboxTagMenu(c.tag); });
    return b;
  };
  for (const c of shown) inboxTagsEl.appendChild(makePill(c, false));
  for (const c of rest) inboxMoreMenu.appendChild(makePill(c, true));
  inboxMore.hidden = rest.length === 0;
  inboxMore.textContent = `+${rest.length}`;
  inboxMore.classList.toggle('is-active', rest.some((c) => inboxFilter.tags.includes(c.tag)));
  if (!rest.length) inboxMoreMenu.hidden = true;
  inboxTagCounts = counts;
  // 已不存在的标签从筛选里去掉
  inboxFilter.tags = inboxFilter.tags.filter((t) => counts.some((c) => c.tag === t));
}

function toggleInboxTag(tag) {
  const i = inboxFilter.tags.indexOf(tag);
  if (i >= 0) inboxFilter.tags.splice(i, 1); else inboxFilter.tags.push(tag);
  renderInbox();
}

function setInboxType(type) {
  inboxFilter.type = type;
  for (const b of inboxTypes.querySelectorAll('.inbox-type')) {
    const on = b.dataset.type === type;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  renderInbox();
}

function updateInboxRangeChip() {
  const r = inboxFilter.range;
  inboxDayChip.hidden = !r;
  inboxDayChipText.textContent = r ? IQ.rangeChipLabel(r, IQ.filterEntries(inboxEntries, inboxFilter).length) : '';
}
function setInboxRange(r) {
  inboxFilter.day = null;
  inboxFilter.range = r || null;
  inboxPickStart = null;
  renderMiniCal();
  renderInbox();
}
function setInboxDay(key) { setInboxRange(key ? { from: key, to: key } : null); }
function closeInboxRangePop(commitPending) {
  if (inboxMiniCal.hidden) return;
  if (commitPending && inboxPickStart) { setInboxDay(inboxPickStart); }
  inboxPickStart = null;
  inboxMiniCal.hidden = true;
  document.getElementById('inbox-cal-toggle').classList.remove('is-active');
}

function clearInboxFilters() {
  inboxFilter.query = ''; inboxSearch.value = '';
  inboxFilter.tags = [];
  setInboxType('all');
  setInboxDay(null);
}

function rowAction(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'inbox-act ' + cls;
  b.textContent = label;
  b.title = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

function buildInboxRow(m) {
  const q = inboxFilter.query;
  const row = document.createElement('div');
  row.className = 'inbox-row' + (m.missing ? ' is-missing' : '');
  row.setAttribute('role', 'listitem');
  row.dataset.id = m.id;
  row.dataset.type = m.type;
  const icon = document.createElement('span');
  icon.className = 'inbox-row-icon';
  const richThumb = m.type === 'text' && m.rich && m.thumb;
  if (m.thumb && !richThumb) {
    const img = document.createElement('img');
    img.src = m.thumb; img.alt = '';
    icon.appendChild(img);
  } else {
    icon.textContent = m.type === 'text' && m.rich ? '🗞' : (INBOX_TYPE_ICON[m.type] || '📄');
  }
  const body = document.createElement('span');
  body.className = 'inbox-row-body';
  const title = document.createElement('span');
  title.className = 'inbox-row-title';
  appendHighlighted(title, m.title || '（无标题）', q);
  const sub = document.createElement('span');
  sub.className = 'inbox-row-sub';
  appendHighlighted(sub, inboxSubtitle(m), q);
  if (m.type === 'file' && m.sourcePath) sub.title = m.sourcePath;
  if ((m.tags || []).length) {
    const tags = document.createElement('span');
    tags.className = 'inbox-row-tags';
    appendHighlighted(tags, m.tags.map((t) => '#' + t).join(' '), q);
    sub.appendChild(tags);
  }
  body.append(title, sub);
  const time = document.createElement('span');
  time.className = 'inbox-row-time';
  time.textContent = formatInboxTime(m.createdAt);
  const acts = document.createElement('span');
  acts.className = 'inbox-row-actions';
  if (m.missing) {
    acts.appendChild(rowAction('重新指定原文件…', 'inbox-act-relink', () => {
      api.relinkInboxEntry(m.id).then((r) => {
        if (r && r.ok) refreshInbox();
        else if (r && r.text) showToast({ type: 'warning', title: r.text });
      }).catch(() => {});
    }));
  } else {
    // 0.1.59：只有文件类才有「在 Finder 中显示」；文字、图文、链接、图片不是用户的文件
    if (m.type === 'file' && !m.missing) acts.appendChild(rowAction('在 Finder 中显示', 'inbox-act-reveal', () => api.revealInboxEntry(m.id)));
    acts.appendChild(rowAction('复制', 'inbox-act-copy', () => {
      api.copyInboxEntry(m.id).then(() => showToast({ type: 'success', title: '已复制' })).catch(() => {});
    }));
    acts.appendChild(rowAction('#', 'inbox-act-tag', (e) => openTagPop(m, e.currentTarget)));
  }
  acts.appendChild(rowAction('×', 'inbox-act-delete', () => deleteInboxEntry(m.id)));
  if (richThumb) {
    const th = document.createElement('img');
    th.className = 'inbox-row-thumb';
    th.src = m.thumb; th.alt = '';
    row.append(icon, body, th, time, acts);
  } else {
    row.append(icon, body, time, acts);
  }
  // 0.1.59：把按钮组实际宽度写进 --acts-w，标题区按它让位
  const measureActs = () => row.style.setProperty('--acts-w', acts.offsetWidth + 'px');
  row.addEventListener('mouseenter', measureActs);
  row.addEventListener('focusin', measureActs);
  if (m.missing) requestAnimationFrame(measureActs);
  row.addEventListener('click', () => openInboxRow(m));
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); api.inboxContextMenu(m.id); });
  return row;
}

function renderInbox(entries) {
  if (Array.isArray(entries)) inboxEntries = entries;
  renderInboxTags();
  const shown = IQ.filterEntries(inboxEntries, inboxFilter);
  inboxList.textContent = '';
  inboxCount.textContent = inboxEntries.length ? (inboxFilterActive() ? `${shown.length}/${inboxEntries.length} 项` : `${inboxEntries.length} 项`) : '';
  const detailOpen = !inboxDetail.hidden;
  inboxEmpty.hidden = detailOpen || inboxEntries.length > 0;
  updateInboxRangeChip();
  inboxNoResult.hidden = detailOpen || !(inboxEntries.length > 0 && shown.length === 0);
  for (const g of IQ.groupByDate(shown, new Date())) {
    const head = document.createElement('div');
    head.className = 'inbox-group';
    head.textContent = g.label;
    inboxList.appendChild(head);
    for (const m of g.entries) inboxList.appendChild(buildInboxRow(m));
  }
}

function deleteInboxEntry(id) {
  if (inboxUndoId && inboxUndoId !== id) inboxUndoId = null;
  api.removeInboxEntry(id).then(() => {
    inboxEntries = inboxEntries.filter((m) => m.id !== id);
    renderInbox();
    inboxUndoId = id;
    inboxUndo.hidden = false;
    if (inboxUndoTimer) clearTimeout(inboxUndoTimer);
    inboxUndoTimer = setTimeout(() => { inboxUndo.hidden = true; inboxUndoId = null; }, 5000);
  }).catch(() => {});
}

document.getElementById('inbox-undo-btn').addEventListener('click', () => {
  const id = inboxUndoId;
  inboxUndo.hidden = true; inboxUndoId = null;
  if (inboxUndoTimer) { clearTimeout(inboxUndoTimer); inboxUndoTimer = null; }
  if (id) api.undoRemoveInboxEntry(id).then(() => refreshInbox()).catch(() => {});
});

let inboxTagLib = [];
function openTagPop(m, anchor) {
  inboxTagTarget = m.id;
  inboxTagErr.textContent = '';
  inboxTagInput.value = '';
  inboxTagPop.hidden = false;
  renderTagSuggest();
  // 0.1.56：候选来自标签库
  inboxTagAnchor = anchor;
  positionTagPop();
  api.inboxTags().then((list) => { inboxTagLib = list || []; if (!inboxTagPop.hidden) { renderTagSuggest(); positionTagPop(); } }).catch(() => {});
  inboxTagInput.focus();
}
let inboxTagAnchor = null;
// 弹层右缘对齐「#」按钮；放不下就翻到按钮上方，始终不出窗口。
function positionTagPop() {
  if (!inboxTagAnchor || inboxTagPop.hidden) return;
  const vr = inboxView.getBoundingClientRect();
  const ar = inboxTagAnchor.getBoundingClientRect();
  const h = inboxTagPop.offsetHeight;
  const w = inboxTagPop.offsetWidth;
  let top = ar.bottom - vr.top + 4;
  if (top + h > vr.height - 8) top = ar.top - vr.top - 4 - h;
  top = Math.max(8, Math.min(top, vr.height - h - 8));
  inboxTagPop.style.top = `${top}px`;
  inboxTagPop.style.right = `${Math.min(Math.max(8, vr.right - ar.right), Math.max(8, vr.width - w - 8))}px`;
}
// 输入时联想已有标签（不用 datalist：自绘候选，点一下即填入并添加）
function renderTagSuggest() {
  const q = inboxTagInput.value.trim().replace(/^#+/, '').toLowerCase();
  const target = inboxEntries.find((m) => m.id === inboxTagTarget);
  const have = (target && target.tags) || [];
  inboxTagSuggest.textContent = '';
  // 0.1.56：标签库里本条还没有的全部标签，按名称排序；输入时按包含过滤。
  const names = inboxTagLib.map((t) => t.name).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  for (const name of names) {
    if (have.includes(name) || (q && !name.toLowerCase().includes(q))) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'inbox-tag-suggest-item';
    b.dataset.tag = name;
    b.title = '#' + name;
    b.textContent = '#' + name;
    b.addEventListener('click', (e) => { e.stopPropagation(); inboxTagInput.value = name; submitTag(); });
    inboxTagSuggest.appendChild(b);
  }
}
inboxTagInput.addEventListener('input', () => { renderTagSuggest(); positionTagPop(); });

function submitTag() {
  const id = inboxTagTarget; const tag = inboxTagInput.value;
  if (!id) return;
  api.addInboxTag(id, tag).then((r) => {
    if (r && r.ok) { closeTagPop(); refreshInbox(); }
    else inboxTagErr.textContent = (r && r.text) || '没加上';
  }).catch(() => {});
}

function closeTagPop() { inboxTagPop.hidden = true; inboxTagTarget = null; }

inboxTagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTagPop(); return; }
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  submitTag();
});

inboxSearch.addEventListener('input', () => { inboxFilter.query = inboxSearch.value; renderInbox(); });
inboxSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inboxSearch.value = ''; inboxFilter.query = ''; renderInbox(); }
});
inboxTypes.addEventListener('click', (e) => {
  const b = e.target.closest('.inbox-type');
  if (b) setInboxType(b.dataset.type);
});
inboxMore.addEventListener('click', (e) => { e.stopPropagation(); inboxMoreMenu.hidden = !inboxMoreMenu.hidden; });
document.getElementById('inbox-day-chip-x').addEventListener('click', () => setInboxDay(null));
document.getElementById('inbox-clear').addEventListener('click', () => clearInboxFilters());
document.addEventListener('keydown', (e) => {
  if (inboxView.hidden) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); inboxSearch.focus(); inboxSearch.select(); }
  // 0.1.49：焦点不在输入框时 ⌘V 收纳剪贴板
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V') && !typing) { e.preventDefault(); captureFromPanel(); }
});
// 0.1.57：收纳页粘贴的结果在窗口内提示，不弹托盘提示框
function captureFromPanel() {
  api.captureClipboard().then((r) => {
    refreshInbox();
    if (!r || !r.text) return;
    let type = 'success';
    if (r.dup) type = 'info';
    else if (!r.ok) type = r.kind === 'empty' ? 'warning' : 'error';
    showToast({ type, title: r.text });
  }).catch(() => {});
}
document.getElementById('inbox-paste').addEventListener('click', () => captureFromPanel());

// 0.1.62 录入：手动输入或粘贴纯文字，走和粘贴文字同一条入库路径（inbox:addManual）
const composeBox = document.getElementById('inbox-compose');
const composeText = document.getElementById('inbox-compose-text');
const composeCount = document.getElementById('inbox-compose-count');
const composeSave = document.getElementById('inbox-compose-save');
const composeBtn = document.getElementById('inbox-compose-btn');
const COMPOSE_MAX = 20000;
function composeSync() {
  const n = [...composeText.value].length;
  const blank = !composeText.value.trim();
  composeCount.textContent = n ? `${n} / ${COMPOSE_MAX}` : '';
  composeCount.classList.toggle('is-over', n > COMPOSE_MAX);
  composeSave.disabled = blank || n > COMPOSE_MAX;
  composeText.style.height = 'auto';
  composeText.style.height = Math.min(composeText.scrollHeight + 2, 10 * 20 + 16) + 'px';
}
function openCompose() {
  composeBox.hidden = false;
  composeBtn.classList.add('inbox-compose-btn-on');
  composeSync();
  composeText.focus();
}
function closeCompose(clear) {
  composeBox.hidden = true;
  composeBtn.classList.remove('inbox-compose-btn-on');
  if (clear) { composeText.value = ''; composeSync(); }
}
function saveCompose() {
  if (composeSave.disabled) return;
  const text = composeText.value;
  api.addInboxManual(text).then((r) => {
    if (r && r.ok) {
      closeCompose(true);
      refreshInbox();
      showToast({ type: 'success', title: r.text || '已收纳' });
    } else {
      showToast({ type: r && r.kind === 'empty' ? 'warning' : 'error', title: (r && r.text) || '收纳失败' });
    }
  }).catch(() => {});
}
composeBtn.addEventListener('click', () => { if (composeBox.hidden) openCompose(); else closeCompose(false); });
composeText.addEventListener('input', composeSync);
composeText.addEventListener('paste', (e) => {
  // 只取纯文本，图片和富文本格式丢弃
  const t = e.clipboardData && e.clipboardData.getData('text/plain');
  e.preventDefault();
  if (!t) return;
  composeText.setRangeText(t, composeText.selectionStart, composeText.selectionEnd, 'end');
  composeSync();
});
composeText.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveCompose(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCompose(true); }
});
composeSave.addEventListener('click', saveCompose);
document.getElementById('inbox-compose-cancel').addEventListener('click', () => closeCompose(true));
document.addEventListener('click', (e) => {
  if (!inboxMoreMenu.hidden && !e.target.closest('.inbox-more-wrap')) inboxMoreMenu.hidden = true;
  if (!inboxTagPop.hidden && !e.target.closest('#inbox-tagpop') && !e.target.closest('.inbox-act-tag')) closeTagPop();
});

// 日历联动：收纳面板里的月历（主界面月历同样画小圆点）。只有收纳面板打开时点日期才筛到当天。
function syncInboxPresets() {
  const r = inboxFilter.range;
  for (const b of document.querySelectorAll('.inbox-preset')) {
    const p = b.dataset.preset;
    const on = p === 'custom' ? Boolean(r && !r.preset) : Boolean(r && r.preset === p);
    b.classList.toggle('is-active', on);
  }
}
function renderMiniCal() {
  syncInboxPresets();
  if (!miniMonth) { const n = new Date(); miniMonth = { y: n.getFullYear(), m: n.getMonth() }; }
  const { y, m } = miniMonth;
  inboxMiniTitle.textContent = `${y}年${m + 1}月`;
  inboxMiniGrid.textContent = '';
  for (const w of ['一', '二', '三', '四', '五', '六', '日']) { const h = document.createElement('span'); h.className = 'inbox-minical-dow'; h.textContent = w; inboxMiniGrid.appendChild(h); }
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  for (let i = 0; i < lead; i += 1) inboxMiniGrid.appendChild(document.createElement('span'));
  const daysIn = new Date(y, m + 1, 0).getDate();
  const todayKey = IQ.dayKeyOf(new Date());
  const nowD = new Date(); const todayMs = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  for (let d = 1; d <= daysIn; d += 1) {
    const key = `${y}-${m + 1}-${d}`;
    const b = document.createElement('button');
    b.type = 'button';
    const r = inboxFilter.range;
    const t = new Date(y, m, d).getTime();
    const future = t > todayMs;
    const isEnd = inboxPickStart ? key === inboxPickStart : Boolean(r && (key === r.from || key === r.to));
    const inSel = !inboxPickStart && r && IQ.inRange({ createdMs: t }, r);
    b.className = 'inbox-minical-day' + (inboxDaySet.has(key) ? ' has-inbox' : ' no-inbox') + (isEnd ? ' is-active' : (inSel ? ' is-in-range' : '')) + (key === todayKey ? ' is-today' : '') + (future ? ' is-future' : '');
    if (future) b.disabled = true;
    b.dataset.day = key;
    const num = document.createElement('span'); num.textContent = String(d);
    b.appendChild(num);
    if (inboxDaySet.has(key)) { const dot = document.createElement('span'); dot.className = 'inbox-dot'; b.appendChild(dot); }
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (inboxView.hidden || b.disabled) return;
      const before = inboxPickStart && IQ.makeRange(inboxPickStart, key).from === key && key !== inboxPickStart;
      if (!inboxPickStart || before) { inboxPickStart = key; renderMiniCal(); return; }
      const range = IQ.makeRange(inboxPickStart, key);
      setInboxRange(range);
      closeInboxRangePop(false);
    });
    inboxMiniGrid.appendChild(b);
  }
}
document.getElementById('inbox-cal-toggle').addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (!inboxMiniCal.hidden) { closeInboxRangePop(false); return; }
  const tb = document.getElementById('inbox-toolbar').getBoundingClientRect();
  inboxMiniCal.style.top = `${Math.round(tb.bottom - inboxView.getBoundingClientRect().top + 4)}px`;
  inboxPickStart = null;
  // 0.1.47：已有区间时直接展开月历把区间标出来，月份跳到区间终点所在月
  const cur = inboxFilter.range;
  inboxCustom.hidden = false; // 0.1.47：月历始终可见
  if (cur) { const e = cur.to.split('-').map(Number); miniMonth = { y: e[0], m: e[1] - 1 }; }
  inboxMiniCal.hidden = false;
  document.getElementById('inbox-cal-toggle').classList.add('is-active');
  renderMiniCal();
});
for (const btn of document.querySelectorAll('.inbox-preset')) {
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (btn.dataset.preset === 'custom') {
      inboxCustom.hidden = false;
      inboxPickStart = null;
      renderMiniCal();
      return;
    }
    setInboxRange(IQ.presetRange(btn.dataset.preset, new Date()));
    closeInboxRangePop(false);
  });
}
inboxMiniCal.addEventListener('click', (ev) => ev.stopPropagation());
document.addEventListener('click', () => closeInboxRangePop(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !inboxMiniCal.hidden) { e.preventDefault(); e.stopImmediatePropagation(); closeInboxRangePop(false); }
}, true);
document.getElementById('inbox-minical-prev').addEventListener('click', (ev) => { ev.stopPropagation(); const d = new Date(miniMonth.y, miniMonth.m - 1, 1); miniMonth = { y: d.getFullYear(), m: d.getMonth() }; renderMiniCal(); });
document.getElementById('inbox-minical-next').addEventListener('click', (ev) => { ev.stopPropagation(); const d = new Date(miniMonth.y, miniMonth.m + 1, 1); miniMonth = { y: d.getFullYear(), m: d.getMonth() }; renderMiniCal(); });

function refreshInboxDays() {
  return Promise.all([api.inboxDays(), api.inboxDayCounts ? api.inboxDayCounts().catch(() => ({})) : Promise.resolve({})]).then(([keys, counts]) => {
    inboxDaySet = new Set(keys || []);
    inboxDayCounts = counts || {};
    for (const cell of grid.querySelectorAll('.cell')) {
      const has = inboxDaySet.has(cell.dataset.day);
      cell.classList.toggle('has-inbox', has);
      let dot = cell.querySelector('.cell-inbox-dot');
      if (has && !dot) { dot = document.createElement('span'); dot.className = 'cell-inbox-dot'; cell.appendChild(dot); }
      if (!has && dot) dot.remove();
      decorateInboxCell(cell);
    }
    if (!inboxMiniCal.hidden) renderMiniCal();
  }).catch(() => {});
}

function refreshInbox() {
  refreshInboxDays();
  if (inboxView.hidden) return Promise.resolve();
  return api.listInbox().then(renderInbox).catch(() => renderInbox([]));
}

function showInboxList() {
  inboxDetail.hidden = true;
  inboxDetailFrame.srcdoc = '';
  inboxList.hidden = false;
  inboxTitle.textContent = '收纳';
  inboxBack.textContent = '‹ 返回';
  refreshInbox();
}

function openInboxRow(m) {
  if (m.missing) { showToast({ type: 'warning', title: '原文件已移动或删除', detail: '右键可删除这条' }); return; }
  api.openInboxEntry(m.id).then((r) => {
    if (r && typeof r.html === 'string') {
      inboxList.hidden = true;
      inboxEmpty.hidden = true;
      inboxNoResult.hidden = true;
      inboxDetail.hidden = false;
      inboxTitle.textContent = m.title || '文字';
      inboxBack.textContent = '‹ 收纳';
      inboxDetailFrame.srcdoc = `<!doctype html><meta charset="utf-8"><style>${DETAIL_FRAME_CSS}</style>${r.html}`;
    }
  }).catch(() => {});
}

function openInboxView() {
  closeAllPickers();
  closeSettingsView();
  if (typeof closeReaderView === 'function') closeReaderView();
  appBody.hidden = true;
  inboxView.hidden = false;
  api.setSettingsView(true);
  api.setInboxView(true);
  showInboxList();
}

function openInboxForDay(key) {
  if (!key) return;
  clearInboxFilters();
  setInboxDay(key);
  inboxOpenedFromDay = true;
  openInboxView();
}

function closeInboxView() {
  if (inboxView.hidden) return;
  if (inboxOpenedFromDay) { inboxOpenedFromDay = false; setInboxDay(null); }
  inboxView.hidden = true;
  inboxDetail.hidden = true;
  inboxDetailFrame.srcdoc = '';
  closeTagPop();
  inboxMoreMenu.hidden = true;
  appBody.hidden = false;
  api.setSettingsView(false);
  api.setInboxView(false);
}

inboxBack.addEventListener('click', () => {
  if (!inboxDetail.hidden) { showInboxList(); return; }
  closeInboxView();
});
inboxButton.addEventListener('click', () => {
  if (inboxView.hidden) openInboxView(); else closeInboxView();
});
api.onInboxChanged(() => { refreshInbox(); });
// 右键「删除这条」和悬停 × 走同一条可撤销删除
if (api.onInboxRequestDelete) api.onInboxRequestDelete((id) => deleteInboxEntry(id));
api.onInboxEscape(() => {
  if (!composeBox.hidden) { closeCompose(true); return; }
  if (!inboxTagPop.hidden) { closeTagPop(); return; }
  if (!inboxMoreMenu.hidden) { inboxMoreMenu.hidden = true; return; }
  if (inboxSearch.value) { inboxSearch.value = ''; inboxFilter.query = ''; renderInbox(); return; }
  if (!inboxDetail.hidden) { showInboxList(); return; }
  closeInboxView();
});
refreshInboxDays();

api.onOpenPanel((panel) => {
  clearSettingsHighlight();
  if (panel === 'inbox') { openInboxView(); return; }
  closeInboxView();
  if (panel === 'reader' && typeof openReaderView === 'function') { openReaderView(); return; }
  if (typeof closeReaderView === 'function') closeReaderView();
  if (panel === 'settings') { openSettingsView(); return; }
  closeSettingsView();
  if (panel === 'calendar') return;
  if (panel === 'clocks') openClockEditor();
  if (panel === 'weather') openWeatherPicker();
  if (panel === 'almanac') openAlmanacPicker();
});

document.addEventListener('pointerdown', clearSettingsHighlight, true);
document.addEventListener('pointerdown', hideIconTooltip, true);
window.addEventListener('blur', clearSettingsHighlight);
window.addEventListener('blur', hideIconTooltip);

document.documentElement.addEventListener('mouseenter', () => {
  clearSettingsHighlight();
  api.pointerEnter();
  if (pointerInside) return;
  pointerInside = true;
  refreshState();
});

document.documentElement.addEventListener('mouseleave', () => {
  pointerInside = false;
  api.pointerLeave();
});

// The main process resets the browsing month whenever the panel moves from
// hidden to visible. Pick that state up as soon as the window appears.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pointerInside = false;
  if (document.visibilityState === 'visible') {
    refreshState();
    refreshWeather();
  }
});

window.addEventListener('focus', () => {
  clearSettingsHighlight();
  refreshState();
});

api.onTick((payload) => {
  if (!payload) return;
  if (Number.isInteger(payload.openSeq) && payload.openSeq !== lastOpenSeq) {
    clearSelection();
    lastOpenSeq = payload.openSeq;
    refreshState();
  }
  if (payload.almanac) todayAlmanac = payload.almanac;
  showAlmanac();
  renderViewSubtitle(payload.viewSubtitle);
  renderClockList(payload.clocks);
});

loadVersion();
refreshState();
if (document.visibilityState === 'visible') refreshWeather();


// ===== 0.1.56 标签管理（契约 docs/changes/0.1.56-tag-manager.md C 段）=====
const tagsNew = document.getElementById('tags-new');
const tagsNewErr = document.getElementById('tags-new-err');
const tagsList = document.getElementById('tags-list');
const tagsEmpty = document.getElementById('tags-empty');

function tagDeleteText(name, count) { return `删除 #${name}？${count} 项会去掉这个标签，条目本身保留`; }

function renderTagManager(list) {
  if (!list) { api.inboxTags().then((l) => renderTagManager(l || [])).catch(() => {}); return; }
  tagsList.textContent = '';
  tagsEmpty.hidden = list.length > 0;
  for (const t of list) tagsList.appendChild(tagRow(t));
}

function tagRow(t) {
  const row = document.createElement('div');
  row.className = 'tag-row';
  row.dataset.id = t.id;
  row.dataset.name = t.name;
  const showNormal = () => {
    row.className = 'tag-row';
    row.textContent = '';
    const name = document.createElement('span'); name.className = 'tag-row-name'; name.textContent = '#' + t.name; name.title = '#' + t.name;
    const count = document.createElement('span'); count.className = 'tag-row-count'; count.textContent = `${t.count} 项`;
    const ren = document.createElement('button'); ren.type = 'button'; ren.className = 'tag-row-btn tag-row-rename'; ren.textContent = '改名';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'tag-row-btn tag-row-delete'; del.textContent = '删除';
    ren.addEventListener('click', showRename);
    del.addEventListener('click', showDelete);
    row.append(name, count, ren, del);
  };
  const showRename = () => {
    row.className = 'tag-row is-editing';
    row.textContent = '';
    const input = document.createElement('input'); input.type = 'text'; input.className = 'tag-row-input'; input.maxLength = 9; input.value = t.name;
    const err = document.createElement('div'); err.className = 'tag-row-err';
    let done = false;
    const save = () => {
      if (done) return;
      const v = input.value;
      if (!v.trim().replace(/^#+/, '').trim() || v.trim().replace(/^#+/, '').trim() === t.name) { done = true; showNormal(); return; }
      api.inboxTagRename(t.id, v).then((r) => {
        if (r && r.ok) { done = true; renderTagManager(r.tags); refreshInboxIfOpen(); }
        else { err.textContent = (r && r.text) || '没改成'; input.focus(); }
      }).catch(() => {});
    };
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; showNormal(); }
    });
    input.addEventListener('blur', () => { if (!err.textContent) save(); });
    input.addEventListener('input', () => { err.textContent = ''; });
    row.append(input, err);
    input.focus(); input.select();
  };
  const showDelete = () => {
    row.className = 'tag-row tag-confirm is-confirm';
    row.textContent = '';
    const text = document.createElement('span'); text.className = 'tag-confirm-text'; text.textContent = tagDeleteText(t.name, t.count);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'tag-confirm-cancel'; cancel.textContent = '取消';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'tag-confirm-ok'; ok.textContent = '删除';
    cancel.addEventListener('click', showNormal);
    ok.addEventListener('click', () => {
      api.inboxTagDelete(t.id).then((r) => { if (r && r.ok) { renderTagManager(r.tags); refreshInboxIfOpen(); } }).catch(() => {});
    });
    row.append(text, cancel, ok);
  };
  showNormal();
  return row;
}

function addTagFromManager() {
  const v = tagsNew.value;
  if (!v.trim()) return;
  api.inboxTagCreate(v).then((r) => {
    if (r && r.ok) { tagsNew.value = ''; tagsNewErr.textContent = ''; renderTagManager(r.tags); }
    else tagsNewErr.textContent = (r && r.text) || '没加上';
  }).catch(() => {});
}
document.getElementById('tags-add-btn').addEventListener('click', addTagFromManager);
tagsNew.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addTagFromManager(); } });
tagsNew.addEventListener('input', () => { tagsNewErr.textContent = ''; });

function refreshInboxIfOpen() { if (typeof refreshInbox === 'function' && !inboxView.hidden) refreshInbox(); }

// 收纳页右键「删除这个标签」：先就地确认，再走同一套删除逻辑。
const inboxTagConfirm = document.getElementById('inbox-tag-confirm');
const inboxTagConfirmText = document.getElementById('inbox-tag-confirm-text');
let inboxTagConfirmName = null;
function askDeleteTag(name) {
  api.inboxTags().then((list) => {
    const t = (list || []).find((x) => x.name === name);
    if (!t) return;
    inboxTagConfirmName = t.id;
    inboxTagConfirmText.textContent = tagDeleteText(t.name, t.count);
    inboxTagConfirm.hidden = false;
  }).catch(() => {});
}
document.getElementById('inbox-tag-confirm-cancel').addEventListener('click', () => { inboxTagConfirm.hidden = true; inboxTagConfirmName = null; });
document.getElementById('inbox-tag-confirm-ok').addEventListener('click', () => {
  const id = inboxTagConfirmName;
  inboxTagConfirm.hidden = true; inboxTagConfirmName = null;
  if (id) api.inboxTagDelete(id).then(() => refreshInbox()).catch(() => {});
});
if (api.onInboxRequestTagDelete) api.onInboxRequestTagDelete((name) => askDeleteTag(name));

// 0.1.56 T6b：弹层底部「管理标签…」→ 设置页「标签」tab
document.getElementById('inbox-tagpop-manage').addEventListener('click', (e) => {
  e.stopPropagation();
  closeTagPop();
  openSettingsView();
  selectSettingsTab('tags');
});
