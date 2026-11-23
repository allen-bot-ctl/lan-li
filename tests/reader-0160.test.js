'use strict';
// 0.1.60 帮阅 R1/R2 单测（契约 docs/changes/0.1.60-reader.md）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../electron/reader-core');
const { complete } = require('../electron/reader-llm');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-reader-'));

test('R1 网址校验：http/https 通过，ftp、abc、空串不通过', () => {
  assert.ok(C.validateUrl('https://example.com/a'));
  assert.ok(C.validateUrl('http://news.example.org/x?y=1'));
  assert.equal(C.validateUrl('ftp://example.com'), null);
  assert.equal(C.validateUrl('abc'), null);
  assert.equal(C.validateUrl(''), null);
  assert.equal(C.validateUrl('   '), null);
});

test('R1 # 片段去重', () => {
  const root = tmp();
  const s = C.createReaderStore({ root });
  s.save({ id: 'r_a1', url: 'https://ex.com/p#top', status: 'done', createdMs: 1 });
  s.save({ id: 'r_a2', url: 'https://ex.com/q', status: 'error', createdMs: 2 });
  assert.equal(C.dedupeKey('https://ex.com/p#x'), 'https://ex.com/p');
  assert.equal(s.findDone('https://ex.com/p#other').id, 'r_a1');
  assert.equal(s.findDone('https://ex.com/p#').id, 'r_a1');
  assert.equal(s.findDone('https://ex.com/q'), null, '失败的记录不算读过');
});

test('R1 JSON 解析：正常、多于 7 条截断、非 JSON、points 空', () => {
  const ok = C.parseSummary(JSON.stringify({ summary: '一句话', points: ['a', 'b', 'c'] }));
  assert.deepEqual(ok, { summary: '一句话', points: ['a', 'b', 'c'] });
  const many = C.parseSummary(JSON.stringify({ summary: 's', points: Array.from({ length: 10 }, (_, i) => `p${i}`) }));
  assert.equal(many.points.length, 7);
  assert.equal(C.parseSummary('```json\n{"summary":"s","points":["x"]}\n```').points[0], 'x');
  assert.throws(() => C.parseSummary('不是 JSON'), (e) => C.llmErrorText(e) === '整理失败：返回格式不对');
  assert.throws(() => C.parseSummary('{"summary":"s","points":[]}'), (e) => C.llmErrorText(e) === '整理失败：返回格式不对');
});

test('R1 错误文案：401/403、HTTP、网络、超时', () => {
  assert.equal(C.llmErrorText({ code: 'http', status: 401 }), 'API Key 无效，去设置 ›');
  assert.equal(C.llmErrorText({ code: 'http', status: 403 }), 'API Key 无效，去设置 ›');
  assert.equal(C.llmErrorText({ code: 'http', status: 500 }), '整理失败：HTTP 500');
  assert.equal(C.llmErrorText({ code: 'network' }), '整理失败：连不上接口');
  assert.equal(C.llmErrorText({ code: 'timeout' }), '整理失败：超时');
});

test('R1 状态恢复：启动时进行中 → 失败「上次没读完，点重试」', () => {
  const root = tmp();
  const s = C.createReaderStore({ root });
  for (const [id, st] of [['r_b1', 'queued'], ['r_b2', 'reading'], ['r_b3', 'summarizing'], ['r_b4', 'done']]) s.save({ id, url: 'https://e.com/' + id, status: st, createdMs: 1 });
  assert.equal(s.recover(), 3);
  assert.equal(s.get('r_b1').status, 'error');
  assert.equal(s.get('r_b2').error, '上次没读完，点重试');
  assert.equal(s.get('r_b4').status, 'done');
});

test('R1 id 形如 r_<36进制时间戳><4位随机>；用户消息截取 12000 字；Markdown 首行 # 标题', () => {
  assert.match(C.newId(), /^r_[0-9a-z]+[0-9a-z]{4}$/);
  const u = C.buildUserMessage({ title: 'T', url: 'https://e.com', text: 'x'.repeat(20000) });
  assert.ok(u.startsWith('标题：T\n网址：https://e.com\n正文：\n'));
  assert.equal(u.length, '标题：T\n网址：https://e.com\n正文：\n'.length + 12000);
  assert.equal(C.toMarkdown({ title: 'T', url: 'https://e.com', summary: 's', points: ['a', 'b'] }), '# T\n来源 https://e.com\n\ns\n\n1. a\n2. b');
  assert.equal(C.normalizeText('a\n\n\n\nb  \n'), 'a\n\nb');
});

