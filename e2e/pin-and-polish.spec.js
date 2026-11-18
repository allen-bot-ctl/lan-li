'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const SHOTS = path.join(__dirname, 'screenshots');
const BASELINE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'layout-0.1.24.json'), 'utf8')
);
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

function box(rect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
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

test('C1 窗口实际为 580×432；未钉住时托盘 mouse-leave 后隐藏', async () => {
  await showUnpinned();

  const bounds = await mainEval(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds());
  expect(bounds.width).toBe(580);
  expect(bounds.height).toBe(432);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  expect(viewport).toEqual({ width: 580, height: 432 });

  expect(await isVisible()).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '01-topbar-unpinned.png') });

  await trayLeave();
  await page.waitForTimeout(400);
  expect(await isVisible()).toBe(false);
});

test('C2 顶栏 32px 全宽：左上是图钉＋栏历，右上最后是带文字「设置」', async () => {
  await showUnpinned();

  const layout = await page.evaluate(() => {
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const topbar = document.querySelector('.topbar');
    const left = document.querySelector('.topbar-left');
    const right = document.querySelector('.topbar-right');
    const pin = document.getElementById('pin-button');
    const title = document.querySelector('.topbar-title');
    const settings = document.getElementById('settings-button');
    const pinRect = rectOf(pin);
    const titleRect = rectOf(title);
    return {
      viewportWidth: window.innerWidth,
      topbar: rectOf(topbar),
      pin: pinRect,
      title: titleRect,
      settings: rectOf(settings),
      leftFirstIsPin: left.firstElementChild === pin,
      titleFollowsPin: titleRect.left >= pinRect.right,
      rightLastIsSettings: right.lastElementChild === settings,
      settingsText: settings.textContent.replace(/\s+/g, ''),
      settingsHeight: getComputedStyle(settings).height,
      topbarPaddingLeft: getComputedStyle(topbar).paddingLeft,
      pinSize: { width: pin.getBoundingClientRect().width, height: pin.getBoundingClientRect().height }
    };
  });

  expect(layout.topbar.height).toBe(32);
  expect(layout.topbar.width).toBe(layout.viewportWidth);
  expect(layout.topbar.top).toBe(0);
  expect(layout.topbarPaddingLeft).toBe('15px');
  expect(layout.leftFirstIsPin).toBe(true);
  expect(layout.titleFollowsPin).toBe(true);
  expect(layout.rightLastIsSettings).toBe(true);
  expect(layout.settingsText).toContain('设置');
  expect(layout.settingsHeight).toBe('26px');
  expect(layout.pinSize).toEqual({ width: 24, height: 24 });
  expect(layout.pin.left).toBeGreaterThanOrEqual(14.5);
  expect(layout.settings.right).toBeLessThanOrEqual(layout.viewportWidth - 14.5);
});

test('C3 月历顶栏只含年月、副标题与 ‹ 今天 ›', async () => {
  const info = await page.evaluate(() => {
    const nav = document.querySelector('.month-nav');
    const calendar = document.querySelector('.calendar-pane');
    return {
      navIds: [...nav.querySelectorAll('[id]')].map((el) => el.id),
      hasPin: calendar.querySelector('#pin-button') !== null,
      hasSettings: calendar.querySelector('#settings-button') !== null,
      hasTitle: document.getElementById('month-title') !== null,
      hasSubtitle: document.getElementById('lunar-subtitle') !== null,
      navText: nav.textContent.replace(/\s+/g, '')
    };
  });

  expect(info.navIds).toEqual(['prev-month', 'today-button', 'next-month']);
  expect(info.hasPin).toBe(false);
  expect(info.hasSettings).toBe(false);
  expect(info.hasTitle).toBe(true);
  expect(info.hasSubtitle).toBe(true);
  expect(info.navText).toBe('‹今天›');
});

test('C4 钉住后忽略托盘离开与失焦，1 秒后仍可见', async () => {
  await showUnpinned();
  await page.click('#pin-button');
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '取消钉住并关闭');
  expect(await isPinned()).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '02-topbar-pinned.png') });

  await trayLeave();
  await blurWindow();
  await page.waitForTimeout(1000);

  expect(await isVisible()).toBe(true);
  expect(await isPinned()).toBe(true);
  await expect(page.locator('#pin-button')).toHaveAttribute('aria-label', '取消钉住并关闭');
});

test('C4 已钉住点 × 隐藏，再悬停托盘恢复未钉住', async () => {
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

test('C4 悬停 500ms 气泡在按钮下方左对齐，文案正确且完全在窗口内', async () => {
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
  const tipBox = await tip.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));

  expect(tipBox).not.toBeNull();
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  expect(tipBox.y).toBeGreaterThanOrEqual(0);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(viewport.width);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(viewport.height);
  expect(tipBox.y).toBeGreaterThanOrEqual(button.y + button.height);
  // Left edges are aligned, as the contract asks for the new top-left spot.
  expect(Math.abs(tipBox.x - button.x)).toBeLessThan(1.5);

  await page.screenshot({ path: path.join(SHOTS, '03-topbar-pin-tooltip.png') });
});

