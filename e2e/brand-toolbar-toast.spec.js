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

test('C9 无更新横幅；页脚版本与 package.json 一致', async () => {
  await trayEnter();
  await clearToast();

  expect(await page.locator('#update-banner').count()).toBe(0);
  await expect(page.locator('#app-version')).toHaveText(`v${PKG.version}`);
});
