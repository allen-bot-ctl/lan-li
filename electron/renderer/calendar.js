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
const grid = document.getElementById('grid');
const almanacCard = document.getElementById('almanac-card');
const almanacStyleName = document.getElementById('almanac-style-name');
const almanacCustomize = document.getElementById('almanac-customize');
const almanacFocusYi = document.getElementById('almanac-focus-yi');
const almanacFocusJi = document.getElementById('almanac-focus-ji');
const almanacQuote = document.getElementById('almanac-quote');
const almanacMeta = document.getElementById('almanac-meta');
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
const weatherCity = document.getElementById('weather-city');
const updateBanner = document.getElementById('update-banner');
const updateMessage = document.getElementById('update-message');
const updateAction = document.getElementById('update-action');
const appVersion = document.getElementById('app-version');
const checkUpdate = document.getElementById('check-update');
const weatherPicker = document.getElementById('weather-picker');
const weatherSearch = document.getElementById('weather-search');
const weatherPickerClose = document.getElementById('weather-picker-close');
const weatherList = document.getElementById('weather-list');
const almanacPicker = document.getElementById('almanac-picker');
const almanacPickerClose = document.getElementById('almanac-picker-close');
const almanacStyleList = document.getElementById('almanac-style-list');
const almanacDetail = document.getElementById('almanac-detail');
const almanacDetailTitle = document.getElementById('almanac-detail-title');
const almanacDetailBody = document.getElementById('almanac-detail-body');
const almanacDetailClose = document.getElementById('almanac-detail-close');

let state = null;
let lastAlmanac = null;
let detailDay = null;
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
let updateMode = null;
let bannerMode = null;
let checkStatusTimer = null;

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
  lunarSubtitle.textContent = `${almanac.ganZhiText} · ${almanac.lunarMonthText}`;
  almanacStyleName.textContent = almanac.styleName;
  almanacStyleName.title = `农历${almanac.lunarDayText}`;

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
  almanacQuote.textContent = almanac.quote;
  almanacMeta.textContent = almanac.metaText;

  // The detail panel always shows the latest received almanac; only a date
  // change (a midnight tick) needs a redraw while it is open.
  if (!almanacDetail.hidden && almanac.lunarDayText !== detailDay) {
    renderAlmanacDetail(almanac);
  }
}

function detailSection(parent, heading, lines) {
  const title = document.createElement('div');
  title.className = 'almanac-detail-heading';
  title.textContent = heading;

  const text = document.createElement('div');
  text.className = 'almanac-detail-text';
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'almanac-detail-line';
    row.textContent = line;
    text.append(row);
  }

  parent.append(title, text);
}

function focusLine(label, focus) {
  const hint = focus.hint ? ` · ${focus.hint}` : '';
  return `${label} ${focus.title}${hint}`;
}

function renderAlmanacDetail(almanac = lastAlmanac) {
  if (!almanac) return;
  almanacDetailTitle.textContent = `今日黄历 · ${almanac.lunarDayText}`;
  almanacDetailBody.replaceChildren();

  const detail = almanac.detail;
  detailSection(almanacDetailBody, '今日焦点', [
    focusLine('宜', almanac.focusYi),
    focusLine('忌', almanac.focusJi)
  ]);
  detailSection(
    almanacDetailBody,
    `宜（${detail.yiItems.length}）`,
    [detail.yiItems.join(' ')]
  );
  detailSection(
    almanacDetailBody,
    `忌（${detail.jiItems.length}）`,
    [detail.jiItems.join(' ')]
  );
  if (almanac.quote) {
    detailSection(almanacDetailBody, '签语', [almanac.quote]);
  }
  detailSection(
    almanacDetailBody,
    '建除 · 值神 · 冲煞',
    [`${detail.zhiXing}日 · ${detail.tianShen}（${detail.tianShenLuck}） · ${detail.chongText}`]
  );
  detailSection(
    almanacDetailBody,
    '彭祖百忌',
    [`${detail.pengZu[0]}；${detail.pengZu[1]}`]
  );

  detailDay = almanac.lunarDayText;
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
    sub.className = 'clock-entry-sub';
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

function openAlmanacDetail() {
  closeClockEditor();
  closeWeatherPicker();
  closeAlmanacPicker();
  clearSettingsHighlight();
  almanacDetail.hidden = false;
  renderAlmanacDetail();
}

function closeAlmanacDetail() {
  almanacDetail.hidden = true;
  almanacDetailBody.replaceChildren();
}

function openClockEditor() {
  closeWeatherPicker();
  closeAlmanacPicker();
  closeAlmanacDetail();
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
    if (next.focus.year === cell.year &&
        next.focus.month === cell.month &&
        next.focus.day === cell.day) {
      button.classList.add('is-focus');
    }

    const dayText = document.createElement('span');
    dayText.className = 'cell-day';
    dayText.textContent = String(cell.day);

    const secondaryText = document.createElement('span');
    secondaryText.className = 'cell-secondary';
    secondaryText.textContent = cell.secondaryText;

    button.append(dayText, secondaryText);
    button.addEventListener('click', () => {
      requestView({
        year: cell.year,
        month: cell.month,
        focusY: cell.year,
        focusM: cell.month,
        focusD: cell.day
      });
    });

    grid.append(button);
  }
}

function applyState(next) {
  if (!next || !Array.isArray(next.cells)) return;
  state = next;

  buildYearOptions();
  yearSelect.value = String(next.view.year);
  monthTitle.textContent = `${next.view.year}年${next.view.month}月`;

  renderCells(next);
  renderAlmanac(next.almanac);
  renderClockList(next.clocks);
  if (!clockPicker.hidden) renderClockEditor(next.clocks);
}

