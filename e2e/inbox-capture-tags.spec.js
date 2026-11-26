'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('录入和粘贴后就地多选标签；批量应用、跳过、重复及空剪贴板', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-capture-tags-'));
  const app = await electron.launch({
    args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
    env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox') },
  });
  const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof openInboxView === 'function' && !!document.querySelector('#inbox-capture-tags'));
    await expect(async () => {
      await hook('openInboxPanel');
      await expect(page.locator('#inbox-view')).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    const dialog = page.getByRole('dialog', { name: '添加标签' });
    const input = dialog.getByRole('textbox', { name: '搜索或输入新标签' });
    const save = dialog.getByRole('button', { name: '保存标签' });
    const skip = dialog.getByRole('button', { name: '跳过' });
    const read = async () => (await hook('inboxList')).map(({title, tags}) => ({title, tags}));

    await page.locator('#inbox-compose-btn').click();
    await page.locator('#inbox-compose-text').fill('录入的新条目');
    await page.locator('#inbox-compose-save').click();
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    expect(await read()).toEqual([{ title: '录入的新条目', tags: [] }]);
    await input.fill('项目');
    await input.press('Enter');
    await input.fill('待看');
    await input.press('Enter');
    await expect(dialog.locator('#capture-tags-count')).toHaveText('2 / 5');
    for (const mode of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.screenshot({ path: path.join(__dirname, 'screenshots', 'capture-tags-' + mode + '.png') });
    }
    await save.click();
    await expect(dialog).toBeHidden();
    expect(await read()).toEqual([{ title: '录入的新条目', tags: ['项目', '待看'] }]);

    const files = ['甲.txt', '乙.txt'].map((name) => path.join(work, name));
    for (const file of files) fs.writeFileSync(file, '测试附件');
    await hook('setClipboardData', { files });
    await page.locator('#inbox-paste').click();
    await expect(dialog).toContainText('已收纳 2 项');
    await dialog.getByRole('button', { name: '#项目', exact: true }).click();
    await dialog.getByRole('button', { name: '#待看', exact: true }).click();
    await dialog.getByRole('button', { name: '移除标签 待看' }).click();
    await input.fill('附件');
    await save.click();
    await expect(dialog).toBeHidden();
    const state = await read();
    expect(state.filter((r) => r.title !== '录入的新条目').map((r) => r.tags)).toEqual([['项目', '附件'], ['项目', '附件']]);
    expect(state.find((r) => r.title === '录入的新条目').tags).toEqual(['项目', '待看']);

    await page.locator('#inbox-paste').click();
    await expect(page.locator('#toast-title')).toHaveText('已经收过了');
    await expect(dialog).toBeHidden();
    expect(await read()).toHaveLength(3);

    await hook('setClipboardData', { text: '跳过但保留内容' });
    await page.locator('#inbox-paste').click();
    await expect(dialog).toBeVisible();
    await input.fill('未生效');
    await input.press('Enter');
    await skip.click();
    await expect(dialog).toBeHidden();
    expect((await read()).find((r) => r.title === '跳过但保留内容').tags).toEqual([]);

    await hook('setClipboardData', { text: 'Esc 也只关标签框' });
    await page.locator('#inbox-paste').click();
    await expect(dialog).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/calendar.html')).webContents
      .sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }));
    await expect(dialog).toBeHidden();
    await expect(page.locator('#inbox-view')).toBeVisible();

    await hook('setClipboardData', { text: '' });
    await page.locator('#inbox-paste').click();
    await expect(page.locator('#toast-title')).toHaveText('剪贴板里没有可收纳的内容');
    await expect(dialog).toBeHidden();
    expect(await read()).toHaveLength(5);
  } finally {
    await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
