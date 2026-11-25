'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const KEY = 'sk-only-synthetic-usage-key';
const BODY = 'SYNTHETIC_PRIVATE_BODY_382';
const ANSWER = 'SYNTHETIC_PRIVATE_ANSWER_382';
const PROVIDER = 'https://llm-usage-fixture.invalid/v1';
const MODELS = ['usage-model-alpha', 'usage-model-beta'];
const makeAnswer = () => `## 摘要\n${ANSWER}\n\n## 要点\n1. 这是合成的文章整理结果。\n2. 此处没有真实用户资料。`;
const chapter = (i) => `第 ${i} 章：${BODY}。这是栏历用量测试使用的独立合成文章，包含足够的正文以验证帮阅按正常入口处理网页。文章数据不是来自外部网站，也不包含真实用户资料。`;

test('大模型消耗：真实帮阅计入已知及未知用量、过滤两模型，重启保留且账簿不含内容', async () => {
  test.setTimeout(100000);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'lanli-e2e-usage-'));
  const readerDir = path.join(work, 'reader');
  const ledger = path.join(readerDir, 'llm-usage.jsonl');
  // Only synthetic article text leaves the app for this loopback server; model
  // traffic is intercepted by the existing opt-in fake provider hook.
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    const title = ({ '/known': '有用量的合成文章', '/unknown': '无用量的合成文章', '/failure': '失败的合成文章' })[pathname];
    if (!title) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title></head><body><article><h1>${title}</h1>${Array.from({ length: 8 }, (_, i) => `<p>${chapter(i + 1)}</p>`).join('')}</article></body></html>`);
  });
  let app;
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const hook = (name, arg) => app.evaluate((_electron, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
    async function launch() {
      app = await electron.launch({
        args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
        env: { ...process.env, LANLI_E2E: '1', LANLI_E2E_USER_DATA_DIR: path.join(work, 'profile'),
          LANLI_READER_DIR: readerDir, LANLI_INBOX_DIR: path.join(work, 'inbox') }
      });
      const calendar = () => app.windows().find(p => !p.isClosed() && /\/electron\/renderer\/calendar\.html(?:$|[?#])/.test(p.url()));
      await expect.poll(() => Boolean(calendar()), { timeout: 15000 }).toBe(true);
      const page = calendar();
      await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
      // There is no OS tray hover in Playwright; this existing test hook only
      // shows the native calendar. All navigation thereafter clicks real UI.
      for (let i = 0; ; i += 1) {
        try { await hook('showWindow'); break; } catch (error) {
          if (i >= 2 || !/Resulting promise was garbage collected/.test(String(error))) throw error;
        }
      }
      await expect(page.locator('#settings-button')).toBeVisible();
      return page;
    }
    const settings = async (page) => {
      await page.locator('#settings-button').click();
      await page.locator('.settings-tab[data-tab="llm"]').click();
      await expect(page.locator('#settings-page-llm')).toBeVisible();
      await expect(page.locator('#reader-base')).toHaveValue(/^https:\/\//);
    };
    async function configure(page, model, withKey) {
      await page.locator('#reader-base').fill(PROVIDER);
      await page.locator('#reader-model').fill(model);
      if (withKey) await page.locator('#reader-key').fill(KEY);
      await page.locator('#reader-key-save').click();
      await expect(page.locator('#reader-key-status')).toHaveText(`已配置 · ${model}`);
    }
    const goReader = async (page) => {
      await page.locator('#settings-back').click();
      await page.locator('#reader-button').click();
      await expect(page.locator('#reader-input')).toBeEnabled();
    };
    async function submit(page, slug, title, status) {
      await page.locator('#reader-input').fill(`${base}/${slug}`);
      await page.locator('#reader-input').press('Enter');
      const row = page.locator('.reader-row').filter({ hasText: title });
      await expect(row.locator('.reader-status')).toHaveText(status, { timeout: 14000 });
    }

    let page = await launch();
    await hook('readerSetFakeLlm', { raw: makeAnswer(), usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
    await settings(page);
    await configure(page, MODELS[0], true);
    await goReader(page);
    await submit(page, 'known', '有用量的合成文章', '已整理');

    await page.locator('#reader-back').click();
    await settings(page);
    await configure(page, MODELS[1], false);
    await hook('readerSetFakeLlm', { raw: makeAnswer() });
    await goReader(page);
    await submit(page, 'unknown', '无用量的合成文章', '已整理');
    await hook('readerSetFakeLlm', { status: 500 });
    await submit(page, 'failure', '失败的合成文章', '整理失败：HTTP 500');

    const calls = (await hook('readerLlmCalls')).filter(c => !c.ping);
    expect(calls.map(c => c.model)).toEqual([MODELS[0], MODELS[1], MODELS[1]]);
    expect(calls[0].user).toContain(BODY);
    expect(calls[0].system.length).toBeGreaterThan(30);
    const promptExcerpt = calls[0].system.slice(0, 30);

    const persisted = await fs.readFile(ledger, 'utf8');
    const entries = persisted.trim().split('\n').map(line => JSON.parse(line));
    expect(entries).toHaveLength(3);
    for (const forbidden of [KEY, BODY, promptExcerpt, ANSWER, PROVIDER, base, '有用量的合成文章', 'Authorization']) {
      expect(persisted).not.toContain(forbidden);
    }
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['at', 'kind', 'status', 'provider', 'model', 'requestedModel', 'modelReported', 'durationMs', 'usage'].sort());
    }
    expect(entries.map(item => item.status)).toEqual(['success', 'success', 'failed']);
    expect(entries.map(item => item.kind)).toEqual(['summarize', 'summarize', 'summarize']);
    expect(entries.every(item => item.provider === 'llm-usage-fixture.invalid')).toBe(true);
    expect(entries.map(item => item.requestedModel)).toEqual([MODELS[0], MODELS[1], MODELS[1]]);
    expect(entries.map(item => item.usage)).toEqual([{ input: 11, output: 7, total: 18 }, null, null]);

    await page.locator('#reader-back').click();
    await settings(page);
    // Usage assertions exercise the production Config → Usage controls.
    await assertUsage(page);
    await app.close();
    app = null;
    page = await launch();
    await settings(page);
    await expect(page.locator('#reader-model')).toHaveValue(MODELS[1]);
    await assertUsage(page);
    expect(await fs.readFile(ledger, 'utf8')).toBe(persisted);
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});


async function assertUsage(page) {
  const toggle = page.getByRole('tab', { name: '消耗' });
  const config = page.getByRole('tab', { name: '配置' });
  const panel = page.locator('#llm-usage-panel');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#llm-usage-count')).toHaveText('3');
  await expect(panel.locator('#llm-usage-total')).toHaveText('18');
  await expect(panel.locator('#llm-usage-input')).toHaveText('11');
  await expect(panel.locator('#llm-usage-output')).toHaveText('7');
  await expect(panel.locator('#llm-usage-counts')).toContainText(/成功 2.*失败 1/);

  const models = panel.locator('#llm-usage-models li button');
  const alpha = models.filter({ hasText: MODELS[0] });
  const beta = models.filter({ hasText: MODELS[1] });
  const tasks = panel.locator('#llm-usage-tasks li');
  await expect(models).toHaveCount(2);
  await expect(tasks).toHaveCount(3);
  await alpha.click();
  await expect(alpha).toHaveAttribute('aria-pressed', 'true');
  await expect(tasks).toHaveCount(1);
  await expect(tasks).toContainText([/总 Token 18/]);

  await beta.click();
  await expect(beta).toHaveAttribute('aria-pressed', 'true');
  await expect(tasks).toHaveCount(2);
  for (const row of await tasks.all()) await expect(row).toContainText('Token 未上报');
  await expect(tasks.filter({ hasText: '失败' })).toHaveCount(1);
  await panel.locator('#llm-usage-all-models').click();
  await expect(tasks).toHaveCount(3);

  await config.click();
  await expect(toggle).toHaveAttribute('aria-selected', 'false');
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel.locator('#llm-usage-count')).toHaveText('3');
  await expect(tasks).toHaveCount(3);
}
