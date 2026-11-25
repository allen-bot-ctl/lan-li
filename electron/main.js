'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  ipcMain,
  dialog,
  clipboard,
  autoUpdater,
  net,
  shell,
  powerMonitor,
  globalShortcut,
  desktopCapturer,
  systemPreferences,
  session
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
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
  formatCompactTrayClock,
  formatTrayTooltipInZone,
  resolveMenuBarTimeZone,
  normalizeMenuBarTimeZone,
  nextMenuBarTimeZoneAfterRemove,
  normalizeWorldClocks,
  addClock,
  removeClock,
  searchCatalog
} = require('./world-clocks');
const { buildTrayMenuTemplate } = require('./settings-menu');
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
const { readTrayClockStyle, initialTrayClockStyle, nextTrayClockStyle } = require('./tray-clock-style');
const { buildAtlas, createClockImageMaker, createCompactClockImageMaker } = require('./tray-clock-image');
const { createInboxController, frontAppName } = require('./inbox-main');
const { createRegionController } = require('./region-capture');
const { createReaderController } = require('./reader-main');
const { normalizeAccelerator } = require('./region-helpers');
const { readInboxDateLinkEnabled, writeInboxDateLinkEnabled } = require('./inbox-date-link');

const WINDOW_WIDTH = 580;
// 0.1.24's 400px content plus the 32px full-width top bar.
const WINDOW_HEIGHT = 432;

// Playwright drives a real Electron process on Linux and macOS CI. Only this
// explicit opt-in exposes the tray/window test hooks; packaged runs never do.
const E2E = process.env.LANLI_E2E === '1';
if (E2E && process.env.LANLI_E2E_USER_DATA_DIR) {
  const dir = path.resolve(process.env.LANLI_E2E_USER_DATA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
}

let tray = null;
let trayClockStyle = readTrayClockStyle();
let makeCompactClockImage = null;
let lastTrayFrameKey = '';
let e2eTrayFrame = null;
let lastTrayTitle = '';
let makeClockImage = null; // v0.1.38: null until the glyph atlas is ready; falls back to setTitle
let lastTrayTooltip = '';
let e2eLoginOpen = false;
const e2eLoginCalls = [];
let calendarWindow = null;
let clockTimer = null;
let closeTimer = null;
let settingsViewOpen = false;
let promptAiOpen = false; // 0.1.64 「AI 改提示词」弹框是否开着
let quitConfirmOpen = false; // 0.1.63 设置页「退出栏历」确认框是否开着
// 0.1.40 托盘右键菜单：菜单开着时悬停不开日历；从菜单打开设置后保持打开，
// 直到鼠标进入窗口再离开（或 Esc / 隐藏）。
let trayMenuOpen = false;
let inbox = null; // 0.1.42 收纳
let region = null; // 0.1.50 框选收纳
let inboxViewOpen = false;
let reader = null; // 0.1.60 帮阅
let readerViewOpen = false;
let trayMenuHold = false;
let e2eTrayMenu = null;
let e2eQuitCalls = 0;
// Pinned is deliberately in-memory only: hiding or restarting clears it.
let pinned = false;
// 0.1.62：收纳、帮阅、设置页面自动钉住。subPage 为真时 pinned 已被规则置为 true，pinBeforeSub 记下进入前的值。
let subPage = false;
let pinBeforeSub = false;
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
    return true;
  } catch (error) {
    console.warn('[栏历] 写入偏好文件失败：' + (error && error.message ? error.message : error));
    return false;
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

function setInboxDateLinkEnabled(value) {
  const preferences = readPreferences();
  const result = writeInboxDateLinkEnabled(preferences, value, writePreferences);
  if (result.ok && value !== readInboxDateLinkEnabled(preferences) && calendarWindow && !calendarWindow.isDestroyed()) {
    calendarWindow.webContents.send('settings:inboxDateLinkChanged', value);
  }
  return result;
}

function setTrayClockPreference(key, value) {
  const next = nextTrayClockStyle(trayClockStyle, key, value);
  if (next !== trayClockStyle && writePreferences({ ...readPreferences(), ...next })) {
    trayClockStyle = next;
    updateClock();
  }
  return trayClockStyle[key];
}

function initializeAlmanacStyle() {
  almanacStyleCatalog = configureAlmanacStyles({ logger });
  configureAlmanacFocus({ logger });
  almanacStyle = readAlmanacStyle(readPreferences());
}

// Must precede login-item and clock preference writes. Chromium's own cache
// may already exist on a fresh profile, so check only files owned by LanLi.
function initializeTrayClockStyle() {
  const dir = app.getPath('userData');
  const existing = ['preferences.json', 'inbox', 'read', 'reader-api-key', 'reader-prompt.txt']
    .some(name => fs.existsSync(path.join(dir, name)));
  const saved = readPreferences();
  trayClockStyle = initialTrayClockStyle(saved, existing);
  if (!existing) writePreferences({ ...saved, ...trayClockStyle });
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
        isLocal: Boolean(relative && relative.isLocal),
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
      if (promptAiOpen) {
        calendarWindow.webContents.send('promptai:escape');
      } else if (quitConfirmOpen) {
        // 0.1.63：退出确认框开着时 Esc 只关框（由渲染层关），不退回日历。
        calendarWindow.webContents.send('quit:escape');
      } else if (settingsViewOpen && readerViewOpen) {
        calendarWindow.webContents.send('reader:escape');
      } else if (settingsViewOpen && inboxViewOpen) {
        // 0.1.44：收纳面板里 Esc 先关标签输入框/清空搜索，再退出面板（由渲染层决定）
        calendarWindow.webContents.send('inbox:escape');
      } else if (settingsViewOpen) {
        settingsViewOpen = false;
        setSubPage(false);
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
  tray.on('right-click', () => openTrayMenu());
  if (inbox) inbox.attachTray(tray);
  tray.on('click', () => {
    if (!calendarWindow || calendarWindow.isDestroyed()) return;
    if (!calendarWindow.isVisible()) openCalendar();
  });
}

function buildTrayMenu() {
  const template = buildTrayMenuTemplate({
    checkUpdate: () => { openSettingsFromTray(); requestUpdateCheck(); },
    openSettings: () => openSettingsFromTray(),
    captureClipboard: () => { inbox.captureClipboard({ via: 'tray' }).catch(() => {}); },
    regionCapture: () => { startRegionCapture(); },
    quit: () => quitApp()
  }, { captureAccelerator: hotkeyAccelerator('capture'), regionAccelerator: hotkeyAccelerator('region') });
  const menu = Menu.buildFromTemplate(template);
  menu.on('menu-will-close', () => { trayMenuOpen = false; });
  return menu;
}

function openTrayMenu() {
  hideCalendar();
  trayMenuOpen = true;
  const menu = buildTrayMenu();
  if (E2E) { e2eTrayMenu = menu; return; }
  if (tray) tray.popUpContextMenu(menu);
  trayMenuOpen = false;
}

function openSettingsFromTray() {
  trayMenuOpen = false;
  trayMenuHold = true;
  openCalendar();
  settingsViewOpen = true;
  sendPanel('settings');
}

// 0.1.42 A-C10：托盘「退出栏历」和自更新共用这一个退出函数。
// A tray app can occasionally keep a native handle alive after quit, so
// force an exit as a last resort after giving app.quit() a short chance.
function quitWithFallback() {
  app.quit();
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {
      // Process already gone.
    }
  }, 3000);
}

