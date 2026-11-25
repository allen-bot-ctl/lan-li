'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { blockedReason } = require('../electron/reader-core');

const KEY = 'sk-synthetic-deepseek-search-only';
const HOST = 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-flash';
const PRIVATE = 'https://api.deepseek.com.fixture.invalid/v1';
const TITLE = '联网开关合成文章';
const ANSWER = 'SyntheticSearchAnswer844';
const SOURCE = 'https://example.com/synthetic-source';
const lines = Array.from({ length: 8 }, (_, i) =>
  `第 ${i + 1} 段：这是一篇合成文章，栏历在本机打开网页，用开源的正文提取算法去掉导航、广告和评论，只把干净的正文交给大模型整理成要点。本文内容为独立合成文本，不使用真实用户资料。`);
const summary = '## 一句话总结\nSyntheticSearchSummary844\n\n## 核心要点\n1. 合成文本整理结果。\n2. 此处没有真实资料。';
const cite = (url, title) => ({ type: 'url_citation', url_citation: { url, title, start_index: 0, end_index: 2 } });
const tool = status => [{ index: 0, calls: [{ index: 0, id: 'srv_synthetic', type: 'deepseek_web_search',
  kind: 'search', action: { type: 'search', queries: ['SyntheticSearchQuery844'] }, status }] }];

