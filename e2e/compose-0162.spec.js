'use strict';
// 0.1.62 R4 收纳录入（契约 docs/changes/0.1.62-pages-pin-compose-prompt.md）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let app = null;
let page = null;
const SHOTS = path.join(__dirname, 'screenshots');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-e2e-p62-'));
// Linux 上主进程 evaluate 偶尔和窗口显示/隐藏撞车（garbage collected），只对这种瞬时错误重试
const hook = async (name, arg) => {
  for (let i = 0; ; i += 1) {
    try { return await app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg }); } catch (e) {
      if (i >= 2 || !/garbage collected/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
};
const pinned = () => hook('isPinned');
const visible = () => hook('isVisible');

async function shots(name, locator) {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(120);
    await (locator || page).screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: null });
}
async function toCalendar() {
  // 在任一页面里点返回，直到回到日历
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('.app-body').isVisible()) return;
    for (const sel of ['#reader-back', '#inbox-back', '#settings-back']) {
      if (await page.locator(sel).isVisible()) { await page.click(sel); break; }
    }
    await page.waitForTimeout(120);
  }
  await expect(page.locator('.app-body')).toBeVisible();
}
// 真机上鼠标进过窗口才会清掉托盘打开时的 hold；这里补一次 mouseenter
const pointerIn = () => page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent('mouseenter')));
async function reset() {
  await hook('showWindow');
  await toCalendar();
  // 回到日历后 pinned 恢复进入前的值；统一成未钉住
  if (await pinned()) { await page.click('#pin-button'); await page.waitForTimeout(200); }
  await hook('showWindow');
  expect(await pinned()).toBe(false);
}
const openInbox = async () => { await hook('openInboxPanel'); await page.waitForSelector('#inbox-view:not([hidden])'); };
const openReader = async () => { await hook('openReaderPanel'); await page.waitForSelector('#reader-view:not([hidden])'); };
const openSettings = async () => { await page.evaluate(() => openSettingsView('ui')); await page.waitForSelector('#settings-view:not([hidden])'); };

test.beforeAll(async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'user') } });
  page = await app.firstWindow();
  await page.waitForSelector('#grid');
  await hook('showWindow');
});
test.afterAll(async () => { if (app) await app.close(); });

test('R4 收纳录入：空内容保存禁用；⌘↩ 保存；标题取第一行；Esc/取消 收起并清空；粘贴只取纯文本；超 20000 字禁用', async () => {
  await reset();
  await openInbox();
  const n0 = (await hook('inboxList')).length;
  await expect(page.locator('#inbox-compose')).toBeHidden();
  await page.click('#inbox-compose-btn');
  await expect(page.locator('#inbox-compose')).toBeVisible();
  await expect(page.locator('#inbox-compose-text')).toHaveAttribute('placeholder', '输入或粘贴文字，⌘↩ 保存');
  await expect(page.locator('#inbox-compose-save')).toBeDisabled();
  await page.fill('#inbox-compose-text', '   \n  ');
  await expect(page.locator('#inbox-compose-save')).toBeDisabled();
  // Esc = 取消：收起并清空，不退出收纳页
  await page.fill('#inbox-compose-text', '草稿内容');
  await expect(page.locator('#inbox-compose-save')).toBeEnabled();
  await page.press('#inbox-compose-text', 'Escape');
  await expect(page.locator('#inbox-compose')).toBeHidden();
  await expect(page.locator('#inbox-view')).toBeVisible();
  await page.click('#inbox-compose-btn');
  await expect(page.locator('#inbox-compose-text')).toHaveValue('');
  // 粘贴只取纯文本
  await page.fill('#inbox-compose-text', '');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '纯文本一行');
    dt.setData('text/html', '<b>粗体</b><img src="x">');
    document.getElementById('inbox-compose-text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#inbox-compose-text')).toHaveValue('纯文本一行');
  // 超过 20000 字：红色字数、保存禁用
  await page.evaluate(() => { const t = document.getElementById('inbox-compose-text'); t.value = '长'.repeat(20001); t.dispatchEvent(new Event('input')); });
  await expect(page.locator('#inbox-compose-count')).toHaveClass(/is-over/);
  await expect(page.locator('#inbox-compose-save')).toBeDisabled();
  // 保存：第一行前 40 字做标题
  const first = '手动录入的第一行标题';
  await page.fill('#inbox-compose-text', `${first}\n第二行内容`);
  await expect(page.locator('#inbox-compose-count')).not.toHaveClass(/is-over/);
  await shots('62-inbox-compose', page.locator('#inbox-view'));
  await page.press('#inbox-compose-text', 'Control+Enter');
  await expect(page.locator('#inbox-compose')).toBeHidden();
  await expect(page.locator('#toast-title')).toHaveText('已收纳');
  const list = await hook('inboxList');
  expect(list.length).toBe(n0 + 1);
  const e = list[0];
  expect(e.type).toBe('text');
  expect(e.via).toBe('manual');
  expect(e.title).toBe(first);
  await expect(page.locator('.inbox-row').first()).toContainText(first);
  await page.click('#inbox-compose-btn');
  await expect(page.locator('#inbox-compose-text')).toHaveValue('');
  await page.fill('#inbox-compose-text', '要取消的');
  await page.click('#inbox-compose-cancel');
  await page.click('#inbox-compose-btn');
  await expect(page.locator('#inbox-compose-text')).toHaveValue('');
  await page.click('#inbox-compose-cancel');
  await expect(page.locator('#inbox-compose')).toBeHidden();
  await reset();
});
