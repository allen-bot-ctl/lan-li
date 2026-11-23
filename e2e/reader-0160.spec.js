'use strict';
// 0.1.60 帮阅 R3–R6（契约 docs/changes/0.1.60-reader.md）：本地 HTTP 页面 + e2e 假大模型接口，不打真网络。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let app = null;
let page = null;
let server = null;
let base = '';
let imgHits = 0;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-reader-'));
const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const rowOf = (t) => page.locator('.reader-row', { hasText: t });
const PARA = '栏历帮阅在本机打开网页，用开源的正文提取算法去掉导航、广告和评论，只把干净的正文交给大模型整理成要点。';
const articlePage = (title, n = 6) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta property="og:site_name" content="测试站"></head><body>
<nav><a href="/">首页导航</a> <a href="/x">频道导航</a></nav><aside class="sidebar ad">侧栏广告位</aside>
<article><h1>${title}</h1>${Array.from({ length: n }, (_, i) => `<p>第${i + 1}段：${PARA}</p>`).join('')}</article>
<section class="comments" id="comments"><p>评论：沙发</p></section><footer>页脚 版权所有</footer></body></html>`;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url;
    let body;
    if (u.startsWith('/slow')) { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(articlePage('慢慢读的长文章')); }, 1500); return; }
    if (u.startsWith('/dl')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="a.bin"' }); res.end('xx'); return; }
    if (u.startsWith('/img.png')) { imgHits += 1; res.writeHead(200, { 'content-type': 'image/png' }); res.end(''); return; }
    if (u.startsWith('/pdf')) { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.4'); return; }
    if (u.startsWith('/js')) {
      body = `<!doctype html><html><head><meta charset="utf-8"><title>脚本渲染的页面</title></head><body><div id="app"></div><script>setTimeout(function(){document.getElementById('app').innerHTML='<article><h1>脚本渲染的页面</h1>'+${JSON.stringify(Array.from({ length: 6 }, (_, i) => `<p>脚本第${i + 1}段：${PARA}</p>`).join(''))}+'</article>';},300);</script></body></html>`;
    } else if (u.startsWith('/popup')) {
      body = articlePage('会弹窗的页面').replace('</body>', '<img src="/img.png"><script>window.open("/a?t=popup");</script></body>');
    } else if (u.startsWith('/promo')) {
      body = `<!doctype html><html><head><meta charset="utf-8"><title>带推广的文章</title></head><body><article><h1>带推广的文章</h1>${Array.from({ length: 6 }, (_, i) => `<p>推广第${i + 1}段：${PARA}<a href="/r${i}">相关链接${i}</a></p>`).join('')}<p>点击关注我们</p><p>责任编辑：张三</p><p><img src="data:image/png;base64,iVBORw0KGgo="></p></article></body></html>`;
    } else {
      const title = decodeURIComponent((/[?&]t=([^&]+)/.exec(u) || [])[1] || '帮阅测试文章');
      body = articlePage(title);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'user') } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
});
test.afterAll(async () => { if (app) await app.close(); if (server) server.close(); });

async function openReader() {
  await hook('openReaderPanel');
  await page.waitForSelector('#reader-view:not([hidden])');
}
async function submit(url) {
  await page.fill('#reader-input', url);
  await page.press('#reader-input', 'Enter');
}

test('R6a 空状态 + 顶栏图标顺序', async () => {
  await hook('setClipboardText', 'not a url');
  await openReader();
  await expect(page.locator('#reader-empty')).toBeVisible();
  await expect(page.locator('#reader-empty')).toContainText('还没有读过的网页');
  await expect(page.locator('#reader-empty')).toContainText('粘贴一个网址，帮你读完整理成要点');
  const order = await page.locator('.topbar-right > button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.id));
  expect(order.slice(0, 4)).toEqual(['帮阅', '收纳', '检查更新', '钉住窗口']);
  const box = await page.locator('#reader-button svg').boundingBox();
  expect(Math.round(box.width)).toBe(14);
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOTS, `60-reader-empty-${scheme}.png`) });
    await page.locator('.topbar').screenshot({ path: path.join(SHOTS, `60-topbar-icons-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
});

test('R4a 无 Key 提交：不入列，出现「去设置 ›」并能打开设置的帮阅 tab', async () => {
  await submit(`${base}/a?t=${encodeURIComponent('没有Key')}`);
  await expect(page.locator('#reader-msg')).toHaveText('还没配置大模型，去设置 ›');
  expect((await hook('readerList')).length).toBe(0);
  await page.click('#reader-msg .reader-link');
  await page.waitForSelector('#settings-view:not([hidden])');
  await expect(page.locator('#settings-page-reader')).toBeVisible();
  await expect(page.locator('#reader-key-status')).toHaveText('未配置');
  await expect(page.locator('#reader-view')).toBeHidden();
});

