'use strict';
// 0.1.50 R-C1–R-C7：框选收纳（真实 DOM 鼠标拖动 + 真实键盘 Enter/Esc）与快捷键改键。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-region-'));
const inboxDir = path.join(work, 'inbox');
const SHOTS = path.join(__dirname, 'screenshots');

async function mainEval(fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await app.evaluate(fn, arg); } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}
const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const rstate = () => hook('regionState');
const entries = () => hook('inboxList');
const setTheme = (t) => mainEval(({ nativeTheme }, v) => { nativeTheme.themeSource = v; }, t);

async function winPage(suffix) {
  for (let i = 0; i < 50; i += 1) {
    const w = app.windows().find((p) => !p.isClosed() && p.url().endsWith(suffix));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await page.waitForTimeout(100);
  }
  throw new Error(suffix + ' window not found');
}
async function shotWin(suffix, name) {
  const b64 = await mainEval(async ({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith(s));
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  }, suffix);
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(b64, 'base64'));
}
async function drag(p, x0, y0, x1, y1) {
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 3 });
  await p.mouse.move(x1, y1, { steps: 3 });
  await p.mouse.up();
}
async function openOverlay(o) {
  const r = await hook('openRegionCapture', o);
  expect(r.ok).toBe(true);
  await expect.poll(async () => (await rstate()).overlayVisible).toBe(true);
  const p = await winPage('region.html');
  await expect.poll(async () => (await rstate()).phase).toBe('idle');
  return p;
}
async function waitClosed() { await expect.poll(async () => (await rstate()).overlayVisible, { timeout: 5000 }).toBe(false); }

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await hook('setHotkey', { kind: 'capture', accelerator: 'Control+Alt+V' });
  await hook('setHotkey', { kind: 'region', accelerator: 'Control+Alt+S' });
});

test.afterAll(async () => {
  if (app) {
    try {
      await setTheme('system');
      await hook('setBusyAccelerators', []);
      await hook('setHotkey', { kind: 'capture', accelerator: 'Control+Alt+V' });
      await hook('setHotkey', { kind: 'region', accelerator: 'Control+Alt+S' });
    } catch { /* ignore */ }
    await app.close();
  }
});

test('R-C1 ⌃⌥S 与托盘菜单都能进入框选；Esc、取消都完全退出', async () => {
  const hk = await hook('hotkeys');
  expect(hk.registered).toContain('Control+Alt+S');
  expect(await hook('pressHotkey', 'Control+Alt+S')).toBe(true);
  await expect.poll(async () => (await rstate()).overlayVisible).toBe(true);
  let p = await winPage('region.html');
  await expect(p.locator('#hint')).toHaveText('拖动框选要收纳的区域 · Esc 取消');
  const d = await hook('regionDisplay');
  const b = await mainEval(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('region.html')).getBounds());
  expect(b).toEqual(d.bounds);
  expect(await p.evaluate(() => getComputedStyle(document.body).cursor)).toBe('crosshair');
  expect(await p.evaluate(() => getComputedStyle(document.getElementById('dim')).backgroundColor)).toBe('rgba(0, 0, 0, 0.2)');
  await p.keyboard.press('Escape');
  await waitClosed();

  await hook('trayRightClick');
  const items = await hook('trayMenuItems');
  const it = items.find((i) => i.id === 'tray-region-capture');
  expect(it.label).toBe('框选收纳');
  expect(it.accelerator).toBe('Control+Alt+S');
  expect(items.findIndex((i) => i.id === 'tray-region-capture')).toBe(items.findIndex((i) => i.id === 'tray-capture-clipboard') + 1);
  expect(await hook('clickTrayMenuItem', 'tray-region-capture')).toBe(true);
  await expect.poll(async () => (await rstate()).overlayVisible).toBe(true);
  p = await winPage('region.html');
  await expect.poll(async () => (await rstate()).phase).toBe('idle');
  await drag(p, 100, 100, 300, 200);
  await expect(p.locator('#bar')).toBeVisible();
  await p.click('#bar-cancel');
  await waitClosed();
  expect(app.windows().filter((w) => w.url().endsWith('region.html')).length).toBeLessThanOrEqual(1);
});

