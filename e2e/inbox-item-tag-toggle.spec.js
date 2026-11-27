'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('既有条目标签多选：即时增删、黄色字体、独立滚动及筛选下恢复原目标', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-item-tags-'));
  let app;
  try {
    app = await electron.launch({ args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox') } });
    const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
    const page = await app.firstWindow();
    await hook('trayDropText', '标签目标 A');
    await hook('trayDropText', '共享条目 B');
    await hook('hideDropzone');
    const entries = await hook('inboxList');
    const first = entries.find((m) => m.title === '标签目标 A').id;
    const second = entries.find((m) => m.title === '共享条目 B').id;
    await page.evaluate(async ([a, b]) => {
      await window.lanli.addInboxTag(a, '共享');
      await window.lanli.addInboxTag(b, '共享');
      for (let i = 0; i < 40; i += 1) await window.lanli.inboxTagCreate('标签' + String(i).padStart(2, '0'));
    }, [first, second]);
    await hook('openInboxPanel');
    const popup = page.locator('#inbox-tagpop');
    const input = page.locator('#inbox-tag-input');
    const chip = (name) => popup.getByRole('button', { name: '#' + name, exact: true });
    const row = () => page.locator(`.inbox-row[data-id="${first}"]`);
    const open = async () => { await row().hover(); await row().locator('.inbox-act-tag').click({ force: true }); await expect(popup).toBeVisible(); };
    const tags = async (id) => (await hook('inboxList')).find((m) => m.id === id).tags;
    await open();
    await expect(input).toBeFocused();
    await expect(chip('共享')).toHaveAttribute('aria-pressed', 'true');
    for (const [mode, color] of [['dark', 'rgb(255, 212, 90)'], ['light', 'rgb(144, 96, 0)']]) {
      await page.emulateMedia({ colorScheme: mode });
      await expect(chip('共享')).toHaveCSS('color', color);
      await chip('共享').hover();
      await expect(chip('共享')).toHaveCSS('color', color);
      await page.screenshot({ path: path.join(__dirname, 'screenshots', 'item-tags-' + mode + '.png') });
    }
    await chip('共享').click();
    await expect(chip('共享')).toHaveAttribute('aria-pressed', 'false');
    expect(await tags(first)).toEqual([]);
    expect(await tags(second)).toEqual(['共享']);
    await chip('共享').click();
    await expect(chip('共享')).toHaveAttribute('aria-pressed', 'true');
    await input.fill('新标签');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(chip('新标签')).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['备忘', '重要', '临时']) {
      await chip(name).click();
      await expect(chip(name)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(chip('标签00')).toBeDisabled();
    await input.fill('超额标签');
    await input.press('Enter');
    await expect(page.locator('#inbox-tagpop-err')).toHaveText('每条最多 5 个标签');
    await input.fill('');
    await chip('重要').click();
    await expect(chip('重要')).toHaveAttribute('aria-pressed', 'false');
    await expect(chip('标签00')).toBeEnabled();
    const beforeInput = await input.boundingBox();
    const manage = popup.getByRole('button', { name: '管理标签…', exact: true });
    const beforeManage = await manage.boundingBox();
    const visible = await page.locator('#inbox-tag-suggest').evaluate((el) => {
      el.scrollTop = 70;
      const r = el.getBoundingClientRect();
      return [...el.children].find((b) => {
        const p = b.getBoundingClientRect();
        return p.top >= r.top && p.bottom <= r.bottom && b.getAttribute('aria-pressed') === 'false';
      }).dataset.tag;
    });
    const scroll = await page.locator('#inbox-tag-suggest').evaluate((el) => el.scrollTop);
    await chip(visible).click();
    await expect(chip(visible)).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(visible)).toBeFocused();
    expect(await page.locator('#inbox-tag-suggest').evaluate((el) => el.scrollTop)).toBe(scroll);
    expect(await input.boundingBox()).toEqual(beforeInput);
    expect(await manage.boundingBox()).toEqual(beforeManage);
    await chip(visible).click();
    await expect(chip(visible)).toHaveAttribute('aria-pressed', 'false');
    await input.press('Escape');
    await expect(popup).toBeHidden();
    await page.locator('.inbox-tag[data-tag="共享"]').click();
    await open();
    const anchor = await popup.boundingBox();
    await chip('共享').click();
    await expect(row()).toHaveCount(0);
    await expect(popup).toBeVisible();
    await expect(chip('共享')).toHaveAttribute('aria-pressed', 'false');
    expect(await popup.boundingBox()).toEqual(anchor);
    expect(await tags(second)).toEqual(['共享']);
    await chip('共享').click();
    await expect(row()).toHaveCount(1);
    await expect(chip('共享')).toHaveAttribute('aria-pressed', 'true');
    expect(await tags(second)).toEqual(['共享']);
    expect((await page.evaluate(() => window.lanli.inboxTags())).some((t) => t.name === '共享')).toBe(true);
    await page.locator('#inbox-search').click();
    await expect(popup).toBeHidden();
  } finally {
    if (app) await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
