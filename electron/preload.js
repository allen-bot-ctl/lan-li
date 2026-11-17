'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanli', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  getState: () => ipcRenderer.invoke('calendar:getState'),
  setView: (view) => ipcRenderer.invoke('calendar:setView', view),
  goToday: () => ipcRenderer.invoke('calendar:goToday'),
  addClock: (payload) => ipcRenderer.invoke('clocks:add', payload),
  removeClock: (payload) => ipcRenderer.invoke('clocks:remove', payload),
  selectClock: (payload) => ipcRenderer.invoke('clocks:select', payload),
  setMenuBarClock: (payload) => ipcRenderer.invoke('clocks:setMenuBar', payload),
  searchClocks: (payload) => ipcRenderer.invoke('clocks:search', payload),
  getWeather: (coordinates, location) => ipcRenderer.invoke('weather:get', coordinates, location),
  onWeatherUpdate: (callback) => {
    ipcRenderer.on('weather:update', (_event, payload) => callback(payload));
  },
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
