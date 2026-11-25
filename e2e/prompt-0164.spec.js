'use strict';
// 0.1.64 没配大模型锁定提示词、「AI 改提示词」弹框（契约 docs/changes/0.1.64.md）。大模型一律用假接口，不碰真实 API。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-p64-'));
const PFILE = path.join(work, 'user', 'reader-prompt.txt');
const hook = async (name, arg) => {
  for (let i = 0; ; i += 1) {
    try { return await app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg }); } catch (e) {
      if (i >= 2 || !/garbage collected/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
};
async function shots(name, locator) {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(120);
    await (locator || page).screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
}
const openReaderSettings = async () => { await page.evaluate(() => window.openSettingsView('reader')); await page.waitForSelector('#settings-page-reader:not([hidden])'); };
const rewriteCalls = async () => (await hook('readerLlmCalls')).filter((c) => !c.ping && c.system && c.system.startsWith('你是提示词编辑'));
const ov = () => page.locator('#prompt-ai-overlay');
const fileText = () => (fs.existsSync(PFILE) ? fs.readFileSync(PFILE, 'utf8') : null);
async function openAi(input) {
  await page.click('#reader-prompt-ai');
  await expect(ov()).toBeVisible();
  if (input != null) await page.fill('#prompt-ai-input', input);
}
async function closeAi() { if (await ov().isVisible()) await page.click('#prompt-ai-keep'); await expect(ov()).toBeHidden(); }

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'user') } });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.readyState === 'complete' &&
    typeof window.openReaderView === 'function' && typeof window.renderReaderSettings === 'function');
  await hook('showWindow');
});
test.afterAll(async () => { if (app) await app.close(); });
test.beforeEach(async ({}, info) => {
  if (!/^R2/.test(info.title)) return;
  expect((await hook('readerSaveConfig', {
    baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-e2e-0164'
  })).ok).toBe(true);
  // R2c/d verify that a prior saved prompt survives cancellation, without
  // requiring R2b's Playwright worker to have completed successfully.
  if (/^R2[cd]/.test(info.title)) {
    expect((await page.evaluate(() => window.lanli.saveReaderPrompt('新版二'))).ok).toBe(true);
  }
  await openReaderSettings();
  await expect(page.locator('#reader-prompt')).toBeEditable();
  await expect(page.locator('#reader-prompt-ai')).toBeEnabled();
});


test('R1 无大模型仍可手动改提示词，只锁 AI；入口、保存和删除 Key 立即更新应用状态', async () => {
  await openReaderSettings();
  const editor = page.locator('#reader-prompt');
  const warning = page.locator('#reader-prompt-lock');
  const modelCta = page.locator('#reader-settings-llm-go');
  const ai = page.locator('#reader-prompt-ai');
  const localSave = page.locator('#reader-prompt-save');
  const localReset = page.locator('#reader-prompt-reset');
  const model = page.locator('#settings-page-llm');
  await expect(model).toBeHidden();
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button')).toHaveCount(1);
  await expect(modelCta).toHaveText('前往大模型');
  await expect(ai).toBeDisabled();
  await expect(editor).toBeEditable();
  await expect(localSave).toBeEnabled();
  await expect(localReset).toBeEnabled();
  await expect(editor).toHaveValue(/^你是阅读助手/);
  await expect(page.locator('.reader-prompt-hint')).toBeVisible();
  await shots('64-prompt-locked', page.locator('#settings-view'));

  await editor.fill('没有大模型也能手动保存的提示词');
  await localSave.click();
  await expect(page.locator('#toast-title')).toHaveText('提示词已保存');
  expect(fileText()).toBe('没有大模型也能手动保存的提示词');

  await modelCta.click();
  await expect(model).toBeVisible();
  await expect(page.locator('#settings-page-reader')).toBeHidden();
  await expect(page.locator('#reader-key-status')).toHaveText('未配置');
  await page.fill('#reader-key', 'sk-e2e-0164');
  await page.click('#reader-key-save');
  await expect(page.locator('#reader-key-status')).toHaveText('已配置 · deepseek-chat');
  await page.locator('.settings-tab[data-tab="reader"]').click();
  await expect(ai).toBeEnabled();
  await expect(warning).toBeHidden();
  await expect(editor).toHaveValue('没有大模型也能手动保存的提示词');

  await page.locator('.settings-tab[data-tab="llm"]').click();
  await page.click('#reader-key-del');
  await expect(page.locator('#reader-key-status')).toHaveText('未配置');
  await page.locator('.settings-tab[data-tab="reader"]').click();
  await expect(warning).toBeVisible();
  await expect(ai).toBeDisabled();
  await expect(editor).toBeEditable();
  await localReset.click();
  await expect(page.locator('#toast-title')).toHaveText('已恢复默认');
  expect(fileText()).toBeNull();

  // A fake 401 from Test Connection does not invalidate saved model fields.
  await modelCta.click();
  await page.fill('#reader-key', 'sk-e2e-0164');
  await page.click('#reader-key-save');
  await expect(page.locator('#reader-key-status')).toHaveText('已配置 · deepseek-chat');
  await hook('readerSetFakeLlm', { status: 401 });
  await page.click('#reader-test');
  await expect(page.locator('#reader-key-status')).toContainText('测试失败');
  await page.locator('.settings-tab[data-tab="reader"]').click();
  await expect(ai).toBeEnabled();
  await hook('readerSetFakeLlm', null);
});