function quitApp() {
  if (E2E) { e2eQuitCalls += 1; return; }
  quitWithFallback();
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
let e2eUpdateChecks = 0;
let e2eUpdateChecks0 = 0;
function requestUpdateCheck() {
  if (E2E) e2eUpdateChecks += 1;
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
      // The installer is already detached; quitWithFallback force-exits
      // after 3s if app.quit() does not finish cleanly.
      quit: () => quitWithFallback()
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
  if (trayMenuOpen || trayMenuHold) return;
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
  if (trayMenuOpen) return;   // 0.1.40：托盘右键菜单开着时悬停不开日历
  if (inbox && inbox.isVisible()) return;   // 0.1.42：接纳框出现时暂停悬停开日历

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
  trayMenuHold = false;
  settingsViewOpen = false;
  quitConfirmOpen = false;
  if (promptAiOpen) { promptAiOpen = false; if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.webContents.send('promptai:escape'); }
  // Hiding always ends the pinned session; the next tray hover reopens in the
  // default unpinned state, as required (nothing is persisted).
  const wasPinned = pinned;
  pinned = false;
  subPage = false;
  if (wasPinned) sendPinState();
  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) {
    sendPanel('calendar');
    calendarWindow.hide();
  }
}

// 渲染层上报「现在是否在非日历页面」。进入：记下旧值再钉住；‹ 返回日历：恢复旧值。
function setSubPage(open) {
  open = Boolean(open);
  if (open === subPage) return;
  subPage = open;
  if (open) {
    pinBeforeSub = pinned;
    pinned = true;
    cancelClose();
  } else {
    pinned = pinBeforeSub;
  }
  sendPinState();
}

