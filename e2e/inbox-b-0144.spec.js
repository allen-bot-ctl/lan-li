'use strict';
// 0.1.44 收纳 B 段验收：B-C1–B-C8（契约 docs/changes/0.1.42-inbox.md 第七、十节）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const IQ = require('../electron/renderer/inbox-query');

const SHOTS = path.join(__dirname, 'screenshots');
let app = null;
let page = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-inbox-b-'));
const inboxDir = path.join(work, 'inbox');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function mainEval(fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await app.evaluate(fn, arg); } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}
const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const entries = () => hook('inboxList');
const rowOf = (text) => page.locator('.inbox-row', { hasText: text });

// 预置两条旧条目（直接写 meta.json，没有 index.json → 启动时由 meta 重建）
const now = new Date();
const old1 = new Date(now.getFullYear(), now.getMonth() - 2, 10, 9, 30);
function seed(id, meta) {
  fs.mkdirSync(path.join(inboxDir, id), { recursive: true });
  fs.writeFileSync(path.join(inboxDir, id, 'meta.json'), JSON.stringify({ id, tags: [], missing: false, schema: 1, sourcePath: null, size: 0, ref: 'copy', ...meta }));
}
seed('20200101-000000-old1', { type: 'link', title: '很久以前的链接', sourceUrl: 'https://old.example.org/a', preview: 'old.example.org', createdAt: old1.toISOString(), createdMs: old1.getTime() });

async function launch() {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
}

test.beforeAll(async () => { await launch(); });
test.afterAll(async () => { if (app) await app.close(); });

const fileA = path.join(work, 'Annual-Report.pdf');
const fileB = path.join(work, '会议纪要.docx');

test('准备：四类条目各一条 + 一条文件（稍后失联）', async () => {
  fs.writeFileSync(fileA, 'pdf'); fs.writeFileSync(fileB, 'doc');
  const img = path.join(work, '设计稿.png'); fs.writeFileSync(img, PNG);
  expect((await hook('trayDropFiles', [fileA])).ok).toBe(true);
  expect((await hook('trayDropFiles', [img])).ok).toBe(true);
  expect((await hook('inboxDrop', { html: '<p>Quarterly 周报：本周完成<b>收纳</b>功能</p>', text: 'Quarterly 周报：本周完成收纳功能' })).ok).toBe(true);
  expect((await hook('inboxDrop', { uriList: ['https://www.github.com/lanli/app'], text: '仓库主页' })).ok).toBe(true);
  expect((await hook('trayDropFiles', [fileB])).ok).toBe(true);
  expect((await entries()).length).toBe(6);
  await expect.poll(async () => (await hook('dropzoneState')).visible, { timeout: 4000 }).toBe(false);
  await hook('openInboxPanel');
  await expect.poll(() => hook('isVisible')).toBe(true);
  await expect(page.locator('.inbox-row')).toHaveCount(6);
});

test('B-C6 index.json 由 meta.json 重建，旧条目也在', async () => {
  expect(fs.existsSync(path.join(inboxDir, 'index.json'))).toBe(true);
  const idx = JSON.parse(fs.readFileSync(path.join(inboxDir, 'index.json'), 'utf8'));
  expect(idx.entries.map((m) => m.id)).toContain('20200101-000000-old1');
  await expect(rowOf('很久以前的链接')).toHaveCount(1);
});

test('B-C3 按今天/昨天/本周/本月/更早按月分组', async () => {
  const heads = await page.locator('.inbox-group').allTextContents();
  expect(heads[0]).toBe('今天');
  expect(heads).toContain(IQ.dateGroupLabel(old1.getTime(), new Date()));
  expect(heads[heads.length - 1]).toMatch(/月$/);
});

async function addTagUI(text, tag) {
  const row = rowOf(text);
  await row.hover();
  await row.locator('.inbox-act-tag').click({ force: true });
  await expect(page.locator('#inbox-tagpop')).toBeVisible();
  await page.locator('#inbox-tag-input').fill(tag);
  await page.locator('#inbox-tag-input').press('Enter');
}

