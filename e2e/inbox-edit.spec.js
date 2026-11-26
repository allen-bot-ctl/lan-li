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
  const legacy = require('../electron/inbox-store').createInboxStore({ root: path.join(work, 'inbox') });
  const legacyItem = legacy.addText('旧格式正文内容');
  const legacyPath = path.join(work, 'inbox', legacyItem.id, 'content.html');
  const legacyOriginal = fs.readFileSync(legacyPath, 'utf8');
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
    await page.locator('#capture-tags-skip').click();
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
    await expect(page.locator('#toast')).toBeHidden();
    await page.screenshot({path:info.outputPath('native-reading.png')});
    const paneTop = (await page.locator('#inbox-detail-frame').boundingBox()).y;
    await expect(page.locator('#inbox-detail-edit')).toHaveText('编辑');
    const titleX = (await page.locator('#inbox-title').boundingBox()).x;
    await page.click('#inbox-detail-edit');
    const titleEdit = () => page.getByRole('textbox', {name:'收纳标题'});
    await expect(titleEdit()).not.toBeFocused();
    expect((await titleEdit().boundingBox()).x).toBe(titleX);
    await expect(page.locator('#inbox-title')).toBeHidden();
    await expect(page.locator('#inbox-detail-frame')).toBeHidden();
    expect((await page.locator('#inbox-wys-panel').boundingBox()).y).toBe(paneTop);
    let writer = page.locator('#inbox-wys-body .tiptap');
    await expect(writer).toHaveAttribute('contenteditable', 'true');
    await expect(writer).toBeFocused();
    await expect.poll(() => writer.locator('p').first().evaluate(el => {
      const selection = el.ownerDocument.getSelection();
      return selection.isCollapsed && el.contains(selection.anchorNode) && selection.anchorOffset === 0;
    })).toBe(true);
    await expect(writer.locator('p').filter({ hasText: '图前：' })).toBeVisible();
    await expect(writer.locator('img')).toBeVisible();
    await expect.poll(() => writer.locator('img').evaluate(e => e.complete && e.naturalWidth > 0)).toBe(true);
    await expect(writer.locator('p').filter({ hasText: '图后：待修改' })).toBeVisible();
    await page.screenshot({path:info.outputPath('native-editing.png')});
    const replace = async (needle,text) => {
      const para = writer.locator('p').filter({hasText:needle});
      await para.click();
      await para.evaluate(el => {
        const selection = el.ownerDocument.getSelection();
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.insertText(text);
    };
    await titleEdit().fill('不应被保存的标题');
    await replace('图前：','图前：不应被保存');
    await expect(writer.locator('p').filter({ hasText: '图前：不应被保存' })).toBeVisible();
    await page.click('#inbox-wys-cancel');
    await expect(page.locator('#inbox-wys-discard')).toBeVisible();
    await page.click('#inbox-wys-discard');
    await expect(page.locator('#inbox-title')).not.toHaveText('不应被保存的标题');
    await expect(frame().locator('p').filter({hasText:'图后：待修改'})).toBeVisible();
    await expect(frame().locator('p').filter({hasText:'图前：不应被保存'})).toHaveCount(0);
    await page.click('#inbox-detail-edit');
    await titleEdit().fill('只改标题');
    await page.click('#inbox-wys-save');
    await expect(page.locator('#inbox-title')).toHaveText('只改标题');
    const titleOnly = JSON.parse(fs.readFileSync(path.join(work,'inbox',id,'meta.json'),'utf8'));
    expect(titleOnly.displayTitle).toBe('只改标题');
    expect(titleOnly.documentEdit).toBeUndefined();
    await page.click('#inbox-detail-edit');
    await titleEdit().fill('已保存的新标题');
    await replace('图后：待修改','图后：修改已保存');
    await page.click('#inbox-wys-save');
    await expect(frame().locator('p').filter({hasText:'图后：修改已保存'})).toBeVisible();
    await expect(page.locator('#inbox-title')).toHaveText('已保存的新标题');
    const savedMeta = JSON.parse(fs.readFileSync(path.join(work,'inbox',id,'meta.json'),'utf8'));
    expect(savedMeta.displayTitle).toBe('已保存的新标题');
    const saved = savedMeta.documentEdit;
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
    await expect(page.locator('#inbox-title')).toHaveText('已保存的新标题');
    await page.click('#inbox-back');
    await page.locator('#inbox-search').fill('图后：修改已保存');
    const reopenRow = page.locator(`.inbox-row[data-id="${id}"]`);
    await expect(reopenRow).toBeVisible();
    await reopenRow.hover();
    await reopenRow.locator('.inbox-act-copy').click();
    await expect.poll(() => app.evaluate(({clipboard})=>clipboard.readHTML())).toContain('图后：修改已保存');
    expect(await app.evaluate(({clipboard})=>clipboard.readHTML())).toMatch(/<img[^>]+src="data:image\/png;base64,/);
    await page.locator('#inbox-search').fill('');
    await page.locator(`.inbox-row[data-id="${legacyItem.id}"]`).click();
    await page.click('#inbox-detail-edit');
    await expect(frame().locator('p')).toHaveText('旧格式正文内容');
    await expect(page.locator('#inbox-edit-dialog')).toBeHidden();
    await expect(titleEdit()).toBeFocused();
    await titleEdit().fill('旧格式新标题');
    await page.click('#inbox-wys-save');
    await expect(page.locator('#inbox-title')).toHaveText('旧格式新标题');
    assert.equal(fs.readFileSync(legacyPath,'utf8'),legacyOriginal);
    await page.click('#inbox-back');
    const plainText = '纯文字第一行\n\n最后一行';
    await app.evaluate(({ clipboard }, value) => { clipboard.clear(); clipboard.writeText(value); }, plainText);
    expect(await app.evaluate(({clipboard}) => clipboard.readText())).toEqual(plainText);
    await page.click('#inbox-paste');
    await page.locator('#capture-tags-skip').click();
    const textRow = page.locator('.inbox-row').filter({hasText:'纯文字第一行'});
    await expect(textRow).toBeVisible();
    const plainId = await textRow.getAttribute('data-id');
    const plainDisk = JSON.parse(fs.readFileSync(path.join(work,'inbox',plainId,'document.json'),'utf8'));
    expect(plainDisk.content.map(pmText)).toEqual(plainText.split('\n'));
    await textRow.click();
    await page.click('#inbox-detail-edit');
    writer = page.locator('#inbox-wys-body .tiptap');
    await expect(writer).toBeVisible();
    await expect.poll(() => writer.evaluate(el => Array.from(el.children).map(n => [n.tagName, n.textContent])))
      .toEqual(plainText.split('\n').map(line => ['P', line]));
    await page.click('#inbox-wys-save');
    await expect(page.locator('#inbox-detail-edit')).toBeVisible();
  } finally {
    if (app) await app.close();
    fs.rmSync(work,{force:true,recursive:true});
  }
});

