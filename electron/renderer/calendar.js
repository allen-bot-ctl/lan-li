'use strict';

const api = window.lanli;

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const yearSelect = document.getElementById('year-select');
const focusLabel = document.getElementById('focus-label');
const prevMonth = document.getElementById('prev-month');
const nextMonth = document.getElementById('next-month');
const todayButton = document.getElementById('today-button');
const grid = document.getElementById('grid');
const loginToggle = document.getElementById('login-toggle');
const quitButton = document.getElementById('quit-button');
const almanacYear = document.getElementById('almanac-year');
const almanacYi = document.getElementById('almanac-yi');
const almanacJi = document.getElementById('almanac-ji');
const clockCard = document.getElementById('clock-card');
const clockRow = document.getElementById('clock-row');
const clockCity = document.getElementById('clock-city');
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const clockDots = document.getElementById('clock-dots');
const clockEmpty = document.getElementById('clock-empty');
const clockPrev = document.getElementById('clock-prev');
const clockNext = document.getElementById('clock-next');
const clockAdd = document.getElementById('clock-add');
const clockRemove = document.getElementById('clock-remove');
const clockSetCurrent = document.getElementById('clock-set-current');
const clockPicker = document.getElementById('clock-picker');
const clockSearch = document.getElementById('clock-search');
const clockPickerClose = document.getElementById('clock-picker-close');
const clockList = document.getElementById('clock-list');
const updateBanner = document.getElementById('update-banner');
const updateMessage = document.getElementById('update-message');
const updateAction = document.getElementById('update-action');
const checkUpdateButton = document.getElementById('check-update-button');
const checkUpdateLabel = document.getElementById('check-update-label');
const appVersion = document.getElementById('app-version');
const weatherText = document.getElementById('weather-text');
const weatherPicker = document.getElementById('weather-picker');
const weatherSearch = document.getElementById('weather-search');
const weatherPickerClose = document.getElementById('weather-picker-close');
const weatherList = document.getElementById('weather-list');

let state = null;
let yearOptionsBuilt = false;
let updateMode = null;
let checkStatusTimer = null;
let clocks = null;
let searchToken = 0;
let searchTimer = null;
let wheelLockedAt = 0;
let weatherToken = 0;
let weatherSearchToken = 0;
let weatherSearchTimer = null;

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
  almanacYear.textContent = almanac.yearText;
  almanacYi.textContent = almanac.yiText;
  almanacYi.title = almanac.yiTitle;
  almanacJi.textContent = almanac.jiText;
  almanacJi.title = almanac.jiTitle;
}

function renderClockDots(items, index) {
  clockDots.replaceChildren();
  clockDots.hidden = items.length === 0;
  for (let position = 0; position < items.length; position += 1) {
    const dot = document.createElement('span');
    dot.className = position === index ? 'clock-dot is-current' : 'clock-dot';
    clockDots.append(dot);
  }
}

function renderClocks(snapshot) {
  if (!snapshot) return;
  clocks = snapshot;

  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const current = snapshot.current || null;
  const empty = !current;
  const canSwitch = items.length > 1;

  clockRow.hidden = empty;
  clockEmpty.hidden = !empty;
  clockRemove.hidden = empty;
  clockSetCurrent.hidden = empty;
  clockPrev.hidden = !canSwitch;
  clockNext.hidden = !canSwitch;
  renderClockDots(items, snapshot.index);

  if (empty) {
    clockSetCurrent.disabled = false;
    clockSetCurrent.textContent = '设为当前';
    clockSetCurrent.removeAttribute('aria-pressed');
    clockCard.removeAttribute('aria-label');
    return;
  }

  clockCity.textContent = current.label;
  clockCity.title = `${current.label}（${current.id}）`;
  clockTime.textContent = current.time;
  clockDate.textContent = `${current.date} ${current.weekday}`;
  const isMenuBar = Boolean(current.isMenuBar);
  clockSetCurrent.disabled = isMenuBar;
  clockSetCurrent.textContent = isMenuBar ? '当前' : '设为当前';
  clockSetCurrent.setAttribute('aria-pressed', isMenuBar ? 'true' : 'false');
  clockCard.setAttribute(
    'aria-label',
    `${current.label} ${current.time} ${current.date} ${current.weekday}`
  );
}

