'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('录入与粘贴复用标签弹层：多选新增只在外层保存写入，列表仍单选即添加', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-capture-tags-'));
  let app;
  try {
    app = await electron.launch({
      args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox') },
    });
    const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof openInboxView === 'function' && !!document.querySelector('#inbox-capture-tags'));
    await expect(async () => {
      await hook('openInboxPanel');
      await expect(page.locator('#inbox-view')).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    const outer = page.locator('#inbox-capture-tags');
    const card = outer.locator('.capture-tags-card');
    const picker = outer.locator('#capture-tags-picker');
    const input = picker.getByRole('textbox', { name: '搜索或输入新标签' });
    const add = card.getByRole('button', { name: '添加标签', exact: true });
    const edit = card.getByRole('button', { name: '重新选择', exact: true });
    const save = card.getByRole('button', { name: '保存标签', exact: true });
    const skip = card.getByRole('button', { name: '暂不添加', exact: true });
    const confirm = picker.getByRole('button', { name: '确认', exact: true });
    const preview = card.locator('#capture-tags-picked');
    const read = async () => (await hook('inboxList')).map(({ title, tags }) => ({ title, tags }));
    const library = () => page.evaluate(() => window.lanli.inboxTags());
    const tagFile = () => fs.readFileSync(path.join(work, 'inbox', 'tags.json'), 'utf8');
    const escape = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/calendar.html')).webContents
      .sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }));
    const paste = async (data) => {
      await hook('setClipboardData', data);
      await page.locator('#inbox-paste').click();
      await expect(outer).toBeVisible();
      await expect(card.getByRole('heading', { level: 2 })).toHaveText('粘贴收纳成功');
    };
    const outerState = async (tags = []) => {
      await expect(outer).toBeVisible();
      await expect(picker).toBeHidden();
      await expect(card.locator('footer button:visible')).toHaveText(['暂不添加', tags.length ? '保存标签' : '添加标签']);
      await expect(card.getByRole('textbox')).toHaveCount(0);
      await expect(preview.locator('button')).toHaveCount(0);
      await expect(preview.locator('.inbox-tag-suggest-item')).toHaveText(tags.map((t) => '#' + t));
      await expect(card.getByRole('button', { name: '返回', exact: true })).toHaveCount(0);
      await expect(skip).toBeInViewport();
    };
    const pickerState = async () => {
      await expect(outer).toHaveAttribute('open', '');
      await expect(picker).toBeVisible();
      await expect(input).toBeFocused();
      await expect(picker).toHaveClass(/inbox-tagpop/);
      await expect(picker.locator('footer button')).toHaveText(['确认']);
      await expect(picker.getByRole('button', { name: /管理标签/ })).toHaveCount(0);
      const parent = await outer.boundingBox();
      const child = await picker.boundingBox();
      expect(Math.abs(parent.x + parent.width / 2 - child.x - child.width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(parent.y + parent.height / 2 - child.y - child.height / 2)).toBeLessThanOrEqual(1);
      await expect(confirm).toBeInViewport();
    };
    const shot = async (name) => {
      for (const mode of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: mode });
        if (await picker.isVisible()) await pickerState();
        await page.screenshot({ path: path.join(__dirname, 'screenshots', name + '-' + mode + '.png') });
      }
    };

    // 录入：内层新增、多选和确认都不得修改条目或标签库。
    await page.locator('#inbox-compose-btn').click();
    await page.locator('#inbox-compose-text').fill('录入的新条目');
    await page.locator('#inbox-compose-save').click();
    await outerState();
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('录入成功');
    await expect(card.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(card.locator('.capture-tags-item-title')).toHaveText('录入的新条目');
    await expect(card.locator('.capture-tags-item-type')).toHaveText('文字');
    await expect(page.locator('#toast')).toBeHidden();
    const initial = await read();
    const initialLibrary = tagFile();
    await shot('capture-receipt');
    await add.click();
    await pickerState();
    await picker.getByRole('button', { name: '#备忘', exact: true }).click();
    await picker.getByRole('button', { name: '#重要', exact: true }).click();
    await input.fill('新建标签');
    await input.press('Enter');
    await expect(picker.locator('#capture-tags-count')).toHaveText('3 / 5');
    await expect(picker.getByRole('button', { name: '#备忘', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByRole('button', { name: '#新建标签', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await read()).toEqual(initial);
    expect(tagFile()).toBe(initialLibrary);
    await shot('capture-tag-selector');
    await input.fill('查询不保存');
    await confirm.click();
    await outerState(['备忘', '重要', '新建标签']);
    expect(await read()).toEqual(initial);
    expect(tagFile()).toBe(initialLibrary);
    await shot('capture-confirmed');

    // 再次进入编辑；Esc 丢弃内层未确认变动，不污染外层已确认草稿。
    await edit.click();
    await pickerState();
    await expect(picker.getByRole('button', { name: '#重要', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await picker.getByRole('button', { name: '#重要', exact: true }).click();
    await input.fill('未确认新增');
    await picker.getByRole('button', { name: '新建标签 未确认新增', exact: true }).click();
    await escape();
    await outerState(['备忘', '重要', '新建标签']);
    await expect(edit).toBeFocused();
    expect(tagFile()).toBe(initialLibrary);
    await edit.click();
    await pickerState();
    await expect(picker.getByRole('button', { name: '#未确认新增', exact: true })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: '#重要', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await picker.getByRole('button', { name: '#重要', exact: true }).click();
    await confirm.click();
    await outerState(['备忘', '新建标签']);
    await save.click();
    await expect(outer).toBeHidden();
    expect(await read()).toEqual([{ title: '录入的新条目', tags: ['备忘', '新建标签'] }]);
    expect((await library()).some((t) => t.name === '新建标签')).toBe(true);
    expect((await library()).some((t) => ['未确认新增', '查询不保存'].includes(t.name))).toBe(false);

    // 原列表弹层保持管理入口、单选立即添加并关闭；不出现内层确认步骤。
    const row = page.locator('.inbox-row', { hasText: '录入的新条目' });
    await row.hover();
    await row.locator('.inbox-act-tag').click({ force: true });
    const listPicker = page.locator('#inbox-tagpop');
    await expect(listPicker).toBeVisible();
    await expect(listPicker.getByRole('button', { name: '管理标签…', exact: true })).toBeVisible();
    await expect(listPicker.getByRole('button', { name: '确认', exact: true })).toHaveCount(0);
    await listPicker.getByRole('button', { name: '#临时', exact: true }).click();
    await expect(listPicker).toBeHidden();
    expect((await read())[0].tags).toEqual(['备忘', '新建标签', '临时']);

    // 批量粘贴：一次确认，外层保存才把标签和新增库标签写入全部新条目。
    const files = ['甲.txt', '乙.txt', '丙.txt'].map((name) => path.join(work, name));
    for (const file of files) fs.writeFileSync(file, '测试附件');
    await paste({ files });
    await outerState();
    await expect(card).toContainText('本次保存了 3 项，标签将应用到全部条目。');
    await expect(card.locator('.capture-tags-item-title')).toHaveText(['甲.txt', '乙.txt']);
    await expect(card.locator('#capture-tags-items')).toContainText('另有 1 项');
    const beforeBatch = await read();
    const beforeBatchLibrary = tagFile();
    await add.click();
    await picker.getByRole('button', { name: '#重要', exact: true }).click();
    await input.fill('批量新增');
    await picker.getByRole('button', { name: '新建标签 批量新增', exact: true }).click();
    await confirm.click();
    await outerState(['重要', '批量新增']);
    expect(await read()).toEqual(beforeBatch);
    expect(tagFile()).toBe(beforeBatchLibrary);
    await save.click();
    await expect(outer).toBeHidden();
    expect((await read()).filter((r) => r.title !== '录入的新条目').map((r) => r.tags))
      .toEqual([['重要', '批量新增'], ['重要', '批量新增'], ['重要', '批量新增']]);
    expect((await library()).some((t) => t.name === '批量新增')).toBe(true);
    await page.locator('#inbox-paste').click();
    await expect(page.locator('#toast-title')).toHaveText('已经收过了');
    await expect(outer).toBeHidden();
    expect(await read()).toHaveLength(4);

    // 已确认草稿仍可直接暂不添加；新建库标签也不能提前落盘。
    await paste({ text: '跳过但保留内容' });
    const beforeSkipLibrary = tagFile();
    await add.click();
    await input.fill('跳过新增');
    await input.press('Enter');
    await confirm.click();
    await outerState(['跳过新增']);
    await skip.click();
    await expect(outer).toBeHidden();
    expect((await read()).find((r) => r.title === '跳过但保留内容').tags).toEqual([]);
    expect(tagFile()).toBe(beforeSkipLibrary);

    // 内层 Esc 返回外层，外层 Esc 丢弃已确认草稿；内容始终存在。
    await paste({ text: 'Esc 也只关标签框' });
    await add.click();
    // 原生 cancel 即使冒泡也只处理内层；常规 Esc 走主进程 IPC。
    await picker.dispatchEvent('cancel', { bubbles: true, cancelable: true });
    await outerState();
    await add.click();
    await escape();
    await outerState();
    await expect(add).toBeFocused();
    await add.click();
    await input.fill('退出新增');
    await input.press('Enter');
    await confirm.click();
    await escape();
    await expect(outer).toBeHidden();
    await expect(page.locator('#inbox-view')).toBeVisible();
    expect((await read()).find((r) => r.title === 'Esc 也只关标签框').tags).toEqual([]);
    expect(tagFile()).toBe(beforeSkipLibrary);
    await hook('setClipboardData', { text: '' });
    await page.locator('#inbox-paste').click();
    await expect(page.locator('#toast-title')).toHaveText('剪贴板里没有可收纳的内容');
    await expect(outer).toBeHidden();
    expect(await read()).toHaveLength(6);

    const source = '**内容预览&amp;#x20;**&amp;#x5DF2;保存下一句。';
    await paste({ html: '<p>' + source + '</p>', text: source });
    await expect(card.locator('#capture-tags-items')).toHaveText(/富文本.*内容预览.*已保存下一句/);
    await expect(card.locator('#capture-tags-items')).not.toHaveText(/\*\*|&#x/);
    await expect(outer).toHaveCSS('border-top-left-radius', '14px');
    await skip.click();
  } finally {
    if (app) await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
