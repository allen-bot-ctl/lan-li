'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('收纳设置可让日历独立，重启仍关闭，独立收纳与日期筛选不变，可重新挂载', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-calendar-inbox-link-'));
  const inbox = path.join(work, 'inbox');
  const userData = path.join(work, 'user-data');
  const preferenceFile = path.join(userData, 'preferences.json');
  const itemId = '20300101-000000-linked';
  const now = new Date();
  const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4);
  const dayKey = `${when.getFullYear()}-${when.getMonth() + 1}-${when.getDate()}`;
  const itemDir = path.join(inbox, itemId);
  fs.mkdirSync(itemDir, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(preferenceFile, JSON.stringify({ menuBarShowDate: false }));
  const original = JSON.stringify({
    id: itemId, tags: [], missing: false, schema: 1, sourcePath: null, size: 0, ref: 'copy',
    type: 'link', title: '合成收纳链接', sourceUrl: 'https://example.org/calendar',
    createdAt: when.toISOString(), createdMs: when.getTime()
  });
  const metadata = path.join(itemDir, 'meta.json');
  fs.writeFileSync(metadata, original);

  let app;
  async function launch() {
    app = await electron.launch({
      args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_E2E_USER_DATA_DIR: userData,
        LANLI_INBOX_DIR: inbox, LANLI_READER_DIR: path.join(work, 'reader') }
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openSettingsView === 'function');
    await app.evaluate(() => globalThis.__lanliTest.showWindow());
    await expect(page.locator('#grid .cell').first()).toBeVisible();
    return page;
  }
  const switchFor = page => page.getByRole('switch', {name:'是否在日历中链接收纳', exact:true});
  const switchRow = page => page.locator('label.settings-row').filter({has: switchFor(page)});
  const calendarDay = page => page.locator(`#grid .cell[data-day="${dayKey}"]`);
  const prefs = () => JSON.parse(fs.readFileSync(preferenceFile,'utf8'));
  async function openLinkSetting(page) {
    await page.locator('#settings-button').click();
    await page.getByRole('button', {name:'收纳', exact:true}).and(page.locator('.settings-tab')).click();
    await expect(switchFor(page)).toBeVisible();
  }
  async function assertUnlinked(page) {
    await expect(page.locator('#inbox-button')).toBeHidden();
    await expect(calendarDay(page).locator('.cell-inbox-dot')).toHaveCount(0);
    await expect(calendarDay(page)).not.toHaveClass(/has-inbox|inbox-openable/);
    expect(await calendarDay(page).getAttribute('data-tooltip')).toBeNull();
  }
  try {
    let page = await launch();
    await expect(page.locator('#inbox-button')).toBeVisible();
    await expect(calendarDay(page).locator('.cell-inbox-dot')).toBeVisible();
    await expect(calendarDay(page)).toHaveAttribute('data-tooltip', /收纳 1 项/);
    await openLinkSetting(page);
    await expect(switchFor(page)).toBeChecked();
    // The native input is visually clipped. Operate its painted label as users do.
    await switchRow(page).locator('.switch-track').click();
    await expect(switchFor(page)).not.toBeChecked();
    await expect.poll(() => prefs().inboxDateLinkEnabled).toBe(false);
    expect(prefs().menuBarShowDate).toBe(false);
    await page.locator('#settings-back').click();
    await assertUnlinked(page);
    await calendarDay(page).click();
    await calendarDay(page).click();
    await expect(page.locator('#inbox-view')).toBeHidden();
    await page.locator('#next-month').click();
    await page.locator('#prev-month').click();
    await assertUnlinked(page);

    // Exercise the same main-process handler used by the independent tray menu.
    await app.evaluate(() => globalThis.__lanliTest.openInboxPanel());
    await expect(page.locator('#inbox-view')).toBeVisible();
    await expect(page.locator('#inbox-button')).toBeVisible();
    await expect(page.getByText('合成收纳链接', {exact:true})).toBeVisible();
    await page.locator('#inbox-cal-toggle').click();
    await expect(page.locator(`#inbox-view .inbox-minical-day[data-day="${dayKey}"] .inbox-dot`)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#inbox-back').click();
    await assertUnlinked(page);

    await app.close(); app = null; page = await launch();
    await assertUnlinked(page);
    await openLinkSetting(page);
    await expect(switchFor(page)).not.toBeChecked();
    await switchRow(page).locator('.settings-label').click();
    await expect(switchFor(page)).toBeChecked();
    await expect.poll(() => prefs().inboxDateLinkEnabled).toBe(true);
    await page.locator('#settings-back').click();
    await expect(page.locator('#inbox-button')).toBeVisible();
    await expect(calendarDay(page).locator('.cell-inbox-dot')).toBeVisible();
    await calendarDay(page).click();
    await expect(page.locator('#inbox-view')).toBeVisible();
    await expect(page.locator('#inbox-day-chip')).toBeVisible();
    expect(fs.readFileSync(metadata,'utf8')).toBe(original);
  } finally {
    if (app) await app.close();
    fs.rmSync(work, {force:true,recursive:true});
  }
});
