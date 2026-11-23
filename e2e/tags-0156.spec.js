'use strict';
// 0.1.56 标签管理验收（契约 docs/changes/0.1.56-tag-manager.md，f7f1d35）：T0、T0b、T4–T7、T6b、删除确认、空库，以及深浅各 3 张截图。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInboxStore } = require('../electron/inbox-store');

const SHOTS = path.join(__dirname, 'screenshots');
let app = null;
let page = null;

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
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// 造一份 0.1.55 形态的收纳目录：meta.tags 是名字数组，有 index.json，没有 tags.json。
function seed055(dir, n, tagged) {
  const s = createInboxStore({ root: dir });
  const ids = [];
  for (let i = 0; i < n; i += 1) ids.push(s.addText({ text: `真实条目 ${String(i).padStart(2, '0')}` }).id);
  for (const id of ids) {
    const f = path.join(dir, id, 'meta.json'); const m = readJson(f);
    m.tags = tagged(ids.indexOf(id));
    fs.writeFileSync(f, JSON.stringify(m, null, 2));
  }
  fs.rmSync(path.join(dir, 'tags.json'), { force: true });
  // 0.1.55 的 index.json：entries 里 tags 也是名字
  const metas = ids.map((id) => readJson(path.join(dir, id, 'meta.json')));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ schema: 1, entries: metas }));
  return ids;
}

async function launch(inboxDir, extraEnv) {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir, ...(extraEnv || {}) } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
}

async function openSettingsTags() {
  if (await page.locator('#settings-view').isHidden()) {
    await page.evaluate(() => { if (typeof closeInboxView === 'function') closeInboxView(); });
    await hook('trayEnter');
    await page.click('#settings-button');
    await expect.poll(() => hook('clickSettingsMenuItem', 'more-settings'), { timeout: 5000 }).toBe(true);
    await hook('closeSettingsMenu');
  }
  await expect(page.locator('#settings-view')).toBeVisible();
  await page.click('.settings-tab[data-tab="tags"]');
  await expect(page.locator('#settings-page-tags')).toBeVisible();
}
async function backFromSettings() {
  if (await page.locator('#settings-view').isVisible()) await page.click('#settings-back');
  await expect(page.locator('#settings-view')).toBeHidden();
}
async function openTagPopFor(text) {
  await hook('openInboxPanel');
  const row = rowOf(text).first();
  await row.hover();
  await row.locator('.inbox-act-tag').click({ force: true });
  await expect(page.locator('#inbox-tagpop')).toBeVisible();
}
const libNames = () => page.evaluate(() => window.lanli.inboxTags()).then((l) => l.map((t) => t.name));

