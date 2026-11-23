'use strict';
// 0.1.42 收纳 A 段验收：A-C1–A-C10（真实系统拖拽由老板在 Mac 上验收，这里调用同一套处理函数）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-inbox-'));
const inboxDir = path.join(work, 'inbox');
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function mainEval(fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await app.evaluate(fn, arg);
    } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}
const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const entries = () => hook('inboxList');
async function dropPage() {
  for (let i = 0; i < 40; i += 1) {
    const w = app.windows().find((p) => p.url().endsWith('dropzone.html'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await page.waitForTimeout(100);
  }
  throw new Error('dropzone window not found');
}

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
});

test.afterAll(async () => { if (app) await app.close(); });

test('A-C1 拖到图标弹出接纳框（状态 1），离开 1.2s 收起；接纳框出现时悬停不开日历', async () => {
  const t0 = Date.now();
  const s = await hook('trayDragEnter');
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(s.visible).toBe(true);
  expect(s.state).toBe('idle');
  expect(s.text).toBe('拖到这里，放进收纳');
  expect(s.bounds.width).toBe(240);
  expect(s.bounds.height).toBe(120);
  expect(await hook('trayEnter')).toBe(false);
  await hook('trayDragLeave');
  await page.waitForTimeout(600);
  expect((await hook('dropzoneState')).visible).toBe(true);
  await expect.poll(async () => (await hook('dropzoneState')).visible, { timeout: 3000 }).toBe(false);
});

test('A-C2/A-C3 拖进框内高亮显示类型，松开保存成功（状态 3），1.2s 后收起', async () => {
  await hook('trayDragEnter');
  const dz = await dropPage();
  await dz.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '明天下午三点开会');
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(dz.locator('#dz')).toHaveAttribute('data-state', 'over');
  await expect(dz.locator('#dz-text')).toHaveText('松开即保存 · 文字');
  await dz.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '明天下午三点开会');
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(dz.locator('#dz')).toHaveAttribute('data-state', 'success', { timeout: 1000 });
  await expect(dz.locator('#dz-text')).toHaveText('已收纳 1 项');
  await expect(dz.locator('#dz-sub')).toHaveText('点开查看');
  const list = await entries();
  expect(list[0].type).toBe('text');
  expect(list[0].title).toBe('明天下午三点开会');
  const meta = JSON.parse(fs.readFileSync(path.join(inboxDir, list[0].id, 'meta.json'), 'utf8'));
  for (const k of ['id', 'type', 'title', 'createdAt', 'tags', 'sourcePath', 'sourceUrl', 'size', 'ref', 'missing', 'preview', 'schema']) expect(meta).toHaveProperty(k);
  await expect.poll(async () => (await hook('dropzoneState')).visible, { timeout: 3000 }).toBe(false);
});

test('A-C4 文件存软链接，ref=symlink，sourcePath=原路径；多个文件一次全存', async () => {
  const a = path.join(work, '季度报告.pdf'); fs.writeFileSync(a, 'pdf');
  const b = path.join(work, '会议录音.m4a'); fs.writeFileSync(b, 'audio');
  const r = await hook('trayDropFiles', [a, b]);
  expect(r.ok).toBe(true);
  expect(r.count).toBe(2);
  const list = await entries();
  const fa = list.find((m) => m.title === '季度报告.pdf');
  expect(fa.ref).toBe('symlink');
  expect(fa.sourcePath).toBe(a);
  expect(fs.readlinkSync(path.join(inboxDir, fa.id, '季度报告.pdf.symlink'))).toBe(a);
  expect(list.find((m) => m.title === '会议录音.m4a').type).toBe('file');
});

test('A-C5 图片存副本和缩略图；浏览器拖的 data: 图片也能存', async () => {
  const img = path.join(work, '截图.png'); fs.writeFileSync(img, PNG);
  expect((await hook('trayDropFiles', [img])).ok).toBe(true);
  let m = (await entries())[0];
  expect(m.type).toBe('image');
  expect(fs.readFileSync(path.join(inboxDir, m.id, 'original.png')).equals(PNG)).toBe(true);
  expect(fs.existsSync(path.join(inboxDir, m.id, 'thumb.jpg'))).toBe(true);
  const src = 'data:image/png;base64,' + PNG.toString('base64');
  expect((await hook('inboxDrop', { html: `<img src="${src}">`, uriList: [] })).ok).toBe(true);
  m = (await entries())[0];
  expect(m.type).toBe('image');
  expect(m.sourceUrl).toBe(null);
  expect(fs.existsSync(path.join(inboxDir, m.id, 'original.png'))).toBe(true);
});

