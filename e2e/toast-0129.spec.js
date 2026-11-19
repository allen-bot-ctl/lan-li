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
const emitNotice = (notice) => mainEval(
  (_electron, n) => globalThis.__lanliTest.emitUpdateNotice(n), notice
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

test('C5 五种提示都能触发：居中、距顶栏 8px、宽 320，月历与右栏零位移', async () => {
  await trayEnter();
  await clearToast();
  const baseline = await rects();
  const cases = [
    { type: 'info', title: '提示信息' },
    { type: 'success', title: '已是最新版本' },
    { type: 'warning', title: '新版本已就绪', detail: '重启后完成更新', action: '立即重启' },
    { type: 'error', title: '检查失败', detail: '网络不通或更新源暂不可用', action: '重试' },
    { type: 'progress', title: '正在检查更新…' }
  ];
  for (const c of cases) {
    await page.evaluate((opts) => {
      showToast({
        type: opts.type,
        title: opts.title,
        detail: opts.detail,
        action: opts.action ? { label: opts.action, onClick: () => {} } : null
      });
    }, c);
    await expect(toast()).toBeVisible();
    await settle();
    // CI 上过渡偶尔没走完：等提示框落到距顶栏 8px 再量
    await expect.poll(() => page.evaluate(() => {
      const r = document.getElementById('toast').getBoundingClientRect();
      const b = document.querySelector('.topbar').getBoundingClientRect();
      return Math.abs(r.top - b.bottom - 8) <= 1;
    }), { timeout: 3000 }).toBe(true);
    const info = await page.evaluate(() => {
      const el = document.getElementById('toast');
      const r = el.getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      const action = document.getElementById('toast-action');
      return {
        type: el.dataset.type,
        title: document.getElementById('toast-title').textContent,
        left: r.left,
        rightGap: window.innerWidth - r.right,
        top: r.top,
        barBottom: bar.bottom,
        width: r.width,
        height: r.height,
        stripe: getComputedStyle(el, '::before').width,
        progress: getComputedStyle(el.querySelector('.toast-progress')).display,
        actionHeight: action.hidden ? 0 : action.getBoundingClientRect().height
      };
    });
    expect(info.type).toBe(c.type);
    expect(info.title).toBe(c.title);
    expect(Math.abs(info.left - info.rightGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(info.top - info.barBottom - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(info.width - 320)).toBeLessThanOrEqual(1);
    expect(info.height).toBeGreaterThanOrEqual(43);
    expect(info.stripe).toBe('3px');
    expect(info.progress).toBe(c.type === 'progress' ? 'block' : 'none');
    if (c.action) expect(Math.abs(info.actionHeight - 24)).toBeLessThanOrEqual(1);
    expectSameRects(await rects(), baseline, c.type);
    await page.screenshot({ path: path.join(SHOTS, `11-toast-${c.type}.png`) });
  }
  await clearToast();
});

test('C5 success 在 2.8–3.4 秒消失；悬停时不消失', async () => {
  await trayEnter();
  await clearToast();
  const startedAt = Date.now();
  await page.evaluate(() => showToast({ type: 'success', title: '已是最新版本' }));
  await expect(toast()).toBeVisible();
  await expect(toast()).toBeHidden({ timeout: 6000 });
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeGreaterThanOrEqual(2800);
  expect(elapsed).toBeLessThanOrEqual(3400);

  await page.evaluate(() => showToast({ type: 'success', title: '悬停测试' }));
  await expect(toast()).toBeVisible();
  await settle();
  await page.hover('#toast-title');
  await page.waitForTimeout(4000);
  await expect(toast()).toBeVisible();
  await page.mouse.move(6, 220);
  await expect(toast()).toBeHidden({ timeout: 6000 });
});

test('C6 页面只有一个提示容器，连续触发两次只剩最新一条', async () => {
  await trayEnter();
  await clearToast();
  await page.evaluate(() => {
    showToast({ type: 'info', title: '第一条' });
    showToast({ type: 'error', title: '第二条' });
  });
  await expect(toast()).toBeVisible();
  const info = await page.evaluate(() => ({
    count: document.querySelectorAll('.toast').length,
    titles: [...document.querySelectorAll('.toast-title')].map((el) => el.textContent),
    type: document.getElementById('toast').dataset.type
  }));
  expect(info.count).toBe(1);
  expect(info.titles).toEqual(['第二条']);
  expect(info.type).toBe('error');
  await clearToast();
});

test('C5 progress 持续到下一状态；30 秒无结果转「检查失败」', async () => {
  test.setTimeout(70000);
  await trayEnter();
  await clearToast();
  await emitStatus({ state: 'checking', label: '正在检查…', busy: true });
  await expect(page.locator('#toast-title')).toHaveText('正在检查更新…');
  await page.waitForTimeout(5000);
  await expect(toast()).toBeVisible();
  await expect(toast()).toHaveAttribute('data-type', 'progress');

  await emitStatus({ state: 'downloading', label: '正在下载…', busy: true });
  await expect(page.locator('#toast-title')).toHaveText(/^正在下载新版本/);
  const startedAt = Date.now();
  await expect(page.locator('#toast-title')).toHaveText('检查失败', { timeout: 35000 });
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(29000);
  await expect(toast()).toHaveAttribute('data-type', 'error');
  await expect(page.locator('#toast-detail')).toHaveText('网络不通或更新源暂不可用');
  await expect(page.locator('#toast-action')).toHaveText('重试');
  await clearToast();
});

// 放最后：ready 通知会留在主进程，之后每次开窗都会重发。
test('C5 sticky（新版本已就绪）10 秒后仍在，× 可关且橙点保留', async () => {
  await trayEnter();
  await clearToast();
  await emitNotice({ mode: 'ready' });
  await expect(toast()).toBeVisible();
  await expect(page.locator('#toast-title')).toHaveText('新版本已就绪');
  await expect(page.locator('#toast-detail')).toHaveText('重启后完成更新');
  await expect(page.locator('#toast-action')).toHaveText('立即重启');
  await page.waitForTimeout(10000);
  await expect(toast()).toBeVisible();
  await page.click('#toast-close');
  await expect(toast()).toBeHidden();
  const classes = await page.locator('#check-update').getAttribute('class');
  expect(classes.split(/\s+/)).toContain('has-update');
});