test('R-C2/R-C7 画框、尺寸标签、询问条位置（贴底翻上方）；截图 55/56', async () => {
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    const p = await openOverlay();
    await p.emulateMedia({ colorScheme: theme });
    await shotWin('region.html', `55-region-overlay-${theme}.png`);
    await drag(p, 120, 140, 600, 460);
    await expect(p.locator('#size')).toHaveText('480 × 320');
    const sz = await p.locator('#size').boundingBox();
    expect(sz.x).toBeCloseTo(120, 0);
    expect(sz.y + sz.height).toBeLessThanOrEqual(140);
    const rect = await p.locator('#rect').boundingBox();
    expect(rect).toMatchObject({ x: 120, y: 140, width: 480, height: 320 });
    expect(await p.evaluate(() => getComputedStyle(document.getElementById('rect')).borderTopColor)).toBe('rgb(255, 138, 0)');
    // 1x 屏上 Chromium 把 1.5px 边框对齐到整像素，断言样式表声明值
    expect(await p.evaluate(() => [...document.styleSheets[0].cssRules].find((r) => r.selectorText === '#rect').style.borderTopWidth)).toBe('1.5px');
    const bar = await p.locator('#bar').boundingBox();
    expect(bar.y).toBeGreaterThanOrEqual(460);
    await expect(p.locator('#bar button')).toHaveText(['收纳', '重选', '取消']);
    await shotWin('region.html', `56-region-confirm-bar-${theme}.png`);
    await p.keyboard.press('Escape');
    await waitClosed();
  }
  await setTheme('system');
  // 贴底：框到屏幕底边，询问条翻到框上方
  const p = await openOverlay();
  const vh = await p.evaluate(() => window.innerHeight);
  await drag(p, 200, vh - 200, 500, vh - 4);
  const s = await rstate();
  expect(s.phase).toBe('confirm');
  expect(s.bar.side).toBe('above');
  const bar = await p.locator('#bar').boundingBox();
  expect(bar.y + bar.height).toBeLessThanOrEqual(vh - 200);
  // 重选：回到可画框状态
  await p.click('#bar-redo');
  await expect(p.locator('#bar')).toBeHidden();
  expect((await rstate()).phase).toBe('idle');
  await p.keyboard.press('Escape');
  await waitClosed();
});

test('R-C2/R-C3 回车 = 收纳；图片尺寸 = 框 × 缩放比，via=region，来源应用正确', async () => {
  for (const sf of [2, 1]) {
    await hook('regionSetScaleFactor', sf);
    const before = (await entries()).length;
    const p = await openOverlay({ sourceApp: sf === 2 ? 'Safari' : '栏历' });
    await drag(p, 50, 60, 290, 220);   // 240 × 160
    await expect(p.locator('#bar')).toBeVisible();
    await p.keyboard.press('Enter');
    await waitClosed();
    await expect.poll(async () => (await entries()).length, { timeout: 5000 }).toBe(before + 1);
    const s = await rstate();
    expect(s.result.ok).toBe(true);
    expect([s.result.width, s.result.height]).toEqual([240 * sf, 160 * sf]);
    const m = (await entries())[0];
    expect(m.type).toBe('image');
    expect(m.via).toBe('region');
    expect(m.title).toBe('框选图片');
    const png = fs.readFileSync(path.join(inboxDir, m.id, m.file));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([240 * sf, 160 * sf]);
    if (sf === 2) expect(m.sourceApp).toBe('Safari'); else expect(m.sourceApp).toBeUndefined();
    const dz = await hook('dropzoneState');
    expect(dz.text).toBe('已收纳 · 框选图片');
    // 列表副行
    await hook('openInboxPanel');
    await page.waitForSelector('.inbox-row');
    const sub = await page.locator('.inbox-row').first().locator('.inbox-row-sub').textContent();
    expect(sub.startsWith(sf === 2 ? '框选 · 来自 Safari' : '框选')).toBe(true);
    if (sf === 1) expect(sub).not.toContain('来自');
    await hook('hideWindow');
  }
  await hook('regionSetScaleFactor', null);
});

test('R-C4 小于 8×8 不出询问条，回到可画框', async () => {
  const p = await openOverlay();
  await drag(p, 300, 300, 305, 340);
  await page.waitForTimeout(200);
  await expect(p.locator('#bar')).toBeHidden();
  expect((await rstate()).phase).toBe('idle');
  await drag(p, 300, 300, 340, 306);
  await expect(p.locator('#bar')).toBeHidden();
  await drag(p, 300, 300, 340, 340);
  await expect(p.locator('#bar')).toBeVisible();
  await p.keyboard.press('Escape');
  await waitClosed();
});