test('R2a 刚打开：需求框空且有焦点、无结果区、取消 + 生成新版（空时置灰）；需求框不超过 500 字', async () => {
  await openReaderSettings();
  await page.fill('#reader-prompt', '我的原提示词\n第二行');   // 未保存的改动
  await openAi();
  await expect(page.locator('#prompt-ai-input')).toBeFocused();
  await expect(page.locator('#prompt-ai-input')).toHaveValue('');
  await expect(page.locator('#prompt-ai-result')).toBeHidden();
  await expect(page.locator('#prompt-ai-keep')).toHaveText('取消');
  await expect(page.locator('#prompt-ai-go')).toHaveText('生成新版');
  await expect(page.locator('#prompt-ai-go')).toBeDisabled();
  await expect(page.locator('#prompt-ai-retry')).toBeHidden();
  await expect(page.locator('#prompt-ai-use')).toBeHidden();
  expect(await page.locator('#prompt-ai-input').getAttribute('maxlength')).toBe('500');
  expect(await page.locator('.prompt-ai-card').evaluate((e) => e.getBoundingClientRect().width)).toBe(440);
  await shots('64-prompt-ai-input');
  await page.fill('#prompt-ai-input', '核心要点只留 3 条');
  await expect(page.locator('#prompt-ai-go')).toBeEnabled();
  await closeAi();
  expect(fileText()).toBeNull();
});

