'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
  dialog
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const {
  MIN_YEAR,
  MAX_YEAR,
  formatMenuTitle,
  daysInMonth,
  buildCells,
  buildNow
} = require('./calendar');

const WINDOW_WIDTH = 680;
const WINDOW_HEIGHT = 470;

let tray = null;
let calendarWindow = null;
let clockTimer = null;
let closeTimer = null;

let view = null;
let focus = null;

function todayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  };
}

function resetViewToToday() {
  const today = todayParts();
  view = { year: today.year, month: today.month };
  focus = { year: today.year, month: today.month, day: today.day };
}

function getOpenAtLogin() {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch (error) {
    console.warn('[栏历] 读取登录项失败：' + (error && error.message ? error.message : error));
    return false;
  }
}

function buildState() {
  return {
    view: { year: view.year, month: view.month },
    focus: { year: focus.year, month: focus.month, day: focus.day },
    cells: buildCells(view.year, view.month, new Date()),
    now: buildNow(new Date()),
    openAtLogin: getOpenAtLogin()
  };
}

function preferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function readPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences) {
  const file = preferencesPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(preferences, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.warn('[栏历] 写入偏好文件失败：' + (error && error.message ? error.message : error));
  }
}

// First launch only: try to turn on the login item and remember that the
// attempt was made. The system value always remains the source of truth.
function initializeLoginItem() {
  const preferences = readPreferences();
  if (preferences.loginItemInitialized === true) return;

  try {
    app.setLoginItemSettings({ openAtLogin: true });
  } catch (error) {
    console.warn('[栏历] 首次运行设置登录项失败：' +
      (error && error.message ? error.message : error));
  }

  const actual = getOpenAtLogin();
  if (!actual) {
    console.warn(
      '[栏历] 首次运行已调用 setLoginItemSettings({ openAtLogin: true })，' +
      '但读回 openAtLogin=false；未签名包可能被系统拒绝，开关将显示真实值。'
    );
  }
  writePreferences({ ...preferences, loginItemInitialized: true });
}

function createCalendarWindow() {
  calendarWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    roundedCorners: true,
    transparent: false,
    focusable: true,
    fullscreenable: false,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  calendarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  calendarWindow.loadFile(path.join(__dirname, 'renderer', 'calendar.html'));

  calendarWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.key === 'Esc')) {
      event.preventDefault();
      hideCalendar();
    }
  });

  calendarWindow.on('closed', () => {
    calendarWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'trayTemplate.png');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);

  tray.on('mouse-enter', openCalendar);
  tray.on('mouse-leave', scheduleClose);
  tray.on('click', () => {
    if (!calendarWindow || calendarWindow.isDestroyed()) return;
    if (!calendarWindow.isVisible()) openCalendar();
  });
}

function cancelClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function scheduleClose() {
  cancelClose();
  closeTimer = setTimeout(hideCalendar, 200);
}

function positionCalendar() {
  if (!tray || !calendarWindow || calendarWindow.isDestroyed()) return;

  const bounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;

  let x = bounds.x + bounds.width - WINDOW_WIDTH;
  if (x < area.x) x = area.x;
  if (x + WINDOW_WIDTH > area.x + area.width) {
    x = area.x + area.width - WINDOW_WIDTH;
  }

  // Align with no overlap by default. On a real Mac, if a pointer-passable
  // gap appears between the menu bar and the panel, use
  // `bounds.y + bounds.height - 1` (at most 1px overlap).
  const y = bounds.y + bounds.height;

  calendarWindow.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT
  });
}

function openCalendar() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;

  cancelClose();
  const wasVisible = calendarWindow.isVisible();

  if (!wasVisible) {
    resetViewToToday();
    positionCalendar();
    calendarWindow.show();
  } else {
    positionCalendar();
  }

  updateClock();
}

function hideCalendar() {
  cancelClose();
  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    calendarWindow.hide();
  }
}

function updateClock() {
  const now = new Date();

  if (tray) {
    tray.setTitle(formatMenuTitle(now), { fontType: 'monospacedDigit' });
  }

  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    calendarWindow.webContents.send('calendar:onTick', buildNow(now));
  }
}

function updateWindowForDisplayChange() {
  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    positionCalendar();
  }
}

function registerDisplayListeners() {
  screen.on('display-metrics-changed', updateWindowForDisplayChange);
  screen.on('display-added', updateWindowForDisplayChange);
  screen.on('display-removed', updateWindowForDisplayChange);
}

function applyViewPayload(payload) {
  if (!payload || typeof payload !== 'object') return buildState();

  const year = Number(payload.year);
  const month = Number(payload.month);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return buildState();
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return buildState();
  }

  const maxDay = daysInMonth(year, month);
  let day;
  const hasFocus = Number.isInteger(payload.focusY) &&
    Number.isInteger(payload.focusM) &&
    Number.isInteger(payload.focusD);

  if (hasFocus && payload.focusY === year && payload.focusM === month) {
    day = Math.min(Math.max(payload.focusD, 1), maxDay);
  } else {
    day = Math.min(focus ? focus.day : 1, maxDay);
  }

  view = { year, month };
  focus = { year, month, day };
  return buildState();
}

function registerIpc() {
  ipcMain.handle('calendar:getState', () => buildState());

  ipcMain.handle('calendar:setView', (_event, payload) => applyViewPayload(payload));

  ipcMain.handle('calendar:goToday', () => {
    resetViewToToday();
    return buildState();
  });

  ipcMain.on('pointer:enter', () => {
    cancelClose();
  });

  ipcMain.on('pointer:leave', () => {
    scheduleClose();
  });

  ipcMain.handle('login:set', (_event, openAtLogin) => {
    const desired = Boolean(openAtLogin);
    try {
      app.setLoginItemSettings({ openAtLogin: desired });
    } catch (error) {
      console.warn('[栏历] 设置登录项失败：' +
        (error && error.message ? error.message : error));
    }
    const actual = getOpenAtLogin();
    if (desired && !actual) {
      console.warn(
        '[栏历] 已调用 setLoginItemSettings({ openAtLogin: true })，' +
        '但读回 openAtLogin=false；系统拒绝了未签名包的登录项，开关保持真实值。'
      );
    }
    return actual;
  });

  ipcMain.on('app:quit', () => {
    app.quit();
  });
}

async function bootstrap() {
  if (process.platform !== 'darwin') {
    dialog.showErrorBox('栏历', '栏历首发只支持 macOS。');
    app.quit();
    return;
  }

  try {
    app.dock.hide();
  } catch {
    // Dock may not be available in every launch context; nothing else to do.
  }

  Menu.setApplicationMenu(null);
  initializeLoginItem();
  resetViewToToday();
  registerIpc();
  createCalendarWindow();
  createTray();
  registerDisplayListeners();

  // Write the menu bar title immediately instead of waiting for the first
  // one-second interval.
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // The first instance keeps its tray and does not need to open a window for
  // the second launch.
  app.on('second-instance', () => {});

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[栏历] 启动失败：', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    // Tray application: keep running when the calendar window is hidden.
  });

  app.on('before-quit', () => {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  });
}

process.on('uncaughtException', (error) => {
  console.error('[栏历] 未捕获异常：', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[栏历] 未处理的 Promise 拒绝：', error);
});