test('R1 complete() 请求体：json_object、非流式、Bearer', async () => {
  let seen = null;
  const r = await complete({ system: 'S', user: 'U', configuration: { baseURL: 'https://api.x.com/', model: 'm', apiKey: 'k' }, fetchImpl: async (url, opts) => { seen = { url: String(url), opts }; return { ok: true, json: async () => ({ choices: [{ message: { content: ' {"a":1} ' } }] }) }; } });
  assert.equal(r, '{"a":1}');
  assert.equal(seen.url, 'https://api.x.com/chat/completions');
  const body = JSON.parse(seen.opts.body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.stream, false);
  assert.equal(seen.opts.headers.Authorization, 'Bearer k');
  await assert.rejects(complete({ system: 'S', user: 'U', configuration: { baseURL: 'https://a', model: 'm', apiKey: 'k' }, fetchImpl: async () => ({ ok: false, status: 401 }) }), (e) => e.code === 'http' && e.status === 401);
});

test('R2 Key 文件 0600；getPublic() 不含明文；只收 https；删除 Key', () => {
  const d = tmp();
  const k = C.createKeyStore({ file: path.join(d, 'reader-api-key'), prefsFile: path.join(d, 'reader-config.json'), easylensDir: path.join(d, 'none') });
  assert.equal(k.getPublic().hasKey, false);
  assert.equal(k.save({ baseURL: 'http://insecure', model: 'm', apiKey: 'sk-secret' }).ok, false);
  const r = k.save({ baseURL: 'https://api.deepseek.com', model: '', apiKey: 'sk-secret-123' });
  assert.equal(r.ok, true);
  assert.equal(fs.statSync(path.join(d, 'reader-api-key')).mode & 0o777, 0o600);
  const pub = k.getPublic();
  assert.equal(pub.hasKey, true);
  assert.equal(pub.model, 'deepseek-chat');
  assert.ok(!JSON.stringify(pub).includes('sk-secret'));
  assert.ok(!fs.readFileSync(path.join(d, 'reader-config.json'), 'utf8').includes('sk-secret'));
  k.save({ baseURL: 'https://api.deepseek.com', model: 'x', apiKey: '' });
  assert.equal(k.config().apiKey, 'sk-secret-123', '留空不修改');
  k.removeKey();
  assert.equal(k.getPublic().hasKey, false);
});

test('R2 EasyLens 导入：复制 Key 并带上 baseURL、model', () => {
  const d = tmp();
  const ez = path.join(d, '.easylens');
  fs.mkdirSync(ez);
  fs.writeFileSync(path.join(ez, 'deepseek-api-key'), 'sk-ez-1\n');
  fs.writeFileSync(path.join(ez, 'settings.json'), JSON.stringify({ provider: 'deepSeek', baseURL: 'https://proxy.example.com/v1/', model: 'deepseek-reasoner' }));
  const k = C.createKeyStore({ file: path.join(d, 'u', 'reader-api-key'), prefsFile: path.join(d, 'u', 'reader-config.json'), easylensDir: ez });
  assert.equal(k.getPublic().easylensAvailable, true);
  const r = k.importEasyLens();
  assert.equal(r.ok, true);
  assert.equal(k.config().apiKey, 'sk-ez-1');
  assert.equal(r.baseURL, 'https://proxy.example.com/v1');
  assert.equal(r.model, 'deepseek-reasoner');
  assert.equal(r.easylensAvailable, false, '有 Key 后不再提示导入');
  assert.equal(fs.statSync(path.join(d, 'u', 'reader-api-key')).mode & 0o777, 0o600);
  const k2 = C.createKeyStore({ file: path.join(d, 'v', 'key'), prefsFile: path.join(d, 'v', 'c.json'), easylensDir: path.join(d, 'missing') });
  assert.equal(k2.importEasyLens().ok, false);
});