test('R2b 生成中只读；成功后结果区 + 三个按钮；基于未保存内容；再试一版从同一版改；点遮罩不关；使用新版保存', async () => {
  await page.fill('#reader-prompt', '我的原提示词\n第二行');
  await hook('readerSetFakeLlm', { raw: '新版一\n只留 3 条', delayMs: 600 });
  const before = (await rewriteCalls()).length;
  await openAi('核心要点只留 3 条');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-go')).toHaveText('生成中…');
  await expect(page.locator('#prompt-ai-go')).toBeDisabled();
  await expect(page.locator('#prompt-ai-input')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('#prompt-ai-result-text')).toHaveText('新版一\n只留 3 条', { timeout: 10000 });
  await expect(page.locator('#prompt-ai-keep')).toHaveText('保持原版');
  await expect(page.locator('#prompt-ai-retry')).toHaveText('再试一版');
  await expect(page.locator('#prompt-ai-use')).toHaveText('使用新版');
  await expect(page.locator('#prompt-ai-go')).toBeHidden();
  await shots('64-prompt-ai-result');
  let calls = await rewriteCalls();
  expect(calls.length).toBe(before + 1);
  expect(calls[calls.length - 1].user).toBe('<<<现行提示词>>>\n我的原提示词\n第二行\n<<<结束>>>\n\n<<<修改需求>>>\n核心要点只留 3 条\n<<<结束>>>');
  expect(calls[calls.length - 1].maxTokens).toBe(4096);
  // 点遮罩不关
  await page.mouse.click(5, 200);
  await expect(ov()).toBeVisible();
  // 再试一版：需求框当前文字，仍从打开时那一版改
  await hook('readerSetFakeLlm', { raw: '新版二', delayMs: 300 });
  await page.fill('#prompt-ai-input', '再短一点');
  await page.click('#prompt-ai-retry');
  await expect(page.locator('#prompt-ai-retry')).toHaveText('生成中…');
  await expect(page.locator('#prompt-ai-use')).toBeDisabled();
  await expect(page.locator('#prompt-ai-result-text')).toHaveText('新版二', { timeout: 10000 });
  calls = await rewriteCalls();
  expect(calls.length).toBe(before + 2);
  expect(calls[calls.length - 1].user).toBe('<<<现行提示词>>>\n我的原提示词\n第二行\n<<<结束>>>\n\n<<<修改需求>>>\n再短一点\n<<<结束>>>');
  expect(fileText()).toBeNull();
  // 使用新版：保存、提示词框换成新版、弹框关闭、toast
  await page.click('#prompt-ai-use');
  await expect(ov()).toBeHidden();
  await expect(page.locator('#toast-title')).toHaveText('提示词已更新');
  await expect(page.locator('#reader-prompt')).toHaveValue('新版二');
  expect(fileText()).toBe('新版二');
  await hook('readerSetFakeLlm', null);
});

test('R2c 取消 / 保持原版 / Esc：提示词与文件不变，Esc 不退出设置页；弹框里请求中止', async () => {
  await hook('readerSetFakeLlm', { raw: '不会被用的新版' });
  // 第一次：取消
  await openAi('随便改');
  await page.click('#prompt-ai-keep');
  await expect(ov()).toBeHidden();
  // 生成成功后保持原版
  await openAi('改一下');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-use')).toBeVisible();
  await page.click('#prompt-ai-keep');
  await expect(ov()).toBeHidden();
  // Esc
  await openAi('改一下');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-use')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ov()).toBeHidden();
  await expect(page.locator('#settings-view')).toBeVisible();
  await expect(page.locator('#reader-prompt')).toHaveValue('新版二');
  expect(fileText()).toBe('新版二');
  // 每次打开需求框都是空的
  await openAi();
  await expect(page.locator('#prompt-ai-input')).toHaveValue('');
  await closeAi();
});

test('R2d 生成中关闭（取消 / Esc）中止请求，结果丢弃', async () => {
  await hook('readerSetFakeLlm', { raw: '迟到的新版', delayMs: 1500 });
  const a0 = (await hook('readerRewriteStats')).aborts;
  await openAi('慢一点的请求');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-go')).toHaveText('生成中…');
  await expect(page.locator('#prompt-ai-keep')).toHaveText('取消');
  await page.click('#prompt-ai-keep');
  await expect(ov()).toBeHidden();
  await expect.poll(async () => (await hook('readerRewriteStats')).aborts, { timeout: 5000 }).toBe(a0 + 1);
  await expect.poll(async () => (await hook('readerRewriteStats')).inFlight).toBe(0);
  // Esc 同样中止
  await openAi('第二个慢请求');
  await page.click('#prompt-ai-go');
  await page.keyboard.press('Escape');
  await expect(ov()).toBeHidden();
  await expect.poll(async () => (await hook('readerRewriteStats')).aborts, { timeout: 5000 }).toBe(a0 + 2);
  await page.waitForTimeout(1800);
  await expect(page.locator('#reader-prompt')).toHaveValue('新版二');
  expect(fileText()).toBe('新版二');
  // 再打开不带上次结果
  await openAi();
  await expect(page.locator('#prompt-ai-result')).toBeHidden();
  await closeAi();
});