test('A-C6 富文本存 content.html，图片进 assets/ 且相对引用，无脚本和事件属性', async () => {
  const src = 'data:image/png;base64,' + PNG.toString('base64');
  const html = `<h3 onclick="x()">读书笔记</h3><p>第一段<b>重点</b></p><img src="${src}"><script>alert(1)</script><a href="https://example.com">原文</a>`;
  expect((await hook('inboxDrop', { html, text: '读书笔记 第一段重点 原文' })).ok).toBe(true);
  const m = (await entries())[0];
  expect(m.type).toBe('text');
  const saved = fs.readFileSync(path.join(inboxDir, m.id, 'content.html'), 'utf8');
  expect(saved).toContain('src="assets/img-1.png"');
  expect(saved).not.toMatch(/script|onclick/i);
  expect(fs.existsSync(path.join(inboxDir, m.id, 'assets', 'img-1.png'))).toBe(true);
});

test('A-C7 链接存 URL 与标题，纯文本单 URL 判为链接', async () => {
  expect((await hook('trayDropText', 'https://www.zhihu.com/question/1')).ok).toBe(true);
  let m = (await entries())[0];
  expect(m.type).toBe('link');
  expect(m.sourceUrl).toBe('https://www.zhihu.com/question/1');
  expect(m.title).toBe('zhihu.com');
  expect((await hook('inboxDrop', { uriList: ['https://a.example/x'], text: '一篇文章' })).ok).toBe(true);
  m = (await entries())[0];
  expect(m.title).toBe('一篇文章');
});