// ---------- T0b：迁移中途写入失败 ----------
test.describe.serial('T0b', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-0156b-'));
  const dir = path.join(work, 'inbox');
  let ids = [];
  let before = {};
  test.beforeAll(async () => {
    ids = seed055(dir, 4, (i) => (i < 3 ? ['test'] : []));
    before = Object.fromEntries(ids.map((id) => [id, fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')]));
    await launch(dir, { LANLI_E2E_MIGRATE_FAIL_AT: '2' });
  });
  test.afterAll(async () => { if (app) await app.close(); app = null; });

  test('T0b 原 meta.json 全部未变，应用照常显示所有条目和标签', async () => {
    for (const id of ids) expect(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')).toBe(before[id]);
    const list = await entries();
    expect(list.length).toBe(4);
    expect(list.filter((m) => m.tags.includes('test')).length).toBe(3);
    await hook('openInboxPanel');
    await expect(page.locator('#inbox-tags .inbox-tag[data-tag="test"]')).toBeVisible();
    await expect(page.locator('.inbox-row')).toHaveCount(4);
  });
});

// ---------- T0 + 其余 UI 验收 ----------
test.describe.serial('main', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-0156-'));
  const dir = path.join(work, 'inbox');
  let ids = [];
  let before = {};
  let indexBefore = '';
  let testIdsBefore = [];
  test.beforeAll(async () => {
    // 12 项，其中 5 项带 #test，2 项带 #重要（和默认同名，应复用）
    ids = seed055(dir, 12, (i) => [...(i % 3 === 0 || i === 1 ? ['test'] : []), ...(i === 2 || i === 4 ? ['重要'] : [])]);
    before = Object.fromEntries(ids.map((id) => [id, fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')]));
    indexBefore = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
    testIdsBefore = ids.filter((id) => JSON.parse(before[id]).tags.includes('test')).sort();
    await launch(dir);
  });
  test.afterAll(async () => { if (app) await app.close(); app = null; });

  test('T0 0.1.55 真实数据升级：#test 在原条目、条目数不变、备份齐全一致、筛选相同、默认标签已补', async () => {
    const list = await entries();
    expect(list.length).toBe(12);
    expect(list.filter((m) => m.tags.includes('test')).map((m) => m.id).sort()).toEqual(testIdsBefore);
    const bak = path.join(dir, '.backup-0.1.56');
    for (const id of ids) expect(fs.readFileSync(path.join(bak, id, 'meta.json'), 'utf8')).toBe(before[id]);
    expect(fs.readFileSync(path.join(bak, 'index.json'), 'utf8')).toBe(indexBefore);
    for (const id of ids) {
      const m = readJson(path.join(dir, id, 'meta.json'));
      expect(m.tags.every((t) => /^t_[0-9a-f]{8}$/.test(t))).toBe(true);
    }
    expect(await libNames()).toEqual(['备忘', '重要', '临时', 'test']);
    await hook('openInboxPanel');
    await page.locator('#inbox-tags .inbox-tag[data-tag="test"]').click();
    await expect(page.locator('.inbox-row')).toHaveCount(testIdsBefore.length);
    await page.locator('#inbox-tags .inbox-tag[data-tag="test"]').click();
    await expect(page.locator('.inbox-row')).toHaveCount(12);
  });

  test('T7 弹层尺寸按 A 表；T6 候选不含本条已有标签、按名称排序', async () => {
    await openTagPopFor('真实条目 00');   // 有 #test
    const m = await page.evaluate(() => {
      const pop = document.getElementById('inbox-tagpop');
      const input = document.getElementById('inbox-tag-input');
      const sug = document.getElementById('inbox-tag-suggest');
      const cs = getComputedStyle(pop); const ic = getComputedStyle(input);
      const item = sug.querySelector('.inbox-tag-suggest-item'); const it = getComputedStyle(item);
      const ir = input.getBoundingClientRect(); const sr = sug.getBoundingClientRect();
      return {
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
        w: ir.width, h: ir.height, font: ic.fontSize, ipad: ic.paddingLeft,
        gap: Math.round(sr.top - ir.bottom), sgap: getComputedStyle(sug).columnGap,
        ih: item.getBoundingClientRect().height, ifont: it.fontSize, ipadx: it.paddingLeft, imax: it.maxWidth,
        popW: pop.getBoundingClientRect().width,
        names: [...sug.querySelectorAll('.inbox-tag-suggest-item')].map((b) => b.dataset.tag)
      };
    });
    expect(m.pad).toEqual(['12px', '12px', '12px', '12px']);
    expect(m.w).toBe(200); expect(m.h).toBe(28); expect(m.font).toBe('13px'); expect(m.ipad).toBe('8px');
    expect(m.gap).toBe(10); expect(m.sgap).toBe('6px');
    expect(m.ih).toBe(22); expect(m.ifont).toBe('12px'); expect(m.ipadx).toBe('8px'); expect(m.imax).toBe('200px');
    expect(Math.round(m.popW)).toBeGreaterThanOrEqual(224);
    expect(m.names).not.toContain('test');
    expect(m.names).toEqual(['备忘', '重要', '临时'].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
    // 弹层不出窗口
    const inWin = await page.evaluate(() => { const r = document.getElementById('inbox-tagpop').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight; });
    expect(inWin).toBe(true);
    // 输入过滤
    await page.fill('#inbox-tag-input', '重');
    await expect(page.locator('#inbox-tag-suggest .inbox-tag-suggest-item')).toHaveText(['#重要']);
    await page.fill('#inbox-tag-input', '');
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `56-tagpop-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
  });

  test('T6 输入已存在的名字回车 → 加上已有 ID，库里条数不变', async () => {
    const n0 = (await libNames()).length;
    await page.fill('#inbox-tag-input', ' #重要 ');
    await page.press('#inbox-tag-input', 'Enter');
    await expect(page.locator('#inbox-tagpop')).toBeHidden();
    await expect.poll(async () => (await entries()).find((x) => x.title === '真实条目 00' || (x.preview || '').includes('真实条目 00'))?.tags || []).toContain('重要');
    expect((await libNames()).length).toBe(n0);
  });

  test('T6b 弹层「管理标签…」→ 打开设置页「标签」tab', async () => {
    await openTagPopFor('真实条目 05');
    await page.click('#inbox-tagpop-manage');
    await expect(page.locator('#settings-view')).toBeVisible();
    await expect(page.locator('#settings-page-tags')).toBeVisible();
    await expect(page.locator('.settings-tab[data-tab="tags"]')).toHaveClass(/is-selected/);
    await expect(page.locator('#settings-page-title')).toHaveText('标签');
    await expect(page.locator('#tags-list .tag-row')).toHaveCount(4);
    await expect(page.locator('#tags-list .tag-row[data-name="test"] .tag-row-count')).toHaveText(`${testIdsBefore.length} 项`);
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `56-tags-tab-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
  });

  test('设置页新增 + 查重（T3 界面）', async () => {
    await openSettingsTags();
    await page.fill('#tags-new', 'ＴＥＳＴ');
    await page.click('#tags-add-btn');
    await expect(page.locator('#tags-new-err')).toHaveText('已有标签 #test');
    await page.fill('#tags-new', '读书');
    await page.press('#tags-new', 'Enter');
    await expect(page.locator('#tags-list .tag-row[data-name="读书"]')).toBeVisible();
    await expect(page.locator('#tags-new')).toHaveValue('');
    expect(await libNames()).toEqual(['备忘', '重要', '临时', 'test', '读书']);
  });

  test('T4 改名 test→测试：meta.json 内容和 mtime 不变；收纳页显示 #测试、可筛选；Esc 取消、重名不保存', async () => {
    const stat = Object.fromEntries(ids.map((id) => { const f = path.join(dir, id, 'meta.json'); return [id, [fs.readFileSync(f, 'utf8'), fs.statSync(f).mtimeMs]]; }));
    const row = page.locator('#tags-list .tag-row[data-name="test"]');
    await row.locator('.tag-row-rename').click();
    await page.locator('#tags-list .tag-row-input').fill('改了又取消');
    await page.press('#tags-list .tag-row-input', 'Escape');
    await expect(page.locator('#tags-list .tag-row[data-name="test"] .tag-row-name')).toHaveText('#test');
    await page.locator('#tags-list .tag-row[data-name="test"] .tag-row-rename').click();
    await page.locator('#tags-list .tag-row-input').fill('重要');
    await page.press('#tags-list .tag-row-input', 'Enter');
    await expect(page.locator('#tags-list .tag-row-err')).toHaveText('已有标签 #重要');
    await page.locator('#tags-list .tag-row-input').fill('测试');
    await page.press('#tags-list .tag-row-input', 'Enter');
    await expect(page.locator('#tags-list .tag-row[data-name="测试"]')).toBeVisible();
    for (const id of ids) {
      const f = path.join(dir, id, 'meta.json');
      expect(fs.readFileSync(f, 'utf8')).toBe(stat[id][0]);
      expect(fs.statSync(f).mtimeMs).toBe(stat[id][1]);
    }
    await backFromSettings();
    await hook('openInboxPanel');
    await expect(page.locator('#inbox-tags .inbox-tag[data-tag="测试"]')).toBeVisible();
    await page.locator('#inbox-tags .inbox-tag[data-tag="测试"]').click();
    await expect(page.locator('.inbox-row')).toHaveCount(testIdsBefore.length);
    await page.locator('#inbox-tags .inbox-tag[data-tag="测试"]').click();
  });

  test('T5 删除「重要」：就地确认，取消无变化；确认后条目数不变、引用清掉', async () => {
    await openSettingsTags();
    const usedBy = (await entries()).filter((m) => m.tags.includes('重要')).length;
    expect(usedBy).toBe(3);
    const row = page.locator('#tags-list .tag-row[data-name="重要"]');
    await row.locator('.tag-row-delete').click();
    await expect(row.locator('.tag-confirm-text')).toHaveText(`删除 #重要？${usedBy} 项会去掉这个标签，条目本身保留`);
    expect(await row.locator('.tag-confirm-ok').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 59, 48)');
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `56-delete-confirm-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
    await row.locator('.tag-confirm-cancel').click();
    await expect(row.locator('.tag-row-name')).toHaveText('#重要');
    expect((await entries()).filter((m) => m.tags.includes('重要')).length).toBe(3);
    await row.locator('.tag-row-delete').click();
    await row.locator('.tag-confirm-ok').click();
    await expect(page.locator('#tags-list .tag-row[data-name="重要"]')).toHaveCount(0);
    const list = await entries();
    expect(list.length).toBe(12);
    expect(list.filter((m) => m.tags.includes('重要')).length).toBe(0);
    for (const id of ids) expect(readJson(path.join(dir, id, 'meta.json')).tags.length).toBeLessThanOrEqual(1);
  });

  test('收纳页右键「删除这个标签」同样先确认（取消不删）', async () => {
    await backFromSettings();
    await hook('openInboxPanel');
    await page.locator('#inbox-tags .inbox-tag[data-tag="测试"]').dispatchEvent('contextmenu');
    await expect.poll(() => hook('inboxMenuItems')).not.toBe(null);
    expect(await hook('clickInboxMenuItem', 'inbox-tag-delete')).toBe(true);
    await expect(page.locator('#inbox-tag-confirm-text')).toHaveText(`删除 #测试？${testIdsBefore.length} 项会去掉这个标签，条目本身保留`);
    await page.click('#inbox-tag-confirm-cancel');
    await expect(page.locator('#inbox-tag-confirm')).toBeHidden();
    expect((await entries()).filter((m) => m.tags.includes('测试')).length).toBe(testIdsBefore.length);
  });

  test('空库：全删光后显示「还没有标签，在上面添加一个」', async () => {
    await openSettingsTags();
    for (;;) {
      const row = page.locator('#tags-list .tag-row').first();
      if (!(await row.count())) break;
      await row.locator('.tag-row-delete').click();
      await row.locator('.tag-confirm-ok').click();
      await page.waitForTimeout(100);
    }
    await expect(page.locator('#tags-empty')).toBeVisible();
    await expect(page.locator('#tags-empty')).toHaveText('还没有标签，在上面添加一个');
    expect((await entries()).length).toBe(12);
    await backFromSettings();
  });
});
