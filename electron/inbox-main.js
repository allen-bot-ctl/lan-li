'use strict';
// 0.1.42 收纳：主进程部分（接纳框窗口、托盘拖拽事件、落盘、列表 IPC）。
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { createInboxStore, classifyDrop, classifyClipboard, captureLabel, imgSources, htmlToPlain, MAX_IMAGE_BYTES, InboxError } = require('./inbox-store');
const Q = require('./renderer/inbox-query');
const { manualCaptureItem } = require('./manual-capture');
const { capturePreview } = require('./inbox-capture-preview');
const UNDO_MS = 5000;

const DZ_W = 240;
const DZ_H = 120;
const DZ_GAP = 6;
const LEAVE_HIDE_MS = 1200;
const SUCCESS_HIDE_MS = 1200;
const ERROR_HIDE_MS = 2000;
const TEXT_IDLE = '拖到这里，放进收纳';
const TEXT_UNSUPPORTED = '这个内容暂时收不进来';
const TEXT_CLIP_EMPTY = '剪贴板里没有可收纳的内容';
const TEXT_CLIP_DUP = '已经收过了';
const CLIP_DUP_MS = 3000;

function xmlUnescape(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
// 只返回收纳弹窗需要的短预览和类型，不返回完整正文或路径。
function captureItems(saved) {
  return saved.slice(0, 2).map((m) => ({ preview: capturePreview(m), type: m.type, rich: !!m.rich }));
}

function fileUrlPath(u) { try { return /^file:/i.test(u) ? decodeURIComponent(new URL(String(u).trim()).pathname).replace(/\/$/, '') : ''; } catch { return ''; } }

// 按快捷键那一刻最前面的应用名（系统自带 lsappinfo，无需授权）。
function frontAppName() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve('');
    execFile('/bin/sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeout: 800 }, (err, out) => {
      if (err) return resolve('');
      const m = /"(?:LSDisplayName|name)"\s*=\s*"([^"]+)"/i.exec(String(out || ''));
      resolve(m ? m[1] : '');
    });
  });
}

// 接纳框贴在托盘图标正下方 6px，水平居中，贴屏幕右缘时左移。
function computeDropzoneBounds(trayBounds, workArea) {
  const tb = trayBounds; const wa = workArea;
  let x = Math.round(tb.x + tb.width / 2 - DZ_W / 2);
  x = Math.min(x, wa.x + wa.width - DZ_W - 4);
  x = Math.max(x, wa.x + 4);
  const y = Math.round(tb.y + tb.height + DZ_GAP);
  return { x, y, width: DZ_W, height: DZ_H };
}

function errorText(error) {
  const code = error && error.code;
  if (code === 'ENOSPC') return '保存失败，磁盘空间不足';
  if (code === 'too-many') return '一次最多收 50 项';
  if (code === 'too-large') return '图片超过 50MB，收不进来';
  if (code === 'empty' || code === 'unsupported') return TEXT_UNSUPPORTED;
  return '保存失败，请再试一次';
}