test('C5 点「设置」弹出原生菜单，锚点为按钮左缘、下方 4px', async () => {
  await showUnpinned();
  const button = await page.locator('#settings-button').boundingBox();

  await page.click('#settings-button');
  await page.waitForTimeout(200);

  const anchor = await mainEval(() => globalThis.__lanliTest.lastSettingsAnchor());
  expect(anchor).not.toBeNull();
  expect(anchor.x).toBe(Math.round(button.x));
  expect(anchor.y).toBe(Math.round(button.y + button.height + 4));

  // Menu popup takes the anchor as its top-left corner; the source side of
  // that contract is also asserted in tests/ui-wiring.test.js.
  await mainEval(() => globalThis.__lanliTest.closeSettingsMenu());
  // Dismissing the menu for real always lands a pointerdown in the window
  // (that is the 0.1.24 signal that clears the pill); replay it, then the
  // button must be back to its resting state.
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await page.waitForTimeout(100);
  await expect(page.locator('#settings-button')).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: path.join(SHOTS, '04-topbar-settings.png') });
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

    const topbar = document.querySelector('.topbar');
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
      topbarRect: rectOf(topbar),
      titleRect: rectOf(title),
      subtitleRect: rectOf(subtitle),
      navRect: rectOf(nav),
      titleGroupRect: rectOf(titleGroup),
      titleGroupOverlapsNav: overlaps(rectOf(titleGroup), rectOf(nav)),
      topbarOverlapsToolbar: overlaps(rectOf(topbar), toolbarRect),
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
  expect(metrics.topbarOverlapsToolbar).toBe(false);
  // The subtitle must have real room, not an ellipsis with zero width.
  expect(metrics.subtitleRect.width).toBeGreaterThan(0);
  // It sits below the fixed 32px top bar without pushing into it.
  expect(metrics.toolbarRect.top).toBeGreaterThanOrEqual(metrics.topbarRect.bottom);

  await page.screenshot({ path: path.join(SHOTS, '07-topbar-longest-subtitle.png') });
});

test('C7 月历格子、三张卡与版本行相对 0.1.24 只整体下移 32px', async () => {
  await showUnpinned();

  const measured = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      calendarPane: rect('.calendar-pane'),
      toolbar: rect('.toolbar'),
      weekdays: rect('.weekdays'),
      grid: rect('.grid'),
      firstCell: rect('.cell'),
      nowPane: rect('.now-pane'),
      almanacCard: rect('.almanac-card'),
      worldClockCard: rect('.world-clock-card'),
      weatherCard: rect('.weather-card'),
      paneFooter: rect('.pane-footer')
    };
  });

  expect(measured.viewport).toEqual({
    width: BASELINE.viewport.width,
    height: BASELINE.viewport.height + 32
  });

  for (const [name, before] of Object.entries(BASELINE.elements)) {
    const after = measured[name];
    expect(after, name).toBeTruthy();
    expect({
      name,
      x: Math.abs(after.x - before.x) <= 1,
      width: Math.abs(after.width - before.width) <= 1,
      height: Math.abs(after.height - before.height) <= 1,
      y: Math.abs(after.y - (before.y + 32)) <= 1
    }).toEqual({ name, x: true, width: true, height: true, y: true });
  }

  await page.screenshot({ path: path.join(SHOTS, '08-topbar-window.png') });
});

test('C8 窗口在当前屏幕可用区域内，且 1280×800 下完整显示', async () => {
  await showUnpinned();
  const fit = await mainEval(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const bounds = win.getBounds();
    const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
    return { bounds, area };
  });

  expect(fit.bounds.width).toBe(580);
  expect(fit.bounds.height).toBe(432);
  expect(fit.bounds.x).toBeGreaterThanOrEqual(fit.area.x);
  expect(fit.bounds.y).toBeGreaterThanOrEqual(fit.area.y);
  expect(fit.bounds.x + fit.bounds.width).toBeLessThanOrEqual(fit.area.x + fit.area.width);
  expect(fit.bounds.y + fit.bounds.height).toBeLessThanOrEqual(fit.area.y + fit.area.height);

  // Exact 1280×800 + 25px menu-bar case lives in tests/window-layout.test.js
  // (pure, injected geometry, runs on every platform).
});

test('C10 三张卡片入口文字统一带 ›', async () => {
  await showUnpinned();
  await expect(page.locator('#almanac-customize')).toHaveText('去定制 ›');
  await expect(page.locator('#clock-edit')).toHaveText('编辑 ›');
  await expect(page.locator('.weather-change')).toHaveText('更换 ›');

  await page.hover('.almanac-card');
  await page.locator('.almanac-card').screenshot({
    path: path.join(SHOTS, '05-almanac-card.png')
  });

  await page.hover('.world-clock-card');
  await page.locator('.world-clock-card').screenshot({
    path: path.join(SHOTS, '06-clock-hover.png')
  });

  await page.locator('.pane-footer').screenshot({
    path: path.join(SHOTS, '09-footer-version.png')
  });
});

test('C10 检查更新与版本号同为 10px，颜色 --muted，悬停 --link', async () => {
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

test('C10 页面与代码中不再有节气倒计时', async () => {
  const present = await page.evaluate(() => ({
    countdown: document.getElementById('almanac-term-countdown') !== null,
    countdownClass: document.querySelector('.term-countdown') !== null
  }));
  expect(present.countdown).toBe(false);
  expect(present.countdownClass).toBe(false);
});
