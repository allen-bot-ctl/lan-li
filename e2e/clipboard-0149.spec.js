'use strict';
// 0.1.49 K-C1–K-C6：剪贴板收纳（全局快捷键 / 面板 ⌘V 与按钮 / 托盘菜单共用 captureClipboard）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-clip-'));
const inboxDir = path.join(work, 'inbox');
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
const entries = () => hook('inboxList');
async function shot(name) {
  // 托盘收纳后 page.screenshot 会卡住，改用主进程 capturePage
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('calendar.html'));
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(b64, 'base64'));
}
async function dropPage() {
  for (let i = 0; i < 40; i += 1) {
    const w = app.windows().find((p) => p.url().endsWith('dropzone.html'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await page.waitForTimeout(100);
  }
  throw new Error('dropzone window not found');
}

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
});

test.afterAll(async () => { if (app) await app.close(); });


const SHOTS = path.join(__dirname, 'screenshots');

const clip = (c) => hook('setClipboardData', c);
const capture = (o) => hook('captureClipboard', o);
async function waitHidden() { await expect.poll(async () => (await hook('dropzoneState')).visible, { timeout: 5000 }).toBe(false); }

test('K-C1/K-C2 五种剪贴板类型各收一次，提示框文案正确', async () => {
  const f1 = path.join(work, 'a.txt'); fs.writeFileSync(f1, 'a');
  const f2 = path.join(work, 'b.pdf'); fs.writeFileSync(f2, 'b');
  const cases = [
    [{ text: '第一行\n第二行内容' }, '已收纳 · 文字', 'text'],
    [{ text: 'https://example.com/x' }, '已收纳 · 链接', 'link'],
    [{ html: '<p>标题行</p><p>正文<img src="data:image/png;base64,' + PNG.toString('base64') + '"></p>', text: '标题行\n正文' }, '已收纳 · 图文', 'text'],
    [{ imageBase64: PNG.toString('base64') }, '已收纳 · 图片', 'image'],
    [{ files: [f1, f2] }, '已收纳 · 2 个文件', 'file']
  ];
  for (const [c, text, type] of cases) {
    const before = (await entries()).length;
    await clip(c);
    const r = await capture();
    expect(r.ok).toBe(true);
    const s = await hook('dropzoneState');
    expect(s.visible).toBe(true);
    expect(s.state).toBe('success');
    expect(s.text).toBe(text);
    const list = await entries();
    expect(list.length).toBe(before + (type === 'file' ? 2 : 1));
    expect(list[0].type).toBe(type);
    expect(list[0].via).toBe('clipboard');
  }
  const rich = (await entries()).find((e) => e.type === 'text' && e.rich);
  expect(rich.title).toBe('标题行');
  expect(rich.assets.length).toBe(1);
  expect(rich.sourceApp).toBe('Safari');
  await waitHidden();
});

test('K-C4 空剪贴板报错；3 秒内重复只存一份', async () => {
  await clip({ text: '' });
  const r = await capture();
  expect(r.ok).toBe(false);
  expect((await hook('dropzoneState')).text).toBe('剪贴板里没有可收纳的内容');
  await clip({ text: '重复的一句话' });
  const n0 = (await entries()).length;
  expect((await capture()).ok).toBe(true);
  const r2 = await capture();
  expect(r2.dup).toBe(true);
  expect((await hook('dropzoneState')).text).toBe('已经收过了');
  expect((await entries()).length).toBe(n0 + 1);
  await waitHidden();
});

test('K-C3/K-C5/K-C6 面板 ⌘V、顶栏按钮、托盘菜单三个入口；图文条目显示；截图', async () => {
  await hook('openInboxPanel');
  await expect(page.locator('#inbox-view')).toBeVisible();
  await page.waitForSelector('#inbox-view:not([hidden])');
  await clip({ text: '来自按钮' });
  await page.click('#inbox-paste');
  await page.locator('#capture-tags-skip').click();
  await expect.poll(async () => (await entries())[0].title).toBe('来自按钮');
  await clip({ text: '来自快捷键 ⌘V' });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Meta+V');
  await page.keyboard.press('Control+V');
  await expect.poll(async () => (await entries()).filter((e) => e.title === '来自快捷键 ⌘V').length).toBe(1);
  await page.locator('#capture-tags-skip').click();
  // 搜索框里 ⌘V 是普通粘贴，不收纳
  const n = (await entries()).length;
  await page.focus('#inbox-search');
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(300);
  expect((await entries()).length).toBe(n);
  await page.fill('#inbox-search', '');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const row = page.locator('.inbox-row[data-type="text"]', { hasText: '标题行' }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('.inbox-row-sub')).toHaveText('图文 · 含 1 张图 · 来自 Safari');
  const th = await row.locator('.inbox-row-thumb').boundingBox();
  expect(Math.round(th.width)).toBe(36);
  expect(Math.round(th.height)).toBe(36);
  await page.screenshot({ path: path.join(SHOTS, '52-inbox-paste-button.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, '53-inbox-rich-item-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, '53-inbox-rich-item-light.png') });
  await page.emulateMedia({ colorScheme: null });
  await hook('trayRightClick');
  const items = await hook('trayMenuItems');
  expect(items.map((i) => i.label)).toContain('收纳剪贴板内容');
  await clip({ text: '来自托盘菜单' });
  expect(await hook('clickTrayMenuItem', 'tray-capture-clipboard')).toBe(true);
  await expect.poll(async () => (await entries())[0].title).toBe('来自托盘菜单');
  await clip({ text: '截图用' });
  await capture();
  const dz = await dropPage();
  await dz.waitForTimeout(150);
  await dz.screenshot({ path: path.join(SHOTS, '54-capture-toast.png') });
});
