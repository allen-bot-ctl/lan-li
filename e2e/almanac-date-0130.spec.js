'use strict';

const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const SHOTS = path.join(__dirname, 'screenshots');

let app = null;
let page = null;

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

const trayEnter = () => mainEval(() => globalThis.__lanliTest.trayEnter());
const trayLeave = () => mainEval(() => globalThis.__lanliTest.trayLeave());
const isVisible = () => mainEval(() => globalThis.__lanliTest.isVisible());
const setNow = (iso) => mainEval((_electron, value) => globalThis.__lanliTest.setNow(value), iso);
const title = () => page.locator('#almanac-style-name');
const cell = (y, m, d) => page.locator(`.cell[aria-label^="${y}年${m}月${d}日 "]`);
const monthTitle = () => page.locator('#month-title');

// 主进程按日期算黄历（almanac:getForDate → buildAlmanac），作为卡片内容的对照。
async function expectedFor(y, m, d) {
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const a = await page.evaluate((k) => window.lanli.getAlmanacForDate(k), key);
  expect(a.dateKey).toBe(key);
  expect(a.styleId).toBe('coder');
  return { yi: a.focusYi.text, ji: a.focusJi.text, quote: a.quote, lunar: a.lunarDayText };
}

function cardText() {
  return page.evaluate(() => ({
    yi: document.getElementById('almanac-focus-yi').textContent,
    ji: document.getElementById('almanac-focus-ji').textContent,
    quote: document.getElementById('almanac-quote').textContent
  }));
}

function ringOf(y, m, d) {
  return page.evaluate((label) => {
    const el = document.querySelector(`.cell[aria-label^="${label}"]`);
    return {
      selected: el.classList.contains('is-selected'),
      today: el.classList.contains('is-today'),
      shadow: getComputedStyle(el).boxShadow
    };
  }, `${y}年${m}月${d}日 `);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await trayEnter();
  // 固定今天为 2026-11-18，风格切到程序猿。
  await setNow('2026-11-18T10:00:00');
  await page.evaluate(() => window.lanli.setAlmanacStyle('coder'));
  await page.click('#today-button');
  await expect(monthTitle()).toHaveText('2026年11月');
  await expect(title()).toHaveText('程序猿黄历');
});

test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.lanli.setAlmanacStyle('lunar')).catch(() => {});
    await setNow(null).catch(() => {});
    await app.close();
  }
});

test('C4 点 12 月灰色「2」格：翻到 12 月、2 号描边、卡片与详情都是 12 月 2 日', async () => {
  await cell(2026, 12, 2).click();
  await expect(monthTitle()).toHaveText('2026年12月');
  await expect(title()).toHaveText('程序猿 · 十月廿四');
  const ring = await ringOf(2026, 12, 2);
  expect(ring.selected).toBe(true);
  expect(ring.shadow).toContain('inset');
  const expected = await expectedFor(2026, 12, 2);
  const card = await cardText();
  expect(card).toEqual({ yi: expected.yi, ji: expected.ji, quote: expected.quote });

  await page.click('#almanac-focus-yi');
  await expect(page.locator('#almanac-detail')).toBeVisible();
  await expect(page.locator('#almanac-detail-title')).toHaveText(`黄历 · ${expected.lunar}`);
  await expect(page.locator('#almanac-detail-body')).toContainText(expected.yi);
  await page.screenshot({ path: path.join(SHOTS, '20-almanac-date-0130.png') });
  await page.click('#almanac-detail-close');
  await expect(page.locator('#almanac-detail')).toBeHidden();
});

test('C5 翻月不改选中，点「今天」回到今天，收起再打开也回到今天', async () => {
  await page.click('#prev-month');
  await expect(monthTitle()).toHaveText('2026年11月');
  await expect(title()).toHaveText('程序猿 · 十月廿四');
  await page.click('#next-month');
  await expect(monthTitle()).toHaveText('2026年12月');
  expect((await ringOf(2026, 12, 2)).selected).toBe(true);

  await page.click('#today-button');
  await expect(monthTitle()).toHaveText('2026年11月');
  await expect(title()).toHaveText('程序猿黄历');
  const today = await ringOf(2026, 11, 18);
  expect(today.today).toBe(true);
  expect(today.selected).toBe(false);
  expect(await page.locator('.cell.is-selected').count()).toBe(0);

  await cell(2026, 11, 20).click();
  await expect(title()).toHaveText('程序猿 · 十月十二');
  // 收起窗口：指针停在中性位置后托盘移出（同 pin-and-polish 的 showUnpinned 做法）。
  await page.mouse.move(6, 220);
  await trayLeave();
  await expect.poll(isVisible, { timeout: 2000 }).toBe(false);
  await trayEnter();
  await expect(title()).toHaveText('程序猿黄历');
  expect(await page.locator('.cell.is-selected').count()).toBe(0);
});

test('C4b 点本月「25」格：25 号描边，标题与宜忌是 11 月 25 日', async () => {
  await cell(2026, 11, 25).click();
  await expect(title()).toHaveText('程序猿 · 十月十七');
  expect((await ringOf(2026, 11, 25)).selected).toBe(true);
  const expected = await expectedFor(2026, 11, 25);
  expect(await cardText()).toEqual({ yi: expected.yi, ji: expected.ji, quote: expected.quote });
});

test('C4c 跨午夜：选中其他日期保持不变；选中今天跟到新的今天', async () => {
  // 接 C4b：选中 11 月 25 日，跨过 11-18 午夜后仍是 25 日。
  await setNow('2026-11-19T00:00:05');
  await page.waitForTimeout(300);
  await expect(title()).toHaveText('程序猿 · 十月十七');
  const keep = await expectedFor(2026, 11, 25);
  expect((await cardText()).yi).toBe(keep.yi);

  // 回到今天（11-19），再跨到 11-20 午夜：卡片跟到 11-20，标题仍是今天样式。
  await page.click('#today-button');
  await expect(title()).toHaveText('程序猿黄历');
  await setNow('2026-11-20T00:00:05');
  const next = await expectedFor(2026, 11, 20);
  await expect.poll(cardText).toEqual({ yi: next.yi, ji: next.ji, quote: next.quote });
  await expect(title()).toHaveText('程序猿黄历');
  await setNow('2026-11-18T10:00:00');
  await page.click('#today-button');
});

test('C6 点今天的格子：只有橙色实底、无描边，标题是今天样式', async () => {
  await cell(2026, 11, 25).click();
  await expect(title()).toHaveText('程序猿 · 十月十七');
  await cell(2026, 11, 18).click();
  await expect(title()).toHaveText('程序猿黄历');
  const today = await ringOf(2026, 11, 18);
  expect(today.today).toBe(true);
  expect(today.selected).toBe(false);
  expect(await page.locator('.cell.is-selected').count()).toBe(0);
});
