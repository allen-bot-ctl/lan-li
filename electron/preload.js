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
  setMenuBarCompactClock: (value) => ipcRenderer.invoke('settings:setMenuBarCompactClock', value),
  setInboxDateLinkEnabled: (value) => ipcRenderer.invoke('settings:setInboxDateLinkEnabled', value),
  onInboxDateLinkChanged: (callback) => ipcRenderer.on('settings:inboxDateLinkChanged', (_event, value) => callback(value)),
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
  setQuitConfirm: (open) => ipcRenderer.send('quit:confirmState', open),
  onQuitEscape: (callback) => { ipcRenderer.on('quit:escape', () => callback()); },
  quitApp: () => ipcRenderer.send('app:quit'),
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
  addInboxManual: (text) => ipcRenderer.invoke('inbox:addManual', text),
  captureClipboard: () => ipcRenderer.invoke('inbox:captureClipboard'),
  openInboxEntry: (id) => ipcRenderer.invoke('inbox:open', id),
  readInboxEdit: (id) => ipcRenderer.invoke('inbox:readEdit', id),
  saveInboxEdit: (id, draft) => ipcRenderer.invoke('inbox:saveEdit', id, draft),
  saveInboxDocument: (id, draft) => ipcRenderer.invoke('inbox:saveDocument', id, draft),
  onInboxRequestEdit: (callback) => { ipcRenderer.on('inbox:requestEdit', (_e, id) => callback(id)); },
  revealInboxEntry: (id) => ipcRenderer.invoke('inbox:reveal', id),
  removeInboxEntry: (id) => ipcRenderer.invoke('inbox:remove', id),
  inboxContextMenu: (id) => ipcRenderer.send('inbox:contextMenu', id),
  undoRemoveInboxEntry: (id) => ipcRenderer.invoke('inbox:undo', id),
  addInboxTag: (id, tag) => ipcRenderer.invoke('inbox:addTag', id, tag),
  addInboxCaptureTags: (id, names) => ipcRenderer.invoke('inbox:addCaptureTags', id, names),
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
  // 0.1.60 帮阅
  listReader: () => ipcRenderer.invoke('reader:list'),
  getReader: (id) => ipcRenderer.invoke('reader:get', id),
  getReaderQa: (id) => ipcRenderer.invoke('reader:getQa', id),
  sendReaderQa: (input) => ipcRenderer.invoke('reader:sendQa', input),
  cancelReaderQa: (input) => ipcRenderer.send('reader:cancelQa', input),
  onReaderQaDelta: (callback) => {
    const handler = (_event,payload) => callback(payload);
    ipcRenderer.on('reader:qaDelta',handler);
    return () => ipcRenderer.removeListener('reader:qaDelta',handler);
  },
  submitReader: (url) => ipcRenderer.invoke('reader:submit', url),
  retryReader: (id) => ipcRenderer.invoke('reader:retry', id),
  resummarizeReader: (id) => ipcRenderer.invoke('reader:resummarize', id),
  removeReader: (id) => ipcRenderer.invoke('reader:remove', id),
  openReaderOriginal: (id) => ipcRenderer.invoke('reader:openOriginal', id),
  copyReader: (id) => ipcRenderer.invoke('reader:copy', id),
  readerClipboardUrl: () => ipcRenderer.invoke('reader:clipboardUrl'),
  getLlmUsage: (request) => ipcRenderer.invoke('llm:getUsage', request),
  getReaderConfig: () => ipcRenderer.invoke('reader:getConfig'),
  saveReaderConfig: (c) => ipcRenderer.invoke('reader:saveConfig', c),
  removeReaderKey: () => ipcRenderer.invoke('reader:removeKey'),
  openReaderLink: (href) => ipcRenderer.invoke('reader:openLink', href),
  getReaderPrompt: () => ipcRenderer.invoke('reader:getPrompt'),
  saveReaderPrompt: (t) => ipcRenderer.invoke('reader:savePrompt', t),
  setPromptAiOpen: (open) => ipcRenderer.send('promptai:state', open),
  onPromptAiEscape: (callback) => { ipcRenderer.on('promptai:escape', () => callback()); },
  rewriteReaderPrompt: (a) => ipcRenderer.invoke('reader:rewritePrompt', a),
  cancelRewriteReaderPrompt: (rid) => ipcRenderer.send('reader:cancelRewrite', rid),
  resetReaderPrompt: () => ipcRenderer.invoke('reader:resetPrompt'),
  testReaderConfig: (c) => ipcRenderer.invoke('reader:testConfig', c),
  setReaderView: (open) => ipcRenderer.send('reader:viewState', open),
  onReaderChanged: (callback) => { ipcRenderer.on('reader:changed', () => callback()); },
  onReaderDone: (callback) => { ipcRenderer.on('reader:done', (_e, p) => callback(p)); },
  onReaderEscape: (callback) => { ipcRenderer.on('reader:escape', () => callback()); },
  onInboxChanged: (callback) => {
    ipcRenderer.on('inbox:changed', () => callback());
  }
});
