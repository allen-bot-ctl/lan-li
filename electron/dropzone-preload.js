'use strict';
// 0.1.42 收纳接纳框的 preload：取拖拽数据交给主进程。
// 0.1.48：File/FileList 跨 contextBridge 会变成空对象，取不到路径。
// 改为 preload 自己监听 drop，在隔离世界里拿原生 File 调 webUtils.getPathForFile。
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function pathOf(f) { try { return webUtils.getPathForFile(f) || ''; } catch { return ''; } }

window.addEventListener('drop', (e) => {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (!dt) { ipcRenderer.send('drop:data', { files: [], html: '', text: '', uriList: [], fileCount: 0 }); return; }
  const list = Array.from(dt.files || []);
  ipcRenderer.send('drop:data', {
    files: list.map(pathOf).filter(Boolean),
    fileCount: list.length,
    html: dt.getData('text/html') || '',
    text: dt.getData('text/plain') || '',
    uriList: (dt.getData('text/uri-list') || '').split(/\r?\n/).filter(Boolean)
  });
}, true);

contextBridge.exposeInMainWorld('lanliDrop', {
  enter: () => ipcRenderer.send('drop:enter'),
  leave: () => ipcRenderer.send('drop:leave'),
  openInbox: () => ipcRenderer.send('drop:openInbox'),
  onState: (cb) => ipcRenderer.on('drop:state', (_e, s) => cb(s))
});
