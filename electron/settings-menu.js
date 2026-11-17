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
      label: '登录时打开',
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
    { type: 'separator' },
    {
      id: 'quit',
      label: '退出栏历',
      accelerator: 'Cmd+Q',
      click: callback(handlers.quit)
    }
  ];
}

module.exports = {
  buildSettingsMenuTemplate
};
