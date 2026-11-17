'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
  dialog,
  autoUpdater,
  net,
  shell,
  session
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
// Electron patches Node's fs so paths inside app.asar look like virtual
// directories. Recursive rmSync on staging/backup bundles would follow that
// patch instead of the real filesystem; original-fs bypasses it.
const originalFs = require('original-fs');

const {
  MIN_YEAR,
  MAX_YEAR,
  formatMenuTitle,
  daysInMonth,
  buildCells,
  buildAlmanac
} = require('./calendar');
const { setupAutoUpdate } = require('./updater');
const { createMacSelfUpdater } = require('./mac-self-update');
const { createLogger } = require('./logger');
const { describeStatus } = require('./update-status');
const { formatVersionLabel } = require('./app-version');
const {
  supportedTimeZoneList,
  defaultLocalTimeZone,
  sameTimeZone,
  formatClock,
  formatMenuTitleInZone,
  resolveMenuBarTimeZone,
  normalizeMenuBarTimeZone,
  nextMenuBarTimeZoneAfterRemove,
  normalizeWorldClocks,
  addClock,
  removeClock,
  selectClock,
  searchCatalog
} = require('./world-clocks');
const {
  RELEASES_LATEST_URL,
  HOMEPAGE_URL
} = require('./update-feed');
const {
  CACHE_TTL_MS: WEATHER_REFRESH_MS,
  createWeatherService,
  unavailableWeather
} = require('./weather');
const { createLocationPermission } = require('./location-permission');
const { createLoginItem } = require('./login-item');

const WINDOW_WIDTH = 580;
const WINDOW_HEIGHT = 400;

let tray = null;
let calendarWindow = null;
let clockTimer = null;
let closeTimer = null;
let updater = null;
let selfUpdater = null;
let updateSetupError = null;
let updateNotice = null;
let weatherService = null;
let weatherTimer = null;
let loginItem = null;
let locationPermission = null;
let locationAuthPromise = null;

const logger = createLogger();

let view = null;
let focus = null;
let worldClocks = { items: [], index: 0 };
// Stored IANA id for the menu-bar display zone. null/omitted means follow the
// system local zone. The renderer never reads or writes preferences directly.
let menuBarTimeZone = null;

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

function getLoginItem() {
  if (!loginItem) {
    loginItem = createLoginItem({
      isPackaged: app.isPackaged,
      logger: (message) => logger.warn('[栏历] 登录项：' + message)
    });
  }
  return loginItem;
}

function reasonOf(error) {
  return error && error.message ? error.message : String(error);
}

function readSystemOpenAtLogin() {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch (error) {
    logger.warn('[栏历] 读取系统登录项失败：' + reasonOf(error));
    return false;
  }
}

function getOpenAtLogin() {
  // The LaunchAgent fallback is only used for this app's own plist, so its
  // presence is a legitimate second source of truth.
  const fallbackEnabled = getLoginItem().isEnabled();
  return readSystemOpenAtLogin() || fallbackEnabled;
}

// Applies the desired state through the system API first. Unsigned bundles
// reject setLoginItemSettings (readback stays false), so a false readback
// after enabling switches to a per-user LaunchAgent. Returns the final real
// state so the renderer can show exactly what took effect.
function applyLoginItem(desired) {
  const helper = getLoginItem();
  const wantOpen = Boolean(desired);

  try {
    app.setLoginItemSettings({ openAtLogin: wantOpen });
  } catch (error) {
    logger.warn('[栏历] 设置系统登录项失败：' + reasonOf(error));
  }

  if (wantOpen) {
    if (!readSystemOpenAtLogin()) {
      const outcome = helper.enable();
      if (outcome.ok) {
        logger.info('[栏历] 系统登录项未生效，已写入 LaunchAgent：' + outcome.path);
      } else {
        logger.warn('[栏历] 系统登录项未生效，LaunchAgent 回退失败：' + outcome.reason);
      }
    } else {
      // A working system login item makes a leftover fallback redundant (and
      // would otherwise launch the app twice at login).
      const outcome = helper.disable();
      if (!outcome.ok) {
        logger.warn('[栏历] 清理旧 LaunchAgent 失败：' + outcome.reason);
      }
    }
  } else {
    const outcome = helper.disable();
    if (!outcome.ok) {
      logger.warn('[栏历] 删除 LaunchAgent 失败：' + outcome.reason);
    }
  }

  const actual = getOpenAtLogin();
  if (actual !== wantOpen) {
    logger.warn('[栏历] 登录项最终状态为 ' + actual + '，期望 ' + wantOpen + '。');
  }
  return actual;
}

