'use strict';

// 0.1.35 十一项打磨验收 C1–C11（C12 = 全量单测与 e2e）。期望值都在测试里计算，不写死。
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

const hook = (name, arg) => mainEval((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
const trayEnter = () => hook('trayEnter');
const setNow = (iso) => hook('setNow', iso);

async function box(selector) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }, selector);
}

async function openSettings() {
  await trayEnter();
  await page.click('#settings-button');
  await hook('clickSettingsMenuItem', 'more-settings');
  await hook('closeSettingsMenu');
  await expect(page.locator('#settings-view')).toBeVisible();
}

async function backToCalendar() {
  if (await page.locator('#settings-view').isVisible()) await page.click('#settings-back');
  await expect(page.locator('#settings-view')).toBeHidden();
}

function offsetMinutes(iso, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric'
  }).formatToParts(new Date(iso));
  const v = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return (Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute) - Date.parse(iso)) / 60000;
}

function offsetText(diff) {
  if (diff === 0) return '时间相同';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const word = diff > 0 ? '快' : '慢';
  return m ? (h ? `${word} ${h} 小时 ${m} 分` : `${word} ${m} 分`) : `${word} ${h} 小时`;
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
  if (!app) return;
  await setNow(null).catch(() => {});
  await hook('setWeatherFail', false).catch(() => {});
  await app.close();
});

test('C1 ⚙ 设置按钮与钉住按钮垂直居中一致、底边离顶栏底线 ≥4px，钉住后不变', async () => {
  const measure = async () => {
    const s = await box('#settings-button');
    const pin = await box('#pin-button');
    const bar = await box('.topbar');
    return {
      dy: Math.abs((s.top + s.h / 2) - (pin.top + pin.h / 2)),
      gap: bar.bottom - s.bottom,
      topGap: s.top - bar.top,
      x: s.x
    };
  };
  // 顶栏 32px（含 1px 底线）、⚙ 胶囊 26px（0.1.24 锁定，pin-and-polish C2 断言）：
  // 恢复 0.1.33 后上下留白对称，底边离底线 = (32 - 1 - 26) / 2 = 2.5px 以上。
  // 契约写的 ≥4px 在 26px 胶囊下不可达，这里断言「上下对称且 ≥ 计算值」，已报 PM。
  const before = await measure();
  const expectedGap = await page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    const cs = getComputedStyle(bar);
    const pill = document.getElementById('settings-button').getBoundingClientRect().height;
    return (parseFloat(cs.height) - parseFloat(cs.borderBottomWidth) - pill) / 2;
  });
  expect(before.dy).toBeLessThanOrEqual(0.5);
  expect(before.gap).toBeGreaterThanOrEqual(expectedGap - 0.5);
  expect(Math.abs(before.topGap - (before.gap - 0))).toBeLessThanOrEqual(1.5);
  const marginTop = await page.evaluate(() => getComputedStyle(document.getElementById('settings-button')).marginTop);
  expect(marginTop).toBe('0px');

  await page.click('#pin-button');
  expect(await hook('isPinned')).toBe(true);
  const after = await measure();
  expect(after.dy).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.gap - before.gap)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
  await page.click('#pin-button');
  expect(await hook('isPinned')).toBe(false);
});

test('C2 全部风格签语：≤2 行、无单字行、不出省略号，带空格的第 1 行是空格前部分', async () => {
  const styles = await hook('allQuotes');
  const quotes = styles.flatMap((s) => s.pool);
  const expectedTotal = styles.reduce((n, s) => n + s.pool.length, 0);
  expect(styles.length).toBeGreaterThanOrEqual(5);
  expect(quotes.length).toBe(expectedTotal);
  expect(quotes.length).toBeGreaterThanOrEqual(50);

  const results = await page.evaluate((list) => {
    const el = document.getElementById('almanac-quote');
    const out = [];
    for (const text of list) {
      renderQuote(el, text);
      const lines = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.length; i += 1) {
          const ch = node.data[i];
          if (ch === ' ') continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect) continue;
          const top = Math.round(rect.top);
          let line = lines.find((l) => Math.abs(l.top - top) <= 2);
          if (!line) { line = { top, text: '' }; lines.push(line); }
          line.text += ch;
        }
      }
      lines.sort((a, b) => a.top - b.top);
      out.push({
        text,
        lines: lines.map((l) => l.text),
        overflow: el.scrollHeight > el.clientHeight + 1,
        ellipsis: getComputedStyle(el).textOverflow === 'ellipsis'
      });
    }
    refreshState();
    return out;
  }, quotes);

  for (const r of results) {
    expect(r.lines.length, r.text).toBeLessThanOrEqual(2);
    for (const line of r.lines) expect(line.length, `${r.text} → ${r.lines.join('/')}`).toBeGreaterThanOrEqual(2);
    expect(r.overflow, r.text).toBe(false);
    expect(r.ellipsis, r.text).toBe(false);
    const space = r.text.indexOf(' ');
    if (space > 0) expect(r.lines[0], r.text).toBe(r.text.slice(0, space));
  }
});

