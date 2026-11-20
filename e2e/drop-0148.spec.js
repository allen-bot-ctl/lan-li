'use strict';
// 0.1.48 F-C2：在接纳框窗口派发真实 DOM drop，走 preload 取数 → 主进程落盘这一整条路径。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-drop-'));
const inboxDir = path.join(work, 'inbox');
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
const entries = () => hook('inboxList');
async function dropPage() {
  for (let i = 0; i < 40; i += 1) {
    const w = app.windows().find((p) => p.url().endsWith('dropzone.html'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await page.waitForTimeout(100);
  }
  throw new Error('dropzone window not found');
}

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inboxDir } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
});

test.afterAll(async () => { if (app) await app.close(); });


test('F-C2 接纳框真实 drop：preload 收到文件并送达主进程，file:// 兜底落盘', async () => {
  const src = path.join(work, '报告 2026.md');
  fs.writeFileSync(src, '# hi');
  const dir = path.join(work, '资料夹');
  fs.mkdirSync(dir);
  await hook('trayDragEnter');
  const dz = await dropPage();
  const urls = [src, dir].map((p) => 'file://' + encodeURI(p));
  await dz.evaluate((list) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['# hi'], '报告 2026.md', { type: 'text/markdown' }));
    dt.items.add(new File([''], '资料夹'));
    dt.setData('text/uri-list', list.join('\r\n'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, urls);
  await expect.poll(async () => (await hook('dropzoneState')).state, { timeout: 4000 }).toBe('success');
  const p = await hook('lastDropPayload');
  expect(p.fileCount).toBe(2);
  expect(p.uriList.length).toBe(2);
  const list = await entries();
  const srcs = list.map((e) => (e.meta || e).sourcePath);
  expect(srcs).toContain(src);
  expect(srcs).toContain(dir);
});
