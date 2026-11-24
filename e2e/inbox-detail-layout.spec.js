'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('收纳文字详情专注阅读，返回保留筛选、日期、滚动位置及原条目焦点', async ({}, info) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-detail-layout-'));
  const inbox = path.join(work, 'inbox');
  const today = new Date();
  const day = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  for (let i = 0; i < 22; i += 1) {
    const id = `20300101-000000-${String(i).padStart(2, '0')}`;
    const dir = path.join(inbox, id);
    const when = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, i);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      id, type: 'text', title: `回归资料 ${i}`, tags: ['备忘'], ref: 'copy', file: 'content.html',
      createdAt: when.toISOString(), createdMs: when.getTime(), schema: 1
    }));
    fs.writeFileSync(path.join(dir, 'content.html'), '<p>完整内容</p>'.repeat(40));
  }
  let app;
  try {
    app = await electron.launch({
      args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inbox, LANLI_READER_DIR: path.join(work, 'reader') }
    });
    const page = await app.firstWindow();
    // Wait for the renderer to finish creating the actual calendar cells, not just its static shell.
    const cell = page.locator(`#grid .cell[data-day="${day}"]`);
    await expect(cell.locator('.cell-inbox-dot')).toHaveCount(1);
    await app.evaluate(() => globalThis.__lanliTest.trayEnter());
    await cell.click();
    if (await page.locator('#inbox-view').isHidden()) await cell.click();
    const list = page.locator('#inbox-list');
    const search = page.locator('#inbox-search');
    const back = page.locator('#inbox-back');
    const detail = page.locator('#inbox-detail');
    const row = list.locator('[data-id="20300101-000000-07"]');
    await expect(page.locator('#inbox-day-chip')).toBeVisible();
    await search.fill('回归资料');
    await page.locator('#inbox-types [data-type="text"]').click();
    await page.locator('#inbox-tags [data-tag="备忘"]').click();
    await expect(list.locator('.inbox-row')).toHaveCount(22);
    const listContext = await page.evaluate(() => JSON.stringify(inboxFilter));
    await row.scrollIntoViewIfNeeded();
    const scroll = await list.evaluate((e) => e.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    const listTop = (await list.boundingBox()).y;
    await row.press('Enter');
    await expect(detail).toBeVisible();
    await expect(back).toHaveAccessibleName('返回收纳列表');
    await expect(back).toBeFocused();
    await expect(page.locator('#inbox-title')).toHaveText('回归资料 7');
    await expect(page.frameLocator('#inbox-detail-frame').locator('p').first()).toHaveText('完整内容');
    expect((await detail.boundingBox()).y).toBeLessThan(listTop - 25);
    for (const sel of ['#inbox-list', '#inbox-search', '#inbox-types', '#inbox-cal-toggle',
      '#inbox-tagrow', '#inbox-count', '#inbox-paste', '#inbox-compose-btn']) await expect(page.locator(sel)).toBeHidden();
    // CSS removes list-only controls from the accessibility tree as well.
    await expect(page.getByRole('searchbox', { name: /搜索收纳/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '粘贴收纳' })).toHaveCount(0);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.locator('#inbox-view').screenshot({ path: info.outputPath(`detail-${scheme}.png`) });
    }
    await page.frameLocator('#inbox-detail-frame').locator('p').first().click();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(search).toHaveValue('回归资料');
    await expect(row).toBeFocused();
    expect(await list.evaluate((e) => e.scrollTop)).toBe(scroll);
    expect(await page.evaluate(() => JSON.stringify(inboxFilter))).toBe(listContext);
    // Back also resumes the list; a second Back (not the first) exits the calendar-day view.
    await row.press('Enter');
    await expect(detail).toBeVisible();
    await back.click();
    await expect(row).toBeFocused();
    await back.click();
    await expect(page.locator('#inbox-view')).toBeHidden();
    expect(await page.evaluate(() => inboxFilter.range)).toBeNull();
  } finally {
    if (app) await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