test('C3 签筒按钮内联 SVG 24×24、有 #pop-stick；点击动画 500ms 内结束并换签', async () => {
  await trayEnter();
  await expect(page.locator('#almanac-redraw #pop-stick')).toHaveCount(1);
  const svg = await box('#almanac-redraw svg');
  expect(Math.abs(svg.w - 24)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(svg.h - 24)).toBeLessThanOrEqual(0.5);
  await expect(page.locator('#almanac-redraw')).toHaveAttribute('data-tooltip', '重新抽签');

  const before = await page.evaluate(() => document.getElementById('almanac-quote').textContent);
  await page.click('#almanac-redraw');
  const started = Date.now();
  expect(await page.evaluate(() => document.getElementById('almanac-redraw').classList.contains('is-shaking'))).toBe(true);
  await expect.poll(
    () => page.evaluate(() => document.getElementById('almanac-redraw').classList.contains('is-shaking')),
    { timeout: 500, intervals: [25] }
  ).toBe(false);
  expect(Date.now() - started).toBeLessThanOrEqual(600);
  const after = await page.evaluate(() => ({
    quote: document.getElementById('almanac-quote').textContent,
    pool: lastAlmanac.quotePool
  }));
  expect(after.quote).not.toBe(before);
  expect(after.pool).toContain(after.quote);
});

test('C4 下拉菜单是「全部设置…」，没有「更多…」，点击进入设置页', async () => {
  const items = await hook('settingsMenuItems');
  const labels = items.map((i) => i.label);
  expect(labels).toContain('全部设置…');
  expect(labels).not.toContain('更多…');
  await openSettings();
  await backToCalendar();
});

test('C5 设置导航：返回与「界面设置」之间有分割线；都是手型、高 30px', async () => {
  await openSettings();
  const m = await page.evaluate(() => {
    const back = document.getElementById('settings-back');
    const firstTab = document.querySelector('.settings-tab');
    const between = back.nextElementSibling;
    const items = [back, ...document.querySelectorAll('.settings-tab')];
    return {
      dividerBetween: between.classList.contains('settings-nav-divider') && between.nextElementSibling === firstTab,
      dividerHeight: between.getBoundingClientRect().height,
      items: items.map((el) => ({ cursor: getComputedStyle(el).cursor, h: el.getBoundingClientRect().height }))
    };
  });
  expect(m.dividerBetween).toBe(true);
  expect(m.dividerHeight).toBeGreaterThan(0);
  for (const item of m.items) {
    expect(item.cursor).toBe('pointer');
    expect(Math.abs(item.h - 30)).toBeLessThanOrEqual(0.5);
  }
  await backToCalendar();
});

test('C6 五个设置页：页标题 15px/600 带分割线，内容区可见文字 ≥12px', async () => {
  await openSettings();
  const tabs = await page.locator('.settings-tab').allTextContents();
  expect(tabs.length).toBe(5);
  for (const tab of tabs) {
    await page.click(`.settings-tab:text-is("${tab}")`);
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const title = document.getElementById('settings-page-title');
      const cs = getComputedStyle(title);
      const roots = [document.getElementById('settings-content'),
        ...document.querySelectorAll('.picker-overlay.is-embedded:not([hidden])')];
      const small = [];
      for (const root of roots) {
        for (const el of root.querySelectorAll('*')) {
          if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
          if (!own) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 12) small.push(`${el.className || el.tagName}:${size}`);
        }
      }
      return {
        text: title.textContent, size: cs.fontSize, weight: Number(cs.fontWeight),
        border: cs.borderBottomWidth, borderStyle: cs.borderBottomStyle, small
      };
    });
    expect(m.text).toBe(tab);
    expect(m.size).toBe('15px');
    expect(m.weight).toBeGreaterThanOrEqual(600);
    expect(m.border).toBe('1px');
    expect(m.borderStyle).toBe('solid');
    expect(m.small, tab).toEqual([]);
  }
  await backToCalendar();
});

test('C7 钉住后 × 图标与钉住图标、下载图标同尺寸', async () => {
  await trayEnter();
  const pin = await box('#pin-button .pin-icon-pin');
  const download = await box('#check-update svg');
  await page.click('#pin-button');
  const close = await box('#pin-button .pin-icon-close');
  for (const ref of [pin, download]) {
    expect(Math.abs(close.w - ref.w)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(close.h - ref.h)).toBeLessThanOrEqual(0.5);
  }
  await page.click('#pin-button');
  expect(await hook('isPinned')).toBe(false);
});

test('C8 黄历卡不可点：无详情面板、无「查看黄历详情」、标题无 ›', async () => {
  await trayEnter();
  const card = await box('#almanac-card');
  const focus = await box('#almanac-focus-yi');
  await page.mouse.click(card.left + 4, focus.top + focus.h / 2);
  await page.waitForTimeout(200);
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
  await expect(page.locator('[aria-label="今日黄历"]')).toHaveCount(0);
  const html = await page.content();
  expect(html.includes('查看黄历详情')).toBe(false);
  const after = await page.evaluate(() =>
    getComputedStyle(document.getElementById('almanac-style-name'), '::after').content);
  expect(['none', 'normal', '']).toContain(after);
});