function buildState() {
  const now = new Date();
  return {
    view: { year: view.year, month: view.month },
    focus: { year: focus.year, month: focus.month, day: focus.day },
    cells: buildCells(view.year, view.month, now),
    almanac: buildAlmanac(now),
    clocks: currentClockSnapshot(now),
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

function supportedTimeZones() {
  return supportedTimeZoneList();
}

function resolvedMenuBarTimeZone() {
  return resolveMenuBarTimeZone(
    menuBarTimeZone,
    worldClocks.items,
    defaultLocalTimeZone(),
    supportedTimeZones()
  );
}

function loadWorldClocks() {
  const preferences = readPreferences();
  const stored = preferences.worldClocks;
  const storedMenuBar = preferences.menuBarTimeZone;
  worldClocks = normalizeWorldClocks(stored, supportedTimeZones());
  menuBarTimeZone = normalizeMenuBarTimeZone(
    storedMenuBar,
    worldClocks.items,
    defaultLocalTimeZone(),
    supportedTimeZones()
  );

  // Only a missing key means first run / an older install. An explicit empty
  // list is the user's choice and is never re-seeded. Also clear an invalid or
  // no-longer-present menu-bar zone so it does not come back after restart.
  const needsSeed = stored === undefined;
  const menuBarChanged = (storedMenuBar ?? null) !== (menuBarTimeZone ?? null);
  if (needsSeed || menuBarChanged) {
    const next = { ...preferences, worldClocks };
    if (menuBarTimeZone) {
      next.menuBarTimeZone = menuBarTimeZone;
    } else {
      delete next.menuBarTimeZone;
    }
    writePreferences(next);
  }
}

function persistWorldClockPreferences() {
  const preferences = readPreferences();
  const next = { ...preferences, worldClocks };
  if (menuBarTimeZone) {
    next.menuBarTimeZone = menuBarTimeZone;
  } else {
    delete next.menuBarTimeZone;
  }
  writePreferences(next);
}

function persistWorldClocks() {
  persistWorldClockPreferences();
}

function currentClockSnapshot(now = new Date()) {
  const item = worldClocks.items[worldClocks.index] || null;
  const resolvedZone = resolvedMenuBarTimeZone();
  const formatted = item ? formatClock(now, item.id) : null;

  return {
    items: worldClocks.items.map((clock) => ({ id: clock.id, label: clock.label })),
    index: worldClocks.index,
    // Resolved IANA id actually used for the tray title (falls back to the
    // system local zone when unset/invalid or the selected clock was removed).
    menuBarTimeZone: resolvedZone,
    current: item && formatted
      ? {
          id: item.id,
          label: item.label,
          time: formatted.time,
          date: formatted.date,
          weekday: formatted.weekday,
          isMenuBar: sameTimeZone(item.id, resolvedZone)
        }
      : null
  };
}

function commitWorldClocks(next) {
  if (next && next !== worldClocks) {
    worldClocks = next;
    persistWorldClocks();
  }
  return currentClockSnapshot();
}

// Update notices are keyed by the release name from the Squirrel feed so a
// single release never produces the same reminder on every launch.
function hasUpdateNotification(key) {
  const notifications = readPreferences().updateNotifications;
  return Boolean(notifications && typeof notifications === 'object' &&
    notifications[key] === true);
}

function markUpdateNotification(key) {
  const preferences = readPreferences();
  const notifications = preferences.updateNotifications &&
    typeof preferences.updateNotifications === 'object'
    ? { ...preferences.updateNotifications }
    : {};
  notifications[key] = true;
  writePreferences({ ...preferences, updateNotifications: notifications });
}

// First launch only: try to turn on the login item and remember that the
// attempt was made. applyLoginItem falls back to a LaunchAgent when the system
// API is rejected (unsigned builds), so the persisted flag matches the real
// effective state.
function initializeLoginItem() {
  const preferences = readPreferences();
  if (preferences.loginItemInitialized === true) return;

  applyLoginItem(true);
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

  calendarWindow.webContents.on('did-finish-load', () => {
    sendUpdateNotice();
  });

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
  // Text-only status item. Tray still requires a NativeImage; an empty image
  // occupies 0x0 and does not use trayTemplate.png. macOS/Electron still add
  // their own small NSStatusItem padding around the title, and there is no
  // public API to remove that, so no private API or zero-width characters are
  // used here.
  tray = new Tray(nativeImage.createEmpty());

  tray.on('mouse-enter', openCalendar);
  tray.on('mouse-leave', scheduleClose);
  tray.on('click', () => {
    if (!calendarWindow || calendarWindow.isDestroyed()) return;
    if (!calendarWindow.isVisible()) openCalendar();
  });
}

function sendUpdateNotice() {
  if (!updateNotice || !calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('update:notice', updateNotice);
}

function showUpdateNotice(notice) {
  updateNotice = notice;
  sendUpdateNotice();
}

function sendUpdateStatus(status) {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('update:status', status);
}

function setupWeatherPermissions() {
  const ses = session.defaultSession;
  const isOurWindow = (webContents) =>
    Boolean(calendarWindow) && webContents === calendarWindow.webContents;

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation' && isOurWindow(webContents));
  });
  ses.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'geolocation' && isOurWindow(webContents);
  });
}

