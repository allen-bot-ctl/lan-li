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
const emitStatus = (status) => mainEval(
  (_electron, s) => globalThis.__lanliTest.emitUpdateStatus(s), status
);
const toast = () => page.locator('#toast');

// 每个用例前清场：直接调渲染层的 hideToast()。
async function clearToast() {
  await page.evaluate(() => hideToast());
  await expect(toast()).toBeHidden();
}

// 入场动画 200ms，测量前多等 150ms。
const settle = () => page.waitForTimeout(350);

async function rects() {
  return page.evaluate(() => {
    const pick = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      grid: pick('#grid'),
      almanac: pick('.almanac-card'),
      clock: pick('.world-clock-card'),
      weather: pick('.weather-card')
    };
  });
}

function expectSameRects(actual, expected, label) {
  for (const key of Object.keys(expected)) {
    for (const prop of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(actual[key][prop] - expected[key][prop]), `${label} ${key}.${prop}`)
        .toBeLessThanOrEqual(0.5);
    }
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await trayEnter();
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('C1 检查中外圈弧旋转、箭头不动', async () => {
  await trayEnter();
  await clearToast();
  await emitStatus({ state: 'checking', label: '正在检查…', busy: true });
  await expect(page.locator('#check-update')).toHaveClass(/is-spinning/);
  const icon = await page.evaluate(() => {
    const style = (sel) => getComputedStyle(document.querySelector(sel));
    return {
      ring: Boolean(document.querySelector('#check-update circle.update-ring')),
      spinning: document.getElementById('check-update').classList.contains('is-spinning'),
      arcAnimation: style('#check-update .update-arc').animationName,
      arcDisplay: style('#check-update .update-arc').display,
      arrowAnimation: style('#check-update .update-arrow').animationName,
      iconAnimation: style('#check-update .update-icon').animationName
    };
  });
  expect(icon.ring).toBe(true);
  expect(icon.spinning).toBe(true);
  expect(icon.arcAnimation).toBe('topbar-spin');
  expect(icon.arcDisplay).not.toBe('none');
  expect(icon.arrowAnimation).toBe('none');
  expect(icon.iconAnimation).toBe('none');

  await emitStatus({ state: 'up-to-date', label: '已是最新', timed: true });
  await expect(page.locator('#check-update')).not.toHaveClass(/is-spinning/);
  await clearToast();
});

test('C2 黄历签语无「签」标签、卡上无干支冲煞，详情仍有建除 · 值神 · 冲煞', async () => {
  await trayEnter();
  const card = await page.evaluate(() => ({
    tag: document.querySelector('.almanac-quote-row .almanac-tag-qian')?.textContent,
    quoteInRow: Boolean(document.querySelector('.almanac-quote-row #almanac-quote')),
    meta: document.getElementById('almanac-meta') !== null,
    text: document.querySelector('.almanac-card').innerText
  }));
  expect(card.tag).toBeUndefined();
  expect(card.quoteInRow).toBe(true);
  expect(card.meta).toBe(false);
  expect(/冲.煞/.test(card.text)).toBe(false);

  await page.click('#almanac-focus-yi');
  await expect(page.locator('#almanac-detail')).toBeVisible();
  await expect(page.locator('#almanac-detail-body')).toContainText('建除 · 值神 · 冲煞');
  await page.click('#almanac-detail-close');
  await expect(page.locator('#almanac-detail')).toBeHidden();
});

test('C4 天气显示当前气温与区间；无区间只显示当前；最长文案不换行', async () => {
  await trayEnter();
  const base = { ok: true, weather: '多云', emoji: '⛅️', temperatureText: '', text: '' };
  // renderWeather 与测量放在同一次 evaluate 里，避免真实天气推送插队。
  const measure = (result) => page.evaluate((r) => {
    renderWeather(r);
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const range = document.getElementById('weather-range');
    return {
      temp: document.getElementById('weather-temp').textContent,
      range: range.textContent,
      rangeHidden: range.hidden,
      tempTop: box('weather-temp').top,
      rangeTop: box('weather-range').top,
      rangeRight: box('weather-range').right,
      rangeScroll: range.scrollWidth,
      rangeClient: range.clientWidth,
      cardRight: box('weather-card').right,
      cardHeight: box('weather-card').height
    };
  }, result);

  const normal = await measure({ ...base, city: '北京', temperature: 8, low: 6, high: 15, rangeText: '6°~15°' });
  expect(normal.temp).toBe('8°');
  expect(normal.range).toBe('6°~15°');
  expect(normal.rangeHidden).toBe(false);
  expect(Math.abs(normal.tempTop - normal.rangeTop)).toBeLessThanOrEqual(1);

  const noRange = await measure({ ...base, city: '北京', temperature: 8, low: null, high: null, rangeText: '' });
  expect(noRange.temp).toBe('8°');
  expect(noRange.rangeHidden).toBe(true);

  const longest = await measure({
    ...base, weather: '小雪', city: '克孜勒苏柯尔克孜自治州', temperature: -5, low: -12, high: -3, rangeText: '-12°~-3°'
  });
  expect(longest.range).toBe('-12°~-3°');
  expect(Math.abs(longest.tempTop - longest.rangeTop)).toBeLessThanOrEqual(1);
  expect(longest.rangeScroll).toBeLessThanOrEqual(longest.rangeClient);
  expect(longest.rangeRight).toBeLessThanOrEqual(longest.cardRight);
  expect(Math.abs(longest.cardHeight - normal.cardHeight)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: path.join(SHOTS, '10-cards-0129.png') });
});

