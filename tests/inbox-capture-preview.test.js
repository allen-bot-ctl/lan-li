'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { capturePreview } = require('../electron/inbox-capture-preview');

test('显示富文本短预览，不把 Markdown 和残留字符实体原样塞进回执', () => {
  const m = { type: 'text', rich: true, title: '**固定原始标题',
    preview: '**现在弹窗显示成功，再显示可选&#x20;**&#x5DF2;保存。' };
  assert.equal(capturePreview(m), '现在弹窗显示成功，再显示可选 已保存。');
  assert.equal(m.title, '**固定原始标题');
  assert.match(m.preview, /&#x5DF2;/);
  assert.equal(capturePreview({ ...m, preview: '[产品介绍](https://example.com)   **重点**' }), '产品介绍 重点');
  assert.equal(capturePreview({ ...m, preview: '' }), '');
});

test('普通文字和文件名不当作 Markdown；长预览按 Unicode 字符限长', () => {
  assert.equal(capturePreview({ type: 'file', title: '项目__2026.txt' }), '项目__2026.txt');
  assert.equal(capturePreview({ type: 'text', rich: false, preview: '保留 **符号**' }), '保留 **符号**');
  const output = capturePreview({ type: 'text', rich: true, preview: '😀'.repeat(110) });
  assert.equal(output, '😀'.repeat(100) + '…');
});