test('R6b 设置页：填 Key 保存后状态行「已配置」；网址不合法提示红字', async () => {
  await page.click('.settings-tab[data-tab="ui"]');
  await page.click('.settings-tab[data-tab="reader"]');
  await page.fill('#reader-base', 'https://api.deepseek.com');
  await page.fill('#reader-model', 'deepseek-chat');
  await page.fill('#reader-key', 'sk-e2e-0160');
  await page.click('#reader-key-save');
  await expect(page.locator('#reader-key-status')).toHaveText('已配置 · deepseek-chat');
  expect(await page.locator('.settings-tab').allTextContents()).toEqual(['界面设置', '黄历', '天气', '世界时钟', '标签', '帮阅', '升级']);
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOTS, `60-settings-reader-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await openReader();
  await submit('abc');
  await expect(page.locator('#reader-msg')).toHaveText('请输入以 http:// 或 https:// 开头的网址');
  await expect(page.locator('#reader-msg')).toHaveClass(/is-error/);
});

test('R3 提交 → 读取网页… → 整理中… → 5 条要点；详情；复制全部首行 # 标题', async () => {
  await hook('readerSetFakeLlm', { points: 5, delayMs: 800 });
  await submit(`${base}/slow?t=1`);
  const row = rowOf('127.0.0.1');
  await expect(page.locator('.reader-row .reader-status').first()).toHaveText('读取网页…', { timeout: 5000 });
  await expect(page.locator('.reader-row .reader-status').first()).toHaveText('整理中…', { timeout: 15000 });
  await expect(page.locator('.reader-row .reader-status').first()).toHaveText('5 条要点', { timeout: 10000 });
  await expect(page.locator('.reader-row').first()).toContainText('慢慢读的长文章');
  const log = (await hook('readerStatusLog')).map((x) => x.status).filter(Boolean);
  expect(log.indexOf('reading')).toBeLessThan(log.indexOf('summarizing'));
  expect(log.indexOf('summarizing')).toBeLessThan(log.indexOf('done'));
  await expect(page.locator('#toast-title')).toHaveText('已读完 · 慢慢读的长文章', { timeout: 3000 });
  void row;
  await page.locator('.reader-row').first().click();
  await expect(page.locator('#reader-detail')).toBeVisible();
  await expect(page.locator('#reader-title')).toHaveText('慢慢读的长文章');
  await expect(page.locator('#reader-back')).toHaveText('‹ 帮阅');
  await expect(page.locator('#reader-d-summary')).toHaveText('这是一句话总结。');
  await expect(page.locator('#reader-d-points li')).toHaveCount(5);
  await expect(page.locator('#reader-d-meta')).toContainText('测试站');
  await page.click('#reader-d-copy');
  await expect(page.locator('#toast-title')).toHaveText('已复制');
  const md = await hook('readClipboardText');
  expect(md.split('\n')[0]).toBe('# 慢慢读的长文章');
  const saved = (await hook('readerList'))[0];
  expect(saved.status).toBe('done');
  const dir = path.join(work, 'user', 'read', saved.id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  for (const k of ['id', 'url', 'finalUrl', 'title', 'site', 'chars', 'extractor', 'createdMs', 'status', 'summary', 'points', 'model']) expect(meta).toHaveProperty(k);
  const rec = { text: fs.readFileSync(path.join(dir, 'text.txt'), 'utf8') };
  expect(rec.text).toContain('第1段');
  expect(rec.text).not.toContain('首页导航');
  expect(rec.text).not.toContain('评论：沙发');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOTS, `60-reader-detail-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await page.click('#reader-back');
  await expect(page.locator('#reader-main')).toBeVisible();
});

test('R4b 同网址再提交：不新增行，直接进详情并出 info 提示', async () => {
  const n = (await hook('readerList')).length;
  await submit(`${base}/slow?t=1#part2`);
  await expect(page.locator('#reader-detail')).toBeVisible();
  await expect(page.locator('#toast-title')).toHaveText('读过了 · 打开上次的结果');
  expect((await hook('readerList')).length).toBe(n);
  await page.click('#reader-back');
});

test('R4c 假接口 401 显示「API Key 无效」；失败行「重试」后成功', async () => {
  await hook('readerSetFakeLlm', { status: 401 });
  await submit(`${base}/a?t=${encodeURIComponent('会失败的文章')}`);
  const row = rowOf('会失败的文章');
  await expect(row.locator('.reader-status')).toHaveText('API Key 无效，去设置 ›', { timeout: 15000 });
  await row.hover();
  expect(await row.locator('.inbox-act').allTextContents()).toEqual(['重试', '×']);
  await hook('readerSetFakeLlm', { points: 4 });
  await row.locator('.reader-act-retry').click();
  await expect(row.locator('.reader-status')).toHaveText('4 条要点', { timeout: 15000 });
  await row.hover();
  expect(await row.locator('.inbox-act').allTextContents()).toEqual(['打开原文', '复制', '×']);
  await row.locator('.reader-act-open').click();
  expect((await hook('readerOpenCalls')).pop()).toContain('/a?t=');
});

