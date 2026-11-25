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
const TITLE = '联网开关合成文章';
const PART = 'SyntheticVisiblePrefix855';
const END = 'SyntheticVisibleFinish855';
const REASON = 'SyntheticPrivateReasoning855';
const SOURCE = 'https://example.com/synthetic-source';
const lines = Array.from({ length: 8 }, (_, i) =>
  `第 ${i + 1} 段：这是一篇合成文章，栏历在本机打开网页，用开源的正文提取算法去掉导航、广告和评论，只把干净的正文交给大模型整理成要点。本文内容为独立合成文本，不使用真实用户资料。`);
const summary = '## 一句话总结\nSyntheticSearchSummary844\n\n## 核心要点\n1. 合成文本整理结果。\n2. 此处没有真实资料。';
const cite = (url, title) => ({ type: 'url_citation', url_citation: { url, title, start_index: 0, end_index: 2 } });
const tool = status => [{ index: 0, calls: [{ index: 0, id: 'srv_synthetic', type: 'deepseek_web_search',
  kind: 'search', action: { type: 'search', queries: ['SyntheticSearchQuery844'] }, status }] }];

test('追问真流式：完成前可见、终帧搜索及用量、断流重试、停止不串篇、重启恢复', async ({}, info) => {
  test.setTimeout(125000);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'lanli-e2e-stream-'));
  const readerDir = path.join(work, 'reader');
  const server = http.createServer((req, res) => {
    if (req.url !== '/article' && req.url !== '/other') { res.writeHead(404).end(); return; }
    const title = req.url === '/other' ? TITLE + '另篇' : TITLE;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title><meta property="og:site_name" content="合成站"></head><body><article><h1>${title}</h1>${lines.map(line => `<p>${line}</p>`).join('')}</article></body></html>`);
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
    const badge = () => page.locator('.reader-qa-search-status');
    const turns = () => page.locator('.reader-qa-turn:not(#reader-qa-stream-turn)');
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
    async function enterQa(title = TITLE) {
      await page.locator('.reader-row').filter({ has: page.getByText(title, { exact: true }) }).click();
      await expect(node('reader-d-md')).toContainText('SyntheticSearchSummary844');
      await node('reader-d-qa').click();
      await expect(node('reader-qa-view')).toBeVisible();
      await expect(node('reader-qa-input')).toBeEnabled();
    }

    const pendingAnswer = () => node('reader-qa-stream-answer');
    const pendingTurn = () => node('reader-qa-stream-turn');
    const sources = () => page.locator('.reader-qa-sources a');
    const currentLedger = async () => {
      const text = await fs.readFile(path.join(readerDir, 'llm-usage.jsonl'), 'utf8');
      return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.kind === 'followup');
    };
    async function begin(question, payload) {
      await fixture(payload);
      await node('reader-qa-input').fill(question);
      await node('reader-qa-send').click();
    }
    const usage = { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 };
    const start = 'SyntheticStreamQuestion855';

    await launch();
    await fixture({ raw: summary });
    await settings();
    await configure(HOST, MODEL, true);
    await enableSearch();
    await goReader();
    for (const [url, title] of [[article, TITLE], [article.replace('/article', '/other'), TITLE + '另篇']]) {
      await node('reader-input').fill(url);
      await node('reader-go').click();
      await expect(page.locator('.reader-row').filter({ has: page.getByText(title, { exact: true }) }).locator('.reader-status'))
        .toHaveText('已整理', { timeout: 20000 });
    }
    await enterQa();
    expect(await calls()).toHaveLength(2);
    await begin(start, { raw: `${PART} ${END}`, deltas: [PART, ' ' + END],
      deltaDelayMs: 1400, reasoning: REASON, usage, serverToolCalls: tool('completed'),
      annotations: [cite(SOURCE, '合成来源'), cite('javascript:alert(1)', '不安全来源')] });
    await expect(pendingAnswer()).toHaveText(PART, { timeout: 8000 });
    await expect(node('reader-qa-stop')).toBeVisible();
    await expect(turns()).toHaveCount(0);
    await expect(badge()).toHaveCount(0);
    await expect(sources()).toHaveCount(0);
    await expect(node('reader-qa-view')).not.toContainText(REASON);
    const request = (await calls()).at(-1);
    expect(request.stream).toBe(true);
    expect(request.streamOptions).toEqual({ include_usage: true });
    expect(request.tools).toEqual([{ type: 'deepseek_web_search' }]);
    await expect(turns().locator('.reader-qa-answer')).toHaveText(`${PART} ${END}`, { timeout: 12000 });
    await expect(pendingTurn()).toBeHidden();
    await expect(badge()).toHaveText(['已联网搜索']);
    await expect(sources()).toHaveCount(1);
    await expect(sources().first()).toHaveAttribute('href', SOURCE);
    const original = await currentLedger();
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ status: 'success', usage: { input: 20, output: 15, total: 35 } });

    const truncated = 'SyntheticTruncated855';
    const retryQuestion = 'SyntheticRetryQ855';
    await begin(retryQuestion, { raw: truncated, deltas: [truncated], deltaDelayMs: 900, dropDone: true });
    await expect(node('reader-qa-error')).toBeVisible({ timeout: 12000 });
    await expect(node('reader-qa-input')).toHaveValue(retryQuestion);
    await expect(pendingTurn()).toBeHidden();
    await expect(turns()).toHaveCount(1);
    await expect(node('reader-qa-view')).not.toContainText(truncated);
    await fixture({ raw: 'SyntheticRecovered855', deltas: ['SyntheticRecovered855'], deltaDelayMs: 250 });
    await node('reader-qa-send').click();
    await expect(turns().locator('.reader-qa-answer')).toHaveText([`${PART} ${END}`, 'SyntheticRecovered855']);

    const stopQ = 'SyntheticStopQ855';
    const stopPart = 'SyntheticStoppedPrefix855';
    const stale = 'SyntheticNeverCommit855';
    await begin(stopQ, { raw: `${stopPart}${stale}`, deltas: [stopPart, stale], deltaDelayMs: 1400 });
    await expect(pendingAnswer()).toHaveText(stopPart, { timeout: 8000 });
    await node('reader-qa-stop').click();
    await expect(node('reader-qa-input')).toHaveValue(stopQ);
    await expect(pendingTurn()).toBeHidden();
    await expect(turns()).toHaveCount(2);
    await node('reader-back').click();
    await node('reader-back').click();
    await enterQa(TITLE + '另篇');
    await expect(turns()).toHaveCount(0);
    await expect(pendingTurn()).toBeHidden();
    await expect.poll(async () => (await currentLedger()).map(row => row.status), { timeout: 10000 })
      .toEqual(['success', 'failed', 'success', 'canceled']);
    await expect(node('reader-qa-view')).not.toContainText(stale);
    await expect(node('reader-qa-view')).not.toContainText(stopPart);
    await node('reader-back').click();
    await node('reader-back').click();
    await enterQa();
    await expect(node('reader-qa-input')).toHaveValue(stopQ);
    await expect(turns().locator('.reader-qa-answer')).toHaveText([`${PART} ${END}`, 'SyntheticRecovered855']);

    await app.close();
    app = null;
    await launch();
    await fixture({ raw: 'SyntheticNoCall855' });
    await goReader(false);
    await enterQa();
    await expect(turns().locator('.reader-qa-answer')).toHaveText([`${PART} ${END}`, 'SyntheticRecovered855']);
    await expect(sources()).toHaveCount(1);
    await expect(sources().first()).toHaveAttribute('href', SOURCE);
    await expect(node('reader-qa-view')).not.toContainText(REASON);
    await expect(node('reader-qa-view')).not.toContainText(stale);
    expect(await calls()).toHaveLength(0);
    const shot = info.outputPath('reader-stream-synthetic.png');
    await page.screenshot({ path: shot });
    await info.attach('流式追问（合成数据）', { path: shot, contentType: 'image/png' });
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});