test('追问联网只给官方 DeepSeek Flash：关闭与不支持不带工具、结果如实标记、安全来源和重启', async ({}, info) => {
  test.setTimeout(125000);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'lanli-e2e-ds-search-'));
  const readerDir = path.join(work, 'reader');
  const server = http.createServer((req, res) => {
    if (req.url !== '/article') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${TITLE}</title><meta property="og:site_name" content="合成站"></head><body><article><h1>${TITLE}</h1>${lines.map(line => `<p>${line}</p>`).join('')}</article></body></html>`);
  });
  let app;
  let page;
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const article = `http://127.0.0.1:${server.address().port}/article`;
    expect(blockedReason(article, lines.join('\n'))).toBeNull();
    async function hook(name, arg) {
      for (let i = 0; ; i++) {
        try { return await app.evaluate((_electron, data) => globalThis.__lanliTest[data.name](data.arg), { name, arg }); }
        catch (error) {
          if (i >= 2 || !/Resulting promise was garbage collected/.test(String(error))) throw error;
        }
      }
    }
    const node = id => page.locator('#' + id);
    const toggle = () => node('llm-web-search');
    const qaToggle = () => node('reader-qa-web-search');
    const badge = () => page.locator('.reader-qa-search-status');
    const turns = () => page.locator('.reader-qa-turn');
    const calls = () => hook('readerLlmCalls');
    const fixture = payload => hook('readerSetFakeLlm', payload);
    async function launch() {
      app = await electron.launch({
        args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
        env: { ...process.env, LANLI_E2E: '1', LANLI_E2E_USER_DATA_DIR: path.join(work, 'profile'),
          LANLI_READER_DIR: readerDir, LANLI_INBOX_DIR: path.join(work, 'inbox') }
      });
      const calendar = () => app.windows().find(p => !p.isClosed() && /\/electron\/renderer\/calendar\.html(?:$|[?#])/.test(p.url()));
      await expect.poll(() => Boolean(calendar()), { timeout: 15000 }).toBe(true);
      page = calendar();
      await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
      await hook('showWindow');
      await expect(node('settings-button')).toBeVisible();
    }
    async function settings() {
      await node('settings-button').click();
      await page.locator('.settings-tab[data-tab="llm"]').click();
      await expect(node('reader-base')).toHaveValue(/^https:\/\//);
    }
    async function configure(base, model, withKey = false) {
      await node('reader-base').fill(base);
      await node('reader-model').fill(model);
      if (withKey) await node('reader-key').fill(KEY);
      await node('reader-key-save').click();
      await expect(node('reader-key-status')).toHaveText(`已配置 · ${model}`);
      await expect(node('reader-base')).toHaveValue(base);
    }
    async function enableSearch() {
      await expect(toggle()).toBeEnabled();
      if (!await toggle().isChecked()) await node('llm-web-search-row').locator('.switch-track').click();
      await expect(toggle()).toBeChecked();
      await node('reader-key-save').click();
      await expect.poll(() => page.evaluate(async () => (await window.lanli.getReaderConfig()).webSearchEnabled)).toBe(true);
    }
    async function goReader(fromSettings = true) {
      if (fromSettings) await node('settings-back').click();
      await node('reader-button').click();
      await expect(node('reader-input')).toBeEnabled();
    }
    async function enterQa() {
      await page.locator('.reader-row').filter({ hasText: TITLE }).click();
      await expect(node('reader-d-md')).toContainText('SyntheticSearchSummary844');
      await node('reader-d-qa').click();
      await expect(node('reader-qa-view')).toBeVisible();
      await expect(node('reader-qa-input')).toBeEnabled();
    }
    async function exitQa() {
      await node('reader-back').click();
      await node('reader-back').click();
      await node('reader-back').click();
      await expect(node('settings-button')).toBeVisible();
    }
    async function ask(question, payload) {
      await fixture({ raw: ANSWER, ...payload });
      const n = await turns().count();
      await node('reader-qa-input').fill(question);
      await node('reader-qa-send').click();
      await expect(turns()).toHaveCount(n + 1);
      await expect(turns().last().locator('.reader-qa-answer')).toHaveText(ANSWER);
      return (await calls()).at(-1);
    }
    const withoutTool = call => { expect(call.tools).toBeUndefined(); };
    const withTool = call => { expect(call.tools).toEqual([{ type: 'deepseek_web_search' }]); };

    await launch();
    await fixture({ raw: summary }); // Installed before any model configuration, no paid transport.
    await settings();
    await configure(HOST, MODEL, true);
    await expect(toggle()).not.toBeChecked();
    expect(await calls()).toHaveLength(0);
    await goReader();
    await node('reader-input').fill(article);
    await node('reader-go').click();
    await expect(page.locator('.reader-row').filter({ hasText: TITLE }).locator('.reader-status')).toHaveText('已整理', { timeout: 20000 });
    withoutTool((await calls()).at(-1));
    await enterQa();
    expect(await calls()).toHaveLength(1);
    withoutTool(await ask('WithoutSearch844', { serverToolCalls: tool('completed'), annotations: [cite(SOURCE, '合成来源')] }));
    await expect(badge()).toHaveCount(0);
    await expect(page.locator('.reader-qa-sources a')).toHaveCount(0);
    await exitQa();

    await settings();
    await enableSearch();
    expect(await calls()).toHaveLength(2);
    await goReader();
    await enterQa();
    await expect(qaToggle()).toBeChecked();
    await qaToggle().uncheck();
    withoutTool(await ask('OptOutSearch844', {}));
    await expect(badge()).toHaveCount(0);

    await qaToggle().check();
    const used = await ask('SuccessfulSearch844', { serverToolCalls: tool('completed'), annotations: [
      cite(SOURCE, '合成来源'), cite('javascript:alert(1)', '不安全协议'), cite('https://test:pass@example.com/', '地址凭证')
    ] });
    withTool(used);
    expect(used.url).toBe(HOST + '/chat/completions');
    expect(used.model).toBe(MODEL);
    await expect(badge()).toHaveText(['已联网搜索']);
    const sources = () => page.locator('.reader-qa-sources a');
    await expect(sources()).toHaveCount(1);
    await expect(sources().first()).toHaveAttribute('href', SOURCE);
    await expect(sources().first()).toContainText('合成来源');

    await qaToggle().check();
    withTool(await ask('NoToolCall844', { serverToolCalls: [], annotations: [cite(SOURCE, '孤立来源')] }));
    await expect(badge()).toHaveText(['已联网搜索', '未使用联网搜索']);
    await expect(sources()).toHaveCount(1);

    await qaToggle().check();
    withTool(await ask('FailedToolCall844', { serverToolCalls: tool('failed'), annotations: [] }));
    await expect(badge()).toHaveText(['已联网搜索', '未使用联网搜索', '联网搜索失败']);
    await expect(sources()).toHaveCount(1);

    await qaToggle().check();
    withTool(await ask('UnreportedToolCall844', { annotations: [cite(SOURCE, '未报告来源')] }));
    await expect(badge()).toHaveText(['已联网搜索', '未使用联网搜索', '联网搜索失败', '联网状态未确认']);
    await expect(sources()).toHaveCount(1);
    await exitQa();

    await settings();
    await configure(PRIVATE, MODEL);
    await expect(toggle()).toBeDisabled();
    await goReader();
    await enterQa();
    withoutTool(await ask('NonDeepSeekHost844', {}));
    await expect(badge()).toHaveCount(4);
    await exitQa();

    await settings();
    await configure(HOST, 'deepseek-chat');
    await expect(toggle()).toBeDisabled();
    await goReader();
    await enterQa();
    withoutTool(await ask('UnsupportedDeepSeekModel844', {}));
    await expect(badge()).toHaveCount(4);
    await exitQa();

    await settings();
    await configure(HOST, MODEL);
    await enableSearch();
    await app.close();
    app = null;
    await launch();
    // New process: attach the fake before touching the UI. Reloading settings
    // and saved results must not contact a paid provider.
    await fixture({ raw: ANSWER });
    await settings();
    await expect(toggle()).toBeChecked();
    await goReader();
    await enterQa();
    await expect(qaToggle()).toBeChecked();
    await expect(badge()).toHaveText(['已联网搜索', '未使用联网搜索', '联网搜索失败', '联网状态未确认']);
    await expect(sources()).toHaveCount(1);
    expect(await calls()).toHaveLength(0);
    const shot = info.outputPath('deepseek-search-synthetic.png');
    await page.screenshot({ path: shot });
    await info.attach('联网搜索（合成结果）', { path: shot, contentType: 'image/png' });
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});
