'use strict';

// 0.1.40：菜单栏时钟右键菜单，和栏况 0.1.14 一致。
// 0.1.50：opts.captureAccelerator / opts.regionAccelerator 为当前快捷键（'' = 已清空，不显示）。
function buildTrayMenuTemplate(actions = {}, opts = {}) {
  const call = (name) => () => { if (typeof actions[name] === 'function') actions[name](); };
  const acc = (v, d) => { const a = v === undefined ? d : v; return a ? { accelerator: a, registerAccelerator: false } : {}; };
  return [
    { id: 'tray-check-update', label: '检查更新…', click: call('checkUpdate') },
    { id: 'tray-capture-clipboard', label: '收纳剪贴板内容', ...acc(opts.captureAccelerator, 'Control+Alt+V'), click: call('captureClipboard') },
    { id: 'tray-region-capture', label: '框选收纳', ...acc(opts.regionAccelerator, 'Control+Alt+S'), click: call('regionCapture') },
    { id: 'tray-open-settings', label: '设置中心…', click: call('openSettings') },
    { type: 'separator' },
    { id: 'tray-quit', label: '退出栏历', accelerator: 'CommandOrControl+Q', click: call('quit') }
  ];
}

module.exports = {
  buildTrayMenuTemplate
};
