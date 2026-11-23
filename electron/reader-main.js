'use strict';
// 0.1.60 帮阅：主进程控制器（契约 docs/changes/0.1.60-reader.md 第 4、5 节）。
// 读取（PM 04:30 定稿）：隐藏 BrowserWindow（persist:reader 会话）渲染网页 → 页内同时跑 Defuddle 和 Readability，按链接密度选一份并转 Markdown；整理：reader-llm complete()；一次只跑 1 篇，其余排队。
const path = require('node:path');
const fs = require('node:fs');
const C = require('./reader-core');
const { complete, ping } = require('./reader-llm');

const READ_TIMEOUT_MS = 20_000; // 整个读取 20 秒
const LOAD_WAIT_MS = 8_000; // did-finish-load 最多等 8 秒
const WIN_CAP_MS = 15_000; // 从开始加载起总上限 15 秒，遇到 did-navigate 重新计时
const POLL_MS = 200;
const STABLE_MS = 800; // 正文长度连续 800ms 不变就抽取
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const NOT_PAGE = C.NOT_PAGE;
const NO_TEXT = C.NO_TEXT;
const BLOCK_TYPES = new Set(['image', 'media', 'font']);
const isHtmlType = (t) => !t || /text\/html|application\/xhtml/i.test(t);

// 页内抽取脚本：三个库的打包单文件读成字符串，用 executeJavaScriptInIsolatedWorld 注入（不用 script 标签，页面 CSP 拦不到，页面脚本也碰不到）
function libSource(spec) { return fs.readFileSync(require.resolve(spec), 'utf8'); }
let inpageScript = null;
function buildInpageScript() {
  if (inpageScript) return inpageScript;
  const defuddle = libSource('defuddle/full');
  const readability = libSource('@mozilla/readability/Readability.js');
  const turndown = libSource('turndown/lib/turndown.browser.umd.js');
  inpageScript = `(function(){
  var module = undefined, exports = undefined, define = undefined;
  var out = { contentType: document.contentType || '', title: document.title || '', df: null, rd: null, meta: {} };
  var chars = function (s) { return String(s || '').replace(/\\s/g, '').length; };
  var density = function (html) {
    try {
      var d = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
      var all = chars(d.body.textContent); if (!all) return 0;
      var a = 0; d.body.querySelectorAll('a').forEach(function (x) { a += chars(x.textContent); });
      return a / all;
    } catch (e) { return 0; }
  };
  try {
${defuddle}
    var D = (typeof Defuddle === 'function') ? Defuddle : (self.Defuddle && (self.Defuddle.default || self.Defuddle));
    var r = new D(document.cloneNode(true), { url: location.href, separateMarkdown: true }).parse();
    if (r) {
      out.df = { markdown: r.contentMarkdown || '', linkDensity: density(r.content), title: r.title || '', site: r.site || '', author: r.author || '', published: r.published || '' };
    }
  } catch (e) { out.dfError = String(e && e.message || e); }
  try {
${readability}
${turndown}
    var a = new Readability(document.cloneNode(true)).parse();
    if (a && a.content) {
      var TD = (typeof TurndownService === 'function') ? TurndownService : self.TurndownService;
      var td = new TD({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      td.remove(['script', 'style', 'noscript', 'iframe', 'img', 'picture', 'video', 'audio', 'svg']);
      out.rd = { markdown: td.turndown(a.content), linkDensity: density(a.content), title: a.title || '', site: a.siteName || '', author: a.byline || '', published: a.publishedTime || '' };
    }
  } catch (e) { out.rdError = String(e && e.message || e); }
  return out;
})()`;
  return inpageScript;
}

