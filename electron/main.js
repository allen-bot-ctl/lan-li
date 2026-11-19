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
  powerMonitor
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
  configureAlmanacStyles,
  configureAlmanacFocus,
  buildAlmanac,
  buildViewSubtitle,
  parseDateKey
} = require('./calendar');
const {
  isStyleId,
  readAlmanacStyle
} = require('./almanac-styles');
const { setupAutoUpdate } = require('./updater');
const { createMacSelfUpdater } = require('./mac-self-update');
const { createLogger } = require('./logger');
const { describeStatus } = require('./update-status');
const { formatVersionLabel } = require('./app-version');
const {
  supportedTimeZoneList,
  defaultLocalTimeZone,
  sameTimeZone,
  formatClockTime,
  describeClockRelative,
  formatMenuTitleInZone,
  formatTrayTooltipInZone,
  resolveMenuBarTimeZone,
  normalizeMenuBarTimeZone,
  nextMenuBarTimeZoneAfterRemove,
  normalizeWorldClocks,
  addClock,
  removeClock,
  searchCatalog
} = require('./world-clocks');
const { buildSettingsMenuTemplate } = require('./settings-menu');
const { computePanelBounds } = require('./window-layout');
const {
  RELEASES_LATEST_URL,
  HOMEPAGE_URL
} = require('./update-feed');
const {
  CACHE_TTL_MS: WEATHER_REFRESH_MS,
  createWeatherService,
  normalizeWeatherCity,
  readWeatherCity,
  writeWeatherCity,
  unavailableWeather
} = require('./weather');
const {
  findQuickCities,
  sameCity
} = require('./quick-cities');
const { createLoginItem } = require('./login-item');
const { createWeatherRefresher } = require('./weather-refresh');

const WINDOW_WIDTH = 580;
// 0.1.24's 400px content plus the 32px full-width top bar.
const WINDOW_HEIGHT = 432;

// Playwright drives a real Electron process on Linux and macOS CI. Only this
// explicit opt-in exposes the tray/window test hooks; packaged runs never do.
const E2E = process.env.LANLI_E2E === '1';

let tray = null;
let menuBarShowDate = true;
let lastTrayTitle = '';
let lastTrayTooltip = '';
let e2eLoginOpen = false;
const e2eLoginCalls = [];
let calendarWindow = null;
let clockTimer = null;
let closeTimer = null;
let settingsMenuOpen = false;
// E2E-only probe: records the anchor actually received for the settings menu.
let e2eLastSettingsAnchor = null;
let e2eSettingsMenu = null;
let settingsViewOpen = false;
// Pinned is deliberately in-memory only: hiding or restarting clears it.
let pinned = false;
let updater = null;
let selfUpdater = null;
let updateSetupError = null;
let updateNotice = null;
let weatherService = null;
let weatherTimer = null;
let weatherRefresher = null;
let e2eWeatherFail = false;
let e2eWeatherRefreshCalls = [];
let loginItem = null;
let almanacStyleCatalog = null;
let almanacStyle = 'lunar';

const logger = createLogger();

let view = null;
let focus = null;
// 0.1.30：窗口每次从隐藏到显示 +1，渲染层据此把黄历选中日期回到今天。
let openSeq = 0;
// E2E-only：固定「现在」，用来验证跨午夜；正式运行恒为 null。
let e2eNow = null;

function currentNow() {
  return e2eNow ? new Date(e2eNow) : new Date();
}
let worldClocks = { items: [], index: 0 };
// Stored IANA id for the menu-bar display zone. null/omitted means follow the
// system local zone. The renderer never reads or writes preferences directly.
let menuBarTimeZone = null;

