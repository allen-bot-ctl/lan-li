'use strict';
// 0.1.50 框选层 / 权限说明卡的 preload。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lanliRegion', {
  commit: (rect) => ipcRenderer.send('region:commit', rect),
  cancel: () => ipcRenderer.send('region:cancel'),
  state: (s) => ipcRenderer.send('region:state', s),
  openPermissionSettings: () => ipcRenderer.send('region:openPermissionSettings'),
  closePermission: () => ipcRenderer.send('region:closePermission'),
  onReset: (cb) => ipcRenderer.on('region:reset', (_e, o) => cb(o || {}))
});