function sendPinState() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  calendarWindow.webContents.send('pin:state', { pinned });
}

function updateClock() {
  const now = currentNow();

  if (tray) {
    const zone = resolvedMenuBarTimeZone(); const local = defaultLocalTimeZone();
    const title = formatMenuTitleInZone(now, zone, local, { showDate: trayClockStyle.menuBarShowDate }) || formatMenuTitle(now, { showDate: trayClockStyle.menuBarShowDate });
    const tooltip = formatTrayTooltipInZone(now, zone, local);
    const face = trayClockStyle.menuBarCompactClock ? formatCompactTrayClock(now, zone, local) : null;
    const dark = Boolean(nativeTheme.shouldUseDarkColors);
    const compact = face && makeCompactClockImage;
    const frameKey = compact ? 'compact:' + dark + ':' + JSON.stringify(face) : 'regular:' + title;
    if (frameKey !== lastTrayFrameKey) {
      const img = compact ? makeCompactClockImage(face, dark) : makeClockImage?.(title);
      if (img) {
        if (process.env.LANLI_DUMP_CLOCK) fs.writeFileSync(process.env.LANLI_DUMP_CLOCK, img.toPNG({ scaleFactor: 2 }));
        tray.setImage(img);
        tray.setTitle('');
      } else {
        tray.setImage(nativeImage.createEmpty());
        tray.setTitle(title, { fontType: 'monospacedDigit' });
      }
      if (E2E) e2eTrayFrame = { face: compact ? face : null, png: compact ? img.toPNG({scaleFactor:2}).toString('base64') : null, png1x: compact ? img.toPNG({scaleFactor:1}).toString('base64') : null, title: img ? '' : title, dark };
      lastTrayFrameKey = frameKey;
    }
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

  ipcMain.handle('settings:get', () => ({ openAtLogin: getOpenAtLogin(), ...trayClockStyle, inboxDateLinkEnabled: readInboxDateLinkEnabled(readPreferences()), captureHotkey: captureHotkeyEnabled(), captureHotkeyBusy: hotkeyState('capture').busy, hotkeys: { capture: hotkeyState('capture'), region: hotkeyState('region') }, version: app.getVersion() }));
  ipcMain.handle('settings:setCaptureHotkey', (_e, value) => setCaptureHotkey(value));
  ipcMain.handle('settings:setHotkey', (_e, a) => setHotkey(a && a.kind, a && a.accelerator));
  ipcMain.handle('settings:setOpenAtLogin', (_e, value) => applyLoginItem(Boolean(value)));
  ipcMain.handle('settings:setMenuBarShowDate', (_e, value) => setTrayClockPreference('menuBarShowDate', value));
  ipcMain.handle('settings:setMenuBarCompactClock', (_e, value) => setTrayClockPreference('menuBarCompactClock', value));
  ipcMain.handle('settings:setInboxDateLinkEnabled', (_e, value) => setInboxDateLinkEnabled(value));
  ipcMain.on('promptai:state', (_e, open) => { promptAiOpen = Boolean(open); });
  ipcMain.on('quit:confirmState', (_e, open) => { quitConfirmOpen = Boolean(open); });
  ipcMain.on('app:quit', () => { quitApp(); });
  ipcMain.on('settings:viewState', (_e, open) => { settingsViewOpen = Boolean(open); setSubPage(open); });
  ipcMain.on('inbox:viewState', (_e, open) => { inboxViewOpen = Boolean(open); });
  ipcMain.on('reader:viewState', (_e, open) => { readerViewOpen = Boolean(open); });

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
    if (!group) return { country: '', countryCode: '', cities: [], manual: Boolean(manual) };
    return {
      manual: Boolean(manual),
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
    trayMenuHold = false;
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
    trayRightClick() { openTrayMenu(); return { menuOpen: trayMenuOpen, visible: Boolean(calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) }; },
    trayMenuItems() { return e2eTrayMenu ? e2eTrayMenu.items.map((i) => ({ id: i.id, label: i.label, type: i.type, accelerator: i.accelerator || null })) : null; },
    clickTrayMenuItem(id) { const item = e2eTrayMenu && e2eTrayMenu.getMenuItemById(id); if (!item) return false; e2eUpdateChecks0 = e2eUpdateChecks; item.click(); trayMenuOpen = false; e2eTrayMenu = null; return true; },
    trayDragEnter() { inbox.show(); return inbox.e2e.state(); },
    trayDragLeave() { return inbox.e2e.leave(); },
    trayDropFiles(files) { return inbox.handleDrop({ files }); },
    trayDropText(text) { return inbox.handleDrop({ text }); },
    inboxDrop(payload) { return inbox.handleDrop(payload); },
    dropzoneState() { return inbox.e2e.state(); },
    lastDropPayload() { return inbox.e2e.lastDrop(); },
    setClipboardData(c) { return inbox.e2e.setClipboard(c); },
    captureClipboard(o) { return inbox.captureClipboard(o || { via: 'hotkey', sourceApp: 'Safari' }); },
    openRegionCapture(o) { return startRegionCapture(o || { sourceApp: 'Safari' }); },
    regionState() { return region.e2e.state(); },
    regionSetPermission(v) { return region.e2e.setPermission(v); },
    regionSetScaleFactor(v) { return region.e2e.setScaleFactor(v); },
    regionOpenCalls() { return region.e2e.openCalls(); },
    regionProbeCalls() { return region.e2e.probeCalls(); },
    regionSetPermissionAfterProbe(v) { return region.e2e.setPermissionAfterProbe(v); },
    regionResetProbeCalls() { return region.e2e.resetProbeCalls(); },
    regionOrder() { return region.e2e.order(); },
    regionDisplay() { const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); return { bounds: d.bounds, scaleFactor: d.scaleFactor }; },
    hotkeys() { return { registered: [...e2eHotkeys.keys()], capture: hotkeyState('capture'), region: hotkeyState('region') }; },
    pressHotkey(acc) { const fn = e2eHotkeys.get(acc); if (!fn) return false; fn(); return true; },
    setBusyAccelerators(list) { e2eBusyAccels.clear(); for (const a of list || []) e2eBusyAccels.add(a); return true; },
    setHotkey(a) { return setHotkey(a.kind, a.accelerator); },
    hideDropzone() { inbox.hide(); return true; },
    inboxRoot() { return inbox.store.root; },
    readerList() { return reader.store.list(); },
    readerSetFakeLlm(f) { return reader.e2e.setFakeLlm(f); },
    readerRewriteStats() { return reader.e2e.rewriteStats(); },
    readerLlmCalls() { return reader.e2e.llmCalls(); },
    readerStatusLog() { return reader.e2e.statusLog(); },
    readerText(id) { return reader.store.readText(id); },
    windowCount() { return BrowserWindow.getAllWindows().length; },
    readerOpenCalls() { return reader.e2e.openCalls(); },
    readerSaveConfig(c) { return reader.keys.save(c); },
    readerRemoveKey() { return reader.keys.removeKey(); },
    readerSubmit(u) { return reader.submit(u); },
    inboxList() { return inbox.store.list(); },
    inboxOpenCalls() { return inbox.e2e.openCalls(); },
    inboxMenuItems() { return inbox.e2e.menuItems(); },
    clickInboxMenuItem(id) { return inbox.e2e.clickMenu(id); },
    openInboxPanel() { openInboxPanel(); return true; },
    openReaderPanel() { trayMenuHold = true; openCalendar(); settingsViewOpen = true; sendPanel('reader'); return true; },
    showWindow() { openCalendar(); return true; },
    windowVisible() { return Boolean(calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()); },
    setClipboardText(t) { clipboard.writeText(String(t)); return true; },
    readClipboardText() { return clipboard.readText(); },
    inboxCopyCalls() { return inbox.e2e.copyCalls(); },
    setInboxRelinkPath(p) { return inbox.e2e.setRelinkPath(p); },
    inboxAddTag(a) { return inbox.store.addTag(a.id, a.tag); },
    inboxIndexPath() { return path.join(inbox.store.root, 'index.json'); },
    clipboardText() { return clipboard.readText(); },
    quitConfirmOpen() { return quitConfirmOpen; },
    promptAiOpen() { return promptAiOpen; },
    trayMenuStats() { return { quitCalls: e2eQuitCalls, updateChecks: e2eUpdateChecks - e2eUpdateChecks0, hold: trayMenuHold }; },
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
    trayClockFrame() { return e2eTrayFrame; },
    trayTooltip() { return lastTrayTooltip; },
    loginItemCalls() { return e2eLoginCalls.slice(); },
    menuBarZone() { return resolvedMenuBarTimeZone() || defaultLocalTimeZone(); },
    setWeatherFail(v) { e2eWeatherFail = Boolean(v); return true; },
    weatherRefreshCalls() { return e2eWeatherRefreshCalls.slice(); },
    triggerResume() { if (weatherRefresher) weatherRefresher.onResume(); return true; },
    refreshWeatherNow() { return refreshWeather(true).then((r) => r); },
    hideWindow() { hideCalendar(); return true; },
    localZone() { return defaultLocalTimeZone(); },
    allQuotes() {
      if (!almanacStyleCatalog) initializeAlmanacStyle();
      const ids = almanacStyleCatalog.list(almanacStyle).map((style) => style.id);
      return ids.map((id) => ({ id, pool: buildAlmanac(currentNow(), id).quotePool || [] }));
    }
  };
}