function requestClockSelect(payload) {
  return api.selectClock(payload).then(renderClocks).catch(() => {
    refreshState();
  });
}

function selectClockRelative(direction) {
  if (!clocks || !Array.isArray(clocks.items) || clocks.items.length < 2) return;
  requestClockSelect({ direction });
}

function renderPicker(rows) {
  clockList.replaceChildren();

  if (!Array.isArray(rows) || rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = '没有匹配的时区';
    clockList.append(empty);
    return;
  }

  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-item';
    button.setAttribute('role', 'option');
    button.disabled = Boolean(row.added);
    button.setAttribute('aria-selected', row.added ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'picker-name';
    name.textContent = row.label;

    const meta = document.createElement('span');
    if (row.added) {
      meta.className = 'picker-added';
      meta.textContent = '已添加';
    } else {
      meta.className = 'picker-zone';
      meta.textContent = row.id;
    }

    button.append(name, meta);
    button.addEventListener('click', () => {
      if (button.disabled) return;
      api.addClock({ id: row.id, label: row.label }).then((snapshot) => {
        renderClocks(snapshot);
        closeClockPicker();
      }).catch(() => {
        refreshState();
      });
    });
    clockList.append(button);
  }
}

function runClockSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  searchTimer = setTimeout(() => {
    searchTimer = null;
    const token = searchToken + 1;
    searchToken = token;
    api.searchClocks({ query: clockSearch.value }).then((rows) => {
      if (token === searchToken) renderPicker(rows);
    }).catch(() => {
      if (token === searchToken) renderPicker([]);
    });
  }, 60);
}

function openClockPicker() {
  clockPicker.hidden = false;
  clockSearch.value = '';
  clockList.replaceChildren();
  runClockSearch();
  clockSearch.focus();
}

function closeClockPicker() {
  clockPicker.hidden = true;
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  searchToken += 1;
  clockList.replaceChildren();
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
  focusLabel.textContent = `${next.focus.month}-${next.focus.day}`;

  renderCells(next);
  renderAlmanac(next.almanac);
  renderClocks(next.clocks);
  loginToggle.checked = Boolean(next.openAtLogin);
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

loginToggle.addEventListener('change', () => {
  const desired = loginToggle.checked;
  api.setLogin(desired).then((actual) => {
    loginToggle.checked = Boolean(actual);
  }).catch(() => {
    refreshState();
  });
});

quitButton.addEventListener('click', () => {
  api.quit();
});

function renderVersion(label) {
  if (!appVersion) return;
  const text = typeof label === 'string' ? label : '';
  appVersion.textContent = text;
  appVersion.setAttribute('aria-label', text ? `当前版本 ${text}` : '当前版本');
}

function loadVersion() {
  if (!appVersion) return;
  api.getVersion().then(renderVersion).catch(() => {
    renderVersion('');
  });
}

function renderWeather(result) {
  if (!weatherText) return;
  const text = result && typeof result.text === 'string' && result.text.trim()
    ? result.text.trim()
    : '天气暂不可用';
  weatherText.textContent = text;
  weatherText.title = text;
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

  button.append(name);
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
    renderWeather({ text: `${label} · 加载中…` });
    api.setCity(city).catch(() => {
      refreshWeather();
    });
  });
  return button;
}

function renderWeatherPicker(rows) {
  weatherList.replaceChildren();
  weatherList.append(weatherRowButton({ auto: true, label: '自动（按 IP）' }));

  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows) {
    weatherList.append(weatherRowButton(row));
  }
}

