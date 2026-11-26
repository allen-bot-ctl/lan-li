'use strict';
// 0.1.58 R4：从网页/聊天窗口复制（HTML 开头带 <meta charset>）后点「粘贴收纳」，条目标题是正文第一行，列表不是空白图文。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-rm-'));
const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox') } });
  page = await app.firstWindow();
  await page.waitForFunction(() => typeof openInboxView === 'function' && !!document.getElementById('capture-tags-skip'));
});
test.afterAll(async () => { if (app) await app.close(); });

test('R2 带 meta 的富文本粘贴收纳：标题是正文开头，详情里能看到文字和链接；R4 深浅截图无白块', async () => {
  await expect(async () => {
    await hook('openInboxPanel');
    await expect(page.locator('#inbox-view')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await hook('setClipboardData', {
    html: "<meta charset='utf-8'><p>栏历 v0.1.57 已出包，<a href=\"https://example.com\">安装包</a></p>",
    text: '栏历 v0.1.57 已出包，安装包'
  });
  await page.click('#inbox-paste');
  await page.locator('#capture-tags-skip').click();
  await expect(page.locator('#toast-title')).toHaveText('已收纳 · 图文');
  const [m] = await hook('inboxList');
  expect(m.title.startsWith('栏历 v0.1.57 已出包，安装包')).toBe(true);
  await page.locator('.inbox-row', { hasText: '栏历 v0.1.57 已出包' }).first().click();
  await expect(page.locator('#inbox-detail')).toBeVisible();
  const frame = page.frameLocator('#inbox-detail-frame');
  await expect(frame.locator('body')).toContainText('栏历 v0.1.57 已出包');
  await expect(frame.locator('a')).toHaveText('安装包');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    const c = await frame.locator('body').evaluate((b) => ({ bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color, cs: getComputedStyle(document.documentElement).colorScheme }));
    expect(c.bg).toBe('rgba(0, 0, 0, 0)');
    expect(c.cs).toBe('light dark');
    expect(c.fg).toBe(scheme === 'dark' ? 'rgb(245, 245, 247)' : 'rgb(29, 29, 31)');
    await page.screenshot({ path: path.join(SHOTS, `58-rich-detail-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await page.locator('#inbox-back').click();
});

test('R3 清洗后为空、text 有字：存成「文字」条目，内容是「备用文字」', async () => {
  await expect(async () => {
    await hook('openInboxPanel');
    await expect(page.locator('#inbox-view')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await hook('setClipboardData', { html: '<style>p{}</style>', text: '备用文字' });
  await page.click('#inbox-paste');
  await page.locator('#capture-tags-skip').click();
  await expect(page.locator('#toast-title')).toHaveText(/已收纳/);
  await expect.poll(async () => (await hook('inboxList'))[0].title).toBe('备用文字');
  const [m] = await hook('inboxList');
  expect(m.rich).toBeFalsy();
});
