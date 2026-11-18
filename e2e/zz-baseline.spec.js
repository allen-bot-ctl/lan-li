'use strict';

const fs = require('node:fs');
const { test, _electron: electron } = require('@playwright/test');

test('capture 0.1.24 baseline layout metrics', async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  const app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  const page = await app.firstWindow();
  await page.waitForSelector('#lunar-subtitle');
  await app.evaluate(() => globalThis.__lanliTest.trayEnter());
  await page.waitForTimeout(300);

  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, width: r.width, height: r.height,
        left: r.left, right: r.right, top: r.top, bottom: r.bottom
      };
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
      paneFooter: rect('.pane-footer'),
      appVersion: rect('#app-version')
    };
  });

  fs.writeFileSync('/tmp/opencode-lan-li-baseline.json', JSON.stringify(metrics, null, 2));
  await app.close();
});
