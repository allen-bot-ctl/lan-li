'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LIMIT_IMAGE, embeddedImage, standaloneHttpLink } = require('../electron/renderer/inbox-paste-policy');

test('正文粘贴只解析受限的本地 PNG/JPEG 数据，不读地址或路径', () => {
  assert.deepEqual(embeddedImage('data:image/png;base64,aaaa'), { bytes: 3, url: 'data:image/png;base64,aaaa' });
  assert.deepEqual(embeddedImage('DATA:IMAGE/JPEG;BASE64,YQ=='), { bytes: 1, url: 'data:image/jpeg;base64,YQ==' });
  for (const value of ['data:image/gif;base64,YQ==', 'data:image/png;base64,YQ=', 'data:image/png;base64,', 'https://example.org/image.png', 'file:///example.png']) assert.equal(embeddedImage(value), null);
  const huge = Buffer.alloc(LIMIT_IMAGE + 1).toString('base64');
  assert.equal(embeddedImage('data:image/png;base64,' + huge), null);
});

test('独立 HTTP(S) 地址可内连，不会把整段混合文字变成一个链接', () => {
  assert.equal(standaloneHttpLink('https://example.org/article?a=b#c'), 'https://example.org/article?a=b#c');
  assert.equal(standaloneHttpLink('http://example.org'), 'http://example.org');
  for (const value of ['说明 https://example.org','https://example.org https://example.net','https://user@example.org','ftp://example.org','https://']) assert.equal(standaloneHttpLink(value), null);
});
