'use strict';
// 0.1.62 R1 顶栏设置入口、R3 非日历页自动钉住（契约 docs/changes/0.1.62-pages-pin-compose-prompt.md）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-p62-'));
// Linux 上主进程 evaluate 偶尔和窗口显示/隐藏撞车（garbage collected），只对这种瞬时错误重试
const hook = async (name, arg) => {
  for (let i = 0; ; i += 1) {
    try { return await app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg }); } catch (e) {
      if (i >= 2 || !/garbage collected/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
};
const pinned = () => hook('isPinned');
const visible = () => hook('isVisible');

async function shots(name, locator) {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(120);
    await (locator || page).screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
}
async function toCalendar() {
  // 在任一页面里点返回，直到回到日历
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('.app-body').isVisible()) return;
    for (const sel of ['#reader-back', '#inbox-back', '#settings-back']) {
      if (await page.locator(sel).isVisible()) { await page.click(sel); break; }
    }
    await page.waitForTimeout(120);
  }
  await expect(page.locator('.app-body')).toBeVisible();
}
// 真机上鼠标进过窗口才会清掉托盘打开时的 hold；这里补一次 mouseenter
const pointerIn = () => page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent('mouseenter')));
async function reset() {
  await hook('showWindow');
  await toCalendar();
  // 回到日历后 pinned 恢复进入前的值；统一成未钉住
  if (await pinned()) { await page.click('#pin-button'); await page.waitForTimeout(200); }
  await hook('showWindow');
  expect(await pinned()).toBe(false);
}
const openInbox = async () => { await hook('openInboxPanel'); await page.waitForSelector('#inbox-view:not([hidden])'); };
const openReader = async () => { await hook('openReaderPanel'); await page.waitForSelector('#reader-view:not([hidden])'); };
const openSettings = async () => { await page.evaluate(() => openSettingsView('ui')); await page.waitForSelector('#settings-view:not([hidden])'); };

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'user') } });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
  await hook('showWindow');
});
test.afterAll(async () => { if (app) await app.close(); });

test('R1 仅日历右上角显示设置，其他顶栏操作和返回不变', async () => {
  const top = page.locator('.topbar');
  const settings = page.locator('#settings-button');
  await expect(settings).toBeVisible();
  await shots('62-topbar-calendar', top);
  for (const [name, open] of [['inbox', openInbox], ['reader', openReader]]) {
    await open();
    await expect(settings).toBeHidden();
    await expect(page.getByRole('button', { name: '设置', exact: true })).toHaveCount(0);
    for (const selector of ['#reader-button', '#inbox-button', '#check-update', '#pin-button']) {
      await expect(page.locator(selector)).toBeVisible();
    }
    await shots(`62-topbar-${name}`, top);
    await toCalendar();
    await expect(settings).toBeVisible();
  }
  await settings.click();
  await expect(page.locator('#settings-view')).toBeVisible();
  await expect(settings).toBeHidden();
  await shots('62-topbar-settings', top);
  await reset();
  await expect(settings).toBeVisible();
});

test('R3 自动钉住状态表：每一行', async () => {
  await reset();
  // 行：日历、进入前未钉住 → 移出照常隐藏
  expect(await pinned()).toBe(false);
  // 收纳 / 帮阅 / 设置：不隐藏，钉住按钮显示已钉住
  for (const [name, open] of [['收纳', openInbox], ['帮阅', openReader], ['设置', openSettings]]) {
    await reset();
    await open();
    await expect.poll(pinned, name).toBe(true);
    await expect(page.locator('#pin-button')).toHaveAttribute('aria-pressed', 'true');
    await pointerIn();
    await hook('trayLeave');
    await page.waitForTimeout(500);
    expect(await visible(), `${name} 移出不隐藏`).toBe(true);
    await hook('blur');
    await page.waitForTimeout(300);
    expect(await visible(), `${name} 失焦不隐藏`).toBe(true);
    // 从上一行回到日历：恢复未钉住，移出后照常隐藏
    await toCalendar();
    await expect.poll(pinned, `${name} 回日历`).toBe(false);
    await expect(page.locator('#pin-button')).toHaveAttribute('aria-pressed', 'false');
    await pointerIn();
    await hook('trayLeave');
    await expect.poll(visible, `${name} 回日历后移出隐藏`).toBe(false);
  }
  // 帮阅详情页同样不隐藏（详情在 reader-view 内）
  await reset();
  await openReader();
  await pointerIn();
    await hook('trayLeave');
  await page.waitForTimeout(400);
  expect(await visible()).toBe(true);
  await toCalendar();
  await pointerIn();
    await hook('trayLeave');
  await expect.poll(visible).toBe(false);
});

test('R3 进入前已钉住：回日历仍钉住；子页面点 ×：窗口隐藏，下次打开是日历页且未钉住', async () => {
  await reset();
  await page.click('#pin-button');                       // 手动钉住日历
  await expect.poll(pinned).toBe(true);
  await openInbox();
  expect(await pinned()).toBe(true);
  await toCalendar();
  await expect.poll(pinned, '进入前已钉住，回来仍钉住').toBe(true);
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-pressed', 'true');
  await pointerIn();
  await hook('trayLeave');
  await page.waitForTimeout(400);
  expect(await visible()).toBe(true);
  await page.click('#pin-button');                       // 日历里点 ×：隐藏
  await expect.poll(visible).toBe(false);

  await reset();
  await openReader();
  await expect.poll(pinned).toBe(true);
  await page.click('#pin-button');                       // 子页面点 ×
  await expect.poll(visible).toBe(false);
  expect(await pinned()).toBe(false);
  await hook('showWindow');
  await expect(page.locator('.app-body')).toBeVisible();
  expect(await pinned()).toBe(false);
});

test('R3 窗口重新出现：停在非日历页时同样钉住（托盘直接打开收纳/帮阅）', async () => {
  await reset();
  await pointerIn();
    await hook('trayLeave');
  await expect.poll(visible).toBe(false);
  await openReader();
  await expect.poll(pinned).toBe(true);
  expect(await visible()).toBe(true);
  await toCalendar();
  await pointerIn();
    await hook('trayLeave');
  await expect.poll(visible).toBe(false);
  await openInbox();
  await expect.poll(pinned).toBe(true);
  await toCalendar();
  await reset();
});

