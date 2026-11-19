'use strict';

// Builds the renderer-facing settings menu as a plain Electron menu template.
// No Electron import: the template is data plus injected callbacks so it can
// be required directly by `node --test`. The main process passes the result to
// `Menu.buildFromTemplate` and `menu.popup`.
function noop() {}

function callback(value) {
  return typeof value === 'function' ? value : noop;
}

function buildSettingsMenuTemplate(state, actions) {
  const current = state && typeof state === 'object' ? state : {};
  const handlers = actions && typeof actions === 'object' ? actions : {};
  const version = typeof current.version === 'string' ? current.version.trim() : '';

  const checkUpdate = {
    id: 'check-update',
    label: '检查更新',
    click: callback(handlers.checkUpdate)
  };
  if (version) checkUpdate.sublabel = version;

  return [
    checkUpdate,
    {
      id: 'open-at-login',
      label: '开机自启动',
      type: 'checkbox',
      checked: current.openAtLogin === true,
      click: (item) => {
        // Use the state Electron reports after the click instead of the
        // captured value so the checkbox and the real login item stay in sync.
        callback(handlers.setOpenAtLogin)(Boolean(item && item.checked));
      }
    },
    { type: 'separator' },
    {
      id: 'choose-almanac-style',
      label: '黄历风格…',
      click: callback(handlers.openAlmanacStyles)
    },
    {
      id: 'edit-clocks',
      label: '编辑世界时钟…',
      click: callback(handlers.openClocks)
    },
    {
      id: 'choose-weather-city',
      label: '更换天气城市…',
      click: callback(handlers.openWeather)
    },
    {
      id: 'more-settings',
      label: '全部设置…',
      click: callback(handlers.openMore)
    },
    { type: 'separator' },
    {
      id: 'quit',
      label: '退出栏历',
      accelerator: 'Cmd+Q',
      click: callback(handlers.quit)
    }
  ];
}

// 0.1.40：菜单栏时钟右键菜单，和栏况 0.1.14 一致。
function buildTrayMenuTemplate(actions = {}) {
  const call = (name) => () => { if (typeof actions[name] === 'function') actions[name](); };
  return [
    { id: 'tray-check-update', label: '检查更新…', click: call('checkUpdate') },
    { id: 'tray-open-settings', label: '设置中心…', click: call('openSettings') },
    { type: 'separator' },
    { id: 'tray-quit', label: '退出栏历', accelerator: 'CommandOrControl+Q', click: call('quit') }
  ];
}

module.exports = {
  buildSettingsMenuTemplate,
  buildTrayMenuTemplate
};