test('首张图片上方不冒出空行，有意的换行仍然保留', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-wys-leading-image-'));
  let app;
  try {
    app = await electron.launch({ args: process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'],
      env: { ...process.env, LANLI_E2E: '1', LANLI_INBOX_DIR: path.join(work, 'inbox'), LANLI_READER_DIR: path.join(work, 'reader') } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.readyState === 'complete' && typeof window.openReaderView === 'function');
    await app.evaluate(() => globalThis.__lanliTest.showWindow());
    await page.click('#inbox-button');
    const code = '合成样本首行\n\t带缩进   内容\n\n末行';
    const raw = '<h1><img src="data:image/png;base64,' + PNG + '"></h1>' +
      '<pre>' + code + '</pre><p><br></p>';
    await app.evaluate(({ clipboard }, html) => { clipboard.clear(); clipboard.write({ html, text: '合成样本首行' }); }, raw);
    await page.click('#inbox-paste');
    await page.locator('#capture-tags-skip').click();
    const row = page.locator('#inbox-list .inbox-row').filter({ hasText: '合成样本首行' });
    const id = await row.getAttribute('data-id');
    const disk = path.join(work, 'inbox', id, 'document.json');
    const stored = JSON.parse(fs.readFileSync(disk, 'utf8'));
    expect(stored.content[0].type).toBe('image');
    const frame = page.frameLocator('#inbox-detail-frame');
    const editable = page.locator('#inbox-wys-body .tiptap');
    const realImage = editable.locator('img[data-attachment-id]');
    let compactTop;
    const normalized = stored.content;
    for (const blank of [{ type: 'paragraph' }, { type: 'heading', attrs: { level: 1 } }]) {
      // Existing rows may contain the old ghost paragraph or the H1 shape
      // produced when a source page wrapped its leading logo in a heading.
      stored.content = [blank, ...normalized];
      fs.writeFileSync(disk, JSON.stringify(stored));
      await row.click();
      await expect(frame.locator('img')).toBeVisible();
      const readImage = await frame.locator('img').boundingBox();
      const readFrame = await page.locator('#inbox-detail-frame').boundingBox();
      await page.click('#inbox-detail-edit');
      await expect(realImage).toBeVisible();
      await expect(editable).toBeFocused();
      await expect.poll(() => editable.locator('pre').evaluate(el => {
        const selection = el.ownerDocument.getSelection();
        return selection.isCollapsed && el.contains(selection.anchorNode) && selection.anchorOffset === 0;
      })).toBe(true);
      const editBodyLocator = page.locator('#inbox-wys-body');
      await editBodyLocator.evaluate(el => { el.scrollTop = 0; });
      const editImage = await realImage.boundingBox();
      const editBody = await editBodyLocator.boundingBox();
      compactTop = editImage.y - editBody.y;
      expect(Math.abs(compactTop - (readImage.y - readFrame.y))).toBeLessThan(8);
      expect(await editable.locator('pre').textContent()).toBe(code);
      await expect(editable.locator('p').last().locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(1);
      await page.click('#inbox-wys-save');
      await expect(frame.locator('img')).toBeVisible();
      expect(await frame.locator('pre').textContent()).toBe(code);
      await expect(frame.locator('p').last().locator('br')).toHaveCount(1);
      expect(JSON.parse(fs.readFileSync(disk, 'utf8'))).toEqual(stored);
      await page.click('#inbox-back');
    }
    // A real leading line break is not the caret-only placeholder.
    stored.content[0] = { type: 'paragraph', content: [{ type: 'hardBreak' }] };
    fs.writeFileSync(disk, JSON.stringify(stored));
    await row.click();
    await expect(frame.locator('img')).toBeVisible();
    await page.click('#inbox-detail-edit');
    const authoredBodyLocator = page.locator('#inbox-wys-body');
    await authoredBodyLocator.evaluate(el => { el.scrollTop = 0; });
    const authoredImage = await realImage.boundingBox();
    const authoredBody = await authoredBodyLocator.boundingBox();
    expect((authoredImage.y - authoredBody.y) - compactTop).toBeGreaterThan(10);
    await expect(editable.locator('p').first().locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(1);
  } finally {
    if (app) await app.close();
    fs.rmSync(work, { force: true, recursive: true });
  }
});
