'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

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
const trayTitle = () => mainEval(() => globalThis.__lanliTest.trayTitle());
const trayTooltip = () => mainEval(() => globalThis.__lanliTest.trayTooltip());
const loginItemCalls = () => mainEval(() => globalThis.__lanliTest.loginItemCalls());
const menuBarZone = () => mainEval(() => globalThis.__lanliTest.menuBarZone());
const settingsMenuItems = () => mainEval(() => globalThis.__lanliTest.settingsMenuItems());
const hideWindow = () => mainEval(() => globalThis.__lanliTest.hideWindow());
const closeSettingsMenu = () => mainEval(() => globalThis.__lanliTest.closeSettingsMenu());

async function launchApp() {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
}

async function openMore() {
  // 先确保窗口可见（前面的 spec 可能留下指针在窗外，窗口会被自动隐藏）。
  await trayEnter();
  await page.click('#settings-button');
  // 原生菜单 popup 是异步建立的；轮询到菜单项真正点上为止（偶发 flaky 修复）。
  await expect.poll(() => mainEval(() => globalThis.__lanliTest.clickSettingsMenuItem('more-settings')), { timeout: 5000 }).toBe(true);
  await closeSettingsMenu();
  await expect(page.locator('#settings-view')).toBeVisible();
}

function hmsOf(zone, iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date(iso));
}

function datePartsOf(zone, iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short'
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return { Y: get('year'), M: get('month'), D: get('day'), weekday: get('weekday') };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await launchApp();
});

test.afterAll(async () => {
  try {
    await page.evaluate(() => window.lanli.setMenuBarShowDate(true));
  } catch {}
  try {
    await setNow(null);
  } catch {}
  if (app) await app.close().catch(() => {});
});

