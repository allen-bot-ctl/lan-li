'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app, page, work;
test.beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-settings-layout-'));
  app = await electron.launch({
    args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
    env: {
      ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'),
      LANLI_READER_DIR: path.join(work, 'user')
    }
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.readyState === 'complete' && typeof window.renderReaderSettings === 'function');
  await app.evaluate(() => globalThis.__lanliTest.showWindow());
});
test.afterAll(async () => {
  if (app) await app.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

const tab = (name) => page.locator(`.settings-tab[data-tab="${name}"]`);
const select = (name) => tab(name).click();
const pageHeading = () => page.locator('#settings-page-title');

test('八类设置保留相同入口，标题层级清楚，内嵌选择器与静态卡片不重叠', async ({}, testInfo) => {
  await page.locator('#settings-button').click();
  const basics = page.getByRole('group', { name: '基础', exact: true });
  const apps = page.getByRole('group', { name: '应用', exact: true });
  await expect(basics.getByRole('button')).toHaveText(['界面设置', '大模型', '升级']);
  await expect(apps.getByRole('button')).toHaveText(['黄历', '天气', '世界时钟', '收纳', '帮阅']);
  const divider = page.locator('.settings-nav-divider');
  await expect(divider).toBeVisible();
  await expect(divider).toHaveAttribute('aria-hidden', 'true');
  const [before, line, after] = await Promise.all([basics.boundingBox(), divider.boundingBox(), apps.boundingBox()]);
  expect(line.height).toBe(1);
  expect(line.width).toBeGreaterThan(75);
  expect(line.y).toBeGreaterThan(before.y + before.height);
  expect(line.y + line.height).toBeLessThan(after.y);
  await tab('ui').focus();
  await page.keyboard.press('Tab');
  await expect(tab('llm')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tab('update')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tab('almanac')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pageHeading()).toHaveText('黄历');
  const categories = [
    ['ui', '界面设置', ['启动与显示', '快捷键']],
    ['almanac', '黄历', ['黄历风格']],
    ['weather', '天气', ['天气城市']],
    ['clocks', '世界时钟', ['编辑世界时钟']],
    ['tags', '收纳', ['日历联动', '标签']],
    ['llm', '大模型', ['大模型']],
    ['reader', '帮阅', ['提示词']],
    ['update', '升级', ['版本与更新']]
  ];
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [key, title, headings] of categories) {
      await select(key);
      await expect(tab(key)).toHaveAttribute('aria-selected', 'true');
      await expect(pageHeading()).toHaveText(title);
      const pane = page.locator('.settings-page:not([hidden]), .picker-overlay.is-embedded:not([hidden])');
      await expect(pane).toHaveCount(1);
      const panels = pane.locator('.settings-card-title, .picker-title');
      await expect(panels).toHaveText(headings);
      const rect = await pageHeading().boundingBox();
      const panel = await panels.first().boundingBox();
      expect(panel.y).toBeGreaterThan(rect.y + rect.height);
      await page.locator('.settings-scroll').evaluate((el) => { el.scrollTop = 0; });
      await page.locator('#settings-view').screenshot({ path: testInfo.outputPath(`${key}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: null });
});

test('大模型校验与帮阅手动提示词分开，短窄窗口标题固定且不横向溢出', async () => {
  await select('reader');
  try {
    // Test responsive fallbacks without changing production native window size.
    await page.evaluate(() => {
      document.documentElement.style.width = document.body.style.width = '520px';
      document.documentElement.style.height = document.body.style.height = '320px';
    });
    const head = await pageHeading().boundingBox();
    const prompt = page.locator('#reader-prompt');
    const lock = page.locator('#reader-prompt-lock');
    const base = page.locator('#reader-base');
    const baseBefore = await base.inputValue();
    await expect(prompt).toBeEditable();
    await expect(lock).toBeVisible();
    await expect(base).toBeHidden();
    await expect(page.locator('#reader-prompt-ai')).toBeDisabled();
    await select('llm');
    await expect(prompt).toBeHidden();
    await base.fill('not-a-url');
    await page.locator('#reader-key-save').click();
    await expect(page.locator('#reader-base-err')).toBeVisible();
    await base.fill(baseBefore);
    await page.locator('#reader-key').fill('sk-layout-fake');
    await page.locator('#reader-key-save').click();
    await expect(page.locator('#reader-key-status')).toHaveText('已配置 · deepseek-chat');
    await select('reader');
    await expect(prompt).toBeEditable();
    await expect(page.locator('#reader-prompt-ai')).toBeEnabled();
    await expect(lock).toBeHidden();
    await prompt.fill('布局回归测试提示词');
    await page.locator('#reader-prompt-save').click();
    await expect(page.locator('#toast-title')).toHaveText('提示词已保存');
    expect(fs.readFileSync(path.join(work, 'user', 'reader-prompt.txt'), 'utf8')).toBe('布局回归测试提示词');
    expect((await pageHeading().boundingBox()).y).toBe(head.y);
    expect(await page.locator('.settings-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await select('llm');
    await page.locator('#reader-key-del').click();
    await expect(page.locator('#reader-key-status')).toHaveText('未配置');
    await select('reader');
    await expect(prompt).toBeEditable();
    await expect(page.locator('#reader-prompt-ai')).toBeDisabled();
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.width = document.body.style.width = '';
      document.documentElement.style.height = document.body.style.height = '';
    });
  }
});
