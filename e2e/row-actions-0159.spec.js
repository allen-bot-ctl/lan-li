'use strict';
// 0.1.59 S1–S4（契约 docs/changes/0.1.59-row-actions.md）：悬停按钮不压标题；只有文件类有「在 Finder 中显示」。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-ra-'));
const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const rowOf = (t) => page.locator('.inbox-row', { hasText: t });
const LONG = '栏历 v0.1.57 已出包，持续集成已经通过。安装包链接在这里，请老板在真机上升级后验收这一版的两项修复内容和界面细节';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fileA = path.join(work, 'Annual-Report-2026-第四季度经营分析报告终版.pdf');

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox') } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  fs.writeFileSync(fileA, 'pdf');
  const img = path.join(work, '设计稿.png'); fs.writeFileSync(img, PNG);
  expect((await hook('trayDropFiles', [fileA])).ok).toBe(true);
  expect((await hook('trayDropFiles', [img])).ok).toBe(true);
  expect((await hook('inboxDrop', { html: `<p>${LONG.replace('通过', '<b>通过</b>')}</p>`, text: LONG })).ok).toBe(true);
  expect((await hook('inboxDrop', { text: '一段纯文字' })).ok).toBe(true);
  expect((await hook('inboxDrop', { uriList: ['https://www.github.com/lanli/app'], text: '仓库主页' })).ok).toBe(true);
  await expect.poll(async () => (await hook('dropzoneState')).visible, { timeout: 4000 }).toBe(false);
  await hook('openInboxPanel');
  await page.waitForSelector('#inbox-view:not([hidden])');
});
test.afterAll(async () => { if (app) await app.close(); });

async function gapCheck(row) {
  await row.hover();
  await page.waitForTimeout(100);
  return row.evaluate((el) => {
    const t = el.querySelector('.inbox-row-title');
    const a = el.querySelector('.inbox-row-actions').getBoundingClientRect();
    return { right: t.getBoundingClientRect().right, left: a.left, ellipsis: t.scrollWidth > t.clientWidth };
  });
}

test('S1 长标题图文行悬停：标题右边界 ≤ 按钮组左边界 - 8，且出省略号', async () => {
  const row = rowOf('栏历 v0.1.57');
  const g = await gapCheck(row);
  expect(g.right).toBeLessThanOrEqual(g.left - 8 + 0.5);
  expect(g.ellipsis).toBe(true);
  const f = await gapCheck(rowOf('Annual-Report'));
  expect(f.right).toBeLessThanOrEqual(f.left - 8 + 0.5);
});

test('S2 文件类 4 个按钮；图文/文字/链接/图片 3 个按钮，没有 reveal', async () => {
  await rowOf('Annual-Report').hover();
  expect(await rowOf('Annual-Report').locator('.inbox-act').allTextContents()).toEqual(['在 Finder 中显示', '复制', '#', '×']);
  for (const t of ['栏历 v0.1.57', '一段纯文字', '仓库主页', '设计稿']) {
    await rowOf(t).hover();
    await expect(rowOf(t).locator('.inbox-act-reveal')).toHaveCount(0);
    expect(await rowOf(t).locator('.inbox-act').allTextContents()).toEqual(['复制', '#', '×']);
  }
});

test('S3 右键菜单：非文件类无 inbox-reveal，文件类有；非文件 reveal 返回 false 且不打开 Finder', async () => {
  for (const t of ['栏历 v0.1.57', '一段纯文字', '仓库主页', '设计稿']) {
    await rowOf(t).click({ button: 'right' });
    await expect.poll(() => hook('inboxMenuItems')).not.toBe(null);
    const items = (await hook('inboxMenuItems')).filter((i) => i.type !== 'separator');
    expect(items.map((i) => i.id)).not.toContain('inbox-reveal');
    expect(items.map((i) => i.label)).toEqual(['删除这条']);
  }
  await rowOf('Annual-Report').click({ button: 'right' });
  expect((await hook('inboxMenuItems')).filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual(['在 Finder 中显示', '删除这条']);
  const list = await hook('inboxList');
  const before = (await hook('inboxOpenCalls')).length;
  for (const m of list.filter((x) => x.type !== 'file')) {
    expect(await page.evaluate((id) => window.lanli.revealInboxEntry(id), m.id)).toBe(false);
  }
  expect((await hook('inboxOpenCalls')).length).toBe(before);
  const file = list.find((x) => x.type === 'file');
  expect(await page.evaluate((id) => window.lanli.revealInboxEntry(id), file.id)).toBe(true);
  expect((await hook('inboxOpenCalls')).pop()).toEqual({ how: 'showItemInFolder', target: fileA });
});

test('S4 截图：长标题悬停深浅两套，文件行悬停深色', async () => {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.mouse.move(0, 0);
    await rowOf('栏历 v0.1.57').hover();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `59-row-hover-long-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await rowOf('Annual-Report').hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, '59-row-hover-file-dark.png') });
  await page.emulateMedia({ colorScheme: null });
});
