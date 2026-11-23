'use strict';
// 0.1.60 帮阅：主进程控制器（契约 docs/changes/0.1.60-reader.md 第 4、5 节）。
// 读取：隐藏 BrowserWindow 打开网页取 HTML → 主进程 linkedom + 内置 Readability 去杂讯取正文；整理：reader-llm complete()；一次只跑 1 篇，其余排队。
const path = require('node:path');
const fs = require('node:fs');
const C = require('./reader-core');
const { complete } = require('./reader-llm');

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 2 * 1024 * 1024;
const WIN_CAP_MS = 15_000; // 隐藏窗口总上限，遇到 did-navigate 重新计时
const POLL_MS = 500;
const STABLE_EXTRA_MS = 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const NOT_PAGE = C.NOT_PAGE;
const NO_TEXT = C.NO_TEXT;
const READABILITY_SRC = fs.readFileSync(path.join(__dirname, 'vendor', 'Readability.js'), 'utf8')
  .replace(/\nif \(typeof module === "object"\) \{[\s\S]*$/, '\n');
// 隐藏窗口兜底：用 executeJavaScript 注入 Readability（不用 script 标签，避开页面 CSP），在渲染后的 DOM 上取正文
const INPAGE_SCRIPT = `(function(){
  var out = { html: '', contentType: document.contentType || '', title: document.title || '', siteName: '', content: '' };
  try {
${READABILITY_SRC}
    var a = new Readability(document.cloneNode(true)).parse();
    if (a) { out.title = a.title || out.title; out.siteName = a.siteName || ''; out.content = a.content || ''; }
  } catch (e) {}
  if (!out.content) { try { out.html = document.documentElement.outerHTML; } catch (e) {} }
  return out;
})()`;
const isHtmlType = (t) => !t || /text\/html|application\/xhtml/i.test(t);

function createReaderController(deps) {
  const { BrowserWindow, session, ipcMain, shell, clipboard, logger, E2E, root, keyFile, prefsFile, easylensDir } = deps;
  const store = C.createReaderStore({ root });
  const keys = C.createKeyStore({ file: keyFile, easylensDir });
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

  // 第一级：net.fetch 取 HTML（20 秒、最多 2MB），主进程 linkedom + Readability 去杂讯
  async function fetchPage(url, signal) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    if (signal) signal.addEventListener('abort', onAbort);
    try {
      const doFetch = deps.netFetch || ((u, o) => session.fromPartition('lanli-reader').fetch(u, o));
      const res = await doFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, redirect: 'follow', signal: ctl.signal });
      const finalUrl = C.validateUrl(res.url) || url;
      const type = res.headers.get('content-type') || '';
      if (!isHtmlType(type)) { try { ctl.abort(); } catch { /* ignore */ } throw new C.ReaderError('not-page', NOT_PAGE); }
      const chunks = []; let size = 0;
      if (res.body && res.body.getReader) {
        const rd = res.body.getReader();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          size += value.byteLength; chunks.push(Buffer.from(value));
          if (size >= FETCH_MAX_BYTES) { try { await rd.cancel(); } catch { /* ignore */ } break; }
        }
      } else {
        chunks.push(Buffer.from(await res.arrayBuffer()));
      }
      const buf = Buffer.concat(chunks).subarray(0, FETCH_MAX_BYTES);
      const cs = (/charset=([\w-]+)/i.exec(type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
      let html;
      try { html = new TextDecoder(cs || 'utf-8').decode(buf); } catch { html = buf.toString('utf8'); }
      const main = C.extractMain(html, finalUrl);
      return { ...main, finalUrl, httpStatus: res.status };
    } catch (e) {
      if (e && e.code === 'not-page') throw e;
      if (signal && signal.aborted) throw new C.ReaderError('cancel', 'cancel');
      return { title: '', siteName: '', text: '', finalUrl: url, httpStatus: 0 };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  // 第二级兜底：隐藏窗口渲染。did-finish-load 后每 500ms 看 body.innerText 长度，连续两次变化 <5% 算稳定，再等 1 秒；
  // 总上限 15 秒，did-navigate 重新计时。
  function renderPage(url, signal) {
    return new Promise((resolve, reject) => {
      const ses = session.fromPartition('lanli-reader');
      let done = false; let win = null; let cap = null; let poll = null; let loaded = false;
      let lastLen = -1; let stableHits = 0; let finalUrl = url;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(cap); clearTimeout(poll);
        try { ses.removeListener('will-download', onDownload); } catch { /* ignore */ }
        if (signal) signal.removeEventListener('abort', onAbort);
        try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
        fn(v);
      };
      const grab = () => {
        if (done) return;
        win.webContents.executeJavaScript(INPAGE_SCRIPT, true).then((r) => {
          if (done) return;
          r = r || {};
          if (!isHtmlType(r.contentType)) { finish(reject, new C.ReaderError('not-page', NOT_PAGE)); return; }
          let text = r.content ? C.normalizeText(C.htmlToText(r.content)) : '';
          let title = r.title; let siteName = r.siteName;
          if (!text && r.html) { const m = C.extractMain(r.html, finalUrl); text = m.text; title = title || m.title; siteName = siteName || m.siteName; }
          finish(resolve, { title, siteName: siteName || C.hostOf(finalUrl), text, finalUrl });
        }).catch(() => finish(resolve, { title: '', siteName: '', text: '', finalUrl }));
      };
      const armCap = () => { clearTimeout(cap); cap = setTimeout(grab, WIN_CAP_MS); };
      const tick = () => {
        if (done || !loaded) return;
        win.webContents.executeJavaScript('(document.body && document.body.innerText || "").length', true).then((len) => {
          if (done) return;
          const changed = lastLen < 0 ? 1 : Math.abs(len - lastLen) / Math.max(lastLen, 1);
          lastLen = len;
          stableHits = changed < 0.05 ? stableHits + 1 : 0;
          if (stableHits >= 2) { poll = setTimeout(grab, STABLE_EXTRA_MS); return; }
          poll = setTimeout(tick, POLL_MS);
        }).catch(() => { if (!done) poll = setTimeout(tick, POLL_MS); });
      };
      const onAbort = () => finish(reject, new C.ReaderError('cancel', 'cancel'));
      const onDownload = (e) => { try { e.preventDefault(); } catch { /* ignore */ } finish(reject, new C.ReaderError('not-page', NOT_PAGE)); };
      if (signal) signal.addEventListener('abort', onAbort);
      ses.on('will-download', onDownload);
      win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true, session: ses } });
      win.webContents.setAudioMuted(true);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e, u) => { if (!/^https?:/i.test(u)) e.preventDefault(); });
      win.webContents.on('did-navigate', (_e, u) => {
        finalUrl = C.validateUrl(u) || finalUrl;
        loaded = false; lastLen = -1; stableHits = 0; clearTimeout(poll); armCap();
      });
      win.webContents.on('did-finish-load', () => {
        if (done) return;
        loaded = true; lastLen = -1; stableHits = 0; clearTimeout(poll);
        poll = setTimeout(tick, POLL_MS);
      });
      win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => {
        if (isMain === false || code === -3) return;
        finish(resolve, { title: '', siteName: '', text: '', finalUrl });
      });
      armCap();
      win.loadURL(url, { userAgent: UA }).catch(() => { /* 由 did-fail-load / 上限处理 */ });
    });
  }

  async function readPage(url, signal) {
    const first = await fetchPage(url, signal);
    if (C.countChars(first.text) >= C.MIN_TEXT_CHARS && !C.blockedReason(first.finalUrl, first.text)) return { ...first, level: 1 };
    if (signal && signal.aborted) throw new C.ReaderError('cancel', 'cancel');
    const second = await renderPage(first.finalUrl || url, signal);
    // 两级取更长的那份
    return C.countChars(second.text) >= C.countChars(first.text) ? { ...second, level: 2 } : { ...first, level: 1 };
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
        const finalUrl = page.finalUrl || m.url;
        const blocked = C.blockedReason(finalUrl, page.text) || C.blockedReason(m.url, page.text);
        if (E2E) e2eStatusLog.push({ id, level: page.level, chars: C.countChars(page.text) });
        if (blocked) { setStatus(id, { status: 'error', error: blocked, finalUrl }); return; }
        store.update(id, {
          text: page.text,
          finalUrl,
          title: String(page.title || '').trim() || m.title || C.hostOf(finalUrl),
          site: String(page.siteName || '').trim() || C.hostOf(finalUrl)
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