function setupWeather() {
  weatherService = createWeatherService({
    fetch: (url, init) => net.fetch(url, init),
    logger: {
      info: (message) => logger.info('[栏历] 天气：' + message),
      warn: (message) => logger.warn('[栏历] 天气：' + message)
    }
  });
  locationPermission = createLocationPermission({
    platform: process.platform,
    isPackaged: app.isPackaged,
    logger: {
      info: (message) => logger.info('[栏历] 天气：' + message),
      warn: (message) => logger.warn('[栏历] 天气：' + message)
    }
  });
  weatherTimer = setInterval(() => {
    refreshWeather(true);
  }, WEATHER_REFRESH_MS);
}

// Native location authorization is requested once, lazily, before the first
// weather refresh. The result is memoized so subsequent refreshes never prompt
// again; denied/restricted settle to the IP path without re-asking.
function ensureLocationAuthorized() {
  if (!locationPermission) {
    return Promise.resolve({ action: 'system', status: 'unavailable', log: '' });
  }
  if (!locationAuthPromise) {
    locationAuthPromise = locationPermission.ensureAuthorized();
  }
  return locationAuthPromise;
}

function sendWeather(result) {
  if (!result || !calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('weather:update', result);
}

function refreshWeather(force = false) {
  if (!weatherService) return Promise.resolve(null);
  return weatherService.refresh({ force }).then((result) => {
    if (result) sendWeather(result);
    return result;
  }).catch((error) => {
    logger.warn('[栏历] 天气：刷新失败：' +
      (error && error.message ? error.message : error));
    return null;
  });
}

function handleUpdateStatus(status) {
  // Automatic startup and 6-hour checks stay silent; only a click on the
  // always-visible entry gets the short state feedback.
  if (!status || status.manual !== true) return;
  sendUpdateStatus(describeStatus(status));
}

function isAllowedUpdateUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith('/allen-bot-ctl/lan-li/');
  } catch {
    return false;
  }
}