// 0.1.49：全局快捷键 ⌃⌥V 收纳剪贴板（不用 ⌥⌘V：Finder「移动到这里」）。
// 0.1.50：两个快捷键（收纳剪贴板 / 框选收纳）可改、可清空，存 prefs.captureAccelerator / prefs.regionAccelerator。
// 兼容 0.1.49：captureHotkey === false 且没有 captureAccelerator → 视为已清空。
const HOTKEYS = {
  capture: { pref: 'captureAccelerator', def: 'Control+Alt+V', name: '收纳剪贴板', run: () => { inbox.captureClipboard({ via: 'hotkey' }).catch(() => {}); } },
  region: { pref: 'regionAccelerator', def: 'Control+Alt+S', name: '框选收纳', run: () => { startRegionCapture(); } }
};
const CAPTURE_ACCELERATOR = HOTKEYS.capture.def;
const hotkeyRegistered = { capture: '', region: '' };
const hotkeyBusy = { capture: false, region: false };
const e2eHotkeys = new Map();      // E2E：不碰系统 globalShortcut，记在这里
const e2eBusyAccels = new Set();   // E2E：模拟被占用
function hotkeyAccelerator(kind) {
  const h = HOTKEYS[kind]; const p = readPreferences();
  if (typeof p[h.pref] === 'string') return normalizeAccelerator(p[h.pref]);
  if (kind === 'capture' && p.captureHotkey === false) return '';
  return h.def;
}
function captureHotkeyEnabled() { return hotkeyAccelerator('capture') !== ''; }
function hotkeyState(kind) { return { accelerator: hotkeyAccelerator(kind), busy: hotkeyBusy[kind] }; }
function shortcutRegister(acc, fn) {
  if (E2E) { if (e2eBusyAccels.has(acc) || e2eHotkeys.has(acc)) return false; e2eHotkeys.set(acc, fn); return true; }
  try { return globalShortcut.register(acc, fn); } catch { return false; }
}
function shortcutUnregister(acc) {
  if (E2E) { e2eHotkeys.delete(acc); return; }
  try { globalShortcut.unregister(acc); } catch { /* ignore */ }
}
function registerHotkey(kind) {
  if (hotkeyRegistered[kind]) { shortcutUnregister(hotkeyRegistered[kind]); hotkeyRegistered[kind] = ''; }
  hotkeyBusy[kind] = false;
  const acc = hotkeyAccelerator(kind);
  if (!acc) return;
  if (shortcutRegister(acc, HOTKEYS[kind].run)) hotkeyRegistered[kind] = acc;
  else { hotkeyBusy[kind] = true; logger.warn(`[栏历] 快捷键 ${acc}（${HOTKEYS[kind].name}）被占用，未注册`); }
}
function setHotkey(kind, accelerator) {
  if (!HOTKEYS[kind]) return { ok: false };
  const acc = accelerator ? normalizeAccelerator(accelerator) : '';
  if (accelerator && !acc) return { ok: false, invalid: true, ...hotkeyState(kind) };
  const other = kind === 'capture' ? 'region' : 'capture';
  if (acc && acc === hotkeyAccelerator(other)) return { ok: false, conflict: true, ...hotkeyState(kind), busy: true };
  const prefs = { ...readPreferences(), [HOTKEYS[kind].pref]: acc };
  if (kind === 'capture') prefs.captureHotkey = acc !== '';
  writePreferences(prefs);
  registerHotkey(kind);
  return { ok: !hotkeyBusy[kind], ...hotkeyState(kind) };
}
function setCaptureHotkey(value) {
  const r = setHotkey('capture', value ? CAPTURE_ACCELERATOR : '');
  return { captureHotkey: Boolean(value), captureHotkeyBusy: r.busy };
}
function registerCaptureHotkey() { registerHotkey('capture'); registerHotkey('region'); }

