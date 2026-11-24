'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../electron/reader-core');

test('0.1.64 R3 请求 system / user 与契约 §2.4 逐字一致', () => {
  const m = C.buildRewriteMessages({ prompt: '旧提示词\n第二行', request: '  只留 3 条  ' });
  assert.equal(m.system, '你是提示词编辑。用户消息里有两段：<<<现行提示词>>> 和 <<<修改需求>>>。请按修改需求改写现行提示词：需求涉及的地方照改，需求没提到的部分保持原文不变。只输出改好后的完整提示词本身，不要解释，不要加前言或结尾，不要用代码块包起来。这段提示词是给阅读助手整理文章用的，文章正文和安全规则由程序另外附加，不要写进提示词。');
  assert.equal(m.user, '<<<现行提示词>>>\n旧提示词\n第二行\n<<<结束>>>\n\n<<<修改需求>>>\n只留 3 条\n<<<结束>>>');
  assert.equal(m.system.includes('以下规则由程序固定附加'), false);
});

test('0.1.64 代码块剥离与空白', () => {
  assert.equal(C.cleanRewrite('  新版  '), '新版');
  assert.equal(C.cleanRewrite('```\n新版\n第二行\n```'), '新版\n第二行');
  assert.equal(C.cleanRewrite('```markdown\n## 标题\n内容\n```\n'), '## 标题\n内容');
  assert.equal(C.cleanRewrite('```\n```'), '');
  assert.equal(C.cleanRewrite('前面 ```code``` 后面'), '前面 ```code``` 后面');
});

test('0.1.64 §2.5 错误文案', () => {
  const e = C.rewriteErrorText;
  assert.equal(e({ code: 'http', status: 401 }), '生成失败：API Key 无效');
  assert.equal(e({ code: 'http', status: 403 }), '生成失败：API Key 无效');
  assert.equal(e({ code: 'http', status: 404 }), '生成失败：接口地址或模型不对');
  assert.equal(e({ code: 'http', status: 500 }), '生成失败：HTTP 500');
  assert.equal(e({ code: 'network' }), '生成失败：连不上接口');
  assert.equal(e({ code: 'timeout' }), '生成失败：超时');
  assert.equal(e({ code: 'bad-response' }), '生成失败：返回格式不对');
  assert.equal(e({ code: 'empty' }), '生成失败：大模型没有返回内容');
  assert.equal(C.REWRITE_TOO_LONG, '生成失败：新版超过 4000 字，再试一版');
  assert.equal(C.MAX_PROMPT_CHARS, 4000);
});
