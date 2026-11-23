'use strict';
// 0.1.57 P1–P5：收纳页「粘贴收纳」不弹托盘提示框、窗口不收起、结果用窗口内 toast；标签页「删除」灰色悬停变红。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-pp-'));
const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const count = async () => (await hook('inboxList')).length;
const toastTitle = () => page.locator('#toast-title');

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox') } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await hook('openInboxPanel');
  await page.waitForSelector('#inbox-view:not([hidden])');
});
test.afterAll(async () => { if (app) await app.close(); });

async function pasteAndCheck(clipData) {
  if (clipData) await hook('setClipboardData', clipData);
  await page.click('#inbox-paste');
  await page.waitForTimeout(1500);
  expect(await hook('isPinned')).toBe(false);
  expect(await hook('isVisible')).toBe(true);
  expect((await hook('dropzoneState')).visible).toBe(false);
  await expect(page.locator('#toast')).toBeVisible();
}

test('P1 未钉住点「粘贴收纳」：窗口仍可见、无托盘提示框、窗口内 success toast、条数 +1', async () => {
  const n = await count();
  await pasteAndCheck({ text: '面板粘贴一段文字' });
  await expect(toastTitle()).toHaveText('已收纳 · 文字');
  expect(await count()).toBe(n + 1);
  await expect(page.locator('.inbox-row').first()).toContainText('面板粘贴一段文字');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `57-panel-paste-toast-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
});

test('P3 连点两次同一内容：第二次 info toast「已经收过了」，条数只 +1', async () => {
  const n = await count();
  await pasteAndCheck({ text: '重复的内容' });
  await pasteAndCheck(null);
  await expect(toastTitle()).toHaveText('已经收过了');
  expect(await count()).toBe(n + 1);
});

test('P2 剪贴板为空：窗口仍可见、warning toast、条数不变', async () => {
  const n = await count();
  await pasteAndCheck({ text: '' });
  await expect(toastTitle()).toHaveText('剪贴板里没有可收纳的内容');
  expect(await count()).toBe(n);
});

test('P5 标签页「删除」常态 --muted，悬停 #ff3b30', async () => {
  await page.evaluate(() => { if (typeof closeInboxView === 'function') closeInboxView(); });
  await hook('trayEnter');
  await page.click('#settings-button');
  await expect.poll(() => hook('clickSettingsMenuItem', 'more-settings'), { timeout: 5000 }).toBe(true);
  await hook('closeSettingsMenu');
  await page.click('.settings-tab[data-tab="tags"]');
  const del = page.locator('.tag-row-delete').first();
  await expect(del).toBeVisible();
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    const c = await del.evaluate((el) => {
      const probe = document.createElement('span'); probe.style.color = 'var(--muted)'; document.body.appendChild(probe);
      const muted = getComputedStyle(probe).color; probe.remove();
      return { now: getComputedStyle(el).color, muted };
    });
    expect(c.now).toBe(c.muted);
    await del.hover();
    await page.waitForTimeout(150);
    expect(await del.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 59, 48)');
    await page.screenshot({ path: path.join(SHOTS, `57-tags-delete-hover-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
});
