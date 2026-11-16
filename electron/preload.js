'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanli', {
  getState: () => ipcRenderer.invoke('calendar:getState'),
  setView: (view) => ipcRenderer.invoke('calendar:setView', view),
  goToday: () => ipcRenderer.invoke('calendar:goToday'),
  onTick: (callback) => {
    ipcRenderer.on('calendar:onTick', (_event, payload) => callback(payload));
  },
  pointerEnter: () => ipcRenderer.send('pointer:enter'),
  pointerLeave: () => ipcRenderer.send('pointer:leave'),
  setLogin: (openAtLogin) => ipcRenderer.invoke('login:set', openAtLogin),
  quit: () => ipcRenderer.send('app:quit'),
  onUpdateNotice: (callback) => {
    ipcRenderer.on('update:notice', (_event, payload) => callback(payload));
  },
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update:status', (_event, payload) => callback(payload));
  },
  restartToUpdate: () => ipcRenderer.send('update:restart'),
  openLatestRelease: () => ipcRenderer.send('update:openLatest')
});