test('R-C5/R-C7 + 0.1.53 Q-C1~Q-C5 无屏幕录制权限：只出说明卡，去授权按顺序；截图 57', async () => {
  const URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
  await hook('regionSetPermission', 'denied');
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    await hook('regionResetProbeCalls');
    const r = await hook('openRegionCapture');
    expect(r).toEqual({ ok: false, permission: 'denied' });
    // Q-C1：只出说明卡，不截屏
    expect(await hook('regionProbeCalls')).toBe(0);
    const s = await rstate();
    expect(s.overlayVisible).toBe(false);
    expect(s.permissionVisible).toBe(true);
    const p = await winPage('region-permission.html');
    await expect(p.locator('#perm-text')).toHaveText('框选收纳要截取你框住的那一块画面，不会上传。');
    await expect(p.locator('#perm-steps')).toHaveText('点「去授权」，在「屏幕录制」列表里打开「栏历」，再按提示重新打开栏历。');
    await expect(p.locator('#perm-close')).toHaveText('以后再说');
    await expect(p.locator('#perm-open')).toHaveText('去授权');
    expect(await p.locator('body').innerText()).not.toContain('+');
    const fit = await p.evaluate(() => { const n = document.getElementById('perm-steps'); const a = document.querySelector('.acts').getBoundingClientRect(); return n.scrollWidth <= n.clientWidth && a.bottom <= window.innerHeight; });
    expect(fit).toBe(true);
    await p.emulateMedia({ colorScheme: theme });
    // Q-C5
    await shotWin('region-permission.html', `57-region-permission-card-${theme}.png`);
    if (theme === 'dark') {
      // Q-C2：去授权 → 先关卡、再登记、最后打开设置
      await p.click('#perm-open');
      await expect.poll(() => hook('regionOpenCalls')).toEqual([URL]);
      expect(await hook('regionProbeCalls')).toBe(1);
      expect(await hook('regionOrder')).toEqual(['close', 'probe', 'open']);
      expect((await rstate()).permissionVisible).toBe(false);
    } else {
      // Q-C4：以后再说 / Esc 都关卡，不登记、不打开设置
      await p.click('#perm-close');
      await expect.poll(async () => (await rstate()).permissionVisible).toBe(false);
      await expect.poll(() => p.isClosed()).toBe(true);
      await hook('openRegionCapture');
      await expect.poll(async () => (await rstate()).permissionVisible).toBe(true);
      const p2 = await winPage('region-permission.html');
      await p2.locator('#perm-open').waitFor();
      await p2.keyboard.press('Escape').catch(() => {}); // Esc 关窗时 press 本身会报页面已关闭
      await expect.poll(async () => (await rstate()).permissionVisible).toBe(false);
      expect(await hook('regionProbeCalls')).toBe(0);
      expect(await hook('regionOpenCalls')).toEqual([]);
    }
  }
  await setTheme('system');
  // Q-C3：去授权后登记让权限变成 granted，直接进框选层，不打开设置
  await hook('regionResetProbeCalls');
  await hook('regionSetPermissionAfterProbe', 'granted');
  await hook('openRegionCapture');
  const p3 = await winPage('region-permission.html');
  await p3.locator('#perm-open').waitFor();
  await p3.keyboard.press('Enter').catch(() => {}); // 回车 = 去授权
  await expect.poll(async () => (await rstate()).overlayVisible).toBe(true);
  expect((await rstate()).permissionVisible).toBe(false);
  expect(await hook('regionOpenCalls')).toEqual([]);
  expect(await hook('regionOrder')).toEqual(['close', 'probe']);
  await hook('regionSetPermissionAfterProbe', null);
  const ov = await winPage('region.html');
  await ov.keyboard.press('Escape');
  await expect.poll(async () => (await rstate()).overlayVisible).toBe(false);
  await hook('regionSetPermission', 'granted');
});

test('R-C6/R-C7 两个快捷键可改、可清空，立即生效；被占用提示；截图 58', async () => {
  await hook('trayRightClick');
  await hook('clickTrayMenuItem', 'tray-open-settings');
  await page.waitForSelector('#setting-region-key');
  await expect(page.locator('#setting-capture-key')).toHaveText('⌃⌥V');
  await expect(page.locator('#setting-region-key')).toHaveText('⌃⌥S');
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: path.join(SHOTS, `58-settings-shortcuts-${theme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  // 改框选键为 ⌃⌥B
  await page.click('#setting-region-key');
  await expect(page.locator('#setting-region-key')).toHaveText('按下新组合…');
  await page.keyboard.press('Control+Alt+KeyB');
  await expect(page.locator('#setting-region-key')).toHaveText('⌃⌥B');
  let hk = await hook('hotkeys');
  expect(hk.registered).toContain('Control+Alt+B');
  expect(hk.registered).not.toContain('Control+Alt+S');
  expect(await hook('pressHotkey', 'Control+Alt+B')).toBe(true);
  await expect.poll(async () => (await rstate()).overlayVisible).toBe(true);
  const p = await winPage('region.html');
  await p.keyboard.press('Escape');
  await waitClosed();
  await hook('trayRightClick');
  expect((await hook('trayMenuItems')).find((i) => i.id === 'tray-region-capture').accelerator).toBe('Control+Alt+B');
  await hook('clickTrayMenuItem', 'tray-open-settings');
  // 清空剪贴板键
  await page.click('#setting-capture-clear');
  await expect(page.locator('#setting-capture-key')).toHaveText('未设置');
  hk = await hook('hotkeys');
  expect(hk.registered).not.toContain('Control+Alt+V');
  expect(hk.capture.accelerator).toBe('');
  // 被占用
  await hook('setBusyAccelerators', ['Control+Alt+Q']);
  await page.click('#setting-capture-key');
  await page.keyboard.press('Control+Alt+KeyQ');
  await expect(page.locator('#setting-capture-hint')).toBeVisible();
  await expect(page.locator('#setting-capture-hint')).toHaveText('快捷键被占用');
  // 再改成可用键，提示消失
  await page.click('#setting-capture-key');
  await page.keyboard.press('Control+Alt+KeyV');
  await expect(page.locator('#setting-capture-hint')).toBeHidden();
  hk = await hook('hotkeys');
  expect(hk.registered).toEqual(expect.arrayContaining(['Control+Alt+V', 'Control+Alt+B']));
  // 恢复默认
  await page.click('#setting-region-key');
  await page.keyboard.press('Control+Alt+KeyS');
  await expect(page.locator('#setting-region-key')).toHaveText('⌃⌥S');
});