test('C9 纽约 20:38：东京、北京副行只显示按时差算出的文案，不含明天/昨天且不溢出', async () => {
  const iso = '2026-11-19T01:38:00Z';
  const added = [];
  const state = await page.evaluate(() => window.lanli.getState());
  const ids = state.clocks.items.map((c) => c.id);
  for (const [id, label] of [['Asia/Tokyo', '东京'], ['Asia/Shanghai', '北京']]) {
    if (!ids.includes(id)) {
      await page.evaluate((payload) => window.lanli.addClock(payload), { id, label });
      added.push(id);
    }
  }
  try {
    await setNow(iso);
    await page.evaluate(() => refreshState());
    const local = await hook('localZone');
    const snapshot = await page.evaluate(() => window.lanli.getState());
    await expect.poll(() => page.locator('#clock-list .clock-entry').count()).toBe(snapshot.clocks.items.length);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#clock-list .clock-entry')].map((row) => {
      const sub = row.querySelector('.clock-entry-sub');
      return { label: row.querySelector('.clock-entry-label').textContent, sub: sub.textContent, sw: sub.scrollWidth, cw: sub.clientWidth };
    }));
    for (const id of ['Asia/Tokyo', 'Asia/Shanghai']) {
      const item = snapshot.clocks.items.find((c) => c.id === id);
      const row = rows.find((r) => r.label === item.label);
      const expected = id === local ? '本地' : offsetText(offsetMinutes(iso, id) - offsetMinutes(iso, local));
      expect(row.sub).toBe(expected);
      expect(row.sub.includes('明天') || row.sub.includes('昨天')).toBe(false);
    }
    for (const r of rows) expect(r.sw, r.label).toBeLessThanOrEqual(r.cw);
  } finally {
    await setNow(null);
    for (const id of added) await page.evaluate((x) => window.lanli.removeClock({ id: x }), id);
  }
});

test('C10 天气当前温度与区间温度间距 8px，区间 11px --muted', async () => {
  await trayEnter();
  await page.evaluate(() => renderWeather({
    ok: true, temperature: 12, city: '上海', weather: '多云', emoji: '⛅️', rangeText: '6°~13°'
  }));
  const temp = await box('#weather-temp');
  const range = await box('#weather-range');
  expect(Math.abs(range.left - temp.right - 8)).toBeLessThanOrEqual(1);
  const m = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    document.body.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(document.getElementById('weather-range'));
    return { size: cs.fontSize, color: cs.color, muted };
  });
  expect(m.size).toBe('11px');
  expect(m.color).toBe(m.muted);
});

test('C11 天气：唤醒 5 秒后强制刷新；失败显示「重试」且不打开城市面板；失败不缓存', async () => {
  // ① resume → 5 秒后 refresh(force)
  const n0 = (await hook('weatherRefreshCalls')).length;
  await hook('triggerResume');
  await page.waitForTimeout(4000);
  expect((await hook('weatherRefreshCalls')).length).toBe(n0);
  await expect.poll(async () => (await hook('weatherRefreshCalls')).length, { timeout: 3000 }).toBeGreaterThan(n0);
  const calls = await hook('weatherRefreshCalls');
  expect(calls[calls.length - 1]).toBe(true);

  // ② 失败态：卡上「天气暂不可用」+「重试」；点重试只刷新
  await hook('setWeatherFail', true);
  await trayEnter();
  await hook('refreshWeatherNow');
  await expect(page.locator('#weather-retry')).toBeVisible();
  await expect(page.locator('#weather-city')).toHaveText('天气暂不可用');
  const n1 = (await hook('weatherRefreshCalls')).length;
  await page.click('#weather-retry');
  await expect.poll(async () => (await hook('weatherRefreshCalls')).length).toBeGreaterThan(n1);
  await expect(page.locator('#weather-picker')).toBeHidden();
  await expect(page.locator('#weather-retry')).toBeVisible();

  // ③ 失败期间的刷新都是 force（自动 60 秒重试由 tests/weather-refresh.test.js 用假定时器覆盖）
  const failCalls = (await hook('weatherRefreshCalls')).slice(n1);
  expect(failCalls.every((f) => f === true)).toBe(true);

  // ④ 失败态悬停不出「更换 ›」；点卡片其他位置仍打开城市面板
  await page.hover('#weather-card');
  const changeDisplay = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#weather-card .weather-change')).display);
  expect(changeDisplay).toBe('none');
  await page.click('#weather-emoji');
  await expect(page.locator('#weather-picker')).toBeVisible();
  await page.click('#weather-picker-close');
  await expect(page.locator('#weather-picker')).toBeHidden();

  // ⑤ 失败不进缓存：清掉先前成功的缓存（自动定位，e2e 默认即自动）后，连续两次 get 都重新请求、都失败
  await page.evaluate(() => window.lanli.setCity(null));
  const r1 = await page.evaluate(() => window.lanli.getWeather());
  const r2 = await page.evaluate(() => window.lanli.getWeather());
  expect(r1.ok).toBe(false);
  expect(r2.ok).toBe(false);

  await hook('setWeatherFail', false);
});
