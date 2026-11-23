'use strict';
// 0.1.58：浏览器/聊天窗口复制的富文本开头带 <meta charset>，清洗后正文不能被删光。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInboxStore, classifyClipboard, sanitizeHtml } = require('../electron/inbox-store');

const CHROME_HTML = "<meta charset='utf-8'><p>栏历 v0.1.57 已出包，CI 通过。安装包在这里：<a href=\"https://github.com/x/y.dmg\">LanLi-0.1.57-mac-x64.dmg</a></p><p>第二段</p>";

test('R1 sanitizeHtml 只去掉 meta/link/base 标签本身，正文保留', () => {
  const h = sanitizeHtml(CHROME_HTML + '<link rel="stylesheet" href="a.css"><base href="/">');
  assert.ok(!/<meta|<link|<base/i.test(h));
  assert.match(h, /栏历 v0\.1\.57 已出包/);
  assert.match(h, /第二段/);
});

test('R2 带 meta 的富文本收纳：标题是第一行文字，正文不空', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-rich-'));
  const s = createInboxStore({ root });
  const [m] = s.saveAll(classifyClipboard({ html: CHROME_HTML, text: '栏历 v0.1.57 已出包' }));
  assert.ok(m.title.startsWith('栏历 v0.1.57 已出包'));
  assert.notStrictEqual(m.title, '图文');
  const html = fs.readFileSync(path.join(root, m.id, 'content.html'), 'utf8');
  assert.match(html, /第二段/);
});

test('R3 富文本清洗后什么都没有时退回纯文本', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-rich-'));
  const s = createInboxStore({ root });
  const [m] = s.saveAll(classifyClipboard({ html: '<style>p{}</style>', text: '只剩纯文本' }));
  assert.strictEqual(m.title, '只剩纯文本');
  assert.strictEqual(m.rich, false);
});

test('R1b 契约用例：link/base/form 保留文字，script 连内容删掉', () => {
  assert.match(sanitizeHtml("<meta charset='utf-8'><p>你好</p>"), /<p>你好<\/p>/);
  assert.match(sanitizeHtml('<link rel=x><b>粗</b>'), /<b>粗<\/b>/);
  assert.match(sanitizeHtml('<base href=x>文字'), /文字/);
  assert.match(sanitizeHtml('<form><p>表单里的字</p></form>'), /<p>表单里的字<\/p>/);
  assert.strictEqual(sanitizeHtml('<script>x</script>正文'), '正文');
});

test('R5 calendar.html 的 CSP 放行详情 iframe 内联样式（sha256 与 DETAIL_FRAME_CSS 一致）', () => {
  const crypto = require('node:crypto');
  const js = fs.readFileSync(path.join(__dirname, '../electron/renderer/calendar.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../electron/renderer/calendar.html'), 'utf8');
  const css = JSON.parse(js.match(/const DETAIL_FRAME_CSS = (".*");/)[1]);
  const h = crypto.createHash('sha256').update(css, 'utf8').digest('base64');
  assert.ok(html.includes(`'sha256-${h}'`), 'CSP style-src must include the hash of DETAIL_FRAME_CSS');
});
