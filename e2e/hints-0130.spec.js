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
const setNow = (iso) => mainEval((_electron, value) => globalThis.__lanliTest.setNow(value), iso);
const tip = () => page.locator('#icon-tooltip');

async function useStyle(id) {
  await page.evaluate((s) => window.lanli.setAlmanacStyle(s), id);
  await page.click('#today-button');
  await page.evaluate(() => refreshState());
}

// 悬停前先把指针挪到中性位置，保证每次都是新的 mouseenter。
async function hoverAndTip(selector, text) {
  // 先把指针挪到中性区并等上一个气泡真正隐藏，再悬停；气泡按 500ms 延迟出现，
  // 断言等事件（气泡可见）而不是卡死时限——macOS CI 上 500ms 计时器 + 600ms 窗口太紧（0.1.30 Release 44281028955）。
  await page.mouse.move(300, 300);
  await expect(tip()).toBeHidden();
  const started = Date.now();
  await page.hover(selector);
  await expect(tip()).toBeVisible();
  await expect(tip()).toHaveText(text);
  expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  const box = await page.evaluate(() => {
    const r = document.getElementById('icon-tooltip').getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight };
  });
  expect(box.l).toBeGreaterThanOrEqual(0);
  expect(box.t).toBeGreaterThanOrEqual(0);
  expect(box.r).toBeLessThanOrEqual(box.w);
  expect(box.b).toBeLessThanOrEqual(box.h);
  return box;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await trayEnter();
  await setNow('2026-11-18T10:00:00');
  await useStyle('coder');
  await expect(page.locator('#almanac-style-name')).toHaveText('程序猿黄历');
});

test.afterAll(async () => {
  if (app) {
    await page.evaluate(() => window.lanli.setAlmanacStyle('lunar')).catch(() => {});
    await setNow(null).catch(() => {});
    await app.close();
  }
});

function tagColors() {
  return page.evaluate(() => {
    const card = document.getElementById('almanac-card');
    const probe = document.createElement('span');
    document.body.append(probe);
    const accentVar = getComputedStyle(card).getPropertyValue('--almanac-accent-light').trim();
    probe.style.color = accentVar || 'var(--accent)';
    const expected = getComputedStyle(probe).color;
    probe.remove();
    const qian = document.querySelector('.almanac-tag-qian');
    const yi = document.querySelector('.almanac-tag-yi');
    const q = qian.getBoundingClientRect();
    const y = yi.getBoundingClientRect();
    return {
      bg: getComputedStyle(qian).backgroundColor,
      color: getComputedStyle(qian).color,
      expected,
      size: [q.width, q.height, y.width, y.height]
    };
  });
}

test('C1 无「签」标签，宜忌与签之间有 1px 分割线，签筒按钮 24px 用风格主色', async () => {
  const m = await page.evaluate(() => {
    const btn = document.getElementById('almanac-redraw');
    const r = btn.getBoundingClientRect();
    return {
      tags: document.querySelectorAll('.almanac-tag-qian').length,
      border: getComputedStyle(document.querySelector('.almanac-quote-row')).borderTopWidth,
      color: getComputedStyle(btn).color,
      size: [r.width, r.height],
      label: btn.getAttribute('aria-label')
    };
  });
  expect(m.tags).toBe(0);
  expect(m.border).toBe('1px');
  expect(m.color).toBe('rgb(112, 72, 232)');
  expect(m.size).toEqual([24, 24]);
  expect(m.label).toBe('重新抽签');
});

test('C11 点签筒：签语换成本风格 12 句里不同的一句，宜忌不变，详情不打开', async () => {
  const before = await page.evaluate(() => ({
    quote: document.getElementById('almanac-quote').textContent,
    yi: document.getElementById('almanac-focus-yi').textContent,
    ji: document.getElementById('almanac-focus-ji').textContent
  }));
  for (let i = 0; i < 3; i += 1) {
    const prev = await page.locator('#almanac-quote').textContent();
    await page.click('#almanac-redraw');
    const after = await page.evaluate(() => ({
      quote: document.getElementById('almanac-quote').textContent,
      pool: lastAlmanac.quotePool,
      yi: document.getElementById('almanac-focus-yi').textContent,
      ji: document.getElementById('almanac-focus-ji').textContent
    }));
    expect(after.pool.length).toBe(12);
    expect(after.pool).toContain(after.quote);
    expect(after.quote).not.toBe(prev);
    expect(after.yi).toBe(before.yi);
    expect(after.ji).toBe(before.ji);
  }
});

