'use strict';

// macOS 定位授权的原生申请与决策。
//
// Electron 的 navigator.geolocation 在 macOS 上不会调用 CLLocationManager 的
// requestWhenInUseAuthorization（见 electron/electron#29314、#45290）。因此
// ad-hoc 签名的包虽然能被系统登记为定位客户端（/var/db/locationd/clients.plist），
// 却永远不会弹授权框，navigator.geolocation 只会超时。这里用 node-mac-permissions
// 原生申请一次「使用时」授权，并把授权状态映射成三种动作：申请 / 走系统定位 / 走 IP。
//
// decideLocationAction 是纯函数，不依赖任何原生模块或 Electron，可被 node --test
// 直接 require。原生模块经 createLocationPermission 的 requireModule 注入，且只在
// darwin 上加载；加载失败只记日志、返回「不可用」，绝不抛出，保证 Linux CI 测试不受影响。

const AUTH_NOT_DETERMINED = 'not determined';
const AUTH_AUTHORIZED = 'authorized';
const AUTH_DENIED = 'denied';
const AUTH_RESTRICTED = 'restricted';
// 原生模块加载失败 / 非 darwin / 读取异常时的占位状态。
const AUTH_UNAVAILABLE = 'unavailable';

const DEFAULT_MAX_WAIT_MS = 30 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 500;

// 输入授权状态，输出下一步动作与一行日志文本。
//   action: 'request' 申请授权（not determined）
//           'system'  走系统定位（authorized；或状态不可用 → 照旧走现有流程）
//           'ip'      直接走 IP（denied / restricted，日志写明原因）
function decideLocationAction(status) {
  if (status === AUTH_NOT_DETERMINED) {
    return { action: 'request', status, log: '定位授权=not determined' };
  }
  if (status === AUTH_AUTHORIZED) {
    return { action: 'system', status, log: '定位授权=authorized' };
  }
  if (status === AUTH_DENIED) {
    return { action: 'ip', status, log: '定位授权=denied，直接走 IP 定位' };
  }
  if (status === AUTH_RESTRICTED) {
    return { action: 'ip', status, log: '定位授权=restricted，直接走 IP 定位' };
  }
  // 未知状态 / 模块加载失败 / 非 darwin：不申请、不特殊处理，照旧走现有渲染进程流程
  // （navigator.geolocation，失败再回退 IP）。
  return { action: 'system', status: AUTH_UNAVAILABLE, log: '定位授权=不可用，按现有流程处理' };
}

function describeReason(error) {
  return error && error.message ? error.message : String(error);
}

function createLocationPermission(options = {}) {
  const platform = typeof options.platform === 'string' ? options.platform : process.platform;
  const isPackaged = options.isPackaged === true;
  const requireModule = typeof options.requireModule === 'function'
    ? options.requireModule
    : (id) => require(id);
  const logger = options.logger && typeof options.logger === 'object' ? options.logger : {};
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const setTimer = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
  const maxWaitMs = Number.isFinite(options.maxWaitMs) && options.maxWaitMs > 0
    ? options.maxWaitMs
    : DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0
    ? options.pollIntervalMs
    : DEFAULT_POLL_INTERVAL_MS;

  let native = null;
  let loadFailed = false;

  function log(level, message) {
    const write = logger[level];
    if (typeof write === 'function') write(message);
  }

  function loadNative() {
    if (native) return native;
    if (loadFailed) return null;
    if (platform !== 'darwin') {
      loadFailed = true;
      return null;
    }
    try {
      native = requireModule('node-mac-permissions');
      return native;
    } catch (error) {
      loadFailed = true;
      log('warn', '原生定位模块加载失败：' + describeReason(error));
      return null;
    }
  }

  function getAuthStatus() {
    const mod = loadNative();
    if (!mod) return AUTH_UNAVAILABLE;
    try {
      const status = mod.getAuthStatus('location');
      return typeof status === 'string' && status !== '' ? status : AUTH_UNAVAILABLE;
    } catch (error) {
      log('warn', '读取定位授权状态失败：' + describeReason(error));
      return AUTH_UNAVAILABLE;
    }
  }

  function askForLocationAccess() {
    const mod = loadNative();
    if (!mod) return undefined;
    try {
      // node-mac-permissions 的 askForLocationAccess 当前是同步 void（只弹框，立即返回）；
      // 若未来版本改成返回 Promise，这里也不 await，交给 ensureAuthorized 轮询决定最终状态。
      return mod.askForLocationAccess('when-in-use');
    } catch (error) {
      log('warn', '申请定位授权失败：' + describeReason(error));
      return undefined;
    }
  }

  function waitForDecision() {
    return new Promise((resolve) => {
      const startedAt = now();
      const tick = () => {
        const status = getAuthStatus();
        if (status !== AUTH_NOT_DETERMINED && status !== AUTH_UNAVAILABLE) {
          resolve(status);
          return;
        }
        if (now() - startedAt >= maxWaitMs) {
          resolve(status);
          return;
        }
        setTimer(tick, pollIntervalMs);
      };
      tick();
    });
  }

  // 首次刷新天气前调用一次：读状态并写日志；not determined 时原生申请一次，再轮询等待
  // 授权变化（最多 maxWaitMs，setTimeout 轮询，不阻塞事件循环），最后按决定动作继续。
  // 之后重复调用只会复用已经确定的状态，不会每次都重新申请。
  async function ensureAuthorized() {
    const initial = getAuthStatus();
    const decision = decideLocationAction(initial);
    log(decision.action === 'ip' ? 'warn' : 'info', decision.log);

    if (decision.action !== 'request') {
      return decision;
    }

    if (!isPackaged) {
      // 开发态（npm start）用 Electron 自己的 Info.plist，没有
      // NSLocationWhenInUseUsageDescription，直接调 requestWhenInUseAuthorization
      // 会崩溃；这里跳过申请，走现有流程。
      log('info', '未打包，跳过原生授权申请（避免缺失用途说明导致崩溃）');
      return { action: 'system', status: initial, log: decision.log };
    }

    const asked = askForLocationAccess();
    if (asked && typeof asked.then === 'function') {
      Promise.resolve(asked).catch((error) => {
        log('warn', '申请定位授权失败：' + describeReason(error));
      });
    }

    const settled = await waitForDecision();
    const result = settled === AUTH_NOT_DETERMINED
      ? { action: 'system', status: settled, log: '定位授权=not determined（超时未决定，按现有流程处理）' }
      : decideLocationAction(settled);
    log(result.action === 'ip' ? 'warn' : 'info', '申请定位授权结果=' + settled);
    return result;
  }

  return {
    getAuthStatus,
    ensureAuthorized,
    decideLocationAction
  };
}

module.exports = {
  AUTH_NOT_DETERMINED,
  AUTH_AUTHORIZED,
  AUTH_DENIED,
  AUTH_RESTRICTED,
  AUTH_UNAVAILABLE,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  decideLocationAction,
  createLocationPermission
};
