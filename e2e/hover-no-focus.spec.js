'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');

test('悬停不抢焦点：实际托盘入口、显式点击激活、首击按钮和子页输入', async () => {
  const app = await electron.launch({ args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
    env: { ...process.env, LANLI_E2E: '1' } });
  const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#grid');
    await hook('hideWindow');
    // A peer Electron window is a project regression fixture. The independent
    // two-application native keyboard test remains a separate release gate.
    const peerEvent = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => {
      const peer = new BrowserWindow({ width: 300, height: 160, x: 40, y: 200, show: true });
      globalThis.__lanliFocusPeer = peer;
      await peer.loadURL('data:text/html,<input id="editor" autofocus aria-label="peer editor">');
      peer.show(); peer.focus();
    });
    const peer = await peerEvent;
    const state = () => app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/calendar.html'));
      return { panelVisible: panel.isVisible(), panelFocused: panel.isFocused(), focusable: panel.isFocusable(),
        peerFocused: globalThis.__lanliFocusPeer.isFocused() };
    });
    const focusPeer = async () => {
      await app.evaluate(() => { globalThis.__lanliFocusPeer.show(); globalThis.__lanliFocusPeer.focus(); });
      await expect.poll(async () => (await state()).peerFocused).toBe(true);
    };
    await focusPeer();
    await hook('trayEnter');
    await expect.poll(async () => (await state()).panelVisible).toBe(true);
    expect(await state()).toEqual({ panelVisible: true, panelFocused: false, focusable: true, peerFocused: true });
    await peer.keyboard.type('keep typing');
    await expect(peer.locator('#editor')).toHaveValue('keep typing');
    await hook('trayEnter');
    expect((await state()).panelFocused).toBe(false);
    await hook('trayLeave');
    await expect.poll(async () => (await state()).panelVisible).toBe(false);
    await focusPeer();
    await hook('trayEnter');
    const month = await page.locator('#month-title').textContent();
    await page.locator('#next-month').click();
    await expect(page.locator('#month-title')).not.toHaveText(month);
    const changed = await page.locator('#month-title').textContent();
    await focusPeer();
    await hook('trayClick');
    await expect.poll(async () => (await state()).panelFocused).toBe(true);
    await expect(page.locator('#month-title')).toHaveText(changed);
    await page.locator('#pin-button').click();
    await hook('trayLeave');
    await page.waitForTimeout(300);
    expect((await state()).panelVisible).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/calendar.html'))
      .webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }));
    await expect.poll(async () => (await state()).panelVisible).toBe(false);
    await focusPeer();
    await hook('trayEnter');
    await hook('trayRightClick');
    await hook('clickTrayMenuItem', 'tray-open-settings');
    await expect(page.locator('#settings-view')).toBeVisible();
    await expect.poll(async () => (await state()).panelFocused).toBe(true);
    await focusPeer();
    await hook('openInboxPanel');
    await expect(page.locator('#inbox-view')).toBeVisible();
    await expect.poll(async () => (await state()).panelFocused).toBe(true);
    await page.locator('#inbox-search').fill('子页输入');
    await expect(page.locator('#inbox-search')).toHaveValue('子页输入');
    await page.locator('#inbox-search').press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await expect(page.locator('#inbox-search')).toBeFocused();
    await app.evaluate(() => { globalThis.__lanliFocusPeer.destroy(); delete globalThis.__lanliFocusPeer; });
  } finally {
    await app.close();
  }
});
