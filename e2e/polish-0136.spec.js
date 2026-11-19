'use strict';

// 0.1.36 验收 C1–C4（C5 = 全量单测与 e2e）。期望值在测试里计算。
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

const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });

async function openSettings(tab) {
  await hook('trayEnter');
  if (await page.locator('#settings-view').isHidden()) {
    await page.click('#settings-button');
    await expect.poll(() => hook('clickSettingsMenuItem', 'more-settings'), { timeout: 5000 }).toBe(true);
    await hook('closeSettingsMenu');
  }
  await expect(page.locator('#settings-view')).toBeVisible();
  if (tab) await page.click(`.settings-tab[data-tab="${tab}"]`);
}

async function backToCalendar() {
  if (await page.locator('#settings-view').isVisible()) await page.click('#settings-back');
  await expect(page.locator('#settings-view')).toBeHidden();
}

function textCenterY(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      rects.push(...r.getClientRects());
    }
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return (top + bottom) / 2;
  }, selector);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await hook('trayEnter');
});

test.afterAll(async () => {
  if (!app) return;
  await page.emulateMedia({ colorScheme: null }).catch(() => {});
  await page.evaluate(() => window.lanli.setCity(null)).catch(() => {});
  await app.close();
});

test('C1 左栏分割线与右侧标题下线同一高度，「‹ 返回」与页标题文字中心对齐（浅/深色各截图）', async () => {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openSettings('ui');
    const lines = await page.evaluate(() => {
      const divider = document.querySelector('.settings-nav-divider').getBoundingClientRect();
      const title = document.getElementById('settings-page-title').getBoundingClientRect();
      const nav = document.querySelector('.settings-nav').getBoundingClientRect();
      const bw = parseFloat(getComputedStyle(document.getElementById('settings-page-title')).borderBottomWidth);
      return {
        dividerY: divider.top, titleLineY: title.bottom - bw,
        dividerLeft: divider.left, dividerRight: divider.right, navLeft: nav.left, navRight: nav.right,
        backSize: getComputedStyle(document.getElementById('settings-back')).fontSize,
        backWeight: Number(getComputedStyle(document.getElementById('settings-back')).fontWeight)
      };
    });
    const backY = await textCenterY('#settings-back');
    const titleY = await textCenterY('#settings-page-title');
    console.log(`C1 ${scheme}: dividerY=${lines.dividerY} titleLineY=${lines.titleLineY} backTextY=${backY} titleTextY=${titleY}`);
    expect(Math.abs(lines.dividerY - lines.titleLineY)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(backY - titleY)).toBeLessThanOrEqual(1);
    expect(lines.dividerLeft).toBeLessThanOrEqual(lines.navLeft + 0.5);
    expect(lines.backSize).toBe('15px');
    const lefts = await page.evaluate(() => {
      const textLeft = (el) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
        const n = w.nextNode(); const r = document.createRange();
        const i = n.textContent.search(/\S/); r.setStart(n, i); r.setEnd(n, i + 1);
        return r.getBoundingClientRect().left;
      };
      return { back: textLeft(document.getElementById('settings-back')), tab: textLeft(document.querySelector('.settings-tab')) };
    });
    console.log(`C1 ${scheme}: backTextLeft=${lefts.back} tabTextLeft=${lefts.tab}`);
    expect(Math.abs(lefts.back - lefts.tab)).toBeLessThanOrEqual(0.5);
    expect(lines.backWeight).toBeGreaterThanOrEqual(600);
    await page.screenshot({ path: path.join(SHOTS, `30-settings-0136-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
  await backToCalendar();
});

test('C2 设置视图里 ⚙ display:none，最右图标右边距等于主界面 ⚙ 胶囊右边距', async () => {
  await hook('trayEnter');
  await backToCalendar();
  const mainGap = await page.evaluate(() =>
    window.innerWidth - document.getElementById('settings-button').getBoundingClientRect().right);
  await openSettings('ui');
  const m = await page.evaluate(() => {
    const right = document.querySelector('.topbar-right');
    const visible = [...right.children].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
    const last = visible.reduce((a, b) => (a.getBoundingClientRect().right > b.getBoundingClientRect().right ? a : b));
    return {
      display: getComputedStyle(document.getElementById('settings-button')).display,
      lastId: last.id,
      gap: window.innerWidth - last.getBoundingClientRect().right
    };
  });
  console.log(`C2: display=${m.display} last=${m.lastId} settingsGap=${m.gap} mainGap=${mainGap}`);
  expect(m.display).toBe('none');
  expect(Math.abs(m.gap - mainGap)).toBeLessThanOrEqual(1);
  await backToCalendar();
});

test('C3 长城市名加 .is-compact 隐藏区间且完整显示；北京照常显示区间', async () => {
  await hook('trayEnter');
  const measure = (city) => page.evaluate((name) => {
    renderWeather({ ok: true, temperature: 18, city: name, weather: '晴', emoji: '☀️', rangeText: '14°~20°' });
    const card = document.getElementById('weather-card');
    const cityEl = document.getElementById('weather-city');
    const range = document.getElementById('weather-range');
    return {
      compact: card.classList.contains('is-compact'),
      rangeShown: getComputedStyle(range).display !== 'none' && range.getBoundingClientRect().width > 0,
      sw: cityEl.scrollWidth, cw: cityEl.clientWidth, text: cityEl.textContent
    };
  }, city);
  const la = await measure('Los Angeles');
  console.log(`C3 LA: ${JSON.stringify(la)}`);
  expect(la.compact).toBe(true);
  expect(la.rangeShown).toBe(false);
  expect(la.sw).toBeLessThanOrEqual(la.cw);
  expect(la.text).toBe('Los Angeles');
  const bj = await measure('北京');
  console.log(`C3 北京: ${JSON.stringify(bj)}`);
  expect(bj.compact).toBe(false);
  expect(bj.rangeShown).toBe(true);
});

test('C4 天气设置页：当前城市行 is-selected + ✓、可点；无手动城市时「自动」行选中且与搜索框左对齐', async () => {
  const readRows = () => page.evaluate(() => [...document.querySelectorAll('#weather-list .picker-item')].map((b) => ({
    text: b.textContent, selected: b.classList.contains('is-selected'), disabled: b.disabled,
    check: Boolean(b.querySelector('.picker-check')) && b.textContent.includes('✓'),
    left: b.getBoundingClientRect().left
  })));

  // 手动城市：从常用城市里选第一个非自动城市
  await page.evaluate(() => window.lanli.setCity(null));
  await openSettings('weather');
  const firstCity = page.locator('#weather-list .picker-item').nth(1);
  await expect(firstCity).toBeVisible({ timeout: 15000 });
  const quick = await page.evaluate(() => window.lanli.getQuickCities());
  expect(quick.cities.length).toBeGreaterThan(0);
  await page.evaluate((c) => window.lanli.setCity({
    name: c.name, latitude: c.latitude, longitude: c.longitude, country: c.country, admin1: c.admin1
  }), quick.cities[0]);
  await page.click('.settings-tab[data-tab="ui"]');
  await page.click('.settings-tab[data-tab="weather"]');
  await expect.poll(async () => (await readRows()).some((r) => r.selected && !r.text.startsWith('自动'))).toBe(true);
  let rows = await readRows();
  const cur = rows.find((r) => r.selected);
  expect(cur.text.startsWith(quick.cities[0].label)).toBe(true);
  expect(cur.check).toBe(true);
  expect(cur.disabled).toBe(false);
  expect(rows.some((r) => r.text.includes('已选'))).toBe(false);
  expect(rows.filter((r) => r.selected).length).toBe(1);
  const bg = await page.evaluate(() => {
    const sel = document.querySelector('#weather-list .picker-item.is-selected');
    const other = document.querySelector('#weather-list .picker-item:not(.is-selected)');
    return [getComputedStyle(sel).backgroundColor, getComputedStyle(other).backgroundColor];
  });
  expect(bg[0]).not.toBe(bg[1]);

  // 自动：恢复后「自动（按 IP）」行选中，左边缘与搜索框对齐
  await page.evaluate(() => window.lanli.setCity(null));
  await page.click('.settings-tab[data-tab="ui"]');
  await page.click('.settings-tab[data-tab="weather"]');
  await expect.poll(async () => (await readRows())[0] && (await readRows())[0].selected).toBe(true);
  rows = await readRows();
  expect(rows[0].text.startsWith('自动')).toBe(true);
  expect(rows[0].check).toBe(true);
  expect(rows[0].disabled).toBe(false);
  const searchLeft = await page.evaluate(() => document.getElementById('weather-search').getBoundingClientRect().left);
  console.log(`C4: autoLeft=${rows[0].left} searchLeft=${searchLeft} selectedCity=${cur.text}`);
  expect(Math.abs(rows[0].left - searchLeft)).toBeLessThanOrEqual(1);
  await backToCalendar();
});
