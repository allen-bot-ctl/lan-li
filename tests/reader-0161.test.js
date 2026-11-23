'use strict';
// 0.1.61 帮阅大模型设置独立（契约 docs/changes/0.1.61-reader-llm-settings.md）R1、R2。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../electron/reader-core');
const { complete, ping } = require('../electron/reader-llm');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lanli-reader61-'));
function memPrefs(init = {}) {
  let p = JSON.parse(JSON.stringify(init));
  return { read: () => JSON.parse(JSON.stringify(p)), write: (n) => { p = JSON.parse(JSON.stringify(n)); }, peek: () => p };
}

test('R1 没有 EasyLens 回落：HOME 下有 ~/.easylens/deepseek-api-key 也读不到', () => {
  const d = tmp();
  const oldHome = process.env.HOME;
  process.env.HOME = d;
  try {
    fs.mkdirSync(path.join(d, '.easylens'));
    fs.writeFileSync(path.join(d, '.easylens', 'deepseek-api-key'), 'sk-ez-should-not-be-read\n');
    const k = C.createKeyStore({ file: path.join(d, 'u', 'reader-api-key'), prefs: memPrefs() });
    assert.equal(k.config().apiKey, null);
    assert.equal(k.getPublic().ready, false);
    assert.equal(k.getPublic().hasKey, false);
    assert.ok(!('usingEasyLens' in k.getPublic()));
  } finally { process.env.HOME = oldHome; }
  const src = ['reader-core.js', 'reader-main.js', 'main.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'electron', f), 'utf8')).join('\n');
  assert.ok(!/easylens/i.test(src), '代码里不再出现 EasyLens');
  const html = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer', 'calendar.html'), 'utf8');
  assert.ok(!/easylens/i.test(html), '界面里不再出现 EasyLens');
});

test('R1 接口地址校验：https 通过，http / 空串不通过，末尾 / 去掉', () => {
  assert.equal(C.validateBaseURL('https://api.deepseek.com'), 'https://api.deepseek.com');
  assert.equal(C.validateBaseURL('  https://api.openai.com/v1/// '), 'https://api.openai.com/v1');
  assert.equal(C.validateBaseURL('http://api.deepseek.com'), null);
  assert.equal(C.validateBaseURL(''), null);
  assert.equal(C.validateBaseURL(null), null);
  assert.equal(C.validateBaseURL('api.deepseek.com'), null);
  assert.equal(C.validateBaseURL('https://'), null);
});

test('R1 保存：地址不合法、模型为空都不能保存；合法时地址和模型进 preferences.reader，Key 不进', () => {
  const d = tmp();
  const prefs = memPrefs({ other: 1 });
  const k = C.createKeyStore({ file: path.join(d, 'reader-api-key'), prefs });
  let r = k.save({ baseURL: 'http://x.com', model: 'm', apiKey: 'sk-a' });
  assert.equal(r.ok, false); assert.equal(r.code, 'bad-url'); assert.equal(r.error, '接口地址需要以 https:// 开头');
  r = k.save({ baseURL: 'https://x.com', model: '  ', apiKey: 'sk-a' });
  assert.equal(r.ok, false); assert.equal(r.code, 'no-model');
  assert.equal(k.config().apiKey, null, '校验失败时不写 Key');
  r = k.save({ baseURL: 'https://api.moonshot.cn/v1/', model: 'kimi-k2', apiKey: 'sk-secret-61' });
  assert.equal(r.ok, true);
  assert.deepEqual(prefs.peek(), { other: 1, reader: { baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k2' } });
  assert.ok(!JSON.stringify(prefs.peek()).includes('sk-secret'));
  assert.equal(fs.statSync(path.join(d, 'reader-api-key')).mode & 0o777, 0o600);
  const pub = k.getPublic();
  assert.deepEqual(pub, { baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k2', hasKey: true, ready: true });
  assert.ok(!JSON.stringify(r).includes('sk-secret'));
  k.save({ baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k2', apiKey: '' });
  assert.equal(k.config().apiKey, 'sk-secret-61', 'Key 留空不修改');
  k.removeKey();
  assert.equal(k.getPublic().hasKey, false);
  assert.equal(k.getPublic().model, 'kimi-k2');
});

test('R1 没有设置时用默认值；preferences 里是坏值时回到默认', () => {
  const d = tmp();
  assert.deepEqual(C.createKeyStore({ file: path.join(d, 'k'), prefs: memPrefs() }).getPublic(), { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', hasKey: false, ready: false });
  const k = C.createKeyStore({ file: path.join(d, 'k'), prefs: memPrefs({ reader: { baseURL: 'http://evil', model: '' } }) });
  assert.equal(k.config().baseURL, 'https://api.deepseek.com');
  assert.equal(k.config().model, 'deepseek-chat');
});

test('R2 请求地址和模型取自设置', async () => {
  const d = tmp();
  const k = C.createKeyStore({ file: path.join(d, 'k'), prefs: memPrefs() });
  k.save({ baseURL: 'https://api.openai.com/v1/', model: 'gpt-4o-mini', apiKey: 'sk-x' });
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url: String(url), body: JSON.parse(opts.body), auth: opts.headers.Authorization }); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"points":["a"]}' } }] }) }; };
  await complete({ system: 'S', user: 'U', configuration: k.config(), fetchImpl });
  assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen[0].body.model, 'gpt-4o-mini');
  assert.equal(seen[0].auth, 'Bearer sk-x');
  // 测试连接：最小请求
  await ping({ configuration: k.config(), fetchImpl });
  assert.equal(seen[1].url, 'https://api.openai.com/v1/chat/completions');
  assert.deepEqual(seen[1].body.messages, [{ role: 'user', content: 'ping' }]);
  assert.equal(seen[1].body.max_tokens, 1);
  assert.equal(seen[1].body.model, 'gpt-4o-mini');
});

test('R2 401/403/404 映射到第 3 节文案；测试连接同样分类', async () => {
  const err = async (status) => {
    try { await complete({ system: 'S', user: 'U', configuration: { baseURL: 'https://a', model: 'm', apiKey: 'k' }, fetchImpl: async () => ({ ok: false, status }) }); } catch (e) { return e; }
    return null;
  };
  assert.equal(C.llmErrorText(await err(401)), 'API Key 无效，去设置 ›');
  assert.equal(C.llmErrorText(await err(403)), 'API Key 无效，去设置 ›');
  assert.equal(C.llmErrorText(await err(404)), '整理失败：接口地址或模型不对');
  assert.equal(C.llmErrorText(await err(500)), '整理失败：HTTP 500');
  assert.equal(C.llmErrorText({ code: 'network' }), '整理失败：连不上接口');
  assert.equal(C.llmErrorText({ code: 'timeout' }), '整理失败：超时');
  assert.equal(C.testErrorText(await err(401)), '测试失败：API Key 无效');
  assert.equal(C.testErrorText(await err(403)), '测试失败：API Key 无效');
  assert.equal(C.testErrorText(await err(404)), '测试失败：接口地址或模型不对');
  assert.equal(C.testErrorText(await err(429)), '测试失败：HTTP 429');
  assert.equal(C.testErrorText({ code: 'timeout' }), '测试失败：超时');
  assert.equal(C.testErrorText({ code: 'network' }), '测试失败：连不上接口');
  await assert.rejects(ping({ configuration: { baseURL: 'https://a', model: 'm', apiKey: 'k' }, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), (e) => e.code === 'network');
});

test('PM：没有 Key 时提交不读取、不建记录', async () => {
  const d = tmp();
  const { createReaderController } = require('../electron/reader-main');
  const handlers = {};
  let windows = 0;
  const ctl = createReaderController({
    BrowserWindow: function () { windows += 1; throw new Error('不该打开网页'); },
    session: { fromPartition: () => { throw new Error('不该打开网页'); } },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    shell: {}, clipboard: {}, logger: null, E2E: false,
    root: path.join(d, 'read'), keyFile: path.join(d, 'reader-api-key'), prefs: memPrefs()
  });
  ctl.register();
  const r = await handlers['reader:submit'](null, 'https://example.com/a');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no-key');
  assert.equal(r.error, '还没配置大模型');
  assert.equal(ctl.store.list().length, 0);
  assert.equal(windows, 0);
  const t = await handlers['reader:testConfig'](null, { baseURL: 'http://a', model: 'm', apiKey: 'k' });
  assert.equal(t.ok, false); assert.equal(t.code, 'bad-url');
});