test('B-C4/B-C6 # 加标签（联想已有标签），每条≤5、单个≤8 字', async () => {
  await addTagUI('Quarterly', '工作');
  await expect(page.locator('#inbox-tagpop')).toBeHidden();
  await expect(rowOf('Quarterly').locator('.inbox-row-tags')).toHaveText('#工作');
  await addTagUI('Quarterly', '读书');
  await addTagUI('仓库主页', '工作');
  // 联想：输入时出现已有标签，点一下即添加
  await rowOf('设计稿.png').hover();
  await rowOf('设计稿.png').locator('.inbox-act-tag').click({ force: true });
  await page.locator('#inbox-tag-input').fill('读');
  await expect(page.locator('#inbox-tag-suggest .inbox-tag-suggest-item')).toHaveText(['#读书']);
  await page.locator('#inbox-tag-input').fill('');
  await expect(page.locator('#inbox-tag-suggest .inbox-tag-suggest-item')).toHaveText(['#工作', '#读书']);
  await page.locator('#inbox-tag-input').press('Escape');
  await expect(page.locator('#inbox-tagpop')).toBeHidden();
  // 输入框最长 8 字；接口层 9 字报错
  await expect(page.locator('#inbox-tag-input')).toHaveAttribute('maxlength', '8');
  const id = (await entries()).find((m) => m.title === '仓库主页').id;
  const tooLong = await page.evaluate((i) => window.lanli.addInboxTag(i, '一二三四五六七八九'), id);
  expect(tooLong.ok).toBe(false);
  expect(tooLong.code).toBe('tag-too-long');
  for (const t of ['a', 'b', 'c', 'd']) expect((await page.evaluate(([i, x]) => window.lanli.addInboxTag(i, x), [id, t])).ok).toBe(true);
  const sixth = await page.evaluate((i) => window.lanli.addInboxTag(i, 'e'), id);
  expect(sixth.ok).toBe(false);
  expect(sixth.code).toBe('tag-limit');
  await expect.poll(async () => (await entries()).find((m) => m.id === id).tags.length).toBe(5);
});

test('B-C1 标签胶囊按次数排序，最多 6 个，其余进「+N」', async () => {
  const fileId = (await entries()).find((m) => m.title === 'Annual-Report.pdf').id;
  await page.evaluate((i) => Promise.all(['x1', 'x2'].map((t) => window.lanli.addInboxTag(i, t))), fileId);
  await expect(page.locator('#inbox-tags .inbox-tag')).toHaveCount(6);
  await expect(page.locator('#inbox-tags .inbox-tag').first()).toHaveText('#工作');
  await expect(page.locator('#inbox-more')).toHaveText('+2');
  await page.locator('#inbox-more').click();
  await expect(page.locator('#inbox-more-menu .inbox-more-item')).toHaveCount(2);
  await page.locator('#inbox-more').click();
});

test('B-C6 标签胶囊右键「删除这个标签」从所有条目移除', async () => {
  for (const t of ['a', 'b', 'c', 'd', 'x1', 'x2']) {
    await page.locator(`.inbox-tag[data-tag="${t}"], .inbox-more-item[data-tag="${t}"]`).first().dispatchEvent('contextmenu');
    await expect.poll(() => hook('inboxMenuItems')).not.toBe(null);
    expect((await hook('inboxMenuItems')).map((i) => i.label)).toEqual(['删除这个标签']);
    expect(await hook('clickInboxMenuItem', 'inbox-tag-delete')).toBe(true);
  }
  await expect.poll(async () => (await entries()).flatMap((m) => m.tags).sort()).toEqual(['工作', '工作', '读书']);
  await expect(page.locator('#inbox-tags .inbox-tag')).toHaveCount(2);
  await expect(page.locator('#inbox-more')).toBeHidden();
});