test('R2e 失败：第一次就失败（取消 + 生成新版）；再试一版失败（保留上一版，三个按钮仍可用）；各类错误文案', async () => {
  await hook('readerSetFakeLlm', { status: 401 });
  await openAi('会失败');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-err')).toHaveText('生成失败：API Key 无效');
  await expect(page.locator('#prompt-ai-result')).toBeHidden();
  await expect(page.locator('#prompt-ai-keep')).toHaveText('取消');
  await expect(page.locator('#prompt-ai-go')).toBeEnabled();
  await expect(page.locator('#prompt-ai-input')).toHaveJSProperty('readOnly', false);
  await shots('64-prompt-ai-error');
  await hook('readerSetFakeLlm', { status: 404 });
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-err')).toHaveText('生成失败：接口地址或模型不对');
  await hook('readerSetFakeLlm', { status: 500 });
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-err')).toHaveText('生成失败：HTTP 500');
  // 成功一次，再试一版失败
  await hook('readerSetFakeLlm', { raw: '这一版留着' });
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-result-text')).toHaveText('这一版留着');
  await expect(page.locator('#prompt-ai-err')).toBeHidden();
  await hook('readerSetFakeLlm', { status: 403 });
  await page.click('#prompt-ai-retry');
  await expect(page.locator('#prompt-ai-err')).toHaveText('生成失败：API Key 无效');
  await expect(page.locator('#prompt-ai-result-text')).toHaveText('这一版留着');
  await expect(page.locator('#prompt-ai-retry')).toBeEnabled();
  await expect(page.locator('#prompt-ai-use')).toBeEnabled();
  // 用结果区里这一版
  await page.click('#prompt-ai-use');
  await expect(ov()).toBeHidden();
  expect(fileText()).toBe('这一版留着');
  // 空返回
  await hook('readerSetFakeLlm', { raw: '```\n```' });
  await openAi('空');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-err')).toHaveText('生成失败：大模型没有返回内容');
  await closeAi();
  await hook('readerSetFakeLlm', null);
});

test('R2f 新版超过 4000 字报错；代码块被剥掉', async () => {
  await hook('readerSetFakeLlm', { raw: '长'.repeat(4001) });
  await openAi('写长一点');
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-err')).toHaveText('生成失败：新版超过 4000 字，再试一版');
  await expect(page.locator('#prompt-ai-result')).toBeHidden();
  await hook('readerSetFakeLlm', { raw: '```markdown\n## 标题\n内容\n```' });
  await page.click('#prompt-ai-go');
  await expect(page.locator('#prompt-ai-result-text')).toHaveText('## 标题\n内容');
  await closeAi();
  await hook('readerSetFakeLlm', null);
});

test('R2g 弹框开着时窗口被隐藏：弹框关闭、请求中止、不保存；再打开不带弹框', async () => {
  const before = fileText();
  await hook('readerSetFakeLlm', { raw: '隐藏时的新版', delayMs: 1200 });
  await openAi('隐藏窗口');
  await page.click('#prompt-ai-go');
  await hook('hideWindow');
  await hook('showWindow');
  await expect(ov()).toBeHidden();
  await page.waitForTimeout(1500);
  expect(fileText()).toBe(before);
  await openReaderSettings();
  await expect(ov()).toBeHidden();
  await hook('readerSetFakeLlm', null);
});

test('R2h ⌘↩ 触发生成；需求为空时无效', async () => {
  await hook('readerSetFakeLlm', { raw: '快捷键新版' });
  await openAi();
  await page.press('#prompt-ai-input', 'Control+Enter');
  await expect(page.locator('#prompt-ai-result')).toBeHidden();
  await page.fill('#prompt-ai-input', '改');
  await page.press('#prompt-ai-input', 'Control+Enter');
  await expect(page.locator('#prompt-ai-result-text')).toHaveText('快捷键新版');
  await closeAi();
  await hook('readerSetFakeLlm', null);
});