function refreshState() {
  return api.getState().then(applyState);
}

function requestView(payload) {
  return api.setView(payload).then(applyState);
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
  appVersion.textContent = text ? `栏历 ${text}` : '栏历';
  appVersion.setAttribute('aria-label', text ? `当前版本 ${text}` : '当前版本');
}

function loadVersion() {
  api.getVersion().then(renderVersion).catch(() => {
    renderVersion('');
  });
}

// The footer button is a second entry to the same main-process check as the
// settings menu; feedback still arrives through update:status.
checkUpdate.addEventListener('click', () => {
  api.checkUpdate();
});

function renderWeather(result) {
  const ok = result && result.ok === true &&
    Number.isFinite(result.temperature) &&
    typeof result.city === 'string' && typeof result.weather === 'string';

  if (ok) {
    weatherEmoji.textContent = result.emoji || '🌡️';
    weatherTemp.textContent = `${Math.round(result.temperature)}°`;
    weatherCity.textContent = result.city;
    weatherCard.title = `${result.city} · ${result.weather}`;
    return;
  }

  const text = result && typeof result.text === 'string' && result.text.trim()
    ? result.text.trim()
    : '天气暂不可用';
  weatherEmoji.textContent = result && result.emoji ? result.emoji : '🌡️';
  weatherTemp.textContent = '—';
  weatherCity.textContent = text;
  weatherCard.title = text;
}

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

  if (row.selected) {
    button.disabled = true;
    const tag = document.createElement('span');
    tag.className = 'picker-zone';
    tag.textContent = '已选';
    button.append(name, tag);
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
  closeAlmanacDetail();
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
      const selected = document.createElement('span');
      selected.className = 'picker-zone';
      selected.textContent = '已选';
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
    renderAlmanac(result.almanac);
    closeAlmanacPicker();
  }).catch(() => {});
}

function openAlmanacPicker() {
  closeClockEditor();
  closeWeatherPicker();
  closeAlmanacDetail();
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

function clearCheckStatusTimer() {
  if (checkStatusTimer) {
    clearTimeout(checkStatusTimer);
    checkStatusTimer = null;
  }
}

function hideStatusBanner() {
  if (bannerMode !== 'status') return;
  bannerMode = null;
  updateMode = null;
  updateBanner.hidden = true;
  updateMessage.textContent = '';
}

function showUpdateNotice(notice) {
  if (!notice || !updateBanner) return;

  clearCheckStatusTimer();
  clearSettingsHighlight();
  bannerMode = 'notice';
  updateMode = notice.mode === 'ready' ? 'ready' : 'manual';
  if (updateMode === 'ready') {
    updateMessage.textContent = '新版本已就绪';
    updateAction.textContent = '重启更新';
  } else {
    updateMessage.textContent = '无法自动更新，请手动下载';
    updateAction.textContent = '下载新版';
  }
  updateAction.hidden = false;
  updateBanner.hidden = false;
}

// Manual check results use the same banner area as update notices. Notices win
// so a pending download/restart prompt is never replaced by a status line.
function applyCheckStatus(status) {
  if (!status) return;
  clearCheckStatusTimer();

  const label = typeof status.label === 'string' ? status.label : '';
  if (!label) {
    if (bannerMode === 'status') hideStatusBanner();
    return;
  }
  if (bannerMode === 'notice') return;

  bannerMode = 'status';
  updateMode = null;
  updateMessage.textContent = label;
  updateAction.hidden = true;
  updateBanner.hidden = false;

  if (status.timed) {
    checkStatusTimer = setTimeout(() => {
      checkStatusTimer = null;
      hideStatusBanner();
    }, 2600);
  }
}

updateAction.addEventListener('click', () => {
  if (updateMode === 'ready') {
    api.restartToUpdate();
  } else if (updateMode === 'manual') {
    api.openLatestRelease();
  }
});

api.onUpdateNotice(showUpdateNotice);
api.onUpdateStatus(applyCheckStatus);
api.onWeatherUpdate(renderWeather);

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

almanacCard.addEventListener('click', (event) => {
  if (event.target.closest('#almanac-customize')) return;
  openAlmanacDetail();
});

almanacCustomize.addEventListener('click', () => {
  openAlmanacPicker();
});

almanacPickerClose.addEventListener('click', () => {
  closeAlmanacPicker();
});

almanacDetailClose.addEventListener('click', () => {
  closeAlmanacDetail();
});

api.onOpenPanel((panel) => {
  clearSettingsHighlight();
  if (panel === 'clocks') openClockEditor();
  if (panel === 'weather') openWeatherPicker();
  if (panel === 'almanac') openAlmanacPicker();
});

document.addEventListener('pointerdown', clearSettingsHighlight, true);
window.addEventListener('blur', clearSettingsHighlight);

document.documentElement.addEventListener('mouseenter', () => {
  clearSettingsHighlight();
  api.pointerEnter();
  refreshState();
});

document.documentElement.addEventListener('mouseleave', () => {
  api.pointerLeave();
});

// The main process resets the browsing month whenever the panel moves from
// hidden to visible. Pick that state up as soon as the window appears.
document.addEventListener('visibilitychange', () => {
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
  renderAlmanac(payload.almanac);
  renderClockList(payload.clocks);
});

loadVersion();
refreshState();
if (document.visibilityState === 'visible') refreshWeather();
