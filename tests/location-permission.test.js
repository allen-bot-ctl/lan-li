'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTH_NOT_DETERMINED,
  AUTH_AUTHORIZED,
  AUTH_DENIED,
  AUTH_RESTRICTED,
  AUTH_UNAVAILABLE,
  decideLocationAction,
  createLocationPermission
} = require('../electron/location-permission');

test('authorization decision maps status to action and log text', () => {
  assert.deepEqual(decideLocationAction(AUTH_NOT_DETERMINED), {
    action: 'request',
    status: AUTH_NOT_DETERMINED,
    log: '定位授权=not determined'
  });
  assert.deepEqual(decideLocationAction(AUTH_AUTHORIZED), {
    action: 'system',
    status: AUTH_AUTHORIZED,
    log: '定位授权=authorized'
  });
  assert.deepEqual(decideLocationAction(AUTH_DENIED), {
    action: 'ip',
    status: AUTH_DENIED,
    log: '定位授权=denied，直接走 IP 定位'
  });
  assert.deepEqual(decideLocationAction(AUTH_RESTRICTED), {
    action: 'ip',
    status: AUTH_RESTRICTED,
    log: '定位授权=restricted，直接走 IP 定位'
  });
});

test('module load failure and unknown status fall back to the existing flow', () => {
  assert.deepEqual(decideLocationAction(AUTH_UNAVAILABLE), {
    action: 'system',
    status: AUTH_UNAVAILABLE,
    log: '定位授权=不可用，按现有流程处理'
  });
  assert.deepEqual(decideLocationAction(null), {
    action: 'system',
    status: AUTH_UNAVAILABLE,
    log: '定位授权=不可用，按现有流程处理'
  });
  assert.deepEqual(decideLocationAction(undefined), {
    action: 'system',
    status: AUTH_UNAVAILABLE,
    log: '定位授权=不可用，按现有流程处理'
  });
  assert.deepEqual(decideLocationAction('weird-status'), {
    action: 'system',
    status: AUTH_UNAVAILABLE,
    log: '定位授权=不可用，按现有流程处理'
  });
});

function steppingNow(stepMs) {
  let value = 0;
  return () => {
    const current = value;
    value += stepMs;
    return current;
  };
}

function makeHarness({ statuses = [], platform = 'darwin', isPackaged = true, now = Date.now } = {}) {
  const logs = [];
  const asked = [];
  let index = 0;
  const fakeModule = {
    getAuthStatus: () => {
      const value = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return value;
    },
    askForLocationAccess: () => {
      asked.push('when-in-use');
      return undefined;
    }
  };
  const permission = createLocationPermission({
    platform,
    isPackaged,
    now,
    requireModule: () => fakeModule,
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    },
    setTimeout: (fn) => setImmediate(fn),
    clearTimeout: () => {}
  });
  return { permission, logs, asked };
}

test('authorized status skips the request and returns system', async () => {
  const { permission, logs, asked } = makeHarness({ statuses: [AUTH_AUTHORIZED] });
  const result = await permission.ensureAuthorized();
  assert.equal(result.action, 'system');
  assert.deepEqual(asked, []);
  assert.ok(logs.includes('info:定位授权=authorized'));
});

test('denied status goes to IP without requesting again', async () => {
  const { permission, logs, asked } = makeHarness({ statuses: [AUTH_DENIED] });
  const result = await permission.ensureAuthorized();
  assert.equal(result.action, 'ip');
  assert.equal(result.status, AUTH_DENIED);
  assert.deepEqual(asked, []);
  assert.ok(logs.includes('warn:定位授权=denied，直接走 IP 定位'));
});

test('not determined triggers one native request and logs the settled result', async () => {
  const { permission, logs, asked } = makeHarness({
    now: steppingNow(1),
    statuses: [AUTH_NOT_DETERMINED, AUTH_NOT_DETERMINED, AUTH_AUTHORIZED]
  });
  const result = await permission.ensureAuthorized();
  assert.equal(result.action, 'system');
  assert.deepEqual(asked, ['when-in-use']);
  assert.ok(logs.includes('info:定位授权=not determined'));
  assert.ok(logs.includes('info:申请定位授权结果=authorized'));
});

test('not determined that never settles falls back to the existing flow after waiting', async () => {
  const { permission, logs, asked } = makeHarness({
    now: steppingNow(40000),
    statuses: [AUTH_NOT_DETERMINED, AUTH_NOT_DETERMINED, AUTH_NOT_DETERMINED]
  });
  const result = await permission.ensureAuthorized();
  assert.equal(result.action, 'system');
  assert.deepEqual(asked, ['when-in-use']);
  assert.ok(logs.includes('info:申请定位授权结果=not determined'));
});

test('non-darwin or unpackaged never require the native module or request', async () => {
  const { permission, logs, asked } = makeHarness({
    platform: 'linux',
    statuses: [AUTH_NOT_DETERMINED]
  });
  const result = await permission.ensureAuthorized();
  assert.equal(result.action, 'system');
  assert.deepEqual(asked, []);
  assert.ok(logs.includes('info:定位授权=不可用，按现有流程处理'));

  const dev = makeHarness({
    platform: 'darwin',
    isPackaged: false,
    statuses: [AUTH_NOT_DETERMINED]
  });
  const devResult = await dev.permission.ensureAuthorized();
  assert.equal(devResult.action, 'system');
  assert.deepEqual(dev.asked, []);
  assert.ok(dev.logs.some((line) => line.includes('跳过原生授权申请')));
});

test('a failing native require logs the error and never throws', async () => {
  const logs = [];
  const permission = createLocationPermission({
    platform: 'darwin',
    isPackaged: true,
    requireModule: () => {
      throw new Error('cannot find module');
    },
    logger: {
      warn: (message) => logs.push('warn:' + message)
    }
  });
  const result = await permission.ensureAuthorized();
  assert.equal(result.action, 'system');
  assert.equal(result.status, AUTH_UNAVAILABLE);
  assert.ok(logs.some((line) => line.includes('原生定位模块加载失败')));
});
