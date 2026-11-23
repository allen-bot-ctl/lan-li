'use strict';
// 0.1.60 帮阅：主进程控制器（契约 docs/changes/0.1.60-reader.md 第 4、5 节）。
// 读取：隐藏 BrowserWindow 打开网页 → 注入内置 Readability 取正文；整理：reader-llm complete()；一次只跑 1 篇，其余排队。
const path = require('node:path');
const fs = require('node:fs');
const C = require('./reader-core');
const { complete } = require('./reader-llm');

const READ_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1500;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const NOT_PAGE = '暂不支持这种文件';
const NO_TEXT = '读不到正文（可能需要登录）';

let readabilitySrc = null;
function readability() {
  if (readabilitySrc == null) readabilitySrc = fs.readFileSync(path.join(__dirname, 'vendor', 'Readability.js'), 'utf8');
  return readabilitySrc;
}

function extractScript() {
  return `(function(){
${readability()}
;try{var doc=document.cloneNode(true);var a=new Readability(doc).parse();
if(a&&a.textContent&&a.textContent.trim().length>=${C.MIN_TEXT_CHARS})return {title:a.title||document.title||'',siteName:a.siteName||'',text:a.textContent};}catch(e){}
return {title:document.title||'',siteName:'',text:document.body?document.body.innerText:''};})()`;
}

function createReaderController(deps) {
  const { BrowserWindow, session, ipcMain, shell, clipboard, logger, E2E, root, keyFile, prefsFile, easylensDir } = deps;
  const store = C.createReaderStore({ root });
  const keys = C.createKeyStore({ file: keyFile, prefsFile, easylensDir });
  const queue = [];
  let running = null; // { id, abort }
  let fakeLlm = null; // e2e：{ status, points, delayMs, raw }
  const e2eOpen = [];
  const e2eStatusLog = [];

  function notify(m) {
    if (E2E && m) e2eStatusLog.push({ id: m.id, status: m.status });
    deps.onChanged && deps.onChanged(m);
  }
  function setStatus(id, patch) {
    const m = store.update(id, patch);
    notify(m);
    return m;
  }

  function readPage(url, signal) {
    return new Promise((resolve, reject) => {
      const ses = session.fromPartition('lanli-reader');
      let contentType = '';
      let httpCode = 0;
      let done = false;
      let win = null;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ses.webRequest.onHeadersReceived(null); } catch { /* ignore */ }
        try { ses.removeListener('will-download', onDownload); } catch { /* ignore */ }
        if (signal) signal.removeEventListener('abort', onAbort);
        try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
        fn(v);
      };
      const timer = setTimeout(() => finish(reject, new C.ReaderError('read', NO_TEXT)), READ_TIMEOUT_MS);
      const onAbort = () => finish(reject, new C.ReaderError('cancel', 'cancel'));
      const onDownload = (e) => { try { e.preventDefault(); } catch { /* ignore */ } finish(reject, new C.ReaderError('not-page', NOT_PAGE)); };
      if (signal) signal.addEventListener('abort', onAbort);
      ses.on('will-download', onDownload);
      ses.webRequest.onHeadersReceived((details, cb) => {
        if (details.resourceType === 'mainFrame') {
          const h = details.responseHeaders || {};
          const k = Object.keys(h).find((x) => x.toLowerCase() === 'content-type');
          contentType = k ? String([].concat(h[k])[0] || '') : '';
          httpCode = details.statusCode;
        }
        cb({ cancel: false });
      });
      win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true, offscreen: false, session: ses } });
      win.webContents.setAudioMuted(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.once('did-finish-load', () => {
        if (done) return;
        if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) { finish(reject, new C.ReaderError('not-page', NOT_PAGE)); return; }
        if (httpCode >= 400) { finish(reject, new C.ReaderError('read', NO_TEXT)); return; }
        setTimeout(() => {
          if (done) return;
          win.webContents.executeJavaScript(extractScript(), true)
            .then((r) => finish(resolve, r || {}))
            .catch(() => finish(reject, new C.ReaderError('read', NO_TEXT)));
        }, SETTLE_MS);
      });
      win.webContents.once('did-fail-load', (_e, code, _desc, _u, isMain) => {
        if (isMain === false || code === -3) return; // -3 = ERR_ABORTED（下载/跳转），等 will-download 或下一次加载
        finish(reject, new C.ReaderError('read', NO_TEXT));
      });
      win.loadURL(url, { userAgent: UA }).catch(() => { /* 由 did-fail-load / 超时处理 */ });
    });
  }

  function llmFetch() {
    if (!fakeLlm) return globalThis.fetch;
    return async (_url, opts) => {
      const f = fakeLlm;
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
        const text = C.normalizeText(page.text);
        if (text.replace(/\s/g, '').length < C.MIN_TEXT_CHARS) { setStatus(id, { status: 'error', error: NO_TEXT }); return; }
        store.saveText(id, text);
        store.update(id, { title: String(page.title || '').trim() || m.title || C.hostOf(m.url), site: String(page.siteName || '').trim() || C.hostOf(m.url) });
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
    if (!keys.config().apiKey) return { ok: false, code: 'no-key', error: '还没设置大模型 API Key' };
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
    if (!keys.config().apiKey) return { ok: false, code: 'no-key', error: '还没设置大模型 API Key' };
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
      if (!m || !C.validateUrl(m.url)) return false;
      if (E2E) { e2eOpen.push(m.url); return true; }
      shell.openExternal(m.url);
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
    ipcMain.handle('reader:importEasyLens', () => keys.importEasyLens());
  }

  return {
    store, keys, register, submit, retry, remove,
    e2e: {
      setFakeLlm: (f) => { fakeLlm = f || null; return true; },
      openCalls: () => e2eOpen.slice(),
      statusLog: () => e2eStatusLog.slice(),
      queueLength: () => queue.length + (running ? 1 : 0)
    }
  };
}

module.exports = { createReaderController };
