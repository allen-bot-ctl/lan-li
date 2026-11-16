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
  quit: () => ipcRenderer.send('app:quit')
});