function todayParts() {
  const now = currentNow();
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
  const now = currentNow();
  return {
    view: { year: view.year, month: view.month },
    focus: { year: focus.year, month: focus.month, day: focus.day },
    cells: buildCells(view.year, view.month, now),
    almanac: buildAlmanac(now, almanacStyle),
    // 0.1.26：副标题跟随所显示的月份，与黄历卡（仍按今天）分开下发。
    viewSubtitle: buildViewSubtitle(view.year, view.month, now),
    clocks: currentClockSnapshot(now),
    openSeq,
    pinned
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

function readMenuBarShowDate(preferences) {
  return !(preferences && preferences.menuBarShowDate === false);
}

function setMenuBarShowDate(value) {
  menuBarShowDate = Boolean(value);
  writePreferences({ ...readPreferences(), menuBarShowDate });
  updateClock();
  return menuBarShowDate;
}

function initializeAlmanacStyle() {
  almanacStyleCatalog = configureAlmanacStyles({ logger });
  configureAlmanacFocus({ logger });
  almanacStyle = readAlmanacStyle(readPreferences());
  menuBarShowDate = readMenuBarShowDate(readPreferences());
}

function persistWorldClocks() {
  const preferences = readPreferences();
  const next = { ...preferences, worldClocks };
  if (menuBarTimeZone) {
    next.menuBarTimeZone = menuBarTimeZone;
  } else {
    delete next.menuBarTimeZone;
  }
  writePreferences(next);
}

function currentClockSnapshot(now = new Date()) {
  const resolvedZone = resolvedMenuBarTimeZone();
  const localZone = defaultLocalTimeZone();

  return {
    // Every saved city is listed at once; the renderer never pages between
    // zones. Relative labels and wall-clock times are computed here so the
    // renderer does not touch Intl/time zones.
    items: worldClocks.items.map((clock) => {
      const relative = describeClockRelative(now, clock.id, localZone);
      return {
        id: clock.id,
        label: clock.label,
        time: formatClockTime(now, clock.id),
        relativeText: relative ? relative.text : '',
        isMenuBar: sameTimeZone(clock.id, resolvedZone)
      };
    })
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
      if (settingsViewOpen) {
        settingsViewOpen = false;
        sendPanel('calendar');
      } else {
        hideCalendar();
      }
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
  try {
    tray = new Tray(nativeImage.createEmpty());
  } catch (error) {
    // A headless Linux CI box may have no status-item implementation. The
    // calendar window itself still works, and tray events are simulated
    // through the E2E hooks, so only fail loudly outside E2E.
    if (!E2E) throw error;
    tray = null;
    logger.warn('[栏历] 测试环境无法创建托盘：' + reasonOf(error));
    return;
  }

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

function setupWeather() {
  weatherService = createWeatherService({
    fetch: (url, init) => (E2E && e2eWeatherFail ? Promise.reject(new Error('offline')) : net.fetch(url, init)),
    weatherCity: readWeatherCity(readPreferences()),
    logger: {
      info: (message) => logger.info('[栏历] 天气：' + message),
      warn: (message) => logger.warn('[栏历] 天气：' + message)
    }
  });
  weatherRefresher = createWeatherRefresher({ refresh: (force) => refreshWeather(force) });
  weatherTimer = setInterval(() => {
    weatherRefresher.run(true);
  }, WEATHER_REFRESH_MS);
  try {
    powerMonitor.on('resume', () => weatherRefresher.onResume());
    powerMonitor.on('unlock-screen', () => weatherRefresher.onResume());
  } catch (error) {
    logger.warn('[栏历] 天气：注册唤醒监听失败：' + (error && error.message ? error.message : error));
  }
}

function sendWeather(result) {
  if (!result || !calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('weather:update', result);
}

function refreshWeather(force = false) {
  if (E2E) e2eWeatherRefreshCalls.push(Boolean(force));
  if (!weatherService) return Promise.resolve(null);
  return weatherService.refresh({ force }).then((result) => {
    if (result) {
      if (weatherRefresher) weatherRefresher.handleResult(result);
      sendWeather(result);
    }
    return result;
  }).catch((error) => {
    logger.warn('[栏历] 天气：刷新失败：' +
      (error && error.message ? error.message : error));
    return null;
  });
}

function handleUpdateStatus(status) {
  // Automatic startup and 6-hour checks stay silent; only a manual menu click
  // gets the short state feedback (shown in the update banner area).
  if (!status || status.manual !== true) return;
  sendUpdateStatus(describeStatus(status));
}

function performUpdateCheck() {
  if (!updater) {
    const reason = updateSetupError || 'updater not initialized';
    logger.warn('update check but updater unavailable: ' + reason);
    return describeStatus({ state: 'error' });
  }
  return describeStatus(updater.checkNow({ manual: true }));
}

// The settings menu runs the existing update check without a renderer round
// trip. Updater statuses are pushed through onStatus; only the unavailable
// path needs an explicit message.
function requestUpdateCheck() {
  const status = performUpdateCheck();
  if (!updater) sendUpdateStatus(status);
}

function sendPanel(panel) {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('ui:openPanel', panel);
}

function pointerInsideWindow() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return false;
  const point = screen.getCursorScreenPoint();
  const bounds = calendarWindow.getBounds();
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

// The renderer sends the settings button's left edge and bottom + 4. Electron's
// popup takes the menu's top-left corner, so use that point as-is.
function settingsMenuAnchor(position) {
  const x = Number(position && position.x);
  const y = Number(position && position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.round(y)
  };
}

function openSettingsMenu(event, position) {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) return;

  cancelClose();
  settingsMenuOpen = true;

  // Actions that open a panel or show update feedback keep the panel visible
  // after the native menu closes. Dismissing the menu without one of those
  // falls back to the normal pointer-outside close.
  let keepWindowOpen = false;

  const template = buildSettingsMenuTemplate(
    {
      version: formatVersionLabel(app.getVersion()),
      openAtLogin: getOpenAtLogin()
    },
    {
      checkUpdate: () => {
        keepWindowOpen = true;
        requestUpdateCheck();
      },
      setOpenAtLogin: (value) => {
        applyLoginItem(Boolean(value));
      },
      openAlmanacStyles: () => {
        keepWindowOpen = true;
        sendPanel('almanac');
      },
      openClocks: () => {
        keepWindowOpen = true;
        sendPanel('clocks');
      },
      openWeather: () => {
        keepWindowOpen = true;
        sendPanel('weather');
      },
      openMore: () => { keepWindowOpen = true; sendPanel('settings'); },
      quit: () => app.quit()
    }
  );

  const menu = Menu.buildFromTemplate(template);
  const anchor = settingsMenuAnchor(position);
  if (E2E) {
    e2eLastSettingsAnchor = anchor;
    e2eSettingsMenu = menu;
  }
  const options = { window: target };
  if (anchor) {
    options.x = anchor.x;
    options.y = anchor.y;
  }
  options.callback = () => {
    settingsMenuOpen = false;
    if (!keepWindowOpen && !pointerInsideWindow()) scheduleClose();
  };
  menu.popup(options);
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
  // Pinned windows ignore tray mouse-leave and window pointer-leave until the
  // user unpins (× or Esc) or the window is hidden by another path.
  if (pinned) return;
  // A native settings menu floats above the window; pointer-leave would
  // otherwise hide the calendar while the user is still choosing an item.
  if (settingsMenuOpen) return;
  closeTimer = setTimeout(hideCalendar, 200);
}

function positionCalendar() {
  if (!tray || !calendarWindow || calendarWindow.isDestroyed()) return;

  const bounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;

  // Align with no overlap by default. On a real Mac, if a pointer-passable
  // gap appears between the menu bar and the panel, the tray bounds bottom is
  // still the intended anchor. computePanelBounds clamps the result so the
  // 432px-tall window always stays inside the work area.
  const target = computePanelBounds(bounds, area, WINDOW_WIDTH, WINDOW_HEIGHT);
  calendarWindow.setBounds(target);
}

function openCalendar() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;

  cancelClose();
  const wasVisible = calendarWindow.isVisible();

  if (!wasVisible) {
    openSeq += 1;
    resetViewToToday();
    positionCalendar();
    calendarWindow.show();
  } else {
    positionCalendar();
  }

  updateClock();
  if (!weatherRefresher || !weatherRefresher.onWindowShow()) refreshWeather();
  sendUpdateNotice();
}

function hideCalendar() {
  cancelClose();
  settingsViewOpen = false;
  // Hiding always ends the pinned session; the next tray hover reopens in the
  // default unpinned state, as required (nothing is persisted).
  const wasPinned = pinned;
  pinned = false;
  if (wasPinned) sendPinState();
  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    sendPanel('calendar');
    calendarWindow.hide();
  }
}

function sendPinState() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('pin:state', { pinned });
}

function updateClock() {
  const now = currentNow();

  if (tray) {
    const zone = resolvedMenuBarTimeZone(); const local = defaultLocalTimeZone();
    const title = formatMenuTitleInZone(now, zone, local, { showDate: menuBarShowDate }) || formatMenuTitle(now, { showDate: menuBarShowDate });
    const tooltip = formatTrayTooltipInZone(now, zone, local);
    tray.setTitle(title, { fontType: 'monospacedDigit' });
    if (tooltip && typeof tray.setToolTip === 'function') tray.setToolTip(tooltip);
    lastTrayTitle = title; lastTrayTooltip = tooltip;
  }

  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    calendarWindow.webContents.send('calendar:onTick', {
      almanac: buildAlmanac(now, almanacStyle),
      viewSubtitle: buildViewSubtitle(view.year, view.month, now),
      clocks: currentClockSnapshot(now),
      openSeq
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

  ipcMain.handle('settings:get', () => ({ openAtLogin: getOpenAtLogin(), menuBarShowDate, version: app.getVersion() }));
  ipcMain.handle('settings:setOpenAtLogin', (_e, value) => applyLoginItem(Boolean(value)));
  ipcMain.handle('settings:setMenuBarShowDate', (_e, value) => setMenuBarShowDate(value));
  ipcMain.on('settings:viewState', (_e, open) => { settingsViewOpen = Boolean(open); });

  ipcMain.handle('weather:get', () => {
    if (!weatherService) return unavailableWeather();
    return weatherService.get();
  });

  ipcMain.handle('weather:refresh', () => refreshWeather(true));

  ipcMain.handle('weather:searchCity', async (_event, query) => {
    if (!weatherService) return [];
    try {
      return await weatherService.searchCity(query);
    } catch (error) {
      logger.warn('[栏历] 天气：城市搜索失败：' +
        (error && error.message ? error.message : error));
      return [];
    }
  });

  // Built-in quick cities follow the same country source as the weather card:
  // a saved manual city's country, or the IP country for automatic mode.
  ipcMain.handle('weather:quickCities', async () => {
    const manual = readWeatherCity(readPreferences());
    let country = manual ? manual.country || '' : '';
    if (!manual && weatherService) {
      try {
        const current = await weatherService.getCountry();
        country = current.countryCode || current.country;
      } catch {
        country = '';
      }
    }

    const group = findQuickCities(country);
    if (!group) return { country: '', countryCode: '', cities: [] };
    return {
      country: group.country,
      countryCode: group.code,
      cities: group.cities.map((city) => ({
        ...city,
        label: [city.name, city.admin1, city.country].filter(Boolean).join(' · '),
        selected: sameCity(city, manual)
      }))
    };
  });

  // Save first and return immediately; the refresh runs in the background and
  // pushes the new result to the renderer via weather:update, so the panel
  // never waits on the network after a city click.
  ipcMain.handle('weather:setCity', (_event, city) => {
    const normalized = normalizeWeatherCity(city);
    writePreferences(writeWeatherCity(readPreferences(), normalized));
    if (!weatherService) return unavailableWeather();
    weatherService.setCity(normalized);
    refreshWeather(true);
    return normalized || null;
  });

  ipcMain.handle('calendar:getState', () => buildState());

  ipcMain.handle('almanac:getStyles', () => {
    if (!almanacStyleCatalog) initializeAlmanacStyle();
    return almanacStyleCatalog.list(almanacStyle);
  });

  ipcMain.handle('almanac:setStyle', (_event, id) => {
    // Invalid ids never touch preferences or the in-memory selection.
    if (!isStyleId(id)) return { ok: false };
    if (!almanacStyleCatalog) initializeAlmanacStyle();

    // Selecting the current style closes the panel in the renderer without a
    // disk write, so only a real change is persisted.
    if (id !== almanacStyle) {
      almanacStyle = id;
      writePreferences({ ...readPreferences(), almanacStyle });
    }

    return { ok: true, almanac: buildAlmanac(currentNow(), almanacStyle) };
  });

  // 0.1.30：黄历跟随选中日期，渲染层传 YYYY-MM-DD；非法日期返回 null。
  ipcMain.handle('almanac:getForDate', (_event, key) => {
    const date = parseDateKey(key);
    return date ? buildAlmanac(date, almanacStyle) : null;
  });

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
    persistWorldClocks();
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
    persistWorldClocks();
    updateClock();
    return currentClockSnapshot();
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

  // The renderer toggles one in-memory flag. Unpinning hides immediately so
  // ×, Esc and a real hide all leave the same unpinned state behind.
  ipcMain.handle('pin:toggle', () => {
    if (pinned) {
      hideCalendar();
    } else {
      pinned = true;
      cancelClose();
      sendPinState();
    }
    return { pinned };
  });

  ipcMain.on('menu:openSettings', (event, position) => {
    openSettingsMenu(event, position);
  });

  // Footer 「检查更新」 reuses the settings menu path and the same
  // update:status feedback, so there is only one update-check implementation.
  ipcMain.on('update:check', () => {
    requestUpdateCheck();
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

// Playwright cannot drive native tray geometry on a headless CI box, so the
// real tray handlers are called through these hooks instead. Registered only
// when LANLI_E2E=1; production processes expose nothing.
function registerE2eHooks() {
  if (!E2E) return;
  app.setLoginItemSettings = (settings) => { e2eLoginCalls.push({ ...settings }); e2eLoginOpen = Boolean(settings && settings.openAtLogin); };
  app.getLoginItemSettings = () => ({ openAtLogin: e2eLoginOpen });
  globalThis.__lanliTest = {
    trayEnter() {
      openCalendar();
      return Boolean(calendarWindow && !calendarWindow.isDestroyed() &&
        calendarWindow.isVisible());
    },
    trayLeave() {
      scheduleClose();
      return true;
    },
    isVisible() {
      return Boolean(calendarWindow && !calendarWindow.isDestroyed() &&
        calendarWindow.isVisible());
    },
    blur() {
      if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.blur();
      return true;
    },
    isPinned() {
      return pinned;
    },
    lastSettingsAnchor() {
      return e2eLastSettingsAnchor;
    },
    closeSettingsMenu() {
      if (e2eSettingsMenu && typeof e2eSettingsMenu.closePopup === 'function') {
        e2eSettingsMenu.closePopup();
      }
      e2eSettingsMenu = null;
      return true;
    },
    clickSettingsMenuItem(id) { const item = e2eSettingsMenu && e2eSettingsMenu.getMenuItemById(id); if (!item) return false; item.click(); return true; },
    emitUpdateStatus(status) {
      sendUpdateStatus(status);
      return true;
    },
    setNow(iso) {
      e2eNow = typeof iso === 'string' ? iso : null;
      updateClock();
      return true;
    },
    emitUpdateNotice(notice) {
      showUpdateNotice(notice);
      return true;
    },
    trayTitle() { return lastTrayTitle; },
    trayTooltip() { return lastTrayTooltip; },
    loginItemCalls() { return e2eLoginCalls.slice(); },
    menuBarZone() { return resolvedMenuBarTimeZone() || defaultLocalTimeZone(); },
    settingsMenuItems() { return buildSettingsMenuTemplate({ version: formatVersionLabel(app.getVersion()), openAtLogin: getOpenAtLogin() }, {}).map((i) => ({ id: i.id || null, type: i.type || 'normal', label: i.label || '', checked: i.checked === true })); },
    setWeatherFail(v) { e2eWeatherFail = Boolean(v); return true; },
    weatherRefreshCalls() { return e2eWeatherRefreshCalls.slice(); },
    triggerResume() { if (weatherRefresher) weatherRefresher.onResume(); return true; },
    refreshWeatherNow() { return refreshWeather(true).then((r) => r); },
    hideWindow() { hideCalendar(); return true; }
  };
}

async function bootstrap() {
  if (process.platform !== 'darwin' && !E2E) {
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
  initializeAlmanacStyle();
  setupWeather();
  registerIpc();
  createCalendarWindow();
  createTray();
  registerDisplayListeners();
  setupUpdates();
  registerE2eHooks();

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
