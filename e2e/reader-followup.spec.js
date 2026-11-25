'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { blockedReason } = require('../electron/reader-core');

const KEY = 'sk-synthetic-reader-followup-724';
const PROVIDER = 'https://followup-fixture.invalid/v1';
const MODEL = 'synthetic-followup-model';
const A = { title: '追问合成文章甲', article: 'SyntheticArticleAlpha724', summary: 'SyntheticSummaryAlpha724' };
const B = { title: '追问合成文章乙', article: 'SyntheticArticleBeta724', summary: 'SyntheticSummaryBeta724' };
const Q1 = 'SyntheticQuestionOne724';
const R1 = 'SyntheticAnswerOne724';
const Q2 = 'SyntheticQuestionTwo724';
const R2 = 'SyntheticAnswerTwo724';
const QB = 'SyntheticQuestionBeta724';
const STOP = 'SyntheticStopQuestion724';
const STOP_ANSWER = 'SyntheticStoppedAnswer724';
const lines = record => Array.from({ length: 8 }, (_, i) =>
  `第 ${i + 1} 段：${record.article}。栏历帮阅在本机打开网页，用开源的正文提取算法去掉导航、广告和评论，只把干净的正文交给大模型整理成要点。`);
const summary = marker => `## 一句话总结\n${marker}\n\n## 核心要点\n1. 这是合成整理结果。\n2. 此处没有真实用户资料。`;

