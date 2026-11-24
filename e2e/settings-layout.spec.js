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
  await page.waitForSelector('#grid');
  await app.evaluate(() => globalThis.__lanliTest.showWindow());
});
test.afterAll(async () => {
  if (app) await app.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

const tab = (name) => page.locator(`.settings-tab[data-tab="${name}"]`);
const select = (name) => tab(name).click();
const pageHeading = () => page.locator('#settings-page-title');

test('七类设置保留相同入口，标题层级清楚，内嵌选择器与静态卡片不重叠', async ({}, testInfo) => {
  await page.locator('#settings-button').click();
  const categories = [
    ['ui', '界面设置', ['启动与显示', '快捷键']],
    ['almanac', '黄历', ['黄历风格']],
    ['weather', '天气', ['天气城市']],
    ['clocks', '世界时钟', ['编辑世界时钟']],
    ['tags', '标签', ['管理标签']],
    ['reader', '帮阅', ['大模型', '提示词']],
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

test('帮阅输入校验仍生效，短窄窗口能滚动到提示词且标题固定，两个卡片仍操作原有状态', async () => {
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
    await expect(prompt).toHaveJSProperty('readOnly', true);
    await expect(lock).toBeVisible();
    await base.fill('not-a-url');
    await page.locator('#reader-key-save').click();
    await expect(page.locator('#reader-base-err')).toBeVisible();
    await base.fill(baseBefore);
    await page.locator('#reader-key').fill('sk-layout-fake');
    await page.locator('#reader-key-save').click();
    await expect(prompt).toHaveJSProperty('readOnly', false);
    await expect(lock).toBeHidden();
    await prompt.fill('布局回归测试提示词');
    await page.locator('#reader-prompt-save').click();
    await expect(page.locator('#toast-title')).toHaveText('提示词已保存');
    expect(fs.readFileSync(path.join(work, 'user', 'reader-prompt.txt'), 'utf8')).toBe('布局回归测试提示词');
    expect((await pageHeading().boundingBox()).y).toBe(head.y);
    expect(await page.locator('.settings-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.locator('#reader-key-del').click();
    await expect(prompt).toHaveJSProperty('readOnly', true);
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.width = document.body.style.width = '';
      document.documentElement.style.height = document.body.style.height = '';
    });
  }
});