test('R2b 隐藏窗口提取：去掉导航和评论；脚本延时写入的正文能等到；清洗；禁弹窗、禁下载、不加载图片；PDF 不支持', async () => {
  await hook('readerSetFakeLlm', { points: 3 });
  const rows = async () => (await hook('readerList'));
  // 普通文章：Defuddle，正文段落在，导航、侧栏、评论、页脚不在
  await submit(`${base}/a?t=${encodeURIComponent('提取样例')}`);
  await expect(rowOf('提取样例').locator('.reader-status')).toHaveText('3 条要点', { timeout: 25000 });
  let m = (await rows()).find((x) => x.title === '提取样例');
  let text = await hook('readerText', m.id);
  expect(text).toContain('第1段：栏历帮阅');
  for (const noise of ['首页导航', '侧栏广告', '评论：沙发', '页脚 版权所有']) expect(text).not.toContain(noise);
  expect(m.extractor).toBe('defuddle');
  expect(m.chars).toBeGreaterThan(300);
  // 脚本延时写入
  await submit(`${base}/js`);
  await expect(rowOf('脚本渲染的页面').locator('.reader-status')).toHaveText('3 条要点', { timeout: 25000 });
  m = (await rows()).find((x) => x.title === '脚本渲染的页面');
  expect(await hook('readerText', m.id)).toContain('脚本第6段');
  // 清洗：链接只留文字、推广行、data-URI
  await submit(`${base}/promo`);
  await expect(rowOf('带推广的文章').locator('.reader-status')).toHaveText('3 条要点', { timeout: 25000 });
  m = (await rows()).find((x) => x.title === '带推广的文章');
  text = await hook('readerText', m.id);
  expect(text).toContain('相关链接0');
  for (const k of ['](', '/r0', '点击关注', '责任编辑', 'data:image']) expect(text).not.toContain(k);
  // 弹窗被拒、图片不加载
  const before = await hook('windowCount');
  await submit(`${base}/popup`);
  await expect(rowOf('会弹窗的页面').locator('.reader-status')).toHaveText('3 条要点', { timeout: 25000 });
  expect(await hook('windowCount')).toBe(before);
  expect(imgHits).toBe(0);
  // 下载被取消、PDF 不支持
  await submit(`${base}/dl`);
  await expect(page.locator('.reader-row').first().locator('.reader-status')).toHaveText('暂不支持这种文件', { timeout: 25000 });
  await submit(`${base}/pdf`);
  await expect(page.locator('.reader-row').first().locator('.reader-status')).toHaveText('暂不支持这种文件', { timeout: 25000 });
});

test('R5 读取进行中收起窗口再打开，状态继续推进；帮阅和收纳互斥', async () => {
  await hook('readerSetFakeLlm', { points: 5, delayMs: 1500 });
  await submit(`${base}/slow?t=2`);
  await expect(page.locator('.reader-row').first().locator('.reader-status')).toHaveText('读取网页…', { timeout: 5000 });
  await hook('hideWindow');
  await expect.poll(() => hook('windowVisible')).toBe(false);
  await page.waitForTimeout(2500);
  await openReader();
  await expect(page.locator('.reader-row').first().locator('.reader-status')).toHaveText('5 条要点', { timeout: 15000 });
  // 互斥
  await page.click('#inbox-button');
  await expect(page.locator('#inbox-view')).toBeVisible();
  await expect(page.locator('#reader-view')).toBeHidden();
  await page.click('#reader-button');
  await expect(page.locator('#reader-view')).toBeVisible();
  await expect(page.locator('#inbox-view')).toBeHidden();
  await expect(page.locator('#reader-button')).toHaveCSS('color', await page.evaluate(() => {
    const el = document.createElement('span'); el.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent'); document.body.appendChild(el);
    const c = getComputedStyle(el).color; el.remove(); return c;
  }));
});

test('R6c 列表截图：完成、整理中、失败三种行', async () => {
  await hook('readerSetFakeLlm', { status: 500 });
  await submit(`${base}/a?t=${encodeURIComponent('接口报错的文章')}`);
  await expect(rowOf('接口报错的文章').locator('.reader-status')).toHaveText('整理失败：HTTP 500', { timeout: 15000 });
  await hook('readerSetFakeLlm', { points: 5, delayMs: 20000 });
  await submit(`${base}/a?t=${encodeURIComponent('正在整理的文章')}`);
  await expect(rowOf('正在整理的文章').locator('.reader-status')).toHaveText('整理中…', { timeout: 15000 });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOTS, `60-reader-list-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  // 删除：toast「已删除」
  const row = rowOf('接口报错的文章');
  await row.hover();
  await row.locator('.reader-act-delete').click();
  await expect(page.locator('#toast-title')).toHaveText('已删除');
  await expect(rowOf('接口报错的文章')).toHaveCount(0);
  // Esc 退出帮阅
  await page.locator('#reader-input').press('Escape');
  await expect(page.locator('#reader-view')).toBeHidden();
});