test('B-C1 类型与标签筛选叠加；空结果「没有符合条件的收纳」+ 清除筛选', async () => {
  await page.locator('.inbox-type[data-type="text"]').click();
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await page.locator('.inbox-type[data-type="all"]').click();
  await page.locator('.inbox-tag[data-tag="工作"]').click();
  await expect(page.locator('.inbox-row')).toHaveCount(2);
  await page.locator('.inbox-tag[data-tag="读书"]').click();
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await expect(page.locator('.inbox-row')).toContainText('Quarterly');
  await page.locator('.inbox-tag[data-tag="读书"]').click();
  await page.locator('.inbox-type[data-type="link"]').click();
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await expect(page.locator('.inbox-row')).toContainText('仓库主页');
  await page.locator('.inbox-type[data-type="file"]').click();
  await expect(page.locator('.inbox-row')).toHaveCount(0);
  await expect(page.locator('#inbox-noresult')).toBeVisible();
  await expect(page.locator('#inbox-noresult')).toContainText('没有符合条件的收纳');
  await page.locator('#inbox-clear').click();
  await expect(page.locator('.inbox-row')).toHaveCount(6);
  await expect(page.locator('.inbox-type[data-type="all"]')).toHaveClass(/is-active/);
});

test('B-C2 搜索：标题/正文/文件名/域名/标签，大小写不敏感，高亮；⌘F 聚焦，Esc 清空', async () => {
  await page.locator('#inbox-list').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await expect(page.locator('#inbox-search')).toBeFocused();
  await page.keyboard.type('QUARTERLY');
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await expect(page.locator('.inbox-row mark.inbox-hit').first()).toHaveText('Quarterly');
  const cases = [['收纳功能', '周报'], ['annual-report', 'Annual-Report.pdf'], ['github.com', '仓库主页'], ['old.example', '很久以前的链接'], ['读书', 'Quarterly']];
  for (const [q, hit] of cases) {
    await page.locator('#inbox-search').fill(q);
    await expect(page.locator('.inbox-row')).toHaveCount(1);
    await expect(page.locator('.inbox-row')).toContainText(hit);
  }
  await page.locator('#inbox-search').press('Escape');
  await expect(page.locator('#inbox-search')).toHaveValue('');
  await expect(page.locator('#inbox-view')).toBeVisible();
  await expect(page.locator('.inbox-row')).toHaveCount(6);
  // 200 条内 < 50ms
  const ms = await page.evaluate(() => {
    const list = Array.from({ length: 200 }, (_, i) => ({ id: 'x' + i, type: ['file', 'image', 'text', 'link'][i % 4], title: `条目 ${i} Title`, preview: '一段正文摘要'.repeat(10), body: '正文'.repeat(500) + i, tags: ['工作', 't' + (i % 7)], createdMs: Date.now() - i * 3600000, sourceUrl: 'https://site' + i + '.com/x' }));
    const t0 = performance.now();
    for (const q of ['t', 'ti', 'tit', 'titl', 'title 19', 'site7']) window.LanliInboxQuery.filterEntries(list, { query: q, type: 'all', tags: ['工作'] });
    return (performance.now() - t0) / 6;
  });
  expect(ms).toBeLessThan(50);
});

test('B-C8 截图：42 收纳列表（四类 + 一条失联）', async () => {
  fs.renameSync(fileB, path.join(work, '挪走的纪要.docx'));
  await page.locator('#inbox-back').click();
  await hook('openInboxPanel');
  await expect(rowOf('会议纪要.docx')).toHaveClass(/is-missing/);
  await expect(rowOf('会议纪要.docx').locator('.inbox-act-relink')).toHaveText('重新指定原文件…');
  // 0.1.46：文件副标题只显示上一级文件夹名，完整路径在悬停提示；日期按钮是单色 svg 图标
  const fileSub = rowOf('Annual-Report.pdf').locator('.inbox-row-sub');
  if (await fileSub.count()) {
    expect(await fileSub.textContent()).not.toContain('/');
    expect(await fileSub.getAttribute('title')).toContain('/');
  }
  await expect(page.locator('#inbox-cal-toggle svg.inbox-cal-icon')).toHaveCount(1);
  expect(await page.locator('#inbox-cal-toggle').textContent()).not.toContain('📅');
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, '42-inbox-list.png') });
});

