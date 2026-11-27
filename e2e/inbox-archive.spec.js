'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('收纳归档与纯链接录入：真实入口、范围筛选、日期计数及恢复重启持久性', async () => {
  test.setTimeout(90000);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-archive-e2e-'));
  const root = path.join(work, 'inbox');
  const history = new Date(); history.setDate(1); history.setHours(12, 0, 0, 0);
  const key = `${history.getFullYear()}-${history.getMonth() + 1}-${history.getDate()}`;
  const oldId = '20200101-000000-legacy';
  const missingId = '20200101-000001-missing';
  const seed = (id, data) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'meta.json'), JSON.stringify({ id, schema: 1, tags: [],
      createdAt: history.toISOString(), createdMs: history.getTime(), size: 0, ref: 'copy', ...data }));
  };
  seed(oldId, { type: 'link', title: '旧链接', sourceUrl: 'https://history.example/unique-history-path' });
  // This missing file is dated a different day, so the link owns its date marker.
  seed(missingId, { type: 'file', title: '缺失文件.txt', createdMs: history.getTime() + 86400000,
    createdAt: new Date(history.getTime() + 86400000).toISOString(), sourcePath: path.join(work, 'missing.txt'), file: 'missing.txt.symlink' });
  let app, page, hook;
  const launch = async () => {
    app = await electron.launch({ args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: root } });
    hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
    page = await app.firstWindow();
    await page.waitForSelector('#grid');
    await expect(async () => { await hook('openInboxPanel'); await expect(page.locator('#inbox-view')).toBeVisible({ timeout: 500 }); }).toPass();
  };
  try {
    await launch();
    const scope = (type) => page.locator(`#inbox-types [data-type="${type}"]`);
    const row = (id) => page.locator(`.inbox-row[data-id="${id}"]`);
    const list = () => hook('inboxList');
    const archive = async (id, restore = false) => {
      await row(id).hover();
      await row(id).getByRole('button', { name: restore ? '恢复收纳' : '归档收纳', exact: true }).click();
      await expect(row(id)).toHaveCount(0);
      await expect(page.locator('#toast-title')).toHaveText(restore ? '已恢复收纳' : '已归档');
    };
    await expect(row(oldId)).toHaveCount(1);
    await scope('archived').click();
    await expect(page.locator('#inbox-empty')).toHaveText(/还没有归档/);
    await expect(page.locator('#inbox-noresult')).toBeHidden();
    await scope('all').click();
    const capture = async (text, type) => {
      await page.locator('#inbox-compose-btn').click();
      await page.locator('#inbox-compose-text').fill(text);
      await page.locator('#inbox-compose-save').click();
      const receipt = page.locator('#inbox-capture-tags');
      await expect(receipt.getByRole('heading')).toHaveText('录入成功');
      await expect(receipt.locator('.capture-tags-item-type')).toHaveText(type);
      await receipt.getByRole('button', { name: '暂不添加', exact: true }).click();
    };
    const url = 'https://example.com/manual-unique-path?q=1#part';
    await capture('  ' + url + ' \n', '链接');
    const manual = (await list()).find((m) => m.sourceUrl === url);
    expect(manual.type).toBe('link');
    expect(manual.via).toBe('manual');
    for (const text of ['说明 https://example.com/a', 'https://a.example https://b.example', 'example.com/no-protocol']) await capture(text, '文字');
    await page.evaluate(async ([a, b]) => { await window.lanli.addInboxTag(a, '历史'); await window.lanli.addInboxTag(b, '当前'); }, [oldId, manual.id]);
    await expect(page.locator('#inbox-tags [data-tag="历史"]')).toBeVisible();
    await row(manual.id).hover();
    expect(await row(manual.id).locator('.inbox-act').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))))
      .toEqual(['复制', '归档收纳', '#', '×']);
    await expect(row(manual.id).locator('.inbox-act-archive svg')).toHaveCount(1);
    // A date containing only the historical link disappears from the home calendar.
    expect((await page.evaluate(() => window.lanli.inboxDayCounts()))[key]).toBe(1);
    await page.locator('#inbox-search').fill('unique-history-path');
    await page.locator('#inbox-tags [data-tag="历史"]').click();
    await page.locator('#inbox-cal-toggle').click();
    const date = page.locator(`#inbox-minical [data-day="${key}"]`);
    await date.click(); await date.click();
    await expect(row(oldId)).toHaveCount(1);
    const before = (await list()).find((m) => m.id === oldId);
    await archive(oldId);
    await expect(page.locator('#inbox-noresult')).toBeVisible();
    await expect(page.locator('#inbox-empty')).toBeHidden();
    await expect(page.locator('#inbox-tags [data-tag="历史"]')).toHaveClass(/is-active/);
    expect((await page.evaluate(() => window.lanli.inboxDayCounts()))[key]).toBeUndefined();
    await expect(page.locator(`.cell[data-day="${key}"] .cell-inbox-dot`)).toHaveCount(0);
    await scope('archived').click();
    await expect(row(oldId)).toHaveCount(1);
    await expect(page.locator('#inbox-search')).toHaveValue('unique-history-path');
    await expect(page.locator('#inbox-day-chip')).toBeVisible();
    await expect(page.locator('#inbox-tags [data-tag="当前"]')).toHaveCount(0);
    await page.locator('#inbox-cal-toggle').click();
    await expect(date).toHaveClass(/has-inbox/);
    await expect(date.locator('.inbox-dot')).toHaveCount(1);
    await page.locator('#inbox-cal-toggle').click();
    const after = (await list()).find((m) => m.id === oldId);
    expect(after.createdMs).toBe(before.createdMs);
    expect(after.type).toBe(before.type);
    expect(after.sourceUrl).toBe(before.sourceUrl);
    expect(after.tags).toEqual(before.tags);
    for (const mode of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.setViewportSize({ width: 400, height: 432 });
      const boxes = await page.locator('#inbox-toolbar').evaluate((el) => [...el.querySelectorAll('input,button')].map((b) => {
        const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom };
      }));
      expect(boxes.every((r) => r.left >= 0 && r.right <= 400)).toBe(true);
      await page.screenshot({ path: path.join(__dirname, 'screenshots', 'archive-scope-' + mode + '.png') });
    }
    await page.setViewportSize({ width: 580, height: 432 });
    await archive(oldId, true);
    await expect(page.locator('#inbox-empty')).toHaveText(/还没有归档/);
    await scope('all').click();
    await expect(row(oldId)).toHaveCount(1);
    expect((await page.evaluate(() => window.lanli.inboxDayCounts()))[key]).toBe(1);
    await page.locator('#inbox-search').fill('');
    await page.locator('#inbox-day-chip-x').click();
    await page.locator('#inbox-tags [data-tag="历史"]').click();
    await scope('file').click();
    await expect(row(missingId)).toHaveCount(1);
    await archive(missingId);
    await scope('archived').click();
    await expect(row(missingId)).toHaveCount(1);
    await app.close(); app = null;
    await launch();
    await expect(row(missingId)).toHaveCount(0);
    await scope('archived').click();
    await expect(row(missingId)).toHaveClass(/is-missing/);
    await archive(missingId, true);
    await scope('file').click();
    await expect(row(missingId)).toHaveClass(/is-missing/);
    expect((await list()).find((m) => m.id === missingId).archived).toBe(false);
  } finally {
    if (app) await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
