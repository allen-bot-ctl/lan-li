'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanli', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  getState: () => ipcRenderer.invoke('calendar:getState'),
  setView: (view) => ipcRenderer.invoke('calendar:setView', view),
  goToday: () => ipcRenderer.invoke('calendar:goToday'),
  addClock: (payload) => ipcRenderer.invoke('clocks:add', payload),
  removeClock: (payload) => ipcRenderer.invoke('clocks:remove', payload),
  setMenuBarClock: (payload) => ipcRenderer.invoke('clocks:setMenuBar', payload),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setOpenAtLogin: (value) => ipcRenderer.invoke('settings:setOpenAtLogin', value),
  setMenuBarShowDate: (value) => ipcRenderer.invoke('settings:setMenuBarShowDate', value),
  setSettingsView: (open) => ipcRenderer.send('settings:viewState', open),
  searchClocks: (payload) => ipcRenderer.invoke('clocks:search', payload),
  getWeather: () => ipcRenderer.invoke('weather:get'),
  searchCity: (query) => ipcRenderer.invoke('weather:searchCity', query),
  getQuickCities: () => ipcRenderer.invoke('weather:quickCities'),
  setCity: (city) => ipcRenderer.invoke('weather:setCity', city),
  getAlmanacStyles: () => ipcRenderer.invoke('almanac:getStyles'),
  setAlmanacStyle: (id) => ipcRenderer.invoke('almanac:setStyle', id),
  getAlmanacForDate: (key) => ipcRenderer.invoke('almanac:getForDate', key),
  onWeatherUpdate: (callback) => {
    ipcRenderer.on('weather:update', (_event, payload) => callback(payload));
  },
  onTick: (callback) => {
    ipcRenderer.on('calendar:onTick', (_event, payload) => callback(payload));
  },
  pointerEnter: () => ipcRenderer.send('pointer:enter'),
  pointerLeave: () => ipcRenderer.send('pointer:leave'),
  togglePin: () => ipcRenderer.invoke('pin:toggle'),
  onPinState: (callback) => {
    ipcRenderer.on('pin:state', (_event, payload) => callback(payload));
  },
  openSettings: (position) => ipcRenderer.send('menu:openSettings', position),
  onOpenPanel: (callback) => {
    ipcRenderer.on('ui:openPanel', (_event, panel) => callback(panel));
  },
  onUpdateNotice: (callback) => {
    ipcRenderer.on('update:notice', (_event, payload) => callback(payload));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update:status', (_event, payload) => callback(payload));
  },
  checkUpdate: () => ipcRenderer.send('update:check'),
  restartToUpdate: () => ipcRenderer.send('update:restart'),
  openLatestRelease: () => ipcRenderer.send('update:openLatest')
});
