'use strict';
// 0.1.50 框选收纳：透明框选层 + 屏幕录制权限说明卡 + 截取落盘。
// 参考 EasyLens feat/gbot electron/main.js（screen-saver 置顶、visibleOnFullScreen、desktopCapturer 按 scaleFactor 截取、拒权超时）。
const path = require('node:path');
const { cropRect } = require('./region-helpers');

const PERMISSION_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const CAPTURE_TIMEOUT_MS = 4000;
const HIDE_SETTLE_MS = 150;

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_r, reject) => setTimeout(() => reject(new Error('capture-timeout')), ms))]);
}

function createRegionController(deps) {
  const { BrowserWindow, screen, desktopCapturer, systemPreferences, shell, ipcMain, nativeImage, logger, E2E } = deps;
  let overlay = null; let permWin = null;
  let display = null; let sourceApp = '';
  let lastState = { phase: 'closed', rect: null, bar: null };
  let lastResult = null;
  const e2e = { permission: 'granted', permissionAfterProbe: null, scaleFactor: null, openCalls: [], probeCalls: 0, order: [] };

  function screenAccess() {
    if (E2E) return e2e.permission;
    if (process.platform !== 'darwin' || !systemPreferences || typeof systemPreferences.getMediaAccessStatus !== 'function') return 'granted';
    try { return systemPreferences.getMediaAccessStatus('screen'); } catch { return 'unknown'; }
  }

  function scaleOf(d) { return (E2E && e2e.scaleFactor) || d.scaleFactor || 1; }

  function ensureOverlay() {
    if (overlay && !overlay.isDestroyed()) return overlay;
    overlay = new BrowserWindow({
      show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: true, enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'region-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    try { overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* ignore */ }
    overlay.loadFile(path.join(__dirname, 'renderer', 'region.html'));
    overlay.on('closed', () => { overlay = null; lastState = { phase: 'closed', rect: null, bar: null }; });
    return overlay;
  }

  function showPermissionCard(d) {
    if (!permWin || permWin.isDestroyed()) {
      permWin = new BrowserWindow({
        width: 380, height: 200, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
        minimizable: false, maximizable: false, fullscreenable: false,
        webPreferences: { preload: path.join(__dirname, 'region-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      permWin.setAlwaysOnTop(true, 'screen-saver');
      try { permWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* ignore */ }
      permWin.loadFile(path.join(__dirname, 'renderer', 'region-permission.html'));
      permWin.on('closed', () => { permWin = null; });
    }
    const wa = d.workArea;
    permWin.setBounds({ x: Math.round(wa.x + (wa.width - 380) / 2), y: Math.round(wa.y + wa.height / 4), width: 380, height: 200 });
    permWin.show(); permWin.focus();
    return permWin;
  }

  async function probeScreenAccess() {
    e2e.probeCalls += 1;
    if (E2E) { if (e2e.permissionAfterProbe) e2e.permission = e2e.permissionAfterProbe; return; }
    try { await withTimeout(desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }), 1500); } catch (err) {
      if (logger) logger.info(`[栏历] 框选：登记截屏 ${err && err.message}`);
    }
  }

  function closePermission() { if (permWin && !permWin.isDestroyed()) permWin.close(); permWin = null; }

  // opts.sourceApp：启动前最前面的应用（由调用方在铺窗前取好）
  async function open(opts) {
    const o = opts || {};
    const pt = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(pt);
    sourceApp = o.sourceApp != null ? o.sourceApp : (deps.frontAppName ? await deps.frontAppName() : '');
    if (/^(栏历|LanLi|Electron)$/i.test(sourceApp || '')) sourceApp = '';
    // 0.1.53：未授权时只弹栏历的说明卡，不截屏，系统框不会同时出现；点「去授权」才登记
    if (screenAccess() !== 'granted') {
      showPermissionCard(display);
      return { ok: false, permission: screenAccess() };
    }
    return showOverlay();
  }

  async function showOverlay() {
    closePermission();
    const w = ensureOverlay();
    w.setBounds(display.bounds);
    if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
    w.webContents.send('region:reset');
    w.show(); w.focus();
    lastResult = null;
    return { ok: true, display: { id: display.id, bounds: display.bounds, scaleFactor: scaleOf(display) } };
  }

  function close() {
    if (overlay && !overlay.isDestroyed()) { overlay.hide(); overlay.webContents.send('region:reset'); }
    lastState = { phase: 'closed', rect: null, bar: null };
  }

  async function grabDisplay(d) {
    const sf = scaleOf(d);
    const size = { width: Math.round(d.bounds.width * sf), height: Math.round(d.bounds.height * sf) };
    if (E2E && deps.e2eFakeScreen) return deps.e2eFakeScreen(size);
    const sources = await withTimeout(desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }), CAPTURE_TIMEOUT_MS);
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('no-screen-source');
    return src.thumbnail;
  }

  async function commit(rect) {
    const d = display;
    close();
    await new Promise((r) => setTimeout(r, HIDE_SETTLE_MS));   // 先让框选层从屏幕上消失再截
    try {
      const full = await grabDisplay(d);
      const sz = full.getSize();
      const crop = cropRect(rect, sz.width / d.bounds.width, sz);
      const img = full.crop(crop);
      const buffer = img.toPNG();
      const res = await deps.saveImage({ buffer, sourceApp, width: crop.width, height: crop.height });
      lastResult = { ok: true, width: crop.width, height: crop.height, ...res };
    } catch (error) {
      if (logger) logger.warn('[栏历] 框选截取失败：' + (error && error.message));
      lastResult = { ok: false, error: String(error && error.message) };
      if (deps.onError) deps.onError(error);
    }
    return lastResult;
  }

  function register() {
    ipcMain.on('region:commit', (_e, rect) => { commit(rect); });
    ipcMain.on('region:cancel', () => close());
    ipcMain.on('region:state', (_e, s) => { if (overlay && overlay.isVisible()) lastState = s; });
    ipcMain.on('region:closePermission', () => closePermission());
    ipcMain.on('region:openPermissionSettings', () => { grantFlow(); });
  }

  // 0.1.53「去授权」：先关卡 → 登记截屏 → 复查权限 → 已授权进框选，否则打开设置页
  async function grantFlow() {
    closePermission(); e2e.order.push('close');
    await probeScreenAccess(); e2e.order.push('probe');
    const access = screenAccess();
    const next = access === 'granted' ? '进入框选' : '打开设置';
    if (logger) logger.info(`[栏历] 框选：说明卡 → 去授权 → 登记截屏 → ${access} → ${next}`);
    if (access === 'granted') return showOverlay();
    e2e.order.push('open');
    if (E2E) e2e.openCalls.push(PERMISSION_URL); else shell.openExternal(PERMISSION_URL);
    return null;
  }

  return {
    register, open, close, commit, screenAccess,
    overlay: () => overlay, permissionWindow: () => permWin,
    e2e: {
      setPermission: (v) => { e2e.permission = v || 'granted'; return true; },
      setPermissionAfterProbe: (v) => { e2e.permissionAfterProbe = v || null; return true; },
      resetProbeCalls: () => { e2e.probeCalls = 0; e2e.openCalls = []; e2e.order = []; return true; },
      order: () => e2e.order.slice(),
      setScaleFactor: (v) => { e2e.scaleFactor = v || null; return true; },
      state: () => ({ ...lastState, overlayVisible: Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible()), permissionVisible: Boolean(permWin && !permWin.isDestroyed() && permWin.isVisible()), sourceApp, result: lastResult }),
      openCalls: () => e2e.openCalls.slice(),
      probeCalls: () => e2e.probeCalls
    }
  };
}

module.exports = { createRegionController, PERMISSION_URL };
