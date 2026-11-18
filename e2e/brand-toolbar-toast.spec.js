'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const PKG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

let app = null;
let page = null;

async function mainEval(fn, arg) {
  // Electron's main-process evaluate occasionally races the window show/hide
  // transition on Linux; retry only that transient error.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await app.evaluate(fn, arg);
    } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}

async function trayEnter() {
  return mainEval(() => globalThis.__lanliTest.trayEnter());
}

async function emitStatus(status) {
  // electron.evaluate 把 electron 模块作为 fn 第一个参数，自定义 arg 是第二个。
  return mainEval(
    (_electron, s) => globalThis.__lanliTest.emitUpdateStatus(s),
    status
  );
}

async function emitNotice(notice) {
  return mainEval(
    (_electron, n) => globalThis.__lanliTest.emitUpdateNotice(n),
    notice
  );
}

// 浮层每次测试前清场：空 status 收掉状态类浮层，notice 类浮层点 ×。
async function clearToast() {
  await emitStatus({ label: '' });
  const toast = page.locator('#update-toast');
  if (await toast.isVisible()) {
    const close = page.locator('#update-toast-close');
    if (await close.isVisible()) await close.click();
    await expect(toast).toBeHidden();
  }
}

// 月历格子容器与右栏三张卡片的矩形基线。
async function rects() {
  return page.evaluate(() => {
    const pick = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      grid: pick('#grid'),
      almanac: pick('.almanac-card'),
      clock: pick('.world-clock-card'),
      weather: pick('.weather-card')
    };
  });
}

function expectSameRect(actual, expected, label) {
  expect(actual.x, `${label}.x`).toBe(expected.x);
  expect(actual.y, `${label}.y`).toBe(expected.y);
  expect(actual.width, `${label}.width`).toBe(expected.width);
  expect(actual.height, `${label}.height`).toBe(expected.height);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({
    args,
    env: { ...process.env, LANLI_E2E: '1' }
  });
  page = await app.firstWindow();
  await page.waitForSelector('#pin-button');
  await page.waitForSelector('#grid');
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('C6 更新浮层弹出时月历与右栏卡片零位移', async () => {
  await trayEnter();
  await clearToast();

  const baseline = await rects();

  await emitStatus({ label: '正在检查…', busy: true });
  await expect(page.locator('#update-toast')).toBeVisible();
  expectSameRect(await rects(), baseline, 'busy');

  await emitStatus({ label: '已是最新', timed: true });
  await expect(page.locator('#update-toast')).toBeVisible();
  expectSameRect(await rects(), baseline, 'timed');
  await expect(page.locator('#update-toast')).toBeHidden();

  await emitNotice({ mode: 'ready' });
  await expect(page.locator('#update-toast')).toBeVisible();
  expectSameRect(await rects(), baseline, 'ready');

  await clearToast();
});

test('C7 浮层居中且距顶栏 8px；定时提示按时消失；ready 需手动关闭', async () => {
  await trayEnter();
  await clearToast();

  // 定时提示在 2.3–2.9 秒之间自行隐藏。
  const startedAt = Date.now();
  await emitStatus({ label: '已是最新', timed: true });
  await expect(page.locator('#update-toast')).toBeVisible();
  await expect(page.locator('#update-toast')).toBeHidden();
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeGreaterThanOrEqual(2300);
  expect(elapsed).toBeLessThanOrEqual(2900);

  // ready 浮层：水平居中、top − 顶栏 bottom = 8px，10 秒后仍在。
  await emitNotice({ mode: 'ready' });
  const toast = page.locator('#update-toast');
  await expect(toast).toBeVisible();

  const geo = await page.evaluate(() => {
    const t = document.querySelector('#update-toast').getBoundingClientRect();
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    return {
      left: t.left,
      rightGap: window.innerWidth - t.right,
      top: t.top,
      barBottom: bar.bottom
    };
  });
  expect(Math.abs(geo.left - geo.rightGap)).toBeLessThanOrEqual(1);
  expect(Math.abs((geo.top - geo.barBottom) - 8)).toBeLessThanOrEqual(1);

  await page.waitForTimeout(10000);
  await expect(toast).toBeVisible();

  await page.click('#update-toast-close');
  await expect(toast).toBeHidden();
  const classes = await page.locator('#check-update').getAttribute('class');
  expect(classes.split(/\s+/)).toContain('has-update');

  await clearToast();
});

test('C8 manual 提示单行且不超宽', async () => {
  await trayEnter();
  await clearToast();

  await emitNotice({ mode: 'manual' });
  const toast = page.locator('#update-toast');
  await expect(toast).toBeVisible();

  const info = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const msg = box('#update-toast-message');
    const msgEl = document.querySelector('#update-toast-message');
    // 三者高度不同（文字 / 按钮 / ×），单行时垂直中心线重合而非 top 相等。
    const centerY = (r) => r.top + r.height / 2;
    return {
      toastWidth: box('#update-toast').width,
      messageCenter: centerY(msg),
      actionCenter: centerY(box('#update-toast-action')),
      closeCenter: centerY(box('#update-toast-close')),
      scrollWidth: msgEl.scrollWidth,
      clientWidth: msgEl.clientWidth
    };
  });
  expect(info.toastWidth).toBeLessThanOrEqual(360);
  expect(Math.abs(info.messageCenter - info.actionCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(info.messageCenter - info.closeCenter)).toBeLessThanOrEqual(1);
  expect(info.scrollWidth).toBeLessThanOrEqual(info.clientWidth);

  await clearToast();
});

test('C9 无更新横幅；页脚版本与 package.json 一致', async () => {
  await trayEnter();
  await clearToast();

  expect(await page.locator('#update-banner').count()).toBe(0);
  await expect(page.locator('#app-version')).toHaveText(`v${PKG.version}`);
});