function setupUpdates() {
  try {
    selfUpdater = createMacSelfUpdater({
      appVersion: app.getVersion(),
      arch: process.arch,
      platform: process.platform,
      isPackaged: app.isPackaged === true,
      execPath: process.execPath,
      fs: originalFs,
      fetch: (url, init) => net.fetch(url, init),
      logger: (message) => logger.info('[栏历] 自更新：' + message),
      getLogsPath: () => app.getPath('logs'),
      pid: process.pid,
      quit: () => {
        app.quit();
        // A tray app can occasionally keep a native handle alive after quit.
        // The installer is already detached, so force an exit as a last resort
        // after giving app.quit() a short chance to finish cleanly.
        setTimeout(() => {
          try {
            app.exit(0);
          } catch {
            // Process already gone.
          }
        }, 3000);
      }
    });
  } catch (error) {
    selfUpdater = null;
    const reason = error && error.message ? error.message : String(error);
    logger.error('[栏历] 初始化应用内自更新失败：' + reason);
  }

  try {
    updater = setupAutoUpdate({
      app,
      autoUpdater,
      net,
      selfUpdate: selfUpdater,
      onReady: ({ name, mode }) => {
        logger.info('[栏历] 新版本已下载：' + (name || '未知版本'));
        const notice = { mode: 'ready', name };
        if (mode === 'ready-self') notice.selfUpdate = true;
        showUpdateNotice(notice);
      },
      onManual: ({ name, url }) => {
        logger.warn('[栏历] 无法自动应用更新' +
          (name ? '（' + name + '）' : '') + '，改为提示手动下载。');
        showUpdateNotice({
          mode: 'manual',
          name,
          url: isAllowedUpdateUrl(url) ? url : RELEASES_LATEST_URL,
          homepage: HOMEPAGE_URL
        });
      },
      onStatus: handleUpdateStatus,
      isNotified: hasUpdateNotification,
      markNotified: markUpdateNotification,
      logger: (message) => logger.info('[栏历] 更新：' + message)
    });
    updateSetupError = null;
  } catch (error) {
    updater = null;
    updateSetupError = error && error.message ? error.message : String(error);
    logger.error('[栏历] 初始化自动更新失败：' + updateSetupError);
  }
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
  refreshWeather();
  sendUpdateNotice();
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
    const title = formatMenuTitleInZone(now, resolvedMenuBarTimeZone(), defaultLocalTimeZone()) ||
      formatMenuTitle(now);
    tray.setTitle(title, { fontType: 'monospacedDigit' });
  }

  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    calendarWindow.webContents.send('calendar:onTick', {
      almanac: buildAlmanac(now),
      clocks: currentClockSnapshot(now)
    });
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
  ipcMain.handle('app:version', () => formatVersionLabel(app.getVersion()));

  ipcMain.handle('weather:get', (_event, payload, location) => {
    if (!weatherService) return unavailableWeather();
    return weatherService.get(payload, location);
  });

  ipcMain.handle('weather:location', async () => {
    try {
      const decision = await ensureLocationAuthorized();
      if (decision && decision.action === 'ip') {
        return { mode: 'ip', reason: decision.status };
      }
      return { mode: 'system' };
    } catch {
      return { mode: 'system' };
    }
  });

  ipcMain.handle('calendar:getState', () => buildState());

  ipcMain.handle('calendar:setView', (_event, payload) => applyViewPayload(payload));

  ipcMain.handle('calendar:goToday', () => {
    resetViewToToday();
    return buildState();
  });

  ipcMain.handle('clocks:add', (_event, payload) => {
    return commitWorldClocks(addClock(worldClocks, payload, supportedTimeZones()));
  });

  ipcMain.handle('clocks:remove', (_event, payload) => {
    const previous = worldClocks;
    const next = removeClock(worldClocks, payload);
    if (next === previous) return currentClockSnapshot();

    // Determine which id was actually removed so we only clear the menu-bar
    // selection when that specific clock (or its alias-equivalent) is gone.
    let removedId = null;
    if (typeof payload === 'string') {
      removedId = payload;
    } else if (payload && typeof payload === 'object' && typeof payload.id === 'string') {
      removedId = payload.id;
    } else {
      const removeIndex = payload && Number.isInteger(payload.index)
        ? payload.index
        : previous.index;
      const removedItem = previous.items[removeIndex];
      removedId = removedItem ? removedItem.id : null;
    }

    worldClocks = next;
    menuBarTimeZone = nextMenuBarTimeZoneAfterRemove(
      menuBarTimeZone,
      removedId,
      worldClocks.items,
      defaultLocalTimeZone()
    );
    persistWorldClockPreferences();
    updateClock();
    return currentClockSnapshot();
  });

  ipcMain.handle('clocks:setMenuBar', (_event, payload) => {
    const id = payload && typeof payload.id === 'string'
      ? payload.id.trim()
      : (worldClocks.items[worldClocks.index] && worldClocks.items[worldClocks.index].id);
    if (!id) return currentClockSnapshot();

    const target = worldClocks.items.find((item) => sameTimeZone(item.id, id));
    if (!target) return currentClockSnapshot();

    menuBarTimeZone = normalizeMenuBarTimeZone(
      target.id,
      worldClocks.items,
      defaultLocalTimeZone(),
      supportedTimeZones()
    );
    persistWorldClockPreferences();
    updateClock();
    return currentClockSnapshot();
  });

  ipcMain.handle('clocks:select', (_event, payload) => {
    return commitWorldClocks(selectClock(worldClocks, payload));
  });

  ipcMain.handle('clocks:search', (_event, payload) => {
    const query = payload && typeof payload.query === 'string' ? payload.query : '';
    return searchCatalog(query, {
      supportedValuesOf: supportedTimeZones(),
      addedIds: worldClocks.items.map((clock) => clock.id)
    });
  });

  ipcMain.on('pointer:enter', () => {
    cancelClose();
  });

  ipcMain.on('pointer:leave', () => {
    scheduleClose();
  });

  ipcMain.handle('login:set', (_event, openAtLogin) => {
    return applyLoginItem(Boolean(openAtLogin));
  });

  ipcMain.on('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('update:check', () => {
    if (!updater) {
      const reason = updateSetupError || 'updater not initialized';
      logger.warn('update:check but updater unavailable: ' + reason);
      return describeStatus({ state: 'error' });
    }
    return describeStatus(updater.checkNow({ manual: true }));
  });

  ipcMain.on('update:restart', () => {
    if (!updateNotice || updateNotice.mode !== 'ready') return;

    if (updateNotice.selfUpdate) {
      if (!selfUpdater) {
        logger.warn('[栏历] 自更新安装器不可用，无法启动安装。');
        return;
      }
      let outcome;
      try {
        outcome = selfUpdater.installReady();
      } catch (error) {
        outcome = {
          ok: false,
          reason: error && error.message ? error.message : String(error)
        };
      }
      if (!outcome.ok) {
        logger.warn('[栏历] 启动自更新安装失败：' + outcome.reason);
      }
      return;
    }

    // Real autoUpdater downloads still use Squirrel.Mac's installer.
    autoUpdater.quitAndInstall();
  });

  ipcMain.on('update:openLatest', () => {
    const target = updateNotice && isAllowedUpdateUrl(updateNotice.url)
      ? updateNotice.url
      : RELEASES_LATEST_URL;
    shell.openExternal(target).catch((error) => {
      logger.warn('[栏历] 打开更新下载地址失败：' +
        (error && error.message ? error.message : error));
    });
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
  loadWorldClocks();
  setupWeatherPermissions();
  setupWeather();
  registerIpc();
  createCalendarWindow();
  createTray();
  registerDisplayListeners();
  setupUpdates();

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
    if (updater) {
      updater.stop();
      updater = null;
    }
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (weatherTimer) {
      clearInterval(weatherTimer);
      weatherTimer = null;
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