function extFromMime(mime, url) {
  const m = /image\/(png|jpe?g|gif|webp|heic|bmp|tiff)/i.exec(String(mime || ''));
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  const u = /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)(\?|#|$)/i.exec(String(url || ''));
  return u ? u[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

function createInboxController(deps) {
  const { BrowserWindow, screen, nativeImage, net, shell, Menu, ipcMain, logger, clipboard, dialog } = deps;
  const E2E = Boolean(deps.E2E);
  const store = createInboxStore({
    root: deps.root,
    documentFormat: true,
    validPastedRaster: (bytes, width, height) => {
      try {
        const image = nativeImage.createFromBuffer(bytes);
        const size = image.getSize();
        return !image.isEmpty() && size.width === width && size.height === height;
      } catch { return false; }
    },
    migrateFailAt: E2E ? Number(process.env.LANLI_E2E_MIGRATE_FAIL_AT) || 0 : 0,
    makeThumb: (src, dest) => {
      let img = nativeImage.createFromPath(src);
      if (img.isEmpty()) return;
      const { width, height } = img.getSize();
      if (Math.max(width, height) > 320) img = img.resize(width >= height ? { width: 320 } : { height: 320 });
      fs.writeFileSync(dest, img.toJPEG(80));
    }
  });
  try { store.cleanup(); } catch { /* ignore */ }
  // 0.1.56：建标签库（备忘/重要/临时）并把老的字符串标签迁成 ID（幂等，改写前备份 meta.json）。
  try { const r = store.migrateTags(); if (r.migrated || r.failed || r.seeded) console.log('[inbox] tags migrate', JSON.stringify(r)); } catch (error) { console.error('[inbox] tags migrate failed', error.message); }

  let win = null;
  let visible = false;
  let state = { state: 'idle', text: TEXT_IDLE };
  let hideTimer = null;
  let busy = false;
  let lastSaved = [];
  let e2eOpenCalls = [];
  let lastDropPayload = null;
  let lastClip = { hash: '', at: 0 };
  let e2eClipboard = null;   // E2E 注入的剪贴板内容
  let e2eCopyCalls = [];
  let e2eRelinkPath = null;
  const purgeTimers = new Map();

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: DZ_W, height: DZ_H, show: false, frame: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, transparent: true, hasShadow: true, roundedCorners: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'dropzone-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, 'renderer', 'dropzone.html'));
    win.on('closed', () => { win = null; visible = false; });
    return win;
  }

  function send(s) {
    state = s;
    if (win && !win.isDestroyed()) win.webContents.send('drop:state', s);
  }

  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  function scheduleHide(ms) { cancelHide(); hideTimer = setTimeout(hide, ms); }

  function show(o) {
    cancelHide();
    const w = ensureWindow();
    const tray = deps.getTray();
    if (tray && screen) {
      const tb = tray.getBounds();
      const area = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).workArea;
      w.setBounds(computeDropzoneBounds(tb, area));
    }
    if (!busy) send({ state: 'idle', text: TEXT_IDLE });
    if (!visible) { w.showInactive(); visible = true; }
    // 0.1.49：面板里收纳时提示框不收起日历面板
    if (deps.onShow && !(o && o.keepCalendar)) deps.onShow();
  }

  function hide() {
    cancelHide();
    visible = false;
    if (win && !win.isDestroyed()) win.hide();
    send({ state: 'idle', text: TEXT_IDLE });
  }

  async function fetchImage(url) {
    if (/^data:/i.test(url)) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(url);
      if (!m) throw new InboxError('unsupported', 'bad data url');
      const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      return { buffer, ext: extFromMime(m[1], '') };
    }
    if (/^file:/i.test(url)) {
      const p = decodeURIComponent(new URL(url).pathname);
      return { buffer: fs.readFileSync(p), ext: extFromMime('', p) };
    }
    if (!/^https?:/i.test(url)) throw new InboxError('unsupported', 'unsupported url');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await net.fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) throw new InboxError('too-large', 'too large');
      return { buffer, ext: extFromMime(res.headers.get('content-type'), url) };
    } finally { clearTimeout(t); }
  }

  // 富文本里的图片下载下来单独存；下载失败的保留原链接。
  async function resolveItems(items) {
    const out = [];
    for (const it of items) {
      if (it.kind === 'image' && it.url) {
        try { out.push({ kind: 'image', url: it.url, ...(await fetchImage(it.url)) }); }
        catch (error) { if (error.code === 'too-large') throw error; out.push({ kind: 'link', url: /^https?:/i.test(it.url) ? it.url : '', title: '' }); }
        continue;
      }
      if (it.kind === 'text' && it.html) {
        const images = [];
        for (const src of [...new Set(imgSources(it.html))]) {
          try { images.push({ src, ...(await fetchImage(src)) }); } catch { /* 保留原链接 */ }
        }
        out.push({ ...it, images });
        continue;
      }
      out.push(it);
    }
    return out.filter((it) => it.kind !== 'link' || it.url);
  }

  async function handleDrop(payload) {
    lastDropPayload = payload || null;
    cancelHide();
    busy = true;
    if (!visible) show();
    try {
      const items = await resolveItems(classifyDrop(payload));
      lastSaved = store.saveAll(items, { via: "drag" });
      send({ state: 'success', text: `已收纳 ${lastSaved.length} 项`, sub: '点开查看' });
      if (deps.onChanged) deps.onChanged();
      scheduleHide(SUCCESS_HIDE_MS);
      return { ok: true, count: lastSaved.length, ids: lastSaved.map((m) => m.id) };
    } catch (error) {
      const p = payload || {};
      if (logger) logger.warn('[栏历] 收纳失败：' + (error && error.message) + ` (files=${(p.files || []).length}/${p.fileCount == null ? '-' : p.fileCount} html=${(p.html || '').length} text=${(p.text || '').length} uriList=${(p.uriList || []).length})`);
      send({ state: 'error', text: errorText(error) });
      scheduleHide(ERROR_HIDE_MS);
      return { ok: false, text: errorText(error) };
    } finally {
      busy = false;
    }
  }

  // 0.1.49 读剪贴板：文件（多个走 NSFilenamesPboardType）、位图、HTML、纯文本。
  function readClipboard() {
    if (e2eClipboard) {
      const c = e2eClipboard;
      return { files: c.files || [], html: c.html || '', text: c.text || '', image: c.imageBase64 ? { buffer: Buffer.from(c.imageBase64, 'base64'), ext: 'png' } : null };
    }
    let files = [];
    try {
      const plist = clipboard.read('NSFilenamesPboardType');
      if (plist) files = Array.from(plist.matchAll(/<string>([^<]*)<\/string>/g)).map((m) => xmlUnescape(m[1])).filter(Boolean);
    } catch { /* ignore */ }
    if (!files.length) {
      try { const p = fileUrlPath(clipboard.read('public.file-url')); if (p) files = [p]; } catch { /* ignore */ }
    }
    let image = null;
    try { const img = clipboard.readImage(); if (img && !img.isEmpty()) image = { buffer: img.toPNG(), ext: 'png' }; } catch { /* ignore */ }
    return { files, html: clipboard.readHTML() || '', text: clipboard.readText() || '', image };
  }

  function clipHash(c) {
    const h = crypto.createHash('sha1');
    h.update(JSON.stringify([c.files, c.html, c.text]));
    if (c.image) h.update(c.image.buffer);
    return h.digest('hex');
  }

  // 三个入口（全局快捷键、面板 ⌘V/按钮、托盘菜单）都走这里。
  async function captureClipboard(opts) {
    const o = opts || {};
    const sourceApp = o.via === 'hotkey' ? (o.sourceApp != null ? o.sourceApp : await frontAppName()) : '';
    // 0.1.57：收纳页里粘贴不弹托盘提示框（它盖住日历顶部会触发 pointer-leave 收起窗口），结果交给窗口内 toast
    const panel = o.via === 'panel';
    const tell = (msg, ms) => { if (panel) return; send(msg); scheduleHide(ms); };
    if (!panel) { cancelHide(); if (!visible) show({}); }
    const c = readClipboard();
    const items = classifyClipboard(c);
    if (!items.length) {
      tell({ state: 'error', text: TEXT_CLIP_EMPTY }, ERROR_HIDE_MS);
      return { ok: false, kind: 'empty', text: TEXT_CLIP_EMPTY };
    }
    const hash = clipHash(c);
    const t = Date.now();
    if (hash === lastClip.hash && t - lastClip.at < CLIP_DUP_MS) {
      lastClip.at = t;
      tell({ state: 'success', text: TEXT_CLIP_DUP, sub: '点开查看' }, SUCCESS_HIDE_MS);
      return { ok: true, dup: true, count: 0, text: TEXT_CLIP_DUP };
    }
    busy = true;
    try {
      const resolved = await resolveItems(items);
      const app = sourceApp && !/^(栏历|LanLi|Electron)$/i.test(sourceApp) ? sourceApp : '';
      lastSaved = store.saveAll(resolved, { via: 'clipboard', ...(app ? { sourceApp: app } : {}) });
      lastClip = { hash, at: t };
      const label = captureLabel(items);
      if (deps.onChanged) deps.onChanged();
      tell({ state: 'success', text: `已收纳 · ${label}`, sub: '点开查看' }, SUCCESS_HIDE_MS);
      return { ok: true, count: lastSaved.length, label, text: `已收纳 · ${label}`, ids: lastSaved.map((m) => m.id), items: panel ? captureItems(lastSaved) : undefined };
    } catch (error) {
      if (logger) logger.warn('[栏历] 剪贴板收纳失败：' + (error && error.message));
      const unsupported = error && (error.code === 'empty' || error.code === 'unsupported');
      const text = unsupported ? TEXT_CLIP_EMPTY : errorText(error);
      tell({ state: 'error', text }, ERROR_HIDE_MS);
      return { ok: false, kind: unsupported ? 'empty' : 'error', text };
    } finally {
      busy = false;
    }
  }

  // 0.1.62 收纳页「录入」：手动输入的纯文字，和粘贴文字走同一个入库函数（addText），meta.via = 'manual'
  const MANUAL_MAX = 20000;
  function addManual(input) {
    const text = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
    if (!text.trim()) return { ok: false, kind: 'empty', text: '内容不能为空' };
    if ([...text].length > MANUAL_MAX) return { ok: false, kind: 'too-long', text: `最多 ${MANUAL_MAX} 字` };
    try {
      lastSaved = store.saveAll([manualCaptureItem(text)], { via: 'manual' });
      if (deps.onChanged) deps.onChanged();
      return { ok: true, count: lastSaved.length, text: '已收纳', ids: lastSaved.map((m) => m.id), items: captureItems(lastSaved) };
    } catch (error) {
      if (logger) logger.warn('[栏历] 录入失败：' + (error && error.message));
      return { ok: false, kind: 'error', text: errorText(error) };
    }
  }

  // 0.1.50 框选收纳：截好的 PNG 存为图片条目（via=region），接纳框成功态。
  async function saveRegionImage(o) {
    const app = o.sourceApp && !/^(栏历|LanLi|Electron)$/i.test(o.sourceApp) ? o.sourceApp : '';
    cancelHide();
    if (!visible) show({ keepCalendar: true });
    busy = true;
    try {
      lastSaved = store.saveAll([{ kind: 'image', buffer: o.buffer, ext: 'png', name: '框选图片' }], { via: 'region', ...(app ? { sourceApp: app } : {}), ...(o.width ? { width: o.width, height: o.height } : {}) });
      send({ state: 'success', text: '已收纳 · 框选图片', sub: '点开查看' });
      if (deps.onChanged) deps.onChanged();
      scheduleHide(SUCCESS_HIDE_MS);
      return { ids: lastSaved.map((m) => m.id) };
    } catch (error) {
      send({ state: 'error', text: errorText(error) });
      scheduleHide(ERROR_HIDE_MS);
      throw error;
    } finally {
      busy = false;
    }
  }

  function showError(text) { cancelHide(); if (!visible) show({ keepCalendar: true }); send({ state: 'error', text }); scheduleHide(ERROR_HIDE_MS); }

  function openEntry(id) {
    const e = store.get(id);
    const m = e.meta;
    if (m.type === 'file') {
      if (m.missing) return { ok: false, missing: true };
      if (E2E) { e2eOpenCalls.push({ how: 'openPath', target: e.filePath }); return { ok: true }; }
      shell.openPath(e.filePath);
      return { ok: true };
    }
    if (m.type === 'image') {
      if (E2E) { e2eOpenCalls.push({ how: 'openPath', target: e.filePath }); return { ok: true }; }
      shell.openPath(e.filePath);
      return { ok: true };
    }
    if (m.type === 'link') {
      const url = m.targetUrl || m.sourceUrl;
      if (!/^https?:/i.test(url || '')) return { ok: false };
      if (E2E) { e2eOpenCalls.push({ how: 'openExternal', target: url }); return { ok: true }; }
      shell.openExternal(url);
      return { ok: true };
    }
    if (e.document) {
      const attachments = documentAttachments(e);
      return { ok: true, html: materializeDocumentHtml(e.html, attachments), title: m.displayTitle || m.title,
        document: e.document, attachments, revision: e.revision };
    }
    // 旧正文继续使用现有 sandbox iframe；不会被转换或改写。
    let html = e.html;
    for (const a of m.assets || []) {
      try { html = html.split(a).join(dataUrl(path.join(e.dir, a))); } catch { /* 缺图就留相对路径 */ }
    }
    return { ok: true, html, title: m.displayTitle || m.title, revision: store.readEdit(id).revision };
  }

  function reveal(id) {
    const e = store.get(id);
    // 0.1.59：只有没丢失的文件类才在 Finder 中显示
    if (!e || !e.meta || e.meta.type !== 'file' || e.meta.missing) return false;
    const target = e.meta.sourcePath;
    if (E2E) { e2eOpenCalls.push({ how: 'showItemInFolder', target }); return true; }
    shell.showItemInFolder(target);
    return true;
  }

  function documentAttachments(e) {
    const approved = new Set(e.assets);
    const found = Object.create(null);
    function collect(node) {
      const src = node.type === 'image' && node.attrs?.src;
      if (src && approved.has(src) && !Object.hasOwn(found, src)) {
        try {
          const file = path.join(e.dir, src);
          const st = fs.lstatSync(file);
          if (st.isFile() && st.size <= MAX_IMAGE_BYTES) found[src] = dataUrl(file);
        } catch { /* Preserve document; a missing file may be shown as unavailable. */ }
      }
      for (const child of node.content || []) collect(child);
    }
    collect(e.document);
    return found;
  }

  function materializeDocumentHtml(html, attachments) {
    return html.replace(/<img\b[^>]*>/gi, (image) => image.replace(/\bsrc="([^"]+)"/i,
      (whole, src) => attachments[src] ? `src="${attachments[src]}"` : whole));
  }

  function dataUrl(file) {
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  }

  function listForRenderer() {
    return store.list().map((m) => {
      let thumb = null;
      try {
        if (m.thumb) thumb = dataUrl(path.join(store.root, m.id, m.thumb));
        else if (m.type === 'image' && m.size < 2 * 1024 * 1024) thumb = dataUrl(path.join(store.root, m.id, m.file));
      } catch { thumb = null; }
      return { ...m, thumb };
    });
  }

  function changed() { if (deps.onChanged) deps.onChanged(); }

  // B 段：删除可撤销（5 秒内），之后才真正删掉条目目录；原文件永远不动。
  function removeWithUndo(id) {
    store.trash(id);
    if (purgeTimers.has(id)) clearTimeout(purgeTimers.get(id));
    purgeTimers.set(id, setTimeout(() => { purgeTimers.delete(id); try { store.purge(id); } catch { /* ignore */ } }, UNDO_MS));
    changed();
    return true;
  }
  function undoRemove(id) {
    if (purgeTimers.has(id)) { clearTimeout(purgeTimers.get(id)); purgeTimers.delete(id); }
    const ok = store.restore(id);
    changed();
    return ok;
  }

  function addTag(id, tag) {
    try { const meta = store.addTag(id, tag); changed(); return { ok: true, tags: meta.tags }; }
    catch (error) { return { ok: false, code: error.code, text: error.message }; }
  }
  function removeTag(tag) { const n = store.removeTagEverywhere(tag); changed(); return n; }
  // 0.1.56 标签管理
  function tagResult(fn) {
    try { const value = fn(); changed(); return { ok: true, value, tags: store.listTags() }; }
    catch (error) { return { ok: false, code: error.code, text: error.message, existing: error.existing }; }
  }
  function listTags() { return store.listTags(); }
  function createTag(name) { return tagResult(() => store.createTag(name)); }
  function renameTag(id, name) { return tagResult(() => store.renameTag(id, name)); }
  function deleteTag(idOrName) { return tagResult(() => store.deleteTag(idOrName)); }

  // 复制：文件复制路径、图片复制图片、文字复制富文本、链接复制 URL
  function copyEntry(id) {
    const e = store.get(id);
    const m = e.meta;
    let call;
    if (m.type === 'file') { call = { kind: 'text', text: m.sourcePath || '' }; clipboard.writeText(call.text); }
    else if (m.type === 'image') { call = { kind: 'image', file: e.filePath }; clipboard.writeImage(nativeImage.createFromPath(e.filePath)); }
    else if (m.type === 'text') {
      call = { kind: 'html', text: e.text ?? e.meta.edit?.text ?? htmlToPlain(e.html) };
      clipboard.write({ html: e.document ? materializeDocumentHtml(e.html, documentAttachments(e)) : e.html, text: call.text });
    }
    else { call = { kind: 'text', text: m.targetUrl || m.sourceUrl || '' }; clipboard.writeText(call.text); }
    e2eCopyCalls.push({ id, type: m.type, ...call });
    return { ok: true, kind: call.kind };
  }

  async function relink(id, event) {
    let picked = null;
    if (E2E) picked = e2eRelinkPath;
    else {
      const parent = event && BrowserWindow.fromWebContents(event.sender);
      const r = await dialog.showOpenDialog(parent || undefined, { title: '重新指定原文件', properties: ['openFile', 'openDirectory'] });
      if (!r.canceled && r.filePaths && r.filePaths[0]) picked = r.filePaths[0];
    }
    if (!picked) return { ok: false, canceled: true };
    try { store.relink(id, picked); changed(); return { ok: true }; }
    catch (error) { return { ok: false, text: '没能重新指定：' + error.message }; }
  }

  function days() { return [...new Set(Q.scopeEntries(store.list()).map((m) => Q.entryDayKey(m)))]; }
  // 0.1.55：每天的收纳条数，日历圆点悬停显示「收纳 N 条」
  function dayCounts() {
    const counts = {};
    for (const m of Q.scopeEntries(store.list())) { const k = Q.entryDayKey(m); counts[k] = (counts[k] || 0) + 1; }
    return counts;
  }

  function register() {
    ipcMain.on('drop:enter', () => { cancelHide(); });
    ipcMain.on('drop:leave', () => { if (!busy && state.state !== 'success' && state.state !== 'error') scheduleHide(LEAVE_HIDE_MS); });
    ipcMain.on('drop:data', (_e, payload) => { handleDrop({ ...(payload || {}), via: 'drag' }); });
    ipcMain.handle('inbox:addManual', (_e, text) => addManual(text));
    ipcMain.handle('inbox:captureClipboard', () => captureClipboard({ via: 'panel' }));
    ipcMain.on('drop:openInbox', () => { hide(); if (deps.openInbox) deps.openInbox(); });
    ipcMain.handle('inbox:list', () => listForRenderer());
    ipcMain.handle('inbox:setArchived', (_e, id, archived) => {
      if (typeof id !== 'string' || typeof archived !== 'boolean') return { ok: false, text: '归档状态无效' };
      try { store.setArchived(id, archived); changed(); return { ok: true, archived }; }
      catch { return { ok: false, text: archived ? '没能归档，请重试' : '没能恢复，请重试' }; }
    });
    ipcMain.handle('inbox:open', (_e, id) => openEntry(id));
    const editResult = (fn) => {
      try { return { ok: true, ...fn() }; }
      catch (error) { return { ok: false, text: error.code && !(error instanceof InboxError) ? '无法读取或保存这条收纳' : error.message }; }
    };
    ipcMain.handle('inbox:readEdit', (_e, id) => editResult(() => ({ value: store.readEdit(id) })));
    ipcMain.handle('inbox:saveEdit', (_e, id, draft) => editResult(() => {
      const result = store.saveEdit(id, draft);
      if (result.changed) changed();
      return result;
    }));
    ipcMain.handle('inbox:saveDocument', (event, id, draft) => editResult(() => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame ||
          !frame.url.startsWith('file:') || !new URL(frame.url).pathname.endsWith('/electron/renderer/calendar.html')) {
        throw new InboxError('protected', '不允许从此页面保存正文');
      }
      const result = store.saveDocument(id, draft);
      if (result.changed) changed();
      return result;
    }));
    ipcMain.handle('inbox:reveal', (_e, id) => reveal(id));
    ipcMain.handle('inbox:remove', (_e, id) => removeWithUndo(id));
    ipcMain.handle('inbox:undo', (_e, id) => undoRemove(id));
    ipcMain.handle('inbox:addTag', (_e, id, tag) => addTag(id, tag));
    ipcMain.handle('inbox:removeItemTag', (_e, id, tag) => {
      if (typeof id !== 'string' || typeof tag !== 'string' || !tag || tag.length > 64) return { ok: false, text: '标签无效' };
      try { const meta = store.removeTagFromItem(id, tag); changed(); return { ok: true, tags: meta.tags }; }
      catch (error) { return { ok: false, code: error.code, text: error.message }; }
    });
    ipcMain.handle('inbox:addCaptureTags', (_e, id, names) => {
      if (typeof id !== 'string' || !Array.isArray(names) || names.length > Q.MAX_TAGS ||
          names.some((name) => typeof name !== 'string' || name.length > 64)) {
        return { ok: false, text: '标签无效' };
      }
      try { store.addTags(id, names); changed(); return { ok: true }; }
      catch (error) { return { ok: false, text: String(error.code || '').startsWith('tag-') ? error.message : errorText(error) }; }
    });
    ipcMain.handle('inbox:copy', (_e, id) => copyEntry(id));
    ipcMain.handle('inbox:relink', (e, id) => relink(id, e));
    ipcMain.handle('inbox:days', () => days());
    ipcMain.handle('inbox:dayCounts', () => dayCounts());
    ipcMain.handle('inbox:tags', () => listTags());
    ipcMain.handle('inbox:tagCreate', (_e, name) => createTag(name));
    ipcMain.handle('inbox:tagRename', (_e, id, name) => renameTag(id, name));
    ipcMain.handle('inbox:tagDelete', (_e, idOrName) => deleteTag(idOrName));
    ipcMain.on('inbox:tagMenu', (event, tag) => {
      // 0.1.56：右键删除先回到渲染层就地确认，再走 inbox:tagDelete。
      const menu = Menu.buildFromTemplate([{ id: 'inbox-tag-delete', label: '删除这个标签', click: () => { if (!event.sender.isDestroyed()) event.sender.send('inbox:requestTagDelete', tag); } }]);
      if (E2E) { lastMenu = menu; return; }
      menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });
    ipcMain.on('inbox:contextMenu', (event, id) => {
      const e = store.get(id);
      const isFile = !!(e && e.meta && e.meta.type === 'file' && !e.meta.missing);
      const menu = Menu.buildFromTemplate([
        ...(isFile ? [{ id: 'inbox-reveal', label: '在 Finder 中显示', click: () => reveal(id) }, { type: 'separator' }] : []),
        { id: 'inbox-edit', label: '编辑收纳…', click: () => { if (!event.sender.isDestroyed()) event.sender.send('inbox:requestEdit', id); } },
        { id: 'inbox-delete', label: '删除这条', click: () => { if (!event.sender.isDestroyed()) event.sender.send('inbox:requestDelete', id); } }
      ]);
      if (E2E) { lastMenu = menu; return; }
      menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });
  }
  let lastMenu = null;

  // 托盘事件（仅 macOS 会触发）
  function attachTray(tray) {
    if (!tray) return;
    tray.on('drag-enter', () => show());
    tray.on('drag-leave', () => { if (!busy && state.state === 'idle') scheduleHide(LEAVE_HIDE_MS); });
    tray.on('drag-end', () => { if (!busy && state.state !== 'success' && state.state !== 'error') scheduleHide(LEAVE_HIDE_MS); });
    tray.on('drop-files', (_e, files) => { handleDrop({ files }); });
    tray.on('drop-text', (_e, text) => { handleDrop({ text }); });
  }

  return {
    store, register, attachTray, removeWithUndo, undoRemove, show, hide, handleDrop, captureClipboard, saveRegionImage, showError,
    isVisible: () => visible,
    window: () => win,
    e2e: {
      state: () => ({ visible, ...state, bounds: win && !win.isDestroyed() ? win.getBounds() : null }),
      openCalls: () => e2eOpenCalls.slice(),
      menuItems: () => (lastMenu ? lastMenu.items.map((i) => ({ id: i.id, label: i.label, type: i.type })) : null),
      clickMenu: (id) => { const it = lastMenu && lastMenu.getMenuItemById(id); if (!it) return false; it.click(); lastMenu = null; return true; },
      copyCalls: () => e2eCopyCalls.slice(),
      lastDrop: () => lastDropPayload,
      setClipboard: (c) => { e2eClipboard = c || null; lastClip = { hash: '', at: 0 }; return true; },
      resetClipDup: () => { lastClip = { hash: '', at: 0 }; return true; },
      setRelinkPath: (p) => { e2eRelinkPath = p || null; return true; },
      leave: () => { if (!busy && state.state !== 'success' && state.state !== 'error') scheduleHide(LEAVE_HIDE_MS); return true; }
    }
  };
}

module.exports = { createInboxController, frontAppName, computeDropzoneBounds, errorText, DZ_W, DZ_H, DZ_GAP };
