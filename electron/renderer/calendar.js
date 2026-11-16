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
const nowTime = document.getElementById('now-time');
const nowWeekday = document.getElementById('now-weekday');
const nowDay = document.getElementById('now-day');
const nowGanzhi = document.getElementById('now-ganzhi');
const nowLunar = document.getElementById('now-lunar');
const updateBanner = document.getElementById('update-banner');
const updateMessage = document.getElementById('update-message');
const updateAction = document.getElementById('update-action');
const checkUpdateButton = document.getElementById('check-update-button');
const checkUpdateLabel = document.getElementById('check-update-label');
const appVersion = document.getElementById('app-version');

let state = null;
let yearOptionsBuilt = false;
let updateMode = null;
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

function renderNow(now) {
  if (!now) return;
  nowTime.textContent = now.hourMinute;
  nowWeekday.textContent = now.weekday;
  nowDay.textContent = String(now.day);
  nowGanzhi.textContent = now.ganzhiYear;
  nowLunar.textContent = now.lunarMonthDay;
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
  renderNow(next.now);
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
  if (document.visibilityState === 'visible') refreshState();
});

window.addEventListener('focus', () => {
  refreshState();
});

api.onTick((now) => {
  renderNow(now);
});

loadVersion();
refreshState();
