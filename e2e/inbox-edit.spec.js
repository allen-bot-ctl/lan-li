'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAXwAAAB8CAIAAADl8pwpAAACZ0lEQVR4nO3dwUnEUBhG0Sh2K9iAaxsQLFFwZwtuRFHE1cx9Py/nNJCPybxLVsnN6/vbAVC5XT0AOBfRAVKiA6REB0iJDpASHSAlOkBKdICU6AAp0QFSogOkRAdIiQ6QEh0gJTpASnSAlOgAKdEBUqIDpEQHSIkOkBIdICU6QEp0gNTd6gEw0f3z46pLvzw8rbp0w5MO/LawOMuvHhAd+GHCmZ+w4XpEB77NOe1zllyc6MCnaed82p5LER0gJTpASnSAlOgAKdEBUqIDpEQHSIkOkBIdICU6QMqrLc7L2xtYwpPOSXl7A6uIzhlNOPMTNrCE6JzOnNM+Zwkl0TmXaed82h4CogOkRAdIiQ6QEh0gJTpASnSAlOgAKdEBUqIDpEQHSIkOkBIdICU6QEp0gJToACnRAVKiA6REB0ht/gkaX1mBaXZ+0vGVFRho2+hMOPMTNsA0e0ZnzmmfswSG2DA60875tD2w1obRASYTHSAlOkBKdICU6AAp0QFSogOkRAdIiQ6QEh0gJTpASnSAlOgAKdEBUqIDpEQHSIkOkBIdICU6QEp0gJToACnRAVKiA6REB0iJDpASHSAlOkBKdICU6AAp0QFSG0bn5eFp9YQfRu0ZNeYYtmfUmGPenkvZMDrHpLs1Z8mXOZPmLPkyZ9KcJRe3Z3SOGfdswoY/TRg2YcOfJgybsOF6to3OsfrODf/f+HH+4ce5qpvX97fVG4AT2flJBxhIdICU6AAp0QFSogOkRAdIiQ6QEh0gJTpASnSAlOgAKdEBUqIDpEQHSIkOkBIdICU6QEp0gJToACnRAVKiA6Q+ACMZV3WVxgUyAAAAAElFTkSuQmCC';

test('系统剪贴板图文原位编辑，图前后、格式、取消、保存重开及复制', async ({}, info) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-wys-'));
  let app;
  const launch = async () => {
    app = await electron.launch({ args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'reader') } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
    await app.evaluate(() => globalThis.__lanliTest.showWindow());
    await page.click('#inbox-button');
    return page;
  };
  try {
    let page = await launch();
    const raw = '<p>图前：<strong>加粗标记</strong> <em>斜体标记</em> <a href="https://example.org/reference">参考链接</a></p>' +
      '<img width="120" alt="合成测试图" src="data:image/png;base64,' + PNG + '">' +
      '<p>图后：待修改</p><ul><li>第一项</li><li>第二项</li></ul>';
    await app.evaluate(({ clipboard }, html) => { clipboard.clear(); clipboard.write({ html, text: '图前、图后与列表' }); }, raw);
    expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toContain('合成测试图');
    await page.click('#inbox-paste');
    const row = page.locator('.inbox-row').filter({ hasText: '图前：' });
    await expect(row).toBeVisible();
    const id = await row.getAttribute('data-id');
    const disk = path.join(work, 'inbox', id, 'document.json');
    const original = JSON.parse(fs.readFileSync(disk, 'utf8'));
    expect(JSON.stringify(original)).not.toContain('base64');
    const image = original.content.find(n => n.type === 'image');
    expect(image.attrs.src).toMatch(/^assets\/img-\d+\.png$/);
    expect(fs.existsSync(path.join(work,'inbox',id,image.attrs.src))).toBe(true);
    await row.click();
    const frame = () => page.frameLocator('#inbox-detail-frame');
    await expect(frame().locator('a')).toHaveAttribute('href', 'https://example.org/reference');
    await page.screenshot({path:info.outputPath('native-reading.png')});
    await page.click('#inbox-detail-edit');
    let writer = page.locator('#inbox-wys-body .tiptap');
    await expect(writer).toHaveAttribute('contenteditable', 'true');
    await expect(writer.locator('p').filter({ hasText: '图前：' })).toBeVisible();
    await expect(writer.locator('img')).toBeVisible();
    await expect.poll(() => writer.locator('img').evaluate(e => e.complete && e.naturalWidth > 0)).toBe(true);
    await expect(writer.locator('p').filter({ hasText: '图后：待修改' })).toBeVisible();
    await page.screenshot({path:info.outputPath('native-editing.png')});
    const replace = async (needle,text) => {
      await writer.locator('p').filter({hasText:needle}).click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.keyboard.insertText(text);
    };
    await replace('图后：待修改','不应被保存');
    await page.click('#inbox-wys-cancel');
    await expect(page.locator('#inbox-wys-discard')).toBeVisible();
    await page.click('#inbox-wys-discard');
    await expect(frame().locator('p').filter({hasText:'图后：待修改'})).toBeVisible();
    await page.click('#inbox-detail-edit');
    await replace('图后：待修改','图后：修改已保存');
    await page.click('#inbox-wys-save');
    await expect(frame().locator('p').filter({hasText:'图后：修改已保存'})).toBeVisible();
    const saved = JSON.parse(fs.readFileSync(path.join(work,'inbox',id,'meta.json'),'utf8')).documentEdit;
    const pmText = n => n.type === 'text' ? n.text : (n.content||[]).map(pmText).join('');
    const changed = saved.content.findIndex(n=>pmText(n)==='图后：修改已保存');
    expect(changed).toBeGreaterThanOrEqual(0);
    for (let i=0;i<original.content.length;i++) if (i!==changed) assert.deepEqual(saved.content[i],original.content[i]);
    const originalBefore = fs.readFileSync(disk,'utf8');
    await app.close(); app = null; page = await launch();
    await page.locator(`.inbox-row[data-id="${id}"]`).click();
    await expect(frame().locator('p').filter({hasText:'图后：修改已保存'})).toBeVisible();
    await expect(frame().locator('img')).toBeVisible();
    assert.equal(fs.readFileSync(disk,'utf8'),originalBefore);
    await page.click('#inbox-back');
    const reopenRow = page.locator(`.inbox-row[data-id="${id}"]`);
    await reopenRow.hover();
    await reopenRow.locator('.inbox-act-copy').click();
    await expect.poll(() => app.evaluate(({clipboard})=>clipboard.readHTML())).toContain('图后：修改已保存');
    expect(await app.evaluate(({clipboard})=>clipboard.readHTML())).toMatch(/<img[^>]+src="data:image\/png;base64,/);
    await app.evaluate(({ clipboard }) => { clipboard.clear(); clipboard.writeText('纯文字第一行\n\n最后一行'); });
    await page.click('#inbox-paste');
    await page.locator('.inbox-row').filter({hasText:'纯文字第一行'}).click();
    await page.click('#inbox-detail-edit');
    writer = page.locator('#inbox-wys-body .tiptap');
    await expect(writer.locator(':scope > p')).toHaveCount(3);
    await expect(writer.locator(':scope > p').nth(1)).toHaveText('');
    await page.click('#inbox-wys-save');
    await expect(page.locator('#inbox-detail-edit')).toBeVisible();
  } finally {
    if (app) await app.close();
    fs.rmSync(work,{force:true,recursive:true});
  }
});
