'use strict';

// 0.1.54 W-C2 / W-C3：本机设为纽约 11/21 13:24，北京、东京跨天显示 11/22；年月下拉箭头为 SVG。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const SHOTS = path.join(__dirname, 'screenshots');
let app = null;
let page = null;
const added = [];

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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', TZ: 'America/New_York' } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await hook('trayEnter');
});

test.afterAll(async () => {
  if (!app) return;
  await hook('setNow', null).catch(() => {});
  for (const id of added) await page.evaluate((x) => window.lanli.removeClock({ id: x }), id).catch(() => {});
  await page.emulateMedia({ colorScheme: null }).catch(() => {});
  await app.close();
});

test('W-C2 本机纽约 13:24：北京、东京显示 11/22，纽约显示「本地」', async () => {
  expect(await hook('localZone')).toBe('America/New_York');
  const state = await page.evaluate(() => window.lanli.getState());
  const ids = state.clocks.items.map((c) => c.id);
  for (const [id, label] of [['Asia/Shanghai', '北京'], ['America/New_York', '纽约'], ['Asia/Tokyo', '东京']]) {
    if (!ids.includes(id)) {
      await page.evaluate((payload) => window.lanli.addClock(payload), { id, label });
      added.push(id);
    }
  }
  await hook('setNow', '2026-11-21T13:24:00');
  await page.evaluate(() => refreshState());
  const snapshot = await page.evaluate(() => window.lanli.getState());
  const subOf = async (id) => {
    const label = snapshot.clocks.items.find((c) => c.id === id).label;
    return page.evaluate((l) => {
      const row = [...document.querySelectorAll('#clock-list .clock-entry')].find((r) => r.querySelector('.clock-entry-label').textContent === l);
      return row ? row.querySelector('.clock-entry-sub').textContent : null;
    }, label);
  };
  await expect.poll(() => subOf('Asia/Shanghai')).toBe('11/22');
  expect(await subOf('Asia/Tokyo')).toBe('11/22');
  expect(await subOf('America/New_York')).toBe('本地');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `54-clock-cross-day-${scheme}.png`) });
  }
});

test('W-C3 年月箭头为 12×8 SVG，左距 6px，垂直居中于文字，未被截断；200% 截图', async () => {
  const caret = page.locator('svg.month-title-caret');
  await expect(caret).toBeVisible();
  const m = await page.evaluate(() => {
    const c = document.querySelector('.month-title-caret').getBoundingClientRect();
    const t = document.querySelector('.month-title-text').getBoundingClientRect();
    const box = document.querySelector('.month-title').getBoundingClientRect();
    return { cw: c.width, ch: c.height, gap: c.left - t.right, cMid: c.top + c.height / 2, tMid: t.top + t.height / 2,
      inside: c.top >= box.top && c.bottom <= box.bottom && c.right <= box.right };
  });
  expect(m.cw).toBeCloseTo(12, 0);
  expect(m.ch).toBeCloseTo(8, 0);
  expect(m.gap).toBeGreaterThanOrEqual(5);
  expect(m.gap).toBeLessThanOrEqual(7.5);
  expect(Math.abs(m.cMid - m.tMid)).toBeLessThanOrEqual(2.5);
  expect(m.inside).toBe(true);
  await page.evaluate(() => { document.querySelector('.toolbar').style.zoom = '2'; document.querySelector('.month-nav').style.visibility = 'hidden'; });
  try {
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, `54-month-caret-200-${scheme}.png`) });
    }
  } finally {
    await page.evaluate(() => { document.querySelector('.toolbar').style.zoom = ''; document.querySelector('.month-nav').style.visibility = ''; });
  }
});