async function startRegionCapture(opts) {
  if (!region) return { ok: false };
  // 来源应用要在铺窗之前取（铺窗后最前面就是栏历自己）
  const o = { ...(opts || {}) };
  if (o.sourceApp == null) o.sourceApp = await frontAppName();
  if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible() && !pinned) hideCalendar();
  return region.open(o);
}

function setupRegion() {
  region = createRegionController({
    BrowserWindow, screen, desktopCapturer, systemPreferences, shell, ipcMain, nativeImage, logger, E2E,
    frontAppName,
    saveImage: (o) => inbox.saveRegionImage(o),
    onError: () => inbox.showError('截取失败，请检查屏幕录制权限'),
    e2eFakeScreen: E2E ? (size) => {
      // 测试用：按显示器像素生成一张灰图（每像素 BGRA）
      const buf = Buffer.alloc(size.width * size.height * 4, 0x80);
      return nativeImage.createFromBitmap(buf, { width: size.width, height: size.height });
    } : null
  });
  region.register();
}

function inboxRoot() {
  if (E2E && process.env.LANLI_INBOX_DIR) return process.env.LANLI_INBOX_DIR;
  return path.join(app.getPath('userData'), 'inbox');
}

function setupInbox() {
  inbox = createInboxController({
    BrowserWindow, screen, nativeImage, net, shell, Menu, ipcMain, logger, E2E, clipboard, dialog,
    root: inboxRoot(),
    getTray: () => tray,
    onShow: () => { if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible() && !pinned) hideCalendar(); },
    onChanged: () => { if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.webContents.send('inbox:changed'); },
    openInbox: () => openInboxPanel()
  });
  inbox.register();
}

