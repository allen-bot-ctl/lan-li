'use strict';
// 0.1.61 帮阅大模型设置独立 R3–R5（契约 docs/changes/0.1.61-reader-llm-settings.md）：本地 HTTP 页面 + e2e 假大模型接口，不打真网络。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let app = null;
let page = null;
let server = null;
let base = '';
let hits = 0;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-reader61-'));
const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const PARA = '栏历帮阅在本机打开网页，用开源的正文提取算法去掉导航、广告和评论，只把干净的正文交给大模型整理成要点。';
const articlePage = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><article><h1>${title}</h1>${Array.from({ length: 6 }, (_, i) => `<p>第${i + 1}段：${PARA}</p>`).join('')}</article></body></html>`;

async function shots(name, locator) {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(120);
    await (locator || page).screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
}
async function openReader() {
  await hook('openReaderPanel');
  await page.waitForSelector('#reader-view:not([hidden])');
}
async function submit(url) {
  await page.fill('#reader-input', url);
  await page.press('#reader-input', 'Enter');
}
// 计算文字和（向上找到的不透明）背景的对比度
const contrastOf = (sel) => page.evaluate((s) => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const el = document.querySelector(s);
  const fg = parse(getComputedStyle(el).color);
  // 背景按层叠合成
  const layers = [];
  for (let n = el; n && n !== document.body; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) layers.push(c); if (c.a >= 1) break; }
  // 一路透明时落到窗口底色（body 的渐变 --body-bg 的中间色；html 的底色被渐变盖住，不算）
  let bg = matchMedia('(prefers-color-scheme: dark)').matches ? { r: 0x23, g: 0x23, b: 0x26 } : { r: 0xf7, g: 0xf3, b: 0xee };
  if (layers.length && layers[layers.length - 1].a >= 1) bg = layers.pop();
  for (const c of layers.reverse()) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) };
  const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
  const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x);
  return { ratio: (a + 0.05) / (b + 0.05), fg: getComputedStyle(el).color, bg };
}, sel);

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    const title = decodeURIComponent((/[?&]t=([^&]+)/.exec(req.url) || [])[1] || '帮阅测试文章');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(articlePage(title));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'user') } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
});
test.afterAll(async () => { if (app) await app.close(); if (server) server.close(); });

test('R3a 没有 Key：输入框禁用、提示卡；不能提交、不读取、不建记录；「去设置」进设置帮阅 tab（0.1.62 改）', async () => {
  await hook('setClipboardText', 'not a url');
  await openReader();
  await expect(page.locator('#reader-nollm')).toBeVisible();
  await expect(page.locator('#reader-input')).toBeDisabled();
  await expect(page.locator('#reader-go')).toBeDisabled();
  await expect(page.locator('#reader-nollm .reader-nollm-title')).toHaveText('还没配置大模型');
  // 主进程仍然兜底：直接提交返回 no-key，不读取、不建记录
  const r = await hook('readerSubmit', `${base}/a?t=${encodeURIComponent('没配置')}`);
  expect(r.code).toBe('no-key');
  await page.waitForTimeout(600);
  expect((await hook('readerList')).length).toBe(0);
  expect(hits).toBe(0);
  expect((await hook('readerLlmCalls')).length).toBe(0);
  await expect(page.locator('.reader-row')).toHaveCount(0);
  await page.click('#reader-nollm-go');
  await page.waitForSelector('#settings-view:not([hidden])');
  await expect(page.locator('#settings-page-reader')).toBeVisible();
  await expect(page.locator('#reader-view')).toBeHidden();
  await expect(page.locator('#reader-key-status')).toHaveText('未配置');
  await expect(page.locator('#settings-page-reader')).not.toContainText(/easylens/i);
  await expect(page.locator('#reader-base')).toHaveValue('https://api.deepseek.com');
  await expect(page.locator('#reader-model')).toHaveValue('deepseek-chat');
  await expect(page.locator('#reader-key')).toHaveAttribute('type', 'password');
  await shots('61-settings-reader-empty');
});

test('R3b 设置页：校验、保存后「已配置 · deepseek-chat」、测试连接 401 / 404 / 200', async () => {
  // 文字不小于 12px；三个输入框同宽
  const sizes = await page.locator('#settings-page-reader').evaluate((root) => [...root.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  const widths = await Promise.all(['#reader-base', '#reader-model', '#reader-key'].map(async (s) => Math.round((await page.locator(s).boundingBox()).width)));
  expect(new Set(widths).size).toBe(1);
  await page.fill('#reader-base', 'http://api.deepseek.com');
  await page.click('#reader-key-save');
  await expect(page.locator('#reader-base-err')).toHaveText('接口地址需要以 https:// 开头');
  await expect(page.locator('#reader-base-err')).toBeVisible();
  await page.fill('#reader-base', 'https://api.deepseek.com/');
  await expect(page.locator('#reader-base-err')).toBeHidden();
  await page.fill('#reader-model', '');
  await page.click('#reader-key-save');
  await expect(page.locator('#reader-model-err')).toBeVisible();
  await expect(page.locator('#reader-key-status')).toHaveText('未配置');
  await page.fill('#reader-model', 'deepseek-chat');
  await page.fill('#reader-key', 'sk-e2e-0161');
  await page.click('#reader-key-save');
  await expect(page.locator('#reader-key-status')).toHaveText('已配置 · deepseek-chat');
  await expect(page.locator('#reader-base')).toHaveValue('https://api.deepseek.com');
  await expect(page.locator('#reader-key')).toHaveValue('');
  await expect(page.locator('#reader-key')).toHaveAttribute('placeholder', '已保存，留空不修改');

  await hook('readerSetFakeLlm', { status: 401, delayMs: 400 });
  await page.click('#reader-test');
  await expect(page.locator('#reader-test')).toHaveText('测试中…');
  await expect(page.locator('#reader-test')).toBeDisabled();
  await expect(page.locator('#reader-key-status')).toHaveText('测试失败：API Key 无效');
  await expect(page.locator('#reader-test')).toHaveText('测试连接');
  await hook('readerSetFakeLlm', { status: 404 });
  await page.click('#reader-test');
  await expect(page.locator('#reader-key-status')).toHaveText('测试失败：接口地址或模型不对');
  await hook('readerSetFakeLlm', { status: 200 });
  await page.click('#reader-test');
  await expect(page.locator('#reader-key-status')).toHaveText('测试通过');
  await expect(page.locator('#reader-key-status')).toHaveClass(/is-ok/);
  const calls = await hook('readerLlmCalls');
  expect(calls.length).toBe(3);
  for (const c of calls) { expect(c.url).toBe('https://api.deepseek.com/chat/completions'); expect(c.model).toBe('deepseek-chat'); expect(c.ping).toBe(true); }
  await shots('61-settings-reader-ok');
});

test('R3c 保存后回到帮阅页：提示消失，能读完一篇；R4 顶栏「N 篇」和行数一致；R5 详情按钮', async () => {
  await hook('readerSetFakeLlm', { points: 5 });
  await openReader();
  await expect(page.locator('#reader-msg')).toBeHidden();
  await expect(page.locator('#reader-count')).toHaveText('');
  await submit(`${base}/a?t=${encodeURIComponent('第一篇文章')}`);
  await expect(page.locator('.reader-row .reader-status').first()).toHaveText('已整理', { timeout: 20000 });
  await expect(page.locator('#reader-count')).toHaveText('1 篇');
  const calls = (await hook('readerLlmCalls')).filter((c) => !c.ping);
  expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions');
  expect(calls[0].model).toBe('deepseek-chat');
  for (const t of ['第二篇文章', '第三篇文章']) {
    await submit(`${base}/a?t=${encodeURIComponent(t)}`);
    await expect(page.locator('.reader-row', { hasText: t }).locator('.reader-status')).toHaveText('已整理', { timeout: 20000 });
  }
  const rows = await page.locator('.reader-row').count();
  expect(rows).toBe(3);
  await expect(page.locator('#reader-count')).toHaveText(`${rows} 篇`);
  await expect(page.locator('#reader-count')).toHaveClass(/inbox-count/);
  await shots('61-reader-list-count');

  await page.locator('.reader-row', { hasText: '第一篇文章' }).click();
  await expect(page.locator('#reader-detail')).toBeVisible();
  await expect(page.locator('#reader-count')).toBeHidden();
  // 「复制全部」和「重新整理」同一种次级按钮样式，深浅色对比度都 ≥ 4.5
  const style = (s) => page.locator(s).evaluate((e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.fontSize].join('|'); });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(120);
    expect(await style('#reader-d-copy')).toBe(await style('#reader-d-resum'));
    const cr = await contrastOf('#reader-d-copy');
    expect(cr.ratio).toBeGreaterThanOrEqual(4.5);
  }
  await shots('61-reader-detail-buttons');
  await page.click('#reader-d-copy');
  await expect(page.locator('#toast-title')).toHaveText('已复制');
});

test('R3d 删除 Key：状态行变「未配置」，帮阅页又出现提示', async () => {
  await page.keyboard.press('Escape');
  await openReader();
  await expect(page.locator('#reader-msg')).toBeHidden();
  await page.evaluate(() => window.openSettingsView('reader'));
  await page.waitForSelector('#settings-page-reader:not([hidden])');
  await page.click('#reader-key-del');
  await expect(page.locator('#reader-key-status')).toHaveText('未配置');
  await openReader();
  await expect(page.locator('#reader-nollm')).toBeVisible();
  await expect(page.locator('#reader-input')).toBeDisabled();
});
