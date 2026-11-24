'use strict';
// 0.1.63 设置页退出栏历（契约 docs/changes/0.1.63.md）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-p63-'));
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
  await page.waitForSelector('#grid');
  await hook('showWindow');
});
test.afterAll(async () => { if (app) await app.close(); });
const quits = async () => (await hook('trayMenuStats')).quitCalls;

test('R1 日历/收纳/帮阅点 ⚙ 直接进设置页，无下拉，自动钉住，返回恢复', async () => {
  await reset();
  await shots('63-topbar-settings');
  for (const open of [null, openInbox, openReader]) {
    await reset();
    if (open) { await open(); }
    await expect(page.locator('#settings-button')).toBeVisible();
    await expect(page.locator('#settings-button')).not.toHaveAttribute('aria-haspopup', /.*/);
    await page.click('#settings-button');
    await expect(page.locator('#settings-view')).toBeVisible();
    await expect(page.locator('#settings-page-ui')).toBeVisible();
    expect(await pinned()).toBe(true);
    expect(await visible()).toBe(true);
    await page.click('#settings-back');
    await toCalendar();
  }
  await reset();
});

test('R2 退出栏历按钮只在设置页，位置在标题行最右、与返回同中线', async () => {
  await reset();
  await expect(page.locator('#settings-quit')).toBeHidden();
  await page.click('#settings-button');
  const q = page.locator('#settings-quit');
  await expect(q).toBeVisible();
  await expect(q).toHaveText('退出栏历');
  for (const tab of ['ui', 'almanac', 'weather', 'clocks', 'tags', 'reader', 'update']) {
    await page.click(`.settings-tab[data-tab="${tab}"]`);
    const m = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const q = r('settings-quit'); const b = r('settings-back'); const h = document.querySelector('.settings-head').getBoundingClientRect();
      return { qMid: q.top + q.height / 2, bMid: b.top + b.height / 2, qRight: q.right, hRight: h.right, color: getComputedStyle(document.getElementById('settings-quit')).color };
    });
    expect(Math.abs(m.qMid - m.bMid)).toBeLessThan(1.5);
    expect(Math.abs(m.qRight - m.hRight)).toBeLessThan(1.5);
  }
  await page.click('.settings-tab[data-tab="ui"]');
  await shots('63-settings-quit');
  await page.click('#settings-back');
  await toCalendar();
  await expect(page.locator('#settings-quit')).toBeHidden();
});

test('R3 确认框：取消/Esc/遮罩只关框；退出调用 quitApp；隐藏窗口关框', async () => {
  await reset();
  await page.click('#settings-button');
  await page.click('.settings-tab[data-tab="almanac"]');
  const before = await quits();
  const ov = page.locator('#quit-overlay');
  await expect(ov).toBeHidden();

  await page.click('#settings-quit');
  await expect(ov).toBeVisible();
  await expect(page.locator('#quit-title')).toHaveText('确定退出栏历吗？');
  await expect(page.locator('#quit-cancel')).toHaveText('取消');
  await expect(page.locator('#quit-confirm')).toHaveText('退出');
  await expect(page.locator('#quit-cancel')).toBeFocused();
  await shots('63-quit-confirm');

  await page.click('#quit-cancel');
  await expect(ov).toBeHidden();
  await expect(page.locator('#settings-view')).toBeVisible();

  await page.click('#settings-quit');
  await expect(ov).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ov).toBeHidden();
  await expect(page.locator('#settings-view')).toBeVisible();
  await expect(page.locator('.settings-tab.is-selected')).toHaveText('黄历');

  await page.click('#settings-quit');
  await page.mouse.click(5, 200);
  await expect(ov).toBeHidden();
  await expect(page.locator('#settings-view')).toBeVisible();
  expect(await quits()).toBe(before);

  // 弹框开着隐藏窗口：框一起关，下次打开不带框
  await page.click('#settings-quit');
  await expect(ov).toBeVisible();
  await hook('hideWindow');
  await hook('showWindow');
  await expect(ov).toBeHidden();

  await page.click('#settings-button');
  await page.click('#settings-quit');
  await expect(ov).toBeVisible();
  await page.click('#quit-confirm');
  await expect.poll(quits).toBe(before + 1);
});
