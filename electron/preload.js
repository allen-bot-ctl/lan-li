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
  setCaptureHotkey: (value) => ipcRenderer.invoke('settings:setCaptureHotkey', value),
  setHotkey: (kind, accelerator) => ipcRenderer.invoke('settings:setHotkey', { kind, accelerator }),
  setSettingsView: (open) => ipcRenderer.send('settings:viewState', open),
  searchClocks: (payload) => ipcRenderer.invoke('clocks:search', payload),
  getWeather: () => ipcRenderer.invoke('weather:get'),
  refreshWeather: () => ipcRenderer.invoke('weather:refresh'),
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
  openLatestRelease: () => ipcRenderer.send('update:openLatest'),
  // 0.1.42 收纳
  listInbox: () => ipcRenderer.invoke('inbox:list'),
  captureClipboard: () => ipcRenderer.invoke('inbox:captureClipboard'),
  openInboxEntry: (id) => ipcRenderer.invoke('inbox:open', id),
  revealInboxEntry: (id) => ipcRenderer.invoke('inbox:reveal', id),
  removeInboxEntry: (id) => ipcRenderer.invoke('inbox:remove', id),
  inboxContextMenu: (id) => ipcRenderer.send('inbox:contextMenu', id),
  undoRemoveInboxEntry: (id) => ipcRenderer.invoke('inbox:undo', id),
  addInboxTag: (id, tag) => ipcRenderer.invoke('inbox:addTag', id, tag),
  inboxTags: () => ipcRenderer.invoke('inbox:tags'),
  onInboxRequestTagDelete: (callback) => { ipcRenderer.on('inbox:requestTagDelete', (_e, name) => callback(name)); },
  inboxTagCreate: (name) => ipcRenderer.invoke('inbox:tagCreate', name),
  inboxTagRename: (id, name) => ipcRenderer.invoke('inbox:tagRename', id, name),
  inboxTagDelete: (idOrName) => ipcRenderer.invoke('inbox:tagDelete', idOrName),
  copyInboxEntry: (id) => ipcRenderer.invoke('inbox:copy', id),
  relinkInboxEntry: (id) => ipcRenderer.invoke('inbox:relink', id),
  inboxDays: () => ipcRenderer.invoke('inbox:days'),
  inboxDayCounts: () => ipcRenderer.invoke('inbox:dayCounts'),
  inboxTagMenu: (tag) => ipcRenderer.send('inbox:tagMenu', tag),
  setInboxView: (open) => ipcRenderer.send('inbox:viewState', open),
  onInboxEscape: (callback) => { ipcRenderer.on('inbox:escape', () => callback()); },
  onInboxRequestDelete: (callback) => { ipcRenderer.on('inbox:requestDelete', (_e, id) => callback(id)); },
  onInboxChanged: (callback) => {
    ipcRenderer.on('inbox:changed', () => callback());
  }
});
