'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const SHOTS = path.join(__dirname, 'screenshots');
const LONGEST_SUBTITLE_MONTH = { year: 2025, month: 7 };
// One-off scan (every day from 1900-01-01 through 2100-12-31) of
// `${ganZhiText} · ${lunarMonthText}` found the maximum rendered width at
// 10 characters, shared by 148 Gregorian months that contain a leap lunar
// month. 2025-07 is one of them; its subtitle is 「乙巳蛇年 · 闰六月」.
// No other generated subtitle is wider than this one.
const LONGEST_SUBTITLE = '乙巳蛇年 · 闰六月';

let app = null;
let page = null;

async function mainEval(fn) {
  // Electron's main-process evaluate occasionally races the window show/hide
  // transition on Linux; retry only that transient error.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await app.evaluate(fn);
    } catch (error) {
      if (attempt >= 2 || !/garbage collected/.test(String(error))) throw error;
      await page.waitForTimeout(150);
    }
  }
}

async function trayEnter() {
  return mainEval(() => globalThis.__lanliTest.trayEnter());
}

async function trayLeave() {
  return mainEval(() => globalThis.__lanliTest.trayLeave());
}

async function isVisible() {
  return mainEval(() => globalThis.__lanliTest.isVisible());
}

async function isPinned() {
  return mainEval(() => globalThis.__lanliTest.isPinned());
}

async function blurWindow() {
  return mainEval(() => globalThis.__lanliTest.blur());
}

async function showUnpinned() {
  // A previous test may have left the window pinned; unpinning also hides it.
  if (await isPinned()) {
    await page.click('#pin-button');
    await page.waitForTimeout(100);
  }
  await trayEnter();
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '钉住窗口');
  // Leave the pointer on a neutral spot so a later hover always produces a
  // fresh mouseenter, even when the previous test ended on the pin itself.
  await page.mouse.move(6, 220);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({
    args,
    env: { ...process.env, LANLI_E2E: '1' }
  });
  page = await app.firstWindow();
  await page.waitForSelector('#pin-button');
  await page.waitForSelector('#lunar-subtitle');
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('C1 未钉住时托盘 mouse-leave 后窗口隐藏', async () => {
  await showUnpinned();
  expect(await isVisible()).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '01-unpinned.png') });

  await trayLeave();
  await page.waitForTimeout(400);
  expect(await isVisible()).toBe(false);
});

test('C2 钉住后忽略托盘离开与失焦，1 秒后仍可见', async () => {
  await showUnpinned();
  await page.click('#pin-button');
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '取消钉住并关闭');
  expect(await isPinned()).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '02-pinned.png') });

  await trayLeave();
  await blurWindow();
  await page.waitForTimeout(1000);

  expect(await isVisible()).toBe(true);
  expect(await isPinned()).toBe(true);
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '取消钉住并关闭');
});

test('C3 已钉住点 × 隐藏，再悬停托盘恢复未钉住', async () => {
  await showUnpinned();
  await page.click('#pin-button');
  expect(await isPinned()).toBe(true);

  await page.click('#pin-button');
  await page.waitForTimeout(100);
  expect(await isVisible()).toBe(false);
  expect(await isPinned()).toBe(false);

  await trayEnter();
  expect(await isVisible()).toBe(true);
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '钉住窗口');
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-pressed', 'false');
});

test('C4 已钉住按 Esc 隐藏并回到未钉住', async () => {
  await showUnpinned();
  await page.click('#pin-button');
  expect(await isPinned()).toBe(true);

  // Playwright's CDP key events bypass Electron's before-input-event on some
  // platforms; send a native input event so the real Esc handler runs.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  });
  await page.waitForTimeout(100);
  expect(await isVisible()).toBe(false);
  expect(await isPinned()).toBe(false);

  await trayEnter();
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '钉住窗口');
});

test('C5 悬停 600ms 内出现页内气泡，文案正确且完全在窗口内', async () => {
  await showUnpinned();
  const tip = page.locator('#pin-tooltip');
  await expect(tip).toBeHidden();

  await page.hover('#pin-button');
  await page.waitForTimeout(600);

  await expect(tip).toBeVisible();
  await expect(tip).toHaveText('钉住窗口，移开鼠标也不隐藏');
  const fontSize = await tip.evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('11px');

  const button = await page.locator('#pin-button').boundingBox();
  const box = await tip.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
  // Right edges are aligned, as the contract asks.
  expect(Math.abs((box.x + box.width) - (button.x + button.width))).toBeLessThan(1.5);

  await page.screenshot({ path: path.join(SHOTS, '03-pin-tooltip.png') });
});