function createReaderController(deps) {
  const { BrowserWindow, session, ipcMain, shell, clipboard, logger, E2E, root, keyFile, prefs } = deps;
  const store = C.createReaderStore({ root });
  const keys = C.createKeyStore({ file: keyFile, prefs });
  const queue = [];
  let running = null; // { id, abort }
  let fakeLlm = null; // e2e：{ status, points, delayMs, raw }
  const e2eOpen = [];
  const e2eStatusLog = [];
  const e2eLlmCalls = [];

  function notify(m) {
    if (E2E && m) e2eStatusLog.push({ id: m.id, status: m.status });
    deps.onChanged && deps.onChanged(m);
  }
  function setStatus(id, patch) {
    const m = store.update(id, patch);
    notify(m);
    return m;
  }

  // 独立会话 persist:reader：屏蔽图片、视频、字体；下载一律取消
  let readerSession = null;
  let currentDownloadHandler = null;
  function getSession() {
    if (readerSession) return readerSession;
    const ses = session.fromPartition('persist:reader');
    ses.setUserAgent(UA, 'zh-CN,zh;q=0.9,en;q=0.8');
    ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: BLOCK_TYPES.has(d.resourceType) }));
    ses.on('will-download', (e, item) => {
      try { e.preventDefault(); } catch { /* ignore */ }
      try { item.cancel(); } catch { /* ignore */ }
      if (currentDownloadHandler) currentDownloadHandler();
    });
    readerSession = ses;
    return ses;
  }

  // 一次读取：等 did-finish-load（最多 8 秒）→ 正文长度连续 800ms 不变 → 页内抽取；总上限 15 秒（跳转重新计时）；整个 20 秒超时
  function renderOnce(url, signal) {
    return new Promise((resolve, reject) => {
      const ses = getSession();
      let done = false; let win = null; let cap = null; let poll = null; let loadWait = null; let hard = null;
      let started = false; let lastLen = -1; let stableSince = 0; let finalUrl = url; let mainType = '';
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(cap); clearTimeout(poll); clearTimeout(loadWait); clearTimeout(hard);
        currentDownloadHandler = null;
        if (signal) signal.removeEventListener('abort', onAbort);
        try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
        fn(v);
      };
      const fail = () => finish(resolve, { failed: true, finalUrl });
      const grab = () => {
        if (done) return;
        clearTimeout(poll);
        win.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: buildInpageScript() }], true).then((r) => {
          if (done) return;
          r = r || {};
          if (!isHtmlType(mainType) || !isHtmlType(r.contentType)) { finish(reject, new C.ReaderError('not-page', NOT_PAGE)); return; }
          finish(resolve, { ...r, finalUrl });
        }).catch((e) => { logger && logger.warn && logger.warn('reader', `extract ${e && e.message}`); fail(); });
      };
      const armCap = () => { clearTimeout(cap); cap = setTimeout(grab, WIN_CAP_MS); };
      const tick = () => {
        if (done) return;
        win.webContents.executeJavaScript('(document.body && document.body.innerText || "").length', true).then((len) => {
          if (done) return;
          const now = Date.now();
          if (len !== lastLen) { lastLen = len; stableSince = now; } else if (len > 0 && now - stableSince >= STABLE_MS) { grab(); return; }
          poll = setTimeout(tick, POLL_MS);
        }).catch(() => { if (!done) poll = setTimeout(tick, POLL_MS); });
      };
      const startPolling = () => {
        if (done || started) return;
        started = true; clearTimeout(loadWait); lastLen = -1; stableSince = Date.now();
        tick();
      };
      const onAbort = () => finish(reject, new C.ReaderError('cancel', 'cancel'));
      if (signal) signal.addEventListener('abort', onAbort);
      currentDownloadHandler = () => finish(reject, new C.ReaderError('not-page', NOT_PAGE));
      win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, images: false } });
      win.webContents.setAudioMuted(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e, u) => { if (!/^https?:/i.test(u)) e.preventDefault(); });
      win.webContents.on('will-redirect', (e, u) => { if (!/^https?:/i.test(u)) e.preventDefault(); });
      win.webContents.on('did-navigate', (_e, u) => {
        finalUrl = C.validateUrl(u) || finalUrl;
        started = false; clearTimeout(poll); armCap();
        clearTimeout(loadWait); loadWait = setTimeout(startPolling, LOAD_WAIT_MS);
      });
      win.webContents.on('did-finish-load', startPolling);
      win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => {
        if (isMain === false || code === -3) return;
        fail();
      });
      // 主文档的 content-type（PDF、图片等不是网页）
      const wcId = win.webContents.id;
      const onHeaders = (d) => {
        if (d.resourceType === 'mainFrame' && d.webContentsId === wcId) {
          const h = d.responseHeaders || {};
          const k = Object.keys(h).find((x) => x.toLowerCase() === 'content-type');
          mainType = k ? String([].concat(h[k])[0] || '') : '';
          if (!isHtmlType(mainType)) finish(reject, new C.ReaderError('not-page', NOT_PAGE));
        }
      };
      headerWatchers.add(onHeaders);
      const cleanup = () => headerWatchers.delete(onHeaders);
      win.on('closed', cleanup);
      hard = setTimeout(grab, READ_TIMEOUT_MS - 1000);
      setTimeout(() => { if (!done) fail(); }, READ_TIMEOUT_MS);
      armCap();
      win.loadURL(url).catch(() => { /* 由 did-fail-load / 上限处理 */ });
    });
  }
  const headerWatchers = new Set();
  let headersHooked = false;
  function hookHeaders() {
    if (headersHooked) return;
    headersHooked = true;
    getSession().webRequest.onHeadersReceived((d, cb) => { for (const f of headerWatchers) { try { f(d); } catch { /* ignore */ } } cb({}); });
  }

  // 失败（打不开/超时/没抽到东西）重试一次
  async function readPage(url, signal) {
    hookHeaders();
    let last = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal && signal.aborted) throw new C.ReaderError('cancel', 'cancel');
      const r = await renderOnce(url, signal);
      const pick = r.failed ? null : C.chooseExtraction(r.df, r.rd);
      if (pick) {
        const text = C.cleanMarkdown(pick.markdown);
        last = {
          text, finalUrl: r.finalUrl, extractor: pick.extractor,
          title: pick.title || r.title || '', site: pick.site || '', author: pick.author || '', published: pick.published || '',
          attempt
        };
        if (C.countChars(text) > 0) return last;
      }
    }
    return last || { text: '', finalUrl: url, title: '', site: '', author: '', published: '', extractor: '' };
  }

  function llmFetch() {
    if (!fakeLlm) return globalThis.fetch;
    return async (url, opts) => {
      const f = fakeLlm;
      try { const b = JSON.parse(opts.body); e2eLlmCalls.push({ url: String(url), model: b.model, ping: b.max_tokens === 1 }); } catch { /* ignore */ }
      if (f.delayMs) await new Promise((r) => setTimeout(r, f.delayMs));
      if (opts && opts.signal && opts.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      if (f.status && f.status !== 200) return { ok: false, status: f.status, json: async () => ({}) };
      const n = f.points || 5;
      const content = f.raw != null ? f.raw : JSON.stringify({ summary: '这是一句话总结。', points: Array.from({ length: n }, (_, i) => `要点 ${i + 1}`) });
      if (f.once) fakeLlm = f.once;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
    };
  }

  async function summarize(id, signal) {
    const m = store.get(id);
    const cfg = keys.config();
    if (!cfg.apiKey) throw Object.assign(new Error('no key'), { code: 'http', status: 401 });
    const raw = await complete({
      system: C.SYSTEM_PROMPT,
      user: C.buildUserMessage({ title: m.title, url: m.url, text: store.readText(id) }),
      configuration: cfg,
      fetchImpl: llmFetch(),
      signal
    });
    return { ...C.parseSummary(raw), model: cfg.model };
  }

  async function runOne(job) {
    const { id, reuseText } = job;
    const controller = new AbortController();
    running = { id, abort: () => controller.abort() };
    try {
      if (!reuseText) {
        const m = setStatus(id, { status: 'reading', error: null });
        if (!m) return;
        let page;
        try { page = await readPage(m.url, controller.signal); } catch (e) {
          if (controller.signal.aborted) return;
          setStatus(id, { status: 'error', error: e.code === 'not-page' ? NOT_PAGE : NO_TEXT });
          return;
        }
        if (controller.signal.aborted || !store.get(id)) return;
        const finalUrl = page.finalUrl || m.url;
        const blocked = C.blockedReason(finalUrl, page.text) || C.blockedReason(m.url, page.text);
        const chars = C.countChars(page.text);
        if (E2E) e2eStatusLog.push({ id, extractor: page.extractor, chars });
        logger && logger.info && logger.info('reader', `extract ${page.extractor || '-'} ${chars}`);
        if (blocked) { setStatus(id, { status: 'error', error: blocked, finalUrl }); return; }
        store.update(id, {
          text: page.text,
          finalUrl,
          chars,
          extractor: page.extractor,
          author: String(page.author || '').trim(),
          published: String(page.published || '').trim(),
          title: String(page.title || '').trim() || m.title || C.hostOf(finalUrl),
          site: String(page.site || '').trim() || C.hostOf(finalUrl)
        });
      }
      setStatus(id, { status: 'summarizing', error: null });
      let r;
      try { r = await summarize(id, controller.signal); } catch (e) {
        if (controller.signal.aborted || !store.get(id)) return;
        setStatus(id, { status: 'error', error: C.llmErrorText(e) });
        return;
      }
      if (controller.signal.aborted || !store.get(id)) return;
      const done = setStatus(id, { status: 'done', error: null, summary: r.summary, points: r.points, model: r.model });
      if (done && deps.onDone) deps.onDone(done);
    } catch (e) {
      logger && logger.warn && logger.warn('reader', String(e && e.message));
      if (store.get(id)) setStatus(id, { status: 'error', error: NO_TEXT });
    } finally {
      running = null;
      pump();
    }
  }

  function pump() {
    if (running || !queue.length) return;
    const job = queue.shift();
    runOne(job);
  }

  function submit(input) {
    const url = C.validateUrl(input);
    if (!url) return { ok: false, code: 'invalid-url', error: '请输入以 http:// 或 https:// 开头的网址' };
    const existing = store.findDone(url);
    if (existing) return { ok: true, dup: true, id: existing.id };
    if (!keys.config().apiKey) return { ok: false, code: 'no-key', error: C.NO_KEY };
    const id = C.newId();
    store.save({ id, url, title: C.hostOf(url), site: C.hostOf(url), createdMs: Date.now(), status: 'queued', error: null, summary: '', points: [], model: '' });
    notify(store.get(id));
    queue.push({ id });
    pump();
    return { ok: true, id };
  }

  function retry(id, reuseText = false) {
    const m = store.get(id);
    if (!m) return { ok: false };
    if (running && running.id === id) return { ok: false };
    if (!keys.config().apiKey) return { ok: false, code: 'no-key', error: C.NO_KEY };
    const hasText = Boolean(store.readText(id));
    store.update(id, { status: 'queued', error: null });
    notify(store.get(id));
    queue.push({ id, reuseText: reuseText && hasText });
    pump();
    return { ok: true };
  }

  function remove(id) {
    const qi = queue.findIndex((j) => j.id === id);
    if (qi >= 0) queue.splice(qi, 1);
    if (running && running.id === id) running.abort();
    store.remove(id);
    notify(null);
    return true;
  }

  // 「测试连接」：用当前填的值（Key 留空用已保存的）；结果只回文案，不回 Key
  async function testConfig(input) {
    const r = keys.resolve(input);
    if (!r.ok) return { ok: false, code: r.code, error: r.error };
    if (!r.apiKey) return { ok: false, code: 'no-key', error: '测试失败：还没填 API Key' };
    try {
      await ping({ configuration: { baseURL: r.baseURL, model: r.model, apiKey: r.apiKey }, fetchImpl: llmFetch() });
      return { ok: true, text: '测试通过' };
    } catch (e) {
      return { ok: false, code: e && e.code, error: C.testErrorText(e) };
    }
  }

  function register() {
    store.recover();
    ipcMain.handle('reader:list', () => store.list());
    ipcMain.handle('reader:get', (_e, id) => store.get(id));
    ipcMain.handle('reader:submit', (_e, url) => submit(url));
    ipcMain.handle('reader:retry', (_e, id) => retry(id, false));
    ipcMain.handle('reader:resummarize', (_e, id) => retry(id, true));
    ipcMain.handle('reader:remove', (_e, id) => remove(id));
    ipcMain.handle('reader:openOriginal', (_e, id) => {
      const m = store.get(id);
      const target = m && (C.validateUrl(m.finalUrl) || C.validateUrl(m.url));
      if (!target) return false;
      if (E2E) { e2eOpen.push(target); return true; }
      shell.openExternal(target);
      return true;
    });
    ipcMain.handle('reader:copy', (_e, id) => {
      const m = store.get(id);
      if (!m || m.status !== 'done') return false;
      clipboard.writeText(C.toMarkdown(m));
      return true;
    });
    ipcMain.handle('reader:clipboardUrl', () => {
      const t = String(clipboard.readText() || '').trim();
      return /^\S+$/.test(t) && C.validateUrl(t) ? t : '';
    });
    ipcMain.handle('reader:getConfig', () => keys.getPublic());
    ipcMain.handle('reader:saveConfig', (_e, c) => keys.save(c || {}));
    ipcMain.handle('reader:removeKey', () => keys.removeKey());
    ipcMain.handle('reader:testConfig', (_e, c) => testConfig(c || {}));
  }

  return {
    store, keys, register, submit, retry, remove,
    e2e: {
      setFakeLlm: (f) => { fakeLlm = f || null; return true; },
      openCalls: () => e2eOpen.slice(),
      llmCalls: () => e2eLlmCalls.slice(),
      statusLog: () => e2eStatusLog.slice(),
      queueLength: () => queue.length + (running ? 1 : 0),
      readPage: (u) => readPage(u)
    }
  };
}

module.exports = { createReaderController };