test('A-C8 空数据显示状态 4，2s 后收起，不留 .tmp', async () => {
  const r = await hook('inboxDrop', { text: '   ' });
  expect(r.ok).toBe(false);
  const s = await hook('dropzoneState');
  expect(s.state).toBe('error');
  expect(s.text).toBe('这个内容暂时收不进来');
  const bad = await hook('trayDropFiles', [path.join(work, '不存在.pdf')]);
  expect(bad.ok).toBe(false);
  expect(fs.readdirSync(inboxDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  await expect.poll(async () => (await hook('dropzoneState')).visible, { timeout: 4000 }).toBe(false);
});

test('A-C9 列表时间倒序，四类各走对应打开方式，原文件移走后置灰', async () => {
  await hook('openInboxPanel');
  await expect(page.locator('#inbox-view')).toBeVisible();
  const rows = page.locator('.inbox-row');
  const list = await entries();
  await expect(rows).toHaveCount(list.length);
  await expect(rows.first()).toHaveAttribute('data-id', list[0].id);
  // 链接
  await page.locator('.inbox-row[data-type="link"]').first().click();
  // 文件
  await page.locator('.inbox-row', { hasText: '季度报告.pdf' }).click();
  // 图片
  await page.locator('.inbox-row[data-type="image"]').first().click();
  const calls = await hook('inboxOpenCalls');
  expect(calls.map((c) => c.how)).toEqual(['openExternal', 'openPath', 'openPath']);
  expect(calls[1].target).toMatch(/季度报告\.pdf\.symlink$/);
  // 文字：面板内展开
  await page.locator('.inbox-row', { hasText: '读书笔记' }).click();
  await expect(page.locator('#inbox-detail')).toBeVisible();
  await expect(page.locator('#inbox-back')).toHaveText('‹ 收纳');
  const frame = page.frameLocator('#inbox-detail-frame');
  await expect(frame.locator('b')).toHaveText('重点');
  await page.locator('#inbox-back').click();
  await expect(page.locator('#inbox-list')).toBeVisible();
  // 原文件移走
  fs.renameSync(path.join(work, '季度报告.pdf'), path.join(work, '挪走了.pdf'));
  await page.locator('#inbox-back').click();
  await hook('openInboxPanel');
  const row = page.locator('.inbox-row', { hasText: '季度报告.pdf' });
  await expect(row).toHaveClass(/is-missing/);
  await expect(row.locator('.inbox-row-sub')).toHaveText('原文件已移动或删除');
  // 右键删除这条，原文件不动
  await row.click({ button: 'right' });
  await expect.poll(() => hook('inboxMenuItems')).not.toBe(null);
  expect((await hook('inboxMenuItems')).filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual(['删除这条']);
  expect(await hook('clickInboxMenuItem', 'inbox-delete')).toBe(true);
  await expect(page.locator('.inbox-row', { hasText: '季度报告.pdf' })).toHaveCount(0);
  // 0.1.45：右键删除与悬停 × 同一路径，也出「已删除 · 撤销」
  await expect(page.locator('#inbox-undo')).toBeVisible();
  expect((await page.locator('#inbox-undo').textContent()).replace(/\u00a0/g, ' ')).toBe('已删除 · 撤销');
  expect(fs.existsSync(path.join(work, '挪走了.pdf'))).toBe(true);
});

test('A-C9 / P-C1–P-C3 顶栏收纳入口在检查更新左侧；图标等距；空状态居中；标题居中', async () => {
  await hook('hideWindow');
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('.topbar-right > *')).map((el) => el.id));
  expect(order.indexOf('inbox-button')).toBe(order.indexOf('check-update') - 1);
  for (const m of await entries()) fs.rmSync(path.join(inboxDir, m.id), { recursive: true });
  await hook('openInboxPanel');
  await expect(page.locator('#inbox-empty')).toHaveText('把文件、图片、文字或链接拖到菜单栏时钟上，就会收在这里');
  // 0.1.46：顶栏三个图标间距一致、同一中线；空提示在列表区域内水平垂直居中；标题紧跟「‹ 返回」左对齐
  const geo = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const ib = r('#inbox-button'); const cu = r('#check-update'); const pb = r('#pin-button');
    const icons = ['#inbox-button svg', '#check-update svg', '#pin-button svg.pin-icon-pin'].map((q) => { const b = r(q); return b.top + b.height / 2; });
    const view = r('#inbox-view'); const empty = r('#inbox-empty'); const head = r('.inbox-head');
    const back = r('#inbox-back'); const title = r('.inbox-title');
    const listTop = Math.max(...Array.from(document.querySelectorAll('#inbox-view > *')).filter((el) => el !== document.getElementById('inbox-empty') && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().bottom <= empty.top + 1).map((el) => el.getBoundingClientRect().bottom), head.bottom);
    return { gap1: cu.left - ib.right, gap2: pb.left - cu.right, icons, emptyMid: empty.top + empty.height / 2, areaMid: (listTop + view.bottom) / 2, emptyH: empty.height, textMid: (() => { const range = document.createRange(); range.selectNodeContents(document.getElementById('inbox-empty')); const b = range.getBoundingClientRect(); return b.top + b.height / 2; })(), titleMid: title.left + title.width / 2, viewMidX: view.left + view.width / 2 };
  });
  expect(geo.gap1).toBe(geo.gap2);
  expect(Math.max(...geo.icons) - Math.min(...geo.icons)).toBeLessThanOrEqual(1);
  expect(Math.abs(geo.textMid - geo.areaMid)).toBeLessThanOrEqual(2);
  // P-C3 收纳页顶栏标题居中
  expect(Math.abs(geo.titleMid - geo.viewMidX)).toBeLessThanOrEqual(1);
  // P-C1 与设置胶囊 8px：在主界面量（收纳页里胶囊隐藏）
  fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '45-inbox-empty.png') });
  await page.locator('#inbox-back').click();
  const pill = await page.evaluate(() => document.getElementById('settings-button').getBoundingClientRect().left - document.getElementById('pin-button').getBoundingClientRect().right);
  expect(pill).toBe(8);
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '44-topbar-icons.png'), clip: { x: 380, y: 0, width: 200, height: 32 } });
  console.log('GEO', JSON.stringify(geo));
});

test('A-C10 托盘「退出栏历」走带兜底强退的退出函数', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const quitApp = /function quitApp\(\) \{([\s\S]*?)\n\}/.exec(src)[1];
  expect(quitApp).toContain('quitWithFallback()');
  const fallback = /function quitWithFallback\(\) \{([\s\S]*?)\n\}/.exec(src)[1];
  expect(fallback).toContain('app.quit()');
  expect(fallback).toContain('app.exit(0)');
  expect(src).toContain('quit: () => quitWithFallback()');
});