test('B-C7 失联条目「重新指定原文件…」后恢复正常', async () => {
  const moved = path.join(work, '挪走的纪要.docx');
  await hook('setInboxRelinkPath', moved);
  await rowOf('会议纪要.docx').locator('.inbox-act-relink').click({ force: true });
  await expect(rowOf('会议纪要.docx')).not.toHaveClass(/is-missing/);
  const m = (await entries()).find((x) => x.title === '会议纪要.docx');
  expect(m.missing).toBe(false);
  expect(m.sourcePath).toBe(moved);
  expect(fs.readlinkSync(path.join(inboxDir, m.id, '会议纪要.docx.symlink'))).toBe(moved);
  await hook('setInboxRelinkPath', null);
});

test('B-C4 复制（四类）与在 Finder 中显示', async () => {
  for (const t of ['Annual-Report.pdf', '设计稿.png', 'Quarterly', '仓库主页']) {
    await rowOf(t).hover();
    await rowOf(t).locator('.inbox-act-copy').click({ force: true });
  }
  const calls = await hook('inboxCopyCalls');
  expect(calls.map((c) => c.kind)).toEqual(['text', 'image', 'html', 'text']);
  expect(calls[0].text).toBe(fileA);
  expect(calls[2].text).toContain('Quarterly');
  expect(calls[3].text).toBe('https://www.github.com/lanli/app');
  expect(await hook('clipboardText')).toBe('https://www.github.com/lanli/app');
  await rowOf('Annual-Report.pdf').hover();
  await rowOf('Annual-Report.pdf').locator('.inbox-act-reveal').click({ force: true });
  const open = (await hook('inboxOpenCalls')).pop();
  expect(open).toEqual({ how: 'showItemInFolder', target: fileA });
});

test('B-C4/B-C6 × 删除无确认，toast「已删除 · 撤销」5 秒内可撤销；之后真删，原文件不动', async () => {
  const id = (await entries()).find((m) => m.title === 'Annual-Report.pdf').id;
  await rowOf('Annual-Report.pdf').hover();
  await rowOf('Annual-Report.pdf').locator('.inbox-act-delete').click({ force: true });
  await expect(rowOf('Annual-Report.pdf')).toHaveCount(0);
  await expect(page.locator('#inbox-undo')).toBeVisible();
  await expect(page.locator('#inbox-undo')).toHaveText('已删除 · 撤销');
  await page.locator('#inbox-undo-btn').click();
  await expect(rowOf('Annual-Report.pdf')).toHaveCount(1);
  expect(fs.existsSync(path.join(inboxDir, id, 'meta.json'))).toBe(true);
  await rowOf('Annual-Report.pdf').hover();
  await rowOf('Annual-Report.pdf').locator('.inbox-act-delete').click({ force: true });
  await expect(rowOf('Annual-Report.pdf')).toHaveCount(0);
  await expect(page.locator('#inbox-undo')).toBeHidden({ timeout: 7000 });
  await expect.poll(() => fs.existsSync(path.join(inboxDir, '.trash', id)), { timeout: 3000 }).toBe(false);
  expect(fs.existsSync(path.join(inboxDir, id))).toBe(false);
  expect(fs.existsSync(fileA)).toBe(true);
});