test('C6 最长闰月副标题不省略、顶栏单行且按钮不重叠', async () => {
  await showUnpinned();
  // Drive the real year selector and month arrows: 2026-11 → 2025-11 → 2025-07.
  await page.selectOption('#year-select', String(LONGEST_SUBTITLE_MONTH.year));
  await expect(page.locator('#month-title')).toHaveText(
    `${LONGEST_SUBTITLE_MONTH.year}年11月`
  );
  for (let month = 11; month > LONGEST_SUBTITLE_MONTH.month; month -= 1) {
    await page.click('#prev-month');
  }
  await expect(page.locator('#month-title')).toHaveText(
    `${LONGEST_SUBTITLE_MONTH.year}年${LONGEST_SUBTITLE_MONTH.month}月`
  );
  await page.evaluate((text) => {
    document.getElementById('lunar-subtitle').textContent = text;
  }, LONGEST_SUBTITLE);

  const metrics = await page.evaluate(() => {
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const overlaps = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

    const toolbar = document.querySelector('.toolbar');
    const toolbarRect = rectOf(toolbar);
    const title = document.getElementById('month-title');
    const subtitle = document.getElementById('lunar-subtitle');
    const nav = document.querySelector('.month-nav');
    const titleGroup = document.querySelector('.title-group');
    const buttons = [...nav.querySelectorAll('button')];
    const items = [titleGroup, ...buttons].map(rectOf);

    const buttonOverlaps = [];
    for (let i = 0; i < buttons.length; i += 1) {
      for (let j = i + 1; j < buttons.length; j += 1) {
        if (overlaps(rectOf(buttons[i]), rectOf(buttons[j]))) {
          buttonOverlaps.push(`${buttons[i].id}/${buttons[j].id}`);
        }
      }
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      titleText: document.getElementById('month-title').textContent,
      subtitleText: subtitle.textContent,
      subtitleScroll: subtitle.scrollWidth,
      subtitleClient: subtitle.clientWidth,
      titleScroll: title.scrollWidth,
      titleClient: title.clientWidth,
      toolbarScrollHeight: toolbar.scrollHeight,
      toolbarClientHeight: toolbar.clientHeight,
      toolbarRect,
      titleRect: rectOf(title),
      subtitleRect: rectOf(subtitle),
      navRect: rectOf(nav),
      titleGroupRect: rectOf(titleGroup),
      titleGroupOverlapsNav: overlaps(rectOf(titleGroup), rectOf(nav)),
      buttonOverlaps,
      singleLine: items.every((r) =>
        r.top >= toolbarRect.top - 1 && r.bottom <= toolbarRect.bottom + 1),
      insideWindow: items.every((r) =>
        r.left >= -0.5 && r.right <= window.innerWidth + 0.5)
    };
  });

  expect(metrics.titleText).toBe('2025年7月');
  expect(metrics.subtitleText).toBe(LONGEST_SUBTITLE);
  expect(metrics.subtitleScroll).toBeLessThanOrEqual(metrics.subtitleClient);
  expect(metrics.titleScroll).toBeLessThanOrEqual(metrics.titleClient);
  expect(metrics.toolbarScrollHeight).toBeLessThanOrEqual(metrics.toolbarClientHeight + 1);
  expect(metrics.singleLine).toBe(true);
  expect(metrics.insideWindow).toBe(true);
  expect(metrics.buttonOverlaps).toEqual([]);
  expect(metrics.titleGroupOverlapsNav).toBe(false);
  // The subtitle must have real room, not an ellipsis with zero width.
  expect(metrics.subtitleRect.width).toBeGreaterThan(0);

  await page.screenshot({ path: path.join(SHOTS, '07-longest-subtitle.png') });
});

test('C8 三张卡片入口文字统一带 ›', async () => {
  await showUnpinned();
  await expect(page.locator('#almanac-customize')).toHaveText('去定制 ›');
  await expect(page.locator('#clock-edit')).toHaveText('编辑 ›');
  await expect(page.locator('.weather-change')).toHaveText('更换 ›');

  await page.hover('.almanac-card');
  await page.locator('.almanac-card').screenshot({
    path: path.join(SHOTS, '04-almanac-card.png')
  });

  await page.hover('.world-clock-card');
  await page.locator('.world-clock-card').screenshot({
    path: path.join(SHOTS, '05-clock-hover.png')
  });

  await page.locator('.pane-footer').screenshot({
    path: path.join(SHOTS, '06-footer-version.png')
  });
});

test('C9 检查更新与版本号同为 10px，颜色 --muted，悬停 --link', async () => {
  await showUnpinned();
  const styles = await page.evaluate(() => {
    const resolve = (value) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const root = getComputedStyle(document.documentElement);
    return {
      versionFont: getComputedStyle(document.getElementById('app-version')).fontSize,
      updateFont: getComputedStyle(document.getElementById('check-update')).fontSize,
      updateColor: getComputedStyle(document.getElementById('check-update')).color,
      muted: resolve(root.getPropertyValue('--muted')),
      link: resolve(root.getPropertyValue('--link'))
    };
  });

  expect(styles.versionFont).toBe('10px');
  expect(styles.updateFont).toBe('10px');
  expect(styles.updateColor).toBe(styles.muted);

  await page.hover('#check-update');
  const hoverColor = await page.locator('#check-update').evaluate(
    (el) => getComputedStyle(el).color
  );
  expect(hoverColor).toBe(styles.link);
});

test('C7 页面与代码中不再有节气倒计时', async () => {
  const present = await page.evaluate(() => ({
    countdown: document.getElementById('almanac-term-countdown') !== null,
    countdownClass: document.querySelector('.term-countdown') !== null
  }));
  expect(present.countdown).toBe(false);
  expect(present.countdownClass).toBe(false);
});