test('帮阅追问从原摘要进入：上下文隔离、失败重试/停止、重启记忆及用量隐私', async ({}, info) => {
  test.setTimeout(115000);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'lanli-reader-followup-'));
  const readerDir = path.join(work, 'reader');
  const records = { '/alpha': A, '/beta': B };
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    const record = records[pathname];
    if (!record) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${record.title}</title><meta property="og:site_name" content="合成站"></head><body><article><h1>${record.title}</h1>${lines(record).map(line => `<p>${line}</p>`).join('')}</article></body></html>`);
  });
  let app;
  let page;
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [slug, record] of Object.entries(records)) {
      expect(blockedReason(base + slug, lines(record).join('\n'))).toBeNull();
    }
    async function hook(name, arg) {
      for (let i = 0; ; i++) {
        try { return await app.evaluate((_electron, data) => globalThis.__lanliTest[data.name](data.arg), { name, arg }); }
        catch (error) {
          if (i >= 2 || !/Resulting promise was garbage collected/.test(String(error))) throw error;
        }
      }
    }
    async function launch() {
      app = await electron.launch({
        args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
        env: { ...process.env, LANLI_E2E: '1', LANLI_E2E_USER_DATA_DIR: path.join(work, 'profile'),
          LANLI_READER_DIR: readerDir, LANLI_INBOX_DIR: path.join(work, 'inbox') }
      });
      // The tray atlas temporarily creates another hidden BrowserWindow.
      const getCalendar = () => app.windows().find(p => !p.isClosed() && /\/electron\/renderer\/calendar\.html(?:$|[?#])/.test(p.url()));
      await expect.poll(() => Boolean(getCalendar()), { timeout: 15000 }).toBe(true);
      page = getCalendar();
      await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
      await hook('showWindow');
      await expect(page.locator('#settings-button')).toBeVisible();
    }
    const elem = id => page.locator('#' + id);
    const row = article => page.locator('.reader-row').filter({ hasText: article.title });
    const questions = () => elem('reader-qa-history').locator('.reader-qa-question');
    const answers = () => elem('reader-qa-history').locator('.reader-qa-answer');
    const calls = async () => (await hook('readerLlmCalls')).filter(c => !c.ping);
    const mock = body => hook('readerSetFakeLlm', body);
    const before = async () => (await calls()).length;
    const content = c => c.messages.map(m => m.content).join('\n');
    const back = async () => elem('reader-back').click();
    async function settings() {
      await elem('settings-button').click();
      await page.locator('.settings-tab[data-tab="llm"]').click();
      await expect(elem('reader-base')).toHaveValue(/^https:\/\//);
    }
    async function article(pathname, record) {
      await mock({ raw: summary(record.summary) });
      await elem('reader-input').fill(base + pathname);
      await elem('reader-go').click();
      // Check the actual row so extraction failure and no-submit are distinct.
      let id;
      await expect.poll(async () => {
        id = (await hook('readerList')).find(item => item.url === base + pathname)?.id;
        return Boolean(id);
      }, { message: '真实提交应建立文章记录', timeout: 5000 }).toBe(true);
      const item = page.locator(`.reader-row[data-id="${id}"]`);
      await expect(item.locator('.reader-status')).toHaveText('已整理', { timeout: 20000 });
      await expect(item).toContainText(record.title);
    }
    async function openQa(record) {
      await row(record).click();
      await expect(elem('reader-d-md')).toContainText(record.summary);
      await elem('reader-d-qa').click();
      await expect(elem('reader-qa-view')).toBeVisible();
      await expect(elem('reader-detail')).toBeHidden();
    }
    async function ask(text) {
      await elem('reader-qa-input').fill(text);
      await elem('reader-qa-send').click();
    }
    const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };
    await launch();
    await mock({ raw: summary(A.summary) });
    await settings();
    await elem('reader-base').fill(PROVIDER);
    await elem('reader-model').fill(MODEL);
    await elem('reader-key').fill(KEY);
    await elem('reader-key-save').click();
    await expect(elem('reader-key-status')).toHaveText(`已配置 · ${MODEL}`);
    await elem('settings-back').click();
    await elem('reader-button').click();
    await expect(elem('reader-input')).toBeEnabled();
    await article('/alpha', A);
    await article('/beta', B);

    const initial = await before();
    expect(initial).toBe(2);
    await openQa(A);
    await expect(questions()).toHaveCount(0);
    expect(await before()).toBe(initial);

    await mock({ raw: R1, usage });
    await ask(Q1);
    await expect(answers()).toHaveText([R1]);
    const first = (await calls())[initial];
    expect(content(first)).toContain(A.article);
    expect(content(first)).toContain(Q1);
    expect(content(first)).not.toContain(B.article);

    await mock({ status: 500 });
    await ask(Q2);
    await expect(elem('reader-qa-error')).toBeVisible();
    await expect(elem('reader-qa-input')).toHaveValue(Q2);
    await expect(answers()).toHaveText([R1]);
    await mock({ raw: R2, usage });
    await elem('reader-qa-send').click();
    await expect(answers()).toHaveText([R1, R2]);
    const retried = (await calls()).at(-1);
    expect(content(retried)).toContain(A.article);
    expect(retried.messages).toEqual(expect.arrayContaining([
      { role: 'user', content: Q1 },
      { role: 'assistant', content: R1 }
    ]));
    expect(content(retried)).toContain(Q2);

    const beforeStop = await before();
    await mock({ raw: STOP_ANSWER, delayMs: 3000, usage });
    await ask(STOP);
    await expect(elem('reader-qa-stop')).toBeVisible();
    await expect.poll(before).toBe(beforeStop + 1);
    await elem('reader-qa-stop').click();
    await expect(elem('reader-qa-stop')).toBeHidden();
    await expect(answers()).toHaveText([R1, R2]);
    await back();
    await expect(elem('reader-d-md')).toContainText(A.summary);
    await elem('reader-d-qa').click();
    await expect(questions()).toHaveText([Q1, Q2]);
    await expect(answers()).toHaveText([R1, R2]);
    expect(await before()).toBe(beforeStop + 1);
    await back();
    await back();

    await openQa(B);
    await expect(questions()).toHaveCount(0);
    await mock({ raw: 'SyntheticBetaAnswer724', usage });
    await ask(QB);
    await expect(answers()).toHaveText(['SyntheticBetaAnswer724']);
    const other = (await calls()).at(-1);
    expect(content(other)).toContain(B.article);
    for (const forbidden of [A.article, A.summary, Q1, R1, Q2, R2, STOP]) expect(content(other)).not.toContain(forbidden);

    const ledger = path.join(readerDir, 'llm-usage.jsonl');
    const readLedger = async () => (await fs.readFile(ledger, 'utf8')).trim().split('\n').map(JSON.parse);
    await expect.poll(async () => (await readLedger()).filter(row => row.kind === 'followup').length).toBe(5);
    const ledgerText = await fs.readFile(ledger, 'utf8');
    for (const forbidden of [KEY, PROVIDER, A.article, A.summary, B.article, B.summary, Q1, R1, Q2, R2, STOP, STOP_ANSWER, QB]) {
      expect(ledgerText).not.toContain(forbidden);
    }
    const usageRows = (await readLedger()).filter(row => row.kind === 'followup');
    expect(usageRows.filter(row => row.status === 'success')).toHaveLength(3);
    expect(usageRows.filter(row => row.status === 'failed')).toHaveLength(1);
    expect(usageRows.filter(row => row.status === 'canceled')).toHaveLength(1);
    expect(usageRows.filter(row => row.status === 'success').map(row => row.usage?.total)).toEqual([20, 20, 20]);

    await app.close();
    app = null;
    await launch();
    await elem('reader-button').click();
    await openQa(A);
    await expect(questions()).toHaveText([Q1, Q2]);
    await expect(answers()).toHaveText([R1, R2]);
    expect(await before()).toBe(0);
    const screenshot = info.outputPath('reader-followup-synthetic.png');
    await page.screenshot({ path: screenshot });
    await info.attach('帮阅追问（合成双轮）', { path: screenshot, contentType: 'image/png' });

    // Missing credentials must not erase prior answers or issue a request.
    await back(); // Same original detail.
    await back(); // Reader list.
    await back(); // Calendar.
    await settings();
    await elem('reader-key-del').click();
    await expect(elem('reader-key-status')).toHaveText('未配置');
    await elem('settings-back').click();
    await elem('reader-button').click();
    await openQa(A);
    await expect(answers()).toHaveText([R1, R2]);
    await expect(elem('reader-qa-settings')).toBeVisible();
    await expect(elem('reader-qa-input')).toBeDisabled();
    await expect(elem('reader-qa-send')).toBeDisabled();
    expect(await before()).toBe(0);
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});