test('C12 换日期后签语回到那天的默认签语', async () => {
  await page.click('#almanac-redraw');
  await page.click('#next-month');
  await page.locator('.cell[aria-label^="2026年12月2日 "]').click();
  const m = await page.evaluate(() => ({
    shown: document.getElementById('almanac-quote').textContent,
    expected: lastAlmanac.quote
  }));
  expect(m.shown).toBe(m.expected);
  await page.click('#today-button');
});

test('C13 最长签语两行内完整显示，右栏不超出窗口', async () => {
  const m = await page.evaluate(() => {
    const el = document.getElementById('almanac-quote');
    const old = el.textContent;
    el.textContent = '春种秋收 宜收不宜放';
    const fits = el.scrollHeight <= el.clientHeight + 1;
    el.textContent = old;
    return { fits, over: document.documentElement.scrollHeight - window.innerHeight };
  });
  expect(m.fits).toBe(true);
  expect(m.over).toBeLessThanOrEqual(0);
});

test('C3 年月标题后有下拉箭头（0.1.54 起为 SVG）；标题、左右箭头、今天分别出气泡', async () => {
  await expect(page.locator('svg.month-title-caret')).toBeVisible();
  await hoverAndTip('.month-title', '选择年份');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.month-title')).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  await hoverAndTip('#prev-month', '上个月');
  await hoverAndTip('#next-month', '下个月');
  await hoverAndTip('#today-button', '回到今天');
  await page.mouse.move(300, 300);
});

test('C7 焦点词悬停不含「（原词）」；农历风格不变', async () => {
  const titles = await page.evaluate(() => ({
    yiTitle: document.getElementById('almanac-focus-yi').title,
    jiTitle: document.getElementById('almanac-focus-ji').title
  }));
  for (const text of [titles.yiTitle, titles.jiTitle]) {
    expect(text.includes('（')).toBe(false);
  }

  await useStyle('lunar');
  const lunar = await page.evaluate(() => {
    const el = document.getElementById('almanac-focus-yi');
    return { text: el.textContent, title: el.title };
  });
  expect(lunar.title).toBe(lunar.text);
  await useStyle('coder');
});

test('C8 「健身党 · 冬月廿三 ›」一行显示不截断', async () => {
  await useStyle('fitness');
  await page.click('#next-month');
  await expect(page.locator('#month-title')).toHaveText('2026年12月');
  await page.locator('.cell[aria-label^="2026年12月31日 "]').click();
  const name = page.locator('#almanac-style-name');
  await expect(name).toHaveText('健身党 · 冬月廿三');
  await page.mouse.move(300, 300);
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const el = document.getElementById('almanac-style-name');
    const r = el.getBoundingClientRect();
    const head = el.parentElement.getBoundingClientRect();
    return { scroll: el.scrollWidth, client: el.clientWidth, h: r.height, right: r.right, headRight: head.right,
      lh: parseFloat(getComputedStyle(el).fontSize) * 1.6 };
  });
  expect(m.scroll).toBeLessThanOrEqual(m.client);
  expect(m.h).toBeLessThanOrEqual(m.lh);
  expect(m.right).toBeLessThanOrEqual(m.headRight + 0.5);
  await page.screenshot({ path: path.join(SHOTS, '22-hints-0130-longest.png') });
  await page.click('#today-button');
  await useStyle('coder');
});

test('C10 选中非今天时悬停不显示「去定制 ›」、标题完整；回到今天后照旧显示', async () => {
  await useStyle('fitness');
  await page.click('#next-month');
  await expect(page.locator('#month-title')).toHaveText('2026年12月');
  await page.locator('.cell[aria-label^="2026年12月31日 "]').click();
  await expect(page.locator('#almanac-style-name')).toHaveText('健身党 · 冬月廿三');
  await page.mouse.move(300, 300);
  await page.hover('#almanac-quote');
  await page.waitForTimeout(1000);
  const dated = await page.evaluate(() => {
    const el = document.getElementById('almanac-style-name');
    const btn = document.getElementById('almanac-customize');
    return { scroll: el.scrollWidth, client: el.clientWidth, opacity: getComputedStyle(btn).opacity,
      visibility: getComputedStyle(btn).visibility };
  });
  expect(dated.scroll).toBeLessThanOrEqual(dated.client);
  expect(dated.opacity).toBe('0');
  expect(dated.visibility).toBe('hidden');

  await page.click('#today-button');
  await expect(page.locator('#almanac-style-name')).toHaveText('健身党黄历');
  await page.mouse.move(300, 300);
  await page.hover('#almanac-quote');
  await expect.poll(() => page.evaluate(() =>
    getComputedStyle(document.getElementById('almanac-customize')).opacity)).toBe('1');
  await page.mouse.move(300, 300);
  await useStyle('coder');
});