function runWeatherSearch() {
  if (weatherSearchTimer) {
    clearTimeout(weatherSearchTimer);
    weatherSearchTimer = null;
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
  weatherPicker.hidden = false;
  weatherSearch.value = '';
  renderWeatherPicker([]);
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
  weatherList.replaceChildren();
}

function showUpdateNotice(notice) {
  if (!notice || !updateBanner) return;

  updateMode = notice.mode === 'ready' ? 'ready' : 'manual';
  if (updateMode === 'ready') {
    updateMessage.textContent = '新版本已就绪';
    updateAction.textContent = '重启更新';
  } else {
    updateMessage.textContent = '无法自动更新，请手动下载';
    updateAction.textContent = '下载新版';
  }
  updateBanner.hidden = false;
}

function resetCheckButton() {
  checkUpdateLabel.textContent = '检查更新';
  checkUpdateButton.disabled = false;
  checkUpdateButton.setAttribute('aria-busy', 'false');
}

function applyCheckStatus(status) {
  if (!status) return;
  if (checkStatusTimer) {
    clearTimeout(checkStatusTimer);
    checkStatusTimer = null;
  }

  const label = typeof status.label === 'string' ? status.label : '';
  if (!label) {
    resetCheckButton();
    return;
  }

  checkUpdateLabel.textContent = label;
  checkUpdateButton.disabled = true;
  checkUpdateButton.setAttribute('aria-busy', status.busy ? 'true' : 'false');

  if (status.timed) {
    checkStatusTimer = setTimeout(() => {
      checkStatusTimer = null;
      resetCheckButton();
    }, 2600);
  }
}

checkUpdateButton.addEventListener('click', () => {
  if (checkUpdateButton.disabled) return;

  applyCheckStatus({
    state: 'checking',
    label: '正在检查…',
    busy: true,
    timed: false
  });

  api.checkForUpdate().then((status) => {
    if (status && status.state !== 'checking') applyCheckStatus(status);
  }).catch(() => {
    applyCheckStatus({
      state: 'error',
      label: '检查失败',
      busy: false,
      timed: true
    });
  });
});

api.onUpdateStatus(applyCheckStatus);

updateAction.addEventListener('click', () => {
  if (updateMode === 'ready') {
    api.restartToUpdate();
  } else if (updateMode === 'manual') {
    api.openLatestRelease();
  }
});

api.onUpdateNotice(showUpdateNotice);
api.onWeatherUpdate(renderWeather);

clockPrev.addEventListener('click', () => {
  selectClockRelative('prev');
});

clockNext.addEventListener('click', () => {
  selectClockRelative('next');
});

clockAdd.addEventListener('click', () => {
  openClockPicker();
});

clockRemove.addEventListener('click', () => {
  api.removeClock().then(renderClocks).catch(() => {
    refreshState();
  });
});

clockSetCurrent.addEventListener('click', () => {
  if (clockSetCurrent.disabled) return;
  api.setMenuBarClock({ id: clocks && clocks.current ? clocks.current.id : undefined })
    .then(renderClocks)
    .catch(() => {
      refreshState();
    });
});

clockPickerClose.addEventListener('click', () => {
  closeClockPicker();
});

clockSearch.addEventListener('input', () => {
  runClockSearch();
});

weatherText.addEventListener('click', () => {
  openWeatherPicker();
});

weatherPickerClose.addEventListener('click', () => {
  closeWeatherPicker();
});

weatherSearch.addEventListener('input', () => {
  runWeatherSearch();
});

// Horizontal trackpad swipe (or shift-wheel) switches clocks. Lock briefly so
// one gesture does not skip several zones.
clockCard.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  if (Math.abs(event.deltaX) < 8) return;
  event.preventDefault();

  const now = Date.now();
  if (now - wheelLockedAt < 350) return;
  wheelLockedAt = now;
  selectClockRelative(event.deltaX > 0 ? 'next' : 'prev');
}, { passive: false });

// Left/right switch clocks unless focus is on a text entry control, so the
// year dropdown and the search field keep their own key handling. After a
// click the focus usually rests on a button; arrow keys must keep switching.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (!clockPicker.hidden) return;

  const target = event.target;
  const tag = target && target.tagName ? target.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ||
      (target && target.isContentEditable)) {
    return;
  }

  event.preventDefault();
  selectClockRelative(event.key === 'ArrowLeft' ? 'prev' : 'next');
});

document.documentElement.addEventListener('mouseenter', () => {
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
  refreshState();
});

api.onTick((payload) => {
  if (!payload) return;
  renderAlmanac(payload.almanac);
  renderClocks(payload.clocks);
});

loadVersion();
refreshState();
if (document.visibilityState === 'visible') refreshWeather();
