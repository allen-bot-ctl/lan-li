'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWeatherRefresher,
  RESUME_DELAY_MS,
  RETRY_MS,
  STALE_MS
} = require('../electron/weather-refresh');

function createFakeTimers() {
  const timers = [];
  let current = 0;
  let nextId = 1;

  function schedule(fn, ms, kind) {
    const timer = { id: nextId++, fn, ms, kind, at: current + ms };
    timers.push(timer);
    return timer.id;
  }

  function cancel(id) {
    const index = timers.findIndex((t) => t.id === id);
    if (index >= 0) timers.splice(index, 1);
  }

  function advance(ms) {
    const target = current + ms;
    for (;;) {
      let next = null;
      for (const t of timers) {
        if (t.at <= target && (!next || t.at < next.at)) next = t;
      }
      if (!next) break;
      current = next.at;
      if (next.kind === 'interval') {
        next.at = current + next.ms;
      } else {
        cancel(next.id);
      }
      next.fn();
    }
    current = target;
  }

  return {
    now: () => current,
    setTimeout: (fn, ms) => schedule(fn, ms, 'timeout'),
    clearTimeout: cancel,
    setInterval: (fn, ms) => schedule(fn, ms, 'interval'),
    clearInterval: cancel,
    advance
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildRefresher(timers, refresh) {
  return createWeatherRefresher({
    refresh,
    now: timers.now,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval
  });
}

test('onResume delays forced refresh by 5s', () => {
  const timers = createFakeTimers();
  const calls = [];
  const refresher = buildRefresher(timers, (force) => {
    calls.push(Boolean(force));
    return Promise.resolve({ ok: true });
  });

  refresher.onResume();
  timers.advance(RESUME_DELAY_MS - 1);
  assert.equal(calls.length, 0);
  timers.advance(1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], true);
  refresher.dispose();
});

test('consecutive onResume calls trigger only one refresh', () => {
  const timers = createFakeTimers();
  const calls = [];
  const refresher = buildRefresher(timers, (force) => {
    calls.push(Boolean(force));
    return Promise.resolve({ ok: true });
  });

  refresher.onResume();
  refresher.onResume();
  timers.advance(RESUME_DELAY_MS);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], true);
  refresher.dispose();
});

test('failed result arms retry timer; success disarms it', async () => {
  const timers = createFakeTimers();
  const calls = [];
  let nextResult = { ok: false };
  const refresher = buildRefresher(timers, (force) => {
    calls.push(Boolean(force));
    return Promise.resolve(nextResult);
  });

  await refresher.run(false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], false);
  assert.ok(refresher.isRetrying());

  nextResult = { ok: true };
  timers.advance(RETRY_MS);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1], true);
  assert.ok(!refresher.isRetrying());

  timers.advance(RETRY_MS * 2);
  await flush();
  assert.equal(calls.length, 2);
  refresher.dispose();
});

test('onWindowShow refreshes on failure or staleness', async () => {
  const timers = createFakeTimers();
  const calls = [];
  let nextResult = { ok: false };
  const refresher = buildRefresher(timers, (force) => {
    calls.push(Boolean(force));
    return Promise.resolve(nextResult);
  });

  // 上次失败 → 调用
  await refresher.run(false);
  assert.ok(refresher.isRetrying());
  assert.equal(refresher.onWindowShow(), true);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1], true);

  // 上次成功且未满 30 分钟 → 不调用
  nextResult = { ok: true };
  await refresher.run(false);
  assert.ok(!refresher.isRetrying());
  assert.equal(refresher.onWindowShow(), false);
  await flush();
  assert.equal(calls.length, 3);

  // 满 30 分钟 → 调用
  timers.advance(STALE_MS);
  assert.equal(refresher.onWindowShow(), true);
  await flush();
  assert.equal(calls.length, 4);
  assert.equal(calls[3], true);

  refresher.dispose();
});
