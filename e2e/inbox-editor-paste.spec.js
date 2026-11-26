'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInboxStore } = require('../electron/inbox-store');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOGba/0AAAAASUVORK5CYII=';
const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

test('已有收纳正文按光标粘贴系统图片、链接和混合图文，保存重开与取消无损', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-editor-paste-'));
  const inbox = path.join(work, 'inbox');
  const old = createInboxStore({ root: inbox }).addText('旧格式只保留原文');
  const oldFile = path.join(inbox, old.id, 'content.html');
  const oldBody = fs.readFileSync(oldFile);
  let app;
  const launch = async () => {
    app = await electron.launch({
      args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: inbox, LANLI_READER_DIR: path.join(work, 'reader') }
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
    await app.evaluate(() => globalThis.__lanliTest.showWindow());
    await page.click('#inbox-button');
    return page;
  };
  try {
    let page = await launch();
    const writeHtml = (text, html) => app.evaluate(({ clipboard }, arg) => {
      clipboard.clear(); clipboard.write(arg);
    }, { text, html });
    const writeBitmap = () => app.evaluate(({ clipboard, nativeImage }) => {
      // Four solid synthetic pixels, unlike the original 1×1 PNG.
      const bitmap = nativeImage.createFromBitmap(Buffer.from([30, 50, 220, 255, 30, 50, 220, 255, 30, 50, 220, 255, 30, 50, 220, 255]), { width: 2, height: 2 });
      clipboard.clear(); clipboard.writeImage(bitmap);
      return clipboard.readImage().getSize();
    });
    await writeHtml('首段原文 尾段原文', '<p>首段原文</p><img src="data:image/png;base64,' + PNG + '"><p>尾段原文</p>');
    await page.click('#inbox-paste');
    await page.locator('#capture-tags-skip').click();
    const entry = page.locator('#inbox-list .inbox-row').filter({ hasText: '首段原文' });
    await expect(entry).toBeVisible();
    const id = await entry.getAttribute('data-id');
    const row = () => page.locator('#inbox-list [data-id="' + id + '"]');
    const item = path.join(inbox, id);
    const immutable = fs.readFileSync(path.join(item, 'document.json'));
    const assetsBefore = fs.readdirSync(path.join(item, 'assets')).sort();
    expect(assetsBefore).toHaveLength(1);
    const firstImage = fs.readFileSync(path.join(item, 'assets', assetsBefore[0]));
    const frame = () => page.frameLocator('#inbox-detail-frame');
    const writer = () => page.locator('#inbox-wys-body .tiptap');
    const addLineAfter = async text => {
      const paragraph = writer().locator('p').filter({ hasText: text });
      await paragraph.click();
      await paragraph.evaluate(async node => {
        const selection = node.ownerDocument.getSelection();
        const target = node.ownerDocument.createRange();
        target.selectNodeContents(node);
        target.collapse(false);
        selection.removeAllRanges();
        selection.addRange(target);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.keyboard.press('Enter');
    };
    const images = () => writer().locator('img');
    const topBlocks = () => writer().evaluate(root => Array.from(root.children, el => el.tagName === 'IMG' ? 'IMG:' + el.naturalWidth : el.textContent));

    await row().click();
    await expect(frame().locator('img')).toHaveCount(1);
    await page.click('#inbox-detail-edit');
    await addLineAfter('首段原文');
    expect(await writeBitmap()).toEqual({ width: 2, height: 2 });
    await page.keyboard.press(PASTE);
    await expect(images()).toHaveCount(2);
    await expect.poll(topBlocks).toContain('IMG:2');
    await expect.poll(topBlocks).toContain('IMG:1');
    const afterBitmap = await topBlocks();
    expect(afterBitmap.indexOf('首段原文')).toBeLessThan(afterBitmap.indexOf('IMG:2'));
    expect(afterBitmap.indexOf('IMG:2')).toBeLessThan(afterBitmap.indexOf('IMG:1'));
    expect(afterBitmap.indexOf('IMG:1')).toBeLessThan(afterBitmap.indexOf('尾段原文'));
    // New draft image is not written to the row's permanent assets before Save.
    expect(fs.readdirSync(path.join(item, 'assets')).sort()).toEqual(assetsBefore);

    const url = 'https://example.invalid/paste-fixture';
    await addLineAfter('尾段原文');
    await app.evaluate(({ clipboard }, value) => { clipboard.clear(); clipboard.writeText(value); }, url);
    const openedBefore = await app.evaluate(() => globalThis.__lanliTest.inboxOpenCalls().length);
    await page.keyboard.press(PASTE);
    await expect(writer().locator('a')).toHaveAttribute('href', url);
    await expect(writer().locator('a')).toHaveText(url);
    expect(await app.evaluate(() => globalThis.__lanliTest.inboxOpenCalls().length)).toBe(openedBefore);

    await addLineAfter(url);
    const mixedPng = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(
      Buffer.from([150, 120, 100, 255, 150, 120, 100, 255, 150, 120, 100, 255]), { width: 3, height: 1 }
    ).toPNG().toString('base64'));
    await writeHtml('混合内容加粗', '<p>混合内容<strong>加粗</strong></p><img src="data:image/png;base64,' + mixedPng + '">');
    await page.keyboard.press(PASTE);
    await expect(writer().locator('strong')).toHaveText('加粗');
    await expect(images()).toHaveCount(3);
    await expect.poll(topBlocks).toContain('IMG:3');
    await page.click('#inbox-wys-save');
    await expect(frame().locator('img')).toHaveCount(3);
    await expect(frame().locator('a')).toHaveAttribute('href', url);
    await expect(frame().locator('strong')).toHaveText('加粗');
    expect(fs.readFileSync(path.join(item, 'document.json'))).toEqual(immutable);
    expect(fs.readFileSync(path.join(item, 'assets', assetsBefore[0]))).toEqual(firstImage);
    const committed = fs.readFileSync(path.join(item, 'meta.json'));
    const committedAssets = fs.readdirSync(path.join(item, 'assets')).sort();
    expect(committedAssets).toHaveLength(3);
    expect(committed.toString()).not.toContain('base64');

    await app.close();
    app = null;
    page = await launch();
    await row().click();
    await expect(frame().locator('body')).toContainText('首段原文');
    await expect(frame().locator('body')).toContainText('尾段原文');
    await expect(frame().locator('img')).toHaveCount(3);
    await expect(frame().locator('a')).toHaveAttribute('href', url);
    await page.click('#inbox-detail-edit');
    await addLineAfter('尾段原文');
    await writeBitmap();
    await page.keyboard.press(PASTE);
    await expect(images()).toHaveCount(4);
    await page.click('#inbox-wys-cancel');
    await page.click('#inbox-wys-discard');
    await expect(frame().locator('img')).toHaveCount(3);
    expect(fs.readFileSync(path.join(item, 'meta.json'))).toEqual(committed);
    expect(fs.readdirSync(path.join(item, 'assets')).sort()).toEqual(committedAssets);

    await page.click('#inbox-back');
    await page.locator('#inbox-list [data-id="' + old.id + '"]').click();
    await page.click('#inbox-detail-edit');
    await expect(writer()).toBeHidden();
    await expect(frame().locator('body')).toContainText('旧格式只保留原文');
    expect(fs.readFileSync(oldFile)).toEqual(oldBody);
  } finally {
    if (app) await app.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
