'use strict';
// 0.1.40 验收 C2–C5：托盘右键菜单。
const { test, expect, _electron: electron } = require('@playwright/test');

let app = null;
let page = null;
async function mainEval(fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await app.evaluate(fn, arg);
    } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}
const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
});

test.afterAll(async () => { if (app) await app.close(); });

test('C1/C2 右键：先隐藏日历，菜单项正确', async () => {
  await hook('trayEnter');
  const r = await hook('trayRightClick');
  expect(r).toEqual({ menuOpen: true, visible: false });
  const items = await hook('trayMenuItems');
  expect(items.map((i) => i.type === 'separator' ? '---' : i.label)).toEqual(['检查更新…', '收纳剪贴板内容', '设置中心…', '---', '退出栏历']);
  expect(items[4].accelerator).toBe('CommandOrControl+Q');
  expect(await hook('trayEnter')).toBe(false);   // 菜单开着时悬停不开日历
});

test('C3 设置中心…：窗口可见且在设置页，鼠标不在窗口上也不关', async () => {
  await hook('trayRightClick');
  expect(await hook('clickTrayMenuItem', 'tray-open-settings')).toBe(true);
  await expect.poll(() => hook('isVisible')).toBe(true);
  await expect(page.locator('#settings-view')).toBeVisible();
  await hook('trayLeave');
  await page.waitForTimeout(400);
  expect(await hook('isVisible')).toBe(true);
});

test('C4 检查更新…：进入设置页并检查一次', async () => {
  await hook('trayRightClick');
  expect(await hook('clickTrayMenuItem', 'tray-check-update')).toBe(true);
  await expect(page.locator('#settings-view')).toBeVisible();
  const st = await hook('trayMenuStats');
  expect(st.updateChecks).toBe(1);
});

test('C5 退出栏历：调用退出', async () => {
  await hook('trayRightClick');
  expect(await hook('clickTrayMenuItem', 'tray-quit')).toBe(true);
  expect((await hook('trayMenuStats')).quitCalls).toBe(1);
});
