'use strict';
// 0.1.42 收纳接纳框的 preload：取拖拽数据交给主进程。
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lanliDrop', {
  pathsOf: (files) => Array.from(files || []).map((f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } }).filter(Boolean),
  enter: () => ipcRenderer.send('drop:enter'),
  leave: () => ipcRenderer.send('drop:leave'),
  drop: (payload) => ipcRenderer.send('drop:data', payload),
  openInbox: () => ipcRenderer.send('drop:openInbox'),
  onState: (cb) => ipcRenderer.on('drop:state', (_e, s) => cb(s))
});