function readerRoot() {
  if (E2E && process.env.LANLI_READER_DIR) return process.env.LANLI_READER_DIR;
  return app.getPath('userData');
}

function setupReader() {
  const base = readerRoot();
  const sendWin = (ch, payload) => { if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.webContents.send(ch, payload); };
  reader = createReaderController({
    BrowserWindow, session, ipcMain, shell, clipboard, logger, E2E,
    root: path.join(base, 'read'),
    keyFile: path.join(base, 'reader-api-key'),
    promptFile: path.join(base, 'reader-prompt.txt'),
    usageFile: path.join(base, 'llm-usage.jsonl'),
    allowQaSender: (event) => Boolean(calendarWindow && !calendarWindow.isDestroyed() &&
      event.sender === calendarWindow.webContents && event.senderFrame && event.senderFrame === event.sender.mainFrame &&
      event.senderFrame.url === pathToFileURL(path.join(__dirname, 'renderer', 'calendar.html')).href),
    prefs: { read: readPreferences, write: writePreferences },
    onChanged: () => sendWin('reader:changed'),
    onDone: (m) => { if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) sendWin('reader:done', { id: m.id, title: m.title }); }
  });
  reader.register();
}

function openInboxPanel() {
  trayMenuHold = true;
  openCalendar();
  settingsViewOpen = true;
  sendPanel('inbox');
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
  initializeTrayClockStyle();
  initializeLoginItem();
  resetViewToToday();
  loadWorldClocks();
  initializeAlmanacStyle();
  setupWeather();
  registerIpc();
  setupInbox();
  setupReader();
  setupRegion();
  registerCaptureHotkey();
  createCalendarWindow();
  createTray();
  registerDisplayListeners();
  setupUpdates();
  registerE2eHooks();

  // Write the menu bar title immediately instead of waiting for the first
  // one-second interval.
  updateClock();
  clockTimer = setInterval(updateClock, 1000);

  if (tray && process.platform === 'darwin' && process.env.LANLI_TITLE_TEXT !== '1' && (!E2E || process.env.LANLI_E2E_TRAY_IMAGE === '1')) {
    nativeTheme.on('updated', updateClock);
    buildAtlas(BrowserWindow).then((atlas) => {
      makeClockImage = createClockImageMaker(nativeImage, atlas);
      makeCompactClockImage = createCompactClockImageMaker(nativeImage, atlas);
      lastTrayFrameKey = '';
      updateClock();
    }).catch((error) => {
      logger.warn('[栏历] 时钟图片生成失败，继续用文字标题：' + reasonOf(error));
    });
  }
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

  app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch { /* ignore */ } });
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
