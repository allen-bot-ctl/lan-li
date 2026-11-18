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
  await page.mouse.move(300, 300);
  await page.waitForTimeout(50);
  await page.hover(selector);
  await expect(tip()).toBeVisible({ timeout: 600 });
  await expect(tip()).toHaveText(text);
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

test('C1 程序猿与农历风格下「签」是风格主色实底白字，与「宜」等大', async () => {
  const coder = await tagColors();
  expect(coder.bg).toBe('rgb(112, 72, 232)');
  expect(coder.color).toBe('rgb(255, 255, 255)');
  expect(coder.size[0]).toBe(coder.size[2]);
  expect(coder.size[1]).toBe(coder.size[3]);

  await useStyle('lunar');
  const lunar = await tagColors();
  expect(lunar.bg).toBe(lunar.expected);
  expect(lunar.color).toBe('rgb(255, 255, 255)');
  await useStyle('coder');
});

test('C2 标题末尾有「›」；悬停卡片变 --chip-hover，600ms 内出「查看黄历详情」且在窗口内', async () => {
  const after = await page.evaluate(() =>
    getComputedStyle(document.getElementById('almanac-style-name'), '::after').content);
  expect(after).toBe('"›"');
  const box = await hoverAndTip('#almanac-quote', '查看黄历详情');
  const card = await page.evaluate(() => {
    const el = document.getElementById('almanac-card');
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.backgroundColor = 'var(--chip-hover)';
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const r = el.getBoundingClientRect();
    return { bg: getComputedStyle(el).backgroundColor, expected, cursor: getComputedStyle(el).cursor, top: r.top };
  });
  expect(card.bg).toBe(card.expected);
  expect(card.cursor).toBe('pointer');
  expect(box.b).toBeLessThanOrEqual(card.top + 1);
  await page.screenshot({ path: path.join(SHOTS, '21-hints-0130-card.png') });
});

test('C3 年月标题后有「⌄」；标题、左右箭头、今天分别出气泡', async () => {
  await expect(page.locator('.month-title-caret')).toHaveText('⌄');
  await hoverAndTip('.month-title', '选择年份');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.month-title')).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  await hoverAndTip('#prev-month', '上个月');
  await hoverAndTip('#next-month', '下个月');
  await hoverAndTip('#today-button', '回到今天');
  await page.mouse.move(300, 300);
});

test('C7 程序猿风格详情的焦点与宜忌、焦点词悬停不含「（原词）」；农历风格不变', async () => {
  await page.click('#almanac-quote');
  await expect(page.locator('#almanac-detail')).toBeVisible();
  const sections = await page.evaluate(() => {
    const out = {};
    const heads = document.querySelectorAll('#almanac-detail-body .almanac-detail-heading');
    for (const h of heads) out[h.textContent] = h.nextElementSibling.textContent;
    return {
      out,
      yiTitle: document.getElementById('almanac-focus-yi').title,
      jiTitle: document.getElementById('almanac-focus-ji').title
    };
  });
  const keys = Object.keys(sections.out);
  const focus = sections.out['今日焦点'];
  const yi = sections.out[keys.find((k) => k.startsWith('宜（'))];
  const ji = sections.out[keys.find((k) => k.startsWith('忌（'))];
  for (const text of [focus, yi, ji, sections.yiTitle, sections.jiTitle]) {
    expect(text.includes('（')).toBe(false);
  }
  await page.click('#almanac-detail-close');

  await useStyle('lunar');
  const lunar = await page.evaluate(() => {
    const el = document.getElementById('almanac-focus-yi');
    return { text: el.textContent, title: el.title };
  });
  expect(lunar.title).toBe(lunar.text);
  await useStyle('coder');
});

test('C8 「健身党 · 12月31日 ›」一行显示不截断', async () => {
  await useStyle('fitness');
  await page.click('#next-month');
  await expect(page.locator('#month-title')).toHaveText('2026年12月');
  await page.locator('.cell[aria-label^="2026年12月31日 "]').click();
  const name = page.locator('#almanac-style-name');
  await expect(name).toHaveText('健身党 · 12月31日');
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
