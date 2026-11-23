'use strict';
// 0.1.55 A1–A2（当前时区）、B1–B6（有圆点的日期再点一次进收纳）。日期都按真实「今天」计算。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SHOTS = path.join(__dirname, 'screenshots');
let app = null;
let page = null;
let addedClock = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-0155-'));
const inboxDir = path.join(work, 'inbox');

async function mainEval(fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await app.evaluate(fn, arg); } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}
const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });

const now = new Date();
const key = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0);
// 有圆点的日期 D（同月、不是今天），无圆点日期 E（同月、不是今天也不是 D）
const dDay = now.getDate() > 2 ? now.getDate() - 1 : now.getDate() + 1;
const eDay = now.getDate() > 2 ? now.getDate() - 2 : now.getDate() + 2;
const D = new Date(now.getFullYear(), now.getMonth(), dDay, 10, 0);
const E = new Date(now.getFullYear(), now.getMonth(), eDay, 10, 0);

function seed(id, title, when) {
  fs.mkdirSync(path.join(inboxDir, id), { recursive: true });
  fs.writeFileSync(path.join(inboxDir, id, 'meta.json'), JSON.stringify({
    id, tags: [], missing: false, schema: 1, sourcePath: null, size: 0, ref: 'copy',
    type: 'link', title, sourceUrl: `https://example.org/${id}`, preview: 'example.org',
    createdAt: when.toISOString(), createdMs: when.getTime()
  }));
}
seed('20300101-000001-d1', 'D 日第一条', D);
seed('20300101-000002-d2', 'D 日第二条', new Date(D.getTime() + 3600e3));
seed('20300101-000003-t1', '今天的一条', today);

const cell = (d) => page.locator(`#grid .cell[data-day="${key(d)}"]`);
const inboxOpen = () => page.locator('#inbox-view').isVisible();
const range = () => page.evaluate(() => inboxFilter.range);

async function tipOf(d) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(100);
  await cell(d).hover();
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const t = document.getElementById('icon-tooltip');
    return t.hidden ? null : t.textContent;
  });
}

async function back() {
  await page.click('#inbox-back');
  await expect(page.locator('#inbox-view')).toBeHidden();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await hook('trayEnter');
  await expect(cell(D).locator('.cell-inbox-dot')).toHaveCount(1);
});

test.afterAll(async () => {
  if (!app) return;
  await page.emulateMedia({ colorScheme: null }).catch(() => {});
  if (addedClock) await page.evaluate((x) => window.lanli.removeClock({ id: x }), addedClock).catch(() => {});
  await app.close();
});

test('A1/A2 当前时区：文字「当前时区」，带 is-current-zone，浅色 #007aff、深色 #0a84ff、字重 600，不截断', async () => {
  const local = await hook('localZone');
  const state = await page.evaluate(() => window.lanli.getState());
  if (!state.clocks.items.some((c) => c.id === local)) {
    await page.evaluate((id) => window.lanli.addClock({ id, label: '本机' }), local);
    addedClock = local;
    await page.evaluate(() => refreshState());
  }
  const sub = page.locator('#clock-list .clock-entry-sub.is-current-zone');
  await expect(sub).toHaveCount(1);
  await expect(sub).toHaveText('当前时区');
  const others = await page.locator('#clock-list .clock-entry-sub:not(.is-current-zone)').allTextContents();
  for (const t of others) expect(t).not.toBe('当前时区');
  for (const [scheme, color] of [['light', 'rgb(0, 122, 255)'], ['dark', 'rgb(10, 132, 255)']]) {
    await page.emulateMedia({ colorScheme: scheme });
    const m = await sub.evaluate((el) => ({ c: getComputedStyle(el).color, w: getComputedStyle(el).fontWeight, sw: el.scrollWidth, cw: el.clientWidth }));
    expect(m.c).toBe(color);
    expect(Number(m.w)).toBe(600);
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    await page.locator('.clocks-card, #clock-list').first().screenshot({ path: path.join(SHOTS, `55-current-zone-${scheme}.png`) }).catch(() => page.screenshot({ path: path.join(SHOTS, `55-current-zone-${scheme}.png`) }));
  }
  await page.emulateMedia({ colorScheme: null });
});

test('B3 今天有圆点且未选其它日期：点一次就打开收纳并筛到今天', async () => {
  expect(await tipOf(today)).toBe('收纳 1 项 · 点击查看');
  await cell(today).click();
  await expect(page.locator('#inbox-view')).toBeVisible();
  expect(await range()).toEqual({ from: key(today), to: key(today) });
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await back();
  expect(await range()).toBeNull();
});

test('B5/B1 未选中的 D：气泡「收纳 2 条」；单击只选中，不开收纳', async () => {
  expect(await tipOf(D)).toBe('收纳 2 项');
  await cell(D).click();
  await page.waitForTimeout(300);
  expect(await inboxOpen()).toBe(false);
  await expect(cell(D)).toHaveClass(/is-selected/);
  expect(await tipOf(D)).toBe('收纳 2 项 · 点击查看');
  await expect(cell(D)).toHaveCSS('cursor', 'pointer');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `55-day-tooltip-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
});

test('B2/B6 再点已选中的 D：打开收纳、range=D、只列 D 的 2 条、范围条显示；返回后 range 清空', async () => {
  await page.mouse.move(5, 5);
  await cell(D).click();
  await expect(page.locator('#inbox-view')).toBeVisible();
  expect(await range()).toEqual({ from: key(D), to: key(D) });
  await expect(page.locator('.inbox-row')).toHaveCount(2);
  await expect(page.locator('#inbox-day-chip')).toBeVisible();
  await expect(page.locator('#inbox-day-chip-text')).toContainText('2');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `55-day-inbox-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await back();
  expect(await range()).toBeNull();
  // 下次从顶部收纳入口进来看到全部
  await page.click('#inbox-button');
  await expect(page.locator('.inbox-row')).toHaveCount(3);
  await back();
});

test('B4/B5 无圆点日期：不出气泡，点两次都不开收纳', async () => {
  expect(await tipOf(E)).toBeNull();
  await cell(E).click();
  await page.waitForTimeout(250);
  await cell(E).click();
  await page.waitForTimeout(300);
  expect(await inboxOpen()).toBe(false);
});