test('C1 settings menu labels and view open', async () => {
  const items = await settingsMenuItems();
  const moreIdx = items.findIndex((i) => i.id === 'more-settings');
  expect(moreIdx).toBeGreaterThanOrEqual(0);
  expect(items[moreIdx].label).toBe('全部设置…');
  expect(items[moreIdx + 1].type).toBe('separator');
  expect(items[moreIdx + 2].id).toBe('quit');
  const login = items.find((i) => i.id === 'open-at-login');
  expect(login.label).toBe('开机自启动');
  expect(items.some((i) => i.label === '登录时打开')).toBe(false);

  await openMore();
  await expect(page.locator('#settings-view')).toBeVisible();
  await expect(page.locator('.app-body')).toBeHidden();
  const size = await mainEval(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  expect(size).toEqual([580, 432]);
});

test('C2 default tab is ui', async () => {
  const tabs = await page.locator('.settings-tab').allTextContents();
  expect(tabs).toEqual(['界面设置', '黄历', '天气', '世界时钟', '升级']);
  const selected = await page.locator('.settings-tab.is-selected').allTextContents();
  expect(selected).toEqual(['界面设置']);
  await expect(page.locator('#settings-page-ui')).toBeVisible();
});

test('C3 open-at-login toggle', async () => {
  const before = (await loginItemCalls()).length;
  await page.click('label.settings-row:has(#setting-open-at-login)');
  await expect.poll(async () => {
    const calls = await loginItemCalls();
    return calls.length > before ? calls[calls.length - 1].openAtLogin : null;
  }).toBe(true);
  let items = await settingsMenuItems();
  expect(items.find((i) => i.id === 'open-at-login').checked).toBe(true);

  await page.click('label.settings-row:has(#setting-open-at-login)');
  await expect.poll(async () => {
    const calls = await loginItemCalls();
    return calls.length > before + 1 ? calls[calls.length - 1].openAtLogin : null;
  }).toBe(false);
  items = await settingsMenuItems();
  expect(items.find((i) => i.id === 'open-at-login').checked).toBe(false);
});

test('C4 menu bar show date', async () => {
  const iso = '2026-11-18T23:30:05Z';
  await setNow(iso);
  const zone = await menuBarZone();
  const hms = hmsOf(zone, iso);
  const { Y, M, D, weekday } = datePartsOf(zone, iso);
  const withDate = `${M}月${D}日 ${hms}`;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const tooltip = `${Y}年${M}月${D}日 周${'日一二三四五六'[weekdayIndex]}`;

  expect(hms).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  await expect.poll(() => trayTitle()).toBe(withDate);

  await page.click('label.settings-row:has(#setting-show-date)');
  await expect.poll(() => trayTitle()).toBe(hms);
  await expect.poll(() => trayTitle()).toMatch(/^\d{2}:\d{2}:\d{2}$/);

  const readPrefs = async () => {
    const userData = await mainEval(({ app: a }) => a.getPath('userData'));
    return JSON.parse(fs.readFileSync(path.join(userData, 'preferences.json'), 'utf8'));
  };
  await expect.poll(async () => (await readPrefs()).menuBarShowDate).toBe(false);

  await app.close();
  await launchApp();
  await setNow(iso);
  await expect.poll(() => trayTitle()).toBe(hms);

  await trayEnter();
  await openMore();
  await page.click('label.settings-row:has(#setting-show-date)');
  await expect.poll(() => trayTitle()).toBe(withDate);
  await expect.poll(async () => (await readPrefs()).menuBarShowDate).toBe(true);
  expect(await trayTooltip()).toBe(tooltip);
});

test('C5 almanac style via embedded picker', async () => {
  const rows = await page.evaluate(() => window.lanli.getAlmanacStyles());
  const current = rows.find((r) => r.selected) || rows[0];
  const other = rows.find((r) => r !== current && !r.selected) || rows.find((r) => r.id !== current.id);
  const origName = await page.locator('#almanac-style-name').textContent();
  expect(origName).toBeTruthy();

  await page.click('.settings-tab[data-tab="almanac"]');
  await expect(page.locator('#almanac-style-list button').first()).toBeVisible();
  await page.locator('#almanac-style-list button').filter({ hasText: other.name }).first().click();
  await page.click('#settings-back');
  await expect(page.locator('#almanac-style-name')).toHaveText(other.name);

  await page.evaluate((id) => window.lanli.setAlmanacStyle(id), current.id);
});

test('C5 world clock via embedded picker', async () => {
  const before = await page.evaluate(() => window.lanli.getState());
  const beforeItems = Array.isArray(before.clocks && before.clocks.items) ? before.clocks.items : [];
  const n = beforeItems.length;
  const existing = beforeItems.map((c) => String(c.label || c.name || c.city || ''));
  const query = existing.some((s) => /tokyo/i.test(s)) ? 'Paris' : 'Tokyo';

  await openMore();
  await page.click('.settings-tab[data-tab="clocks"]');
  await page.fill('#clock-search', query);
  await expect(page.locator('#clock-search-results button').first()).toBeVisible();
  await page.locator('#clock-search-results button').first().click();
  await page.click('#settings-back');
  await expect.poll(async () => page.locator('#clock-list > *').count()).toBe(n + 1);

  const after = await page.evaluate(() => window.lanli.getState());
  const afterItems = Array.isArray(after.clocks && after.clocks.items) ? after.clocks.items : [];
  const added = afterItems.find((c) => !beforeItems.some((o) => o.id === c.id));
  expect(added).toBeTruthy();
  await page.evaluate((id) => window.lanli.removeClock({ id }), added.id);
});

test('C5 weather city via embedded picker', async () => {
  await openMore();
  await page.click('.settings-tab[data-tab="weather"]');
  // 第 1 个是「自动」；已选中的城市按钮是 disabled，取第一个可点的非自动城市。
  const choices = page.locator('#weather-list button:not([disabled])');
  await expect.poll(async () => choices.count()).toBeGreaterThanOrEqual(2);
  const btn = choices.nth(1);
  const raw = (await btn.innerText()) || '';
  const cityName = raw.split('\n')[0].trim().split(' · ')[0].trim();
  expect(cityName).toBeTruthy();
  await btn.click();
  await page.click('#settings-back');
  try {
    await expect(page.locator('#weather-city')).toContainText(cityName);
  } finally {
    await page.evaluate(() => window.lanli.setCity(null));
  }
});

test('C6 update page shows version and check', async () => {
  await openMore();
  await page.click('.settings-tab[data-tab="update"]');
  const shown = await page.locator('#settings-version').textContent();
  const ver = await mainEval(({ app: a }) => a.getVersion());
  expect(shown).toBe(ver);
  await page.click('#settings-check-update');
  await expect(page.locator('#toast')).toBeVisible();
});

test('C7 back / Escape / hide-return leave settings', async () => {
  if (await page.locator('#settings-view').isHidden()) await openMore();
  await page.click('#settings-back');
  await expect(page.locator('#settings-view')).toBeHidden();
  await expect(page.locator('.app-body')).toBeVisible();

  await openMore();
  // 与 pin-and-polish C4 相同：用原生输入事件，确保走真实的 before-input-event Esc 处理。
  await mainEval(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  });
  await expect(page.locator('#settings-view')).toBeHidden();
  await expect(page.locator('.app-body')).toBeVisible();
  expect(await mainEval(() => globalThis.__lanliTest.isVisible())).toBe(true);

  await openMore();
  await hideWindow();
  await trayEnter();
  await expect(page.locator('#settings-view')).toBeHidden();
  await expect(page.locator('.app-body')).toBeVisible();
});
