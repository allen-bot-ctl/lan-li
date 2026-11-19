'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSettingsMenuTemplate } = require('../electron/settings-menu');

test('settings menu follows the confirmed order and separators', () => {
  const template = buildSettingsMenuTemplate(
    { version: 'v0.1.16', openAtLogin: true },
    {}
  );

  assert.deepEqual(
    template.map((item) => (item.type === 'separator' ? '---' : item.id)),
    [
      'check-update',
      'open-at-login',
      '---',
      'choose-almanac-style',
      'edit-clocks',
      'choose-weather-city',
      'more-settings',
      '---',
      'quit'
    ]
  );
});

test('check update carries the version sublabel and calls its action', () => {
  let checked = 0;
  const template = buildSettingsMenuTemplate(
    { version: 'v0.1.16', openAtLogin: false },
    { checkUpdate: () => { checked += 1; } }
  );

  const checkUpdate = template[0];
  assert.equal(checkUpdate.label, '检查更新');
  assert.equal(checkUpdate.sublabel, 'v0.1.16');
  assert.equal(typeof checkUpdate.click, 'function');

  checkUpdate.click();
  assert.equal(checked, 1);
});

test('login item is a checkbox reflecting state and reports the new value', () => {
  const values = [];
  const template = buildSettingsMenuTemplate(
    { version: 'v0.1.16', openAtLogin: true },
    { setOpenAtLogin: (value) => values.push(value) }
  );

  const login = template[1];
  assert.equal(login.label, '开机自启动');
  assert.equal(login.type, 'checkbox');
  assert.equal(login.checked, true);

  login.click({ checked: false });
  login.click({ checked: true });
  assert.deepEqual(values, [false, true]);
});

test('panel and quit entries forward to their actions', () => {
  const called = [];
  const template = buildSettingsMenuTemplate(
    { version: 'v0.1.16', openAtLogin: false },
    {
      openAlmanacStyles: () => called.push('almanac'),
      openClocks: () => called.push('clocks'),
      openWeather: () => called.push('weather'),
      openMore: () => called.push('more'),
      quit: () => called.push('quit')
    }
  );

  template[3].click();
  template[4].click();
  template[5].click();
  template[6].click();
  template[8].click();
  assert.deepEqual(called, ['almanac', 'clocks', 'weather', 'more', 'quit']);
});

test('more settings sits directly above the quit separator', () => {
  const template = buildSettingsMenuTemplate(
    { version: 'v0.1.16', openAtLogin: false },
    {}
  );
  const separatorIndexes = template
    .map((item, index) => (item.type === 'separator' ? index : -1))
    .filter((index) => index >= 0);
  const lastSeparator = separatorIndexes[separatorIndexes.length - 1];

  assert.equal(template[lastSeparator - 1].id, 'more-settings');
  assert.equal(template[lastSeparator - 1].label, '全部设置…');
});

test('quit entry displays the Cmd+Q accelerator', () => {
  const template = buildSettingsMenuTemplate({ version: 'v0.1.16' }, {});
  const quit = template[template.length - 1];

  assert.equal(quit.label, '退出栏历');
  assert.equal(quit.accelerator, 'Cmd+Q');
});

test('missing version and actions are tolerated', () => {
  const template = buildSettingsMenuTemplate(undefined, undefined);
  const checkUpdate = template[0];

  assert.equal('sublabel' in checkUpdate, false);
  assert.doesNotThrow(() => {
    for (const item of template) {
      if (typeof item.click === 'function') item.click({ checked: false });
    }
  });
});