test('B-C5 有收纳的日期显示小点；收纳面板打开时点日期筛到当天，× 取消', async () => {
  const todayKey = IQ.dayKeyOf(new Date());
  // 收纳面板里的月历
  await page.locator('#inbox-cal-toggle').click();
  const day = page.locator(`.inbox-minical-day[data-day="${todayKey}"]`);
  await expect(day.locator('.inbox-dot')).toHaveCount(1);
  await day.click();
  const d = new Date();
  await expect(page.locator('#inbox-day-chip')).toBeVisible();
  await expect(page.locator('#inbox-day-chip-text')).toHaveText(`${d.getMonth() + 1}月${d.getDate()}日`);
  await expect(rowOf('很久以前的链接')).toHaveCount(0);
  await expect(page.locator('.inbox-row')).toHaveCount(4);
  await page.locator('#inbox-day-chip-x').click();
  await expect(page.locator('#inbox-day-chip')).toBeHidden();
  await expect(page.locator('.inbox-row')).toHaveCount(5);
  await page.locator('#inbox-cal-toggle').click();
  // 主界面月历：今天下方有灰点；面板关着时点日期不会筛选
  await page.locator('#inbox-back').click();
  await expect(page.locator('#inbox-view')).toBeHidden();
  await expect(page.locator(`#grid .cell[data-day="${todayKey}"] .cell-inbox-dot`)).toHaveCount(1);
  const dot = await page.locator(`#grid .cell[data-day="${todayKey}"] .cell-inbox-dot`).evaluate((el) => { const s = getComputedStyle(el); return [s.width, s.height]; });
  expect(dot).toEqual(['4px', '4px']);
});

test('B-C8 截图：43 带搜索词、类型和标签筛选', async () => {
  await hook('openInboxPanel');
  await page.locator('.inbox-type[data-type="text"]').click();
  await page.locator('.inbox-tag[data-tag="工作"]').click();
  await page.locator('#inbox-search').fill('周报');
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await page.screenshot({ path: path.join(SHOTS, '43-inbox-panel-filtered.png') });
  await page.locator('#inbox-search').fill('');
  await page.locator('.inbox-tag[data-tag="工作"]').click();
  await page.locator('.inbox-type[data-type="all"]').click();
  await expect(page.locator('.inbox-row')).toHaveCount(5);
});

test('B-C8 截图：40 接纳框空闲、41 橙框+件数', async () => {
  await hook('trayDragEnter');
  let dz = null;
  for (let i = 0; i < 40 && !dz; i += 1) { dz = app.windows().find((p) => p.url().endsWith('dropzone.html')) || null; if (!dz) await page.waitForTimeout(100); }
  await dz.waitForLoadState('domcontentloaded');
  await expect(dz.locator('#dz')).toHaveAttribute('data-state', 'idle');
  await dz.screenshot({ path: path.join(SHOTS, '40-inbox-dropzone-idle.png') });
  await dz.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['a'], 'a.pdf')); dt.items.add(new File(['b'], 'b.pdf')); dt.items.add(new File(['c'], 'c.pdf'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(dz.locator('#dz')).toHaveAttribute('data-state', 'over');
  await expect(dz.locator('#dz-text')).toContainText('松开即保存');
  await dz.screenshot({ path: path.join(SHOTS, '41-inbox-dropzone-over.png') });
  await hook('hideDropzone');
});

test('B-C6 删除 index.json 后重启，由 meta.json 重建', async () => {
  const before = (await entries()).map((m) => m.id).sort();
  await app.close(); app = null;
  fs.rmSync(path.join(inboxDir, 'index.json'), { force: true });
  await launch();
  await hook('openInboxPanel');
  await expect(page.locator('.inbox-row')).toHaveCount(before.length);
  expect((await entries()).map((m) => m.id).sort()).toEqual(before);
  expect(fs.existsSync(path.join(inboxDir, 'index.json'))).toBe(true);
  const m = (await entries()).find((x) => x.title.startsWith('Quarterly'));
  expect(m.tags).toEqual(['工作', '读书']);
});
