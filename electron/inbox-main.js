'use strict';
// 0.1.42 收纳：主进程部分（接纳框窗口、托盘拖拽事件、落盘、列表 IPC）。
const path = require('node:path');
const fs = require('node:fs');
const { createInboxStore, classifyDrop, imgSources, htmlToPlain, MAX_IMAGE_BYTES, InboxError } = require('./inbox-store');
const Q = require('./renderer/inbox-query');
const UNDO_MS = 5000;

const DZ_W = 240;
const DZ_H = 120;
const DZ_GAP = 6;
const LEAVE_HIDE_MS = 1200;
const SUCCESS_HIDE_MS = 1200;
const ERROR_HIDE_MS = 2000;
const TEXT_IDLE = '拖到这里，放进收纳';
const TEXT_UNSUPPORTED = '这个内容暂时收不进来';

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
    makeThumb: (src, dest) => {
      let img = nativeImage.createFromPath(src);
      if (img.isEmpty()) return;
      const { width, height } = img.getSize();
      if (Math.max(width, height) > 320) img = img.resize(width >= height ? { width: 320 } : { height: 320 });
      fs.writeFileSync(dest, img.toJPEG(80));
    }
  });
  try { store.cleanup(); } catch { /* ignore */ }

  let win = null;
  let visible = false;
  let state = { state: 'idle', text: TEXT_IDLE };
  let hideTimer = null;
  let busy = false;
  let lastSaved = [];
  let e2eOpenCalls = [];
  let lastDropPayload = null;
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

  function show() {
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
    if (deps.onShow) deps.onShow();
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
      lastSaved = store.saveAll(items);
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
      if (!/^https?:/i.test(m.sourceUrl || '')) return { ok: false };
      if (E2E) { e2eOpenCalls.push({ how: 'openExternal', target: m.sourceUrl }); return { ok: true }; }
      shell.openExternal(m.sourceUrl);
      return { ok: true };
    }
    // 内嵌图片换成 data: 内联，详情 iframe 用 sandbox 且无脚本
    let html = e.html;
    for (const a of m.assets || []) {
      try { html = html.split(a).join(dataUrl(path.join(e.dir, a))); } catch { /* 缺图就留相对路径 */ }
    }
    return { ok: true, html };
  }

  function reveal(id) {
    const e = store.get(id);
    const target = e.meta.type === 'file' && !e.meta.missing ? e.meta.sourcePath : (e.filePath || path.join(e.dir, 'meta.json'));
    if (E2E) { e2eOpenCalls.push({ how: 'showItemInFolder', target }); return true; }
    shell.showItemInFolder(target);
    return true;
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

  // 复制：文件复制路径、图片复制图片、文字复制富文本、链接复制 URL
  function copyEntry(id) {
    const e = store.get(id);
    const m = e.meta;
    let call;
    if (m.type === 'file') { call = { kind: 'text', text: m.sourcePath || '' }; clipboard.writeText(call.text); }
    else if (m.type === 'image') { call = { kind: 'image', file: e.filePath }; clipboard.writeImage(nativeImage.createFromPath(e.filePath)); }
    else if (m.type === 'text') { call = { kind: 'html', text: htmlToPlain(e.html) }; clipboard.write({ html: e.html, text: call.text }); }
    else { call = { kind: 'text', text: m.sourceUrl || '' }; clipboard.writeText(call.text); }
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

  function days() { return [...new Set(store.list().map((m) => Q.entryDayKey(m)))]; }

  function register() {
    ipcMain.on('drop:enter', () => { cancelHide(); });
    ipcMain.on('drop:leave', () => { if (!busy && state.state !== 'success' && state.state !== 'error') scheduleHide(LEAVE_HIDE_MS); });
    ipcMain.on('drop:data', (_e, payload) => { handleDrop(payload); });
    ipcMain.on('drop:openInbox', () => { hide(); if (deps.openInbox) deps.openInbox(); });
    ipcMain.handle('inbox:list', () => listForRenderer());
    ipcMain.handle('inbox:open', (_e, id) => openEntry(id));
    ipcMain.handle('inbox:reveal', (_e, id) => reveal(id));
    ipcMain.handle('inbox:remove', (_e, id) => removeWithUndo(id));
    ipcMain.handle('inbox:undo', (_e, id) => undoRemove(id));
    ipcMain.handle('inbox:addTag', (_e, id, tag) => addTag(id, tag));
    ipcMain.handle('inbox:copy', (_e, id) => copyEntry(id));
    ipcMain.handle('inbox:relink', (e, id) => relink(id, e));
    ipcMain.handle('inbox:days', () => days());
    ipcMain.on('inbox:tagMenu', (event, tag) => {
      const menu = Menu.buildFromTemplate([{ id: 'inbox-tag-delete', label: '删除这个标签', click: () => removeTag(tag) }]);
      if (E2E) { lastMenu = menu; return; }
      menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });
    ipcMain.on('inbox:contextMenu', (event, id) => {
      const menu = Menu.buildFromTemplate([
        { id: 'inbox-reveal', label: '在 Finder 中显示', click: () => reveal(id) },
        { type: 'separator' },
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
    store, register, attachTray, removeWithUndo, undoRemove, show, hide, handleDrop,
    isVisible: () => visible,
    window: () => win,
    e2e: {
      state: () => ({ visible, ...state, bounds: win && !win.isDestroyed() ? win.getBounds() : null }),
      openCalls: () => e2eOpenCalls.slice(),
      menuItems: () => (lastMenu ? lastMenu.items.map((i) => ({ id: i.id, label: i.label, type: i.type })) : null),
      clickMenu: (id) => { const it = lastMenu && lastMenu.getMenuItemById(id); if (!it) return false; it.click(); lastMenu = null; return true; },
      copyCalls: () => e2eCopyCalls.slice(),
      lastDrop: () => lastDropPayload,
      setRelinkPath: (p) => { e2eRelinkPath = p || null; return true; },
      leave: () => { if (!busy && state.state !== 'success' && state.state !== 'error') scheduleHide(LEAVE_HIDE_MS); return true; }
    }
  };
}

module.exports = { createInboxController, computeDropzoneBounds, errorText, DZ_W, DZ_H, DZ_GAP };
